// Comunicação da internação e da alta à operadora (F78.04-2, 04-INT linha 80). Rotas (porta própria; sem banco do
// cliente, 503):
//   GET  /api/internacao/comunicacoes-operadora/internacoes/:int        comunicações da internação (visão por paciente)
//   POST /api/internacao/comunicacoes-operadora/internacoes/:int        { tipo } nasce pendente, dos dados da internação
//   GET  /api/internacao/comunicacoes-operadora/:id/mensagem            prévia da mensagem de comunicação de beneficiário
//   POST /api/internacao/comunicacoes-operadora/:id/transicao           { acao, versao, protocolo?, resposta? }
//   POST /api/internacao/comunicacoes-operadora/:id/transmitir          { versao } sai pelo serviço web da operadora (C1-108)
//   POST /api/internacao/comunicacoes-operadora/:id/retorno             lê o retorno do serviço web e aplica (C1-108)
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
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_COMUNICACAO_OPERADORA,
  type PortaComunicacaoOperadoraPropria,
} from './comunicacao-operadora-propria.js';

export const PERMISSOES_COMUNICACAO_OPERADORA = {
  ler: 'internacao.internacao.ler',
  registrar: 'internacao.guia.editar',
} as const;
const TRILHA = 'comunicação à operadora pelo executor (trilha na mesma transação)';

@Controller('internacao/comunicacoes-operadora')
export class ComunicacaoOperadoraController {
  constructor(
    @Optional()
    @Inject(PORTA_COMUNICACAO_OPERADORA)
    private readonly porta: PortaComunicacaoOperadoraPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaComunicacaoOperadoraPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('internacoes/:int')
  @Permissao(PERMISSOES_COMUNICACAO_OPERADORA.ler)
  lista(@Req() req: RequisicaoAutorizada, @Param('int', ParseIntPipe) int: number) {
    return this.com(req, async (p, c) => ({ itens: await p.comunicacoes(c, int) }));
  }

  @Post('internacoes/:int')
  @HttpCode(201)
  @Permissao(PERMISSOES_COMUNICACAO_OPERADORA.registrar)
  @AuditadoNoHandler(TRILHA)
  registrar(
    @Req() req: RequisicaoAutorizada,
    @Param('int', ParseIntPipe) int: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.registrar(c, int, corpo));
  }

  @Get(':id/mensagem')
  @Permissao(PERMISSOES_COMUNICACAO_OPERADORA.ler)
  mensagem(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.mensagem(c, id));
  }

  @Post(':id/transicao')
  @HttpCode(200)
  @Permissao(PERMISSOES_COMUNICACAO_OPERADORA.registrar)
  @AuditadoNoHandler(TRILHA)
  transicao(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.transicao(c, id, corpo));
  }

  @Post(':id/transmitir')
  @HttpCode(200)
  @Permissao(PERMISSOES_COMUNICACAO_OPERADORA.registrar)
  @AuditadoNoHandler(TRILHA)
  transmitir(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.transmitir(c, id, corpo));
  }

  @Post(':id/retorno')
  @HttpCode(200)
  @Permissao(PERMISSOES_COMUNICACAO_OPERADORA.registrar)
  @AuditadoNoHandler(TRILHA)
  retorno(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.retorno(c, id));
  }
}
