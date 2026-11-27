// Gestão da qualidade (ONA) e envios regulatórios (M48, etapa 5; ficha, seções 4, 5, 7 e 8, regras 9, 10 e 11; cap-05b
// §5.11; cap-07 §7.5.3; manual m17 "Indicadores e gestão da qualidade (ONA)" e m26 "Envios regulatórios"; DP-47.8 e
// DP-47.9). Tudo só do novo (SGH_QUA_* do 0485 e do 0486 com a trilha_auditoria na mesma transação); a chave
// `qualidade.gestao` liga as gravações (recolher = só consulta). Rotas:
//   GET  /api/qualidade/gestao/resumo                         o cabeçalho e os cartões (documentos, riscos, NC, ouvidoria)
//   GET  /api/qualidade/documentos[/:id[/ciencias]]           documentos (quem não publica vê só os vigentes)
//   GET  /api/qualidade/documentos/:id/pendentes-ciencia      quem a distribuição obriga a ler e ainda não leu
//   POST /api/qualidade/documentos                            qualidade.publicarDocumento (primeira ou nova revisão)
//   POST /api/qualidade/documentos/:id/retirada               qualidade.retirarDocumento
//   POST /api/qualidade/documentos/:id/ciencia                qualidade.registrarCiencia
//   GET  /api/qualidade/indicadores?competencia=              os indicadores da competência com a ficha e a análise
//   GET  /api/qualidade/indicadores/:codigo/analises          o histórico das análises
//   POST /api/qualidade/indicadores/:codigo/analise           qualidade.registrarAnaliseIndicador
//   GET  /api/qualidade/gestao/{auditorias[/:id],comissoes[/:id/reunioes],riscos,nao-conformidades,escala-gut}
//   POST /api/qualidade/gestao/{auditorias,comissoes,comissoes/:id/reunioes,riscos,nao-conformidades}
//   GET  /api/qualidade/ouvidoria/{manifestacoes[/:id],nps,pesquisas}
//   POST /api/qualidade/ouvidoria/manifestacoes[/:id/{encaminhamento,resposta}]
//   GET  /api/relatorio/envios-regulatorios[/:id/arquivo]     os envios e o arquivo gerado de novo (resumo conferido)
//   POST /api/relatorio/envios-regulatorios[/:id/transmissao] relatorio.gerarEnvioRegulatorio / registrarTransmissaoEnvio
// Nenhum relato, manifestante, conteúdo de documento nem paciente vai à trilha no payload (só os IDs das linhas SGH_); a
// leitura das manifestações é auditada (`qualidade.ouvidoria.lida`).
import { TABELA_DO_REGISTRO } from './tipos.js';
import { Body, Controller, Get, Inject, Optional, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  PARAMETRO_CANAL_HALAI_OUVIDORIA,
  PARAMETRO_PRAZO_OUVIDORIA,
  DIAS_UTEIS_RESPOSTA_OUVIDORIA,
  esquemaAlterarAuditoria,
  esquemaAssinarAta,
  esquemaCancelarNaoConformidade,
  esquemaCancelarRegistroQualidade,
  esquemaCorrigirManifestacao,
  esquemaRetificarAta,
  type RegistroVersionadoQualidade,
  CODIGOS_TIPO_ENVIO_REGULATORIO,
  ESCALA_GUT,
  esquemaEncaminharManifestacao,
  esquemaFiltroCompetenciaQualidade,
  esquemaSerieIndicadorQualidade,
  LINHAS_DE_CUIDADO,
  type LinhaDeCuidado,
  parametroMetaChaveLinha,
  type PontoSerieIndicadorQualidade,
  esquemaFiltroDocumentosQualidade,
  esquemaFiltroGestao,
  esquemaFiltroManifestacoes,
  esquemaGerarEnvioRegulatorio,
  esquemaPublicarDocumento,
  esquemaRegistrarAnaliseIndicador,
  esquemaRegistrarAuditoria,
  esquemaRegistrarCiencia,
  esquemaRegistrarComissao,
  esquemaRegistrarManifestacao,
  esquemaRegistrarNaoConformidade,
  esquemaRegistrarReuniaoComissao,
  esquemaRegistrarRisco,
  esquemaRegistrarTransmissaoEnvio,
  esquemaResponderManifestacao,
  esquemaRetirarDocumento,
  EVENTOS_AUDITAVEIS,
  type IndicadorDaCompetencia,
  INDICADORES_QUALIDADE,
  PERMISSAO_DADOS_ENVIO_REGULATORIO,
  PERMISSOES_GESTAO_QUALIDADE as P,
  PRIORIDADES_RISCO,
  type ResumoGestaoQualidade,
  type TipoEnvioRegulatorio,
  TIPOS_ENVIO_REGULATORIO,
} from '@sgh/contratos';
import { calcularIndicadoresAgregados, totaisIndicadoresPaCatalogo } from '@sgh/dominio-atendimento';
import {
  adesaoHigieneMaos,
  calendarioDeFeriados,
  competenciaAnterior,
  competenciaFechada,
  conferirPublicacao,
  diasDaCompetenciaQualidade,
  limitarPelaAlta,
  membrosRepetidos,
  MENSAGENS_RECUSA_GESTAO,
  nomeArquivoEnvio,
  npsDasNotas,
  prazoRespostaOuvidoria,
  indicadoresOuvidoria,
  MENSAGENS_CANAL_OUVIDORIA,
  recusaCanalOuvidoria,
  protocoloManifestacao,
  type RecusaGestaoQualidade,
  recusaAnaliseIndicador,
  recusaAndamentoManifestacao,
  recusaAuditoria,
  recusaCiencia,
  recusaGeracaoEnvio,
  recusaNaoConformidade,
  recusaRegistroManifestacao,
  recusaResposta,
  recusaRetirada,
  recusaReuniao,
  recusaControlesRisco,
  recusaRisco,
  recusaTransmissaoEnvio,
  resultadoChecklist,
  somarDiasData,
  somarMeses,
  csvIndicadores,
  textoParaResumoDocumento,
  conferirCancelamentoNaoConformidade,
  conferirCancelamentoReuniao,
  conferirCorrecaoManifestacao,
  MENSAGENS_CORRECAO_GESTAO,
  type RecusaCorrecaoGestao,
} from '@sgh/dominio-qualidade';
import { metaDoTexto } from '@sgh/dominio-relatorio';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { PORTA_ADT, type PortaAdt, indicadoresGiroLeito, totaisGiro } from '../adt/public-api.js';
import { PORTA_ATENDIMENTO, type PortaAtendimento } from '../atendimento/public-api.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import {
  CONFIGURACAO_M16,
  type ConfiguracaoM16,
  SERVICO_INTERNACAO,
  type ServicoInternacao,
} from '../internacao/public-api.js';
import { PORTA_CCIH, type PortaCcih } from './porta-ccih.js';
import { type GravadorGestao, PORTA_GESTAO, type PortaGestao } from './porta-gestao.js';
import { montarDenominadores } from './servico-ccih.js';
import {
  analiseLida,
  arquivoDoEnvio,
  auditoriaLida,
  comissaoLida,
  type DadosDoEnvio,
  documentoLido,
  envioLido,
  incidentesDoEnvio,
  type IndicadorDoCenso,
  indicadoresDaCompetencia,
  manifestacaoLida,
  membrosDaComissao,
  naoConformidadeLida,
  resumoSha256Texto,
  reuniaoLida,
  riscoLido,
  valoresDaQualidade,
  valoresSegurancaELinhas,
} from './servico-gestao.js';
import { definicoesGerenciadas } from './servico-seguranca.js';

/** A chave da funcionalidade (recursos de liberação do M08; ficha, seção 12). */
export const CHAVE_QUALIDADE_GESTAO = 'qualidade.gestao';
const E = EVENTOS_AUDITAVEIS;

const recusaGestao = (motivo: RecusaGestaoQualidade, status = 409) =>
  new ErroProblema(
    status === 422 ? 'entrada-invalida' : 'recusa-de-negocio',
    status,
    'Gestão da qualidade',
    MENSAGENS_RECUSA_GESTAO[motivo],
    { codigo: motivo, bloqueios: [motivo] },
  );
/** As recusas de conflito (o registro mudou) são 409; as de conteúdo, 422. */
const CONFLITO: ReadonlySet<RecusaGestaoQualidade> = new Set([
  'versao-desatualizada',
  'analise-ja-registrada',
  'codigo-ja-vigente',
  'substituta-nao-vigente',
  'documento-nao-vigente',
  'ciencia-ja-registrada',
  'risco-encerrado',
  'manifestacao-respondida',
  'ja-transmitido',
  'envio-nao-pendente',
  'pesquisa-ja-convertida',
  'comissao-inativa',
  'origem-cancelada',
]);
const recusar = (m: RecusaGestaoQualidade | null): void => {
  if (m) throw recusaGestao(m, CONFLITO.has(m) ? 409 : 422);
};
/** W0-04: a recusa da correção ou do cancelamento, com quantos e quais (D-CRUD-ORFAOS) em `avisos`. */
const recusaCorrecaoGestao = (motivo: RecusaCorrecaoGestao, avisos: readonly string[] = [], status = 409) =>
  new ErroProblema(
    status === 422 ? 'entrada-invalida' : 'recusa-de-negocio',
    status,
    'Gestão da qualidade',
    [MENSAGENS_CORRECAO_GESTAO[motivo], ...avisos].join(' '),
    { codigo: motivo, bloqueios: [motivo], ...(avisos.length ? { avisos } : {}) },
  );
