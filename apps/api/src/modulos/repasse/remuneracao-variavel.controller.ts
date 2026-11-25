// Remuneração variável do profissional (F8, 07-FIN linha 157). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/repasse/remuneracao-variavel?profissional=          regras do profissional (ou de todos) e listas da tela
//   POST /api/repasse/remuneracao-variavel/minimos                 inclui o mínimo garantido mensal
//   POST /api/repasse/remuneracao-variavel/fixos                   inclui o valor fixo mensal (C2-100)
//   POST /api/repasse/remuneracao-variavel/resultados              inclui o percentual do resultado do centro de custo
//   POST /api/repasse/remuneracao-variavel/metas                   inclui a meta de produtividade com as faixas
//   POST /api/repasse/remuneracao-variavel/metas/:id/apurado       { competencia, valor } valor apurado da meta
//   POST /api/repasse/remuneracao-variavel/:tipo/:id/encerrar      { versao, fim } encerra (nada apagado)
//   GET  /api/repasse/remuneracao-variavel/simulacao?apuracao=&profissional=  cálculo sem gravar
//   POST /api/repasse/remuneracao-variavel/lancar                  { apuracao, profissional? } lança na apuração
// Ler: quem lê as regras do repasse; incluir e encerrar: quem propõe regra; lançar: quem cria lançamento.
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
  PORTA_REMUNERACAO_VARIAVEL,
  type PortaRemuneracaoVariavelPropria,
  TIPOS_REGRA_VARIAVEL,
  type TipoRegraVariavel,
} from './remuneracao-variavel-propria.js';

export const PERMISSOES_REMUNERACAO_VARIAVEL = {
  ler: 'repasse.regra.ler',
  editar: 'repasse.regra.propor',
  lancar: 'repasse.lancamento.criar',
} as const;

const AUDITORIA = 'executor: trilha na mesma transação da remuneração variável';

const idOuNulo = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, 'Parâmetro inválido');
  return n;
};

@Controller('repasse/remuneracao-variavel')
export class RemuneracaoVariavelController {
  constructor(
    @Optional()
    @Inject(PORTA_REMUNERACAO_VARIAVEL)
    private readonly porta: PortaRemuneracaoVariavelPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaRemuneracaoVariavelPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.ler)
  painel(@Req() req: RequisicaoAutorizada, @Query('profissional') profissional?: string) {
    return this.com(req, (p, c) => p.painel(c, idOuNulo(profissional)));
  }

  @Get('simulacao')
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.ler)
  simulacao(
    @Req() req: RequisicaoAutorizada,
    @Query('apuracao') apuracao?: string,
    @Query('profissional') profissional?: string,
  ) {
    const a = idOuNulo(apuracao);
    if (a === null) throw new ErroProblema('entrada-invalida', 400, 'Informe a apuração');
    return this.com(req, (p, c) => p.simular(c, a, idOuNulo(profissional)));
  }

  @Post('minimos')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.editar)
  incluirMinimo(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirMinimo(c, corpo));
  }

  @Post('fixos')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.editar)
  incluirFixo(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirFixo(c, corpo));
  }

  @Post('resultados')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.editar)
  incluirResultado(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirResultado(c, corpo));
  }

  @Post('metas')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.editar)
  incluirMeta(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirMeta(c, corpo));
  }

  @Post('metas/:id/apurado')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.editar)
  informarApurado(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.informarApurado(c, id, corpo));
  }

  @Post(':tipo/:id/encerrar')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.editar)
  encerrar(
    @Req() req: RequisicaoAutorizada,
    @Param('tipo') tipo: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    if (!TIPOS_REGRA_VARIAVEL.includes(tipo as TipoRegraVariavel))
      throw new ErroProblema('entrada-invalida', 400, 'Tipo de regra inválido');
    return this.com(req, (p, c) => p.encerrar(c, tipo as TipoRegraVariavel, id, corpo));
  }

  @Post('lancar')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_REMUNERACAO_VARIAVEL.lancar)
  lancar(@Req() req: RequisicaoAutorizada, @Body() corpo: { apuracao?: unknown; profissional?: unknown }) {
    const a = idOuNulo(corpo?.apuracao);
    if (a === null) throw new ErroProblema('entrada-invalida', 400, 'Informe a apuração');
    return this.com(req, (p, c) => p.lancar(c, a, idOuNulo(corpo?.profissional)));
  }
}
