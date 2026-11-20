// Regra 9 (ficha do M52, seção 8): dimensionamento de enfermagem pela Resolução COFEN 543/2017, com as parcelas
// escritas no teste (a conta por extenso confere com a feita à mão).
import { describe, expect, it } from 'vitest';
import { calcularDimensionamento, constanteDeMarinho, pacientesDaClassificacao } from './cofen-543.js';

const zero = { minimos: 0, intermediarios: 0, altaDependencia: 0, semiIntensivos: 0, intensivos: 0 };

describe('COFEN 543/2017 (regra 9)', () => {
  it('constante de Marinho com IST de 15%: os valores das tabelas da norma', () => {
    expect(constanteDeMarinho(20, 0.15)).toBe(0.4025);
    expect(constanteDeMarinho(30, 0.15)).toBe(0.2683);
    expect(constanteDeMarinho(36, 0.15)).toBe(0.2236);
    expect(constanteDeMarinho(40, 0.15)).toBe(0.2012);
    expect(constanteDeMarinho(44, 0.15)).toBe(0.1829);
    expect(constanteDeMarinho(36, 0.2)).toBe(0.2333);
  });

  it('unidade de internação: 10 mínimos, 8 intermediários e 2 de alta dependência, 36 h e IST 15%', () => {
    // THE = 10 × 4 + 8 × 6 + 2 × 10 = 40 + 48 + 20 = 108 h
    // KM = (7 ÷ 36) × 1,15 = 0,2236 (truncada)
    // QP = 108 × 0,2236 = 24,1488 → 24,15 → 25 profissionais
    // prevalente: cuidados mínimos (10) → 33% de 25 = 8,25 → 9 enfermeiros (acima do mínimo de 6) e 16 técnicos
    // cobertura no turno = 108 ÷ 24 = 4,5 → 5
    const r = calcularDimensionamento({
      pacientes: { ...zero, minimos: 10, intermediarios: 8, altaDependencia: 2 },
      jornadaSemanalHoras: 36,
      ist: 0.15,
    });
    expect(r).toMatchObject({
      totalHoras: 108,
      km: 0.2236,
      quantitativo: 24.15,
      totalProfissionais: 25,
      categoriaPrevalente: 'minimos',
      percentualEnfermeiros: 0.33,
      enfermeiros: 9,
      tecnicos: 16,
      coberturaSugerida: 5,
    });
    expect(r.horasPorCategoria).toEqual({
      minimos: 40,
      intermediarios: 48,
      altaDependencia: 20,
      semiIntensivos: 0,
      intensivos: 0,
    });
    expect(r.parcelas).toEqual([
      'Cuidados mínimos: 10 paciente(s) × 4 h = 40 h',
      'Cuidados intermediários: 8 paciente(s) × 6 h = 48 h',
      'Alta dependência: 2 paciente(s) × 10 h = 20 h',
      'THE (total de horas de enfermagem em 24 h) = 40 + 48 + 20 = 108 h',
      'KM (constante de Marinho) = (7 dias ÷ 36 h) × (1 + 15%) = 0,2236',
      'QP (quantitativo de pessoal) = 108 × 0,2236 = 24,15, para cima: 25 profissional(is)',
      'Enfermeiros: categoria de maior prevalência cuidados mínimos (10 paciente(s)), 33% de 25 = 8,25, para cima: 9',
      'Técnicos e auxiliares de enfermagem = 25 - 9 = 16',
      'Cobertura sugerida no turno (profissionais ao mesmo tempo) = 108 h ÷ 24 h = 4,5, para cima: 5',
    ]);
  });

  it('terapia intensiva: 10 intensivos → 52% de enfermeiros', () => {
    // THE = 10 × 18 = 180 h; QP = 180 × 0,2236 = 40,248 → 40,25 → 41; 52% de 41 = 21,32 → 22; técnicos 19;
    // cobertura = 180 ÷ 24 = 7,5 → 8
    const r = calcularDimensionamento({
      pacientes: { ...zero, intensivos: 10 },
      jornadaSemanalHoras: 36,
      ist: 0.15,
    });
    expect([r.totalHoras, r.totalProfissionais, r.enfermeiros, r.tecnicos, r.coberturaSugerida]).toEqual([
      180, 41, 22, 19, 8,
    ]);
  });

  it('empate na prevalência vale a categoria mais complexa; o mínimo de enfermeiros no cuidado mínimo', () => {
    // 3 mínimos e 3 de alta dependência: THE = 12 + 30 = 42; QP = 42 × 0,2236 = 9,39 → 10; 36% de 10 = 3,6 → 4
    const empate = calcularDimensionamento({
      pacientes: { ...zero, minimos: 3, altaDependencia: 3 },
      jornadaSemanalHoras: 36,
      ist: 0.15,
    });
    expect([empate.categoriaPrevalente, empate.totalProfissionais, empate.enfermeiros]).toEqual([
      'altaDependencia',
      10,
      4,
    ]);
    // 4 mínimos, 40 h: THE = 16; QP = 16 × 0,2012 = 3,22 → 4; 33% de 4 = 1,32 → 2; mínimo de 6 limitado ao total → 4
    const pequena = calcularDimensionamento({
      pacientes: { ...zero, minimos: 4 },
      jornadaSemanalHoras: 40,
      ist: 0.15,
    });
    expect([pequena.totalProfissionais, pequena.enfermeiros, pequena.tecnicos]).toEqual([4, 4, 0]);
    expect(pequena.parcelas).toContain('Mínimo de enfermeiros no cuidado mínimo e intermediário: 4');
    // Sem o mínimo (parâmetro 0): fica o percentual.
    const sem = calcularDimensionamento({
      pacientes: { ...zero, minimos: 4 },
      jornadaSemanalHoras: 40,
      ist: 0.15,
      minimoEnfermeiros: 0,
    });
    expect(sem.enfermeiros).toBe(2);
  });

  it('NAS: as horas entram no THE e os pacientes contam como intensivos', () => {
    // NAS soma 150% → 150 × 24 ÷ 100 = 36 h; com 1 intermediário (6 h): THE = 6 + 36 = 42
    const r = calcularDimensionamento({
      pacientes: { ...zero, intermediarios: 1 },
      nasSoma: 150,
      nasPacientes: 2,
      jornadaSemanalHoras: 36,
      ist: 0.15,
    });
    expect([r.nasHoras, r.totalHoras, r.categoriaPrevalente]).toEqual([36, 42, 'intensivos']);
    expect(r.parcelas).toContain('NAS: soma 150% × 24 h ÷ 100 = 36 h');
    expect(r.parcelas).toContain('THE (total de horas de enfermagem em 24 h) = 6 + 36 = 42 h');
  });

  it('unidade vazia e entradas inválidas', () => {
    const r = calcularDimensionamento({ pacientes: zero, jornadaSemanalHoras: 36, ist: 0.15 });
    expect([r.totalHoras, r.totalProfissionais, r.enfermeiros, r.categoriaPrevalente]).toEqual([
      0,
      0,
      0,
      null,
    ]);
    expect(r.parcelas[0]).toBe('THE (total de horas de enfermagem em 24 h) = 0 = 0 h');
    expect(() => calcularDimensionamento({ pacientes: zero, jornadaSemanalHoras: 36, ist: 0.1 })).toThrow();
    expect(() => calcularDimensionamento({ pacientes: zero, jornadaSemanalHoras: 0, ist: 0.15 })).toThrow();
  });

  it('pacientes a partir da classificação do turno (Fugulin por categoria, NAS como soma)', () => {
    expect(
      pacientesDaClassificacao([
        { instrumento: 'fugulin', categoria: 'minimos', total: 14 },
        { instrumento: 'fugulin', categoria: 'minimos', total: 15 },
        { instrumento: 'fugulin', categoria: 'intensivos', total: 40 },
        { instrumento: 'fugulin', categoria: 'desconhecida', total: 1 },
        { instrumento: 'nas', categoria: 'nas', total: 62.3 },
        { instrumento: 'nas', categoria: 'nas', total: 70.1 },
      ]),
    ).toEqual({
      pacientes: { minimos: 2, intermediarios: 0, altaDependencia: 0, semiIntensivos: 0, intensivos: 1 },
      nasSoma: 132.4,
      nasPacientes: 2,
      comOsDois: 0,
    });
  });

  it('o paciente com Fugulin e NAS no mesmo turno conta uma vez só, pelo NAS', () => {
    const r = pacientesDaClassificacao([
      { paciente: 1, instrumento: 'fugulin', categoria: 'intensivos', total: 40 },
      { paciente: 1, instrumento: 'nas', categoria: 'nas', total: 70 },
      { paciente: 2, instrumento: 'fugulin', categoria: 'intensivos', total: 38 },
      { paciente: 3, instrumento: 'nas', categoria: 'nas', total: 50 },
    ]);
    expect(r).toEqual({
      pacientes: { minimos: 0, intermediarios: 0, altaDependencia: 0, semiIntensivos: 0, intensivos: 1 },
      nasSoma: 120,
      nasPacientes: 2,
      comOsDois: 1,
    });
    const k = calcularDimensionamento({
      pacientes: r.pacientes,
      nasSoma: r.nasSoma,
      nasPacientes: r.nasPacientes,
      jornadaSemanalHoras: 36,
      ist: 0.15,
    });
    // 1 intensivo pelo Fugulin (18 h) + 120% × 24 ÷ 100 = 28,8 h do NAS; o paciente 1 não entra duas vezes.
    expect(k.totalHoras).toBeCloseTo(46.8, 5);
  });
});
