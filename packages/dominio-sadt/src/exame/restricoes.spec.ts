// Regra 6 (ficha do M26): alerta ou bloqueio para sexo e idade incompatíveis e para repetição no intervalo mínimo.
import { describe, expect, it } from 'vitest';
import {
  decisaoDasRestricoes,
  emDias,
  idadeEmDias,
  repeticao,
  type RestricaoCadastro,
  restricoesDoExame,
} from './restricoes.js';

const sem: RestricaoCadastro = {
  sexo: null,
  notificacaoSexo: null,
  idadeMinima: null,
  unidadeIdadeMinima: null,
  idadeMaxima: null,
  unidadeIdadeMaxima: null,
  notificacaoIdade: null,
};

describe('restrições do exame (regra 6)', () => {
  it('sexo: só masculino, só feminino, ambos e sem sexo no cadastro do paciente', () => {
    const soFem = { ...sem, sexo: 2, notificacaoSexo: 2 };
    expect(restricoesDoExame(soFem, { sexo: 'M', idadeDias: 10_000 })).toEqual([
      { tipo: 'sexo', nivel: 'bloqueio', texto: 'Exame indicado só para o sexo feminino.' },
    ]);
    expect(restricoesDoExame(soFem, { sexo: 'F', idadeDias: 10_000 })).toEqual([]);
    expect(restricoesDoExame({ ...sem, sexo: 1 }, { sexo: 'F', idadeDias: null })[0]?.nivel).toBe('alerta');
    expect(
      restricoesDoExame({ ...sem, sexo: 1, notificacaoSexo: 3 }, { sexo: 'F', idadeDias: null })[0]?.nivel,
    ).toBe('justificativa');
    expect(restricoesDoExame({ ...sem, sexo: 3 }, { sexo: 'M', idadeDias: 1 })).toEqual([]);
    expect(restricoesDoExame({ ...sem, sexo: 1 }, { sexo: null, idadeDias: 1 })).toEqual([]);
  });

  it('idade: limites em dias, meses e anos', () => {
    expect(emDias(10, 3)).toBe(10);
    expect(emDias(2, 2)).toBeCloseTo(60.875);
    expect(emDias(1, 1)).toBeCloseTo(365.25);
    expect(emDias(1, null)).toBeCloseTo(365.25);
    const adulto = { ...sem, idadeMinima: 18, unidadeIdadeMinima: 1, notificacaoIdade: 2 };
    expect(restricoesDoExame(adulto, { sexo: 'M', idadeDias: 365 * 10 })[0]).toMatchObject({
      tipo: 'idade',
      nivel: 'bloqueio',
    });
    expect(restricoesDoExame(adulto, { sexo: 'M', idadeDias: 365 * 30 })).toEqual([]);
    const neonatal = { ...sem, idadeMaxima: 28, unidadeIdadeMaxima: 3 };
    expect(restricoesDoExame(neonatal, { sexo: 'M', idadeDias: 40 })[0]?.nivel).toBe('alerta');
    expect(restricoesDoExame(neonatal, { sexo: 'M', idadeDias: null })).toEqual([]);
  });

  it('idade em dias pelo nascimento', () => {
    expect(idadeEmDias('2026-01-01', '2026-01-31')).toBe(30);
    expect(idadeEmDias(null, '2026-01-31')).toBeNull();
    expect(idadeEmDias('2026-02-01', '2026-01-31')).toBeNull();
    expect(idadeEmDias('inválida', '2026-01-31')).toBeNull();
  });

  it('repetição no intervalo mínimo', () => {
    const r = repeticao(['2026-10-20T08:00:00Z', '2026-10-21T20:00:00Z'], '2026-10-22T08:00:00Z', 24);
    expect(r).toEqual({
      tipo: 'repeticao',
      nivel: 'alerta',
      texto: 'O mesmo exame foi pedido há 12 hora(s) (intervalo mínimo de 24 horas).',
    });
    expect(repeticao(['2026-10-20T08:00:00Z'], '2026-10-22T08:00:00Z', 24)).toBeNull();
    expect(repeticao(['2026-10-21T20:00:00Z'], '2026-10-22T08:00:00Z', 0)).toBeNull();
    expect(repeticao(['2026-10-23T08:00:00Z', 'x'], '2026-10-22T08:00:00Z', 24)).toBeNull();
  });

  it('decisão: bloqueio recusa; alerta e justificativa pedem a confirmação', () => {
    expect(decisaoDasRestricoes([], false)).toEqual({ segue: true, motivo: null });
    const alerta = { tipo: 'repeticao', nivel: 'alerta', texto: 'x' } as const;
    expect(decisaoDasRestricoes([alerta], false).segue).toBe(false);
    expect(decisaoDasRestricoes([alerta], true).segue).toBe(true);
    expect(decisaoDasRestricoes([{ tipo: 'sexo', nivel: 'bloqueio', texto: 'Só feminino.' }], true)).toEqual({
      segue: false,
      motivo: 'Só feminino.',
    });
  });
});
