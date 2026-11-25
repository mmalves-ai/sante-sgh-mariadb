// Módulo do orçamento empresarial na API migrada (F2.2): versões, linhas, aprovação e orçado × realizado. A porta é a
// própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci; fora disso, a
// indisponível (503, falha fechada). Os testes passam a porta pelas opções.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import type { ContextoModulo } from '../registro.js';
import { ControleOrcamentarioController } from './controle-orcamentario.controller.js';
import {
  PORTA_CONTROLE_ORCAMENTARIO,
  PortaControleOrcamentarioPropria,
} from './controle-orcamentario-propria.js';
import { EstatisticasOrcamentoController } from './estatisticas-orcamento.controller.js';
import {
  PORTA_ESTATISTICAS_ORCAMENTO,
  type PortaEstatisticasOrcamento,
  PortaEstatisticasOrcamentoMemoria,
  portaEstatisticasIndisponivel,
} from './estatisticas-orcamento.js';
import { PortaEstatisticasOrcamentoPropria } from './estatisticas-orcamento-propria.js';
import { OrcamentoController } from './orcamento.controller.js';
import { PORTA_ORCAMENTO, type PortaOrcamento, portaOrcamentoIndisponivel } from './porta.js';
import { PortaOrcamentoMemoria } from './porta-memoria.js';
import { PortaOrcamentoPropria } from './porta-propria.js';
import {
  PORTA_PREMISSAS_ORCAMENTO,
  type PortaPremissasOrcamento,
  PortaPremissasOrcamentoMemoria,
  portaPremissasIndisponivel,
} from './premissas-cenarios.js';
import { PremissasCenariosOrcamentoController } from './premissas-cenarios.controller.js';
import { PortaPremissasOrcamentoPropria } from './premissas-cenarios-propria.js';
import { ProjetoResultadoController } from './projeto-resultado.controller.js';
import { PORTA_PROJETO_RESULTADO, PortaProjetoResultadoPropria } from './projeto-resultado-propria.js';

export interface OpcoesModuloOrcamento {
  /** Porta pronta (testes). */
  readonly porta?: PortaOrcamento;
  /** Porta pronta das premissas e cenários (testes). */
  readonly premissas?: PortaPremissasOrcamento;
  /** Porta pronta do orçamento estatístico e dos indicadores (testes). */
  readonly estatisticas?: PortaEstatisticasOrcamento;
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

/** A porta das premissas e cenários (C1-125) pela mesma regra. */
export function portaDasPremissas(ctx: ContextoModulo, orcamento: PortaOrcamento): PortaPremissasOrcamento {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente && orcamento.destino === 'banco')
    return new PortaPremissasOrcamentoPropria(ctx.nucleo, cliente);
  if (orcamento.destino === 'memoria') return new PortaPremissasOrcamentoMemoria();
  return portaPremissasIndisponivel();
}

/** A porta do orçamento estatístico e dos indicadores por setor (C1-129) pela mesma regra. */
export function portaDasEstatisticas(
  ctx: ContextoModulo,
  orcamento: PortaOrcamento,
): PortaEstatisticasOrcamento {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente && orcamento.destino === 'banco')
    return new PortaEstatisticasOrcamentoPropria(ctx.nucleo, cliente);
  if (orcamento.destino === 'memoria') return new PortaEstatisticasOrcamentoMemoria(orcamento);
  return portaEstatisticasIndisponivel();
}

@Module({})
export class ModuloOrcamento {}

export async function modulo(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloOrcamento = {},
): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDoOrcamento(ctx));
  const premissas = opcoes.premissas ?? portaDasPremissas(ctx, porta);
  const estatisticas = opcoes.estatisticas ?? portaDasEstatisticas(ctx, porta);
  return {
    module: ModuloOrcamento,
    controllers: [
      OrcamentoController,
      PremissasCenariosOrcamentoController,
      EstatisticasOrcamentoController,
      // C2-107 (07-FIN linha 128): projeto como centro de resultado; sem banco do cliente, 503.
      ProjetoResultadoController,
      // C2-112 (07-FIN linha 130): controle orçamentário na compra e no pagamento; sem banco do cliente, 503.
      ControleOrcamentarioController,
    ],
    providers: [
      { provide: PORTA_ORCAMENTO, useValue: porta },
      { provide: PORTA_PREMISSAS_ORCAMENTO, useValue: premissas },
      { provide: PORTA_ESTATISTICAS_ORCAMENTO, useValue: estatisticas },
      {
        provide: PORTA_PROJETO_RESULTADO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaProjetoResultadoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      {
        provide: PORTA_CONTROLE_ORCAMENTARIO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaControleOrcamentarioPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
    ],
    exports: [PORTA_ORCAMENTO],
  };
}
