// Regra 1 do M37: retratos sintéticos das últimas conexões do outro sistema, com e sem mudança.
import { describe, expect, it } from 'vitest';
import {
  diaCivilDe,
  diasDesdeUltimaConexao,
  emQuedaContinua,
  retratoDoDia,
  seriePessoasPorDia,
} from './ultima-conexao.js';

const d = (s: string) => new Date(s);

describe('retrato das últimas conexões (regra 1)', () => {
  it('marca "mudou" só quando a última conexão avançou desde o retrato anterior', () => {
    const anterior = [
      { login: 'SINT.A', modulo: 1, ultima: d('2026-11-03T12:00:00Z') },
      { login: 'SINT.B', modulo: 1, ultima: d('2026-11-03T12:00:00Z') },
      { login: 'SINT.B', modulo: 1, ultima: d('2026-11-02T12:00:00Z') },
    ];
    const lidas = [
      { login: 'SINT.A ', modulo: 1, ultima: d('2026-11-04T13:00:00Z') },
      { login: 'SINT.B', modulo: 1, ultima: d('2026-11-03T12:00:00Z') },
      { login: 'SINT.B', modulo: 1, ultima: d('2026-11-01T12:00:00Z') },
      { login: 'SINT.C', modulo: 2, ultima: d('2026-11-04T15:00:00Z') },
      { login: 'SINT.D', modulo: 2, ultima: d('2026-10-01T15:00:00Z') },
    ];
    const r = retratoDoDia('2026-11-04', lidas, anterior);
    expect(r.map((x) => [x.login, x.modulo, x.mudou])).toEqual([
      ['SINT.A', 1, true],
      ['SINT.B', 1, false],
      ['SINT.C', 2, true],
      ['SINT.D', 2, false],
    ]);
  });

  it('sem retrato anterior, só a conexão do próprio dia conta como uso', () => {
    const r = retratoDoDia('2026-11-04', [{ login: 'X', modulo: 3, ultima: d('2026-11-04T02:00:00Z') }], []);
    // 02:00 UTC é 23:00 do dia 3 em São Paulo: não é do dia 4.
    expect(r[0]?.mudou).toBe(false);
    expect(diaCivilDe(d('2026-11-04T02:00:00Z'))).toBe('2026-11-03');
  });

  it('dias desde a última conexão em qualquer módulo; nunca conectou: null', () => {
    expect(diasDesdeUltimaConexao([], '2026-11-04')).toBeNull();
    expect(diasDesdeUltimaConexao([d('2026-10-30T15:00:00Z'), d('2026-11-01T15:00:00Z')], '2026-11-04')).toBe(
      3,
    );
    expect(diasDesdeUltimaConexao([d('2026-11-05T15:00:00Z')], '2026-11-04')).toBe(0);
  });

  it('série de pessoas por dia e queda contínua por semana', () => {
    const linhas = [
      { dia: '2026-11-01', login: 'a', modulo: 1, ultima: d('2026-11-01T12:00:00Z'), mudou: true },
      { dia: '2026-11-01', login: 'A', modulo: 2, ultima: d('2026-11-01T12:00:00Z'), mudou: true },
      { dia: '2026-11-01', login: 'b', modulo: 1, ultima: d('2026-11-01T12:00:00Z'), mudou: true },
      { dia: '2026-11-02', login: 'c', modulo: 1, ultima: d('2026-11-01T12:00:00Z'), mudou: false },
      { dia: '2026-11-08', login: 'a', modulo: 1, ultima: d('2026-11-08T12:00:00Z'), mudou: true },
    ];
    expect(seriePessoasPorDia(linhas)).toEqual([
      { dia: '2026-11-01', pessoas: 2 },
      { dia: '2026-11-08', pessoas: 1 },
    ]);
    expect(seriePessoasPorDia(linhas, new Set(['B']))).toEqual([{ dia: '2026-11-01', pessoas: 1 }]);
    const queda = [
      { dia: '2026-11-01', pessoas: 10 },
      { dia: '2026-11-03', pessoas: 9 },
      { dia: '2026-11-09', pessoas: 4 },
      { dia: '2026-11-14', pessoas: 0 },
    ];
    expect(emQuedaContinua(queda, 14)).toBe(true);
    expect(emQuedaContinua([...queda.slice(0, 2), { dia: '2026-11-14', pessoas: 12 }], 14)).toBe(false);
    expect(emQuedaContinua([{ dia: '2026-11-14', pessoas: 1 }], 14)).toBe(false);
    expect(emQuedaContinua([], 14)).toBe(false);
  });
});
