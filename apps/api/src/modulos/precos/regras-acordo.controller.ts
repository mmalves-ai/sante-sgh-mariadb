// Regras do acordo com a fonte pagadora (06-FAT linha 1), numa visão só por convênio:
//   GET /api/cadastros/convenios/:cod/regras-acordo?data=AAAA-MM-DD   percentuais por componente, desconto por grupo
//                                                                    de despesa, via de acesso, itens isentos e tetos,
//                                                                    cada regra com a vigência e "vigente na data"
//   POST /api/cadastros/convenios/:cod/regras-acordo/:tipo                 convenio.contrato.editar: inclui a regra
//                                                                    (percentual, desconto, via, isento, teto, alto-custo);
//                                                                    a anterior da mesma chave encerra na véspera
//   POST /api/cadastros/convenios/:cod/regras-acordo/:tipo/:id/encerramento   convenio.contrato.editar: encerra a vigência
// As gravações levam Idempotency-Key e passam pelo executor (trilha e autoria na mesma transação); nada se apaga.
// Sem o banco próprio, 503 (falha fechada). O convênio fora do escopo da sessão é recusado sem vazar.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { TIPOS_REGRA_ACORDO, type TipoRegraAcordo } from '@sgh/dominio-preco';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, dataDe, exigirNoEscopo, inteiro, problemaDoPreco } from './base.js';
import { FONTE_PRECOS, type FontePrecos } from './fonte.js';
import type { GravadorRegrasAcordo, NomeOperacaoRegraAcordo } from './regras-acordo-gravacao.js';
import type { LeitorRegrasAcordo, RegrasDoAcordo } from './regras-acordo-propria.js';

export const LEITOR_REGRAS_ACORDO = Symbol('LEITOR_REGRAS_ACORDO');
export const GRAVADOR_REGRAS_ACORDO = Symbol('GRAVADOR_REGRAS_ACORDO');
const EXECUTOR = 'executor: trilha e autoria na mesma transação';

const objeto = (c: unknown): Record<string, unknown> =>
  c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};

function tipoDe(tipo: string): TipoRegraAcordo {
  if (!(TIPOS_REGRA_ACORDO as readonly string[]).includes(tipo))
    throw new ErroProblema('nao-encontrado', 404, 'Tipo de regra desconhecido');
  return tipo as TipoRegraAcordo;
}

@Controller('cadastros/convenios')
export class RegrasAcordoController {
  constructor(
    @Inject(LEITOR_REGRAS_ACORDO) private readonly leitor: LeitorRegrasAcordo | null,
    @Inject(FONTE_PRECOS) private readonly fonte: FontePrecos,
    @Inject(GRAVADOR_REGRAS_ACORDO) private readonly gravador: GravadorRegrasAcordo | null,
  ) {}

  private async gravar(
    req: RequisicaoAutorizada,
    cod: string,
    nome: NomeOperacaoRegraAcordo,
    entrada: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.gravador)
      throw new ErroProblema('indisponivel', 503, 'As regras do acordo exigem o banco próprio.');
    const c = inteiro(cod, 'convênio');
    exigirNoEscopo(req, c);
    const ctx = contextoOperacao(req, 'regras-acordo');
    if (!(await this.fonte.convenio(ctx, c)))
      throw new ErroProblema('nao-encontrado', 404, 'Convênio não encontrado');
    try {
      return await this.gravador.gravar(nome, ctx, { ...entrada, fonteId: c });
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }

  @Post(':cod/regras-acordo/:tipo')
  @HttpCode(201)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  incluir(
    @Param('cod') cod: string,
    @Param('tipo') tipo: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.gravar(req, cod, tipoDe(tipo), objeto(corpo));
  }

  @Post(':cod/regras-acordo/:tipo/:id/encerramento')
  @HttpCode(200)
  @Permissao('convenio.contrato.editar')
  @AuditadoNoHandler(EXECUTOR)
  encerrar(
    @Param('cod') cod: string,
    @Param('tipo') tipo: string,
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.gravar(req, cod, `${tipoDe(tipo)}.encerrar`, { ...objeto(corpo), id: inteiro(id, 'id') });
  }

  @Get(':cod/regras-acordo')
  @Permissao('convenio.contrato.ler')
  async regras(
    @Param('cod') cod: string,
    @Query('data') data: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegrasDoAcordo> {
    if (!this.leitor)
      throw new ErroProblema('indisponivel', 503, 'As regras do acordo exigem o banco próprio.');
    const c = inteiro(cod, 'convênio');
    exigirNoEscopo(req, c);
    const ctx = ctxDe(req, 'regras-acordo');
    if (!(await this.fonte.convenio(ctx, c)))
      throw new ErroProblema('nao-encontrado', 404, 'Convênio não encontrado');
    return this.leitor.regras(ctx, c, dataDe(data) ?? (await this.fonte.hoje(ctx)));
  }
}
