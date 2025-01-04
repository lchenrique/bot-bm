import TelegramBot from 'node-telegram-bot-api';
import { env } from '../config/env';
import { monitorService } from './monitor.service';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

class NotificationService {
  private telegramBot: TelegramBot;
  private subscribedChatIds: Set<number> = new Set();
  private readonly storageFile: string;
  private logger = pino({
    name: 'NotificationService',
    level: env.NODE_ENV === 'production' ? 'info' : 'debug'
  });

  constructor() {
    console.log('Iniciando bot do Telegram...');
    this.telegramBot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });
    this.storageFile = path.join(process.cwd(), 'data', 'subscribers.json');
    this.loadSubscribers();
    this.setupTelegramCommands();

    // Log quando o bot estiver pronto
    this.telegramBot.on('polling_error', (error) => {
      console.error('Erro no polling do Telegram:', error);
    });

    this.telegramBot.on('message', (msg) => {
      console.log('Mensagem recebida:', msg);
    });
  }

  private loadSubscribers() {
    try {
      // Cria o diretório data se não existir
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
      }

      // Carrega os inscritos do arquivo
      if (fs.existsSync(this.storageFile)) {
        const data = fs.readFileSync(this.storageFile, 'utf-8');
        const subscribers = JSON.parse(data);
        this.subscribedChatIds = new Set(subscribers);
        console.log('Inscritos carregados:', Array.from(this.subscribedChatIds));
      }
    } catch (error) {
      console.error('Erro ao carregar inscritos:', error);
    }
  }

  private saveSubscribers() {
    try {
      const subscribers = Array.from(this.subscribedChatIds);
      fs.writeFileSync(this.storageFile, JSON.stringify(subscribers));
    } catch (error) {
      console.error('Erro ao salvar inscritos:', error);
    }
  }

  private setupTelegramCommands() {
    // Comando /start para iniciar o bot
    this.telegramBot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      
      // Solicita a senha
      await this.telegramBot.sendMessage(
        chatId,
        'Por favor, insira a senha para se inscrever nas notificações:'
      );
      
      // Aguarda a resposta com a senha
      this.telegramBot.once('message', async (response) => {
        if (response.text === env.BOT_PASSWORD) {
          this.subscribedChatIds.add(chatId);
          this.saveSubscribers();
          await this.telegramBot.sendMessage(
            chatId,
            '✅ Inscrição realizada com sucesso! Você receberá notificações quando houver atualizações.'
          );
          console.log('Novo usuário inscrito. Chat ID:', chatId);
        } else {
          await this.telegramBot.sendMessage(
            chatId,
            '❌ Senha incorreta. Inscrição cancelada.'
          );
          console.log('Tentativa de inscrição com senha incorreta. Chat ID:', chatId);
        }
      });
    });

    // Comando /stop para parar de receber notificações
    this.telegramBot.onText(/\/stop/, async (msg) => {
      const chatId = msg.chat.id;
      this.subscribedChatIds.delete(chatId);
      this.saveSubscribers();
      await this.telegramBot.sendMessage(
        chatId,
        'Notificações desativadas. Use /start para ativar novamente.'
      );
    });

    // Comando /status para verificar se está recebendo notificações
    this.telegramBot.onText(/\/status/, async (msg) => {
      const chatId = msg.chat.id;
      const isSubscribed = this.subscribedChatIds.has(chatId);
      console.log('Status do chat', chatId, ':', isSubscribed ? 'Inscrito' : 'Não inscrito');
      await this.telegramBot.sendMessage(
        chatId,
        isSubscribed 
          ? 'Você está recebendo notificações.'
          : 'Você não está recebendo notificações. Use /start para ativar.'
      );
    });

    // Comando /debug para verificar o estado do bot
    this.telegramBot.onText(/\/debug/, async (msg) => {
      const chatId = msg.chat.id;
      const debugInfo = {
        chatId: chatId,
        subscribedChats: Array.from(this.subscribedChatIds),
        botInfo: await this.telegramBot.getMe()
      };
      await this.telegramBot.sendMessage(
        chatId,
        'Informações de debug:\n' + JSON.stringify(debugInfo, null, 2)
      );
    });

    // Comando /monitorstatus para verificar status do monitoramento
    this.telegramBot.onText(/\/monitorstatus/, async (msg) => {
      const chatId = msg.chat.id;
      const isMonitoring = monitorService.isRunning;
      const lastCheck = monitorService.lastCheck;
      const lastStatus = monitorService.lastStatus;
      
      const statusMessage = `📊 *Status do Monitoramento*\n\n` +
        `🔄 Estado: ${isMonitoring ? 'Rodando' : 'Parado'}\n` +
        `⏱ Última verificação: ${lastCheck?.toLocaleString('pt-BR') || 'N/A'}\n` +
        `📝 Último status: ${lastStatus || 'N/A'}`;
        
      await this.telegramBot.sendMessage(chatId, statusMessage);
    });

    // Comando /startmonitor para iniciar monitoramento
    this.telegramBot.onText(/\/startmonitor/, async (msg) => {
      const chatId = msg.chat.id;
      
      if (monitorService.isRunning) {
        await this.telegramBot.sendMessage(chatId, '⚠️ O monitoramento já está em execução');
        return;
      }

      try {
        await monitorService.startMonitoring();
        await this.telegramBot.sendMessage(chatId, '✅ Monitoramento iniciado com sucesso');
      } catch (error) {
        console.error('Erro ao iniciar monitoramento:', error);
        await this.telegramBot.sendMessage(chatId, '❌ Falha ao iniciar monitoramento');
      }
    });

    // Comando /stopmonitor para parar monitoramento
    this.telegramBot.onText(/\/stopmonitor/, async (msg) => {
      const chatId = msg.chat.id;
      
      if (!monitorService.isRunning) {
        await this.telegramBot.sendMessage(chatId, '⚠️ O monitoramento já está parado');
        return;
      }

      try {
        await monitorService.stopMonitoring();
        await this.telegramBot.sendMessage(chatId, '✅ Monitoramento parado com sucesso');
      } catch (error) {
        console.error('Erro ao parar monitoramento:', error);
        await this.telegramBot.sendMessage(chatId, '❌ Falha ao parar monitoramento');
      }
    });

    // Comando /menu para exibir o menu de opções com botões
    this.telegramBot.onText(/\/menu/, async (msg) => {
      const chatId = msg.chat.id;
      
      const menuKeyboard = {
        inline_keyboard: [
          [
            { text: '📝 Iniciar/Inscrição', callback_data: '/start' },
            { text: '🚫 Parar Notificações', callback_data: '/stop' }
          ],
          [
            { text: '📊 Status Inscrição', callback_data: '/status' },
            { text: '📈 Status Monitoramento', callback_data: '/monitorstatus' }
          ],
          [
            { text: '▶️ Iniciar Monitoramento', callback_data: '/startmonitor' },
            { text: '⏹ Parar Monitoramento', callback_data: '/stopmonitor' }
          ],
          [
            { text: '🛠 Debug', callback_data: '/debug' },
            { text: '⚠️ Reset (Admin)', callback_data: '/reset' }
          ]
        ]
      };

      await this.telegramBot.sendMessage(chatId, '📋 *Menu de Comandos* - Escolha uma opção:', {
        parse_mode: 'Markdown',
        reply_markup: menuKeyboard
      });
    });

    // Handler para os botões do menu
    this.telegramBot.on('callback_query', async (callbackQuery) => {
      if (!callbackQuery.message) {
        return;
      }
      
      const msg = callbackQuery.message;
      const command = callbackQuery.data;
      const chatId = msg.chat.id;
      
      // Responde ao callback
      await this.telegramBot.answerCallbackQuery(callbackQuery.id);
      
      // Executa o comando correspondente
      switch (command) {
        case '/start':
          await this.telegramBot.sendMessage(
            chatId,
            'Por favor, insira a senha para se inscrever nas notificações:'
          );
          break;
          
        case '/stop':
          this.subscribedChatIds.delete(chatId);
          this.saveSubscribers();
          await this.telegramBot.sendMessage(
            chatId,
            'Notificações desativadas. Use /start para ativar novamente.'
          );
          break;
          
        case '/status':
          const isSubscribed = this.subscribedChatIds.has(chatId);
          await this.telegramBot.sendMessage(
            chatId,
            isSubscribed 
              ? 'Você está recebendo notificações.'
              : 'Você não está recebendo notificações. Use /start para ativar.'
          );
          break;
          
        case '/monitorstatus':
          const isMonitoring = monitorService.isRunning;
          const lastCheck = monitorService.lastCheck;
          const lastStatus = monitorService.lastStatus;
          
          const statusMessage = `📊 *Status do Monitoramento*\n\n` +
            `🔄 Estado: ${isMonitoring ? 'Rodando' : 'Parado'}\n` +
            `⏱ Última verificação: ${lastCheck?.toLocaleString('pt-BR') || 'N/A'}\n` +
            `📝 Último status: ${lastStatus || 'N/A'}`;
            
          await this.telegramBot.sendMessage(chatId, statusMessage);
          break;
          
        case '/startmonitor':
          if (monitorService.isRunning) {
            await this.telegramBot.sendMessage(chatId, '⚠️ O monitoramento já está em execução');
            break;
          }
          try {
            await monitorService.startMonitoring();
            await this.telegramBot.sendMessage(chatId, '✅ Monitoramento iniciado com sucesso');
          } catch (error) {
            console.error('Erro ao iniciar monitoramento:', error);
            await this.telegramBot.sendMessage(chatId, '❌ Falha ao iniciar monitoramento');
          }
          break;
          
        case '/stopmonitor':
          if (!monitorService.isRunning) {
            await this.telegramBot.sendMessage(chatId, '⚠️ O monitoramento já está parado');
            break;
          }
          try {
            await monitorService.stopMonitoring();
            await this.telegramBot.sendMessage(chatId, '✅ Monitoramento parado com sucesso');
          } catch (error) {
            console.error('Erro ao parar monitoramento:', error);
            await this.telegramBot.sendMessage(chatId, '❌ Falha ao parar monitoramento');
          }
          break;
          
        case '/debug':
          const debugInfo = {
            chatId: chatId,
            subscribedChats: Array.from(this.subscribedChatIds),
            botInfo: await this.telegramBot.getMe()
          };
          await this.telegramBot.sendMessage(
            chatId,
            'Informações de debug:\n' + JSON.stringify(debugInfo, null, 2)
          );
          break;
          
        case '/reset':
          if (chatId.toString() === process.env.ADMIN_CHAT_ID) {
            this.subscribedChatIds.clear();
            this.saveSubscribers();
            await this.telegramBot.sendMessage(
              chatId,
              '✅ Todos os inscritos foram removidos com sucesso.'
            );
          } else {
            await this.telegramBot.sendMessage(
              chatId,
              '❌ Acesso negado. Apenas o administrador pode usar este comando.'
            );
          }
          break;
          
        default:
          await this.telegramBot.sendMessage(chatId, 'Comando não reconhecido');
          break;
      }
    });

    // Comando /reset para limpar todos os inscritos (apenas admin)
    this.telegramBot.onText(/\/reset/, async (msg) => {
      const chatId = msg.chat.id;
      
      // Verifica se é o admin (chatId do admin pode ser configurado no .env)
      if (chatId.toString() === process.env.ADMIN_CHAT_ID) {
        this.subscribedChatIds.clear();
        this.saveSubscribers();
        await this.telegramBot.sendMessage(
          chatId,
          '✅ Todos os inscritos foram removidos com sucesso.'
        );
        console.log('Todos os inscritos foram removidos pelo admin:', chatId);
      } else {
        await this.telegramBot.sendMessage(
          chatId,
          '❌ Acesso negado. Apenas o administrador pode usar este comando.'
        );
      }
    });
  }

  async sendNotification(message: string, imageBuffer?: Buffer) {
    console.log('Tentando enviar notificação para', this.subscribedChatIds.size, 'chats');
    const errors: Error[] = [];

    // Envia para todos os chats inscritos
    for (const chatId of this.subscribedChatIds) {
      try {
        this.logger.info('Enviando notificação', { chatId });
        if (imageBuffer) {
          await this.telegramBot.sendPhoto(chatId, imageBuffer, {
            caption: message
          });
        } else {
          await this.telegramBot.sendMessage(chatId, message);
        }
        console.log('Notificação enviada com sucesso para:', chatId);
      } catch (error) {
        console.error('Erro ao enviar para chat', chatId, ':', error);
        errors.push(error as Error);
        // Remove o chatId se houver erro de "chat não encontrado" ou "bot bloqueado"
        if (error instanceof Error && 
            (error.message.includes('chat not found') || 
             error.message.includes('bot was blocked'))) {
          this.subscribedChatIds.delete(chatId);
          this.saveSubscribers();
        }
      }
    }

    if (errors.length > 0) {
      console.error('Errors sending notifications:', errors);
    }
  }

  getSubscribedChats(): number[] {
    return Array.from(this.subscribedChatIds);
  }
}

// Create singleton instance
export const notificationService = new NotificationService();
