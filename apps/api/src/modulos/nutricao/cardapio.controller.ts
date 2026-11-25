// Cardápio do serviço de nutrição e dietética (F8, 04-HOT linha 141). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/nutricao/cardapio/cadastros                       refeições, opções, dietas, unidades e tipos
//   GET  /api/nutricao/cardapio/generos?termo=                  gêneros do estoque para a ficha técnica
//   GET  /api/nutricao/cardapio/preparacoes?termo=              preparações com o custo da porção
//   GET  /api/nutricao/cardapio/preparacoes/:id                 a preparação com a ficha técnica
//   POST /api/nutricao/cardapio/preparacoes                     cria ou altera (com a versão) a preparação e a ficha
//   GET  /api/nutricao/cardapio/planejamentos?de=&ate=          os planejamentos que cruzam o período
//   GET  /api/nutricao/cardapio/planejamentos/:id               o planejamento com as preparações por dia e opção
//   POST /api/nutricao/cardapio/planejamentos                   cria ou altera o rascunho
//   POST /api/nutricao/cardapio/planejamentos/:id/acao          enviar, devolver, publicar ou cancelar
//   POST /api/nutricao/cardapio/planejamentos/:id/aprovar       aprovação pela nutricionista (conselho ativo)
//   GET  /api/nutricao/cardapio/planejamentos/:id/producao?data=&margem=   previsão da produção do dia
//   GET  /api/nutricao/cardapio/dia?data=&refeicao=&internacao=  o cardápio publicado do dia e as escolhas
//   GET  /api/nutricao/cardapio/comensais?data=&refeicao=      internados ativos (nome, leito, dieta, jejum, acompanhantes)
//   POST /api/nutricao/cardapio/escolhas                        registra a escolha do paciente ou do acompanhante
//   POST /api/nutricao/cardapio/escolhas/:id/cancelar           { versao }
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
import { PERMISSOES_NUTRICAO_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_CARDAPIO, type PortaCardapioPropria } from './cardapio-propria.js';

export const PERMISSOES_CARDAPIO = {
  ler: P.mapaLer,
  /** O serviço de nutrição e dietética (quem fecha o mapa) mantém as preparações e planeja o cardápio. */
  planejar: P.mapaFechar,
  /** A aprovação é da nutricionista com o conselho ativo (Resolução CFN 600/2018). */
  aprovar: P.nutricaoTriar,
  /** A copa registra a escolha à beira do leito. */
  escolher: P.mapaImprimir,
} as const;

const AUDITORIA = 'cardápio do serviço de nutrição pelo executor (trilha na mesma transação)';
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function data(v: string | undefined, campo: string): string {
  if (!DATA.test(v ?? '')) throw new ErroProblema('entrada-invalida', 400, `Informe ${campo} (AAAA-MM-DD)`);
  return v as string;
}

@Controller('nutricao/cardapio')
export class CardapioController {
  constructor(
    @Optional()
    @Inject(PORTA_CARDAPIO)
    private readonly porta: PortaCardapioPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaCardapioPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('cadastros')
  @Permissao(PERMISSOES_CARDAPIO.ler)
  cadastros(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.cadastros(c));
  }

  @Get('generos')
  @Permissao(PERMISSOES_CARDAPIO.ler)
  generos(@Req() req: RequisicaoAutorizada, @Query('termo') termo?: string) {
    const t = (termo ?? '').trim().slice(0, 60);
    if (t.length < 2) throw new ErroProblema('entrada-invalida', 400, 'Digite ao menos 2 letras do gênero');
    return this.com(req, async (p, c) => ({ itens: await p.generos(c, t) }));
  }

  @Get('preparacoes')
  @Permissao(PERMISSOES_CARDAPIO.ler)
  preparacoes(@Req() req: RequisicaoAutorizada, @Query('termo') termo?: string) {
    return this.com(req, async (p, c) => ({
      itens: await p.preparacoes(c, (termo ?? '').trim().slice(0, 60)),
    }));
  }

