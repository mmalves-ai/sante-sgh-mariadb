// Cliente da gestão da qualidade e dos envios regulatórios (M48, etapa 5), validado na chegada. As gravações vão com o
// CSRF e a Idempotency-Key (uma por intenção de gravar); Problem Details viram ErroApi e o código da recusa fica em
// `problema.codigo` para a tela mostrar o texto certo (os textos das recusas ficam em @sgh/dominio-qualidade, os
// mesmos da API).
import {
  CODIGOS_CANAL_MANIFESTACAO,
  CODIGOS_CATEGORIA_RISCO,
  CODIGOS_EFICACIA_CONTROLE_RISCO,
  CODIGOS_CLASSIFICACAO_NAO_CONFORMIDADE,
  CODIGOS_EFICACIA_NAO_CONFORMIDADE,
  CODIGOS_ORIGEM_NAO_CONFORMIDADE,
  CODIGOS_PERIODICIDADE_COMISSAO,
  CODIGOS_REFERENCIAL_AUDITORIA,
  CODIGOS_RESULTADO_ITEM_AUDITORIA,
  CODIGOS_SITUACAO_DOCUMENTO_QUALIDADE,
  CODIGOS_SITUACAO_MANIFESTACAO,
  CODIGOS_SITUACAO_NAO_CONFORMIDADE,
  CODIGOS_SITUACAO_RISCO,
  CODIGOS_TIPO_COMISSAO,
  CODIGOS_TIPO_CONTROLE_RISCO,
  CODIGOS_TIPO_DOCUMENTO_QUALIDADE,
  CODIGOS_TIPO_ENVIO_REGULATORIO,
  CODIGOS_TIPO_MANIFESTACAO,
  CODIGOS_TIPO_REUNIAO_COMISSAO,
  type EncaminharManifestacaoEntrada,
  type GerarEnvioRegulatorioEntrada,
  type PublicarDocumentoEntrada,
  type RegistrarAnaliseIndicadorEntrada,
  type RegistrarAuditoriaEntrada,
  type RegistrarComissaoEntrada,
  type RegistrarManifestacaoEntrada,
  type RegistrarNaoConformidadeEntrada,
  type RegistrarReuniaoComissaoEntrada,
  type RegistrarRiscoEntrada,
  type RegistrarTransmissaoEnvioEntrada,
  type ResponderManifestacaoEntrada,
  type RetirarDocumentoEntrada,
} from '@sgh/contratos';
import { z } from 'zod';
import { erroDaResposta } from '../../../casca/erros/problem-details.js';
import { enviar, ler, qs } from '../../exames/api-exames.js';

export { codigoDaRecusa } from '../../exames/api-exames.js';

const Q = '/api/qualidade';
const G = `${Q}/gestao`;
const O = `${Q}/ouvidoria`;
const R = '/api/relatorio/envios-regulatorios';

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChaveGestao(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m48g.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

// ── Esquemas das respostas ──────────────────────────────────────────────────────────────────────────

const n = z.number();
const nN = z.number().nullable();
const s = z.string();
const sN = z.string().nullable();
const b = z.boolean();
const pagina = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ itens: z.array(item), total: n, pagina: n, porPagina: n });

export const esquemaResumoGestao = z.object({
  documentosVigentes: n,
  documentosRevisaoVencida: n,
  cienciasPendentesSessao: n,
  riscosCriticos: n,
  naoConformidadesAbertas: n,
  naoConformidadesVencidas: n,
  manifestacoesAbertas: n,
  manifestacoesVencidas: n,
  comissoesAtrasadas: n,
  ligada: b,
  motivo: sN,
  podeRegistrar: b,
  agora: s,
});
export type ResumoGestaoTela = z.infer<typeof esquemaResumoGestao>;

