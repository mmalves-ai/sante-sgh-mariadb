import { describe, expect, it } from 'vitest';
import { classificarExpressao, normalizarExpressao, resumirExpressoes } from './expressoes.js';

// Formas sintéticas dos padrões da ref 04 §3.3 (as 270 reais estão no relatório do M09).
describe('inventário das expressões Pascal (regra 5)', () => {
  it.each([
    [
      'habilitar',
      'if (cmp23ItemIndex = 1) then\r\n result := false\r\n else\r\n result := true;',
      'habilitar-por-resposta',
    ],
    [
      'calcular',
      "if (DateToStr(cmp7) = '30/12/1899') then result := 0 else result := Date() - DateToStr(cmp7);",
      'dias-desde-data',
    ],
    [
      'calcular',
      'if cmp69 > 0 // Concent\r\n and cmp70 > 0 // Vazao\r\n then result:= (cmp69 * cmp70) / (cmp12 * 60)',
      'dose-vasoativa',
    ],
    [
      'calcular',
      'A := 0; B := 0; C := 0; if cmp1ItemIndex > 0 then A := cmp1ItemIndex; if cmp2ItemIndex > 0 then B := 1; result := A',
      'escore-soma',
    ],
    ['calcular', 'result := cmp1ItemIndex + cmp2ItemIndex', 'escore-soma'],
    [
      'calcular',
      'if ((cmp260 >= 6) and (cmp260 <= 11)) then result := 3 else if ((cmp260 >= 12) and (cmp260 <= 14)) then result := 1',
      'classificacao-faixa',
    ],
    ['calcular', "if cmp1 >= 15 then result := 'baixo'", 'classificacao-faixa'],
    ['calcular', 'if cmp757 <> 0 then result:= (cmp757/(cmp758*cmp758))', 'antropometria'],
    ['calcular', 'result := 70 + PacienteIdade', 'antropometria'],
    ['calcular', '', 'vazia'],
    ['calcular', 'result := cmp1 * 2', 'outro'],
  ] as const)('%s: %s → %s', (tipo, fonte, padrao) => {
    expect(classificarExpressao(tipo, fonte).padrao).toBe(padrao);
  });

  it('guarda referências, contexto e fonte normalizada', () => {
    const e = classificarExpressao('calcular', 'result :=  Date() -  DateToStr(cmp7) + cmp7 + PacienteSexo');
    expect(e.referencias).toEqual(['cmp7']);
    expect(e.contexto).toEqual(['PacienteSexo', 'Date']);
    expect(normalizarExpressao('  a \r\n b ')).toBe('a b');
  });

  it('M22: fonte sem comentários e a regra convertida para JSON Logic', () => {
    const e = classificarExpressao('calcular', 'if cmp1 > 0 // peso\r\n then result := cmp1 * 2');
    expect(e.fonte).toBe('if cmp1 > 0 then result := cmp1 * 2');
    expect(e.convertida).toBe(true);
    expect(e.regra).toEqual({ if: [{ '>': [{ var: 'cmp1' }, 0] }, { '*': [{ var: 'cmp1' }, 2] }, null] });
    const ruim = classificarExpressao('calcular', 'while x do y := 1');
    expect(ruim.convertida).toBe(false);
    expect(ruim.motivoConversao).toContain('comando desconhecido');
  });

  it('resume por tipo e padrão', () => {
    const r = resumirExpressoes([
      classificarExpressao('habilitar', 'if (cmp1ItemIndex = 1) then result := false'),
      classificarExpressao('calcular', ''),
    ]);
    expect(r).toMatchObject({ habilitar: 1, calcular: 1 });
    expect(r.porPadrao['habilitar-por-resposta']).toBe(1);
    expect(r.porPadrao.vazia).toBe(1);
  });
});
