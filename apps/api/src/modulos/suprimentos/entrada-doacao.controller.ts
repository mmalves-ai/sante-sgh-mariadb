// Entrada de produtos recebidos em doação (C1-126, 09-AREA linha 79). Tudo ligado para todos: só o cargo controla.
//   GET  /api/suprimentos/doacoes                    as doações recebidas do estabelecimento (as mais novas primeiro)
//   GET  /api/suprimentos/doacoes/doadores?termo=    empresas e pessoas do cadastro pelo nome ou documento
//   GET  /api/suprimentos/doacoes/itens/:id          o item com o último preço de compra (custo de referência)
//   POST /api/suprimentos/doacoes                    registrar a doação (sem pedido; doador, termo, custo por item)
// A gravação exige a Idempotency-Key: a repetição do mesmo pedido devolve o resultado da primeira.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { esquemaEntradaDoacao, PORTA_ENTRADA_DOACAO, type PortaEntradaDoacao } from './entrada-doacao.js';

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

@Controller('suprimentos/doacoes')
export class EntradaDoacaoController {
  constructor(@Inject(PORTA_ENTRADA_DOACAO) private readonly porta: PortaEntradaDoacao) {}

  @Get()
  @Permissao('suprimentos.nota.ler')
  recebidas(@Req() req: RequisicaoAutorizada) {
    return this.porta.recebidas(sessaoDe(req).porta);
  }

  @Get('doadores')
  @Permissao('suprimentos.nota.ler')
  doadores(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.doadores(sessaoDe(req).porta, termo ?? '');
  }

  @Get('itens/:id')
  @Permissao('suprimentos.nota.ler')
  referencia(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.referencia(sessaoDe(req).porta, idDaRota(id));
  }

  @Post()
  @HttpCode(201)
  @Permissao('suprimentos.nota.registrar')
  @AuditadoNoHandler('suprimentos.doacao.registrar pelo executor (trilha na mesma transação)')
  registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.registrar(sessaoDe(req).porta, corpo(esquemaEntradaDoacao, b), chaveDe(req));
  }
}
