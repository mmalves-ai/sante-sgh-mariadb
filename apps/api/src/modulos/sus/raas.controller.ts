// RAAS da atenção psicossocial e da atenção domiciliar (F8, 06-SUS linha 64). Rotas (porta própria; sem banco do
// cliente, 503):
//   GET  /api/sus/raas?competencia=AAAAMM&tipo=&paciente=   painel: registros e remessas (ou a visão do paciente)
//   GET  /api/sus/raas/opcoes                               destinos do paciente (motivo de saída)
//   GET  /api/sus/raas/pacientes?busca=                     busca por prontuário ou nome
//   GET  /api/sus/raas/registros/:id                        registro com as ações e as críticas
//   POST /api/sus/raas/registros                            inclui o registro (competência aberta aqui se faltar)
//   POST /api/sus/raas/registros/:id/acoes                  lança a ação { ..., versao }
//   POST /api/sus/raas/acoes/:id/retirar                    { versao } (marca excluído; nada apagado)
//   POST /api/sus/raas/registros/:id/concluir               { dataConclusao, destino, versao }
//   POST /api/sus/raas/registros/:id/continuar              { versao } (registro na competência seguinte)
//   POST /api/sus/raas/criticar                             { competencia, tipo }
//   POST /api/sus/raas/remessas                             { competencia, tipo, orgaoDestino, indicadorDestino }
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
import { TIPOS_RAAS, type TipoRaas } from '@sgh/dominio-faturamento';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_RAAS, type PortaRaasPropria } from './raas-propria.js';

export const PERMISSOES_RAAS = {
  ler: 'faturamento.susRaas.ler',
  registrar: 'faturamento.susRaas.registrar',
  gerar: 'faturamento.susRaas.gerar',
} as const;
const TRILHA = 'registro, ação, crítica e remessa RAAS pelo executor (trilha na mesma transação)';

const competenciaAtual = () => {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  return hoje.slice(0, 4) + hoje.slice(5, 7);
};

@Controller('sus/raas')
export class RaasSusController {
  constructor(
    @Optional()
    @Inject(PORTA_RAAS)
    private readonly porta: PortaRaasPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaRaasPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_RAAS.ler)
  painel(
    @Req() req: RequisicaoAutorizada,
    @Query('competencia') competencia?: string,
    @Query('tipo') tipo?: string,
    @Query('paciente') paciente?: string,
  ) {
    const t = TIPOS_RAAS.includes(tipo as TipoRaas) ? (tipo as TipoRaas) : null;
    const p = /^\d+$/.test(paciente ?? '') ? Number(paciente) : null;
    return this.com(req, (x, c) => x.painel(c, (competencia ?? '').trim() || competenciaAtual(), t, p));
  }

  @Get('opcoes')
  @Permissao(PERMISSOES_RAAS.ler)
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.opcoes(c));
  }

  @Get('pacientes')
  @Permissao(PERMISSOES_RAAS.ler)
  pacientes(@Req() req: RequisicaoAutorizada, @Query('busca') busca?: string) {
    return this.com(req, async (p, c) => ({ pacientes: await p.buscarPacientes(c, busca ?? '') }));
  }

  @Get('registros/:id')
  @Permissao(PERMISSOES_RAAS.ler)
  detalhe(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.detalhe(c, id));
  }

  @Post('registros')
  @HttpCode(201)
  @Permissao(PERMISSOES_RAAS.registrar)
  @AuditadoNoHandler(TRILHA)
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirRegistro(c, corpo));
  }

  @Post('registros/:id/acoes')
  @HttpCode(201)
  @Permissao(PERMISSOES_RAAS.registrar)
  @AuditadoNoHandler(TRILHA)
  lancar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.lancarAcao(c, id, corpo));
  }

  @Post('acoes/:id/retirar')
  @HttpCode(200)
  @Permissao(PERMISSOES_RAAS.registrar)
  @AuditadoNoHandler(TRILHA)
  retirar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.retirarAcao(c, id, corpo));
  }

  @Post('registros/:id/concluir')
  @HttpCode(200)
  @Permissao(PERMISSOES_RAAS.registrar)
  @AuditadoNoHandler(TRILHA)
  concluir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.concluir(c, id, corpo));
  }

  @Post('registros/:id/continuar')
  @HttpCode(201)
  @Permissao(PERMISSOES_RAAS.registrar)
  @AuditadoNoHandler(TRILHA)
  continuar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.continuar(c, id, corpo));
  }

  @Post('criticar')
  @HttpCode(200)
  @Permissao(PERMISSOES_RAAS.registrar)
  @AuditadoNoHandler(TRILHA)
  criticar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.criticar(c, corpo));
  }

  @Post('remessas')
  @HttpCode(201)
  @Permissao(PERMISSOES_RAAS.gerar)
  @AuditadoNoHandler(TRILHA)
  gerar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gerarRemessa(c, corpo));
  }
}
