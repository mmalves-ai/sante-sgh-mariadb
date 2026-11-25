// Liberação da OPME acima do limite do procedimento (06-FAT linha 25). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/tiss/opme-liberacao                    a fila: pedidos retidos e os decididos nos últimos 30 dias
//   POST /api/tiss/opme-liberacao/:id/decisao        { versao, decisao: aprovar|recusar|cancelar, justificativa }
// Quatro olhos: quem pediu não libera; a faixa e o nível vêm da alçada do tipo 'limite_opme' (ou a do limite).
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
import { PORTA_LIBERACAO_OPME, type PortaLiberacaoOpmePropria } from './opme-guia-propria.js';

export const PERMISSOES_LIBERACAO_OPME = {
  ler: 'faturamento.autorizacao.ler',
  liberar: 'faturamento.autorizacao.liberar',
} as const;

const TRILHA = 'executor: trilha na mesma transação da decisão da alçada';

@Controller('tiss/opme-liberacao')
export class OpmeLiberacaoController {
  constructor(
    @Optional()
    @Inject(PORTA_LIBERACAO_OPME)
    private readonly porta: PortaLiberacaoOpmePropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaLiberacaoOpmePropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    return fn(this.porta, sessaoDe(req).porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_LIBERACAO_OPME.ler)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.painel(c));
  }

  @Post(':id/decisao')
  @AuditadoNoHandler(TRILHA)
  @HttpCode(201)
  @Permissao(PERMISSOES_LIBERACAO_OPME.liberar)
  decidir(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.decidir(c, id, corpo));
  }
}
