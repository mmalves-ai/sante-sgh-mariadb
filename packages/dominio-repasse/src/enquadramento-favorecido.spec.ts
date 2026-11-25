import { describe, expect, it } from 'vitest';
import { planejarEnquadramento } from './enquadramento-favorecido.js';

const novo = {
  tributo: null,
  regime: 'lucro_presumido',
  retem: true,
  aliquotaIss: 2,
  inicio: '2026-11-01',
  fim: null,
};

describe('enquadramento tributário do fornecedor do favorecido', () => {
  it('o novo termina o anterior aberto do mesmo tributo no dia de antes', () => {
    const r = planejarEnquadramento(novo, [
      { id: 1, tributo: null, inicio: '2026-01-01', fim: null },
      { id: 2, tributo: 7, inicio: '2026-01-01', fim: null },
      { id: 3, tributo: null, inicio: '2025-01-01', fim: '2025-12-31' },
    ]);
    expect(r).toEqual({ problemas: [], encerrar: [{ id: 1, fim: '2026-10-31' }] });
  });

  it('recusa quando já há enquadramento do tributo a partir do mesmo dia ou depois', () => {
    const r = planejarEnquadramento(novo, [{ id: 1, tributo: null, inicio: '2026-11-01', fim: null }]);
    expect(r.encerrar).toEqual([]);
    expect(r.problemas.map((p) => p.campo)).toEqual(['inicio']);
  });

  it('recusa regime inválido, decisão judicial sem processo, alíquota fora da faixa e fim antes do início', () => {
    expect(planejarEnquadramento({ ...novo, regime: 'xpto' }, []).problemas[0]?.campo).toBe('regime');
    expect(planejarEnquadramento({ ...novo, regime: 'decisao_judicial' }, []).problemas[0]?.mensagem).toMatch(
      /processo/,
    );
    expect(planejarEnquadramento({ ...novo, aliquotaIss: 101 }, []).problemas[0]?.campo).toBe('aliquotaIss');
    expect(planejarEnquadramento({ ...novo, aliquotaIss: 2.12345 }, []).problemas[0]?.campo).toBe(
      'aliquotaIss',
    );
    expect(planejarEnquadramento({ ...novo, fim: '2026-10-01' }, []).problemas[0]?.campo).toBe('fim');
    expect(planejarEnquadramento({ ...novo, aliquotaIss: null, regime: 'mei' }, []).problemas).toEqual([]);
  });
});
