import { describe, expect, it } from 'vitest';
import {
  errosConferenciaIdentidade,
  errosFotoIdentificacao,
  guardaFotoIdentificacaoAte,
  motivoDaConferencia,
  motivoRevogacaoValido,
  TAMANHO_MAXIMO_FOTO_IDENTIFICACAO,
  tipoDaConferencia,
  tipoDaFotoIdentificacao,
} from './foto-identificacao.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF = new Uint8Array(Buffer.from('%PDF-1.4 sintetico', 'latin1'));

describe('foto da identificação positiva', () => {
  it('tipo pela assinatura do conteúdo, nunca pelo nome', () => {
    expect(tipoDaFotoIdentificacao(JPEG)).toBe('image/jpeg');
    expect(tipoDaFotoIdentificacao(PNG)).toBe('image/png');
    expect(tipoDaFotoIdentificacao(PDF)).toBeNull();
    expect(tipoDaFotoIdentificacao(new Uint8Array())).toBeNull();
  });

  it('recusa o que não é imagem e o que passa do teto', () => {
    expect(errosFotoIdentificacao(JPEG)).toEqual([]);
    expect(errosFotoIdentificacao(PDF)).toEqual(['foto-tipo']);
    const grande = new Uint8Array(TAMANHO_MAXIMO_FOTO_IDENTIFICACAO + 1);
    grande.set(JPEG);
    expect(errosFotoIdentificacao(grande)).toEqual(['foto-tamanho']);
    expect(errosFotoIdentificacao(new Uint8Array())).toEqual(['foto-tipo', 'foto-tamanho']);
  });

  it('guarda de 20 anos (prontuário), com o 29 de fevereiro ajustado', () => {
    expect(guardaFotoIdentificacaoAte('2026-11-26')).toBe('2046-11-26');
    expect(guardaFotoIdentificacaoAte('2024-02-29')).toBe('2044-02-29');
    expect(guardaFotoIdentificacaoAte('2028-02-29')).toBe('2048-02-29');
    expect(guardaFotoIdentificacaoAte('2016-02-29T10:00:00')).toBe('2036-02-29');
    expect(guardaFotoIdentificacaoAte('2020-02-29')).toBe('2040-02-29');
    expect(guardaFotoIdentificacaoAte('2012-02-29')).toBe('2032-02-29');
    expect(guardaFotoIdentificacaoAte('2081-02-28')).toBe('2101-02-28');
    expect(guardaFotoIdentificacaoAte('2080-02-29')).toBe('2100-02-28');
  });

  it('conferência: confirmar ou negar exige foto ativa; a dispensa exige motivo', () => {
    const base = { contexto: 'recepcao', motivoDispensa: null, temFotoAtiva: true };
    expect(errosConferenciaIdentidade({ ...base, resultado: 'confirmada' })).toEqual([]);
    expect(errosConferenciaIdentidade({ ...base, resultado: 'nao_confirmada', temFotoAtiva: false })).toEqual(
      ['sem-foto'],
    );
    expect(errosConferenciaIdentidade({ ...base, resultado: 'dispensada', temFotoAtiva: false })).toEqual([
      'motivoDispensa',
    ]);
    expect(
      errosConferenciaIdentidade({
        ...base,
        resultado: 'dispensada',
        motivoDispensa: 'Paciente inconsciente',
        temFotoAtiva: false,
      }),
    ).toEqual([]);
    expect(errosConferenciaIdentidade({ ...base, resultado: 'talvez', contexto: 'balcao' })).toEqual([
      'resultado',
      'contexto',
    ]);
  });

  it('tipo e motivo da conferência', () => {
    expect(tipoDaConferencia('confirmada')).toBe('FOTO_CONFERIDA');
    expect(tipoDaConferencia('dispensada')).toBe('DOCUMENTO_CONFERIDO');
    expect(motivoDaConferencia('confirmada', 'qualquer')).toBeNull();
    expect(motivoDaConferencia('dispensada', '  Sem condição  ')).toBe('Sem condição');
    expect(motivoRevogacaoValido('foto de outra pessoa')).toBe(true);
    expect(motivoRevogacaoValido(' abc ')).toBe(false);
  });
});
