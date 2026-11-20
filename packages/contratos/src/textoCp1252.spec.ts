// Regra 4 da ficha do M02: texto de entrada só no CP1252, mesmo validador na tela e no servidor, limite em
// bytes da coluna. Corpus sintético de nomes acentuados e termos clínicos (nenhum dado real).
import { describe, expect, it } from 'vitest';
import { normalizarTextoCp1252, problemasCp1252, textoCp1252 } from './texto-cp1252.js';

const NOMES_SINTETICOS = [
  'João da Conceição Araújo',
  'Maria Antônia Gonçalves Brandão',
  'Ângela Mônica Würth',
  'José Inácio Ñúñez',
  'Cauã Ítalo Ébano',
  'Lúcia Ônix Çarvalho',
  'Françoise Ægir Œdipo',
];
const TERMOS_CLINICOS = [
  'Hipertensão arterial sistêmica; PA 140×90 mmHg',
  'Dispneia aos médios esforços… SatO₂'.replace('₂', '2'),
  'Glicemia ≥ 126 mg/dL'.replace('≥', '>='),
  'Temperatura 38,5 °C — febre',
  'Prescrição: dipirona 1 g, “se dor” ½ comprimido',
  'Úlcera por pressão grau ² em região sacral',
  'Dose: 5 µg/kg/min ± 10%',
];

describe('textoCp1252', () => {
  const campo = textoCp1252(80);

  it.each([...NOMES_SINTETICOS, ...TERMOS_CLINICOS])('aceita "%s"', (t) => {
    expect(campo.parse(t)).toBe(t);
  });

  it('mantém aspas curvas, travessão e reticência tipográfica', () => {
    const t = '“Paciente” ‘lúcido’ – orientado — sem queixas…';
    expect(campo.parse(t)).toBe(t);
  });

  it('recusa emoji com mensagem clara', () => {
    const r = campo.safeParse('Paciente bem 😊');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/Emoji não é aceito/);
  });

  it('propõe troca para "≥" e não troca em silêncio', () => {
    const r = campo.safeParse('Glicemia ≥ 126');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain('Use “>=”');
    expect(problemasCp1252('Glicemia ≥ 126')[0]?.troca).toBe('>=');
  });

  it('recusa caractere fora do CP1252 sem troca conhecida', () => {
    const r = campo.safeParse('Unidade ㎎');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/U\+338E não é aceito/);
  });

  it('espaço especial colado vira espaço comum; invisível sai; acento decomposto é recomposto', () => {
    expect(campo.parse('Ana Maria Silva')).toBe('Ana Maria Silva');
    expect(campo.parse('Jo​ão')).toBe('João');
    expect(campo.parse('José')).toBe('José');
    expect(normalizarTextoCp1252('a b')).toBe('a b');
  });

  it('recusa controles C1 (bytes que o CP1252 não define) e C0 exceto tabulação e quebra', () => {
    expect(campo.safeParse('a\u0081b').success).toBe(false);
    expect(campo.safeParse('a\u0007b').success).toBe(false);
    expect(campo.parse('linha 1\nlinha 2\tfim')).toBe('linha 1\nlinha 2\tfim');
  });

  it('limite em bytes igual ao tamanho da coluna', () => {
    const c10 = textoCp1252(10);
    expect(c10.parse('Conceição!')).toHaveLength(10);
    const r = c10.safeParse('Conceições');
    expect(r.success).toBe(true);
    const r2 = c10.safeParse('Conceição!!');
    expect(r2.success).toBe(false);
    expect(r2.error?.issues[0]?.message).toMatch(/Máximo de 10 caracteres/);
  });

  it('tamanho inválido é erro de programação', () => {
    expect(() => textoCp1252(0)).toThrow();
  });
});
