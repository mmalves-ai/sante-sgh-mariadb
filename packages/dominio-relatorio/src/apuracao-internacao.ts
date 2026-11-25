// Apuração mensal dos indicadores obrigatórios de internação fora da qualidade (01-REL L112; F3): a partir das bases
// mensais do censo (paciente-dia, leito-dia, saídas, óbitos), cada indicador vira uma apuração com numerador,
// denominador, valor e situação diante da meta (Portaria 312 do Ministério da Saúde e referenciais da ANAHP). A
// apuração do mês corrente é prévia e é recalculada; a apuração fechada (análise crítica concluída) nunca é
// sobrescrita: o histórico se preserva.
import type { BaseMensal, CodigoIndicador, FichaIndicador } from '@sgh/contratos';
import { situacaoDaMeta, valorDe } from './calculo.js';
import { FICHAS } from './fichas.js';

/** Os indicadores obrigatórios de internação apurados pelo censo. */
export const INDICADORES_OBRIGATORIOS_INTERNACAO: readonly CodigoIndicador[] = [
  'taxaOcupacao',
  'mediaPermanencia',
  'giroLeito',
  'intervaloSubstituicao',
  'taxaMortalidadeGeral',
  'taxaMortalidadeInstitucional',
];

export type SituacaoMetaApuracao = 'na_meta' | 'fora_da_meta' | 'sem_meta' | 'sem_valor';

export interface ApuracaoCalculada {
  readonly codigo: CodigoIndicador;
  readonly competencia: string;
  readonly periodoInicio: string;
  readonly periodoFim: string;
  readonly numerador: number;
  readonly denominador: number | null;
  readonly valor: number | null;
  readonly valorMeta: number | null;
  readonly situacaoMeta: SituacaoMetaApuracao;
  readonly parcial: boolean;
}

export interface ErroApuracao {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

/** Último dia do mês AAAA-MM. */
export function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mes}-${String(d).padStart(2, '0')}`;
}

/** Confere a competência pedida (AAAA-MM): formato, nada antes de 2019 e nada depois do mês corrente. */
export function conferirCompetenciaApuracao(competencia: string, mesAtual: string): ErroApuracao[] {
  const erro = (codigo: string, mensagem: string): ErroApuracao[] => [
    { campo: 'competencia', codigo, mensagem },
  ];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia))
    return erro('competencia-invalida', 'Informe a competência no formato AAAA-MM.');
  if (competencia < '2019-01') return erro('competencia-antiga', 'A apuração começa em 2019.');
  if (competencia > mesAtual) return erro('competencia-futura', 'Não se apura um mês que ainda não começou.');
  return [];
}

const SITUACAO: Readonly<Record<string, SituacaoMetaApuracao>> = {
  'na-meta': 'na_meta',
  'fora-da-meta': 'fora_da_meta',
  'sem-meta': 'sem_meta',
  'sem-valor': 'sem_valor',
};

/** Calcula as apurações de cada base mensal para os indicadores obrigatórios (numerador e denominador sempre). */
export function apurarIndicadoresInternacao(
  bases: readonly BaseMensal[],
  metas: Readonly<Partial<Record<CodigoIndicador, number | null>>>,
  fichas: readonly FichaIndicador[] = FICHAS,
): ApuracaoCalculada[] {
  const escolhidas = fichas.filter((f) => INDICADORES_OBRIGATORIOS_INTERNACAO.includes(f.codigo));
  return bases.flatMap((b) =>
    escolhidas.map((f) => {
      const v = valorDe(f, b);
      const meta = metas[f.codigo] ?? null;
      return {
        codigo: f.codigo,
        competencia: `${b.periodo}-01`,
        periodoInicio: `${b.periodo}-01`,
        periodoFim: ultimoDiaDoMes(b.periodo),
        numerador: v.numerador,
        denominador: v.denominador,
        valor: v.valor,
        valorMeta: meta,
        situacaoMeta: SITUACAO[situacaoDaMeta(f, meta, v.valor)] ?? 'sem_meta',
        parcial: b.parcial,
      };
    }),
  );
}

export interface ApuracaoGravada {
  readonly situacao: string;
  readonly numerador: number | null;
  readonly denominador: number | null;
  readonly valorMeta: number | null;
}

export type DestinoApuracao = 'incluir' | 'atualizar' | 'manter-fechada' | 'sem-mudanca';

/** O que fazer com a apuração recalculada diante da gravada: fechada nunca muda; igual não regrava. */
export function destinoDaApuracao(gravada: ApuracaoGravada | null, nova: ApuracaoCalculada): DestinoApuracao {
  if (!gravada) return 'incluir';
  if (gravada.situacao === 'fechada') return 'manter-fechada';
  const igual =
    gravada.situacao !== 'cancelada' &&
    gravada.numerador === nova.numerador &&
    gravada.denominador === nova.denominador &&
    gravada.valorMeta === nova.valorMeta;
  return igual ? 'sem-mudanca' : 'atualizar';
}
