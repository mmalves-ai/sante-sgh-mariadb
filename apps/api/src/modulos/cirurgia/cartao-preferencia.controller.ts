// Cartão de preferência do cirurgião (F8, 04-CC linha 105). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/cirurgia/cartoes-preferencia?cirurgiao=                       os cartões (com os fora de uso)
//   GET  /api/cirurgia/cartoes-preferencia/apoio                            as escolhas da tela por nome
//   GET  /api/cirurgia/cartoes-preferencia/produtos?busca=                  busca de produto do estoque (3+ letras)
//   GET  /api/cirurgia/cartoes-preferencia/aplicavel?cirurgiao=&procedimento=&data= o cartão que vale na data do
//                                                                           ato, a sugestão para o mapa e os produtos
//                                                                           para o gasto de sala
//   POST /api/cirurgia/cartoes-preferencia                                  inclui
//   PUT  /api/cirurgia/cartoes-preferencia/:id                              altera com a versão lida
//   POST /api/cirurgia/cartoes-preferencia/:id/uso                          { ativo, versao } (nada apagado)
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
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_CARTAO_PREFERENCIA,
  type PortaCartaoPreferenciaPropria,
  type QuemGravaCartao,
} from './cartao-preferencia-propria.js';

export const PERMISSOES_CARTAO_PREFERENCIA = {
  ler: 'cirurgia.registro.ler',
  editar: 'cirurgia.registro.criar',
  /** Quem administra o bloco (a mesma do texto padrão pessoal) mantém o cartão de qualquer cirurgião. */
  gerirDeOutro: 'cirurgia.agenda.excecao',
} as const;

const idOuNulo = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, 'Parâmetro inválido');
  return n;
};

@Controller('cirurgia/cartoes-preferencia')
export class CartaoPreferenciaController {
  constructor(
    @Optional()
    @Inject(PORTA_CARTAO_PREFERENCIA)
    private readonly porta: PortaCartaoPreferenciaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (
      p: PortaCartaoPreferenciaPropria,
      c: ReturnType<typeof sessaoDe>['porta'],
      quem: QuemGravaCartao,
    ) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta, { gestor: s.pode(PERMISSOES_CARTAO_PREFERENCIA.gerirDeOutro) }).catch(
      (e: unknown) => {
        throw problemaDoCadastro(e);
      },
    );
  }

  @Get()
  @Permissao(PERMISSOES_CARTAO_PREFERENCIA.ler)
  listar(@Req() req: RequisicaoAutorizada, @Query('cirurgiao') cirurgiao?: string) {
    return this.com(req, async (p, c) => ({ itens: await p.listar(c, { cirurgiao: idOuNulo(cirurgiao) }) }));
  }

  @Get('apoio')
  @Permissao(PERMISSOES_CARTAO_PREFERENCIA.ler)
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.apoio(c));
  }

  @Get('produtos')
  @Permissao(PERMISSOES_CARTAO_PREFERENCIA.ler)
  produtos(@Req() req: RequisicaoAutorizada, @Query('busca') busca?: string) {
    return this.com(req, (p, c) => p.produtos(c, String(busca ?? '').slice(0, 60)));
  }

  @Get('aplicavel')
  @Permissao(PERMISSOES_CARTAO_PREFERENCIA.ler)
  aplicavel(
    @Req() req: RequisicaoAutorizada,
    @Query('cirurgiao') cirurgiao?: string,
    @Query('procedimento') procedimento?: string,
    @Query('data') data?: string,
  ) {
    const cir = idOuNulo(cirurgiao);
    if (cir === null) throw new ErroProblema('entrada-invalida', 400, 'Informe o cirurgião');
    if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data))
      throw new ErroProblema('entrada-invalida', 400, 'Data do ato inválida (AAAA-MM-DD)');
    return this.com(req, (p, c) => p.aplicavel(c, cir, idOuNulo(procedimento), data || null));
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSOES_CARTAO_PREFERENCIA.editar)
  @AuditadoNoHandler('cartão de preferência pelo executor (trilha na mesma transação)')
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c, q) => p.incluir(c, corpo, q));
  }

  @Put(':id')
  @Permissao(PERMISSOES_CARTAO_PREFERENCIA.editar)
  @AuditadoNoHandler('cartão de preferência pelo executor (trilha na mesma transação)')
  alterar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c, q) => p.alterar(c, id, corpo, q));
  }

  @Post(':id/uso')
  @HttpCode(200)
  @Permissao(PERMISSOES_CARTAO_PREFERENCIA.editar)
  @AuditadoNoHandler('cartão de preferência pelo executor (trilha na mesma transação)')
  uso(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c, q) => p.definirUso(c, id, corpo, q));
  }
}
