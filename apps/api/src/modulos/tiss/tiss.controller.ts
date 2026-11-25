// Pós-fechamento da conta (M31; ficha, seções 4, 5 e 7): guias, lotes TISS 04.03.00, protocolo, prazos de envio,
// competências, demonstrativos e conciliação, retorno e glosa, webservices por operadora e o painel de glosas, sobre as
// mesmas tabelas do outro sistema:
//   GET  /api/tiss/gravacao | apoio | motivos
//   GET  /api/tiss/guias?convenio&competencia (auditada); GET guias/:conta/impressao (PDF/A, auditada)
//   GET  /api/tiss/lotes/contas-prontas?convenio&tipoGuia&competencia; POST lotes (gerarLote)
//   GET  /api/tiss/lotes?convenio&de&ate&semProtocolo&pagina; GET lotes/:id (auditada)
//   POST /api/tiss/lotes/:id/protocolo | lotes/:id/envio
//   GET  /api/tiss/prazos; GET/POST /api/tiss/competencias; GET competencias/resumo
//   GET/POST /api/tiss/demonstrativos; GET demonstrativos/:id
//   GET  /api/tiss/glosas?convenio&competencia&estado&pagina (auditada); GET glosas/contas/:conta (auditada)
//   POST /api/tiss/glosas/baixa | recurso | desfecho | decisao; GET glosas/itens/:id/evidencia (auditada)
//   GET  /api/tiss/configuracao; POST /api/tiss/endpoints
//   GET  /api/tiss/painel?de&ate (só agregados; cache de horas); GET painel/exportacao (CSV)
//   GET  /api/tiss/painel/competencia?competencia&convenio  M42: acompanhamento da competência (só agregados; cache)
//   GET  /api/tiss/painel/competencia/exportacao            M42: CSV com as parcelas (auditada)
//   POST /api/tiss/painel/competencia/conferencia           M42: compara o lido no outro sistema com o de agora
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type AcompanhamentoCompetencia,
  type ConferenciaCompetencia,
  type CompetenciaLida,
  type ConfiguracaoTissLida,
  type ContaProntaLote,
  type DemonstrativoLido,
  type EvidenciaGlosaLida,
  esquemaDecidirGlosa,
  esquemaEditarEndpointTiss,
  esquemaFecharCompetencia,
  esquemaReabrirCompetencia,
  esquemaGerarLote,
  esquemaImportarDemonstrativo,
  esquemaRegistrarGlosa,
  esquemaRegistrarProtocolo,
  esquemaRegistrarRecurso,
  esquemaRegistrarRetornoRecurso,
  EVENTOS_AUDITAVEIS,
  type GradeGlosa,
  type GravacaoTiss,
  type GuiaLida,
  type ItemGlosaLido,
  type ListaLotes,
  type LoteDetalhe,
  type MotivoGlosaLido,
  type PainelGlosa,
  type PrazoEnvio,
  type ResultadoTiss,
} from '@sgh/contratos';
import { lerCompetencia, ROTULO_TIPO_GUIA, VERSAO_TISS_VIGENTE } from '@sgh/dominio-faturamento';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import { AcompanhamentoTiss } from './acompanhamento.js';
import { ApoiosTiss } from './apoios.js';
import { type ArmazemXmlTiss, armazemXmlMemoria } from './armazem-xml.js';
import { guiaHtml } from './guia-impressao.js';
import { type ContextoTiss, PORTA_TISS, type PortaTiss } from './porta.js';
import { ServicoTiss } from './servico.js';

export const ARMAZEM_XML_TISS = Symbol('ARMAZEM_XML_TISS');
export const GERADOR_PDF_TISS = Symbol('GERADOR_PDF_TISS');
export type GeradorPdfTiss = (html: string, titulo: string) => Promise<Uint8Array>;

