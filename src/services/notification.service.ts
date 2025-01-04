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

      const keyboard: TelegramBot.SendMessageOptions = {
        reply_markup: {
          keyboard: [
            [{ text: '▶️ Iniciar monitoramento' }, { text: '🛑 Parar monitoramento' }],
            [{ text: '📊 Status' }, { text: '🔍 Verificar agora' }],
            [{ text: '⚙️ Configurações' }, { text: '❓ Ajuda' }]
          ],
          resize_keyboard: true
        }
      };

      await this.bot.sendMessage(chatId, 
        '🤖 Bot de Monitoramento iniciado!\n\n' +
        'Use o menu abaixo ou os comandos:\n' +
        '/start - Inicia o monitoramento\n' +
        '/stop - Para o monitoramento\n' +
        '/status - Verifica o status atual\n' +
        '/check - Força uma verificação\n' +
        '/help - Mostra ajuda completa',
        keyboard
      );
    });

    // Comando /status e botão Status
    this.bot.onText(/\/status|📊 Status/, async (msg) => {
      const chatId = msg.chat.id;
      if (chatId.toString() !== env.ADMIN_CHAT_ID) {
        await this.bot.sendMessage(chatId, '⚠️ Desculpe, você não tem permissão para usar este bot.');
        return;
      }
      await this.sendStatus('Status solicitado manualmente');
    });

    // Comando /check e botão Verificar agora
    this.bot.onText(/\/check|🔍 Verificar agora/, async (msg) => {
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

    // Botão Configurações
    this.bot.onText(/⚙️ Configurações/, async (msg) => {
      const chatId = msg.chat.id;
      if (chatId.toString() !== env.ADMIN_CHAT_ID) {
        await this.bot.sendMessage(chatId, '⚠️ Desculpe, você não tem permissão para usar este bot.');
        return;
      }
      await this.bot.sendMessage(chatId,
        '⚙️ *Configurações*\n\n' +
        `🏢 Última verificação: ${monitorService.lastCheck || 'Nunca'}\n` +
        `📝 Último status: ${monitorService.lastStatus || 'Nenhum'}`,
        { parse_mode: 'Markdown' }
      );
    });

    // Comando /start e botão Iniciar monitoramento
    this.bot.onText(/\/start|▶️ Iniciar monitoramento/, async (msg) => {
      const chatId = msg.chat.id;
      if (chatId.toString() !== env.ADMIN_CHAT_ID) {
        await this.bot.sendMessage(chatId, '⚠️ Desculpe, você não tem permissão para usar este bot.');
        return;
      }
      if (monitorService.isRunning) {
        await this.bot.sendMessage(chatId, '⚠️ O monitoramento já está em execução!');
        return;
      }
      await monitorService.initialize();
      await monitorService.startMonitoring();
      await this.bot.sendMessage(chatId, '▶️ Monitoramento iniciado com sucesso!');
    });

    // Comando /stop e botão Parar monitoramento
    this.bot.onText(/\/stop|🛑 Parar monitoramento/, async (msg) => {
      const chatId = msg.chat.id;
      if (chatId.toString() !== env.ADMIN_CHAT_ID) {
        await this.bot.sendMessage(chatId, '⚠️ Desculpe, você não tem permissão para usar este bot.');
        return;
      }
      if (!monitorService.isRunning) {
        await this.bot.sendMessage(chatId, '⚠️ O monitoramento já está parado!');
        return;
      }
      await monitorService.stopMonitoring();
      await this.bot.sendMessage(chatId, '🛑 Monitoramento parado com sucesso!');
    });

    // Comando /help e botão Ajuda
    this.bot.onText(/\/help|❓ Ajuda/, async (msg) => {
      const chatId = msg.chat.id;
      if (chatId.toString() !== env.ADMIN_CHAT_ID) {
        await this.bot.sendMessage(chatId, '⚠️ Desculpe, você não tem permissão para usar este bot.');
        return;
      }
      await this.bot.sendMessage(chatId,
        '🤖 *Bot de Monitoramento - Ajuda*\n\n' +
        'Comandos disponíveis:\n\n' +
        '▶️ Iniciar monitoramento - Inicia o monitoramento automático\n' +
        '🛑 Parar monitoramento - Para o monitoramento\n' +
        '📊 Status - Verifica o status atual do monitoramento\n' +
        '🔍 Verificar agora - Força uma verificação imediata\n' +
        '⚙️ Configurações - Mostra configurações atuais\n' +
        '❓ Ajuda - Mostra esta mensagem de ajuda\n\n' +
        '_O bot notificará automaticamente quando houver atualizações._\n\n' +
        '*Nota:* O sistema verifica automaticamente tanto Niterói quanto Maricá.',
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
                   `🤖 Estado: ${monitorService.isRunning ? 'Rodando' : 'Parado'}\n` +
                   `🕒 Última verificação: ${monitorService.lastCheck || 'Nunca'}\n` +
                   `📝 Último local: ${monitorService.currentConvenio === '16' ? 'Niterói' : 'Maricá'}\n` +
                   `📝 ${status}\n\n` +
                   `_O sistema verifica automaticamente tanto Niterói quanto Maricá._`;

    await this.bot.sendMessage(env.ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' });
  }
}

// Create singleton instance
export const notificationService = new NotificationService();
