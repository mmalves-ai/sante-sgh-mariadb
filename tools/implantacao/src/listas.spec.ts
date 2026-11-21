// M60, etapa 1, sobre o banco próprio: o anexo das migrações do banco do cliente gerado do repositório (todas, na
// ordem do "criar novo cliente", com o hash) e a conferência.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  anexoDeMigracoes,
  conferirAnexo,
  contarComandos,
  lerMigracoes,
  listaDeMigracoes,
  type MigracaoBanco,
} from './listas.ts';

const migracoes = lerMigracoes(resolve(import.meta.dirname, '../../..'));

describe('anexo das migrações', () => {
  it('todas as migrações do repositório: tabelas antes das chaves, pelo caminho, com o sha256 completo', () => {
    const itens = listaDeMigracoes([...migracoes].reverse());
    expect(itens).toHaveLength(migracoes.length);
    expect(itens.length).toBeGreaterThan(10);
    expect(itens[0]).toMatchObject({
      ordem: 1,
      arquivo: '00_NUCLEO/00_nucleo_tabelas.sql',
      etapa: 'tabelas',
    });
    const primeiraChave = itens.findIndex((i) => i.etapa === 'chaves');
    expect(primeiraChave).toBeGreaterThan(0);
    expect(itens.slice(primeiraChave).every((i) => i.etapa === 'chaves')).toBe(true);
    const tabelas = itens.slice(0, primeiraChave).map((i) => i.arquivo);
    expect(tabelas).toEqual([...tabelas].sort());
    expect(itens.map((i) => i.ordem)).toEqual(itens.map((_, k) => k + 1));
    expect(itens.every((i) => /^[0-9a-f]{64}$/.test(i.sha256))).toBe(true);
    // Arquivo de chaves pode vir vazio (o módulo sem chave estrangeira nova); o de tabelas, nunca.
    expect(itens.filter((i) => i.etapa === 'tabelas' && i.comandos === 0)).toEqual([]);
    const md = anexoDeMigracoes(itens);
    expect(md).toContain('criar novo cliente');
    expect(conferirAnexo(md, itens)).toEqual({ faltam: [], hashDivergente: [] });
  });

  it('conferência aponta migração faltando e hash velho', () => {
    const m = (arquivo: string, hash: string): MigracaoBanco => ({
      arquivo,
      etapa: 'tabelas',
      hash,
      comandos: 1,
    });
    const itens = listaDeMigracoes([
      m('01_A/01_tabelas.sql', 'a'.repeat(64)),
      m('02_B/01_tabelas.sql', 'b'.repeat(64)),
      m('03_C/01_tabelas.sql', 'c'.repeat(64)),
    ]);
    const md = anexoDeMigracoes(itens.slice(0, 2)).replace('b'.repeat(64), 'velho');
    expect(conferirAnexo(md, itens)).toEqual({
      faltam: ['03_C/01_tabelas.sql'],
      hashDivergente: ['02_B/01_tabelas.sql'],
    });
  });

  it('conta os comandos sem os comentários', () => {
    expect(
      contarComandos(
        '-- cabeçalho; com ponto e vírgula\nCREATE TABLE a (x INT);\nALTER TABLE a\n  ADD y INT;\n',
      ),
    ).toBe(2);
  });
});
