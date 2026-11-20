// Última escolha do seletor de estabelecimento (ficha do M05 §1, ARQ-1): conveniência do navegador, só o
// CÓDIGO do estabelecimento (nenhum dado de pessoa, nenhum token). Pode faltar (janela privada, dados
// apagados): a tela funciona sem ela.
const CHAVE = 'sgh.entrar.estabelecimento';

export function lembrarEscolha(
  codigo: string,
  armazenamento: Pick<Storage, 'setItem'> | null = local(),
): void {
  try {
    armazenamento?.setItem(CHAVE, codigo);
  } catch {
    /* sem armazenamento: segue sem lembrar */
  }
}

export function ultimaEscolha(armazenamento: Pick<Storage, 'getItem'> | null = local()): string | null {
  try {
    return armazenamento?.getItem(CHAVE) ?? null;
  } catch {
    return null;
  }
}

function local(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Escolha inicial: a pedida (troca de estabelecimento), a lembrada, ou a primeira disponível. */
export function escolhaInicial(
  disponiveis: readonly { codigo: string }[],
  pedida: string | null,
  lembrada: string | null,
): string {
  for (const c of [pedida, lembrada]) if (c && disponiveis.some((e) => e.codigo === c)) return c;
  return disponiveis[0]?.codigo ?? '';
}
