// Regra 14 do M25: a responsabilidade só passa com o aceite de quem recebe; pendências herdadas.
import { describe, expect, it } from 'vitest';
import {
  conferirAceite,
  conferirCancelamento,
  conferirPassagem,
  pendenciasHerdadas,
  responsavel,
} from './aceite.js';

const p = { situacao: 'aguardandoAceite' as const, passadoPor: 'ENF.A', recebedor: 'ENF.B' };

describe('regra 14: passagem de plantão com aceite', () => {
  it('só o recebedor indicado aceita; quem passa não', () => {
    expect(conferirAceite(p, 'enf.b')).toBeNull();
    expect(conferirAceite(p, 'ENF.A')).toMatch(/Quem passa/);
    expect(conferirAceite(p, 'ENF.C')).toMatch(/indicado/);
    expect(conferirAceite({ ...p, situacao: 'aceita' }, 'ENF.B')).toMatch(/já foi respondida/);
    expect(conferirAceite(null, 'ENF.B')).toMatch(/não foi encontrada/);
  });
  it('a responsabilidade é de quem passou até o aceite', () => {
    expect(responsavel(p)).toBe('ENF.A');
    expect(responsavel({ ...p, situacao: 'recusada' })).toBe('ENF.A');
    expect(responsavel({ ...p, situacao: 'aceita' })).toBe('ENF.B');
  });
  it('a passagem pede outro recebedor e ao menos uma nota', () => {
    expect(conferirPassagem({ passadoPor: 'ENF.A', recebedor: 'enf.a', notas: 1 })).toMatch(
      /outro profissional/,
    );
    expect(conferirPassagem({ passadoPor: 'ENF.A', recebedor: 'ENF.B', notas: 0 })).toMatch(/pelo menos um/);
    expect(conferirPassagem({ passadoPor: 'ENF.A', recebedor: 'ENF.B', notas: 2 })).toBeNull();
  });
  it('pendências herdadas: doses atrasadas e omitidas; cuidado não feito', () => {
    const m = pendenciasHerdadas([
      {
        id: 1,
        paciente: 10,
        estado: 'atrasada',
        tipo: 'medicamento',
        descricao: 'Dipirona',
        previsto: '2026-10-22T10:00',
      },
      {
        id: 2,
        paciente: 10,
        estado: 'omitida',
        tipo: 'medicamento',
        descricao: 'Cefalotina',
        previsto: '2026-10-22T08:00',
      },
      {
        id: 3,
        paciente: 11,
        estado: 'atrasada',
        tipo: 'cuidado',
        descricao: 'Curativo',
        previsto: '2026-10-22T09:00',
      },
      {
        id: 4,
        paciente: 11,
        estado: 'administrada',
        tipo: 'medicamento',
        descricao: 'Soro',
        previsto: '2026-10-22T09:00',
      },
    ]);
    expect(m.get(10)?.map((x) => x.tipo)).toEqual(['doseAtrasada', 'doseOmitida']);
    expect(m.get(10)?.[0]?.descricao).toBe('Dipirona (10:00)');
    expect(m.get(11)).toEqual([{ tipo: 'cuidadoNaoFeito', descricao: 'Curativo (09:00)', horario: 3 }]);
  });
});

describe('W0-03: cancelamento da passagem', () => {
  const base = { passadoPor: 'ANA', recebedor: 'BIA' };
  it('quem passou cancela antes do aceite', () => {
    expect(conferirCancelamento({ ...base, situacao: 'aguardandoAceite' }, 'ana')).toBeNull();
  });
  it('depois do aceite, da recusa ou do cancelamento: recusa', () => {
    for (const situacao of ['aceita', 'recusada', 'cancelada'] as const)
      expect(conferirCancelamento({ ...base, situacao }, 'ANA')?.codigo).toBe('plantao-ja-respondido');
  });
  it('só quem passou', () => {
    expect(conferirCancelamento({ ...base, situacao: 'aguardandoAceite' }, 'BIA')?.codigo).toBe(
      'plantao-de-outro',
    );
    expect(conferirCancelamento(null, 'ANA')?.codigo).toBe('plantao-inexistente');
  });
  it('a passagem cancelada não se aceita', () => {
    expect(conferirAceite({ ...base, situacao: 'cancelada' }, 'BIA')).toMatch(/cancelada/);
  });
});
