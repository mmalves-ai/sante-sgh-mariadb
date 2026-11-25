// 01-ADM L115 (F8): a ligação da ferramenta de BI ao data mart é só de leitura e sem dado de pessoa. Um arquivo
// SINTÉTICO com o esquema do data mart (pseudônimos HMAC, faixa etária, nenhum nome) numa pasta descartável: a ferramenta
// de BI o abre, faz a tabela dinâmica (soma por mês e clínica) e não consegue gravar; o arquivo com uma coluna
// identificadora ou sem o registro da carga é recusado.
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ddlDoDataMart, pseudonimo, VERSAO_ESQUEMA_DATAMART } from '@sgh/dominio-relatorio/datamart';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirParaBi, conferirLigacaoBi } from '../datamart-bi.ts';

const pasta = resolve(import.meta.dirname, '../../../../.tmp/datamart-bi-spec');
const bom = resolve(pasta, 'sint.sqlite');
const ruim = resolve(pasta, 'ruim.sqlite');
const semCarga = resolve(pasta, 'sem-carga.sqlite');
const CHAVE = 'chave-sintetica-do-teste-bi-0123456789';
const NOME_SINTETICO = 'Paciente Sintético da Silva';

function criar(arquivo: string, extra: (db: DatabaseSync) => void, comCarga = true): void {
  const db = new DatabaseSync(arquivo);
  try {
    for (const c of ddlDoDataMart()) db.exec(c);
    const ins = db.prepare('INSERT INTO fato_internacao VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (let i = 1; i <= 4; i++)
      ins.run(
        'sint',
        pseudonimo(CHAVE, 'sint:internacao', i),
        pseudonimo(CHAVE, 'sint:paciente', 100 + (i % 2)),
        i <= 2 ? '2026-09' : '2026-10',
        null,
        'eletiva',
        i % 2 === 0 ? 'M' : 'C',
        'alta',
        2.5,
        2,
        0,
        '40-49',
        'F',
        '1',
      );
    if (comCarga)
      db.prepare('INSERT INTO carga VALUES (?, ?, ?, ?, ?, ?)').run(
        'sint',
        '2026-11-25T05:00:00.000Z',
        '2026-11-24',
        VERSAO_ESQUEMA_DATAMART,
        'por-estabelecimento',
        'impressao-sintetica',
      );
    extra(db);
  } finally {
    db.close();
  }
}

describe('ligação do BI ao data mart: só leitura e sem dado de pessoa (01-ADM L115)', () => {
  beforeAll(() => {
    rmSync(pasta, { recursive: true, force: true });
    mkdirSync(pasta, { recursive: true });
    criar(bom, () => {});
    criar(ruim, (db) => {
      db.exec('CREATE TABLE extra_paciente (nome_paciente TEXT, cpf TEXT)');
      db.prepare('INSERT INTO extra_paciente VALUES (?, ?)').run(NOME_SINTETICO, '00000000000');
    });
    criar(semCarga, () => {}, false);
  });

  afterAll(() => rmSync(pasta, { recursive: true, force: true }));

  it('a ferramenta de BI faz a tabela dinâmica e não consegue gravar', () => {
    const db = abrirParaBi(bom);
    try {
      const dinamica = db
        .prepare(
          'SELECT mes_entrada AS mes, clinica, COUNT(*) AS internacoes FROM fato_internacao GROUP BY mes_entrada, clinica ORDER BY 1, 2',
        )
        .all() as { mes: string; clinica: string; internacoes: number }[];
      expect(dinamica.map((x) => [x.mes, x.clinica, Number(x.internacoes)])).toEqual([
        ['2026-09', 'C', 1],
        ['2026-09', 'M', 1],
        ['2026-10', 'C', 1],
        ['2026-10', 'M', 1],
      ]);
      expect(() => db.exec("INSERT INTO carga VALUES ('x', 'x', 'x', 1, 'x', 'x')")).toThrow(/readonly/i);
      expect(() => db.exec('DROP TABLE fato_internacao')).toThrow(/readonly/i);
      expect(() => db.exec('CREATE TABLE analise (x TEXT)')).toThrow(/readonly/i);
    } finally {
      db.close();
    }
    const c = conferirLigacaoBi(bom);
    expect(c.problemas).toEqual([]);
    expect(c.tabelas).toContain('fato_internacao');
    // Nenhum valor do arquivo é o identificador cru: o paciente e a internação só como pseudônimo.
    const db2 = abrirParaBi(bom);
    try {
      const pacientes = db2
        .prepare('SELECT DISTINCT paciente_pseudonimo AS p FROM fato_internacao')
        .all() as {
        p: string;
      }[];
      for (const x of pacientes) expect(x.p).toMatch(/^[0-9a-f]{20}$/);
    } finally {
      db2.close();
    }
  });

  it('recusa o arquivo com coluna identificadora ou sem o registro da carga', () => {
    expect(() => abrirParaBi(ruim)).toThrow(/extra_paciente\.nome_paciente.*extra_paciente\.cpf/);
    expect(conferirLigacaoBi(ruim).problemas).toEqual(['extra_paciente.nome_paciente', 'extra_paciente.cpf']);
    expect(() => abrirParaBi(semCarga)).toThrow(/registro da carga vazio/);
    expect(conferirLigacaoBi(resolve(pasta, 'nao-existe.sqlite')).problemas).toEqual([
      'arquivo do data mart inexistente',
    ]);
  });
});
