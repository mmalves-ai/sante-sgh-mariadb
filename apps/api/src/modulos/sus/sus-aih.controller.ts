// Faturamento SUS próprio, etapa 4 (M51; ficha, seções 5, 7, 8 e 12) — `Faturamento > Faturamento SUS > AIH (internação,
// SIH)`, desligada por estabelecimento até haver contrato SUS (DP-35):
//   GET  /api/sus/aih/painel                       a chave, os parâmetros prontos, as faixas e os leitos de UTI habilitados
//   GET  /api/sus/aih?situacao&numero&prontuario   a página das AIHs (sem documento; auditada)
//   GET  /api/sus/aih/internacao/:registro         a internação para o laudo (o CNS só como "válido"; auditada)
//   POST /api/sus/aih                              faturamento.registrarAih (laudo, autorizar, negar, fechar, reabrir,
//                                                  cancelar)
//   GET  /api/sus/aih/:id/espelho                  o espelho (linhas, valores da SIGTAP, críticas, retorno; auditada)
//   GET  /api/sus/aih/faixas                       as faixas numéricas e o próximo número
//   POST /api/sus/aih/faixas                       faturamento.registrarFaixaAih (registrar, cancelar; supervisor)
//   POST /api/sus/aih/arquivo                      faturamento.gerarSisaih (SISAIH01 da competência, com hash)
//   GET  /api/sus/aih/arquivos/:id/conteudo        baixar o SISAIH01 (auditado; conferido pelo hash)
// Retorno do gestor (`> AIH` e `> BPA`):
//   GET  /api/sus/retorno?instrumento&competencia… a página do retorno (situação, motivo, valores e glosa)
//   POST /api/sus/retorno                          faturamento.importarRetornoSus (o CSV do espelho ou do relatório)
//   POST /api/sus/retorno/tratamento               a decisão: reapresentar ou aceitar a glosa (com justificativa)
// A permissão é conferida aqui (catálogo do M06) e de novo no serviço (liberação, escopo, máquina de estados e versão).
// A sessão e o serviço são os do controlador das competências (a crítica da AIH roda pela tela das competências).
import {
  Body,
  Controller,
  Get,
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
  type AihLida,
  type ArquivoSusGerado,
  type EspelhoAih,
  esquemaFiltroAihs,
  esquemaFiltroRetornosSus,
  esquemaGerarSisaih,
  esquemaImportarRetornoSus,
  esquemaRegistrarAih,
  esquemaRegistrarFaixaAih,
  esquemaTratarRetornoSus,
  EVENTOS_AUDITAVEIS,
  type FaixaAihLida,
  type InternacaoParaAih,
  type PaginaAihs,
  type PaginaRetornosSus,
  type ResultadoRetornoSus,
  type RetornoSusLido,
} from '@sgh/contratos';
import type { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { PORTA_SUS, type PortaSus } from './porta.js';
import type { ArmazemArquivoSus } from './servico.js';
import { ARMAZEM_ARQUIVO_SUS, SusController } from './sus.controller.js';

interface Resposta {
  header(n: string, v: string): unknown;
  send(c: unknown): unknown;
}

const E = EVENTOS_AUDITAVEIS;

function validar<T>(esquema: z.ZodType<T>, v: unknown): T {
  const r = esquema.safeParse(v);
  if (!r.success)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Dados inválidos',
      r.error.issues[0]?.message ?? 'Confira os campos.',
      { campos: [...new Set(r.error.issues.map((i) => i.path.map(String).join('.')))] },
    );
  return r.data;
}

@Controller('sus')
export class SusAihController {
  private readonly base: SusController;

  constructor(
    @Inject(PORTA_SUS) porta: PortaSus,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(ARMAZEM_ARQUIVO_SUS) armazem: ArmazemArquivoSus | null = null,
  ) {
    this.base = new SusController(porta, trilha, configuracao, cache, armazem);
  }

  private get aih() {
    return this.base.aih;
  }

  @Get('aih/painel')
  @Permissao('faturamento.sus.ler')
  async painel(
    @Req() req: RequisicaoAutorizada,
  ): Promise<Awaited<ReturnType<SusController['aih']['painel']>>> {
    return this.aih.painel(await this.base.sessao(req));
  }

  @Get('aih/faixas')
  @Permissao('faturamento.sus.ler')
  async faixas(@Req() req: RequisicaoAutorizada): Promise<FaixaAihLida[]> {
    return this.aih.faixas(await this.base.sessao(req));
  }

