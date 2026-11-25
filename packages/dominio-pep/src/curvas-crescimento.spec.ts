import { describe, expect, it } from 'vitest';
import {
  avaliarMedida,
  classificarCrescimento,
  imcDe,
  linhasDoGrafico,
  linhasEm,
  lmsEm,
  percentilDoZ,
  referenciaDaMedida,
  validarMedidaCrescimento,
  valorLms,
  zLinhas,
  zLms,
  type CurvaCalculo,
} from './curvas-crescimento.js';

// LMS do peso para a idade, meninos, no nascimento (tabela da OMS 2006): L 0,3487, M 3,3464, S 0,14602. As linhas
// publicadas na tabela de escore Z da OMS para o nascimento são -3: 2,1; -2: 2,5; 0: 3,3; +2: 4,4; +3: 5,0 kg.
const L = 0.3487;
const M = 3.3464;
const S = 0.14602;
const codigos = (f: { codigo: string }[]) => f.map((x) => x.codigo);

describe('curvas de crescimento: escore Z e percentil', () => {
  it('a fórmula LMS reproduz as linhas publicadas pela OMS e o Z volta ao valor', () => {
    expect(valorLms(-3, L, M, S).toFixed(1)).toBe('2.1');
    expect(valorLms(-2, L, M, S).toFixed(1)).toBe('2.5');
    expect(valorLms(0, L, M, S)).toBeCloseTo(M, 6);
    expect(valorLms(2, L, M, S).toFixed(1)).toBe('4.4');
    expect(valorLms(3, L, M, S).toFixed(1)).toBe('5.0');
    expect(zLms(valorLms(1.3, L, M, S), L, M, S)).toBeCloseTo(1.3, 6);
    // L = 1 (comprimento): Z = (y/M - 1)/S.
    expect(zLms(49.8842 * (1 + 2 * 0.03795), 1, 49.8842, 0.03795)).toBeCloseTo(2, 6);
  });

  it('além de ±3, o ajuste restrito mede a distância pelo intervalo entre os desvios 2 e 3', () => {
    const sd3 = valorLms(3, L, M, S);
    const sd23 = sd3 - valorLms(2, L, M, S);
    expect(zLms(sd3 + sd23, L, M, S, true)).toBeCloseTo(4, 6);
    const sdm3 = valorLms(-3, L, M, S);
    const sdm23 = valorLms(-2, L, M, S) - sdm3;
    expect(zLms(sdm3 - sdm23 / 2, L, M, S, true)).toBeCloseTo(-3.5, 6);
    expect(zLms(sd3 + sd23, L, M, S, false)).not.toBeCloseTo(4, 2);
  });

  it('interpola o LMS e as linhas entre os pontos e recusa fora da faixa', () => {
    const p = [
      { x: 0, l: 1, m: 50, s: 0.04 },
      { x: 1, l: 1, m: 54, s: 0.036 },
    ];
    expect(lmsEm(p, 0.5)).toEqual({ l: 1, m: 52, s: 0.038 });
    expect(lmsEm(p, 1.005)).toEqual({ l: 1, m: 54, s: 0.036 });
    expect(lmsEm(p, 1.5)).toBeNull();
    const z = [
      { x: 27, z: [0.36, 0.44, 0.55, 0.67, 0.83, 1.02, 1.25] },
      { x: 28, z: [0.46, 0.56, 0.68, 0.83, 1.01, 1.23, 1.5] },
    ];
    expect(linhasEm(z, 27.5)![3]).toBeCloseTo(0.75, 6);
    expect(linhasEm(z, 26)).toBeNull();
  });

  it('Z pelas linhas de desvio: linear entre linhas e pela última faixa fora delas', () => {
    const v = [0.36, 0.44, 0.55, 0.67, 0.83, 1.02, 1.25];
    expect(zLinhas(v, 0.67)).toBeCloseTo(0, 6);
    expect(zLinhas(v, 0.75)).toBeCloseTo(0.5, 6);
    expect(zLinhas(v, 0.4)).toBeCloseTo(-2.5, 6);
    expect(zLinhas(v, 1.48)).toBeCloseTo(4, 6);
    expect(zLinhas(v, 0.28)).toBeCloseTo(-4, 6);
  });

  it('percentil pela normal padrão', () => {
    expect(percentilDoZ(0)).toBe(50);
    expect(percentilDoZ(-2)).toBe(2.3);
    expect(percentilDoZ(2)).toBe(97.7);
    expect(percentilDoZ(-1.881)).toBe(3);
  });
});

