// Número e código de acompanhamento (M48, etapa 1).
import { FORMATO_CODIGO_ACOMPANHAMENTO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { formatarProtocolo, gerarCodigoAcompanhamento, lerProtocolo } from './acompanhamento.js';

describe('protocolo', () => {
  it('formata e lê de volta; recusa ano e sequencial fora da faixa', () => {
    expect(formatarProtocolo(2026, 123)).toBe('NSP-2026-000123');
    expect(lerProtocolo(' nsp-2026-000123 ')).toEqual({ ano: 2026, sequencial: 123 });
    expect(lerProtocolo('NSP-26-1')).toBeNull();
    expect(() => formatarProtocolo(1999, 1)).toThrow('Ano inválido.');
    expect(() => formatarProtocolo(2026, 0)).toThrow();
    expect(() => formatarProtocolo(2026, 1_000_000)).toThrow();
  });
});

describe('código de acompanhamento', () => {
  it('10 caracteres do alfabeto sem ambíguos, pulando os bytes acima do maior múltiplo (sem viés)', () => {
    // 31 símbolos: o limite é 248; os bytes 248 a 255 são descartados.
    let chamada = 0;
    const bytes = (n: number) => {
      chamada++;
      return Uint8Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 250 : i));
    };
    const c = gerarCodigoAcompanhamento(bytes);
    expect(c).toMatch(FORMATO_CODIGO_ACOMPANHAMENTO);
    expect(c).toBe('3579BDFHKN');
    expect(chamada).toBe(1);
  });

  it('gerador sem variação útil: falha em vez de laço infinito', () => {
    expect(() => gerarCodigoAcompanhamento((n) => new Uint8Array(n).fill(255))).toThrow(
      'Gerador aleatório sem variação.',
    );
  });

  it('com o gerador real, códigos diferentes', () => {
    const real = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    const vistos = new Set(Array.from({ length: 50 }, () => gerarCodigoAcompanhamento(real)));
    expect(vistos.size).toBe(50);
  });
});
