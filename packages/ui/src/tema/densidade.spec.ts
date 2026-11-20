import { describe, expect, it } from 'vitest';
import { folhaDeTokens, TIPOGRAFIA } from './css.js';
import { CORES_REDE_SANTE } from '../tokens/marcas.js';
import { DENSIDADES, MEDIDAS, classeDensidade, variaveisDensidade } from './densidade.js';

describe('densidades e tipografia (regra 4)', () => {
  it('compacta (estação), confortável (tablet) e painel (TV)', () => {
    expect(DENSIDADES).toEqual(['compacta', 'confortavel', 'painel']);
  });

  it('confortável tem alvo de toque ≥ 44 px e base de 16 px; compacta base de 14 px', () => {
    expect(MEDIDAS.confortavel.alvoMinimo).toBeGreaterThanOrEqual(44);
    expect(MEDIDAS.confortavel.fonteBase).toBe(16);
    expect(MEDIDAS.compacta.fonteBase).toBe(14);
    expect(MEDIDAS.painel.fonteBase).toBeGreaterThan(MEDIDAS.confortavel.fonteBase);
  });

  it('nenhum texto abaixo de 12 px em nenhuma densidade', () => {
    for (const d of DENSIDADES) expect(MEDIDAS[d].fontePequena).toBeGreaterThanOrEqual(12);
  });

  it('cada densidade vira classe na raiz com as variáveis do Sante SGH e do OpenVue', () => {
    const css = folhaDeTokens(CORES_REDE_SANTE);
    for (const d of DENSIDADES) {
      expect(css).toContain(`:root.${classeDensidade(d)} {`);
      const v = variaveisDensidade(d);
      expect(v['--sgh-alvo-minimo']).toBe(`${MEDIDAS[d].alvoMinimo}px`);
      expect(v['--p-form-field-padding-y']).toMatch(/^\d+px$/);
    }
    expect(css).toMatch(/fonte-ampliada/);
  });

  it('fontes da interface: Inter, Nunito Sans e JetBrains Mono (empacotadas)', () => {
    expect(TIPOGRAFIA['--sgh-fonte-texto']).toMatch(/^'Inter'/);
    expect(TIPOGRAFIA['--sgh-fonte-titulo']).toMatch(/^'Nunito Sans'/);
    expect(TIPOGRAFIA['--sgh-fonte-codigo']).toMatch(/^'JetBrains Mono'/);
  });
});
