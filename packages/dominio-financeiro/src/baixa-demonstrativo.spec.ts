// F3.8, 07-FIN linha 76: a regra da baixa dos títulos pelo demonstrativo de pagamento da operadora (dados sintéticos).
import { describe, expect, it } from 'vitest';
import {
  type EntradaBaixaDemonstrativo,
  type LinhaDoDemonstrativo,
  planejarBaixaDemonstrativo,
  type TituloDoDemonstrativo,
} from './index.js';

const linha = (
  itemConta: number | null,
  titulo: number | null,
  informado: number,
  liberado: number,
  glosa = 0,
  motivoGlosa: number | null = null,
): LinhaDoDemonstrativo => ({ itemConta, titulo, informado, liberado, glosa, motivoGlosa });
const titulo = (
  id: number,
  saldo: number,
  extra: Partial<TituloDoDemonstrativo> = {},
): TituloDoDemonstrativo => ({
  titulo: id,
  situacao: 'aberto',
  parcela: id * 10,
  saldo,
  ...extra,
});
const entrada = (extra: Partial<EntradaBaixaDemonstrativo> = {}): EntradaBaixaDemonstrativo => ({
  situacao: 'importado',
  jaBaixado: false,
  linhas: [linha(1, 5, 100, 100), linha(2, 5, 200, 150, 50, 9), linha(3, 5, 80, 0, 80, 4)],
  titulos: [titulo(5, 380)],
  ...extra,
});
const codigo = (r: unknown) => (r as { codigo?: string }).codigo ?? 'plano';

describe('baixa pelo demonstrativo de pagamento', () => {
  it('uma baixa por título com o recebido e a glosa por item; a glosa não quita o título', () => {
    const p = planejarBaixaDemonstrativo(entrada());
    if ('codigo' in p) throw new Error(p.codigo);
    expect(p.baixas).toHaveLength(1);
    expect(p.baixas[0]).toMatchObject({
      titulo: 5,
      parcela: 50,
      recebido: 250,
      glosa: 130,
      saldoRestante: 130,
    });
    expect(p.baixas[0]?.quita).toBe(false);
    expect(p.baixas[0]?.itens.map((i) => i.situacao)).toEqual(['recebido', 'parcial', 'glosado']);
    expect(p.baixas[0]?.itens[1]).toMatchObject({
      apresentado: 200,
      recebido: 150,
      glosa: 50,
      motivoGlosa: 9,
    });
    expect(p).toMatchObject({ totalRecebido: 250, totalGlosa: 130, linhasSemTitulo: 0, valorSemTitulo: 0 });
  });

  it('pagamento integral quita; títulos diferentes recebem baixas separadas', () => {
    const p = planejarBaixaDemonstrativo(
      entrada({
        linhas: [linha(1, 5, 100, 100), linha(2, 6, 70.1, 70.1), linha(3, 6, 29.9, 29.9)],
        titulos: [titulo(5, 100), titulo(6, 100)],
      }),
    );
    if ('codigo' in p) throw new Error(p.codigo);
    expect(p.baixas.map((b) => [b.titulo, b.recebido, b.quita])).toEqual([
      [5, 100, true],
      [6, 100, true],
    ]);
    expect(p.totalRecebido).toBe(200);
  });

  it('duas linhas do mesmo item da conta viram um item só, somado', () => {
    const p = planejarBaixaDemonstrativo(
      entrada({ linhas: [linha(1, 5, 50, 40, 10, 3), linha(1, 5, 50, 50)], titulos: [titulo(5, 100)] }),
    );
    if ('codigo' in p) throw new Error(p.codigo);
    expect(p.baixas[0]?.itens).toEqual([
      { itemConta: 1, apresentado: 100, recebido: 90, glosa: 10, motivoGlosa: 3, situacao: 'parcial' },
    ]);
  });

  it('a linha sem item da conta ou sem título fica de fora e é contada; a linha zerada é ignorada', () => {
    const p = planejarBaixaDemonstrativo(
      entrada({
        linhas: [
          linha(1, 5, 100, 100),
          linha(null, null, 40, 40),
          linha(8, null, 60, 25, 35),
          linha(9, 5, 0, 0),
        ],
        titulos: [titulo(5, 100)],
      }),
    );
    if ('codigo' in p) throw new Error(p.codigo);
    expect(p.linhasSemTitulo).toBe(2);
    expect(p.valorSemTitulo).toBe(65);
    expect(p.baixas[0]?.itens).toHaveLength(1);
  });

  it.each([
    ['demonstrativo-cancelado', entrada({ situacao: 'cancelado' })],
    ['demonstrativo-ja-baixado', entrada({ jaBaixado: true })],
    ['demonstrativo-sem-titulo', entrada({ linhas: [linha(null, null, 10, 10)] })],
    ['demonstrativo-sem-titulo', entrada({ linhas: [] })],
    ['titulo-nao-aberto', entrada({ titulos: [titulo(5, 0, { situacao: 'recebido', parcela: null })] })],
    ['titulo-nao-aberto', entrada({ titulos: [titulo(5, 380, { situacao: 'renegociado' })] })],
    ['titulo-nao-aberto', entrada({ titulos: [] })],
    ['recebido-acima-do-saldo', entrada({ titulos: [titulo(5, 249.98)] })],
  ])('recusa %s', (esperado, e) => {
    expect(codigo(planejarBaixaDemonstrativo(e))).toBe(esperado);
  });
});
