// Regra 5 do M45: APACHE II com a configuração do estabelecimento (21 agrupamentos, 109 variáveis, 121 faixas, Glasgow
// com 30 itens; fixture da cópia, dado de domínio sem paciente), testado contra casos montados pelas tabelas e pela
// equação publicadas (Knaus et al., 1985). Cada caso tem a conta à mão no comentário.
import { describe, expect, it } from 'vitest';
import { calcularApache2, fracao, gradienteAa } from './apache2.js';
import { categoriasDoTipo, divergenciasDaPublicacao, impressaoConfiguracao } from './configuracao.js';
import { CONFIG } from './configuracao-pc.spec-util.js';

const NORMAIS = {
  TEMP: 37,
  PAM: 85,
  FC: 80,
  FR: 16,
  FIO2: 0.21,
  PAO2: 90,
  PH: 7.4,
  NASERICO: 140,
  KSERICO: 4,
  CREATININA: 1,
  HEMATOCRITO: 40,
  LEUCOCITO: 8000,
};
// Glasgow do APACHE II: 4 (espontânea, item 4), 5 (orientado, item 9), 6 (obedece, item 15).
const GCS15 = { ocular: 4, verbal: 9, motora: 15 };

describe('configuração do estabelecimento', () => {
  it('21 agrupamentos, 109 variáveis, 121 faixas e 30 itens de Glasgow; impressão estável', async () => {
    expect(CONFIG.agrupamentos).toHaveLength(21);
    expect(CONFIG.variaveis).toHaveLength(109);
    expect(CONFIG.variaveis.reduce((s, v) => s + v.faixas.length, 0)).toBe(121);
    expect(CONFIG.glasgow).toHaveLength(30);
    expect(CONFIG.impressao).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await impressaoConfiguracao({
        agrupamentos: CONFIG.agrupamentos,
        glasgow: CONFIG.glasgow,
        variaveis: [...CONFIG.variaveis].reverse(),
      }),
    ).toBe(CONFIG.impressao);
  });
  it('as categorias diagnósticas por tipo de admissão; a de urgência já leva o 0,603 da equação', () => {
    const eletiva = categoriasDoTipo(CONFIG, 'eletiva');
    const urgencia = categoriasDoTipo(CONFIG, 'urgencia');
    expect(eletiva.length).toBeGreaterThan(15);
    expect(categoriasDoTipo(CONFIG, 'nao-cirurgico').some((c) => c.nome === 'Sepse')).toBe(true);
    const pe = eletiva.find((c) => c.nome === 'Politraumatismo')!.peso;
    const pu = urgencia.find((c) => c.nome === 'Politraumatismo')!.peso;
    expect(Math.round((pu - pe) * 1000) / 1000).toBe(0.603);
  });
  it('as divergências da configuração em relação à publicação ficam listadas (DP-20)', () => {
    const d = divergenciasDaPublicacao(CONFIG);
    expect(d.some((x) => /débito urinário/.test(x))).toBe(true);
    expect(d.some((x) => /axilar/.test(x))).toBe(true);
    expect(d.some((x) => /Glasgow/.test(x))).toBe(true);
  });
});

