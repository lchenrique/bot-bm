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

  constructor() {
    this.bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });
    this.setupCommands();
  }

  private setupCommands() {
    // Comando /start
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      if (chatId.toString() !== env.ADMIN_CHAT_ID) {
        await this.bot.sendMessage(chatId, '⚠️ Desculpe, você não tem permissão para usar este bot.');
        return;
      }
      await this.bot.sendMessage(chatId, 
        '🤖 Bot de Monitoramento iniciado!\n\n' +
        'Comandos disponíveis:\n' +
        '/status - Verifica o status atual do monitoramento\n' +
        '/check - Força uma verificação imediata\n' +
        '/help - Mostra esta mensagem de ajuda'
      );
    });

    // Comando /status
    this.bot.onText(/\/status/, async (msg) => {
      const chatId = msg.chat.id;
      if (chatId.toString() !== env.ADMIN_CHAT_ID) {
        await this.bot.sendMessage(chatId, '⚠️ Desculpe, você não tem permissão para usar este bot.');
        return;
      }
      await this.sendStatus('Status solicitado manualmente');
    });

    // Comando /check
    this.bot.onText(/\/check/, async (msg) => {
      const chatId = msg.chat.id;
      if (chatId.toString() !== env.ADMIN_CHAT_ID) {
        await this.bot.sendMessage(chatId, '⚠️ Desculpe, você não tem permissão para usar este bot.');
        return;
      }
      await this.bot.sendMessage(chatId, '🔍 Iniciando verificação manual...');
      try {
        // Garante que o navegador está inicializado
        if (!await monitorService.initialize()) {
          throw new Error('Falha ao inicializar o navegador');
        }
        
        // Verifica Niterói (16)
        monitorService['_currentConvenio'] = '16';
        const result16 = await monitorService['processConvenio']();
        
        // Verifica Maricá (18)
        monitorService['_currentConvenio'] = '18';
        const result18 = await monitorService['processConvenio']();
        
        let message = '✅ Verificação manual concluída!\n\n';
        message += `📍 Niterói: ${result16?.hasUpdates ? '🟢 Serviço disponível!' : '🔴 Nenhuma desistência'}\n`;
        message += `📍 Maricá: ${result18?.hasUpdates ? '🟢 Serviço disponível!' : '🔴 Nenhuma desistência'}`;
        
        await this.bot.sendMessage(chatId, message);
      } catch (error) {
        await this.bot.sendMessage(chatId, '❌ Erro ao realizar verificação manual: ' + error);
      }
    });

    // Comando /help
    this.bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      if (chatId.toString() !== env.ADMIN_CHAT_ID) {
        await this.bot.sendMessage(chatId, '⚠️ Desculpe, você não tem permissão para usar este bot.');
        return;
      }
      await this.bot.sendMessage(chatId,
        '🤖 *Bot de Monitoramento - Ajuda*\n\n' +
        'Comandos disponíveis:\n\n' +
        '📊 /status - Verifica o status atual do monitoramento\n' +
        '🔍 /check - Força uma verificação imediata\n' +
        '❓ /help - Mostra esta mensagem de ajuda\n\n' +
        '_O bot notificará automaticamente quando houver atualizações._',
        { parse_mode: 'Markdown' }
      );
    });
  }

  async sendNotification(message: string, image?: Buffer) {
    try {
      if (image) {
        await this.bot.sendPhoto(env.ADMIN_CHAT_ID, image, {
          caption: message
        });
      } else {
        await this.bot.sendMessage(env.ADMIN_CHAT_ID, message);
      }
    } catch (error) {
      console.error('Erro ao enviar notificação:', error);
    }
  }

  async sendStatus(status: string) {
    const message = `📊 *Status do Monitoramento*\n\n` +
                   `🤖 Estado: Rodando\n` +
                   `🕒 Última verificação: ${formatDateBR(new Date())}\n` +
                   `📝 ${status}`;

    await this.sendNotification(message);
  }
}

// Create singleton instance
export const notificationService = new NotificationService();
