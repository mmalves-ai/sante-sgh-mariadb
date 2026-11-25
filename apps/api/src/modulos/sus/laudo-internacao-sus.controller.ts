// Laudo de internação SUS e lote de laudos (F7, 06-SUS linha 57). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/sus/laudos-internacao?autorizacao=&semLote=&situacao=   laudos (da AIH, os livres para lote, por situação)
//   POST /api/sus/laudos-internacao/aih/:aih/devolver   { versao, motivo }          devolução pelo gestor
//   POST /api/sus/laudos-internacao/aih/:aih/reenviar   { versao, justificativa, procedimentoSolicitado?, cidPrincipal? }
//   POST /api/sus/laudos-internacao/aih/:aih/especial   { versao, justificativa, itens[] }  laudo especial
//   POST /api/sus/laudos-internacao/:id/impressao                                  marca a impressão
//   GET  /api/sus/laudos-internacao/lotes                                          lotes de laudos
//   POST /api/sus/laudos-internacao/lotes               { laudos[] }               gera o lote
//   POST /api/sus/laudos-internacao/lotes/:id/enviar|retornar|cancelar  { versao, observacao? }
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
  PORTA_LAUDO_INTERNACAO_SUS,
  type PortaLaudoInternacaoSusPropria,
} from './laudo-internacao-sus-propria.js';

const LER = 'faturamento.sus.ler';
const REGISTRAR = 'faturamento.susAih.registrar';
const TRILHA = 'laudo de internação SUS pelo executor (trilha na mesma transação)';

@Controller('sus/laudos-internacao')
export class LaudoInternacaoSusController {
  constructor(
    @Optional()
    @Inject(PORTA_LAUDO_INTERNACAO_SUS)
    private readonly porta: PortaLaudoInternacaoSusPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaLaudoInternacaoSusPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(LER)
  listar(
    @Req() req: RequisicaoAutorizada,
    @Query('autorizacao') autorizacao?: string,
    @Query('semLote') semLote?: string,
    @Query('situacao') situacao?: string,
  ) {
    const filtro = {
      ...(autorizacao ? { autorizacao: Number(autorizacao) } : {}),
      ...(semLote === 'true' ? { semLote: true } : {}),
      ...(situacao ? { situacao } : {}),
    };
    return this.com(req, async (p, c) => ({ itens: await p.listar(c, filtro) }));
  }

  @Get('lotes')
  @Permissao(LER)
  lotes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.listarLotes(c) }));
  }

  @Post('aih/:aih/devolver')
  @HttpCode(200)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(TRILHA)
  devolver(
    @Req() req: RequisicaoAutorizada,
    @Param('aih', ParseIntPipe) aih: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.devolver(c, aih, corpo));
  }

  @Post('aih/:aih/reenviar')
  @HttpCode(200)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(TRILHA)
  reenviar(
    @Req() req: RequisicaoAutorizada,
    @Param('aih', ParseIntPipe) aih: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.reenviar(c, aih, corpo));
  }

  @Post('aih/:aih/especial')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(TRILHA)
  especial(
    @Req() req: RequisicaoAutorizada,
    @Param('aih', ParseIntPipe) aih: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.especial(c, aih, corpo));
  }

  @Post(':id/impressao')
  @HttpCode(200)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(TRILHA)
  imprimir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.imprimir(c, id));
  }

  @Post('lotes')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(TRILHA)
  gerarLote(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gerarLote(c, corpo));
  }

  @Post('lotes/:id/enviar')
  @HttpCode(200)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(TRILHA)
  enviarLote(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.enviarLote(c, id, corpo));
  }

  @Post('lotes/:id/retornar')
  @HttpCode(200)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(TRILHA)
  retornarLote(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.retornarLote(c, id, corpo));
  }

  @Post('lotes/:id/cancelar')
  @HttpCode(200)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(TRILHA)
  cancelarLote(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.cancelarLote(c, id, corpo));
  }
}
