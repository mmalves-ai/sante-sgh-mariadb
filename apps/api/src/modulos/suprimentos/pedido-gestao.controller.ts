// Gestão do pedido de compra emitido (F3.6, 05-SUP linha 20): a leitura da tela e as gravações pelo executor.
//   GET  /api/suprimentos/pedidos/:ano/:doc/gestao                 itens com a agenda de entregas, contatos, motivos
//   POST /api/suprimentos/pedidos/:ano/:doc/entregas               agenda de entregas de um item
//   POST /api/suprimentos/pedidos/:ano/:doc/acompanhamentos        contato com o fornecedor (sempre uma linha nova)
//   POST /api/suprimentos/pedidos/:ano/:doc/cancelamento           cancelamento do pedido inteiro ou do item, com motivo
//   POST /api/suprimentos/motivos-cancelamento-compra              cadastro do motivo (nunca apagado: inativa)
// Quem pode: ler o pedido (consulta), criar o pedido (agenda e contatos), aprovar o pedido (cancelar e motivos).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import {
  esquemaAcompanharPedido,
  esquemaCancelarCompra,
  esquemaGravarMotivoCancelamentoCompra,
  esquemaProgramarEntregasPedido,
  type GestaoPedidoCompra,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ApoiosSuprimentos } from './apoios.js';
import { type ContextoSuprimentos, PORTA_SUPRIMENTOS, type PortaSuprimentos } from './porta.js';
import { ServicoSuprimentos } from './servico.js';

type Resultado = Awaited<ReturnType<ServicoSuprimentos['executar']>>;
/** A leitura da gestão existe só na porta própria (banco próprio); sem ela, 503. */
type ComGestao = PortaSuprimentos & {
  gestaoPedido?(c: ContextoSuprimentos, ano: number, doc: number): Promise<GestaoPedidoCompra | null>;
};

@Controller('suprimentos')
export class PedidoGestaoController {
  private readonly servico: ServicoSuprimentos;

  constructor(
    @Inject(PORTA_SUPRIMENTOS) private readonly porta: PortaSuprimentos,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonteConfiguracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoSuprimentos(
      porta,
      new ApoiosSuprimentos(porta, trilha, fonteConfiguracao, cache),
    );
  }

  @Get('pedidos/:ano/:doc/gestao')
  @Permissao('suprimentos.pedido.ler')
  async gestao(
    @Param('ano') ano: string,
    @Param('doc') doc: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<GestaoPedidoCompra> {
    const porta = this.porta as ComGestao;
    if (!porta.gestaoPedido)
      throw new ErroProblema('indisponivel', 503, 'A gestão do pedido exige o banco próprio.');
    const g = await porta.gestaoPedido(sessaoDe(req).porta, idDaRota(ano), idDaRota(doc));
    if (!g) throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado');
    return g;
  }

  private pedido(ano: string, doc: string) {
    return { ano: idDaRota(ano), doc: idDaRota(doc) };
  }

  @Post('pedidos/:ano/:doc/entregas')
  @HttpCode(200)
  @Permissao('suprimentos.pedido.criar')
  @AuditadoNoHandler('suprimentos.programarEntregasPedido pelo executor (trilha na mesma transação)')
  entregas(
    @Param('ano') ano: string,
    @Param('doc') doc: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Resultado> {
    const e = corpo(esquemaProgramarEntregasPedido, { ...(b as object), pedido: this.pedido(ano, doc) });
    return this.servico.executar(sessaoDe(req), 'suprimentos.programarEntregasPedido', e);
  }

  @Post('pedidos/:ano/:doc/acompanhamentos')
  @HttpCode(200)
  @Permissao('suprimentos.pedido.criar')
  @AuditadoNoHandler('suprimentos.acompanharPedido pelo executor (trilha na mesma transação)')
  acompanhar(
    @Param('ano') ano: string,
    @Param('doc') doc: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Resultado> {
    const e = corpo(esquemaAcompanharPedido, { ...(b as object), pedido: this.pedido(ano, doc) });
    return this.servico.executar(sessaoDe(req), 'suprimentos.acompanharPedido', e);
  }

  @Post('pedidos/:ano/:doc/cancelamento')
  @HttpCode(200)
  @Permissao('suprimentos.pedido.aprovar')
  @AuditadoNoHandler('suprimentos.cancelarCompra pelo executor (trilha na mesma transação)')
  cancelar(
    @Param('ano') ano: string,
    @Param('doc') doc: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Resultado> {
    const e = corpo(esquemaCancelarCompra, { ...(b as object), pedido: this.pedido(ano, doc) });
    return this.servico.executar(sessaoDe(req), 'suprimentos.cancelarCompra', e);
  }

  @Post('motivos-cancelamento-compra')
  @HttpCode(200)
  @Permissao('suprimentos.pedido.aprovar')
  @AuditadoNoHandler('suprimentos.gravarMotivoCancelamentoCompra pelo executor (trilha na mesma transação)')
  motivo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<Resultado> {
    return this.servico.executar(
      sessaoDe(req),
      'suprimentos.gravarMotivoCancelamentoCompra',
      corpo(esquemaGravarMotivoCancelamentoCompra, b),
    );
  }
}
