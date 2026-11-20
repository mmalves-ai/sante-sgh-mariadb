// W0-03 (M6): o documento RIA da aplicação, da substituição e do cancelamento; o destino pelo ambiente e pela
// credencial (dev e ci SEMPRE no simulador local); o motivo da recusa da RNDS sem dígitos longos. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  destinoRia,
  documentoRia,
  eventoRia,
  imunizacaoDoRegistro,
  motivoDaRecusaRnds,
  reciboDaRnds,
  SemCredencialRnds,
} from './ria.js';

const REG = {
  id: 7,
  imunobiologico: '33',
  nome: 'Vacina sintetica',
  lote: 'LOTE-1',
  fabricante: null,
  dose: 'D1',
  via: 'IM',
  local: 'DD',
  aplicadaEm: '2031-01-06T09:00',
};
const imun = imunizacaoDoRegistro(REG, { hospital: 'pc', paciente: 5, vacinador: 'SINT.ENF' });
const EM = new Date('2031-01-06T12:00:00Z');

describe('W0-03 M6: documento RIA', () => {
  it('a imunização com os identificadores do conector e a hora de São Paulo', () => {
    expect(imun).toMatchObject({
      resourceType: 'Immunization',
      id: 'vac-pc-7',
      status: 'completed',
      patient: { reference: 'Patient/pac-pc-5' },
      occurrenceDateTime: '2031-01-06T12:00:00.000Z',
      lotNumber: 'LOTE-1',
    });
    expect(imun).not.toHaveProperty('manufacturer');
  });

  it('aplicação (versão 0): Composition final sem relatesTo e a imunização completa', () => {
    const b = documentoRia({
      evento: 'fato.vacina.aplicada',
      hospital: 'pc',
      vacina: 7,
      versao: 0,
      imunizacao: imun,
      emitidoEm: EM,
    });
    expect(b).toMatchObject({
      resourceType: 'Bundle',
      type: 'document',
      identifier: { value: 'ria-pc-7-v0' },
    });
    const [c, i] = (b['entry'] as { resource: Record<string, unknown> }[]).map((x) => x.resource);
    expect(c).toMatchObject({
      resourceType: 'Composition',
      status: 'final',
      subject: { reference: 'Patient/pac-pc-5' },
    });
    expect(c).not.toHaveProperty('relatesTo');
    expect(i).toMatchObject({ status: 'completed' });
  });

  it('substituição (versão N): relatesTo "replaces" a versão N-1; cancelamento: entered-in-error', () => {
    const s = documentoRia({
      evento: 'fato.vacina.substituida',
      hospital: 'pc',
      vacina: 7,
      versao: 1,
      imunizacao: { ...imun, lotNumber: 'LOTE-2' },
      emitidoEm: EM,
    });
    const [cs, is] = (s['entry'] as { resource: Record<string, unknown> }[]).map((x) => x.resource);
    expect(cs?.['relatesTo']).toEqual([
      { code: 'replaces', targetIdentifier: { system: 'urn:sgh:ria', value: 'ria-pc-7-v0' } },
    ]);
    expect(is).toMatchObject({ status: 'completed', lotNumber: 'LOTE-2' });
    const k = documentoRia({
      evento: 'fato.vacina.cancelada',
      hospital: 'pc',
      vacina: 7,
      versao: 2,
      imunizacao: imun,
      emitidoEm: EM,
    });
    const [ck, ik] = (k['entry'] as { resource: Record<string, unknown> }[]).map((x) => x.resource);
    expect(ck).toMatchObject({ status: 'entered-in-error' });
    expect((ck?.['relatesTo'] as { targetIdentifier: { value: string } }[])[0]?.targetIdentifier.value).toBe(
      'ria-pc-7-v1',
    );
    expect(ik).toMatchObject({ status: 'entered-in-error' });
  });

  it('versões incoerentes com o evento são recusadas; o filtro dos eventos', () => {
    expect(() =>
      documentoRia({
        evento: 'fato.vacina.aplicada',
        hospital: 'pc',
        vacina: 7,
        versao: 1,
        imunizacao: imun,
        emitidoEm: EM,
      }),
    ).toThrow();
    expect(() =>
      documentoRia({
        evento: 'fato.vacina.cancelada',
        hospital: 'pc',
        vacina: 7,
        versao: 0,
        imunizacao: imun,
        emitidoEm: EM,
      }),
    ).toThrow();
    expect(eventoRia('fato.vacina.cancelada')).toBe(true);
    expect(eventoRia('fato.exame.apoio')).toBe(false);
  });
});

