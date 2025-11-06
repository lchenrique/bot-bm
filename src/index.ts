import fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import { env } from './config/env';
import { notificationService } from './services/notification.service';
import { monitorService } from './services/monitor.service';

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

    // Rota para verificar status do monitoramento
    server.get('/monitor-status', async () => {
      return {
        isRunning: monitorService.isRunning,
        lastCheck: monitorService.lastCheck,
        lastStatus: monitorService.lastStatus,
        currentConvenio: monitorService.currentConvenio
      };
    });

    server.get('/debug', async () => {
      return {
          status: 'ok',
          monitorRunning: monitorService.isRunning,
          lastCheck: monitorService.lastCheck,
          currentConvenio: monitorService.currentConvenio,
          timestamp: formatDateBR(new Date())
      };
  });


    // Start the server FIRST para o Render detectar a porta
    await server.listen({ 
      port: Number(env.PORT), 
      host: '0.0.0.0' 
    });
    
    console.log(`✅ Server listening on 0.0.0.0:${env.PORT}`);

    // Inicializa o bot e serviços em segundo plano
    console.log('Iniciando serviços em segundo plano...');
    
    // Não aguarda a inicialização para não bloquear
    monitorService.initialize()
      .then(() => {
        console.log('✅ Serviços inicializados com sucesso');
        return monitorService.startMonitoring();
      })
      .then(() => {
        console.log('✅ Monitoramento iniciado com sucesso');
      })
      .catch((error) => {
        console.error('❌ Erro ao inicializar serviços:', error);
      });

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

 