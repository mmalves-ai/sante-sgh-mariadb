import { describe, expect, it } from 'vitest';
import { RAZOES_IMPRESSAO, registroDaVia, regraJustificativaImpressao } from './impressao-justificada.js';

describe('justificativa da impressão do prontuário (01-ADM L82)', () => {
  it('1ª via sem justificativa é recusada', () => {
    expect(regraJustificativaImpressao({ viaAnterior: false })).toMatchObject({
      ok: false,
      codigo: 'justificativa-obrigatoria',
    });
    expect(regraJustificativaImpressao({ viaAnterior: false, justificativa: '   curta  ' })).toMatchObject({
      ok: false,
      codigo: 'justificativa-obrigatoria',
    });
  });
  it('1ª via com justificativa vira evento "impresso" com o texto aparado', () => {
    expect(
      regraJustificativaImpressao({ viaAnterior: false, justificativa: `  ${RAZOES_IMPRESSAO[0]} ` }),
    ).toEqual({ ok: true, tipo: 'impresso', justificativa: RAZOES_IMPRESSAO[0] });
  });
  it('o motivo sozinho não serve de justificativa da 1ª via', () => {
    expect(regraJustificativaImpressao({ viaAnterior: false, motivo: 'Via extraviada' })).toMatchObject({
      ok: false,
    });
  });
  it('nova via exige o motivo; aceita a justificativa no lugar', () => {
    expect(regraJustificativaImpressao({ viaAnterior: true })).toMatchObject({
      ok: false,
      codigo: 'motivo-obrigatorio',
    });
    expect(regraJustificativaImpressao({ viaAnterior: true, motivo: 'Perda' })).toEqual({
      ok: true,
      tipo: 'segunda-via',
      justificativa: 'Perda',
    });
    expect(regraJustificativaImpressao({ viaAnterior: true, justificativa: 'Via rasgada' })).toMatchObject({
      ok: true,
      tipo: 'segunda-via',
    });
  });
  it('texto acima do limite é recusado', () => {
    expect(regraJustificativaImpressao({ viaAnterior: false, justificativa: 'x'.repeat(256) })).toMatchObject(
      {
        ok: false,
        codigo: 'justificativa-longa',
      },
    );
  });
});

describe('registro único de cada via emitida (01-ADM L82)', () => {
  it('a 1ª via é impressão e leva a justificativa aparada', () => {
    expect(
      registroDaVia({ via: 1, texto: '  Entrega ao paciente na alta ', primeiraViaPedeTexto: true }),
    ).toEqual({
      ok: true,
      operacao: 'impressao',
      justificativa: 'Entrega ao paciente na alta',
    });
  });
  it('a 1ª via sem texto só passa quando a emissão é o próprio ato de entrega (laudo)', () => {
    expect(registroDaVia({ via: 1, primeiraViaPedeTexto: true })).toEqual({
      ok: false,
      codigo: 'justificativa-obrigatoria',
    });
    expect(registroDaVia({ via: 1, texto: '  ', primeiraViaPedeTexto: false })).toEqual({
      ok: true,
      operacao: 'impressao',
      justificativa: null,
    });
  });
  it('da 2ª via em diante é reimpressão e nunca sai sem o motivo', () => {
    expect(registroDaVia({ via: 2, texto: null, primeiraViaPedeTexto: false })).toEqual({
      ok: false,
      codigo: 'motivo-obrigatorio',
    });
    expect(registroDaVia({ via: 3, texto: 'Via extraviada', primeiraViaPedeTexto: false })).toEqual({
      ok: true,
      operacao: 'reimpressao',
      justificativa: 'Via extraviada',
    });
  });
  it('o texto longo é cortado no que cabe no registro', () => {
    const r = registroDaVia({ via: 1, texto: 'x'.repeat(600), primeiraViaPedeTexto: true });
    expect(r.ok && r.justificativa?.length).toBe(500);
  });
});
