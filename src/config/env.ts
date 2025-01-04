import { config } from 'dotenv';

config();

interface EnvConfig {
  TELEGRAM_BOT_TOKEN: string;
  GOOGLE_API_KEY: string;
  TARGET_URL: string;
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  BOT_PASSWORD: string;
  MONITOR_LOGIN: string;
  MONITOR_PASSWORD: string;
}

function validateEnv(): EnvConfig {
  const requiredEnvVars = [
    'TELEGRAM_BOT_TOKEN',
    'GOOGLE_API_KEY',
    'TARGET_URL',
    'BOT_PASSWORD',
    'MONITOR_LOGIN',
    'MONITOR_PASSWORD'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  return {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN!,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY!,
    TARGET_URL: process.env.TARGET_URL!,
    PORT: parseInt(process.env.PORT || '3000', 10),
    NODE_ENV: (process.env.NODE_ENV || 'development') as EnvConfig['NODE_ENV'],
    BOT_PASSWORD: process.env.BOT_PASSWORD!,
    MONITOR_LOGIN: process.env.MONITOR_LOGIN!,
    MONITOR_PASSWORD: process.env.MONITOR_PASSWORD!
  };
}

export const env = validateEnv();