const ctx = (s: SessaoCadastro): ContextoTiss => s.porta;
const pagina = (v: string | undefined) => Math.min(10_000, Math.max(0, inteiroOuNulo(v) ?? 0));
const E = EVENTOS_AUDITAVEIS;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const dataOu = (v: string | undefined, padrao: string): string => {
  if (v === undefined || v === '') return padrao;
  if (!DIA.test(v)) throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use AAAA-MM-DD.');
  return v;
};
const menosDias = (hoje: string, dias: number) => {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
};
const mesOu = (v: string | undefined, padrao: string): string => {
  if (v === undefined || v === '') return padrao;
  if (!/^\d{4}-\d{2}$/.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Mês inválido', 'Use AAAA-MM.');
  return v;
};

interface Resposta {
  header(n: string, v: string): unknown;
  send(c: unknown): unknown;
}

@Controller('tiss')
export class TissController {
  readonly apoios: ApoiosTiss;
  readonly servico: ServicoTiss;
  readonly acompanhamento: AcompanhamentoTiss;
  constructor(
    @Inject(PORTA_TISS) private readonly porta: PortaTiss,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonteConfiguracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(ARMAZEM_XML_TISS) armazem: ArmazemXmlTiss | null = null,
    @Optional() @Inject(GERADOR_PDF_TISS) private readonly geradorPdf: GeradorPdfTiss | null = null,
  ) {
    const ambiente = (process.env['AMBIENTE'] ?? 'dev').trim() || 'dev';
    this.apoios = new ApoiosTiss(porta, trilha, fonteConfiguracao, cache, ambiente);
    this.servico = new ServicoTiss(porta, this.apoios, ambiente, armazem ?? armazemXmlMemoria());
    this.acompanhamento = new AcompanhamentoTiss(porta, this.servico);
  }

  // ── Situação, apoio e motivos ────────────────────────────────────────────────────────────────────────

  @Get('gravacao')
  @Permissao('faturamento.lote.ler')
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoTiss> {
    return this.apoios.gravacao(sessaoDe(req));
  }

  /** As telas de glosa e de demonstrativo também leem a situação (perfis sem a leitura do lote). */
  @Get('gravacao-glosa')
  @Permissao('faturamento.glosa.ler')
  gravacaoGlosa(@Req() req: RequisicaoAutorizada): Promise<GravacaoTiss> {
    return this.apoios.gravacao(sessaoDe(req));
  }

  @Get('apoio')
  @Permissao('faturamento.glosa.ler')
  async apoio(@Req() req: RequisicaoAutorizada): Promise<{
    hoje: string;
    convenios: { codigo: number; nome: string }[];
    situacoesProtocolo: { id: number; nome: string }[];
    tiposGuia: { id: number; nome: string }[];
    versao: string;
  }> {
    const s = sessaoDe(req);
    const escopo = this.servico.convenios(s);
    const todos = await this.porta.convenios(ctx(s));
    return {
      hoje: await this.porta.hoje(ctx(s)),
      convenios: escopo === null ? todos : todos.filter((c) => escopo.includes(c.codigo)),
      situacoesProtocolo: await this.porta.situacoesProtocolo(ctx(s)),
      tiposGuia: [1, 2, 3, 4].map((id) => ({ id, nome: ROTULO_TIPO_GUIA[id] ?? String(id) })),
      versao: VERSAO_TISS_VIGENTE,
    };
  }

  @Get('motivos')
  @Permissao('faturamento.glosa.ler')
  motivos(@Req() req: RequisicaoAutorizada): Promise<MotivoGlosaLido[]> {
    return this.porta.motivos(ctx(sessaoDe(req)));
  }

  // ── Guias ────────────────────────────────────────────────────────────────────────────────────────────

  @Get('guias')
  @Permissao('faturamento.guia.ler')
  @Auditar(E.faturamentoContasLidas.codigo)
  async guias(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<GuiaLida[]> {
    const s = sessaoDe(req);
    const comp = lerCompetencia(q['competencia']);
    req.sghAlvo = { tabelaAlvo: 'conta_hospitalar', idAlvo: `guias ${q['competencia'] ?? ''}` };
    return this.porta.guias(ctx(s), {
      convenio: inteiroOuNulo(q['convenio']),
      ano: comp?.ano ?? null,
      mes: comp?.mes ?? null,
      convenios: this.servico.convenios(s, inteiroOuNulo(q['convenio'])),
    });
  }

  /** A guia no leiaute da TISS em PDF/A (Gotenberg), a partir dos dados emitidos (a emissão segue no outro sistema). */
  @Get('guias/:conta/impressao')
  @Permissao('faturamento.guia.imprimir')
  @Auditar(E.faturamentoContasLidas.codigo)
  async imprimirGuia(
    @Param('conta') conta: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: Resposta,
  ): Promise<void> {
    const s = sessaoDe(req);
    const id = idDaRota(conta);
    const convenio = await this.servico.exigirEscopoConta(s, id);
    req.sghAlvo = { tabelaAlvo: 'conta_hospitalar', idAlvo: String(id) };
    const guias = await this.porta.guias(ctx(s), {
      convenio,
      ano: null,
      mes: null,
      convenios: this.servico.convenios(s, convenio),
    });
    const g = guias.find((x) => x.conta === id);
    if (!g) throw new ErroProblema('nao-encontrado', 404, 'Guia não encontrada', 'A conta não foi emitida.');
    const itens = await this.porta.itensDaConta(ctx(s), id, '');
    const html = guiaHtml(g, itens);
    if (!this.geradorPdf) {
      res.header('content-type', 'text/html; charset=utf-8');
      res.send(html);
      return;
    }
    const pdf = await this.geradorPdf(html, `Guia ${g.tipoGuiaNome} ${g.numeroGuia}`);
    res.header('content-type', 'application/pdf');
    res.header('content-disposition', `inline; filename="guia-${id}.pdf"`);
    res.send(Buffer.from(pdf));
  }

  // ── Lotes ────────────────────────────────────────────────────────────────────────────────────────────

  @Get('lotes/contas-prontas')
  @Permissao('faturamento.lote.ler')
  @Auditar(E.faturamentoContasLidas.codigo)
  async contasProntas(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ContaProntaLote[]> {
    const s = sessaoDe(req);
    const convenio = inteiroOuNulo(q['convenio']);
    if (convenio === null)
      throw new ErroProblema('entrada-invalida', 400, 'Convênio obrigatório', 'Escolha o convênio do lote.', {
        campos: ['convenio'],
      });
    this.servico.exigirEscopoConvenio(s, convenio);
    const tipoGuia = inteiroOuNulo(q['tipoGuia']) ?? 2;
    const comp = lerCompetencia(q['competencia']);
    req.sghAlvo = { tabelaAlvo: 'conta_hospitalar', idAlvo: `prontas ${convenio}` };
    return this.porta.contasProntas(ctx(s), {
      convenio,
      tipoGuia,
      ano: comp?.ano ?? null,
      mes: comp?.mes ?? null,
      convenios: this.servico.convenios(s, convenio),
    });
  }

  @Post('lotes')
  @HttpCode(200)
  @Permissao('faturamento.lote.gerar')
  @AuditadoNoHandler('faturamento.gerarLote pelo executor (trilha na mesma transação)')
  gerarLote(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTiss> {
    return this.servico.gerarLote(sessaoDe(req), corpo(esquemaGerarLote, b));
  }

  @Get('lotes')
  @Permissao('faturamento.lote.ler')
  async lotes(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaLotes> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    return this.porta.lotes(ctx(s), {
      convenio: inteiroOuNulo(q['convenio']),
      de: dataOu(q['de'], menosDias(hoje, 90)),
      ate: dataOu(q['ate'], hoje),
      semProtocolo: q['semProtocolo'] === 'sim',
      convenios: this.servico.convenios(s, inteiroOuNulo(q['convenio'])),
      pagina: pagina(q['pagina']),
      porPagina: 50,
      hoje,
    });
  }

  @Get('lotes/:id')
  @Permissao('faturamento.lote.ler')
  @Auditar(E.faturamentoContasLidas.codigo)
  async lote(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<LoteDetalhe> {
    const s = sessaoDe(req);
    const lote = idDaRota(id);
    await this.servico.exigirEscopoLote(s, lote);
    req.sghAlvo = { tabelaAlvo: 'lote_tiss', idAlvo: String(lote) };
    const l = await this.porta.lote(ctx(s), lote, await this.porta.hoje(ctx(s)));
    if (!l) throw new ErroProblema('nao-encontrado', 404, 'Lote não encontrado');
    return l;
  }

  @Post('lotes/:id/protocolo')
  @HttpCode(200)
  @Permissao('faturamento.protocolo.registrar')
  @AuditadoNoHandler('faturamento.registrarProtocolo pelo executor (trilha na mesma transação)')
  protocolo(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoTiss> {
    return this.servico.registrarProtocolo(
      sessaoDe(req),
      corpo(esquemaRegistrarProtocolo, { ...((b ?? {}) as object), lote: idDaRota(id) }),
    );
  }

  @Post('lotes/:id/envio')
  @HttpCode(200)
  @Permissao('faturamento.lote.enviar')
  @AuditadoNoHandler(
    'envio do lote (simulador fora de produção) com a trilha_auditoria na mesma transação (entidade lote_tiss)',
  )
  envio(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.servico.enviarLote(sessaoDe(req), idDaRota(id));
  }

  @Get('prazos')
  @Permissao('faturamento.lote.ler')
  async prazos(@Req() req: RequisicaoAutorizada): Promise<PrazoEnvio[]> {
    const s = sessaoDe(req);
    return this.porta.prazos(ctx(s), {
      hoje: await this.porta.hoje(ctx(s)),
      paradoDias: await this.servico.parametro(s, 'faturamento.loteParadoDias', 15),
      prazoRecurso: await this.servico.parametroTexto(s, 'faturamento.recursoPrazoPorOperadora'),
      convenios: this.servico.convenios(s),
    });
  }

  // ── Competências ─────────────────────────────────────────────────────────────────────────────────────

  @Get('competencias')
  @Permissao('faturamento.competencia.ler')
  competencias(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CompetenciaLida[]> {
    const s = sessaoDe(req);
    return this.porta.competencias(ctx(s), {
      convenio: inteiroOuNulo(q['convenio']),
      ano: inteiroOuNulo(q['ano']),
      convenios: this.servico.convenios(s, inteiroOuNulo(q['convenio'])),
    });
  }

  @Get('competencias/resumo')
  @Permissao('faturamento.competencia.ler')
  async resumoCompetencia(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CompetenciaLida> {
    const s = sessaoDe(req);
    const convenio = inteiroOuNulo(q['convenio']);
    const comp = lerCompetencia(q['competencia']);
    if (convenio === null || !comp)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Convênio e competência',
        'Informe o convênio e a competência.',
      );
    this.servico.exigirEscopoConvenio(s, convenio);
    return this.porta.resumoCompetencia(ctx(s), { convenio, ano: comp.ano, mes: comp.mes });
  }

  @Post('competencias')
  @HttpCode(200)
  @Permissao('faturamento.competencia.fechar')
  @AuditadoNoHandler('faturamento.fecharCompetencia pelo executor (trilha na mesma transação)')
  fecharCompetencia(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTiss> {
    return this.servico.fecharCompetencia(sessaoDe(req), corpo(esquemaFecharCompetencia, b));
  }

  @Post('competencias/reabrir')
  @HttpCode(200)
  @Permissao('faturamento.competencia.reabrir')
  @AuditadoNoHandler('faturamento.reabrirCompetencia pelo executor (trilha na mesma transação)')
  reabrirCompetencia(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTiss> {
    return this.servico.reabrirCompetencia(sessaoDe(req), corpo(esquemaReabrirCompetencia, b));
  }

  // ── Demonstrativos ───────────────────────────────────────────────────────────────────────────────────

  @Get('demonstrativos')
  @Permissao('faturamento.demonstrativo.ler')
  demonstrativos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DemonstrativoLido[]> {
    const s = sessaoDe(req);
    return this.porta.demonstrativos(ctx(s), {
      lote: inteiroOuNulo(q['lote']),
      convenios: this.servico.convenios(s),
    });
  }

  @Get('demonstrativos/:id')
  @Permissao('faturamento.demonstrativo.ler')
  @Auditar(E.faturamentoGlosasLidas.codigo)
  async demonstrativo(
    @Param('id') id: string,
    @Query('tipo') tipo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<NonNullable<Awaited<ReturnType<PortaTiss['demonstrativo']>>>> {
    const s = sessaoDe(req);
    const pagamento = tipo === 'pagamento';
    const d = await this.porta.demonstrativo(ctx(s), idDaRota(id), pagamento ? 'pagamento' : 'analise');
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Demonstrativo não encontrado');
    this.servico.exigirEscopoConvenio(s, d.convenio);
    req.sghAlvo = {
      tabelaAlvo: pagamento ? 'demonstrativo_pagamento' : 'demonstrativo_analise_conta',
      idAlvo: id,
    };
    return d;
  }

  @Post('demonstrativos')
  @HttpCode(200)
  @Permissao('faturamento.demonstrativo.importar')
  @AuditadoNoHandler(
    'importação do demonstrativo com a trilha_auditoria na mesma transação (entidade demonstrativo_analise_conta)',
  )
  importar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTiss> {
    return this.servico.importarDemonstrativo(sessaoDe(req), corpo(esquemaImportarDemonstrativo, b));
  }

  // ── Retorno e glosa ──────────────────────────────────────────────────────────────────────────────────

  @Get('glosas')
  @Permissao('faturamento.glosa.ler')
  @Auditar(E.faturamentoGlosasLidas.codigo)
  async glosas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<GradeGlosa> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    const comp = lerCompetencia(q['competencia'] ?? hoje.slice(0, 7));
    if (!comp) throw new ErroProblema('entrada-invalida', 400, 'Competência inválida', 'Use AAAA-MM.');
    const estado = (['todas', 'com-glosa', 'em-recurso', 'nao-conciliadas'] as const).find(
      (e) => e === q['estado'],
    );
    req.sghAlvo = { tabelaAlvo: 'conta_hospitalar_item', idAlvo: `glosas ${comp.ano}-${comp.mes}` };
    return this.porta.grade(ctx(s), {
      convenios: this.servico.convenios(s, inteiroOuNulo(q['convenio'])),
      convenio: inteiroOuNulo(q['convenio']),
      ano: comp.ano,
      mes: comp.mes,
      estado: estado ?? 'com-glosa',
      pagina: pagina(q['pagina']),
      porPagina: 500,
    });
  }

  @Get('glosas/contas/:conta')
  @Permissao('faturamento.glosa.ler')
  @Auditar(E.faturamentoGlosasLidas.codigo)
  async itensGlosa(
    @Param('conta') conta: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ItemGlosaLido[]> {
    const s = sessaoDe(req);
    const id = idDaRota(conta);
    await this.servico.exigirEscopoConta(s, id);
    req.sghAlvo = { tabelaAlvo: 'conta_hospitalar_item', idAlvo: `conta ${id}` };
    return this.porta.itensDaConta(
      ctx(s),
      id,
      await this.servico.parametroTexto(s, 'faturamento.recursoPrazoPorOperadora'),
    );
  }

  /** A evidência do prontuário anexada à decisão de recorrer: leitura auditada. */
  @Get('glosas/itens/:id/evidencia')
  @Permissao('faturamento.glosa.decidir')
  @Auditar(E.faturamentoEvidenciaLida.codigo)
  async evidencia(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<EvidenciaGlosaLida> {
    const s = sessaoDe(req);
    const item = idDaRota(id);
    await this.servico.exigirEscopoItem(s, item);
    req.sghAlvo = { tabelaAlvo: 'glosa_item', idAlvo: String(item) };
    const ev = await this.porta.evidenciaDoItem(ctx(s), item);
    if (!ev)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Sem evidência',
        'A decisão deste item não tem evidência do prontuário registrada.',
        { codigo: 'sem-evidencia' },
      );
    return ev;
  }

  @Post('glosas/baixa')
  @HttpCode(200)
  @Permissao('faturamento.glosa.baixar')
  @AuditadoNoHandler('faturamento.registrarGlosa pelo executor (trilha na mesma transação)')
  baixar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTiss> {
    return this.servico.registrarGlosa(sessaoDe(req), corpo(esquemaRegistrarGlosa, b));
  }

  @Post('glosas/recurso')
  @HttpCode(200)
  @Permissao('faturamento.glosa.recorrer')
  @AuditadoNoHandler('faturamento.registrarRecurso pelo executor (trilha na mesma transação)')
  recorrer(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTiss> {
    return this.servico.registrarRecurso(sessaoDe(req), corpo(esquemaRegistrarRecurso, b));
  }

  @Post('glosas/desfecho')
  @HttpCode(200)
  @Permissao('faturamento.glosa.registrarDesfecho')
  @AuditadoNoHandler('faturamento.registrarRetornoRecurso pelo executor (trilha na mesma transação)')
  desfecho(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTiss> {
    return this.servico.registrarRetorno(sessaoDe(req), corpo(esquemaRegistrarRetornoRecurso, b));
  }

  @Post('glosas/decisao')
  @HttpCode(200)
  @Permissao('faturamento.glosa.decidir')
  @AuditadoNoHandler('decisão da glosa em glosa_item com a trilha_auditoria na mesma transação')
  decidir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTiss> {
    return this.servico.decidirGlosa(sessaoDe(req), corpo(esquemaDecidirGlosa, b));
  }

  // ── Webservices por operadora ────────────────────────────────────────────────────────────────────────

  @Get('configuracao')
  @Permissao('integracao.tiss.ler')
  configuracao(@Req() req: RequisicaoAutorizada): Promise<ConfiguracaoTissLida> {
    return this.porta.configuracao(ctx(sessaoDe(req)));
  }

  @Get('gravacao-integracao')
  @Permissao('integracao.tiss.ler')
  gravacaoIntegracao(@Req() req: RequisicaoAutorizada): Promise<GravacaoTiss> {
    return this.apoios.gravacao(sessaoDe(req));
  }

  @Post('endpoints')
  @HttpCode(200)
  @Permissao('integracao.tiss.editar')
  @AuditadoNoHandler(
    'canal de envio em endpoint_tiss_fonte_pagadora com a trilha_auditoria na mesma transação',
  )
  editarEndpoint(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTiss> {
    return this.servico.editarEndpoint(sessaoDe(req), corpo(esquemaEditarEndpointTiss, b));
  }

  // ── Painel de glosas e ciclo de receita ──────────────────────────────────────────────────────────────

  private async periodo(s: SessaoCadastro, q: Record<string, string>): Promise<{ de: string; ate: string }> {
    const hoje = await this.porta.hoje(ctx(s));
    const ano = Number(hoje.slice(0, 4));
    const de = mesOu(q['de'], `${ano}-01`);
    const ate = mesOu(q['ate'], hoje.slice(0, 7));
    if (de > ate)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O início vem depois do fim.');
    return { de, ate };
  }

  @Get('painel')
  @Permissao('relatorio.glosa.ler')
  async painel(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<PainelGlosa> {
    const s = sessaoDe(req);
    const p = await this.periodo(s, q);
    return this.servico.painel(s, p.de, p.ate);
  }

  @Get('painel/exportacao')
  @Permissao('relatorio.glosa.exportar')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Auditar(E.faturamentoGlosasLidas.codigo)
  async exportar(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<string> {
    const s = sessaoDe(req);
    const p = await this.periodo(s, q);
    req.sghAlvo = { tabelaAlvo: 'conta_hospitalar_item', idAlvo: `painel ${p.de}:${p.ate}` };
    const r = await this.servico.painel(s, p.de, p.ate);
    const n = (v: number) => v.toFixed(2).replace('.', ',');
    const linhas = [
      `Régua;competência (${p.de} a ${p.ate})`,
      'Convênio;Conciliado;Glosa;Contestado;Recuperado;Êxito',
      ...r.porConvenio.map(
        (c) =>
          `${c.nome.replace(/;/g, ',')};${n(c.conciliado)};${n(c.glosa)};${n(c.contestado)};${n(c.recuperado)};${c.exitoRotulo}`,
      ),
    ];
    return linhas.join('\n');
  }

  // ── M42: acompanhamento da competência (onda 4) ─────────────────────────────────────────────────────────

  @Get('painel/competencia')
  @Permissao('relatorio.glosa.ler')
  painelCompetencia(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AcompanhamentoCompetencia> {
    return this.acompanhamento.painel(sessaoDe(req), q);
  }

  @Get('painel/competencia/exportacao')
  @Permissao('relatorio.glosa.exportar')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Auditar(E.faturamentoGlosasLidas.codigo)
  async exportarCompetencia(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<string> {
    const r = await this.acompanhamento.exportar(sessaoDe(req), q);
    req.sghAlvo = { tabelaAlvo: 'conta_hospitalar', idAlvo: `competencia ${r.competencia}` };
    return r.csv;
  }

  @Post('painel/competencia/conferencia')
  @HttpCode(200)
  @Permissao('relatorio.glosa.ler')
  @AuditadoNoHandler('Não muda estado: compara o retrato informado com a leitura de agora (nada grava)')
  conferirCompetencia(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ConferenciaCompetencia> {
    return this.acompanhamento.conferir(sessaoDe(req), b);
  }
}