export const esquemaDocumento = z.object({
  id: n,
  versao: n,
  codigo: s,
  revisao: n,
  tipo: z.enum(CODIGOS_TIPO_DOCUMENTO_QUALIDADE),
  titulo: s,
  area: s,
  resumoAlteracao: sN,
  elaboradoPor: s,
  revisadoPor: sN,
  aprovadoPor: s,
  publicadoEm: s,
  vigenciaAte: s,
  exigeCiencia: b,
  situacao: z.enum(CODIGOS_SITUACAO_DOCUMENTO_QUALIDADE),
  motivoRetirada: sN,
  hash: s,
  revisaoVencida: b,
  ciencias: n,
  cienteSessao: b,
});
export type DocumentoTela = z.infer<typeof esquemaDocumento>;
const esquemaDocumentos = pagina(esquemaDocumento);
export type PaginaDocumentos = z.infer<typeof esquemaDocumentos>;
export const esquemaDocumentoCompleto = esquemaDocumento.extend({
  conteudo: s,
  revisoes: z.array(
    z.object({ id: n, revisao: n, situacao: z.enum(CODIGOS_SITUACAO_DOCUMENTO_QUALIDADE), publicadoEm: s }),
  ),
});
export type DocumentoCompletoTela = z.infer<typeof esquemaDocumentoCompleto>;
const esquemaCientes = z.object({
  itens: z.array(z.object({ usuario: s, cienteEm: s })),
});

const unidade = z.enum(['percentual', 'dias', 'razao', 'quantidade', 'densidade', 'minutos']);
const situacaoMeta = z.enum(['na-meta', 'fora-da-meta', 'sem-meta', 'sem-valor']);
export const esquemaAnalise = z.object({
  id: n,
  versao: n,
  indicador: s,
  competencia: s,
  numerador: n,
  denominador: nN,
  valor: nN,
  meta: nN,
  situacaoMeta,
  texto: s,
  causas: sN,
  plano: sN,
  responsavel: sN,
  prazo: sN,
  registradaPor: s,
  registradaEm: s,
  atualizadaPor: sN,
  atualizadaEm: sN,
});
export type AnaliseTela = z.infer<typeof esquemaAnalise>;
export const esquemaIndicador = z.object({
  ficha: z.object({
    codigo: s,
    nome: s,
    formula: s,
    numerador: s,
    denominador: sN,
    fator: n,
    unidade,
    fonte: s,
    periodicidade: z.literal('mensal'),
    polaridade: z.enum(['maior-melhor', 'menor-melhor', 'faixa', 'neutra']),
    responsavel: s,
    referencia: s,
    programas: z.array(z.enum(['anahp', 'ona', 'pmQualiss'])),
    origem: z.enum(['censo', 'qualidade', 'seguranca', 'linhaCuidado', 'higienizacao', 'atendimento']),
  }),
  competencia: s,
  numerador: nN,
  denominador: nN,
  valor: nN,
  conta: sN,
  meta: nN,
  situacaoMeta,
  parcial: b,
  analise: esquemaAnalise.nullable(),
  pendente: b,
});
export type IndicadorTela = z.infer<typeof esquemaIndicador>;
const esquemaIndicadores = z.object({
  competencia: s,
  itens: z.array(esquemaIndicador),
  ligada: b,
  motivo: sN,
  podeAnalisar: b,
});
export type ListaIndicadores = z.infer<typeof esquemaIndicadores>;

const esquemaItemChecklist = z.object({
  requisito: s,
  secao: sN,
  resultado: z.enum(CODIGOS_RESULTADO_ITEM_AUDITORIA),
  evidencia: sN,
});
export const esquemaAuditoria = z.object({
  id: n,
  titulo: s,
  area: s,
  referencial: z.enum(CODIGOS_REFERENCIAL_AUDITORIA),
  realizadaEm: s,
  auditores: s,
  itens: z.array(esquemaItemChecklist),
  resultado: z.object({
    conformes: n,
    parciais: n,
    naoConformes: n,
    naoAplicaveis: n,
    avaliados: n,
    conformidade: nN,
    conta: sN,
  }),
  conclusao: s,
  naoConformidades: n,
  registradaPor: s,
  registradaEm: s,
  versao: n.optional().default(1),
  /** W0-04: a versão e o cancelamento lógico com motivo (o cancelado fica visível como inativo). */
  canceladaEm: sN.optional().default(null),
  motivoCancelamento: sN.optional().default(null),
});
export type AuditoriaTela = z.infer<typeof esquemaAuditoria>;
const esquemaAuditorias = pagina(esquemaAuditoria);

