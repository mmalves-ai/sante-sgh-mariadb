import { esquemaRelatorioEnsaioUtf8 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  avaliarEtapasEnsaioUtf8,
  avaliarIndicesUtf8,
  chaveIndiceUtf8,
  compararEquivalencia,
  conferirCatalogadas,
  contarClasses,
  ensaioUtf8Aprovavel,
  estimarJanelaUtf8Minutos,
  explicarDesvioCharset,
  limiteChaveIndice,
  paginaMinima,
  relatorioEnsaioUtf8Vazio,
  resumirLiterais,
  separarDesvioDoCharset,
  situacaoMedidaUtf8,
} from './ensaio-utf8.js';

const vazio = () =>
  relatorioEnsaioUtf8Vazio(
    'pc',
    '2026-10-27',
    { versaoMotor: '5.0.3', charset: 'NONE' },
    {
      versaoMotor: '5.0.3',
      charset: 'UTF8',
    },
  );

describe('M58-F3: inventário e índices', () => {
  it('conta as colunas por classe e confere as catalogadas', () => {
    expect(contarClasses([{ classe: 'cp1252' }, { classe: 'cp1252' }, { classe: 'bytes' }])).toEqual({
      cp1252: 2,
      utf8Catalogada: 0,
      bytes: 1,
    });
    expect(
      conferirCatalogadas(
        [{ tabela: 'PRCONTEVOL', coluna: 'EVOLUCAO_XML' }],
        ['PRCONTEVOL.EVOLUCAO_XML', 'RPMATRIZ_GUT_DESCRICAO.NOME'],
      ),
    ).toEqual({ catalogadas: ['PRCONTEVOL.EVOLUCAO_XML'], ausentes: ['RPMATRIZ_GUT_DESCRICAO.NOME'] });
  });

  it('chave em UTF-8: limite de um quarto da página menos 9; composto em grupos de 5 a cada 4', () => {
    expect(limiteChaveIndice(8192)).toBe(2039);
    expect(limiteChaveIndice(16384)).toBe(4087);
    expect(chaveIndiceUtf8([{ tipo: 'texto', tamanho: 100 }])).toBe(400);
    expect(
      chaveIndiceUtf8([
        { tipo: 'texto', tamanho: 10 },
        { tipo: 'outro', tamanho: 4 },
      ]),
    ).toBe(55);
    expect(paginaMinima(2039)).toBe(8192);
    expect(paginaMinima(2040)).toBe(16384);
    expect(paginaMinima(9000)).toBeNull();
  });

  it('os que estouram e a página do convertido; nenhum cabe ⇒ sem página', () => {
    const r = avaliarIndicesUtf8(
      [
        { nome: 'IX_PEQ', tabela: 'T', segmentos: [{ tipo: 'texto', tamanho: 60 }] },
        { nome: 'IX_GRANDE', tabela: 'T', segmentos: [{ tipo: 'texto', tamanho: 600 }] },
      ],
      8192,
    );
    expect(r.limiteChave).toBe(2039);
    expect(r.estouram).toEqual([{ nome: 'IX_GRANDE', tabela: 'T', chaveBytes: 2400, paginaMinima: 16384 }]);
    expect(r.paginaAlvo).toBe(16384);
    const n = avaliarIndicesUtf8(
      [{ nome: 'IX_X', tabela: 'T', segmentos: [{ tipo: 'texto', tamanho: 3000 }] }],
      8192,
    );
    expect(n.paginaAlvo).toBeNull();
    expect(avaliarIndicesUtf8([], 16384).paginaAlvo).toBe(16384);
  });
});

