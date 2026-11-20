// W0-03, mercado M5: as regras da contenção mecânica, sem banco (o servidor e a tela usam as mesmas):
//   - a checagem periódica aprazada pela ordem (de `inicio` até o fim do prazo, a cada `intervaloMinutos`);
//   - a situação da ordem (ativa, vencida sem retirada nem renovação, retirada, renovada);
//   - as checagens atrasadas (horário passado da tolerância sem registro);
//   - o indicador do período, com o numerador e o denominador impressos (contenções por 1.000 pacientes-dia, horas
//     contidas e checagens feitas no prazo).
// Base: Resolução COFEN 427/2012 (monitoramento do contido e registro). Horas locais em texto (tempo.ts).
import type { SituacaoContencao, Turno } from '@sgh/contratos';
import { diferencaMinutos, somarMinutos } from '../tempo.js';
import { turnoDoInstante } from '../turno/linha-do-tempo.js';

export interface ParametrosContencao {
  /** Prazo máximo da ordem em horas (a renovação é ordem nova). */
  readonly prazoMaximoHoras: number;
  /** Intervalo padrão da checagem periódica em minutos. */
  readonly intervaloPadraoMinutos: number;
  /** Tolerância, em minutos, para a checagem contar como no prazo. */
  readonly toleranciaMinutos: number;
}

export const PARAMETROS_CONTENCAO_PADRAO: ParametrosContencao = {
  prazoMaximoHoras: 24,
  intervaloPadraoMinutos: 60,
  toleranciaMinutos: 15,
};

export interface OrdemContencaoLida {
  readonly id: number;
  readonly inicio: string;
  readonly prazoHoras: number;
  readonly intervaloMinutos: number;
  readonly encerradaEm: string | null;
  readonly encerramento: 'retirada' | 'inativacao' | null;
  /** A ordem nova que renovou esta (a anterior fica "renovada"); a renovação inativada não conta. */
  readonly renovadaPor: number | null;
  /**
   * Revisão W0-03: o início da renovação. A renovação antes do fim do prazo corta a anterior como a retirada: os
   * horários da anterior depois dele são da nova (não previstos aqui) e as horas contidas da anterior vão até ele.
   */
  readonly renovadaEm?: string | null;
}

export const fimDaOrdem = (o: Pick<OrdemContencaoLida, 'inicio' | 'prazoHoras'>): string =>
  somarMinutos(o.inicio.slice(0, 16), o.prazoHoras * 60);

/** Os horários da checagem periódica da ordem (o primeiro um intervalo depois do início; até o fim do prazo). */
export function horariosDeChecagem(
  o: Pick<OrdemContencaoLida, 'inicio' | 'prazoHoras' | 'intervaloMinutos'>,
): string[] {
  const r: string[] = [];
  const inicio = o.inicio.slice(0, 16);
  const total = o.prazoHoras * 60;
  for (let m = o.intervaloMinutos; m <= total; m += o.intervaloMinutos) r.push(somarMinutos(inicio, m));
  return r;
}

export function situacaoDaOrdem(o: OrdemContencaoLida, agora: string): SituacaoContencao {
  if (o.renovadaPor !== null) return 'renovada';
  if (o.encerradaEm !== null) return 'retirada';
  return agora.slice(0, 16) > fimDaOrdem(o) ? 'vencida' : 'ativa';
}

/** Confere a ordem nova contra os parâmetros (prazo máximo e intervalo que cabe no prazo). */
export function conferirOrdem(
  e: { prazoHoras: number; intervaloMinutos: number },
  p: ParametrosContencao,
):
  | { ok: true }
  | { ok: false; codigo: 'prazo-acima-do-maximo' | 'intervalo-maior-que-prazo'; mensagem: string } {
  if (e.prazoHoras > p.prazoMaximoHoras)
    return {
      ok: false,
      codigo: 'prazo-acima-do-maximo',
      mensagem: `O prazo máximo da ordem é de ${p.prazoMaximoHoras} horas: depois dele, renove com nova avaliação.`,
    };
  if (e.intervaloMinutos > e.prazoHoras * 60)
    return {
      ok: false,
      codigo: 'intervalo-maior-que-prazo',
      mensagem: 'O intervalo da checagem passa do prazo.',
    };
  return { ok: true };
}

