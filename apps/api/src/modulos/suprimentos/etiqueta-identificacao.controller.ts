// Etiqueta de identificação do estoque e leitura do código (F3.6, 05-SUP linha 14). Tudo ligado para todos: só o
// cargo controla.
//   POST /api/suprimentos/etiquetas                emitir N etiquetas do item (lote, local, quantidade por etiqueta);
//                                                  devolve o conteúdo dos códigos e o ZPL (a 1ª impressão)
//   GET  /api/suprimentos/etiquetas/:id            a etiqueta com o ZPL de novo (a reimpressão se registra pela
//                                                  impressão padrão, com motivo)
//   GET  /api/suprimentos/leitura?codigo=          lê o código (padrão configurado, GS1 ou código simples) e resolve o
//                                                  item, o lote, a validade e a quantidade, com os alertas
//   POST /api/suprimentos/etiquetas/baixa          baixa das etiquetas lidas (consumida na saída, devolvida,
//                                                  descartada, cancelada; a devolvida volta a ativa)
// As gravações exigem a Idempotency-Key: a repetição do mesmo pedido devolve o resultado da primeira.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  BAIXAS_ETIQUETA,
  MAXIMO_ETIQUETAS_POR_EMISSAO,
  TIPOS_ETIQUETA_ESTOQUE,
} from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_ETIQUETA_IDENTIFICACAO, type PortaEtiquetaIdentificacao } from './etiqueta-identificacao.js';

const id = z.number().int().positive();
const esquemaEmissao = z
  .object({
    insumo: id,
    lote: id.nullable().default(null),
    local: id.nullable().default(null),
    quantidade: z.number().positive().max(999_999),
    etiquetas: z.number().int().min(1).max(MAXIMO_ETIQUETAS_POR_EMISSAO),
    tipo: z.enum(TIPOS_ETIQUETA_ESTOQUE).default('unidade'),
    notaEntradaItem: id.nullable().default(null),
  })
  .strict();
const esquemaBaixa = z
  .object({
    identificadores: z.array(z.string().min(3).max(100)).min(1).max(500),
    situacao: z.enum([...BAIXAS_ETIQUETA, 'reativar']),
    movimento: id.nullable().default(null),
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

@Controller('suprimentos')
export class EtiquetaIdentificacaoController {
  constructor(@Inject(PORTA_ETIQUETA_IDENTIFICACAO) private readonly porta: PortaEtiquetaIdentificacao) {}

  @Post('etiquetas')
  @HttpCode(201)
  @Permissao('suprimentos.nota.registrar')
  @AuditadoNoHandler('suprimentos.etiqueta.emitir pelo executor (trilha na mesma transação)')
  emitir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.emitir(sessaoDe(req).porta, corpo(esquemaEmissao, b), chaveDe(req));
  }

  @Post('etiquetas/baixa')
  @HttpCode(200)
  @Permissao('suprimentos.saida.registrar')
  @AuditadoNoHandler('suprimentos.etiqueta.baixar pelo executor (trilha na mesma transação)')
  baixar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.baixar(sessaoDe(req).porta, corpo(esquemaBaixa, b), chaveDe(req));
  }

  @Get('etiquetas/:id')
  @Permissao('suprimentos.item.ler')
  async ficha(@Param('id') v: string, @Req() req: RequisicaoAutorizada) {
    const f = await this.porta.ficha(sessaoDe(req).porta, idDaRota(v));
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Etiqueta não encontrada');
    return f;
  }

  @Get('leitura')
  @Permissao('suprimentos.item.ler')
  ler(@Query('codigo') codigo: string | undefined, @Req() req: RequisicaoAutorizada) {
    const c = (codigo ?? '').slice(0, 200);
    if (!c.trim())
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Leia ou digite o código.');
    return this.porta.ler(sessaoDe(req).porta, c);
  }
}
