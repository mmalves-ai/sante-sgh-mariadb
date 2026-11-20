import { describe, expect, it } from 'vitest';
import {
  arquivoBaseCep,
  arquivoBancos,
  arquivoBrasindice,
  arquivoCiap,
  arquivoCid10,
  arquivoCodigoNome,
  arquivoDcb,
  arquivoFiscal,
  arquivoRelacaoCbo,
  arquivoRelacaoCid,
  arquivoSimpro,
  arquivoTbProcedimento,
  arquivoTuss,
} from '../sinteticos.js';
import { camposCsv, indicesDoCabecalho, linhasDoTexto, separadorProvavel } from './comum.js';
import {
  LEIAUTE_BANCO,
  LEIAUTE_CBO,
  LEIAUTE_CIAP,
  LEIAUTE_CID10,
  LEIAUTE_CID_O,
  LEIAUTE_DCB,
  LEIAUTE_TUSS_38,
  leiauteFiscal,
  lerCsv,
} from './csv-oficiais.js';
import {
  lerBaseCep,
  lerBrasindice,
  lerRelacaoSigtap,
  lerSimpro,
  lerTbProcedimento,
  LEIAUTE_CEP_PADRAO,
} from './posicoes.js';

describe('partes comuns', () => {
  it('CSV com aspas, aspas duplicadas e separador escolhido', () => {
    expect(camposCsv('"a;b";"c ""d""";e', ';')).toEqual(['a;b', 'c "d"', 'e']);
    expect(separadorProvavel('A|B|C')).toBe('|');
    expect(separadorProvavel('A,B,C')).toBe(',');
    expect(linhasDoTexto('﻿A\r\n\r\nB').map((l) => l.texto)).toEqual(['A', 'B']);
  });
  it('cabeçalho por nome sem acento e falta de obrigatória', () => {
    const r = indicesDoCabecalho(
      ['Código', 'DESCRIÇÃO'],
      { codigo: ['codigo'], nome: ['descricao'], x: ['x'] },
      ['codigo', 'x'],
    );
    expect(r.indices).toEqual({ codigo: 0, nome: 1 });
    expect(r.faltam).toEqual(['x']);
  });
});

describe('CID-10, CIAP e CID-O', () => {
  it('lê subcategorias do DATASUS com sexo e classificação do banco', () => {
    const r = lerCsv(
      arquivoCid10([
        { codigo: 'U99.1', nome: 'DOENCA SGH', sexo: 'F', classif: '*' },
        { codigo: 'U98', nome: 'OUTRA' },
      ]),
      LEIAUTE_CID10,
    );
    expect(r.erros).toEqual([]);
    expect(r.itens.map((i) => i.campos)).toEqual([
      { codigo: 'U991', classificacao: '*', sexo: '3', nome: 'DOENCA SGH' },
      { codigo: 'U98', classificacao: '', sexo: '5', nome: 'OUTRA' },
    ]);
  });
  it('leiaute errado: nada é lido', () => {
    const r = lerCsv('CODIGO;OUTRA\nA00;x', LEIAUTE_CID10);
    expect(r.itens).toEqual([]);
    expect(r.erros[0]?.mensagem).toContain('faltam as colunas');
    expect(lerCsv('', LEIAUTE_CID10).erros[0]?.mensagem).toBe('arquivo vazio');
  });
  it('linha com código inválido e campo obrigatório vazio', () => {
    const r = lerCsv('SUBCAT;DESCRICAO\n0A;x\nA00;', LEIAUTE_CID10);
    expect(r.itens[0]?.erros[0]).toContain('CID inválido');
    expect(r.itens[1]?.erros).toEqual(['nome: vazio']);
    expect(lerCsv('SUBCAT;DESCRICAO\n;x', LEIAUTE_CID10).itens[0]?.erros).toEqual(['codigo: vazio']);
  });
  it('CIAP e CID-O', () => {
    expect(
      lerCsv(arquivoCiap([{ codigo: 'z99', original: 'Sintoma', leigo: 'Leigo' }]), LEIAUTE_CIAP).itens[0]
        ?.campos,
    ).toEqual({
      codigo: 'Z99',
      nomeOriginal: 'Sintoma',
      nomeLeigo: 'Leigo',
      sexo: '5',
    });
    expect(lerCsv('cid;morfologia\nD11.0;8147/3', LEIAUTE_CID_O).itens[0]?.campos).toEqual({
      cid: 'D110',
      morfologia: 'M81473',
    });
  });
});

describe('TUSS, CBO, listas e fiscais', () => {
  it('TUSS 38 com datas brasileiras; data inválida é erro da linha', () => {
    const r = lerCsv(
      arquivoTuss([{ codigo: '9001', nome: 'GLOSA SGH', inicio: '01/02/2026', fim: '31/02/2026' }]),
      LEIAUTE_TUSS_38,
    );
    expect(r.itens[0]?.campos).toMatchObject({ codigo: '9001', inicio: '2026-02-01', fim: null });
    expect(r.itens[0]?.erros[0]).toContain('data inválida');
  });
  it('CBO com zeros, DCB com CAS, bancos do STR e fiscal com barra', () => {
    expect(
      lerCsv(arquivoCodigoNome('CODIGO;TITULO', [{ codigo: '22512', nome: 'MEDICO' }]), LEIAUTE_CBO).itens[0]
        ?.campos,
    ).toEqual({ codigo: '022512', nome: 'MEDICO' });
    expect(
      lerCsv(arquivoDcb([{ codigo: '9901', nome: 'SUBSTANCIA', cas: '50-00-0' }]), LEIAUTE_DCB).itens[0]
        ?.campos,
    ).toEqual({ codigo: '9901', nome: 'SUBSTANCIA', cas: '50-00-0' });
    expect(
      lerCsv(arquivoBancos([{ codigo: '1', nome: 'BANCO SGH' }]), LEIAUTE_BANCO).itens[0]?.campos,
    ).toEqual({ codigo: '001', nome: 'BANCO SGH' });
    expect(
      lerCsv(arquivoFiscal([{ codigo: '9999', nome: 'CFOP SGH' }]), leiauteFiscal('cfop')).itens[0]?.campos,
    ).toEqual({
      codigo: '9999',
      nome: 'CFOP SGH',
      inicio: '2026-01-01',
      fim: null,
    });
  });
});

