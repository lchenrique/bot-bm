export class StatusService {
  private startTime: Date;
  private totalChecks: number = 0;
  private servicesFound: number = 0;

  constructor() {
    this.startTime = new Date();
  }

  private formatDateBR(date: Date): string {
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

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    
    return `${days}d ${hours}h ${minutes}m`;
  }

  incrementChecks() {
    this.totalChecks++;
  }

  incrementServicesFound() {
    this.servicesFound++;
  }

  getStatus(): string {
    const uptime = (new Date().getTime() - this.startTime.getTime()) / 1000;
    
    return `📊 Status do Monitor\n\n` +
           `🕒 Última verificação: ${this.formatDateBR(new Date())}\n` +
           `⏱️ Uptime: ${this.formatUptime(uptime)}\n` +
           `🔄 Total de verificações: ${this.totalChecks}\n` +
           `✅ Serviços encontrados: ${this.servicesFound}`;
  }
} 