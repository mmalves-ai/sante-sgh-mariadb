// Regra 18 do M45 (etapa 4; ficha, seção 8: `vacina-rnds.spec.ts`; Portaria GM/MS 5.663/2024): o registro da vacina
// aplicada pela HTTP (portas em memória; dados sintéticos) com o prazo do envio RIA de 24 horas; o registro RIA
// (Immunization do BR Core fixado) montado do registro é válido no perfil; com o conector do M34 desligado, o envio
// aguarda (nada sai); fora de produção, a RNDS só no simulador local; a dose repetida, o lote vencido e o imunobiológico
// de fora são recusados; a chave desligada recusa.
import type { VacinasDoPaciente } from '@sgh/contratos';
import { enderecosRnds, prazoEnvioVacina } from '@sgh/dominio-integracao';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { imunizacaoDaVacina } from './vacina.controller.js';
import { CONSULTA_ENFERMAGEM_SINTETICA } from './sae-porta-memoria.js';
import { montarAppSae } from './sae.spec-util.js';

let a: Awaited<ReturnType<typeof montarAppSae>>;
beforeAll(async () => {
  a = await montarAppSae();
});
afterAll(async () => {
  await a.app.close();
});

const AT = 25_102;
const VACINA = {
  imunobiologico: '99',
  lote: 'LOTE-SINT-1',
  fabricante: 'Fabricante sintético',
  validadeLote: '2027-01-31',
  dose: 'D1',
  via: 'IM',
  local: 'DD',
};

