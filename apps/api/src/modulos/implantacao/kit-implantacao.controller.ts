// Kit de implantação do hospital novo (C2-025, 01-ADM L98). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/implantacao/kit                         painel do "o que falta": implantação aberta, itens, metas e resumo
//                                                     (sem implantação: o diagnóstico pelo checklist padrão)
//   POST /api/implantacao/kit                         abre a implantação do estabelecimento com os itens do modelo
//   PATCH /api/implantacao/kit/:id                    fase, situação, datas e responsáveis do projeto
//   POST /api/implantacao/kit/:id/conferencia         reconta os cadastros mínimos e atualiza a situação dos itens
//   PATCH /api/implantacao/kit/itens/:item            prazo, responsável, dispensa com motivo, situação manual
//   POST /api/implantacao/kit/:id/metas               inclui uma meta (processo, indicador, valor, data limite)
//   POST /api/implantacao/kit/metas/:meta/medicao     registra a medição da meta
//   GET  /api/implantacao/kit/modelo                  o checklist padrão (com os inativos)
//   POST /api/implantacao/kit/modelo                  inclui ou altera um item do checklist padrão (pelo código)
// Nada trava a virada (ADR 0002): o painel é informativo.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_KIT_IMPLANTACAO, type PortaKitImplantacaoPropria } from './kit-implantacao-propria.js';

export const PERMISSOES_KIT_IMPLANTACAO = {
  ler: 'implantacao.kit.ler',
  editar: 'implantacao.kit.editar',
  modelo: 'implantacao.modelo.editar',
} as const;

const AUDITORIA = 'executor: trilha na mesma transação do kit de implantação';

@Controller('implantacao/kit')
export class KitImplantacaoController {
  constructor(
    @Optional()
    @Inject(PORTA_KIT_IMPLANTACAO)
    private readonly porta: PortaKitImplantacaoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaKitImplantacaoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_KIT_IMPLANTACAO.ler)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painel(c));
  }

  @Get('modelo')
  @Permissao(PERMISSOES_KIT_IMPLANTACAO.ler)
  modelo(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.modelo(c));
  }

  @Post('modelo')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_KIT_IMPLANTACAO.modelo)
  salvarModelo(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.salvarModelo(c, corpo));
  }

  @Post()
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_KIT_IMPLANTACAO.editar)
  iniciar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.iniciar(c, corpo));
  }

  @Patch('itens/:item')
  @AuditadoNoHandler(AUDITORIA)
  @Permissao(PERMISSOES_KIT_IMPLANTACAO.editar)
  alterarItem(
    @Req() req: RequisicaoAutorizada,
    @Param('item', ParseIntPipe) item: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alterarItem(c, item, corpo));
  }

  @Post('metas/:meta/medicao')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_KIT_IMPLANTACAO.editar)
  medirMeta(
    @Req() req: RequisicaoAutorizada,
    @Param('meta', ParseIntPipe) meta: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.medirMeta(c, meta, corpo));
  }

  @Patch(':id')
  @AuditadoNoHandler(AUDITORIA)
  @Permissao(PERMISSOES_KIT_IMPLANTACAO.editar)
  alterarImplantacao(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alterarImplantacao(c, id, corpo));
  }

  @Post(':id/conferencia')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(200)
  @Permissao(PERMISSOES_KIT_IMPLANTACAO.editar)
  conferir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.conferir(c, id));
  }

  @Post(':id/metas')
  @AuditadoNoHandler(AUDITORIA)
  @HttpCode(201)
  @Permissao(PERMISSOES_KIT_IMPLANTACAO.editar)
  incluirMeta(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.incluirMeta(c, id, corpo));
  }
}
