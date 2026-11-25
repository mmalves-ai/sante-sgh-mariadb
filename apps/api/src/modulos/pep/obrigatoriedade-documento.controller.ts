// Documentos exigidos por diagnóstico, idade ou setor (F7, 03-PEP L132). Rotas (porta própria; sem banco do cliente,
// 503):
//   GET  /api/pep/documentos-exigidos/pendencias?setor=&vencidas=   lista do profissional (atendimentos abertos)
//   GET  /api/pep/documentos-exigidos/atendimentos/:atendimento     visão por paciente (um atendimento)
//   GET  /api/pep/documentos-exigidos/regras                        cadastro das regras e opções da tela
//   POST /api/pep/documentos-exigidos/regras                        { modelo, momento, cids, ... } inclui
//   POST /api/pep/documentos-exigidos/regras/:regra                 { versao, ... } altera (CID retirado fica marcado)
//   POST /api/pep/documentos-exigidos/regras/:regra/ativo           { versao, ativo } (nada apagado)
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
  PORTA_OBRIGATORIEDADE_DOCUMENTO,
  type PortaObrigatoriedadeDocumentoPropria,
} from './obrigatoriedade-documento-propria.js';

/** O profissional lê a lista pelo acesso ao prontuário; a administração do PEP mantém as regras. */
export const PERMISSOES_OBRIGATORIEDADE_DOCUMENTO = {
  pendencias: 'pep.prontuario.ler',
  regrasLer: 'pep.admin.ler',
  regrasEditar: 'pep.admin.editar',
} as const;

@Controller('pep/documentos-exigidos')
export class ObrigatoriedadeDocumentoController {
  constructor(
    @Optional()
    @Inject(PORTA_OBRIGATORIEDADE_DOCUMENTO)
    private readonly porta: PortaObrigatoriedadeDocumentoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaObrigatoriedadeDocumentoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('pendencias')
  @Permissao(PERMISSOES_OBRIGATORIEDADE_DOCUMENTO.pendencias)
  pendencias(@Req() req: RequisicaoAutorizada, @Query() consulta: unknown) {
    return this.com(req, (p, c) => p.pendencias(c, consulta));
  }

  @Get('atendimentos/:atendimento')
  @Permissao(PERMISSOES_OBRIGATORIEDADE_DOCUMENTO.pendencias)
  doAtendimento(@Req() req: RequisicaoAutorizada, @Param('atendimento', ParseIntPipe) atendimento: number) {
    return this.com(req, (p, c) => p.pendenciasDoAtendimento(c, atendimento));
  }

  @Get('regras')
  @Permissao(PERMISSOES_OBRIGATORIEDADE_DOCUMENTO.regrasLer)
  regras(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.regras(c));
  }

  @Post('regras')
  @HttpCode(200)
  @Permissao(PERMISSOES_OBRIGATORIEDADE_DOCUMENTO.regrasEditar)
  @AuditadoNoHandler('regra de documento exigido incluída pelo executor (trilha na mesma transação)')
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluir(c, corpo));
  }

  @Post('regras/:regra')
  @HttpCode(200)
  @Permissao(PERMISSOES_OBRIGATORIEDADE_DOCUMENTO.regrasEditar)
  @AuditadoNoHandler('regra de documento exigido alterada pelo executor (trilha na mesma transação)')
  alterar(
    @Req() req: RequisicaoAutorizada,
    @Param('regra', ParseIntPipe) regra: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alterar(c, regra, corpo));
  }

  @Post('regras/:regra/ativo')
  @HttpCode(200)
  @Permissao(PERMISSOES_OBRIGATORIEDADE_DOCUMENTO.regrasEditar)
  @AuditadoNoHandler(
    'regra de documento exigido ativada ou desativada pelo executor (trilha na mesma transação)',
  )
  ativo(
    @Req() req: RequisicaoAutorizada,
    @Param('regra', ParseIntPipe) regra: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.ativar(c, regra, corpo));
  }
}
