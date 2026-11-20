import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loggerNest } from '@sgh/contratos';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import type { Configuracao } from './configuracao.js';
import type { FonteCoexistencia } from './modulos/config/public-api.js';
import type { FonteAcesso } from './sessao/fonte-acesso.js';
import type { OpcoesApp } from './app.module.js';
import { logger } from './logger.js';
import { ProblemaFilter } from './problema.filter.js';
import { registrarResposta } from './telemetria.js';
import { MEDIDOR_TAREFAS } from './modulos/coexistencia/aplicacao/medidor-tarefas.js';
import type { AutorizacaoDaRequisicao } from './autorizacao/guarda.js';

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
 * `fonte`: o núcleo do legado (M02 coexistência + M05 fonte de acesso), null quando não configurado.
 * `armazem`/`servico`: sessão (M05); sem eles, o módulo monta um serviço pelo ambiente (memória + fonte
 * sintética em dev/ci), que é o que os testes usam. `assinaturas`: painel de assinaturas (M03).
 */
export async function criarApp(
  configuracao: Configuracao,
  fonte: (FonteCoexistencia & Partial<FonteAcesso>) | null = null,
  env: NodeJS.ProcessEnv = process.env,
  opcoes: OpcoesApp = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.com(configuracao, fonte, env, opcoes),
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
      // M37: o tempo das tarefas-chave do dia (painel de indicadores da migração gradual).
      // Por estabelecimento: o da sessão da requisição (sem ele, a amostra não entra).
      const sessao = (req as { sgh?: AutorizacaoDaRequisicao }).sgh?.sessao;
      MEDIDOR_TAREFAS.registrar(
        sessao?.estabelecimentoAtivo
          ? { rede: sessao.rede ?? '', hospital: sessao.estabelecimentoAtivo }
          : null,
        req.routeOptions.url ?? '',
        req.method,
        resposta.statusCode,
        resposta.elapsedTime,
      );
      pronto();
    });
  app.useGlobalFilters(new ProblemaFilter());
  app.enableShutdownHooks();
  return app;
}
