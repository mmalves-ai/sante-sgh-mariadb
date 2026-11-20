import { describe, expect, it } from 'vitest';
import { decidirPublicacao, planejarLotes, podeIrPara, proximoLote, situacaoDaPreparacao } from './ciclo.js';
import { dentroDaJanela, JANELA_PADRAO, lerJanela, minutosDe } from './janela.js';

// Ciclo da carga (ficha do M13, regra 6): três passos, aprovação, lotes curtos fora do pico, cancelável entre
// lotes e retomada pelo último lote confirmado; um responsável por catálogo de cada vez (regra 3).
describe('ciclo da carga', () => {
  it('transições', () => {
    expect(podeIrPara('comparada', 'aprovada')).toBe(true);
    expect(podeIrPara('preparada', 'publicada')).toBe(false);
    expect(podeIrPara('publicando', 'cancelada')).toBe(true);
    expect(podeIrPara('falhou', 'publicando')).toBe(true);
    expect(podeIrPara('publicada', 'publicando')).toBe(false);
    expect(situacaoDaPreparacao(0, false)).toBe('comparada');
    expect(situacaoDaPreparacao(1, false)).toBe('rejeitada');
    expect(situacaoDaPreparacao(0, true)).toBe('rejeitada');
  });
  it('lotes e retomada', () => {
    expect(planejarLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(() => planejarLotes([1], 0)).toThrow();
    expect(proximoLote(3, 0)).toBe(1);
    expect(proximoLote(3, 2)).toBe(3);
    expect(proximoLote(3, 3)).toBeNull();
  });
  const base = {
    situacao: 'comparada' as const,
    responsavel: 'novo' as const,
    exigeContrato: false,
    contratoVigente: false,
    erros: 0,
    itensAPublicar: 10,
    janela: JANELA_PADRAO,
    agoraMinutos: 23 * 60,
  };
  it('decide a publicação', () => {
    expect(decidirPublicacao(base)).toEqual({ pode: true, codigo: null, motivo: null });
    expect(decidirPublicacao({ ...base, responsavel: 'externo' }).codigo).toBe('responsavel-externo');
    expect(decidirPublicacao({ ...base, exigeContrato: true }).codigo).toBe('sem-contrato');
    expect(decidirPublicacao({ ...base, exigeContrato: true, contratoVigente: true }).pode).toBe(true);
    expect(decidirPublicacao({ ...base, situacao: 'rejeitada' }).codigo).toBe('situacao-invalida');
    expect(decidirPublicacao({ ...base, erros: 1 }).codigo).toBe('carga-com-erros');
    expect(decidirPublicacao({ ...base, itensAPublicar: 0 }).codigo).toBe('sem-efeito');
    const fora = decidirPublicacao({ ...base, agoraMinutos: 12 * 60 });
    expect(fora).toMatchObject({ pode: true, codigo: 'fora-da-janela' });
    expect(decidirPublicacao({ ...base, agoraMinutos: 12 * 60, ignorarJanela: true }).codigo).toBeNull();
  });
});

describe('janela fora do pico', () => {
  it('atravessa a meia-noite e lê o parâmetro', () => {
    expect(dentroDaJanela(JANELA_PADRAO, minutosDe('23:30'))).toBe(true);
    expect(dentroDaJanela(JANELA_PADRAO, minutosDe('05:59'))).toBe(true);
    expect(dentroDaJanela(JANELA_PADRAO, minutosDe('06:00'))).toBe(false);
    expect(dentroDaJanela({ inicio: '01:00', fim: '03:00' }, minutosDe('02:00'))).toBe(true);
    expect(dentroDaJanela({ inicio: '01:00', fim: '03:00' }, minutosDe('04:00'))).toBe(false);
    expect(dentroDaJanela({ inicio: '00:00', fim: '00:00' }, 1)).toBe(true);
    expect(lerJanela('20:00-04:30')).toEqual({ inicio: '20:00', fim: '04:30' });
    expect(lerJanela('25:00-04:30')).toEqual(JANELA_PADRAO);
    expect(lerJanela(null)).toEqual(JANELA_PADRAO);
    expect(() => minutosDe('x')).toThrow();
  });
});
