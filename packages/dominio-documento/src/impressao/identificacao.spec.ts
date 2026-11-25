import { describe, expect, it } from 'vitest';
import { finalidadeDaIdentificacao, planoImpressaoIdentificacao } from './identificacao.js';

const motivo = { ativo: true, exigeComplemento: false };

describe('impressão da identificação do paciente (01-ADM L79)', () => {
  it('a primeira impressão é a via 1 e não pede motivo', () => {
    expect(planoImpressaoIdentificacao({ viasAnteriores: 0, motivoInformado: false, motivo: null })).toEqual({
      via: 1,
      reimpressao: false,
      complemento: null,
    });
    // O motivo que vier na primeira impressão é ignorado: não há reimpressão a justificar.
    expect(
      planoImpressaoIdentificacao({ viasAnteriores: 0, motivoInformado: true, motivo, complemento: 'x' }),
    ).toEqual({ via: 1, reimpressao: false, complemento: null });
  });

  it('já impressa, só sai de novo com o motivo do catálogo', () => {
    expect(planoImpressaoIdentificacao({ viasAnteriores: 1, motivoInformado: false, motivo: null })).toEqual({
      recusa: 'motivo-obrigatorio',
    });
    expect(planoImpressaoIdentificacao({ viasAnteriores: 1, motivoInformado: true, motivo: null })).toEqual({
      recusa: 'motivo-inexistente',
    });
    expect(
      planoImpressaoIdentificacao({
        viasAnteriores: 1,
        motivoInformado: true,
        motivo: { ativo: false, exigeComplemento: false },
      }),
    ).toEqual({ recusa: 'motivo-inativo' });
  });

  it('a reimpressão segue a via e cobra o complemento quando o motivo pede', () => {
    expect(planoImpressaoIdentificacao({ viasAnteriores: 1, motivoInformado: true, motivo })).toEqual({
      via: 2,
      reimpressao: true,
      complemento: null,
    });
    const pede = { ativo: true, exigeComplemento: true };
    expect(
      planoImpressaoIdentificacao({
        viasAnteriores: 3,
        motivoInformado: true,
        motivo: pede,
        complemento: ' ab ',
      }),
    ).toEqual({ recusa: 'complemento-obrigatorio' });
    expect(
      planoImpressaoIdentificacao({
        viasAnteriores: 3,
        motivoInformado: true,
        motivo: pede,
        complemento: ' pulseira rasgada ',
      }),
    ).toEqual({ via: 4, reimpressao: true, complemento: 'pulseira rasgada' });
  });

  it('a finalidade vem do tipo: ativa, da mídia certa, nunca a de amostra', () => {
    const fs = [
      { id: 1, codigo: 'ETIQUETA_AMOSTRA', midia: 'etiqueta', ativa: true },
      { id: 2, codigo: 'ETIQUETA_GERAL', midia: 'etiqueta', ativa: true },
      { id: 3, codigo: 'ETIQUETA_PRONTUARIO', midia: 'etiqueta', ativa: true },
      { id: 4, codigo: 'PULSEIRA', midia: 'pulseira', ativa: false },
      { id: 5, codigo: 'PULSEIRA_ADULTO', midia: 'pulseira', ativa: true },
      { id: 6, codigo: 'A4', midia: 'a4', ativa: true },
    ];
    expect(finalidadeDaIdentificacao('etiqueta', fs)).toBe(3);
    expect(finalidadeDaIdentificacao('pulseira', fs)).toBe(5);
    expect(finalidadeDaIdentificacao('etiqueta', fs.slice(0, 1))).toBeNull();
    expect(finalidadeDaIdentificacao('etiqueta', fs.slice(0, 2))).toBe(2);
    expect(finalidadeDaIdentificacao('pulseira', fs.slice(0, 4))).toBeNull();
  });
});
