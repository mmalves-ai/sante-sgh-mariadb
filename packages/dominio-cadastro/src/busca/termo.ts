// Interpretação do termo da busca única (ficha do M11, objetivo e seção 4): nome sem acento, nome da mãe,
// telefone (8 últimos dígitos), CPF, prontuário, CNS e nascimento. No modo `auto`, o termo decide: CPF válido
// de 11 dígitos; 15 dígitos, CNS; data (DD/MM/AAAA ou AAAA-MM-DD), nascimento; até 9 dígitos, prontuário;
// 10 ou mais dígitos que não são CPF, telefone; texto, nome. A busca por CPF e por prontuário vai direto ao
// cadastro (nunca depende do índice de nomes).
import { somenteDigitos, type TipoBuscaPaciente } from '@sgh/contratos';
import { cpfValido } from '../documento/cpf.js';
import { palavrasDoTermo, termoIdentifica } from './fonetica.js';

export type TermoInterpretado =
  | { readonly tipo: 'nome' | 'mae'; readonly palavras: readonly string[] }
  | { readonly tipo: 'telefone'; readonly ultimos8: string }
  | { readonly tipo: 'cpf'; readonly cpf: number }
  | { readonly tipo: 'prontuario'; readonly prontuario: number }
  | { readonly tipo: 'cns'; readonly cns: string }
  | { readonly tipo: 'nascimento'; readonly data: string };

export class ErroTermo extends Error {
  override readonly name = 'ErroTermo';
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

const DATA_BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data de calendário válida (AAAA-MM-DD) do texto, ou null. */
export function dataDoTermo(termo: string): string | null {
  const t = termo.trim();
  const br = DATA_BR.exec(t);
  const iso = DATA_ISO.exec(t);
  const [a, m, d] = br ? [br[3], br[2], br[1]] : iso ? [iso[1], iso[2], iso[3]] : [];
  if (!a || !m || !d) return null;
  const dt = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  if (
    dt.getUTCFullYear() !== Number(a) ||
    dt.getUTCMonth() !== Number(m) - 1 ||
    dt.getUTCDate() !== Number(d)
  )
    return null;
  if (Number(a) < 1900) return null;
  return `${a}-${m}-${d}`;
}

/** Só dígitos e separadores comuns de documento e telefone. */
const NUMERICO = /^[\d\s.\-/()+]+$/;

export function interpretarTermo(termo: string, tipo: TipoBuscaPaciente = 'auto'): TermoInterpretado {
  const t = termo.trim();
  const digitos = somenteDigitos(t);
  const escolhido = tipo === 'auto' ? detectar(t, digitos) : tipo;
  switch (escolhido) {
    case 'cpf':
      if (!cpfValido(digitos))
        throw new ErroTermo(
          'cpf-invalido',
          'CPF inválido: confira os dígitos (sequência repetida não é CPF).',
        );
      return { tipo: 'cpf', cpf: Number(digitos) };
    case 'prontuario':
      if (!/^\d{1,16}$/.test(digitos) || !Number.isSafeInteger(Number(digitos)) || Number(digitos) <= 0)
        throw new ErroTermo('prontuario-invalido', 'Prontuário: só números (até 16 dígitos).');
      return { tipo: 'prontuario', prontuario: Number(digitos) };
    case 'cns':
      if (!/^\d{15}$/.test(digitos)) throw new ErroTermo('cns-invalido', 'CNS: 15 dígitos.');
      return { tipo: 'cns', cns: digitos };
    case 'nascimento': {
      const d = dataDoTermo(t);
      if (!d) throw new ErroTermo('data-invalida', 'Nascimento: use DD/MM/AAAA.');
      return { tipo: 'nascimento', data: d };
    }
    case 'telefone':
      if (digitos.length < 8)
        throw new ErroTermo('telefone-invalido', 'Telefone: pelo menos os 8 últimos dígitos.');
      return { tipo: 'telefone', ultimos8: digitos.slice(-8) };
    case 'mae':
    case 'nome': {
      const palavras = palavrasDoTermo(t);
      if (!termoIdentifica(palavras))
        throw new ErroTermo(
          'termo-curto',
          'Digite ao menos uma palavra de duas letras ou mais (títulos e iniciais sozinhos não identificam ninguém).',
        );
      return { tipo: escolhido, palavras };
    }
    default:
      throw new ErroTermo('tipo-invalido', 'Tipo de busca desconhecido.');
  }
}

function detectar(t: string, digitos: string): Exclude<TipoBuscaPaciente, 'auto'> {
  if (dataDoTermo(t)) return 'nascimento';
  if (!NUMERICO.test(t)) return 'nome';
  if (digitos.length === 11 && cpfValido(digitos)) return 'cpf';
  if (digitos.length === 15) return 'cns';
  if (digitos.length <= 9) return 'prontuario';
  return 'telefone';
}
