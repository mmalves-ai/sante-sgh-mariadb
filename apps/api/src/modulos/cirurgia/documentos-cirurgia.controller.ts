// Documentos obrigatórios antes da cirurgia, com bloqueio do início (F8, 04-CC linha 104). Rotas (porta própria; sem
// banco do cliente, 503):
//   GET  /api/cirurgia/agendamentos/:id/documentos            exigidos com o estado, histórico e digitalizados
//   POST /api/cirurgia/agendamentos/:id/documentos            { tipo, situacao, apresentadoEm?, validoAte?, ... }
//   GET  /api/cirurgia/documentos-exigidos                    tipos, regras do estabelecimento e opções
//   POST /api/cirurgia/documentos-exigidos/tipos              { codigo, descricao, categoria, validadeDias?, ... }
//   POST /api/cirurgia/documentos-exigidos/tipos/:tipo/ativo  { versao, ativo } (nada apagado)
//   POST /api/cirurgia/documentos-exigidos/regras             { tipo, procedimento?, fontePagadora?, ... }
//   POST /api/cirurgia/documentos-exigidos/regras/:regra/ativo { versao, ativo } (nada apagado)
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
  PORTA_DOCUMENTOS_CIRURGIA,
  type PortaDocumentosCirurgiaPropria,
} from './documentos-cirurgia-propria.js';

export const PERMISSOES_DOCUMENTOS_CIRURGIA = {
  ler: 'cirurgia.agenda.ler',
  registrar: 'cirurgia.agenda.agendar',
  configuracaoLer: 'cirurgia.sala.ler',
  configuracaoEditar: 'cirurgia.sala.editar',
} as const;

@Controller('cirurgia')
export class DocumentosCirurgiaController {
  constructor(
    @Optional()
    @Inject(PORTA_DOCUMENTOS_CIRURGIA)
    private readonly porta: PortaDocumentosCirurgiaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaDocumentosCirurgiaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('agendamentos/:id/documentos')
  @Permissao(PERMISSOES_DOCUMENTOS_CIRURGIA.ler)
  documentos(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.documentos(c, id));
  }

  @Post('agendamentos/:id/documentos')
  @HttpCode(200)
  @Permissao(PERMISSOES_DOCUMENTOS_CIRURGIA.registrar)
  @AuditadoNoHandler(
    'documento da cirurgia registrado pelo executor (trilha na mesma transação; histórico mantido)',
  )
  registrar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrar(c, id, corpo));
  }

  @Get('documentos-exigidos')
  @Permissao(PERMISSOES_DOCUMENTOS_CIRURGIA.configuracaoLer)
  configuracao(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.configuracao(c));
  }

  @Post('documentos-exigidos/tipos')
  @HttpCode(200)
  @Permissao(PERMISSOES_DOCUMENTOS_CIRURGIA.configuracaoEditar)
  @AuditadoNoHandler('tipo de documento pré-operatório incluído pelo executor (trilha na mesma transação)')
  incluirTipo(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirTipo(c, corpo));
  }

  @Post('documentos-exigidos/tipos/:tipo/ativo')
  @HttpCode(200)
  @Permissao(PERMISSOES_DOCUMENTOS_CIRURGIA.configuracaoEditar)
  @AuditadoNoHandler('tipo de documento pré-operatório ativado ou desativado pelo executor (nada apagado)')
  ativarTipo(
    @Req() req: RequisicaoAutorizada,
    @Param('tipo', ParseIntPipe) tipo: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.ativarTipo(c, tipo, corpo));
  }

  @Post('documentos-exigidos/regras')
  @HttpCode(200)
  @Permissao(PERMISSOES_DOCUMENTOS_CIRURGIA.configuracaoEditar)
  @AuditadoNoHandler('regra de documento exigido incluída pelo executor (trilha na mesma transação)')
  incluirRegra(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirRegra(c, corpo));
  }

  @Post('documentos-exigidos/regras/:regra/ativo')
  @HttpCode(200)
  @Permissao(PERMISSOES_DOCUMENTOS_CIRURGIA.configuracaoEditar)
  @AuditadoNoHandler('regra de documento exigido ativada ou desativada pelo executor (nada apagado)')
  ativarRegra(
    @Req() req: RequisicaoAutorizada,
    @Param('regra', ParseIntPipe) regra: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.ativarRegra(c, regra, corpo));
  }
}
