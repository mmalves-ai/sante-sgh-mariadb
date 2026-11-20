// Regra 8 do M32: a situação vem do par data de pagamento e borderô, não de STATUS (legenda "a confirmar", DP-46.3).
import { describe, expect, it } from 'vitest';
import {
  chaveTituloTexto,
  conferirExclusao,
  conferirParcelas,
  legendaStatusPagar,
  parcelarDocumento,
  serieGravada,
  situacaoTituloPagar,
  STATUS_DA_BAIXA,
  tituloEmAberto,
  tpPgtoVisto,
} from './index.js';

const t = { vencimento: '2026-03-10', dataPagamento: '1899-12-30', valor: 100, pago: 0, bordero: 0 };

describe('situação do título (regra 8)', () => {
  it('aberto, vencido, em borderô, pago, pago a menor', () => {
    expect(situacaoTituloPagar(t, '2026-03-10')).toBe('aberto');
    expect(situacaoTituloPagar(t, '2026-03-11')).toBe('vencido');
    expect(situacaoTituloPagar({ ...t, bordero: 7 }, '2026-03-11')).toBe('em-bordero');
    expect(situacaoTituloPagar({ ...t, dataPagamento: '2026-03-09', pago: 100 }, '2026-03-11')).toBe('pago');
    expect(situacaoTituloPagar({ ...t, dataPagamento: '2026-03-09', pago: 90 }, '2026-03-11')).toBe(
      'pago-parcial',
    );
    expect(situacaoTituloPagar({ ...t, vencimento: null, dataPagamento: null }, '2026-03-11')).toBe('aberto');
  });
  it('STATUS só exibido, com a legenda a confirmar; os valores da baixa são os vistos', () => {
    expect(legendaStatusPagar(1)).toContain('a confirmar');
    expect(legendaStatusPagar(0)).toContain('a confirmar');
    expect(legendaStatusPagar(7)).toBe('7 (a confirmar)');
    expect(legendaStatusPagar(null)).toBe('—');
    expect(STATUS_DA_BAIXA['pagar-por-bordero']).toBe(0);
    expect(tpPgtoVisto(1)).toBe(true);
    expect(tpPgtoVisto(2)).toBe(false);
  });
});

describe('título a pagar (regras 3 e 6)', () => {
  it('chave natural em texto; série vazia vira F (o DEFAULT)', () => {
    expect(chaveTituloTexto({ empresa: 1, credor: 7, documento: 12, parcela: 1, tipo: 'F', serie: '' })).toBe(
      '1/7/12/1/F/-',
    );
    expect(serieGravada(' nf1 ')).toBe('NF1');
    expect(serieGravada(null)).toBe('F');
  });
  it('parcelas: R$ 1.000,00 em 3 = 333,33 + 333,33 + 333,34 a cada 30 dias', () => {
    const p = parcelarDocumento(1_000, 3, '2026-04-10', 30);
    expect(p.map((x) => x.valor)).toEqual([333.33, 333.33, 333.34]);
    expect(p.map((x) => x.vencimento)).toEqual(['2026-04-10', '2026-05-10', '2026-06-09']);
    expect(conferirParcelas(p, 1_000, '2026-04-01')).toBeNull();
  });
  it.each([
    [[], 'sem-parcelas'],
    [[{ parcela: 2, vencimento: '2026-04-10', valor: 1 }], 'parcela-fora-de-ordem'],
    [[{ parcela: 1, vencimento: '2026-04-10', valor: 0 }], 'parcela-sem-valor'],
    [[{ parcela: 1, vencimento: '2026-03-01', valor: 1 }], 'vencimento-antes-da-emissao'],
    [
      [
        { parcela: 1, vencimento: '2026-05-10', valor: 1 },
        { parcela: 2, vencimento: '2026-04-10', valor: 1 },
      ],
      'vencimentos-fora-de-ordem',
    ],
    [[{ parcela: 1, vencimento: '2026-04-10', valor: 999 }], 'parcelas-nao-somam'],
  ])('parcelas %j → %s', (ps, codigo) => {
    expect(conferirParcelas(ps, 1_000, '2026-04-01')?.codigo).toBe(codigo);
  });
  it('mais de 120 parcelas recusado', () => {
    expect(conferirParcelas(parcelarDocumento(121, 121, '2026-04-10', 1), 121, '2026-04-01')?.codigo).toBe(
      'parcelas-demais',
    );
  });
  it('título pago não se apaga (estorno); o do borderô sai do borderô antes', () => {
    expect(tituloEmAberto({ pago: 0, dataPagamento: '1899-12-30', bordero: 0 })).toBe(true);
    expect(conferirExclusao({ pago: 10, dataPagamento: '2026-03-01', bordero: 0 })?.codigo).toBe(
      'titulo-pago',
    );
    expect(conferirExclusao({ pago: 0, dataPagamento: null, bordero: 3 })?.codigo).toBe('titulo-em-bordero');
    expect(conferirExclusao({ pago: 0, dataPagamento: null, bordero: 0 })).toBeNull();
  });
});
