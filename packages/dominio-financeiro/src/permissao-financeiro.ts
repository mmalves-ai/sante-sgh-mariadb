// F3.8, 07-FIN linha 99: permissões do financeiro por conta bancária e por tipo de lançamento. Regra pura, sem banco.
// Escopo de conta por usuário (consultar e movimentar, com vigência): quem mantém não altera o próprio escopo
// (segregação), movimentar exige consultar, a vigência não se inverte. Retirar o acesso desliga as duas marcas (a linha
// fica, com o histórico na trilha): apagar a linha devolveria ao usuário a visão de todas as contas.
// Tipo de lançamento por perfil de acesso (lista branca): quando algum perfil do usuário tem tipos liberados para a
// operação, só esses tipos passam; sem nenhuma linha para os perfis do usuário, vale o que a permissão da operação dá.
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

/** Os tipos liberados para os perfis do usuário (vazio: sem restrição por tipo para a operação). */
export function conferirTipoLancamento(
  liberados: readonly number[],
  tipo: number,
  descricao: string,
): RecusaFinanceiro | null {
  if (liberados.length === 0 || liberados.includes(tipo)) return null;
  return recusaFin(
    'tipo-lancamento-nao-liberado',
    `O seu perfil não lança "${descricao}": peça a liberação do tipo a quem mantém os parâmetros do financeiro.`,
    ['tipo'],
  );
}