describe('regra 18: a vacina aplicada e o envio RIA', () => {
  it('registra com o prazo de 24 horas; o envio aguarda o conector desligado; a prévia RIA é válida no BR Core', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const antes = (await a.get(enf, `/enfermagem/vacinas/${AT}`)).json() as VacinasDoPaciente;
    expect(antes.imunobiologicos.map((x) => x.codigo)).toEqual(['99', '98']);
    expect(antes.conector.ligado).toBe(false);
    expect(antes.gravacao).toMatchObject({ ligada: true, registrar: true });
    const r = await a.post(enf, `/enfermagem/vacinas/${AT}`, VACINA);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().prazoEnvio).toBe('2026-10-23T13:00');
    const v = ((await a.get(enf, `/enfermagem/vacinas/${AT}`)).json() as VacinasDoPaciente).vacinas[0]!;
    expect(v).toMatchObject({
      imunobiologico: '99',
      dose: 'D1',
      aplicadaEm: '2026-10-22T13:00',
      prazoEnvio: '2026-10-23T13:00',
      envio: { situacao: 'aguardandoConector', vencido: false },
    });
    // O prazo do envio é o da Portaria (24 horas), o mesmo do conector do M34.
    expect(prazoEnvioVacina(new Date('2026-10-22T16:00:00Z')).toISOString()).toBe('2026-10-23T16:00:00.000Z');
    const ria = (await a.get(enf, `/enfermagem/vacinas/${AT}/${v.id}/ria`)).json();
    expect(ria.valido).toBe(true);
    expect(ria.recurso).toMatchObject({
      resourceType: 'Immunization',
      status: 'completed',
      lotNumber: 'LOTE-SINT-1',
      occurrenceDateTime: '2026-10-22T16:00:00.000Z',
      protocolApplied: [{ doseNumberString: 'D1' }],
    });
    expect(a.trilha.eventos.some((l) => l.evento === 'enfermagem.vacina.registrada')).toBe(true);
  });

  it('a mesma dose do mesmo imunobiológico, o lote vencido e o imunobiológico de fora são recusados', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const dup = await a.post(enf, `/enfermagem/vacinas/${AT}`, VACINA);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('dose-ja-registrada');
    expect(
      (
        await a.post(enf, `/enfermagem/vacinas/${AT}`, { ...VACINA, dose: 'D2', validadeLote: '2026-10-01' })
      ).json().codigo,
    ).toBe('lote-vencido');
    expect(
      (await a.post(enf, `/enfermagem/vacinas/${AT}`, { ...VACINA, imunobiologico: '01' })).json().codigo,
    ).toBe('imunobiologico-desconhecido');
    expect((await a.post(enf, `/enfermagem/vacinas/${AT}`, { ...VACINA, dose: 'REF' })).statusCode).toBe(201);
    expect((await a.post(enf, `/enfermagem/vacinas/${AT}`, { ...VACINA, dose: 'REF' })).statusCode).toBe(201);
    const tec = await a.entrar('SINT.TECNICO.ENF');
    expect(
      (await a.post(tec, `/enfermagem/vacinas/${AT}`, { ...VACINA, imunobiologico: '98' })).statusCode,
    ).toBe(201);
    const fora = await a.entrar('SINT.AGENDA');
    expect((await a.get(fora, `/enfermagem/vacinas/${AT}`)).statusCode).toBe(403);
  });

  it('a escolha também oferece o atendimento externo do dia (a sala de vacina), com a leitura auditada', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.get(enf, '/enfermagem/vacinas/externos');
    expect(r.statusCode, r.body).toBe(200);
    const ex = r.json() as { itens: { atendimento: number }[]; cortada: boolean };
    expect(ex.cortada).toBe(false);
    expect(ex.itens.map((x) => x.atendimento)).toContain(CONSULTA_ENFERMAGEM_SINTETICA);
    const lida = a.trilha.eventos.filter(
      (l) => l.evento === 'enfermagem.vacina.lida' && l.tabelaAlvo === 'ATCABECATEND',
    );
    expect(lida).toHaveLength(1);
    expect(lida[0]?.chaveNaturalAlvo).toMatch(/^dia:\d{4}-\d{2}-\d{2};n:2$/);
    // O atendimento externo abre a tela das vacinas sem leito.
    const v = (
      await a.get(enf, `/enfermagem/vacinas/${CONSULTA_ENFERMAGEM_SINTETICA}`)
    ).json() as VacinasDoPaciente;
    expect(v).toMatchObject({ atendimento: CONSULTA_ENFERMAGEM_SINTETICA, leito: '' });
    const fora = await a.entrar('SINT.AGENDA');
    expect((await a.get(fora, '/enfermagem/vacinas/externos')).statusCode).toBe(403);
  });

  it('fora de produção nada sai: a RNDS só no simulador local; a prévia RIA leva só os identificadores', () => {
    expect(() => enderecosRnds('simulador', null)).toThrow(/Simulador/);
    expect(() => enderecosRnds('simulador', 'https://rnds.exemplo.gov.br')).toThrow(/endereço local/);
    expect(enderecosRnds('simulador', 'http://127.0.0.1:9000').ehr).toBe('http://127.0.0.1:9000/api');
    const r = imunizacaoDaVacina(
      {
        id: 7,
        imunobiologico: '99',
        nome: 'Vacina sintética A',
        lote: 'L1',
        fabricante: null,
        dose: 'REF',
        via: 'IM',
        local: 'DE',
        aplicadaEm: '2026-10-22T08:30',
      },
      { hospital: 'pc', paciente: 25_002, vacinador: 'SINT.ENF.PLANTAO' },
    );
    expect(r).toMatchObject({
      id: 'vac-pc-7',
      patient: { reference: 'Patient/pac-pc-25002' },
      occurrenceDateTime: '2026-10-22T11:30:00.000Z',
    });
    expect(JSON.stringify(r)).not.toMatch(/PACIENTE|SINTETICO M45/);
  });

  it('a chave desligada: em consulta, e a gravação responde 403 recurso-desligado', async () => {
    const b = await montarAppSae({ semChave: 'enfermagem.vacina' });
    try {
      const enf = await b.entrar('SINT.ENF.PLANTAO');
      expect(
        ((await b.get(enf, `/enfermagem/vacinas/${AT}`)).json() as VacinasDoPaciente).gravacao.ligada,
      ).toBe(false);
      const r = await b.post(enf, `/enfermagem/vacinas/${AT}`, VACINA);
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('recurso-desligado');
    } finally {
      await b.app.close();
    }
  });
});
