// Assinatura ICP-Brasil dos documentos emitidos, etapa 2 (M49; ficha, seções 4, 5 e 7; regras 4, 5, 7, 8 e 10). Rotas:
//   GET  /api/documento/assinatura/documentos                       (fila do autor: a assinar, pendentes, assinados, avisos)
//   POST /api/documento/assinatura/documentos/:id/previa            (prévia exata: PDF/A com o selo; devolve o hash)
//   GET  /api/documento/assinatura/documentos/:id/previa.pdf        (o PDF da prévia, o mesmo do hash)
//   POST /api/documento/assinatura/lote/preparar                    (prévia de cada documento do lote)
//   POST /api/documento/assinatura/documentos                       (pedido: um ou o lote; provedor ou agente local)
//   POST /api/documento/assinatura/assinaturas/:id/reprocessar      (o autor reprocessa a sua pendente ou em falha)
//   GET  /api/documento/assinatura/assinaturas/:id/pdf              (o PDF assinado, validável fora; validação "exportar")
//   POST /api/documento/assinatura/avisos/lidos                     (o autor marca os seus avisos)
//   GET  /api/documento/assinatura/estabelecimento                  (direção técnica: pendências e avisos)
//   POST /api/documento/assinatura/estabelecimento/:id/reprocessar  (direção técnica reprocessa)
//   POST /api/documento/assinatura/estabelecimento/avisos/lidos     (direção técnica marca os avisos)
//   POST /api/documento/sncr                                        (numeração SNCR: chave `receita.sncr`, desligada)
//   PUT  /api/documento/simulador-psc/fontes                        (SÓ dev/ci: fontes do simulador fora do ar)
// E o agendador do reprocessamento automático (regra 5): ligado fora de dev/ci; em dev/ci só com
// ASSINATURA_REPROCESSAR=ligado (a cópia é compartilhada). Toda escrita só em SGH_, com a SGH_TRILHA na mesma transação.
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import {
  esquemaMarcarAvisosAssinatura,
  esquemaPedirAssinaturaIcp,
  esquemaPrepararLoteIcp,
  esquemaSolicitarSncr,
  type LoteIcpPreparado,
  type PedidoAssinaturaIcpResposta,
  type PendenciasIcpResposta,
  type PreviaIcp,
  type SituacaoAssinaturaDocumento,
  type SolicitacaoSncrResumo,
} from '@sgh/contratos';
import { lerRedePadrao } from '@sgh/legado';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { LiberacaoPep } from '../pep/liberacao-pep.js';
import {
  type ArmazemPdfIcp,
  type ConfigDocumentosIcp,
  type FonteConteudoIcp,
  ServicoAssinaturaDocumentos,
  USUARIO_REPROCESSAMENTO,
} from './aplicacao/documentos.js';
import type { ServicoAssinaturaIcp } from './aplicacao/servico.js';
import { PORTA_ASSINATURA_ICP, type PortaAssinaturaIcp } from './porta.js';
import {
  ARMAZEM_PDF_ICP,
  CONFIG_DOCUMENTOS_ICP,
  FONTE_CONTEUDO_ICP,
  SERVICO_ASSINATURA_ICP,
} from './simbolos.js';

type Resposta = { header(n: string, v: string): unknown };

const esquemaPrevia = z.object({ certificado: z.number().int().positive() }).strict();
const esquemaFontes = z
  .object({ psc: z.boolean().optional(), act: z.boolean().optional(), lcr: z.boolean().optional() })
  .strict();

/** O agendador do reprocessamento: fora de dev/ci, sempre (salvo "desligado"); em dev/ci só com "ligado". */
export function reprocessamentoLigado(env: NodeJS.ProcessEnv): boolean {
  const pedido = (env['ASSINATURA_REPROCESSAR'] ?? '').trim();
  if (pedido === 'desligado') return false;
  const ambiente = (env['AMBIENTE'] ?? '').trim();
  return ambiente === 'dev' || ambiente === 'ci' || ambiente === '' ? pedido === 'ligado' : true;
}

/**
 * A rede da sessão do agendador: a mesma da configuração dos estabelecimentos (REDE_PADRAO, lida pelo núcleo), sem
 * valor literal de reserva. Sem rede configurada (ou com formato inválido): null, e o agendador não roda (o motivo
 * vai ao log), para o PDF assinado nunca cair num prefixo do armazenamento que não é o da rede.
 */
export function redeDoAgendador(env: NodeJS.ProcessEnv): string | null {
  try {
    return lerRedePadrao(env);
  } catch {
    return null;
  }
}

