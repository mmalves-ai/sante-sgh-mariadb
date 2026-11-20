// Regra 5: alta vazia (sentinela) = internado; as internações com dado impossível ficam marcadas no cálculo.
import { describe, expect, it } from 'vitest';
import { d, em, movimento } from './massa.spec-util.js';
import { MotorInternacao } from './motor.js';
import { normalizarTrajetorias } from './trajetoria.js';

describe('alta sentinela e marcas do cálculo', () => {
  const base = movimento(
    [
      { entrada: ['2026-06-01', '1000'], trechos: [{ unidade: 'ENF', de: ['2026-06-01', '1000'] }] },
      // Alta anterior à entrada: fora do cálculo, marcada.
      {
        entrada: ['2026-06-05', '1000'],
        alta: ['2026-06-04', '1000'],
        trechos: [{ unidade: 'ENF', de: ['2026-06-05', '1000'] }],
      },
      // Sem trecho: um trecho na posição atual, marcada.
      { entrada: ['2026-06-02', '1000'], alta: ['2026-06-03', '1000'] },
      // Trecho em aberto com a alta dada; trecho invertido; trecho além da alta.
      {
        entrada: ['2026-06-02', '1000'],
        alta: ['2026-06-06', '1000'],
        trechos: [
          { unidade: 'ENF', de: ['2026-06-02', '1000'], ate: ['2026-06-01', '1000'] },
          { unidade: 'APTO', de: ['2026-06-02', '1000'], ate: ['2026-06-08', '1000'] },
        ],
      },
      {
        entrada: ['2026-06-03', '1000'],
        alta: ['2026-06-04', '1000'],
        trechos: [{ unidade: 'UTI', de: ['2026-06-03', '1000'] }],
      },
      // No futuro: fora.
      { entrada: ['2027-01-01', '1000'] },
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
          horaEntrada: '0000',
          saida: null,
          horaSaida: null,
          tipo: 1,
        },
      ],
      transferencias: [
        {
          reg: 1,
          data: d('2026-06-02'),
          hora: '1000',
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
      agora: em('2026-06-10', '1200'),
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