describe('SIGTAP (posições fixas, centavos)', () => {
  const comp = '202610';
  it('tb_procedimento com valores e competência do arquivo', () => {
    const r = lerTbProcedimento(
      arquivoTbProcedimento([
        { codigo: '0301010072', nome: 'CONSULTA SGH', competencia: comp, valorSh: 10.5, valorSp: 2 },
      ]),
    );
    expect(r.erros).toEqual([]);
    expect(r.edicao).toBe(comp);
    expect(r.itens[0]?.campos).toMatchObject({
      codigo: '0301010072',
      nome: 'CONSULTA SGH',
      valorSh: 10.5,
      valorSa: 0,
      valorSp: 2,
      complexidade: '2',
      sexo: 'I',
      financiamento: '06',
    });
  });
  it('linha curta e competências misturadas são erro do arquivo', () => {
    const r = lerTbProcedimento(
      `curta\n${arquivoTbProcedimento([
        { codigo: '1', nome: 'A', competencia: '202609' },
        { codigo: '2', nome: 'B', competencia: '202610' },
      ])}`,
    );
    expect(r.erros.map((e) => e.mensagem)).toEqual([
      'leiaute: linha com 5 posições (esperadas 336)',
      'leiaute: o arquivo mistura competências (202609, 202610)',
    ]);
    expect(r.edicao).toBeNull();
  });
  it('relações com CID e CBO', () => {
    const c = lerRelacaoSigtap(arquivoRelacaoCid([{ procedimento: '0301010072', cid: 'A00' }], comp), 'cid');
    expect(c.itens[0]?.campos).toEqual({ procedimento: '0301010072', cid: 'A00' });
    expect(c.edicao).toBe(comp);
    const o = lerRelacaoSigtap(
      arquivoRelacaoCbo([{ procedimento: '0301010072', cbo: '225125' }], comp),
      'cbo',
    );
    expect(o.itens[0]?.campos).toEqual({ procedimento: '0301010072', cbo: '225125' });
    expect(lerRelacaoSigtap('x', 'cbo').erros[0]?.mensagem).toContain('esperadas 22');
  });
});

describe('base de CEP pelo leiaute de posições', () => {
  it('localidades dão o IBGE; logradouros dão os CEPs', () => {
    const t = arquivoBaseCep(
      [
        {
          cep: '99990001',
          uf: 'RJ',
          cidade: 'Campos dos Goytacazes',
          logradouro: 'Rua SGH',
          bairro: 'Centro',
          tipo: 'Rua',
        },
      ],
      [{ ibge: '3301009', nome: 'Campos dos Goytacazes', uf: 'RJ' }],
    );
    const r = lerBaseCep(t);
    expect(r.erros).toEqual([]);
    expect(r.itens.find((i) => i.entidade === 'municipio')?.campos).toEqual({
      ibge: '3301009',
      nome: 'Campos dos Goytacazes',
      uf: 'RJ',
    });
    expect(r.itens.find((i) => i.entidade === 'cep')?.campos).toEqual({
      cep: '99990001',
      uf: 'RJ',
      cidade: 'Campos dos Goytacazes',
      logradouro: 'Rua SGH',
      bairro: 'Centro',
      tipoLogradouro: 'Rua',
      ibge: '3301009',
    });
  });
  it('registro fora de seção e arquivo sem seção', () => {
    expect(lerBaseCep('qualquer coisa').erros[0]?.mensagem).toContain('antes de qualquer seção');
    expect(lerBaseCep('', LEIAUTE_CEP_PADRAO).erros[0]?.mensagem).toContain('nenhuma seção');
  });
});

describe('Brasíndice e Simpro (sintéticos no leiaute do fornecedor)', () => {
  it('Brasíndice com edição do arquivo', () => {
    const r = lerBrasindice(
      arquivoBrasindice(
        [{ codigo: '96999001', nome: 'MEDICAMENTO SGH', laboratorio: 9001, pmc: 12.5, pfb: 9.99 }],
        '1096',
      ),
    );
    expect(r.edicao).toBe('1096');
    expect(r.itens[0]?.campos).toEqual({
      codigo: '96999001',
      nome: 'MEDICAMENTO SGH',
      laboratorio: 9001,
      pmc: 12.5,
      pfb: 9.99,
      classificacao: 2,
      apresentacao: 'SG01',
      fator: 1,
      tuss: 90000001,
    });
    expect(lerBrasindice('"1";"2"').erros[0]?.mensagem).toContain('esperados 8');
  });
  it('Simpro com valor em centavos', () => {
    const r = lerSimpro(arquivoSimpro([{ codigo: '7999001', nome: 'MATERIAL SGH', valor: 3.21 }], '2026'));
    expect(r.edicao).toBe('2026');
    expect(r.itens[0]?.campos).toEqual({
      codigo: '7999001',
      nome: 'MATERIAL SGH',
      valor: 3.21,
      classificacao: 1,
      unidade: 'UN',
      fabricante: 1,
      registroAnvisa: '80000000000',
      referenciaFabricante: 'REF SGH',
      identificacao: 'F',
      tuss: 0,
    });
    expect(lerSimpro('x').erros[0]?.mensagem).toContain('esperadas 128');
  });
});