/** Os horários previstos até agora sem checagem registrada, passada a tolerância. */
export function checagensAtrasadas(
  previstos: readonly string[],
  feitas: readonly { previsto: string }[],
  agora: string,
  toleranciaMinutos: number,
): string[] {
  const ok = new Set(feitas.map((f) => f.previsto.slice(0, 16)));
  return previstos.filter((x) => !ok.has(x) && diferencaMinutos(x, agora.slice(0, 16)) > toleranciaMinutos);
}

// ── W1-08: a checagem da contenção por turno (no aprazamento da enfermagem) ─────────────────

/** O que toda checagem periódica da contenção avalia, em todo turno (COFEN 427/2012: perfusão e pele do membro contido). */
export const ACHADOS_OBRIGATORIOS_CONTENCAO = ['perfusao', 'pele'] as const;

export type EstadoHorarioContencao = 'pendente' | 'atrasada' | 'feita' | 'cancelada';

/** As checagens da ordem num turno de 12 horas da enfermagem (diurno ou noturno). */
export interface TurnoChecagemContencao {
  readonly turno: Turno;
  readonly inicio: string;
  readonly fim: string;
  /** Os horários aprazados pela ordem neste turno (os cancelados pela retirada ou renovação não contam). */
  readonly previstas: number;
  readonly feitas: number;
  readonly atrasadas: number;
  readonly pendentes: number;
  readonly canceladas: number;
  readonly achados: readonly (typeof ACHADOS_OBRIGATORIOS_CONTENCAO)[number][];
  readonly horarios: readonly string[];
}

/**
 * W1-08: os horários aprazados pela ordem agrupados nos turnos de 12 horas da unidade (o diurno começa no parâmetro
 * `inicioDiurno`). Cada turno coberto pela ordem tem as checagens de perfusão e pele; como o intervalo vai até 120
 * minutos, todo turno em que a ordem está em curso tem ao menos uma checagem aprazada.
 */
export function checagensPorTurno(
  horarios: readonly { readonly previsto: string; readonly estado: EstadoHorarioContencao }[],
  inicioDiurno = '0700',
): TurnoChecagemContencao[] {
  const porTurno = new Map<
    string,
    { turno: Turno; inicio: string; fim: string; h: (typeof horarios)[number][] }
  >();
  for (const h of horarios) {
    const j = turnoDoInstante(h.previsto.slice(0, 16), inicioDiurno);
    const t = porTurno.get(j.inicio) ?? { turno: j.nome, inicio: j.inicio, fim: j.fim, h: [] };
    t.h.push(h);
    porTurno.set(j.inicio, t);
  }
  return [...porTurno.values()]
    .sort((a, b) => (a.inicio < b.inicio ? -1 : 1))
    .map((t) => {
      const conta = (e: EstadoHorarioContencao) => t.h.filter((h) => h.estado === e).length;
      return {
        turno: t.turno,
        inicio: t.inicio,
        fim: t.fim,
        previstas: t.h.length - conta('cancelada'),
        feitas: conta('feita'),
        atrasadas: conta('atrasada'),
        pendentes: conta('pendente'),
        canceladas: conta('cancelada'),
        achados: [...ACHADOS_OBRIGATORIOS_CONTENCAO],
        horarios: t.h.map((h) => h.previsto.slice(0, 16)),
      };
    });
}

/**
 * W1-08: a ordem venceu sem renovação nem retirada no prazo? O prazo terminou antes de `ate` e nem a retirada nem o
 * início da renovação vigente aconteceram até o fim do prazo mais a tolerância. A inativada (lançada errada) não conta.
 */
