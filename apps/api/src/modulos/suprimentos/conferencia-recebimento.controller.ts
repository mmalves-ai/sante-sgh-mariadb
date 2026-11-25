// Conferência física do recebimento (C2-038, 05-SUP linha 21). Tudo ligado para todos: só o cargo controla.
//   GET  /api/suprimentos/conferencias-recebimento?situacao=    as conferências do estabelecimento (as mais novas primeiro)
//   GET  /api/suprimentos/conferencias-recebimento/:id          a conferência com os itens e as divergências
//   GET  /api/suprimentos/conferencias-recebimento/pedido/:ano/:doc  o saldo a receber de cada item do pedido
//   POST /api/suprimentos/conferencias-recebimento              registrar a conferência (a regra classifica cada item)
//   POST /api/suprimentos/conferencias-recebimento/:id/validar  validar (outra pessoa; divergente com justificativa)
//   POST /api/suprimentos/conferencias-recebimento/:id/cancelar cancelar com o motivo (nunca a já usada pela nota)
// A gravação exige a Idempotency-Key: a repetição do mesmo pedido devolve o resultado da primeira.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaConferenciaRecebimento,
  esquemaCancelarConferencia,
  esquemaValidarConferencia,
  PORTA_CONFERENCIA_RECEBIMENTO,
  type PortaConferenciaRecebimento,
} from './conferencia-recebimento.js';

const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
const SITUACOES = new Set(['aberta', 'conferida', 'divergente', 'validada', 'cancelada']);

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

@Controller('suprimentos/conferencias-recebimento')
export class ConferenciaRecebimentoController {
  constructor(@Inject(PORTA_CONFERENCIA_RECEBIMENTO) private readonly porta: PortaConferenciaRecebimento) {}

  @Get()
  @Permissao('suprimentos.nota.ler')
  listar(@Query('situacao') situacao: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.listar(sessaoDe(req).porta, situacao && SITUACOES.has(situacao) ? situacao : null);
  }

  @Get('pedido/:ano/:doc')
  @Permissao('suprimentos.nota.ler')
  esperados(@Param('ano') ano: string, @Param('doc') doc: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.esperadosDoPedido(sessaoDe(req).porta, idDaRota(ano), idDaRota(doc));
  }

  @Get(':id')
  @Permissao('suprimentos.nota.ler')
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.detalhe(sessaoDe(req).porta, idDaRota(id));
  }

  @Post()
  @HttpCode(201)
  @Permissao('suprimentos.nota.registrar')
  @AuditadoNoHandler(
    'suprimentos.conferencia-recebimento.registrar pelo executor (trilha na mesma transação)',
  )
  registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.registrar(sessaoDe(req).porta, corpo(esquemaConferenciaRecebimento, b), chaveDe(req));
  }

  @Post(':id/validar')
  @HttpCode(200)
  @Permissao('suprimentos.nota.registrar')
  @AuditadoNoHandler('suprimentos.conferencia-recebimento.validar pelo executor (trilha na mesma transação)')
  validar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaValidarConferencia, { ...(b as object), id: idDaRota(id) });
    return this.porta.validar(sessaoDe(req).porta, e, chaveDe(req));
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Permissao('suprimentos.nota.registrar')
  @AuditadoNoHandler('suprimentos.conferencia-recebimento.cancelar pelo executor (trilha na mesma transação)')
  cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaCancelarConferencia, { ...(b as object), id: idDaRota(id) });
    return this.porta.cancelar(sessaoDe(req).porta, e, chaveDe(req));
  }
}
