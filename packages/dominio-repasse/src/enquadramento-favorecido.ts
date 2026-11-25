// Enquadramento tributário do fornecedor de um favorecido do repasse (F3.7, 06-FAT linha 46). É o mesmo cadastro
// fiscal do contas a pagar (empresa fornecedora): regime, retenção e alíquota própria de ISS, por tributo e vigência.
// Regras: alíquota de 0 a 100 com até 4 casas; fim nunca antes do início; o enquadramento novo de um tributo termina o
// anterior aberto no dia de antes (nada apagado); um enquadramento que começa no mesmo dia ou depois do novo recusa
// (corrigir o futuro é encerrá-lo); decisão judicial exige o processo, que é cadastrado no contas a pagar.
import { diaAnterior, type ProblemaCampo } from './favorecido.js';

export const REGIMES_ENQUADRAMENTO = [
  'simples_nacional',
  'mei',
  'lucro_presumido',
  'lucro_real',
  'imune',
  'isento',
  'substituto_tributario',
  'outro',
] as const;
export type RegimeEnquadramento = (typeof REGIMES_ENQUADRAMENTO)[number];

export interface EnquadramentoNovo {
  readonly tributo: number | null;
  readonly regime: string;
  readonly retem: boolean;
  readonly aliquotaIss: number | null;
  readonly inicio: string;
  readonly fim: string | null;
}

export interface EnquadramentoVigente {
  readonly id: number;
  readonly tributo: number | null;
  readonly inicio: string;
  readonly fim: string | null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Confere o enquadramento novo e diz quais anteriores do mesmo tributo terminam no dia de antes. */
export function planejarEnquadramento(
  novo: EnquadramentoNovo,
  existentes: readonly EnquadramentoVigente[],
): { problemas: ProblemaCampo[]; encerrar: { id: number; fim: string }[] } {
  const problemas: ProblemaCampo[] = [];
  if (novo.regime === 'decisao_judicial')
    problemas.push({
      campo: 'regime',
      mensagem: 'Decisão judicial exige o processo: cadastre no contas a pagar, com o processo tributário.',
    });
  else if (!REGIMES_ENQUADRAMENTO.includes(novo.regime as RegimeEnquadramento))
    problemas.push({ campo: 'regime', mensagem: 'Regime tributário inválido.' });
  if (
    novo.aliquotaIss !== null &&
    (!Number.isFinite(novo.aliquotaIss) ||
      novo.aliquotaIss < 0 ||
      novo.aliquotaIss > 100 ||
      Math.round(novo.aliquotaIss * 10_000) !== novo.aliquotaIss * 10_000)
  )
    problemas.push({ campo: 'aliquotaIss', mensagem: 'A alíquota de ISS vai de 0 a 100, com até 4 casas.' });
  if (!DATA.test(novo.inicio)) problemas.push({ campo: 'inicio', mensagem: 'Informe o início da vigência.' });
  else if (novo.fim !== null && (!DATA.test(novo.fim) || novo.fim < novo.inicio))
    problemas.push({ campo: 'fim', mensagem: 'O fim da vigência não pode ser antes do início.' });
  const encerrar: { id: number; fim: string }[] = [];
  if (problemas.length) return { problemas, encerrar };
  for (const e of existentes) {
    if (e.tributo !== novo.tributo) continue;
    if (e.fim !== null && e.fim < novo.inicio) continue;
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
