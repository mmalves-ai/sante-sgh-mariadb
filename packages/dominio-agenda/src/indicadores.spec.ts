// Regras 8 e 9 e a mesma semântica de gestao-agenda.js (ocupação, funil, cancelamento, absenteísmo).
import { describe, expect, it } from 'vitest';
import { absenteismo, faixaAntecedencia, funil, ocupacao, pct, riscoDeFalta } from './indicadores.js';

describe('indicadores', () => {
  it('pct com uma casa e zero no denominador', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(2, 0)).toBe(0);
  });
  it('faixas de antecedência pela data da marcação (DT_AGE), sentinela = não informada', () => {
    expect(faixaAntecedencia('2026-10-21', '2026-10-21')).toBe('mesmo-dia');
    expect(faixaAntecedencia('2026-10-14', '2026-10-21')).toBe('ate-7');
    expect(faixaAntecedencia('2026-10-01', '2026-10-21')).toBe('de-8-a-30');
    expect(faixaAntecedencia('2026-08-01', '2026-10-21')).toBe('mais-de-30');
    expect(faixaAntecedencia('1899-12-30', '2026-10-21')).toBe('nao-informada');
    expect(faixaAntecedencia(null, '2026-10-21')).toBe('nao-informada');
    expect(faixaAntecedencia('2026-10-22', '2026-10-21')).toBe('mesmo-dia');
  });
  it('risco de falta pela antecedência (ref 01 §2.1)', () => {
    expect(riscoDeFalta('mesmo-dia')).toEqual({ percentual: 7.9, nivel: 'baixo' });
    expect(riscoDeFalta('ate-7')).toEqual({ percentual: 37.2, nivel: 'medio' });
    expect(riscoDeFalta('mais-de-30')).toEqual({ percentual: 55.3, nivel: 'alto' });
    expect(riscoDeFalta('nao-informada')).toEqual({ percentual: null, nivel: 'desconhecido' });
  });
  it('ocupação por agenda e pela especialidade do nome', () => {
    const l = [
      { agenda: 'CARDIOLOGIA - A', horarios: 10, ocupados: 5 },
      { agenda: 'CARDIOLOGIA- B', horarios: 10, ocupados: 10 },
      { agenda: 'ORTOPEDIA - C', horarios: 4, ocupados: 1 },
    ];
    const porAgenda = ocupacao(l, 'agenda');
    expect(porAgenda).toMatchObject({ horarios: 24, ocupados: 16, livres: 8, ocupacao: 66.7 });
    expect(porAgenda.linhas).toHaveLength(3);
    const porEsp = ocupacao(l, 'especialidade');
    expect(porEsp.linhas[0]).toEqual({
      chave: 'CARDIOLOGIA',
      horarios: 20,
      ocupados: 15,
      livres: 5,
      ocupacao: 75,
    });
  });
  it('absenteísmo agrupa pela especialidade do NOME (nunca por ESPEC, só preenchida na chegada)', () => {
    const a = absenteismo(
      [
        { chave: 'CARDIOLOGIA - A', marcados: 10, compareceu: 6 },
        { chave: 'CARDIOLOGIA - B', marcados: 10, compareceu: 9 },
      ],
      true,
    );
    expect(a).toMatchObject({ marcados: 20, compareceu: 15, faltou: 5, absenteismo: 25 });
    expect(a.linhas).toEqual([
      { chave: 'CARDIOLOGIA', marcados: 20, compareceu: 15, faltou: 5, absenteismo: 25 },
    ]);
    expect(absenteismo([{ chave: 'x', marcados: 1, compareceu: 1 }]).linhas[0]?.chave).toBe('x');
  });
  it('funil: cancelamento sobre marcados + cancelados (o cancelamento remove a marcação)', () => {
    expect(
      funil({ horarios: 100, livres: 30, marcados: 70, compareceu: 50, cancelados: 30, encaixes: 4 }),
    ).toEqual({
      horariosOfertados: 100,
      nuncaPreenchidos: 30,
      marcados: 70,
      cancelados: 30,
      compareceu: 50,
      faltou: 20,
      encaixes: 4,
      ocupacao: 70,
      taxaCancelamento: 30,
      absenteismo: 28.6,
      conversaoEmAtendimento: 50,
    });
  });
});
