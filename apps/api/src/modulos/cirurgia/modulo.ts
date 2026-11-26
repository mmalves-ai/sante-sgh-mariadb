// Módulo do centro cirúrgico (M18) e do bloco seguro (M46: anestesia, checklist, rastreio e painel para familiares) na
// API migrada (F2.2): os controladores sobre as portas próprias (MariaDB pelo @sgh/nucleo) quando o núcleo existe; as de
// memória só em dev/ci com as fontes sintéticas; fora disso, as portas indisponíveis (503 em tudo, falha fechada).
// Melhoria: os avisos ao vivo do bloco vêm das gravações (sem o vigia do sistema de origem).
// Melhoria: a trava da incisão usa a fonte de configuração global no banco (falha fechada pela chave do hospital).
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { pacientesSinteticos } from '../agenda/modulo.js';
import { AvisosAtendimento } from '../atendimento/public-api.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { AnestesiaController } from './anestesia.controller.js';
import { PORTA_ANESTESIA, type PortaAnestesia } from './anestesia-porta.js';
import { PortaAnestesiaMemoria } from './anestesia-porta-memoria.js';
import { portaAnestesiaIndisponivel, PortaAnestesiaPropria } from './anestesia-porta-propria.js';
import { AVISOS_BLOCO, BlocoSeguroController } from './bloco-seguro.controller.js';
import { PORTA_BLOCO_SEGURO, type PortaBlocoSeguro } from './bloco-seguro-porta.js';
import { PortaBlocoSeguroMemoria } from './bloco-seguro-porta-memoria.js';
import { portaBlocoSeguroIndisponivel, PortaBlocoSeguroPropria } from './bloco-seguro-porta-propria.js';
import { CirurgiaController } from './cirurgia.controller.js';
import { DescricaoCirurgicaController } from './descricao-cirurgica.controller.js';
import {
  PORTA_DESCRICAO_CIRURGICA,
  portaDescricaoIndisponivel,
  PortaDescricaoCirurgicaPropria,
} from './descricao-cirurgica-porta.js';
import { PORTA_CIRURGIA, type PortaCirurgia } from './porta.js';
import { PortaCirurgiaMemoria } from './porta-memoria.js';
import { portaCirurgiaIndisponivel, PortaCirurgiaPropria } from './porta-propria.js';
import { TRAVA_INCISAO, TravaIncisao } from './trava-incisao.js';
import { TextoPadraoCirurgiaController } from './texto-padrao.controller.js';
import { CartaoPreferenciaController } from './cartao-preferencia.controller.js';
import { PORTA_CARTAO_PREFERENCIA, PortaCartaoPreferenciaPropria } from './cartao-preferencia-propria.js';
import { PORTA_TEXTO_PADRAO_CIRURGIA, PortaTextoPadraoCirurgiaPropria } from './texto-padrao-propria.js';
import { GastoSalaController } from './gasto-sala.controller.js';
import { GradeSalaController } from './grade-sala.controller.js';
import { PORTA_GRADE_SALA, PortaGradeSalaPropria } from './grade-sala-propria.js';
import { PORTA_GASTO_SALA, PortaGastoSalaPropria } from './gasto-sala-propria.js';
import { KitAgendamentoController } from './kit-agendamento.controller.js';
import { CmeController } from './cme.controller.js';
import { PORTA_CME, PortaCmePropria } from './cme-propria.js';
import { CmeCicloController } from './cme-ciclo.controller.js';
import { PORTA_CME_CICLO, PortaCmeCicloPropria } from './cme-ciclo-propria.js';
import { CmeCadastroController } from './cme-cadastro.controller.js';
import { PORTA_CME_CADASTRO, PortaCmeCadastroPropria } from './cme-cadastro-propria.js';
import { ReservaCirurgiaController } from './reserva-cirurgia.controller.js';
import { DocumentosCirurgiaController } from './documentos-cirurgia.controller.js';
import { ProfilaxiaCirurgicaController } from './profilaxia-cirurgica.controller.js';
import { MutiraoCirurgicoController } from './mutirao-cirurgico.controller.js';
import { PORTA_MUTIRAO_CIRURGICO, PortaMutiraoCirurgicoPropria } from './mutirao-cirurgico-propria.js';
import {
  PORTA_PROFILAXIA_CIRURGICA,
  PortaProfilaxiaCirurgicaPropria,
} from './profilaxia-cirurgica-propria.js';
import { PORTA_DOCUMENTOS_CIRURGIA, PortaDocumentosCirurgiaPropria } from './documentos-cirurgia-propria.js';
import { ProcedimentoCirurgicoController } from './procedimento-cirurgico.controller.js';
import {
  PORTA_PROCEDIMENTO_CIRURGICO,
  PortaProcedimentoCirurgicoPropria,
} from './procedimento-cirurgico-propria.js';
import { PORTA_KIT_AGENDAMENTO, PortaKitAgendamentoPropria } from './kit-agendamento-propria.js';
import { EquipeRealizadaController } from './equipe-realizada.controller.js';
import { PORTA_EQUIPE_REALIZADA, PortaEquipeRealizadaPropria } from './equipe-realizada-propria.js';
import { PORTA_RESERVA_CIRURGIA, PortaReservaCirurgiaPropria } from './reserva-cirurgia-propria.js';

