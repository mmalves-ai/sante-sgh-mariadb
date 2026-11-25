// Rotas da tela "Carga e sincronismo" do painel técnico (obra carga-painel, 2026-11-24; ADR 0010). Atendem SÓ:
//   - o administrador da plataforma (ator 'plataforma' da sessão do hospital): a guarda pede a sessão, a permissão
//     declarada e o CSRF da sessão nas escritas;
//   - a CONTA DA PLATAFORMA com papel plataforma (ADR 0021, @AceitaContaPlataforma): a sessão própria conferida pela
//     mesma função do controlador da plataforma (contaDaSessao), com o CSRF próprio nas escritas. O papel suporte
//     recebe 403.
// O usuário de um cliente, mesmo com a permissão, recebe 403. Respostas só com agregados; a senha da
// origem vai ao cofre e nunca volta.
import { createReadStream } from 'node:fs';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Req,
  StreamableFile,
} from '@nestjs/common';
import type {
  CargaCliente,
  ExecucaoPedida,
  ListaConectores,
  OrigemServidor,
  TesteOrigem,
  TipoProblema,
} from '@sgh/contratos';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { AceitaContaPlataforma, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ResolvedorRede } from '../../sessao/rede.js';
import { RESOLVEDOR_REDE } from '../acesso/acesso.controller.js';
import { SERVICO_PLATAFORMA } from '../suporte/plataforma.controller.js';
import { ErroPlataforma, type ServicoPlataforma } from '../suporte/servico-plataforma.js';
import { contaDaSessao, idSessaoConta, problemaDaPlataforma } from '../suporte/sessao-conta.js';
import { administradorDaSessao, PERMISSAO_ONBOARDING } from './onboarding.controller.js';
import { ErroOnboarding } from './porta.js';
import { type AtorCarga, SERVICO_CARGA, type ServicoCarga } from './servico-carga.js';

const HTTP: Record<ErroOnboarding['tipo'], [TipoProblema, number, string]> = {
  conflito: ['recusa-de-negocio', 409, 'Conflito'],
  invalido: ['entrada-invalida', 400, 'Pedido recusado'],
  inexistente: ['nao-encontrado', 404, 'Não encontrado'],
  indisponivel: ['indisponivel', 503, 'Serviço indisponível'],
};

const AUDITORIA =
  'cliente_evento no banco da plataforma, com o administrador ou a conta da plataforma que pediu (fila do conector e origem)';
const CONTA =
  'a conta da plataforma com papel plataforma (sessão própria e CSRF próprio, conferidos no handler)';

@Controller('plataforma/carga')
export class CargaController {
  constructor(
    @Inject(SERVICO_CARGA) private readonly servico: ServicoCarga | null,
    @Optional() @Inject(SERVICO_PLATAFORMA) private readonly plataforma: ServicoPlataforma | null = null,
    @Optional()
    @Inject(CONFIGURACAO)
    private readonly configuracao: Pick<Configuracao, 'ambiente'> | null = null,
    @Optional() @Inject(RESOLVEDOR_REDE) private readonly resolvedor: ResolvedorRede | null = null,
  ) {}

  /**
   * O ator da ação: o administrador (a guarda já conferiu a sessão do hospital e o CSRF dela) ou, com o cookie da
   * conta, a conta da plataforma com papel plataforma (sessão própria; CSRF próprio nas escritas). Sem nenhuma, 401;
   * outro usuário ou o papel suporte, 403.
   */
  private async exigir(
    req: RequisicaoAutorizada,
    escrita = false,
  ): Promise<{ s: ServicoCarga; ator: AtorCarga }> {
    const admin = administradorDaSessao(req);
    let ator: AtorCarga;
    if (admin !== null) ator = admin > 0 ? admin : null;
    else if (this.plataforma && this.resolvedor && idSessaoConta(req, this.ambiente)) {
      let conta;
      try {
        conta = await contaDaSessao(
          this.plataforma,
          req,
          { ambiente: this.ambiente, resolvedor: this.resolvedor },
          escrita,
        );
      } catch (e) {
        if (e instanceof ErroPlataforma) throw problemaDaPlataforma(e);
        throw e;
      }
      if (conta.papel !== 'PLATAFORMA' || !conta.ativo)
        throw new ErroProblema(
          'sem-permissao',
          403,
          'Sem permissão',
          'Só a conta da plataforma (papel plataforma).',
        );
      ator = { conta: conta.id };
    } else if (!req.sgh)
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária', 'Entre para continuar.');
    else throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Só o administrador da plataforma.');
    if (!this.servico) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    return { s: this.servico, ator };
  }