describe('APACHE II', () => {
  it('caso 1, não cirúrgico, sepse: APS 17 + idade 5 = 22; mortalidade 45,2%', () => {
    // Temp 39,2 (3), PAM 65 (2), FC 125 (2), FR 28 (1), FiO2 0,4 com PaO2 68 (1), pH 7,30 (2), Na 138 (0), K 3,2 (1),
    // creatinina 1,8 sem falha (2), Ht 32 (0), leucócitos 18.000 (1), Glasgow 13 (2) = 17; 67 anos (5); sem doença
    // crônica. ln(R/(1-R)) = -3,517 + 0,146 × 22 + 0,113 = -0,192; R = 45,2%.
    const sepse = categoriasDoTipo(CONFIG, 'nao-cirurgico').find((c) => c.nome === 'Sepse')!;
    const r = calcularApache2(CONFIG, {
      variaveis: {
        TEMP: 39.2,
        PAM: 65,
        FC: 125,
        FR: 28,
        FIO2: 0.4,
        PAO2: 68,
        PH: 7.3,
        NASERICO: 138,
        KSERICO: 3.2,
        CREATININA: 1.8,
        HEMATOCRITO: 32,
        LEUCOCITO: 18_000,
      },
      glasgow: { ocular: 3, verbal: 8, motora: 15 },
      idade: 67,
      tipoAdmissao: 'nao-cirurgico',
      categoria: sepse.id,
      insuficienciaCronica: false,
      falhaRenalAguda: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pontuacao).toBe(22);
    expect(r.parcelas.filter((p) => p.grupo === 'Fisiológica aguda').reduce((s, p) => s + p.pontos, 0)).toBe(
      17,
    );
    expect(r.mortalidade).toBeCloseTo(0.4521, 3);
    expect(r.equacao).toBe('ln(R/(1−R)) = −3,517 + 0,146 × 22 + 0,113 (Sepse) = −0,192; R = 45,2%');
    expect(r.avisos).toEqual([]);
  });
  it('caso 2, cirurgia eletiva valvular com doença crônica e falha renal aguda: 12; mortalidade 4,6%', () => {
    // FiO2 0,6: gradiente A-a = 0,6 × 713 - 40 ÷ 0,8 - 100 = 278 (2); creatinina 2,0 com falha (6); o resto normal (0);
    // Glasgow 15 (0) = 8; 50 anos (2); doença crônica na eletiva (2). ln(R/(1-R)) = -3,517 + 0,146 × 12 - 1,261 = -3,026.
    const valvular = categoriasDoTipo(CONFIG, 'eletiva').find(
      (c) => c.nome === 'Cirurgia cardíaca valvular',
    )!;
    const r = calcularApache2(CONFIG, {
      variaveis: { ...NORMAIS, FIO2: 60, PAO2: 100, PACO2: 40, CREATININA: 2 },
      glasgow: GCS15,
      idade: 50,
      tipoAdmissao: 'eletiva',
      categoria: valvular.id,
      insuficienciaCronica: true,
      falhaRenalAguda: true,
    });
    expect(r.ok && r.pontuacao).toBe(12);
    expect(r.ok && r.parcelas.find((p) => p.sigla === 'GRADIENTE')).toMatchObject({ valor: 278, pontos: 2 });
    expect(r.ok && r.parcelas.find((p) => p.sigla === 'CREATCOMFALHA')?.pontos).toBe(6);
    expect(r.ok && r.mortalidade).toBeCloseTo(0.0463, 3);
  });
  it('urgência: doença crônica vale 5; sem pH, o bicarbonato; variável não informada conta 0 com aviso', () => {
    const poli = categoriasDoTipo(CONFIG, 'urgencia').find((c) => c.nome === 'Politraumatismo')!;
    const semPh: Record<string, number | null> = { ...NORMAIS };
    delete semPh['PH'];
    delete semPh['HEMATOCRITO'];
    const r = calcularApache2(CONFIG, {
      variaveis: { ...semPh, HCO3: 16, PAM: null, PAS: 100, PAD: 40 },
      glasgow: GCS15,
      idade: 30,
      tipoAdmissao: 'urgencia',
      categoria: poli.id,
      insuficienciaCronica: true,
      falhaRenalAguda: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // HCO3 16 (3); PAM (100 + 2 × 40) ÷ 3 = 60 (2); Ht não informado (0, aviso); doença crônica na urgência (5).
    expect(r.parcelas.find((p) => p.sigla === 'HCO3')?.pontos).toBe(3);
    expect(r.parcelas.find((p) => p.sigla === 'PAM')).toMatchObject({ valor: 60, pontos: 2 });
    expect(r.parcelas.find((p) => p.sigla === 'INSUF')?.pontos).toBe(5);
    expect(r.pontuacao).toBe(10);
    expect(r.avisos).toEqual(['Hematócrito: não informado, conta como normal (0).']);
  });
  it('categoria de outro tipo e Glasgow fora da configuração são recusados', () => {
    const sepse = categoriasDoTipo(CONFIG, 'nao-cirurgico').find((c) => c.nome === 'Sepse')!;
    const base = {
      variaveis: NORMAIS,
      glasgow: GCS15,
      idade: 40,
      tipoAdmissao: 'eletiva' as const,
      categoria: sepse.id,
      insuficienciaCronica: false,
      falhaRenalAguda: false,
    };
    expect(calcularApache2(CONFIG, base)).toMatchObject({ ok: false, codigo: 'categoria-de-outro-tipo' });
    // Itens de Glasgow do SOFA (16 a 30) não valem no APACHE II.
    expect(
      calcularApache2(CONFIG, { ...base, glasgow: { ocular: 17, verbal: 21, motora: 25 } }),
    ).toMatchObject({
      ok: false,
      codigo: 'glasgow-invalido',
    });
  });
  it('FiO2 em porcentagem e o gradiente', () => {
    expect(fracao(40)).toBe(0.4);
    expect(fracao(0.4)).toBe(0.4);
    expect(gradienteAa(1, 40, 100)).toBe(563);
  });
});
