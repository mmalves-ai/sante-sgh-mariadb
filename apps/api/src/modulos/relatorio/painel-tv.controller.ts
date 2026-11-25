// Rotas dos painéis de TV operacionais (01-REL L116; F3; sem chave de liberação: só a permissão):
//   GET    /api/relatorios/paineis-tv/catalogo                    tipos, unidades intensivas, salas e televisores
//   GET    /api/relatorios/paineis-tv                             os painéis do estabelecimento (blocos, TVs, no ar)
//   GET    /api/relatorios/paineis-tv/:id                         o painel com os blocos e os televisores
//   GET    /api/relatorios/paineis-tv/:id/tela                    o que a TV mostra (só iniciais, números e tempos)
//   POST   /api/relatorios/paineis-tv                             cria o painel (rascunho)
//   PUT    /api/relatorios/paineis-tv/:id                         salva dados e blocos de uma vez
//   POST   /api/relatorios/paineis-tv/:id/situacao                ativa, suspende ou inativa (nada é apagado)
//   POST   /api/relatorios/paineis-tv/:id/televisores             liga um televisor e gera o código de pareamento
//   POST   /api/relatorios/paineis-tv/:id/televisores/:tv/desligar desliga o televisor (fica no histórico)
//   POST   /api/relatorios/paineis-tv/parear                      a TV digita o código uma vez
//   POST   /api/relatorios/paineis-tv/televisores/:tv/contato     a TV pareada avisa que está no ar
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
  Put,
  Req,
} from '@nestjs/common';
import { PERMISSOES_M34_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import type { ContextoComunicacao } from '../integracao/comunicacao-base-propria.js';
import { PORTA_PAINEL_TV, type PortaPainelTvPropria } from './painel-tv-propria.js';

const TRILHA =
  'cadastro do painel de TV, dos blocos e dos televisores, pareamento e contato pelo executor (trilha na mesma transação)';

const ipDe = (req: RequisicaoAutorizada): string | null => (req as { ip?: string }).ip ?? null;

@Controller('relatorios/paineis-tv')
export class PainelTvController {
  constructor(
    @Optional()
    @Inject(PORTA_PAINEL_TV)
    private readonly porta: PortaPainelTvPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaPainelTvPropria, c: ContextoComunicacao) => Promise<T>,
  ): Promise<T> {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta as ContextoComunicacao).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('catalogo')
  @Permissao(P.painelTvEditar)
  catalogo(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.catalogo(c));
  }

  @Get()
  @Permissao(P.painelTvExibir)
  paineis(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.paineis(c) }));
  }

  @Get(':id')
  @Permissao(P.painelTvEditar)
  detalhe(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.detalhe(c, id));
  }

  @Get(':id/tela')
  @Permissao(P.painelTvExibir)
  tela(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.tela(c, id));
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.painelTvEditar)
  @AuditadoNoHandler(TRILHA)
  criar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.criar(c, corpo));
  }

  @Put(':id')
  @HttpCode(200)
  @Permissao(P.painelTvEditar)
  @AuditadoNoHandler(TRILHA)
  salvar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvar(c, id, corpo));
  }

  @Post(':id/situacao')
  @HttpCode(200)
  @Permissao(P.painelTvEditar)
  @AuditadoNoHandler(TRILHA)
  situacao(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.mudarSituacao(c, id, corpo));
  }

  @Post(':id/televisores')
  @HttpCode(201)
  @Permissao(P.painelTvEditar)
  @AuditadoNoHandler(TRILHA)
  ligar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.ligarDispositivo(c, id, corpo));
  }

  @Post(':id/televisores/:tv/desligar')
  @HttpCode(200)
  @Permissao(P.painelTvEditar)
  @AuditadoNoHandler(TRILHA)
  desligar(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Param('tv', ParseIntPipe) tv: number,
  ) {
    return this.com(req, (p, c) => p.desligarDispositivo(c, id, tv));
  }

  @Post('parear')
  @HttpCode(200)
  @Permissao(P.painelTvExibir)
  @AuditadoNoHandler(TRILHA)
  parear(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.parear(c, corpo, ipDe(req)));
  }

  @Post('televisores/:tv/contato')
  @HttpCode(200)
  @Permissao(P.painelTvExibir)
  @AuditadoNoHandler(TRILHA)
  contato(@Req() req: RequisicaoAutorizada, @Param('tv', ParseIntPipe) tv: number) {
    return this.com(req, (p, c) => p.contato(c, tv, ipDe(req)));
  }
}
