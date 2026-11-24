// Módulo da conta do paciente na API migrada (F2.2 onda 2): contas, itens, pendências, etapas, auditoria, lançamento
// manual e o particular (M30). A porta é a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a
// memória sintética só em dev/ci; fora disso, a indisponível (503, falha fechada). Os testes passam a porta pelas
// opções. A liberação das funcionalidades vem da FONTE_CONFIGURACAO do módulo de configuração (global), quando montado.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import { FaturamentoController } from './faturamento.controller.js';
import { PORTA_FATURAMENTO, type PortaFaturamento, portaFaturamentoIndisponivel } from './porta.js';
import { PortaFaturamentoMemoria } from './porta-memoria.js';
import { PortaFaturamentoPropria } from './porta-propria.js';
import { RotinaDiariaContas } from './rotina-diaria.js';

export interface OpcoesModuloFaturamento {
  /** Porta pronta (testes). */
  readonly porta?: PortaFaturamento;
}

/** A porta da conta do paciente pela regra do módulo (sem as opções de teste). */
export function portaDoFaturamento(ctx: ContextoModulo): PortaFaturamento {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) return new PortaFaturamentoPropria(ctx.nucleo, cliente);
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaFaturamentoMemoria(null);
  return portaFaturamentoIndisponivel();
}

@Module({})
export class ModuloFaturamento {}

export function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloFaturamento = {}): DynamicModule {
  const porta = opcoes.porta ?? portaDoFaturamento(ctx);
  return {
    module: ModuloFaturamento,
    controllers: [FaturamentoController],
    providers: [
      { provide: PORTA_FATURAMENTO, useValue: porta },
      // A rotina diária das contas (diária do dia de corte) roda só sobre o banco do cliente, nunca na porta de teste.
      {
        provide: RotinaDiariaContas,
        useValue: new RotinaDiariaContas(
          opcoes.porta ? null : ctx.nucleo,
          ctx.configuracao.clientePadrao ?? null,
          ctx.env as Readonly<Record<string, string | undefined>>,
        ),
      },
    ],
    exports: [PORTA_FATURAMENTO],
  };
}
