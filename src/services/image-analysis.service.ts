import { env } from '../config/env';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pino from 'pino';
import { notificationService } from './notification.service';

const logger = pino();

export class ImageAnalysisService {
  private apiKeys: string[];
  private currentKeyIndex: number = 0;
  private currentKey: string;

  constructor() {
    this.apiKeys = [
      env.GOOGLE_API_KEY,
      env.GOOGLE_API_KEY_2,
      env.GOOGLE_API_KEY_3,
      env.GOOGLE_API_KEY_4
    ];
    this.currentKey = this.apiKeys[this.currentKeyIndex];
    logger.info('Iniciando com a chave API 1');
  }

  private async switchToNextKey() {
    // Notifica o admin sobre a chave que atingiu o limite
    await notificationService.sendNotification(
      `⚠️ *Alerta de API Key*\n\n` +
      `A chave API ${this.currentKeyIndex + 1} atingiu o limite de uso.\n` +
      `Trocando para a próxima chave...`
    );

    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    this.currentKey = this.apiKeys[this.currentKeyIndex];
    logger.info(`Trocando para chave API ${this.currentKeyIndex + 1}`);
  }

  async analyzeCaptcha(imageBase64: string): Promise<string> {
    try {
      const genAI = new GoogleGenerativeAI(this.currentKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-pro-vision' });

      const prompt = "Analise esta imagem de CAPTCHA e retorne APENAS os caracteres que você vê, sem nenhum texto adicional. Se houver letras, retorne em maiúsculo.";

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64
          }
        }
      ]);

      const response = result.response;
      const text = response.text().trim();
      
      return text;

    } catch (error) {
      // Se o erro for de limite excedido, troca para próxima chave e tenta novamente
      if (error instanceof Error && 
          (error.message.includes('quota') || 
           error.message.includes('limit') || 
           error.message.includes('exceeded'))) {
        
        logger.warn(`Limite excedido na chave ${this.currentKeyIndex + 1}, trocando para próxima...`);
        await this.switchToNextKey();
        
        // Tenta novamente com a nova chave
        return this.analyzeCaptcha(imageBase64);
      }

      // Se for outro tipo de erro, registra e repassa
      logger.error('Erro ao analisar captcha:', error);
      throw error;
    }
  }
}

// Create singleton instance
export const imageAnalysisService = new ImageAnalysisService(); 