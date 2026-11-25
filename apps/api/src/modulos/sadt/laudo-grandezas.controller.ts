// Cadastro do laudo estruturado do exame (F3.5, análise 05-SADT linha 17), ao lado da ficha do exame:
//   GET  /api/sadt/catalogo/laudo-estruturado?exame          seções, medidas (com faixas e fórmulas), sexos e unidades
//   POST /api/sadt/catalogo/laudo-estruturado/secoes         inclui ou altera (com id e versão) a seção
//   POST /api/sadt/catalogo/laudo-estruturado/grandezas      inclui ou altera a medida
//   POST /api/sadt/catalogo/laudo-estruturado/faixas         inclui ou altera a faixa de referência da medida
//   POST /api/sadt/catalogo/laudo-estruturado/grandezas/:id/formula   nova versão da fórmula da medida calculada
// Ler: `sadt.catalogo.ler`; gravar: `sadt.catalogo.editar`. Toda gravação vai à trilha na mesma transação (Executor).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';
import { contextoOperacao, idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaFaixaGrandeza,
  esquemaFormulaGrandeza,
  esquemaGrandezaLaudo,
  esquemaSecaoLaudo,
  GRANDEZAS_LAUDO,
  type PortaGrandezasLaudoPropria,
} from './laudo-grandezas-propria.js';

@Controller('api/sadt/catalogo/laudo-estruturado')
export class LaudoGrandezasController {
  constructor(
    @Optional() @Inject(GRANDEZAS_LAUDO) private readonly porta: PortaGrandezasLaudoPropria | null,
  ) {}

  private p(): PortaGrandezasLaudoPropria {
    if (!this.porta)
      throw semBancoDoCliente(
        'Catálogo indisponível',
        'O cadastro do laudo estruturado só existe com o banco do cliente.',
      );
    return this.porta;
  }

  /** Inclusão valida o corpo inteiro; alteração (com id) valida só o enviado e exige a versão vista. */
  private conferir(
    esquema: { parse(x: unknown): unknown; partial(): { parse(x: unknown): unknown } },
    b: unknown,
  ) {
    const alteracao = Boolean(b && typeof b === 'object' && (b as Record<string, unknown>)['id']);
    const e = corpo((alteracao ? esquema.partial() : esquema) as never, b) as { versao?: number };
    if (alteracao && !e.versao)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Falta a versão vista.');
  }

  @Get()
  @Permissao('sadt.catalogo.ler')
  ler(@Query('exame') exame: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.p().laudoEstruturado(sessaoDe(req).porta, idDaRota(String(exame ?? '')));
  }

  @Post('secoes')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a seção do laudo estruturado com a trilha_auditoria na mesma transação (Executor)')
  secao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    this.conferir(esquemaSecaoLaudo, b);
    return this.p().salvarSecao(contextoOperacao(sessaoDe(req), 'sadt.catalogo'), b);
  }

  @Post('grandezas')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler('a medida do laudo estruturado com a trilha_auditoria na mesma transação (Executor)')
  grandeza(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    this.conferir(esquemaGrandezaLaudo, b);
    return this.p().salvarGrandeza(contextoOperacao(sessaoDe(req), 'sadt.catalogo'), b);
  }

  @Post('faixas')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler(
    'a faixa de referência da medida do laudo com a trilha_auditoria na mesma transação (Executor)',
  )
  faixa(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    this.conferir(esquemaFaixaGrandeza, b);
    return this.p().salvarFaixa(contextoOperacao(sessaoDe(req), 'sadt.catalogo'), b);
  }

  @Post('grandezas/:id/formula')
  @HttpCode(200)
  @Permissao('sadt.catalogo.editar')
  @AuditadoNoHandler(
    'a fórmula da medida calculada e as variáveis com a trilha_auditoria na mesma transação (Executor)',
  )
  formula(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    corpo(esquemaFormulaGrandeza, b);
    return this.p().novaFormula(contextoOperacao(sessaoDe(req), 'sadt.catalogo'), idDaRota(id), b);
  }
}
