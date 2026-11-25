// Refeição do acompanhante pelo direito legal e pelas regras do convênio (F7, 04-HOT linha 133). Rotas (porta própria;
// sem banco do cliente, 503):
//   GET  /api/nutricao/direito-refeicao                         as regras (com as fora de uso)
//   GET  /api/nutricao/direito-refeicao/apoio                   fontes pagadoras, acomodações e refeições do dia
//   POST /api/nutricao/direito-refeicao                         inclui a regra
//   PUT  /api/nutricao/direito-refeicao/:id                     altera com a versão lida
//   POST /api/nutricao/direito-refeicao/:id/uso                 { ativo, versao } (nada apagado)
//   GET  /api/nutricao/refeicoes-acompanhante/:reg              as refeições lançadas da internação
//   GET  /api/nutricao/refeicoes-acompanhante/:reg/decisao?data=&refeicao=  a regra que vale e a cobertura (antes de lançar)
//   POST /api/nutricao/refeicoes-acompanhante                   lança (coberta, a autorizar ou cobrável na conta)
//   POST /api/nutricao/refeicoes-acompanhante/:id/autorizacao   { autorizada, versao } a decisão da fonte pagadora
//   POST /api/nutricao/refeicoes-acompanhante/:id/cancelar      { motivo, versao } (nunca apaga)
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { PERMISSOES_NUTRICAO_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_DIREITO_REFEICAO, type PortaDireitoRefeicaoPropria } from './direito-refeicao-propria.js';

export const PERMISSOES_DIREITO_REFEICAO = {
  ler: P.mapaLer,
  /** As regras são do serviço de nutrição e dietética (quem fecha o mapa). */
  regrar: P.mapaFechar,
  lancar: P.acompanhanteRegistrar,
} as const;

const AUDITORIA = 'refeição do acompanhante pelo executor (trilha na mesma transação)';

@Controller('nutricao')
export class DireitoRefeicaoController {
  constructor(
    @Optional()
    @Inject(PORTA_DIREITO_REFEICAO)
    private readonly porta: PortaDireitoRefeicaoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaDireitoRefeicaoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('direito-refeicao')
  @Permissao(PERMISSOES_DIREITO_REFEICAO.ler)
  listar(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.listar(c) }));
  }

  @Get('direito-refeicao/apoio')
  @Permissao(PERMISSOES_DIREITO_REFEICAO.ler)
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.apoio(c));
  }

  @Post('direito-refeicao')
  @HttpCode(201)
  @Permissao(PERMISSOES_DIREITO_REFEICAO.regrar)
  @AuditadoNoHandler(AUDITORIA)
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluir(c, corpo));
  }

  @Put('direito-refeicao/:id')
  @Permissao(PERMISSOES_DIREITO_REFEICAO.regrar)
  @AuditadoNoHandler(AUDITORIA)
  alterar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.alterar(c, id, corpo));
  }

  @Post('direito-refeicao/:id/uso')
  @HttpCode(200)
  @Permissao(PERMISSOES_DIREITO_REFEICAO.regrar)
  @AuditadoNoHandler(AUDITORIA)
  uso(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.definirUso(c, id, corpo));
  }

  @Get('refeicoes-acompanhante/:reg')
  @Permissao(PERMISSOES_DIREITO_REFEICAO.ler)
  refeicoes(@Req() req: RequisicaoAutorizada, @Param('reg', ParseIntPipe) reg: number) {
    return this.com(req, async (p, c) => ({ itens: await p.refeicoesDaInternacao(c, reg) }));
  }

  @Get('refeicoes-acompanhante/:reg/decisao')
  @Permissao(PERMISSOES_DIREITO_REFEICAO.ler)
  decisao(
    @Req() req: RequisicaoAutorizada,
    @Param('reg', ParseIntPipe) reg: number,
    @Query('data') data?: string,
    @Query('refeicao') refeicao?: string,
  ) {
    const r = Number(refeicao);
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isInteger(r) || r <= 0)
      throw new ErroProblema('entrada-invalida', 400, 'Informe a data (AAAA-MM-DD) e a refeição');
    return this.com(req, (p, c) => p.decidir(c, reg, data, r));
  }

  @Post('refeicoes-acompanhante')
  @HttpCode(201)
  @Permissao(PERMISSOES_DIREITO_REFEICAO.lancar)
  @AuditadoNoHandler(AUDITORIA)
  lancar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.lancar(c, corpo));
  }

  @Post('refeicoes-acompanhante/:id/autorizacao')
  @HttpCode(200)
  @Permissao(PERMISSOES_DIREITO_REFEICAO.lancar)
  @AuditadoNoHandler(AUDITORIA)
  autorizar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.autorizar(c, id, corpo));
  }

  @Post('refeicoes-acompanhante/:id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_DIREITO_REFEICAO.lancar)
  @AuditadoNoHandler(AUDITORIA)
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, corpo));
  }
}
