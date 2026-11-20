// Regra 17: data mart pseudonimizado. Nenhuma coluna identificadora no esquema; pseudônimo HMAC com chave;
// nascimento em faixa etária.
import { describe, expect, it } from 'vitest';
import {
  colunasIdentificadoras,
  ddlDoDataMart,
  ESQUEMA_DATAMART,
  faixaEtaria,
  pseudonimo,
  sexoDoDataMart,
} from './datamart.js';

const CHAVE = 'chave-sintetica-de-teste-0123456789';

describe('data mart sem dado pessoal', () => {
  it('o esquema não tem coluna identificadora; o verificador acusa as que teriam', () => {
    expect(colunasIdentificadoras(ESQUEMA_DATAMART)).toEqual([]);
    expect(
      colunasIdentificadoras([
        {
          nome: 't',
          colunas: {
            nome: 'texto',
            cpf: 'texto',
            data_nascimento: 'texto',
            paciente: 'inteiro',
            telefone_1: 'texto',
            texto_evolucao: 'texto',
            paciente_pseudonimo: 'texto',
          },
        },
      ]),
    ).toEqual(['t.nome', 't.cpf', 't.data_nascimento', 't.paciente', 't.telefone_1', 't.texto_evolucao']);
  });

  it('pseudônimo estável com a mesma chave, diferente por escopo e por chave; chave curta recusada', () => {
    const a = pseudonimo(CHAVE, 'paciente', 123);
    expect(a).toMatch(/^[0-9a-f]{20}$/);
    expect(pseudonimo(CHAVE, 'paciente', 123)).toBe(a);
    expect(pseudonimo(CHAVE, 'internacao', 123)).not.toBe(a);
    expect(pseudonimo(`${CHAVE}x`, 'paciente', 123)).not.toBe(a);
    expect(pseudonimo(Buffer.alloc(32, 1), 'paciente', 123)).toMatch(/^[0-9a-f]{20}$/);
    expect(() => pseudonimo('curta', 'paciente', 1)).toThrow(/curta/);
  });

  it('faixa etária e sexo', () => {
    expect([null, -1, 0, 3, 10, 20, 40, 50, 70, 90].map(faixaEtaria)).toEqual([
      'nao-informada',
      'nao-informada',
      '0',
      '1-4',
      '5-14',
      '15-29',
      '30-44',
      '45-59',
      '60-74',
      '75+',
    ]);
    expect([' m', 'F', 'X', null].map(sexoDoDataMart)).toEqual(['M', 'F', 'nao-informado', 'nao-informado']);
  });

  it('DDL de todas as tabelas', () => {
    const ddl = ddlDoDataMart();
    expect(ddl).toHaveLength(ESQUEMA_DATAMART.length);
    expect(ddl[0]).toMatch(
      /^CREATE TABLE IF NOT EXISTS fato_internacao_dia \(estabelecimento TEXT, data TEXT,/,
    );
  });
});
