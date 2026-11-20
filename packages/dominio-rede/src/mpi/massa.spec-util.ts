// Massa sintética de pares para o MPI (M57, ficha, seção 10): gêmeos, homônimos, CPF placeholder, mãe ausente. Nomes e
// documentos INVENTADOS (CPFs gerados pelo dígito verificador a partir de bases arbitrárias; nenhum é de pessoa).
import type { CadastroRede } from './cadastro.js';

/** CPF sintético válido a partir de 9 dígitos de base. */
export function cpfSintetico(base9: string): string {
  const dv = (b: string) => {
    let s = 0;
    for (let i = 0; i < b.length; i++) s += Number(b[i]) * (b.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base9);
  const d2 = dv(`${base9}${d1}`);
  return `${base9}${d1}${d2}`;
}

export const CPF_A = cpfSintetico('123450001');
export const CPF_B = cpfSintetico('987650002');
/** CNS provisório sintético (soma ponderada múltipla de 11). */
export const CNS_A = '700000000000005';

export function cadastro(extra: Partial<CadastroRede> = {}): CadastroRede {
  return {
    estabelecimento: 'pc',
    id: 101,
    prontuario: 5001,
    nome: 'ANA TESTE FICTICIA',
    mae: 'MARIA EXEMPLO FICTICIA',
    nascimento: '1980-05-17',
    sexo: 'F',
    cpf: CPF_A,
    cns: null,
    ativo: true,
    idUnificado: 101,
    ...extra,
  };
}

/** O mesmo cadastro no outro estabelecimento. */
export function noOutro(extra: Partial<CadastroRede> = {}): CadastroRede {
  return cadastro({ estabelecimento: 'hs', id: 909, prontuario: 77001, idUnificado: 909, ...extra });
}
