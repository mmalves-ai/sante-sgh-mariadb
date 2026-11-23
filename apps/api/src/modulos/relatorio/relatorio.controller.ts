// Catálogo de relatórios parametrizados, triagem, pedidos e envio agendado (M34; ficha, seção 7):
//   GET  /api/relatorios/catalogo                         os relatórios (liberação, motivo e o que a sessão pode)
//   POST /api/relatorios/catalogo/:codigo/executar        emitir na grade (permissão do relatório; máscara; auditado)
//   POST /api/relatorios/catalogo/:codigo/exportar        CSV, XLSX ou PDF (com dado de pessoa: justificativa)
//   GET  /api/relatorios/execucoes?relatorio              as emissões e exportações (quem, quando, linhas; sem valores)
//   GET  /api/relatorios/triagem?destino&situacao&marco&termo&pagina&tamanho   a triagem e o resumo
//   POST /api/relatorios/triagem/:id                      confirmar ou mudar o destino (com o motivo)
//   GET  /api/relatorios/pedidos; POST pedidos; POST pedidos/:id/resposta (curador)
//   GET  /api/relatorios/agendamentos; POST agendamentos; POST agendamentos/:id; POST agendamentos/:id/ativo;
//        POST agendamentos/:id/enviar
//   W0-09: POST pedidos/:id (corrigir o aberto), pedidos/:id/cancelamento, pedidos/:id/exclusao; GET pedidos/:id/historico;
//        POST agendamentos/:id/exclusao; GET agendamentos/:id/historico (todas com motivo)
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
  type AgendamentoLido,
  type EventoGestaoRelatorio,
  type ExecucaoLida,
  type HistoricoEnvioOrigem,
  type PaginaTriagem,
  type PedidoLido,
  PERMISSOES_M34_CODIGOS as P,
  type RelatorioDescrito,
  type ResultadoRelatorio,
  type TriagemLida,
  lerIdBanco,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ConfiguracaoM34 } from './aplicacao/configuracao.js';
import { relatorioOu404, ServicoExecucao } from './aplicacao/executar.js';
import type { GeradorPdf } from './aplicacao/exportar.js';
import { type FilaEnvioRelatorio, ServicoGestaoRelatorios } from './aplicacao/gestao.js';
import { PORTA_RELATORIO, type PortaRelatorio } from './porta.js';

export const FILA_ENVIO_RELATORIO = Symbol('FILA_ENVIO_RELATORIO');
export const GERADOR_PDF_RELATORIO = Symbol('GERADOR_PDF_RELATORIO');

interface RespostaArquivo {
  header(nome: string, valor: string): RespostaArquivo;
}

/**
 * A base do link que sai por e-mail: sempre WEB_ENDERECO, como no envio agendado do worker. O cabeçalho Origin do
 * pedido não entra (quem o forja fora do navegador poria no e-mail institucional um link para domínio externo).
 */
export function baseDoLink(env: NodeJS.ProcessEnv = process.env): string {
  return env['WEB_ENDERECO']?.trim() || 'http://127.0.0.1:5300';
}

@Controller('relatorios')
export class CatalogoRelatoriosController {
  readonly execucao: ServicoExecucao;
  readonly gestao: ServicoGestaoRelatorios;
  constructor(
    @Inject(PORTA_RELATORIO) private readonly porta: PortaRelatorio,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Inject(CONFIGURACAO) configuracao: Configuracao,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(FILA_ENVIO_RELATORIO) fila: FilaEnvioRelatorio | null = null,
    @Optional() @Inject(GERADOR_PDF_RELATORIO) pdf: GeradorPdf | null = null,
  ) {
    const config = new ConfiguracaoM34(fonte, cache);
    this.execucao = new ServicoExecucao(porta, trilha, config, pdf, configuracao.produtoNome);
    this.gestao = new ServicoGestaoRelatorios(porta, trilha, config, this.execucao, fila);
  }

  // ── Catálogo, emissão e exportação ──────────────────────────────────────────────────────────────────

  @Get('catalogo')
  @Permissao(P.catalogoLer)
  catalogo(@Req() req: RequisicaoAutorizada): Promise<RelatorioDescrito[]> {
    return this.execucao.catalogo(sessaoDe(req));
  }

