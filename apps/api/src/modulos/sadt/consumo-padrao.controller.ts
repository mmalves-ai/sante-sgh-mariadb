// Consumo padrão de insumos por exame (F8, 05-SADT linha 22). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/sadt/consumo-padrao/apoio?busca=              locais de estoque, kits e produtos ativos (busca 3+ letras)
//   GET  /api/sadt/consumo-padrao?exame=                    os consumos padrão com os itens vivos
//   POST /api/sadt/consumo-padrao                           inclui ou altera (com id e versão) o consumo e os itens
//   GET  /api/sadt/consumo-padrao/pendentes?setor=          exames recentes com consumo padrão ainda não baixado
//   GET  /api/sadt/consumo-padrao/exames/:item              a sugestão da realização (kit aberto, cobrável, já baixado)
//   POST /api/sadt/consumo-padrao/exames/:item/realizar     { local, ajustes } baixa no estoque e lança na conta
// Cadastro: `sadt.catalogo.ler` / `sadt.catalogo.editar`. Realização: quem lança o exame no setor
// (`sadt.lancamento.ler` / `sadt.lancamento.lancar`); o motor do estoque confere ainda a permissão do usuário no local.
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
import { CONSUMO_PADRAO_EXAME, type PortaConsumoPadraoExamePropria } from './consumo-padrao-propria.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';

export const PERMISSOES_CONSUMO_PADRAO = {
  ler: 'sadt.catalogo.ler',
  editar: 'sadt.catalogo.editar',
  lerRealizacao: 'sadt.lancamento.ler',
  realizar: 'sadt.lancamento.lancar',
} as const;

const idOuNulo = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, 'Parâmetro inválido');
  return n;
};

@Controller('api/sadt/consumo-padrao')
export class ConsumoPadraoExameController {
  constructor(
    @Optional()
    @Inject(CONSUMO_PADRAO_EXAME)
    private readonly porta: PortaConsumoPadraoExamePropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaConsumoPadraoExamePropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta)
      throw semBancoDoCliente(
        'Consumo padrão indisponível',
        'O consumo padrão do exame só existe com o banco do cliente.',
      );
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('apoio')
  @Permissao(PERMISSOES_CONSUMO_PADRAO.ler)
  apoio(@Req() req: RequisicaoAutorizada, @Query('busca') busca?: string) {
    return this.com(req, (p, c) => p.apoio(c, busca ?? null));
  }

  @Get()
  @Permissao(PERMISSOES_CONSUMO_PADRAO.ler)
  listar(@Req() req: RequisicaoAutorizada, @Query('exame') exame?: string) {
    return this.com(req, async (p, c) => ({ itens: await p.listar(c, idOuNulo(exame)) }));
  }

  @Post()
  @HttpCode(200)
  @Permissao(PERMISSOES_CONSUMO_PADRAO.editar)
  @AuditadoNoHandler('consumo padrão do exame pelo executor (trilha na mesma transação)')
  salvar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvar(c, corpo));
  }

  @Get('pendentes')
  @Permissao(PERMISSOES_CONSUMO_PADRAO.lerRealizacao)
  pendentes(@Req() req: RequisicaoAutorizada, @Query('setor') setor?: string) {
    return this.com(req, async (p, c) => ({ itens: await p.pendentes(c, idOuNulo(setor)) }));
  }

  @Get('exames/:item')
  @Permissao(PERMISSOES_CONSUMO_PADRAO.lerRealizacao)
  sugestao(@Req() req: RequisicaoAutorizada, @Param('item', ParseIntPipe) item: number) {
    return this.com(req, (p, c) => p.sugestao(c, item));
  }

  @Post('exames/:item/realizar')
  @HttpCode(200)
  @Permissao(PERMISSOES_CONSUMO_PADRAO.realizar)
  @AuditadoNoHandler(
    'baixa do consumo do exame e lançamento na conta pelo executor (trilha na mesma transação)',
  )
  realizar(
    @Req() req: RequisicaoAutorizada,
    @Param('item', ParseIntPipe) item: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.realizar(c, item, corpo));
  }
}
