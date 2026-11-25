// Governança do cadastro de itens (C2-082, 05-SUP linha 2). Tudo ligado para todos: só o cargo controla.
//   GET  /api/suprimentos/governanca-cadastro/itens?termo=           itens do cadastro para os combos
//   GET  /api/suprimentos/governanca-cadastro/solicitacoes           pedidos de inclusão, alteração e inativação
//   POST /api/suprimentos/governanca-cadastro/solicitacoes           pedir (nasce enviado à comissão)
//   POST /api/suprimentos/governanca-cadastro/solicitacoes/:id/decisao   aprovar, reprovar (comissão) ou cancelar
//   GET  /api/suprimentos/governanca-cadastro/unificacoes            unificações de itens duplicados
//   POST /api/suprimentos/governanca-cadastro/unificacoes            pedir a unificação
//   POST /api/suprimentos/governanca-cadastro/unificacoes/:id/decisao    aprovar, executar ou cancelar
//   GET  /api/suprimentos/governanca-cadastro/substituicoes?item=    substituições (de-para) entre itens
//   POST /api/suprimentos/governanca-cadastro/substituicoes          incluir, alterar ou desativar
// A gravação exige a Idempotency-Key: a repetição do mesmo pedido devolve o resultado da primeira.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaDecisaoSolicitacao,
  esquemaDecisaoUnificacao,
  esquemaSolicitacaoCadastro,
  esquemaSubstituicao,
  esquemaUnificacao,
  PORTA_GOVERNANCA_CADASTRO,
  type PortaGovernancaCadastro,
} from './governanca-cadastro.js';

const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;

/** A Idempotency-Key do pedido (obrigatória na gravação). */
function chaveDe(req: RequisicaoAutorizada): string {
  const bruto = req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof k !== 'string' || !CHAVE.test(k))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'A Idempotency-Key do pedido falta ou é inválida.',
    );
  return k;
}

@Controller('suprimentos/governanca-cadastro')
export class GovernancaCadastroController {
  constructor(@Inject(PORTA_GOVERNANCA_CADASTRO) private readonly porta: PortaGovernancaCadastro) {}

  @Get('itens')
  @Permissao('suprimentos.item.ler')
  itens(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.itens(sessaoDe(req).porta, termo ?? '');
  }

  @Get('solicitacoes')
  @Permissao('suprimentos.item.ler')
  solicitacoes(@Req() req: RequisicaoAutorizada) {
    return this.porta.solicitacoes(sessaoDe(req).porta);
  }

  @Post('solicitacoes')
  @HttpCode(201)
  @Permissao('suprimentos.item.editar')
  @AuditadoNoHandler('suprimentos.cadastro_solicitacao.criar pelo executor (trilha na mesma transação)')
  solicitar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.solicitar(sessaoDe(req).porta, corpo(esquemaSolicitacaoCadastro, b), chaveDe(req));
  }

  @Post('solicitacoes/:id/decisao')
  @HttpCode(200)
  @Permissao('suprimentos.padronizacao.aprovar')
  @AuditadoNoHandler('suprimentos.cadastro_solicitacao.decidir pelo executor (trilha na mesma transação)')
  decidirSolicitacao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.decidirSolicitacao(
      sessaoDe(req).porta,
      idDaRota(id),
      corpo(esquemaDecisaoSolicitacao, b),
      chaveDe(req),
    );
  }

  @Get('unificacoes')
  @Permissao('suprimentos.item.ler')
  unificacoes(@Req() req: RequisicaoAutorizada) {
    return this.porta.unificacoes(sessaoDe(req).porta);
  }

  @Post('unificacoes')
  @HttpCode(201)
  @Permissao('suprimentos.item.editar')
  @AuditadoNoHandler('suprimentos.unificacao.criar pelo executor (trilha na mesma transação)')
  unificar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.unificar(sessaoDe(req).porta, corpo(esquemaUnificacao, b), chaveDe(req));
  }

  @Post('unificacoes/:id/decisao')
  @HttpCode(200)
  @Permissao('suprimentos.padronizacao.aprovar')
  @AuditadoNoHandler('suprimentos.unificacao.decidir pelo executor (trilha na mesma transação)')
  decidirUnificacao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.decidirUnificacao(
      sessaoDe(req).porta,
      idDaRota(id),
      corpo(esquemaDecisaoUnificacao, b),
      chaveDe(req),
    );
  }

  @Get('substituicoes')
  @Permissao('suprimentos.item.ler')
  substituicoes(@Query('item') item: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.substituicoes(sessaoDe(req).porta, item ? idDaRota(item) : null);
  }

  @Post('substituicoes')
  @HttpCode(200)
  @Permissao('suprimentos.item.editar')
  @AuditadoNoHandler('suprimentos.substituicao.gravar pelo executor (trilha na mesma transação)')
  substituir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.substituir(sessaoDe(req).porta, corpo(esquemaSubstituicao, b), chaveDe(req));
  }
}
