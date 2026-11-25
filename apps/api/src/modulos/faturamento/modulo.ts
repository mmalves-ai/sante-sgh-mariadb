// Módulo da conta do paciente na API migrada (F2.2 onda 2): contas, itens, pendências, etapas, auditoria, lançamento
// manual e o particular (M30). A porta é a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a
// memória sintética só em dev/ci; fora disso, a indisponível (503, falha fechada). Os testes passam a porta pelas
// opções. A liberação das funcionalidades vem da FONTE_CONFIGURACAO do módulo de configuração (global), quando montado.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { arquivosDoAmbiente } from '../arquivos-locais.js';
import type { ContextoModulo } from '../registro.js';
import {
  AuditoriaTramiteController,
  SERVICO_AUDITORIA_TRAMITE,
  ServicoAuditoriaTramite,
} from './auditoria-tramite.controller.js';
import {
  AjustesContaController,
  SERVICO_AJUSTES_CONTA,
  ServicoAjustesConta,
} from './conta-ajustes.controller.js';
import {
  ComplementosContaController,
  SERVICO_COMPLEMENTOS_CONTA,
  ServicoComplementosConta,
} from './conta-complementos.controller.js';
import {
  MovimentosContaController,
  SERVICO_MOVIMENTOS_CONTA,
  ServicoMovimentosConta,
} from './conta-movimentos.controller.js';
import {
  SERVICO_TRANSFERENCIA_CONTA,
  ServicoTransferenciaConta,
  TransferenciaContaController,
} from './conta-transferencia.controller.js';
import { FaturamentoController } from './faturamento.controller.js';
import {
  ParametrosFaturamentoController,
  SERVICO_PARAMETROS_FATURAMENTO,
  ServicoParametrosFaturamento,
} from './parametros-faturamento.controller.js';
import {
  NotaVinculoController,
  SERVICO_NOTA_VINCULO,
  ServicoNotaVinculo,
} from './nota-vinculo.controller.js';
import {
  ParticularAdiantamentoController,
  SERVICO_PARTICULAR_ADIANTAMENTO,
  ServicoParticularAdiantamento,
} from './particular-adiantamento.controller.js';
import {
  RegrasComerciaisController,
  SERVICO_REGRAS_COMERCIAIS,
  ServicoRegrasComerciais,
} from './regras-comerciais.controller.js';
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
    controllers: [
      FaturamentoController,
      ComplementosContaController,
      MovimentosContaController,
      TransferenciaContaController,
      AjustesContaController,
      NotaVinculoController,
      ParticularAdiantamentoController,
      AuditoriaTramiteController,
      RegrasComerciaisController,
      ParametrosFaturamentoController,
    ],
    providers: [
      { provide: PORTA_FATURAMENTO, useValue: porta },
      // 06-FAT linhas 10 e 12: período da conta parcial, segurado na conta e campo adicional da guia (banco próprio).
      {
        provide: SERVICO_COMPLEMENTOS_CONTA,
        useValue:
          !opcoes.porta && ctx.nucleo && ctx.configuracao.clientePadrao
            ? new ServicoComplementosConta(ctx.nucleo)
            : null,
      },
      // 06-FAT linhas 14, 15 e 16: equipe do item, kit de cobrança e transferência de itens entre contas (banco próprio).
      {
        provide: SERVICO_MOVIMENTOS_CONTA,
        useValue:
          !opcoes.porta && ctx.nucleo && ctx.configuracao.clientePadrao
            ? new ServicoMovimentosConta(ctx.nucleo)
            : null,
      },
      // 06-FAT linha 14: conta inteira, lote, estorno, cobertura no destino e sugestão pela troca de convênio.
      {
        provide: SERVICO_TRANSFERENCIA_CONTA,
        useValue:
          !opcoes.porta && ctx.nucleo && ctx.configuracao.clientePadrao
            ? new ServicoTransferenciaConta(ctx.nucleo)
            : null,
      },
      // 06-FAT linhas 17, 18 e 20: horário especial, acréscimo e desconto com alçada e pacote na conta (banco próprio).
      {
        provide: SERVICO_AJUSTES_CONTA,
        useValue:
          !opcoes.porta && ctx.nucleo && ctx.configuracao.clientePadrao
            ? new ServicoAjustesConta(ctx.nucleo)
            : null,
      },
      // 06-FAT linha 36: a nota fiscal de serviço que documenta a fatura ou a conta (banco próprio).
      {
        provide: SERVICO_NOTA_VINCULO,
        useValue:
          !opcoes.porta && ctx.nucleo && ctx.configuracao.clientePadrao
            ? new ServicoNotaVinculo(ctx.nucleo)
            : null,
      },
      // 06-FAT linhas 21, 22 e 24: auditoria item a item, protocolo entre setores e acompanhamento da guia.
      {
        provide: SERVICO_AUDITORIA_TRAMITE,
        useValue:
          !opcoes.porta && ctx.nucleo && ctx.configuracao.clientePadrao
            ? new ServicoAuditoriaTramite(
                ctx.nucleo,
                arquivosDoAmbiente(ctx.nucleo, ctx.configuracao.clientePadrao, ctx.env as NodeJS.ProcessEnv),
              )
            : null,
      },
      // 06-FAT linhas 39 e 40: adiantamento, caução e conta corrente do paciente; modelo de orçamento (banco próprio).
      {
        provide: SERVICO_PARTICULAR_ADIANTAMENTO,
        useValue:
          !opcoes.porta && ctx.nucleo && ctx.configuracao.clientePadrao
            ? new ServicoParticularAdiantamento(ctx.nucleo, ctx.configuracao.ambiente)
            : null,
      },
      // F8 (06-FAT linhas 13, 19 e 23): regras de criação e quebra de conta, franquia e desconto por volume, remoção e
      // ligação tarifada (banco próprio).
      {
        provide: SERVICO_REGRAS_COMERCIAIS,
        useValue:
          !opcoes.porta && ctx.nucleo && ctx.configuracao.clientePadrao
            ? new ServicoRegrasComerciais(ctx.nucleo)
            : null,
      },
      // 06-FAT linha 38: parâmetros tipados, preferências do faturista e alçada do faturamento (banco próprio).
      {
        provide: SERVICO_PARAMETROS_FATURAMENTO,
        useValue:
          !opcoes.porta && ctx.nucleo && ctx.configuracao.clientePadrao
            ? new ServicoParametrosFaturamento(ctx.nucleo)
            : null,
      },
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