const esquemaMembro = z.object({ nome: s, funcao: s, login: sN });
export const esquemaComissao = z.object({
  id: n,
  versao: n,
  tipo: z.enum(CODIGOS_TIPO_COMISSAO),
  nome: s,
  periodicidade: z.enum(CODIGOS_PERIODICIDADE_COMISSAO),
  membros: z.array(esquemaMembro),
  ativa: b,
  ultimaReuniao: sN,
  proximaReuniaoAte: sN,
  atrasada: b,
});
export type ComissaoTela = z.infer<typeof esquemaComissao>;
export const esquemaReuniao = z.object({
  id: n,
  comissao: n,
  tipo: z.enum(CODIGOS_TIPO_REUNIAO_COMISSAO),
  realizadaEm: s,
  pauta: s,
  ata: s,
  presentes: z.array(s),
  membrosTotal: n,
  presentesTotal: n,
  quorum: b,
  convidados: sN,
  deliberacoes: sN,
  registradaPor: s,
  registradaEm: s,
  versao: n.optional().default(1),
  /** W0-04: a versão e o cancelamento lógico com motivo (o cancelado fica visível como inativo). */
  canceladaEm: sN.optional().default(null),
  motivoCancelamento: sN.optional().default(null),
  ataAssinadaEm: sN.optional().default(null),
  ataAssinadaPor: sN.optional().default(null),
  /** Revisão do W0-04: quem assinou a ata antes da retificação (o texto atual aguarda nova assinatura). */
  assinaturaAnteriorEm: sN.optional().default(null),
  assinaturaAnteriorPor: sN.optional().default(null),
});
export type ReuniaoTela = z.infer<typeof esquemaReuniao>;

export const esquemaRisco = z.object({
  id: n,
  versao: n,
  titulo: s,
  descricao: s,
  area: s,
  categoria: z.enum(CODIGOS_CATEGORIA_RISCO),
  gravidade: n,
  urgencia: n,
  tendencia: n,
  pontuacao: n,
  prioridade: z.enum(['critica', 'alta', 'moderada', 'baixa']),
  controles: sN,
  controlesLista: z
    .array(
      z.object({
        nome: s,
        tipo: z.enum(CODIGOS_TIPO_CONTROLE_RISCO),
        eficacia: z.enum(CODIGOS_EFICACIA_CONTROLE_RISCO),
        avaliadoEm: sN,
      }),
    )
    .default([]),
  eficaciaControles: z.enum([...CODIGOS_EFICACIA_CONTROLE_RISCO, 'semControle']).default('semControle'),
  responsavel: s,
  situacao: z.enum(CODIGOS_SITUACAO_RISCO),
  reavaliarEm: s,
  reavaliacaoVencida: b,
  justificativa: sN,
  registradoPor: s,
  registradoEm: s,
  atualizadoPor: sN,
  atualizadoEm: sN,
});
export type RiscoTela = z.infer<typeof esquemaRisco>;

export const esquemaNaoConformidade = z.object({
  id: n,
  versao: n,
  origem: z.enum(CODIGOS_ORIGEM_NAO_CONFORMIDADE),
  idOrigem: nN,
  descricao: s,
  area: s,
  classificacao: z.enum(CODIGOS_CLASSIFICACAO_NAO_CONFORMIDADE),
  acaoImediata: sN,
  causa: sN,
  plano: sN,
  responsavel: sN,
  prazo: sN,
  situacao: z.enum(CODIGOS_SITUACAO_NAO_CONFORMIDADE),
  eficacia: z.enum(CODIGOS_EFICACIA_NAO_CONFORMIDADE).nullable(),
  eficaciaTexto: sN,
  vencida: b,
  registradaPor: s,
  registradaEm: s,
  encerradaPor: sN,
  encerradaEm: sN,
  /** W0-04: a versão e o cancelamento lógico com motivo (o cancelado fica visível como inativo). */
  canceladaEm: sN.optional().default(null),
  motivoCancelamento: sN.optional().default(null),
  duplicadaDe: nN.optional().default(null),
});
export type NaoConformidadeTela = z.infer<typeof esquemaNaoConformidade>;