export interface OpcoesModuloCirurgia {
  /** Testes: as portas já montadas. */
  readonly cirurgia?: PortaCirurgia;
  readonly anestesia?: PortaAnestesia;
  readonly blocoSeguro?: PortaBlocoSeguro;
  /** Testes: a fonte da liberação e dos parâmetros (null: sem fonte). */
  readonly configuracao?: FonteConfiguracao | null;
}

export interface PortasCirurgia {
  readonly cirurgia: PortaCirurgia;
  readonly anestesia: PortaAnestesia;
  readonly blocoSeguro: PortaBlocoSeguro;
}

/** As portas do bloco pela regra do módulo (sem as opções de teste). */
export async function portasDaCirurgia(ctx: ContextoModulo): Promise<PortasCirurgia> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return {
      cirurgia: new PortaCirurgiaPropria(ctx.nucleo),
      anestesia: new PortaAnestesiaPropria(ctx.nucleo),
      blocoSeguro: new PortaBlocoSeguroPropria(ctx.nucleo),
    };
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) {
    const cirurgia = new PortaCirurgiaMemoria(null, async (_c, ids) => pacientesSinteticos(ids));
    return {
      cirurgia,
      anestesia: new PortaAnestesiaMemoria(cirurgia),
      blocoSeguro: new PortaBlocoSeguroMemoria(cirurgia),
    };
  }
  return {
    cirurgia: portaCirurgiaIndisponivel(),
    anestesia: portaAnestesiaIndisponivel(),
    blocoSeguro: portaBlocoSeguroIndisponivel(),
  };
}

@Module({})
export class ModuloCirurgia {}

