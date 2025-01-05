import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  PORT: z.string(),
  NODE_ENV: z.string(),
  TELEGRAM_BOT_TOKEN: z.string(),
  ADMIN_CHAT_ID: z.string(),
  TARGET_URL: z.string(),
  MONITOR_LOGIN: z.string(),
  MONITOR_PASSWORD: z.string(),
  BOT_PASSWORD: z.string(),
  GOOGLE_API_KEY: z.string(),
  GOOGLE_API_KEY_BACKUP: z.string(),
  DEEPSEEK_API_KEY: z.string(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const env = {
    PORT: process.env.PORT!,
    NODE_ENV: process.env.NODE_ENV!,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN!,
    ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID!,
    TARGET_URL: process.env.TARGET_URL!,
    MONITOR_LOGIN: process.env.MONITOR_LOGIN!,
    MONITOR_PASSWORD: process.env.MONITOR_PASSWORD!,
    BOT_PASSWORD: process.env.BOT_PASSWORD!,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY!,
    GOOGLE_API_KEY_BACKUP: process.env.GOOGLE_API_KEY_BACKUP!,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY!
};
