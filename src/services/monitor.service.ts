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

// Array de chaves do Gemini e controle de taxa
const GEMINI_API_KEYS = [
    env.GOOGLE_API_KEY,
    env.GOOGLE_API_KEY_BACKUP
].filter(Boolean);

let currentKeyIndex = 0;
let requestsInLastMinute = 0;
let requestsToday = 0;
let lastRequestTime = new Date();
let dayStartTime = new Date();

// Controle de taxa por chave
interface RateLimit {
    requestsInLastMinute: number;
    requestsToday: number;
    lastRequestTime: Date;
    dayStartTime: Date;
    isExhausted: boolean;
}

const rateLimits: { [key: string]: RateLimit } = {};

// Inicializa limites para cada chave
GEMINI_API_KEYS.forEach(key => {
    rateLimits[key] = {
        requestsInLastMinute: 0,
        requestsToday: 0,
        lastRequestTime: new Date(),
        dayStartTime: new Date(),
        isExhausted: false
    };
});

// Função para obter próxima chave disponível do pool
const getNextApiKey = (): string | null => {
    const availableKeys = GEMINI_API_KEYS.filter(key => !rateLimits[key].isExhausted);
    if (availableKeys.length === 0) {
        return null;
    }
    currentKeyIndex = (currentKeyIndex + 1) % availableKeys.length;
    return availableKeys[currentKeyIndex];
};

// Função para verificar limites de taxa por chave
const checkRateLimits = async (apiKey: string): Promise<boolean> => {
    const limits = rateLimits[apiKey];
    const now = new Date();
    
    // Reset contadores diários à meia-noite
    if (now.getDate() !== limits.dayStartTime.getDate()) {
        limits.requestsToday = 0;
        limits.dayStartTime = now;
        limits.isExhausted = false;
    }

    // Reset contador de minuto
    if (now.getTime() - limits.lastRequestTime.getTime() >= 60000) {
        limits.requestsInLastMinute = 0;
        limits.lastRequestTime = now;
    }

    // Verifica limites
    if (limits.requestsInLastMinute >= 15) {
        console.log(`⏳ Chave ${apiKey.substring(0, 5)}... atingiu limite por minuto`);
        await new Promise(resolve => setTimeout(resolve, 60000));
        return checkRateLimits(apiKey);
    }

    if (limits.requestsToday >= 1500) {
        console.log(`⚠️ Chave ${apiKey.substring(0, 5)}... atingiu limite diário`);
        limits.isExhausted = true;
        return false;
    }

    limits.requestsInLastMinute++;
    limits.requestsToday++;
    return true;
};

export class MonitorService {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private readonly COOKIES_FILE = 'cookies.json';
    private _currentConvenio: '16' | '18' = '16';
    private statusService: StatusService;
    private lastUsedKey: string | null = null;
    private keyUsageCount: { [key: string]: number } = {
        [env.GOOGLE_API_KEY]: 0,
        [env.GOOGLE_API_KEY_BACKUP]: 0
    };

    constructor() {
        this.statusService = new StatusService();
    }

