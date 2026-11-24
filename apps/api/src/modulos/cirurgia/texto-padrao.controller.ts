// Texto padrão da descrição cirúrgica (F3.4, 04-CC linha 91). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/cirurgia/textos-padrao                                    todos (cadastro, com os inativos)
//   GET  /api/cirurgia/textos-padrao/descricao?procedimento=&cirurgiao= os que a descrição oferece, na ordem do domínio
//   POST /api/cirurgia/textos-padrao                                    inclui
//   PUT  /api/cirurgia/textos-padrao/:id                                altera com a versão lida
//   POST /api/cirurgia/textos-padrao/:id/uso                            { ativo, versao } tira de uso ou volta (nada apagado)
//   POST /api/cirurgia/textos-padrao/:id/preencher                      { valores } texto preenchido e campos que faltam
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
  Query,
  Req,
} from '@nestjs/common';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_TEXTO_PADRAO_CIRURGIA, type PortaTextoPadraoCirurgiaPropria } from './texto-padrao-propria.js';

export const PERMISSOES_TEXTO_PADRAO = {
  ler: 'cirurgia.registro.ler',
  editar: 'cirurgia.registro.criar',
} as const;

const idOuNulo = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, 'Parâmetro inválido');
  return n;
};

@Controller('cirurgia/textos-padrao')
export class TextoPadraoCirurgiaController {
  constructor(
    @Optional()
    @Inject(PORTA_TEXTO_PADRAO_CIRURGIA)
    private readonly porta: PortaTextoPadraoCirurgiaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaTextoPadraoCirurgiaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_TEXTO_PADRAO.ler)
  listar(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.listar(c, {}) }));
  }

  @Get('descricao')
  @Permissao(PERMISSOES_TEXTO_PADRAO.ler)
  paraDescricao(
    @Req() req: RequisicaoAutorizada,
    @Query('procedimento') procedimento?: string,
    @Query('cirurgiao') cirurgiao?: string,
  ) {
    return this.com(req, async (p, c) => ({
      itens: await p.listar(c, {
        paraDescricao: true,
        procedimento: idOuNulo(procedimento),
        cirurgiao: idOuNulo(cirurgiao),
      }),
    }));
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSOES_TEXTO_PADRAO.editar)
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluir(c, corpo));
  }

  @Put(':id')
  @Permissao(PERMISSOES_TEXTO_PADRAO.editar)
  alterar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.alterar(c, id, corpo));
  }

  @Post(':id/uso')
  @HttpCode(200)
  @Permissao(PERMISSOES_TEXTO_PADRAO.editar)
  uso(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.definirUso(c, id, corpo));
  }

  @Post(':id/preencher')
  @HttpCode(200)
  @Permissao(PERMISSOES_TEXTO_PADRAO.ler)
  preencher(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.preencher(c, id, corpo));
  }
}
