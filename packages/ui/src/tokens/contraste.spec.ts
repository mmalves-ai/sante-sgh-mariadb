import { describe, expect, it } from 'vitest';
import { PACOTES_DE_MARCA, PACOTE_NEUTRO } from '../marca/index.js';
import { PALETA_CLINICA } from './clinica.js';
import { PARES_DE_CONTRASTE, tokensDoTema } from './cores.js';
import { contraste, distanciaLab } from './contraste.js';
import { CORES_REDE_SANTE } from './marcas.js';
import { relatorioContraste } from './relatorio.js';

describe('contraste WCAG 2.2 AA nos dois temas (regra 2)', () => {
  it('fórmula confere com os valores de referência (preto × branco = 21; vinho ≈ 10:1; cinza ≈ 2,9:1)', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contraste('#83102c', '#ffffff')).toBeGreaterThan(10);
    expect(contraste('#96989a', '#ffffff')).toBeCloseTo(2.89, 1);
  });

  for (const pacote of [...Object.values(PACOTES_DE_MARCA), PACOTE_NEUTRO]) {
    const temas = tokensDoTema(pacote);
    for (const tema of ['claro', 'escuro'] as const) {
      it.each(PARES_DE_CONTRASTE.map((p) => [p.texto, p.fundo, p.minimo] as const))(
        `${pacote.id} ${tema}: %s sobre %s ≥ %s`,
        (texto, fundo, minimo) => {
          expect(contraste(temas[tema][texto], temas[tema][fundo])).toBeGreaterThanOrEqual(minimo);
        },
      );
    }

    it(`${pacote.id}: a secundária pura nunca é texto no claro; o texto secundário é um cinza derivado ≥ 4,5:1`, () => {
      expect(contraste(pacote.corSecundaria, temas.claro.fundo)).toBeLessThan(4.5);
      expect(temas.claro['texto-secundario']).not.toBe(pacote.corSecundaria);
      expect(contraste(temas.claro['texto-secundario'], temas.claro.fundo)).toBeGreaterThanOrEqual(4.5);
      // No escuro, a própria secundária serve como texto secundário (cap-03 §3.3).
      expect(temas.escuro['texto-secundario']).toBe(pacote.corSecundaria);
    });

    it(`${pacote.id}: a primária serve para tudo sobre branco; no escuro vira um tom claro`, () => {
      expect(contraste(pacote.corPrimaria, '#ffffff')).toBeGreaterThanOrEqual(7);
      expect(contraste(temas.escuro.primaria, temas.escuro.fundo)).toBeGreaterThanOrEqual(7);
    });
  }

  it('selos clínicos: rótulo × fundo ≥ 4,5:1 nos dois temas', () => {
    for (const e of PALETA_CLINICA) {
      expect(contraste(e.claro.texto, e.claro.fundo), e.id).toBeGreaterThanOrEqual(4.5);
      expect(contraste(e.escuro.texto, e.escuro.fundo), e.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('vinho não é alerta: o vermelho de alerta é perceptivelmente outro tom (ΔE > 20)', () => {
    const t = tokensDoTema(CORES_REDE_SANTE);
    expect(t.claro.alerta).not.toBe(t.claro.primaria);
    expect(distanciaLab(t.claro.alerta, t.claro.primaria)).toBeGreaterThan(20);
    expect(distanciaLab(t.escuro.alerta, t.escuro.primaria)).toBeGreaterThan(20);
  });

  it('relatório de contraste sem nenhuma falha', () => {
    const r = relatorioContraste(CORES_REDE_SANTE);
    expect(r).toContain('| claro |');
    expect(r).not.toContain('FALHA');
  });
});
