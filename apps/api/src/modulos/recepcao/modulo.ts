// Módulo da recepção (F2.2): guichê, fila, senhas, chegada do agendado, painéis e totem, termos, a classificação de
// risco no PA e os protocolos gerenciados, sobre as portas próprias (MariaDB pelo @sgh/nucleo) quando o núcleo e o
// cliente existem; as de memória só em dev/ci com as fontes sintéticas; fora disso, as indisponíveis (503 em tudo,
// falha fechada) — a mesma regra do F2-L.
// A liberação das funcionalidades vem da FONTE_CONFIGURACAO do módulo de configuração; sem ela, as telas ficam em
// consulta (falha fechada). Na memória, a fonte sintética da configuração.
// Sem vigia de mudanças (a convivência com o sistema de origem saiu, ADR 0003): a central de chamadas relê as senhas
// do dia na leitura dos painéis e anuncia as chamadas desta instância na hora.
import type { DynamicModule } from '@nestjs/common';
import type { Executor } from '@sgh/nucleo';
import { fontesSinteticas } from '../../sessao/montar.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { FONTE_RISCO_PA, PORTA_ATENDIMENTO, type PortaAtendimento } from '../atendimento/public-api.js';
import type { ContextoModulo } from '../registro.js';
import {
  type PortaGuias,
  portaGuiasIndisponivel,
  portaGuiasMemoria,
  portaGuiasPropria,
} from './aplicacao/worklist-recepcao.js';
import { CentralChamadas } from './chamadas.js';
import { PORTA_CLASSIFICACAO, type PortaClassificacao } from './classificacao-porta.js';
import { PortaClassificacaoMemoria } from './classificacao-porta-memoria.js';
import { PortaClassificacaoPropria } from './classificacao-porta-propria.js';
import { ClassificacaoController, fonteAtendimentosPa, fonteRiscoPa } from './classificacao.controller.js';
import { ServicoClassificacao } from './classificacao-servico.js';
import { DispositivoController } from './dispositivo.controller.js';
import { EstruturaRecepcaoController } from './estrutura.controller.js';
import { EstruturaRecepcaoMemoria, PORTA_ESTRUTURA_RECEPCAO } from './estrutura-porta.js';
import { EstruturaRecepcaoPropria } from './estrutura-propria.js';
import { LocaisAtendimentoController } from './locais-atendimento.controller.js';
import { LocaisAtendimentoMemoria, PORTA_LOCAIS_ATENDIMENTO } from './locais-atendimento-porta.js';
import { LocaisAtendimentoPropria } from './locais-atendimento-propria.js';
import { GestaoRecepcaoController } from './gestao.controller.js';
import { portaClassificacaoIndisponivel, portaRecepcaoIndisponivel } from './indisponivel.js';
import { PORTA_RECEPCAO, type PortaRecepcao } from './porta.js';
import { lembrarRecepcaoMemoria, PortaRecepcaoMemoria } from './porta-memoria.js';
import { PortaRecepcaoPropria } from './porta-propria.js';
import { ProtocoloGerenciadoController } from './protocolo-gerenciado.controller.js';
import { RecepcaoController } from './recepcao.controller.js';
import { CENTRAL_CHAMADAS, PAINEL_PA_TV, REDE_RECEPCAO } from './simbolos.js';
import { TermosRecepcaoController } from './termos.controller.js';
import { PORTA_GUIAS, WorklistRecepcaoController } from './worklist.controller.js';

export interface OpcoesModuloRecepcao {
  /** Testes: as portas já montadas. */
  readonly recepcao?: PortaRecepcao;
  readonly classificacao?: PortaClassificacao;
  readonly guias?: PortaGuias;
  /** Testes: a fonte da liberação e dos parâmetros (null: sem fonte, telas em consulta). */
  readonly configuracao?: unknown;
  /** Testes: o executor do núcleo (padrão: o do NucleoProprio). */
  readonly executor?: Executor;
}

