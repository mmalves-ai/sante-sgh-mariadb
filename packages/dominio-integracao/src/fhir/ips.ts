// W0-10 (M3, portabilidade do titular; LGPD art. 18 V): o pacote do titular em FHIR R4 no formato do International
// Patient Summary (IPS 2.0.0, versão fixada; recorte do pacote oficial em ./ips-2.0.0.json, com o SHA-256, extraído por
// tools/verificadores/src/ips-extrair.ts). Um Bundle "document": a Composition do sumário (LOINC 60591-5) com as três
// seções obrigatórias (problemas, alergias e medicamentos; vazias com emptyReason), o Patient (perfis BR Core e IPS), o
// estabelecimento autor e os PDFs assinados do prontuário como DocumentReference (anexo inline, hash SHA-1 do FHIR).
// O validador do CI confere o Bundle contra o recorte: cardinalidades dos perfis, as fatias de seção pelo código LOINC
// e as invariantes do documento (bdl-7, bdl-9, bdl-10, bdl-11, bdl-ips-1, cmp-1, cmp-2, ips-comp-1, ips-pat-1). Não
// substitui o validador oficial do HL7: é a conferência sem rede. Sem banco: o fato já lido entra pronto.
import { createHash } from 'node:crypto';
import pacoteIps from './ips-2.0.0.json' with { type: 'json' };
import {
  type EstabelecimentoFhir,
  type PacienteFhir,
  organizacaoFhir,
  pacienteFhir,
  perfilBrCore,
} from './mapeadores.js';
import { perfilBrCoreRecortado } from './perfis.js';
import { type PerfilRecortado, type ProblemaValidacao, validarRecurso } from './validador.js';

type Json = Record<string, unknown>;

export interface PacoteIpsRecortado {
  readonly pacote: string;
  readonly versao: string;
  readonly sha256: string;
  readonly perfis: Readonly<Record<string, PerfilRecortado>>;
}

export const PACOTE_IPS = pacoteIps as unknown as PacoteIpsRecortado;
export const VERSAO_IPS = PACOTE_IPS.versao;

export function perfilIpsRecortado(tipo: string): PerfilRecortado | undefined {
  return PACOTE_IPS.perfis[tipo];
}

const perfilIps = (tipo: string) => {
  const p = perfilIpsRecortado(tipo);
  if (!p) throw new Error(`perfil IPS ausente do recorte: ${tipo}`);
  return `${p.url}|${p.versao}`;
};

export const SISTEMAS_IPS = {
  loinc: 'http://loinc.org',
  cid10: 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRCID10',
  vazio: 'http://terminology.hl7.org/CodeSystem/list-empty-reason',
  clinico: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
  alergiaClinico: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
  ausente: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
  uri: 'urn:ietf:rfc:3986',
} as const;

/** As seções obrigatórias do IPS (fatias com mínimo 1 da Composition) e o código LOINC de cada uma. */
export const SECOES_IPS = {
  problemas: { codigo: '11450-4', titulo: 'Problemas' },
  alergias: { codigo: '48765-2', titulo: 'Alergias e intolerâncias' },
  medicamentos: { codigo: '10160-0', titulo: 'Medicamentos em uso' },
} as const;

export interface ProblemaIps {
  readonly id: string;
  readonly descricao: string;
  readonly cid10: string | null;
  readonly desde: Date | null;
  readonly ativo: boolean;
}

export interface AlergiaIps {
  readonly id: string;
  readonly descricao: string;
  readonly reacao: string | null;
  readonly critica: boolean;
}

export interface MedicamentoIps {
  readonly id: string;
  readonly descricao: string;
  readonly posologia: string | null;
  readonly desde: Date;
  readonly ativo: boolean;
}

export interface DocumentoAssinadoIps {
  readonly id: string;
  readonly titulo: string;
  readonly emitidoEm: Date;
  readonly pdf: Uint8Array;
  /** Quem assinou e como (ex.: "Dra. Fulana, CRM 1234-SP, ICP-Brasil"); vai na descrição do documento. */
  readonly assinatura: string | null;
}

export interface EntradaPacoteIps {
  /** Identificador estável do pacote (o protocolo do pedido de portabilidade). */
  readonly protocolo: string;
  readonly geradoEm: Date;
  readonly paciente: PacienteFhir;
  readonly estabelecimento: EstabelecimentoFhir;
  readonly problemas: readonly ProblemaIps[];
  readonly alergias: readonly AlergiaIps[];
  readonly medicamentos: readonly MedicamentoIps[];
  readonly documentos: readonly DocumentoAssinadoIps[];
}

