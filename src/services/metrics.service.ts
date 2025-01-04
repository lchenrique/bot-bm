import prometheus from 'prom-client';

class MetricsService {
  private notificationCounter = new prometheus.Counter({
    name: 'notifications_sent_total',
    help: 'Total de notificações enviadas'
  });

  recordNotification() {
    this.notificationCounter.inc();
  }
} 