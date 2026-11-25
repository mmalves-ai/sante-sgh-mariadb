import { describe, expect, it } from 'vitest';
import { aliquotaIssValida, planejarEnquadramento, problemasDoProcesso } from './enquadramento-favorecido.js';

const novo = {
  tributo: null,
  regime: 'lucro_presumido',
  retem: true,
  aliquotaIss: 2,
  processoTributario: null,
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
    expect(planejarEnquadramento({ ...novo, regime: 'decisao_judicial' }, []).problemas[0]?.campo).toBe(
      'processoTributario',
    );
    expect(
      planejarEnquadramento({ ...novo, regime: 'decisao_judicial', processoTributario: 9 }, []).problemas,
    ).toEqual([]);
    expect(planejarEnquadramento({ ...novo, aliquotaIss: 101 }, []).problemas[0]?.campo).toBe('aliquotaIss');
    expect(planejarEnquadramento({ ...novo, aliquotaIss: 2.12345 }, []).problemas[0]?.campo).toBe(
      'aliquotaIss',
    );
    expect(planejarEnquadramento({ ...novo, fim: '2026-10-01' }, []).problemas[0]?.campo).toBe('fim');
    expect(planejarEnquadramento({ ...novo, aliquotaIss: null, regime: 'mei' }, []).problemas).toEqual([]);
  });

  it('alíquota de ISS: até 4 casas sem o erro do ponto flutuante', () => {
    for (const a of [2.0001, 0.07, 0.0003, 0.14, 0.28, 0, 100, 99.9999, null])
      expect(aliquotaIssValida(a), String(a)).toBe(true);
    for (const a of [2.12345, 0.00001, -0.0001, 100.0001, Number.NaN])
      expect(aliquotaIssValida(a), String(a)).toBe(false);
    let recusadas = 0;
    for (let i = 0; i <= 1_000_000; i++) if (!aliquotaIssValida(i / 10_000)) recusadas++;
    expect(recusadas).toBe(0);
  });

  it('o enquadramento geral aberto do tributo recusa o deste estabelecimento; o geral encerrado antes, não', () => {
    const r = planejarEnquadramento(novo, [
      { id: 4, tributo: null, inicio: '2025-01-01', fim: null, geral: true },
    ]);
    expect(r.encerrar).toEqual([]);
    expect(r.problemas[0]?.mensagem).toMatch(/todos os estabelecimentos/);
    expect(
      planejarEnquadramento(novo, [
        { id: 4, tributo: null, inicio: '2025-01-01', fim: '2026-10-31', geral: true },
      ]),
    ).toEqual({ problemas: [], encerrar: [] });
  });

  it('decisão judicial: o processo é judicial, ativo e vigente no início', () => {
    const dj = { regime: 'decisao_judicial', processoTributario: 9, inicio: '2026-11-01' };
    const ok = { tipo: 'judicial', situacao: 'ativo', inicio: '2026-01-01', fim: null };
    expect(problemasDoProcesso(dj, ok)).toEqual([]);
    expect(problemasDoProcesso({ ...dj, processoTributario: null }, null)).toEqual([]);
    expect(problemasDoProcesso(dj, null)[0]?.mensagem).toMatch(/não encontrado/);
    expect(problemasDoProcesso(dj, { ...ok, tipo: 'administrativo' })[0]?.mensagem).toMatch(/judicial/);
    expect(problemasDoProcesso({ ...dj, regime: 'outro' }, { ...ok, tipo: 'administrativo' })).toEqual([]);
    expect(problemasDoProcesso(dj, { ...ok, situacao: 'encerrado' })[0]?.mensagem).toMatch(/ativo/);
    expect(problemasDoProcesso(dj, { ...ok, fim: '2026-10-31' })[0]?.mensagem).toMatch(/vigente/);
    expect(problemasDoProcesso(dj, { ...ok, inicio: '2026-11-02' })[0]?.mensagem).toMatch(/vigente/);
  });
});