describe('curvas de crescimento: classificação pelos pontos de corte do Ministério da Saúde', () => {
  it('peso, estatura e perímetro cefálico', () => {
    expect(classificarCrescimento('peso', -3.1, 6)).toEqual({ codigo: 'muito_baixo_peso', nivel: 'alerta' });
    expect(classificarCrescimento('peso', -2.5, 6).codigo).toBe('baixo_peso');
    expect(classificarCrescimento('peso', -2, 6).codigo).toBe('peso_adequado');
    expect(classificarCrescimento('peso', 2.1, 6).codigo).toBe('peso_elevado');
    expect(classificarCrescimento('estatura', -2.1, 6).codigo).toBe('baixa_estatura');
    expect(classificarCrescimento('estatura', 3, 6).codigo).toBe('estatura_adequada');
    expect(classificarCrescimento('perimetro_cefalico', -3.2, 1).codigo).toBe('microcefalia_grave');
    expect(classificarCrescimento('perimetro_cefalico', -2.2, 1)).toEqual({
      codigo: 'microcefalia',
      nivel: 'alerta',
    });
    expect(classificarCrescimento('perimetro_cefalico', 2.2, 1).codigo).toBe('macrocefalia');
  });

  it('IMC muda os cortes aos 5 anos (risco de sobrepeso só antes)', () => {
    expect(classificarCrescimento('imc', 1, 30).codigo).toBe('eutrofia');
    expect(classificarCrescimento('imc', 1.5, 30).codigo).toBe('risco_sobrepeso');
    expect(classificarCrescimento('imc', 2.5, 30).codigo).toBe('sobrepeso');
    expect(classificarCrescimento('imc', 3.1, 30).codigo).toBe('obesidade');
    expect(classificarCrescimento('imc', 1.5, 100).codigo).toBe('sobrepeso');
    expect(classificarCrescimento('imc', 2.5, 100).codigo).toBe('obesidade');
    expect(classificarCrescimento('imc', 3.1, 100).codigo).toBe('obesidade_grave');
    expect(classificarCrescimento('imc', -3.1, 100).codigo).toBe('magreza_acentuada');
  });
});

describe('curvas de crescimento: referência pela idade', () => {
  const nasc = new Date('2026-01-01T10:00:00Z');
  it('a termo: OMS 2006 até 60 meses, OMS 2007 até 228, nada depois', () => {
    const r = referenciaDaMedida(
      { nascimento: nasc, igSemanas: 39, igDias: 2 },
      new Date('2026-07-02T08:00:00Z'),
    );
    expect(r).toMatchObject({ publicacao: 'oms2006', corrigida: false });
    expect(r!.x).toBeCloseTo(182 / 30.4375, 6);
    expect(
      referenciaDaMedida({ nascimento: nasc, igSemanas: null, igDias: null }, new Date('2033-01-01')),
    ).toMatchObject({
      publicacao: 'oms2007',
    });
    expect(
      referenciaDaMedida({ nascimento: nasc, igSemanas: null, igDias: null }, new Date('2046-01-01')),
    ).toBeNull();
    expect(
      referenciaDaMedida({ nascimento: nasc, igSemanas: null, igDias: null }, new Date('2025-12-31')),
    ).toBeNull();
  });

  it('prematuro: INTERGROWTH até 64 semanas pós-menstruais, depois OMS pela idade corrigida até 24 meses', () => {
    const p = { nascimento: nasc, igSemanas: 30, igDias: 0 };
    const r1 = referenciaDaMedida(p, new Date('2026-01-15T12:00:00Z'));
    expect(r1).toMatchObject({ publicacao: 'intergrowth', x: 32 });
    const r2 = referenciaDaMedida(p, new Date('2026-10-01T12:00:00Z'));
    expect(r2).toMatchObject({ publicacao: 'oms2006', corrigida: true });
    expect(r2!.x).toBeCloseTo((273 - 70) / 30.4375, 6);
    expect(referenciaDaMedida({ nascimento: nasc, igSemanas: 25, igDias: 0 }, nasc)).toBeNull();
    const r3 = referenciaDaMedida(p, new Date('2028-06-01T12:00:00Z'));
    expect(r3).toMatchObject({ publicacao: 'oms2006', corrigida: false });
  });
});