const naoEncontrado = (o: string) => new ErroProblema('nao-encontrado', 404, `${o} não encontrado`);

@Controller()
export class GestaoQualidadeController {
  private readonly apoio: ApoioGravacao<GravadorGestao>;

  constructor(
    @Inject(PORTA_GESTAO) private readonly porta: PortaGestao,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(PORTA_CCIH) private readonly ccih: PortaCcih | null = null,
    @Optional() @Inject(SERVICO_INTERNACAO) private readonly internacao: ServicoInternacao | null = null,
    @Optional() @Inject(CONFIGURACAO_M16) private readonly cfgM16: ConfiguracaoM16 | null = null,
    @Optional() @Inject(PORTA_ADT) private readonly adt: PortaAdt | null = null,
    @Optional() @Inject(PORTA_ATENDIMENTO) private readonly atendimento: PortaAtendimento | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_QUALIDADE_GESTAO, nome: 'a gestão da qualidade', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private agora(s: SessaoCadastro): Promise<string> {
    return this.porta.relogio(s.porta);
  }

  // ── Resumo ───────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('qualidade/gestao/resumo')
  @Permissao(P.documentoLer)
  async resumo(
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResumoGestaoQualidade & { podeRegistrar: boolean }> {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const [c, l, comissoes] = await Promise.all([
      this.porta.contagem(s.porta, agora, s.login),
      this.apoio.liberacao(s),
      s.pode(P.gestaoLer) ? this.porta.comissoes(s.porta) : Promise.resolve([]),
    ]);
    const gestao = s.pode(P.gestaoLer);
    const ouvidoria = s.pode(P.ouvidoriaLer);
    return {
      documentosVigentes: c.documentosVigentes,
      documentosRevisaoVencida: s.pode(P.documentoPublicar) ? c.documentosRevisaoVencida : 0,
      cienciasPendentesSessao: c.cienciasPendentesSessao,
      riscosCriticos: gestao ? c.riscosCriticos : 0,
      naoConformidadesAbertas: gestao ? c.naoConformidadesAbertas : 0,
      naoConformidadesVencidas: gestao ? c.naoConformidadesVencidas : 0,
      manifestacoesAbertas: ouvidoria ? c.manifestacoesAbertas : 0,
      manifestacoesVencidas: ouvidoria ? c.manifestacoesVencidas : 0,
      comissoesAtrasadas: comissoes.map((x) => comissaoLida(x, agora.slice(0, 10))).filter((x) => x.atrasada)
        .length,
      ligada: l.ligada,
      motivo: l.motivo,
      podeRegistrar: l.ligada && s.pode(P.gestaoRegistrar),
      agora,
    };
  }

  /** O calendário de feriados do período (os recorrentes expandidos nos anos dele). */
  private async calendario(s: SessaoCadastro, de: string, ate: string): Promise<ReadonlySet<string>> {
    const anos = [...new Set([Number(de.slice(0, 4)), Number(ate.slice(0, 4))])];
    return calendarioDeFeriados(await this.porta.feriados(s.porta, de, ate), anos);
  }

  // ── Documentos ───────────────────────────────────────────────────────────────────────────────────────────────

  /** Os setores do estabelecimento para a área do documento (combo da publicação). */
  @Get('qualidade/documentos/setores')
  @Permissao(P.documentoPublicar)
  async setoresDaArea(@Req() req: RequisicaoAutorizada) {
    return { itens: await this.porta.setoresDaArea(sessaoDe(req).porta) };
  }

  @Get('qualidade/documentos')
  @Permissao(P.documentoLer)
  async documentos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroDocumentosQualidade, q);
    // Quem não publica vê só os vigentes (o obsoleto e o retirado são do escritório da qualidade).
    const situacao = s.pode(P.documentoPublicar) ? f.situacao : 'vigente';
    const [agora, pg] = await Promise.all([
      this.agora(s),
      this.porta.documentos(s.porta, {
        situacao,
        tipo: f.tipo,
        busca: f.busca?.toUpperCase(),
        pagina: f.pagina,
        porPagina: f.porPagina,
      }),
    ]);
    const ciencias = await this.porta.ciencias(
      s.porta,
      pg.itens.map((d) => d.id),
      s.login,
    );
    return {
      itens: pg.itens.map((d) => documentoLido(d, ciencias.get(d.id), agora.slice(0, 10))),
      total: pg.total,
      pagina: f.pagina,
      porPagina: f.porPagina,
    };
  }

  private async documentoOu404(s: SessaoCadastro, id: number) {
    const d = await this.porta.documento(s.porta, id);
    if (!d || (d.situacao !== 'vigente' && !s.pode(P.documentoPublicar))) throw naoEncontrado('Documento');
    return d;
  }

  @Get('qualidade/documentos/:id')
  @Permissao(P.documentoLer)
  async documento(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const d = await this.documentoOu404(s, idDaRota(id));
    const [agora, ciencias, revisoes] = await Promise.all([
      this.agora(s),
      this.porta.ciencias(s.porta, [d.id], s.login),
      s.pode(P.documentoPublicar) ? this.porta.documentosDoCodigo(s.porta, d.codigo) : Promise.resolve([]),
    ]);
    return {
      ...documentoLido(d, ciencias.get(d.id), agora.slice(0, 10)),
      conteudo: d.conteudo ?? '',
      revisoes: revisoes.map((r) => ({
        id: r.id,
        revisao: r.revisao,
        situacao: r.situacao,
        publicadoEm: r.publicadoEm,
      })),
    };
  }

  @Get('qualidade/documentos/:id/ciencias')
  @Permissao(P.documentoPublicar)
  async cientes(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const d = await this.documentoOu404(s, idDaRota(id));
    return { itens: await this.porta.cientes(s.porta, d.id) };
  }

  /** Quem a distribuição obriga a ler a revisão vigente e ainda não registrou a ciência. */
  @Get('qualidade/documentos/:id/pendentes-ciencia')
  @Permissao(P.documentoPublicar)
  async pendentesCiencia(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const d = await this.documentoOu404(s, idDaRota(id));
    return { itens: await this.porta.pendentesCiencia(s.porta, d.id) };
  }

