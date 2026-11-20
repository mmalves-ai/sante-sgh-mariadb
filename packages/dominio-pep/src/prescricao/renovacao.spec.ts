// Regra 14 do M24: aviso de renovação pendente e as que vencem no turno.
import { describe, expect, it } from 'vitest';
import { renovacaoPendente, vencemNoTurno } from './renovacao.js';

const p = (id: number, atendimento: number, inicio: string, fim: string, suspensa = false) => ({
  id,
  atendimento,
  vigencia: { inicio, fim },
  suspensa,
});

describe('renovação', () => {
  const vigente = p(1, 10, '2026-06-19T16:01', '2026-06-20T16:00');
  it('avisa nas últimas 6 horas sem prescrição do período seguinte', () => {
    expect(renovacaoPendente([vigente], '2026-06-20T09:59')).toBeNull();
    expect(renovacaoPendente([vigente], '2026-06-20T10:00')?.id).toBe(1);
    expect(
      renovacaoPendente([vigente, p(2, 10, '2026-06-20T16:01', '2026-06-21T16:00')], '2026-06-20T12:00'),
    ).toBeNull();
    expect(renovacaoPendente([{ ...vigente, suspensa: true }], '2026-06-20T12:00')).toBeNull();
    expect(renovacaoPendente([vigente], '2026-06-20T17:00')).toBeNull();
  });
  it('lista as que vencem no turno, por atendimento, sem a seguinte', () => {
    const outra = p(3, 11, '2026-06-19T16:01', '2026-06-20T16:00');
    const renovada = p(4, 11, '2026-06-20T16:01', '2026-06-21T16:00');
    const fora = p(5, 12, '2026-06-20T08:00', '2026-06-21T07:59');
    const r = vencemNoTurno(
      [vigente, outra, renovada, fora, p(6, 13, '2026-06-18T16:01', '2026-06-19T16:00')],
      '2026-06-20T12:00',
      '2026-06-20T19:00',
    );
    expect(r.map((x) => x.id)).toEqual([1]);
  });
});
