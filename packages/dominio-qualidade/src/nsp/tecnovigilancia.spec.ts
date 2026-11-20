// Tecnovigilância e farmacovigilância (M48, etapa 2): o tipo na área, a situação para a frente, o número do Notivisa
// e os expostos só com item e lote.
import { describe, expect, it } from 'vitest';
import {
  calculaExpostos,
  conferirAberturaVigilancia,
  conferirAndamentoVigilancia,
  MENSAGENS_RECUSA_VIGILANCIA,
  tipoCabeNaArea,
} from './tecnovigilancia.js';

describe('tecnovigilância e farmacovigilância', () => {
  it('o tipo cabe na área', () => {
    expect(tipoCabeNaArea('reacaoAdversa', 'farmacovigilancia')).toBe(true);
    expect(tipoCabeNaArea('reacaoAdversa', 'tecnovigilancia')).toBe(false);
    expect(tipoCabeNaArea('eventoAdverso', 'tecnovigilancia')).toBe(true);
    expect(tipoCabeNaArea('queixaTecnica', 'farmacovigilancia')).toBe(true);
    expect(tipoCabeNaArea('x' as never, 'farmacovigilancia')).toBe(false);
    expect(conferirAberturaVigilancia({ area: 'tecnovigilancia', tipo: 'inefetividade' })).toBe(
      'tipo-fora-da-area',
    );
    expect(conferirAberturaVigilancia({ area: 'tecnovigilancia', tipo: 'alertaSanitario' })).toBeNull();
  });

  it('a situação só anda para a frente; notificada exige o número; o número não muda', () => {
    const aberta = { situacao: 'aberta' as const, versao: 1, notivisaNumero: null };
    expect(
      conferirAndamentoVigilancia(aberta, { versao: 1, situacao: 'emInvestigacao', notivisaNumero: null }),
    ).toEqual({ ok: true, encerra: false, notivisaNumero: null });
    expect(
      conferirAndamentoVigilancia(aberta, { versao: 1, situacao: 'notificada', notivisaNumero: null }),
    ).toEqual({
      ok: false,
      motivo: 'sem-numero-notivisa',
    });
    expect(
      conferirAndamentoVigilancia(aberta, { versao: 2, situacao: 'aberta', notivisaNumero: null }),
    ).toEqual({
      ok: false,
      motivo: 'versao-desatualizada',
    });
    const notificada = { situacao: 'notificada' as const, versao: 3, notivisaNumero: 'NV-1' };
    expect(
      conferirAndamentoVigilancia(notificada, { versao: 3, situacao: 'aberta', notivisaNumero: null }),
    ).toEqual({
      ok: false,
      motivo: 'situacao-nao-permite',
    });
    expect(
      conferirAndamentoVigilancia(notificada, { versao: 3, situacao: 'encerrada', notivisaNumero: null }),
    ).toEqual({ ok: true, encerra: true, notivisaNumero: 'NV-1' });
    expect(
      conferirAndamentoVigilancia(notificada, { versao: 3, situacao: 'encerrada', notivisaNumero: 'NV-2' }),
    ).toEqual({ ok: false, motivo: 'situacao-nao-permite' });
    expect(
      conferirAndamentoVigilancia(
        { situacao: 'encerrada', versao: 4, notivisaNumero: null },
        { versao: 4, situacao: 'encerrada', notivisaNumero: null },
      ),
    ).toEqual({ ok: false, motivo: 'situacao-nao-permite' });
  });

  it('expostos só com item e lote', () => {
    expect(calculaExpostos({ item: 10, lote: 'L1' })).toBe(true);
    expect(calculaExpostos({ item: null, lote: 'L1' })).toBe(false);
    expect(calculaExpostos({ item: 10, lote: ' ' })).toBe(false);
    expect(calculaExpostos({ item: 10, lote: null })).toBe(false);
    expect(Object.keys(MENSAGENS_RECUSA_VIGILANCIA)).toHaveLength(4);
  });
});