  @Post('qualidade/documentos')
  @Permissao(P.documentoPublicar)
  @AuditadoNoHandler(
    'qualidade.publicarDocumento: documento_qualidade (a revisão anterior obsoleta) e a trilha_auditoria',
  )
  async publicar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaPublicarDocumento, b);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const doCodigo = await this.porta.documentosDoCodigo(s.porta, e.codigo);
    const r = conferirPublicacao({
      entrada: e,
      aprovador: s.login,
      hoje: agora.slice(0, 10),
      doCodigo: doCodigo.map((d) => ({
        id: d.id,
        versao: d.versao,
        codigo: d.codigo,
        revisao: d.revisao,
        situacao: d.situacao as 'vigente' | 'obsoleto' | 'retirado',
      })),
    });
    if ('recusa' in r) recusar(r.recusa);
    const revisao = 'revisao' in r ? r.revisao : 1;
    const hash = resumoSha256Texto(
      textoParaResumoDocumento({ codigo: e.codigo, revisao, titulo: e.titulo, conteudo: e.conteudo }),
    );
    const g = await this.apoio.sgh(
      s,
      E.qualidadeDocumentoPublicado.codigo,
      P.documentoPublicar,
      (x: { id: number }) => ({ tabela: 'documento_qualidade', id: String(x.id) }),
      (gr) =>
        gr.publicarDocumento({
          codigo: e.codigo,
          revisao,
          tipo: e.tipo,
          titulo: e.titulo.trim(),
          area: e.area.trim(),
          setorId: e.setorId ?? null,
          conteudo: e.conteudo,
          resumoAlteracao: e.resumoAlteracao?.trim() || null,
          elaboradoPor: e.elaboradoPor,
          revisadoPor: e.revisadoPor,
          vigenciaAte: e.vigenciaAte,
          exigeCiencia: e.exigeCiencia,
          hash,
          substitui: e.substitui,
          agora,
          usuario: s.login,
        }),
    );
    return { id: g.id, revisao, hash };
  }

  @Post('qualidade/documentos/:id/retirada')
  @Permissao(P.documentoPublicar)
  @AuditadoNoHandler(
    'qualidade.retirarDocumento: documento_qualidade com a versão conferida e a trilha_auditoria',
  )
  async retirar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRetirarDocumento, { ...(b as object), documento: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const d = await this.documentoOu404(s, e.documento);
    recusar(recusaRetirada({ versao: d.versao, situacao: d.situacao as 'vigente' }, e.versao));
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeDocumentoRetirado.codigo,
      P.documentoPublicar,
      { tabela: 'documento_qualidade', id: String(d.id) },
      (g) =>
        g.retirarDocumento({ id: d.id, versao: e.versao, motivo: e.motivo.trim(), agora, usuario: s.login }),
    );
  }

  @Post('qualidade/documentos/:id/ciencia')
  @Permissao(P.documentoLer)
  @AuditadoNoHandler(
    'qualidade.registrarCiencia: documento_qualidade_ciencia (uma por usuário) e a trilha_auditoria',
  )
  async ciencia(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarCiencia, { documento: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const d = await this.documentoOu404(s, e.documento);
    const ja = (await this.porta.ciencias(s.porta, [d.id], s.login)).get(d.id)?.sessao ?? false;
    recusar(recusaCiencia({ situacao: d.situacao as 'vigente' }, ja));
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeDocumentoCiencia.codigo,
      P.documentoLer,
      (x: { id: number }) => ({ tabela: 'documento_qualidade_ciencia', id: String(x.id) }),
      (g) => g.registrarCiencia({ documento: d.id, agora, usuario: s.login }),
    );
  }

  // ── Indicadores ──────────────────────────────────────────────────────────────────────────────────────────────

  /** As metas dos indicadores da qualidade (parâmetros `qualidade.meta.<codigo>`). */
  private async metasQualidade(s: SessaoCadastro): Promise<Map<string, number | null>> {
    const ler = await this.apoio.resolvedorParametros(s);
    return new Map(
      INDICADORES_QUALIDADE.map((i) => [
        i.codigo,
        metaDoTexto(String(ler(`qualidade.meta.${i.codigo}`, null) ?? '')),
      ]),
    );
  }

  /** Os indicadores do censo (M16) na competência; sem o serviço da internação (testes), nenhum. */
  private async censo(s: SessaoCadastro, competencia: string): Promise<IndicadorDoCenso[]> {
    if (!this.internacao || !this.cfgM16) return [];
    try {
      const p = await this.cfgM16.parametros(s);
      const r = await this.internacao.indice(
        { rede: s.rede, hospital: s.hospital, traceId: 'qualidade-indicadores' },
        p,
        competencia,
        competencia,
      );
      return r.indicadores.map((i) => {
        const { meta, ...ficha } = i.ficha;
        return { ficha, meta, valor: i.ultimo?.periodo === competencia ? i.ultimo : null };
      });
    } catch {
      // Sem o censo (fonte indisponível ou competência fora da série), os indicadores do censo ficam sem valor.
      return [];
    }
  }

  /**
   * W0-07 (M3): os indicadores de higienização e giro de leito da competência (as etapas da limpeza, pela porta do ADT).
   * Sem a porta (testes) ou com a fonte indisponível, ficam sem valor.
   */
  private async giroLeito(s: SessaoCadastro, competencia: string) {
    if (!this.adt) return new Map<string, { numerador: number; denominador: number }>();
    try {
      const { de, ate } = diasDaCompetenciaQualidade(competencia);
      return totaisGiro(await indicadoresGiroLeito(this.adt, s.porta, de, ate));
    } catch {
      return new Map<string, { numerador: number; denominador: number }>();
    }
  }

  /**
   * W0-07 (M2): o retorno ao PA em 72 h e a internação via PA da competência (as fichas do PA, pela porta do
   * atendimento; o mesmo cálculo da tela de indicadores do atendimento). Sem a porta ou com a fonte indisponível, ficam
   * sem valor.
   */
  private async indicadoresPa(s: SessaoCadastro, competencia: string) {
    if (!this.atendimento) return new Map<string, { numerador: number; denominador: number }>();
    try {
      const { de, ate } = diasDaCompetenciaQualidade(competencia);
      const agregados = await this.atendimento.indicadores(s.porta, { inicio: de, fim: ate });
      return totaisIndicadoresPaCatalogo(calcularIndicadoresAgregados({ inicio: de, fim: ate }, agregados));
    } catch {
      return new Map<string, { numerador: number; denominador: number }>();
    }
  }

  /** Os denominadores da competência pelas leituras da CCIH (a mesma conta da tela da CCIH). */
  private async denominadores(s: SessaoCadastro, competencia: string, agora: string) {
    if (!this.ccih) return null;
    const { de, ate } = diasDaCompetenciaQualidade(competencia);
    const [censo, disp, iras, obs] = await Promise.all([
      this.ccih.censo(s.porta, de, ate),
      this.ccih.dispositivosNoPeriodo(s.porta, de, ate),
      this.ccih.irasNoPeriodo(s.porta, de, ate),
      this.ccih.observacoesMaos(s.porta, de, ate),
    ]);
    const abertos = disp.itens.filter((d) => d.retiradoEm === null);
    const altas = new Map(
      abertos.length
        ? (
            await this.ccih.altasDas(
              s.porta,
              abertos.map((d) => d.reg),
            )
          ).map((a) => [a.reg, a.alta])
        : [],
    );
    const m = montarDenominadores({
      competencia,
      agora,
      censo: censo.porSetor,
      dispositivos: disp.itens.map((d) => limitarPelaAlta(d, altas.get(d.reg) ?? null)),
      iras: iras.itens.filter((i) => i.dataInfeccao >= de && i.dataInfeccao <= ate),
    });
    const adesao = adesaoHigieneMaos(
      obs.itens.map((o) => ({
        categoria: o.categoria as Parameters<typeof adesaoHigieneMaos>[0][number]['categoria'],
        oportunidades: o.detalhe as Parameters<typeof adesaoHigieneMaos>[0][number]['oportunidades'],
      })),
    );
    return { ...m, adesao: adesao.total, dispositivos: disp.itens };
  }

  /** W0-04 (M3): a meta-chave de cada linha de cuidado (parâmetro `qualidade.linhaCuidado.metaChave.<tipo>`). */
  private async metasChave(s: SessaoCadastro): Promise<Map<LinhaDeCuidado, string>> {
    const ler = await this.apoio.resolvedorParametros(s);
    return new Map(
      LINHAS_DE_CUIDADO.map((l) => [
        l.tipo,
        String(ler(parametroMetaChaveLinha(l.tipo), null) ?? '').trim() || l.metaChave,
      ]),
    );
  }

  private async indicadores(
    s: SessaoCadastro,
    competencia: string,
    relogio?: string,
  ): Promise<IndicadorDaCompetencia[]> {
    const agora = relogio ?? (await this.agora(s));
    const { de, ate } = diasDaCompetenciaQualidade(competencia);
    const fim = somarDiasData(ate, 1);
    const [censo, den, metas, analises, notificacoes, gerenciados, metasChave] = await Promise.all([
      this.censo(s, competencia),
      this.denominadores(s, competencia, agora),
      this.metasQualidade(s),
      this.porta.analises(s.porta, competencia),
      this.porta.notificacoesPorTipo(s.porta, de, fim),
      this.porta.protocolosGerenciados(s.porta, `${de}T00:00:00`, `${fim}T00:00:00`),
      this.metasChave(s),
    ]);
    const parcial = !competenciaFechada(competencia, agora);
    const qualidade = valoresDaQualidade(den?.todos ?? null, den ? den.adesao : null, parcial);
    for (const [codigo, v] of await this.giroLeito(s, competencia)) qualidade.set(codigo, { ...v, parcial });
    for (const [codigo, v] of await this.indicadoresPa(s, competencia))
      qualidade.set(codigo, { ...v, parcial });
    const segurancaELinhas = valoresSegurancaELinhas({
      competencia,
      parcial,
      pacientesDia: den ? den.todos.pacientesDia : null,
      notificacoes,
      dispositivos: den?.dispositivos ?? [],
      protocolos: gerenciados.protocolos,
      definicoes: definicoesGerenciadas(gerenciados.versoes),
      metasChave,
    });
    return indicadoresDaCompetencia({
      competencia,
      agora,
      censo,
      qualidade: new Map([...qualidade, ...segurancaELinhas]),
      metasQualidade: metas,
      analises,
    });
  }

  @Get('qualidade/indicadores')
  @Permissao(P.indicadorLer)
  async listaIndicadores(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroCompetenciaQualidade, q);
    const [itens, l] = await Promise.all([this.indicadores(s, f.competencia), this.apoio.liberacao(s)]);
    return {
      competencia: f.competencia,
      itens,
      ligada: l.ligada,
      motivo: l.motivo,
      podeAnalisar: l.ligada && s.pode(P.indicadorAnalisar),
    };
  }

  /**
   * W0-04 (M2 e M3): a planilha das parcelas da competência (CSV): cada indicador com o numerador, o denominador, o
   * fator, o valor, a conta, a meta e a situação. Só contagens; nenhum dado de pessoa.
   */
  @Get('qualidade/indicadores/exportacao')
  @Permissao(P.indicadorLer)
  async exportarIndicadores(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { header(nome: string, valor: string): unknown },
  ): Promise<string> {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroCompetenciaQualidade, q);
    const itens = await this.indicadores(s, f.competencia);
    res.header('content-type', 'text/csv; charset=utf-8');
    res.header('content-disposition', `attachment; filename="indicadores-qualidade-${f.competencia}.csv"`);
    return csvIndicadores(itens);
  }

  /** W0-04 (M2 e M3): a série mensal de um indicador (até 12 competências terminando em `ate`), com as parcelas. */
  @Get('qualidade/indicadores/:codigo/serie')
  @Permissao(P.indicadorLer)
  async serieIndicador(
    @Param('codigo') codigo: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ codigo: string; itens: PontoSerieIndicadorQualidade[] }> {
    const s = sessaoDe(req);
    if (!/^[a-zA-Z][a-zA-Z0-9]{2,39}$/.test(codigo)) throw naoEncontrado('Indicador');
    const f = corpo(esquemaSerieIndicadorQualidade, q);
    const agora = await this.agora(s);
    const competencias = Array.from({ length: f.meses }, (_, i) =>
      somarMeses(`${f.ate}-01`, i - f.meses + 1).slice(0, 7),
    );
    const itens: PontoSerieIndicadorQualidade[] = [];
    for (const c of competencias) {
      const ind = (await this.indicadores(s, c, agora)).find((i) => i.ficha.codigo === codigo);
      if (!ind) throw naoEncontrado('Indicador');
      itens.push({
        competencia: c,
        numerador: ind.numerador,
        denominador: ind.denominador,
        valor: ind.valor,
        conta: ind.conta,
        meta: ind.meta,
        situacaoMeta: ind.situacaoMeta,
        parcial: ind.parcial,
      });
    }
    return { codigo, itens };
  }

  @Get('qualidade/indicadores/:codigo/analises')
  @Permissao(P.indicadorLer)
  async historico(@Param('codigo') codigo: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    if (!/^[a-zA-Z][a-zA-Z0-9]{2,39}$/.test(codigo)) throw naoEncontrado('Indicador');
    return { itens: (await this.porta.historicoAnalises(s.porta, codigo)).map(analiseLida) };
  }

  @Post('qualidade/indicadores/:codigo/analise')
  @Permissao(P.indicadorAnalisar)
  @AuditadoNoHandler('qualidade.registrarAnaliseIndicador: analise_critica_indicador e a trilha_auditoria')
  async analisar(@Param('codigo') codigo: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarAnaliseIndicador, { ...(b as object), indicador: codigo });
    await this.apoio.exigirLiberacao(s);
    const ind = (await this.indicadores(s, e.competencia)).find((i) => i.ficha.codigo === e.indicador);
    if (!ind) throw recusaGestao('indicador-inexistente', 422);
    const agora = await this.agora(s);
    const existente = ind.analise ? { id: ind.analise.id, versao: ind.analise.versao } : null;
    recusar(recusaAnaliseIndicador({ entrada: e, situacaoMeta: ind.situacaoMeta, existente, agora }));
    const situacaoMeta = ind.situacaoMeta === 'sem-valor' ? 'sem-meta' : ind.situacaoMeta;
    return this.apoio.sgh(
      s,
      E.qualidadeIndicadorAnalisado.codigo,
      P.indicadorAnalisar,
      (x: { id: number }) => ({ tabela: 'analise_critica_indicador', id: String(x.id) }),
      (g) =>
        g.registrarAnaliseIndicador({
          id: e.analise,
          versao: e.versao,
          indicador: e.indicador,
          competencia: e.competencia,
          numerador: ind.numerador,
          denominador: ind.denominador,
          valor: ind.valor,
          meta: ind.meta,
          situacaoMeta,
          texto: e.texto.trim(),
          causas: e.causas?.trim() || null,
          plano: e.plano?.trim() || null,
          responsavel: e.responsavel?.trim() || null,
          prazo: e.prazo,
          agora,
          usuario: s.login,
          ficha: ind.ficha,
        }),
    );
  }

  // ── Auditorias ───────────────────────────────────────────────────────────────────────────────────────────────

  @Get('qualidade/gestao/auditorias')
  @Permissao(P.gestaoLer)
  async auditorias(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroGestao, q);
    const pg = await this.porta.auditorias(s.porta, f);
    const ncs = await this.porta.naoConformidadesPorOrigem(
      s.porta,
      'auditoria',
      pg.itens.map((a) => a.id),
    );
    return {
      itens: pg.itens.map((a) => auditoriaLida(a, ncs.get(a.id) ?? 0)),
      total: pg.total,
      pagina: f.pagina,
      porPagina: f.porPagina,
    };
  }

  @Get('qualidade/gestao/auditorias/:id')
  @Permissao(P.gestaoLer)
  async auditoria(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const a = await this.porta.auditoria(s.porta, idDaRota(id));
    if (!a) throw naoEncontrado('Auditoria');
    const ncs = await this.porta.naoConformidadesPorOrigem(s.porta, 'auditoria', [a.id]);
    return auditoriaLida(a, ncs.get(a.id) ?? 0);
  }

  @Post('qualidade/gestao/auditorias')
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.registrarAuditoria: auditoria_interna e a trilha_auditoria')
  async registrarAuditoria(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarAuditoria, b);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    recusar(recusaAuditoria(e, agora.slice(0, 10)));
    const itens = JSON.stringify(e.itens);
    if (Buffer.byteLength(itens, 'latin1') > 16_000)
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Gestão da qualidade',
        'O checklist passou do tamanho máximo.',
        {
          codigo: 'checklist-grande',
          campos: ['itens'],
        },
      );
    const r = resultadoChecklist(e.itens);
    const g = await this.apoio.sgh(
      s,
      E.qualidadeAuditoriaRegistrada.codigo,
      P.gestaoRegistrar,
      (x: { id: number }) => ({ tabela: 'auditoria_interna', id: String(x.id) }),
      (gr) =>
        gr.registrarAuditoria({
          titulo: e.titulo.trim(),
          area: e.area.trim(),
          referencial: e.referencial,
          realizadaEm: e.realizadaEm,
          auditores: e.auditores.trim(),
          itens,
          conformes: r.conformes,
          parciais: r.parciais,
          naoConformes: r.naoConformes,
          naoAplicaveis: r.naoAplicaveis,
          conformidade: r.conformidade,
          conclusao: e.conclusao.trim(),
          agora,
          usuario: s.login,
        }),
    );
    return { id: g.id, resultado: r };
  }

  // ── Comissões ────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('qualidade/gestao/comissoes')
  @Permissao(P.gestaoLer)
  async comissoes(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const [agora, cs] = await Promise.all([this.agora(s), this.porta.comissoes(s.porta)]);
    return { itens: cs.map((c) => comissaoLida(c, agora.slice(0, 10))) };
  }

  @Get('qualidade/gestao/comissoes/:id/reunioes')
  @Permissao(P.gestaoLer)
  async reunioes(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const c = await this.porta.comissao(s.porta, idDaRota(id));
    if (!c) throw naoEncontrado('Comissão');
    return { itens: (await this.porta.reunioes(s.porta, c.id)).map(reuniaoLida) };
  }

  @Post('qualidade/gestao/comissoes')
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.registrarComissao: comissao_hospitalar e a trilha_auditoria')
  async registrarComissao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarComissao, b);
    await this.apoio.exigirLiberacao(s);
    if ((e.comissao === null) !== (e.versao === null)) recusar('versao-desatualizada');
    if (membrosRepetidos(e.membros)) recusar('membro-repetido');
    const atual = e.comissao === null ? null : await this.porta.comissao(s.porta, e.comissao);
    if (e.comissao !== null && !atual) recusar('comissao-inexistente');
    // Revisão do W0-04 (D-CRUD-ORFAOS): inativar a comissão ou tirar dela o tipo 'prontuario' confere o mapa de
    // dependências (checklist vigente, sorteios em andamento) e recusa com quantos e quais; a gravação confere de novo
    // dentro da transação.
    const conferirDependentes =
      atual !== null &&
      ((atual.ativa && !e.ativa) || (atual.tipo === 'prontuario' && e.tipo !== 'prontuario'));
    if (conferirDependentes && atual) await this.semDependentes(s, 'comissao_hospitalar', atual.id);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeComissaoRegistrada.codigo,
      P.gestaoRegistrar,
      (x: { id: number }) => ({ tabela: 'comissao_hospitalar', id: String(x.id) }),
      (g) =>
        g.registrarComissao({
          id: e.comissao,
          versao: e.versao,
          tipo: e.tipo,
          nome: e.nome.trim(),
          periodicidade: e.periodicidade,
          membros: JSON.stringify(e.membros),
          ativa: e.ativa,
          agora,
          usuario: s.login,
          justificativa: e.justificativa ?? null,
          conferirDependentes,
        }),
    );
  }

  @Post('qualidade/gestao/comissoes/:id/reunioes')
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.registrarReuniaoComissao: reuniao_comissao e a trilha_auditoria')
  async registrarReuniao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarReuniaoComissao, { ...(b as object), comissao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const c = await this.porta.comissao(s.porta, e.comissao);
    if (!c) throw naoEncontrado('Comissão');
    // As posições dos presentes valem para a composição que a tela leu: a comissão alterada depois é recusada.
    if (c.versao !== e.versaoComissao) recusar('versao-desatualizada');
    const membros = membrosDaComissao(c.membros);
    const agora = await this.agora(s);
    recusar(recusaReuniao(e, { ativa: c.ativa, membros: membros.length }, agora));
    const presentes = e.presentes.map((i) => membros[i]!.nome);
    return this.apoio.sgh(
      s,
      E.qualidadeReuniaoRegistrada.codigo,
      P.gestaoRegistrar,
      (x: { id: number }) => ({ tabela: 'reuniao_comissao', id: String(x.id) }),
      (g) =>
        g.registrarReuniaoComissao({
          comissao: c.id,
          versaoComissao: e.versaoComissao,
          tipo: e.tipo,
          realizadaEm: e.realizadaEm,
          pauta: e.pauta.trim(),
          ata: e.ata.trim(),
          presentes: JSON.stringify(presentes),
          membrosTotal: membros.length,
          presentesTotal: presentes.length,
          presentesPosicoes: e.presentes,
          convidados: e.convidados?.trim() || null,
          deliberacoes: e.deliberacoes?.trim() || null,
          agora,
          usuario: s.login,
        }),
    );
  }

  // ── Riscos e não conformidades ───────────────────────────────────────────────────────────────────────────────

  @Get('qualidade/gestao/escala-gut')
  @Permissao(P.gestaoLer)
  escalaGut() {
    return { escala: ESCALA_GUT, prioridades: PRIORIDADES_RISCO };
  }

  @Get('qualidade/gestao/riscos')
  @Permissao(P.gestaoLer)
  async riscos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroGestao, q);
    const [agora, pg] = await Promise.all([this.agora(s), this.porta.riscos(s.porta, f)]);
    return {
      itens: pg.itens.map((r) => riscoLido(r, agora.slice(0, 10))),
      total: pg.total,
      pagina: f.pagina,
      porPagina: f.porPagina,
    };
  }

  @Post('qualidade/gestao/riscos')
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.registrarRisco: risco_institucional e a trilha_auditoria')
  async registrarRisco(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarRisco, b);
    await this.apoio.exigirLiberacao(s);
    if ((e.risco === null) !== (e.versao === null)) recusar('versao-desatualizada');
    const existente = e.risco === null ? null : await this.porta.risco(s.porta, e.risco);
    if (e.risco !== null && !existente) recusar('risco-inexistente');
    const agora = await this.agora(s);
    recusar(recusaRisco(e, existente, e.versao, agora.slice(0, 10)));
    recusar(recusaControlesRisco(e.controlesLista, e.situacao));
    return this.apoio.sgh(
      s,
      E.qualidadeRiscoRegistrado.codigo,
      P.gestaoRegistrar,
      (x: { id: number }) => ({ tabela: 'risco_institucional', id: String(x.id) }),
      (g) =>
        g.registrarRisco({
          id: e.risco,
          versao: e.versao,
          titulo: e.titulo.trim(),
          descricao: e.descricao.trim(),
          area: e.area.trim(),
          categoria: e.categoria,
          gravidade: e.gravidade,
          urgencia: e.urgencia,
          tendencia: e.tendencia,
          controles: e.controles?.trim() || null,
          ...(e.controlesLista
            ? {
                controlesLista: e.controlesLista.map((c) => ({
                  nome: c.nome.trim(),
                  tipo: c.tipo,
                  eficacia: c.eficacia,
                })),
              }
            : {}),
          responsavel: e.responsavel.trim(),
          situacao: e.situacao,
          reavaliarEm: e.reavaliarEm,
          justificativa: e.justificativa?.trim() || null,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Get('qualidade/gestao/nao-conformidades')
  @Permissao(P.gestaoLer)
  async naoConformidades(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroGestao, q);
    const [agora, pg] = await Promise.all([this.agora(s), this.porta.naoConformidades(s.porta, f)]);
    return {
      itens: pg.itens.map((n) => naoConformidadeLida(n, agora.slice(0, 10))),
      total: pg.total,
      pagina: f.pagina,
      porPagina: f.porPagina,
    };
  }

  /**
   * O registro de origem existe no Sante (auditoria, risco, manifestação e a notificação de incidente do NSP, esta só
   * pela existência, sem ler o relato nem o notificador). As outras origens não têm registro: o domínio exige o ID nulo.
   */
  private async origemDaNc(
    s: SessaoCadastro,
    origem: string,
    id: number | null,
  ): Promise<'origem-sem-registro' | 'origem-cancelada' | null> {
    if (id === null) return null;
    // Revisão do W0-04 (D-CRUD-ORFAOS): a origem cancelada (auditoria ou manifestação) não recebe NC nova; a gravação
    // confere de novo na transação, com a origem travada.
    const cancelada = (x: { canceladaEm?: string | null } | null) =>
      x === null ? 'origem-sem-registro' : x.canceladaEm ? 'origem-cancelada' : null;
    if (origem === 'auditoria') return cancelada(await this.porta.auditoria(s.porta, id));
    if (origem === 'ouvidoria') return cancelada(await this.porta.manifestacao(s.porta, id));
    if (origem === 'risco')
      return (await this.porta.risco(s.porta, id)) !== null ? null : 'origem-sem-registro';
    if (origem === 'notificacao')
      return (await this.porta.notificacaoExiste(s.porta, id)) ? null : 'origem-sem-registro';
    return 'origem-sem-registro';
  }

  @Post('qualidade/gestao/nao-conformidades')
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.registrarNaoConformidade: nao_conformidade_qualidade e a trilha_auditoria')
  async registrarNaoConformidade(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarNaoConformidade, b);
    await this.apoio.exigirLiberacao(s);
    if ((e.naoConformidade === null) !== (e.versao === null)) recusar('versao-desatualizada');
    const existente =
      e.naoConformidade === null ? null : await this.porta.naoConformidade(s.porta, e.naoConformidade);
    if (e.naoConformidade !== null && !existente) recusar('nao-conformidade-inexistente');
    if (existente?.canceladaEm) throw recusaCorrecaoGestao('registro-cancelado');
    const agora = await this.agora(s);
    recusar(
      recusaNaoConformidade(
        e,
        existente ? { ...existente, situacao: existente.situacao as 'aberta' } : null,
        agora.slice(0, 10),
      ),
    );
    const origem = await this.origemDaNc(s, e.origem, e.idOrigem);
    // A NC já aberta mantém a origem (não muda depois de aberta); a nova não nasce presa a origem cancelada.
    recusar(origem === 'origem-cancelada' && e.naoConformidade !== null ? null : origem);
    return this.apoio.sgh(
      s,
      E.qualidadeNaoConformidadeRegistrada.codigo,
      P.gestaoRegistrar,
      (x: { id: number }) => ({ tabela: 'nao_conformidade_qualidade', id: String(x.id) }),
      (g) =>
        g.registrarNaoConformidade({
          id: e.naoConformidade,
          versao: e.versao,
          origem: e.origem,
          idOrigem: e.idOrigem,
          descricao: e.descricao.trim(),
          area: e.area.trim(),
          classificacao: e.classificacao,
          acaoImediata: e.acaoImediata?.trim() || null,
          causa: e.causa?.trim() || null,
          plano: e.plano?.trim() || null,
          responsavel: e.responsavel?.trim() || null,
          prazo: e.prazo,
          situacao: e.situacao,
          eficacia: e.eficacia,
          eficaciaTexto: e.eficaciaTexto?.trim() || null,
          agora,
          usuario: s.login,
        }),
    );
  }

  // ── Ouvidoria ────────────────────────────────────────────────────────────────────────────────────────────────

  /** W0-04 (M4): o prazo da resposta (dias úteis, padrão 10) e a chave do canal da Hal-AI, pelos parâmetros. */
  private async parametrosOuvidoria(s: SessaoCadastro): Promise<{ prazo: number; halai: boolean }> {
    const ler = await this.apoio.resolvedorParametros(s);
    const prazo = Number(ler(PARAMETRO_PRAZO_OUVIDORIA, null));
    const halai = ler(PARAMETRO_CANAL_HALAI_OUVIDORIA, null);
    return {
      prazo: Number.isInteger(prazo) && prazo >= 1 ? prazo : DIAS_UTEIS_RESPOSTA_OUVIDORIA,
      halai: halai === true || halai === 'sim',
    };
  }

  /** W0-04 (M4): os indicadores da ouvidoria na competência (no prazo, por tipo, por área e por canal). */
  @Get('qualidade/ouvidoria/indicadores')
  @Permissao(P.ouvidoriaLer)
  async indicadoresDaOuvidoria(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroCompetenciaQualidade, q);
    const { de, ate } = diasDaCompetenciaQualidade(f.competencia);
    const TETO = 5000;
    const [agora, pg, par] = await Promise.all([
      this.agora(s),
      this.porta.manifestacoes(s.porta, {
        recebidaDe: de,
        recebidaAntes: somarDiasData(ate, 1),
        pagina: 1,
        porPagina: TETO,
      }),
      this.parametrosOuvidoria(s),
    ]);
    return {
      ...indicadoresOuvidoria(f.competencia, pg.itens, agora, par.prazo),
      cortada: pg.total > pg.itens.length,
    };
  }

  @Get('qualidade/ouvidoria/manifestacoes')
  @Permissao(P.ouvidoriaLer)
  @Auditar(E.qualidadeOuvidoriaLida.codigo)
  async manifestacoes(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroManifestacoes, q);
    const [agora, pg, l, par] = await Promise.all([
      this.agora(s),
      this.porta.manifestacoes(s.porta, f),
      this.apoio.liberacao(s),
      this.parametrosOuvidoria(s),
    ]);
    const nomes = await this.porta.nomesPacientes(
      s.porta,
      pg.itens.flatMap((m) => (m.paciente === null ? [] : [m.paciente])),
    );
    return {
      itens: pg.itens.map((m) =>
        manifestacaoLida(m, m.paciente === null ? null : (nomes.get(m.paciente) ?? null), agora),
      ),
      total: pg.total,
      pagina: f.pagina,
      porPagina: f.porPagina,
      ligada: l.ligada,
      motivo: l.motivo,
      podeResponder: l.ligada && s.pode(P.ouvidoriaResponder),
      agora,
      // W0-04 (M4): o prazo vigente e se o canal da Hal-AI está ligado (o formulário só o oferece ligado).
      prazoDiasUteis: par.prazo,
      canalHalai: par.halai,
    };
  }

  private async manifestacaoOu404(s: SessaoCadastro, id: number) {
    const m = await this.porta.manifestacao(s.porta, id);
    if (!m) throw naoEncontrado('Manifestação');
    return m;
  }

  @Get('qualidade/ouvidoria/manifestacoes/:id')
  @Permissao(P.ouvidoriaLer)
  @Auditar(E.qualidadeOuvidoriaLida.codigo)
  async manifestacao(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const m = await this.manifestacaoOu404(s, idDaRota(id));
    const [agora, nomes, ncs] = await Promise.all([
      this.agora(s),
      this.porta.nomesPacientes(s.porta, m.paciente === null ? [] : [m.paciente]),
      this.porta.naoConformidadesPorOrigem(s.porta, 'ouvidoria', [m.id]),
    ]);
    return {
      ...manifestacaoLida(m, m.paciente === null ? null : (nomes.get(m.paciente) ?? null), agora),
      naoConformidades: ncs.get(m.id) ?? 0,
    };
  }

  @Get('qualidade/ouvidoria/nps')
  @Permissao(P.ouvidoriaLer)
  async nps(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroCompetenciaQualidade, q);
    // A competência e as cinco anteriores (a tendência do NPS no semestre).
    const comps = [f.competencia];
    for (let i = 0; i < 5; i++) comps.push(competenciaAnterior(comps.at(-1)!));
    const { de } = diasDaCompetenciaQualidade(comps.at(-1)!);
    const { ate } = diasDaCompetenciaQualidade(f.competencia);
    const p = await this.porta.pesquisas(s.porta, de, ate);
    return {
      itens: comps.reverse().map((c) =>
        npsDasNotas(
          c,
          p.itens.filter((x) => x.dataAtendimento.startsWith(c)).map((x) => x.nota),
        ),
      ),
      cortada: p.cortada,
    };
  }

  @Get('qualidade/ouvidoria/pesquisas')
  @Permissao(P.ouvidoriaLer)
  async pesquisas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroCompetenciaQualidade, q);
    const { de, ate } = diasDaCompetenciaQualidade(f.competencia);
    const p = await this.porta.pesquisas(s.porta, de, ate);
    // Sem o paciente: a ouvidoria vê a nota, o comentário, a agenda e o dia (a conversão em manifestação traz o vínculo).
    return {
      itens: p.itens
        .filter((x) => x.comentario !== null || x.nota <= 6)
        .map((x) => ({
          id: x.id,
          tipo: x.tipo,
          agenda: x.agenda,
          dataAtendimento: x.dataAtendimento,
          nota: x.nota,
          comentario: x.comentario,
          manifestacao: x.manifestacao,
        })),
      cortada: p.cortada,
    };
  }

  @Post('qualidade/ouvidoria/manifestacoes')
  @Permissao(P.ouvidoriaResponder)
  @AuditadoNoHandler('qualidade.registrarManifestacao: manifestacao_ouvidoria e a trilha_auditoria')
  async registrarManifestacao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarManifestacao, b);
    await this.apoio.exigirLiberacao(s);
    const [agora, par] = await Promise.all([this.agora(s), this.parametrosOuvidoria(s)]);
    recusar(recusaRegistroManifestacao(e.recebidaEm, agora));
    const canal = recusaCanalOuvidoria(e.canal, par.halai);
    if (canal)
      throw new ErroProblema('recusa-de-negocio', 422, 'Ouvidoria', MENSAGENS_CANAL_OUVIDORIA[canal], {
        codigo: canal,
        bloqueios: [canal],
      });
    let paciente = e.paciente;
    if (e.pesquisa !== null) {
      const p = await this.porta.pesquisa(s.porta, e.pesquisa);
      if (!p) recusar('pesquisa-inexistente');
      // A resposta do portal é do paciente da conta: a manifestação identificada leva o paciente dela.
      if (e.identificada) paciente = p?.paciente ?? null;
    }
    if (paciente !== null && !(await this.porta.nomesPacientes(s.porta, [paciente])).get(paciente))
      recusar('paciente-inexistente');
    const feriados = await this.calendario(
      s,
      e.recebidaEm.slice(0, 10),
      somarDiasData(e.recebidaEm.slice(0, 10), 60),
    );
    const prazoEm = prazoRespostaOuvidoria(e.recebidaEm, feriados, par.prazo);
    const r = await this.apoio.sgh(
      s,
      E.qualidadeManifestacaoRegistrada.codigo,
      P.ouvidoriaResponder,
      (x: { id: number }) => ({ tabela: 'manifestacao_ouvidoria', id: String(x.id), paciente }),
      (g) =>
        g.registrarManifestacao({
          protocoloDe: (n) => protocoloManifestacao(e.recebidaEm, n),
          canal: e.canal,
          tipo: e.tipo,
          identificada: e.identificada,
          paciente,
          manifestante: e.manifestante?.trim() || null,
          contato: e.contato?.trim() || null,
          area: e.area.trim(),
          relato: e.relato.trim(),
          recebidaEm: e.recebidaEm,
          prazoEm,
          pesquisa: e.pesquisa,
          agora,
          usuario: s.login,
        }),
    );
    return { ...r, prazoEm };
  }

  @Post('qualidade/ouvidoria/manifestacoes/:id/encaminhamento')
  @Permissao(P.ouvidoriaResponder)
  @AuditadoNoHandler(
    'qualidade.encaminharManifestacao: manifestacao_ouvidoria com a versão conferida e a trilha_auditoria',
  )
  async encaminhar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncaminharManifestacao, { ...(b as object), manifestacao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const m = await this.manifestacaoOu404(s, e.manifestacao);
    if (m.canceladaEm) throw recusaCorrecaoGestao('registro-cancelado');
    recusar(recusaAndamentoManifestacao({ versao: m.versao, situacao: m.situacao as 'aberta' }, e.versao));
    return this.apoio.sgh(
      s,
      E.qualidadeManifestacaoEncaminhada.codigo,
      P.ouvidoriaResponder,
      { tabela: 'manifestacao_ouvidoria', id: String(m.id), paciente: m.paciente },
      (g) =>
        g.encaminharManifestacao({
          id: m.id,
          versao: e.versao,
          encaminhadaA: e.encaminhadaA.trim(),
          observacao: e.observacao?.trim() || null,
        }),
    );
  }

  @Post('qualidade/ouvidoria/manifestacoes/:id/resposta')
  @Permissao(P.ouvidoriaResponder)
  @AuditadoNoHandler(
    'qualidade.responderManifestacao: manifestacao_ouvidoria com a versão conferida e a trilha_auditoria',
  )
  async responder(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaResponderManifestacao, { ...(b as object), manifestacao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const m = await this.manifestacaoOu404(s, e.manifestacao);
    if (m.canceladaEm) throw recusaCorrecaoGestao('registro-cancelado');
    recusar(recusaAndamentoManifestacao({ versao: m.versao, situacao: m.situacao as 'aberta' }, e.versao));
    recusar(recusaResposta(m.tipo, e.procedente));
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeManifestacaoRespondida.codigo,
      P.ouvidoriaResponder,
      { tabela: 'manifestacao_ouvidoria', id: String(m.id), paciente: m.paciente },
      (g) =>
        g.responderManifestacao({
          id: m.id,
          versao: e.versao,
          resposta: e.resposta.trim(),
          procedente: e.procedente,
          agora,
          usuario: s.login,
        }),
    );
  }

  // ── Envios regulatórios ──────────────────────────────────────────────────────────────────────────────────────

  /** Os dados de cada envio na competência (as mesmas leituras das telas da CCIH, do NSP e dos indicadores). */
  private async dadosDoEnvio(
    s: SessaoCadastro,
    tipo: TipoEnvioRegulatorio,
    competencia: string,
  ): Promise<DadosDoEnvio> {
    if (tipo === 'pmQualiss') return { indicadores: await this.indicadores(s, competencia) };
    if (tipo === 'iras') {
      const d = await this.denominadores(s, competencia, await this.agora(s));
      return d ? { iras: { setores: d.setores, todos: d.todos } } : {};
    }
    const { de, ate } = diasDaCompetenciaQualidade(competencia);
    const fim = somarDiasData(ate, 1);
    const [inc, feriados] = await Promise.all([
      this.porta.incidentesNotivisa(s.porta, de, fim),
      this.calendario(s, de, somarDiasData(ate, 62)),
    ]);
    return { notificacoes: incidentesDoEnvio(inc.itens, feriados) };
  }

  /** O tipo de envio cujos dados a sessão pode ler (o Notivisa do NSP, as IRAS da CCIH, o PM-QUALISS dos indicadores). */
  private podeTipoEnvio(s: SessaoCadastro, tipo: string): boolean {
    const p = (PERMISSAO_DADOS_ENVIO_REGULATORIO as Readonly<Record<string, string>>)[tipo];
    return p !== undefined && s.pode(p);
  }

  private exigirTipoEnvio(s: SessaoCadastro, tipo: string): void {
    if (!this.podeTipoEnvio(s, tipo))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão para este envio',
        'Seu perfil não acessa os dados deste envio regulatório.',
        { codigo: 'sem-permissao-envio' },
      );
  }

  @Get('relatorio/envios-regulatorios')
  @Permissao(P.envioGerar)
  async envios(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const [agora, l] = await Promise.all([this.agora(s), this.apoio.liberacao(s)]);
    let desde = agora.slice(0, 7);
    for (let i = 0; i < 12; i++) desde = competenciaAnterior(desde);
    return {
      tipos: TIPOS_ENVIO_REGULATORIO.filter((t) => this.podeTipoEnvio(s, t.codigo)),
      itens: (await this.porta.envios(s.porta, desde))
        .filter((x) => this.podeTipoEnvio(s, x.tipo))
        .map(envioLido),
      ligada: l.ligada,
      motivo: l.motivo,
      podeGerar: l.ligada,
      // A competência fechada mais recente (a sugerida na tela).
      competenciaSugerida: competenciaAnterior(agora.slice(0, 7)),
      agora,
    };
  }

  @Get('relatorio/envios-regulatorios/:id/arquivo')
  @Permissao(P.envioGerar)
  async arquivo(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const env = await this.porta.envio(s.porta, idDaRota(id));
    if (!env) throw naoEncontrado('Envio');
    const tipo = env.tipo as TipoEnvioRegulatorio;
    if (!(CODIGOS_TIPO_ENVIO_REGULATORIO as readonly string[]).includes(tipo)) throw naoEncontrado('Envio');
    this.exigirTipoEnvio(s, tipo);
    // A porta própria devolve os bytes guardados na geração (os transmitidos, nunca gerados de novo).
    if (this.porta.arquivoEnvio) {
      const g = await this.porta.arquivoEnvio(s.porta, env.id);
      if (!g) throw naoEncontrado('Envio');
      return { arquivo: g.arquivo, conteudo: g.conteudo, hash: g.hash, igual: g.hash === env.hash };
    }
    const a = arquivoDoEnvio(tipo, env.competencia, await this.dadosDoEnvio(s, tipo, env.competencia));
    // O arquivo se gera de novo dos mesmos dados; o resumo diferente diz que os dados mudaram depois da geração.
    return { arquivo: env.arquivo, conteudo: a.conteudo, hash: a.hash, igual: a.hash === env.hash };
  }

  @Post('relatorio/envios-regulatorios')
  @Permissao(P.envioGerar)
  @AuditadoNoHandler(
    'relatorio.gerarEnvioRegulatorio: envio_regulatorio_qualidade (a anterior substituída) e a trilha_auditoria',
  )
  async gerar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaGerarEnvioRegulatorio, b);
    this.exigirTipoEnvio(s, e.tipo);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const ant = (await this.porta.envios(s.porta, e.competencia)).filter(
      (x) => x.tipo === e.tipo && x.competencia === e.competencia,
    );
    recusar(
      recusaGeracaoEnvio(
        e.competencia,
        agora,
        ant.map((x) => ({ situacao: x.situacao as 'gerado' })),
      ),
    );
    const a = arquivoDoEnvio(e.tipo, e.competencia, await this.dadosDoEnvio(s, e.tipo, e.competencia));
    const r = await this.apoio.sgh(
      s,
      E.relatorioEnvioGerado.codigo,
      P.envioGerar,
      (x: { id: number }) => ({ tabela: 'envio_regulatorio_qualidade', id: String(x.id) }),
      (g) =>
        g.gerarEnvioRegulatorio({
          tipo: e.tipo,
          competencia: e.competencia,
          arquivoDe: (rev) => nomeArquivoEnvio(e.tipo, e.competencia, rev, s.hospital),
          hash: a.hash,
          linhas: a.linhas,
          resumo: JSON.stringify(a.resumo),
          conteudo: a.conteudo,
          agora,
          usuario: s.login,
        }),
    );
    return { ...r, hash: a.hash, linhas: a.linhas, resumo: a.resumo, conteudo: a.conteudo };
  }

  @Post('relatorio/envios-regulatorios/:id/transmissao')
  @Permissao(P.envioGerar)
  @AuditadoNoHandler(
    'relatorio.registrarTransmissaoEnvio: envio_regulatorio_qualidade com a versão e o resumo, e a trilha_auditoria',
  )
  async transmitir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarTransmissaoEnvio, { ...(b as object), envio: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const env = await this.porta.envio(s.porta, e.envio);
    if (!env) throw naoEncontrado('Envio');
    this.exigirTipoEnvio(s, env.tipo);
    const agora = await this.agora(s);
    recusar(
      recusaTransmissaoEnvio(
        { versao: env.versao, situacao: env.situacao as 'gerado', hash: env.hash, geradoEm: env.geradoEm },
        e,
        agora,
      ),
    );
    return this.apoio.sgh(
      s,
      E.relatorioEnvioTransmitido.codigo,
      P.envioGerar,
      { tabela: 'envio_regulatorio_qualidade', id: String(env.id) },
      (g) =>
        g.registrarTransmissaoEnvio({
          id: env.id,
          versao: e.versao,
          hash: e.hash,
          transmitidoEm: e.transmitidoEm,
          protocolo: e.protocolo.trim(),
          usuario: s.login,
        }),
    );
  }

  // ── W0-04: alteração com versão, cancelamento com motivo e retificação ───────────────────────────────────────

  /** A senha das operações críticas (reautenticação em diálogo, SBIS-07): vem no corpo e sai dele. */
  private async reautenticado(req: RequisicaoAutorizada, b: unknown): Promise<unknown> {
    const { senha, ...resto } = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, typeof senha === 'string' ? senha : undefined);
    return resto;
  }

  /** D-CRUD-ORFAOS: o cancelamento que deixaria dependente ativo é recusado com quantos e quais. */
  private async semDependentes(s: SessaoCadastro, tabela: string, id: number): Promise<void> {
    const ds = await this.porta.dependentes(s.porta, tabela, id);
    if (ds.length) {
      const avisos = ds.map((d) => `${d.grupo} (${String(d.quantidade)}): nº ${d.ids.join(', nº ')}.`);
      throw recusaCorrecaoGestao('com-dependentes', avisos);
    }
  }

  @Get('qualidade/gestao/versoes/:registro/:id')
  @Permissao(P.gestaoLer)
  async versoesGestao(
    @Param('registro') registro: string,
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const tabela = TABELA_DO_REGISTRO[registro as RegistroVersionadoQualidade];
    if (
      !tabela ||
      !['auditoria', 'reuniao', 'nao-conformidade', 'manifestacao', 'comissao'].includes(registro)
    )
      throw naoEncontrado('Registro');
    if (registro === 'manifestacao' && !s.pode(P.ouvidoriaLer)) throw naoEncontrado('Registro');
    return { itens: await this.porta.versoes(s.porta, tabela, idDaRota(id)) };
  }

  @Post('qualidade/gestao/auditorias/:id/alteracao')
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler(
    'qualidade.alterarAuditoria: auditoria_interna (nova versão; a anterior na trilha_auditoria) e a trilha_auditoria',
  )
  async alterarAuditoria(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarAuditoria, b);
    await this.apoio.exigirLiberacao(s);
    const a = await this.porta.auditoria(s.porta, idDaRota(id));
    if (!a) throw naoEncontrado('Auditoria');
    if (a.canceladaEm) throw recusaCorrecaoGestao('registro-cancelado');
    const agora = await this.agora(s);
    recusar(recusaAuditoria(e, agora.slice(0, 10)));
    const itens = JSON.stringify(e.itens);
    if (Buffer.byteLength(itens, 'latin1') > 16_000)
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Gestão da qualidade',
        'O checklist passou do tamanho máximo.',
        {
          codigo: 'checklist-grande',
          campos: ['itens'],
        },
      );
    const r = resultadoChecklist(e.itens);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCorrigido.codigo,
      P.gestaoRegistrar,
      { tabela: 'auditoria_interna', id: String(a.id) },
      (g) =>
        g.alterarAuditoria({
          id: a.id,
          versao: e.versao,
          titulo: e.titulo.trim(),
          area: e.area.trim(),
          realizadaEm: e.realizadaEm,
          auditores: e.auditores.trim(),
          itens,
          contagens: r,
          conclusao: e.conclusao.trim(),
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('qualidade/gestao/auditorias/:id/cancelamento')
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler(
    'qualidade.cancelarAuditoria: auditoria_interna (cancelamento lógico; retrato na trilha_auditoria) e a trilha_auditoria',
  )
  async cancelarAuditoria(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarRegistroQualidade, await this.reautenticado(req, b));
    await this.apoio.exigirLiberacao(s);
    const a = await this.porta.auditoria(s.porta, idDaRota(id));
    if (!a) throw naoEncontrado('Auditoria');
    if (a.canceladaEm) throw recusaCorrecaoGestao('registro-cancelado');
    await this.semDependentes(s, 'auditoria_interna', a.id);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCancelado.codigo,
      P.gestaoRegistrar,
      { tabela: 'auditoria_interna', id: String(a.id) },
      (g) =>
        g.cancelarAuditoria({
          id: a.id,
          versao: e.versao,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('qualidade/gestao/reunioes/:id/retificacao')
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler(
    'qualidade.retificarAta: reuniao_comissao (nova versão; a anterior na trilha_auditoria) e a trilha_auditoria',
  )
  async retificarAta(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const r = await this.porta.reuniao(s.porta, idDaRota(id));
    if (!r) throw naoEncontrado('Reunião');
    // Revisão do W0-04: retificar a ata JÁ ASSINADA é operação crítica (senha): a assinatura sai do texto novo, que fica
    // aguardando nova assinatura (a assinada inteira continua no histórico de versões).
    const assinada = r.ataAssinadaEm ? { em: r.ataAssinadaEm, por: r.ataAssinadaPor ?? '' } : null;
    const e = corpo(esquemaRetificarAta, assinada ? await this.reautenticado(req, b) : b);
    await this.apoio.exigirLiberacao(s);
    if (r.canceladaEm) throw recusaCorrecaoGestao('registro-cancelado');
    const c = await this.porta.comissao(s.porta, r.comissao);
    if (!c) throw naoEncontrado('Comissão');
    // Os presentes são as posições da composição de hoje (o retrato da reunião guarda os nomes de antes).
    const membros = membrosDaComissao(c.membros);
    if (e.presentes.some((i) => i >= membros.length)) recusar('presente-fora-da-composicao');
    if (new Set(e.presentes).size !== e.presentes.length) recusar('presente-repetido');
    const presentes = e.presentes.map((i) => membros[i]!.nome);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCorrigido.codigo,
      P.gestaoRegistrar,
      { tabela: 'reuniao_comissao', id: String(r.id) },
      (g) =>
        g.retificarAta({
          id: r.id,
          versao: e.versao,
          pauta: e.pauta.trim(),
          ata: e.ata.trim(),
          presentes: JSON.stringify(presentes),
          presentesTotal: presentes.length,
          convidados: e.convidados?.trim() || null,
          deliberacoes: e.deliberacoes?.trim() || null,
          justificativa: e.justificativa,
          assinaturaAtual: assinada,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('qualidade/gestao/reunioes/:id/assinatura')
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.assinarAta: reuniao_comissao (marca da assinatura) e a trilha_auditoria')
  async assinarAta(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAssinarAta, await this.reautenticado(req, b));
    await this.apoio.exigirLiberacao(s);
    const r = await this.porta.reuniao(s.porta, idDaRota(id));
    if (!r) throw naoEncontrado('Reunião');
    if (r.canceladaEm) throw recusaCorrecaoGestao('registro-cancelado');
    if (r.ataAssinadaEm) throw recusaCorrecaoGestao('ata-ja-assinada');
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeAtaAssinada.codigo,
      P.gestaoRegistrar,
      { tabela: 'reuniao_comissao', id: String(r.id) },
      (g) => g.assinarAta({ id: r.id, versao: e.versao, agora, usuario: s.login }),
    );
  }

  @Post('qualidade/gestao/reunioes/:id/cancelamento')
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler(
    'qualidade.cancelarReuniao: reuniao_comissao (cancelamento lógico; retrato na trilha_auditoria) e a trilha_auditoria',
  )
  async cancelarReuniao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarRegistroQualidade, await this.reautenticado(req, b));
    await this.apoio.exigirLiberacao(s);
    const r = await this.porta.reuniao(s.porta, idDaRota(id));
    if (!r) throw naoEncontrado('Reunião');
    const problema = conferirCancelamentoReuniao(r);
    if (problema) throw recusaCorrecaoGestao(problema);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCancelado.codigo,
      P.gestaoRegistrar,
      { tabela: 'reuniao_comissao', id: String(r.id) },
      (g) =>
        g.cancelarReuniao({
          id: r.id,
          versao: e.versao,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('qualidade/gestao/nao-conformidades/:id/cancelamento')
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler(
    'qualidade.cancelarNaoConformidade: nao_conformidade_qualidade (cancelamento lógico; retrato na trilha_auditoria) e a trilha_auditoria',
  )
  async cancelarNaoConformidade(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarNaoConformidade, await this.reautenticado(req, b));
    await this.apoio.exigirLiberacao(s);
    const n = await this.porta.naoConformidade(s.porta, idDaRota(id));
    if (!n) throw naoEncontrado('Não conformidade');
    const original =
      e.duplicadaDe === null || e.duplicadaDe === n.id
        ? null
        : await this.porta.naoConformidade(s.porta, e.duplicadaDe);
    const problema = conferirCancelamentoNaoConformidade(n, original, e.duplicadaDe);
    if (problema) throw recusaCorrecaoGestao(problema, [], problema === 'registro-cancelado' ? 409 : 422);
    await this.semDependentes(s, 'nao_conformidade_qualidade', n.id);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCancelado.codigo,
      P.gestaoRegistrar,
      { tabela: 'nao_conformidade_qualidade', id: String(n.id) },
      (g) =>
        g.cancelarNaoConformidade({
          id: n.id,
          versao: e.versao,
          duplicadaDe: e.duplicadaDe,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('qualidade/ouvidoria/manifestacoes/:id/correcao')
  @Permissao(P.ouvidoriaResponder)
  @AuditadoNoHandler(
    'qualidade.corrigirManifestacao: manifestacao_ouvidoria (nova versão; a anterior na trilha_auditoria) e a trilha_auditoria',
  )
  async corrigirManifestacao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCorrigirManifestacao, b);
    await this.apoio.exigirLiberacao(s);
    const m = await this.manifestacaoOu404(s, idDaRota(id));
    const problema = conferirCorrecaoManifestacao(m, e);
    if (problema) throw recusaCorrecaoGestao(problema, [], problema === 'sem-mudanca' ? 422 : 409);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCorrigido.codigo,
      P.ouvidoriaResponder,
      { tabela: 'manifestacao_ouvidoria', id: String(m.id), paciente: m.paciente },
      (g) =>
        g.corrigirManifestacao({
          id: m.id,
          versao: e.versao,
          tipo: e.tipo,
          area: e.area.trim(),
          relato: e.relato.trim(),
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('qualidade/ouvidoria/manifestacoes/:id/cancelamento')
  @Permissao(P.ouvidoriaResponder)
  @AuditadoNoHandler(
    'qualidade.cancelarManifestacao: manifestacao_ouvidoria (cancelamento lógico; retrato na trilha_auditoria) e a trilha_auditoria',
  )
  async cancelarManifestacao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarRegistroQualidade, await this.reautenticado(req, b));
    await this.apoio.exigirLiberacao(s);
    const m = await this.manifestacaoOu404(s, idDaRota(id));
    if (m.canceladaEm) throw recusaCorrecaoGestao('registro-cancelado');
    await this.semDependentes(s, 'manifestacao_ouvidoria', m.id);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeRegistroCancelado.codigo,
      P.ouvidoriaResponder,
      { tabela: 'manifestacao_ouvidoria', id: String(m.id), paciente: m.paciente },
      (g) =>
        g.cancelarManifestacao({
          id: m.id,
          versao: e.versao,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }
}
