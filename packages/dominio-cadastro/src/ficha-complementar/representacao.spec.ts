// Representação do paciente fora da lista de responsáveis (F3.1, 02-CAD linha 4): a condição de incapacidade (data e
// documento), a pendência `incapaz-sem-curador`, o aviso da abertura do atendimento e quem assina o consentimento.
import { describe, expect, it } from 'vitest';
import {
  alertasRepresentacao,
  errosIncapacidade,
  pendenciasRepresentacao,
  recusaEncerramento,
  recusaFimIncapacidade,
  signatarioDoConsentimento,
} from './responsaveis.js';

const HOJE = '2026-11-24';
const ADULTO = '1980-05-17';
const MENOR = '2016-03-02';
const curador = { id: 7, papel: 'curador', temComprovante: true };
const mae = { id: 3, papel: 'responsavel_legal', temComprovante: false };
const familiar = { id: 9, papel: 'familiar', temComprovante: false };

describe('incapacidade do paciente', () => {
  const base = {
    inicio: '2025-02-10',
    documentoTipo: 'sentenca_curatela',
    documentoNumero: '0001234-55.2025.8.13.0024',
    documentoData: '2025-02-10',
  };

  it('aceita a condição com data e documento; o laudo médico não pede número', () => {
    expect(errosIncapacidade(base, ADULTO, HOJE, false)).toEqual([]);
    expect(
      errosIncapacidade(
        { ...base, documentoTipo: 'laudo_medico', documentoNumero: null },
        ADULTO,
        HOJE,
        false,
      ),
    ).toEqual([]);
  });

  it('recusa início futuro ou anterior ao nascimento, documento sem tipo, sem data ou judicial sem processo', () => {
    expect(errosIncapacidade({ ...base, inicio: '2026-11-25' }, ADULTO, HOJE, false)).toEqual(['inicio']);
    expect(errosIncapacidade({ ...base, inicio: '1979-01-01' }, ADULTO, HOJE, false)).toEqual(['inicio']);
    expect(errosIncapacidade({ ...base, inicio: '10/02/2025' }, ADULTO, HOJE, false)).toEqual(['inicio']);
    expect(errosIncapacidade({ ...base, documentoTipo: 'declaracao' }, ADULTO, HOJE, false)).toEqual([
      'documentoTipo',
    ]);
    expect(errosIncapacidade({ ...base, documentoData: null }, ADULTO, HOJE, false)).toEqual([
      'documentoData',
    ]);
    expect(errosIncapacidade({ ...base, documentoData: '2026-12-01' }, ADULTO, HOJE, false)).toEqual([
      'documentoData',
    ]);
    expect(errosIncapacidade({ ...base, documentoNumero: '  ' }, ADULTO, HOJE, false)).toEqual([
      'documentoNumero',
    ]);
    expect(
      errosIncapacidade(
        { ...base, documentoTipo: 'curatela_provisoria', documentoNumero: null },
        ADULTO,
        HOJE,
        false,
      ),
    ).toEqual(['documentoNumero']);
  });

  it('uma só condição vigente por paciente', () => {
    expect(errosIncapacidade(base, ADULTO, HOJE, true)).toEqual(['incapacidade-ja-vigente']);
  });

  it('o levantamento não é futuro nem anterior ao início', () => {
    expect(recusaFimIncapacidade('2025-02-10', HOJE, HOJE)).toBeNull();
    expect(recusaFimIncapacidade('2025-02-10', '2025-02-10', HOJE)).toBeNull();
    expect(recusaFimIncapacidade('2025-02-10', '2025-02-09', HOJE)).toBe('fim');
    expect(recusaFimIncapacidade('2025-02-10', '2026-11-25', HOJE)).toBe('fim');
  });
});