export const esquemaManifestacao = z.object({
  id: n,
  versao: n,
  protocolo: s,
  canal: z.enum(CODIGOS_CANAL_MANIFESTACAO),
  tipo: z.enum(CODIGOS_TIPO_MANIFESTACAO),
  identificada: b,
  paciente: z.object({ id: n, nome: s }).nullable(),
  manifestante: sN,
  contato: sN,
  area: s,
  relato: s,
  recebidaEm: s,
  prazoEm: s,
  situacao: z.enum(CODIGOS_SITUACAO_MANIFESTACAO),
  encaminhadaA: sN,
  observacao: sN,
  resposta: sN,
  procedente: b.nullable(),
  respondidaEm: sN,
  respondidaPor: sN,
  pesquisa: nN,
  estadoPrazo: z.enum(['noPrazo', 'vencendo', 'vencido', 'cumprido', 'respondidaComAtraso']),
  registradaPor: s,
  registradaEm: s,
  /** W0-04: a versão e o cancelamento lógico com motivo (o cancelado fica visível como inativo). */
  canceladaEm: sN.optional().default(null),
  motivoCancelamento: sN.optional().default(null),
});
export type ManifestacaoTela = z.infer<typeof esquemaManifestacao>;
const esquemaManifestacoes = pagina(esquemaManifestacao).extend({
  ligada: b,
  motivo: sN,
  podeResponder: b,
  agora: s,
  /** W0-04 (M4): o prazo vigente (parâmetro) e se o canal da Hal-AI está ligado. */
  prazoDiasUteis: n.optional().default(10),
  canalHalai: b.optional().default(false),
});
export type PaginaManifestacoes = z.infer<typeof esquemaManifestacoes>;
export const esquemaNps = z.object({
  competencia: s,
  respostas: n,
  promotores: n,
  neutros: n,
  detratores: n,
  nps: nN,
  conta: sN,
});
export type NpsTela = z.infer<typeof esquemaNps>;
const esquemaListaNps = z.object({ itens: z.array(esquemaNps), cortada: b });
export const esquemaPesquisa = z.object({
  id: n,
  tipo: s,
  agenda: s.nullable(),
  dataAtendimento: s,
  nota: n,
  comentario: sN,
  manifestacao: nN,
});
export type PesquisaTela = z.infer<typeof esquemaPesquisa>;
const esquemaPesquisas = z.object({ itens: z.array(esquemaPesquisa), cortada: b });

export const esquemaEnvio = z.object({
  id: n,
  versao: n,
  tipo: z.enum(CODIGOS_TIPO_ENVIO_REGULATORIO),
  competencia: s,
  revisao: n,
  arquivo: s,
  hash: s,
  linhas: n,
  resumo: z.record(z.string(), n),
  situacao: z.enum(['gerado', 'transmitido', 'substituido']),
  geradoPor: s,
  geradoEm: s,
  transmitidoEm: sN,
  transmitidoPor: sN,
  protocolo: sN,
});
export type EnvioTela = z.infer<typeof esquemaEnvio>;
const esquemaEnvios = z.object({
  tipos: z.array(z.object({ codigo: z.enum(CODIGOS_TIPO_ENVIO_REGULATORIO), rotulo: s, destino: s })),
  itens: z.array(esquemaEnvio),
  ligada: b,
  motivo: sN,
  podeGerar: b,
  competenciaSugerida: s,
  agora: s,
});
export type ListaEnvios = z.infer<typeof esquemaEnvios>;
const esquemaArquivo = z.object({ arquivo: s, conteudo: s, hash: s, igual: b });
export type ArquivoEnvioTela = z.infer<typeof esquemaArquivo>;
const esquemaGerado = z
  .object({ id: n, revisao: n, arquivo: s, hash: s, linhas: n, resumo: z.record(z.string(), n), conteudo: s })
  .passthrough();
export type EnvioGerado = z.infer<typeof esquemaGerado>;

const esquemaId = z.object({ id: n }).passthrough();
const esquemaVersao = z.object({ versao: n }).passthrough();
const esquemaPublicado = z.object({ id: n, revisao: n, hash: s });
const esquemaManifestacaoRegistrada = z.object({ id: n, protocolo: s }).passthrough();

// ── Chamadas ────────────────────────────────────────────────────────────────────────────────────────

