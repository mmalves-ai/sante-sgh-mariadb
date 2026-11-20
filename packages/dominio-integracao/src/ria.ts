// W0-03 (M6 do mercado; Portaria GM/MS 5.663/2024; modelo de informação RIA da RNDS): o envio do Registro de
// Imunobiológico Administrado e as correções dele. O registro local nunca muda (o estorno e a retificação são versões);
// à RNDS vão três eventos da fila de saída:
//   - `fato.vacina.aplicada` (versão 0): o documento RIA com a imunização;
//   - `fato.vacina.substituida` (versão N): o documento novo que SUBSTITUI o anterior (Composition.relatesTo "replaces"
//     apontando a versão N-1), com a imunização como vale depois da retificação;
//   - `fato.vacina.cancelada` (versão N): o documento que cancela o anterior (status entered-in-error, com o mesmo
//     relatesTo).
// O destino depende do ambiente e do parâmetro de credencial: em dev e ci, SEMPRE o simulador local; a homologação da
// RNDS só com a homologação autorizada e a credencial (certificado ICP-Brasil do estabelecimento); a produção só em
// produção e com a credencial. Sem a credencial, nada sai (o envio fica com o motivo no monitor de recusas).
// Puro: sem banco, sem HTTP. Os sistemas e códigos seguem o BR Core fixado; conferir no credenciamento.
import { imunizacaoFhir, perfilBrCore } from './fhir/mapeadores.js';
import { type AmbienteRnds, ambienteRnds, enderecosRnds } from './rnds.js';

export const EVENTOS_RIA = [
  'fato.vacina.aplicada',
  'fato.vacina.substituida',
  'fato.vacina.cancelada',
] as const;
export type EventoRia = (typeof EVENTOS_RIA)[number];
export const eventoRia = (t: string): t is EventoRia => (EVENTOS_RIA as readonly string[]).includes(t);

/** O sistema do identificador do documento RIA do estabelecimento (estável entre versões: o sufixo é a versão). */
export const SISTEMA_DOCUMENTO_RIA = 'urn:sgh:ria';

/** O registro da vacina como o conector lê (a versão vigente na data do evento). */
export interface RegistroVacinaRia {
  readonly id: number;
  readonly imunobiologico: string;
  readonly nome: string;
  readonly lote: string;
  readonly fabricante: string | null;
  readonly dose: string;
  readonly via: string;
  readonly local: string;
  /** Hora local do estabelecimento (AAAA-MM-DDTHH:mm), sem fuso no banco. */
  readonly aplicadaEm: string;
}

/** A imunização (Immunization do BR Core) do registro, com os identificadores do conector. */
export function imunizacaoDoRegistro(
  v: RegistroVacinaRia,
  o: { readonly hospital: string; readonly paciente: number; readonly vacinador: string },
): Record<string, unknown> {
  return imunizacaoFhir({
    id: `vac-${o.hospital}-${v.id}`,
    paciente: `pac-${o.hospital}-${o.paciente}`,
    profissional: `prof-${o.hospital}-${o.vacinador}`,
    estabelecimento: `est-${o.hospital}`,
    vacina: { codigo: v.imunobiologico, nome: v.nome },
    // A hora local do estabelecimento (sem fuso no banco) vai como o instante de São Paulo (UTC-3).
    aplicadaEm: new Date(`${v.aplicadaEm.slice(0, 16)}:00-03:00`),
    lote: v.lote,
    fabricante: v.fabricante,
    via: v.via,
    local: v.local,
    dose: v.dose,
  });
}

const idDocumento = (hospital: string, vacina: number, versao: number) =>
  `ria-${hospital}-${vacina}-v${versao}`;

/**
 * O documento RIA (Bundle "document": Composition + Immunization) do evento. A versão 0 é a aplicação; as seguintes
 * substituem ou cancelam a anterior pelo relatesTo; o cancelamento leva a imunização e o documento como
 * entered-in-error. O identificador do documento é estável por versão (a RNDS recusa o repetido; o reenvio não duplica).
 */
