// Montagem das respostas da gestão da qualidade e dos envios regulatórios (M48, etapa 5) a partir das leituras das
// portas: as linhas SGH_ no formato da tela (com o estado do prazo, a prioridade GUT, a conformidade do checklist), os
// indicadores da competência (os do censo do M16 e os da qualidade pelas leituras da CCIH) e o arquivo de cada envio
// com o resumo SHA-256. As regras puras são as de @sgh/dominio-qualidade. Sem banco nem Nest.
import { createHash } from 'node:crypto';
import {
  type ConteudoGerenciado,
  type LinhaDeCuidado,
  LINHAS_DE_CUIDADO,
  type AnaliseIndicadorLida,
  type AuditoriaLida,
  type CategoriaRisco,
  type ClassificacaoNaoConformidade,
  type ComissaoLida,
  type DenominadorSetor,
  type DocumentoQualidadeLido,
  type EficaciaNaoConformidade,
  type EnvioRegulatorioLido,
  esquemaItemChecklistAuditoria,
  esquemaMembroComissao,
  type FichaIndicador,
  type FichaIndicadorQualidade,
  type IndicadorDaCompetencia,
  type ItemChecklistAuditoria,
  type ManifestacaoLida,
  type MembroComissao,
  type NaoConformidadeLida,
  type OrigemNaoConformidade,
  type PeriodicidadeComissao,
  type ReferencialAuditoria,
  type ReuniaoComissaoLida,
  type RiscoLido,
  type SituacaoMetaQualidade,
  type TipoComissao,
  type TipoEnvioRegulatorio,
  type ValorIndicador,
} from '@sgh/contratos';
import {
  analisePendente,
  arquivoIras,
  arquivoNotivisa,
  arquivoPmQualiss,
  type ArquivoEnvio,
  comissaoAtrasada,
  competenciaFechada,
  contaDaMediana,
  type ContagemNotificacoes,
  contaDoIndicador,
  type DispositivoParaSeguranca,
  linhaDeCuidado,
  numeradoresSeguranca,
  type ProtocoloParaLinha,
  estadoPrazoManifestacao,
  fichaDoCenso,
  FICHAS_INDICADOR_QUALIDADE,
  naoConformidadeVencida,
  type NotificacaoParaEnvio,
  prazoNotivisaMensal,
  prazoNotivisaObito,
  eficaciaDosControles,
  prioridadeGut,
  proximaReuniaoAte,
  reavaliacaoVencida,
  resultadoChecklist,
  revisaoVencida,
  situacaoMetaQualidade,
  temQuorum,
  valorPelasParcelas,
} from '@sgh/dominio-qualidade';
import type {
  AnaliseIndicadorRegistrada,
  AuditoriaRegistrada,
  ComissaoRegistrada,
  DocumentoQualidadeRegistrado,
  EnvioRegulatorioRegistrado,
  ManifestacaoRegistrada,
  NaoConformidadeRegistrada,
  ReuniaoComissaoRegistrada,
  RiscoRegistrado,
} from './tipos.js';
import { z } from 'zod';
import type { IncidenteParaNotivisaLido } from './porta-gestao.js';

export const resumoSha256Texto = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

/** JSON gravado lido pelo esquema (linha corrompida vira lista vazia, nunca erro na tela). */
function jsonLista<T>(texto: string, item: z.ZodType<T>): T[] {
  try {
    const r = z.array(item).safeParse(JSON.parse(texto));
    return r.success ? r.data : [];
  } catch {
    return [];
  }
}

export const itensDoChecklist = (texto: string): ItemChecklistAuditoria[] =>
  jsonLista(texto, esquemaItemChecklistAuditoria);
export const membrosDaComissao = (texto: string): MembroComissao[] => jsonLista(texto, esquemaMembroComissao);
const nomesPresentes = (texto: string): string[] => jsonLista(texto, z.string());

// ── Documentos ───────────────────────────────────────────────────────────────────────────────────────────────────

