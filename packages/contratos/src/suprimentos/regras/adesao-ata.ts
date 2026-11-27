// Adesão à ata de registro de preços (C2-017, 09-AREA linha 81; Lei 14.133/2021, art. 86). Regras puras; a porta
// própria grava o que elas decidem.
//   - Participante: o hospital participou do registro; pede até o saldo do item registrado para ele.
//   - Carona (órgão não participante, art. 86, § 2º a § 5º):
//       justificativa da vantagem da adesão (§ 2º, I) e preço não acima do registrado (§ 2º, II);
//       por órgão, no máximo 50% da quantidade registrada do item, somadas as adesões dele ao mesmo item (§ 4º);
//       no total, as adesões de todos os órgãos ao item não passam do dobro da quantidade registrada (§ 5º);
//       a autorização só com o aceite prévio do órgão gerenciador (ofício autorizado, com o número) e do fornecedor
//       (§ 2º, III), e com a documentação conferida.
//   - Ata do próprio cliente: só vigente e com a solicitação dentro da vigência; ata externa: o órgão gerenciador e a
//     quantidade registrada são obrigatórios (sem ela não há limite a conferir).
//   - Contam no que já foi aderido as adesões solicitadas, em análise e autorizadas (a autorizada pela quantidade aderida);
//     a negada e a cancelada não contam. A negação e o cancelamento exigem motivo; nada é apagado.
import { qtd4 } from './ata-empenho.js';
import { type RecusaSuprimentos, recusa } from './recusa.js';

export const LIMITE_ADESAO_POR_ORGAO = 0.5;
export const LIMITE_ADESOES_TOTAL = 2;
export const TIPOS_ADESAO = ['participante', 'carona'] as const;
export type TipoAdesao = (typeof TIPOS_ADESAO)[number];
export const SITUACOES_ADESAO = [
  'solicitada',
  'em_analise',
  'autorizada',
  'negada',
  'cancelada',
  'encerrada',
] as const;
export type SituacaoAdesao = (typeof SITUACOES_ADESAO)[number];
export const SITUACOES_ADESAO_QUE_CONTAM: readonly SituacaoAdesao[] = [
  'solicitada',
  'em_analise',
  'autorizada',
  'encerrada',
];

/** A quantidade que uma adesão ocupa do item: a aderida, se autorizada; senão a solicitada; zero se negada. */
export function quantidadeOcupada(a: {
  readonly situacao: string;
  readonly solicitada: number;
  readonly aderida: number | null;
}): number {
  if (!(SITUACOES_ADESAO_QUE_CONTAM as readonly string[]).includes(a.situacao)) return 0;
  return qtd4(a.situacao === 'autorizada' || a.situacao === 'encerrada' ? (a.aderida ?? 0) : a.solicitada);
}

/** Os limites do item para o órgão e no total (art. 86, § 4º e § 5º). */
export function limitesAdesao(registrada: number): { porOrgao: number; total: number } {
  return {
    porOrgao: qtd4(registrada * LIMITE_ADESAO_POR_ORGAO),
    total: qtd4(registrada * LIMITE_ADESOES_TOTAL),
  };
}

export interface QuantidadesDoItem {
  readonly registrada: number | null;
  /** Já ocupado pelo mesmo órgão (este estabelecimento) no mesmo item, sem a adesão em exame. */
  readonly jaDoOrgao: number;
  /** Já ocupado por todos os órgãos no item, sem a adesão em exame. */
  readonly jaTotal: number;
}

function conferirLimites(
  tipo: TipoAdesao,
  quantidade: number,
  q: QuantidadesDoItem,
  campo: string,
): RecusaSuprimentos[] {
  if (q.registrada === null || !(q.registrada > 0))
    return [
      recusa('adesao-sem-registrada', 'Informe a quantidade registrada do item na ata.', [
        'quantidadeRegistrada',
      ]),
    ];
  const r: RecusaSuprimentos[] = [];
  if (tipo === 'participante') {
    const saldo = qtd4(q.registrada - q.jaDoOrgao);
    if (qtd4(quantidade) > saldo)
      r.push(
        recusa(
          'adesao-acima-do-registrado',
          `O participante pede ${qtd4(quantidade)} e o saldo registrado é ${saldo}.`,
          [campo],
        ),
      );
    return r;
  }
  const lim = limitesAdesao(q.registrada);
  const doOrgao = qtd4(q.jaDoOrgao + quantidade);
  if (doOrgao > lim.porOrgao)
    r.push(
      recusa(
        'adesao-acima-do-limite-do-orgao',
        `As adesões deste órgão ao item somariam ${doOrgao}, acima de 50% do registrado (${lim.porOrgao}; Lei 14.133, art. 86, § 4º).`,
        [campo],
      ),
    );
  const total = qtd4(q.jaTotal + quantidade);
  if (total > lim.total)
    r.push(
      recusa(
        'adesao-acima-do-limite-total',
        `As adesões ao item somariam ${total}, acima do dobro do registrado (${lim.total}; Lei 14.133, art. 86, § 5º).`,
        [campo],
      ),
    );
  return r;
}

