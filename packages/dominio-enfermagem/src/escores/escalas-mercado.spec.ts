// W0-03, mercado M1 (critério de aceite 9): as escalas novas como regra versionada — Caprini e Padua (risco de TEV, com a
// profilaxia sugerida ao prescritor), PEWS, Braden Q e Humpty Dumpty (pediatria), NIPS e FLACC (dor neonatal e
// pediátrica) e MEOWS (obstetrícia). Os casos de referência usam os pesos e os cortes das publicações citadas em cada
// bloco; a versão da regra usada vai com o resultado (a gravada no escore).
import { ESCALAS_MERCADO_M1, type FaixaEscore, itensDaEscala, type RegraEscore } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { calcularEscala, sugestaoProfilaxia } from './escalas.js';
import {
  conferirEscalaTev,
  escoreTevVigente,
  PARAMETROS_TEV_PADRAO,
  parametrosTev,
  profilaxiaPendente,
} from './profilaxia.js';
import { cuidadosSugeridos } from './reavaliacao.js';
import { INTERVALO_ESCALA, problemasDasFaixas, REGRAS_PADRAO } from './regras.js';

/** Todos os itens no menor valor, com os informados por cima. */
function respostas(escala: (typeof ESCALAS_MERCADO_M1)[number], marcados: Record<string, number> = {}) {
  const r: Record<string, number> = {};
  for (const i of itensDaEscala(escala)) r[i.codigo] = Math.min(...i.opcoes.map((o) => o.valor));
  return { ...r, ...marcados };
}

describe('as regras padrão (versão 1) das escalas novas', () => {
  it.each(ESCALAS_MERCADO_M1)('%s: cobre o intervalo dos itens sem buraco e tem a origem publicada', (e) => {
    const itens = itensDaEscala(e);
    const min = itens.reduce((a, i) => a + Math.min(...i.opcoes.map((o) => o.valor)), 0);
    const max = itens.reduce((a, i) => a + Math.max(...i.opcoes.map((o) => o.valor)), 0);
    expect(INTERVALO_ESCALA[e]).toEqual([min, max]);
    expect(problemasDasFaixas(e, REGRAS_PADRAO[e].faixas)).toEqual([]);
    expect(REGRAS_PADRAO[e].versao).toBe(1);
    expect(REGRAS_PADRAO[e].origem).toMatch(/\(\d{4}\)/);
    // Os itens com o maior valor cabem no registro (até 1.000 caracteres).
    const json = JSON.stringify(Object.fromEntries(itens.map((i) => [i.codigo, 99])));
    expect(json.length).toBeLessThan(1000);
    expect(e.length).toBeLessThanOrEqual(10);
  });
});

describe('Caprini (Caprini 2005; faixas de Gould et al., ACCP 2012)', () => {
  it('nenhum fator: risco muito baixo, sem pendência', () => {
    const r = calcularEscala('caprini', respostas('caprini'));
    expect(r).toMatchObject({ ok: true, total: 0, gatilho: 'nenhum', faixa: { codigo: 'muitoBaixo' } });
  });
  it('41 a 60 anos com cirurgia menor = 2: baixo, profilaxia mecânica', () => {
    const r = calcularEscala('caprini', respostas('caprini', { idade: 1, cirMenor: 1 }));
    expect(r).toMatchObject({ ok: true, total: 2, faixa: { codigo: 'baixo' }, gatilho: 'profilaxia' });
    expect(r.ok && r.conduta).toMatch(/mecânica/);
  });
  it('61 a 74 anos, cirurgia aberta maior e neoplasia = 6: alto, farmacológica e mecânica', () => {
    const r = calcularEscala('caprini', respostas('caprini', { idade: 2, cirMaior: 2, neoplasia: 2 }));
    expect(r).toMatchObject({ ok: true, total: 6, faixa: { codigo: 'alto' }, gatilho: 'profilaxia' });
    expect(r.ok && r.conduta).toMatch(/farmacológica associada à mecânica/);
  });
  it('artroplastia eletiva sozinha (5 pontos) já é alto risco; 3 a 4 é moderado', () => {
    expect(calcularEscala('caprini', respostas('caprini', { artropl: 5 }))).toMatchObject({
      total: 5,
      faixa: { codigo: 'alto' },
    });
    expect(calcularEscala('caprini', respostas('caprini', { tevPrev: 3, varizes: 1 }))).toMatchObject({
      total: 4,
      faixa: { codigo: 'moderado' },
    });
  });
  it('peso fora da publicação é recusado (o fator de 2 pontos não aceita 3)', () => {
    expect(calcularEscala('caprini', respostas('caprini', { cirMaior: 3 }))).toMatchObject({
      ok: false,
      codigo: 'valor-nunca-visto',
    });
  });
});