describe('curvas de crescimento: avaliação, gráfico e validação', () => {
  const curva: CurvaCalculo = {
    tipo: 'lms',
    pontos: [
      { x: 0, l: L, m: M, s: S },
      { x: 1, l: L, m: M, s: S },
    ],
  };
  it('avalia a medida com Z, percentil, classificação e plausibilidade', () => {
    const a = avaliarMedida('peso', M, curva, 0.5, 0.5)!;
    expect(a).toMatchObject({ z: 0, percentil: 50, plausivel: true });
    expect(a.classificacao.codigo).toBe('peso_adequado');
    expect(avaliarMedida('peso', 2.3, curva, 0.5, 0.5)!.classificacao.codigo).toBe('baixo_peso');
    expect(avaliarMedida('peso', 40, curva, 0.5, 0.5)!.plausivel).toBe(false);
    expect(avaliarMedida('peso', 3, curva, 2, 2)).toBeNull();
    expect(avaliarMedida('peso', 0, curva, 0.5, 0.5)).toBeNull();
  });

  it('o gráfico traz as linhas -3, -2, 0, +2 e +3 em cada ponto publicado', () => {
    const g = linhasDoGrafico(curva);
    expect(g).toHaveLength(2);
    expect(g[0]!.valores.map((v) => v.toFixed(1))).toEqual(['2.1', '2.5', '3.3', '4.4', '5.0']);
    const ig = linhasDoGrafico({ tipo: 'linhas_z', pontos: [{ x: 27, z: [1, 2, 3, 4, 5, 6, 7] }] });
    expect(ig[0]!.valores).toEqual([1, 2, 4, 6, 7]);
  });

  it('IMC pelo peso e pela estatura', () => {
    expect(imcDe(20, 110)).toBe(16.53);
    expect(imcDe(null, 110)).toBeNull();
  });

  it('valida a medida antes de gravar', () => {
    const agora = new Date('2026-11-25T12:00:00Z');
    const nascimento = new Date('2026-01-01');
    const ok = { pesoKg: 8, estaturaCm: 70, perimetroCefalicoCm: 44, medidoEm: agora, nascimento };
    expect(validarMedidaCrescimento(ok, agora)).toEqual([]);
    expect(
      codigos(
        validarMedidaCrescimento(
          { pesoKg: null, estaturaCm: null, perimetroCefalicoCm: null, medidoEm: agora, nascimento: null },
          agora,
        ),
      ),
    ).toEqual(['medida-vazia', 'sem-data-nascimento']);
    expect(
      codigos(
        validarMedidaCrescimento(
          { ...ok, pesoKg: 8000, estaturaCm: 0.7, perimetroCefalicoCm: 4, medidoEm: new Date('2027-01-01') },
          agora,
        ),
      ),
    ).toEqual(['medida-no-futuro', 'peso-impossivel', 'estatura-impossivel', 'perimetro-impossivel']);
    expect(codigos(validarMedidaCrescimento({ ...ok, medidoEm: new Date('2025-12-01') }, agora))).toEqual([
      'medida-antes-do-nascimento',
    ]);
  });
});
