export interface Status {
    lastCheck: Date;
    hasServices: boolean;
    convenio: string;
}

export class StatusService {
    private _totalChecks = 0;
    private _servicesFound = 0;
    private _status: Status | null = null;

    incrementChecks() {
        this._totalChecks++;
    }

    incrementServicesFound() {
        this._servicesFound++;
    }

    setStatus(status: Status) {
        this._status = status;
    }

    getStatus(): string {
        if (!this._status) {
            return 'Nenhuma verificação realizada ainda.';
        }

        const { lastCheck, hasServices, convenio } = this._status;
        const formattedDate = lastCheck.toLocaleString('pt-BR', { 
            timeZone: 'America/Sao_Paulo',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        return `📊 Status do Monitoramento\n\n` +
               `🔍 Total de verificações: ${this._totalChecks}\n` +
               `✨ Serviços encontrados: ${this._servicesFound}\n` +
               `⏰ Última verificação: ${formattedDate}\n` +
               `📍 Último local: ${convenio === '16' ? 'Niterói' : 'Maricá'}\n` +
               `${hasServices ? '🎉 Serviços disponíveis!' : '😕 Nenhum serviço disponível'}`;
    }
} 