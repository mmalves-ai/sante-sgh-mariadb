import { describe, expect, it } from 'vitest';
import {
  arvoreDaEstrutura,
  arvoreDeLeitos,
  chaveAcomodacao,
  chaveLeito,
  conferirChave,
  mudaChave,
} from './hierarquia.js';

describe('árvore da estrutura', () => {
  const unidades = [
    { codigo: 2, nome: 'Unidade B', cnes: 0, ativa: false },
    { codigo: 1, nome: 'Unidade A', cnes: 1234567, ativa: true },
  ];
  it('empresa → hospital → unidades, em ordem de código; CNES 0 vira vazio', () => {
    const a = arvoreDaEstrutura({
      empresa: { codigo: 1, nome: 'Empresa sintética', ativa: true },
      hospital: { codigo: 1, nome: 'Hospital sintético', cnes: 0 },
      unidades,
    });
    expect(a).toHaveLength(1);
    expect(a[0]?.tipo).toBe('empresa');
    const h = a[0]?.filhos[0];
    expect(h?.tipo).toBe('hospital');
    expect(h?.cnes).toBeNull();
    expect(h?.filhos.map((u) => [u.codigo, u.cnes, u.ativo])).toEqual([
      ['1', 1234567, true],
      ['2', null, false],
    ]);
  });
  it('sem empresa: o hospital é a raiz; sem hospital: as unidades', () => {
    expect(
      arvoreDaEstrutura({ empresa: null, hospital: { codigo: 1, nome: 'H', cnes: 99 }, unidades })[0]?.cnes,
    ).toBe(99);
    expect(arvoreDaEstrutura({ empresa: null, hospital: null, unidades }).map((u) => u.tipo)).toEqual([
      'unidade',
      'unidade',
    ]);
    expect(
      arvoreDaEstrutura({ empresa: { codigo: 1, nome: 'E', ativa: true }, hospital: null, unidades })[0]
        ?.filhos,
    ).toHaveLength(2);
  });
});

describe('blocos, acomodações e leitos', () => {
  const blocos = [
    { bloco: '2', nome: 'Bloco 2', andares: 1 },
    { bloco: '1', nome: 'Bloco 1', andares: 3 },
  ];
  const acomodacoes = [
    { bloco: '1', acomodacao: '101', nome: 'Apto 101', leitosPrevistos: 2, clinica: 'M', centroCusto: 10 },
    { bloco: '1', acomodacao: '100', nome: 'Apto 100', leitosPrevistos: 1, clinica: null, centroCusto: null },
  ];
  const l = (id: number, bloco: string, ac: string, leito: string, ativo = true, ocupado = false) => ({
    id,
    bloco,
    acomodacao: ac,
    leito,
    ativo,
    ocupado,
    ramal: null,
  });
  it('agrupa e conta ativos e ocupados; leito sem acomodação fica à parte', () => {
    const a = arvoreDeLeitos(blocos, acomodacoes, [
      l(1, '1', '101', 'B'),
      l(2, '1', '101', 'A', true, true),
      l(3, '1', '100', 'A', false),
      l(4, '9', '999', 'X'),
    ]);
    expect(a.blocos.map((b) => b.bloco)).toEqual(['1', '2']);
    const b1 = a.blocos[0];
    expect(b1?.acomodacoes.map((x) => x.acomodacao)).toEqual(['100', '101']);
    expect(b1?.acomodacoes[1]?.leitos.map((x) => x.leito)).toEqual(['A', 'B']);
    expect([b1?.ativos, b1?.ocupados]).toEqual([2, 1]);
    expect(a.orfaos.map((x) => x.id)).toEqual([4]);
    expect(a.totais).toEqual({ leitos: 4, ativos: 3, ocupados: 1 });
    expect(a.blocos[1]?.acomodacoes).toEqual([]);
  });
  it('chaves textuais exatas sem o preenchimento à direita', () => {
    expect(chaveLeito('1  ', '101 ', 'A')).toBe('1|101|A');
    expect(chaveAcomodacao('1 ', '101')).toBe('1|101');
  });
  it('confere a chave digitada', () => {
    expect(conferirChave('', 5)).toBe('vazio');
    expect(conferirChave('123456', 5)).toBe('longo');
    expect(conferirChave(' 12', 5)).toBe('espacos');
    expect(conferirChave('1ç', 5)).toBe('caractere');
    expect(conferirChave('UTI-1', 5)).toBeNull();
  });
  it('código em uso não muda (regra 16)', () => {
    expect(mudaChave({ bloco: '1', nome: 'x' }, { bloco: '2', nome: 'y' }, ['bloco'])).toEqual(['bloco']);
    expect(mudaChave({ bloco: '1' }, { nome: 'y' }, ['bloco'])).toEqual([]);
    expect(mudaChave({ bloco: '1' }, { bloco: '1' }, ['bloco'])).toEqual([]);
  });
});
