// Programação físico-orçamentária, tetos financeiros e cotas do SUS (F7, 06-SUS linha 54). Rotas (porta própria; sem banco
// do cliente, 503):
//   GET  /api/sus/programacao?competencia=AAAAMM        painel: programações, saldo de cada limite e remanejamentos
//   GET  /api/sus/programacao/opcoes                    contratos com o gestor e setores
//   GET  /api/sus/programacao/:id/itens                 metas da programação
//   POST /api/sus/programacao                           importa o arquivo da programação (rascunho)
//   POST /api/sus/programacao/:id/ativar                { versao } (a anterior do contrato termina na véspera)
//   POST /api/sus/programacao/:id/cancelar              { versao } (só o rascunho; nada apagado)
//   POST /api/sus/programacao/limites                   inclui teto ou cota
//   POST /api/sus/programacao/limites/:tipo/:id/inativar { versao }
//   POST /api/sus/programacao/cotas/:id/remanejar       pede o remanejamento (setor ou município)
//   POST /api/sus/programacao/remanejamentos/:id/decidir { aprovar, competencia, versao } (outra pessoa)
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
import { PORTA_PROGRAMACAO_SUS, type PortaProgramacaoSusPropria } from './programacao-propria.js';

export const PERMISSOES_PROGRAMACAO_SUS = {
  ler: 'faturamento.susProgramacao.ler',
  editar: 'faturamento.susProgramacao.editar',
  aprovar: 'faturamento.susProgramacao.aprovar',
} as const;
const TRILHA = 'programação físico-orçamentária, teto e cota SUS pelo executor (trilha na mesma transação)';

const competenciaAtual = () => {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  return hoje.slice(0, 4) + hoje.slice(5, 7);
};

@Controller('sus/programacao')
export class ProgramacaoSusController {
  constructor(
    @Optional()
    @Inject(PORTA_PROGRAMACAO_SUS)
    private readonly porta: PortaProgramacaoSusPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaProgramacaoSusPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_PROGRAMACAO_SUS.ler)
  painel(@Req() req: RequisicaoAutorizada, @Query('competencia') competencia?: string) {
    return this.com(req, (p, c) => p.painel(c, (competencia ?? '').trim() || competenciaAtual()));
  }

  @Get('opcoes')
  @Permissao(PERMISSOES_PROGRAMACAO_SUS.ler)
  opcoes(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.opcoes(c));
  }

  @Get(':id/itens')
  @Permissao(PERMISSOES_PROGRAMACAO_SUS.ler)
  itens(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, async (p, c) => ({ itens: await p.itens(c, id) }));
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSOES_PROGRAMACAO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  importar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.importar(c, corpo));
  }

  @Post(':id/ativar')
  @HttpCode(200)
  @Permissao(PERMISSOES_PROGRAMACAO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  ativar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.ativar(c, id, corpo));
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_PROGRAMACAO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  cancelar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.cancelar(c, id, corpo));
  }

  @Post('limites')
  @HttpCode(201)
  @Permissao(PERMISSOES_PROGRAMACAO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  incluirLimite(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirLimite(c, corpo));
  }

  @Post('limites/:tipo/:id/inativar')
  @HttpCode(200)
  @Permissao(PERMISSOES_PROGRAMACAO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  inativarLimite(
    @Req() req: RequisicaoAutorizada,
    @Param('tipo') tipo: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    if (tipo !== 'teto' && tipo !== 'cota')
      throw new ErroProblema('registro-inexistente', 404, 'Limite inexistente');
    return this.com(req, (p, c) => p.inativarLimite(c, tipo, id, corpo));
  }

  @Post('cotas/:id/remanejar')
  @HttpCode(201)
  @Permissao(PERMISSOES_PROGRAMACAO_SUS.editar)
  @AuditadoNoHandler(TRILHA)
  remanejar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.solicitarRemanejamento(c, id, corpo));
  }

  @Post('remanejamentos/:id/decidir')
  @HttpCode(200)
  @Permissao(PERMISSOES_PROGRAMACAO_SUS.aprovar)
  @AuditadoNoHandler(TRILHA)
  decidir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.decidirRemanejamento(c, id, corpo));
  }
}
