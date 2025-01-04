import { chromium, Page, Browser } from '@playwright/test';
import { env } from '../config/env';
import { createLogger, format, transports } from 'winston';
import { notificationService } from './notification.service';
import * as fs from 'fs/promises';
import * as path from 'path';
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

    async initialize() {
        try {
            this.browser = await chromium.launch({ 
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const context = await this.browser.newContext({
                viewport: null
            });
            
            // Carrega cookies se existirem
            const cookies = await this.loadCookies();
            if (cookies) {
                await context.addCookies(cookies);
            }

            this.page = await context.newPage();
            await this.page.goto(env.TARGET_URL, { waitUntil: 'networkidle' });
            
            return true;
        } catch (error) {
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
        if (this.isRunning) {
            logger.warn('Monitoramento já está em execução');
            return;
        }

        this._isRunning = true;
        
        try {
            while (this.isRunning) {
                try {
                    if (!this.browser || !this.page) {
                        if (!await this.initialize()) {
                            throw new Error('Falha ao inicializar navegador');
                        }
                    }

                    // Verifica cookies e faz login se necessário
                    if (!await this.checkCookiesAndLogin()) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                        continue;
                    }

                    // Navega para serviços vagos
                    await this.navigateToServices();

            // Processa convênio atual
            this._lastCheck = new Date();
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
                    }

                    // Alterna convênio para próxima iteração
                    this._currentConvenio = this._currentConvenio === '16' ? '18' : '16';
                    
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (error) {
                    logger.error('Erro no monitoramento', { error });
                    await this.close();
                    await new Promise(resolve => setTimeout(resolve, 2000));
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
            // Verifica se está logado procurando o link de serviços
            const servicesLink = await this.page!.$('a[href="/index.php?option=com_servicos_vagos&Itemid=155"]');
            if (servicesLink) {
                return true;
            }

            // Verifica se há mensagem de código incorreto
            const content = await this.page!.content();
            if (content.includes('Código incorreto.')) {
                await this.page!.reload();
                await this.page!.waitForTimeout(1000);
                return false;
            }

            // Faz login
            await this.page!.fill('#modlgn_username', env.MONITOR_LOGIN);
            await this.page!.fill('#modlgn_passwd', env.MONITOR_PASSWORD);

            // Resolve captcha
            const captchaText = await this.solveCaptcha();
            await this.page!.fill('input[name="cd"]', captchaText);
            
            // Submete formulário
            await this.page!.click('input[type="submit"]');
            await this.page!.waitForTimeout(500);

            // Verifica se login foi bem sucedido
            const loggedIn = await this.page!.$('a[href="/index.php?option=com_servicos_vagos&Itemid=155"]');
            if (!loggedIn) {
                throw new Error('Login falhou');
            }

            // Salva cookies
            const cookies = await this.page!.context().cookies();
            await this.saveCookies(cookies);

            return true;
        } catch (error) {
            logger.error('Erro no login', { error });
            return false;
        }
    }

    private async navigateToServices() {
        await this.page!.click('a[href="/index.php?option=com_servicos_vagos&Itemid=155"]');
        await this.page!.waitForTimeout(1000);
    }

    private async processConvenio(): Promise<{ hasUpdates: boolean; city: string } | null> {
        try {
            // Seleciona convênio
            await this.page!.selectOption('select#convenio', this.currentConvenio);
            await this.page!.waitForTimeout(1000);

            // Resolve captcha
            const captchaText = await this.solveCaptcha();
            await this.page!.fill('input[name="cd"]', captchaText);
            
            // Submete formulário
            await this.page!.click('input[type="submit"][value=" VISUALIZAR "]');
            await this.page!.waitForTimeout(1000);

            // Verifica resultado
            const content = await this.page!.content();
            
            // Primeiro verifica código inválido
            if (content.includes('Código inválido')) {
                // Clica no link para tentar novamente com o mesmo convênio
                await this.page!.click('a[href="index.php?option=com_servicos_vagos"]');
                await this.page!.waitForTimeout(1000);
                
                // Seleciona o mesmo convênio novamente
                await this.page!.selectOption('select#convenio', this.currentConvenio);
                await this.page!.waitForTimeout(1000);
                
                // Retorna null para tentar novamente o mesmo convênio
                return null;
            }

            // Se não tem "Nenhuma desistência", e não tem "Código inválido",
            // então provavelmente tem serviço disponível
            if (!content.includes('Nenhuma desistência até o momento')) {
                return { 
                    hasUpdates: true, 
                    city: this.currentConvenio === '16' ? 'Niterói' : 'Maricá' 
                };
            }

            // Se chegou aqui, não tem serviço disponível
            this._lastStatus = `Nenhuma desistência em ${this.currentConvenio === '16' ? 'Niterói' : 'Maricá'}`;
            return { hasUpdates: false, city: this.currentConvenio === '16' ? 'Niterói' : 'Maricá' };

        } catch (error) {
            logger.error('Erro ao processar convênio', { error });
            return null;
        }
    }

    private async solveCaptcha(): Promise<string> {
        const captchaElement = await this.page!.$('img[src="/captcha2.php"]');
        if (!captchaElement) {
            throw new Error('Captcha não encontrado');
        }

        const imageBuffer = await captchaElement.screenshot();
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

            const result = await model.generateContent([
                "Analise esta imagem de CAPTCHA. Extraia APENAS os caracteres em preto, mantendo EXATAMENTE o mesmo caso (maiúsculo/minúsculo). " +
                "IMPORTANTE: Se aparecer um '0' (zero) com um risco, é realmente um '0' (zero). " +
                "Ignore qualquer ruído ou linha. " +
                "Retorne APENAS os caracteres, sem explicações ou pontuação. " +
                "NÃO converta para maiúsculo, mantenha exatamente como está na imagem.",
                {
                    inlineData: { 
                        data: imageBuffer.toString('base64'), 
                        mimeType: 'image/png' 
                    }
                }
            ]);

        const captchaText = (await result.response).text().trim();
        if (!captchaText || captchaText.length < 4) {
            throw new Error('Captcha inválido');
        }

        return captchaText;
    }

    private async saveCookies(cookies: any[]) {
        await fs.writeFile(
            path.join(process.cwd(), this.COOKIES_FILE),
            JSON.stringify(cookies, null, 2)
        );
    }

    private async loadCookies(): Promise<any[] | null> {
        try {
            const cookiesData = await fs.readFile(
                path.join(process.cwd(), this.COOKIES_FILE),
                'utf-8'
            );
            return JSON.parse(cookiesData);
        } catch (error) {
            return null;
        }
    }

    async close() {
        // Mantém o navegador aberto para inspeção
        // this.browser = null;
        // this.page = null;
    }

    async monitorServices() {
        try {
            this.statusService.incrementChecks();
            const result = await this.processConvenio();
            
            if (result?.hasUpdates) {
                this.statusService.incrementServicesFound();
                await notificationService.sendNotification(
                    `🚨 NOVO SERVIÇO DISPONÍVEL!\n\n` +
                    `Encontrado serviço em ${result.city}\n` +
                    `⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\n` +
                    `Acesse: ${env.TARGET_URL}`
                );
            }
        } catch (error) {
            console.error('Erro ao monitorar serviços:', error);
        }
    }

    getStatus(): string {
        return this.statusService.getStatus();
    }
}

export const monitorService = new MonitorService();
