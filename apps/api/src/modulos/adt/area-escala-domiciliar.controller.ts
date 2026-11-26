// Áreas e escala da atenção domiciliar (C2-105, 03-PEP linha 143). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/internacao/domiciliar/areas                        áreas com faixas de CEP e profissionais, e as escolhas
//   GET  /api/internacao/domiciliar/areas/cep/:cep               a área ativa do CEP
//   POST /api/internacao/domiciliar/areas                        cria a área com as faixas
//   POST /api/internacao/domiciliar/areas/:id                    troca descrição, programa e faixas { …, versao }
//   POST /api/internacao/domiciliar/areas/:id/profissionais      vincula o profissional (prioridade e vigência)
//   POST /api/internacao/domiciliar/areas/:id/:acao              inativar | reativar { versao }
//   POST /api/internacao/domiciliar/vinculos/:id/encerrar        encerra o vínculo { versao, vigenciaFim }
//   GET  /api/internacao/domiciliar/escalas                      turnos da escala
//   GET  /api/internacao/domiciliar/escalas/grade?inicio=&dias=  grade dos dias com as vagas
//   POST /api/internacao/domiciliar/escalas                      cria o turno
//   POST /api/internacao/domiciliar/escalas/:id/:acao            encerrar | inativar | reativar { versao, vigenciaFim? }
// Ler: quem consulta a internação; gravar: quem interna (internacao.internacao.criar), como o resto da atenção
// domiciliar.
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
  ACOES_AREA_DOMICILIAR,
  ACOES_ESCALA_DOMICILIAR,
  PORTA_AREA_ESCALA_DOMICILIAR,
  type PortaAreaEscalaDomiciliarPropria,
} from './area-escala-domiciliar-propria.js';

const TRILHA = 'área e escala da atenção domiciliar pelo executor (trilha na mesma transação)';

function acaoValida<T extends string>(acao: string, validas: readonly T[]): T {
  if (!(validas as readonly string[]).includes(acao))
    throw new ErroProblema('nao-encontrado', 404, `Ação ${acao} desconhecida`);
  return acao as T;
}

@Controller('internacao/domiciliar')
export class AreaEscalaDomiciliarController {
  constructor(
    @Optional()
    @Inject(PORTA_AREA_ESCALA_DOMICILIAR)
    private readonly porta: PortaAreaEscalaDomiciliarPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaAreaEscalaDomiciliarPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('areas')
  @Permissao('internacao.internacao.ler')
  areas(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.areas(c));
  }

  @Get('areas/cep/:cep')
  @Permissao('internacao.internacao.ler')
  areaPorCep(@Req() req: RequisicaoAutorizada, @Param('cep') cep: string) {
    return this.com(req, (p, c) => p.areaPorCep(c, cep));
  }

  @Post('areas')
  @HttpCode(201)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  criarArea(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvarArea(c, null, corpo));
  }

  @Post('areas/:id')
  @HttpCode(200)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  alterarArea(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.salvarArea(c, id, corpo));
  }

  @Post('areas/:id/profissionais')
  @HttpCode(201)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  vincular(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.vincularProfissional(c, id, corpo));
  }

  @Post('areas/:id/:acao')
  @HttpCode(200)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  acaoArea(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Param('acao') acao: string,
    @Body() corpo: unknown,
  ) {
    const a = acaoValida(acao, ACOES_AREA_DOMICILIAR);
    return this.com(req, (p, c) => p.acaoArea(c, id, a, corpo));
  }

  @Post('vinculos/:id/encerrar')
  @HttpCode(200)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  encerrarVinculo(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.encerrarVinculo(c, id, corpo));
  }

  @Get('escalas')
  @Permissao('internacao.internacao.ler')
  escalas(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.escalas(c));
  }

  @Get('escalas/grade')
  @Permissao('internacao.internacao.ler')
  grade(@Req() req: RequisicaoAutorizada, @Query('inicio') inicio?: string, @Query('dias') dias?: string) {
    return this.com(req, (p, c) => p.grade(c, inicio ?? null, Number(dias ?? 7)));
  }

  @Post('escalas')
  @HttpCode(201)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  criarEscala(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.criarEscala(c, corpo));
  }

  @Post('escalas/:id/:acao')
  @HttpCode(200)
  @Permissao('internacao.internacao.criar')
  @AuditadoNoHandler(TRILHA)
  acaoEscala(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Param('acao') acao: string,
    @Body() corpo: unknown,
  ) {
    const a = acaoValida(acao, ACOES_ESCALA_DOMICILIAR);
    return this.com(req, (p, c) => p.acaoEscala(c, id, a, corpo));
  }
}
