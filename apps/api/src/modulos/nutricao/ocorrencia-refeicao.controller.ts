// Ocorrências na entrega da refeição (F8, 04-HOT linha 143). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/nutricao/mapa/ocorrencias/tipos                         os tipos em uso (com o que exigem)
//   GET  /api/nutricao/mapa/ocorrencias?unidade=&refeicao=&data=      as ocorrências do mapa da refeição e do dia
//   POST /api/nutricao/mapa/ocorrencias                               registra sobre a bandeja do mapa fechado
//   POST /api/nutricao/mapa/ocorrencias/:id/resolver                  { providencia, versao } (nunca reescrita)
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
import { PERMISSOES_NUTRICAO_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  PORTA_OCORRENCIA_REFEICAO,
  type PortaOcorrenciaRefeicaoPropria,
} from './ocorrencia-refeicao-propria.js';

export const PERMISSOES_OCORRENCIA_REFEICAO = {
  ler: P.mapaLer,
  /** Quem distribui as bandejas (a copa, que imprime as etiquetas do mapa). */
  registrar: P.mapaImprimir,
  /** A providência é do serviço de nutrição e dietética (quem fecha o mapa). */
  resolver: P.mapaFechar,
} as const;

const AUDITORIA = 'ocorrência na entrega da refeição pelo executor (trilha na mesma transação)';

@Controller('nutricao/mapa/ocorrencias')
export class OcorrenciaRefeicaoController {
  constructor(
    @Optional()
    @Inject(PORTA_OCORRENCIA_REFEICAO)
    private readonly porta: PortaOcorrenciaRefeicaoPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaOcorrenciaRefeicaoPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('tipos')
  @Permissao(PERMISSOES_OCORRENCIA_REFEICAO.ler)
  tipos(@Req() req: RequisicaoAutorizada) {
    return this.com(req, async (p, c) => ({ itens: await p.tipos(c) }));
  }

  @Get()
  @Permissao(PERMISSOES_OCORRENCIA_REFEICAO.ler)
  listar(
    @Req() req: RequisicaoAutorizada,
    @Query('unidade') unidade?: string,
    @Query('refeicao') refeicao?: string,
    @Query('data') data?: string,
  ) {
    const r = Number(refeicao);
    const u = (unidade ?? '').trim();
    if (
      !/^[A-Za-z0-9._-]{1,30}$/.test(u) ||
      !Number.isInteger(r) ||
      r <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data ?? '')
    )
      throw new ErroProblema('entrada-invalida', 400, 'Informe a unidade, a refeição e o dia (AAAA-MM-DD)');
    return this.com(req, async (p, c) => ({
      itens: await p.listar(c, { unidade: u, refeicao: r, data: data as string }),
    }));
  }

  @Post()
  @HttpCode(201)
  @Permissao(PERMISSOES_OCORRENCIA_REFEICAO.registrar)
  @AuditadoNoHandler(AUDITORIA)
  registrar(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.registrar(c, corpo));
  }

  @Post(':id/resolver')
  @HttpCode(200)
  @Permissao(PERMISSOES_OCORRENCIA_REFEICAO.resolver)
  @AuditadoNoHandler(AUDITORIA)
  resolver(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.resolver(c, id, corpo));
  }
}
