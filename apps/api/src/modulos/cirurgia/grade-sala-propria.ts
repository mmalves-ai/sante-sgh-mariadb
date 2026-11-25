// Grade de funcionamento da sala cirúrgica no banco do cliente (04-CC linha 92; F3.4, fatia F3.4-4): leitura das faixas
// da sala (grade_sala_cirurgica), gravação e inativação pelo Executor (trilha na mesma transação) e a conferência da
// agenda: agendar e remarcar releem as faixas sob a trava da sala e recusam o horário fora da grade, na faixa reservada
// a outro cirurgião ou especialidade, ou em feriado sem faixa que valha no feriado (regra do @sgh/dominio-cirurgia).
// A faixa nunca é apagada: inativar guarda a linha (ativo = falso) e a trilha. Feriado: o do calendário único do
// cliente (nacional, da UF, do município e do estabelecimento; ponto facultativo e meio expediente não fecham a sala).
import { randomUUID } from 'node:crypto';
import {
  conferirGradeSala,
  type FaixaAbertaDoMapa,
  type FaixaGradeSala,
  faixasAbertasDoDia,
  validarFaixaGrade,
} from '@sgh/dominio-cirurgia';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  type Operacao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { lerFeriadosDoPeriodo } from '../agenda/dias-sem-expediente-leitor.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { civil, n, nn, verdadeiro } from './banco-apoio.js';

export const PORTA_GRADE_SALA = Symbol('PORTA_GRADE_SALA');

const SQL_FAIXAS = `
  SELECT g.id, g.dia_semana, TIME_FORMAT(g.hora_inicio, '%H:%i') AS inicio, TIME_FORMAT(g.hora_fim, '%H:%i') AS fim,
         DATE_FORMAT(g.vigencia_inicio, '%Y-%m-%d') AS vig_ini, DATE_FORMAT(g.vigencia_fim, '%Y-%m-%d') AS vig_fim,
         g.vale_feriado, g.especialidade_medica_id, g.profissional_id, g.ativo, g.versao
    FROM grade_sala_cirurgica g
    JOIN sala_cirurgica s ON s.id = g.sala_cirurgica_id
   WHERE g.sala_cirurgica_id = ? AND s.estabelecimento_id = ?`;

// As faixas de todas as salas ativas do estabelecimento (para o mapa pintar a grade aberta do dia).
const SQL_FAIXAS_DO_ESTABELECIMENTO = `
  SELECT g.sala_cirurgica_id AS sala, g.id, g.dia_semana, TIME_FORMAT(g.hora_inicio, '%H:%i') AS inicio,
         TIME_FORMAT(g.hora_fim, '%H:%i') AS fim, DATE_FORMAT(g.vigencia_inicio, '%Y-%m-%d') AS vig_ini,
         DATE_FORMAT(g.vigencia_fim, '%Y-%m-%d') AS vig_fim, g.vale_feriado, g.especialidade_medica_id,
         g.profissional_id, g.ativo, g.versao
    FROM grade_sala_cirurgica g
    JOIN sala_cirurgica s ON s.id = g.sala_cirurgica_id
   WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL
   ORDER BY g.sala_cirurgica_id, g.dia_semana, g.hora_inicio`;

export interface FaixaLida extends FaixaGradeSala {
  readonly id: number;
  readonly versao: number;
}

const faixaDe = (x: Record<string, unknown>): FaixaLida => ({
  id: n(x['id']),
  diaSemana: n(x['dia_semana']),
  inicio: String(x['inicio']),
  fim: String(x['fim']),
  vigenciaInicio: String(x['vig_ini']),
  vigenciaFim: x['vig_fim'] ? String(x['vig_fim']) : null,
  valeFeriado: verdadeiro(x['vale_feriado']),
  especialidade: nn(x['especialidade_medica_id']),
  profissional: nn(x['profissional_id']),
  ativo: verdadeiro(x['ativo']),
  versao: n(x['versao']),
});

type Consulta = Pick<Leitor, 'consultar' | 'uma'>;

async function faixasDaSala(l: Consulta, sala: number, est: number): Promise<FaixaLida[]> {
  return (await l.consultar(`${SQL_FAIXAS} ORDER BY g.dia_semana, g.hora_inicio`, [sala, est])).map(faixaDe);
}

async function ehFeriado(l: Consulta, data: string, est: number): Promise<boolean> {
  return (await lerFeriadosDoPeriodo(l, est, data, data)).length > 0;
}

