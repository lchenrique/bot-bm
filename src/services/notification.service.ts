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
    this.bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
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
