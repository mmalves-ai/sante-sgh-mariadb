// C3-006: S-1200 e S-1210 do RPA do autônomo validam no XSD do leiaute S-1.3; pendências sem CPF, nascimento,
// rubrica ou pagamento. Dados sintéticos.
import { beforeAll, describe, expect, it } from 'vitest';
import { type ResultadoEventoEsocial, xmlDoEvento, xmlParaConferencia } from './comum.js';
import { ideDmDevDoRpa, montarS1200DoRpa, montarS1210DoRpa } from './eventos-autonomo.js';
import { CPF, ctx, empregador } from './fixtures-esocial.spec-util.js';
import { type ArquivoEsquemaEsocial, esquemasDoLeiaute, validarEventoNoXsd } from './xsd.js';

let esquemas: ArquivoEsquemaEsocial[];
beforeAll(async () => {
  esquemas = await esquemasDoLeiaute('v_S_01_03_00');
});

async function conferir(r: ResultadoEventoEsocial, raiz: string) {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) return '';
  const v = await validarEventoNoXsd(xmlParaConferencia(r.raiz), raiz, esquemas);
  expect(v.erros).toEqual([]);
  return xmlDoEvento(r.raiz);
}

const autonomo = { cpf: CPF, nome: 'Profissional Sintetico', nascimento: '1980-05-10' };
const rpa = {
  id: 42,
  competencia: '2026-10',
  bruto: 500_000,
  inss: 55_000,
  irrf: 30_000,
  liquido: 415_000,
  pagoEm: '2026-11-05',
};
const rubricas = { remuneracao: 'RPA01', inss: 'RPA02', irrf: 'RPA03' };

describe('eSocial do RPA do autônomo', () => {
  it('S-1200 com infoComplem, categoria 701 e as três rubricas', async () => {
    const xml = await conferir(montarS1200DoRpa(ctx, empregador, autonomo, rpa, rubricas, null), 'evtRemun');
    expect(xml).toContain('<codCateg>701</codCateg>');
    expect(xml).toContain('<nmTrab>Profissional Sintetico</nmTrab>');
    expect(xml).toContain(`<ideDmDev>${ideDmDevDoRpa(42)}</ideDmDev>`);
    expect(xml).toContain('<vrRubr>550.00</vrRubr>');
    expect(xml).toContain('<perApur>2026-10</perApur>');
  });

  it('S-1200 sem IRRF retido não leva a rubrica do IRRF', async () => {
    const xml = await conferir(
      montarS1200DoRpa(ctx, empregador, autonomo, { ...rpa, irrf: 0 }, { ...rubricas, irrf: null }, null),
      'evtRemun',
    );
    expect(xml).not.toContain('RPA03');
  });

  it('S-1210 paga o líquido no mês do pagamento', async () => {
    const r = montarS1210DoRpa(ctx, empregador, autonomo, rpa, null);
    const xml = await conferir(r, 'evtPgtos');
    expect(r.ok && r.dataReferencia).toBe('2026-11');
    expect(xml).toContain('<vrLiq>4150.00</vrLiq>');
    expect(xml).toContain('<perRef>2026-10</perRef>');
  });

  it('pendências: sem CPF, sem nascimento, sem rubrica e sem pagamento', () => {
    const s = montarS1200DoRpa(
      ctx,
      empregador,
      { cpf: null, nome: 'X', nascimento: null },
      rpa,
      { ...rubricas, inss: null },
      null,
    );
    expect(s.ok ? [] : s.pendencias.map((p) => p.codigo)).toEqual([
      'autonomo-sem-cpf',
      'autonomo-sem-nascimento',
      'rubrica-ausente',
    ]);
    const p = montarS1210DoRpa(ctx, empregador, autonomo, { ...rpa, pagoEm: null }, null);
    expect(p.ok ? [] : p.pendencias.map((x) => x.codigo)).toEqual(['rpa-nao-pago']);
  });
});
