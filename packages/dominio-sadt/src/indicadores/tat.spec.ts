// Regra 12 (ficha do M26): TAT pela inclusão e pela liberação, sem sentinela. Casos traduzidos de
// sante-api test/gestao.test.js ("TAT ignora as colunas com data sentinela": a média sai da inclusão e da liberação,
// nunca da digitação nem da emissão), sem dado real.
import { describe, expect, it } from 'vitest';
import { dataValida, horasMedias, linhasTat, minutosPedidoLiberacao, pendenteHaMaisDe24h } from './tat.js';

describe('TAT do pedido à liberação (regra 12)', () => {
  it('sentinela 1899-12-30 e ano 5202 ficam fora', () => {
    expect(dataValida('1899-12-30T00:00:00Z')).toBe(false);
    expect(dataValida('5202-01-01T00:00:00Z')).toBe(false);
    expect(dataValida(null)).toBe(false);
    expect(dataValida('inválida')).toBe(false);
    expect(dataValida('2026-06-01T10:00:00Z')).toBe(true);
  });

  it('minutos do pedido à liberação de um exame', () => {
    expect(minutosPedidoLiberacao('2026-06-01T10:00:00Z', '2026-06-01T13:30:00Z')).toBe(210);
    expect(minutosPedidoLiberacao('1899-12-30T00:00:00Z', '2026-06-01T13:30:00Z')).toBeNull();
    expect(minutosPedidoLiberacao('2026-06-01T10:00:00Z', null)).toBeNull();
    expect(minutosPedidoLiberacao('2026-06-02T10:00:00Z', '2026-06-01T10:00:00Z')).toBeNull();
  });

  it('linhas por setor e prioridade com as parcelas; as horas médias como a sante-api (10 exames, 17 h)', () => {
    const linhas = linhasTat([
      {
        setor: 'laboratorio',
        urgente: false,
        exames: 8,
        liberados: 8,
        comMarcas: 8,
        somaMinutos: 8 * 17 * 60,
      },
      {
        setor: 'laboratorio',
        urgente: true,
        exames: 2,
        liberados: 2,
        comMarcas: 2,
        somaMinutos: 2 * 17 * 60,
      },
      { setor: 'imagem', urgente: false, exames: 5, liberados: 1, comMarcas: 0, somaMinutos: 0 },
      { setor: 'laboratorio', urgente: false, exames: 1, liberados: 1, comMarcas: 0, somaMinutos: 0 },
    ]);
    expect(linhas).toEqual([
      {
        setor: 'imagem',
        prioridade: 'rotina',
        exames: 5,
        liberados: 1,
        mediaMinutosPedidoLiberacao: null,
        comMarcas: 0,
        semMarcas: 1,
      },
      {
        setor: 'laboratorio',
        prioridade: 'rotina',
        exames: 9,
        liberados: 9,
        mediaMinutosPedidoLiberacao: 1020,
        comMarcas: 8,
        semMarcas: 1,
      },
      {
        setor: 'laboratorio',
        prioridade: 'urgente',
        exames: 2,
        liberados: 2,
        mediaMinutosPedidoLiberacao: 1020,
        comMarcas: 2,
        semMarcas: 0,
      },
    ]);
    expect(horasMedias(linhas)).toBe(17);
    expect(horasMedias([])).toBeNull();
  });

  it('pendente há mais de 24 horas', () => {
    expect(pendenteHaMaisDe24h('2026-06-01T10:00:00Z', '2026-06-02T10:00:01Z')).toBe(true);
    expect(pendenteHaMaisDe24h('2026-06-01T10:00:00Z', '2026-06-02T09:59:00Z')).toBe(false);
    expect(pendenteHaMaisDe24h('1899-12-30T00:00:00Z', '2026-06-02T09:59:00Z')).toBe(false);
  });
});
