// Regra 3 da ficha do M15: documento emitido (03/2022 em diante) para "como emitido"; sem ele, o formulário
// gravado com o cabeçalho dos retratos; sem formulário, o texto formatado.
import { describe, expect, it } from 'vitest';
import { BASE } from './corpus.spec-util.js';
import { fonteComoEmitido, marcasDoRegistro } from './registro.js';

describe('escolha da fonte por registro', () => {
  it('registro de 2021 sem documento: o formulário da época', () => {
    expect(fonteComoEmitido({ documento: false, layout: true, texto: true })).toBe('layout');
  });
  it('registro de 2024 com documento e evento suspenso: o documento, com a marca', () => {
    expect(fonteComoEmitido({ documento: true, layout: true, texto: true })).toBe('documento');
    const m = marcasDoRegistro(
      { ...BASE, dataHora: '2024-03-01T10:00:00', situacoesDocumento: [1, 2] },
      new Date(),
    );
    expect(m.suspenso).toBe(true);
  });
  it('só o texto; e nenhuma fonte', () => {
    expect(fonteComoEmitido({ documento: false, layout: false, texto: true })).toBe('texto');
    expect(fonteComoEmitido({ documento: false, layout: false, texto: false })).toBe('nenhuma');
  });
});
