// Leitura do catálogo RDB$ (unitário, com leitor dublê de linhas sintéticas) e geração dos tipos.
import { describe, expect, it } from 'vitest';
import type { Leitor } from '../transacao.js';
import { descreverTipo, lerCatalogoLegado, nomeAutomatico } from './catalogo.js';
import { esquemaDaColuna, esquemaDaTabela } from './esquemas.js';
import { type CatalogoTipos, gerarTipos } from './gerar-tipos.js';
import { calcularImpressao } from './impressao.js';

const linhas: [string, Record<string, unknown>[]][] = [
  ['FROM RDB$DATABASE', [{ CS: 'NONE', V: '3.0.14' }]],
  [
    'FROM RDB$RELATIONS r',
    [
      { NOME: 'TBA', FONTE: null, VISAO: 0 },
      { NOME: 'VW_A', FONTE: 'select 1', VISAO: 1 },
      { NOME: 'TBVAZIA', FONTE: null, VISAO: 0 },
    ],
  ],
  [
    'FROM RDB$RELATION_FIELDS rf',
    [
      {
        T: 'TBA',
        C: 'ID',
        P: 0,
        D: 'RDB$1',
        NR: 1,
        ND: null,
        TP: 8,
        ST: 0,
        L: 4,
        PR: 0,
        SC: 0,
        CL: null,
        CALC: 0,
        CK: null,
        DF: null,
      },
      {
        T: 'TBA',
        C: 'NOME',
        P: 1,
        D: 'D_NOME',
        NR: null,
        ND: null,
        TP: 37,
        ST: 0,
        L: 40,
        PR: null,
        SC: 0,
        CL: 40,
        CALC: 0,
        CK: "CHECK (VALUE <> '')",
        DF: "DEFAULT ''",
      },
      {
        T: 'TBA',
        C: 'VALOR',
        P: 2,
        D: 'RDB$2',
        NR: null,
        ND: null,
        TP: 16,
        ST: 1,
        L: 8,
        PR: 15,
        SC: -2,
        CL: null,
        CALC: 0,
        CK: null,
        DF: null,
      },
      {
        T: 'TBA',
        C: 'OBS',
        P: 3,
        D: 'RDB$3',
        NR: null,
        ND: null,
        TP: 261,
        ST: 1,
        L: 8,
        PR: null,
        SC: 0,
        CL: null,
        CALC: 0,
        CK: null,
        DF: null,
      },
      {
        T: 'TBA',
        C: 'DT',
        P: 4,
        D: 'RDB$4',
        NR: null,
        ND: 1,
        TP: 12,
        ST: null,
        L: 4,
        PR: null,
        SC: 0,
        CL: null,
        CALC: 0,
        CK: null,
        DF: null,
      },
    ],
  ],
  ["'PRIMARY KEY'", [{ T: 'TBA', C: 'ID' }]],
  ['FROM RDB$TRIGGERS t', [{ NOME: 'TRG_A', T: 'TBA', TP: 1, SQ: 0, INATIVO: 0, FONTE: 'as begin end\r\n' }]],
  ['FROM RDB$PROCEDURES p\n', [{ NOME: 'SP_A', FONTE: 'as begin end' }]],
  [
    'FROM RDB$PROCEDURE_PARAMETERS',
    [
      { P: 'SP_A', NOME: 'X', ES: 0, NUM: 0, TP: 8, ST: 0, L: 4, PR: 0, SC: 0, CL: null },
      { P: 'SP_A', NOME: 'Y', ES: 1, NUM: 0, TP: 37, ST: 0, L: 10, PR: null, SC: 0, CL: 10 },
    ],
  ],
  ['FROM RDB$GENERATORS', [{ NOME: 'GEN_A' }]],
  ['FROM RDB$INDICES i\n', [{ NOME: 'RDB$PRIMARY1', T: 'TBA', U: 1, DESCE: 0, INATIVO: 0, EXPR: null }]],
  ['FROM RDB$INDEX_SEGMENTS s', [{ I: 'RDB$PRIMARY1', C: 'ID' }]],
  [
    'FROM RDB$RELATION_CONSTRAINTS rc\n       LEFT',
    [
      {
        NOME: 'INTEG_1',
        T: 'TBA',
        TP: 'PRIMARY KEY',
        I: 'RDB$PRIMARY1',
        UQ: null,
        UR: null,
        DR: null,
        CK: null,
      },
      { NOME: 'CK_A', T: 'TBA', TP: 'CHECK', I: null, UQ: null, UR: null, DR: null, CK: 'check (id > 0)' },
      {
        NOME: 'FK_A',
        T: 'TBA',
        TP: 'FOREIGN KEY',
        I: null,
        UQ: 'INTEG_1',
        UR: 'RESTRICT',
        DR: 'RESTRICT',
        CK: null,
      },
    ],
  ],
  [
    'FROM RDB$FIELDS f',
    [{ NOME: 'D_NOME', TP: 37, ST: 0, L: 40, PR: null, SC: 0, CL: 40, NF: null, CK: null, DF: null }],
  ],
  ['FROM RDB$EXCEPTIONS', [{ NOME: 'E_A', M: new Uint8Array([0x61]) }]],
  [
    'FROM RDB$FUNCTION_ARGUMENTS',
    [
      { F: 'F_A', POS: 0, MEC: 0, NOME: null, TP: 27, ST: null, L: 8, PR: null, SC: 0, CL: null },
      { F: 'F_A', POS: 1, MEC: 1, NOME: null, TP: 27, ST: null, L: 8, PR: null, SC: 0, CL: null },
      { F: 'F_P', POS: 1, MEC: null, NOME: 'X', TP: 8, ST: 0, L: 4, PR: 0, SC: 0, CL: null },
    ],
  ],
  [
    'FROM RDB$FUNCTIONS',
    [
      { NOME: 'F_A', MODULO: 'ib_udf', ENTRADA: 'IB_UDF_abs', RET: 0, FONTE: null },
      { NOME: 'F_P', MODULO: null, ENTRADA: null, RET: null, FONTE: 'BEGIN RETURN X + 1; END  \r\n' },
    ],
  ],
];

