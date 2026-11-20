// Regra 19 (unidade): o lote contábil sai com contagem e soma conferíveis (débitos = créditos, com as parcelas
// escritas), o evento sem de-para fica contado e fora do arquivo, e o período inválido não registra nada.
import type { DePara, EventoFinanceiro } from '@sgh/dominio-financeiro';
import { describe, expect, it } from 'vitest';
import { ErroLoteContabil, exportarLoteDoPeriodo, type FonteLote } from './lote.js';

const EVENTOS: readonly EventoFinanceiro[] = [
  {
    data: '2026-09-02',
    evento: 'receita-convenio',
    valor: 1200.4,
    historico: 'Título SINTETICO 1',
    documento: '1',
  },
  {
    data: '2026-09-03',
    evento: 'receita-convenio',
    valor: 799.6,
    historico: 'Título SINTETICO 2',
    documento: '2',
  },
  {
    data: '2026-09-04',
    evento: 'despesa-material',
    valor: 350,
    historico: 'NF; SINTETICA\n3',
    documento: '3',
  },
  { data: '2026-09-05', evento: 'sem-cadastro', valor: 10, historico: 'Sem de-para', documento: '4' },
];
const DEPARA: readonly DePara[] = [
  { evento: 'receita-convenio', contaDebito: '1.1.2.01', contaCredito: '3.1.1.01' },
  { evento: 'despesa-material', contaDebito: '4.1.3.02', contaCredito: '1.1.1.01' },
];

function fonte() {
  const guardados: string[] = [];
  const registros: Parameters<FonteLote['registrar']>[1][] = [];
  const f: FonteLote = {
    eventos: async () => EVENTOS,
    dePara: async () => DEPARA,
    guardar: async (_h, nome, conteudo) => {
      guardados.push(conteudo);
      return `memoria/${nome}`;
    },
    registrar: async (_h, d) => {
      registros.push(d);
      return { id: 7 };
    },
  };
  return { f, guardados, registros };
}

describe('lote da exportação contábil', () => {
  it('contagem e soma conferíveis; o sem de-para fica contado e fora do arquivo', async () => {
    const { f, guardados, registros } = fonte();
    const r = await exportarLoteDoPeriodo(f, 'pc', '2026-09', 'competencia');
    // 1.200,40 + 799,60 + 350,00 = 2.350,00 (o evento de R$ 10,00 sem de-para não entra).
    expect(r).toMatchObject({ id: 7, lancamentos: 3, soma: 2350, semDePara: 1 });
    expect(registros[0]).toMatchObject({
      somaDebitos: 2350,
      somaCreditos: 2350,
      semDePara: 1,
      regua: 'competencia',
    });
    const linhas = guardados[0]!.trim().split('\r\n');
    expect(linhas.at(-1)).toBe('TOTAL;3;2350.00;2350.00');
    // O separador e a quebra no histórico não quebram a linha do arquivo.
    expect(linhas[2]).toBe('2026-09-04;4.1.3.02;1.1.1.01;350.00;NF  SINTETICA 3;3');
    expect(guardados[0]).not.toContain('Sem de-para');
  });

  it('período inválido: recusa sem registrar', async () => {
    const { f, registros } = fonte();
    await expect(exportarLoteDoPeriodo(f, 'pc', '2026/09', 'caixa')).rejects.toBeInstanceOf(ErroLoteContabil);
    expect(registros).toEqual([]);
  });
});
