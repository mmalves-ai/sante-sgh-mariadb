// Regras de tela do M59-F2 (puras, testadas sem navegador): para onde ir depois do login, o texto da recusa do
// segundo fator no login e a chave do aplicativo autenticador (lida do URI otpauth, nunca guardada).
import type { Sessao } from '@sgh/contratos';

export const ROTA_SEGURANCA = '/preferencias/seguranca';

/** Depois do login: troca de senha obrigatória, depois o cadastro do segundo fator na adesão, senão o início. */
export function destinoDepoisDoLogin(sessao: Pick<Sessao, 'trocaSenha' | 'segundoFator'>): string {
  if (sessao.trocaSenha) return '/senha';
  const f = sessao.segundoFator;
  if (f && f.disponivel && !f.cadastrado && f.exigencia === 'adesao') return `${ROTA_SEGURANCA}?adesao=1`;
  return '/inicio';
}

/** A recusa do login por causa do segundo fator (extensão `codigo` do Problem Details) → chave do texto. */
export function textoRecusaSegundoFator(codigo: string | null): string | null {
  switch (codigo) {
    case 'segundo-fator-codigo':
      return 'entrar.segundoFatorPedido';
    case 'segundo-fator-invalido':
      return 'entrar.segundoFatorInvalido';
    case 'segundo-fator-cadastro':
      return 'entrar.segundoFatorCadastro';
    case 'segundo-fator-email':
      return 'acessoEmail.codigoEnviado';
    case 'segundo-fator-email-esgotado':
      return 'acessoEmail.codigoEsgotado';
    case 'segundo-fator-sem-email':
      return 'acessoEmail.semEmail';
    case 'segundo-fator-email-envios':
      return 'acessoEmail.muitosEnvios';
    default:
      return null;
  }
}

/** A chave em base32 do URI otpauth (para digitar no aplicativo quando a câmera não lê o QR), em grupos de 4. */
export function chaveDoUri(uri: string): string {
  let segredo: string;
  try {
    segredo = new URL(uri).searchParams.get('secret') ?? '';
  } catch {
    segredo = '';
  }
  return segredo.replace(/(.{4})(?=.)/g, '$1 ');
}

/** Código de 6 dígitos (aceita espaços digitados entre os grupos). */
export function codigoLimpo(bruto: string): string {
  return bruto.replace(/\s+/g, '');
}

export const codigoValido = (bruto: string): boolean => /^\d{6}$/.test(codigoLimpo(bruto));

/** Perfis do Sante SGH que o catálogo de permissões conhece (para o combo da política), em ordem alfabética. */
export function perfisDoCatalogo(
  catalogo: readonly { readonly perfis?: readonly string[] }[],
  complementares: readonly string[] = [],
): string[] {
  const todos = new Set<string>(complementares);
  for (const d of catalogo) for (const p of d.perfis ?? []) todos.add(p);
  return [...todos].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Último dia da adesão (AAAA-MM-DD) de uma linha: início + prazo − 1 (o mesmo cálculo do servidor). */
export function fimDaAdesao(inicio: string, prazoAdesaoDias: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inicio);
  if (!m) return inicio;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + Math.max(0, prazoAdesaoDias - 1));
  return d.toISOString().slice(0, 10);
}

/** AAAA-MM-DD (ou ISO com hora) → dd/mm/aaaa. */
export function dataBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