@Controller('documento')
export class AssinaturaDocumentosController implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly servico: ServicoAssinaturaDocumentos;
  private temporizador: NodeJS.Timeout | undefined;
  private rodando = false;
  private readonly log = new Logger('ReprocessamentoAssinaturas');

  constructor(
    @Inject(SERVICO_ASSINATURA_ICP) private readonly icp: ServicoAssinaturaIcp,
    @Inject(PORTA_ASSINATURA_ICP) porta: PortaAssinaturaIcp,
    @Inject(CONFIG_DOCUMENTOS_ICP) cfg: ConfigDocumentosIcp,
    @Optional() @Inject(FONTE_CONTEUDO_ICP) fonte: FonteConteudoIcp | null = null,
    @Optional() @Inject(ARMAZEM_PDF_ICP) armazem: ArmazemPdfIcp | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    const lib = new LiberacaoPep(configuracao, cache);
    this.servico = new ServicoAssinaturaDocumentos(icp, porta, fonte, armazem, lib, cfg);
  }

  // ── Agendador (regra 5) ───────────────────────────────────────────────────────────────────────────────────

  onApplicationBootstrap(): void {
    if (!reprocessamentoLigado(process.env)) return;
    if (!redeDoAgendador(process.env)) {
      this.log.warn('Reprocessamento das assinaturas não iniciado: REDE_PADRAO ausente ou inválida.');
      return;
    }
    const ms = Math.min(
      Math.max(Number(process.env['ASSINATURA_REPROCESSAR_MS'] ?? '') || 60_000, 10_000),
      3_600_000,
    );
    this.temporizador = setInterval(() => void this.rodada(), ms);
    this.temporizador.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /** Uma rodada em cada estabelecimento da lista (ESTABELECIMENTOS), com a sessão do agendador. */
  async rodada(env: NodeJS.ProcessEnv = process.env): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    let vistas = 0;
    try {
      const rede = redeDoAgendador(env);
      if (!rede) return 0;
      for (const hospital of (env['ESTABELECIMENTOS'] ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)) {
        const r = await this.servico
          .cicloReprocessamento(sessaoDoAgendador(rede, hospital))
          .catch(() => ({ vistas: 0 }));
        vistas += r.vistas;
      }
    } finally {
      this.rodando = false;
    }
    return vistas;
  }

  // ── Fila do autor ─────────────────────────────────────────────────────────────────────────────────────────

  @Get('assinatura/documentos')
  @Permissao('documento.assinatura.assinar')
  @Auditar('documento.pendencias.lidas')
  async fila(@Req() req: RequisicaoAutorizada): Promise<PendenciasIcpResposta> {
    const r = await this.servico.fila(sessaoDe(req));
    req.sghAlvo = { tabelaAlvo: 'SGH_PEP_DOCUMENTO', chaveNaturalAlvo: `pendencias-icp;n:${r.itens.length}` };
    return r;
  }

  @Post('assinatura/documentos/:id/previa')
  @HttpCode(200)
  @Permissao('documento.assinatura.assinar')
  @AuditadoNoHandler('prévia em SGH_DOC_PREVIA_ASSIN (PDF/A no S3) com a SGH_TRILHA na mesma transação')
  previa(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaIcp> {
    return this.servico.previa(sessaoDe(req), idDaRota(id), corpo(esquemaPrevia, b).certificado);
  }

  @Get('assinatura/documentos/:id/previa.pdf')
  @Permissao('documento.assinatura.assinar')
  @Auditar('pep.documento.lido')
  @Header('content-type', 'application/pdf')
  async pdfPrevia(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: Resposta,
  ): Promise<Buffer> {
    const doc = idDaRota(id);
    const r = await this.servico.pdfDaPrevia(sessaoDe(req), doc);
    req.sghAlvo = {
      paciente: r.paciente,
      tabelaAlvo: 'SGH_DOC_PREVIA_ASSIN',
      idAlvo: String(doc),
      chaveNaturalAlvo: 'previa-icp',
    };
    res.header('content-disposition', `inline; filename="previa-${doc}.pdf"`);
    res.header('cache-control', 'no-store');
    return Buffer.from(r.pdf);
  }

  @Post('assinatura/lote/preparar')
  @HttpCode(200)
  @Permissao('documento.assinatura.assinar')
  @AuditadoNoHandler('uma prévia por documento em SGH_DOC_PREVIA_ASSIN, cada uma com a sua SGH_TRILHA')
  lote(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<LoteIcpPreparado> {
    return this.servico.prepararLote(sessaoDe(req), corpo(esquemaPrepararLoteIcp, b));
  }

  @Post('assinatura/documentos')
  @HttpCode(200)
  @Permissao('documento.assinatura.assinar')
  @AuditadoNoHandler(
    'o pedido em SGH_DOC_PEDIDO_ASSINATURA com a SGH_TRILHA; a assinatura, a validação e o evento na volta',
  )
  pedir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PedidoAssinaturaIcpResposta> {
    return this.servico.pedir(sessaoDe(req), corpo(esquemaPedirAssinaturaIcp, b));
  }

  @Post('assinatura/assinaturas/:id/reprocessar')
  @HttpCode(200)
  @Permissao('documento.assinatura.assinar')
  @AuditadoNoHandler(
    'SGH_DOC_ASSINATURA, SGH_DOC_VALIDACAO, o evento e os avisos com a SGH_TRILHA na mesma transação',
  )
  reprocessar(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SituacaoAssinaturaDocumento> {
    return this.servico.reprocessar(sessaoDe(req), idDaRota(id), true);
  }

  @Get('assinatura/assinaturas/:id/pdf')
  @Permissao('documento.assinatura.assinar')
  @AuditadoNoHandler('validação "ao exportar" em SGH_DOC_VALIDACAO com a SGH_TRILHA na mesma transação')
  @Header('content-type', 'application/pdf')
  async pdfAssinado(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: Resposta,
  ): Promise<Buffer> {
    const r = await this.servico.pdfAssinado(sessaoDe(req), idDaRota(id));
    res.header('content-disposition', `attachment; filename="documento-${r.documento}-assinado.pdf"`);
    res.header('cache-control', 'no-store');
    return Buffer.from(r.pdf);
  }

  @Post('assinatura/avisos/lidos')
  @HttpCode(200)
  @Permissao('documento.assinatura.assinar')
  @AuditadoNoHandler('LIDO_EM em SGH_DOC_ASSINATURA_AVISO com a SGH_TRILHA na mesma transação')
  avisosLidos(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<{ lidos: number }> {
    return this.servico.marcarAvisos(sessaoDe(req), corpo(esquemaMarcarAvisosAssinatura, b).avisos);
  }

  // ── Direção técnica (regra 5: o diretor técnico é avisado) ────────────────────────────────────────────────

  @Get('assinatura/estabelecimento')
  @Permissao('documento.assinatura.reprocessar')
  async estabelecimento(
    @Req() req: RequisicaoAutorizada,
  ): Promise<NonNullable<PendenciasIcpResposta['estabelecimento']>> {
    const s = sessaoDe(req);
    const r = await this.servico.fila(s);
    return r.estabelecimento ?? { pendentes: 0, falhas: 0, avisos: [] };
  }

  @Post('assinatura/estabelecimento/:id/reprocessar')
  @HttpCode(200)
  @Permissao('documento.assinatura.reprocessar')
  @AuditadoNoHandler(
    'SGH_DOC_ASSINATURA, SGH_DOC_VALIDACAO, o evento e os avisos com a SGH_TRILHA na mesma transação',
  )
  reprocessarDoEstabelecimento(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SituacaoAssinaturaDocumento> {
    return this.servico.reprocessar(sessaoDe(req), idDaRota(id), true);
  }

  @Post('assinatura/estabelecimento/avisos/lidos')
  @HttpCode(200)
  @Permissao('documento.assinatura.reprocessar')
  @AuditadoNoHandler('LIDO_EM em SGH_DOC_ASSINATURA_AVISO com a SGH_TRILHA na mesma transação')
  avisosDoEstabelecimentoLidos(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ lidos: number }> {
    return this.servico.marcarAvisos(sessaoDe(req), corpo(esquemaMarcarAvisosAssinatura, b).avisos);
  }

  // ── SNCR (regra 10; desligado pela chave `receita.sncr`) ──────────────────────────────────────────────────

  @Post('sncr')
  @HttpCode(200)
  @Permissao('documento.assinatura.assinar')
  @AuditadoNoHandler(
    'SGH_DOC_SNCR_SOLICITACAO (e o campo SNCR da receita) com a SGH_TRILHA na mesma transação',
  )
  sncr(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<SolicitacaoSncrResumo> {
    return this.servico.solicitarSncr(sessaoDe(req), corpo(esquemaSolicitarSncr, b).documento);
  }

  // ── Simulador (só dev/ci): fontes fora do ar para o teste do reprocessamento ──────────────────────────────

  @Put('simulador-psc/fontes')
  @Permissao('documento.provedor.editar')
  @AuditadoNoHandler('nada é gravado: só o estado do simulador da sessão de teste (dev/ci)')
  fontes(@Body() b: unknown): { psc: boolean; act: boolean; lcr: boolean } {
    const sim = this.icp.cfg.simulador;
    if (this.icp.modo !== 'simulador' || !sim)
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    const e = corpo(esquemaFontes, b);
    if (e.psc !== undefined) sim.foraDoAr.psc = e.psc;
    if (e.act !== undefined) sim.foraDoAr.act = e.act;
    if (e.lcr !== undefined) sim.foraDoAr.lcr = e.lcr;
    return { ...sim.foraDoAr };
  }
}

/** A sessão do agendador (nenhuma pessoa): o login da trilha é o do reprocessamento e nada mais pode. */
export function sessaoDoAgendador(rede: string, hospital: string): SessaoCadastro {
  return {
    req: { headers: { 'x-correlacao': 'reprocessamento-icp' }, ip: '127.0.0.1' } as never,
    hospital,
    rede,
    login: USUARIO_REPROCESSAMENTO,
    porta: { rede, hospital } as never,
    pode: () => false,
  };
}
