// F3.8, 07-FIN linha 99: permissões do financeiro por conta bancária e por tipo de lançamento. Regra pura, sem banco.
// Escopo de conta por usuário (consultar e movimentar, com vigência): quem mantém não altera o próprio escopo
// (segregação), movimentar exige consultar, a vigência não se inverte. Retirar o acesso desliga as duas marcas (a linha
// fica, com o histórico na trilha): apagar a linha devolveria ao usuário a visão de todas as contas.
// Tipo de lançamento por perfil de acesso (lista branca, por estabelecimento): o perfil marcado como restrito na operação
// só lança os tipos da sua lista (vazia: nenhum); o perfil livre segue a permissão da operação. Os perfis acumulam: um
// perfil restrito a mais nunca tira o que um perfil livre que dá a operação já dava.
// A mesma lista vale em cada operação que tem tipo: o movimento bancário (tipo de lançamento), o título a pagar e o
// adiantamento (tipo de credor). Cada operação tem a sua marca de restrito e a sua lista: restringir o perfil no
// movimento não o restringe no título a pagar.
import { type RecusaFinanceiro, recusaFin } from '@sgh/contratos/regras-financeiro';

export interface PedidoEscopoConta {
  readonly usuario: number;
  readonly quemMantem: number;
  readonly consultar: boolean;
  readonly movimentar: boolean;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
}

export function conferirEscopoConta(p: PedidoEscopoConta): RecusaFinanceiro | null {
  if (p.usuario === p.quemMantem)
    return recusaFin(
      'escopo-proprio',
      'Ninguém altera o próprio escopo de contas: peça a outro responsável.',
      ['usuario'],
    );
  if (p.movimentar && !p.consultar)
    return recusaFin('escopo-movimentar-sem-consultar', 'Quem movimenta a conta precisa consultá-la.', [
      'consultar',
    ]);
  if (p.vigenciaInicio && p.vigenciaFim && p.vigenciaFim < p.vigenciaInicio)
    return recusaFin('escopo-vigencia-invertida', 'O fim da vigência é anterior ao início.', ['vigenciaFim']);
  return null;
}

/** Um perfil vigente do usuário no estabelecimento, visto pela regra do tipo de lançamento de uma operação. */
export interface PerfilNoTipoLancamento {
  /** A marca explícita de restrito na operação (independe de haver tipos na lista). */
  readonly restrito: boolean;
  /** O perfil dá a permissão da operação (administrador ou ação permitida). */
  readonly concedeOperacao: boolean;
  /** Os tipos liberados ao perfil na operação (só contam quando o perfil é restrito). */
  readonly liberados: readonly number[];
}

/** O que a lista de cada operação guarda (tipo de lançamento ou tipo de credor) e a ação que dá a operação. */
export const OPERACOES_TIPO_LANCAMENTO = {
  banco: { alvo: 'lancamento', acao: 'financeiro.movimento.criar' },
  contas_pagar: { alvo: 'credor', acao: 'financeiro.tituloPagar.criar' },
  adiantamento: { alvo: 'credor', acao: 'financeiro.adiantamento.conceder' },
} as const;
export type OperacaoTipoLancamento = keyof typeof OPERACOES_TIPO_LANCAMENTO;
export const NOMES_OPERACAO_TIPO_LANCAMENTO = Object.keys(OPERACOES_TIPO_LANCAMENTO) as [
  OperacaoTipoLancamento,
  ...OperacaoTipoLancamento[],
];

const RECUSA_DA_OPERACAO: Readonly<Record<OperacaoTipoLancamento, (descricao: string) => string>> = {
  banco: (d) => `O seu perfil não lança "${d}"`,
  contas_pagar: (d) => `O seu perfil não lança título a pagar de credor do tipo "${d}"`,
  adiantamento: (d) => `O seu perfil não pede adiantamento a credor do tipo "${d}"`,
};

/**
 * O tipo passa, avaliado perfil a perfil: sem nenhum perfil restrito, vale só a permissão da operação; havendo perfil
 * restrito, passa se algum perfil livre do usuário der a operação ou se algum perfil restrito tiver o tipo liberado.
 * Perfil restrito com a lista vazia não libera nada (retirar o último tipo nunca devolve tudo).
 */
export function conferirTipoLancamento(
  perfis: readonly PerfilNoTipoLancamento[],
  tipo: number,
  descricao: string,
  operacao: OperacaoTipoLancamento = 'banco',
): RecusaFinanceiro | null {
  if (!perfis.some((p) => p.restrito)) return null;
  if (perfis.some((p) => !p.restrito && p.concedeOperacao)) return null;
  if (perfis.some((p) => p.restrito && p.liberados.includes(tipo))) return null;
  return recusaFin(
    'tipo-lancamento-nao-liberado',
    `${RECUSA_DA_OPERACAO[operacao](descricao)}: peça a liberação do tipo a quem mantém os parâmetros do financeiro.`,
    ['tipo'],
  );
}
