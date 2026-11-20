// Regra 4 da ficha do M15: texto formatado → parágrafos (\par, \b, \li, \cf, \qc), comandos ignorados contados,
// conteúdo ativo neutralizado, acentuação CP1252 sem caractere de substituição.
import { describe, expect, it } from 'vitest';
import { RTF_SINTETICO } from './corpus.spec-util.js';
import { ErroRtf, pareceRtf, rtfParaTexto, TETO_RTF, textoCorrido } from './rtf.js';

describe('texto formatado (RTF → parágrafos)', () => {
  const t = rtfParaTexto(RTF_SINTETICO);

  it('monta os parágrafos com negrito, cor, recuo e centro', () => {
    expect(t.paragrafos).toHaveLength(4);
    const [titulo, queixa, conduta] = t.paragrafos;
    expect(titulo!.trechos[0]).toMatchObject({ texto: 'QUEIXA PRINCIPAL', negrito: true, cor: 1 });
    expect(queixa!.recuo).toBe(1);
    expect(conduta!.alinhamento).toBe('centro');
    expect(conduta!.trechos[0]).toMatchObject({ texto: 'Conduta:', negrito: true, cor: 2 });
    expect(conduta!.trechos[1]).toMatchObject({ negrito: false, cor: 0 });
    expect(t.cores).toEqual(['#000000', '#0000ff', '#ff0000']);
  });

  it('decodifica os escapes CP1252 e o unicode, sem caractere de substituição', () => {
    const corrido = textoCorrido(t);
    expect(corrido).toContain('Paciente SINTÉTICO refere dor torácica há 2 dias, não irradiada.');
    expect(corrido).toContain('observação e reavaliação');
    expect(corrido).toContain('termo clínico: açúcar €');
    expect(corrido).not.toMatch(/[\uFFFD]/);
    expect(corrido).not.toContain('Tahoma');
  });

  it('conta os comandos ignorados', () => {
    const x = rtfParaTexto(String.raw`{\rtf1\ansi\highlight3\expndtw10 texto\par}`);
    expect(x.ignorados).toEqual({ highlight: 1, expndtw: 1 });
    expect(textoCorrido(x)).toBe('texto');
  });

  it('neutraliza conteúdo ativo (objeto, imagem e campo com link) e conta', () => {
    const x = rtfParaTexto(
      String.raw`{\rtf1 antes {\object\objemb{\*\objdata 0102}} {\pict\pngblip 89504e47} {\field{\*\fldinst HYPERLINK "http://exemplo.invalid"}{\fldrslt clique}} depois\par}`,
    );
    const corrido = textoCorrido(x);
    expect(corrido).not.toContain('HYPERLINK');
    expect(corrido).not.toContain('exemplo.invalid');
    expect(corrido).not.toContain('89504e47');
    expect(corrido).toContain('antes');
    expect(corrido).toContain('clique');
    expect(corrido).toContain('depois');
    expect(x.conteudoAtivoRemovido).toBe(3);
  });

  it('marcação no texto continua texto (nada vira HTML)', () => {
    const x = rtfParaTexto(String.raw`{\rtf1 <script>alert(1)</script> \{chave\} \\barra\par}`);
    expect(textoCorrido(x)).toBe('<script>alert(1)</script> {chave} \\barra');
  });

  it('quebra de linha, tabulação, célula, itálico, sublinhado e plain', () => {
    const x = rtfParaTexto(
      String.raw`{\rtf1\i a\i0\ul b\ulnone\line c\tab d\cell e\row\qr\qj\ql f\b g\plain h\par}`,
    );
    expect(x.paragrafos[0]!.trechos[0]).toMatchObject({ texto: 'a', italico: true });
    expect(x.paragrafos[0]!.trechos[1]).toMatchObject({ texto: 'b', sublinhado: true });
    expect(textoCorrido(x)).toContain('c d | e');
    expect(x.paragrafos[1]!.trechos.map((y) => y.texto).join('')).toBe('fgh');
  });

  it('recusa entrada acima do teto e reconhece o RTF dentro do valor', () => {
    expect(() => rtfParaTexto('x'.repeat(TETO_RTF + 1))).toThrow(ErroRtf);
    expect(pareceRtf('  {\\rtf1 x}')).toBe(true);
    expect(pareceRtf('texto')).toBe(false);
  });
});
