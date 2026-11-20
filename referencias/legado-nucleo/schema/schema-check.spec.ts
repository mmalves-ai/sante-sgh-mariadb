// Regra 8 da ficha do M02: divergência de schema bloqueia escrita naquele estabelecimento. Fixture com um
// trigger alterado gera divergência e marca de bloqueio. Catálogo sintético (nomes fictícios).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type CatalogoLegado, normalizarFonte } from './catalogo.js';
import { calcularImpressao, compararImpressoes, resumirComparacao } from './impressao.js';
import {
  desserializarImpressao,
  escritaBloqueada,
  gravarHomologada,
  lerHomologada,
  marcarSchema,
  RegistroSchema,
  serializarImpressao,
} from './verificacao.js';

const b = (t: string) => Uint8Array.from(t, (c) => c.charCodeAt(0));

function catalogoSintetico(mudar: (c: CatalogoLegado) => CatalogoLegado = (c) => c): CatalogoLegado {
  return mudar({
    charset: 'NONE',
    versaoMotor: '3.0.14',
    tabelas: [
      {
        nome: 'TBA',
        pk: ['ID'],
        colunas: [
          {
            nome: 'ID',
            tipo: 'INTEGER',
            base: 'inteiro',
            tamanho: null,
            escala: null,
            anulavel: false,
            dominio: null,
            check: null,
            padrao: null,
            calculada: false,
          },
          {
            nome: 'NOME',
            tipo: 'VARCHAR(40)',
            base: 'texto',
            tamanho: 40,
            escala: null,
            anulavel: true,
            dominio: 'D_NOME',
            check: null,
            padrao: null,
            calculada: false,
          },
        ],
      },
      { nome: 'TBB', pk: [], colunas: [] },
    ],
    visoes: [{ nome: 'VW_A', fonte: b('select id from tba') }],
    triggers: [
      {
        nome: 'TRG_TBA_BI',
        tabela: 'TBA',
        tipo: 1,
        sequencia: 0,
        inativo: false,
        fonte: b('as begin new.id = gen_id(g, 1); end'),
      },
      { nome: 'TRG_TBB_AU', tabela: 'TBB', tipo: 4, sequencia: 0, inativo: false, fonte: b('as begin end') },
    ],
    procedimentos: [{ nome: 'SP_X', parametros: ['entrada:0:P:INTEGER'], fonte: b('as begin suspend; end') }],
    generators: ['GEN_TBA'],
    indices: [
      {
        nome: 'RDB$PRIMARY1',
        tabela: 'TBA',
        unico: true,
        descendente: false,
        inativo: false,
        expressao: null,
        segmentos: ['ID'],
      },
      {
        nome: 'IDX_TBA_NOME',
        tabela: 'TBA',
        unico: false,
        descendente: false,
        inativo: false,
        expressao: null,
        segmentos: ['NOME'],
      },
    ],
    restricoes: [
      { nome: 'INTEG_1', tabela: 'TBA', tipo: 'PRIMARY KEY', colunas: ['ID'], detalhe: null },
      {
        nome: 'FK_TBB',
        tabela: 'TBB',
        tipo: 'FOREIGN KEY',
        colunas: [],
        detalhe: 'ref=INTEG_1;upd=RESTRICT;del=CASCADE',
      },
    ],
    dominios: [{ nome: 'D_NOME', tipo: 'VARCHAR(40)', anulavel: true, check: null, padrao: null }],
    excecoes: [{ nome: 'E_X', fonte: b('mensagem') }],
    funcoes: [{ nome: 'F_X', fonte: b('ib_udf|IB_UDF_x') }],
  });
}

const homologada = calcularImpressao('pc', catalogoSintetico(), new Date('2026-10-19T00:00:00Z'));

describe('impressão digital', () => {
  it('é estável e conta os objetos por categoria', () => {
    const outra = calcularImpressao('pc', catalogoSintetico(), new Date('2026-10-20T00:00:00Z'));
    expect(outra.resumo).toBe(homologada.resumo);
    expect(homologada.contagens).toMatchObject({
      tabelas: 2,
      triggers: 2,
      generators: 1,
      indices: 2,
      restricoes: 2,
    });
    expect(compararImpressoes(homologada, outra).iguais).toBe(true);
  });

  it('nomes gerados pelo Firebird não entram: outro RDB$PRIMARYnn/INTEG_nn é o mesmo objeto', () => {
    const renomeado = calcularImpressao(
      'hs',
      catalogoSintetico((c) => ({
        ...c,
        indices: c.indices.map((i) => (i.nome === 'RDB$PRIMARY1' ? { ...i, nome: 'RDB$PRIMARY77' } : i)),
        restricoes: c.restricoes.map((r) =>
          r.nome === 'INTEG_1'
            ? { ...r, nome: 'INTEG_99' }
            : { ...r, detalhe: r.detalhe?.replace('INTEG_1', 'INTEG_99') ?? null },
        ),
      })),
    );
    expect(compararImpressoes(homologada, renomeado).iguais).toBe(true);
  });

  it('fonte que só difere em CRLF ou espaço no fim da linha: igual (normalizada na leitura)', () => {
    expect(normalizarFonte(b('as begin  \r\n  x;\t\r\nend\r\n\r\n'))).toEqual(b('as begin\n  x;\nend'));
    const crlf = calcularImpressao(
      'pc',
      catalogoSintetico((c) => ({
        ...c,
        triggers: c.triggers.map((t) => ({ ...t, fonte: normalizarFonte(t.fonte) })),
      })),
    );
    expect(crlf.resumo).toBe(homologada.resumo);
  });

  it('não guarda fonte nem dado: só nomes e hashes', () => {
    const json = serializarImpressao(homologada);
    expect(json).not.toContain('gen_id');
    expect(json).not.toContain('mensagem');
    expect(desserializarImpressao(json, 'pc')).toEqual(JSON.parse(JSON.stringify(homologada)));
    expect(json).not.toMatch(/^\s*"[A-Z_]+"\s*:/m); // nenhum nome de objeto como chave
    expect(() => desserializarImpressao(JSON.stringify({ ...homologada, categorias: {} }), 'pc')).toThrow(
      /sem a categoria/,
    );
  });
});

