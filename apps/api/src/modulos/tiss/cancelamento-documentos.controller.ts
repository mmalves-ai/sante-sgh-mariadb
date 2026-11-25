// Cancelamento de guia enviada e envio de documentos anexos pelo TISS 04.03.00 (06-FAT linha 28). Rotas (porta
// própria; sem banco do cliente, 503):
//   GET  /api/tiss/cancelamento-documentos/guias/:guia                 pedidos de cancelamento e envios da guia
//   GET  /api/tiss/cancelamento-documentos/contas/:conta               a mesma visão para cada guia da conta
//   POST /api/tiss/cancelamento-documentos/cancelamentos               { guias, motivo } pedido em rascunho
//   GET  /api/tiss/cancelamento-documentos/cancelamentos/:id/mensagem  prévia da CANCELA_GUIA
//   POST /api/tiss/cancelamento-documentos/cancelamentos/:id/envio     { versao } envia e devolve o XML
//   POST /api/tiss/cancelamento-documentos/cancelamentos/:id/descarte  { versao } descarta o rascunho
//   POST /api/tiss/cancelamento-documentos/cancelamentos/:id/recibo    { versao, protocolo?, erro?, guias }
//   POST /api/tiss/cancelamento-documentos/envios                      { guia, documentos } (corpo com anexos)
//   GET  /api/tiss/cancelamento-documentos/envios/:id/mensagens        prévia das ENVIO_DOCUMENTO
//   POST /api/tiss/cancelamento-documentos/envios/:id/envio            { versao } envia e devolve os XML
//   POST /api/tiss/cancelamento-documentos/envios/:id/cancelamento     { versao } cancela o rascunho
//   POST /api/tiss/cancelamento-documentos/envios/:id/recibo           { versao, protocolo?, documentos }
// Leitura pela permissão de ler guias; gravação pela de enviar à operadora.
import { LIMITE_CORPO_ANEXOS_PORTAL, TIPO_CORPO_ANEXOS_PORTAL } from '@sgh/contratos';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  type OnModuleInit,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_CANCELAMENTO_DOCUMENTOS_TISS,
  type PortaCancelamentoDocumentosTissPropria,
} from './cancelamento-documentos-propria.js';

export const PERMISSOES_CANCELAMENTO_DOCUMENTOS = {
  ler: 'faturamento.guia.ler',
  enviar: 'faturamento.lote.enviar',
} as const;

const AUDITORIA = 'executor: trilha na mesma transação do cancelamento ou do envio de documentos TISS';

/** O pedaço do Fastify usado para o tipo do corpo com anexos (o JSON padrão, com teto próprio). */
interface InstanciaComParser {
  hasContentTypeParser(tipo: string): boolean;
  addContentTypeParser(tipo: string, opcoes: { parseAs: 'string'; bodyLimit: number }, parser: unknown): void;
  getDefaultJsonParser(proto: 'error', construtor: 'error'): unknown;
}

@Controller('tiss/cancelamento-documentos')
export class CancelamentoDocumentosTissController implements OnModuleInit {
  constructor(
    @Optional()
    @Inject(PORTA_CANCELAMENTO_DOCUMENTOS_TISS)
    private readonly porta: PortaCancelamentoDocumentosTissPropria | null = null,
    @Optional() @Inject(HttpAdapterHost) private readonly adaptador: HttpAdapterHost | null = null,
  ) {}

  /** Os documentos (em base64) não cabem no teto padrão do JSON: vêm com o tipo do corpo com anexos (registro único). */
  onModuleInit(): void {
    const f = this.adaptador?.httpAdapter?.getInstance?.() as InstanciaComParser | undefined;
    if (!f?.hasContentTypeParser || f.hasContentTypeParser(TIPO_CORPO_ANEXOS_PORTAL)) return;
    f.addContentTypeParser(
      TIPO_CORPO_ANEXOS_PORTAL,
      { parseAs: 'string', bodyLimit: LIMITE_CORPO_ANEXOS_PORTAL },
      f.getDefaultJsonParser('error', 'error'),
    );
  }

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaCancelamentoDocumentosTissPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('guias/:guia')
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.ler)
  daGuia(@Req() req: RequisicaoAutorizada, @Param('guia', ParseIntPipe) guia: number) {
    return this.com(req, (p, c) => p.daGuia(c, guia));
  }

  @Get('contas/:conta')
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.ler)
  daConta(@Req() req: RequisicaoAutorizada, @Param('conta', ParseIntPipe) conta: number) {
    return this.com(req, (p, c) => p.daConta(c, conta));
  }

  @Post('cancelamentos')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.enviar)
  solicitar(@Req() req: RequisicaoAutorizada, @Body() b: unknown) {
    return this.com(req, (p, c) => p.solicitarCancelamento(c, b));
  }

  @Get('cancelamentos/:id/mensagem')
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.ler)
  mensagemCancelamento(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.mensagemCancelamento(c, id));
  }

  @Post('cancelamentos/:id/envio')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.enviar)
  enviarCancelamento(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: unknown,
  ) {
    return this.com(req, (p, c) => p.enviarCancelamento(c, id, b));
  }

  @Post('cancelamentos/:id/descarte')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.enviar)
  descartar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) {
    return this.com(req, (p, c) => p.descartarCancelamento(c, id, b));
  }

  @Post('cancelamentos/:id/recibo')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.enviar)
  reciboCancelamento(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: unknown,
  ) {
    return this.com(req, (p, c) => p.reciboCancelamento(c, id, b));
  }

  @Post('envios')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.enviar)
  registrarEnvio(@Req() req: RequisicaoAutorizada, @Body() b: unknown) {
    return this.com(req, (p, c) => p.registrarEnvio(c, b));
  }

  @Get('envios/:id/mensagens')
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.ler)
  mensagensEnvio(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.mensagensEnvio(c, id));
  }

  @Post('envios/:id/envio')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.enviar)
  enviarDocumentos(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: unknown,
  ) {
    return this.com(req, (p, c) => p.enviarDocumentos(c, id, b));
  }

  @Post('envios/:id/cancelamento')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.enviar)
  cancelarEnvio(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() b: unknown) {
    return this.com(req, (p, c) => p.cancelarEnvio(c, id, b));
  }

  @Post('envios/:id/recibo')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_CANCELAMENTO_DOCUMENTOS.enviar)
  reciboDocumentos(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() b: unknown,
  ) {
    return this.com(req, (p, c) => p.reciboDocumentos(c, id, b));
  }
}