export async function moduloCirurgia(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloCirurgia = {},
): Promise<DynamicModule> {
  const padrao =
    opcoes.cirurgia && opcoes.anestesia && opcoes.blocoSeguro ? null : await portasDaCirurgia(ctx);
  const cirurgia = opcoes.cirurgia ?? padrao!.cirurgia;
  const anestesia = opcoes.anestesia ?? padrao!.anestesia;
  const blocoSeguro = opcoes.blocoSeguro ?? padrao!.blocoSeguro;
  const configuracao =
    opcoes.configuracao !== undefined
      ? opcoes.configuracao
      : cirurgia.destino === 'memoria'
        ? fonteConfiguracaoMemoria(ctx.trilha, {
            chavesIniciais: chavesIniciaisSinteticas,
            prerequisitosIniciais: prerequisitosIniciaisSinteticos,
            parametrosIniciais: parametrosIniciaisSinteticos,
          })
        : null;
  return {
    module: ModuloCirurgia,
    // Global: o OPME e a manipulação (suprimentos) leem a PORTA_CIRURGIA.
    global: true,
    controllers: [
      CirurgiaController,
      AnestesiaController,
      BlocoSeguroController,
      TextoPadraoCirurgiaController,
      CartaoPreferenciaController,
      DescricaoCirurgicaController,
      GastoSalaController,
      GradeSalaController,
      KitAgendamentoController,
      CmeController,
      CmeCadastroController,
      CmeCicloController,
      EquipeRealizadaController,
      ReservaCirurgiaController,
      DocumentosCirurgiaController,
      ProfilaxiaCirurgicaController,
      MutiraoCirurgicoController,
      ProcedimentoCirurgicoController,
    ],
    providers: [
      { provide: PORTA_CIRURGIA, useValue: cirurgia },
      { provide: PORTA_ANESTESIA, useValue: anestesia },
      { provide: PORTA_BLOCO_SEGURO, useValue: blocoSeguro },
      // 04-CC linha 96: a descrição cirúrgica assinada e as intercorrências (só no banco; sem ele, 503).
      {
        provide: PORTA_DESCRICAO_CIRURGICA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaDescricaoCirurgicaPropria(ctx.nucleo)
            : portaDescricaoIndisponivel(),
      },
      // F3.4 (04-CC linha 91): texto padrão da descrição cirúrgica no banco do cliente; sem núcleo, 503.
      {
        provide: PORTA_TEXTO_PADRAO_CIRURGIA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaTextoPadraoCirurgiaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F8 (04-CC linha 105): cartão de preferência do cirurgião no banco do cliente; sem núcleo, 503.
      {
        provide: PORTA_CARTAO_PREFERENCIA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaCartaoPreferenciaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F3.4 (04-CC linha 100): gasto de sala do ato no banco do cliente; sem núcleo, 503.
      {
        provide: PORTA_GASTO_SALA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaGastoSalaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F3.4 (04-CC linha 92): grade de funcionamento da sala no banco do cliente; sem núcleo, 503.
      {
        provide: PORTA_GRADE_SALA,
        useValue: ctx.nucleo && ctx.configuracao.clientePadrao ? new PortaGradeSalaPropria(ctx.nucleo) : null,
      },
      // F3.4 (04-CC linha 95): equipe realizada do ato e a ponte com o item da conta; sem núcleo, 503.
      {
        provide: PORTA_EQUIPE_REALIZADA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaEquipeRealizadaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F7 (05-SUP linha 29): central de material esterilizado (caixas, ciclos, etiqueta, rastreio); sem núcleo, 503.
      {
        provide: PORTA_CME,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaCmePropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F7 (04-CME linha 116): ciclo pelos testes dos indicadores e rejeição no reprocessamento; sem núcleo, 503.
      {
        provide: PORTA_CME_CICLO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaCmeCicloPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F7 (04-CME linha 115): cadastro da CME (produtos reprocessáveis, caixas e kits, fases e foto); sem núcleo, 503.
      {
        provide: PORTA_CME_CADASTRO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaCmeCadastroPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F3.6 (05-SUP linha 13): kit padrão sugerido e aplicado no agendamento cirúrgico; sem núcleo, 503.
      {
        provide: PORTA_KIT_AGENDAMENTO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaKitAgendamentoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F8 (04-CC linha 103): reserva de equipamentos e hemocomponentes da cirurgia; sem núcleo, 503.
      {
        provide: PORTA_RESERVA_CIRURGIA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaReservaCirurgiaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F8 (04-CC linha 104): documentos obrigatórios antes da cirurgia; sem núcleo, 503.
      {
        provide: PORTA_DOCUMENTOS_CIRURGIA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaDocumentosCirurgiaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F8 (04-CC linha 106): protocolo e auditoria da profilaxia antimicrobiana cirúrgica; sem núcleo, 503.
      {
        provide: PORTA_PROFILAXIA_CIRURGICA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaProfilaxiaCirurgicaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F8 (04-CC linha 108): projetos e mutirões cirúrgicos do SUS (metas SIGTAP, AIH e APAC marcadas); sem núcleo, 503.
      {
        provide: PORTA_MUTIRAO_CIRURGICO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaMutiraoCirurgicoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F3.4 (04-CC linha 91): cadastro do procedimento cirúrgico no banco do cliente; sem núcleo, 503.
      {
        provide: PORTA_PROCEDIMENTO_CIRURGICO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaProcedimentoCirurgicoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      { provide: AVISOS_BLOCO, useValue: new AvisosAtendimento(null, 'bloco') },
      // A trava da incisão lê a chave do hospital na fonte de configuração: no banco, a FONTE_CONFIGURACAO global (sem
      // ela, a trava ficaria aberta em silêncio com a chave ligada).
      {
        provide: TRAVA_INCISAO,
        inject: [{ token: FONTE_CONFIGURACAO, optional: true }],
        useFactory: (global: FonteConfiguracao | null | undefined) =>
          new TravaIncisao(blocoSeguro, ctx.trilha, configuracao ?? global ?? null, null),
      },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
    exports: [PORTA_CIRURGIA, PORTA_ANESTESIA, PORTA_BLOCO_SEGURO, TRAVA_INCISAO],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloCirurgia(ctx);
}
