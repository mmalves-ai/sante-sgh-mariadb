// Recoleta e sub-amostras (F3.5, 05-SADT linha 7). A recoleta é um fato próprio: nasce de uma amostra com motivo do
// cadastro, fica pendente até a nova coleta e liga a amostra nova à original (a original nunca é apagada). A sub-amostra
// (alíquota) sai da amostra primária recebida pelas regras do exame: cada regra diz a bancada ou o setor de destino e
// como as etiquetas se agrupam. Regra pura, sem banco.

export class RecusaAmostra extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Situações (do banco) em que a amostra ainda pode pedir recoleta. */
const RECOLETAVEIS = new Set([
  'coletada',
  'em_transporte',
  'recebida',
  'triada',
  'aliquotada',
  'em_analise',
  'rejeitada',
]);

export interface MotivoRecoleta {
  readonly ativo: boolean;
  readonly geraNovaAmostra: boolean;
}

/**
 * Confere o pedido de recoleta: a amostra precisa estar coletada (ou rejeitada), sem outra recoleta em aberto, e o
 * motivo ativo. Devolve se a amostra original deve ser rejeitada junto (quando ainda estava ativa).
 */
export function conferirRecoleta(
  situacaoAmostra: string,
  recoletaAberta: boolean,
  motivo: MotivoRecoleta | null,
): { readonly rejeitarOriginal: boolean } {
  if (!motivo || !motivo.ativo)
    throw new RecusaAmostra('motivo-invalido', 'Escolha um motivo de recoleta ativo.');
  if (!RECOLETAVEIS.has(situacaoAmostra))
    throw new RecusaAmostra('amostra-sem-recoleta', 'A amostra não está numa situação que permita recoleta.');
  if (recoletaAberta)
    throw new RecusaAmostra('recoleta-aberta', 'Já existe recoleta pendente para esta amostra.');
  return { rejeitarOriginal: situacaoAmostra !== 'rejeitada' };
}

/** Passagens da recoleta pendente: a coleta só fecha a pendente, e o cancelamento pede motivo. */
export function conferirFechamentoRecoleta(
  situacao: string,
  acao: 'coletar' | 'cancelar',
  motivo?: string | null,
) {
  if (!['pendente', 'contato_realizado', 'agendada'].includes(situacao))
    throw new RecusaAmostra('recoleta-fechada', 'A recoleta já foi coletada ou cancelada.');
  if (acao === 'cancelar' && (motivo ?? '').trim().length < 5)
    throw new RecusaAmostra('motivo-obrigatorio', 'Informe o motivo do cancelamento da recoleta.');
}

// ── Sub-amostras ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ExameDaAmostra {
  readonly exameItem: number;
  readonly exame: number;
  readonly setor: number | null;
  readonly material: number;
}

export interface RegraSubamostra {
  readonly id: number;
  readonly exame: number;
  readonly setor: number;
  readonly material: number | null;
  readonly bancada: number | null;
  readonly destinoSetor: number | null;
  readonly geraSubamostra: boolean;
  readonly examePrimario: boolean;
  readonly agrupamento: 'por_exame' | 'por_bancada' | 'por_setor' | 'unico' | null;
}

export interface SubamostraPlanejada {
  readonly regra: number;
  readonly bancada: number | null;
  readonly setor: number | null;
  readonly exameItens: readonly number[];
}

/**
 * O plano das alíquotas da amostra primária: para cada exame, a regra do exame no setor (a do material da amostra
 * vence a genérica). Exame sem regra, ou com a regra que o deixa na primária, não gera alíquota. As alíquotas se
 * agrupam pela regra: uma por exame, por bancada, por setor de destino ou única para a regra.
 */
export function planoDeSubamostras(
  exames: readonly ExameDaAmostra[],
  regras: readonly RegraSubamostra[],
): SubamostraPlanejada[] {
  const grupos = new Map<
    string,
    { regra: number; bancada: number | null; setor: number | null; itens: number[] }
  >();
  for (const e of exames) {
    const candidatas = regras.filter(
      (r) =>
        r.exame === e.exame &&
        (e.setor === null || r.setor === e.setor) &&
        (r.material ?? e.material) === e.material,
    );
    const r = candidatas.find((x) => x.material !== null) ?? candidatas[0];
    if (!r || !r.geraSubamostra || r.examePrimario) continue;
    const setor = r.destinoSetor ?? r.setor;
    const ag = r.agrupamento ?? 'por_exame';
    const k =
      ag === 'por_exame'
        ? `e:${e.exameItem}`
        : ag === 'por_bancada'
          ? `b:${r.bancada ?? '-'}:${setor}`
          : ag === 'por_setor'
            ? `s:${setor}`
            : `u:${r.id}`;
    const g = grupos.get(k) ?? { regra: r.id, bancada: r.bancada, setor, itens: [] };
    g.itens.push(e.exameItem);
    grupos.set(k, g);
  }
  return [...grupos.values()].map((g) => ({
    regra: g.regra,
    bancada: g.bancada,
    setor: g.setor,
    exameItens: g.itens,
  }));
}

/** A amostra primária só se divide recebida (ou triada) e uma vez só. */
export function conferirAliquotagem(
  situacao: string,
  jaTemFilhas: boolean,
  plano: readonly SubamostraPlanejada[],
) {
  if (!['recebida', 'triada'].includes(situacao))
    throw new RecusaAmostra(
      'amostra-nao-recebida',
      'Receba a amostra no laboratório antes de gerar as alíquotas.',
    );
  if (jaTemFilhas)
    throw new RecusaAmostra('amostra-aliquotada', 'As alíquotas desta amostra já foram geradas.');
  if (plano.length === 0)
    throw new RecusaAmostra('sem-regra-subamostra', 'Nenhum exame desta amostra tem regra de alíquota.');
}
