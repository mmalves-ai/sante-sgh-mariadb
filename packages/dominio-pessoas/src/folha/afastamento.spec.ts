// Afastamento do colaborador (M53-F0; D-AFAST-531).
import { describe, expect, it } from 'vitest';
import {
  type AfastamentoLido,
  conferirAfastamento,
  conferirCancelamentoAfastamento,
  conferirEncerramentoAfastamento,
  periodosSeSobrepoem,
} from './afastamento.js';

const V = { admissao: '2020-01-01', desligamento: null };
const MOTIVOS = new Set([1, 3]);
const af = (id: number, inicio: string, fim: string | null, situacao = 'ativo'): AfastamentoLido => ({
  id,
  vinculo: 9,
  inicio,
  fim,
  situacao,
});

describe('periodosSeSobrepoem', () => {
  it('fim aberto alcança tudo depois; dias de borda contam', () => {
    expect(
      periodosSeSobrepoem({ inicio: '2026-01-01', fim: null }, { inicio: '2030-01-01', fim: '2030-01-02' }),
    ).toBe(true);
    expect(
      periodosSeSobrepoem({ inicio: '2026-01-01', fim: '2026-01-10' }, { inicio: '2026-01-10', fim: null }),
    ).toBe(true);
    expect(
      periodosSeSobrepoem({ inicio: '2026-01-01', fim: '2026-01-09' }, { inicio: '2026-01-10', fim: null }),
    ).toBe(false);
  });
});

describe('conferirAfastamento', () => {
  const ok = { inicio: '2026-09-01', fim: '2026-09-10', motivo: 1 };
  it('aceita o período válido', () => {
    expect(conferirAfastamento(ok, V, [], MOTIVOS)).toBeNull();
  });
  it('recusa motivo, ordem das datas, admissão, desligamento e sobreposição', () => {
    expect(conferirAfastamento({ ...ok, motivo: 2 }, V, [], MOTIVOS)?.codigo).toBe('motivo-inexistente');
    expect(conferirAfastamento({ ...ok, fim: '2026-08-31' }, V, [], MOTIVOS)?.codigo).toBe(
      'fim-antes-do-inicio',
    );
    expect(conferirAfastamento({ ...ok, inicio: '2019-12-31' }, V, [], MOTIVOS)?.codigo).toBe(
      'antes-da-admissao',
    );
    const deslig = { admissao: '2020-01-01', desligamento: '2026-09-05' };
    expect(conferirAfastamento(ok, deslig, [], MOTIVOS)?.codigo).toBe('depois-do-desligamento');
    expect(conferirAfastamento({ ...ok, fim: null }, deslig, [], MOTIVOS)?.codigo).toBe(
      'depois-do-desligamento',
    );
    expect(conferirAfastamento(ok, V, [af(1, '2026-09-10', null)], MOTIVOS)?.codigo).toBe('sobreposto');
  });
  it('o cancelado e o próprio (na alteração) não contam na sobreposição', () => {
    expect(conferirAfastamento(ok, V, [af(1, '2026-09-01', null, 'cancelado')], MOTIVOS)).toBeNull();
    expect(conferirAfastamento(ok, V, [af(1, '2026-09-01', null)], MOTIVOS, 1)).toBeNull();
  });
});

describe('encerrar e cancelar', () => {
  it('encerra o em vigor sem fim, pelas mesmas regras', () => {
    const a = { ...af(1, '2026-09-01', null), motivo: 1 };
    expect(conferirEncerramentoAfastamento(a, '2026-09-20', V, [a], MOTIVOS)).toBeNull();
    expect(conferirEncerramentoAfastamento(a, '2026-08-01', V, [a], MOTIVOS)?.codigo).toBe(
      'fim-antes-do-inicio',
    );
    expect(
      conferirEncerramentoAfastamento({ ...a, fim: '2026-09-02' }, '2026-09-20', V, [], MOTIVOS)?.codigo,
    ).toBe('ja-encerrado');
    expect(
      conferirEncerramentoAfastamento({ ...a, situacao: 'cancelado' }, '2026-09-20', V, [], MOTIVOS)?.codigo,
    ).toBe('cancelado');
  });
  it('cancela só o em vigor', () => {
    expect(conferirCancelamentoAfastamento(af(1, '2026-09-01', null))).toBeNull();
    expect(conferirCancelamentoAfastamento(af(1, '2026-09-01', null, 'cancelado'))?.codigo).toBe('cancelado');
  });
});
