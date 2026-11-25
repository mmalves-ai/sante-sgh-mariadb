// C2-085 (08-INTG L130; Portaria GM/MS 1.434/2020; modelos de informação da RNDS; perfis BR Core fixados): o envio dos
// documentos clínicos à Rede Nacional de Dados em Saúde e as versões de cada um.
//   - Três documentos: a imunização (RIA, já montada em ria.ts), o sumário de alta (SA) e o resultado de exame (REL).
//   - Cada documento tem um envio (identificador local estável) e versões numeradas: 1 é a original; as seguintes
//     SUBSTITUEM a anterior (relatesTo "replaces") ou a CANCELAM (entered-in-error). Nada é apagado.
//   - A versão nova só sai depois da anterior aceita (a RNDS precisa do identificador dela); o envio cancelado não
//     recebe versão nova.
//   - O paciente vai identificado pelo CPF válido ou, sem ele, pelo CNS válido; sem nenhum dos dois, não sai.
//   - Os perfis usados ficam fixados em tabela (url canônica e versão do pacote BR Core).
// Melhoria: o motivo do bloqueio é dito antes de pedir o envio (registro não liberado, paciente sem identificação,
// versão anterior pendente), em vez de descobrir na recusa da RNDS.
// Puro: sem banco, sem HTTP. Os sistemas e códigos seguem o BR Core fixado; conferir no credenciamento.
import { CANONICO_BR_CORE, VERSAO_BR_CORE } from '@sgh/contratos';
import { perfilBrCore, SISTEMAS } from './fhir/mapeadores.js';
import type { IdentificacaoRnds } from './rnds.js';

export const TIPOS_DOCUMENTO_RNDS = ['imunizacao', 'sumario_alta', 'resultado_exame'] as const;
export type TipoDocumentoRnds = (typeof TIPOS_DOCUMENTO_RNDS)[number];
export const TIPOS_VERSAO_RNDS = ['original', 'substituicao', 'cancelamento'] as const;
export type TipoVersaoRnds = (typeof TIPOS_VERSAO_RNDS)[number];
export const SITUACOES_ENVIO_RNDS = [
  'pendente',
  'enviado',
  'aceito',
  'rejeitado',
  'substituido',
  'cancelado',
  'erro',
] as const;
export type SituacaoEnvioRnds = (typeof SITUACOES_ENVIO_RNDS)[number];
export type SituacaoVersaoRnds = 'pendente' | 'enviado' | 'aceito' | 'rejeitado' | 'erro';

/** O evento da fila de saída do sumário e do resultado (o objeto é o envio; a versão sai da tabela). */
export const EVENTO_DOCUMENTO_RNDS = 'fato.rnds.documento';
export const eventoDocumentoRnds = (t: string): boolean => t === EVENTO_DOCUMENTO_RNDS;

/** O código do sistema externo da rede nacional (identificador do paciente nela). */
export const SISTEMA_EXTERNO_RNDS = 'rnds';
/** O sistema do identificador dos documentos do estabelecimento (o sufixo é a versão). */
export const SISTEMA_DOCUMENTO_RNDS = 'urn:sgh:rnds';
/** O sistema do código local do exame (o de-para para a terminologia nacional fica no credenciamento). */
export const SISTEMA_EXAME_LOCAL = 'urn:sgh:exame';
const SISTEMA_CID10 = 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRCID10';
const SISTEMA_TIPO_DOCUMENTO = 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRTipoDocumento';

export interface PerfilFhirFixado {
  readonly codigo: string;
  readonly nome: string;
  readonly recurso: string;
  readonly urlCanonica: string;
  readonly versaoPerfil: string;
}

const perfil = (nome: string, recurso: string, rotulo: string): PerfilFhirFixado => ({
  codigo: `br-core-${nome}`,
  nome: rotulo,
  recurso,
  urlCanonica: `${CANONICO_BR_CORE}/StructureDefinition/br-core-${nome}`,
  versaoPerfil: VERSAO_BR_CORE,
});

/** Os perfis BR Core que os documentos da RNDS usam, fixados na versão do pacote. */
export const PERFIS_FHIR_RNDS: readonly PerfilFhirFixado[] = [
  perfil('patient', 'Patient', 'Paciente'),
  perfil('organization', 'Organization', 'Estabelecimento'),
  perfil('practitioner', 'Practitioner', 'Profissional'),
  perfil('immunization', 'Immunization', 'Imunização'),
  perfil('composition', 'Composition', 'Documento clínico'),
  perfil('condition', 'Condition', 'Diagnóstico'),
  perfil('diagnosticreport', 'DiagnosticReport', 'Laudo de exame'),
  perfil('observation', 'Observation', 'Resultado de exame'),
];