const diaSeguinte = (data: string): string => {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Conferência da agenda sob a transação (chamada por agendar e remarcar depois da trava da sala): recusa o horário
 * fora da grade da sala. Sem faixa ativa na sala, ou com a exceção registrada, não restringe.
 */
export async function conferirGradeNaTx(
  tx: TxOperacao,
  fuso: string,
  p: {
    sala: number;
    inicio: Date;
    duracaoMin: number;
    especialidade: number | null;
    cirurgiao: number | null;
    excecao: boolean;
  },
): Promise<void> {
  const est = tx.contexto.estabelecimento;
  if (est === null || p.excecao) return;
  const faixas = await faixasDaSala(tx, p.sala, est);
  if (!faixas.some((f) => f.ativo)) return;
  const inicio = civil(p.inicio, fuso) ?? '';
  const data = inicio.slice(0, 10);
  const r = conferirGradeSala(
    faixas,
    {
      inicio,
      duracaoMin: p.duracaoMin,
      feriado: await ehFeriado(tx, data, est),
      especialidade: p.especialidade,
      cirurgiao: p.cirurgiao,
      excecao: p.excecao,
    },
    await ehFeriado(tx, diaSeguinte(data), est),
  );
  if (r) throw recusa(r.codigo, r.mensagem, { campos: [r.campo] });
}

// ── operações ──────────────────────────────────────────────────────────────────────────────────────────────

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no formato HH:MM.');
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');

export const esquemaGravarFaixaGrade = z.object({
  sala: z.number().int().positive(),
  faixa: z.number().int().positive().optional(),
  versao: z.number().int().positive().optional(),
  diaSemana: z.number().int().min(1).max(7),
  inicio: hora,
  fim: hora,
  vigenciaInicio: data,
  vigenciaFim: data.nullable().optional(),
  valeFeriado: z.boolean().default(false),
  especialidade: z.number().int().positive().nullable().optional(),
  profissional: z.number().int().positive().nullable().optional(),
});
export type GravarFaixaGradeEntrada = z.infer<typeof esquemaGravarFaixaGrade>;

export const esquemaInativarFaixaGrade = z.object({
  faixa: z.number().int().positive(),
  versao: z.number().int().positive(),
});
export type InativarFaixaGradeEntrada = z.infer<typeof esquemaInativarFaixaGrade>;

function estDe(tx: TxOperacao): number {
  const e = tx.contexto.estabelecimento;
  if (e === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return e;
}

async function exigirSalaAtiva(tx: TxOperacao, sala: number, est: number): Promise<void> {
  const [s] = await tx.consultarParaAtualizar(
    "SELECT id FROM sala_cirurgica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'ativa'",
    [sala, est],
    { teto: 1 },
  );
  if (!s)
    throw recusa('sala-inexistente', 'A sala cirúrgica não existe ou não está ativa neste estabelecimento.', {
      campos: ['sala'],
    });
}

async function exigirReserva(tx: TxOperacao, e: GravarFaixaGradeEntrada): Promise<void> {
  if (e.especialidade) {
    const r = await tx.uma('SELECT id FROM especialidade_medica WHERE id = ?', [e.especialidade]);
    if (!r)
      throw recusa('especialidade-inexistente', 'A especialidade não existe.', { campos: ['especialidade'] });
  }
  if (e.profissional) {
    const r = await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
      e.profissional,
    ]);
    if (!r) throw recusa('profissional-inexistente', 'O cirurgião não existe.', { campos: ['profissional'] });
  }
}

const gravarFaixa = definirOperacao<GravarFaixaGradeEntrada, ResultadoOperacao>({
  nome: 'cirurgia.grade-sala.gravar',
  tabelas: ['grade_sala_cirurgica'],
  entrada: esquemaGravarFaixaGrade as never,
  async gravar(tx, e) {
    const est = estDe(tx);
    // A trava da sala serializa as gravações da grade e as marcações da agenda na mesma sala.
    await exigirSalaAtiva(tx, e.sala, est);
    await exigirReserva(tx, e);
    const faixa: FaixaGradeSala & { id?: number } = {
      ...(e.faixa ? { id: e.faixa } : {}),
      diaSemana: e.diaSemana,
      inicio: e.inicio,
      fim: e.fim,
      vigenciaInicio: e.vigenciaInicio,
      vigenciaFim: e.vigenciaFim ?? null,
      valeFeriado: e.valeFeriado,
      especialidade: e.especialidade ?? null,
      profissional: e.profissional ?? null,
      ativo: true,
    };
    const r = validarFaixaGrade(faixa, await faixasDaSala(tx, e.sala, est));
    if (r) throw recusa(r.codigo, r.mensagem, { campos: [r.campo] });
    const valores = {
      dia_semana: e.diaSemana,
      hora_inicio: `${e.inicio}:00`,
      hora_fim: `${e.fim}:00`,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim ?? null,
      vale_feriado: e.valeFeriado,
      especialidade_medica_id: e.especialidade ?? null,
      profissional_id: e.profissional ?? null,
    };
    if (e.faixa) {
      const atual = await tx.uma(`${SQL_FAIXAS} AND g.id = ?`, [e.sala, est, e.faixa]);
      if (!atual || !verdadeiro(atual['ativo']))
        throw recusa('faixa-inexistente', 'A faixa da grade não existe ou está inativa.', {
          campos: ['faixa'],
        });
      await tx.alterar('grade_sala_cirurgica', e.faixa, e.versao ?? n(atual['versao']), valores);
      return { faixa: e.faixa } as ResultadoOperacao;
    }
    const id = await tx.incluir('grade_sala_cirurgica', {
      sala_cirurgica_id: e.sala,
      ...valores,
      ativo: true,
    });
    return { faixa: id } as ResultadoOperacao;
  },
  alvo: (e) => ({ tabela: 'sala_cirurgica', id: e.sala }),
});

