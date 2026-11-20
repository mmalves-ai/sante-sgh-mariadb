// Regra 10: leito-dia operacional com limitação declarada: a situação ATUAL do leito (o legado não guarda o
// bloqueio). Os leitos ativos ficam na linha do tipo atual da acomodação.
import { describe, expect, it } from 'vitest';
import { em, movimento, UNIDADES } from './massa.spec-util.js';
import { MotorInternacao } from './motor.js';

describe('leito-dia operacional', () => {
  it('leitos ativos de hoje × dias, por acomodação; acomodação sem tipo vai ao tipo 0', () => {
    const mov = {
      ...movimento([]),
      unidades: [
        ...UNIDADES,
        { bloco: '3', acomodacao: 'OBS', nome: 'Observação', tipo: null, leitos: 1, leitosAtivos: 1 },
      ],
    };
    const m = new MotorInternacao(mov, {
      horaFechamento: 24,
      intensivas: [3],
      agora: em('2026-02-10', '1200'),
    });
    const [fev] = m.basesMensais('2026-02', '2026-02');
    expect(fev?.grandezas.dias).toBe(10);
    expect(fev?.grandezas.leitosDia).toBe(9 * 10);
    const obs = m.censoDoDia('2026-02-05').find((l) => l.acomodacao === 'OBS');
    expect(obs).toMatchObject({ tipo: { id: 0, nome: 'Não informado' }, leitosOperacionais: 1 });
  });

  it('mês inteiro no futuro: sem dias e parcial', () => {
    const m = new MotorInternacao(movimento([]), {
      horaFechamento: 24,
      intensivas: [],
      agora: em('2026-02-10'),
    });
    const [mar] = m.basesMensais('2026-03', '2026-03');
    expect(mar).toMatchObject({ parcial: true, grandezas: { dias: 0, leitosDia: 0 } });
  });
});
