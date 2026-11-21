// O login é a chave (ficha do M10, regra 2; cap-08 §8.9; ref 01 §4.3): o login é único, texto exato de até
// 31 caracteres, sensível a maiúsculas ("hal-ai" é outro usuário que "HALAI"), referenciado por FK RESTRICT em
// centenas de tabelas. As colunas USUARIO* do legado recebem o login de quem OPERA (a sessão), nunca o da
// conexão com o banco. O novo nunca normaliza o login digitado: confere e recusa.

/** Tamanho máximo do login (31 caracteres). */
export const TAMANHO_LOGIN = 31;

export type FalhaLogin = 'vazio' | 'longo' | 'espacos-nas-pontas' | 'espaco-interno' | 'caractere-invalido';

/** Caracteres aceitos num login novo: letras sem acento, números e . _ - @ (os do legado medidos no pc). */
const CARACTERE_LOGIN = /^[A-Za-z0-9._@-]+$/;

/** Confere um login NOVO (criação de usuário): nenhuma correção automática, só a recusa com o motivo. */
export function conferirLoginNovo(login: string): FalhaLogin | null {
  if (login.length === 0) return 'vazio';
  if (login.length > TAMANHO_LOGIN) return 'longo';
  if (login.trim() !== login) return 'espacos-nas-pontas';
  if (/\s/.test(login)) return 'espaco-interno';
  if (!CARACTERE_LOGIN.test(login)) return 'caractere-invalido';
  return null;
}

/** Mensagem de produto para a falha (sem citar o sistema antigo). */
export function mensagemFalhaLogin(f: FalhaLogin): string {
  switch (f) {
    case 'vazio':
      return 'Informe o login.';
    case 'longo':
      return `O login tem no máximo ${TAMANHO_LOGIN} caracteres.`;
    case 'espacos-nas-pontas':
      return 'O login não pode começar nem terminar com espaço.';
    case 'espaco-interno':
      return 'O login não pode ter espaço.';
    case 'caractere-invalido':
      return 'Use só letras sem acento, números e os sinais . _ - @ no login.';
  }
}

/** Comparação de login: exata e sensível a maiúsculas (a do banco, byte a byte). */
export function mesmoLogin(a: string | null | undefined, b: string | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && a === b;
}

/**
 * Logins que diferem só em maiúsculas de um existente: o legado aceita (são outros usuários), mas a tela avisa,
 * para ninguém criar "joao" achando que é "JOAO".
 */
export function parecidosNaCaixa(login: string, existentes: readonly string[]): string[] {
  const alvo = login.toUpperCase();
  return existentes.filter((e) => e !== login && e.toUpperCase() === alvo);
}

/** Valor das colunas USUARIO* de uma gravação: sempre o login da sessão (quem opera). */
export function usuarioDaGravacao(sessao: { readonly login: string }): string {
  if (!sessao.login) throw new Error('Gravação sem o login de quem opera.');
  return sessao.login;
}
