// Cargas do data mart na administração (01-REL L113; F3). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/relatorios/datamart/cargas?limite=     as cargas do estabelecimento da sessão, da mais recente
//   GET  /api/relatorios/datamart/cargas/:id         a carga com as etapas por dimensão e fato
//   POST /api/relatorios/datamart/cargas             pede a carga manual (o worker a assume; 409 com outra aberta)
// Leitura `relatorio.datamart.ler`; pedido `relatorio.datamart.acionar` (perfil administrador do sistema). O registro
// só tem contagens, tempos e a mensagem sem valores: nenhum dado de pessoa.
import {
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
import { PERMISSOES_M34_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { CARGAS_DATAMART, type PortaCargasDataMartPropria } from './datamart-cargas-propria.js';

@Controller('relatorios/datamart/cargas')
export class CargasDataMartController {
  constructor(
    @Optional()
    @Inject(CARGAS_DATAMART)
    private readonly porta: PortaCargasDataMartPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaCargasDataMartPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Cargas do data mart indisponíveis',
        'O registro das cargas do data mart só existe com o banco do cliente.',
      );
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(P.datamartLer)
  listar(@Req() req: RequisicaoAutorizada, @Query('limite') limite?: string) {
    const n = limite === undefined || limite === '' ? 50 : Number(limite);
    if (!Number.isInteger(n) || n < 1 || n > 200)
      throw new ErroProblema('entrada-invalida', 400, 'Parâmetro inválido', 'O limite vai de 1 a 200.');
    return this.com(req, async (p, c) => ({ itens: await p.listar(c, n) }));
  }

  @Get(':id')
  @Permissao(P.datamartLer)
  detalhe(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.detalhe(c, id));
  }

  @Post()
  @HttpCode(200)
  @Permissao(P.datamartAcionar)
  @AuditadoNoHandler('pedido manual da carga do data mart pelo executor (trilha na mesma transação)')
  pedir(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.pedir(c));
  }
}
