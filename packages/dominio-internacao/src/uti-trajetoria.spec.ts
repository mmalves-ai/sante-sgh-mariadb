// Regra 4: a terapia intensiva conta pelo tipo do trecho (parâmetro dos tipos 3, 7, 8, 9 e 17), não pelo nome
// nem pela acomodação atual.
import { describe, expect, it } from 'vitest';
import { em, movimento } from './massa.spec-util.js';
import { MotorInternacao } from './motor.js';

describe('UTI pelo tipo do trecho', () => {
  const mov = movimento([
    {
      entrada: ['2026-04-01', '0800'],
      trechos: [
        // Um trecho de tipo 7 (CTI) numa acomodação cadastrada como apartamento.
        { unidade: 'APTO', tipo: 7, de: ['2026-04-01', '0800'], ate: ['2026-04-04', '0800'] },
        { unidade: 'APTO', tipo: 2, de: ['2026-04-04', '0800'] },
      ],
    },
  ]);

  it('o tipo do trecho decide; o parâmetro escolhe os tipos', () => {
    const com7 = new MotorInternacao(mov, {
      horaFechamento: 24,
      intensivas: [3, 7, 8, 9, 17],
      agora: em('2026-04-10'),
    });
    const sem7 = new MotorInternacao(mov, { horaFechamento: 24, intensivas: [3], agora: em('2026-04-10') });
    expect(com7.basesMensais('2026-04', '2026-04')[0]?.grandezas.pacientesDiaIntensiva).toBe(3);
    expect(sem7.basesMensais('2026-04', '2026-04')[0]?.grandezas.pacientesDiaIntensiva).toBe(0);
    const linha = com7.censoDoDia('2026-04-02').find((l) => l.tipo.id === 7);
    expect(linha).toMatchObject({
      acomodacao: 'APTO',
      intensiva: true,
      internados: 1,
      leitosOperacionais: 0,
    });
    expect(com7.linhas.get([...com7.linhas.keys()].find((k) => k.endsWith('\u00007'))!)?.tipoNome).toBe(
      'Tipo 7',
    );
  });
});
