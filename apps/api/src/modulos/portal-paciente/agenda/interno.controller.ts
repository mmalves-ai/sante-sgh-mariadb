// Telas internas da etapa 2 do portal (M50; ficha, seção 7): a configuração da agenda online e a conferência do
// pré-check-in pela recepção. Sessão interna (@Permissao, CSRF da plataforma). A conferência que aprova campos grava o
// cadastro pela receita do M11 com quem conferiu (Idempotency-Key do pedido) e exige também `cadastro.paciente.editar`.
//   GET  /api/agenda/online                               agenda.online.ler (a lista, sem os convênios e serviços)
//   GET  /api/agenda/online/:tipo/:agenda                 agenda.online.ler (o detalhe: convênios e serviços da agenda)
//   PUT  /api/agenda/online                               agenda.online.configurar (agenda.configurarAgendaOnline)
//   GET  /api/recepcao/pre-checkin?situacao&data&depoisDe&termo  recepcao.precheckin.conferir (uma página de 50;
//                                                         termo = nome ou prontuário, pela busca do cadastro)
//   GET  /api/recepcao/pre-checkin/:id                    recepcao.precheckin.conferir
//   GET  /api/recepcao/pre-checkin/:id/documentos/:indice recepcao.precheckin.conferir (a leitura vai à trilha)
//   POST /api/recepcao/pre-checkin/:id/conferencia        recepcao.precheckin.conferir (+ cadastro.paciente.editar)
//   POST /api/recepcao/pre-checkin/:id/recusa             recepcao.precheckin.conferir
// W0-10: a tesouraria das cobranças do portal (o menu fica no W4-01; a tela é /tesouraria/portal):
//   GET  /api/tesouraria/portal/pagamentos?de=&ate=        portal.pagamento.conciliar (confirmados e duplicados)
//   POST /api/tesouraria/portal/pagamentos/:id/conciliacao portal.pagamento.conciliar (baixa ou divergência)
//   POST /api/tesouraria/portal/pagamentos/:id/estorno     portal.pagamento.estornar (crítica; reautenticação)
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  esquemaConciliarPagamentoPortal,
  esquemaConferirPreCheckin,
  esquemaConfigAgendaOnline,
  esquemaEstornarPagamentoPortal,
  esquemaFiltroFilaPreCheckin,
  esquemaFiltroTesourariaPortal,
  esquemaRecusarPreCheckin,
  PERMISSOES_CODIGOS_PORTAL_E2 as P,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { reautenticar } from '../../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { ServicoSessao } from '../../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../../acesso/acesso.controller.js';
import { contextoOperacao, sessaoDe } from '../../cadastro/comum.js';
import { corpo } from '../../exames/public-api.js';
import { SERVICO_AGENDA_PORTAL } from './portal-agenda.controller.js';
import type { QuemAgendaOnline, ServicoAgendaPortal } from './servico.js';

const id = (v: string): number => {
  if (!/^[1-9]\d{0,17}$/.test(v)) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
  return Number(v);
};

@Controller()
export class PortalAgendaInternoController {
  constructor(
    @Inject(SERVICO_AGENDA_PORTAL) private readonly agenda: ServicoAgendaPortal,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
  ) {}

  private quem(req: RequisicaoAutorizada): QuemAgendaOnline {
    const s = sessaoDe(req);
    const memoria = this.agenda.destino === 'memoria';
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      estacao: estacaoDaRequisicao(req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(req, 'portal-agenda').slice(0, 64),
      pode: (p) => s.pode(p),
      contextoOperacao: (rotulo) => contextoOperacao(s, rotulo),
      trilhaMemoria: async (evento, recurso, idAlvo) => {
        if (!memoria) return;
        await this.trilha.registrar({
          evento,
          rede: s.rede,
          hospital: s.hospital,
          usuario: s.login,
          estacao: estacaoDaRequisicao(req).slice(0, 80),
          correlacao: correlacaoDaRequisicao(req, `precheckin-${idAlvo}`).slice(0, 64),
          recurso,
          resultado: 'sucesso',
          tabelaAlvo: 'MEMORIA',
          idAlvo,
        });
      },
    };
  }

  @Get('agenda/online')
  @Header('cache-control', 'no-store')
  @Permissao(P.agendaOnlineLer)
  lista(@Req() req: RequisicaoAutorizada) {
    return this.agenda.listaConfig(this.quem(req));
  }

  @Get('agenda/online/:tipo/:agenda')
  @Header('cache-control', 'no-store')
  @Permissao(P.agendaOnlineLer)
  detalheConfig(
    @Param('tipo') tipo: string,
    @Param('agenda') agenda: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    if (tipo !== 'consulta' && tipo !== 'exame')
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    return this.agenda.detalheConfig(this.quem(req), tipo, id(agenda));
  }

