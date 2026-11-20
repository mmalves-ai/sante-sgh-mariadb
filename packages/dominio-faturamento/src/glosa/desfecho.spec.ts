// Regra 8 do M31 (desfecho): exige número do demonstrativo e data ≥ DT_RE; acatado = VLR_RE, QTD_RE e 3095; parcial
// entre R$ 0,01 e o recursado (motivo 0 por padrão); negado = 0 e o motivo informado (o indeferimento vai ao SGH_).
import { describe, expect, it } from 'vitest';
import { conferirDesfecho, MOTIVO_ACATADO } from '@sgh/contratos/regras-faturamento';

const item = {
  valorRecurso: 40,
  quantidadeRecurso: 1.5,
  dataRecurso: '2026-09-10',
  valorRetorno: 0,
  dataRetorno: null,
};
const d = (x: Partial<Parameters<typeof conferirDesfecho>[0]> = {}) =>
  conferirDesfecho({ item, desfecho: 'acatado', data: '2026-10-01', numeroDemonstrativo: 'D-1', ...x });

describe('desfecho do recurso', () => {
  it('acatado: o recursado inteiro com 3095', () => {
    expect(d()).toEqual({ ok: true, valores: { valor: 40, quantidade: 1.5, motivo: MOTIVO_ACATADO } });
    const r = d({ valor: 30 });
    expect(r.ok).toBe(false);
  });
  it('parcial: entre 0,01 e menos que o recursado', () => {
    expect(d({ desfecho: 'parcial', valor: 15.555 })).toEqual({
      ok: true,
      valores: { valor: 15.56, quantidade: 1.5, motivo: 0 },
    });
    expect(d({ desfecho: 'parcial', valor: 40 }).ok).toBe(false);
    expect(d({ desfecho: 'parcial' }).ok).toBe(false);
    expect(d({ desfecho: 'parcial', valor: 10, motivo: 1001 })).toMatchObject({ valores: { motivo: 1001 } });
  });
  it('negado: 0 com o motivo; sem motivo, com valor ou com 3095: recusado', () => {
    expect(d({ desfecho: 'negado', motivo: 1001 })).toEqual({
      ok: true,
      valores: { valor: 0, quantidade: 0, motivo: 1001 },
    });
    expect(d({ desfecho: 'negado', motivo: 0 })).toMatchObject({ ok: true });
    expect(d({ desfecho: 'negado' }).ok).toBe(false);
    expect(d({ desfecho: 'negado', valor: 5, motivo: 1 }).ok).toBe(false);
    expect(d({ desfecho: 'negado', motivo: MOTIVO_ACATADO }).ok).toBe(false);
  });
  it.each([
    [{ data: '2026-09-01' }, 'data-anterior-ao-recurso'],
    [{ numeroDemonstrativo: ' ' }, 'demonstrativo-obrigatorio'],
    [{ item: { ...item, valorRecurso: 0 } }, 'sem-recurso'],
    [{ item: { ...item, dataRetorno: '2026-09-20' } }, 'retorno-ja-baixado'],
  ])('%j → %s', (x, codigo) => {
    const r = d(x as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusa.codigo).toBe(codigo);
  });
  it('a data igual à do recurso é aceita', () => {
    expect(d({ data: '2026-09-10' }).ok).toBe(true);
  });
});
