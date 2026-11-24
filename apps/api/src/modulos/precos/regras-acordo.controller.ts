// Regras do acordo com a fonte pagadora (06-FAT linha 1), numa visão só por convênio:
//   GET /api/cadastros/convenios/:cod/regras-acordo?data=AAAA-MM-DD   percentuais por componente, desconto por grupo
//                                                                    de despesa, via de acesso, itens isentos e tetos,
//                                                                    cada regra com a vigência e "vigente na data"
// Sem o banco próprio, 503 (falha fechada). O convênio fora do escopo da sessão é recusado sem vazar.
import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { ctxDe, dataDe, exigirNoEscopo, inteiro } from './base.js';
import { FONTE_PRECOS, type FontePrecos } from './fonte.js';
import type { LeitorRegrasAcordo, RegrasDoAcordo } from './regras-acordo-propria.js';

export const LEITOR_REGRAS_ACORDO = Symbol('LEITOR_REGRAS_ACORDO');

@Controller('cadastros/convenios')
export class RegrasAcordoController {
  constructor(
    @Inject(LEITOR_REGRAS_ACORDO) private readonly leitor: LeitorRegrasAcordo | null,
    @Inject(FONTE_PRECOS) private readonly fonte: FontePrecos,
  ) {}

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
