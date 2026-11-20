// Digitalização certificada (M50, etapa 6; ficha, regra 12): captura, indexação, conferência de fidelidade, assinatura
// de quem conferiu e o prazo de guarda; nenhum papel é eliminado pelo sistema.
import { describe, expect, it } from 'vitest';
import {
  conferirCaptura,
  ehPdf,
  ErroDigitalizacao,
  guardaAte,
  paginasDoPdf,
  transicaoDigitalizacao,
} from './regras.js';

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const pdf = (paginas: number) =>
  bytes(
    `%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count ${paginas} >> endobj\n` +
      Array.from(
        { length: paginas },
        (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj\n`,
      ).join('') +
      '%%EOF',
  );

const recusa = (fn: () => unknown, codigo: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ErroDigitalizacao);
    expect((e as ErroDigitalizacao).codigo).toBe(codigo);
    return;
  }
  throw new Error(`Não recusou (${codigo}).`);
};

describe('captura', () => {
  it('reconhece o PDF e conta as páginas (o /Pages não conta)', () => {
    expect(ehPdf(pdf(2))).toBe(true);
    expect(ehPdf(bytes('\x89PNG\r\n\x1a\n...'))).toBe(false);
    expect(ehPdf(bytes('%PDF'))).toBe(false);
    expect(paginasDoPdf(pdf(3))).toBe(3);
    expect(paginasDoPdf(bytes('%PDF-1.7\n<< /Type /ObjStm >>\n%%EOF'))).toBeNull();
  });

  const base = { resolucaoDpi: 300, paginas: 2, dataDocumento: '2019-04-02', hoje: '2026-10-25' };
  it('aceita o PDF de 300 dpi com as páginas certas', () => {
    expect(conferirCaptura({ ...base, bytes: pdf(2) })).toEqual({ paginasArquivo: 2 });
    expect(
      conferirCaptura({ ...base, paginas: 7, bytes: bytes('%PDF-1.7\n<< /Type /ObjStm >>\n%%EOF') }),
    ).toEqual({ paginasArquivo: null });
  });
  it('recusa o que não é PDF, a resolução baixa, a data futura e as páginas divergentes', () => {
    recusa(() => conferirCaptura({ ...base, bytes: bytes('GIF89a.......') }), 'nao-e-pdf');
    recusa(() => conferirCaptura({ ...base, resolucaoDpi: 200, bytes: pdf(2) }), 'resolucao-baixa');
    recusa(() => conferirCaptura({ ...base, dataDocumento: '2026-10-26', bytes: pdf(2) }), 'data-futura');
    recusa(() => conferirCaptura({ ...base, paginas: 3, bytes: pdf(2) }), 'paginas-divergentes');
  });
});

describe('conferência e assinatura (segregação)', () => {
  const d = { quem: 'SAME.CONFERE', capturadoPor: 'SAME.CAPTURA', conferidoPor: null };
  it('outra pessoa confere: fiel ou recusado', () => {
    expect(transicaoDigitalizacao('capturado', 'conferir-fiel', d)).toBe('conferido');
    expect(transicaoDigitalizacao('capturado', 'conferir-recusar', d)).toBe('recusado');
  });
  it('quem capturou não confere (sem diferença de caixa nem espaço)', () => {
    recusa(
      () => transicaoDigitalizacao('capturado', 'conferir-fiel', { ...d, quem: ' same.captura ' }),
      'mesma-pessoa',
    );
  });
  it('só o capturado é conferido', () => {
    for (const s of ['conferido', 'recusado', 'assinado'] as const)
      recusa(() => transicaoDigitalizacao(s, 'conferir-fiel', d), 'ja-conferido');
  });
  it('quem assina é quem conferiu; só o conferido; o assinado não assina de novo', () => {
    const c = { ...d, conferidoPor: 'SAME.CONFERE' };
    expect(transicaoDigitalizacao('conferido', 'assinar', c)).toBe('assinado');
    recusa(
      () => transicaoDigitalizacao('conferido', 'assinar', { ...c, quem: 'OUTRA.PESSOA' }),
      'assinante-nao-conferiu',
    );
    recusa(() => transicaoDigitalizacao('capturado', 'assinar', c), 'nao-conferido');
    recusa(() => transicaoDigitalizacao('recusado', 'assinar', c), 'nao-conferido');
    recusa(() => transicaoDigitalizacao('assinado', 'assinar', c), 'ja-assinado');
    recusa(
      () => transicaoDigitalizacao('conferido', 'assinar', { ...c, conferidoPor: null }),
      'assinante-nao-conferiu',
    );
  });
});

describe('guarda', () => {
  it('20 anos a partir da captura (o 29 de fevereiro vai a 28)', () => {
    expect(guardaAte('2026-10-25T10:00')).toBe('2046-10-25');
    expect(guardaAte('2028-02-29')).toBe('2048-02-28');
    expect(guardaAte('2026-01-05', 5)).toBe('2031-01-05');
  });
});
