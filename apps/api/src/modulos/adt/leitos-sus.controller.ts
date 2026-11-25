// Leitos do sistema público (F78.04-2, 04-INT linha 79). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/internacao/leitos-sus/habilitacoes                       habilitações com os leitos no programa hoje
//   POST /api/internacao/leitos-sus/habilitacoes                       inclui (conferida pelo domínio)
//   POST /api/internacao/leitos-sus/habilitacoes/:id/encerrar          { vigenciaFim, versao } encerra (nada apagado)
//   GET  /api/internacao/leitos-sus/habilitacoes/:id/leitos            leitos do programa (vigentes e passados)
//   POST /api/internacao/leitos-sus/habilitacoes/:id/leitos            { leito, vigenciaInicio, vigenciaFim? }
//   POST /api/internacao/leitos-sus/leitos/:id/encerrar                { vigenciaFim, versao } o leito sai do programa
//   GET  /api/internacao/leitos-sus/capacidade?competencia=AAAA-MM-01  capacidade vigente, teto e histórico
//   POST /api/internacao/leitos-sus/capacidade                         nova linha (inclusão, alteração ou retirada)
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
import { competenciaDe } from '@sgh/dominio-internacao';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_LEITOS_SUS, type PortaLeitosSusPropria } from './leitos-sus-propria.js';

export const PERMISSOES_LEITOS_SUS = {
  ler: 'faturamento.susLeitoUti.ler',
  editar: 'faturamento.susLeitoUti.editar',
} as const;
const TRILHA = 'habilitação, leito do programa e capacidade pelo executor (trilha na mesma transação)';

@Controller('internacao/leitos-sus')
export class LeitosSusController {
  constructor(
    @Optional() @Inject(PORTA_LEITOS_SUS) private readonly porta: PortaLeitosSusPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaLeitosSusPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('habilitacoes')
  @Permissao(PERMISSOES_LEITOS_SUS.ler)
  habilitacoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.habilitacoes(c) }));
  }

  @Post('habilitacoes')
  @HttpCode(201)
  @Permissao(PERMISSOES_LEITOS_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirHabilitacao(c, corpo));
  }

  @Post('habilitacoes/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_LEITOS_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  encerrar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.encerrarHabilitacao(c, id, corpo));
  }

  @Get('habilitacoes/:id/leitos')
  @Permissao(PERMISSOES_LEITOS_SUS.ler)
  leitos(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, async (p, c) => ({ itens: await p.leitos(c, id) }));
  }

  @Post('habilitacoes/:id/leitos')
  @HttpCode(201)
  @Permissao(PERMISSOES_LEITOS_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  vincular(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.vincularLeito(c, id, corpo));
  }

  @Post('leitos/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_LEITOS_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  encerrarLeito(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.encerrarVinculo(c, id, corpo));
  }

  @Get('capacidade')
  @Permissao(PERMISSOES_LEITOS_SUS.ler)
  capacidade(@Req() req: RequisicaoAutorizada, @Query('competencia') competencia?: string) {
    const comp = competenciaDe(competencia ?? '');
    if (!comp) throw new ErroProblema('entrada-invalida', 400, 'Informe a competência (AAAA-MM).');
    return this.com(req, async (p, c) => ({ competencia: comp, itens: await p.capacidade(c, comp) }));
  }

  @Post('capacidade')
  @HttpCode(201)
  @Permissao(PERMISSOES_LEITOS_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  registrarCapacidade(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrarCapacidade(c, corpo));
  }
}
