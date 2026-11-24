// Rotas da tela "Carga e sincronismo" do painel técnico (obra carga-painel, 2026-11-24; ADR 0010). SÓ o administrador
// da plataforma: a guarda pede a sessão, a permissão declarada e o CSRF nas escritas; aqui se exige o ator da
// plataforma (o usuário de um cliente, mesmo com a permissão, recebe 403). Respostas só com agregados; a senha da
// origem vai ao cofre e nunca volta.
import { createReadStream } from 'node:fs';
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
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { administradorDaSessao, PERMISSAO_ONBOARDING } from './onboarding.controller.js';
import { ErroOnboarding } from './porta.js';
import { SERVICO_CARGA, type ServicoCarga } from './servico-carga.js';

const HTTP: Record<ErroOnboarding['tipo'], [TipoProblema, number, string]> = {
  conflito: ['recusa-de-negocio', 409, 'Conflito'],
  invalido: ['entrada-invalida', 400, 'Pedido recusado'],
  inexistente: ['nao-encontrado', 404, 'Não encontrado'],
  indisponivel: ['indisponivel', 503, 'Serviço indisponível'],
};

const AUDITORIA =
  'cliente_evento no banco da plataforma, com o administrador que pediu (fila do conector e origem)';

@Controller('plataforma/carga')
export class CargaController {
  constructor(@Inject(SERVICO_CARGA) private readonly servico: ServicoCarga | null) {}

  private exigir(req: RequisicaoAutorizada): { s: ServicoCarga; admin: number | null } {
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

  @Get('conectores')
  @Permissao(PERMISSAO_ONBOARDING)
  async conectores(@Req() req: RequisicaoAutorizada): Promise<ListaConectores> {
    const { s } = this.exigir(req);
    return { conectores: await this.tratar(() => s.listarConectores()) };
  }

  @Put('clientes/:codigo/origem-servidor')
  @AuditadoNoHandler(AUDITORIA)
  @Permissao(PERMISSAO_ONBOARDING)
  async origemServidor(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
  ): Promise<OrigemServidor> {
    const { s, admin } = this.exigir(req);
    return this.tratar(() => s.gravarOrigemServidor(codigo, corpo, admin));
  }

  /** Só leitura na origem (conexão e transação somente leitura); a guarda pede CSRF por ser POST. */
  @Post('clientes/:codigo/origem-servidor/testar')
  @AuditadoNoHandler(
    'só leitura: abre a conexão somente leitura na origem e devolve agregados; nada é gravado',
  )
  @HttpCode(200)
  @Permissao(PERMISSAO_ONBOARDING)
  async testar(@Req() req: RequisicaoAutorizada, @Param('codigo') codigo: string): Promise<TesteOrigem> {
    const { s } = this.exigir(req);
    return this.tratar(() => s.testarOrigem(codigo));
  }

  @Post('clientes/:codigo/carga')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(202)
  @Permissao(PERMISSAO_ONBOARDING)
  async iniciar(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Body() corpo: unknown,
  ): Promise<ExecucaoPedida> {
    const { s, admin } = this.exigir(req);
    return { execucao: await this.tratar(() => s.pedirCarga(codigo, corpo, admin)) };
  }

  @Post('clientes/:codigo/carga/pausar')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(202)
  @Permissao(PERMISSAO_ONBOARDING)
  async pausar(@Req() req: RequisicaoAutorizada, @Param('codigo') codigo: string): Promise<ExecucaoPedida> {
    const { s, admin } = this.exigir(req);
    return { execucao: await this.tratar(() => s.pausar(codigo, admin)) };
  }

  @Post('clientes/:codigo/carga/retomar')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(202)
  @Permissao(PERMISSAO_ONBOARDING)
  async retomar(@Req() req: RequisicaoAutorizada, @Param('codigo') codigo: string): Promise<ExecucaoPedida> {
    const { s, admin } = this.exigir(req);
    return { execucao: await this.tratar(() => s.retomar(codigo, admin)) };
  }

  @Get('clientes/:codigo/carga')
  @Header('Cache-Control', 'no-store')
  @Permissao(PERMISSAO_ONBOARDING)
  async carga(@Req() req: RequisicaoAutorizada, @Param('codigo') codigo: string): Promise<CargaCliente> {
    const { s } = this.exigir(req);
    return this.tratar(() => s.carga(codigo));
  }

  /** Log da execução (sem valores de linha), lido da pasta de logs do conector com proteção de caminho. */
  @Get('clientes/:codigo/carga/:id/log')
  @Header('Cache-Control', 'no-store')
  @Permissao(PERMISSAO_ONBOARDING)
  async log(
    @Req() req: RequisicaoAutorizada,
    @Param('codigo') codigo: string,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const { s } = this.exigir(req);
    const n = Number(id);
    const caminho = await this.tratar(() => s.log(codigo, n));
    return new StreamableFile(createReadStream(caminho), {
      type: 'text/plain; charset=utf-8',
      disposition: `attachment; filename="execucao-${n}.log"`,
    });
  }
}
