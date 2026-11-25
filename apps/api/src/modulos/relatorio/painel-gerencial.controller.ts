// Rotas dos painéis gerenciais montados pelo hospital (01-REL L112; F3; sem chave de liberação: só a permissão):
//   GET  /api/relatorios/paineis-gerenciais/catalogo        indicadores e perfis (editor)
//   GET  /api/relatorios/paineis-gerenciais                 os painéis que a pessoa pode abrir (o editor vê todos)
//   GET  /api/relatorios/paineis-gerenciais/:id             o painel com os quadros em ordem e as permissões (editor)
//   GET  /api/relatorios/paineis-gerenciais/:id/abrir       o painel com a série apurada de cada indicador
//   POST /api/relatorios/paineis-gerenciais                 cria o painel (em montagem)
//   PUT  /api/relatorios/paineis-gerenciais/:id             salva o painel inteiro (dados, quadros e permissões)
//   POST /api/relatorios/paineis-gerenciais/:id/uso         põe em uso ou tira de uso (nada é apagado)
// Abrir pede ainda a permissão do próprio painel (perfil ou pessoa, vigente), conferida pela porta.
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
import { PERMISSOES_M34_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import type { ContextoComunicacao } from '../integracao/comunicacao-base-propria.js';
import { PORTA_PAINEL_GERENCIAL, type PortaPainelGerencialPropria } from './painel-gerencial-propria.js';

const TRILHA =
  'criação, gravação e mudança de uso do painel gerencial pelo executor (trilha na mesma transação)';

@Controller('relatorios/paineis-gerenciais')
export class PainelGerencialController {
  constructor(
    @Optional()
    @Inject(PORTA_PAINEL_GERENCIAL)
    private readonly porta: PortaPainelGerencialPropria | null = null,
  ) {}

  private com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaPainelGerencialPropria, c: ContextoComunicacao, editorGeral: boolean) => Promise<T>,
  ): Promise<T> {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta as ContextoComunicacao, s.pode(P.painelGerencialEditar)).catch(
      (e: unknown) => {
        throw problemaDoCadastro(e);
      },
    );
  }

  @Get('catalogo')
  @Permissao(P.painelGerencialEditar)
  catalogo(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.catalogo(c));
  }

  @Get()
  @Permissao(P.painelGerencialLer)
  paineis(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c, editorGeral) => ({ itens: await p.paineis(c, { editorGeral }) }));
  }

  @Get(':id')
  @Permissao(P.painelGerencialEditar)
  detalhe(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.detalhe(c, id));
  }

  @Get(':id/abrir')
  @Permissao(P.painelGerencialLer)
  abrir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c, editorGeral) => p.abrir(c, id, { editorGeral }));
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.painelGerencialEditar)
  @AuditadoNoHandler(TRILHA)
  criar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.criar(c, corpo));
  }

  @Put(':id')
  @HttpCode(200)
  @Permissao(P.painelGerencialEditar)
  @AuditadoNoHandler(TRILHA)
  salvar(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvar(c, id, corpo));
  }

  @Post(':id/uso')
  @HttpCode(200)
  @Permissao(P.painelGerencialEditar)
  @AuditadoNoHandler(TRILHA)
  uso(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.mudarUso(c, id, corpo));
  }
}
