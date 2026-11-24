// Vínculo do item com a referência de preço de material e medicamento (F3.6, 05-SUP linha 28), na ficha do item.
//   GET  /api/suprimentos/cadastro/itens/:id/referencias-preco                  vigente e histórico do item
//   GET  /api/suprimentos/cadastro/itens/:id/referencias-preco/buscar?termo=    referências ativas com fator sugerido
//   POST /api/suprimentos/cadastro/itens/:id/referencias-preco                  vincular (fecha o anterior na véspera)
//   POST /api/suprimentos/cadastro/itens/:id/referencias-preco/:v/encerrar      encerrar o vigente numa data
// Quem pode: ler o item (consulta) e editar o item (gravação). Tudo ligado para todos; só o cargo controla.
// As gravações exigem a Idempotency-Key: a repetição do mesmo pedido devolve o resultado da primeira, sem gravar de novo.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  type FichaVinculoReferencia,
  type OpcaoReferenciaPreco,
  PORTA_VINCULO_REFERENCIA,
  type PortaVinculoReferencia,
} from './vinculo-referencia-preco.js';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const esquemaVincular = z
  .object({
    referencia: z.number().int().positive(),
    edicao: z.number().int().positive().nullable().optional(),
    fator: z.number().positive().max(1_000_000),
    inicio: data,
  })
  .strict();
const esquemaEncerrar = z.object({ fim: data }).strict();
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

@Controller('suprimentos/cadastro/itens/:id/referencias-preco')
export class VinculoReferenciaPrecoController {
  constructor(@Inject(PORTA_VINCULO_REFERENCIA) private readonly porta: PortaVinculoReferencia) {}

  @Get()
  @Permissao('suprimentos.item.ler')
  async ficha(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<FichaVinculoReferencia> {
    const f = await this.porta.ficha(sessaoDe(req).porta, idDaRota(id));
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    return f;
  }

  @Get('buscar')
  @Permissao('suprimentos.item.ler')
  buscar(
    @Param('id') id: string,
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<OpcaoReferenciaPreco[]> {
    return this.porta.buscar(sessaoDe(req).porta, idDaRota(id), (termo ?? '').slice(0, 60));
  }

  @Post()
  @HttpCode(201)
  @Permissao('suprimentos.item.editar')
  @AuditadoNoHandler('suprimentos.cadastro.vincularReferenciaPreco pelo executor (trilha na mesma transação)')
  vincular(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaVincular, b);
    return this.porta.vincular(
      sessaoDe(req).porta,
      idDaRota(id),
      { ...e, edicao: e.edicao ?? null },
      chaveDe(req),
    );
  }

  @Post(':vinculo/encerrar')
  @HttpCode(200)
  @Permissao('suprimentos.item.editar')
  @AuditadoNoHandler(
    'suprimentos.cadastro.encerrarVinculoReferenciaPreco pelo executor (trilha na mesma transação)',
  )
  encerrar(
    @Param('id') id: string,
    @Param('vinculo') v: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.porta.encerrar(
      sessaoDe(req).porta,
      idDaRota(id),
      idDaRota(v),
      corpo(esquemaEncerrar, b).fim,
      chaveDe(req),
    );
  }
}
