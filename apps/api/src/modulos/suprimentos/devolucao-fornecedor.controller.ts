// Devolução de compra ao fornecedor (C2-015, 05-SUP linha 22). Permissões do estoque: devolução ler e registrar.
//   GET  /api/suprimentos/devolucoes-fornecedor               as devoluções do estabelecimento (as mais novas primeiro)
//   GET  /api/suprimentos/devolucoes-fornecedor/notas?busca=  notas de compra confirmadas com item a devolver
//   GET  /api/suprimentos/devolucoes-fornecedor/notas/:id     a nota com o disponível por item e o saldo a pagar
//   GET  /api/suprimentos/devolucoes-fornecedor/motivos       motivos de devolução ativos
//   POST /api/suprimentos/devolucoes-fornecedor               registrar (saída do estoque e crédito no contas a pagar)
// A gravação exige a Idempotency-Key: a repetição do mesmo pedido devolve o resultado da primeira.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaDevolucaoFornecedor,
  PORTA_DEVOLUCAO_FORNECEDOR,
  type PortaDevolucaoFornecedor,
} from './devolucao-fornecedor.js';

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

@Controller('suprimentos/devolucoes-fornecedor')
export class DevolucaoFornecedorController {
  constructor(@Inject(PORTA_DEVOLUCAO_FORNECEDOR) private readonly porta: PortaDevolucaoFornecedor) {}

  @Get()
  @Permissao('suprimentos.devolucao.ler')
  devolucoes(@Req() req: RequisicaoAutorizada) {
    return this.porta.devolucoes(sessaoDe(req).porta);
  }

  @Get('notas')
  @Permissao('suprimentos.devolucao.ler')
  notas(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.notas(sessaoDe(req).porta, busca ?? '');
  }

  @Get('notas/:id')
  @Permissao('suprimentos.devolucao.ler')
  nota(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.nota(sessaoDe(req).porta, idDaRota(id));
  }

  @Get('motivos')
  @Permissao('suprimentos.devolucao.ler')
  motivos(@Req() req: RequisicaoAutorizada) {
    return this.porta.motivos(sessaoDe(req).porta);
  }

  @Post()
  @HttpCode(201)
  @Permissao('suprimentos.devolucao.registrar')
  @AuditadoNoHandler('suprimentos.devolucao_fornecedor.registrar pelo executor (trilha na mesma transação)')
  registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.registrar(sessaoDe(req).porta, corpo(esquemaDevolucaoFornecedor, b), chaveDe(req));
  }
}
