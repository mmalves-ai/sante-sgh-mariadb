// Rotas da página inicial montada pelo hospital (01-ADM L114; F8; sem chave de liberação: só a permissão):
//   GET  /api/relatorios/pagina-inicial/catalogo               tipos de bloco, indicadores e perfis (editor)
//   GET  /api/relatorios/pagina-inicial/modelos                modelos do estabelecimento e da rede
//   GET  /api/relatorios/pagina-inicial/modelos/:id            o modelo com os blocos em ordem e os perfis
//   POST /api/relatorios/pagina-inicial/modelos                cria o modelo (rascunho)
//   PUT  /api/relatorios/pagina-inicial/modelos/:id            salva a página inteira (nome, blocos e perfis)
//   POST /api/relatorios/pagina-inicial/modelos/:id/situacao   publica, volta a rascunho ou inativa (nada é apagado)
//   GET  /api/relatorios/pagina-inicial/minha                  a página da pessoa (nula: a página fixa do perfil)
// O modelo da rede (vale para todos os estabelecimentos) só é criado, salvo ou muda de situação com o escopo de rede
// (relatorio.paginaInicial.editarRede); a porta recusa (403) sem ele e confere os perfis pelo escopo do modelo.
// A minha página só traz as listas de trabalho que a pessoa já veria na página fixa (permissão do módulo de origem).
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
  Req,
} from '@nestjs/common';
import {
  DEFINICOES_COMPONENTES_INICIO,
  PERMISSOES_ACESSO,
  PERMISSOES_M34_CODIGOS as P,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import type { ContextoComunicacao } from '../integracao/comunicacao-base-propria.js';
import { PORTA_PAGINA_INICIAL, type PortaPaginaInicialPropria } from './pagina-inicial-propria.js';

const TRILHA =
  'criação, gravação e mudança de situação do modelo de página inicial pelo executor (trilha na mesma transação)';

/** O escopo de rede da sessão (editar os modelos que valem para todos os estabelecimentos). */
const rede = (req: RequisicaoAutorizada): boolean => sessaoDe(req).pode(P.paginaInicialEditarRede);

@Controller('relatorios/pagina-inicial')
export class PaginaInicialController {
  constructor(
    @Optional()
    @Inject(PORTA_PAGINA_INICIAL)
    private readonly porta: PortaPaginaInicialPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaPaginaInicialPropria, c: ContextoComunicacao) => Promise<T>,
  ): Promise<T> {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta as ContextoComunicacao).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('catalogo')
  @Permissao(P.paginaInicialLer)
  catalogo(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.catalogo(c, rede(req)));
  }

  @Get('modelos')
  @Permissao(P.paginaInicialLer)
  modelos(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.modelos(c) }));
  }

  @Get('modelos/:id')
  @Permissao(P.paginaInicialLer)
  modelo(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.detalhe(c, id, rede(req)));
  }

  @Post('modelos')
  @HttpCode(201)
  @Permissao(P.paginaInicialEditar)
  @AuditadoNoHandler(TRILHA)
  criar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.criar(c, corpo, rede(req)));
  }

  @Put('modelos/:id')
  @HttpCode(200)
  @Permissao(P.paginaInicialEditar)
  @AuditadoNoHandler(TRILHA)
  salvar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvar(c, id, corpo, rede(req)));
  }

  @Post('modelos/:id/situacao')
  @HttpCode(200)
  @Permissao(P.paginaInicialEditar)
  @AuditadoNoHandler(TRILHA)
  situacao(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.mudarSituacao(c, id, corpo, rede(req)));
  }

  @Get('minha')
  @Permissao(PERMISSOES_ACESSO.inicioLer)
  minha(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const listas = new Set(
      DEFINICOES_COMPONENTES_INICIO.filter((d) => d.entregue && s.pode(d.permissao)).map(
        (d) => d.id as string,
      ),
    );
    return this.com(req, (p, c) => p.minha(c, listas));
  }
}