  @Put('agenda/online')
  @Permissao(P.agendaOnlineConfigurar)
  @AuditadoNoHandler('agenda.configurarAgendaOnline: SGH_AGE_ONLINE_CFG com a SGH_TRILHA na mesma transação')
  configurar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.agenda.configurar(this.quem(req), corpo(esquemaConfigAgendaOnline, b));
  }

  @Get('recepcao/pre-checkin')
  @Header('cache-control', 'no-store')
  @Permissao(P.precheckinConferir)
  fila(@Query() q: Record<string, string | undefined>, @Req() req: RequisicaoAutorizada) {
    const depois = q['depoisDe'];
    const f = corpo(esquemaFiltroFilaPreCheckin, {
      situacao: q['situacao'] || undefined,
      data: q['data'] || null,
      depoisDe: depois && /^\d{1,18}$/.test(depois) ? Number(depois) : null,
      termo: q['termo']?.trim() || null,
    });
    return this.agenda.fila(this.quem(req), f);
  }

  @Get('recepcao/pre-checkin/:id')
  @Header('cache-control', 'no-store')
  @Permissao(P.precheckinConferir)
  detalhe(@Param('id') pre: string, @Req() req: RequisicaoAutorizada) {
    return this.agenda.detalhe(this.quem(req), id(pre));
  }

  @Get('recepcao/pre-checkin/:id/documentos/:indice')
  @Header('cache-control', 'no-store')
  @Permissao(P.precheckinConferir)
  @AuditadoNoHandler('a leitura do documento (portal.precheckin.conferido, "documento-lido") na SGH_TRILHA')
  documento(@Param('id') pre: string, @Param('indice') indice: string, @Req() req: RequisicaoAutorizada) {
    if (!/^[0-2]$/.test(indice)) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    return this.agenda.documento(this.quem(req), id(pre), Number(indice));
  }

  @Post('recepcao/pre-checkin/:id/conferencia')
  @HttpCode(200)
  @Permissao(P.precheckinConferir)
  @AuditadoNoHandler(
    'cadastro.alterarPaciente pelo executor (o aprovado) e portal.precheckin.conferido na SGH_TRILHA',
  )
  conferir(@Param('id') pre: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.agenda.conferir(this.quem(req), id(pre), corpo(esquemaConferirPreCheckin, b));
  }

  @Post('recepcao/pre-checkin/:id/recusa')
  @HttpCode(200)
  @Permissao(P.precheckinConferir)
  @AuditadoNoHandler('portal.precheckin.conferido (recusado): SGH_POR_PRECHECKIN com a SGH_TRILHA')
  recusar(@Param('id') pre: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.agenda.recusar(this.quem(req), id(pre), corpo(esquemaRecusarPreCheckin, b));
  }

  // ── W0-10: tesouraria das cobranças do portal ──────────────────────────────────────────────────────────────────

  @Get('tesouraria/portal/pagamentos')
  @Header('cache-control', 'no-store')
  @Permissao(P.pagamentoConciliar)
  tesouraria(@Query() q: Record<string, string | undefined>, @Req() req: RequisicaoAutorizada) {
    const f = corpo(esquemaFiltroTesourariaPortal, { de: q['de'] ?? '', ate: q['ate'] ?? '' });
    return this.agenda.tesouraria.listar(this.quem(req), f);
  }

  @Post('tesouraria/portal/pagamentos/:id/conciliacao')
  @HttpCode(200)
  @Permissao(P.pagamentoConciliar)
  @AuditadoNoHandler('portal.pagamento.conciliado: SGH_POR_CONCILIACAO com a SGH_TRILHA na mesma transação')
  conciliar(@Param('id') pag: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.agenda.tesouraria.conciliar(
      this.quem(req),
      id(pag),
      corpo(esquemaConciliarPagamentoPortal, b),
    );
  }

  @Post('tesouraria/portal/pagamentos/:id/estorno')
  @HttpCode(200)
  @Permissao(P.pagamentoEstornar)
  @AuditadoNoHandler('portal.pagamento.estornado: o gateway e a SGH_POR_CONCILIACAO com a SGH_TRILHA')
  async estornar(@Param('id') pag: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
    const { senha, ...resto } = o;
    const e = corpo(esquemaEstornarPagamentoPortal, resto);
    if (this.agenda.destino !== 'memoria' || req.sgh?.real)
      await reautenticar(this.sessoes, this.resolvedor, req, typeof senha === 'string' ? senha : undefined);
    return this.agenda.tesouraria.estornar(this.quem(req), id(pag), e);
  }
}