export function documentoLido(
  d: DocumentoQualidadeRegistrado,
  ciencia: { total: number; sessao: boolean } | undefined,
  hoje: string,
): DocumentoQualidadeLido {
  return {
    id: d.id,
    versao: d.versao,
    codigo: d.codigo,
    revisao: d.revisao,
    tipo: d.tipo as DocumentoQualidadeLido['tipo'],
    titulo: d.titulo,
    area: d.area,
    resumoAlteracao: d.resumoAlteracao,
    elaboradoPor: d.elaboradoPor,
    revisadoPor: d.revisadoPor,
    aprovadoPor: d.aprovadoPor,
    publicadoEm: d.publicadoEm,
    vigenciaAte: d.vigenciaAte,
    exigeCiencia: d.exigeCiencia,
    situacao: d.situacao as DocumentoQualidadeLido['situacao'],
    motivoRetirada: d.motivoRetirada,
    hash: d.hash,
    revisaoVencida: revisaoVencida(
      { situacao: d.situacao as DocumentoQualidadeLido['situacao'], vigenciaAte: d.vigenciaAte },
      hoje,
    ),
    ciencias: ciencia?.total ?? 0,
    cienteSessao: ciencia?.sessao ?? false,
  };
}

// ── Indicadores ──────────────────────────────────────────────────────────────────────────────────────────────────

export function analiseLida(a: AnaliseIndicadorRegistrada): AnaliseIndicadorLida {
  return { ...a, situacaoMeta: a.situacaoMeta as SituacaoMetaQualidade };
}

export interface ValorApurado {
  readonly numerador: number;
  readonly denominador: number | null;
  readonly parcial: boolean;
  /** A conta já escrita (a mediana, com os tempos); sem ela, a conta sai das parcelas. */
  readonly conta?: string | null;
}

/** O indicador na competência: o valor pelas parcelas, a conta, a situação perante a meta e a análise registrada. */
export function indicadorDaCompetencia(e: {
  readonly ficha: FichaIndicadorQualidade;
  readonly competencia: string;
  readonly valor: ValorApurado | null;
  readonly meta: number | null;
  readonly analise: AnaliseIndicadorRegistrada | null;
  readonly agora: string;
}): IndicadorDaCompetencia {
  const v = e.valor;
  const valor = v ? valorPelasParcelas(v.numerador, v.denominador, e.ficha.fator) : null;
  const situacaoMeta = situacaoMetaQualidade(e.ficha.polaridade, e.meta, valor);
  const analise = e.analise ? analiseLida(e.analise) : null;
  return {
    ficha: e.ficha,
    competencia: e.competencia,
    numerador: v?.numerador ?? null,
    denominador: v?.denominador ?? null,
    valor,
    conta: v ? (v.conta ?? contaDoIndicador(v.numerador, v.denominador, e.ficha.fator)) : null,
    meta: e.meta,
    situacaoMeta,
    parcial: v?.parcial ?? !competenciaFechada(e.competencia, e.agora),
    analise,
    pendente: analisePendente({ competencia: e.competencia, agora: e.agora, situacaoMeta, analise }),
  };
}

/** Os valores dos indicadores da qualidade pelas leituras da CCIH (denominadores da competência e adesão às mãos). */
export function valoresDaQualidade(
  todos: DenominadorSetor | null,
  adesao: { numerador: number; denominador: number } | null,
  parcial: boolean,
): Map<string, ValorApurado> {
  const m = new Map<string, ValorApurado>();
  const p = (x: { numerador: number; denominador: number }) => ({
    numerador: x.numerador,
    denominador: x.denominador,
    parcial,
  });
  if (todos) {
    m.set('densidadeIpcsCvc', p(todos.densidade.ipcs));
    m.set('densidadeItuSvd', p(todos.densidade.itu));
    m.set('densidadePavVm', p(todos.densidade.pav));
    m.set('utilizacaoCvc', p(todos.utilizacao.cvc));
    m.set('utilizacaoSvd', p(todos.utilizacao.sondaVesical));
    m.set('utilizacaoVm', p(todos.utilizacao.ventilacaoMecanica));
  }
  if (adesao) m.set('adesaoHigieneMaos', p(adesao));
  return m;
}

