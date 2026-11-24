// Módulo da internação, dos leitos, da higienização, do SAME e do NIR na API migrada (F2.2): admissão,
// transferência e alta, o mapa de leitos operacional, a higienização do pedido à liberação, a movimentação do SAME,
// a fila e a reserva do NIR e a regulação. As portas são as próprias sobre o banco do cliente quando o núcleo existe;
// sem núcleo, a memória sintética só em dev/ci (o painel sintético do M16 e o NIR em memória compartilhando o estado);
// fora disso, as indisponíveis (503, falha fechada). Os testes passam as portas pelas opções.
// Melhoria: o módulo monta os próprios provedores de apoio (configuração do M16, avisos, armazém das fotos e a
// integração da OS no leito) sem depender da montagem antiga; os avisos do mapa vêm das gravações. É global: as
// portas e a integração da OS no leito ficam visíveis à manutenção, à qualidade e aos relatórios.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { AVISOS_ATENDIMENTO, AvisosAtendimento } from '../atendimento/public-api.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ConfiguracaoM16 } from '../internacao/configuracao.js';
import { FonteInternacaoMemoria } from '../internacao/fonte-memoria.js';
import { BATIDA_EVENTOS_MS, BATIDA_EVENTOS_PADRAO_MS, CONFIGURACAO_M16 } from '../internacao/simbolos.js';
import type { ContextoModulo } from '../registro.js';
import { ARMAZEM_FOTOS, type ArmazemFotos, criarArmazemFotos } from './fotos.js';
import { HigienizacaoController } from './higienizacao.controller.js';
import { InternacaoController } from './internacao.controller.js';
import { MapaLeitosController } from './leitos.controller.js';
import { EstadoNirMemoria } from './nir-memoria.js';
import { NirController } from './nir.controller.js';
import { PORTA_NIR, type PortaNir, portaNirIndisponivel } from './nir-porta.js';
import { PortaNirMemoria } from './nir-porta-memoria.js';
import { PortaNirPropria } from './nir-porta-propria.js';
import { INTEGRACAO_OS_LEITO, IntegracaoOsLeitoAdt } from './os-leito.js';
import { PORTA_ADT, type PortaAdt, portaAdtIndisponivel } from './porta.js';
import { PortaAdtMemoria } from './porta-memoria.js';
import { PortaAdtPropria } from './porta-propria.js';
import { DocumentosInternacaoController, DOCUMENTOS_INTERNACAO } from './documentos-internacao.controller.js';
import { PortaDocumentosInternacao } from './documentos-internacao.js';
import { RegistrosInternacaoController } from './registros-internacao.controller.js';
import { RegulacaoController } from './regulacao.controller.js';
import { SameController } from './same.controller.js';
import { AVISOS_ADT } from './simbolos.js';

export interface OpcoesModuloAdt {
  /** Portas prontas (testes). */
  readonly adt?: PortaAdt;
  readonly nir?: PortaNir;
  /** Armazém das fotos da higienização (testes; padrão: o disco local com o núcleo, memória sem ele). */
  readonly fotos?: ArmazemFotos;
  /** Batida do canal de eventos (testes). */
  readonly batidaEventosMs?: number;
}

/** As portas da internação e do NIR pela regra do módulo (sem as opções de teste). */
export async function portasDaInternacao(ctx: ContextoModulo): Promise<{ adt: PortaAdt; nir: PortaNir }> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return { adt: new PortaAdtPropria(ctx.nucleo), nir: new PortaNirPropria(ctx.nucleo) };
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) {
    const cadastro = new PortaCadastroMemoria();
    const estadoNir = new EstadoNirMemoria({
      arquivoPorFora: ctx.env['NIR_SINTETICO_POR_FORA']?.trim() || null,
    });
    const adt = new PortaAdtMemoria(
      { estado: () => 'verde' },
      {
        painel: new FonteInternacaoMemoria({
          arquivoPorFora: ctx.env['LEITOS_SINTETICOS_POR_FORA']?.trim() || null,
        }),
        lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids),
        nir: estadoNir,
      },
    );
    return {
      adt,
      nir: new PortaNirMemoria(estadoNir, adt, ctx.trilha, (c, ids) => cadastro.lerPacientes(c, ids)),
    };
  }
  return { adt: portaAdtIndisponivel(), nir: portaNirIndisponivel() };
}

@Module({})
export class ModuloAdt {}

export async function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloAdt = {}): Promise<DynamicModule> {
  const padrao = opcoes.adt && opcoes.nir ? null : await portasDaInternacao(ctx);
  const adt = opcoes.adt ?? padrao!.adt;
  const nir = opcoes.nir ?? padrao!.nir;
  return {
    module: ModuloAdt,
    // Global: a manutenção (a OS no leito), a qualidade e os relatórios usam as portas e a integração da OS no leito.
    global: true,
    controllers: [
      InternacaoController,
      RegistrosInternacaoController,
      MapaLeitosController,
      NirController,
      RegulacaoController,
      HigienizacaoController,
      SameController,
      DocumentosInternacaoController,
    ],
    providers: [
      { provide: PORTA_ADT, useValue: adt },
      { provide: PORTA_NIR, useValue: nir },
      {
        provide: DOCUMENTOS_INTERNACAO,
        useValue: ctx.nucleo && !opcoes.adt ? new PortaDocumentosInternacao(ctx.nucleo) : null,
      },
      { provide: AVISOS_ADT, useValue: new AvisosAtendimento(null, 'leitos') },
      { provide: AVISOS_ATENDIMENTO, useValue: new AvisosAtendimento(null) },
      {
        provide: ARMAZEM_FOTOS,
        useValue:
          opcoes.fotos ?? criarArmazemFotos(ctx.configuracao, ctx.env as NodeJS.ProcessEnv, ctx.nucleo),
      },
      { provide: BATIDA_EVENTOS_MS, useValue: opcoes.batidaEventosMs ?? BATIDA_EVENTOS_PADRAO_MS },
      { provide: INTEGRACAO_OS_LEITO, useClass: IntegracaoOsLeitoAdt },
      {
        provide: CONFIGURACAO_M16,
        useFactory: (cfg: FonteConfiguracao | null, cache: CacheConfig | null) =>
          new ConfiguracaoM16(cfg, cache),
        inject: [
          { token: FONTE_CONFIGURACAO, optional: true },
          { token: CACHE_CONFIG, optional: true },
        ],
      },
    ],
    exports: [PORTA_ADT, PORTA_NIR, INTEGRACAO_OS_LEITO],
  };
}
