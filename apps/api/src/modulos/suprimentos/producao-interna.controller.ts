// Produção interna da farmácia e da central (C1-124, 05-SUP linha 12):
//   GET  /api/farmacia/producao-interna?de=&ate=          as ordens baixadas a fechar, os custos indiretos com o valor
//                                                         vigente, os kits padrão com a composição, os locais e os
//                                                         lotes produzidos do período com os custos
//   POST /api/farmacia/producao-interna/ordens/:id/fechamento   o lote produzido da ordem baixada (entrada no estoque)
//   POST /api/farmacia/producao-interna/kits              o kit montado (consumo da composição e entrada do kit)
// Ler pede suprimentos.manipulacao.ler; gravar, suprimentos.manipulacao.abrir. Sem chave de liberação: vale a
// permissão do cargo. A gravação exige a Idempotency-Key (a mesma do corpo).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { PERMISSOES_MANIPULACAO_CODIGOS as P } from '@sgh/contratos';
import { MAXIMO_KITS_POR_MONTAGEM } from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_PRODUCAO_INTERNA, type PortaProducaoInterna } from './producao-interna.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
const PERIODO_MAXIMO_DIAS = 92;
const quantidade = z.number().min(0).max(99_999_999);
const custos = z
  .array(
    z
      .object({ custo: z.number().int().positive(), quantidade: z.number().positive().max(99_999_999) })
      .strict(),
  )
  .max(20)
  .default([]);

export const esquemaFechamentoProducao = z
  .object({
    versaoVista: z.number().int().positive(),
    quantidadeProduzida: quantidade,
    perda: quantidade.default(0),
    validadeEm: z.string().regex(INSTANTE),
    numeroLote: z.string().trim().min(1).max(50).nullable().default(null),
    custos,
    valorAdicional: z.number().min(0).max(99_999_999).default(0),
  })
  .strict();

export const esquemaMontagemKit = z
  .object({
    kit: z.number().int().positive(),
    produto: z.number().int().positive(),
    local: z.number().int().positive(),
    quantidadeKits: z.number().int().min(1).max(MAXIMO_KITS_POR_MONTAGEM),
    validadeEm: z.string().regex(INSTANTE),
    numeroLote: z.string().trim().min(1).max(50).nullable().default(null),
    custos,
    valorAdicional: z.number().min(0).max(99_999_999).default(0),
  })
  .strict();

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

function idDe(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'A ordem de manipulação não existe.');
  return n;
}

@Controller('farmacia/producao-interna')
export class ProducaoInternaController {
  constructor(@Inject(PORTA_PRODUCAO_INTERNA) private readonly porta: PortaProducaoInterna) {}

  @Get()
  @Permissao(P.ler)
  painel(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    if (!de || !ate || !DATA.test(de) || !DATA.test(ate) || de > ate)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'Informe o período (de e até).');
    if ((Date.parse(ate) - Date.parse(de)) / 86_400_000 > PERIODO_MAXIMO_DIAS)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Período longo',
        `O período vai até ${PERIODO_MAXIMO_DIAS} dias.`,
      );
    return this.porta.painel(sessaoDe(req).porta, de, ate);
  }

  @Post('ordens/:id/fechamento')
  @HttpCode(201)
  @Permissao(P.abrir)
  @AuditadoNoHandler('suprimentos.producao.fechar-ordem pelo executor (trilha na mesma transação)')
  async fechar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaFechamentoProducao, b);
    const r = await this.porta.fecharOrdem(sessaoDe(req).porta, idDe(id), e, chaveDe(req));
    return { ok: true, ...r, mensagem: `Lote ${r.numeroLote} produzido e lançado no estoque.` };
  }

  @Post('kits')
  @HttpCode(201)
  @Permissao(P.abrir)
  @AuditadoNoHandler('suprimentos.producao.montar-kit pelo executor (trilha na mesma transação)')
  async montar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaMontagemKit, b);
    const r = await this.porta.montarKit(sessaoDe(req).porta, e, chaveDe(req));
    return { ok: true, ...r, mensagem: `Kit montado: lote ${r.numeroLote} lançado no estoque.` };
  }
}