const inativarFaixa = definirOperacao<InativarFaixaGradeEntrada, ResultadoOperacao>({
  nome: 'cirurgia.grade-sala.inativar',
  tabelas: ['grade_sala_cirurgica'],
  entrada: esquemaInativarFaixaGrade as never,
  async gravar(tx, e) {
    const est = estDe(tx);
    const atual = await tx.uma<{ sala: number; ativo: unknown }>(
      `SELECT g.sala_cirurgica_id AS sala, g.ativo FROM grade_sala_cirurgica g
         JOIN sala_cirurgica s ON s.id = g.sala_cirurgica_id
        WHERE g.id = ? AND s.estabelecimento_id = ?`,
      [e.faixa, est],
    );
    if (!atual || !verdadeiro(atual.ativo))
      throw recusa('faixa-inexistente', 'A faixa da grade não existe ou já está inativa.', {
        campos: ['faixa'],
      });
    await exigirSalaAtiva(tx, n(atual.sala), est);
    await tx.alterar('grade_sala_cirurgica', e.faixa, e.versao, { ativo: false });
    return { faixa: e.faixa } as ResultadoOperacao;
  },
  alvo: (e) => ({ tabela: 'grade_sala_cirurgica', id: e.faixa }),
});

export const OPERACOES_GRADE_SALA: Readonly<Record<string, Operacao<never, ResultadoOperacao>>> = {
  'cirurgia.gravarFaixaGrade': gravarFaixa as Operacao<never, ResultadoOperacao>,
  'cirurgia.inativarFaixaGrade': inativarFaixa as Operacao<never, ResultadoOperacao>,
};

// ── porta ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface GradeDaSala {
  readonly sala: number;
  readonly faixas: readonly FaixaLida[];
}

/** A grade aberta de cada sala que usa grade, dia a dia (as salas sem faixa ativa não aparecem: não restringem). */
export interface GradeAbertaDoPeriodo {
  readonly dias: readonly {
    readonly dia: string;
    readonly feriado: boolean;
    readonly salas: readonly { readonly sala: number; readonly faixas: readonly FaixaAbertaDoMapa[] }[];
  }[];
}

export type NucleoGrade = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export class PortaGradeSalaPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoGrade,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  /** As faixas da sala (ativas e inativas, para o histórico); nulo se a sala não é do estabelecimento. */
  grade(c: ContextoPortaM18, sala: number): Promise<GradeDaSala | null> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(
      { cliente: c.cliente, correlacao: c.correlacao || 'cirurgia' },
      async (l) => {
        const s = await l.uma(
          'SELECT id FROM sala_cirurgica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [sala, est],
        );
        if (!s) return null;
        return { sala, faixas: await faixasDaSala(l, sala, est) };
      },
    );
  }

  /** A grade aberta de `dias` dias (1 a 7) a partir de `inicio`, com o feriado do calendário único. */
  gradeAberta(c: ContextoPortaM18, inicio: string, dias: number): Promise<GradeAbertaDoPeriodo> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    const n7 = Math.min(Math.max(Math.trunc(dias), 1), 7);
    const datas = [inicio];
    while (datas.length < n7) datas.push(diaSeguinte(datas[datas.length - 1] ?? inicio));
    return this.nucleo.lerSomente(
      { cliente: c.cliente, correlacao: c.correlacao || 'cirurgia' },
      async (l) => {
        const porSala = new Map<number, FaixaLida[]>();
        for (const x of await l.consultar(SQL_FAIXAS_DO_ESTABELECIMENTO, [est])) {
          const sala = n(x['sala']);
          porSala.set(sala, [...(porSala.get(sala) ?? []), faixaDe(x)]);
        }
        const feriados = new Set(
          (await lerFeriadosDoPeriodo(l, est, inicio, datas[datas.length - 1] ?? inicio)).map((f) => f.data),
        );
        return {
          dias: datas.map((dia) => ({
            dia,
            feriado: feriados.has(dia),
            salas: [...porSala.entries()].flatMap(([sala, faixas]) => {
              const abertas = faixasAbertasDoDia(faixas, dia, feriados.has(dia));
              return abertas === null ? [] : [{ sala, faixas: abertas }];
            }),
          })),
        };
      },
    );
  }

  async executar(c: ContextoPortaM18, op: string, entrada: unknown, ctx: ContextoOperacao) {
    const operacao = OPERACOES_GRADE_SALA[op];
    if (!operacao) throw recusa('operacao-desconhecida', 'Operação desconhecida na grade da sala.');
    const r = await this.executor.executar(operacao, c.cliente, entrada as never, {
      ...ctx,
      chaveIdempotencia: ctx.chaveIdempotencia || `grade-sala-${randomUUID()}`,
    });
    return { resultado: r.resultado, repetida: r.repetida };
  }
}
