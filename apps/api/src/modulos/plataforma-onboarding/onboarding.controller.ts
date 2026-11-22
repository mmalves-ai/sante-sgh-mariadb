// Rotas do painel de onboarding (F4 L3; plano F4 seção 2). SÓ o administrador da plataforma (login POST
// /api/sessao/plataforma): a guarda pede a sessão, a permissão declarada e o CSRF nas escritas; aqui se exige o ator
// da plataforma (a sessão de um usuário do cliente, mesmo com a permissão, recebe 403). Respostas só com agregados.
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type {
  ClienteCriado,
  TipoProblema,
  ExecucaoConector,
  ListaExecucoes,
  ExecucaoPedida,
  ListaClientesOnboarding,
  ListaOrigens,
  OrigemVinculada,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { filtrarRelatorio, relatorioCsv } from './execucao.js';
import { ErroOnboarding, SERVICO_ONBOARDING } from './porta.js';
import type { ServicoOnboarding } from './servico.js';

/** Permissão declarada nas rotas (o ator da plataforma tem todas); o portão real é o ator, conferido abaixo. */
export const PERMISSAO_ONBOARDING = 'config.conexao.ler';
const PREFIXO = 'plataforma:';

/** Id do administrador da plataforma na sessão (`plataforma:<id>`); null se a sessão não é do ator da plataforma. */
export function administradorDaSessao(req: Pick<RequisicaoAutorizada, 'sgh'>): number | null {
  const u = req.sgh?.sessao.usuario as { id?: unknown; ator?: unknown } | undefined;
  if (!u || u.ator !== 'plataforma') return null;
  const id = String(u.id ?? '');
  const n = Number(id.startsWith(PREFIXO) ? id.slice(PREFIXO.length) : id);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

const HTTP: Record<ErroOnboarding['tipo'], [TipoProblema, number, string]> = {
  conflito: ['recusa-de-negocio', 409, 'Conflito'],
  invalido: ['entrada-invalida', 400, 'Pedido recusado'],
  inexistente: ['nao-encontrado', 404, 'Não encontrado'],
  indisponivel: ['indisponivel', 503, 'Serviço indisponível'],
};

@Controller('plataforma/onboarding')
export class OnboardingController {
  constructor(@Inject(SERVICO_ONBOARDING) private readonly servico: ServicoOnboarding | null) {}

  private exigir(req: RequisicaoAutorizada): { s: ServicoOnboarding; admin: number | null } {
    const admin = administradorDaSessao(req);
    if (admin === null)
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Só o administrador da plataforma.');
    if (!this.servico) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    return { s: this.servico, admin: admin > 0 ? admin : null };
  }

  private async tratar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErroOnboarding) {
        const [codigo, status, titulo] = HTTP[e.tipo];
        throw new ErroProblema(codigo, status, titulo, e.message);
      }
      throw e;
    }
  }

  @Get('clientes')
  @Permissao(PERMISSAO_ONBOARDING)
  async listar(@Req() req: RequisicaoAutorizada): Promise<ListaClientesOnboarding> {
    const { s } = this.exigir(req);
    return { clientes: await this.tratar(() => s.listarClientes()) };
  }

  @Post('clientes')
  @AuditadoNoHandler(
    'cliente_evento no banco da plataforma, com o administrador que pediu (script do cliente e conector)',
  )
  @HttpCode(201)
  @Permissao(PERMISSAO_ONBOARDING)
  async criar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown): Promise<ClienteCriado> {
    const { s, admin } = this.exigir(req);
    return this.tratar(() => s.criarCliente(corpo, admin));
  }

  @Get('origens')
  @Permissao(PERMISSAO_ONBOARDING)
  async origens(@Req() req: RequisicaoAutorizada): Promise<ListaOrigens> {
    const { s } = this.exigir(req);
    return { origens: await this.tratar(() => s.listarOrigens()) };
  }

  @Put('clientes/:codigo/origem')
  @AuditadoNoHandler(
    'cliente_evento no banco da plataforma, com o administrador que pediu (script do cliente e conector)',
  )
  @Permissao(PERMISSAO_ONBOARDING)
  async vincular(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
  ): Promise<OrigemVinculada> {
    const { s, admin } = this.exigir(req);
    return this.tratar(() => s.vincular(codigo, corpo, admin));
  }

  @Post('clientes/:codigo/execucoes')
  @AuditadoNoHandler(
    'cliente_evento no banco da plataforma, com o administrador que pediu (script do cliente e conector)',
  )
  @HttpCode(202)
  @Permissao(PERMISSAO_ONBOARDING)
  async pedir(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
  ): Promise<ExecucaoPedida> {
    const { s, admin } = this.exigir(req);
    return { execucao: await this.tratar(() => s.pedirExecucao(codigo, corpo, admin)) };
  }

  @Get('clientes/:codigo/execucoes')
  @Permissao(PERMISSAO_ONBOARDING)
  async historico(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
  ): Promise<ListaExecucoes> {
    const { s } = this.exigir(req);
    return { execucoes: await this.tratar(() => s.historico(codigo)) };
  }

  @Get('clientes/:codigo/execucoes/:id')
  @Permissao(PERMISSAO_ONBOARDING)
  async execucao(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Param('id') id: string,
  ): Promise<ExecucaoConector> {
    const { s } = this.exigir(req);
    return this.tratar(() => s.execucao(codigo, Number(id)));
  }

  /** L10: relatório da execução com filtro por entidade e regra (o painel filtra também na tela). */
  @Get('clientes/:codigo/execucoes/:id/relatorio')
  @Permissao(PERMISSAO_ONBOARDING)
  async relatorio(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Param('id') id: string,
    @Query('entidade') entidade: string | undefined,
    @Query('regra') regra: string | undefined,
  ): Promise<ExecucaoConector> {
    const { s } = this.exigir(req);
    const e = await this.tratar(() => s.execucao(codigo, Number(id)));
    return {
      ...e,
      entidades: e.entidades.filter((x) => !entidade || x.entidade === entidade),
      relatorio: e.relatorio ? filtrarRelatorio(e.relatorio, { entidade, regra }) : null,
    };
  }

  /** L10: exportação do relatório (CSV para planilha), com o mesmo filtro. Só agregados. */
  @Get('clientes/:codigo/execucoes/:id/relatorio.csv')
  @Permissao(PERMISSAO_ONBOARDING)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="relatorio-conciliacao.csv"')
  @Header('Cache-Control', 'no-store')
  async relatorioCsv(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Param('id') id: string,
    @Query('entidade') entidade: string | undefined,
    @Query('regra') regra: string | undefined,
  ): Promise<string> {
    const { s } = this.exigir(req);
    const e = await this.tratar(() => s.execucao(codigo, Number(id)));
    return relatorioCsv(e, { entidade, regra });
  }
}
