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
import { PORTA_TEXTO_PADRAO_CIRURGIA, PortaTextoPadraoCirurgiaPropria } from './texto-padrao-propria.js';
import { GastoSalaController } from './gasto-sala.controller.js';
import { PORTA_GASTO_SALA, PortaGastoSalaPropria } from './gasto-sala-propria.js';

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
      DescricaoCirurgicaController,
      GastoSalaController,
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
      // F3.4 (04-CC linha 100): gasto de sala do ato no banco do cliente; sem núcleo, 503.
      {
        provide: PORTA_GASTO_SALA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaGastoSalaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
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