describe('W0-03 M6: destino pelo ambiente e pela credencial', () => {
  it('dev e ci: SEMPRE o simulador local, mesmo com a homologação autorizada e a credencial', () => {
    for (const ambiente of ['dev', 'ci'])
      expect(
        destinoRia({
          ambiente,
          homologacaoAutorizada: true,
          credencial: true,
          simulador: 'http://127.0.0.1:4010',
        }),
      ).toEqual({
        ambiente: 'simulador',
        url: 'http://127.0.0.1:4010/api/fhir/r4/Bundle',
        certificado: false,
        autenticacao: null,
      });
    // O simulador fora do loopback é recusado; sem simulador, nada sai.
    expect(() =>
      destinoRia({
        ambiente: 'dev',
        homologacaoAutorizada: false,
        credencial: false,
        simulador: 'https://rnds.exemplo',
      }),
    ).toThrow();
    expect(() =>
      destinoRia({ ambiente: 'dev', homologacaoAutorizada: false, credencial: false, simulador: null }),
    ).toThrow();
  });

  it('homologação só autorizada e com a credencial; produção só em produção e com a credencial', () => {
    expect(() =>
      destinoRia({ ambiente: 'homolog', homologacaoAutorizada: true, credencial: false, simulador: null }),
    ).toThrow(SemCredencialRnds);
    expect(
      destinoRia({ ambiente: 'homolog', homologacaoAutorizada: true, credencial: true, simulador: null }),
    ).toMatchObject({
      ambiente: 'homologacao',
      certificado: true,
      url: 'https://ehr-services.hmg.saude.gov.br/api/fhir/r4/Bundle',
    });
    // Homologação não autorizada: o simulador (com ele configurado).
    expect(
      destinoRia({
        ambiente: 'homolog',
        homologacaoAutorizada: false,
        credencial: true,
        simulador: 'http://localhost:4010',
      }).ambiente,
    ).toBe('simulador');
    expect(() =>
      destinoRia({ ambiente: 'producao', homologacaoAutorizada: false, credencial: false, simulador: null }),
    ).toThrow(/produção/);
    expect(
      destinoRia({ ambiente: 'producao', homologacaoAutorizada: false, credencial: true, simulador: null }),
    ).toMatchObject({
      ambiente: 'producao',
      url: 'https://rj-ehr-services.saude.gov.br/api/fhir/r4/Bundle',
    });
  });
});

describe('W0-03 M6: a resposta da RNDS', () => {
  it('a recusa com o OperationOutcome, os dígitos longos mascarados e o teto de 200', () => {
    const corpo = JSON.stringify({
      resourceType: 'OperationOutcome',
      issue: [
        { severity: 'error', code: 'business-rule', diagnostics: 'Paciente 12345678901 sem cadastro' },
        { severity: 'error', diagnostics: '' },
      ],
    });
    const m = motivoDaRecusaRnds(422, corpo);
    expect(m).toBe('recusado pela RNDS (HTTP 422): business-rule: Paciente *** sem cadastro; error');
    expect(motivoDaRecusaRnds(400, 'nao e json')).toBe('recusado pela RNDS (HTTP 400): sem detalhe');
    expect(
      motivoDaRecusaRnds(
        400,
        JSON.stringify({ resourceType: 'OperationOutcome', issue: [{ diagnostics: 'x'.repeat(400) }] }),
      ).length,
    ).toBe(200);
  });
  it('o recibo pelo Location (com ou sem o histórico) ou pelo id do corpo', () => {
    expect(reciboDaRnds('https://x/api/fhir/r4/Bundle/abc-1', '')).toBe('abc-1');
    expect(reciboDaRnds('https://x/api/fhir/r4/Bundle/abc-2/_history/1', '')).toBe('abc-2');
    expect(reciboDaRnds(null, JSON.stringify({ id: 'r-9' }))).toBe('r-9');
    expect(reciboDaRnds(null, '{}')).toBeNull();
    expect(reciboDaRnds('', 'xx')).toBeNull();
  });
});
