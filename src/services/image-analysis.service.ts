import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';

class ImageAnalysisService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    this.genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
  }

  async analyzeImage(imageBuffer: Buffer): Promise<string> {
    try {
      const prompt = 'Descreva detalhadamente o que você vê nesta imagem, focando em mudanças ou atualizações relevantes.';
      
      const result = await this.model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: 'image/png'
          }
        }
      ]);

      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Error analyzing image:', error);
      throw error;
    }
  }
}

// Create singleton instance
export const imageAnalysisService = new ImageAnalysisService(); 