describe('M58-F3: literais e equivalência', () => {
  it('resume a revisão: comentário, literal, a rever (inclui byte alto no código)', () => {
    const f = (nome: string, o: Partial<Parameters<typeof resumirLiterais>[0][number]>) => ({
      nome,
      tipo: 'gatilho' as const,
      emComentario: 0,
      emLiteral: 0,
      emCodigo: 0,
      aRever: false,
      idaEVolta: true,
      ...o,
    });
    expect(
      resumirLiterais([
        f('G1', { emComentario: 2 }),
        f('G2', { emLiteral: 1 }),
        f('G3', { emLiteral: 1, aRever: true }),
        { ...f('P1', { emCodigo: 1 }), tipo: 'procedure' },
      ]),
    ).toEqual({
      gatilhos: 3,
      procedures: 1,
      soComentario: 1,
      emLiteral: 2,
      aRever: ['G3', 'P1'],
      idaEVoltaOk: 4,
    });
  });

  it('iguais ⇒ mesmo resumo; coluna trocada, tabela a mais e não verificada são apontadas', () => {
    const a = { T: { linhas: 2, resumos: { A: 'x', B: 'y' } }, U: { linhas: 9, resumos: null } };
    expect(compararEquivalencia(a, a)).toMatchObject({
      tabelas: 2,
      tabelasIguais: 2,
      colunas: 2,
      colunasIguais: 2,
      diferentes: [],
      naoVerificadas: ['U'],
    });
    const c = compararEquivalencia(a, {
      ...a,
      T: { linhas: 2, resumos: { A: 'x', B: 'z' } },
      V: { linhas: 1, resumos: {} },
    });
    expect(c.diferentes).toEqual(['T.B']);
    expect(c.tabelasDiferentes).toEqual(['V']);
    expect(c.hashAntes).not.toBe(c.hashDepois);
  });
});

describe('M58-F3: impressão e janela', () => {
  it('alterado tocado pela conversão é do charset; ausente, novo e alterado não tocado reprovam', () => {
    const d = separarDesvioDoCharset(
      'tabelas',
      { ausentes: [], novos: ['RDB$X'], alterados: ['TBPACIEN', 'TBOUTRA'] },
      new Set(['TBPACIEN']),
    );
    expect(d).toMatchObject({ novos: 0, alterados: 2, doCharset: 1, nomes: ['TBOUTRA'] });
    expect(explicarDesvioCharset([d])).toEqual(['schema-alterados:tabelas']);
    expect(explicarDesvioCharset([{ ...d, doCharset: 2 }])).toEqual([]);
    expect(
      explicarDesvioCharset([{ categoria: 'triggers', ausentes: 1, novos: 0, alterados: 0, nomes: [] }]),
    ).toEqual(['schema-ausentes:triggers']);
  });

  it('janela: (bombeamento + verificação) × 1,5 em blocos de 15 min; sem bombeamento, null', () => {
    expect(estimarJanelaUtf8Minutos(null, 100)).toBeNull();
    expect(estimarJanelaUtf8Minutos(3600, 1200)).toBe(120);
    expect(estimarJanelaUtf8Minutos(10, null)).toBe(15);
  });
});

