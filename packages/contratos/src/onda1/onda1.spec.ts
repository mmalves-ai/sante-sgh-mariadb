import { describe, expect, it } from 'vitest';
import {
  esquemaIndicadoresDisputa,
  esquemaItemLigar,
  ITENS_LIGAR_SETOR,
  ITENS_POR_SETOR,
  OPERACOES_FICHA_ONDA_1,
  operacoesForaDaOnda1,
  operacoesLiberaveisOnda1,
  ROTULO_INDICADOR_DISPUTA,
  ROTULO_ITEM_LIGAR,
  SETORES_ONDA_1,
} from './onda1.js';

describe('onda 1: contratos', () => {
  it('cada setor libera uma lista sem repetição e sem a agenda de exames (DP-8)', () => {
    for (const s of SETORES_ONDA_1) {
      const l = operacoesLiberaveisOnda1(s);
      expect(new Set(l).size).toBe(l.length);
      expect(l.some((n) => /Exame/.test(n))).toBe(false);
    }
    expect(operacoesForaDaOnda1().map((o) => o.nome)).toEqual([
      'agenda.agendarExame',
      'agenda.cancelarExame',
      'agenda.gerarGradeExame',
      'agenda.definirCoberturaExame',
    ]);
  });

  it('nenhum nome do catálogo aparece em duas linhas da ficha', () => {
    const todos = OPERACOES_FICHA_ONDA_1.flatMap((o) => o.catalogo);
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('todo item e indicador tem rótulo de produto sem o nome do outro sistema', () => {
    for (const i of ITENS_LIGAR_SETOR) expect(ROTULO_ITEM_LIGAR[i]).toBeTruthy();
    const textos = [...Object.values(ROTULO_ITEM_LIGAR), ...Object.values(ROTULO_INDICADOR_DISPUTA)];
    for (const t of textos) expect(t).not.toMatch(/spdata|legado/i);
    for (const s of SETORES_ONDA_1) expect(ITENS_POR_SETOR[s]).toContain('operacoes-conferidas');
  });

  it('esquemas: data civil e evidência curta', () => {
    expect(esquemaItemLigar.parse({ item: 'tvs', situacao: 'cumprido' })).toEqual({
      item: 'tvs',
      situacao: 'cumprido',
      evidencia: '',
      em: null,
    });
    expect(() => esquemaItemLigar.parse({ item: 'tvs', situacao: 'cumprido', em: '09/11/2026' })).toThrow();
    expect(() =>
      esquemaIndicadoresDisputa.parse({ hospital: 'pc', dia: '2026-11-9', setores: [] }),
    ).toThrow();
  });
});
