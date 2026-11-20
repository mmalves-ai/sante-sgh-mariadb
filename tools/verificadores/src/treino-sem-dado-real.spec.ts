// M37, regra 5: o verificador do treino procura CPF, CNS e telefone válidos fora da lista sintética e falha se achar.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  arquivosDoTreino,
  cnsValido,
  cpfValido,
  lerSinteticos,
  procurarDadoReal,
  telefoneValido,
} from './treino-sem-dado-real.ts';

// Valores GERADOS para o teste (dígitos válidos por construção; nenhum é de pessoa conhecida).
function cpfGerado(base9: string): string {
  const dv = (b: string) => {
    let s = 0;
    for (let i = 0; i < b.length; i++) s += Number(b[i]) * (b.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base9);
  return `${base9}${d1}${dv(`${base9}${d1}`)}`;
}
function cnsGerado(prefixo11: string): string {
  // Provisório (começa com 7, 8 ou 9): completa os 4 últimos dígitos até a soma ponderada ser múltipla de 11.
  for (let n = 0; n < 10_000; n++) {
    const c = `${prefixo11}${String(n).padStart(4, '0')}`;
    if (cnsValido(c)) return c;
  }
  throw new Error('sem CNS');
}

const tmp = mkdtempSync(join(tmpdir(), 'sgh-treino-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const raiz = resolve(import.meta.dirname, '../../..');

describe('treino sem dado real (regra 5)', () => {
  const cpf = cpfGerado('987654321');
  const cns = cnsGerado('89876543210');

  it('valida CPF, CNS e telefone pelos dígitos e pelo formato', () => {
    expect(cpfValido(cpf)).toBe(true);
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido(`${cpf.slice(0, 10)}${(Number(cpf[10]) + 1) % 10}`)).toBe(false);
    expect(cnsValido(cns)).toBe(true);
    expect(cnsValido('111111111111111')).toBe(false);
    expect(cnsValido('312345678901234')).toBe(false);
    expect(telefoneValido('(51) 99876-1234')).toBe(true);
    expect(telefoneValido('+55 51 3222-1234')).toBe(true);
    expect(telefoneValido('(00) 99876-1234')).toBe(false);
    expect(telefoneValido('(51) 19876-1234')).toBe(false);
    expect(telefoneValido('(51) 99999-9999')).toBe(false);
    expect(telefoneValido('123')).toBe(false);
  });

  it('acha os válidos, ignora os inválidos e a lista sintética; nunca devolve o valor', () => {
    const texto = [
      `paciente com documento ${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`,
      `cartão ${cns}`,
      'contato (51) 99876-1234',
      'número qualquer 12345678901 e 000.000.000-00',
    ].join('\n');
    const a = procurarDadoReal(texto, 'x.txt');
    expect(a).toEqual([
      { arquivo: 'x.txt', linha: 1, tipo: 'CPF' },
      { arquivo: 'x.txt', linha: 2, tipo: 'CNS' },
      { arquivo: 'x.txt', linha: 3, tipo: 'telefone' },
    ]);
    expect(JSON.stringify(a)).not.toContain(cpf);
    const lista = join(tmp, 'sinteticos.txt');
    writeFileSync(lista, `# comentário\n${cpf}\n${cns} # cartão da turma\n51998761234\n`);
    expect(procurarDadoReal(texto, 'x.txt', lerSinteticos(lista))).toEqual([]);
    expect(lerSinteticos(join(tmp, 'nao-existe.txt')).size).toBe(0);
  });

  it('a massa e o material do treino versionados não têm dado real (0 achado)', () => {
    const arquivos = arquivosDoTreino(raiz);
    expect(arquivos.length).toBeGreaterThan(20);
    const sinteticos = lerSinteticos(resolve(raiz, 'tools/verificadores/dados/treino-sinteticos.txt'));
    const achados = arquivos.flatMap((f) =>
      procurarDadoReal(require_texto(f), f.slice(raiz.length + 1), sinteticos),
    );
    expect(achados).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
function require_texto(f: string): string {
  return readFileSync(f, 'utf8');
}
