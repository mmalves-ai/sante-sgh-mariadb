// Regra 5 do M45: SOFA com a configuração do estabelecimento, testado contra casos montados pelas tabelas publicadas
// (Vincent et al., 1996). A conta de cada caso está no comentário.
import { describe, expect, it } from 'vitest';
import { CONFIG } from './configuracao-pc.spec-util.js';
import { pontosDaVariavel } from './configuracao.js';
import { calcularSofa, pontosNeurologicoSofa } from './sofa.js';

// Glasgow do SOFA (itens 16 a 30): espontânea (17, 3), confuso (22, 3), localiza o estímulo (27, 6) = 12.
const GCS12 = { ocular: 17, verbal: 22, motora: 27 };
// Espontânea (17), orientado (21, 4), obedece (25, 8) = 15.
const GCS15 = { ocular: 17, verbal: 21, motora: 25 };

describe('SOFA', () => {
  it('caso grave: respiratório 3 + coagulação 2 + hepático 2 + cardiovascular 4 + neurológico 2 + renal 3 = 16', () => {
    // PaO2 80 com FiO2 0,5: 160 (3); plaquetas 90 (2); bilirrubina 2,5 (2); PAM 65 (1) e noradrenalina 0,2 (4): 4;
    // Glasgow 12 (2); creatinina 3,6 (3) e débito 400 mL/dia (3): 3.
    const r = calcularSofa(CONFIG, {
      variaveis: {
        PAO2: 80,
        FIO2: 0.5,
        PLAQUETAS: 90,
        BILIRRUBINA: 2.5,
        PAM: 65,
        DOPAMINA: 0,
        EPI_NORA: 0.2,
        CREATININA: 3.6,
        DEBURINARIO: 400,
      },
      glasgow: GCS12,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pontuacao).toBe(16);
    expect(Object.fromEntries(r.parcelas.map((p) => [p.grupo, p.pontos]))).toEqual({
      Respiratório: 3,
      Coagulação: 2,
      Hepático: 2,
      Cardiovascular: 4,
      Neurológico: 2,
      Renal: 3,
    });
    expect(r.parcelas.find((p) => p.grupo === 'Respiratório')).toMatchObject({
      valor: 160,
      nome: 'PaO2/FiO2',
    });
    expect(r.mortalidade).toBeNull();
  });
  it('normal: 0; órgão sem dado conta 0 com o aviso; a dobutamina acima da última faixa mantém os pontos', () => {
    const r = calcularSofa(CONFIG, {
      variaveis: { RELACAO_PF: 450, PLAQUETAS: 250, BILIRRUBINA: 0.8, PAM: 85, CREATININA: 0.9 },
      glasgow: GCS15,
    });
    expect(r.ok && r.pontuacao).toBe(0);
    expect(r.ok && r.avisos).toEqual([]);
    const s = calcularSofa(CONFIG, {
      variaveis: { PAM: 90, DOBUTAMINA: 7, PAS: 120, PAD: 80 },
      glasgow: GCS15,
    });
    expect(s.ok && s.parcelas.find((p) => p.grupo === 'Cardiovascular')).toMatchObject({
      sigla: 'DOBUTAMINA',
      pontos: 2,
    });
    expect(s.ok && s.avisos).toEqual([
      'Respiratório: sem dado, conta 0.',
      'Coagulação: sem dado, conta 0.',
      'Hepático: sem dado, conta 0.',
      'Renal: sem dado, conta 0.',
    ]);
    const pam = calcularSofa(CONFIG, { variaveis: { PAS: 80, PAD: 50 }, glasgow: GCS15 });
    expect(pam.ok && pam.parcelas.find((p) => p.grupo === 'Cardiovascular')).toMatchObject({
      valor: 60,
      pontos: 1,
    });
  });
  it('neurológico pela publicação; Glasgow fora da configuração do SOFA é recusado', () => {
    expect([15, 14, 13, 12, 10, 9, 6, 5, 3].map(pontosNeurologicoSofa)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(
      calcularSofa(CONFIG, { variaveis: {}, glasgow: { ocular: 4, verbal: 9, motora: 15 } }),
    ).toMatchObject({
      ok: false,
      codigo: 'glasgow-invalido',
    });
  });
  it('faixas: cada uma vai até o início da seguinte; abaixo da primeira e acima da última, 0', () => {
    const v = {
      faixas: [
        { pontuacao: 1, de: 1.2, ate: 1.9 },
        { pontuacao: 2, de: 2, ate: 5.9 },
      ],
    };
    expect([1, 1.2, 1.95, 2, 5.9, 6].map((x) => pontosDaVariavel(v, x).pontos)).toEqual([0, 1, 1, 2, 2, 0]);
    expect(pontosDaVariavel(v, 7, { saturarAcima: true }).pontos).toBe(2);
    expect(pontosDaVariavel({ faixas: [] }, 1).pontos).toBe(0);
  });
});