/** O perfil principal de cada documento (a linha fixada que o envio aponta). */
export const PERFIL_DO_DOCUMENTO: Readonly<Record<TipoDocumentoRnds, string>> = {
  imunizacao: 'br-core-immunization',
  sumario_alta: 'br-core-composition',
  resultado_exame: 'br-core-diagnosticreport',
};

const SIGLA: Readonly<Record<TipoDocumentoRnds, string>> = {
  imunizacao: 'ria',
  sumario_alta: 'sa',
  resultado_exame: 'rel',
};

/** O identificador local do envio (estável entre as versões; único no banco). */
export function identificadorLocalRnds(hospital: string, tipo: TipoDocumentoRnds, registro: number): string {
  if (!Number.isInteger(registro) || registro <= 0) throw new Error('Registro do documento inválido.');
  return `${SIGLA[tipo]}-${hospital}-${registro}`;
}

/** O identificador do documento de uma versão (a RNDS recusa o repetido; o reenvio da mesma versão não duplica). */
export const identificadorDocumentoRnds = (local: string, numeroVersao: number) =>
  `${local}-v${numeroVersao}`;

export interface EnvioRndsAtual {
  readonly situacao: SituacaoEnvioRnds;
  readonly versaoAtual: number;
  /** A situação da versão atual. */
  readonly situacaoVersao: SituacaoVersaoRnds;
}

export type ProximaVersaoRnds =
  | { readonly ok: true; readonly numero: number; readonly tipo: TipoVersaoRnds }
  | { readonly ok: false; readonly codigo: string; readonly motivo: string };

/** A versão que o pedido cria, ou o motivo da recusa. */
export function proximaVersaoRnds(atual: EnvioRndsAtual | null, pedido: TipoVersaoRnds): ProximaVersaoRnds {
  if (atual === null) {
    if (pedido !== 'original')
      return {
        ok: false,
        codigo: 'sem-envio',
        motivo: 'O documento ainda não foi enviado: envie a versão original primeiro.',
      };
    return { ok: true, numero: 1, tipo: 'original' };
  }
  if (atual.situacao === 'cancelado')
    return { ok: false, codigo: 'cancelado', motivo: 'O documento foi cancelado na rede nacional.' };
  if (pedido === 'original')
    return {
      ok: false,
      codigo: 'ja-enviado',
      motivo: 'O documento já tem envio: use a substituição ou o cancelamento.',
    };
  if (atual.situacaoVersao !== 'aceito')
    return {
      ok: false,
      codigo: 'versao-pendente',
      motivo: `A versão ${atual.versaoAtual} ainda não foi aceita: aguarde o retorno ou trate a recusa no monitor.`,
    };
  return { ok: true, numero: atual.versaoAtual + 1, tipo: pedido };
}

/** A resposta da RNDS (o código HTTP) ou a falha de transporte (rede, tempo, destino indisponível). */
export type RespostaRnds = { readonly status: number } | { readonly falha: string };

/** A situação do envio e da versão depois da resposta. */
export function situacoesDaResposta(
  tipo: TipoVersaoRnds,
  r: RespostaRnds,
): { readonly envio: SituacaoEnvioRnds; readonly versao: SituacaoVersaoRnds } {
  if ('falha' in r) return { envio: 'erro', versao: 'erro' };
  if (r.status >= 200 && r.status < 300)
    return { envio: tipo === 'cancelamento' ? 'cancelado' : 'aceito', versao: 'aceito' };
  // 4xx é recusa do conteúdo (corrigir e reenviar); 408, 429 e 5xx são passageiros (a fila tenta de novo).
  if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429)
    return { envio: 'rejeitado', versao: 'rejeitado' };
  return { envio: 'erro', versao: 'erro' };
}

/** O tipo da versão do evento da vacina (a versão 0 do evento é a original; a N, a N+1 da tabela). */
export function versaoDoEventoVacina(
  evento: string,
  versaoEvento: number,
): { readonly numero: number; readonly tipo: TipoVersaoRnds } {
  const tipo: TipoVersaoRnds =
    evento === 'fato.vacina.cancelada'
      ? 'cancelamento'
      : evento === 'fato.vacina.substituida'
        ? 'substituicao'
        : 'original';
  return { numero: Math.max(0, Math.trunc(versaoEvento)) + 1, tipo };
}

