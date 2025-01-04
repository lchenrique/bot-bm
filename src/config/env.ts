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
});

export type EnvConfig = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