export interface AdesaoParaConferir {
  readonly numero: string;
  readonly tipo: TipoAdesao;
  readonly hoje: string;
  readonly dataSolicitacao: string;
  readonly quantidadeSolicitada: number;
  readonly valorUnitario: number;
  readonly justificativa: string | null;
  /** A ata do próprio cliente (relida), ou null para ata de outro órgão. */
  readonly ataPropria: {
    readonly situacao: string;
    readonly vigenciaInicio: string;
    readonly vigenciaFim: string;
    readonly valorRegistrado: number;
  } | null;
  readonly orgaoGerenciador: string | null;
  readonly quantidades: QuantidadesDoItem;
}

/** As recusas da solicitação de adesão (vazio: pode solicitar). */
export function conferirAdesao(a: AdesaoParaConferir): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!a.numero.trim()) r.push(recusa('adesao-sem-numero', 'Informe o número da adesão.', ['numero']));
  if (a.dataSolicitacao > a.hoje)
    r.push(recusa('adesao-data-futura', 'A data da solicitação não pode ser futura.', ['dataSolicitacao']));
  if (!(a.quantidadeSolicitada > 0))
    r.push(
      recusa('adesao-quantidade-invalida', 'A quantidade solicitada deve ser maior que zero.', [
        'quantidadeSolicitada',
      ]),
    );
  if (a.ataPropria) {
    if (a.ataPropria.situacao !== 'vigente')
      r.push(recusa('ata-nao-vigente', 'A ata não está vigente.', ['ata']));
    else if (a.dataSolicitacao < a.ataPropria.vigenciaInicio || a.dataSolicitacao > a.ataPropria.vigenciaFim)
      r.push(recusa('adesao-fora-da-vigencia', 'A solicitação está fora da vigência da ata.', ['dataSolicitacao']));
    if (a.valorUnitario > a.ataPropria.valorRegistrado)
      r.push(
        recusa(
          'adesao-preco-acima-do-registrado',
          `O preço (${a.valorUnitario}) passa do registrado na ata (${a.ataPropria.valorRegistrado}).`,
          ['valorUnitario'],
        ),
      );
  } else if (!a.orgaoGerenciador?.trim())
    r.push(
      recusa('adesao-sem-gerenciador', 'Informe o órgão gerenciador da ata de outro órgão.', [
        'orgaoGerenciador',
      ]),
    );
  if (a.tipo === 'carona' && (a.justificativa ?? '').trim().length < 20)
    r.push(
      recusa(
        'adesao-sem-justificativa',
        'Justifique a vantagem da adesão (ao menos 20 letras; Lei 14.133, art. 86, § 2º, I).',
        ['justificativa'],
      ),
    );
  if (a.quantidadeSolicitada > 0)
    r.push(...conferirLimites(a.tipo, a.quantidadeSolicitada, a.quantidades, 'quantidadeSolicitada'));
  return r;
}

export interface DecisaoAdesaoParaConferir {
  readonly situacao: string;
  readonly tipo: TipoAdesao;
  readonly decisao: 'autorizar' | 'negar';
  readonly quantidadeSolicitada: number;
  readonly quantidadeAderida: number | null;
  readonly numeroOficio: string | null;
  readonly aceiteGerenciador: boolean;
  readonly aceiteFornecedor: boolean;
  readonly documentacaoConferida: boolean;
  readonly motivo: string | null;
  readonly quantidades: QuantidadesDoItem;
}

/** As recusas da decisão da adesão (autorizar ou negar). */
export function conferirDecisaoAdesao(d: DecisaoAdesaoParaConferir): RecusaSuprimentos[] {
  if (d.situacao !== 'solicitada' && d.situacao !== 'em_analise')
    return [recusa('adesao-ja-decidida', `A adesão está ${d.situacao}: só a solicitada ou em análise é decidida.`)];
  if (d.decisao === 'negar')
    return (d.motivo ?? '').trim().length < 10
      ? [recusa('adesao-sem-motivo', 'Descreva o motivo da negação (ao menos 10 letras).', ['motivo'])]
      : [];
  const r: RecusaSuprimentos[] = [];
  if (!d.aceiteGerenciador || !(d.numeroOficio ?? '').trim())
    r.push(
      recusa(
        'adesao-sem-aceite-gerenciador',
        'A autorização exige o aceite do órgão gerenciador, com o número do ofício (Lei 14.133, art. 86, § 2º, III).',
        ['numeroOficio'],
      ),
    );
  if (!d.aceiteFornecedor)
    r.push(
      recusa(
        'adesao-sem-aceite-fornecedor',
        'A autorização exige o aceite do fornecedor (Lei 14.133, art. 86, § 2º, III).',
        ['aceiteFornecedor'],
      ),
    );
  if (!d.documentacaoConferida)
    r.push(
      recusa('adesao-documentacao-pendente', 'Confira a documentação antes de autorizar.', [
        'documentacaoConferida',
      ]),
    );
  const q = d.quantidadeAderida;
  if (q === null || !(q > 0) || qtd4(q) > qtd4(d.quantidadeSolicitada))
    r.push(
      recusa(
        'adesao-aderida-invalida',
        'A quantidade aderida deve ser maior que zero e não passar da solicitada.',
        ['quantidadeAderida'],
      ),
    );
  else r.push(...conferirLimites(d.tipo, q, d.quantidades, 'quantidadeAderida'));
  return r;
}