/** O motivo de o registro não poder ir à RNDS agora (null: pode). */
export function motivoBloqueioRnds(
  tipo: Exclude<TipoDocumentoRnds, 'imunizacao'>,
  situacaoRegistro: string,
  identificacao: IdentificacaoRnds,
): string | null {
  if (tipo === 'sumario_alta' && !['finalizado', 'assinado'].includes(situacaoRegistro))
    return 'O sumário de alta precisa estar finalizado ou assinado para ir à rede nacional.';
  if (tipo === 'resultado_exame' && situacaoRegistro !== 'liberado')
    return 'O resultado precisa estar liberado para ir à rede nacional.';
  if (identificacao.tipo === 'nenhuma') return identificacao.motivo;
  return null;
}

export interface SumarioAltaRnds {
  readonly id: number;
  readonly altaEm: Date | null;
  readonly cid10Principal: string | null;
  readonly situacaoDiagnostico: string | null;
  readonly motivoInternacao: string | null;
  readonly evolucao: string | null;
  readonly planoPosAlta: string | null;
  readonly condicaoAlta: string | null;
  readonly obito: boolean;
}

export interface ResultadoExameRnds {
  readonly id: number;
  readonly exameCodigo: string;
  readonly exameNome: string;
  readonly liberadoEm: Date;
  readonly conclusao: string | null;
  readonly texto: string | null;
  readonly anormal: boolean;
}

export interface EntradaDocumentoRnds {
  readonly hospital: string;
  readonly numeroVersao: number;
  readonly tipoVersao: TipoVersaoRnds;
  readonly identificacao: IdentificacaoRnds;
  /** O profissional responsável (id), como referência no documento. */
  readonly profissional: number | null;
  readonly emitidoEm: Date;
}

type Json = Record<string, unknown>;

function sujeito(i: IdentificacaoRnds): Json {
  if (i.tipo === 'nenhuma') throw new Error(i.motivo);
  return { identifier: { system: i.tipo === 'cpf' ? SISTEMAS.cpf : SISTEMAS.cns, value: i.valor } };
}

function conferirVersao(e: EntradaDocumentoRnds): void {
  if (!Number.isInteger(e.numeroVersao) || e.numeroVersao < 1)
    throw new Error('Versão do documento inválida.');
  if ((e.numeroVersao === 1) !== (e.tipoVersao === 'original'))
    throw new Error('A versão 1 é a original; a substituição e o cancelamento vêm depois.');
}

function composicao(
  e: EntradaDocumentoRnds,
  local: string,
  tipo: { code: string; display: string },
  secoes: Json[],
): Json {
  const id = identificadorDocumentoRnds(local, e.numeroVersao);
  return {
    resourceType: 'Composition',
    id: `comp-${id}`,
    meta: { profile: [perfilBrCore('composition')] },
    status:
      e.tipoVersao === 'cancelamento'
        ? 'entered-in-error'
        : e.tipoVersao === 'substituicao'
          ? 'amended'
          : 'final',
    type: { coding: [{ system: SISTEMA_TIPO_DOCUMENTO, ...tipo }] },
    subject: sujeito(e.identificacao),
    date: e.emitidoEm.toISOString(),
    author: [
      { reference: `Organization/est-${e.hospital}` },
      ...(e.profissional !== null
        ? [{ reference: `Practitioner/prof-${e.hospital}-${e.profissional}` }]
        : []),
    ],
    title: tipo.display,
    ...(e.numeroVersao > 1
      ? {
          relatesTo: [
            {
              code: 'replaces',
              targetIdentifier: {
                system: SISTEMA_DOCUMENTO_RNDS,
                value: identificadorDocumentoRnds(local, e.numeroVersao - 1),
              },
            },
          ],
        }
      : {}),
    section: secoes,
  };
}

function pacote(e: EntradaDocumentoRnds, local: string, perfilPrincipal: string, recursos: Json[]): Json {
  const id = identificadorDocumentoRnds(local, e.numeroVersao);
  return {
    resourceType: 'Bundle',
    meta: { profile: [perfilBrCore(perfilPrincipal)] },
    identifier: { system: SISTEMA_DOCUMENTO_RNDS, value: id },
    type: 'document',
    timestamp: e.emitidoEm.toISOString(),
    entry: recursos.map((r) => ({ fullUrl: `urn:uuid:${String(r['id'])}`, resource: r })),
  };
}