/** UUID determinístico (forma da versão 5, sobre SHA-1) para o fullUrl de cada recurso do pacote. */
export function uuidDeterministico(semente: string): string {
  const h = createHash('sha1').update(semente).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const narrativa = (linhas: readonly string[]) => ({
  status: 'generated',
  div: `<div xmlns="http://www.w3.org/1999/xhtml">${
    linhas.length ? `<ul>${linhas.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p>Sem registro.</p>'
  }</div>`,
});
const dia = (d: Date) => d.toISOString().slice(0, 10);
const comPerfis = (r: Json, ...perfis: string[]) => ({ ...r, meta: { profile: perfis } });

/** Gera o Bundle IPS do titular. Determinístico: a mesma entrada dá o mesmo JSON (o hash do pacote vai à trilha). */
export function pacoteIpsTitular(e: EntradaPacoteIps): Json {
  const url = (tipo: string, id: string) => `urn:uuid:${uuidDeterministico(`${e.protocolo}|${tipo}|${id}`)}`;
  const pacienteBase = pacienteFhir(e.paciente);
  const paciente = comPerfis(
    {
      ...pacienteBase,
      ...(e.paciente.nascimento
        ? {}
        : { _birthDate: { extension: [{ url: SISTEMAS_IPS.ausente, valueCode: 'unknown' }] } }),
    },
    perfilBrCore('patient'),
    perfilIps('Patient'),
  );
  const urlPaciente = url('Patient', String(e.paciente.id));
  const refPaciente = { reference: urlPaciente };
  // Sem cidade e UF no cadastro do estabelecimento, o endereço (obrigatório no BR Core) leva só o país: o FHIR não
  // aceita texto vazio.
  const org = organizacaoFhir(e.estabelecimento);
  const organizacao = comPerfis(
    e.estabelecimento.cidade || e.estabelecimento.uf ? org : { ...org, address: [{ country: 'BRA' }] },
    perfilBrCore('organization'),
    perfilIps('Organization'),
  );
  const urlOrganizacao = url('Organization', e.estabelecimento.cnes);

  const problemas = e.problemas.map((p) => ({
    fullUrl: url('Condition', p.id),
    resource: comPerfis(
      {
        resourceType: 'Condition',
        id: p.id,
        clinicalStatus: {
          coding: [{ system: SISTEMAS_IPS.clinico, code: p.ativo ? 'active' : 'resolved' }],
        },
        code: {
          ...(p.cid10 ? { coding: [{ system: SISTEMAS_IPS.cid10, code: p.cid10 }] } : {}),
          text: p.descricao,
        },
        subject: refPaciente,
        ...(p.desde ? { onsetDateTime: dia(p.desde) } : {}),
      },
      perfilIps('Condition'),
    ),
  }));
  const alergias = e.alergias.map((a) => ({
    fullUrl: url('AllergyIntolerance', a.id),
    resource: comPerfis(
      {
        resourceType: 'AllergyIntolerance',
        id: a.id,
        clinicalStatus: { coding: [{ system: SISTEMAS_IPS.alergiaClinico, code: 'active' }] },
        ...(a.critica ? { criticality: 'high' } : {}),
        code: { text: a.descricao },
        patient: refPaciente,
        ...(a.reacao ? { reaction: [{ manifestation: [{ text: a.reacao }] }] } : {}),
      },
      perfilIps('AllergyIntolerance'),
    ),
  }));
  const medicamentos = e.medicamentos.map((m) => ({
    fullUrl: url('MedicationStatement', m.id),
    resource: comPerfis(
      {
        resourceType: 'MedicationStatement',
        id: m.id,
        status: m.ativo ? 'active' : 'completed',
        medicationCodeableConcept: { text: m.descricao },
        subject: refPaciente,
        effectiveDateTime: dia(m.desde),
        ...(m.posologia ? { dosage: [{ text: m.posologia }] } : {}),
      },
      perfilIps('MedicationStatement'),
    ),
  }));
  const documentos = e.documentos.map((d) => ({
    fullUrl: url('DocumentReference', d.id),
    resource: {
      resourceType: 'DocumentReference',
      id: d.id,
      status: 'current',
      type: { text: d.titulo },
      subject: refPaciente,
      date: d.emitidoEm.toISOString(),
      ...(d.assinatura ? { description: `Assinado: ${d.assinatura}` } : {}),
      content: [
        {
          attachment: {
            contentType: 'application/pdf',
            data: Buffer.from(d.pdf).toString('base64'),
            size: d.pdf.byteLength,
            hash: createHash('sha1').update(d.pdf).digest('base64'),
            title: d.titulo,
            creation: d.emitidoEm.toISOString(),
          },
        },
      ],
    },
  }));

  const secao = (
    s: (typeof SECOES_IPS)[keyof typeof SECOES_IPS],
    itens: readonly { fullUrl: string }[],
    linhas: readonly string[],
  ) => ({
    title: s.titulo,
    code: { coding: [{ system: SISTEMAS_IPS.loinc, code: s.codigo }] },
    text: narrativa(linhas),
    ...(itens.length
      ? { entry: itens.map((i) => ({ reference: i.fullUrl })) }
      : { emptyReason: { coding: [{ system: SISTEMAS_IPS.vazio, code: 'unavailable' }] } }),
  });
  const secoes: Json[] = [
    secao(
      SECOES_IPS.problemas,
      problemas,
      e.problemas.map((p) => `${p.cid10 ? `${p.cid10} ` : ''}${p.descricao}${p.ativo ? '' : ' (resolvido)'}`),
    ),
    secao(
      SECOES_IPS.alergias,
      alergias,
      e.alergias.map((a) => `${a.descricao}${a.reacao ? `: ${a.reacao}` : ''}`),
    ),
    secao(
      SECOES_IPS.medicamentos,
      medicamentos,
      e.medicamentos.map((m) => `${m.descricao}${m.posologia ? `, ${m.posologia}` : ''}`),
    ),
  ];
  if (documentos.length)
    secoes.push({
      title: 'Documentos assinados',
      code: { text: 'Documentos assinados do prontuário' },
      text: narrativa(e.documentos.map((d) => `${dia(d.emitidoEm)} ${d.titulo}`)),
      entry: documentos.map((d) => ({ reference: d.fullUrl })),
    });

  const composicao = comPerfis(
    {
      resourceType: 'Composition',
      id: `ips-${e.protocolo}`,
      status: 'final',
      type: {
        coding: [{ system: SISTEMAS_IPS.loinc, code: '60591-5', display: 'Patient summary Document' }],
      },
      subject: refPaciente,
      date: e.geradoEm.toISOString(),
      author: [{ reference: urlOrganizacao }],
      title: `Sumário do paciente (pedido ${e.protocolo})`,
      custodian: { reference: urlOrganizacao },
      section: secoes,
    },
    perfilIps('Composition'),
  );

  return comPerfis(
    {
      resourceType: 'Bundle',
      id: `ips-${e.protocolo}`,
      language: 'pt-BR',
      identifier: { system: SISTEMAS_IPS.uri, value: url('Bundle', e.protocolo) },
      type: 'document',
      timestamp: e.geradoEm.toISOString(),
      entry: [
        { fullUrl: url('Composition', e.protocolo), resource: composicao },
        { fullUrl: urlPaciente, resource: paciente },
        { fullUrl: urlOrganizacao, resource: organizacao },
        ...problemas,
        ...alergias,
        ...medicamentos,
        ...documentos,
      ],
    },
    perfilIps('Bundle'),
  );
}

const codigos = (cc: unknown): { system?: unknown; code?: unknown }[] =>
  ((cc as Json | undefined)?.['coding'] as { system?: unknown; code?: unknown }[] | undefined) ?? [];

/**
 * Valida o Bundle IPS contra o recorte da versão fixada: o perfil de cada recurso (o Patient também contra o BR Core),
 * as fatias obrigatórias de seção e as invariantes do documento. Lista vazia = conforme.
 */
export function validarPacoteIps(bundle: Json): ProblemaValidacao[] {
  const problemas: ProblemaValidacao[] = [];
  const add = (caminho: string, mensagem: string) => problemas.push({ caminho, mensagem });
  const perfil = (t: string) => perfilIpsRecortado(t)!;
  problemas.push(...validarRecurso(bundle, perfil('Bundle')));

  const id = bundle['identifier'] as Json | undefined;
  if (typeof id?.['system'] !== 'string' || typeof id?.['value'] !== 'string')
    add('Bundle.identifier', 'bdl-9: o documento tem identificador com sistema e valor');
  if (typeof bundle['timestamp'] !== 'string') add('Bundle.timestamp', 'bdl-10: o documento tem data');

  const entradas = ((bundle['entry'] as Json[] | undefined) ?? []).filter((x) => typeof x === 'object' && x);
  const recursos = entradas.map((x) => (x['resource'] as Json | undefined) ?? {});
  const tipo = (r: Json) => r['resourceType'];
  if (tipo(recursos[0] ?? {}) !== 'Composition')
    add('Bundle.entry[0]', 'bdl-11: o primeiro recurso do documento é a Composition');
  if (recursos.filter((r) => tipo(r) === 'Composition').length !== 1)
    add('Bundle.entry', 'bdl-ips-1: uma única Composition no documento IPS');
  if (recursos.filter((r) => tipo(r) === 'Patient').length !== 1)
    add('Bundle.entry:patient', 'fatia obrigatória: exatamente um Patient');
  const urls = new Set<string>();
  entradas.forEach((x, k) => {
    const u = x['fullUrl'];
    if (typeof u !== 'string') add(`Bundle.entry[${k}].fullUrl`, 'obrigatório (mínimo 1)');
    else if (urls.has(u)) add(`Bundle.entry[${k}].fullUrl`, 'bdl-7: fullUrl repetido');
    else urls.add(u);
    if (!x['resource']) add(`Bundle.entry[${k}].resource`, 'obrigatório (mínimo 1)');
  });

  recursos.forEach((r, k) => {
    const t = String(tipo(r));
    const p = perfilIpsRecortado(t);
    const prefixar = (lista: ProblemaValidacao[]) =>
      lista.map((q) => ({ caminho: `Bundle.entry[${k}].${q.caminho}`, mensagem: q.mensagem }));
    if (p && t !== 'Bundle') problemas.push(...prefixar(validarRecurso(r, p)));
    const br = t === 'Patient' || t === 'Organization' ? perfilBrCoreRecortado(t) : undefined;
    if (br) problemas.push(...prefixar(validarRecurso(r, br)));
    if (t === 'Patient') {
      const nomes = (r['name'] as Json[] | undefined) ?? [];
      if (!nomes.every((n) => n['given'] || n['family'] || n['text']))
        add(`Bundle.entry[${k}].name`, 'ips-pat-1: nome com given, family ou text');
    }
  });

  const comp = recursos.find((r) => tipo(r) === 'Composition');
  if (comp) {
    const sujeito = (comp['subject'] as Json | undefined)?.['reference'];
    const urlPaciente = entradas.find((x) => tipo((x['resource'] as Json) ?? {}) === 'Patient')?.['fullUrl'];
    if (sujeito !== urlPaciente) add('Composition.subject', 'o sujeito é o Patient do documento');
    const secoes = (comp['section'] as Json[] | undefined) ?? [];
    // As fatias de seção do perfil: o código LOINC fixo e a cardinalidade vêm do recorte.
    const elementos = perfil('Composition').elementos;
    for (const fatia of elementos.filter((x) => /^Composition\.section:[^.]+$/.test(x.id))) {
      const padrao = elementos.find((x) => x.id === `${fatia.id}.code`)?.fixo?.valor;
      const alvo = codigos(padrao)[0];
      if (!alvo) continue;
      const daFatia = secoes.filter((s) =>
        codigos(s['code']).some((c) => c.system === alvo.system && c.code === alvo.code),
      );
      if (daFatia.length < fatia.min) add(fatia.id, `seção obrigatória (LOINC ${String(alvo.code)})`);
      if (fatia.max !== '*' && daFatia.length > Number(fatia.max))
        add(fatia.id, `no máximo ${fatia.max} seção (LOINC ${String(alvo.code)})`);
      if (fatia.min > 0)
        for (const s of daFatia)
          if (!s['entry'] && !s['emptyReason'])
            add(fatia.id, 'ips-comp-1: a seção obrigatória tem entry ou emptyReason');
    }
    secoes.forEach((s, k) => {
      const caminho = `Composition.section[${k}]`;
      const entry = (s['entry'] as Json[] | undefined) ?? [];
      if (!s['text'] && entry.length === 0 && !s['section'])
        add(caminho, 'cmp-1: a seção tem texto, entradas ou subseções');
      if (s['emptyReason'] && entry.length > 0) add(caminho, 'cmp-2: emptyReason só na seção vazia');
      for (const ref of entry)
        if (!urls.has(String(ref['reference'])))
          add(`${caminho}.entry`, `referência fora do documento: ${String(ref['reference'])}`);
    });
  }
  return problemas;
}
