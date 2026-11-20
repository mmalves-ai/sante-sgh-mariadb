// Pontuação do par entre estabelecimentos (M57, regra 3; cap-07 §7.7; sante-api test/fonetica.test.js): nome, nome da
// mãe e nascimento entram na pontuação e SÓ SUGEREM; a fonética nunca vincula sozinha (o vínculo automático exige CPF ou
// CNS iguais; automatico.ts). O CNS quase não existe nos cadastros (8 de 47.063 no pc) e pesa pouco.
// Pesos (teto 100):
//   - CPF válido igual: 40; CNS válido igual: 15;
//   - nome igual (normalizado): 25; senão todas as chaves fonéticas iguais: 18; senão primeira e última: 10;
//   - mãe igual: 15; senão fonética igual: 10;
//   - nascimento igual: 20;
//   - sexo igual: 5.
// Divergências (descontam e barram o automático): CPFs válidos diferentes (-40), nascimentos diferentes (-15), sexos
// diferentes (-10) e nomes sem nenhuma chave fonética em comum (registrada, sem desconto: o nome muda no casamento).
import type { CriterioPareamentoRede, DivergenciaPareamentoRede } from '@sgh/contratos';
import type { CadastroComparavelRede } from './cadastro.js';

export const PESOS_PAREAMENTO = {
  cpf: 40,
  cns: 15,
  nome: 25,
  nomeFoneticoTodas: 18,
  nomeFoneticoPontas: 10,
  mae: 15,
  maeFonetica: 10,
  nascimento: 20,
  sexo: 5,
} as const;

export const DESCONTOS_PAREAMENTO = {
  cpfDiferente: 40,
  nascimentoDiferente: 15,
  sexoDiferente: 10,
} as const;

export interface PontuacaoPar {
  readonly pontuacao: number;
  readonly criterios: readonly CriterioPareamentoRede[];
  readonly divergencias: readonly DivergenciaPareamentoRede[];
}

function mesmaFonetica(a: readonly string[], b: readonly string[]): 'todas' | 'pontas' | null {
  if (a.length === 0 || b.length === 0) return null;
  if (a.length === b.length && a.every((k, i) => k === b[i])) return 'todas';
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1] ? 'pontas' : null;
}

function algumaEmComum(a: readonly string[], b: readonly string[]): boolean {
  const s = new Set(a);
  return b.some((k) => s.has(k));
}

export function pontuarPar(a: CadastroComparavelRede, b: CadastroComparavelRede): PontuacaoPar {
  const criterios: CriterioPareamentoRede[] = [];
  const divergencias: DivergenciaPareamentoRede[] = [];
  let p = 0;
  if (a.cpf && b.cpf) {
    if (a.cpf === b.cpf) {
      p += PESOS_PAREAMENTO.cpf;
      criterios.push('cpf');
    } else {
      p -= DESCONTOS_PAREAMENTO.cpfDiferente;
      divergencias.push('cpf_diferente');
    }
  }
  if (a.cns && b.cns && a.cns === b.cns) {
    p += PESOS_PAREAMENTO.cns;
    criterios.push('cns');
  }
  if (a.nome && b.nome && a.nome === b.nome) {
    p += PESOS_PAREAMENTO.nome;
    criterios.push('nome');
  } else {
    const f = mesmaFonetica(a.nomeFonetico, b.nomeFonetico);
    if (f) {
      p += f === 'todas' ? PESOS_PAREAMENTO.nomeFoneticoTodas : PESOS_PAREAMENTO.nomeFoneticoPontas;
      criterios.push('nome_fonetico');
    } else if (
      a.nomeFonetico.length > 0 &&
      b.nomeFonetico.length > 0 &&
      !algumaEmComum(a.nomeFonetico, b.nomeFonetico)
    )
      divergencias.push('nome_diferente');
  }
  if (a.mae && b.mae && a.mae === b.mae) {
    p += PESOS_PAREAMENTO.mae;
    criterios.push('mae');
  } else if (mesmaFonetica(a.maeFonetica, b.maeFonetica) === 'todas') {
    p += PESOS_PAREAMENTO.maeFonetica;
    criterios.push('mae_fonetica');
  }
  if (a.nascimento && b.nascimento) {
    if (a.nascimento === b.nascimento) {
      p += PESOS_PAREAMENTO.nascimento;
      criterios.push('nascimento');
    } else {
      p -= DESCONTOS_PAREAMENTO.nascimentoDiferente;
      divergencias.push('nascimento_diferente');
    }
  }
  if (a.sexo && b.sexo) {
    if (a.sexo === b.sexo) {
      p += PESOS_PAREAMENTO.sexo;
      criterios.push('sexo');
    } else {
      p -= DESCONTOS_PAREAMENTO.sexoDiferente;
      divergencias.push('sexo_diferente');
    }
  }
  return { pontuacao: Math.max(0, Math.min(100, p)), criterios, divergencias };
}