const leitor: Leitor = {
  hospital: 'pc',
  async consultar(sql) {
    const achada = linhas.find(([chave]) => sql.includes(chave));
    if (!achada) throw new Error(`consulta não prevista: ${sql.slice(0, 80)}`);
    return achada[1] as never;
  },
  async lerBlob(blob) {
    return Buffer.from(String(blob), 'latin1');
  },
};

describe('lerCatalogoLegado', () => {
  it('monta tabelas, colunas, PK, visões, triggers, procedures, índices e restrições', async () => {
    const c = await lerCatalogoLegado(leitor);
    expect(c.charset).toBe('NONE');
    expect(c.tabelas.map((t) => t.nome)).toEqual(['TBA', 'TBVAZIA']);
    const tba = c.tabelas[0];
    expect(tba?.pk).toEqual(['ID']);
    expect(tba?.colunas.map((x) => [x.nome, x.tipo, x.anulavel, x.dominio])).toEqual([
      ['ID', 'INTEGER', false, null],
      ['NOME', 'VARCHAR(40)', true, 'D_NOME'],
      ['VALOR', 'NUMERIC(15,2)', true, null],
      ['OBS', 'BLOB SUB_TYPE TEXT', true, null],
      ['DT', 'DATE', false, null],
    ]);
    expect(c.visoes.map((v) => v.nome)).toEqual(['VW_A']);
    expect(Buffer.from(c.triggers[0]?.fonte ?? []).toString('latin1')).toBe('as begin end');
    expect(c.procedimentos[0]?.parametros).toEqual(['entrada:0:X:INTEGER', 'saida:0:Y:VARCHAR(10)']);
    expect(c.indices[0]?.segmentos).toEqual(['ID']);
    expect(c.restricoes.map((r) => r.detalhe)).toEqual([
      null,
      'check (id > 0)',
      'ref=INTEG_1;upd=RESTRICT;del=RESTRICT',
    ]);
    expect(c.funcoes[0]?.nome).toBe('F_A');
    // A impressão da função leva assinatura e corpo PSQL (normalizado), não só módulo e entrada.
    const texto = (u: Uint8Array | undefined) => Buffer.from(u ?? []).toString('latin1');
    expect(texto(c.funcoes[0]?.fonte)).toBe(
      'ib_udf|IB_UDF_abs|ret:0|0:0::DOUBLE PRECISION:8:0;1:1::DOUBLE PRECISION:8:0|',
    );
    expect(texto(c.funcoes[1]?.fonte)).toBe('||ret:|1::X:INTEGER:4:0|BEGIN RETURN X + 1; END');
    expect(calcularImpressao('pc', c).contagens).toMatchObject({ tabelas: 2, visoes: 1, restricoes: 3 });
  });

  it('gera os tipos: interface por tabela, catálogo JSON, lista das tabelas legadas e índice', async () => {
    const c = await lerCatalogoLegado(leitor);
    const arq = gerarTipos('pc', c);
    expect(Object.keys(arq).sort()).toEqual([
      'catalogo.json',
      'index.ts',
      'indices-legados.json',
      'procedimentos-legados.json',
      'tabelas-legadas.json',
      'tabelas.ts',
    ]);
    // M04: insumos do guardas:legado (colunas que abrem índice; procedimento com efeito colateral)
    expect(JSON.parse(arq['indices-legados.json'] as string)).toHaveProperty('colunasIndexadas');
    expect(JSON.parse(arq['procedimentos-legados.json'] as string)).toHaveProperty('procedimentos');
    expect(arq['tabelas.ts']).toContain('export interface TBA {');
    expect(arq['tabelas.ts']).toContain('  readonly ID: number;');
    expect(arq['tabelas.ts']).toContain('  readonly NOME: string | null;');
    expect(arq['tabelas.ts']).toContain('  readonly OBS: BlobLegado | null;');
    expect(arq['tabelas.ts']).toContain('  readonly DT: Date;');
    expect(arq['tabelas.ts']).toContain('NÃO EDITAR');
    expect(arq['index.ts']).toContain('TOTAL_TABELAS_LEGADAS = 2');
    const lista = JSON.parse(arq['tabelas-legadas.json'] as string) as {
      tabelas: string[];
      visoes: string[];
    };
    expect(lista).toMatchObject({ tabelas: ['TBA', 'TBVAZIA'], visoes: ['VW_A'] });
    const cat = JSON.parse(arq['catalogo.json'] as string) as CatalogoTipos;
    expect(cat.totalTabelas).toBe(2);
    const z = esquemaDaTabela(cat, 'TBA');
    expect(z.safeParse({ ID: 1, NOME: 'ok', VALOR: 1.5, OBS: null, DT: new Date() }).success).toBe(true);
    expect(z.safeParse({ ID: 1.5, NOME: 'x'.repeat(41), VALOR: null, OBS: null, DT: null }).success).toBe(
      false,
    );
    expect(() => esquemaDaTabela(cat, 'NAO_EXISTE')).toThrow(/não está no catálogo/);
  });
});