export function documentoRia(o: {
  readonly evento: EventoRia;
  readonly hospital: string;
  readonly vacina: number;
  readonly versao: number;
  readonly imunizacao: Record<string, unknown>;
  readonly emitidoEm: Date;
}): Record<string, unknown> {
  if (o.evento === 'fato.vacina.aplicada' && o.versao !== 0)
    throw new Error('A aplicação é a versão 0 do registro.');
  if (o.evento !== 'fato.vacina.aplicada' && o.versao < 1)
    throw new Error('A substituição e o cancelamento são da versão 1 em diante.');
  const cancelado = o.evento === 'fato.vacina.cancelada';
  const imunizacao = cancelado ? { ...o.imunizacao, status: 'entered-in-error' } : o.imunizacao;
  const id = idDocumento(o.hospital, o.vacina, o.versao);
  const composicao: Record<string, unknown> = {
    resourceType: 'Composition',
    id: `comp-${id}`,
    status: cancelado ? 'entered-in-error' : 'final',
    type: {
      coding: [
        {
          system: 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRTipoDocumento',
          code: 'RIA',
          display: 'Registro de Imunobiológico Administrado',
        },
      ],
    },
    subject: imunizacao['patient'],
    date: o.emitidoEm.toISOString(),
    author: [{ reference: `Organization/est-${o.hospital}` }],
    title: 'Registro de Imunobiológico Administrado',
    ...(o.versao > 0
      ? {
          relatesTo: [
            {
              code: 'replaces',
              targetIdentifier: {
                system: SISTEMA_DOCUMENTO_RIA,
                value: idDocumento(o.hospital, o.vacina, o.versao - 1),
              },
            },
          ],
        }
      : {}),
    section: [{ entry: [{ reference: `Immunization/${String(imunizacao['id'])}` }] }],
  };
  return {
    resourceType: 'Bundle',
    meta: { profile: [perfilBrCore('immunization')] },
    identifier: { system: SISTEMA_DOCUMENTO_RIA, value: id },
    type: 'document',
    timestamp: o.emitidoEm.toISOString(),
    entry: [
      { fullUrl: `urn:uuid:comp-${id}`, resource: composicao },
      { fullUrl: `urn:uuid:${String(imunizacao['id'])}-v${o.versao}`, resource: imunizacao },
    ],
  };
}

/** Para onde vai o RIA: o simulador em dev/ci; a homologação ou a produção só com a credencial. */
export interface DestinoRia {
  readonly ambiente: AmbienteRnds;
  readonly url: string;
  /** Exige o certificado ICP-Brasil do estabelecimento (token no ehr-auth e o cliente com o certificado). */
  readonly certificado: boolean;
  readonly autenticacao: string | null;
}

export class SemCredencialRnds extends Error {
  override readonly name = 'SemCredencialRnds';
}

export function destinoRia(o: {
  readonly ambiente: string;
  readonly homologacaoAutorizada: boolean;
  readonly credencial: boolean;
  readonly simulador: string | null;
}): DestinoRia {
  const a = ambienteRnds(o.ambiente, o.homologacaoAutorizada);
  const e = enderecosRnds(a, o.simulador);
  if (a !== 'simulador' && !o.credencial)
    throw new SemCredencialRnds(
      `credencial da RNDS ausente (${a === 'producao' ? 'produção' : 'homologação'}): cadastre o certificado do estabelecimento; nada foi enviado`,
    );
  return {
    ambiente: a,
    url: `${e.ehr}/fhir/r4/Bundle`,
    certificado: a !== 'simulador',
    autenticacao: a === 'simulador' ? null : e.autenticacao,
  };
}

/**
 * O motivo curto da recusa da RNDS (OperationOutcome: severidade, código e o diagnóstico de cada problema), sem dado do
 * paciente (o diagnóstico é cortado e os dígitos longos, como CPF e CNS, são mascarados). Até 200 caracteres.
 */
export function motivoDaRecusaRnds(status: number, corpo: string): string {
  let problemas: string[] = [];
  try {
    const o = JSON.parse(corpo) as { resourceType?: string; issue?: unknown };
    if (o.resourceType === 'OperationOutcome' && Array.isArray(o.issue))
      problemas = o.issue.map((i: { severity?: string; code?: string; diagnostics?: string }) =>
        [i.code ?? i.severity ?? 'erro', i.diagnostics ?? ''].filter(Boolean).join(': '),
      );
  } catch {
    problemas = [];
  }
  const texto = problemas.length ? problemas.join('; ') : 'sem detalhe';
  return `recusado pela RNDS (HTTP ${status}): ${texto.replace(/\d{6,}/g, '***')}`.slice(0, 200);
}

/** O recibo da RNDS no aceite: o id do recurso no cabeçalho Location (ou o do corpo). */
export function reciboDaRnds(location: string | null, corpo: string): string | null {
  if (location) {
    const m = /\/([A-Za-z0-9.-]+)(?:\/_history\/[^/]+)?$/.exec(location);
    if (m) return m[1]!.slice(0, 120);
  }
  try {
    const o = JSON.parse(corpo) as { id?: unknown };
    return typeof o.id === 'string' ? o.id.slice(0, 120) : null;
  } catch {
    return null;
  }
}
