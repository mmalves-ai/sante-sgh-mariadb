// Enquadramento tributário do fornecedor de um favorecido do repasse (F3.7, 06-FAT linha 46). É o mesmo cadastro
// fiscal do contas a pagar (empresa fornecedora): regime, retenção e alíquota própria de ISS, por tributo e vigência.
// Regras: alíquota de 0 a 100 com até 4 casas; fim nunca antes do início; o enquadramento novo de um tributo termina o
// anterior aberto no dia de antes (nada apagado); um enquadramento que começa no mesmo dia ou depois do novo recusa
// (corrigir o futuro é encerrá-lo); o enquadramento geral (todos os estabelecimentos) aberto do tributo recusa o
// deste estabelecimento (encerrá-lo mudaria os outros); decisão judicial exige o processo judicial ativo e vigente
// no início, do mesmo estabelecimento.
import { diaAnterior, type ProblemaCampo } from './favorecido.js';

export const REGIMES_ENQUADRAMENTO = [
  'simples_nacional',
  'mei',
  'lucro_presumido',
  'lucro_real',
  'imune',
  'isento',
  'substituto_tributario',
  'decisao_judicial',
  'outro',
] as const;
export type RegimeEnquadramento = (typeof REGIMES_ENQUADRAMENTO)[number];

export interface EnquadramentoNovo {
  readonly tributo: number | null;
  readonly regime: string;
  readonly retem: boolean;
  readonly aliquotaIss: number | null;
  readonly processoTributario: number | null;
  readonly inicio: string;
  readonly fim: string | null;
}

export interface EnquadramentoVigente {
  readonly id: number;
  readonly tributo: number | null;
  readonly inicio: string;
  readonly fim: string | null;
  /** Vale para todos os estabelecimentos (sem estabelecimento). */
  readonly geral?: boolean;
}

/** O processo tributário citado pelo enquadramento, como está gravado. */
export interface ProcessoDoEnquadramento {
  readonly tipo: string;
  readonly situacao: string;
  readonly inicio: string;
  readonly fim: string | null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Alíquota de ISS de 0 a 100 com até 4 casas. A conferência das casas tem tolerância, porque o ponto flutuante faz
 * 0,07 × 10.000 dar 700,0000000000001; 2,12345 continua recusada (sobra meia unidade da quarta casa).
 */
export function aliquotaIssValida(a: number | null): boolean {
  if (a === null) return true;
  if (!Number.isFinite(a) || a < 0 || a > 100) return false;
  const x = a * 10_000;
  return Math.abs(Math.round(x) - x) < 1e-6;
}

/** Confere o processo citado: existe no estabelecimento, é judicial na decisão judicial, ativo e vigente no início. */
export function problemasDoProcesso(
  novo: Pick<EnquadramentoNovo, 'regime' | 'processoTributario' | 'inicio'>,
  processo: ProcessoDoEnquadramento | null,
): ProblemaCampo[] {
  if (novo.processoTributario === null) return [];
  const campo = 'processoTributario';
  if (!processo) return [{ campo, mensagem: 'Processo tributário não encontrado neste estabelecimento.' }];
  const p: ProblemaCampo[] = [];
  if (novo.regime === 'decisao_judicial' && processo.tipo !== 'judicial')
    p.push({ campo, mensagem: 'Decisão judicial exige um processo judicial.' });
  if (processo.situacao !== 'ativo') p.push({ campo, mensagem: 'O processo tributário não está ativo.' });
  if (processo.inicio > novo.inicio || (processo.fim !== null && processo.fim < novo.inicio))
    p.push({ campo, mensagem: 'O processo tributário não está vigente no início do enquadramento.' });
  return p;
}

/** Confere o enquadramento novo e diz quais anteriores do mesmo tributo terminam no dia de antes. */
export function planejarEnquadramento(
  novo: EnquadramentoNovo,
  existentes: readonly EnquadramentoVigente[],
): { problemas: ProblemaCampo[]; encerrar: { id: number; fim: string }[] } {
  const problemas: ProblemaCampo[] = [];
  if (!REGIMES_ENQUADRAMENTO.includes(novo.regime as RegimeEnquadramento))
    problemas.push({ campo: 'regime', mensagem: 'Regime tributário inválido.' });
  else if (novo.regime === 'decisao_judicial' && novo.processoTributario === null)
    problemas.push({ campo: 'processoTributario', mensagem: 'Decisão judicial exige o processo judicial.' });
  if (!aliquotaIssValida(novo.aliquotaIss))
    problemas.push({ campo: 'aliquotaIss', mensagem: 'A alíquota de ISS vai de 0 a 100, com até 4 casas.' });
  if (!DATA.test(novo.inicio)) problemas.push({ campo: 'inicio', mensagem: 'Informe o início da vigência.' });
  else if (novo.fim !== null && (!DATA.test(novo.fim) || novo.fim < novo.inicio))
    problemas.push({ campo: 'fim', mensagem: 'O fim da vigência não pode ser antes do início.' });
  const encerrar: { id: number; fim: string }[] = [];
  if (problemas.length) return { problemas, encerrar };
  for (const e of existentes) {
    if (e.tributo !== novo.tributo) continue;
    if (e.fim !== null && e.fim < novo.inicio) continue;
    if (e.geral) {
      problemas.push({
        campo: 'inicio',
        mensagem: `Há enquadramento deste tributo para todos os estabelecimentos desde ${e.inicio}; encerre-o antes de incluir o deste estabelecimento.`,
      });
      continue;
    }
    if (e.inicio >= novo.inicio) {
      problemas.push({
        campo: 'inicio',
        mensagem: `Já há enquadramento deste tributo a partir de ${e.inicio}; encerre-o antes de incluir outro.`,
      });
      continue;
    }
    encerrar.push({ id: e.id, fim: diaAnterior(novo.inicio) });
  }
  return { problemas, encerrar: problemas.length ? [] : encerrar };
}