describe('M58-F3: avaliação das etapas (falha fechada)', () => {
  it('o vazio vale no esquema e nada é aprovável', () => {
    const r = vazio();
    expect(esquemaRelatorioEnsaioUtf8.safeParse(r).success).toBe(true);
    const e = avaliarEtapasEnsaioUtf8(r);
    expect(e).toHaveLength(16);
    expect(e.every((x) => x.situacao === 'nao-executada')).toBe(true);
    expect(ensaioUtf8Aprovavel(e)).toBe(false);
  });

  it('literal revisto com a mesma letra sai dos achados; o que mudou de letra fica', () => {
    const r = vazio();
    r.etapas.literais = {
      ...r.etapas.literais,
      situacao: 'aprovada',
      gatilhos: 3,
      procedures: 0,
      idaEVoltaOk: 3,
      aRever: ['G1', 'G2', 'G3'],
      revistos: [
        { nome: 'G1', motivos: ['utf8-no-literal'], mesmaLetra: true },
        { nome: 'G2', motivos: ['byte-indefinido', 'utf8-no-literal'], mesmaLetra: false },
      ],
    };
    const l = avaliarEtapasEnsaioUtf8(r).find((x) => x.etapa === 'literais')!;
    expect(l.situacao).toBe('reprovada');
    expect(l.achados).toEqual(['literal-a-rever:G2', 'literal-a-rever:G3', 'literal-mudou:G2']);
    r.etapas.literais.revistos = ['G1', 'G2', 'G3'].map((nome) => ({ nome, motivos: [], mesmaLetra: true }));
    expect(situacaoMedidaUtf8(r, 'literais')).toBe('aprovada');
  });

  it('função externa que conta por byte com dependentes é achado dos objetos', () => {
    const r = vazio();
    r.etapas.objetos = {
      ...r.etapas.objetos,
      situacao: 'aprovada',
      gatilhos: 10,
      procedures: 2,
      funcoesPorByte: [
        { funcao: 'SUBSTR', dependentes: 45 },
        { funcao: 'RIGHT', dependentes: 0 },
      ],
    };
    const o = avaliarEtapasEnsaioUtf8(r).find((x) => x.etapa === 'objetos')!;
    expect(o.achados).toEqual(['funcao-por-byte:SUBSTR']);
    r.etapas.objetos.funcoesPorByte = [];
    expect(situacaoMedidaUtf8(r, 'objetos')).toBe('aprovada');
  });

  it('"aprovada" escrita sem os números vira reprovada, com os achados', () => {
    const r = vazio();
    r.etapas.equivalencia = {
      ...r.etapas.equivalencia,
      situacao: 'aprovada',
      tabelas: 2,
      tabelasIguais: 2,
      colunas: 3,
      colunasIguais: 2,
      diferentes: ['T.B'],
      hashAntes: 'a'.repeat(64),
      hashDepois: 'b'.repeat(64),
    };
    const eq = avaliarEtapasEnsaioUtf8(r).find((x) => x.etapa === 'equivalencia')!;
    expect(eq.situacao).toBe('reprovada');
    expect(eq.achados).toEqual(['coluna-diferente:T.B', 'resumo-diferente']);
    expect(situacaoMedidaUtf8(r, 'codec')).toBe('reprovada');
  });

  it('tudo medido e aprovado ⇒ aprovável', () => {
    const r = vazio();
    const h = 'c'.repeat(64);
    const ap = { situacao: 'aprovada' as const, bloqueio: null, observacao: null };
    r.etapas = {
      base: { ...ap, impressao: h, integridadeOk: true },
      inventario: {
        ...ap,
        tabelas: 2,
        cp1252: 5,
        utf8Catalogada: 1,
        bytes: 2,
        catalogadas: [],
        catalogadasAusentes: [],
      },
      indices: { ...ap, tamanhoPagina: 8192, limiteChave: 2039, comTexto: 3, estouram: [], paginaAlvo: 8192 },
      literais: {
        ...ap,
        gatilhos: 2,
        procedures: 0,
        soComentario: 1,
        emLiteral: 1,
        aRever: [],
        idaEVoltaOk: 2,
        revistos: [],
      },
      conversao: {
        ...ap,
        metodo: 'bombeamento',
        segundos: 10,
        tabelas: 2,
        linhas: 5,
        valoresByteIndefinido: 0,
        valoresMistos: 0,
        tabelasRejeitadas: [],
      },
      equivalencia: {
        ...ap,
        segundos: 5,
        tabelas: 2,
        tabelasIguais: 2,
        colunas: 6,
        colunasIguais: 6,
        diferentes: [],
        tabelasDiferentes: [],
        naoVerificadas: [],
        hashAntes: h,
        hashDepois: h,
      },
      'utf8-catalogadas': { ...ap, colunas: 1, idaEVoltaOk: 1, valoresInvalidos: 0 },
      rtf: { ...ap, colunas: 2, bytesIguais: 2, amostra: 3, abrem: 3 },
      objetos: {
        ...ap,
        gatilhos: 2,
        procedures: 1,
        invalidos: [],
        invalidosNaOrigem: [],
        funcoesPorByte: [],
      },
      codec: { ...ap, corpusBytes: 256, idaEVoltaOk: true, charsetConfere: true },
      schema: { ...ap, impressaoBase: h, impressaoEnsaio: h, diferencas: [] },
      assinaturas: {
        ...ap,
        operacoes: 1,
        cenarios: 2,
        diferencas: 0,
        iguaisABase: 0,
        relatorio: null,
        operacoesComDiferenca: [],
        funcoesACorrigir: [],
      },
      carga: { ...ap, slosAtendidos: true },
      'sante-api': { ...ap, contratosQuebrados: 0, referencia: null },
      parceiros: { ...ap, alvos: [{ alvo: 'V_FIRST_', objetos: 1, lidosSemErro: 1, avisado: true }] },
      'volta-atras': { ...ap, segundos: 100, integridadeOk: true },
    };
    expect(esquemaRelatorioEnsaioUtf8.safeParse(r).success).toBe(true);
    const e = avaliarEtapasEnsaioUtf8(r);
    expect(e.filter((x) => x.situacao !== 'aprovada')).toEqual([]);
    expect(ensaioUtf8Aprovavel(e)).toBe(true);
  });
});