describe('tipos do Firebird', () => {
  it.each([
    [[7, 0, 2, 0, 0, null], 'SMALLINT'],
    [[16, 0, 8, 0, 0, null], 'BIGINT'],
    [[8, 2, 4, 9, -2, null], 'DECIMAL(9,2)'],
    [[10, 0, 4, null, 0, null], 'FLOAT'],
    [[27, 0, 8, null, 0, null], 'DOUBLE PRECISION'],
    [[13, 0, 4, null, 0, null], 'TIME'],
    [[35, 0, 8, null, 0, null], 'TIMESTAMP'],
    [[14, 0, 1, null, 0, 1], 'CHAR(1)'],
    [[23, 0, 1, null, 0, null], 'BOOLEAN'],
    [[261, 0, 8, null, 0, null], 'BLOB SUB_TYPE 0'],
    [[99, 0, 8, null, 0, null], 'TIPO_99'],
  ] as const)('%o → %s', (a, tipo) => {
    expect(descreverTipo(a[0], a[1], a[2], a[3], a[4], a[5]).tipo).toBe(tipo);
  });

  it('nomes automáticos', () => {
    expect(nomeAutomatico('RDB$PRIMARY12')).toBe(true);
    expect(nomeAutomatico('INTEG_45')).toBe(true);
    expect(nomeAutomatico('IDX_RICADPAC')).toBe(false);
  });

  it('esquema de coluna por tipo', () => {
    expect(esquemaDaColuna(['B', 'BOOLEAN', 0, null, null, null]).safeParse(true).success).toBe(true);
    expect(esquemaDaColuna(['T', 'TIMESTAMP', 0, null, null, null]).safeParse('x').success).toBe(false);
    expect(esquemaDaColuna(['X', 'BLOB SUB_TYPE 0', 1, null, null, null]).safeParse({}).success).toBe(true);
  });
});