export const lerResumoGestao = (): Promise<ResumoGestaoTela> => ler(`${G}/resumo`, esquemaResumoGestao);

export const lerDocumentos = (f: {
  situacao?: string | undefined;
  tipo?: string | undefined;
  busca?: string | undefined;
  pagina?: number | undefined;
}): Promise<PaginaDocumentos> => ler(`${Q}/documentos${qs({ ...f, porPagina: 50 })}`, esquemaDocumentos);
export const lerDocumento = (id: number): Promise<DocumentoCompletoTela> =>
  ler(`${Q}/documentos/${String(id)}`, esquemaDocumentoCompleto);
export const lerCientes = (id: number) => ler(`${Q}/documentos/${String(id)}/ciencias`, esquemaCientes);
/** Os setores do estabelecimento para escolher a área do documento pelo id. */
export const listarSetoresDocumento = () =>
  ler(
    `${Q}/documentos/setores`,
    z.object({
      itens: z.array(z.object({ id: z.number(), codigo: z.string().nullable(), nome: z.string() })),
    }),
  );
export const publicarDocumento = (e: PublicarDocumentoEntrada, chave: string) =>
  enviar(`${Q}/documentos`, e, esquemaPublicado, chave);
export const retirarDocumento = (id: number, e: Omit<RetirarDocumentoEntrada, 'documento'>, chave: string) =>
  enviar(`${Q}/documentos/${String(id)}/retirada`, e, esquemaVersao, chave);
export const registrarCiencia = (id: number, chave: string) =>
  enviar(`${Q}/documentos/${String(id)}/ciencia`, {}, esquemaId, chave);

export const lerIndicadores = (competencia: string): Promise<ListaIndicadores> =>
  ler(`${Q}/indicadores${qs({ competencia })}`, esquemaIndicadores);
/** W0-04 (M2 e M3): a série mensal de um indicador com as parcelas. */
const esquemaSerie = z.object({
  codigo: s,
  itens: z.array(
    z.object({
      competencia: s,
      numerador: nN,
      denominador: nN,
      valor: nN,
      conta: sN,
      meta: nN,
      situacaoMeta,
      parcial: b,
    }),
  ),
});
export type SerieIndicadorTela = z.infer<typeof esquemaSerie>;
export const lerSerieIndicador = (codigo: string, ate: string, meses = 6): Promise<SerieIndicadorTela> =>
  ler(`${Q}/indicadores/${encodeURIComponent(codigo)}/serie${qs({ ate, meses })}`, esquemaSerie);
/** W0-04 (M2 e M3): a planilha das parcelas da competência (CSV). */
export async function exportarIndicadores(
  competencia: string,
  buscar: typeof fetch = fetch,
): Promise<string> {
  const r = await buscar(`${Q}/indicadores/exportacao${qs({ competencia })}`, {
    headers: { accept: 'text/csv' },
  });
  if (!r.ok) throw await erroDaResposta(r);
  return r.text();
}
export const lerHistoricoAnalises = (codigo: string) =>
  ler(
    `${Q}/indicadores/${encodeURIComponent(codigo)}/analises`,
    z.object({ itens: z.array(esquemaAnalise) }),
  );
export const registrarAnalise = (
  codigo: string,
  e: Omit<RegistrarAnaliseIndicadorEntrada, 'indicador'>,
  chave: string,
) => enviar(`${Q}/indicadores/${encodeURIComponent(codigo)}/analise`, e, esquemaId, chave);

export const lerAuditorias = (pagina: number) => ler(`${G}/auditorias${qs({ pagina })}`, esquemaAuditorias);
export const lerAuditoria = (id: number): Promise<AuditoriaTela> =>
  ler(`${G}/auditorias/${String(id)}`, esquemaAuditoria);
export const registrarAuditoria = (e: RegistrarAuditoriaEntrada, chave: string) =>
  enviar(`${G}/auditorias`, e, esquemaId, chave);

export const lerComissoes = () => ler(`${G}/comissoes`, z.object({ itens: z.array(esquemaComissao) }));
export const lerReunioes = (id: number) =>
  ler(`${G}/comissoes/${String(id)}/reunioes`, z.object({ itens: z.array(esquemaReuniao) }));
