// O NIR em MEMÓRIA (M44, etapa 2): a sessão sintética de dev/ci (E2E), com as MESMAS recusas das tabelas do banco (uma
// solicitação aberta por paciente, a transição sobre o estado visto, uma reserva vigente por leito, a sucessão única
// da alta prevista, a barreira resolvida uma vez). O estado é compartilhado com a porta da internação em memória
// (o mapa vê o leito reservado; a admissão e a transferência vindas do NIR concluem a solicitação e consomem a
// reserva na mesma "gravação"). Sem o `worker` na sessão sintética, a reserva vencida expira na leitura (a mesma regra
// do `worker`: só as vigentes com a validade passada, uma vez). O relógio pode ser avançado pelo E2E pelo arquivo
// NIR_SINTETICO_POR_FORA ({"avancarMin": n}, só dev/ci), para a reserva expirar e a alta prevista vencer sem esperar.
// Nada vai à cópia; dados SINTÉTICOS.
import { readFileSync } from 'node:fs';
import {
  type AcaoSolicitacaoNir,
  chaveTextoLeito,
  type ChaveLeito,
  type EscopoLimitePermanencia,
  type EstadoSolicitacaoNir,
  type Precaucao,
  type SituacaoReserva,
} from '@sgh/contratos';
import {
  type AltaPrevistaRegistrada,
  type BarreiraDaAlta,
  EVENTOS_SEM_DESDOBRAMENTO,
  type EventoSolicitacaoNir,
  frasesDependenciasNir,
  type NovaAltaPrevista,
  type NovaBarreira,
  type NovaReserva,
  type NovaSolicitacaoLeito,
  type ReservaLeitoNir,
  type SolicitacaoLeitoNir,
  type TransicaoSolicitacao,
} from './tipos.js';
import { ErroOperacao } from '@sgh/nucleo';
import { transicao } from '@sgh/dominio-internacao';
import { relogioDoEstabelecimento } from '../recepcao/porta-memoria.js';

