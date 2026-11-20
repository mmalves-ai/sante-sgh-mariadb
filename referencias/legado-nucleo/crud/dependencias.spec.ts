// W0-02 (D-CRUD-ORFAOS): o verificador de dependências comum sobre um banco por roteiro — FKs de entrada de uma e de
// mais colunas (com os valores tirados da linha), autorreferência, referência lógica, contagem que falha (fail-closed),
// valor nulo, amostra pela chave primária da tabela dependente e as frases da recusa. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { BancoRoteiro } from '../banco-roteiro.spec-util.js';
import {
  chavePrimaria,
  conferirMapa,
  fksDeEntrada,
  frasesDosDependentes,
  grupoDaTabela,
  type MapaDependencias,
  verificarDependencias,
} from './dependencias.js';

function banco(): BancoRoteiro {
  return new BancoRoteiro()
    .quando(/FROM RDB\$RELATION_CONSTRAINTS rc JOIN RDB\$REF_CONSTRAINTS/, [
      { NOME: 'FK_A', FILHA: 'FILHA_A', COLUNA: 'ID_MAE', MAE: 'ID', REGRA: 'RESTRICT', POS: 0 },
      { NOME: 'FK_B', FILHA: 'LIGACAO', COLUNA: 'MAE_ID', MAE: 'ID', REGRA: 'CASCADE', POS: 0 },
      { NOME: 'FK_B', FILHA: 'LIGACAO', COLUNA: 'MAE_COD', MAE: 'COD', REGRA: 'CASCADE', POS: 1 },
      { NOME: 'FK_C', FILHA: 'MAE', COLUNA: 'ID_PAI', MAE: 'ID', REGRA: 'ESQUISITA', POS: 0 },
      { NOME: 'FK_D', FILHA: 'PROPRIA', COLUNA: 'ID_MAE', MAE: 'ID', REGRA: 'CASCADE', POS: 0 },
    ])
    .quando(/'PRIMARY KEY'/, (p) =>
      p[0] === 'FILHA_A' ? [{ C: 'ID' }] : p[0] === 'LIGACAO' ? [{ C: 'MAE_ID' }, { C: 'OUTRO' }] : [],
    )
    .quando(/SELECT COUNT\(\*\) N FROM "FILHA_A"/, [{ N: 7 }])
    .quando(/SELECT FIRST 5 "ID" FROM "FILHA_A"/, [{ ID: 1 }, { ID: 2 }])
    .quando(/SELECT COUNT\(\*\) N FROM "LIGACAO"/, [{ N: 2 }])
    .quando(/SELECT FIRST 5 "MAE_ID", "OUTRO" FROM "LIGACAO"/, [
      { MAE_ID: 10, OUTRO: new Date(Date.UTC(2026, 0, 2)) },
      { MAE_ID: 10, OUTRO: 'X ' },
    ])
    .quando(/SELECT COUNT\(\*\) N FROM "MAE"/, [{ N: 0 }])
    .quando(/SELECT COUNT\(\*\) N FROM "HIST"/, () => {
      throw new Error('tabela travada');
    })
    .quando(/SELECT COUNT\(\*\) N FROM "SEM_PK"/, [{ N: 3 }]);
}

const mapa: MapaDependencias = {
  tabela: 'MAE',
  chave: ['ID'],
  referenciasLogicas: [
    { tabela: 'HIST', colunas: ['ID_MAE'], evidencia: 'teste', rotulo: 'Histórico' },
    { tabela: 'SEM_PK', colunas: ['ID_MAE'], evidencia: 'teste' },
    { tabela: 'MAE', colunas: ['ID_ORIGEM'], evidencia: 'autorreferência lógica' },
  ],
  proprias: ['PROPRIA.ID_MAE'],
};

