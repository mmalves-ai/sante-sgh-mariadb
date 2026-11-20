import { describe, expect, it } from 'vitest';
import { esquemaCriarTituloPagar } from '../financeiro/entradas.js';
import {
  cenarioDoDestino,
  DESTINOS_TITULO_FOLHA,
  esquemaGravarIntegracaoFolha,
  esquemaLancarTitulosFolha,
  ROTINA_DO_DESTINO,
  ROTINAS_TITULO_FOLHA,
} from './folha-titulos.js';

const titulo = {
  chave: 'fgts:2026-10-20',
  destino: 'fgts',
  rotina: 15,
  credor: 900,
  documento: 2_026_091_520,
  vencimento: '2026-10-20',
  valor: 54_400,
  classificacao: { grupo: 296, subgrupo: 4, item: 2 },
  referente: 'Folha 09/2026: FGTS',
};
const folha = {
  acao: 'incluir-folha',
  empresa: 1,
  origem: 'fechamento',
  idOrigem: 7,
  apuracao: 'mensal',
  periodo: '2026-09',
  resumo: 'a'.repeat(64),
  emissao: '2026-09-30',
  liquido: 0,
  encargos: 54_400,
  titulos: [titulo],
};

describe('contrato dos títulos da folha (M53-F8)', () => {
  it('cada destino tem rotina e cenário; as rotinas são as do cadastro', () => {
    for (const d of DESTINOS_TITULO_FOLHA) expect(ROTINA_DO_DESTINO[d]).toBeGreaterThan(0);
    expect(ROTINAS_TITULO_FOLHA).toEqual([4, 6, 11, 12, 14, 15, 16, 17, 18]);
    expect(cenarioDoDestino('liquido-rescisao')).toBe('origem-folha');
    expect(cenarioDoDestino('irrf')).toBe('origem-encargo');
  });

  it('a ação incluir-folha de criarTituloPagar: centavos inteiros, fatos opcionais, nada de campo a mais', () => {
    const ok = esquemaCriarTituloPagar.parse(folha);
    expect(ok.acao === 'incluir-folha' && ok.fatos).toEqual([]);
    expect(
      esquemaCriarTituloPagar.safeParse({ ...folha, titulos: [{ ...titulo, valor: 1.5 }] }).success,
    ).toBe(false);
    expect(esquemaCriarTituloPagar.safeParse({ ...folha, titulos: [] }).success).toBe(false);
    expect(esquemaCriarTituloPagar.safeParse({ ...folha, cpf: '1' }).success).toBe(false);
    expect(esquemaCriarTituloPagar.safeParse({ ...folha, periodo: '2026-13' }).success).toBe(false);
  });

  it('o de-para recusa destino repetido; o lançamento exige o resumo da prévia', () => {
    const d = {
      destino: 'inss',
      credor: 1,
      classificacao: { grupo: 296, subgrupo: 4, item: 2 },
      diaVencimento: 20,
      mesesDepois: 1,
    };
    expect(
      esquemaGravarIntegracaoFolha.safeParse({ empresa: 1, inicio: '2026-09-01', destinos: [d] }).success,
    ).toBe(true);
    expect(
      esquemaGravarIntegracaoFolha.safeParse({ empresa: 1, inicio: '2026-09-01', destinos: [d, d] }).success,
    ).toBe(false);
    expect(
      esquemaGravarIntegracaoFolha.safeParse({
        empresa: 1,
        inicio: '2026-09-01',
        destinos: [{ ...d, classificacao: { grupo: 0, subgrupo: 0, item: 0 } }],
      }).success,
    ).toBe(false);
    expect(
      esquemaLancarTitulosFolha.safeParse({
        empresa: 1,
        origem: 'fechamento',
        id: 1,
        resumo: 'x',
        emissao: '2026-09-30',
      }).success,
    ).toBe(false);
  });
});
