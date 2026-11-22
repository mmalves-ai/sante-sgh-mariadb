// Módulo da enfermagem na API migrada (F2.2): beira-leito (M25), balanço hídrico, escores, contenção, lesão, TRR e
// parada, protocolo do internado, SAE, prescrição e receita do enfermeiro, vacina (M45) e agência transfusional (M47).
// Cada porta é a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci;
// fora disso, a indisponível (503, falha fechada). Os testes passam as portas pelas opções.
// Melhoria: sem o vigia de reconciliação com o sistema de origem; o vigia dos horários lê o próprio banco do cliente,
// pelo contexto do estabelecimento (cliente e id), e os avisos vêm também das gravações deste processo.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { AvisosAtendimento } from '../atendimento/public-api.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import { portaIndisponivel } from '../exames/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { AgenciaController } from './agencia.controller.js';
import { METODOS_PORTA_AGENCIA, PORTA_AGENCIA, type PortaAgencia } from './agencia-porta.js';
import { PortaAgenciaMemoria } from './agencia-porta-memoria.js';
import { PortaAgenciaPropria } from './agencia-porta-propria.js';
import { BalancoController } from './balanco.controller.js';
import { METODOS_PORTA_BALANCO, PORTA_BALANCO, type PortaBalanco } from './balanco-porta.js';
import { PortaBalancoMemoria } from './balanco-porta-memoria.js';
import { PortaBalancoPropria } from './balanco-porta-propria.js';
import { ContencaoController, VIGIA_CONTENCAO } from './contencao.controller.js';
import { VigiaContencao } from './contencao-servico.js';
import { EnfermagemController } from './enfermagem.controller.js';
import { ClassificacaoPacientesController, EscoresController } from './escores.controller.js';
import { METODOS_PORTA_ESCORES, PORTA_ESCORES, type PortaEscores } from './escores-porta.js';
import { PortaEscoresMemoria } from './escores-porta-memoria.js';
import { PortaEscoresPropria } from './escores-porta-propria.js';
import { IndicesUtiController } from './indices-uti.controller.js';
import { LesaoController } from './lesao.controller.js';
import { METODOS_PORTA_ENFERMAGEM, PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { PortaEnfermagemMemoria } from './porta-memoria.js';
import { PortaEnfermagemPropria } from './porta-propria.js';
import { PrescricaoEnfermeiroController } from './prescricao-enfermeiro.controller.js';
import { ProtocoloInternadoController } from './protocolo-internado.controller.js';
import { SaeController } from './sae.controller.js';
import { PORTA_SAE, type PortaSae } from './sae-porta.js';
import { PortaSaeMemoria } from './sae-porta-memoria.js';
import { PortaSaePropria, portaSaeIndisponivel } from './sae-porta-propria.js';
import { AVISOS_ENFERMAGEM } from './simbolos.js';
import { TransfusaoController } from './transfusao.controller.js';
import { PORTA_TRANSFUSAO, type PortaTransfusao } from './transfusao-porta.js';
import { PortaTransfusaoMemoria } from './transfusao-porta-memoria.js';
import { PortaTransfusaoPropria, portaTransfusaoIndisponivel } from './transfusao-porta-propria.js';
import { TrrController } from './trr.controller.js';
import { VacinaController } from './vacina.controller.js';
import { VigiaHorarios } from './vigia.js';

/** As portas do módulo (as opções dos testes trocam qualquer uma). */
export interface PortasEnfermagem {
  readonly enfermagem: PortaEnfermagem;
  readonly escores: PortaEscores;
  readonly balanco: PortaBalanco;
  readonly sae: PortaSae;
  readonly transfusao: PortaTransfusao;
  readonly agencia: PortaAgencia;
}

export interface OpcoesModuloEnfermagem extends Partial<PortasEnfermagem> {
  /** O vigia dos horários (null desliga; padrão: o do módulo sobre a porta da enfermagem). */
  readonly vigiaEnfermagem?: VigiaHorarios | null;
  /** O vigia das contenções vencidas (padrão: nenhum). */
  readonly vigiaContencao?: VigiaContencao | null;
  /** O relógio das portas em memória (testes). */
  readonly agora?: () => Date;
}

/**
 * As portas pela regra do módulo: com o núcleo, todas as próprias sobre o banco do cliente (beira-leito, escores,
 * balanço e agência pelo lote 02-04; SAE e transfusão pelo 02-05).
 */
export async function portasDaEnfermagem(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloEnfermagem = {},
): Promise<PortasEnfermagem> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    // Lote 02-04: as portas próprias da beira-leito, dos escores, do balanço e da agência (estoque e imuno).
    const enfermagem = opcoes.enfermagem ?? new PortaEnfermagemPropria(ctx.nucleo);
    return {
      enfermagem,
      escores: opcoes.escores ?? new PortaEscoresPropria(ctx.nucleo),
      balanco: opcoes.balanco ?? new PortaBalancoPropria(ctx.nucleo, enfermagem),
      sae: opcoes.sae ?? new PortaSaePropria(ctx.nucleo),
      transfusao: opcoes.transfusao ?? new PortaTransfusaoPropria(ctx.nucleo),
      agencia: opcoes.agencia ?? new PortaAgenciaPropria(ctx.nucleo),
    };
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) {
    const agora = opcoes.agora;
    const enfermagem =
      opcoes.enfermagem ??
      new PortaEnfermagemMemoria({
        arquivoPorFora: ctx.env['ENFERMAGEM_SINTETICA_POR_FORA']?.trim() || null,
        ...(agora ? { agora } : {}),
      });
    const transfusao = opcoes.transfusao ?? new PortaTransfusaoMemoria(enfermagem);
    return {
      enfermagem,
      escores: opcoes.escores ?? new PortaEscoresMemoria(agora ? { agora } : {}),
      balanco: opcoes.balanco ?? new PortaBalancoMemoria(enfermagem),
      sae: opcoes.sae ?? new PortaSaeMemoria(enfermagem),
      transfusao,
      agencia: opcoes.agencia ?? new PortaAgenciaMemoria(transfusao, (c) => enfermagem.relogio(c)),
    };
  }
  return {
    enfermagem: opcoes.enfermagem ?? portaIndisponivel<PortaEnfermagem>(METODOS_PORTA_ENFERMAGEM),
    escores: opcoes.escores ?? portaIndisponivel<PortaEscores>(METODOS_PORTA_ESCORES),
    balanco: opcoes.balanco ?? portaIndisponivel<PortaBalanco>(METODOS_PORTA_BALANCO),
    sae: opcoes.sae ?? portaSaeIndisponivel(),
    transfusao: opcoes.transfusao ?? portaTransfusaoIndisponivel(),
    agencia: opcoes.agencia ?? portaIndisponivel<PortaAgencia>(METODOS_PORTA_AGENCIA),
  };
}

