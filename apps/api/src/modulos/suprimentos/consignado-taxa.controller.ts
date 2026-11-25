// Taxa de comercialização do consignado por faixa de valor (05-SUP linha 24), na tela dos consignados.
//   GET  /api/suprimentos/consignados/taxas?fornecedor=                  vigente (do fornecedor ou geral) e histórico
//   GET  /api/suprimentos/consignados/taxas/calculo?fornecedor=&valor=   a taxa de um valor pela tabela vigente
//   POST /api/suprimentos/consignados/taxas                              tabela nova (fecha a vigente na véspera)
// Quem pode: ler os consignados (consulta e cálculo) e registrar no consignado (tabela nova). Tudo ligado para todos;
// só o cargo controla. A gravação exige a Idempotency-Key: a repetição devolve o resultado da primeira.
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import { PERMISSOES_CONSIGNADO_CODIGOS as P } from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_TAXA_CONSIGNACAO, type PortaTaxaConsignacao } from './consignado-taxa.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const valor = z.number().min(0).max(9_999_999_999_999);
const esquemaTabela = z
  .object({
    fornecedor: z.number().int().positive().nullable(),
    inicio: z.string().regex(DATA),
    faixas: z
      .array(
        z
          .object({
            valorInicial: valor,
            valorFinal: valor.nullable(),
            percentual: z.number().min(0).max(1000),
            teto: valor.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
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

function fornecedorDe(q: string | undefined): number | null {
  const f = Number(q);
  return Number.isInteger(f) && f > 0 ? f : null;
}

@Controller('suprimentos/consignados/taxas')
export class TaxaConsignacaoController {
  constructor(@Inject(PORTA_TAXA_CONSIGNACAO) private readonly porta: PortaTaxaConsignacao) {}

  @Get()
  @Permissao(P.ler)
  tabelas(@Query('fornecedor') fornecedor: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.tabelas(sessaoDe(req).porta, fornecedorDe(fornecedor));
  }

  @Get('calculo')
  @Permissao(P.ler)
  calcular(
    @Query('fornecedor') fornecedor: string | undefined,
    @Query('valor') v: string | undefined,
    @Query('data') data: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const numero = Number(String(v ?? '').replace(',', '.'));
    if (!Number.isFinite(numero) || numero < 0)
      throw new ErroProblema('entrada-invalida', 400, 'Pedido incompleto', 'Informe o valor do material.');
    return this.porta.calcular(
      sessaoDe(req).porta,
      fornecedorDe(fornecedor),
      numero,
      data && DATA.test(data) ? data : null,
    );
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.registrar)
  @AuditadoNoHandler('suprimentos.consignado.gravar-tabela-taxa pelo executor (trilha na mesma transação)')
  gravar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.gravar(sessaoDe(req).porta, corpo(esquemaTabela, b), chaveDe(req));
  }
}
