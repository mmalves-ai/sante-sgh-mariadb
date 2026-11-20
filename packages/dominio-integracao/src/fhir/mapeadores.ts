// Mapeadores FHIR R4 para os perfis BR Core da versão fixada (M34; ficha, regra 14; ADR 0016): paciente, organização
// (estabelecimento com CNES), profissional e imunização (o registro de imunobiológico administrado, modelo RIA da
// RNDS). Entradas sem banco (o fato já lido); o recurso gerado é conferido pelo validador do CI. O CPF é o
// identificador principal (até 2026-12 no SUS); o CNS entra quando o cadastro tem (opcional).
import { CANONICO_BR_CORE, VERSAO_BR_CORE } from '@sgh/contratos';

export const SISTEMAS = {
  cpf: 'https://saude.gov.br/fhir/sid/cpf',
  cns: 'https://saude.gov.br/fhir/sid/cns',
  cnes: 'https://saude.gov.br/fhir/sid/cnes',
  cnpj: 'https://saude.gov.br/fhir/sid/cnpj',
  imunobiologico: 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRImunobiologico',
  via: 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRViaAdministracao',
  local: 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRLocalAplicacao',
  funcao: 'http://terminology.hl7.org/CodeSystem/v2-0443',
  tipoIdentificador: 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRTipoDocumentoIndividuo',
  conselho: 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRConselhoProfissional',
} as const;

export const perfilBrCore = (nome: string) =>
  `${CANONICO_BR_CORE}/StructureDefinition/br-core-${nome}|${VERSAO_BR_CORE}`;

const so = (d: string) => d.replace(/\D/g, '');
const data = (d: Date) => d.toISOString().slice(0, 10);

export interface PacienteFhir {
  readonly id: number;
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly nome: string;
  readonly nascimento: Date | null;
  readonly sexo: 'M' | 'F' | 'I' | null;
}

export function pacienteFhir(p: PacienteFhir): Record<string, unknown> {
  const identifier: Record<string, unknown>[] = [];
  if (p.cpf) identifier.push({ use: 'official', system: SISTEMAS.cpf, value: so(p.cpf) });
  if (p.cns)
    identifier.push({
      use: 'official',
      type: { coding: [{ system: SISTEMAS.tipoIdentificador, code: 'CNS' }] },
      system: SISTEMAS.cns,
      value: so(p.cns),
    });
  return {
    resourceType: 'Patient',
    id: `pac-${p.id}`,
    meta: { profile: [perfilBrCore('patient')] },
    identifier,
    name: [{ use: 'official', text: p.nome }],
    gender: p.sexo === 'M' ? 'male' : p.sexo === 'F' ? 'female' : 'unknown',
    ...(p.nascimento ? { birthDate: data(p.nascimento) } : {}),
  };
}

export interface EstabelecimentoFhir {
  readonly cnes: string;
  readonly cnpj: string | null;
  readonly nome: string;
  readonly apelido: string;
  readonly cidade: string;
  readonly uf: string;
}

export function organizacaoFhir(o: EstabelecimentoFhir): Record<string, unknown> {
  return {
    resourceType: 'Organization',
    id: `est-${so(o.cnes)}`,
    meta: { profile: [perfilBrCore('organization')] },
    identifier: [
      { use: 'official', system: SISTEMAS.cnes, value: so(o.cnes).padStart(7, '0') },
      ...(o.cnpj ? [{ use: 'official', system: SISTEMAS.cnpj, value: so(o.cnpj) }] : []),
    ],
    name: o.nome,
    alias: [o.apelido],
    address: [{ city: o.cidade, state: o.uf, country: 'BRA' }],
  };
}

export interface ProfissionalFhir {
  readonly id: number;
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly nome: string;
  readonly conselho: { readonly sigla: string; readonly uf: string; readonly numero: string } | null;
  readonly ativo: boolean;
}

export function profissionalFhir(p: ProfissionalFhir): Record<string, unknown> {
  const tipo = (codigo: string) => ({ coding: [{ system: SISTEMAS.tipoIdentificador, code: codigo }] });
  const identifier: Record<string, unknown>[] = [];
  if (p.cpf) identifier.push({ use: 'official', type: tipo('CPF'), system: SISTEMAS.cpf, value: so(p.cpf) });
  if (p.cns) identifier.push({ use: 'official', type: tipo('CNS'), system: SISTEMAS.cns, value: so(p.cns) });
  return {
    resourceType: 'Practitioner',
    id: `prof-${p.id}`,
    meta: { profile: [perfilBrCore('practitioner')] },
    identifier,
    active: p.ativo,
    name: [{ use: 'official', text: p.nome }],
    ...(p.conselho
      ? {
          qualification: [
            {
              code: { coding: [{ system: SISTEMAS.conselho, code: p.conselho.sigla }] },
              identifier: [{ value: `${p.conselho.numero}-${p.conselho.uf}` }],
            },
          ],
        }
      : {}),
  };
}

export interface VacinaAplicadaFhir {
  readonly id: string;
  readonly paciente: string;
  readonly profissional: string;
  readonly estabelecimento: string;
  readonly vacina: { readonly codigo: string; readonly nome: string };
  readonly aplicadaEm: Date;
  readonly lote: string;
  readonly fabricante: string | null;
  readonly via: string;
  readonly local: string;
  /** Dose do esquema (ex.: D1, D2, REF). */
  readonly dose: string;
}

/** Imunização (RIA, modelo da RNDS): status completed, vacina, paciente, data, local, via, quem aplicou e a dose. */
export function imunizacaoFhir(v: VacinaAplicadaFhir): Record<string, unknown> {
  return {
    resourceType: 'Immunization',
    id: v.id,
    meta: { profile: [perfilBrCore('immunization')] },
    status: 'completed',
    vaccineCode: {
      coding: [{ system: SISTEMAS.imunobiologico, code: v.vacina.codigo, display: v.vacina.nome }],
    },
    patient: { reference: `Patient/${v.paciente}` },
    occurrenceDateTime: v.aplicadaEm.toISOString(),
    location: { reference: `Organization/${v.estabelecimento}` },
    lotNumber: v.lote,
    ...(v.fabricante ? { manufacturer: { display: v.fabricante } } : {}),
    site: { coding: [{ system: SISTEMAS.local, code: v.local }] },
    route: { coding: [{ system: SISTEMAS.via, code: v.via }] },
    performer: [
      {
        function: { coding: [{ system: SISTEMAS.funcao, code: 'AP' }] },
        actor: { reference: `Practitioner/${v.profissional}` },
      },
    ],
    protocolApplied: [{ doseNumberString: v.dose }],
  };
}