describe('verificador de dependências (W0-02, D-CRUD-ORFAOS)', () => {
  it('as FKs de entrada agrupadas por restrição, com as colunas da mãe na ordem; regra desconhecida vira RESTRICT', async () => {
    const fks = await fksDeEntrada(banco().tx(), 'MAE');
    expect(fks.map((f) => [f.nome, f.tabela, f.colunas.join('+'), f.colunasMae.join('+'), f.regra])).toEqual([
      ['FK_A', 'FILHA_A', 'ID_MAE', 'ID', 'RESTRICT'],
      ['FK_B', 'LIGACAO', 'MAE_ID+MAE_COD', 'ID+COD', 'CASCADE'],
      ['FK_C', 'MAE', 'ID_PAI', 'ID', 'RESTRICT'],
      ['FK_D', 'PROPRIA', 'ID_MAE', 'ID', 'CASCADE'],
    ]);
    await expect(fksDeEntrada(banco().tx(), 'mae; drop')).rejects.toThrow(/inválida/);
    expect(await chavePrimaria(banco().tx(), 'LIGACAO')).toEqual(['MAE_ID', 'OUTRO']);
  });

  it('conta FKs (simples e compostas) e lógicas, com amostra; fail-closed; sem a própria linha e sem as próprias', async () => {
    const b = banco();
    const v = await verificarDependencias(b.tx(), {
      mapa,
      linha: { ID: 10, COD: 'A' },
      chave: [10],
      rotulo: (t) => (t === 'FILHA_A' ? 'Filhas declaradas' : undefined),
    });
    expect(
      v.map((x) => [x.tabela, x.origem, x.quantidade, x.amostra.join(','), x.rotulo, x.naoContado ?? false]),
    ).toEqual([
      ['FILHA_A', 'fk', 7, '1,2', 'Filhas declaradas', false],
      ['LIGACAO', 'fk', 2, '10|2026-01-02,10|X', 'Outros cadastros e movimentos', false],
      ['HIST', 'logica', 1, '', 'Histórico', true],
      ['SEM_PK', 'logica', 3, '', 'Outros cadastros e movimentos', false],
    ]);
    // A autorreferência (FK_C, e a lógica ID_ORIGEM) exclui a própria linha; a FK própria (PROPRIA) nem é contada.
    expect(b.de(/FROM "MAE" WHERE "ID_PAI" = \? AND NOT \("ID" = \?\)/)).toHaveLength(1);
    expect(b.de(/FROM "MAE" WHERE "ID_ORIGEM" = \? AND NOT \("ID" = \?\)/)).toHaveLength(1);
    expect(b.de(/FROM "PROPRIA"/)).toHaveLength(0);
    // Valores da FK composta tirados da linha (ID e COD).
    expect(b.de(/FROM "LIGACAO" WHERE "MAE_ID" = \? AND "MAE_COD" = \?/)[0]?.parametros).toEqual([10, 'A']);
  });

  it('só as lógicas (recontagem antes do COMMIT) e valor nulo na linha não conta', async () => {
    const b = banco();
    const v = await verificarDependencias(b.tx(), {
      mapa: { ...mapa, referenciasLogicas: [] },
      linha: { ID: null, COD: null },
      chave: [null],
    });
    expect(v).toEqual([]);
    const so = await verificarDependencias(b.tx(), { mapa, linha: { ID: 10 }, chave: [10], soLogicas: true });
    expect(so.map((x) => x.origem)).toEqual(['logica', 'logica']);
    expect(b.de(/RDB\$REF_CONSTRAINTS/)).toHaveLength(1);
  });

  it('nome inválido na referência lógica conta como vínculo (fail-closed)', async () => {
    const v = await verificarDependencias(banco().tx(), {
      mapa: { ...mapa, referenciasLogicas: [{ tabela: 'x"; --', colunas: ['A'], evidencia: 'e' }] },
      linha: { ID: 1 },
      chave: [1],
      soLogicas: true,
    });
    expect(v).toEqual([expect.objectContaining({ quantidade: 1, naoContado: true })]);
  });

  it('W1-04: as derivadas (condição fixa, parâmetros da linha) contam também na recontagem; nulo não conta; formato e falha fechada', async () => {
    const b = new BancoRoteiro()
      .quando(/SELECT COUNT\(\*\) N FROM "JUSTIF"/, [{ N: 2 }])
      .quando(/SELECT FIRST 5 CAST\("REG" AS VARCHAR\(80\)\) "REG" FROM "JUSTIF"/, [
        { REG: 11 },
        { REG: ' 12 ' },
      ])
      .quando(/SELECT COUNT\(\*\) N FROM "QUEBRA"/, () => {
        throw new Error('falhou');
      });
    const derivada = {
      tabela: 'JUSTIF',
      onde: `TEXTO STARTING WITH (TRIM(CAST(? AS VARCHAR(50))) || ':')`,
      de: ['NOME'],
      amostra: ['REG'],
      evidencia: 'teste',
      rotulo: 'Justificativas',
    };
    const m: MapaDependencias = {
      tabela: 'MAE',
      chave: ['ID'],
      referenciasLogicas: [],
      semReferenciasLogicas: 'x',
      derivadas: [derivada],
    };
    const v = await verificarDependencias(b.tx(), {
      mapa: m,
      linha: { ID: 1, NOME: 'Erro' },
      chave: [1],
      soLogicas: true,
    });
    expect(v).toEqual([
      expect.objectContaining({
        tabela: 'JUSTIF',
        origem: 'logica',
        quantidade: 2,
        amostra: ['11', '12'],
        rotulo: 'Justificativas',
      }),
    ]);
    expect(b.de(/FROM "JUSTIF" WHERE TEXTO STARTING WITH/)[0]?.parametros).toEqual(['Erro']);
    expect(
      await verificarDependencias(b.tx(), {
        mapa: m,
        linha: { ID: 1, NOME: null },
        chave: [1],
        soLogicas: true,
      }),
    ).toEqual([]);
    const falha = await verificarDependencias(b.tx(), {
      mapa: {
        ...m,
        derivadas: [
          { ...derivada, tabela: 'QUEBRA' },
          { ...derivada, onde: 'A = ? ; DROP' },
        ],
      },
      linha: { ID: 1, NOME: 'Erro' },
      chave: [1],
      soLogicas: true,
    });
    expect(falha.map((x) => [x.quantidade, x.naoContado])).toEqual([
      [1, true],
      [1, true],
    ]);
    expect(
      conferirMapa({
        ...m,
        derivadas: [
          { ...derivada, de: [] },
          { ...derivada, onde: 'A = ? -- x' },
          { ...derivada, evidencia: ' ' },
        ],
      }),
    ).toEqual([
      'JUSTIF: derivada com 0 coluna(s) para os parâmetros da condição',
      'JUSTIF: derivada com separador na condição',
      'JUSTIF: derivada sem evidência',
    ]);
  });

  it('o formato do mapa e as frases', () => {
    expect(
      conferirMapa({ tabela: 'mae', chave: ['ID'], referenciasLogicas: [], semReferenciasLogicas: 'ok' }),
    ).toEqual(['tabela inválida (mae)']);
    expect(
      conferirMapa({
        tabela: 'MAE',
        chave: ['ID'],
        referenciasLogicas: [{ tabela: 'x', colunas: ['a'], evidencia: 'e' }],
      }),
    ).toEqual(['x: nome inválido']);
    expect(
      frasesDosDependentes(
        [{ tabela: 'T', colunas: ['C'], origem: 'fk', quantidade: 1, amostra: ['9'], rotulo: 'X' }],
        'O item',
        '',
      ),
    ).toBe('O item tem 1 registro dependente: 1 registro em X (amostra: 9).');
    for (const [t, g] of [
      ['SGH_PEP_DOC', 'Prontuário (evoluções, prescrições, documentos)'],
      ['CCCADCIR', 'Centro cirúrgico'],
      ['AGPACAGENDA', 'Agenda'],
      ['ATCABECATEND', 'Atendimentos'],
      ['RICADINT', 'Internação'],
      ['SILANEXA', 'Exames e serviços (SADT)'],
      ['MFCONPAG', 'Repasse e honorários'],
      ['FTCONTA', 'Contas e faturamento'],
      ['GEITENS', 'Estoque e suprimentos'],
      ['FPEVENTO', 'Pessoas e folha'],
      ['TBUSERS_TBPAPEL', 'Login do sistema'],
      ['SGH_CAD_PROF_EVENTO', 'Histórico do login do sistema'],
      ['TBQUALQUER', 'Outros cadastros e movimentos'],
    ] as const)
      expect(grupoDaTabela(t), t).toBe(g);
  });
});