const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Recusado pela regra de negócio', detalhe);
const ms = (iso: string) => Date.parse(`${iso.slice(0, 19)}Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 19);
const FINAIS: readonly EstadoSolicitacaoNir[] = ['internado', 'cancelado', 'rejeitado'];

interface EstadoHospital {
  solicitacoes: Map<number, SolicitacaoLeitoNir & { ativa: string | null }>;
  eventos: (EventoSolicitacaoNir & { id: number })[];
  reservas: Map<number, ReservaLeitoNir & { vigente: string | null; regConsumo: number | null }>;
  dpas: (AltaPrevistaRegistrada & { sucede: string })[];
  barreiras: Map<number, BarreiraDaAlta>;
  limites: Map<
    string,
    {
      escopo: EscopoLimitePermanencia;
      chave: string;
      amareloDias: number;
      vermelhoDias: number;
      origem: string;
      amostra: number | null;
    }
  >;
  depara: Map<
    number,
    { situacao: number; estado: EstadoSolicitacaoNir; aprovadoPor: string; aprovadoEm: string }
  >;
  seq: number;
}

/** De quem a solicitação precisa ser: o paciente admitido ou a internação transferida. */
export type DonoSolicitacaoNir = { paciente: number } | { internacao: number };

/** A solicitação é do paciente admitido (não de troca de leito) ou da internação transferida (a mesma regra do banco). */
export function solicitacaoDoDono(
  s: Pick<SolicitacaoLeitoNir, 'origem' | 'paciente' | 'internacao'>,
  dono: DonoSolicitacaoNir,
): boolean {
  return 'internacao' in dono
    ? s.origem === 'internado' && s.internacao === dono.internacao
    : s.origem !== 'internado' && s.paciente === dono.paciente;
}

/** O que a porta da internação em memória usa do NIR (o mapa, a admissão e a transferência vindas dele). */
export interface NirParaAdt {
  reservasDoMapa(hospital: string): {
    chave: string;
    id: number;
    solicitacao: number;
    validaAte: string;
    confirmada: boolean;
    conflitoEm: string | null;
  }[];
  /**
   * Recusa o leito reservado para outra solicitação, a solicitação que não está mais reservada e a de outro paciente
   * (admissão: o cadastro; transferência: a internação de onde ela saiu).
   */
  conferirAdmissao(
    hospital: string,
    leito: ChaveLeito,
    solicitacao: number | null,
    dono?: DonoSolicitacaoNir,
  ): void;
  /** Conclui: consome a reserva no leito gravado; a de outro leito é cancelada (o leito reservado volta a livre). */
  concluir(hospital: string, solicitacao: number, reg: number, usuario: string, leito?: ChaveLeito): void;
  registrarConflito(hospital: string, leito: ChaveLeito, reg: number): number;
}

export class EstadoNirMemoria implements NirParaAdt {
  private readonly hospitais = new Map<string, EstadoHospital>();

  constructor(private readonly opcoes: { agora?: () => Date; arquivoPorFora?: string | null } = {}) {}

  /** A hora local do estabelecimento (sem fuso), com o avanço do E2E quando houver. */
  agora(): string {
    const base = relogioDoEstabelecimento(this.opcoes.agora?.() ?? new Date()).agora;
    return iso(ms(base) + this.avanco() * 60_000);
  }

  private avanco(): number {
    const arq = this.opcoes.arquivoPorFora;
    if (!arq) return 0;
    try {
      const n = Number((JSON.parse(readFileSync(arq, 'utf8')) as { avancarMin?: unknown }).avancarMin ?? 0);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  h(hospital: string): EstadoHospital {
    let s = this.hospitais.get(hospital);
    if (!s) {
      s = {
        solicitacoes: new Map(),
        eventos: [],
        reservas: new Map(),
        dpas: [],
        barreiras: new Map(),
        limites: new Map(),
        depara: new Map(),
        seq: 990_000,
      };
      this.hospitais.set(hospital, s);
    }
    return s;
  }

  /**
   * Expira as reservas vigentes vencidas no relógio (a mesma regra do `worker`), devolvendo a solicitação à análise;
   * devolve as expiradas agora (para a trilha). Chamado em toda leitura do NIR e do mapa.
   */
  expirarVencidas(hospital: string): ReservaLeitoNir[] {
    const s = this.h(hospital);
    const agora = this.agora();
    const r: ReservaLeitoNir[] = [];
    for (const x of s.reservas.values())
      if (x.vigente !== null && ms(agora) > ms(x.validaAte)) {
        this.encerrar(hospital, {
          reserva: x.id,
          situacao: 'expirada',
          motivo: 'Validade vencida',
          usuario: 'SGH.NIR',
        });
        const sol = s.solicitacoes.get(x.solicitacao);
        if (sol && transicao(sol.estado, 'liberarReserva').ok)
          this.transicionar(hospital, {
            solicitacao: x.solicitacao,
            acao: 'liberarReserva',
            de: sol.estado,
            para: 'em_analise',
            situacaoCodigo: 1,
            reserva: x.id,
            motivo: 'Reserva expirada',
            usuario: 'SGH.NIR',
          });
        r.push(x);
      }
    return r;
  }

  // ── Gravações (as mesmas recusas do banco) ──

  evento(
    hospital: string,
    x: {
      solicitacao: number;
      acao: AcaoSolicitacaoNir | 'solicitar' | 'corrigir';
      de: string | null;
      para: string;
      motivo?: string | null;
      usuario: string;
    },
  ): void {
    const s = this.h(hospital);
    s.eventos.push({
      id: ++s.seq,
      solicitacao: x.solicitacao,
      acao: x.acao,
      de: x.de,
      para: x.para,
      motivo: x.motivo ?? null,
      por: x.usuario,
      em: this.agora(),
    });
  }

  solicitar(
    hospital: string,
    x: Omit<NovaSolicitacaoLeito, 'hospital'> & {
      prontuario: number | null;
      nome: string;
      sexo: string | null;
      nascimento: string | null;
    },
  ): number {
    const s = this.h(hospital);
    const ativa = `p:${x.paciente}`;
    if ([...s.solicitacoes.values()].some((y) => y.ativa === ativa))
      throw recusa(
        'solicitacao-aberta',
        'O paciente já tem uma solicitação de leito aberta: acompanhe-a na fila do NIR.',
      );
    const id = ++s.seq;
    const agora = this.agora();
    s.solicitacoes.set(id, {
      id,
      origem: x.origem,
      paciente: x.paciente,
      prontuario: x.prontuario,
      nome: x.nome,
      sexo: x.sexo,
      nascimento: x.nascimento,
      atendimento: x.atendimento,
      cabecalho: x.cabecalho,
      internacao: x.internacao,
      cirurgia: x.cirurgia,
      prioridade: x.prioridade,
      prazoEm: iso(ms(agora) + x.prazoMin * 60_000),
      intensiva: x.perfil.intensiva,
      precaucao: x.perfil.precaucao,
      tiposAcomodacao: [...x.perfil.tiposAcomodacao],
      clinica: x.clinica,
      especialidade: x.especialidade,
      cid: x.cid,
      justificativa: x.justificativa,
      estado: 'solicitado',
      versao: 1,
      vinculo: x.vinculo,
      solicitadoPor: x.usuario,
      solicitadoEm: agora,
      regGerado: null,
      concluidoEm: null,
      ativa,
    });
    this.evento(hospital, {
      solicitacao: id,
      acao: 'solicitar',
      de: null,
      para: 'solicitado',
      usuario: x.usuario,
    });
    return id;
  }

  transicionar(hospital: string, t: Omit<TransicaoSolicitacao, 'hospital'>): number {
    const s = this.h(hospital);
    const x = s.solicitacoes.get(t.solicitacao);
    if (!x || x.estado !== t.de)
      throw recusa(
        'solicitacao-desatualizada',
        'A solicitação mudou depois que você abriu (outra pessoa agiu nela). Abra a fila de novo.',
      );
    const final = FINAIS.includes(t.para);
    s.solicitacoes.set(t.solicitacao, {
      ...x,
      estado: t.para,
      versao: x.versao + 1,
      ativa: final ? null : x.ativa,
      concluidoEm: final ? this.agora() : x.concluidoEm,
      regGerado: t.para === 'internado' && t.reg ? t.reg : x.regGerado,
      ...(t.prioridade
        ? {
            prioridade: t.prioridade,
            prazoEm: iso(ms(x.solicitadoEm) + (t.prazoMinDesdeOPedido ?? 0) * 60_000),
          }
        : {}),
    });
    this.evento(hospital, {
      solicitacao: t.solicitacao,
      acao: t.acao,
      de: t.de,
      para: t.para,
      motivo: t.motivo ?? null,
      usuario: t.usuario,
    });
    return 1;
  }

  reservar(hospital: string, r: Omit<NovaReserva, 'hospital'>): number {
    const s = this.h(hospital);
    const chave = chaveTextoLeito(r.leito);
    if ([...s.reservas.values()].some((x) => x.vigente === chave))
      throw recusa(
        'leito-reservado',
        'O leito acabou de ser reservado em outro terminal. Escolha outro leito.',
      );
    const id = ++s.seq;
    const agora = this.agora();
    s.reservas.set(id, {
      id,
      solicitacao: r.solicitacao,
      bloco: r.leito.bloco,
      acomodacao: r.leito.acomodacao,
      leito: r.leito.leito,
      situacao: 'ativa',
      validaAte: iso(ms(agora) + r.validadeMin * 60_000),
      excecao: r.excecao,
      criadaPor: r.usuario,
      criadaEm: agora,
      confirmadaEm: null,
      encerradaEm: null,
      motivoEncerramento: null,
      conflitoEm: null,
      conflitoReg: null,
      vigente: chave,
      regConsumo: null,
    });
    return id;
  }

  confirmar(hospital: string, r: { reserva: number; validadeMin: number; usuario: string }): number {
    const x = this.h(hospital).reservas.get(r.reserva);
    if (!x || x.situacao !== 'ativa')
      throw recusa('reserva-desatualizada', 'A reserva não está mais aguardando confirmação. Abra de novo.');
    const agora = this.agora();
    Object.assign(x, {
      situacao: 'confirmada',
      confirmadaEm: agora,
      validaAte: iso(ms(agora) + r.validadeMin * 60_000),
    });
    return 1;
  }

  encerrar(
    hospital: string,
    r: {
      reserva: number;
      situacao: 'cancelada' | 'expirada' | 'consumida';
      motivo?: string | null;
      reg?: number | null;
      usuario: string;
    },
  ): number {
    const x = this.h(hospital).reservas.get(r.reserva);
    if (!x || x.vigente === null) return 0;
    Object.assign(x, {
      situacao: r.situacao as SituacaoReserva,
      vigente: null,
      encerradaEm: this.agora(),
      motivoEncerramento: r.motivo ?? null,
      regConsumo: r.reg ?? null,
    });
    return 1;
  }

  registrarDpa(hospital: string, d: Omit<NovaAltaPrevista, 'hospital'>): number {
    const s = this.h(hospital);
    const sucede = d.anterior === null ? `inicial:${d.reg}` : `apos:${d.anterior}`;
    if (s.dpas.some((x) => x.sucede === sucede))
      throw recusa(
        'dpa-desatualizada',
        'A alta prevista mudou depois que você abriu (outra pessoa registrou). Abra de novo.',
      );
    const id = ++s.seq;
    s.dpas.push({ id, reg: d.reg, data: d.data, motivo: d.motivo, por: d.usuario, em: this.agora(), sucede });
    return id;
  }

  registrarBarreira(hospital: string, b: Omit<NovaBarreira, 'hospital'>): number {
    const s = this.h(hospital);
    const id = ++s.seq;
    s.barreiras.set(id, {
      id,
      reg: b.reg,
      tipo: b.tipo,
      descricao: b.descricao,
      responsavel: b.responsavel,
      prazo: b.prazo,
      situacao: 'aberta',
      criadaPor: b.usuario,
      criadaEm: this.agora(),
      resolvidaEm: null,
    });
    return id;
  }

  resolverBarreira(hospital: string, b: { barreira: number; cancelar: boolean }): number {
    const x = this.h(hospital).barreiras.get(b.barreira);
    if (!x || x.situacao !== 'aberta')
      throw recusa('barreira-resolvida', 'A barreira já foi resolvida ou cancelada por outra pessoa.');
    Object.assign(x, { situacao: b.cancelar ? 'cancelada' : 'resolvida', resolvidaEm: this.agora() });
    return 1;
  }

  gravarLimite(
    hospital: string,
    l: {
      escopo: EscopoLimitePermanencia;
      chave: string;
      amareloDias: number;
      vermelhoDias: number;
      origem: string;
      amostra: number | null;
      motivo?: string | null;
      usuario?: string;
    },
  ): void {
    const k = `${l.escopo}:${l.chave}`;
    const { motivo, usuario, ...novo } = l;
    const atual = this.h(hospital).limites.get(k);
    if (atual) {
      // W0-07: a alteração leva o motivo e deixa o valor anterior na trilha (como na gravação real).
      const antes: Record<string, unknown> = {};
      for (const c of ['amareloDias', 'vermelhoDias', 'origem', 'amostra'] as const)
        if (atual[c] !== novo[c]) antes[c] = atual[c];
      if (Object.keys(antes).length === 0) return;
      if (!motivo?.trim())
        throw recusa(
          'motivo-obrigatorio',
          'Informe o motivo da alteração: o valor anterior fica no histórico, com quem o definiu.',
        );
      this.alterou(hospital, {
        tabela: 'limite_permanencia',
        chave: k,
        acao: 'alterar',
        antes,
        motivo,
        usuario: usuario ?? '',
      });
    }
    this.h(hospital).limites.set(k, { ...novo });
  }

  aprovarDepara(
    hospital: string,
    d: { situacao: number; estado: EstadoSolicitacaoNir; usuario: string },
  ): void {
    this.h(hospital).depara.set(d.situacao, {
      situacao: d.situacao,
      estado: d.estado,
      aprovadoPor: d.usuario,
      aprovadoEm: this.agora(),
    });
  }

  // ── W0-07: correção, alteração e exclusão (as mesmas recusas das gravações no banco) ──

  /** A versão anterior de cada alteração (a trilha de auditoria em memória). */
  readonly alteracoes: {
    hospital: string;
    tabela: string;
    chave: string;
    acao: string;
    antes: Record<string, unknown> | null;
    motivo: string;
    por: string;
    em: string;
  }[] = [];
  /** Os retratos das exclusões físicas (a trilha de auditoria em memória). */
  readonly retratos: { hospital: string; tabela: string; chave: string; linha: unknown; motivo: string }[] =
    [];

  private alterou(
    hospital: string,
    a: {
      tabela: string;
      chave: string;
      acao: string;
      antes: Record<string, unknown> | null;
      motivo: string;
      usuario: string;
    },
  ): void {
    this.alteracoes.push({ hospital, ...a, por: a.usuario, em: this.agora() });
  }

  corrigir(
    hospital: string,
    c: {
      solicitacao: number;
      versaoVista: number;
      perfil: { intensiva: boolean; precaucao: Precaucao | null; tiposAcomodacao: number[] };
      recursos: readonly string[];
      observacao: string | null;
      motivo: string;
      usuario: string;
    },
  ): number {
    const x = this.h(hospital).solicitacoes.get(c.solicitacao);
    if (!x) throw recusa('solicitacao-inexistente', 'A solicitação de leito não existe.');
    if (FINAIS.includes(x.estado))
      throw recusa(
        'solicitacao-encerrada',
        'A solicitação já foi encerrada (internada, cancelada ou rejeitada): não se corrige mais.',
      );
    if (x.versao !== c.versaoVista)
      throw recusa(
        'solicitacao-desatualizada',
        'A solicitação mudou depois que você abriu (outra pessoa agiu nela). Abra a fila de novo.',
      );
    const antes = {
      intensiva: x.intensiva,
      precaucao: x.precaucao,
      tiposAcomodacao: x.tiposAcomodacao.join(','),
      recursos: (x.recursos ?? []).join(','),
      observacao: x.observacao ?? null,
    };
    const depois = {
      intensiva: c.perfil.intensiva,
      precaucao: c.perfil.precaucao,
      tiposAcomodacao: c.perfil.tiposAcomodacao.join(','),
      recursos: c.recursos.join(','),
      observacao: c.observacao,
    };
    const dif: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(depois))
      if (JSON.stringify((antes as Record<string, unknown>)[k]) !== JSON.stringify(v))
        dif[k] = (antes as Record<string, unknown>)[k];
    if (Object.keys(dif).length === 0)
      throw recusa('nada-a-corrigir', 'Nada mudou: altere o perfil, os recursos ou a observação.');
    this.h(hospital).solicitacoes.set(c.solicitacao, {
      ...x,
      intensiva: c.perfil.intensiva,
      precaucao: c.perfil.precaucao,
      tiposAcomodacao: [...c.perfil.tiposAcomodacao],
      recursos: [...c.recursos],
      observacao: c.observacao,
      versao: x.versao + 1,
    });
    this.alterou(hospital, {
      tabela: 'pedido_leito',
      chave: String(c.solicitacao),
      acao: 'corrigir',
      antes: dif,
      motivo: c.motivo,
      usuario: c.usuario,
    });
    this.evento(hospital, {
      solicitacao: c.solicitacao,
      acao: 'corrigir',
      de: x.estado,
      para: x.estado,
      motivo: c.motivo,
      usuario: c.usuario,
    });
    return 1;
  }

  /** O que depende da solicitação (o mesmo critério do mapa de dependências; as regulações vêm da porta). */
  dependencias(hospital: string, solicitacao: number, regulacoes: number) {
    const s = this.h(hospital);
    const reservas = [...s.reservas.values()].filter((r) => r.solicitacao === solicitacao).length;
    const transicoes = s.eventos.filter(
      (e) => e.solicitacao === solicitacao && !EVENTOS_SEM_DESDOBRAMENTO.includes(e.acao),
    ).length;
    const internacaoGerada = s.solicitacoes.get(solicitacao)?.regGerado ? 1 : 0;
    return {
      reservas,
      transicoes,
      regulacoes,
      internacaoGerada,
      total: reservas + transicoes + regulacoes + internacaoGerada,
    };
  }

  excluirSolicitacao(
    hospital: string,
    x: { solicitacao: number; motivo: string; usuario: string },
    regulacoes: number,
  ): number {
    const s = this.h(hospital);
    const sol = s.solicitacoes.get(x.solicitacao);
    if (!sol) throw recusa('solicitacao-inexistente', 'A solicitação de leito não existe.');
    const dep = this.dependencias(hospital, x.solicitacao, regulacoes);
    if (dep.total > 0)
      throw recusa(
        'solicitacao-com-vinculo',
        `A solicitação não pode ser excluída: ${frasesDependenciasNir(dep)}. Cancele-a com o motivo.`,
      );
    this.retratos.push({
      hospital,
      tabela: 'pedido_leito',
      chave: String(x.solicitacao),
      linha: { ...sol },
      motivo: x.motivo,
    });
    for (const ev of s.eventos.filter((e) => e.solicitacao === x.solicitacao))
      this.retratos.push({
        hospital,
        tabela: 'pedido_leito',
        chave: String(ev.id),
        linha: { ...ev },
        motivo: x.motivo,
      });
    s.eventos = s.eventos.filter((e) => e.solicitacao !== x.solicitacao);
    s.solicitacoes.delete(x.solicitacao);
    return 1;
  }

  private reservaParaMudar(hospital: string, reserva: number) {
    const x = this.h(hospital).reservas.get(reserva);
    if (!x) throw recusa('reserva-inexistente', 'A reserva não existe.');
    if (x.situacao === 'consumida' || x.regConsumo !== null)
      throw recusa(
        'reserva-convertida',
        'A reserva já virou internação: não se altera nem se retira (corrija pela internação).',
      );
    return x;
  }

  alterarReserva(
    hospital: string,
    r: {
      reserva: number;
      leito: ChaveLeito | null;
      validadeMin: number | null;
      motivo: string;
      usuario: string;
    },
  ): { solicitacao: number; leitoAnterior: ChaveLeito; confirmacaoDesfeita: boolean } {
    const x = this.reservaParaMudar(hospital, r.reserva);
    if (x.vigente === null) throw recusa('reserva-desatualizada', 'A reserva já não está vigente.');
    const anterior = { bloco: x.bloco, acomodacao: x.acomodacao, leito: x.leito };
    const antes: Record<string, unknown> = {};
    if (r.leito && chaveTextoLeito(r.leito) !== x.vigente) {
      const chave = chaveTextoLeito(r.leito);
      if ([...this.h(hospital).reservas.values()].some((y) => y.vigente === chave))
        throw recusa('leito-reservado', 'O leito escolhido já está reservado. Escolha outro leito.');
      antes['leito'] = x.vigente;
      // A confirmação do setor era do leito anterior: volta a 'ativa' (a anterior fica no histórico).
      if (x.situacao === 'confirmada') {
        antes['situacao'] = 'confirmada';
        antes['confirmadaEm'] = x.confirmadaEm;
        Object.assign(x, { situacao: 'ativa', confirmadaEm: null });
      }
      Object.assign(x, {
        bloco: r.leito.bloco,
        acomodacao: r.leito.acomodacao,
        leito: r.leito.leito,
        vigente: chave,
      });
    }
    if (r.validadeMin) {
      antes['validaAte'] = x.validaAte;
      Object.assign(x, { validaAte: iso(ms(this.agora()) + r.validadeMin * 60_000) });
    }
    if (Object.keys(antes).length === 0)
      throw recusa('nada-a-alterar', 'Nada mudou: escolha outro leito ou outra validade.');
    this.alterou(hospital, {
      tabela: 'reserva_leito',
      chave: String(r.reserva),
      acao: 'alterar',
      antes,
      motivo: r.motivo,
      usuario: r.usuario,
    });
    return { solicitacao: x.solicitacao, leitoAnterior: anterior, confirmacaoDesfeita: 'situacao' in antes };
  }

  excluirReserva(
    hospital: string,
    r: { reserva: number; motivo: string; usuario: string },
  ): { solicitacao: number; retrato: number } {
    const x = this.reservaParaMudar(hospital, r.reserva);
    if (x.situacao !== 'ativa' || x.conflitoEm !== null)
      throw recusa(
        'reserva-com-desdobramento',
        x.situacao === 'confirmada'
          ? 'A reserva já foi confirmada pelo setor de destino: cancele-a com o motivo.'
          : x.situacao === 'ativa'
            ? 'A reserva tem conflito com a ocupação registrada: cancele-a com o motivo.'
            : 'A reserva já está encerrada: fica no histórico.',
      );
    // Desdobramento: o paciente já está a caminho do leito com base nesta reserva (como na gravação real).
    const h = this.h(hospital);
    const evs = h.eventos.filter((ev) => ev.solicitacao === x.solicitacao);
    const reservou = Math.max(0, ...evs.filter((ev) => ev.acao === 'reservar').map((ev) => ev.id));
    if (
      h.solicitacoes.get(x.solicitacao)?.estado === 'em_transito' ||
      evs.some((ev) => ev.acao === 'transito' && ev.id > reservou)
    )
      throw recusa(
        'reserva-com-desdobramento',
        'O paciente já está a caminho do leito com base nesta reserva: cancele-a com o motivo.',
      );
    this.retratos.push({
      hospital,
      tabela: 'reserva_leito',
      chave: String(r.reserva),
      linha: { ...x },
      motivo: r.motivo,
    });
    h.reservas.delete(r.reserva);
    return { solicitacao: x.solicitacao, retrato: this.retratos.length };
  }

  retirarDpa(
    hospital: string,
    d: { reg: number; anterior: number; motivo: string; usuario: string },
  ): number {
    const s = this.h(hospital);
    const ant = s.dpas.find((x) => x.id === d.anterior && x.reg === d.reg);
    if (!ant) throw recusa('dpa-inexistente', 'A alta prevista não existe.');
    if (ant.retirada) throw recusa('dpa-retirada', 'A alta prevista já foi retirada.');
    const sucede = `apos:${d.anterior}`;
    if (s.dpas.some((x) => x.sucede === sucede))
      throw recusa(
        'dpa-desatualizada',
        'A alta prevista mudou depois que você abriu (outra pessoa registrou). Abra de novo.',
      );
    const id = ++s.seq;
    s.dpas.push({
      id,
      reg: d.reg,
      data: ant.data,
      motivo: d.motivo,
      por: d.usuario,
      em: this.agora(),
      sucede,
      retirada: true,
    });
    return id;
  }

  alterarBarreira(
    hospital: string,
    b: {
      barreira: number;
      descricao: string | null;
      responsavel: string | null;
      prazo: string | null;
      motivo: string;
      usuario: string;
    },
  ): number {
    const x = this.h(hospital).barreiras.get(b.barreira);
    if (!x) throw recusa('barreira-inexistente', 'A barreira não existe.');
    if (x.situacao !== 'aberta')
      throw recusa('barreira-resolvida', 'A barreira já foi resolvida ou cancelada: fica no histórico.');
    const antes: Record<string, unknown> = {};
    if (b.descricao !== null && b.descricao !== x.descricao) antes['descricao'] = x.descricao;
    if (b.responsavel !== null && b.responsavel !== x.responsavel) antes['responsavel'] = x.responsavel;
    if (b.prazo !== null && b.prazo !== x.prazo) antes['prazo'] = x.prazo;
    if (Object.keys(antes).length === 0)
      throw recusa('nada-a-alterar', 'Nada mudou: altere a descrição, o responsável ou o prazo.');
    Object.assign(x, {
      descricao: b.descricao ?? x.descricao,
      responsavel: b.responsavel ?? x.responsavel,
      prazo: b.prazo ?? x.prazo,
    });
    this.alterou(hospital, {
      tabela: 'barreira_alta',
      chave: String(b.barreira),
      acao: 'alterar',
      antes,
      motivo: b.motivo,
      usuario: b.usuario,
    });
    return 1;
  }

  removerLimite(
    hospital: string,
    l: { escopo: EscopoLimitePermanencia; chave: string; motivo: string; usuario: string },
  ): number {
    const s = this.h(hospital);
    const k = `${l.escopo}:${l.chave}`;
    const x = s.limites.get(k);
    if (!x) throw recusa('limite-inexistente', 'Não há limite próprio para esta chave: já vale o padrão.');
    this.alterou(hospital, {
      tabela: 'limite_permanencia',
      chave: k,
      acao: 'remover',
      antes: { ...x },
      motivo: l.motivo,
      usuario: l.usuario,
    });
    s.limites.delete(k);
    return 1;
  }

  // ── O que a internação em memória usa ──

  reservasDoMapa(hospital: string) {
    this.expirarVencidas(hospital);
    return [...this.h(hospital).reservas.values()]
      .filter((x) => x.vigente !== null)
      .map((x) => ({
        chave: x.vigente as string,
        id: x.id,
        solicitacao: x.solicitacao,
        validaAte: x.validaAte,
        confirmada: x.situacao === 'confirmada',
        conflitoEm: x.conflitoEm,
      }));
  }

  conferirAdmissao(
    hospital: string,
    leito: ChaveLeito,
    solicitacao: number | null,
    dono?: DonoSolicitacaoNir,
  ): void {
    const chave = chaveTextoLeito(leito);
    const r = this.reservasDoMapa(hospital).find((x) => x.chave === chave);
    if (r && r.solicitacao !== solicitacao)
      throw recusa(
        'leito-reservado',
        'Leito reservado pelo NIR para outro paciente: escolha outro leito ou fale com o NIR.',
      );
    if (solicitacao === null) return;
    const s = this.h(hospital).solicitacoes.get(solicitacao);
    if (!s || (s.estado !== 'reservado' && s.estado !== 'em_transito'))
      throw recusa(
        'solicitacao-desatualizada',
        'A solicitação de leito do NIR não está mais reservada (cancelada ou com a reserva vencida): confira a fila antes de admitir.',
      );
    if (dono && !solicitacaoDoDono(s, dono))
      throw recusa(
        'solicitacao-de-outro-paciente',
        'internacao' in dono
          ? 'A solicitação de leito do NIR é de outra internação: abra a transferência pelo cartão da fila.'
          : 'A solicitação de leito do NIR é de outro paciente: abra a admissão pelo cartão da fila.',
      );
  }

  concluir(hospital: string, solicitacao: number, reg: number, usuario: string, leito?: ChaveLeito): void {
    const s = this.h(hospital);
    const x = s.solicitacoes.get(solicitacao);
    if (!x) return;
    const r = [...s.reservas.values()].find((y) => y.solicitacao === solicitacao && y.vigente !== null);
    if (r && leito && r.vigente !== chaveTextoLeito(leito))
      this.encerrar(hospital, {
        reserva: r.id,
        situacao: 'cancelada',
        motivo: 'Paciente admitido em outro leito',
        usuario,
      });
    else if (r) this.encerrar(hospital, { reserva: r.id, situacao: 'consumida', reg, usuario });
    this.transicionar(hospital, {
      solicitacao,
      acao: 'internar',
      de: x.estado,
      para: 'internado',
      situacaoCodigo: 9,
      reserva: r?.id ?? null,
      reg,
      usuario,
    });
  }

  registrarConflito(hospital: string, leito: ChaveLeito, reg: number): number {
    const chave = chaveTextoLeito(leito);
    const r = [...this.h(hospital).reservas.values()].find(
      (x) => x.vigente === chave && x.conflitoEm === null,
    );
    if (!r) return 0;
    Object.assign(r, { conflitoEm: this.agora(), conflitoReg: reg });
    return 1;
  }
}
