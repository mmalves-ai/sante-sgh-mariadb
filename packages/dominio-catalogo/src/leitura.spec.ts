import { describe, expect, it } from 'vitest';
import { leitorDoArquivo, lerArquivosDaCarga } from './leitura.js';
import { arquivoSimpro, arquivoTbProcedimento, cepsSinteticos } from './sinteticos.js';

describe('leitor pelo nome do arquivo oficial', () => {
  it.each([
    ['cid', 'CID-10-SUBCATEGORIAS.CSV', true],
    ['cid', 'CIAP2.csv', true],
    ['cid', 'CID-O-MORFOLOGIA.CSV', true],
    ['cid', 'x.csv', false],
    ['sigtap', 'tb_procedimento.txt', true],
    ['sigtap', 'rl_procedimento_cid.txt', true],
    ['sigtap', 'rl_procedimento_ocupacao.txt', true],
    ['sigtap', 'tb_grupo.txt', false],
    ['tuss', 'TUSS38_v202601.csv', true],
    ['tuss', 'TUSS24.csv', true],
    ['tuss', 'TUSS19.csv', true],
    ['tuss', 'TUSS22.csv', false],
    ['cep', 'LOG_RJ.TXT', true],
    ['cep', 'base.csv', false],
    ['cbo', 'CBO2002 - Ocupacao.csv', true],
    ['cbo', 'OCUPACOES.csv', true],
    ['cbo', 'x.csv', false],
    ['listas', 'DCB_2026.csv', true],
    ['listas', 'FABRICANTES.csv', true],
    ['listas', 'BANCOS.csv', true],
    ['listas', 'ATIVIDADES.csv', true],
    ['listas', 'x.csv', false],
    ['fiscal', 'cfop.txt', true],
    ['fiscal', 'pasta/cstPis.txt', true],
    ['fiscal', 'outro.txt', false],
    ['brasindice', 'BRASINDICE_1096.txt', true],
    ['brasindice', 'x.txt', false],
    ['simpro', 'SIMPRO.txt', true],
    ['simpro', 'x.txt', false],
    ['dominiosSus', 'TIPOS_UTI_2026.csv', true],
    ['dominiosSus', 'pasta/ACESSO_VASCULAR.csv', true],
    ['dominiosSus', 'CLASSIFICACAO_DIAGNOSTICO.csv', true],
    ['dominiosSus', 'x.csv', false],
    ['spedContabil', 'TIPO_ITEM_2026.csv', true],
    ['spedContabil', 'pasta/ATIVIDADE_PREPONDERANTE.csv', true],
    ['spedContabil', 'x.csv', false],
    ['agravos', 'AGRAVOS_CID_2026.csv', true],
    ['agravos', 'AGRAVOS_FICHAS.csv', true],
    ['agravos', 'AGRAVOS_PERGUNTAS.csv', true],
    ['agravos', 'x.csv', false],
  ] as const)('%s / %s', (c, n, existe) => {
    expect(leitorDoArquivo(c, n) !== null).toBe(existe);
  });
  it('cada leitor devolve itens', () => {
    for (const [c, n, t] of [
      ['cid', 'CIAP2.csv', 'codigo;titulo_original\nA01;x'],
      ['cid', 'CID-O.csv', 'cid;morfologia\nD110;M81470'],
      ['tuss', 'TUSS24.csv', 'Código do Termo;Termo\n225125;x'],
      ['tuss', 'TUSS19.csv', 'Código do Termo;Termo\n90000001;x'],
      ['cbo', 'OCUPACOES.csv', 'codigo;nome\n11;x'],
      ['listas', 'FABRICANTES.csv', 'codigo;nome\n9001;x'],
      ['listas', 'ATIVIDADES.csv', 'codigo;nome\n9001;x'],
      ['listas', 'BANCOS.csv', 'Número_Código,Nome_Reduzido\n999,x'],
      ['listas', 'DCB.csv', 'DCB;NOME\n9001;x'],
      ['sigtap', 'rl_procedimento_cid.txt', '0301010072A00 S201312'],
      ['sigtap', 'rl_procedimento_ocupacao.txt', '0301010072225125201312'],
      ['tuss', 'TUSS38.csv', 'Código do Termo;Termo\n9001;x'],
      ['dominiosSus', 'TIPOS_UTI.csv', 'codigo;nome\n91;UTI sintética'],
      ['dominiosSus', 'SITUACAO_TRANSPLANTE.csv', 'codigo;nome\n91;x'],
      ['spedContabil', 'NATUREZA_PJ.csv', 'codigo;nome\n8;x'],
      ['agravos', 'AGRAVOS_CID.csv', 'cid;periodicidade\nA90.0;1'],
      ['agravos', 'AGRAVOS_FICHAS.csv', 'codigo;nome\n91;A90/A92'],
      ['agravos', 'AGRAVOS_PERGUNTAS.csv', 'ficha;pergunta;subpergunta;nome\n91;3;0;Data da notificação'],
    ] as const) {
      const ler = leitorDoArquivo(c, n);
      expect(ler?.(t).itens.length, `${c}/${n}`).toBe(1);
    }
  });
});