/**
 * W0-04 (M2 e M3): os valores da segurança do paciente (numeradores do NSP e do registro de dispositivos sobre os
 * pacientes-dia do censo) e das linhas de cuidado (% no alvo e mediana da meta-chave). Sem o censo, a segurança fica
 * sem valor (nunca um denominador inventado); a linha sem inclusão avaliada fica sem valor.
 */
export function valoresSegurancaELinhas(e: {
  readonly competencia: string;
  readonly parcial: boolean;
  readonly pacientesDia: number | null;
  readonly notificacoes: readonly ContagemNotificacoes[];
  readonly dispositivos: readonly DispositivoParaSeguranca[];
  readonly protocolos: readonly ProtocoloParaLinha[];
  readonly definicoes: ReadonlyMap<number, ConteudoGerenciado>;
  readonly metasChave: ReadonlyMap<LinhaDeCuidado, string>;
}): Map<string, ValorApurado> {
  const m = new Map<string, ValorApurado>();
  if (e.pacientesDia !== null) {
    const n = numeradoresSeguranca(e);
    for (const [codigo, numerador] of Object.entries(n))
      m.set(codigo, { numerador, denominador: e.pacientesDia, parcial: e.parcial });
  }
  for (const l of LINHAS_DE_CUIDADO) {
    const r = linhaDeCuidado({
      tipo: l.tipo,
      metaChave: e.metasChave.get(l.tipo) ?? l.metaChave,
      protocolos: e.protocolos,
      definicoes: e.definicoes,
    });
    if (r.avaliadas > 0)
      m.set(`${l.prefixo}NoAlvo`, { numerador: r.noAlvo, denominador: r.avaliadas, parcial: e.parcial });
    if (r.mediana !== null)
      m.set(`${l.prefixo}Mediana`, {
        numerador: r.mediana,
        denominador: null,
        parcial: e.parcial,
        conta: contaDaMediana(r.tempos),
      });
  }
  return m;
}

export interface IndicadorDoCenso {
  readonly ficha: FichaIndicador;
  readonly meta: number | null;
  readonly valor: ValorIndicador | null;
}

/** Os indicadores da competência: os do censo (M16) e os da qualidade, cada um com a análise registrada. */
export function indicadoresDaCompetencia(e: {
  readonly competencia: string;
  readonly agora: string;
  readonly censo: readonly IndicadorDoCenso[];
  readonly qualidade: ReadonlyMap<string, ValorApurado>;
  readonly metasQualidade: ReadonlyMap<string, number | null>;
  readonly analises: readonly AnaliseIndicadorRegistrada[];
}): IndicadorDaCompetencia[] {
  const analise = (codigo: string) => e.analises.find((a) => a.indicador === codigo) ?? null;
  const doCenso = e.censo.map((c) =>
    indicadorDaCompetencia({
      ficha: fichaDoCenso(c.ficha),
      competencia: e.competencia,
      valor: c.valor
        ? { numerador: c.valor.numerador, denominador: c.valor.denominador, parcial: c.valor.parcial }
        : null,
      meta: c.meta,
      analise: analise(c.ficha.codigo),
      agora: e.agora,
    }),
  );
  const daQualidade = FICHAS_INDICADOR_QUALIDADE.map((f) =>
    indicadorDaCompetencia({
      ficha: f,
      competencia: e.competencia,
      valor: e.qualidade.get(f.codigo) ?? null,
      meta: e.metasQualidade.get(f.codigo) ?? null,
      analise: analise(f.codigo),
      agora: e.agora,
    }),
  );
  return [...doCenso, ...daQualidade];
}

// ── Auditorias, comissões, riscos e não conformidades ────────────────────────────────────────────────────────────

export function auditoriaLida(a: AuditoriaRegistrada, naoConformidades: number): AuditoriaLida {
  const itens = itensDoChecklist(a.itens);
  return {
    id: a.id,
    titulo: a.titulo,
    area: a.area,
    referencial: a.referencial as ReferencialAuditoria,
    realizadaEm: a.realizadaEm,
    auditores: a.auditores,
    itens,
    resultado: resultadoChecklist(itens),
    conclusao: a.conclusao,
    naoConformidades,
    registradaPor: a.registradaPor,
    registradaEm: a.registradaEm,
    versao: a.versao ?? 1,
    canceladaEm: a.canceladaEm ?? null,
    motivoCancelamento: a.motivoCancelamento ?? null,
  };
}