    async initialize() {
        try {
            this.browser = await chromium.launch({ 
                headless: false,
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
                        console.log('⚠️ Erro ao processar convênio, tentando novamente...');
                        continue; // Mantém o mesmo convênio para nova tentativa
                    }

                    // Alterna convênio para próxima iteração
                    this._currentConvenio = this._currentConvenio === '16' ? '18' : '16';
                    console.log(`✅ Alternando para convênio ${this._currentConvenio} (${this._currentConvenio === '16' ? 'Niterói' : 'Maricá'})`);
                    
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

            // Se não achou o link, verifica se tem mensagem de código incorreto
            const content = await this.page!.content();
            if (content.includes('Código incorreto')) {
                console.log('⚠️ Código incorreto detectado, recarregando página...');
                await this.page!.reload();
                await this.page!.waitForTimeout(1000);
                return false;
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
            await this.page!.waitForTimeout(1000);

            // Verifica se login foi bem sucedido
            const loggedIn = await this.page!.$('a[href="/index.php?option=com_servicos_vagos&Itemid=155"]');
            if (!loggedIn) {
                console.log('❌ Login falhou, verificando erro...');
                const newContent = await this.page!.content();
                if (newContent.includes('Código incorreto')) {
                    console.log('❌ Captcha incorreto');
                    return false;
                }
                throw new Error('Login falhou por motivo desconhecido');
            }

            console.log('✅ Login bem sucedido, salvando cookies...');
            const cookies = await this.page!.context().cookies();
            await this.saveCookies(cookies);

            return true;
        } catch (error) {
            console.error('❌ Erro no processo de login:', error);
            return false;
        }
    }

    private async navigateToServices() {
        await this.page!.click('a[href="/index.php?option=com_servicos_vagos&Itemid=155"]');
        await this.page!.waitForTimeout(1000);
    }

    private async getCaptchaText(): Promise<string> {
        console.log('🔍 Procurando elemento do captcha...');
        const captchaElement = await this.page!.$('img[src="/captcha2.php"]');
        if (!captchaElement) {
            throw new Error('Captcha não encontrado');
        }

        console.log('📸 Capturando screenshot do captcha...');
        const imageBuffer = await captchaElement.screenshot();
        
        // Escolhe a chave com menos uso
        const key = this.lastUsedKey === env.GOOGLE_API_KEY ? 
                   env.GOOGLE_API_KEY_BACKUP : 
                   env.GOOGLE_API_KEY;
        
        this.lastUsedKey = key;
        this.keyUsageCount[key]++;

        console.log(`🔄 Usando chave ${key === env.GOOGLE_API_KEY ? '1' : '2'} (${this.keyUsageCount[key]} usos)`);
        
        // Adiciona delay proporcional ao uso da chave
        const delay = Math.min(this.keyUsageCount[key] * 500, 5000);
        if (delay > 0) {
            console.log(`⏳ Aguardando ${delay}ms antes da próxima requisição...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        try {
            const { GoogleGenerativeAI } = await import('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

            const result = await model.generateContent([
                "Leia o texto do CAPTCHA nesta imagem. " +
                "O texto tem 4 caracteres em preto. " +
                "IMPORTANTE: " +
                "- Se ver um '0' (zero) com uma linha atravessada, é um zero. " +
                "- Mantenha maiúsculas e minúsculas exatamente como aparecem. " +
                "- Ignore linhas coloridas e outros ruídos. " +
                "Responda APENAS os 4 caracteres, sem nenhuma explicação.",
                {
                    inlineData: { 
                        data: imageBuffer.toString('base64'), 
                        mimeType: 'image/png' 
                    }
                }
            ]);

            const captchaText = result.response.text().trim();
            console.log('✅ Captcha resolvido:', captchaText);

            // Reset contador se sucesso
            if (this.keyUsageCount[key] > 10) {
                this.keyUsageCount[key] = 0;
            }

            return captchaText;

        } catch (error: any) {
            console.error('❌ Erro ao resolver captcha:', error.message);
            
            // Se for erro de limite, aumenta o delay na próxima vez
            if (error.message.includes('429') || error.message.includes('quota')) {
                const key = this.lastUsedKey!;
                this.keyUsageCount[key] += 5; // Aumenta o contador para forçar mais delay
                console.log(`⚠️ Limite atingido na chave ${key === env.GOOGLE_API_KEY ? '1' : '2'}, aumentando delay`);
            }

            throw error;
        }
    }

    private async solveCaptcha(): Promise<string> {
        return this.getCaptchaText();
    }

    private async processConvenio(): Promise<{ hasUpdates: boolean; city: string } | null> {
        try {
            // Seleciona convênio
            await this.page!.selectOption('select#convenio', this.currentConvenio);
            await this.page!.waitForTimeout(1000);

            // Resolve captcha usando o mesmo método com controle de taxa
            const captchaText = await this.getCaptchaText();
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
                    `⏰ ${formatDateBR(new Date())}\n\n` +
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