import { describe, expect, it } from 'vitest';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import {
  caminhoRegistroFim,
  esquemaPainelFimCoexistencia,
  esquemaRegistroFimCoexistencia,
  FONTE_ITEM_FIM,
  ITENS_FIM_CAP14,
  ITENS_FIM_CAP15,
  PERMISSOES_M43,
} from './fim.js';

const minimo = { formato: 1, estabelecimento: 'pc' } as const;

describe('registro do fim da coexistência (M43)', () => {
  it('aceita o registro mínimo e preenche as listas vazias', () => {
    const r = esquemaRegistroFimCoexistencia.parse(minimo);
    expect(r.ensaios).toEqual([]);
    expect(r.paineis).toEqual([]);
    expect(r.fimRegistrado).toBeNull();
    expect(caminhoRegistroFim('pc')).toBe('docs/coexistencia/fim/pc.yaml');
  });

  it('recusa dado pessoal no texto livre (dígitos em sequência e e-mail)', () => {
    const ensaio = (observacao: string) => ({
      ...minimo,
      ensaios: [{ tipo: 'kit-papel', data: '2027-01-10', papeis: ['ti'], resultado: 'aprovado', observacao }],
    });
    expect(esquemaRegistroFimCoexistencia.safeParse(ensaio('papel conferido no posto 3')).success).toBe(true);
    expect(esquemaRegistroFimCoexistencia.safeParse(ensaio('prontuário 123456')).success).toBe(false);
    expect(esquemaRegistroFimCoexistencia.safeParse(ensaio('fale com a@b.com')).success).toBe(false);
  });

  it('recusa login de painel repetido e fim registrado sem ata', () => {
    const p = { login: 'TV01', dispositivo: 3, conferidoEm: '2027-01-12', papel: 'ti' };
    expect(
      esquemaRegistroFimCoexistencia.safeParse({ ...minimo, paineis: [p, { ...p, login: 'tv01' }] }).success,
    ).toBe(false);
    expect(
      esquemaRegistroFimCoexistencia.safeParse({
        ...minimo,
        fimRegistrado: { data: '2027-01-31', papel: 'dono-do-projeto' },
      }).success,
    ).toBe(false);
  });

  it('nome de pessoa nunca entra no papel', () => {
    const r = esquemaRegistroFimCoexistencia.safeParse({
      ...minimo,
      aceiteDiretoria: { data: '2027-01-30', papel: 'Fulano' },
    });
    expect(r.success).toBe(false);
  });

  it('DP-6 decidida ou com data prevista', () => {
    expect(
      esquemaRegistroFimCoexistencia.safeParse({ ...minimo, dp6: { previstaPara: '2027-03-01' } }).success,
    ).toBe(true);
    expect(esquemaRegistroFimCoexistencia.safeParse({ ...minimo, dp6: { decisao: 'x' } }).success).toBe(
      false,
    );
  });
});

describe('painel do fim', () => {
  it('toda fonte está descrita e os dois conjuntos não se sobrepõem', () => {
    for (const i of [...ITENS_FIM_CAP15, ...ITENS_FIM_CAP14]) expect(FONTE_ITEM_FIM[i]).toBeTruthy();
    expect(ITENS_FIM_CAP15.filter((i) => (ITENS_FIM_CAP14 as readonly string[]).includes(i))).toEqual([]);
  });

  it('valida a resposta', () => {
    const r = esquemaPainelFimCoexistencia.safeParse({
      estabelecimento: 'pc',
      medidoEm: '2027-01-20T10:00:00Z',
      cap15: [
        {
          item: 'sem-s1-aberto',
          conjunto: 'cap15',
          situacao: 'verde',
          valor: '0',
          parcelas: [{ rotulo: 'S1 abertos', valor: 0 }],
          fonte: FONTE_ITEM_FIM['sem-s1-aberto'],
          verdeDesde: '2027-01-05',
          motivo: null,
        },
      ],
      cap14: [],
      fimRegistravel: false,
      pendencias: ['x'],
      fimRegistradoEm: null,
      divergencias: [],
    });
    expect(r.success).toBe(true);
  });
});

describe('permissões do M43', () => {
  it('são as dos marcos de origem, todas no catálogo (nenhuma nova)', () => {
    const codigos = new Set(CATALOGO_DECLARADO.map((p) => p.codigo));
    for (const c of Object.values(PERMISSOES_M43)) expect(codigos.has(c), c).toBe(true);
  });
});