export const registrarComissao = (e: RegistrarComissaoEntrada, chave: string) =>
  enviar(`${G}/comissoes`, e, esquemaId, chave);
export const registrarReuniao = (
  id: number,
  e: Omit<RegistrarReuniaoComissaoEntrada, 'comissao'>,
  chave: string,
) => enviar(`${G}/comissoes/${String(id)}/reunioes`, e, esquemaId, chave);

export const lerRiscos = (f: { situacao?: string | undefined; pagina?: number | undefined }) =>
  ler(`${G}/riscos${qs({ ...f, porPagina: 50 })}`, pagina(esquemaRisco));
export const registrarRisco = (e: RegistrarRiscoEntrada, chave: string) =>
  enviar(`${G}/riscos`, e, esquemaId, chave);
export const lerNaoConformidades = (f: { situacao?: string | undefined; pagina?: number | undefined }) =>
  ler(`${G}/nao-conformidades${qs({ ...f, porPagina: 50 })}`, pagina(esquemaNaoConformidade));
export const registrarNaoConformidade = (e: RegistrarNaoConformidadeEntrada, chave: string) =>
  enviar(`${G}/nao-conformidades`, e, esquemaId, chave);

export const lerManifestacoes = (f: {
  situacao?: string | undefined;
  tipo?: string | undefined;
  busca?: string | undefined;
  pagina?: number | undefined;
}): Promise<PaginaManifestacoes> =>
  ler(`${O}/manifestacoes${qs({ ...f, porPagina: 50 })}`, esquemaManifestacoes);
const parcelaOuv = z.object({ numerador: n, denominador: n, valor: nN, conta: sN });
const grupoOuv = z.object({ chave: s, total: n, respondidas: n, vencidas: n, noPrazo: parcelaOuv });
export const esquemaIndicadoresOuvidoria = z.object({
  competencia: s,
  prazoDiasUteis: n,
  total: n,
  canceladas: n,
  respondidas: n,
  vencidas: n,
  noPrazo: parcelaOuv,
  porTipo: z.array(grupoOuv),
  porArea: z.array(grupoOuv),
  porCanal: z.array(grupoOuv),
  cortada: b,
});
export type IndicadoresOuvidoriaTela = z.infer<typeof esquemaIndicadoresOuvidoria>;
/** W0-04 (M4): os indicadores da ouvidoria na competência. */
export const lerIndicadoresOuvidoria = (competencia: string): Promise<IndicadoresOuvidoriaTela> =>
  ler(`${O}/indicadores${qs({ competencia })}`, esquemaIndicadoresOuvidoria);
export const lerNps = (competencia: string) => ler(`${O}/nps${qs({ competencia })}`, esquemaListaNps);
export const lerPesquisas = (competencia: string) =>
  ler(`${O}/pesquisas${qs({ competencia })}`, esquemaPesquisas);
export const registrarManifestacao = (e: RegistrarManifestacaoEntrada, chave: string) =>
  enviar(`${O}/manifestacoes`, e, esquemaManifestacaoRegistrada, chave);
export const encaminharManifestacao = (
  id: number,
  e: Omit<EncaminharManifestacaoEntrada, 'manifestacao'>,
  chave: string,
) => enviar(`${O}/manifestacoes/${String(id)}/encaminhamento`, e, esquemaVersao, chave);
export const responderManifestacao = (
  id: number,
  e: Omit<ResponderManifestacaoEntrada, 'manifestacao'>,
  chave: string,
) => enviar(`${O}/manifestacoes/${String(id)}/resposta`, e, esquemaVersao, chave);

export const lerEnvios = (): Promise<ListaEnvios> => ler(R, esquemaEnvios);
export const lerArquivoEnvio = (id: number): Promise<ArquivoEnvioTela> =>
  ler(`${R}/${String(id)}/arquivo`, esquemaArquivo);
export const gerarEnvio = (e: GerarEnvioRegulatorioEntrada, chave: string): Promise<EnvioGerado> =>
  enviar(R, e, esquemaGerado, chave);
export const registrarTransmissao = (
  id: number,
  e: Omit<RegistrarTransmissaoEnvioEntrada, 'envio'>,
  chave: string,
) => enviar(`${R}/${String(id)}/transmissao`, e, esquemaVersao, chave);
