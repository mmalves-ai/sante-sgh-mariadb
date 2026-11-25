// Auditoria da profilaxia antimicrobiana cirúrgica (F8, 04-CC linha 106). Rotas (porta própria; sem banco do cliente,
// 503):
//   GET  /api/cirurgia/profilaxia/painel?de=&ate=              cirurgias do período, auditoria vigente e indicadores
//   POST /api/cirurgia/profilaxia/atos/:ato/auditar            { justificativa? } audita e grava (histórico preservado)
//   GET  /api/cirurgia/profilaxia/protocolos                   protocolos do estabelecimento e opções
//   POST /api/cirurgia/profilaxia/protocolos                   { procedimento|grupo, antimicrobiano, dose, ... }
//   POST /api/cirurgia/profilaxia/protocolos/:protocolo/ativo  { versao, ativo } (nada apagado)
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
  PORTA_PROFILAXIA_CIRURGICA,
  type PortaProfilaxiaCirurgicaPropria,
} from './profilaxia-cirurgica-propria.js';

/** A comissão de controle de infecção (CCIH) consulta e audita; o mesmo perfil mantém o protocolo. */
export const PERMISSOES_PROFILAXIA_CIRURGICA = {
  ler: 'qualidade.ccih.ler',
  registrar: 'qualidade.ccih.registrar',
} as const;

@Controller('cirurgia/profilaxia')
export class ProfilaxiaCirurgicaController {
  constructor(
    @Optional()
    @Inject(PORTA_PROFILAXIA_CIRURGICA)
    private readonly porta: PortaProfilaxiaCirurgicaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaProfilaxiaCirurgicaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('painel')
  @Permissao(PERMISSOES_PROFILAXIA_CIRURGICA.ler)
  painel(@Req() req: RequisicaoAutorizada, @Query('de') de: unknown, @Query('ate') ate: unknown) {
    return this.com(req, (p, c) => p.painel(c, { de, ate }));
  }

  @Post('atos/:ato/auditar')
  @HttpCode(200)
  @Permissao(PERMISSOES_PROFILAXIA_CIRURGICA.registrar)
  @AuditadoNoHandler('auditoria da profilaxia cirúrgica pelo executor (trilha na mesma transação)')
  auditar(@Req() req: RequisicaoAutorizada, @Param('ato', ParseIntPipe) ato: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.auditar(c, ato, corpo));
  }

  @Get('protocolos')
  @Permissao(PERMISSOES_PROFILAXIA_CIRURGICA.ler)
  protocolos(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.protocolos(c));
  }

  @Post('protocolos')
  @HttpCode(200)
  @Permissao(PERMISSOES_PROFILAXIA_CIRURGICA.registrar)
  @AuditadoNoHandler('protocolo de profilaxia incluído pelo executor (trilha na mesma transação)')
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirProtocolo(c, corpo));
  }

  @Post('protocolos/:protocolo/ativo')
  @HttpCode(200)
  @Permissao(PERMISSOES_PROFILAXIA_CIRURGICA.registrar)
  @AuditadoNoHandler(
    'protocolo de profilaxia ativado ou desativado pelo executor (trilha na mesma transação)',
  )
  ativo(
    @Req() req: RequisicaoAutorizada,
    @Param('protocolo', ParseIntPipe) protocolo: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.ativarProtocolo(c, protocolo, corpo));
  }
}
