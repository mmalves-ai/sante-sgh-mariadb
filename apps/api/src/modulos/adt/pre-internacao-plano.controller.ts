// C2-048 (04-INT linha 70): plano previsto da pré-internação e fila de espera eletiva no banco do cliente (porta
// própria; sem banco, 503).
//   GET  /api/internacao/pre-internacao/apoio                      funções da equipe, prioridades e vias de acesso
//   GET  /api/internacao/pre-internacao/busca/itens?termo          procedimentos (itens faturáveis em uso)
//   GET  /api/internacao/pre-internacao/busca/insumos?termo        materiais e medicamentos em uso
//   GET  /api/internacao/pre-internacao/busca/profissionais?termo  profissionais ativos
//   GET  /api/internacao/pre-internacao/busca/fornecedores?termo   fornecedores ativos (material consignado ou OPME)
//   GET  /api/internacao/pre-internacao/fila                       fila de espera ordenada (prioridade, data do pedido)
//   GET  /api/internacao/pre-internacao/pacientes/:p/plano         plano da pré-internação pendente do paciente
//   GET  /api/internacao/pre-internacao/:id/plano                  plano de uma pré-internação
//   POST /api/internacao/pre-internacao/:id/plano                  grava o plano inteiro (com a versão)
//   POST /api/internacao/pre-internacao/:id/prioridade             muda a prioridade na fila (com justificativa)
// Níveis de acesso: os mesmos da pré-internação (ler a lista; agendar grava o plano e a prioridade).
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
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_PRE_INTERNACAO_PLANO,
  type PortaPreInternacaoPlanoPropria,
} from './pre-internacao-plano-propria.js';

export const PERMISSOES_PRE_INTERNACAO_PLANO = {
  ler: 'internacao.pre.ler',
  gravar: 'internacao.pre.criar',
} as const;
const P = PERMISSOES_PRE_INTERNACAO_PLANO;
const TRILHA = 'executor: trilha na mesma transação do plano da pré-internação';

@Controller('internacao/pre-internacao')
export class PreInternacaoPlanoController {
  constructor(
    @Optional()
    @Inject(PORTA_PRE_INTERNACAO_PLANO)
    private readonly porta: PortaPreInternacaoPlanoPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaPreInternacaoPlanoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('apoio')
  @Permissao(P.ler)
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.apoio(c));
  }

  @Get('busca/itens')
  @Permissao(P.ler)
  itens(@Req() req: RequisicaoAutorizada, @Query('termo') termo = '') {
    return this.com(req, (p, c) => p.buscarItens(c, String(termo).slice(0, 60)));
  }

  @Get('busca/insumos')
  @Permissao(P.ler)
  insumos(@Req() req: RequisicaoAutorizada, @Query('termo') termo = '') {
    return this.com(req, (p, c) => p.buscarInsumos(c, String(termo).slice(0, 60)));
  }

  @Get('busca/profissionais')
  @Permissao(P.ler)
  profissionais(@Req() req: RequisicaoAutorizada, @Query('termo') termo = '') {
    return this.com(req, (p, c) => p.buscarProfissionais(c, String(termo).slice(0, 60)));
  }

  @Get('busca/fornecedores')
  @Permissao(P.ler)
  fornecedores(@Req() req: RequisicaoAutorizada, @Query('termo') termo = '') {
    return this.com(req, (p, c) => p.buscarFornecedores(c, String(termo).slice(0, 60)));
  }

  @Get('fila')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.internacaoLida.codigo)
  fila(@Req() req: RequisicaoAutorizada) {
    req.sghAlvo = { tabelaAlvo: 'agendamento_internacao', idAlvo: 'fila' };
    return this.com(req, (p, c) => p.fila(c));
  }

  @Get('pacientes/:paciente/plano')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.internacaoLida.codigo)
  async planoDoPaciente(@Req() req: RequisicaoAutorizada, @Param('paciente', ParseIntPipe) paciente: number) {
    req.sghAlvo = { paciente, tabelaAlvo: 'agendamento_internacao', idAlvo: String(paciente) };
    return { plano: await this.com(req, (p, c) => p.planoDoPaciente(c, paciente)) };
  }

  @Get(':id/plano')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.internacaoLida.codigo)
  plano(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    req.sghAlvo = { tabelaAlvo: 'agendamento_internacao', idAlvo: String(id) };
    return this.com(req, (p, c) => p.plano(c, id));
  }

  @Post(':id/plano')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(P.gravar)
  gravarPlano(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.gravarPlano(c, id, corpo));
  }

  @Post(':id/prioridade')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(200)
  @Permissao(P.gravar)
  priorizar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.priorizar(c, id, corpo));
  }
}