  @Get('preparacoes/:id')
  @Permissao(PERMISSOES_CARDAPIO.ler)
  preparacao(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.preparacao(c, id));
  }

  @Post('preparacoes')
  @HttpCode(200)
  @Permissao(PERMISSOES_CARDAPIO.planejar)
  @AuditadoNoHandler(AUDITORIA)
  salvarPreparacao(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvarPreparacao(c, corpo));
  }

  @Get('planejamentos')
  @Permissao(PERMISSOES_CARDAPIO.ler)
  planejamentos(@Req() req: RequisicaoAutorizada, @Query('de') de?: string, @Query('ate') ate?: string) {
    const q = { de: data(de, 'o início'), ate: data(ate, 'o fim') };
    return this.com(req, async (p, c) => ({ itens: await p.planejamentos(c, q) }));
  }

  @Get('planejamentos/:id')
  @Permissao(PERMISSOES_CARDAPIO.ler)
  planejamento(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.planejamento(c, id));
  }

  @Post('planejamentos')
  @HttpCode(200)
  @Permissao(PERMISSOES_CARDAPIO.planejar)
  @AuditadoNoHandler(AUDITORIA)
  salvarPlanejamento(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvarPlanejamento(c, corpo));
  }

  @Post('planejamentos/:id/acao')
  @HttpCode(200)
  @Permissao(PERMISSOES_CARDAPIO.planejar)
  @AuditadoNoHandler(AUDITORIA)
  agir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    if ((corpo as { acao?: unknown } | null)?.acao === 'aprovar')
      throw new ErroProblema('entrada-invalida', 400, 'A aprovação é pela rota da nutricionista (aprovar)');
    return this.com(req, (p, c) => p.agir(c, id, corpo));
  }

  @Post('planejamentos/:id/aprovar')
  @HttpCode(200)
  @Permissao(PERMISSOES_CARDAPIO.aprovar)
  @AuditadoNoHandler(AUDITORIA)
  aprovar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    const versao = (corpo as { versao?: unknown } | null)?.versao;
    return this.com(req, (p, c) => p.agir(c, id, { acao: 'aprovar', versao }));
  }

  @Get('planejamentos/:id/producao')
  @Permissao(PERMISSOES_CARDAPIO.ler)
  producao(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Query('data') dia?: string,
    @Query('margem') margem?: string,
  ) {
    const d = data(dia, 'o dia');
    const m = margem === undefined || margem === '' ? 5 : Number(margem);
    if (!Number.isFinite(m) || m < 0 || m > 30)
      throw new ErroProblema('entrada-invalida', 400, 'A margem de segurança fica entre 0 e 30%');
    return this.com(req, (p, c) => p.producao(c, id, d, m));
  }

  @Get('dia')
  @Permissao(PERMISSOES_CARDAPIO.ler)
  dia(
    @Req() req: RequisicaoAutorizada,
    @Query('data') dia?: string,
    @Query('refeicao') refeicao?: string,
    @Query('internacao') internacao?: string,
  ) {
    const r = Number(refeicao);
    const i = internacao ? Number(internacao) : null;
    if (!Number.isInteger(r) || r <= 0 || (i !== null && (!Number.isInteger(i) || i <= 0)))
      throw new ErroProblema('entrada-invalida', 400, 'Informe a refeição (e a internação, quando houver)');
    const q = { data: data(dia, 'o dia'), refeicao: r, internacao: i };
    return this.com(req, (p, c) => p.cardapioDoDia(c, q));
  }

  @Get('comensais')
  @Permissao(PERMISSOES_CARDAPIO.ler)
  comensais(
    @Req() req: RequisicaoAutorizada,
    @Query('data') dia?: string,
    @Query('refeicao') refeicao?: string,
  ) {
    const r = Number(refeicao);
    if (!Number.isInteger(r) || r <= 0) throw new ErroProblema('entrada-invalida', 400, 'Informe a refeição');
    const q = { data: data(dia, 'o dia'), refeicao: r };
    return this.com(req, (p, c) => p.comensais(c, q));
  }

  @Post('escolhas')
  @HttpCode(201)
  @Permissao(PERMISSOES_CARDAPIO.escolher)
  @AuditadoNoHandler(AUDITORIA)
  escolher(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrarEscolha(c, corpo));
  }

  @Post('escolhas/:id/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_CARDAPIO.escolher)
  @AuditadoNoHandler(AUDITORIA)
  cancelarEscolha(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    const versao = Number((corpo as { versao?: unknown } | null)?.versao);
    if (!Number.isInteger(versao) || versao <= 0)
      throw new ErroProblema('entrada-invalida', 400, 'Informe a versão lida');
    return this.com(req, (p, c) => p.cancelarEscolha(c, id, versao));
  }
}
