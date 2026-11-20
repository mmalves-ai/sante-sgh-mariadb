import { definicaoCatalogo, type DefinicaoCatalogo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { compararEdicao } from './comparacao.js';
import { camposDaChave, chaveDoItem, validarItens } from './validacao.js';

const cid = definicaoCatalogo('cid') as DefinicaoCatalogo;
const tuss = definicaoCatalogo('tuss') as DefinicaoCatalogo;
const sigtap = definicaoCatalogo('sigtap') as DefinicaoCatalogo;
const item = (
  entidade: string,
  linha: number,
  campos: Record<string, string | number | null>,
  erros: string[] = [],
) => ({ entidade, linha, campos, erros });

describe('validação (regra 6: leiaute, totais e duplicados; regra 7: charset)', () => {
  it('totais, duplicado pela chave, obrigatório, tamanho e troca proposta', () => {
    const r = validarItens(cid, [
      item('cid10', 2, { codigo: 'U991', nome: 'A ≥ B', classificacao: '', sexo: '5' }),
      item('cid10', 3, { codigo: 'U991', nome: 'repetido', classificacao: '', sexo: '5' }),
      item('cid10', 4, { codigo: 'U992', nome: null, classificacao: '', sexo: '5' }),
      item('cid10', 5, { codigo: 'U993', nome: 'x'.repeat(271), classificacao: '', sexo: '5' }),
      item('cid10', 6, { codigo: 'U994', nome: 'ok', classificacao: '', sexo: '5' }, ['erro da leitura']),
      item('outra', 7, {}),
    ]);
    expect(r.totais).toEqual({ linhas: 6, validas: 1, erros: 5 });
    expect(r.itens[0]).toMatchObject({
      resultado: 'valida',
      chave: 'codigo=U991',
      campos: { nome: 'A >= B' },
    });
    expect(r.itens[0]?.motivos[0]).toContain('troca proposta');
    expect(r.itens[1]?.motivos).toEqual(['duplicado: a mesma chave já veio na linha 2']);
    expect(r.itens[2]?.motivos).toEqual(['nome: obrigatório']);
    expect(r.itens[3]?.motivos[0]).toContain('máximo 270');
    expect(r.itens[4]?.motivos).toEqual(['erro da leitura']);
    expect(r.itens[5]?.motivos).toEqual(['entidade desconhecida']);
  });
  it('tipos inteiro, decimal e data', () => {
    const r = validarItens(sigtap, [
      item('procedimento', 1, {
        codigo: '0301010072',
        nome: 'X',
        quantidadeMaxima: 'a',
        valorSh: -1,
        valorSa: '2,5',
      }),
    ]);
    expect(r.itens[0]?.motivos).toEqual(['quantidadeMaxima: inteiro esperado', 'valorSh: valor inválido']);
    expect(r.itens[0]?.campos['valorSa']).toBe(2.5);
    const longo = validarItens(sigtap, [
      item('procedimento', 1, { codigo: '0301010072', nome: 'N'.repeat(120) }),
    ]);
    expect(longo.itens[0]).toMatchObject({ resultado: 'valida', campos: { nome: 'N'.repeat(100) } });
    expect(longo.itens[0]?.motivos[0]).toContain('cortado em 100');
    const t = validarItens(tuss, [item('cboAns', 1, { codigo: '225125', nome: 'X', inicio: '01/01/2026' })]);
    expect(t.itens[0]?.motivos).toEqual(['inicio: data inválida']);
  });
  it('chave composta e de volta', () => {
    const e = cid.entidades[2];
    if (!e) throw new Error();
    const c = chaveDoItem(e, { cid: 'D110', morfologia: 'M81473' });
    expect(c).toBe('cid=D110;morfologia=M81473');
    expect(camposDaChave(c)).toEqual({ cid: 'D110', morfologia: 'M81473' });
  });
});

describe('comparação de edições (regras 4 e 5)', () => {
  const v = validarItens(tuss, [
    item('motivoGlosa', 1, { codigo: '9001', nome: 'NOVO', inicio: null, fim: null }),
    item('motivoGlosa', 2, { codigo: '9002', nome: 'MUDOU', inicio: null, fim: null }),
    item('motivoGlosa', 3, { codigo: '9003', nome: 'IGUAL', inicio: null, fim: null }),
    item('motivoGlosa', 4, { codigo: '3095', nome: 'OUTRO NOME', inicio: null, fim: null }),
    item('motivoGlosa', 5, { codigo: '0', nome: 'NOVO ZERO', inicio: null, fim: null }),
    item('motivoGlosa', 6, { codigo: '9005', nome: null, inicio: null, fim: null }),
  ]);
  const atuais = new Map([
    [
      'motivoGlosa',
      new Map([
        ['codigo=9002', { codigo: '9002', nome: 'ANTES', inicio: null, fim: null }],
        ['codigo=9003', { codigo: '9003', nome: 'IGUAL ', inicio: null, fim: null }],
        ['codigo=3095', { codigo: '3095', nome: 'RECURSO DE GLOSA ACATADO', inicio: null, fim: null }],
        ['codigo=9004', { codigo: '9004', nome: 'SAIU DA FONTE', inicio: null, fim: null }],
      ]),
    ],
  ]);
  const r = compararEdicao(tuss, v.itens, atuais);
  const de = (k: string) => r.itens.find((i) => i.chave === k);
  it('novo, alterado (só o que mudou), igual, removido na fonte e protegidos', () => {
    expect(r.totais).toEqual({ novos: 2, alterados: 2, iguais: 1, removidos: 1 });
    expect(de('codigo=9001')).toMatchObject({ comparacao: 'novo', publicar: true });
    expect(de('codigo=9002')).toMatchObject({
      comparacao: 'alterado',
      depois: { nome: 'MUDOU' },
      publicar: true,
    });
    expect(de('codigo=9003')).toMatchObject({ comparacao: 'igual', publicar: false });
    expect(de('codigo=3095')).toMatchObject({ comparacao: 'alterado', publicar: false });
    expect(de('codigo=3095')?.motivos).toContain('código protegido: nunca alterado');
    expect(de('codigo=0')).toMatchObject({ comparacao: 'novo', publicar: false });
    expect(de('codigo=9004')).toMatchObject({ comparacao: 'removido', publicar: false, linha: 9_000_000 });
    expect(de('codigo=9005')).toMatchObject({ resultado: 'erro', comparacao: null, publicar: false });
  });
  it('por edição: o existente igual também é publicado na edição nova', () => {
    const v2 = validarItens(sigtap, [item('procedimento', 1, { codigo: '0301010072', nome: 'IGUAL' })]);
    const x = compararEdicao(
      sigtap,
      v2.itens,
      new Map([['procedimento', new Map([['codigo=0301010072', { codigo: '0301010072', nome: 'IGUAL' }]])]]),
    );
    expect(x.itens[0]).toMatchObject({ comparacao: 'igual', publicar: true });
  });
  it('entidade só de inclusão não sobrescreve; removidos limitados ao escopo e pelas chaves existentes', () => {
    const cidV = validarItens(cid, [item('cidMorfologia', 1, { cid: 'D110', morfologia: 'M81473' })]);
    const x = compararEdicao(cid, cidV.itens, new Map(), {
      existentes: new Map([['cidMorfologia', ['cid=D110;morfologia=M81470', 'cid=C50;morfologia=M80003']]]),
      escopo: (_e, c) => c['cid'] === 'D110',
    });
    expect(x.totais).toEqual({ novos: 1, alterados: 0, iguais: 0, removidos: 1 });
    const so = compararEdicao(
      cid,
      cidV.itens,
      new Map([
        [
          'cidMorfologia',
          new Map([['cid=D110;morfologia=M81473', { cid: 'D110', morfologia: 'M81473', extra: 'a' }]]),
        ],
      ]),
    );
    expect(so.totais.iguais).toBe(1);
  });
});
