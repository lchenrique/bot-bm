import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: z.string().default('3000'),
  TELEGRAM_BOT_TOKEN: z.string(),
  ADMIN_CHAT_ID: z.string(),
  ADMIN_CHAT_ID_2: z.string().optional(),
  TARGET_URL: z.string(),
  MONITOR_LOGIN: z.string(),
  MONITOR_PASSWORD: z.string(),
  BOT_PASSWORD: z.string(),
  GOOGLE_API_KEY: z.string(),
  GOOGLE_API_KEY_2: z.string().optional(),
  GOOGLE_API_KEY_3: z.string().optional(),
  GOOGLE_API_KEY_4: z.string().optional(),
  GOOGLE_API_KEY_5: z.string().optional(),
  GOOGLE_API_KEY_6: z.string().optional(),
  GOOGLE_API_KEY_7: z.string().optional(),
  GOOGLE_API_KEY_8: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  CAPTCHA_SERVICE_URL: z.string(),
  // URL local para desenvolvimento
  CAPTCHA_SERVICE_URL_LOCAL: z.string().optional(),
});

const parsedEnv = envSchema.parse(process.env);

// Define a URL do serviço de captcha baseado no ambiente
export const env = {
  ...parsedEnv,
  CAPTCHA_SERVICE_URL: parsedEnv.NODE_ENV === 'development' 
    ? (parsedEnv.CAPTCHA_SERVICE_URL_LOCAL || 'http://backend-api-1:8000')
    : parsedEnv.CAPTCHA_SERVICE_URL
};
