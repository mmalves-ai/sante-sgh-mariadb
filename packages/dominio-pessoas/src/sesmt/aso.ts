// ASO e exames do PCMSO (regra 17; NR-7 7.5.8 a 7.5.19; NR32-01; cap-07 §7.1.4): admissional, periódico, retorno ao
// trabalho, mudança de função, monitoração pontual e demissional; conclusão apto ou inapto; o próximo exame periódico
// pela periodicidade do PCMSO; o alerta de ASO vencido ou a vencer. O prontuário ocupacional é só de inclusão: a correção
// é uma retificação (registro novo que aponta o anterior, com o motivo), e a leitura considera só o registro em vigor.
import {
  CONCLUSAO_INAPTO,
  JANELA_ALERTA_ASO_DIAS,
  type NaturezaAso,
  naturezaAso,
  PERIODICIDADE_ASO_MESES,
} from '@sgh/contratos';
import { diasEntre } from '../datas.js';
import { recusaSesmt, type RecusaSesmt } from './recusa.js';

export interface AsoLido {
  readonly id: number;
  readonly tipo: number;
  readonly data: string;
  readonly conclusao: number;
  readonly proximo: string | null;
  readonly retifica: number | null;
}

/** Soma meses a uma data civil; o dia que não existe no mês de destino vira o último dia dele (31/01 + 1 → 28/02). */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${ano}-${p(mes)}-${p(Math.min(d, ultimo))}`;
}

/**
 * O próximo exame (a validade do ASO): data do exame + periodicidade, salvo o demissional (encerra o acompanhamento,
 * sem próximo). O informado pelo médico vale se não passar da periodicidade nem vier antes do exame.
 */
export function proximoAso(
  data: string,
  natureza: NaturezaAso,
  periodicidadeMeses: number = PERIODICIDADE_ASO_MESES,
  informado: string | null = null,
): string | null {
  if (natureza === 'demissional') return null;
  const teto = somarMeses(data, periodicidadeMeses);
  if (informado === null) return teto;
  return diasEntre(informado, teto) < 0 ? teto : informado;
}

export interface EntradaAso {
  readonly tipo: number;
  readonly data: string;
  readonly conclusao: number;
  readonly restricoes: string | null;
  readonly proximo: string | null;
  readonly exames: readonly { readonly data: string }[];
}

export interface ContextoAso {
  readonly hoje: string;
  readonly admissao: string;
  readonly desligamento: string | null;
  /** Os ASO em vigor do vínculo (sem os retificados), do mais recente ao mais antigo. */
  readonly anteriores: readonly AsoLido[];
  /** O ID do ASO retificado por este (null: ASO novo). */
  readonly retifica: number | null;
}

/** Confere o ASO antes de gravar (regra 17). Devolve a primeira recusa ou null. */
export function conferirAso(e: EntradaAso, c: ContextoAso): RecusaSesmt | null {
  const natureza = naturezaAso(e.tipo);
  if (diasEntre(c.hoje, e.data) > 0)
    return recusaSesmt('aso-futuro', 'A data do exame não pode ser futura.', 'data');
  if (diasEntre(c.admissao, e.data) < -90)
    return recusaSesmt(
      'aso-antes-admissao',
      'O exame é de mais de 90 dias antes da admissão: registre-o no vínculo certo.',
      'data',
    );
  // O demissional vale com o vínculo ainda ativo (NR-7 7.5.11: até a data da homologação) ou já desligado.
  if (natureza !== 'demissional' && c.desligamento !== null && diasEntre(c.desligamento, e.data) > 0)
    return recusaSesmt(
      'vinculo-desligado',
      'O vínculo foi desligado antes desta data: só cabe o ASO demissional.',
      'tipo',
    );
  const vigentes = c.anteriores.filter((a) => a.id !== c.retifica);
  if (natureza === 'admissional' && vigentes.some((a) => naturezaAso(a.tipo) === 'admissional'))
    return recusaSesmt(
      'admissional-repetido',
      'Este vínculo já tem ASO admissional. Para corrigir, use a retificação do registro.',
      'tipo',
    );
  if (natureza !== 'admissional' && vigentes.length === 0)
    return recusaSesmt(
      'sem-admissional',
      'O primeiro ASO do vínculo é o admissional (NR-7). Registre o admissional antes.',
      'tipo',
    );
  if (e.conclusao === CONCLUSAO_INAPTO && !(e.restricoes ?? '').trim())
    return recusaSesmt(
      'inapto-sem-motivo',
      'O ASO inapto precisa da orientação do médico do trabalho (restrições ou encaminhamento).',
      'restricoes',
    );
  if (e.proximo !== null && natureza === 'demissional')
    return recusaSesmt('demissional-com-proximo', 'O ASO demissional não tem próximo exame.', 'proximo');
  if (e.proximo !== null && diasEntre(e.data, e.proximo) <= 0)
    return recusaSesmt('proximo-antes', 'O próximo exame tem de ser depois da data deste.', 'proximo');
  for (const x of e.exames)
    if (diasEntre(e.data, x.data) > 0)
      return recusaSesmt(
        'exame-depois-do-aso',
        'Os exames complementares são feitos até a data do ASO (NR-7 7.5.19).',
        'exames',
      );
  return null;
}

export type SituacaoAso = 'valido' | 'a-vencer' | 'vencido' | 'sem-aso' | 'encerrado';

export interface ResumoAso {
  readonly situacao: SituacaoAso;
  readonly ultimo: AsoLido | null;
  /** Dias até o vencimento (negativo: vencido há tantos dias); null sem próximo. */
  readonly diasParaVencer: number | null;
  readonly inapto: boolean;
}

/** Só os registros em vigor: o retificado sai, o que retifica fica. Do mais recente para o mais antigo. */
export function asosEmVigor<T extends AsoLido>(asos: readonly T[]): T[] {
  const retificados = new Set(asos.map((a) => a.retifica).filter((x): x is number => x !== null));
  return asos
    .filter((a) => !retificados.has(a.id))
    .sort((a, b) => (a.data === b.data ? b.id - a.id : a.data < b.data ? 1 : -1));
}

/** A situação do ASO do vínculo no dia (alerta de vencido e a vencer; regra 17). */
export function situacaoAso(
  asos: readonly AsoLido[],
  hoje: string,
  janelaDias: number = JANELA_ALERTA_ASO_DIAS,
): ResumoAso {
  const [ultimo] = asosEmVigor(asos);
  if (!ultimo) return { situacao: 'sem-aso', ultimo: null, diasParaVencer: null, inapto: false };
  const inapto = ultimo.conclusao === CONCLUSAO_INAPTO;
  if (naturezaAso(ultimo.tipo) === 'demissional' || ultimo.proximo === null)
    return { situacao: 'encerrado', ultimo, diasParaVencer: null, inapto };
  const dias = diasEntre(hoje, ultimo.proximo);
  const situacao: SituacaoAso = dias < 0 ? 'vencido' : dias <= janelaDias ? 'a-vencer' : 'valido';
  return { situacao, ultimo, diasParaVencer: dias, inapto };
}
