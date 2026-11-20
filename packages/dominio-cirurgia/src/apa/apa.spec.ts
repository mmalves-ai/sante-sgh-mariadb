// M46 (etapa 1): avaliação pré-anestésica — jejum ASA 2017, Lee, rótulo ASA, conferência e pendências do M18.
import { describe, expect, it } from 'vitest';
import { avaliarJejum, conclusaoLibera, conferirApa, indiceLee, jejumSuficiente, rotuloAsa } from './apa.js';

const inicio = '2026-10-24T10:00';

describe('jejum (ASA 2017)', () => {
  it('horas desde cada ingestão contra o mínimo; não ingerido conta como suficiente', () => {
    const j = avaliarJejum({ refeicaoLeve: '2026-10-24T03:00', liquidosClaros: '2026-10-24T08:30' }, inicio);
    expect(j.find((x) => x.tipo === 'refeicaoLeve')).toEqual({
      tipo: 'refeicaoLeve',
      horas: 7,
      minimo: 6,
      suficiente: true,
    });
    expect(j.find((x) => x.tipo === 'liquidosClaros')).toMatchObject({ horas: 1.5, suficiente: false });
    expect(j.find((x) => x.tipo === 'refeicaoGordurosa')).toMatchObject({ horas: null, suficiente: true });
    expect(jejumSuficiente(j)).toBe(false);
    expect(jejumSuficiente(avaliarJejum({}, inicio))).toBe(true);
  });
});

describe('Lee e ASA', () => {
  it('um ponto por critério válido, sem repetir; classe I a IV', () => {
    expect(indiceLee([])).toEqual({ pontos: 0, classe: 'I' });
    expect(indiceLee(['cardiopatia-isquemica', 'cardiopatia-isquemica'])).toEqual({
      pontos: 1,
      classe: 'II',
    });
    expect(indiceLee(['cardiopatia-isquemica', 'inventado', 'diabetes-insulina'])).toEqual({
      pontos: 2,
      classe: 'III',
    });
    expect(
      indiceLee([
        'cirurgia-alto-risco',
        'cardiopatia-isquemica',
        'insuficiencia-cardiaca',
        'creatinina-alta',
      ]),
    ).toEqual({ pontos: 4, classe: 'IV' });
  });
  it('rótulo com o modificador de emergência', () => {
    expect(rotuloAsa(2, false)).toBe('ASA II');
    expect(rotuloAsa(3, true)).toBe('ASA III E');
    expect(conclusaoLibera('apto-ressalvas')).toBe(true);
    expect(conclusaoLibera('reavaliar')).toBe(false);
  });
});

describe('conferência da APA', () => {
  const base = {
    asa: 2 as const,
    emergencia: false,
    alergiasConferidas: true,
    conclusao: 'apto' as const,
    jejum: { refeicaoLeve: '2026-10-23T22:00' },
    criteriosLee: [],
  };
  it('apto com jejum suficiente fecha as pendências de APA, ASA e jejum', () => {
    const r = conferirApa(base, inicio, 'confirmado');
    expect(r.recusas).toEqual([]);
    expect(r.pendenciasResolvidas).toEqual(['apa', 'asa', 'jejum']);
    expect(r.lee.classe).toBe('I');
  });
  it('apto com jejum insuficiente é recusado; com ressalvas passa e deixa a pendência de jejum', () => {
    const jejum = { liquidosClaros: '2026-10-24T09:30' };
    expect(conferirApa({ ...base, jejum }, inicio, 'confirmado').recusas).toEqual(['apa-jejum-insuficiente']);
    const r = conferirApa({ ...base, jejum, conclusao: 'apto-ressalvas' }, inicio, 'confirmado');
    expect(r.recusas).toEqual([]);
    expect(r.pendenciasResolvidas).toEqual(['apa', 'asa']);
    expect(conferirApa({ ...base, jejum, emergencia: true }, inicio, 'em-sala').recusas).toEqual([]);
  });
  it('alergias não conferidas, ASA VI E e agendamento fechado são recusados; reavaliar não fecha pendência', () => {
    expect(
      conferirApa({ ...base, alergiasConferidas: false, asa: 6, emergencia: true }, inicio, 'cancelado')
        .recusas,
    ).toEqual(['apa-agendamento-fechado', 'apa-alergias-nao-conferidas', 'apa-asa-emergencia']);
    expect(
      conferirApa({ ...base, conclusao: 'reavaliar' }, inicio, 'confirmado').pendenciasResolvidas,
    ).toEqual([]);
  });
  it('revisão: a versão que não libera reabre APA, ASA e jejum; o jejum insuficiente reabre só o jejum', () => {
    for (const conclusao of ['reavaliar', 'inapto'] as const) {
      const r = conferirApa({ ...base, conclusao }, inicio, 'confirmado');
      expect(r.pendenciasResolvidas).toEqual([]);
      expect(r.pendenciasAbertas).toEqual(['apa', 'asa', 'jejum']);
    }
    const jejum = { liquidosClaros: '2026-10-24T09:30' };
    const r = conferirApa({ ...base, jejum, conclusao: 'apto-ressalvas' }, inicio, 'confirmado');
    expect(r.pendenciasAbertas).toEqual(['jejum']);
    expect(conferirApa(base, inicio, 'confirmado').pendenciasAbertas).toEqual([]);
    expect(conferirApa({ ...base, conclusao: 'inapto' }, inicio, 'cancelado').pendenciasAbertas).toEqual([]);
  });
});
