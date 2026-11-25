// Endereçamento do armazém e reserva para a separação (F8, 05-SUP linha 4). Tudo ligado para todos: só o cargo controla.
//   GET  /api/suprimentos/enderecamento/locais                         os locais ativos do estabelecimento
//   GET  /api/suprimentos/enderecamento/itens?termo=                   itens ativos por código ou nome
//   GET  /api/suprimentos/enderecamento/locais/:local                  a árvore de endereços do local com os itens
//   POST /api/suprimentos/enderecamento/enderecos                      criar o endereço (nível pelo de cima)
//   PUT  /api/suprimentos/enderecamento/enderecos/:id                  descrição, capacidade, bloqueio e situação
//   POST /api/suprimentos/enderecamento/enderecos/:id/itens            ligar o item (preferencial desmarca os outros)
//   POST /api/suprimentos/enderecamento/vinculos/:id/preferencial      tornar o endereço o preferencial do item
//   POST /api/suprimentos/enderecamento/vinculos/:id/retirar           retirar o item do endereço (excluido_em)
//   GET  /api/suprimentos/enderecamento/requisicoes/:id/reservas       as reservas da requisição por endereço e lote
//   POST /api/suprimentos/enderecamento/requisicoes/:id/reservar       reservar o saldo livre para separar
//   POST /api/suprimentos/enderecamento/requisicoes/:id/liberar        devolver ao livre o que está reservado
// As gravações exigem a Idempotency-Key: a repetição do mesmo pedido devolve o resultado da primeira.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { TIPOS_NIVEL_ENDERECO } from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_ENDERECAMENTO, type PortaEnderecamento } from './enderecamento.js';

const id = z.number().int().positive();
const capacidade = z.number().positive().max(999_999_999).nullable();
const esquemaEndereco = z
  .object({
    local: id,
    superior: id.nullable().optional(),
    tipoNivel: z.enum(TIPOS_NIVEL_ENDERECO),
    codigo: z.string().min(1).max(30),
    descricao: z.string().max(200).nullable().optional(),
    capacidade: capacidade.optional(),
  })
  .strict();
const esquemaAlteracao = z
  .object({
    versao: id,
    descricao: z.string().max(200).nullable(),
    capacidade,
    bloqueado: z.boolean(),
    ativo: z.boolean(),
  })
  .strict();
const esquemaVinculo = z
  .object({
    insumo: id,
    preferencial: z.boolean(),
    quantidadeMaxima: capacidade,
  })
  .strict();
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;

/** A Idempotency-Key do pedido (obrigatória nas gravações). */
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

@Controller('suprimentos/enderecamento')
export class EnderecamentoController {
  constructor(@Inject(PORTA_ENDERECAMENTO) private readonly porta: PortaEnderecamento) {}

  @Get('locais')
  @Permissao('suprimentos.local.ler')
  locais(@Req() req: RequisicaoAutorizada) {
    return this.porta.locais(sessaoDe(req).porta);
  }

  @Get('itens')
  @Permissao('suprimentos.local.ler')
  itens(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.itens(sessaoDe(req).porta, (termo ?? '').slice(0, 60));
  }

  @Get('locais/:local')
  @Permissao('suprimentos.local.ler')
  async ficha(@Param('local') l: string, @Req() req: RequisicaoAutorizada) {
    const f = await this.porta.ficha(sessaoDe(req).porta, idDaRota(l));
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Local não encontrado');
    return f;
  }

  @Post('enderecos')
  @HttpCode(201)
  @Permissao('suprimentos.local.editar')
  @AuditadoNoHandler('suprimentos.enderecamento.criar-endereco pelo executor (trilha na mesma transação)')
  criar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.criarEndereco(sessaoDe(req).porta, corpo(esquemaEndereco, b), chaveDe(req));
  }

  @Put('enderecos/:id')
  @Permissao('suprimentos.local.editar')
  @AuditadoNoHandler('suprimentos.enderecamento.alterar-endereco pelo executor (trilha na mesma transação)')
  alterar(@Param('id') v: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.alterarEndereco(
      sessaoDe(req).porta,
      idDaRota(v),
      corpo(esquemaAlteracao, b),
      chaveDe(req),
    );
  }

  @Post('enderecos/:id/itens')
  @HttpCode(201)
  @Permissao('suprimentos.local.editar')
  @AuditadoNoHandler('suprimentos.enderecamento.vincular-item pelo executor (trilha na mesma transação)')
  vincular(@Param('id') v: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.vincularItem(sessaoDe(req).porta, idDaRota(v), corpo(esquemaVinculo, b), chaveDe(req));
  }

  @Post('vinculos/:id/preferencial')
  @HttpCode(200)
  @Permissao('suprimentos.local.editar')
  @AuditadoNoHandler(
    'suprimentos.enderecamento.tornar-preferencial pelo executor (trilha na mesma transação)',
  )
  preferencial(@Param('id') v: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.tornarPreferencial(sessaoDe(req).porta, idDaRota(v), chaveDe(req));
  }

  @Post('vinculos/:id/retirar')
  @HttpCode(200)
  @Permissao('suprimentos.local.editar')
  @AuditadoNoHandler('suprimentos.enderecamento.retirar-vinculo pelo executor (trilha na mesma transação)')
  retirar(@Param('id') v: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.retirarVinculo(sessaoDe(req).porta, idDaRota(v), chaveDe(req));
  }

  @Get('requisicoes/:id/reservas')
  @Permissao('suprimentos.requisicao.ler')
  reservas(@Param('id') v: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.reservas(sessaoDe(req).porta, idDaRota(v));
  }

  @Post('requisicoes/:id/reservar')
  @HttpCode(200)
  @Permissao('suprimentos.requisicao.atender')
  @AuditadoNoHandler('suprimentos.enderecamento.reservar-separacao pelo executor (trilha na mesma transação)')
  reservar(@Param('id') v: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.reservar(sessaoDe(req).porta, idDaRota(v), chaveDe(req));
  }

  @Post('requisicoes/:id/liberar')
  @HttpCode(200)
  @Permissao('suprimentos.requisicao.atender')
  @AuditadoNoHandler(
    'suprimentos.enderecamento.liberar-reserva-separacao pelo executor (trilha na mesma transação)',
  )
  liberar(@Param('id') v: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.liberar(sessaoDe(req).porta, idDaRota(v), chaveDe(req));
  }
}
