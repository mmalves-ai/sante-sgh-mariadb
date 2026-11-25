// Ata de registro de preços e nota de empenho (C2-030, 05-SUP linha 26). Tudo ligado para todos: só o cargo controla.
//   GET  /api/suprimentos/atas-registro-preco                    as atas do estabelecimento com o saldo de cada item
//   GET  /api/suprimentos/atas-registro-preco/processos          os processos homologados sem ata, com os adjudicados
//   POST /api/suprimentos/atas-registro-preco                    registrar a ata assinada (vigente)
//   GET  /api/suprimentos/empenhos                               os empenhos do estabelecimento
//   POST /api/suprimentos/empenhos                               emitir o empenho sobre o saldo da ata
//   POST /api/suprimentos/empenhos/:id/anulacao                  anular o empenho (devolve o saldo à ata)
// A ata é ato de quem conduz a contratação; o empenho e a anulação, da autoridade (suprimentos.licitacao.homologar).
// A gravação exige a Idempotency-Key: a repetição do mesmo pedido devolve o resultado da primeira.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaAnulacaoEmpenho,
  esquemaAta,
  esquemaEmpenho,
  PORTA_ATA_EMPENHO,
  type PortaAtaEmpenho,
} from './ata-empenho.js';

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

@Controller('suprimentos')
export class AtaEmpenhoController {
  constructor(@Inject(PORTA_ATA_EMPENHO) private readonly porta: PortaAtaEmpenho) {}

  @Get('atas-registro-preco')
  @Permissao('suprimentos.licitacao.ler')
  atas(@Req() req: RequisicaoAutorizada) {
    return this.porta.atas(sessaoDe(req).porta);
  }

  @Get('atas-registro-preco/processos')
  @Permissao('suprimentos.licitacao.ler')
  processos(@Req() req: RequisicaoAutorizada) {
    return this.porta.processosHomologados(sessaoDe(req).porta);
  }

  @Post('atas-registro-preco')
  @HttpCode(201)
  @Permissao('suprimentos.licitacao.conduzir')
  @AuditadoNoHandler('suprimentos.ata-registro-preco.registrar pelo executor (trilha na mesma transação)')
  registrarAta(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.registrarAta(sessaoDe(req).porta, corpo(esquemaAta, b), chaveDe(req));
  }

  @Get('empenhos')
  @Permissao('suprimentos.licitacao.ler')
  empenhos(@Req() req: RequisicaoAutorizada) {
    return this.porta.empenhos(sessaoDe(req).porta);
  }

  @Post('empenhos')
  @HttpCode(201)
  @Permissao('suprimentos.licitacao.homologar')
  @AuditadoNoHandler('suprimentos.empenho.emitir pelo executor (trilha na mesma transação)')
  emitirEmpenho(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.emitirEmpenho(sessaoDe(req).porta, corpo(esquemaEmpenho, b), chaveDe(req));
  }

  @Post('empenhos/:id/anulacao')
  @HttpCode(200)
  @Permissao('suprimentos.licitacao.homologar')
  @AuditadoNoHandler('suprimentos.empenho.anular pelo executor (trilha na mesma transação)')
  anularEmpenho(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.anularEmpenho(
      sessaoDe(req).porta,
      idDaRota(id),
      corpo(esquemaAnulacaoEmpenho, b),
      chaveDe(req),
    );
  }
}
