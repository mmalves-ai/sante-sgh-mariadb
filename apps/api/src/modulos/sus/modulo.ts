// Módulo do faturamento SUS próprio na API migrada (F2.2 onda 3, M51): competência, crítica prévia, CIHA, BPA, APAC,
// AIH (faixa, laudo, espelho, retorno) e a equivalência SIGTAP. A porta é a própria sobre o banco do cliente quando o
// núcleo existe; sem núcleo, a memória sintética só em dev/ci; fora disso, a indisponível (503, falha fechada). O
// arquivo exportado (tem dado pessoal) vai ao disco local, sob a raiz de arquivos, como o TISS (ADR 0004); na memória,
// à memória.
// Os testes passam a porta e o armazém pelas opções.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import { localizadorDoNucleo } from '../tiss/armazem-xml.js';
import { armazemSusLocal, armazemSusMemoria } from './armazem.js';
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

/** O armazém do arquivo exportado: o disco local quando a porta é a do banco; senão, a memória. */
export function armazemDoSus(ctx: ContextoModulo, porta: PortaSus): ArmazemArquivoSus {
  if (porta.destino !== 'banco') return armazemSusMemoria();
  return armazemSusLocal(localizadorDoNucleo(ctx.nucleo, ctx.env), ctx.configuracao.clientePadrao ?? '');
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
