import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loggerNest } from '@sgh/contratos';
import { aplicarArquivoAmbiente, caminhoArquivoAmbiente, recusaDePartida } from '@sgh/legado';
import { logger } from './logger.js';
import { iniciarTelemetria } from './telemetria.js';
import { WorkerModule } from './worker.module.js';

// Mesmo arquivo de ambiente da API (.env.sante) e a mesma trava de saídas (M01): sem ela, não sobe.
aplicarArquivoAmbiente(caminhoArquivoAmbiente());
const recusa = recusaDePartida(process.env);
if (recusa) {
  logger.fatal('trava de saídas: o worker não sobe');
  console.error(recusa);
  process.exit(1);
}

iniciarTelemetria('sgh-worker');
// Contexto NestJS sem HTTP: nenhuma porta aberta.
// Logs do próprio Nest pelo pino com redação (nunca o ConsoleLogger sem máscara).
const contexto = await NestFactory.createApplicationContext(WorkerModule.com(process.env), {
  bufferLogs: true,
});
contexto.useLogger(loggerNest(logger));
contexto.enableShutdownHooks();
// Mantém o processo vivo até SIGINT/SIGTERM (o sinal de vida usa temporizador sem ref).
setInterval(() => undefined, 1 << 30);
