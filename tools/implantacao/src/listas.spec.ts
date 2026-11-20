// M60, etapa 1: anexo dos scripts SGH_ gerado do repositório (todos, na ordem, com o hash) e a conferência.
import { resolve } from 'node:path';
import { lerScriptsSgh, ordemDeAplicacao } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import { anexoDeScripts, conferirAnexo, listaDeScripts } from './listas.ts';

const scripts = lerScriptsSgh(resolve(import.meta.dirname, '../../../packages/legado/src'));

describe('anexo de scripts', () => {
  it('todos os scripts do repositório, na ordem de aplicação (a de dependência), com o sha256 completo', () => {
    const itens = listaDeScripts([...scripts].reverse());
    expect(itens).toHaveLength(scripts.length);
    expect(itens[0]).toMatchObject({
      ordem: 1,
      numero: '0001',
      arquivo: 'config/sgh/0001_versao_script.sql',
    });
    const esperada = ordemDeAplicacao([...scripts].sort((a, b) => a.numero - b.numero));
    expect(itens.map((i) => i.arquivo)).toEqual(esperada.map((s) => s.arquivo));
    expect(itens.map((i) => i.ordem)).toEqual(itens.map((_, k) => k + 1));
    const md = anexoDeScripts(itens);
    expect(md).toContain('na ordem em que `sgh:aplicar` os aplica');
    expect(md).not.toContain('pela ordem do número');
    expect(conferirAnexo(md, itens)).toEqual({ faltam: [], hashDivergente: [] });
  });

  it('conferência aponta script faltando e hash velho', () => {
    const itens = listaDeScripts(scripts.slice(0, 3));
    const md = anexoDeScripts(itens.slice(0, 2)).replace(itens[1]?.sha256 ?? '', 'velho');
    expect(conferirAnexo(md, itens)).toEqual({
      faltam: [itens[2]?.arquivo],
      hashDivergente: [itens[1]?.arquivo],
    });
  });
});
