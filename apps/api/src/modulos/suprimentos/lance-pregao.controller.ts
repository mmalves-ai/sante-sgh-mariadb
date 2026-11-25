// Lances da disputa aberta do pregão e do leilão (C2-030, 05-SUP linha 26; Lei 14.133, art. 56 e 57). Tudo ligado para
// todos: só o cargo controla.
//   GET  /api/suprimentos/lances-pregao                 os processos na sessão de pregão ou leilão do estabelecimento
//   GET  /api/suprimentos/lances-pregao/:processo       a disputa: itens, propostas, lances e a classificação parcial
//   POST /api/suprimentos/lances-pregao/:processo       registrar o lance do licitante no item
// O lance é ato de quem conduz a sessão (suprimentos.licitacao.conduzir). A gravação exige a Idempotency-Key: a
// repetição do mesmo pedido devolve o resultado da primeira.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { esquemaLance, PORTA_LANCE_PREGAO, type PortaLancePregao } from './lance-pregao.js';

const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;

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

@Controller('suprimentos/lances-pregao')
export class LancePregaoController {
  constructor(@Inject(PORTA_LANCE_PREGAO) private readonly porta: PortaLancePregao) {}

  @Get()
  @Permissao('suprimentos.licitacao.ler')
  processos(@Req() req: RequisicaoAutorizada) {
    return this.porta.processos(sessaoDe(req).porta);
  }

  @Get(':processo')
  @Permissao('suprimentos.licitacao.ler')
  disputa(@Param('processo') processo: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.disputa(sessaoDe(req).porta, idDaRota(processo));
  }

  @Post(':processo')
  @HttpCode(201)
  @Permissao('suprimentos.licitacao.conduzir')
  @AuditadoNoHandler('suprimentos.lance-licitacao.registrar pelo executor (trilha na mesma transação)')
  registrar(@Param('processo') processo: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.registrar(
      sessaoDe(req).porta,
      idDaRota(processo),
      corpo(esquemaLance, b),
      chaveDe(req),
    );
  }
}
