// A chave de cifra do CPF (gestão de pessoas, ponto e folha) vem do cofre do ambiente: `PESSOAS_CHAVE_CPF` ou, na falta
// dela, a chave mestra da plataforma (`PLATAFORMA_CHAVE_MESTRA`), 32 bytes em 64 caracteres hexadecimais ou em base64.
// Melhoria: sem a chave (ou com a chave inválida), o módulo não cai inteiro para portas indisponíveis (503 genérico em
// tudo); as portas próprias sobem com uma cifra que recusa só o que lê ou grava o CPF, com o erro dizendo exatamente o
// que falta (qual variável, em que formato). O que não toca o CPF segue funcionando.
// Melhoria: a variável vazia não esconde a outra (antes, `PESSOAS_CHAVE_CPF=` vazia fazia ignorar a chave mestra).
// O valor da chave nunca vai para mensagem, log nem trilha: só o NOME da variável.
import { ErroOperacao } from '@sgh/nucleo';
import type { CifraDoCpf } from './banco-apoio.js';

/** As variáveis do cofre, na ordem de preferência. */
export const VARIAVEIS_CHAVE_CPF = ['PESSOAS_CHAVE_CPF', 'PLATAFORMA_CHAVE_MESTRA'] as const;

const FORMATO = '32 bytes, em 64 caracteres hexadecimais ou em base64';

export interface DiagnosticoChaveCpf {
  /** A chave de 32 bytes; null quando falta ou é inválida. */
  readonly chave: Buffer | null;
  /** A variável de onde a chave veio (ou a que está inválida); null quando nenhuma foi informada. */
  readonly variavel: (typeof VARIAVEIS_CHAVE_CPF)[number] | null;
  /** O que falta, em texto para o administrador; null com a chave válida. */
  readonly falta: string | null;
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64_URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** Decodifica a chave: hexadecimal de 64 ou base64 (padrão ou url) de 32 bytes; o resto é inválido. */
function decodificar(bruto: string): Buffer | null {
  if (/^[0-9a-f]{64}$/i.test(bruto)) return Buffer.from(bruto, 'hex');
  const b = BASE64.test(bruto)
    ? Buffer.from(bruto, 'base64')
    : BASE64_URL.test(bruto)
      ? Buffer.from(bruto, 'base64url')
      : null;
  return b && b.length === 32 ? b : null;
}

/** O diagnóstico da chave do CPF no ambiente (só nomes de variável no texto, nunca o valor). */
export function diagnosticoChaveCpf(env: NodeJS.ProcessEnv): DiagnosticoChaveCpf {
  for (const variavel of VARIAVEIS_CHAVE_CPF) {
    const bruto = (env[variavel] ?? '').trim();
    if (!bruto) continue;
    const chave = decodificar(bruto);
    return chave
      ? { chave, variavel, falta: null }
      : {
          chave: null,
          variavel,
          falta: `A chave de cifra do CPF em ${variavel} é inválida: precisa ter ${FORMATO}. Corrija o valor no cofre do ambiente e reinicie a API.`,
        };
  }
  return {
    chave: null,
    variavel: null,
    falta: `Falta a chave de cifra do CPF no cofre do ambiente: configure ${VARIAVEIS_CHAVE_CPF[0]} (ou, na falta dela, ${VARIAVEIS_CHAVE_CPF[1]}) com ${FORMATO} e reinicie a API.`,
  };
}

/** O erro de quem precisa do CPF sem a chave: 503 com o que falta. */
export function erroChaveCpfAusente(falta: string): ErroOperacao {
  return new ErroOperacao(503, 'chave-cpf-ausente', 'Cifra do CPF indisponível', falta);
}

/**
 * A cifra das portas próprias sem a chave: toda chamada recusa com `chave-cpf-ausente` (e o que falta). A porta sobe;
 * só o que lê ou grava o CPF recusa, nunca com valor vazio nem CPF em claro.
 */
export function cifraCpfAusente(falta: string): CifraDoCpf {
  const recusar = (): never => {
    throw erroChaveCpfAusente(falta);
  };
  return { hmac: recusar, cifrar: recusar, decifrar: recusar };
}

/** A cifra para as portas próprias: a entregue ao módulo ou, sem ela, a que recusa dizendo o que falta no ambiente. */
export function cifraDasPortas(cifra: CifraDoCpf | null, env: NodeJS.ProcessEnv): CifraDoCpf {
  if (cifra) return cifra;
  return cifraCpfAusente(
    diagnosticoChaveCpf(env).falta ??
      'A cifra do CPF não foi entregue ao módulo de gestão de pessoas (configuração de teste sem cifra).',
  );
}
