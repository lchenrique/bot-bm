import TelegramBot from 'node-telegram-bot-api';
import { env } from '../config/env';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

// Interface para o MonitorService
interface IMonitorService {
  isRunning: boolean;
  lastCheck: string | null;
  currentConvenio: '16' | '18';
  initialize(): Promise<boolean>;
  startMonitoring(): Promise<void>;
  stopMonitoring(): Promise<void>;
}

// Variável para armazenar a referência do MonitorService
let monitorServiceRef: IMonitorService;

// Função para configurar a referência
export function setMonitorService(service: IMonitorService) {
  monitorServiceRef = service;
}

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
  private authorizedChats: Set<string>;
  private lastPingTime: Date | null = null;
  private serviceActive = true;

  constructor() {
    this.bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });
    // Inicializa apenas com os admins
    this.authorizedChats = new Set([env.ADMIN_CHAT_ID]);
    if (env.ADMIN_CHAT_ID_2) {
      this.authorizedChats.add(env.ADMIN_CHAT_ID_2);
    }
    this.setupCommands();
    this.startPingCheck();
  }

  private startPingCheck() {
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
    // Comando /menu - Mostra o menu de comandos
    this.bot.onText(/\/menu/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!this.authorizedChats.has(chatId)) {
        await this.bot.sendMessage(chatId, '⚠️ Você não está autorizado a usar este bot.');
        return;
      }

      await this.bot.sendMessage(chatId, 
        '📋 Menu de Comandos:\n\n' +
        '📊 Status Inscrição - /status\n' +
        '🔄 Status Monitoramento - /check\n' +
        '🛠️ Debug - /debug',
        {
          reply_markup: {
            keyboard: [
              [{ text: '📊 Status Inscrição' }, { text: '📄 Status Monitoramento' }],
              [{ text: '▶️ Iniciar Monitoramento' }, { text: '⏹️ Parar Monitoramento' }],
              [{ text: '🛠️ Debug' }]
            ],
            resize_keyboard: true
          }
        }
      );
    });

    // Comando /status - Status da inscrição
    this.bot.onText(/\/status|📊 Status Inscrição/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!this.authorizedChats.has(chatId)) {
        await this.bot.sendMessage(chatId, '⚠️ Você não está autorizado a usar este bot.');
        return;
      }

      const botInfo = await this.bot.getMe();
      await this.bot.sendMessage(chatId,
        '📊 *Status do Bot*\n\n' +
        `🤖 Bot: @${botInfo.username}\n` +
        `🆔 Seu Chat ID: ${chatId}\n` +
        `🕒 Última verificação: ${this.lastPingTime ? formatDateBR(this.lastPingTime) : 'Nunca'}`,
        { parse_mode: 'Markdown' }
      );
    });

    // Comando /check - Status do monitoramento
    this.bot.onText(/\/check|📄 Status Monitoramento/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!this.authorizedChats.has(chatId)) {
        await this.bot.sendMessage(chatId, '⚠️ Você não está autorizado a usar este bot.');
        return;
      }

      await this.sendStatus('📊 Status do Monitoramento', chatId);
    });

    // Comando para iniciar monitoramento
    this.bot.onText(/▶️ Iniciar Monitoramento/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!this.authorizedChats.has(chatId)) {
        await this.bot.sendMessage(chatId, '⚠️ Você não está autorizado a usar este bot.');
        return;
      }

      if (monitorServiceRef.isRunning) {
        await this.bot.sendMessage(chatId, '⚠️ O monitoramento já está em execução!');
        return;
      }
      await monitorServiceRef.initialize();
      await monitorServiceRef.startMonitoring();
      await this.bot.sendMessage(chatId, '▶️ Monitoramento iniciado com sucesso!');
    });

    // Comando para parar monitoramento
    this.bot.onText(/⏹️ Parar Monitoramento/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!this.authorizedChats.has(chatId)) {
        await this.bot.sendMessage(chatId, '⚠️ Você não está autorizado a usar este bot.');
        return;
      }

      if (!monitorServiceRef.isRunning) {
        await this.bot.sendMessage(chatId, '⚠️ O monitoramento já está parado!');
        return;
      }
      await monitorServiceRef.stopMonitoring();
      await this.bot.sendMessage(chatId, '⏹️ Monitoramento parado com sucesso!');
    });

    // Comando /debug - Informações de debug
    this.bot.onText(/\/debug|🛠️ Debug/, async (msg) => {
      const chatId = msg.chat.id.toString();
      if (!this.authorizedChats.has(chatId)) {
        await this.bot.sendMessage(chatId, '⚠️ Você não está autorizado a usar este bot.');
        return;
      }

      await this.bot.sendMessage(chatId,
        '🛠️ *Informações de Debug*\n\n' +
        `🤖 Estado: ${monitorServiceRef.isRunning ? 'Rodando' : 'Parado'}\n` +
        `🕒 Última verificação: ${monitorServiceRef.lastCheck || 'Nunca'}\n` +
        `📍 Último local: ${monitorServiceRef.currentConvenio === '16' ? 'Niterói' : 'Maricá'}\n` +
        `📡 Última conexão: ${this.lastPingTime ? formatDateBR(this.lastPingTime) : 'Nunca'}`,
        { parse_mode: 'Markdown' }
      );
    });
  }

  private async sendStatus(status: string, chatId: string) {
    if (!this.serviceActive) {
        await this.bot.sendMessage(chatId, '⚠️ Serviço está temporariamente indisponível');
        return;
    }

    const message = `📊 *Status do Monitoramento*\n\n` +
                   `🤖 Estado: ${monitorServiceRef.isRunning ? 'Rodando' : 'Parado'}\n` +
                   `🕒 Última verificação: ${monitorServiceRef.lastCheck || 'Nunca'}\n` +
                   `📝 Último local: ${monitorServiceRef.currentConvenio === '16' ? 'Niterói' : 'Maricá'}\n\n` +
                   `_O sistema verifica automaticamente tanto Niterói quanto Maricá._`;

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  // Notificação geral para todos os usuários autorizados
  async sendNotification(message: string, image?: Buffer) {
    try {
      if (image) {
        await this.bot.sendPhoto(env.ADMIN_CHAT_ID, image, {
          caption: message,
          parse_mode: 'Markdown'
        });

        // Envia também para ADMIN_CHAT_ID_2 se existir
        if (env.ADMIN_CHAT_ID_2) {
          await this.bot.sendPhoto(env.ADMIN_CHAT_ID_2, image, {
            caption: message,
            parse_mode: 'Markdown'
          });
        }
      } else {
        await this.bot.sendMessage(env.ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' });
        if (env.ADMIN_CHAT_ID_2) {
          await this.bot.sendMessage(env.ADMIN_CHAT_ID_2, message, { parse_mode: 'Markdown' });
        }
      }
    } catch (error) {
      console.error('Erro ao enviar notificação:', error);
    }
  }

  // Notificação exclusiva para o admin principal (erros de API)
  async sendAdminNotification(message: string) {
    try {
      await this.bot.sendMessage(env.ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Erro ao enviar notificação para admin:', error);
    }
  }
}

// Create singleton instance
export const notificationService = new NotificationService();