describe('pendência incapaz-sem-curador', () => {
  it('sai da condição vigente sem curador e some com o curador', () => {
    expect(pendenciasRepresentacao(ADULTO, [], HOJE, true)).toEqual([
      { pendencia: 'incapaz-sem-curador', vinculo: null },
    ]);
    expect(pendenciasRepresentacao(ADULTO, [familiar], HOJE, true)).toEqual([
      { pendencia: 'incapaz-sem-curador', vinculo: null },
    ]);
    expect(pendenciasRepresentacao(ADULTO, [curador], HOJE, true)).toEqual([]);
    expect(pendenciasRepresentacao(ADULTO, [], HOJE)).toEqual([]);
  });

  it('o menor incapaz tem as duas pendências, cada uma resolvida pelo seu representante', () => {
    expect(pendenciasRepresentacao(MENOR, [], HOJE, true).map((p) => p.pendencia)).toEqual([
      'menor-sem-representante',
      'incapaz-sem-curador',
    ]);
    expect(pendenciasRepresentacao(MENOR, [mae], HOJE, true).map((p) => p.pendencia)).toEqual([
      'incapaz-sem-curador',
    ]);
  });

  it('com a incapacidade vigente, o último curador não é encerrado nem com o levantamento marcado', () => {
    expect(recusaEncerramento(ADULTO, [curador], 7, HOJE, true, true)).toBe('incapacidade-vigente');
    expect(recusaEncerramento(ADULTO, [curador], 7, HOJE, false, true)).toBe('incapacidade-vigente');
    expect(recusaEncerramento(ADULTO, [curador, { ...curador, id: 8 }], 7, HOJE, false, true)).toBeNull();
    // Sem a condição registrada, vale a regra anterior (o levantamento declarado libera).
    expect(recusaEncerramento(ADULTO, [curador], 7, HOJE, true)).toBeNull();
    expect(recusaEncerramento(ADULTO, [curador], 7, HOJE, false)).toBe('incapaz-sem-curador');
  });
});

describe('abertura do atendimento', () => {
  it('avisa só as pendências de quem representa (o comprovante ausente fica na ficha)', () => {
    expect(alertasRepresentacao(MENOR, [], HOJE, false)).toEqual(['menor-sem-representante']);
    expect(alertasRepresentacao(ADULTO, [], HOJE, true)).toEqual(['incapaz-sem-curador']);
    expect(alertasRepresentacao(MENOR, [], HOJE, true)).toEqual([
      'menor-sem-representante',
      'incapaz-sem-curador',
    ]);
    expect(alertasRepresentacao(ADULTO, [{ ...curador, temComprovante: false }], HOJE, true)).toEqual([]);
    expect(alertasRepresentacao(ADULTO, [], HOJE, false)).toEqual([]);
  });
});

describe('quem assina o consentimento', () => {
  const e = { nascimentoPaciente: ADULTO, incapaz: false, vigentes: [], hoje: HOJE } as const;

  it('o adulto capaz assina; o menor e o incapaz não', () => {
    expect(signatarioDoConsentimento({ ...e, signatario: 'paciente' })).toEqual({
      recusa: null,
      vinculo: null,
    });
    expect(signatarioDoConsentimento({ ...e, signatario: 'paciente', nascimentoPaciente: MENOR })).toEqual({
      recusa: 'paciente-menor',
    });
    expect(signatarioDoConsentimento({ ...e, signatario: 'paciente', incapaz: true })).toEqual({
      recusa: 'paciente-incapaz',
    });
  });

  it('pelo incapaz assina o curador, e só ele', () => {
    const i = { ...e, signatario: 'representante_legal', incapaz: true } as const;
    expect(signatarioDoConsentimento({ ...i, vigentes: [mae, curador] })).toEqual({
      recusa: null,
      vinculo: 7,
    });
    expect(signatarioDoConsentimento({ ...i, vigentes: [mae] })).toEqual({ recusa: 'curador-ausente' });
  });

  it('pelo menor assina o responsável legal, o guardião ou o tutor; familiar não representa', () => {
    const m = { ...e, signatario: 'representante_legal', nascimentoPaciente: MENOR } as const;
    expect(signatarioDoConsentimento({ ...m, vigentes: [familiar, mae] })).toEqual({
      recusa: null,
      vinculo: 3,
    });
    expect(signatarioDoConsentimento({ ...m, vigentes: [familiar] })).toEqual({
      recusa: 'representante-ausente',
    });
    expect(signatarioDoConsentimento({ ...m, vigentes: [curador] })).toEqual({
      recusa: 'representante-ausente',
    });
  });

  it('o adulto capaz com representante cadastrado pode ser representado; sem representante, recusa', () => {
    const a = { ...e, signatario: 'representante_legal' } as const;
    expect(signatarioDoConsentimento({ ...a, vigentes: [mae] })).toEqual({ recusa: null, vinculo: 3 });
    expect(signatarioDoConsentimento(a)).toEqual({ recusa: 'representante-ausente' });
  });
});
