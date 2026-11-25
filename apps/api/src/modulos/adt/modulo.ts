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
import { IMPRESSAO_IDENTIFICACAO } from '../administracao/impressao-identificacao-emissao.js';
import { ImpressaoIdentificacaoPropria } from '../administracao/impressao-identificacao-propria.js';
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
import { GasMedicinalController } from './gas-medicinal.controller.js';
import { PORTA_GAS_MEDICINAL, PortaGasMedicinalPropria } from './gas-medicinal-propria.js';
import { PORTA_GAS_SETOR, PortaGasSetorPropria } from './gas-setor-propria.js';
import { GasSetorController } from './gas-setor.controller.js';
import { PORTA_TRANSPORTE_PACIENTE, PortaTransportePacientePropria } from './transporte-paciente-propria.js';
import { TransportePacienteController } from './transporte-paciente.controller.js';
import { RegulacaoController } from './regulacao.controller.js';
import { PORTA_REGULACAO_ENTRADA, PortaRegulacaoEntradaPropria } from './regulacao-entrada-propria.js';
import { RegulacaoEntradaController } from './regulacao-entrada.controller.js';
import { SameController } from './same.controller.js';
import { SameGuardaController } from './same-guarda.controller.js';
import { PORTA_SAME_GUARDA, PortaSameGuardaPropria } from './same-guarda-propria.js';
import { SameTramiteController } from './same-tramite.controller.js';
import { PORTA_SAME_TRAMITE, PortaSameTramitePropria } from './same-tramite-propria.js';
import { AVISOS_ADT } from './simbolos.js';
import { ControlesAssistenciaisController } from './controles-assistenciais.controller.js';
import {
  PORTA_CONTROLES_ASSISTENCIAIS,
  PortaControlesAssistenciaisPropria,
} from './controles-assistenciais-propria.js';

import { LeitosSusController } from './leitos-sus.controller.js';
import { PORTA_LEITOS_SUS, PortaLeitosSusPropria } from './leitos-sus-propria.js';
import { ComunicacaoOperadoraController } from './comunicacao-operadora.controller.js';
import {
  PORTA_COMUNICACAO_OPERADORA,
  PortaComunicacaoOperadoraPropria,
} from './comunicacao-operadora-propria.js';

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
      RegulacaoEntradaController,
      HigienizacaoController,
      SameController,
      DocumentosInternacaoController,
      GasSetorController,
      TransportePacienteController,
      GasMedicinalController,
      SameGuardaController,
      SameTramiteController,
      ControlesAssistenciaisController,
      LeitosSusController,
      ComunicacaoOperadoraController,
    ],
    providers: [
      { provide: PORTA_ADT, useValue: adt },
      { provide: PORTA_NIR, useValue: nir },
      // Pulseira e etiqueta com a 1ª impressão registrada e a reimpressão por motivo (01-ADM L79): só no banco próprio.
      {
        provide: IMPRESSAO_IDENTIFICACAO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new ImpressaoIdentificacaoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F3.4 (04-INT linha 82): gases medicinais por tempo de uso no banco do cliente; sem núcleo, 503.
      {
        provide: PORTA_GAS_MEDICINAL,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaGasMedicinalPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // C1-050 (05-SUP linha 30): consumo de gás por setor e apuração por setor no banco do cliente; sem núcleo, 503.
      {
        provide: PORTA_GAS_SETOR,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaGasSetorPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // C1-080 (02-REC linha 38): pedidos recebidos da central de regulação (aceite e recusa); sem núcleo, 503.
      {
        provide: PORTA_REGULACAO_ENTRADA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaRegulacaoEntradaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // C1-066 (03-PEP linha 125): pedido de transporte do paciente na alta e na transferência; sem núcleo, 503.
      {
        provide: PORTA_TRANSPORTE_PACIENTE,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaTransportePacientePropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F3.9 (04-HOT L126): SAME pelo volume (guarda, local e movimentação pelo tipo da operação); sem núcleo, 503.
      {
        provide: PORTA_SAME_GUARDA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaSameGuardaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F3.9 (04-HOT L127 e L128): protocolo em lote, solicitação e empréstimo de prontuário; sem núcleo, 503.
      {
        provide: PORTA_SAME_TRAMITE,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaSameTramitePropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F78.04-1 (04-INT L74, L75, L78): formulários de óbito, auditoria do isolamento e evolução da regulação; sem núcleo, 503.
      {
        provide: PORTA_CONTROLES_ASSISTENCIAIS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaControlesAssistenciaisPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F78.04-2 (04-INT L79 e L80): leitos do sistema público e comunicação à operadora; sem núcleo, 503.
      {
        provide: PORTA_LEITOS_SUS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaLeitosSusPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      {
        provide: PORTA_COMUNICACAO_OPERADORA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaComunicacaoOperadoraPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
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
