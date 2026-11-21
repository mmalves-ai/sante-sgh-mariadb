// Regra 5: alta vazia (sentinela) = internado; as internações com dado impossível ficam marcadas no cálculo.
import { describe, expect, it } from 'vitest';
import { d, em, movimento } from './massa.spec-util.js';
import { MotorInternacao } from './motor.js';
import { normalizarTrajetorias } from './trajetoria.js';

describe('alta sentinela e marcas do cálculo', () => {
  const base = movimento(
    [
      { entrada: ['2026-06-01', '10:00'], trechos: [{ unidade: 'ENF', de: ['2026-06-01', '10:00'] }] },
      // Alta anterior à entrada: fora do cálculo, marcada.
      {
        entrada: ['2026-06-05', '10:00'],
        alta: ['2026-06-04', '10:00'],
        trechos: [{ unidade: 'ENF', de: ['2026-06-05', '10:00'] }],
      },
      // Sem trecho: um trecho na posição atual, marcada.
      { entrada: ['2026-06-02', '10:00'], alta: ['2026-06-03', '10:00'] },
      // Trecho em aberto com a alta dada; trecho invertido; trecho além da alta.
      {
        entrada: ['2026-06-02', '10:00'],
        alta: ['2026-06-06', '10:00'],
        trechos: [
          { unidade: 'ENF', de: ['2026-06-02', '10:00'], ate: ['2026-06-01', '10:00'] },
          { unidade: 'APTO', de: ['2026-06-02', '10:00'], ate: ['2026-06-08', '10:00'] },
        ],
      },
      {
        entrada: ['2026-06-03', '10:00'],
        alta: ['2026-06-04', '10:00'],
        trechos: [{ unidade: 'UTI', de: ['2026-06-03', '10:00'] }],
      },
      // No futuro: fora.
      { entrada: ['2027-01-01', '10:00'] },
    ],
    {
      trechosSoltos: [
        {
          reg: 1,
          cod: 999,
          bloco: '1',
          acomodacao: 'ENF',
          leito: '02',
          entrada: d('2026-06-01'),
          horaEntrada: '00:00',
          saida: null,
          horaSaida: null,
          tipo: 1,
        },
      ],
      transferencias: [
        {
          reg: 1,
          data: d('2026-06-02'),
          hora: '10:00',
          origem: { bloco: '1', acomodacao: 'ENF', leito: '01' },
          destino: { bloco: '1', acomodacao: 'APTO', leito: '01' },
        },
      ],
    },
  );

  it('o internado com alta sentinela continua internado no dia em curso', () => {
    const m = new MotorInternacao(base, {
      horaFechamento: 24,
      intensivas: [3],
      agora: em('2026-06-10', '12:00'),
    });
    const hoje = m.censoDoDia('2026-06-10').reduce((s, l) => s + l.internados, 0);
    expect(hoje).toBe(1);
    expect(m.ultimoMovimento).toBeGreaterThan(0);
  });

  it('as marcas contam cada caso, sem corrigir o dado', () => {
    const t = normalizarTrajetorias(base, em('2026-06-10'));
    expect(t.marcas).toMatchObject({
      'alta-anterior-a-entrada': 1,
      'trecho-sem-internacao': 1,
      'internacao-sem-trecho': 1,
      'trecho-invertido': 1,
      'trecho-aberto-com-alta': 1,
      'trecho-alem-da-alta': 1,
      'entrada-no-futuro': 1,
    });
    expect(t.internacoes).toHaveLength(4);
    const futuro = normalizarTrajetorias(base, em('2027-02-01'));
    expect(futuro.marcas['entrada-no-futuro']).toBe(0);
    expect(normalizarTrajetorias(base, em('2026-12-01')).marcas['entrada-no-futuro']).toBe(1);
  });

  it('cada caso marcado sai com o número da internação (relatório do arquivo médico), a contagem igual', () => {
    const t = normalizarTrajetorias(base, em('2026-06-10'));
    const regs = base.internacoes.map((i) => i.reg);
    // Na ordem do movimento: a alta anterior à entrada é a 2ª internação, o trecho solto aponta a internação 1.
    expect(t.casos).toContainEqual({ internacao: regs[1], marca: 'alta-anterior-a-entrada' });
    expect(t.casos).toContainEqual({ internacao: 1, marca: 'trecho-sem-internacao' });
    expect(t.casos).toContainEqual({ internacao: regs[2], marca: 'internacao-sem-trecho' });
    expect(t.casos).toContainEqual({ internacao: regs[5], marca: 'entrada-no-futuro' });
    for (const [m, n] of Object.entries(t.marcas))
      if (m !== 'transferencias-sem-trecho')
        expect(
          t.casos.filter((c) => c.marca === m),
          m,
        ).toHaveLength(n);
    const motor = new MotorInternacao(base, { horaFechamento: 24, intensivas: [3], agora: em('2026-06-10') });
    expect(motor.casosMarcados).toEqual(t.casos);
  });

  it('transferência registrada sem a mudança de unidade nos trechos: a diferença é marcada', () => {
    const t = normalizarTrajetorias(base, em('2026-06-10'));
    expect(t.mudancasDeUnidade).toBe(1);
    expect(t.marcas['transferencias-sem-trecho']).toBe(0);
  });
});
