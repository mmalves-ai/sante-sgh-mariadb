// Cadastro do calendário de entrega da fatura por convênio (F3.7, 06-FAT linha 31):
//   GET  /api/tiss/calendario-entrega?convenio&inativas    faturamento.lote.ler (o mesmo do painel de prazos)
//   POST /api/tiss/calendario-entrega                      faturamento.competencia.fechar (incluir; Idempotency-Key)
//   POST /api/tiss/calendario-entrega/:id                  faturamento.competencia.fechar (alterar, com a versão lida)
//   POST /api/tiss/calendario-entrega/:id/inativacao       faturamento.competencia.fechar (inativar; nunca apaga)
// Quem fecha a competência do convênio é quem combina com ele as janelas de entrega dela. O escopo por convênio do
// faturista vale na lista e na gravação. A gravação passa pelo executor (trilha e autoria na mesma transação); sem o
// banco próprio, a fonte sintética usa o cadastro em memória da porta do TISS.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { JanelaCalendarioLida } from '@sgh/contratos';
import { conferirEscopoConvenio, filtroConvenios } from '@sgh/dominio-faturamento';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { sessaoDe } from '../cadastro/comum.js';
import { escopoConvenios } from '../faturamento/servico.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, problemaDoPreco } from '../precos/base.js';
import type { AcaoCalendario, FonteCalendarioEntrega } from './calendario-entrega-propria.js';

export const FONTE_CALENDARIO_ENTREGA = Symbol('FONTE_CALENDARIO_ENTREGA');

const ORIGEM = 'calendario-entrega';

@Controller('tiss/calendario-entrega')
export class CalendarioEntregaController {
  constructor(@Inject(FONTE_CALENDARIO_ENTREGA) private readonly fonte: FonteCalendarioEntrega | null) {}

  private f(): FonteCalendarioEntrega {
    if (!this.fonte)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'O calendário de entrega exige o banco próprio do cliente.',
      );
    return this.fonte;
  }

  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }

  private exigirEscopo(req: RequisicaoAutorizada, convenio: number | null): void {
    if (convenio === null)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Janela não encontrada',
        'A janela de entrega não existe.',
      );
    const r = conferirEscopoConvenio(escopoConvenios(sessaoDe(req)), convenio);
    if (r)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora do escopo',
        'O convênio está fora do seu escopo de faturamento.',
        { codigo: r.codigo },
      );
  }

  @Get()
  @Permissao('faturamento.lote.ler')
  listar(
    @Query('convenio') convenio: string | undefined,
    @Query('inativas') inativas: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<JanelaCalendarioLida[]> {
    const pedido = Number(convenio);
    const convenios = filtroConvenios(
      escopoConvenios(sessaoDe(req)),
      Number.isInteger(pedido) && pedido > 0 ? pedido : null,
    );
    return this.rodar(() =>
      this.f().listar(ctxDe(req, ORIGEM), { convenios, inativas: inativas === '1' || inativas === 'true' }),
    );
  }

  private async gravar(acao: AcaoCalendario, req: RequisicaoAutorizada, corpo: unknown, id: number | null) {
    const op = contextoOperacao(req, ORIGEM);
    return this.rodar(async () => {
      if (id === null) {
        const cv = Number((corpo as { convenio?: unknown } | null)?.convenio);
        if (Number.isInteger(cv) && cv > 0) this.exigirEscopo(req, cv);
        return this.f().gravar(acao, op, corpo);
      }
      this.exigirEscopo(req, await this.f().convenioDaJanela(ctxDe(req, ORIGEM), id));
      return this.f().gravar(acao, op, { ...(corpo as object), id });
    });
  }

  @Post()
  @HttpCode(200)
  @Permissao('faturamento.competencia.fechar')
  @AuditadoNoHandler(
    'faturamento.incluir-calendario-entrega pelo executor (trilha e autoria na mesma transação)',
  )
  incluir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('incluir', req, corpo, null);
  }

  @Post(':id')
  @HttpCode(200)
  @Permissao('faturamento.competencia.fechar')
  @AuditadoNoHandler(
    'faturamento.alterar-calendario-entrega pelo executor (trilha e autoria na mesma transação)',
  )
  alterar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('alterar', req, corpo, idDaJanela(id));
  }

  @Post(':id/inativacao')
  @HttpCode(200)
  @Permissao('faturamento.competencia.fechar')
  @AuditadoNoHandler(
    'faturamento.inativar-calendario-entrega pelo executor (trilha e autoria na mesma transação)',
  )
  inativar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar('inativar', req, corpo, idDaJanela(id));
  }
}

function idDaJanela(v: string): number {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0)
    throw new ErroProblema('entrada-invalida', 400, 'Pedido inválido', 'Janela inválida.');
  return id;
}
