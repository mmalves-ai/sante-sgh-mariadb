// O termo de baixa (M54, etapa 6; ficha, seção 10, "Documento"): o HTML relido do bem e do movimento de baixa, com a
// conta do valor contábil e do resultado impressa, autocontido e com o texto escapado. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { htmlTermoBaixa, resultadoDaBaixa } from './documentos.js';
import { BEM_BAIXADO, MOVIMENTO_BAIXA } from './documentos.spec-util.js';

describe('termo de baixa', () => {
  it('resultado = venda − contábil; sem venda, perda do contábil inteiro', () => {
    expect(resultadoDaBaixa(11_400_00, 500_00)).toBe(-10_900_00);
    expect(resultadoDaBaixa(100_00, null)).toBe(-100_00);
    expect(resultadoDaBaixa(100_00, 150_00)).toBe(50_00);
  });

  it('o HTML traz o bem, a nota de origem, a conta impressa, escapa o texto e não cita recurso externo', () => {
    const h = htmlTermoBaixa({
      bem: BEM_BAIXADO,
      baixa: MOVIMENTO_BAIXA,
      estabelecimento: 'pc',
      titular: 'HOSPITAL SINTETICO',
      emitidoEm: '2026-10-29T12:00:00Z',
      emitidoPor: 'SINT.PATRIMONIO',
    });
    expect(h).toContain('Termo de baixa de bem patrimonial nº TB-1');
    expect(h).toContain('MONITOR &lt;SINTETICO&gt; &amp; CIA');
    expect(h).toContain('Nota fiscal 000123/1 de 10/03/2026');
    expect(h).toContain('Equipamentos médico-hospitalares');
    expect(h).toContain('R$ 12.000,00 − R$ 600,00 = R$ 11.400,00 (valor contábil)');
    expect(h).toContain('R$ 500,00 − R$ 11.400,00 = −R$ 10.900,00 (resultado)');
    expect(h).toContain('Perda na baixa');
    expect(h).toContain('Emitido em 29/10/2026 por SINT.PATRIMONIO');
    expect(h).not.toMatch(/https?:\/\//);
  });

  it('doação com termo e venda acima do contábil: ganho', () => {
    const h = htmlTermoBaixa({
      bem: {
        ...BEM_BAIXADO,
        documento: 'termo',
        nota: null,
        termo: { numero: 'D-9', data: '2001-05-02', doador: 'DOADOR SINTETICO' },
        contabilCent: 0,
        acumuladaCent: 12_000_00,
        ultimaCompetencia: null,
      },
      baixa: { ...MOVIMENTO_BAIXA, termoNumero: null, valorVendaCent: null },
      estabelecimento: 'pc',
      titular: '',
      emitidoEm: '2026-10-29',
      emitidoPor: 'SINT.PATRIMONIO',
    });
    expect(h).toContain('Termo de doação D-9 de 02/05/2001 (DOADOR SINTETICO)');
    expect(h).toContain('nº 7');
    expect(h).toContain('Ganho na baixa');
  });
});
