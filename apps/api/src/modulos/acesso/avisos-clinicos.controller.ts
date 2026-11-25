// Avisos clínicos na central de avisos (F3.5, 05-SADT linha 10). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/acesso/avisos-clinicos               os avisos clínicos do usuário da sessão (novos, lidos, cientes)
//   POST /api/acesso/avisos-clinicos/:id/ciente     a ciência do próprio destinatário (a repetida não grava)
import { Controller, Get, HttpCode, Inject, Optional, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { PERMISSOES_INICIO } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_AVISOS_CLINICOS, type PortaAvisosClinicosPropria } from './avisos-clinicos-propria.js';

@Controller('acesso/avisos-clinicos')
export class AvisosClinicosController {
  constructor(
    @Optional()
    @Inject(PORTA_AVISOS_CLINICOS)
    private readonly porta: PortaAvisosClinicosPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaAvisosClinicosPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get()
  @Permissao(PERMISSOES_INICIO.avisoLer)
  listar(@Req() req: RequisicaoAutorizada) {
    return this.com(req, (p, c) => p.listar(c));
  }

  @Post(':id/ciente')
  @HttpCode(200)
  @Permissao(PERMISSOES_INICIO.avisoResolver)
  @AuditadoNoHandler('a ciência do aviso clínico vai à trilha pelo executor (mesma transação)')
  ciente(@Req() req: RequisicaoAutorizada, @Param('id', ParseIntPipe) id: number) {
    return this.com(req, (p, c) => p.ciente(c, id));
  }
}
