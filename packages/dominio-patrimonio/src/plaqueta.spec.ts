// Plaqueta, QR e etiqueta ZPL do bem (M54, etapa 6; ficha, seção 7).
import { describe, expect, it } from 'vitest';
import { digitoQr, etiquetaZpl, formatarPlaqueta, lerCodigo, textoDoQr } from './plaqueta.js';

describe('plaqueta e QR', () => {
  it('a plaqueta gerada leva o estabelecimento e 6 dígitos', () => {
    expect(formatarPlaqueta('pc', 123)).toBe('PC000123');
    expect(() => formatarPlaqueta('pc', 0)).toThrow(RangeError);
    expect(() => formatarPlaqueta('abcdefghij', 1_000_000_000_000)).toThrow(/longa/);
  });

  it('o QR leva o estabelecimento, a plaqueta e o dígito, e volta pela leitura', () => {
    const qr = textoDoQr('pc', 'PC000123');
    expect(qr).toMatch(/^PAT1:pc:PC000123:[0-9A-Z]$/);
    expect(lerCodigo(qr, 'pc')).toEqual({ ok: true, plaqueta: 'PC000123', pelo: 'qr' });
    expect(digitoQr('PAT1:pc:PC000123')).toBe(qr.slice(-1));
  });

  it('o QR trocado, de outro estabelecimento ou truncado é recusado; a plaqueta digitada vale', () => {
    const qr = textoDoQr('pc', 'PC000123');
    const trocado = `${qr.slice(0, -1)}${qr.endsWith('0') ? '1' : '0'}`;
    expect(lerCodigo(trocado, 'pc')).toMatchObject({ ok: false, motivo: 'qr-invalido' });
    expect(lerCodigo(textoDoQr('hs', 'HS000001'), 'pc')).toMatchObject({
      ok: false,
      motivo: 'outro-estabelecimento',
    });
    expect(lerCodigo('PAT1:pc:PC0', 'pc')).toMatchObject({ ok: false, motivo: 'qr-invalido' });
    expect(lerCodigo(' pc000123 ', 'pc')).toEqual({ ok: true, plaqueta: 'PC000123', pelo: 'digitado' });
    expect(lerCodigo('PC 0001', 'pc')).toMatchObject({ ok: false, motivo: 'formato' });
  });
});

describe('etiqueta ZPL', () => {
  it('o QR, a plaqueta, a descrição e o titular, sem caracteres de comando nos campos', () => {
    const z = etiquetaZpl({
      hospital: 'pc',
      plaqueta: 'PC000123',
      descricao: 'Monitor ^ multi~paramétrico',
      titular: 'Hospital sintético',
    });
    expect(z.startsWith('^XA\n^CI28')).toBe(true);
    expect(z.endsWith('^XZ')).toBe(true);
    expect(z).toContain(`^FDMA,${textoDoQr('pc', 'PC000123')}^FS`);
    expect(z).toContain('^FDPC000123^FS');
    expect(z).toContain('^FDMonitor multi paramétrico^FS');
    expect(z).toContain('^FDHospital sintético^FS');
  });
});
