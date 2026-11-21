// Montagem da aplicação Nest sobre o Fastify (F2-L): recebe o módulo raiz. O padrão é o boot mínimo (app-base.module,
// com os módulos migrados de API_MODULOS); o app.module.ts antigo fica fora do grafo do build, como referência.
import 'reflect-metadata';
import type { DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loggerNest } from '@sgh/contratos';
import type { NucleoProprio } from '@sgh/nucleo';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppBaseModule, type OpcoesAppBase } from './app-base.module.js';
import type { Configuracao } from './configuracao.js';
import { logger } from './logger.js';
import { ProblemaFilter } from './problema.filter.js';
import { registrarResposta } from './telemetria.js';

const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

/**
 * Confiança no proxy (M49.3): a API só escuta em loopback, atrás do proxy do web (vite em dev, o proxy reverso em
 * produção), que põe o endereço de quem pediu no X-Forwarded-For. Confia-se só no salto 0 (a conexão direta) e só se
 * ela vier do loopback: o `req.ip` passa a ser o último endereço do X-Forwarded-For (o que o proxy viu), nunca um
 * que o cliente tenha escrito antes no cabeçalho. Sem o cabeçalho, segue o endereço da conexão.
 */
export const confiarNoProxy = (endereco: string, salto: number): boolean =>
  salto === 0 && LOOPBACK.test(endereco);

/**
 * A app com o boot mínimo: `nucleo` é o NucleoProprio (null em dev/ci sem banco e nos testes, que usam a fonte
 * sintética). `opcoes`: armazém, serviço de sessão, fonte de acesso e trilha (testes), registro dos módulos.
 */
export async function criarApp(
  configuracao: Configuracao,
  nucleo: NucleoProprio | null = null,
  env: NodeJS.ProcessEnv = process.env,
  opcoes: OpcoesAppBase = {},
): Promise<NestFastifyApplication> {
  return criarAppComModulo(await AppBaseModule.com(configuracao, nucleo, env, opcoes));
}

/** A app Nest sobre o Fastify com o módulo raiz dado (prefixo /api, confiança no proxy, métricas e Problem Details). */
export async function criarAppComModulo(modulo: DynamicModule): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    modulo,
    new FastifyAdapter({ trustProxy: confiarNoProxy }),
    // Logs do próprio Nest pelo pino com redação (nunca o ConsoleLogger sem máscara).
    { bufferLogs: true },
  );
  app.useLogger(loggerNest(logger));
  app.setGlobalPrefix('api');
  // M09: latência e erros por rota (padrão da rota, sem valores) para os painéis "Técnico" e "Jornadas".
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onResponse', (req, resposta, pronto) => {
      registrarResposta(
        req.routeOptions.url ?? 'sem-rota',
        req.method,
        resposta.statusCode,
        resposta.elapsedTime / 1000,
      );
      pronto();
    });
  app.useGlobalFilters(new ProblemaFilter());
  app.enableShutdownHooks();
  return app;
}
