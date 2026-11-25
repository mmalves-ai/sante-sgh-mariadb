// Cadastro da central de material esterilizado (CME; F7, 04-CME linha 115). Rotas (porta própria; sem banco do
// cliente, 503):
//   GET  /api/cirurgia/cme/cadastro                              produtos, caixas, catálogo de fases e opções
//   GET  /api/cirurgia/cme/cadastro/caixas/:id                   a caixa com a composição e as fases
//   POST /api/cirurgia/cme/cadastro/produtos                     inclui o produto reprocessável (e as fases)
//   POST /api/cirurgia/cme/cadastro/produtos/:id                 altera o produto (versão)
//   POST /api/cirurgia/cme/cadastro/produtos/:id/situacao        ativo, em manutenção, inativo ou descartado
//   POST /api/cirurgia/cme/cadastro/caixas                       inclui a caixa, o kit ou o pacote avulso
//   POST /api/cirurgia/cme/cadastro/caixas/:id                   altera a caixa com a composição inteira (versão)
//   POST /api/cirurgia/cme/cadastro/caixas/:id/situacao          ativa ou inativa
//   POST /api/cirurgia/cme/cadastro/:alvo/:id/foto               { versao, conteudo (base64) } foto da caixa ou peça
//   GET  /api/cirurgia/cme/cadastro/:alvo/:id/foto               a foto (base64)
// Permissões da CME (concessão por perfil, packages/contratos/src/permissoes/cirurgia-cme.ts): consultar e operar.
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
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  type AlvoFotoCme,
  PORTA_CME_CADASTRO,
  type PortaCmeCadastroPropria,
} from './cme-cadastro-propria.js';

export const PERMISSOES_CME_CADASTRO = {
  ler: 'cirurgia.cme.ler',
  operar: 'cirurgia.cme.operar',
} as const;

const alvoDe = (v: string): AlvoFotoCme => {
  if (v === 'caixas') return 'caixa';
  if (v === 'pecas') return 'peca';
  throw new ErroProblema('nao-encontrado', 404, 'Rota inexistente', 'A foto é da caixa ou da peça.');
};

@Controller('cirurgia/cme/cadastro')
export class CmeCadastroController {
  constructor(
    @Optional()
    @Inject(PORTA_CME_CADASTRO)
    private readonly porta: PortaCmeCadastroPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaCmeCadastroPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_CME_CADASTRO.ler)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painel(c));
  }

  @Get('caixas/:id')
  @Permissao(PERMISSOES_CME_CADASTRO.ler)
  caixa(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.caixa(c, id));
  }

  @Post('produtos')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME_CADASTRO.operar)
  @AuditadoNoHandler('produto reprocessável incluído pelo executor (trilha na mesma transação)')
  incluirProduto(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarProduto(c, null, corpo));
  }

  @Post('produtos/:id')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME_CADASTRO.operar)
  @AuditadoNoHandler('produto reprocessável alterado pelo executor (trilha na mesma transação)')
  alterarProduto(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.gravarProduto(c, id, corpo));
  }

  @Post('produtos/:id/situacao')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME_CADASTRO.operar)
  @AuditadoNoHandler('situação do produto reprocessável pelo executor (trilha na mesma transação)')
  situacaoProduto(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.situacaoProduto(c, id, corpo));
  }

  @Post('caixas')
  @HttpCode(201)
  @Permissao(PERMISSOES_CME_CADASTRO.operar)
  @AuditadoNoHandler('caixa da CME incluída com a composição pelo executor (trilha na mesma transação)')
  incluirCaixa(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarCaixa(c, null, corpo));
  }

  @Post('caixas/:id')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME_CADASTRO.operar)
  @AuditadoNoHandler('caixa da CME alterada com a composição pelo executor (trilha na mesma transação)')
  alterarCaixa(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.gravarCaixa(c, id, corpo));
  }

  @Post('caixas/:id/situacao')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME_CADASTRO.operar)
  @AuditadoNoHandler('situação da caixa da CME pelo executor (trilha na mesma transação)')
  situacaoCaixa(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.situacaoCaixa(c, id, corpo));
  }

  @Post(':alvo/:id/foto')
  @HttpCode(200)
  @Permissao(PERMISSOES_CME_CADASTRO.operar)
  @AuditadoNoHandler('foto da caixa ou da peça guardada e ligada pelo executor (trilha na mesma transação)')
  enviarFoto(
    @Req() req: RequisicaoAutorizada,
    @Param('alvo') alvo: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    const a = alvoDe(alvo);
    return this.com(req, (p, c) => p.enviarFoto(c, a, id, corpo));
  }

  @Get(':alvo/:id/foto')
  @Permissao(PERMISSOES_CME_CADASTRO.ler)
  async foto(
    @Req() req: RequisicaoAutorizada,
    @Param('alvo') alvo: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const a = alvoDe(alvo);
    const f = await this.com(req, (p, c) => p.foto(c, a, id));
    return { tipo: f.tipo, conteudo: f.conteudo.toString('base64') };
  }
}