describe('Padua (Barbar et al., 2010)', () => {
  it('câncer ativo e 70 anos ou mais = 4: alto risco, profilaxia farmacológica sugerida', () => {
    const r = calcularEscala('padua', respostas('padua', { cancer: 3, idade70: 1 }));
    expect(r).toMatchObject({ ok: true, total: 4, faixa: { codigo: 'alto' }, gatilho: 'profilaxia' });
    expect(r.ok && r.conduta).toMatch(/farmacológica/);
  });
  it('mobilidade reduzida sozinha = 3: baixo risco, sem pendência', () => {
    expect(calcularEscala('padua', respostas('padua', { mobilidade: 3 }))).toMatchObject({
      ok: true,
      total: 3,
      faixa: { codigo: 'baixo' },
      gatilho: 'nenhum',
    });
  });
});

describe('PEWS de Brighton (Monaghan, 2005)', () => {
  it('2 sem alerta; 3 avisa o médico; 5 aciona o Time de Resposta Rápida', () => {
    expect(calcularEscala('pews', respostas('pews', { comport: 1, cardio: 1 }))).toMatchObject({
      total: 2,
      gatilho: 'nenhum',
    });
    expect(calcularEscala('pews', respostas('pews', { comport: 1, cardio: 1, resp: 1 }))).toMatchObject({
      total: 3,
      gatilho: 'avisar-medico',
    });
    expect(
      calcularEscala('pews', respostas('pews', { comport: 1, cardio: 1, resp: 1, nebul: 2 })),
    ).toMatchObject({ total: 5, gatilho: 'trr' });
  });
});

describe('Braden Q (Quigley e Curley, 1996; corte de 16)', () => {
  it('16 está em risco (cuidados de lesão por pressão); 17 não', () => {
    const q = (n: number) =>
      respostas('bradenq', {
        mobilidade: 2,
        atividade: 2,
        percepcao: 2,
        umidade: 2,
        friccao: 2,
        nutricao: 2,
        perfusao: n,
      });
    const r16 = calcularEscala('bradenq', q(4));
    expect(r16).toMatchObject({ ok: true, total: 16, gatilho: 'prevencao' });
    expect(r16.ok && cuidadosSugeridos('bradenq', r16.faixa).map((c) => c.codigo)).toContain(
      'mudancaDecubito',
    );
    const r17 = calcularEscala('bradenq', { ...q(4), nutricao: 3 });
    expect(r17).toMatchObject({ ok: true, total: 17, gatilho: 'nenhum' });
  });
});

describe('Humpty Dumpty (Hill-Rodriguez et al., 2009)', () => {
  it('mínimo 7 é baixo; lactente menino em cama sem outros fatores = 12, alto (cuidados de queda)', () => {
    expect(calcularEscala('humpty', respostas('humpty'))).toMatchObject({ total: 7, gatilho: 'nenhum' });
    const r = calcularEscala('humpty', respostas('humpty', { idade: 4, sexo: 2, ambiente: 2 }));
    expect(r).toMatchObject({ ok: true, total: 12, faixa: { codigo: 'alto' }, gatilho: 'prevencao' });
    expect(r.ok && cuidadosSugeridos('humpty', r.faixa).map((c) => c.codigo)).toContain('gradesElevadas');
  });
});

describe('NIPS (Lawrence et al., 1993) e FLACC (Merkel et al., 1997)', () => {
  it('NIPS: 3 sem dor; 4 (mais de 3) é dor e pede reavaliação depois da analgesia', () => {
    expect(calcularEscala('nips', respostas('nips', { face: 1, choro: 2 }))).toMatchObject({
      total: 3,
      gatilho: 'nenhum',
    });
    const r = calcularEscala('nips', respostas('nips', { face: 1, choro: 2, bracos: 1 }));
    expect(r).toMatchObject({ total: 4, gatilho: 'reavaliar' });
    expect(r.ok && r.conduta).toMatch(/analgesia/);
  });
  it('FLACC: 0 relaxado, 1 a 3 leve, 4 a 6 moderada, 7 a 10 intensa', () => {
    const f = (n: Record<string, number>) => calcularEscala('flacc', respostas('flacc', n));
    expect(f({})).toMatchObject({ faixa: { codigo: 'relaxado' } });
    expect(f({ face: 1, pernas: 1, choro: 1 })).toMatchObject({ total: 3, gatilho: 'nenhum' });
    expect(f({ face: 2, pernas: 2 })).toMatchObject({
      total: 4,
      faixa: { codigo: 'moderada' },
      gatilho: 'reavaliar',
    });
    expect(f({ face: 2, pernas: 2, choro: 2, consolo: 1 })).toMatchObject({
      total: 7,
      faixa: { codigo: 'intensa' },
    });
  });
});

