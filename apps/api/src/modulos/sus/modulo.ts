// Módulo do faturamento SUS próprio na API migrada (F2.2 onda 3, M51): competência, crítica prévia, CIHA, BPA, APAC,
// AIH (faixa, laudo, espelho, retorno) e a equivalência SIGTAP. A porta é a própria sobre o banco do cliente quando o
// núcleo existe; sem núcleo, a memória sintética só em dev/ci; fora disso, a indisponível (503, falha fechada). O
// arquivo exportado (tem dado pessoal) vai ao armazenamento de objetos com retenção, como o TISS; na memória, à memória.
// Os testes passam a porta e o armazém pelas opções.
import { type DynamicModule, Module } from '@nestjs/common';
import { ClienteS3 } from '../documento/public-api.js';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import { armazemSusMemoria, armazemSusS3 } from './armazem.js';
import { PORTA_SUS, type PortaSus, portaSusIndisponivel } from './porta.js';
import { PortaSusMemoria } from './porta-memoria.js';
import { PortaSusPropria } from './porta-propria.js';
import type { ArmazemArquivoSus } from './servico.js';
import { SusAihController } from './sus-aih.controller.js';
import { ARMAZEM_ARQUIVO_SUS, SusController } from './sus.controller.js';

export interface OpcoesModuloSus {
  /** Porta pronta (testes). */
  readonly porta?: PortaSus;
  readonly armazem?: ArmazemArquivoSus;
}

/** A porta do faturamento SUS pela regra do módulo (sem as opções de teste). */
export function portaDoSus(ctx: ContextoModulo): PortaSus {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) return new PortaSusPropria(ctx.nucleo, cliente);
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaSusMemoria();
  return portaSusIndisponivel();
}

/** O armazém do arquivo exportado: o de objetos com retenção quando a porta é a do banco; senão, a memória. */
export function armazemDoSus(ctx: ContextoModulo, porta: PortaSus): ArmazemArquivoSus {
  if (porta.destino !== 'banco') return armazemSusMemoria();
  const env = ctx.env;
  return armazemSusS3(
    new ClienteS3({
      endpoint: env['S3_ENDPOINT']?.trim() || 'http://127.0.0.1:9318',
      regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
      acesso: env['S3_SEGREDO']?.trim() ? env['S3_ACESSO']?.trim() : undefined,
      segredo: env['S3_SEGREDO']?.trim() || undefined,
    }),
    env['S3_BUCKET_SUS']?.trim() || `sgh-${ctx.configuracao.clientePadrao || 'cliente'}-sus`,
    (env['AMBIENTE'] ?? 'dev').trim() || 'dev',
  );
}

@Module({})
export class ModuloSus {}

export function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloSus = {}): DynamicModule {
  const porta = opcoes.porta ?? portaDoSus(ctx);
  const armazem = opcoes.armazem ?? armazemDoSus(ctx, porta);
  return {
    module: ModuloSus,
    controllers: [SusController, SusAihController],
    providers: [
      { provide: PORTA_SUS, useValue: porta },
      { provide: ARMAZEM_ARQUIVO_SUS, useValue: armazem },
    ],
    exports: [PORTA_SUS, ARMAZEM_ARQUIVO_SUS],
  };
}
