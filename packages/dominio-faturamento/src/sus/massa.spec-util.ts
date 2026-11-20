// Massa SINTÉTICA dos testes do faturamento SUS (nenhum dado de pessoa): documentos gerados pelo algoritmo, CIDs e
// códigos SIGTAP de forma válida, convênios e contas inventados.
import type { AtendimentoCiha, ContextoCiha } from './ciha.js';
import type { AtributosSigtap, ProcedimentoSigtap } from './sigtap-competencia.js';

/** CPF sintético válido a partir de 9 dígitos base. */
export function cpfSintetico(base9: string): string {
  const dv = (b: string) => {
    let s = 0;
    for (let i = 0; i < b.length; i++) s += Number(b[i]) * (b.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base9);
  return `${base9}${d1}${dv(`${base9}${d1}`)}`;
}

/** CNS provisório sintético (começa em 7; soma ponderada de 15 a 1 múltipla de 11). */
export function cnsSintetico(semente: number): string {
  for (let k = 0; k < 1000; k++) {
    const corpo = `7${String(semente * 1000 + k).padStart(14, '0')}`;
    let s = 0;
    for (let i = 0; i < 15; i++) s += Number(corpo[i]) * (15 - i);
    if (s % 11 === 0) return corpo;
  }
  throw new Error('sem CNS');
}

/** Validador de CNS dos testes (o mesmo algoritmo do provisório do M11; o definitivo não é usado na massa). */
export function cnsValidoTeste(cns: string): boolean {
  if (!/^[789]\d{14}$/.test(cns)) return false;
  let s = 0;
  for (let i = 0; i < 15; i++) s += Number(cns[i]) * (15 - i);
  return s % 11 === 0;
}

export const ATRIBUTOS_LIVRES: AtributosSigtap = {
  idadeMinimaMeses: null,
  idadeMaximaMeses: null,
  sexo: 'ambos',
  quantidadeMaxima: null,
  permanencia: null,
  complexidade: 'MC',
};

export function procedimento(
  id: number,
  codigo: string,
  extra: Partial<ProcedimentoSigtap> = {},
): ProcedimentoSigtap {
  return { id, codigo, competenciaInicial: 200801, competenciaFinal: 0, atuais: ATRIBUTOS_LIVRES, ...extra };
}

/** Catálogo sintético: 101 consulta (livre), 102 parto (só F, 10 a 60 anos), 103 encerrado em 202412. */
export const CATALOGO: ReadonlyMap<number, ProcedimentoSigtap> = new Map([
  [101, procedimento(101, '0301010072')],
  [
    102,
    procedimento(102, '0310010039', {
      atuais: {
        ...ATRIBUTOS_LIVRES,
        sexo: 'F',
        idadeMinimaMeses: 120,
        idadeMaximaMeses: 720,
        quantidadeMaxima: 1,
      },
    }),
  ],
  [103, procedimento(103, '0211020036', { competenciaFinal: 202412 })],
]);

export function contexto(extra: Partial<ContextoCiha> = {}): ContextoCiha {
  return {
    competencia: '202509',
    cnes: '9999991',
    fontePorConvenio: (c) => (c === 10 ? 'particular-pf' : c === 99 ? null : 'plano-privado'),
    procedimento: (id) => {
      const p = CATALOGO.get(id);
      if (!p) return null;
      const vigente = p.competenciaFinal === 0 || Number('202509') <= p.competenciaFinal;
      return { procedimento: p, naCompetencia: vigente ? { fonte: 'atual', atributos: p.atuais } : null };
    },
    cnsValido: cnsValidoTeste,
    ...extra,
  };
}

let seq = 1;
export function atendimento(extra: Partial<AtendimentoCiha> = {}): AtendimentoCiha {
  const n = seq++;
  return {
    conta: 900_000 + n,
    atendimento: 800_000 + n,
    modalidade: 'ambulatorial',
    convenio: 20,
    paciente: {
      cns: null,
      cpf: cpfSintetico(String(100_000_000 + n)),
      sexo: 'F',
      nascimento: '1990-05-10',
      municipio: 330100,
      nome: `PACIENTE SINTETICO ${n}`,
      logradouro: 'RUA DO TESTE',
      numero: '10',
      complemento: null,
      uf: 'RJ',
      cep: '25600000',
      prontuario: 500_000 + n,
    },
    motivoAlta: extra.modalidade === 'internacao' ? 12 : null,
    beneficiario: 'CARTEIRA-SINT-1',
    guiaTiss: 'GUIA-SINT-1',
    operadora: { regAns: 123456, cnpj: null },
    entrada: '2025-09-10',
    saida: '2025-09-10',
    cidPrincipal: 'I10',
    cidSecundario: null,
    itens: [{ item: 700_000 + n, sigtap: 101, quantidade: 1 }],
    ...extra,
  };
}
