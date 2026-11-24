// Favorecidos do repasse e prestadores terceiros (F3.7, 06-FAT linha 46). Rotas (porta própria; sem banco do
// cliente, 503):
//   GET  /api/repasse/favorecidos?profissional=        favorecidos (vigentes e encerrados) do profissional ou de todos
//   GET  /api/repasse/favorecidos/alvos?tipo=&busca=   empresas, cooperativas ou profissionais para apontar
//   GET  /api/repasse/favorecidos/contas?profissional= contas de crédito ativas (documento só com o final)
//   POST /api/repasse/favorecidos                      inclui; o anterior do mesmo tipo e fonte termina no dia de antes
//   POST /api/repasse/favorecidos/:id/encerrar         { versao, fim } encerra a vigência (nada apagado)
//   GET  /api/repasse/prestadores-terceiros?busca=     prestadores terceiros (ativos primeiro)
//   POST /api/repasse/prestadores-terceiros            inclui o prestador (documento, CNES, percentual, base)
//   POST /api/repasse/prestadores-terceiros/:id        { versao, ativo?, percentualRepasse?, baseRepasse?, ... }
// O acesso é o do cargo que mantém cooperativas e credenciamentos do repasse; nada depende de chave de liberação.
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
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_FAVORECIDOS_REPASSE, type PortaFavorecidosRepassePropria } from './favorecidos-propria.js';

export const PERMISSOES_FAVORECIDOS_REPASSE = {
  ler: 'repasse.cooperativa.ler',
  editar: 'repasse.cooperativa.editar',
} as const;

const idOuNulo = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, 'Parâmetro inválido');
  return n;
};

@Controller('repasse')
export class FavorecidosRepasseController {
  constructor(
    @Optional()
    @Inject(PORTA_FAVORECIDOS_REPASSE)
    private readonly porta: PortaFavorecidosRepassePropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaFavorecidosRepassePropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('favorecidos')
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.ler)
  favorecidos(@Req() req: RequisicaoAutorizada, @Query('profissional') profissional?: string) {
    return this.com(req, async (p, c) => ({ itens: await p.listarFavorecidos(c, idOuNulo(profissional)) }));
  }

  @Get('favorecidos/alvos')
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.ler)
  alvos(@Req() req: RequisicaoAutorizada, @Query('tipo') tipo?: string, @Query('busca') busca?: string) {
    if (tipo !== 'pessoa_juridica' && tipo !== 'cooperativa' && tipo !== 'terceiro_profissional')
      throw new ErroProblema('entrada-invalida', 400, 'Tipo de favorecido inválido');
    return this.com(req, async (p, c) => ({ itens: await p.listarAlvos(c, tipo, busca ?? '') }));
  }

  @Get('favorecidos/contas')
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.ler)
  contas(@Req() req: RequisicaoAutorizada, @Query('profissional') profissional?: string) {
    const id = idOuNulo(profissional);
    if (id === null) throw new ErroProblema('entrada-invalida', 400, 'Informe o profissional');
    return this.com(req, async (p, c) => ({ itens: await p.listarContas(c, id) }));
  }

  @Post('favorecidos')
  @HttpCode(201)
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.editar)
  incluirFavorecido(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirFavorecido(c, corpo));
  }

  @Post('favorecidos/:id/encerrar')
  @HttpCode(200)
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.editar)
  encerrarFavorecido(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.encerrarFavorecido(c, id, corpo));
  }

  @Get('prestadores-terceiros')
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.ler)
  prestadores(@Req() req: RequisicaoAutorizada, @Query('busca') busca?: string) {
    return this.com(req, async (p, c) => ({ itens: await p.listarPrestadores(c, busca ?? null) }));
  }

  @Post('prestadores-terceiros')
  @HttpCode(201)
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.editar)
  incluirPrestador(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirPrestador(c, corpo));
  }

  @Post('prestadores-terceiros/:id')
  @HttpCode(200)
  @Permissao(PERMISSOES_FAVORECIDOS_REPASSE.editar)
  alterarPrestador(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alterarPrestador(c, id, corpo));
  }
}