  /** Sem a configuração (testes), o ambiente de produção: cookie com o prefixo __Host-. */
  private get ambiente(): string {
    return this.configuracao?.ambiente ?? 'producao';
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

  @Get('conectores')
  @Permissao(PERMISSAO_ONBOARDING)
  @AceitaContaPlataforma(CONTA)
  async conectores(@Req() req: RequisicaoAutorizada): Promise<ListaConectores> {
    const { s } = await this.exigir(req);
    return { conectores: await this.tratar(() => s.listarConectores()) };
  }

  @Put('clientes/:codigo/origem-servidor')
  @AuditadoNoHandler(AUDITORIA)
  @Permissao(PERMISSAO_ONBOARDING)
  @AceitaContaPlataforma(CONTA)
  async origemServidor(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
  ): Promise<OrigemServidor> {
    const { s, ator } = await this.exigir(req, true);
    return this.tratar(() => s.gravarOrigemServidor(codigo, corpo, ator));
  }

  /** Só leitura na origem (conexão e transação somente leitura); a guarda pede CSRF por ser POST. */
  @Post('clientes/:codigo/origem-servidor/testar')
  @AuditadoNoHandler(
    'só leitura: abre a conexão somente leitura na origem e devolve agregados; nada é gravado',
  )
  @HttpCode(200)
  @Permissao(PERMISSAO_ONBOARDING)
  @AceitaContaPlataforma(CONTA)
  async testar(@Req() req: RequisicaoAutorizada, @Param('codigo') codigo: string): Promise<TesteOrigem> {
    const { s } = await this.exigir(req, true);
    return this.tratar(() => s.testarOrigem(codigo));
  }

  @Post('clientes/:codigo/carga')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(202)
  @Permissao(PERMISSAO_ONBOARDING)
  @AceitaContaPlataforma(CONTA)
  async iniciar(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
  ): Promise<ExecucaoPedida> {
    const { s, ator } = await this.exigir(req, true);
    return { execucao: await this.tratar(() => s.pedirCarga(codigo, corpo, ator)) };
  }

  @Post('clientes/:codigo/carga/pausar')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(202)
  @Permissao(PERMISSAO_ONBOARDING)
  @AceitaContaPlataforma(CONTA)
  async pausar(@Req() req: RequisicaoAutorizada, @Param('codigo') codigo: string): Promise<ExecucaoPedida> {
    const { s, ator } = await this.exigir(req, true);
    return { execucao: await this.tratar(() => s.pausar(codigo, ator)) };
  }

  @Post('clientes/:codigo/carga/retomar')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(202)
  @Permissao(PERMISSAO_ONBOARDING)
  @AceitaContaPlataforma(CONTA)
  async retomar(@Req() req: RequisicaoAutorizada, @Param('codigo') codigo: string): Promise<ExecucaoPedida> {
    const { s, ator } = await this.exigir(req, true);
    return { execucao: await this.tratar(() => s.retomar(codigo, ator)) };
  }

  @Get('clientes/:codigo/carga')
  @Header('Cache-Control', 'no-store')
  @Permissao(PERMISSAO_ONBOARDING)
  @AceitaContaPlataforma(CONTA)
  async carga(@Req() req: RequisicaoAutorizada, @Param('codigo') codigo: string): Promise<CargaCliente> {
    const { s } = await this.exigir(req);
    return this.tratar(() => s.carga(codigo));
  }

  /** Log da execução (sem valores de linha), lido da pasta de logs do conector com proteção de caminho. */
  @Get('clientes/:codigo/carga/:id/log')
  @Header('Cache-Control', 'no-store')
  @Permissao(PERMISSAO_ONBOARDING)
  @AceitaContaPlataforma(CONTA)
  async log(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const { s } = await this.exigir(req);
    const n = Number(id);
    const caminho = await this.tratar(() => s.log(codigo, n));
    return new StreamableFile(createReadStream(caminho), {
      type: 'text/plain; charset=utf-8',
      disposition: `attachment; filename="execucao-${n}.log"`,
    });
  }
}