export function comissaoLida(c: ComissaoRegistrada, hoje: string): ComissaoLida {
  const periodicidade = c.periodicidade as PeriodicidadeComissao;
  return {
    id: c.id,
    versao: c.versao,
    tipo: c.tipo as TipoComissao,
    nome: c.nome,
    periodicidade,
    membros: membrosDaComissao(c.membros),
    ativa: c.ativa,
    ultimaReuniao: c.ultimaReuniao,
    proximaReuniaoAte: proximaReuniaoAte(c.ultimaOrdinaria, periodicidade),
    atrasada: comissaoAtrasada({
      ativa: c.ativa,
      periodicidade,
      ultimaOrdinaria: c.ultimaOrdinaria,
      criadaEm: c.registradaEm,
      hoje,
    }),
  };
}

export function reuniaoLida(r: ReuniaoComissaoRegistrada): ReuniaoComissaoLida {
  return {
    id: r.id,
    comissao: r.comissao,
    tipo: r.tipo as ReuniaoComissaoLida['tipo'],
    realizadaEm: r.realizadaEm,
    pauta: r.pauta,
    ata: r.ata,
    presentes: nomesPresentes(r.presentes),
    membrosTotal: r.membrosTotal,
    presentesTotal: r.presentesTotal,
    quorum: temQuorum(r.membrosTotal, r.presentesTotal),
    convidados: r.convidados,
    deliberacoes: r.deliberacoes,
    registradaPor: r.registradaPor,
    registradaEm: r.registradaEm,
    versao: r.versao ?? 1,
    ataAssinadaEm: r.ataAssinadaEm ?? null,
    ataAssinadaPor: r.ataAssinadaPor ?? null,
    canceladaEm: r.canceladaEm ?? null,
    motivoCancelamento: r.motivoCancelamento ?? null,
    assinaturaAnteriorEm: r.assinaturaAnteriorEm ?? null,
    assinaturaAnteriorPor: r.assinaturaAnteriorPor ?? null,
  };
}

export function riscoLido(r: RiscoRegistrado, hoje: string): RiscoLido {
  return {
    ...r,
    categoria: r.categoria as CategoriaRisco,
    controlesLista: r.controlesLista as RiscoLido['controlesLista'],
    eficaciaControles: eficaciaDosControles(r.controlesLista as RiscoLido['controlesLista']),
    prioridade: prioridadeGut(r.pontuacao),
    situacao: r.situacao as RiscoLido['situacao'],
    reavaliacaoVencida: reavaliacaoVencida(r, hoje),
  };
}

export function naoConformidadeLida(n: NaoConformidadeRegistrada, hoje: string): NaoConformidadeLida {
  const situacao = n.situacao as NaoConformidadeLida['situacao'];
  return {
    ...n,
    origem: n.origem as OrigemNaoConformidade,
    classificacao: n.classificacao as ClassificacaoNaoConformidade,
    situacao,
    eficacia: n.eficacia as EficaciaNaoConformidade | null,
    vencida: naoConformidadeVencida({ situacao, prazo: n.prazo }, hoje),
  };
}

// ── Ouvidoria ────────────────────────────────────────────────────────────────────────────────────────────────────

export function manifestacaoLida(
  m: ManifestacaoRegistrada,
  nomePaciente: string | null,
  agora: string,
): ManifestacaoLida {
  const situacao = m.situacao as ManifestacaoLida['situacao'];
  return {
    id: m.id,
    versao: m.versao,
    protocolo: m.protocolo,
    canal: m.canal as ManifestacaoLida['canal'],
    tipo: m.tipo as ManifestacaoLida['tipo'],
    identificada: m.identificada,
    paciente: m.paciente === null ? null : { id: m.paciente, nome: nomePaciente ?? '' },
    manifestante: m.manifestante,
    contato: m.contato,
    area: m.area,
    relato: m.relato,
    recebidaEm: m.recebidaEm,
    prazoEm: m.prazoEm,
    situacao,
    encaminhadaA: m.encaminhadaA,
    observacao: m.observacao,
    resposta: m.resposta,
    procedente: m.procedente,
    respondidaEm: m.respondidaEm,
    respondidaPor: m.respondidaPor,
    pesquisa: m.pesquisa,
    estadoPrazo: estadoPrazoManifestacao(
      { situacao, prazoEm: m.prazoEm, respondidaEm: m.respondidaEm },
      agora,
    ),
    registradaPor: m.registradaPor,
    registradaEm: m.registradaEm,
    canceladaEm: m.canceladaEm ?? null,
    motivoCancelamento: m.motivoCancelamento ?? null,
  };
}

