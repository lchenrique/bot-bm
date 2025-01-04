import fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import { env } from './config/env';
import { notificationService } from './services/notification.service';
import { monitorService } from './services/monitor.service';
import path from 'path';
import fs from 'fs';

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

async function main() {
  const server = fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  try {
    // Register plugins BEFORE starting the server
    await server.register(cors);
    await server.register(swagger, {
      swagger: {
        info: {
          title: 'Bot BM API',
          description: 'Web monitoring bot API documentation',
          version: '1.0.0',
        },
      },
    });

    // Health check route
    server.get('/health', async () => {
      return { status: 'ok', timestamp: formatDateBR(new Date()) };
    });

    // Rota de teste para enviar notificação
    server.get('/test-notification', async (request, reply) => {
      try {
        console.log('Rota /test-notification chamada');
        const currentTime = formatDateBR(new Date());
        await notificationService.sendNotification(
          `🔔 Teste de notificação!\n\n` +
          `Se você recebeu esta mensagem, o bot está funcionando corretamente.\n\n` +
          `Hora do teste: ${currentTime}`
        );
        console.log('Notificação enviada com sucesso');
        return { status: 'sent', timestamp: currentTime };
      } catch (error) {
        console.error('Erro ao enviar notificação:', error);
        reply.status(500).send({ error: 'Falha ao enviar notificação', details: error instanceof Error ? error.message : String(error) });
      }
    });

    // Serve a página de teste
    server.get('/test-page', async (request, reply) => {
      const filePath = path.join(process.cwd(), 'public', 'test-page.html');
      const content = fs.readFileSync(filePath, 'utf-8');
      reply.type('text/html').send(content);
    });

    // Rota para simular uma mudança na página
    server.get('/simulate-change', async () => {
      const filePath = path.join(process.cwd(), 'public', 'test-page.html');
      const currentTime = formatDateBR(new Date());
      const newContent = `<!DOCTYPE html>
<html>
<head>
    <title>Monitor de Oportunidades</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root {
            --primary-color: #2196F3;
            --background-color: #f5f5f5;
            --text-color: #333;
            --alert-color: #4CAF50;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: var(--background-color);
            color: var(--text-color);
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }

        h1 {
            color: var(--primary-color);
            text-align: center;
            margin-bottom: 30px;
            font-size: 2.5em;
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 10px;
        }

        #content {
            padding: 20px;
            border-radius: 8px;
            background-color: rgba(33, 150, 243, 0.05);
        }

        .update-alert {
            background-color: var(--alert-color);
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            display: inline-block;
            margin-bottom: 15px;
            font-weight: bold;
        }

        .job-details {
            background: white;
            padding: 15px;
            border-radius: 5px;
            border-left: 4px solid var(--primary-color);
            margin: 15px 0;
        }

        .timestamp {
            color: #666;
            font-size: 0.9em;
            margin-top: 20px;
            text-align: right;
            font-style: italic;
        }

        @media (max-width: 600px) {
            body {
                padding: 10px;
            }
            .container {
                padding: 15px;
            }
            h1 {
                font-size: 2em;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Monitor de Oportunidades</h1>
        <div id="content">
            <div class="update-alert">
                🔥 NOVA OPORTUNIDADE DISPONÍVEL!
            </div>
            <div class="job-details">
                <h3>Serviço Encontrado</h3>
                <p>Uma nova oportunidade de trabalho está disponível para você!</p>
                <p>Acesse agora para não perder essa chance.</p>
            </div>
            <p class="timestamp">Publicado em: <span id="timestamp">${currentTime}</span></p>
        </div>
    </div>
</body>
</html>`;

      fs.writeFileSync(filePath, newContent);
      return { status: 'changed', timestamp: currentTime };
    });

    // Rota para verificar status do monitoramento
    server.get('/monitor-status', async () => {
      return {
        isRunning: monitorService.isRunning,
        lastCheck: monitorService.lastCheck,
        lastStatus: monitorService.lastStatus,
        currentConvenio: monitorService.currentConvenio
      };
    });

    // Inicializa o bot e serviços ANTES de iniciar o servidor
    console.log('Iniciando serviços...');
    await monitorService.initialize();
    console.log('Serviços inicializados com sucesso');

    // Start the server
    await server.listen({ 
      port: Number(env.PORT), 
      host: '0.0.0.0' 
    });
    
    console.log(`Server listening on 0.0.0.0:${env.PORT}`);

    // Inicia o monitoramento DEPOIS que o servidor estiver rodando
    await monitorService.startMonitoring();
    console.log('Monitoramento iniciado com sucesso');

    // Tratamento de sinais
    const shutdown = async (signal: string) => {
      console.log(`Recebido sinal ${signal}. Encerrando graciosamente...`);
      try {
        await monitorService.stopMonitoring();
        await server.close();
        console.log('Servidor encerrado com sucesso');
        process.exit(0);
      } catch (error) {
        console.error('Erro ao encerrar:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (err) {
    console.error('Erro ao iniciar:', err);
    process.exit(1);
  }
}

// Adiciona tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('Erro não capturado:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promessa rejeitada não tratada:', reason);
  process.exit(1);
});

main().catch((error) => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