const narrativa = (titulo: string, texto: string | null): Json[] =>
  texto && texto.trim()
    ? [
        {
          title: titulo,
          text: {
            status: 'generated',
            div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapar(texto)}</div>`,
          },
        },
      ]
    : [];

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** O documento do sumário de alta (Bundle "document": Composition SA e o diagnóstico principal em CID-10). */
export function documentoSumarioAltaRnds(e: EntradaDocumentoRnds, s: SumarioAltaRnds): Json {
  conferirVersao(e);
  const local = identificadorLocalRnds(e.hospital, 'sumario_alta', s.id);
  const cancelado = e.tipoVersao === 'cancelamento';
  const diagnostico: Json | null = s.cid10Principal
    ? {
        resourceType: 'Condition',
        id: `cond-${local}-v${e.numeroVersao}`,
        meta: { profile: [perfilBrCore('condition')] },
        verificationStatus: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
              code: cancelado
                ? 'entered-in-error'
                : s.situacaoDiagnostico === 'presuntivo'
                  ? 'provisional'
                  : s.situacaoDiagnostico === 'descartado'
                    ? 'refuted'
                    : 'confirmed',
            },
          ],
        },
        code: { coding: [{ system: SISTEMA_CID10, code: s.cid10Principal.replace('.', '') }] },
        subject: sujeito(e.identificacao),
      }
    : null;
  const secoes: Json[] = [
    ...(diagnostico
      ? [{ title: 'Diagnóstico principal', entry: [{ reference: `Condition/${String(diagnostico['id'])}` }] }]
      : []),
    ...narrativa('Motivo da internação', s.motivoInternacao),
    ...narrativa('Evolução', s.evolucao),
    ...narrativa('Plano após a alta', s.planoPosAlta),
    ...narrativa('Condição na alta', s.obito ? 'Óbito' : s.condicaoAlta),
  ];
  const comp = composicao(e, local, { code: 'SA', display: 'Sumário de Alta' }, secoes);
  if (s.altaEm) comp['event'] = [{ period: { end: s.altaEm.toISOString() } }];
  return pacote(e, local, 'composition', [comp, ...(diagnostico ? [diagnostico] : [])]);
}

/** O documento do resultado de exame (Bundle "document": Composition REL, o laudo e o resultado). */
export function documentoResultadoExameRnds(e: EntradaDocumentoRnds, r: ResultadoExameRnds): Json {
  conferirVersao(e);
  const local = identificadorLocalRnds(e.hospital, 'resultado_exame', r.id);
  const status =
    e.tipoVersao === 'cancelamento'
      ? 'entered-in-error'
      : e.tipoVersao === 'substituicao'
        ? 'amended'
        : 'final';
  const codigo = { coding: [{ system: SISTEMA_EXAME_LOCAL, code: r.exameCodigo, display: r.exameNome }] };
  const observacao: Json = {
    resourceType: 'Observation',
    id: `obs-${local}-v${e.numeroVersao}`,
    meta: { profile: [perfilBrCore('observation')] },
    status,
    code: codigo,
    subject: sujeito(e.identificacao),
    issued: r.liberadoEm.toISOString(),
    ...(r.texto ? { valueString: r.texto } : {}),
    ...(r.anormal
      ? {
          interpretation: [
            {
              coding: [
                { system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: 'A' },
              ],
            },
          ],
        }
      : {}),
  };
  const laudo: Json = {
    resourceType: 'DiagnosticReport',
    id: `dr-${local}-v${e.numeroVersao}`,
    meta: { profile: [perfilBrCore('diagnosticreport')] },
    status,
    code: codigo,
    subject: sujeito(e.identificacao),
    issued: r.liberadoEm.toISOString(),
    result: [{ reference: `Observation/${String(observacao['id'])}` }],
    ...(r.conclusao ? { conclusion: r.conclusao } : {}),
  };
  const comp = composicao(e, local, { code: 'REL', display: 'Resultado de Exame Laboratorial' }, [
    { title: r.exameNome, entry: [{ reference: `DiagnosticReport/${String(laudo['id'])}` }] },
  ]);
  return pacote(e, local, 'diagnosticreport', [comp, laudo, observacao]);
}
