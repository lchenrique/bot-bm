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
  private authorizedChats: Set<string>;

  constructor() {
    this.bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });
    // Inicializa apenas com os admins
    this.authorizedChats = new Set([env.ADMIN_CHAT_ID]);
    if (env.ADMIN_CHAT_ID_2) {
      this.authorizedChats.add(env.ADMIN_CHAT_ID_2);
    }
  }

  // Notificação geral para todos os usuários autorizados
  async sendNotification(message: string, image?: Buffer) {
    try {
      for (const chatId of this.authorizedChats) {
        try {
          if (image) {
            await this.bot.sendPhoto(chatId, image, {
              caption: message,
              parse_mode: 'Markdown'
            });
          } else {
            await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
          }
        } catch (error) {
          console.error(`Erro ao enviar notificação para ${chatId}:`, error);
        }
      }
    } catch (error) {
      console.error('Erro ao enviar notificações:', error);
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