@Module({})
export class ModuloEnfermagem {}

/**
 * A vigia da contenção vencida (W0-03, M5: o aviso na central), com o núcleo: vigia cada estabelecimento ativo do
 * cliente da instalação (CLIENTE_PADRAO). Antes só o boot antigo a ligava, e só no caminho do sistema anterior.
 * Leitura da rede inteira de propósito: a lista de estabelecimentos do cliente é o alvo da vigia, não dado de sessão.
 * Melhoria: a vigia nasce no módulo dono e sobre o banco próprio; ENFERMAGEM_VIGIA_CONTENCAO=nao desliga.
 */
async function vigiaDaContencao(
  ctx: ContextoModulo,
  p: { escores: PortaEscores; enfermagem: PortaEnfermagem },
  opcoes: OpcoesModuloEnfermagem,
): Promise<VigiaContencao | null> {
  if (opcoes.vigiaContencao !== undefined) return opcoes.vigiaContencao;
  const cliente = ctx.configuracao.clientePadrao;
  if (!ctx.nucleo || !cliente || ctx.env['ENFERMAGEM_VIGIA_CONTENCAO'] === 'nao') return null;
  const linhas = await ctx.nucleo.lerSomente({ cliente, correlacao: 'vigia-contencao-alvos' }, (l) =>
    l.consultar('SELECT id FROM estabelecimento WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY id', []),
  );
  const alvos = linhas.map((r) => ({
    cliente,
    estabelecimento: Number(r['id']),
    usuario: null,
    correlacao: 'vigia-contencao',
  }));
  return new VigiaContencao(p.escores, p.enfermagem, alvos);
}

export async function modulo(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloEnfermagem = {},
): Promise<DynamicModule> {
  const p = await portasDaEnfermagem(ctx, opcoes);
  const vigia =
    opcoes.vigiaEnfermagem !== undefined
      ? opcoes.vigiaEnfermagem
      : ctx.env['ENFERMAGEM_VIGIA'] === 'nao'
        ? null
        : new VigiaHorarios(p.enfermagem);
  const vigiaContencao = await vigiaDaContencao(ctx, p, opcoes);
  return {
    module: ModuloEnfermagem,
    // Global: a cirurgia (balanço na ficha anestésica) e a farmácia leem as portas da enfermagem.
    global: true,
    controllers: [
      EnfermagemController,
      BalancoController,
      EscoresController,
      ClassificacaoPacientesController,
      IndicesUtiController,
      ContencaoController,
      TrrController,
      ProtocoloInternadoController,
      LesaoController,
      SaeController,
      PrescricaoEnfermeiroController,
      VacinaController,
      TransfusaoController,
      AgenciaController,
    ],
    providers: [
      { provide: PORTA_ENFERMAGEM, useValue: p.enfermagem },
      { provide: PORTA_ESCORES, useValue: p.escores },
      { provide: PORTA_BALANCO, useValue: p.balanco },
      { provide: PORTA_SAE, useValue: p.sae },
      { provide: PORTA_TRANSFUSAO, useValue: p.transfusao },
      { provide: PORTA_AGENCIA, useValue: p.agencia },
      { provide: AVISOS_ENFERMAGEM, useValue: new AvisosAtendimento(vigia, 'leitos') },
      { provide: VIGIA_CONTENCAO, useValue: vigiaContencao },
    ],
    exports: [
      PORTA_ENFERMAGEM,
      PORTA_ESCORES,
      PORTA_BALANCO,
      PORTA_SAE,
      PORTA_TRANSFUSAO,
      PORTA_AGENCIA,
      AVISOS_ENFERMAGEM,
    ],
  };
}
