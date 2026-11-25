// Rateio do repasse por setor e custos do prestador (F8, 06-FAT linha 49). Rotas (porta própria; sem banco do cliente,
// 503):
//   GET  /api/repasse/rateio-custos?profissional=           tipos de desconto, custos, regras de rateio e listas da tela
//   POST /api/repasse/rateio-custos/tipos                   inclui o tipo de desconto
//   POST /api/repasse/rateio-custos/tipos/:id/situacao      { versao, ativo } ativa ou inativa (nada apagado)
//   POST /api/repasse/rateio-custos/custos                  inclui o custo do prestador descontado do médico
//   POST /api/repasse/rateio-custos/regras                  inclui a regra de rateio por setor
//   POST /api/repasse/rateio-custos/:tipo/:id/encerrar      { versao, fim } encerra custo ou regra (não estende)
//   GET  /api/repasse/rateio-custos/apuracao/:id            rateio gravado e simulado da apuração, com as pendências
//   POST /api/repasse/rateio-custos/ratear                  { apuracao } grava o rateio da apuração por setor
// Ler: quem lê as regras do repasse; incluir e encerrar: quem propõe regra; ratear: quem cria lançamento.
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
import {
  PORTA_RATEIO_CUSTO_REPASSE,
  type PortaRateioCustoRepassePropria,
  TIPOS_ENCERRAVEIS,
  type TipoEncerravel,
} from './rateio-custo-propria.js';

export const PERMISSOES_RATEIO_CUSTO = {
  ler: 'repasse.regra.ler',
  editar: 'repasse.regra.propor',
  ratear: 'repasse.lancamento.criar',
} as const;

const AUDITORIA = 'executor: trilha na mesma transação do rateio e do custo do prestador';

const idOuNulo = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, 'Parâmetro inválido');
  return n;
};

@Controller('repasse/rateio-custos')
export class RateioCustoController {
  constructor(
    @Optional()
    @Inject(PORTA_RATEIO_CUSTO_REPASSE)
    private readonly porta: PortaRateioCustoRepassePropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaRateioCustoRepassePropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_RATEIO_CUSTO.ler)
  painel(@Req() req: RequisicaoAutorizada, @Query('profissional') profissional?: string) {
    return this.com(req, (p, c) => p.painel(c, idOuNulo(profissional)));
  }

  @Get('apuracao/:id')
  @Permissao(PERMISSOES_RATEIO_CUSTO.ler)
  rateio(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.rateioDaApuracao(c, id));
  }

  @Post('tipos')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_RATEIO_CUSTO.editar)
  incluirTipo(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirTipo(c, corpo));
  }

  @Post('tipos/:id/situacao')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_RATEIO_CUSTO.editar)
  situacaoTipo(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.situacaoTipo(c, id, corpo));
  }

  @Post('custos')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_RATEIO_CUSTO.editar)
  incluirCusto(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirCusto(c, corpo));
  }

  @Post('regras')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_RATEIO_CUSTO.editar)
  incluirRegra(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirRegra(c, corpo));
  }

  @Post('ratear')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_RATEIO_CUSTO.ratear)
  ratear(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.ratear(c, corpo));
  }

  @Post(':tipo/:id/encerrar')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_RATEIO_CUSTO.editar)
  encerrar(
    @Req() req: RequisicaoAutorizada,
    @Param('tipo') tipo: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    if (!(TIPOS_ENCERRAVEIS as readonly string[]).includes(tipo))
      throw new ErroProblema('entrada-invalida', 400, 'Tipo de regra inválido');
    return this.com(req, (p, c) => p.encerrar(c, tipo as TipoEncerravel, id, corpo));
  }
}