describe('MEOWS (Singh et al., 2012): um vermelho ou dois amarelos', () => {
  it('um amarelo não dispara; dois amarelos ou um vermelho avisam o médico', () => {
    expect(calcularEscala('meows', respostas('meows', { fc: 1 }))).toMatchObject({
      total: 1,
      gatilho: 'nenhum',
    });
    expect(calcularEscala('meows', respostas('meows', { fc: 1, fr: 1 }))).toMatchObject({
      total: 2,
      gatilho: 'avisar-medico',
    });
    expect(calcularEscala('meows', respostas('meows', { pas: 2 }))).toMatchObject({
      total: 2,
      gatilho: 'avisar-medico',
    });
    expect(calcularEscala('meows', respostas('meows', { spo2: 1 }))).toMatchObject({ ok: false });
  });
});

describe('a versão da regra vai com o resultado (regra versionada)', () => {
  it('a versão 2 publicada da Padua (corte em 5) muda a faixa do mesmo total', () => {
    const f = (codigo: string, minimo: number, maximo: number, risco: boolean): FaixaEscore => ({
      codigo,
      rotulo: codigo,
      minimo,
      maximo,
      risco,
    });
    const v2: RegraEscore = {
      ...REGRAS_PADRAO.padua,
      versao: 2,
      faixas: [f('baixo', 0, 4, false), f('alto', 5, 20, true)],
      origem: 'publicada',
    };
    expect(problemasDasFaixas('padua', v2.faixas)).toEqual([]);
    const r = calcularEscala('padua', respostas('padua', { cancer: 3, idade70: 1 }), { regra: v2 });
    expect(r).toMatchObject({ ok: true, total: 4, gatilho: 'nenhum', faixa: { codigo: 'baixo' } });
  });
});

describe('profilaxia de TEV: a escala do perfil e a pendência ao prescritor', () => {
  it('padrão de mercado: Padua no clínico, Caprini no cirúrgico; o parâmetro troca', () => {
    expect(PARAMETROS_TEV_PADRAO).toEqual({ clinico: 'padua', cirurgico: 'caprini' });
    expect(parametrosTev('', 'x')).toEqual(PARAMETROS_TEV_PADRAO);
    expect(conferirEscalaTev('caprini', 'cirurgico', PARAMETROS_TEV_PADRAO)).toEqual({ ok: true });
    expect(conferirEscalaTev('caprini', 'clinico', PARAMETROS_TEV_PADRAO)).toMatchObject({
      ok: false,
      codigo: 'escala-tev-do-perfil',
      esperada: 'padua',
    });
    expect(conferirEscalaTev('caprini', 'clinico', parametrosTev('caprini', 'caprini'))).toEqual({
      ok: true,
    });
  });
  it('pendente: o último escore de TEV válido em risco e sem decisão; o estornado não conta', () => {
    const e = (id: number, gatilho: string, aferidoEm: string, estornado = false) => ({
      id,
      escala: 'padua',
      gatilho,
      aferidoEm,
      estornado,
    });
    const risco = e(1, 'profilaxia', '2026-11-18T08:00');
    expect(profilaxiaPendente(escoreTevVigente([risco]), new Set())).toBe(true);
    expect(profilaxiaPendente(escoreTevVigente([risco]), new Set([1]))).toBe(false);
    // Um escore mais novo sem risco encerra a pendência.
    expect(profilaxiaPendente(escoreTevVigente([risco, e(2, 'nenhum', '2026-11-18T10:00')]), new Set())).toBe(
      false,
    );
    // O estorno desde o nascimento: o escore estornado sai da pendência.
    expect(escoreTevVigente([e(1, 'profilaxia', '2026-11-18T08:00', true)])).toBeNull();
    expect(sugestaoProfilaxia('padua', 'baixo')).toMatch(/deambulação/);
  });
});
