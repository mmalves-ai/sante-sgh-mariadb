// Chave Pix do credor (F3.8, 07-FIN linha 66): a chave é conferida e normalizada no domínio antes de entrar no cadastro
// do credor ou numa remessa de pagamento por Pix. Os tipos são os do arranjo Pix (CPF, CNPJ, e-mail, telefone e chave
// aleatória) e a forma gravada é a canônica: só dígitos no CPF e no CNPJ, e-mail em minúsculas, telefone com +55 e o DDD,
// chave aleatória em minúsculas com os hífens.
import { cnpjValido, cpfValido, somenteDigitos } from '@sgh/contratos';

export type TipoChavePix = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';

export type ChavePixConferida =
  | { readonly ok: true; readonly tipo: TipoChavePix; readonly chave: string }
  | { readonly ok: false; readonly mensagem: string };

const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const ALEATORIA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Confere a chave do tipo informado e devolve a forma canônica, ou a mensagem para mostrar na hora. */
export function conferirChavePix(tipo: TipoChavePix, valor: string): ChavePixConferida {
  const v = valor.trim();
  if (v.length === 0) return { ok: false, mensagem: 'Informe a chave Pix.' };
  switch (tipo) {
    case 'cpf':
      return cpfValido(v)
        ? { ok: true, tipo, chave: somenteDigitos(v) }
        : { ok: false, mensagem: 'A chave Pix não é um CPF válido.' };
    case 'cnpj':
      return cnpjValido(v)
        ? { ok: true, tipo, chave: somenteDigitos(v) }
        : { ok: false, mensagem: 'A chave Pix não é um CNPJ válido.' };
    case 'email': {
      const e = v.toLowerCase();
      return e.length <= 77 && EMAIL.test(e)
        ? { ok: true, tipo, chave: e }
        : { ok: false, mensagem: 'A chave Pix não é um e-mail válido (até 77 caracteres).' };
    }
    case 'telefone': {
      // Aceita com ou sem +55; o número nacional tem DDD (sem zero à esquerda) e 8 ou 9 dígitos (celular começa por 9).
      let d = somenteDigitos(v);
      if (v.startsWith('+')) {
        if (!d.startsWith('55'))
          return { ok: false, mensagem: 'A chave Pix de telefone tem de ser um número do Brasil (+55).' };
        d = d.slice(2);
      }
      const valido = /^[1-9][1-9](9\d{8}|[2-8]\d{7})$/.test(d);
      return valido
        ? { ok: true, tipo, chave: `+55${d}` }
        : { ok: false, mensagem: 'A chave Pix não é um telefone válido: DDD e número, com o 9 no celular.' };
    }
    case 'aleatoria': {
      const a = v.toLowerCase();
      return ALEATORIA.test(a)
        ? { ok: true, tipo, chave: a }
        : {
            ok: false,
            mensagem: 'A chave Pix aleatória tem 32 caracteres hexadecimais com os hífens (8-4-4-4-12).',
          };
    }
  }
}

/** Sugere o tipo pela forma digitada (para a tela preencher o tipo sozinha); null quando não dá para saber. */
export function tipoProvavelChavePix(valor: string): TipoChavePix | null {
  const v = valor.trim();
  if (v.includes('@')) return 'email';
  if (ALEATORIA.test(v.toLowerCase())) return 'aleatoria';
  if (v.startsWith('+')) return 'telefone';
  const d = somenteDigitos(v);
  if (d.length === 14 && cnpjValido(d)) return 'cnpj';
  if (d.length === 11 && cpfValido(d)) return 'cpf';
  if (d.length === 10 || d.length === 11) return 'telefone';
  return null;
}
