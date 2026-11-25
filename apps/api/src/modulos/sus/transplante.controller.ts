// Transplante para a central estadual (F8, 06-SUS linha 65). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/sus/transplante/opcoes                         órgãos, centrais e profissionais
//   GET  /api/sus/transplante/pacientes?busca=               pacientes pelo prontuário ou pelo início do nome
//   GET  /api/sus/transplante/notificacoes[?paciente=]       notificações de potencial doador
//   GET  /api/sus/transplante/notificacoes/:id               ficha da notificação
//   POST /api/sus/transplante/notificacoes                   notifica (número pela sequência do estabelecimento)
//   POST /api/sus/transplante/notificacoes/:id               altera (protocolo, abordagem, desfecho; com a versão)
//   POST /api/sus/transplante/notificacoes/:id/protocolo     protocolo devolvido pela central
//   GET  /api/sus/transplante/inscricoes[?situacao&pendentes&paciente]
//   GET  /api/sus/transplante/inscricoes/conferencia         arquivo de conferência (CSV)
//   GET  /api/sus/transplante/inscricoes/:id                 ficha com o histórico
//   POST /api/sus/transplante/inscricoes                     inscreve o receptor
//   POST /api/sus/transplante/inscricoes/:id                 altera (aptidão, situação, saída da lista; com a versão)
//   POST /api/sus/transplante/inscricoes/:id/central         número da central e envio das mudanças pendentes
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_TRANSPLANTE, type PortaTransplantePropria } from './transplante-propria.js';

export const PERMISSOES_TRANSPLANTE = {
  ler: 'faturamento.susTransplante.ler',
  registrar: 'faturamento.susTransplante.registrar',
} as const;
const TRILHA = 'notificação de doador e inscrição de receptor pelo executor (trilha na mesma transação)';

interface RespostaCsv {
  header(nome: string, valor: string): RespostaCsv;
}

const inteiro = (v: string | undefined): number | undefined => {
  const n = Number(v);
  return v && Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

@Controller('sus/transplante')
export class TransplanteSusController {
  constructor(
    @Optional() @Inject(PORTA_TRANSPLANTE) private readonly porta: PortaTransplantePropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaTransplantePropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('opcoes')
  @Permissao(PERMISSOES_TRANSPLANTE.ler)
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.opcoes(c));
  }

  @Get('pacientes')
  @Permissao(PERMISSOES_TRANSPLANTE.ler)
  pacientes(@Req() req: RequisicaoAutorizada, @Query('busca') busca = '') {
    return this.com(req, async (p, c) => ({
      itens: await p.buscarPacientes(c, String(busca).slice(0, 100)),
    }));
  }

  @Get('notificacoes')
  @Permissao(PERMISSOES_TRANSPLANTE.ler)
  notificacoes(@Req() req: RequisicaoAutorizada, @Query('paciente') paciente?: string) {
    return this.com(req, async (p, c) => ({ itens: await p.listarNotificacoes(c, inteiro(paciente)) }));
  }

  @Get('notificacoes/:id')
  @Permissao(PERMISSOES_TRANSPLANTE.ler)
  notificacao(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.lerNotificacao(c, id));
  }

  @Post('notificacoes')
  @HttpCode(201)
  @Permissao(PERMISSOES_TRANSPLANTE.registrar)
  @AuditadoNoHandler(TRILHA)
  notificar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.notificar(c, corpo));
  }

  @Post('notificacoes/:id')
  @HttpCode(200)
  @Permissao(PERMISSOES_TRANSPLANTE.registrar)
  @AuditadoNoHandler(TRILHA)
  alterarNotificacao(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alterarNotificacao(c, id, corpo));
  }

  @Post('notificacoes/:id/protocolo')
  @HttpCode(200)
  @Permissao(PERMISSOES_TRANSPLANTE.registrar)
  @AuditadoNoHandler(TRILHA)
  protocolo(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrarProtocolo(c, id, corpo));
  }

  @Get('inscricoes')
  @Permissao(PERMISSOES_TRANSPLANTE.ler)
  inscricoes(
    @Req() req: RequisicaoAutorizada,
    @Query('situacao') situacao?: string,
    @Query('pendentes') pendentes?: string,
    @Query('paciente') paciente?: string,
  ) {
    return this.com(req, async (p, c) => ({
      itens: await p.listarInscricoes(c, {
        ...(situacao ? { situacao } : {}),
        pendentes: pendentes === 'true',
        ...(inteiro(paciente) ? { paciente: inteiro(paciente)! } : {}),
      }),
    }));
  }

  @Get('inscricoes/conferencia')
  @Permissao(PERMISSOES_TRANSPLANTE.ler)
  @Auditar('faturamento.susTransplante.conferenciaExportada')
  @Header('content-type', 'text/csv; charset=utf-8')
  conferencia(
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: RespostaCsv,
    @Query('situacao') situacao?: string,
    @Query('pendentes') pendentes?: string,
  ) {
    return this.com(req, async (p, c) => {
      const csv = await p.conferencia(c, {
        ...(situacao ? { situacao } : {}),
        pendentes: pendentes === 'true',
      });
      req.sghAlvo = {
        tabelaAlvo: 'inscricao_transplante',
        chaveNaturalAlvo: `conferencia;${situacao ?? 'todas'}`,
      };
      res.header('content-disposition', 'attachment; filename="inscricoes-transplante.csv"');
      return csv;
    });
  }

  @Get('inscricoes/:id')
  @Permissao(PERMISSOES_TRANSPLANTE.ler)
  inscricao(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.lerInscricao(c, id));
  }

  @Post('inscricoes')
  @HttpCode(201)
  @Permissao(PERMISSOES_TRANSPLANTE.registrar)
  @AuditadoNoHandler(TRILHA)
  inscrever(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.inscrever(c, corpo));
  }

  @Post('inscricoes/:id')
  @HttpCode(200)
  @Permissao(PERMISSOES_TRANSPLANTE.registrar)
  @AuditadoNoHandler(TRILHA)
  alterarInscricao(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alterarInscricao(c, id, corpo));
  }

  @Post('inscricoes/:id/central')
  @HttpCode(200)
  @Permissao(PERMISSOES_TRANSPLANTE.registrar)
  @AuditadoNoHandler(TRILHA)
  central(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrarCentral(c, id, corpo));
  }
}
