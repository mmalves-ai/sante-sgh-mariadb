// F3.8, 07-FIN linha 99: permissões do financeiro por conta bancária e por tipo de lançamento. Regra pura, sem banco.
// Escopo de conta por usuário (consultar e movimentar, com vigência): quem mantém não altera o próprio escopo
// (segregação), movimentar exige consultar, a vigência não se inverte. Retirar o acesso desliga as duas marcas (a linha
// fica, com o histórico na trilha): apagar a linha devolveria ao usuário a visão de todas as contas.
// Tipo de lançamento por perfil de acesso (lista branca, por estabelecimento): o perfil marcado como restrito na operação
// só lança os tipos da sua lista (vazia: nenhum); o perfil livre segue a permissão da operação. Os perfis acumulam: um
// perfil restrito a mais nunca tira o que um perfil livre que dá a operação já dava.
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

/**
 * O tipo passa, avaliado perfil a perfil: sem nenhum perfil restrito, vale só a permissão da operação; havendo perfil
 * restrito, passa se algum perfil livre do usuário der a operação ou se algum perfil restrito tiver o tipo liberado.
 * Perfil restrito com a lista vazia não libera nada (retirar o último tipo nunca devolve tudo).
 */
export function conferirTipoLancamento(
  perfis: readonly PerfilNoTipoLancamento[],
  tipo: number,
  descricao: string,
): RecusaFinanceiro | null {
  if (!perfis.some((p) => p.restrito)) return null;
  if (perfis.some((p) => !p.restrito && p.concedeOperacao)) return null;
  if (perfis.some((p) => p.restrito && p.liberados.includes(tipo))) return null;
  return recusaFin(
    'tipo-lancamento-nao-liberado',
    `O seu perfil não lança "${descricao}": peça a liberação do tipo a quem mantém os parâmetros do financeiro.`,
    ['tipo'],
  );
}
