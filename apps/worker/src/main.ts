// Partida do worker (lote F2.2 05-15): o ambiente do processo completado pelo .env da raiz (o processo manda; o arquivo
// só preenche o que falta) e a mesma trava de saídas da API (regra 6: fora de produção nada sai), pelo @sgh/nucleo.
// Sem a neutralização, não sobe. Nenhum valor do ambiente vai ao log.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loggerNest } from '@sgh/contratos';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  formatarNeutralizacao,
  verificarNeutralizacao,
} from '@sgh/nucleo';
import { logger } from './logger.js';
import { iniciarTelemetria } from './telemetria.js';
import { WorkerModule } from './worker.module.js';

const { env } = ambienteEfetivo(process.env, caminhoArquivoAmbiente(process.env));
for (const [k, v] of Object.entries(env))
  if (process.env[k] === undefined && v !== undefined) process.env[k] = v;
const neutralizacao = verificarNeutralizacao(process.env);
if (!neutralizacao.ok) {
  logger.fatal('trava de saídas: o worker não sobe');
  console.error(formatarNeutralizacao(neutralizacao));
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