export function moduloRecepcao(ctx: ContextoModulo, opcoes: OpcoesModuloRecepcao = {}): DynamicModule {
  const cliente = ctx.configuracao.clientePadrao;
  const propria = ctx.nucleo !== null && cliente !== null;
  const memoria = !ctx.nucleo && fontesSinteticas(ctx.env);
  const nucleo = ctx.nucleo;
  const executor = propria && nucleo ? (opcoes.executor ?? nucleo.criarExecutor()) : null;
  const recepcao: PortaRecepcao =
    opcoes.recepcao ??
    (propria && nucleo && cliente
      ? new PortaRecepcaoPropria(nucleo, executor ?? nucleo.criarExecutor(), cliente)
      : memoria
        ? lembrarRecepcaoMemoria(new PortaRecepcaoMemoria({ estado: () => 'verde' }))
        : portaRecepcaoIndisponivel());
  const classificacao: PortaClassificacao =
    opcoes.classificacao ??
    (propria && nucleo && cliente
      ? new PortaClassificacaoPropria(nucleo, executor ?? nucleo.criarExecutor(), cliente)
      : memoria
        ? new PortaClassificacaoMemoria({ trilha: ctx.trilha })
        : portaClassificacaoIndisponivel());
  const guias: PortaGuias =
    opcoes.guias ??
    (propria && nucleo && cliente
      ? portaGuiasPropria(nucleo, cliente)
      : memoria
        ? portaGuiasMemoria
        : portaGuiasIndisponivel());
  const configuracao =
    opcoes.configuracao !== undefined
      ? opcoes.configuracao
      : recepcao.destino === 'memoria'
        ? fonteConfiguracaoMemoria(ctx.trilha, {
            chavesIniciais: chavesIniciaisSinteticas,
            prerequisitosIniciais: prerequisitosIniciaisSinteticos,
            parametrosIniciais: parametrosIniciaisSinteticos,
          })
        : null;
  const rede = ctx.configuracao.rede ?? '';
  return {
    module: class ModuloRecepcao {},
    // Global: o atendimento lê o risco do quadro (FONTE_RISCO_PA) e os módulos do PA usam as portas da recepção.
    global: true,
    controllers: [
      RecepcaoController,
      GestaoRecepcaoController,
      EstruturaRecepcaoController,
      LocaisAtendimentoController,
      TermosRecepcaoController,
      DispositivoController,
      ClassificacaoController,
      ProtocoloGerenciadoController,
      WorklistRecepcaoController,
    ],
    providers: [
      { provide: PORTA_RECEPCAO, useValue: recepcao },
      // 02-REC linha 33: o cadastro da estrutura (pontos, guichês e serviços) no banco do cliente; na sessão sintética,
      // em memória; sem nenhum dos dois, o controlador responde 503.
      {
        provide: PORTA_ESTRUTURA_RECEPCAO,
        useValue:
          propria && nucleo && cliente
            ? new EstruturaRecepcaoPropria(nucleo, cliente)
            : recepcao.destino === 'memoria'
              ? new EstruturaRecepcaoMemoria(recepcao)
              : null,
      },
      // C2-005: os locais de atendimento e os encaminhamentos entre locais, do mesmo jeito.
      {
        provide: PORTA_LOCAIS_ATENDIMENTO,
        useValue:
          propria && nucleo && cliente
            ? new LocaisAtendimentoPropria(nucleo, cliente)
            : recepcao.destino === 'memoria'
              ? new LocaisAtendimentoMemoria(recepcao)
              : null,
      },
      { provide: CENTRAL_CHAMADAS, useValue: new CentralChamadas(recepcao, rede, null) },
      { provide: REDE_RECEPCAO, useValue: rede },
      { provide: PORTA_CLASSIFICACAO, useValue: classificacao },
      { provide: PORTA_GUIAS, useValue: guias },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
      // O risco do quadro do PA (lido pelo módulo do atendimento) e o painel de TV do PA: pela porta do atendimento,
      // quando o módulo dele está montado (global); sem ele, nada é oferecido (o quadro fica sem cor).
      {
        provide: FONTE_RISCO_PA,
        useFactory: (a: PortaAtendimento | null) => (a ? fonteRiscoPa(classificacao, a) : null),
        inject: [{ token: PORTA_ATENDIMENTO, optional: true }],
      },
      {
        provide: PAINEL_PA_TV,
        useFactory: (a: PortaAtendimento | null) =>
          a ? new ServicoClassificacao(classificacao, fonteAtendimentosPa(a, recepcao)) : null,
        inject: [{ token: PORTA_ATENDIMENTO, optional: true }],
      },
    ],
    exports: [
      PORTA_RECEPCAO,
      PORTA_CLASSIFICACAO,
      CENTRAL_CHAMADAS,
      FONTE_RISCO_PA,
      PAINEL_PA_TV,
      // A configuração sintética (só memória) vale também para os módulos do PA montados na mesma app de dev/ci.
      ...(configuracao ? [FONTE_CONFIGURACAO] : []),
    ],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloRecepcao(ctx);
}
