import TelegramBot from 'node-telegram-bot-api';
import { env } from '../config/env';
import { monitorService } from './monitor.service';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

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

export class NotificationService {
  private bot: TelegramBot;
  private lastPingTime: Date | null = null;
  private notificationsEnabled = true;
  private authorizedChats: Set<string>;
  private pendingAuth: Map<string, number>;

  constructor() {
    this.bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });
    this.authorizedChats = new Set([env.ADMIN_CHAT_ID]); // Admin sempre autorizado
    this.pendingAuth = new Map(); // Armazena tentativas de autenticação
    this.setupCommands();
    this.startPingCheck();
  }

  private startPingCheck() {
    // A cada 5 minutos, verifica se o bot está respondendo
    setInterval(async () => {
      try {
        await this.bot.getMe();
        this.lastPingTime = new Date();
      } catch (error) {
        console.error('Erro ao verificar status do bot:', error);
      }
    }, 5 * 60 * 1000);
  }

  private setupCommands() {
    // Comando /start - Inscrição com senha
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id.toString();
      
      // Se já está autorizado
      if (this.authorizedChats.has(chatId)) {
        await this.bot.sendMessage(chatId, 
          '✅ Você já está inscrito e autorizado!\n\n' +
          'Use /menu para ver os comandos disponíveis.'
        );
        return;
      }

      // Reseta tentativas anteriores
      this.pendingAuth.set(chatId, 0);

      await this.bot.sendMessage(chatId, 
        '🔐 *Autenticação Necessária*\n\n' +
        'Por favor, digite a senha para se inscrever.\n' +
        '_Você tem 3 tentativas._',
        { parse_mode: 'Markdown' }
      );
    });

    // Listener para verificar senha
    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id.toString();
      const text = msg.text;

      // Ignora comandos e mensagens de usuários já autorizados
      if (!text || text.startsWith('/') || this.authorizedChats.has(chatId)) {
        return;
      }

      // Verifica se está aguardando senha
      const attempts = this.pendingAuth.get(chatId);
      if (attempts === undefined) {
        return;
      }

      // Verifica a senha
      if (text === env.BOT_PASSWORD) {
        this.authorizedChats.add(chatId);
        this.pendingAuth.delete(chatId);
        this.notificationsEnabled = true;

        await this.bot.sendMessage(chatId,
          '✅ *Senha correta!*\n\n' +
          'Você foi autorizado com sucesso e receberá notificações.\n' +
          'Use /menu para ver os comandos disponíveis.',
          { parse_mode: 'Markdown' }
        );
      } else {
        const newAttempts = attempts + 1;
        if (newAttempts >= 3) {
          this.pendingAuth.delete(chatId);
          await this.bot.sendMessage(chatId,
            '❌ *Senha incorreta!*\n\n' +
            'Você excedeu o número máximo de tentativas.\n' +
            'Use /start para tentar novamente.',
            { parse_mode: 'Markdown' }
          );
        } else {
          this.pendingAuth.set(chatId, newAttempts);
          await this.bot.sendMessage(chatId,
            '❌ *Senha incorreta!*\n\n' +
            `Você tem mais ${3 - newAttempts} tentativa(s).\n` +
            'Tente novamente:',
            { parse_mode: 'Markdown' }
          );
        }
      }
    });

    // Comando /menu - Mostra o menu de comandos
    this.bot.onText(/\/menu/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!this.authorizedChats.has(chatId)) {
        await this.bot.sendMessage(chatId, 
          '⚠️ Você não está autorizado.\n' +
          'Use /start para se inscrever.'
        );
        return;
      }

      await this.bot.sendMessage(chatId, 
        '📋 Menu de Comandos - Escolha uma opção:\n\n' +
        '📝 Iniciar/Inscrição - /start\n' +
        '🔕 Parar Notificações - /stop\n' +
        '📊 Status Inscrição - /status\n' +
        '🔄 Status Monitoramento - /check\n' +
        '🛠️ Debug - /debug\n' +
        '⚠️ Reset (Admin) - /reset',
        {
          reply_markup: {
            keyboard: [
              [{ text: '📝 Iniciar/Inscrição' }, { text: '🔕 Parar Notificações' }],
              [{ text: '📊 Status Inscrição' }, { text: '📄 Status Monitoramento' }],
              [{ text: '▶️ Iniciar Monitoramento' }, { text: '⏹️ Parar Monitoramento' }],
              [{ text: '🛠️ Debug' }, { text: '⚠️ Reset (Admin)' }]
            ],
            resize_keyboard: true
          }
        }
      );
    });

    // Verifica autorização para outros comandos
    const checkAuth = async (chatId: string | number): Promise<boolean> => {
      const id = chatId.toString();
      if (!this.authorizedChats.has(id)) {
        await this.bot.sendMessage(id, 
          '⚠️ Você não está autorizado.\n' +
          'Use /start para se inscrever.'
        );
        return false;
      }
      return true;
    };

    // Comando /stop - Parar notificações
    this.bot.onText(/\/stop|🔕 Parar Notificações/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!await checkAuth(chatId)) return;

      this.notificationsEnabled = false;
      await this.bot.sendMessage(chatId, 
        '🔕 Notificações desativadas!\n\n' +
        'Você não receberá mais notificações.\n' +
        'Use /start para ativar novamente.'
      );
    });

    // Comando /status - Status da inscrição
    this.bot.onText(/\/status|📊 Status Inscrição/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!await checkAuth(chatId)) return;

      const botInfo = await this.bot.getMe();
      await this.bot.sendMessage(chatId,
        '📊 *Status da Inscrição*\n\n' +
        `🤖 Bot: @${botInfo.username}\n` +
        `🆔 Seu Chat ID: ${chatId}\n` +
        `🔔 Notificações: ${this.notificationsEnabled ? '✅ Ativadas' : '❌ Desativadas'}\n` +
        `🕒 Última verificação: ${this.lastPingTime ? formatDateBR(this.lastPingTime) : 'Nunca'}`,
        { parse_mode: 'Markdown' }
      );
    });

    // Comando /check - Status do monitoramento
    this.bot.onText(/\/check|📄 Status Monitoramento/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!await checkAuth(chatId)) return;

      await this.sendStatus('📊 Status do Monitoramento');
    });

    // Comando para iniciar monitoramento
    this.bot.onText(/▶️ Iniciar Monitoramento/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!await checkAuth(chatId)) return;

      if (monitorService.isRunning) {
        await this.bot.sendMessage(chatId, '⚠️ O monitoramento já está em execução!');
        return;
      }
      await monitorService.initialize();
      await monitorService.startMonitoring();
      await this.bot.sendMessage(chatId, '▶️ Monitoramento iniciado com sucesso!');
    });

    // Comando para parar monitoramento
    this.bot.onText(/⏹️ Parar Monitoramento/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!await checkAuth(chatId)) return;

      if (!monitorService.isRunning) {
        await this.bot.sendMessage(chatId, '⚠️ O monitoramento já está parado!');
        return;
      }
      await monitorService.stopMonitoring();
      await this.bot.sendMessage(chatId, '⏹️ Monitoramento parado com sucesso!');
    });

    // Comando /debug - Informações de debug
    this.bot.onText(/\/debug|🛠️ Debug/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!await checkAuth(chatId)) return;

      await this.bot.sendMessage(chatId,
        '🛠️ *Informações de Debug*\n\n' +
        `🤖 Estado: ${monitorService.isRunning ? 'Rodando' : 'Parado'}\n` +
        `🕒 Última verificação: ${monitorService.lastCheck || 'Nunca'}\n` +
        `📍 Último local: ${monitorService.currentConvenio === '16' ? 'Niterói' : 'Maricá'}\n` +
        `🔔 Notificações: ${this.notificationsEnabled ? 'Ativadas' : 'Desativadas'}\n` +
        `📡 Última conexão: ${this.lastPingTime ? formatDateBR(this.lastPingTime) : 'Nunca'}`,
        { parse_mode: 'Markdown' }
      );
    });

    // Comando /reset - Apenas para admin
    this.bot.onText(/\/reset|⚠️ Reset \(Admin\)/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (chatId !== env.ADMIN_CHAT_ID) {
        await this.bot.sendMessage(chatId, '⚠️ Apenas o administrador pode usar este comando.');
        return;
      }
      await monitorService.stopMonitoring();
      this.notificationsEnabled = true;
      await this.bot.sendMessage(chatId, '🔄 Bot reiniciado com sucesso!');
    });
  }

  async sendNotification(message: string, image?: Buffer) {
    try {
      if (!this.notificationsEnabled) {
        console.log('Notificação não enviada: notificações desativadas');
        return;
      }

      // Envia para todos os usuários autorizados
      for (const chatId of this.authorizedChats) {
        try {
          if (image) {
            await this.bot.sendPhoto(chatId, image, {
              caption: message
            });
          } else {
            await this.bot.sendMessage(chatId, message);
          }
        } catch (error) {
          console.error(`Erro ao enviar notificação para ${chatId}:`, error);
        }
      }
    } catch (error) {
      console.error('Erro ao enviar notificações:', error);
    }
  }

  async sendStatus(status: string) {
    const message = `📊 *Status do Monitoramento*\n\n` +
                   `🤖 Estado: ${monitorService.isRunning ? 'Rodando' : 'Parado'}\n` +
                   `🕒 Última verificação: ${monitorService.lastCheck || 'Nunca'}\n` +
                   `📝 Último local: ${monitorService.currentConvenio === '16' ? 'Niterói' : 'Maricá'}\n\n` +
                   `_O sistema verifica automaticamente tanto Niterói quanto Maricá._`;

    await this.bot.sendMessage(env.ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' });
  }
}

// Create singleton instance
export const notificationService = new NotificationService();