  @Post('catalogo/:codigo/executar')
  @HttpCode(200)
  @Permissao(P.catalogoLer)
  @AuditadoNoHandler('emissão em execucao_relatorio com a trilha na mesma transação')
  executar(
    @Param('codigo') codigo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoRelatorio> {
    return this.execucao.executar(sessaoDe(req), codigo, b);
  }

  @Post('catalogo/:codigo/exportar')
  @HttpCode(200)
  @Permissao(P.catalogoLer)
  @AuditadoNoHandler('exportação em execucao_relatorio (com a justificativa) e a trilha na mesma transação')
  async exportar(
    @Param('codigo') codigo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: RespostaArquivo,
  ): Promise<Buffer> {
    const a = await this.execucao.exportar(sessaoDe(req), codigo, b);
    res.header('content-type', a.tipo);
    res.header('content-disposition', `attachment; filename="${a.nome}"`);
    res.header('cache-control', 'no-store');
    return Buffer.from(a.conteudo);
  }

  @Get('execucoes')
  @Permissao(P.catalogoLer)
  async execucoes(
    @Query('relatorio') relatorio: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ExecucaoLida[]> {
    const s = sessaoDe(req);
    // O curador vê as de todos; os demais, só as próprias.
    const todas = s.pode(P.pedidoPublicar);
    if (relatorio) relatorioOu404(relatorio);
    const l = await this.porta.execucoes(s.porta, {
      ...(relatorio ? { relatorio } : {}),
      ...(todas ? {} : { usuario: s.login }),
      limite: 100,
    });
    return l.map((x) => ({ ...x, criadoEm: x.criadoEm.toISOString().slice(0, 19) }));
  }

  // ── Triagem dos relatórios de SQL livre ─────────────────────────────────────────────────────────────

  @Get('triagem')
  @Permissao(P.triagemLer)
  triagem(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaTriagem> {
    return this.gestao.triagem(sessaoDe(req), q);
  }

  @Post('triagem/:id')
  @HttpCode(200)
  @Permissao(P.triagemDecidir)
  @AuditadoNoHandler('decisão em triagem_relatorio_legado com a trilha na mesma transação')
  decidir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<TriagemLida> {
    if (lerIdBanco(id) === null)
      throw new ErroProblema('nao-encontrado', 404, 'Relatório não encontrado na triagem');
    return this.gestao.decidir(sessaoDe(req), Number(id), b);
  }

  // ── Pedidos de relatório ────────────────────────────────────────────────────────────────────────────

  @Get('pedidos')
  @Permissao(P.pedidoCriar)
  pedidos(@Req() req: RequisicaoAutorizada): Promise<PedidoLido[]> {
    return this.gestao.pedidos(sessaoDe(req));
  }

  @Post('pedidos')
  @HttpCode(201)
  @Permissao(P.pedidoCriar)
  @AuditadoNoHandler('pedido em pedido_relatorio com a trilha na mesma transação')
  criarPedido(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<{ id: string }> {
    return this.gestao.criarPedido(sessaoDe(req), b);
  }

  @Post('pedidos/:id/resposta')
  @HttpCode(200)
  @Permissao(P.pedidoPublicar)
  @AuditadoNoHandler('resposta em pedido_relatorio com a trilha na mesma transação')
  responder(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    return this.gestao.responderPedido(sessaoDe(req), id, b);
  }

  @Post('pedidos/:id')
  @HttpCode(200)
  @Permissao(P.pedidoCriar)
  @AuditadoNoHandler('pedido em pedido_relatorio e trilha de auditoria com a trilha na mesma transação')
  alterarPedido(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    return this.gestao.alterarPedido(sessaoDe(req), id, b);
  }

  @Post('pedidos/:id/cancelamento')
  @HttpCode(200)
  @Permissao(P.pedidoCriar)
  @AuditadoNoHandler('cancelamento em pedido_relatorio e trilha de auditoria com a trilha na mesma transação')
  cancelarPedido(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    return this.gestao.cancelarPedido(sessaoDe(req), id, b);
  }

  @Post('pedidos/:id/exclusao')
  @HttpCode(200)
  @Permissao(P.pedidoCriar)
  @AuditadoNoHandler(
    'exclusão em pedido_relatorio com o log em trilha de auditoria e a trilha na mesma transação',
  )
  excluirPedido(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    return this.gestao.excluirPedido(sessaoDe(req), id, b);
  }

  @Get('pedidos/:id/historico')
  @Permissao(P.pedidoCriar)
  historicoPedido(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EventoGestaoRelatorio[]> {
    return this.gestao.historicoPedido(sessaoDe(req), id);
  }

  // ── Envio agendado ──────────────────────────────────────────────────────────────────────────────────

  @Get('agendamentos')
  @Permissao(P.agendamentoLer)
  agendamentos(@Req() req: RequisicaoAutorizada): Promise<{
    agendamentos: AgendamentoLido[];
    origem: HistoricoEnvioOrigem;
    envioLigado: boolean;
    motivo: string | null;
  }> {
    return this.gestao.agendamentos(sessaoDe(req));
  }

  @Post('agendamentos')
  @HttpCode(201)
  @Permissao(P.agendamentoEditar)
  @AuditadoNoHandler('agendamento em agendamento_relatorio com a trilha na mesma transação')
  criarAgendamento(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: string; proximoEnvio: string }> {
    return this.gestao.criarAgendamento(sessaoDe(req), b);
  }

  @Post('agendamentos/:id')
  @HttpCode(200)
  @Permissao(P.agendamentoEditar)
  @AuditadoNoHandler('agendamento em agendamento_relatorio com a trilha na mesma transação')
  alterarAgendamento(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    return this.gestao.alterarAgendamento(sessaoDe(req), id, b);
  }

  @Post('agendamentos/:id/ativo')
  @HttpCode(200)
  @Permissao(P.agendamentoEditar)
  @AuditadoNoHandler('agendamento em agendamento_relatorio com a trilha na mesma transação')
  ativar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    return this.gestao.ativarAgendamento(sessaoDe(req), id, b);
  }

  @Post('agendamentos/:id/exclusao')
  @HttpCode(200)
  @Permissao(P.agendamentoEditar)
  @AuditadoNoHandler(
    'exclusão em agendamento_relatorio com o log em trilha de auditoria e a trilha na mesma transação',
  )
  excluirAgendamento(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    return this.gestao.excluirAgendamento(sessaoDe(req), id, b);
  }

  @Get('agendamentos/:id/historico')
  @Permissao(P.agendamentoLer)
  historicoAgendamento(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EventoGestaoRelatorio[]> {
    return this.gestao.historicoAgendamento(sessaoDe(req), id);
  }

  @Post('agendamentos/:id/enviar')
  @HttpCode(200)
  @Permissao(P.agendamentoEditar)
  @AuditadoNoHandler('envio em execucao_relatorio com a trilha na mesma transação; o e-mail pelo worker')
  enviar(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ situacao: 'enfileirado' | 'sem-fila'; link: string }> {
    return this.gestao.enviarAgora(sessaoDe(req), id, baseDoLink());
  }
}