export function venceuSemRenovacao(o: OrdemContencaoLida, ate: string, toleranciaMinutos = 0): boolean {
  if (o.encerramento === 'inativacao') return false;
  const fim = fimDaOrdem(o);
  const limite = somarMinutos(fim, toleranciaMinutos);
  if (limite >= ate.slice(0, 16)) return false;
  const retiradaNoPrazo = o.encerradaEm !== null && o.encerradaEm.slice(0, 16) <= limite;
  const renovadaNoPrazo = o.renovadaPor !== null && (!o.renovadaEm || o.renovadaEm.slice(0, 16) <= limite);
  return !retiradaNoPrazo && !renovadaNoPrazo;
}

export interface IndicadorContencao {
  /** W1-08: ordens com o prazo vencido no período sem renovação nem retirada no prazo (e quantas seguem abertas). */
  readonly vencidasSemRenovacao: {
    readonly numerador: number;
    readonly denominador: number;
    readonly percentual: number | null;
    readonly emAberto: number;
  };
  readonly contencoes: {
    readonly numerador: number;
    readonly denominador: number;
    readonly por1000: number | null;
  };
  readonly horasContidas: number;
  readonly checagensNoPrazo: {
    readonly numerador: number;
    readonly denominador: number;
    readonly percentual: number | null;
  };
}

/**
 * O indicador do período: ordens iniciadas (renovação não conta como nova contenção) por 1.000 pacientes-dia; horas
 * contidas (do início ao encerramento ou ao fim do período); checagens feitas até a tolerância sobre as previstas.
 */
export function indicadorContencao(
  ordens: readonly (OrdemContencaoLida & { readonly renovaAnterior: boolean })[],
  checagens: readonly { previsto: string; feitaEm: string }[],
  previstas: number,
  pacientesDia: number,
  fimPeriodo: string,
  toleranciaMinutos: number,
): IndicadorContencao {
  const novas = ordens.filter((o) => !o.renovaAnterior && o.encerramento !== 'inativacao');
  const horas = ordens
    .filter((o) => o.encerramento !== 'inativacao')
    .reduce((a, o) => {
      const ate = [
        o.encerradaEm?.slice(0, 16) ?? fimDaOrdem(o),
        o.renovadaPor !== null && o.renovadaEm ? o.renovadaEm.slice(0, 16) : fimDaOrdem(o),
        fimDaOrdem(o),
        fimPeriodo.slice(0, 16),
      ].sort()[0]!;
      return a + Math.max(0, diferencaMinutos(o.inicio.slice(0, 16), ate)) / 60;
    }, 0);
  const noPrazo = checagens.filter(
    (c) => diferencaMinutos(c.previsto.slice(0, 16), c.feitaEm.slice(0, 16)) <= toleranciaMinutos,
  ).length;
  const corte = fimPeriodo.slice(0, 16);
  const comPrazoFechado = ordens.filter(
    (o) => o.encerramento !== 'inativacao' && somarMinutos(fimDaOrdem(o), toleranciaMinutos) < corte,
  );
  const vencidas = comPrazoFechado.filter((o) => venceuSemRenovacao(o, corte, toleranciaMinutos));
  return {
    vencidasSemRenovacao: {
      numerador: vencidas.length,
      denominador: comPrazoFechado.length,
      percentual:
        comPrazoFechado.length > 0
          ? Math.round((vencidas.length / comPrazoFechado.length) * 1000) / 10
          : null,
      emAberto: vencidas.filter((o) => o.encerradaEm === null && o.renovadaPor === null).length,
    },
    contencoes: {
      numerador: novas.length,
      denominador: pacientesDia,
      por1000: pacientesDia > 0 ? Math.round((novas.length / pacientesDia) * 1000 * 100) / 100 : null,
    },
    horasContidas: Math.round(horas * 10) / 10,
    checagensNoPrazo: {
      numerador: noPrazo,
      denominador: previstas,
      percentual: previstas > 0 ? Math.round((noPrazo / previstas) * 1000) / 10 : null,
    },
  };
}
