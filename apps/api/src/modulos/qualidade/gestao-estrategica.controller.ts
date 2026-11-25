// Rotas da gestão estratégica (C2-066, 01-ADM L118): mapa BSC, iniciativas e reuniões de análise crítica. Sem banco
// próprio, 503. Leitura por qualidade.gestao.ler; gravação por qualidade.gestao.registrar (escritório da qualidade).
// - GET  /api/qualidade/estrategia                      perspectivas, indicadores, mapas, iniciativas e reuniões
// - GET  /api/qualidade/estrategia/mapas/:id            objetivos por perspectiva, indicadores e farol
// - GET  /api/qualidade/estrategia/iniciativas/:id      objetivos, participantes, ações e horas
// - GET  /api/qualidade/estrategia/reunioes/:id         participantes, pauta, ata e deliberações
// - POST /api/qualidade/estrategia/{perspectivas,mapas,objetivos,iniciativas,iniciativas/:id/situacao,acoes,horas,
//        reunioes,reunioes/:id/pauta,reunioes/:id/presenca,reunioes/:id/situacao,deliberacoes}
// Gravações pelo executor, com a trilha na mesma transação.
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
  Req,
} from '@nestjs/common';
import { PERMISSOES_GESTAO_QUALIDADE as P } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problema } from '../administracao/comum.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { sessaoDe } from '../cadastro/comum.js';
import type { ContextoGravacaoEstrategia, GestaoEstrategicaPropria } from './gestao-estrategica-propria.js';

export const GESTAO_ESTRATEGICA = Symbol('GESTAO_ESTRATEGICA');

const corpoDe = (c: unknown): Record<string, unknown> =>
  c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

@Controller()
export class GestaoEstrategicaController {
  constructor(
    @Optional() @Inject(GESTAO_ESTRATEGICA) private readonly porta: GestaoEstrategicaPropria | null = null,
  ) {}

  private banco(): GestaoEstrategicaPropria {
    if (!this.porta)
      throw new ErroProblema('indisponivel', 503, 'Gestão estratégica indisponível neste ambiente');
    return this.porta;
  }

  private leitura(req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return { hospital: s.hospital, login: s.login };
  }

  private gravacao(req: RequisicaoAutorizada, rotulo: string): ContextoGravacaoEstrategia {
    const s = sessaoDe(req);
    const g = contextoGravacao(s, rotulo, false);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  @Get('qualidade/estrategia')
  @Permissao(P.gestaoLer)
  async painel(@Req() req: RequisicaoAutorizada) {
    return this.banco()
      .painel(this.leitura(req))
      .catch((x: unknown) => problema(x));
  }

  @Get('qualidade/estrategia/mapas/:id')
  @Permissao(P.gestaoLer)
  async mapa(@Param('id', ParseIntPipe) id: number, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .mapa(this.leitura(req), id)
      .catch((x: unknown) => problema(x));
  }

  @Get('qualidade/estrategia/iniciativas/:id')
  @Permissao(P.gestaoLer)
  async iniciativa(@Param('id', ParseIntPipe) id: number, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .iniciativa(this.leitura(req), id)
      .catch((x: unknown) => problema(x));
  }

  @Get('qualidade/estrategia/reunioes/:id')
  @Permissao(P.gestaoLer)
  async reuniao(@Param('id', ParseIntPipe) id: number, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .reuniao(this.leitura(req), id)
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/perspectivas')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_perspectiva_gravar pelo executor (trilha na mesma transação)')
  async perspectiva(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarPerspectivaEstrategica(this.gravacao(req, 'estrategia-perspectiva'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/mapas')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_mapa_gravar pelo executor (trilha na mesma transação)')
  async gravarMapa(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarMapaEstrategico(this.gravacao(req, 'estrategia-mapa'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/objetivos')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_objetivo_gravar pelo executor (trilha na mesma transação)')
  async objetivo(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarObjetivoEstrategico(this.gravacao(req, 'estrategia-objetivo'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/iniciativas')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_iniciativa_gravar pelo executor (trilha na mesma transação)')
  async gravarIniciativa(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarIniciativaEstrategica(this.gravacao(req, 'estrategia-iniciativa'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/iniciativas/:id/situacao')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_iniciativa_situacao pelo executor (trilha na mesma transação)')
  async situacaoIniciativa(
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.banco()
      .mudarSituacaoIniciativa(this.gravacao(req, 'estrategia-iniciativa-situacao'), {
        ...corpoDe(corpo),
        id,
      })
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/acoes')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_acao_gravar pelo executor (trilha na mesma transação)')
  async acao(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarAcaoIniciativa(this.gravacao(req, 'estrategia-acao'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/horas')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_horas_apontar pelo executor (trilha na mesma transação)')
  async horas(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .apontarHoras(this.gravacao(req, 'estrategia-horas'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/reunioes')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_reuniao_gravar pelo executor (trilha na mesma transação)')
  async gravarReuniao(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarReuniao(this.gravacao(req, 'estrategia-reuniao'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/reunioes/:id/pauta')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_reuniao_pauta pelo executor (trilha na mesma transação)')
  async pauta(
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.banco()
      .gravarPauta(this.gravacao(req, 'estrategia-pauta'), { ...corpoDe(corpo), reuniao: id })
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/reunioes/:id/presenca')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_reuniao_presenca pelo executor (trilha na mesma transação)')
  async presenca(
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.banco()
      .registrarPresenca(this.gravacao(req, 'estrategia-presenca'), { ...corpoDe(corpo), reuniao: id })
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/reunioes/:id/situacao')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_reuniao_situacao pelo executor (trilha na mesma transação)')
  async situacaoReuniao(
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.banco()
      .mudarSituacaoReuniao(this.gravacao(req, 'estrategia-reuniao-situacao'), { ...corpoDe(corpo), id })
      .catch((x: unknown) => problema(x));
  }

  @Post('qualidade/estrategia/deliberacoes')
  @HttpCode(200)
  @Permissao(P.gestaoRegistrar)
  @AuditadoNoHandler('qualidade.estrategia_deliberacao_gravar pelo executor (trilha na mesma transação)')
  async deliberacao(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco()
      .gravarDeliberacao(this.gravacao(req, 'estrategia-deliberacao'), corpoDe(corpo))
      .catch((x: unknown) => problema(x));
  }
}
