import { describe, expect, it } from 'vitest';
import { COLUNAS_PROIBIDAS, procurarColunasProibidas } from './colunas-proibidas.ts';
import { COLUNAS_CREDENCIAL, credenciaisNasRespostas } from './respostas-credencial.ts';

describe('guarda de colunas de credencial (regra 8 do M09)', () => {
  it.each([
    ["const q = 'SELECT URL, SENHA_PRESTADOR FROM TBTISSWEBSERV';", 'SENHA_PRESTADOR'],
    ['const q = `SELECT w.LOGIN_PRESTADOR FROM TBTISSWEBSERV w`;', 'LOGIN_PRESTADOR'],
    ['const q = "SELECT CERTIFICADO_DIG_WS_TISS FROM TBTISS";', 'CERTIFICADO_DIG_WS_TISS'],
    ["const q = 'SELECT c.COD, c.SENHA FROM TBCONVEN c';", 'TBCONVEN.SENHA'],
    ["const q = 'SELECT SENHA FROM TBCONVEN';", 'TBCONVEN.SENHA'],
    ["const q = 'SELECT * FROM TBTISS WHERE CONV = ?';", 'SELECT *'],
    ["const q = 'SELECT FIRST 1 * FROM TBCONVEN';", 'SELECT *'],
    ["const q = 'SELECT t.* FROM TBTISSWEBSERV t';", 'SELECT *'],
  ])('recusa: %s', (codigo, motivo) => {
    const achados = procurarColunasProibidas(codigo, 'x.ts');
    expect(achados.length).toBeGreaterThan(0);
    expect(achados.map((a) => a.motivo).join(' ')).toContain(motivo);
    expect(achados[0]?.linha).toBe(1);
  });

  it.each([
    "const q = 'SELECT CONV, COD_CON_TISS, IMP_SENHA_2_3_GUIA FROM TBTISS';",
    "const q = 'SELECT COD, NOME, SENHA_OBRIGATORIA_CONV FROM TBCONVEN';",
    "const q = 'SELECT ID_TBCONVEN, URL, SENHA_PRESTADOR_PADRAO_HASH_MD5 FROM TBTISSWEBSERV';",
    "const senha = 'SENHA'; // texto sem SQL",
    "const q = 'SELECT SENHA FROM TBUSERS WHERE NOME = ?'; // outra tabela: não é desta regra",
    "const q = 'SELECT COUNT(*) N FROM TBTISS';",
  ])('aceita: %s', (codigo) => {
    expect(procurarColunasProibidas(codigo, 'x.ts')).toEqual([]);
  });

  it('exceção revisada: só a contagem da neutralização da cópia (M01), sem ler o valor', () => {
    const contagem =
      "const q = \"SELECT 'credencial=' || COUNT(*) FROM TBTISSWEBSERV WHERE COALESCE(SENHA_PRESTADOR,'') <> ''\";";
    expect(procurarColunasProibidas(contagem, 'packages/legado/src/copia/neutralizacao.ts')).toEqual([]);
    expect(procurarColunasProibidas(contagem, 'packages/legado/src/outro.ts')).toHaveLength(1);
    const leitura = "const q = 'SELECT SENHA_PRESTADOR FROM TBTISSWEBSERV';";
    expect(procurarColunasProibidas(leitura, 'packages/legado/src/copia/neutralizacao.ts')).toHaveLength(1);
  });

  it('informa a linha do literal', () => {
    const achados = procurarColunasProibidas(
      "// a\n// b\nconst q = 'SELECT SENHA_PRESTADOR FROM TBTISSWEBSERV';",
      'y.ts',
    );
    expect(achados).toEqual([{ arquivo: 'y.ts', linha: 3, motivo: 'coluna de credencial SENHA_PRESTADOR' }]);
  });

  it('arquivo .sql: o arquivo inteiro é SQL, sem exigir string (cada comando, com a linha)', () => {
    const sql =
      '-- consulta de prova\nSELECT COUNT(*) N FROM TBTISS;\n\nSELECT SENHA_PRESTADOR\n  FROM TBTISSWEBSERV;\nSELECT * FROM TBCONVEN;\n';
    const achados = procurarColunasProibidas(sql, 'packages/x/consulta.sql');
    expect(achados).toEqual([
      { arquivo: 'packages/x/consulta.sql', linha: 4, motivo: 'coluna de credencial SENHA_PRESTADOR' },
      {
        arquivo: 'packages/x/consulta.sql',
        linha: 6,
        motivo: 'SELECT * sobre TBCONVEN (traria as colunas de credencial)',
      },
    ]);
    // O mesmo texto num .ts sem string não é SQL do código.
    expect(procurarColunasProibidas('// SELECT SENHA_PRESTADOR FROM TBTISSWEBSERV', 'x.ts')).toEqual([]);
    expect(procurarColunasProibidas('SELECT COUNT(*) N FROM TBTISS;', 'y.sql')).toEqual([]);
  });
});

describe('regra 8 sobre as respostas da API (M12)', () => {
  it('a lista de @sgh/contratos é a mesma da guarda do SQL', () => {
    expect([...COLUNAS_CREDENCIAL].sort()).toEqual(
      [...new Set(Object.values(COLUNAS_PROIBIDAS).flat())].sort(),
    );
  });
  it('recusa chave ou valor de credencial, na forma do banco ou em camelCase; aceita senhaObrigatoria', () => {
    const achados = credenciaisNasRespostas([
      {
        url: '/api/cadastros/convenios/codigos-prestador',
        corpo: { itens: [{ codigo: 1, senhaPrestador: 'x' }] },
      },
      {
        url: '/api/faturamento/credenciamento',
        corpo: { colunas: [{ campo: 'LOGIN_PRESTADOR', rotulo: 'Login' }] },
      },
      { url: '/api/cadastros/convenios/305', corpo: { campos: [{ campo: 'senhaObrigatoria', valor: '4' }] } },
    ]);
    expect(achados.map((a) => `${a.url} ${a.caminho}`)).toEqual([
      '/api/cadastros/convenios/codigos-prestador $.itens[0].senhaPrestador',
      '/api/faturamento/credenciamento $.colunas[0].campo',
    ]);
  });
});
