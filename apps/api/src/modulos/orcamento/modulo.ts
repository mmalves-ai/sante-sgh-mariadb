// Módulo do orçamento empresarial na API migrada (F2.2): versões, linhas, aprovação e orçado × realizado. A porta é a
// própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci; fora disso, a
// indisponível (503, falha fechada). Os testes passam a porta pelas opções.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import type { ContextoModulo } from '../registro.js';
import { OrcamentoController } from './orcamento.controller.js';
import { PORTA_ORCAMENTO, type PortaOrcamento, portaOrcamentoIndisponivel } from './porta.js';
import { PortaOrcamentoMemoria } from './porta-memoria.js';
import { PortaOrcamentoPropria } from './porta-propria.js';

export interface OpcoesModuloOrcamento {
  /** Porta pronta (testes). */
  readonly porta?: PortaOrcamento;
}

/** A porta do orçamento pela regra do módulo (sem as opções de teste). */
export async function portaDoOrcamento(ctx: ContextoModulo): Promise<PortaOrcamento> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaOrcamentoPropria(ctx.nucleo, cliente);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaOrcamentoMemoria();
  return portaOrcamentoIndisponivel();
}

@Module({})
export class ModuloOrcamento {}

export async function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloOrcamento = {}): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDoOrcamento(ctx));
  return {
    module: ModuloOrcamento,
    controllers: [OrcamentoController],
    providers: [{ provide: PORTA_ORCAMENTO, useValue: porta }],
    exports: [PORTA_ORCAMENTO],
  };
}
