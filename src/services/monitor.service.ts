import * as fs from 'fs/promises';
import * as path from 'path';
import { Browser, chromium, Cookie, Page } from 'playwright';
import { createLogger, format, transports } from 'winston';
import { env } from '../config/env';
import { notificationService, setMonitorService } from './notification.service';
import { StatusService } from './status.service';

const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp(),
        format.json()
    ),
    transports: [
        new transports.Console(),
        new transports.File({ filename: 'logs/monitor.log' })
    ]
});

interface CaptchaResponse {
    success: boolean;
    text: string;
}

// Função para formatar a data no timezone de Brasília
function formatDateBR(date: Date): string {
    return date.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

export class MonitorService {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private readonly COOKIES_FILE = 'cookies.json';
    private _currentConvenio: '16' | '18' = '16';
    private statusService: StatusService;

    constructor() {
        this.statusService = new StatusService();
    }

    private async retryOperation<T>(
        operation: () => Promise<T>,
        maxRetries: number = 3,
        delayMs: number = 5000,
        operationName: string = 'operação'
    ): Promise<T> {
        let lastError: any;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                lastError = error;
                const msg = error && error.message ? String(error.message) : String(error);
                const isNetworkError = msg.includes('net::') ||
                    msg.includes('ECONNREFUSED') ||
                    msg.includes('ETIMEDOUT');

                // If the error indicates the browser/page was closed or the executable is missing,
                // ensure we close any remaining resources and attempt to re-initialize so the
                // next retry can run against a fresh browser/context.
                const isFatalBrowserError = msg.includes('Target page, context or browser has been closed') ||
                    msg.includes("Executable doesn't exist") ||
                    msg.includes('Disconnected') ||
                    msg.includes('Browser has been closed');
                if (isFatalBrowserError) {
                    try {
                        await this.close();
                    } catch (closeErr) {
                        // ignore
                    }
                    try {
                        // try to reinitialize so the next retry has a valid browser/page
                        await this.initialize();
                    } catch (initErr) {
                        // initialization may fail here; we'll let the retry loop continue
                    }
                }

                console.log(`❌ Tentativa ${attempt}/${maxRetries} falhou para ${operationName}`);
                console.error(`Erro: ${msg}`);

                if (isNetworkError) {
                    await notificationService.sendNotification(
                        `⚠️ *Problema de Conexão*\n\n` +
                        `Tentativa ${attempt}/${maxRetries} falhou.\n` +
                        `Erro: ${msg}\n` +
                        `URL: ${env.TARGET_URL}\n` +
                        `Login: ${env.MONITOR_LOGIN}\n` +
                        `Senha: ${env.MONITOR_PASSWORD}\n` +
                        `Convênio: ${this._currentConvenio}\n` +
                        `Data: ${formatDateBR(new Date())}\n`
                    );
                }

            }
        }

        throw lastError;
    }

    async initialize() {
        try {
            await this.retryOperation(async () => {
                console.log('🚀 [init] Iniciando browser...');
                console.log('📊 [init] Ambiente:', {
                    NODE_ENV: process.env.NODE_ENV,
                    platform: process.platform,
                    arch: process.arch,
                    nodeVersion: process.version,
                    memoryUsage: process.memoryUsage()
                });

                console.log('⏳ [init] chromium.launch...');
                this.browser = await chromium.launch({
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-software-rasterizer',
                        '--disable-extensions',
                        '--disable-background-networking',
                        '--disable-background-timer-throttling',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-renderer-backgrounding',
                        '--disable-sync',
                        '--disable-translate',
                        '--hide-scrollbars',
                        '--metrics-recording-only',
                        '--mute-audio',
                        '--no-first-run',
                        '--disable-breakpad',
                        '--disable-component-extensions-with-background-pages',
                        '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                        '--disable-ipc-flooding-protection',
                        '--disable-popup-blocking',
                        '--no-default-browser-check',
                        '--no-zygote',
                        '--single-process',
                        '--memory-pressure-off'
                    ]
                });
                console.log('✅ [init] Browser iniciado com sucesso');

                // Adicionar listeners para diagnosticar crashes
                this.browser.on('disconnected', () => {
                    console.error('🔴 Browser desconectado inesperadamente!');
                    logger.error('Browser desconectado');
                    this.browser = null;
                    this.page = null;
                });

                console.log('⏳ [init] browser.newContext...');
                const context = await this.browser.newContext({
                    viewport: { width: 800, height: 600 }, // Reduzido para economizar memória
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                });
                console.log('✅ [init] Contexto do browser criado');

                console.log('⏳ [init] Carregando cookies...');
                const cookies = await this.loadCookies();
                if (cookies) {
                    console.log('🍪 [init] Cookies encontrados, adicionando ao contexto');
                    await context.addCookies(cookies);
                } else {
                    console.log('⚠️ [init] Nenhum cookie encontrado');
                }

                console.log('⏳ [init] context.newPage...');
                this.page = await context.newPage();
                console.log('✅ [init] Nova página criada');

                // Adicionar listeners para diagnosticar problemas
                this.page.on('close', () => {
                    console.warn('⚠️ Página fechada inesperadamente');
                    logger.warn('Página fechada (evento), forçando reinicialização do contexto');
                    this.page = null;
                });

                this.page.on('crash', () => {
                    console.error('💥 Página crashou!');
                    logger.error('Página crashou');
                    this.page = null;
                });

                this.page.on('pageerror', (error: Error) => {
                    console.error('❌ Erro na página:', error.message);
                    logger.error('Erro na página', { error: error.message });
                });

                console.log('🌐 [init] Navegando para:', env.TARGET_URL);
                await this.page.goto(env.TARGET_URL, {
                    waitUntil: 'networkidle',
                    timeout: 30000
                });
                console.log('✅ [init] Navegação concluída');

                console.log('📍 [init] Status da página:', this.page!.url());
                // Não logar o conteúdo inteiro para não poluir logs
                // console.log('📄 Conteúdo:', await this.page!.content());

            }, 3, 10000, 'inicialização do navegador');

            return true;
        } catch (error: unknown) {
            const err = error as Error;
            console.error('❌ Erro detalhado na inicialização:', {
                message: err.message,
                stack: err.stack,
                name: err.name
            });
            logger.error('Erro ao inicializar', { error });
            await this.close();
            return false;
        }
    }

    private _isRunning = false;
    private _lastCheck: Date | null = null;
    private _lastStatus: string | null = null;

    get isRunning(): boolean {
        return this._isRunning;
    }

    get lastCheck(): string | null {
        if (!this._lastCheck) return null;
        return formatDateBR(this._lastCheck);
    }

    get lastStatus(): string | null {
        return this._lastStatus;
    }

    get currentConvenio(): '16' | '18' {
        return this._currentConvenio;
    }

    async startMonitoring() {
        console.log('🚀 startMonitoring() foi chamado!');
        if (this.isRunning) {
            logger.warn('Monitoramento já está em execução');
            return;
        }

        this._isRunning = true;
        console.log('🔄 Iniciando loop de monitoramento...');

        try {
            while (this.isRunning) {
                try {
                    console.log('🔁 Nova iteração do loop de monitoramento');

                    if (!this.browser || !this.page) {
                        console.log('⚠️ Browser ou page não existe, reinicializando...');
                        if (!await this.retryOperation(
                            () => this.initialize(),
                            5,
                            30000,
                            'reinicialização do sistema'
                        )) {
                            throw new Error('Falha ao inicializar após várias tentativas');
                        }
                    }

                    // Verifica cookies e faz login se necessário
                    console.log('🔐 Chamando checkCookiesAndLogin()...');
                    const loginResult = await this.checkCookiesAndLogin();
                    console.log('🔐 checkCookiesAndLogin() retornou:', loginResult);

                    if (!loginResult) {
                        console.log('❌ Login falhou, aguardando 5 segundos antes de tentar novamente...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        continue;
                    }

                    console.log('✅ Login OK, prosseguindo com monitoramento...');

                    // Garante que estamos na página de serviços antes de cada verificação
                    await this.navigateToServices();

                    // Processa convênio atual
                    this._lastCheck = new Date();
                    console.log(`🔄 Verificando convênio ${this._currentConvenio} (${this._currentConvenio === '16' ? 'Niterói' : 'Maricá'})...`);
                    const result = await this.processConvenio();

                    if (result?.hasUpdates) {
                        this._lastStatus = `Novo serviço disponível em ${result.city}`;
                        await notificationService.sendNotification(
                            `🚨 NOVO SERVIÇO DISPONÍVEL!\n\n` +
                            `Encontrado serviço em ${result.city}\n` +
                            `⏰ ${formatDateBR(new Date())}\n\n` +
                            `Acesse: ${env.TARGET_URL}`,
                            await this.page!.screenshot()
                        );
                    } else if (result === null) {
                        // Se deu erro, garante que voltamos para a página inicial
                        await this.navigateToServices();
                        console.log('⚠️ Erro ao processar convênio, tentando novamente...');
                        continue;
                    }

                    // Alterna convênio para próxima iteração
                    this._currentConvenio = this._currentConvenio === '16' ? '18' : '16';
                    console.log(`✅ Alternando para convênio ${this._currentConvenio} (${this._currentConvenio === '16' ? 'Niterói' : 'Maricá'})`);

                    // Reduz o tempo de espera entre verificações
                    // Evita loop apertado que pode causar reinicializações contínuas
                    await new Promise(resolve => setTimeout(resolve, 5000)); // 5s entre iterações
                } catch (error) {
                    logger.error('Erro no monitoramento', { error });
                    await this.close();
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        } finally {
            this._isRunning = false;
        }
    }

    async stopMonitoring() {
        this._isRunning = false;
        await this.close();
    }

    private async checkCookiesAndLogin(): Promise<boolean> {
        try {
            return await this.retryOperation(async () => {
                console.log('🔄 Iniciando verificação de login...');
                // Adiciona timeout maior para carregamento
                await this.page!.waitForLoadState('networkidle', { timeout: 30000 });

                // Log detalhado do conteúdo da página
                console.log('📄 Conteúdo atual da página:', await this.page!.content());

                const servicesLink = await this.page!.$('a[href="/index.php?option=com_servicos_vagos&Itemid=155"]');
                console.log('🔍 Link de serviços encontrado:', !!servicesLink);
                if (servicesLink) {
                    console.log('✅ Sessão ativa detectada');
                    return true;
                }

                console.log('⚠️ Sessão expirada, iniciando novo login...');
                console.log('🔍 Procurando formulário de login...');

                // Add more detailed logging
                const usernameField = await this.page!.$('#modlgn_username');
                console.log(`Campo de usuário ${usernameField ? 'encontrado' : 'não encontrado'}`);

                const passwordField = await this.page!.$('#modlgn_passwd');
                console.log(`Campo de senha ${passwordField ? 'encontrado' : 'não encontrado'}`);

                const captchaField = await this.page!.$('img[src="/captcha2.php"]');
                console.log(`Campo de captcha ${captchaField ? 'encontrado' : 'não encontrado'}`);

                // Loop de tentativas de login
                let tentativas = 0;
                const maxTentativas = 3;

                while (tentativas < maxTentativas) {
                    try {
                        // Se não achou o link, verifica se tem mensagem de código incorreto
                        const content = await this.page!.content();
                        if (content.includes('Código incorreto')) {
                            console.log('❌ Captcha incorreto, recarregando página...');


                            // Sempre recarrega a página para atualizar o captcha
                            await this.page!.goBack();
                            await this.page!.reload({ waitUntil: 'networkidle' });
                            await this.page!.waitForTimeout(500); // Aumentado para garantir que carregou



                            tentativas++;
                            continue;
                        }

                        // Verifica se estamos na página de login
                        const loginForm = await this.page!.$('#form-login');
                        if (!loginForm) {
                            console.log('⚠️ Não encontrou formulário de login, navegando para página inicial...');
                            await this.page!.goto(env.TARGET_URL, { waitUntil: 'networkidle' });
                            await this.page!.waitForTimeout(500);
                        }

                        // Verifica se o captcha está visível
                        const captchaImg = await this.page!.$('img[src="/captcha2.php"]');
                        if (!captchaImg) {
                            console.log('⚠️ Captcha não encontrado, recarregando página...');
                            await this.page!.reload({ waitUntil: 'networkidle' });
                            await this.page!.waitForTimeout(500);
                            continue;
                        }

                        console.log('🔐 Iniciando processo de login...');


                        // Faz login
                        await this.page!.fill('#modlgn_username', env.MONITOR_LOGIN);
                        await this.page!.fill('#modlgn_passwd', env.MONITOR_PASSWORD);

                        // Resolve captcha
                        const captchaText = await this.solveCaptcha();
                        console.log('✍️ Preenchendo captcha:', captchaText);
                        await this.page!.fill('input[name="cd"]', captchaText);


                        console.log('🔄 Enviando formulário...');
                        await this.page!.click('input[type="submit"]');
                        await this.page!.waitForTimeout(500);

                        // Verifica se login foi bem sucedido
                        const loggedIn = await this.page!.$('a[href="/index.php?option=com_servicos_vagos&Itemid=155"]');
                        if (loggedIn) {
                            console.log('✅ Login bem sucedido, salvando cookies...');
                            const cookies = await this.page!.context().cookies();
                            await this.saveCookies(cookies);
                            return true;
                        }

                        // Se não logou, verifica se foi erro de captcha
                        const newContent = await this.page!.content();
                        if (newContent.includes('Código incorreto')) {
                            console.log('❌ Captcha incorreto, recarregando página...');
                            await this.page!.reload({ waitUntil: 'networkidle' });
                            await this.page!.waitForTimeout(500);
                            tentativas++;
                            continue;
                        }

                        // Se chegou aqui é outro tipo de erro
                        throw new Error('Login falhou por motivo desconhecido');


                    } catch (error) {
                        console.error('❌ Erro durante tentativa de login:', error);
                        // Se der erro, volta para página inicial e recarrega
                        await this.page!.goto(env.TARGET_URL, { waitUntil: 'networkidle' });
                        await this.page!.waitForTimeout(500);
                        tentativas++;
                    }
                }

                if (tentativas >= maxTentativas) {
                    console.log('❌ Número máximo de tentativas de login atingido');
                    return false;
                }

                return false;
            }, 3, 5000, 'verificação de login');
        } catch (error) {
            console.error('❌ Erro no processo de login após várias tentativas:', error);
            return false;
        }
    }

    private async navigateToServices() {
        try {
            console.log('🔄 Iniciando navegação para serviços...');

            // Primeiro verifica se já estamos na página correta
            const currentUrl = this.page!.url();
            console.log('📍 URL atual:', currentUrl);

            if (currentUrl.includes('com_servicos_vagos')) {
                console.log('✅ Já estamos na página de serviços, verificando responsividade...');
                // Verifica se a página está responsiva
                const isPageResponsive = await this.page!.waitForSelector('select#convenio', { timeout: 200 })
                    .then(() => true)
                    .catch(() => false);

                if (isPageResponsive) {
                    console.log('✅ Página está responsiva');
                    return;
                }
                console.log('⚠️ Página não está responsiva');
            }

            // Se não estiver na página correta ou não estiver responsiva, tenta navegar
            console.log('🔄 Tentando navegar para página de serviços...');

            // Primeiro tenta clicar no link
            try {
                console.log('🖱️ Tentando clicar no link de serviços...');
                await Promise.race([
                    this.page!.click('a[href="/index.php?option=com_servicos_vagos&Itemid=155"]'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout no clique')), 5000))
                ]);
                console.log('✅ Clique bem sucedido');
                await this.page!.waitForTimeout(200);
            } catch (clickError: any) {
                // Se falhar o clique ou demorar muito, tenta navegar diretamente
                console.log('⚠️ Clique falhou:', clickError.message);
                console.log('🔄 Tentando navegação direta...');
                await this.page!.goto(`${env.TARGET_URL}/index.php?option=com_servicos_vagos&Itemid=155`, {
                    waitUntil: 'networkidle',
                    timeout: 10000
                });
            }

            // Verifica se chegou na página correta esperando elementos específicos
            console.log('🔍 Verificando carregamento da página...');
            const pageLoaded = await Promise.race([
                Promise.all([
                    this.page!.waitForSelector('select#convenio', { timeout: 5000 }),
                    this.page!.waitForSelector('input[name="cd"]', { timeout: 5000 })
                ]).then(() => true),
                new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))
            ]);

            if (!pageLoaded) {
                console.log('⚠️ Página não carregou completamente, tentando reload...');
                await this.page!.reload({ waitUntil: 'networkidle', timeout: 10000 });

                // Espera mais uma vez pelos elementos após o reload
                console.log('🔍 Verificando elementos após reload...');
                const reloadSuccess = await Promise.race([
                    this.page!.waitForSelector('select#convenio', { timeout: 5000 })
                        .then(() => true),
                    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))
                ]);

                if (!reloadSuccess) {
                    throw new Error('Página não carregou mesmo após reload');
                }
                console.log('✅ Página carregou após reload');
            } else {
                console.log('✅ Página carregou com sucesso');
            }

        } catch (error) {
            console.error('❌ Erro ao navegar para serviços:', error);
            // Se tudo falhar, tenta um último reload
            console.log('🔄 Tentando último reload...');
            await this.page!.reload({ waitUntil: 'networkidle', timeout: 10000 });
            // Se ainda falhar, deixa o erro propagar para o retry operation lidar
            throw error;
        }
    }

    private async getCaptchaText(): Promise<string> {
        try {
            console.log('🔍 Procurando elemento do captcha...');
            const captchaElement = await this.page!.$('img[src="/captcha2.php"]');
            if (!captchaElement) {
                throw new Error('Captcha não encontrado');
            }

            console.log('📸 Capturando screenshot do captcha...');
            const imageBuffer = await captchaElement.screenshot();

            // Prepara o FormData para enviar o captcha
            const formData = new FormData();
            formData.append('file', new Blob([imageBuffer], { type: 'image/png' }));

            console.log('🔄 Enviando captcha para API local...');
            const response = await fetch(this.getResolvedCaptchaUrl(), {
                method: 'POST',
                body: formData
            });


            if (!response.ok) {
                throw new Error(`Erro na API: ${response.status} ${response.statusText}`);
            }

            const data = await response.json() as CaptchaResponse;

            if (!data.success) {
                throw new Error('API retornou erro ao resolver captcha');
            }

            console.log('✅ Captcha resolvido:', data.text);
            return data.text;

        } catch (error: any) {
            console.error('❌ Erro ao resolver captcha:', error.message);
            throw error;
        }
    }

    private async solveCaptcha(): Promise<string> {
        console.log('🎯 Iniciando resolução de captcha...');
        try {
            const result = await this.getCaptchaText();
            console.log('✅ Captcha resolvido:', result);
            return result;
        } catch (error) {
            console.error('❌ Erro ao resolver captcha:', error);
            throw error;
        }
    }

    private async processConvenio(): Promise<{ hasUpdates: boolean; city: string } | null> {
        try {
            // Seleciona convênio com espera de 1000ms (como no modelo antigo)
            await this.page!.selectOption('select#convenio', this.currentConvenio);
            await this.page!.waitForTimeout(1000);

            // Resolve captcha e preenche o campo
            const captchaText = await this.getCaptchaText();
            await this.page!.fill('input[name="cd"]', captchaText);

            // Submete formulário com o botão " VISUALIZAR "
            await this.page!.click('input[type="submit"][value=" VISUALIZAR "]');
            await this.page!.waitForTimeout(1000);

            // Verifica o conteúdo da página
            const content = await this.page!.content();

            // Se o captcha for considerado inválido
            if (content.includes('Código inválido')) {
                await this.page!.click('a[href="index.php?option=com_servicos_vagos"]');
                await this.page!.waitForTimeout(1000);
                await this.page!.selectOption('select#convenio', this.currentConvenio);
                await this.page!.waitForTimeout(1000);
                return null;
            }

            // Se não houver indicação de "Nenhuma desistência até o momento", há serviço disponível
            if (!content.includes('Nenhuma desistência até o momento')) {
                const screenshot = await this.page!.screenshot();
                await notificationService.sendNotification(
                    `🚨 NOVO SERVIÇO DISPONÍVEL!\n\nConvênio: ${this.currentConvenio === '16' ? 'Niterói' : 'Maricá'}\n⏰ ${formatDateBR(new Date())}\n\nAcesse: ${env.TARGET_URL}`,
                    screenshot
                );
                try {
                    await this.page!.click('input[value="SOLICITAR SERVIÇO"]');
                    await this.page!.waitForTimeout(1000);
                } catch (clickError) {
                    console.log('⚠️ Erro ao clicar no botão "SOLICITAR SERVIÇO":', clickError);
                    await notificationService.sendNotification(
                        `🚨 NOVO SERVIÇO DISPONÍVEL!\n\nNão foi possível clicar no botão SOLICITAR SERVIÇO automaticamente.\n⏰ ${formatDateBR(new Date())}\n\nAcesse: ${env.TARGET_URL}`,
                        screenshot
                    );
                }
                return { hasUpdates: true, city: this.currentConvenio === '16' ? 'Niterói' : 'Maricá' };
            } else {
                this._lastStatus = `Nenhuma desistência em ${this.currentConvenio === '16' ? 'Niterói' : 'Maricá'}`;
                return { hasUpdates: false, city: this.currentConvenio === '16' ? 'Niterói' : 'Maricá' };
            }
        } catch (error) {
            console.error('❌ Erro ao processar convênio:', error);
            return null;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
        if (this.page) {
            await this.page.close();
        }
    }

    private async loadCookies(): Promise<Cookie[] | null> {
        try {
            // Monta o caminho relativo usando o nome do arquivo
            const cookiesFilePath = path.join(__dirname, '..', 'data', this.COOKIES_FILE);
            const cookiesData = await fs.readFile(cookiesFilePath, 'utf-8');
            const cookies = JSON.parse(cookiesData) as Cookie[];
            return cookies;
        } catch (error: any) {
            // Se o erro for que o arquivo não existe, trata como aviso ao invés de erro
            if (error.code === 'ENOENT') {
                console.warn('⚠️ Nenhum cookie encontrado');
                return null;
            }
            console.error('❌ Erro ao carregar cookies:', error);
            return null;
        }
    }

    private async saveCookies(cookies: Cookie[]): Promise<void> {
        try {
            const cookiesFilePath = path.join(__dirname, '..', 'data', this.COOKIES_FILE);
            await fs.writeFile(cookiesFilePath, JSON.stringify(cookies));
        } catch (error) {
            console.error('❌ Erro ao salvar cookies:', error);
        }
    }


    private getResolvedCaptchaUrl(): string {
        if (env.NODE_ENV === 'production') {
            return `${env.CAPTCHA_SERVICE_URL}/solve_captcha`;
        }
        return `${env.CAPTCHA_SERVICE_URL_LOCAL}/solve_captcha`;
    }



}
export const monitorService = new MonitorService();
setMonitorService(monitorService);