# Bot BM - Web Monitoring Bot

A robust web monitoring bot built with TypeScript that monitors websites for updates and sends notifications through multiple channels.

## Features

- Real-time website monitoring using Playwright
- Image analysis with Google's Gemini Flash 1.5
- Push notifications via Firebase Cloud Messaging
- Telegram message integration
- Built with Fastify for high performance
- TypeScript for type safety and better development experience

## Prerequisites

- Node.js >= 18.0.0
- Firebase project credentials
- Telegram Bot Token
- Google Cloud API Key (for Gemini)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
Create a `.env` file in the root directory with:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
FIREBASE_CREDENTIALS=path_to_firebase_credentials.json
GOOGLE_API_KEY=your_google_api_key
TARGET_URL=url_to_monitor
```

3. Build the project:
```bash
npm run build
```

4. Start the server:
```bash
npm start
```

For development:
```bash
npm run dev
```

## Project Structure

```
src/
├── config/         # Configuration files
├── services/       # Core services (monitoring, notifications)
├── types/          # TypeScript type definitions
├── utils/          # Utility functions
└── index.ts        # Application entry point
```

## Deployment

This project is optimized for deployment on Render. Follow these steps:
1. Connect your repository to Render
2. Set up environment variables
3. Configure the build command: `npm install && npm run build`
4. Set the start command: `npm start`

## License

MIT 