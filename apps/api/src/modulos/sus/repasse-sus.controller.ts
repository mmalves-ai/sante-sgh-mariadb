// Repasse da produção SUS aos profissionais (F7, 06-SUS linha 62). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/sus/repasse                              regras do repasse, rateios do SADT e apurações em apuração
//   GET  /api/sus/repasse/apuracoes/:id/linhas          linhas da produção SUS na apuração
//   POST /api/sus/repasse/regras                       inclui a regra do repasse SUS
//   POST /api/sus/repasse/rateios                      inclui a regra do rateio do SADT da AIH
//   POST /api/sus/repasse/:tipo/:id/encerrar           { versao, fim } encerra a vigência (tipo: regras|rateios)
//   POST /api/sus/repasse/apuracoes/:id/apurar         { versao } apura a produção aprovada da competência
import {
  BadRequestException,
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
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_REPASSE_SUS, type PortaRepasseSusPropria } from './repasse-sus-propria.js';

const LER = 'repasse.apuracao.ler';
const EDITAR_REGRA = 'repasse.parametro.editar';
const APURAR = 'repasse.apuracao.apurar';
const TRILHA = 'repasse da produção SUS pelo executor (trilha na mesma transação)';

@Controller('sus/repasse')
export class RepasseSusController {
  constructor(
    @Optional()
    @Inject(PORTA_REPASSE_SUS)
    private readonly porta: PortaRepasseSusPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaRepasseSusPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(LER)
  consultar(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.consultar(c));
  }

  @Get('apuracoes/:id/linhas')
  @Permissao(LER)
  linhas(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.linhas(c, id));
  }

  @Post('regras')
  @HttpCode(201)
  @Permissao(EDITAR_REGRA)
  @AuditadoNoHandler(TRILHA)
  incluirRegra(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirRegra(c, corpo));
  }

  @Post('rateios')
  @HttpCode(201)
  @Permissao(EDITAR_REGRA)
  @AuditadoNoHandler(TRILHA)
  incluirRateio(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirRateio(c, corpo));
  }

  @Post('apuracoes/:id/apurar')
  @HttpCode(200)
  @Permissao(APURAR)
  @AuditadoNoHandler(TRILHA)
  apurar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.apurar(c, id, corpo));
  }

  @Post(':tipo/:id/encerrar')
  @HttpCode(200)
  @Permissao(EDITAR_REGRA)
  @AuditadoNoHandler(TRILHA)
  encerrar(
    @Req() req: RequisicaoAutorizada,
    @Param('tipo') tipo: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    if (tipo !== 'regras' && tipo !== 'rateios') throw new BadRequestException('Tipo inválido');
    return this.com(req, (p, c) => p.encerrar(c, tipo === 'regras' ? 'regra' : 'rateio', id, corpo));
  }
}
