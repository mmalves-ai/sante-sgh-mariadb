import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Relogio } from './relogio.js';
import { logger } from './logger.js';

/** No M00 o worker só dá sinal de vida no log; as filas (BullMQ) chegam nos marcos seguintes. */
@Injectable()
export class SinalDeVidaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private temporizador: NodeJS.Timeout | undefined;

  constructor(private readonly relogio: Relogio) {}

  descrever(): { estado: 'vivo'; em: string } {
    return { estado: 'vivo', em: this.relogio.agora().toISOString() };
  }

  onApplicationBootstrap(): void {
    logger.info(this.descrever(), 'worker no ar');
    const intervalo = Number(process.env['WORKER_SINAL_MS'] ?? 60_000);
    this.temporizador = setInterval(() => logger.info(this.descrever(), 'sinal de vida'), intervalo);
    this.temporizador.unref();
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }
}