describe('trigger alterado → divergência e bloqueio', () => {
  const alterada = calcularImpressao(
    'pc',
    catalogoSintetico((c) => ({
      ...c,
      triggers: c.triggers.map((t) =>
        t.nome === 'TRG_TBA_BI' ? { ...t, fonte: b('as begin new.id = 0; end') } : t,
      ),
    })),
  );

  it('a comparação aponta o trigger e a tabela afetada', () => {
    const c = compararImpressoes(homologada, alterada);
    expect(c.iguais).toBe(false);
    expect(c.diferencas.triggers).toEqual({ ausentes: [], novos: [], alterados: ['TRG_TBA_BI'] });
    expect(c.tabelasAfetadas).toEqual(['TBA']);
    expect(c.global).toBe(false);
    expect(resumirComparacao(c)).toBe('triggers: 0 ausente(s), 0 novo(s), 1 alterado(s)');
  });

  it('a marca bloqueia as escritas em TBA e só nelas', () => {
    const m = marcarSchema('pc', alterada, homologada);
    expect(m.estado).toBe('divergente');
    expect(m.tabelasBloqueadas).toEqual(['TBA']);
    expect(escritaBloqueada(m, ['tba'])).toBe(true);
    expect(escritaBloqueada(m, ['TBB'])).toBe(false);
    const r = new RegistroSchema();
    r.registrar(m);
    expect(r.bloqueada('pc', ['TBA', 'TBB'])).toBe(true);
    expect(r.bloqueada('hs', ['TBB'])).toBe(true); // sem marca: bloqueado
    expect(r.todas()).toHaveLength(1);
  });

  it('trigger desativado, generator a menos e charset diferente', () => {
    const desativado = calcularImpressao(
      'pc',
      catalogoSintetico((c) => ({
        ...c,
        triggers: c.triggers.map((t) => ({ ...t, inativo: t.nome === 'TRG_TBB_AU' })),
      })),
    );
    expect(compararImpressoes(homologada, desativado).tabelasAfetadas).toEqual(['TBB']);
    const semGen = calcularImpressao(
      'pc',
      catalogoSintetico((c) => ({ ...c, generators: [] })),
    );
    const cg = compararImpressoes(homologada, semGen);
    expect(cg.global).toBe(true);
    expect(marcarSchema('pc', semGen, homologada).bloqueiaTudo).toBe(true);
    const utf8 = calcularImpressao(
      'pc',
      catalogoSintetico((c) => ({ ...c, charset: 'UTF8' })),
    );
    const cc = compararImpressoes(homologada, utf8);
    expect(cc).toMatchObject({ iguais: false, charsetIgual: false, global: true });
    expect(resumirComparacao(cc)).toMatch(/^charset diferente/);
    expect(marcarSchema('pc', utf8, homologada).motivo).toMatch(/Charset/);
  });

  it('tabela removida e objeto novo sem tabela também bloqueiam', () => {
    const sem = calcularImpressao(
      'pc',
      catalogoSintetico((c) => ({ ...c, tabelas: c.tabelas.slice(0, 1), excecoes: [] })),
    );
    const c = compararImpressoes(homologada, sem);
    expect(c.diferencas.tabelas?.ausentes).toEqual(['TBB']);
    expect(c.tabelasAfetadas).toContain('TBB');
    expect(c.global).toBe(true);
    const nova = calcularImpressao(
      'pc',
      catalogoSintetico((c) => ({
        ...c,
        procedimentos: [...c.procedimentos, { nome: 'SP_NOVA', parametros: [], fonte: b('x') }],
      })),
    );
    expect(compararImpressoes(homologada, nova).diferencas.procedimentos?.novos).toEqual(['SP_NOVA']);
  });
});

describe('marca sem banco ou sem homologação', () => {
  it('banco indisponível e sem homologação bloqueiam tudo', () => {
    const ind = marcarSchema('pc', null, homologada, { motivo: 'sem conexão' });
    expect(ind).toMatchObject({ estado: 'indisponivel', bloqueiaTudo: true, motivo: 'sem conexão' });
    expect(marcarSchema('pc', null, null).motivo).toMatch(/indisponível/);
    const sem = marcarSchema('pc', homologada, null);
    expect(sem.estado).toBe('sem-homologacao');
    expect(escritaBloqueada(sem, [])).toBe(true);
    expect(escritaBloqueada(undefined, [])).toBe(true);
    expect(escritaBloqueada(marcarSchema('pc', homologada, homologada), ['TBA'])).toBe(false);
  });
});

describe('arquivo homologado', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'sgh-schema-'));
  afterAll(() => rmSync(pasta, { recursive: true, force: true }));

  it('grava e lê de volta; formato e código conferidos', () => {
    const p = gravarHomologada(pasta, homologada);
    expect(p.endsWith('pc.json')).toBe(true);
    expect(lerHomologada(pasta, 'pc')?.resumo).toBe(homologada.resumo);
    expect(lerHomologada(pasta, 'hs')).toBeNull();
    writeFileSync(join(pasta, 'zz.json'), JSON.stringify({ formato: 2 }));
    expect(() => lerHomologada(pasta, 'zz')).toThrow(/formato inesperado/);
    expect(() => lerHomologada(pasta, '../x')).toThrow(/inválido/);
  });
});
