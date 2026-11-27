// Remuneração variável por faixa e equipe (F8, 06-FAT linha 48). Rotas (porta própria; na fonte sintética, a porta em
// memória; sem banco do cliente e fora da fonte sintética, 503):
//   GET  /api/repasse/variavel-faixa                         regras com as faixas, equipes com a composição e listas
//   POST /api/repasse/variavel-faixa/equipes                 cria a equipe com a composição (cotas somam 100%)
//   POST /api/repasse/variavel-faixa/equipes/:id/recompor    { versao, inicio, membros } nova composição (nada apagado)
//   POST /api/repasse/variavel-faixa/regras                  inclui a regra com as faixas
//   POST /api/repasse/variavel-faixa/regras/:id/encerrar     { versao, fim } encerra (nunca estende nem apaga)
//   GET  /api/repasse/variavel-faixa/simulacao?apuracao=     medida, faixa, valor e rateio, sem gravar
//   POST /api/repasse/variavel-faixa/lancar                  { apuracao } lança na apuração
// Ler: quem lê as regras do repasse; incluir, recompor e encerrar: quem propõe regra; lançar: quem cria lançamento.
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
  Query,
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PERMISSOES_REMUNERACAO_VARIAVEL } from './remuneracao-variavel.controller.js';
import type { PortaVariavelFaixa } from './variavel-faixa-memoria.js';
import { PORTA_VARIAVEL_FAIXA } from './variavel-faixa-propria.js';

const AUDITORIA = 'executor: trilha na mesma transação da remuneração variável por faixa';

const idObrigatorio = (v: unknown, o: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, `Informe ${o}`);
  return n;
};

@Controller('repasse/variavel-faixa')
export class VariavelFaixaController {
  constructor(
    @Optional()
    @Inject(PORTA_VARIAVEL_FAIXA)
    private readonly porta: PortaVariavelFaixa | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaVariavelFaixa, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.ler)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painel(c));
  }

  @Get('simulacao')
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.ler)
  simulacao(@Req() req: RequisicaoAutorizada, @Query('apuracao') apuracao?: string) {
    const a = idObrigatorio(apuracao, 'a apuração');
    return this.com(req, (p, c) => p.simular(c, a));
  }

  @Post('equipes')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.editar)
  incluirEquipe(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirEquipe(c, corpo));
  }

  @Post('equipes/:id/recompor')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.editar)
  recompor(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.recomporEquipe(c, id, corpo));
  }

  @Post('regras')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.editar)
  incluirRegra(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirRegra(c, corpo));
  }

  @Post('regras/:id/encerrar')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.editar)
  encerrar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.encerrarRegra(c, id, corpo));
  }

  @Post('lancar')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.lancar)
  lancar(@Req() req: RequisicaoAutorizada, @Body() corpo: { apuracao?: unknown }) {
    const a = idObrigatorio(corpo?.apuracao, 'a apuração');
    return this.com(req, (p, c) => p.lancar(c, a));
  }
}
