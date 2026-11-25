// Controle orçamentário na compra e no pagamento (C2-112, 07-FIN linha 130). Rotas (porta própria; sem banco do
// cliente, 503):
//   GET  /api/financeiro/controle-orcamentario                         regras, exceções, reservas e as escolhas
//   GET  /api/financeiro/controle-orcamentario/saldo?linha=&competencia=&tipoDocumento=&conta=
//                                                                       prévia do saldo com a regra que vale
//   POST /api/financeiro/controle-orcamentario/regras                  cria a regra de controle
//   POST /api/financeiro/controle-orcamentario/regras/:id              altera ou desativa a regra { …, versao }
//   POST /api/financeiro/controle-orcamentario/reservas                reserva no pedido de compra ou no título
//   POST /api/financeiro/controle-orcamentario/reservas/:id/nota       a nota realiza a reserva (ajuste)
//   POST /api/financeiro/controle-orcamentario/reservas/:id/liberar    libera o saldo em aberto { versao, motivo }
//   POST /api/financeiro/controle-orcamentario/excecoes                pede a exceção justificada
//   POST /api/financeiro/controle-orcamentario/excecoes/:id/decidir    aprova ou reprova { versao, aprovar, parecer }
// Ler: financeiro.orcamento.ler; regras, reservas, notas e pedidos de exceção: financeiro.orcamento.editar; decidir a
// exceção: financeiro.orcamento.aprovar (como a aprovação do orçamento).
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
  PORTA_CONTROLE_ORCAMENTARIO,
  type PortaControleOrcamentarioPropria,
} from './controle-orcamentario-propria.js';

const TRILHA = 'controle orçamentário pelo executor (trilha na mesma transação)';
const inteiro = (v: string | undefined) =>
  v && /^\d+$/.test(v) ? Number(v) : v === undefined ? undefined : v;

@Controller('financeiro/controle-orcamentario')
export class ControleOrcamentarioController {
  constructor(
    @Optional()
    @Inject(PORTA_CONTROLE_ORCAMENTARIO)
    private readonly porta: PortaControleOrcamentarioPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaControleOrcamentarioPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao('financeiro.orcamento.ler')
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painel(c));
  }

  @Get('saldo')
  @Permissao('financeiro.orcamento.ler')
  saldo(
    @Req() req: RequisicaoAutorizada,
    @Query('linha') linha: string | undefined,
    @Query('competencia') competencia: string | undefined,
    @Query('tipoDocumento') tipoDocumento: string | undefined,
    @Query('conta') conta: string | undefined,
  ) {
    return this.com(req, (p, c) =>
      p.saldo(c, {
        linha: inteiro(linha),
        competencia,
        ...(tipoDocumento ? { tipoDocumento } : {}),
        contaOrcamentaria: conta ? inteiro(conta) : null,
      }),
    );
  }

  @Post('regras')
  @HttpCode(201)
  @Permissao('financeiro.orcamento.editar')
  @AuditadoNoHandler(TRILHA)
  criarRegra(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvarRegra(c, null, corpo));
  }

  @Post('regras/:id')
  @HttpCode(200)
  @Permissao('financeiro.orcamento.editar')
  @AuditadoNoHandler(TRILHA)
  alterarRegra(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.salvarRegra(c, id, corpo));
  }

  @Post('reservas')
  @HttpCode(201)
  @Permissao('financeiro.orcamento.editar')
  @AuditadoNoHandler(TRILHA)
  reservar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.reservar(c, corpo));
  }

  @Post('reservas/:id/nota')
  @HttpCode(200)
  @Permissao('financeiro.orcamento.editar')
  @AuditadoNoHandler(TRILHA)
  nota(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrarNota(c, id, corpo));
  }

  @Post('reservas/:id/liberar')
  @HttpCode(200)
  @Permissao('financeiro.orcamento.editar')
  @AuditadoNoHandler(TRILHA)
  liberar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.liberar(c, id, corpo));
  }

  @Post('excecoes')
  @HttpCode(201)
  @Permissao('financeiro.orcamento.editar')
  @AuditadoNoHandler(TRILHA)
  pedirExcecao(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.solicitarExcecao(c, corpo));
  }

  @Post('excecoes/:id/decidir')
  @HttpCode(200)
  @Permissao('financeiro.orcamento.aprovar')
  @AuditadoNoHandler(TRILHA)
  decidir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.decidirExcecao(c, id, corpo));
  }
}
