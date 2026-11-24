// Preferências da própria conta (01-ADM L84), concedidas a todos os perfis de pessoa. Rotas:
// - GET /api/acesso/preferencias/minhas[?tela=<código>] (acesso.preferencia.ler): gerais, tela inicial, telas do
//   menu que podem ser a inicial e as visões salvas por tela (com a que cada tela abre);
// - PUT /api/acesso/preferencias/minhas (acesso.preferencia.editar): grava as gerais;
// - PUT /api/acesso/preferencias/minhas/telas/:tela (acesso.preferencia.editar): grava uma visão da tela.
// A tela inicial e as telas oferecidas seguem as permissões da sessão (o menu do cargo).
// A gravação e a trilha são do Executor (operacoes-preferencias-propria.ts); sempre a conta da sessão.
import { Body, Controller, Get, HttpCode, Inject, Param, Put, Query, Req } from '@nestjs/common';
import { PERMISSOES_ACESSO } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, ctxDe, problema, sessaoDe } from './comum.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao } from './fonte.js';
import type { PreferenciasLidas } from './operacoes-preferencias-propria.js';
import type { Ctx } from './tipos.js';

/** A fonte própria lê as preferências; a de memória não (503, falha fechada). */
interface FonteComPreferencias {
  lerPreferencias?(
    c: Ctx,
    usuario: number | null,
    tela?: string,
    permissoes?: ReadonlySet<string>,
  ): Promise<PreferenciasLidas>;
}

@Controller('acesso/preferencias/minhas')
export class PreferenciasController {
  constructor(@Inject(FONTE_ADMINISTRACAO) private readonly fonte: FonteAdministracao) {}

  @Get()
  @Permissao(PERMISSOES_ACESSO.preferenciaLer)
  async ler(@Req() req: RequisicaoAutorizada, @Query('tela') tela?: string): Promise<PreferenciasLidas> {
    const f = this.fonte as unknown as FonteComPreferencias;
    if (typeof f.lerPreferencias !== 'function')
      throw new ErroProblema('indisponivel', 503, 'Preferências indisponíveis neste ambiente');
    const t = typeof tela === 'string' && /^[A-Za-z0-9._-]{1,30}$/.test(tela) ? tela : undefined;
    const s = sessaoDe(req);
    return f
      .lerPreferencias(ctxDe(req, 'preferencias-ler'), s.usuario, t, s.permissoes)
      .catch((x: unknown) => problema(x));
  }

  @Put()
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.preferenciaEditar)
  @AuditadoNoHandler('executor: a trilha na mesma transação da operação')
  async gravar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    // As permissões vêm sempre da sessão, por cima do corpo: a tela inicial só pode ser uma tela do menu do cargo.
    const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
    const entrada = { ...c, permissoesSessao: [...sessaoDe(req).permissoes] };
    return this.fonte
      .executar('preferencias.gravarGeral', entrada, contextoOperacao(req, 'preferencias-geral'))
      .catch((x: unknown) => problema(x));
  }

  @Put('telas/:tela')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.preferenciaEditar)
  @AuditadoNoHandler('executor: a trilha na mesma transação da operação')
  async gravarVisao(@Param('tela') tela: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const c = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {};
    return this.fonte
      .executar('preferencias.gravarVisaoTela', { ...c, tela }, contextoOperacao(req, 'preferencias-visao'))
      .catch((x: unknown) => problema(x));
  }
}