describe('leitura de vários arquivos', () => {
  it('junta itens e acusa edições diferentes e a edição informada divergente', () => {
    const a = arquivoTbProcedimento([{ codigo: '1', nome: 'A', competencia: '201312' }]);
    const b = arquivoTbProcedimento([{ codigo: '2', nome: 'B', competencia: '201401' }]);
    const r = lerArquivosDaCarga(
      'sigtap',
      [
        { nome: 'tb_procedimento.txt', conteudo: a },
        { nome: 'tb_procedimento_2.txt', conteudo: b },
      ],
      null,
    );
    expect(r.itens.map((i) => i.linha)).toEqual([1, 1_000_001]);
    expect(r.erros[0]?.mensagem).toContain('edições diferentes');
    const x = lerArquivosDaCarga(
      'simpro',
      [{ nome: 'SIMPRO.txt', conteudo: arquivoSimpro([{ codigo: '1', nome: 'X', valor: 1 }], '7') }],
      '8',
    );
    expect(x.erros[0]?.mensagem).toContain('difere');
    const y = lerArquivosDaCarga(
      'fiscal',
      [{ nome: 'cfop.txt', conteudo: 'CODIGO|DESCRICAO\n9999|X' }],
      null,
    );
    expect(y.edicao).toBeNull();
    expect(lerArquivosDaCarga('fiscal', [{ nome: 'cfop.txt', conteudo: 'x\n' }], null).erros.length).toBe(1);
  });
  it('CEPs sintéticos na faixa reservada', () => {
    const c = cepsSinteticos(2);
    expect(c.map((x) => x.cep)).toEqual(['90000000', '90000001']);
  });
});

describe('catálogos da ANS (M56, F6; D-IMPORT-56)', () => {
  it('cada arquivo pelo nome; a chave composta do SIP e a vigência da TPS em data ISO', () => {
    expect(leitorDoArquivo('ans', 'outro.csv')).toBeNull();
    const r = lerArquivosDaCarga(
      'ans',
      [
        { nome: 'SIP_GRUPOS_2026.csv', conteudo: 'CODIGO;NOME\n900;GRUPO SINTETICO' },
        {
          nome: 'SIP_PROCEDIMENTOS_2026.csv',
          conteudo: 'PROCEDIMENTO;GRUPO;INICIO\n99999901;900;01/01/2026',
        },
        {
          nome: 'TPS_2026.csv',
          conteudo: 'VIGENCIA;MES;ANO;VALOR_ANUAL;VALOR_TRIMESTRAL\n01/01/2029;3;2029;9,99;2,4975',
        },
        { nome: 'REMUNERACAO.csv', conteudo: 'CODIGO;NOME;INICIO\n8;MODELO SINTETICO;2026-01-01' },
      ],
      null,
    );
    expect(r.erros).toEqual([]);
    expect(r.itens.map((i) => i.entidade)).toEqual([
      'grupoSip',
      'procedimentoSip',
      'valorTps',
      'remuneracaoPrestador',
    ]);
    expect(r.itens[1]?.campos).toMatchObject({
      procedimento: '99999901',
      grupo: '900',
      inicio: '2026-01-01',
      fim: '9999-12-31',
    });
    expect(r.itens[2]?.campos).toMatchObject({ inicio: '2029-01-01', mes: '3', valorTrimestral: '2,4975' });
    const sem = lerArquivosDaCarga(
      'ans',
      [{ nome: 'SIP_PROCEDIMENTOS.csv', conteudo: 'CODIGO;GRUPO\n1;2' }],
      null,
    );
    expect(sem.erros.length).toBeGreaterThan(0);
  });
});