// ── Envios regulatórios ──────────────────────────────────────────────────────────────────────────────────────────

export function envioLido(e: EnvioRegulatorioRegistrado): EnvioRegulatorioLido {
  let resumo: Record<string, number> = {};
  try {
    const r = z.record(z.string(), z.number()).safeParse(JSON.parse(e.resumo));
    if (r.success) resumo = r.data;
  } catch {
    resumo = {};
  }
  return {
    id: e.id,
    versao: e.versao,
    tipo: e.tipo as TipoEnvioRegulatorio,
    competencia: e.competencia,
    revisao: e.revisao,
    arquivo: e.arquivo,
    hash: e.hash,
    linhas: e.linhas,
    resumo,
    situacao: e.situacao as EnvioRegulatorioLido['situacao'],
    geradoPor: e.geradoPor,
    geradoEm: e.geradoEm,
    transmitidoEm: e.transmitidoEm,
    transmitidoPor: e.transmitidoPor,
    protocolo: e.protocolo,
  };
}

/** Os incidentes no formato do envio, com o prazo regulatório de cada um (óbito em 72 h; os demais, 15º dia útil). */
export function incidentesDoEnvio(
  itens: readonly IncidenteParaNotivisaLido[],
  feriados: ReadonlySet<string>,
): NotificacaoParaEnvio[] {
  return itens.map((i) => ({
    numero: i.numero,
    ocorridoEm: i.ocorridoEm,
    tipo: i.tipo,
    classificacao: i.classificacao,
    grauDano: i.dano,
    obito: i.dano === 'obito',
    prazoEm:
      i.dano === 'obito' ? prazoNotivisaObito(i.ocorridoEm) : prazoNotivisaMensal(i.ocorridoEm, feriados),
    transcritaEm: i.transcritaEm,
    numeroNotivisa: i.numeroNotivisa,
  }));
}

export interface DadosDoEnvio {
  readonly iras?: { readonly setores: readonly DenominadorSetor[]; readonly todos: DenominadorSetor };
  readonly indicadores?: readonly IndicadorDaCompetencia[];
  readonly notificacoes?: readonly NotificacaoParaEnvio[];
}

/** O arquivo do envio e o resumo SHA-256 dos bytes (UTF-8). */
export function arquivoDoEnvio(
  tipo: TipoEnvioRegulatorio,
  competencia: string,
  d: DadosDoEnvio,
): ArquivoEnvio & { hash: string } {
  const a =
    tipo === 'iras'
      ? arquivoIras(competencia, d.iras?.setores ?? [], d.iras?.todos ?? totalVazio())
      : tipo === 'pmQualiss'
        ? arquivoPmQualiss(competencia, d.indicadores ?? [])
        : arquivoNotivisa(competencia, d.notificacoes ?? []);
  return { ...a, hash: resumoSha256Texto(a.conteudo) };
}

function totalVazio(): DenominadorSetor {
  const p = { numerador: 0, denominador: 0, fator: 1000 as const, valor: null };
  const u = { ...p, fator: 100 as const };
  return {
    setor: 'todos',
    pacientesDia: 0,
    dispositivosDia: { cvc: 0, sondaVesical: 0, ventilacaoMecanica: 0 },
    iras: { ipcs: 0, pav: 0, itu: 0 },
    densidade: { ipcs: p, pav: p, itu: p },
    utilizacao: { cvc: u, sondaVesical: u, ventilacaoMecanica: u },
  };
}
