// Regras de tela do saneamento dos grupos (M59-F4), puras e testadas sem navegador: que ações cada decisão do plano
// oferece, a ordem dos usuários (sem decisão primeiro) e o destino pré-selecionado e a chave do texto de cada recusa
// do servidor (extensão `codigo` do Problem Details); o que não for recusa conhecida vai à MensagemErro.
import { type ItemSaneamento, RECUSAS_SANEAMENTO, type UsuarioSaneamento } from '@sgh/contratos';

/** Códigos que o serviço do saneamento devolve além das recusas das regras puras. */
const OUTROS_CODIGOS = [
  'usuario-inexistente',
  'item-inexistente',
  'alterado',
  'operacao-desligada',
  'indisponivel',
] as const;

/** Recusa conhecida → chave do texto (`saneamento.recusas.<codigo>`); null para os demais erros. */
export function chaveRecusaSaneamento(codigo: string | null): string | null {
  return codigo &&
    ((RECUSAS_SANEAMENTO as readonly string[]).includes(codigo) ||
      (OUTROS_CODIGOS as readonly string[]).includes(codigo))
    ? `saneamento.recusas.${codigo}`
    : null;
}

export type AcaoSaneamento = 'decidir' | 'aprovar' | 'aplicar' | 'descartar';

/**
 * Ações de um usuário pelo item vivo do plano. Sem permissão de sanear, nenhuma. Sem item (ou com o item descartado
 * ou não aplicado), decidir, também para o inativo ou bloqueado (que sai do grupo amplo pela troca de grupo). Com o
 * bloqueio aplicado, o usuário continua no grupo: decidir de novo (a troca de grupo). Proposto: aprovar (se perde
 * opção usada) ou aplicar; aprovado: aplicar. Proposto e aprovado podem ser descartados ou decididos de novo.
 */
export function acoesDoUsuario(u: Pick<UsuarioSaneamento, 'item'>, podeSanear: boolean): AcaoSaneamento[] {
  if (!podeSanear) return [];
  const i = u.item;
  if (!i || i.situacao === 'aplicado' || i.situacao === 'descartado' || i.situacao === 'falhou')
    return !i || i.situacao !== 'aplicado' || i.decisao === 'bloquear' ? ['decidir'] : [];
  if (i.situacao === 'proposto')
    return i.exigeAprovacao ? ['aprovar', 'descartar', 'decidir'] : ['aplicar', 'descartar', 'decidir'];
  return ['aplicar', 'descartar'];
}

/** Ordem da lista: sem decisão primeiro, depois propostos, aprovados e o resto; dentro, pelo login. */
export function ordenarUsuarios(us: readonly UsuarioSaneamento[]): UsuarioSaneamento[] {
  const peso = (i: ItemSaneamento | null): number =>
    !i ? 0 : i.situacao === 'proposto' ? 1 : i.situacao === 'aprovado' ? 2 : i.situacao === 'falhou' ? 3 : 4;
  return [...us].sort((a, b) => peso(a.item) - peso(b.item) || a.login.localeCompare(b.login));
}

/** Destino pré-selecionado ao decidir: a sugestão pelo uso, se ela for um destino válido; senão, nenhum. */
export function destinoInicial(
  u: Pick<UsuarioSaneamento, 'sugestao'>,
  destinos: readonly { grupo: string }[],
): string {
  const s = u.sugestao?.grupo;
  return s && destinos.some((d) => d.grupo === s) ? s : '';
}
