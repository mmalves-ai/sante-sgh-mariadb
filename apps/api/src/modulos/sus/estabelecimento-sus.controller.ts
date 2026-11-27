// Habilitações, serviços e classificações SUS do estabelecimento e regras por tipo de prestador (F7, 06-SUS linha 61).
// Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/sus/estabelecimento                               o cadastro (habilitações, serviços, regras)
//   GET  /api/sus/estabelecimento/opcoes                        catálogos oficiais e cadastros do formulário
//   POST /api/sus/estabelecimento/habilitacoes                  inclui (vigência por competência; catálogo oficial)
//   POST /api/sus/estabelecimento/habilitacoes/:id/encerrar     { vigenciaFim, versao } (nada apagado)
//   POST /api/sus/estabelecimento/habilitacoes/conciliar        { competencia, habilitacoes, aplicar } (cadastro nacional)
//   GET  /api/sus/estabelecimento/cnes/conferencias             conferências com a base oficial do cadastro nacional
//   POST /api/sus/estabelecimento/cnes/conferir                 { competencia } grava remessa e críticas (C3-011)
//   POST /api/sus/estabelecimento/cnes/criticas/:id/resolver    { versao }
//   POST /api/sus/estabelecimento/servicos                      inclui serviço e classificação
//   POST /api/sus/estabelecimento/servicos/:id/encerrar         { vigenciaFim, versao }
//   POST /api/sus/estabelecimento/regras-prestador              inclui regra por tipo de prestador
//   POST /api/sus/estabelecimento/regras-prestador/:id/encerrar { vigenciaFim, versao }
//   POST /api/sus/estabelecimento/regras-servico                inclui regra do serviço automático
//   POST /api/sus/estabelecimento/regras-servico/:id/inativar   { versao }
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
  PORTA_ESTABELECIMENTO_SUS,
  type PortaEstabelecimentoSusPropria,
} from './estabelecimento-sus-propria.js';

export const PERMISSOES_ESTABELECIMENTO_SUS = {
  ler: 'faturamento.sus.ler',
  editar: 'faturamento.susCadastro.editar',
  /** A regra geral (todos os estabelecimentos do cliente) pede também esta, de administração do cliente. */
  editarGeral: 'faturamento.regraPrestadorGeral.editar',
} as const;
const podeGeral = (req: RequisicaoAutorizada): boolean =>
  (req.sgh?.sessao.permissoes ?? []).includes(PERMISSOES_ESTABELECIMENTO_SUS.editarGeral);
const TRILHA = 'cadastro SUS do estabelecimento pelo executor (trilha na mesma transação)';

@Controller('sus/estabelecimento')
export class EstabelecimentoSusController {
  constructor(
    @Optional()
    @Inject(PORTA_ESTABELECIMENTO_SUS)
    private readonly porta: PortaEstabelecimentoSusPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaEstabelecimentoSusPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.ler)
  listar(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.listar(c));
  }

  @Get('opcoes')
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.ler)
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.opcoes(c));
  }

  @Post('habilitacoes')
  @HttpCode(201)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  incluirHabilitacao(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirHabilitacao(c, corpo));
  }

  @Get('cnes/conferencias')
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.ler)
  conferenciasCnes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.conferenciasCnes(c));
  }

  @Post('cnes/conferir')
  @HttpCode(201)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  conferirCnes(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.conferirComCnes(c, corpo));
  }

  @Post('cnes/criticas/:id/resolver')
  @HttpCode(200)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  resolverCriticaCnes(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.resolverCriticaCnes(c, id, corpo));
  }

  @Post('cnes/arquivo')
  @HttpCode(200)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  carregarArquivoCnes(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.carregarArquivoCnes(c, corpo));
  }

  @Post('habilitacoes/conciliar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  conciliar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.conciliarCnes(c, corpo));
  }

  @Post('habilitacoes/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  encerrarHabilitacao(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.encerrarHabilitacao(c, id, corpo));
  }

  @Post('servicos')
  @HttpCode(201)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  incluirServico(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirServico(c, corpo));
  }

  @Post('servicos/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  encerrarServico(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.encerrarServico(c, id, corpo));
  }

  @Post('regras-prestador')
  @HttpCode(201)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  incluirRegraPrestador(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirRegraPrestador(c, corpo, podeGeral(req)));
  }

  @Post('regras-prestador/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  encerrarRegraPrestador(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.encerrarRegraPrestador(c, id, corpo, podeGeral(req)));
  }

  @Post('regras-servico')
  @HttpCode(201)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  incluirRegraServico(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirRegraServico(c, corpo));
  }

  @Post('regras-servico/:id/inativar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ESTABELECIMENTO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  inativarRegraServico(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.inativarRegraServico(c, id, corpo));
  }
}
