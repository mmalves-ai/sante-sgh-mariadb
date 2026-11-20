// Regra 2 do M45: as faixas em regra versionada (a versão publicada cobre a escala inteira, sem buraco nem sobreposição;
// a vigente é a de maior versão; a histórica nunca vale em registro novo).
import { describe, expect, it } from 'vitest';
import {
  BRADEN_HISTORICA_FORMULARIO,
  conteudoCanonicoFaixas,
  INTERVALO_ESCALA,
  problemasDasFaixas,
  REGRAS_PADRAO,
  regrasVigentes,
} from './regras.js';

describe('faixas versionadas', () => {
  it('as versões 1 cobrem o intervalo de cada escala', () => {
    for (const [escala, regra] of Object.entries(REGRAS_PADRAO))
      expect(problemasDasFaixas(escala as keyof typeof INTERVALO_ESCALA, regra.faixas), escala).toEqual([]);
  });
  it('recusa buraco, sobreposição, início e fim errados, código repetido e sem faixa de risco ou sem risco', () => {
    const f = (codigo: string, minimo: number, maximo: number, risco: boolean) => ({
      codigo,
      rotulo: codigo,
      minimo,
      maximo,
      risco,
    });
    expect(problemasDasFaixas('morse', [f('a', 0, 24, false), f('b', 26, 125, true)])).toEqual([
      'Há um intervalo sem faixa entre 24 e 26.',
    ]);
    expect(problemasDasFaixas('morse', [f('a', 0, 30, false), f('b', 25, 125, true)])[0]).toMatch(
      /se sobrepõem/,
    );
    expect(problemasDasFaixas('morse', [f('a', 1, 24, false), f('b', 25, 120, true)])).toEqual([
      'A primeira faixa tem de começar em 0.',
      'A última faixa tem de terminar em 125.',
    ]);
    expect(problemasDasFaixas('morse', [f('a', 0, 24, true), f('a', 25, 125, true)])).toEqual([
      'Há código de faixa repetido.',
      'Deixe ao menos uma faixa sem risco.',
    ]);
    expect(problemasDasFaixas('morse', [f('a', 0, 24, false), f('b', 25, 125, false)])).toEqual([
      'Marque ao menos uma faixa de risco.',
    ]);
    expect(problemasDasFaixas('morse', [])).toEqual(['Informe as faixas.']);
  });
  it('o conteúdo canônico é o mesmo em qualquer ordem', () => {
    const a = REGRAS_PADRAO.morse.faixas;
    expect(conteudoCanonicoFaixas('morse', [...a].reverse())).toBe(conteudoCanonicoFaixas('morse', a));
  });
  it('a vigente é a de maior versão publicada; a histórica não entra', () => {
    const v2 = { ...REGRAS_PADRAO.morse, versao: 2 };
    const v3 = { ...REGRAS_PADRAO.morse, versao: 3 };
    const r = regrasVigentes([v3, v2, { ...BRADEN_HISTORICA_FORMULARIO, versao: 9 }]);
    expect(r.morse.versao).toBe(3);
    expect(r.braden.versao).toBe(1);
    expect(r.news2).toBe(REGRAS_PADRAO.news2);
  });
});