  @Post('aih/faixas')
  @HttpCode(200)
  @Permissao('faturamento.susAih.registrarFaixa')
  @AuditadoNoHandler(
    'faturamento.registrarFaixaAih: SGH_FAT_SUS_FAIXA_AIH com a SGH_TRILHA na mesma transação',
  )
  async registrarFaixa(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<FaixaAihLida> {
    return this.aih.registrarFaixa(await this.base.sessao(req), validar(esquemaRegistrarFaixaAih, corpo));
  }

  @Get('aih/internacao/:registro')
  @Permissao('faturamento.sus.ler')
  @Auditar(E.faturamentoSusLido.codigo)
  async internacao(
    @Param('registro') registro: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<InternacaoParaAih> {
    const r = idDaRota(registro);
    req.sghAlvo = { tabelaAlvo: 'RICADINT', idAlvo: String(r) };
    return this.aih.internacao(await this.base.sessao(req), r);
  }

  @Get('aih')
  @Permissao('faturamento.sus.ler')
  @Auditar(E.faturamentoSusLido.codigo)
  async listar(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<PaginaAihs> {
    const f = validar(esquemaFiltroAihs, q);
    req.sghAlvo = { tabelaAlvo: 'SGH_FAT_SUS_AIH', idAlvo: f.situacao ?? 'todas' };
    return this.aih.listar(await this.base.sessao(req), f);
  }

  @Post('aih')
  @HttpCode(200)
  @Permissao('faturamento.susAih.registrar')
  @AuditadoNoHandler(
    'faturamento.registrarAih: SGH_FAT_SUS_AIH e SGH_FAT_SUS_AIH_ITEM com a SGH_TRILHA na mesma transação',
  )
  async registrar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<AihLida> {
    return this.aih.registrar(await this.base.sessao(req), validar(esquemaRegistrarAih, corpo));
  }

  @Get('aih/:id/espelho')
  @Permissao('faturamento.sus.ler')
  @Auditar(E.faturamentoSusLido.codigo)
  async espelho(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<EspelhoAih> {
    const n = idDaRota(id);
    req.sghAlvo = { tabelaAlvo: 'SGH_FAT_SUS_AIH', idAlvo: String(n) };
    return this.aih.espelho(await this.base.sessao(req), n);
  }

  @Post('aih/arquivo')
  @HttpCode(201)
  @Permissao('faturamento.susAih.registrar')
  @AuditadoNoHandler(
    'faturamento.gerarSisaih: SGH_FAT_SUS_ARQUIVO e as AIHs apresentadas com a SGH_TRILHA (hash e contagens)',
  )
  async gerarSisaih(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ArquivoSusGerado> {
    return this.aih.gerarSisaih(await this.base.sessao(req), validar(esquemaGerarSisaih, corpo));
  }

  @Get('aih/arquivos/:id/conteudo')
  @Permissao('faturamento.susAih.registrar')
  @AuditadoNoHandler(
    'faturamento.arquivoSus.baixado: a SGH_TRILHA com o hash, gravada antes do envio do conteúdo',
  )
  async baixar(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: false }) res: Resposta,
  ): Promise<void> {
    const r = await this.base.servico.baixar(await this.base.sessao(req), idDaRota(id), 'aih');
    res.header('content-type', 'text/plain; charset=us-ascii');
    res.header('content-disposition', `attachment; filename="${r.nome.replace(/[^A-Za-z0-9_.-]/g, '_')}"`);
    res.header('x-sgh-sha256', r.arquivo.hash);
    res.header('cache-control', 'no-store');
    res.send(Buffer.from(r.conteudo));
  }

  // ── Retorno do gestor ────────────────────────────────────────────────────────────────────────────────

  @Get('retorno')
  @Permissao('faturamento.sus.ler')
  @Auditar(E.faturamentoSusLido.codigo)
  async retornos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaRetornosSus> {
    const f = validar(esquemaFiltroRetornosSus, q);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_FAT_SUS_RETORNO',
      idAlvo: `${f.instrumento ?? ''} ${f.competencia ?? ''}`.trim(),
    };
    return this.aih.listarRetornos(await this.base.sessao(req), f);
  }

  @Post('retorno')
  @HttpCode(200)
  @Permissao('faturamento.susRetorno.importar')
  @AuditadoNoHandler(
    'faturamento.importarRetornoSus: SGH_FAT_SUS_RETORNO e a situação da AIH com a SGH_TRILHA (contagens e hash)',
  )
  async importarRetorno(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRetornoSus> {
    return this.aih.importarRetorno(await this.base.sessao(req), validar(esquemaImportarRetornoSus, corpo));
  }

  @Post('retorno/tratamento')
  @HttpCode(200)
  @Permissao('faturamento.susRetorno.importar')
  @AuditadoNoHandler(
    'faturamento.tratarRetornoSus: SGH_FAT_SUS_RETORNO (e a AIH reapresentada) com a SGH_TRILHA',
  )
  async tratarRetorno(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<RetornoSusLido> {
    return this.aih.tratarRetorno(await this.base.sessao(req), validar(esquemaTratarRetornoSus, corpo));
  }
}
