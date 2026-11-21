// Tela interna do portal do médico externo (M50, etapa 3; ficha, seção 7): as contas aprovadas do portal (M26), o
// profissional do corpo clínico ligado a cada uma (com a sugestão pelo número e pela UF do conselho; a pessoa decide) e
// os pedidos de cirurgia em aberto. Sessão interna (@Permissao, CSRF da plataforma). Prefixo `portal-medico` (o
// `/api/portal/...` é o portal de resultados do M26).
//   GET  /api/portal-medico/contas?q&situacao&pagina      portal.medicoExterno.ler (25 por página)
//   GET  /api/portal-medico/profissionais?q               portal.medicoExterno.vincular (busca pelo nome; teto 30)
//   POST /api/portal-medico/contas/:acesso/vinculo        portal.medicoExterno.vincular
//   POST /api/portal-medico/contas/:acesso/desvinculo     portal.medicoExterno.vincular
//   POST /api/portal-medico/contas/:acesso/ato            portal.medicoExterno.conta (W0-10; crítica: reautenticação)
//   GET  /api/portal-medico/contas/:acesso/atos           portal.medicoExterno.ler (W0-10; o histórico da conta)
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
  Query,
  Req,
} from '@nestjs/common';
import {
  type AtoContaMedicoExternoItem,
  esquemaAtoContaMedicoExterno,
  type ContasMedicoExterno,
  esquemaFiltroContasMedicoExterno,
  esquemaVincularMedicoExterno,
  EVENTOS_AUDITAVEIS,
  PERMISSOES_CODIGOS_PORTAL_MEDICO as P,
  type ResultadoAtoContaMedicoExterno,
  type ResultadoPortalMedico,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { CanalMedicoSimulador } from './aplicacao/canal.js';
import type { QuemInternoMedico, ServicoPortalMedico } from './aplicacao/servico.js';
import { SERVICO_PORTAL_MEDICO } from './portal-medico.controller.js';

const id = (v: string): number => {
  if (!/^[1-9]\d{0,17}$/.test(v)) throw new ErroProblema('nao-encontrado', 404, 'Conta não encontrada');
  return Number(v);
};

/** A Idempotency-Key do pedido (opcional: sem ela, cada gravação é nova); a chave fora do formato é recusada. */
const FORMATO_CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
function chaveDoPedido(req: RequisicaoAutorizada): string | null {
  const bruto = req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  if (chave === undefined || chave === '') return null;
  if (!FORMATO_CHAVE.test(chave))
    throw new ErroProblema('entrada-invalida', 400, 'Pedido inválido', 'A Idempotency-Key está fora do formato.');
  return chave;
}

@Controller('portal-medico')
export class PortalMedicoInternoController {
  constructor(
    @Inject(SERVICO_PORTAL_MEDICO) private readonly portal: ServicoPortalMedico,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
  ) {}

  private quem(req: RequisicaoAutorizada): QuemInternoMedico {
    const s = sessaoDe(req);
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      estacao: estacaoDaRequisicao(req),
      correlacao: correlacaoDaRequisicao(req, 'portal-medico'),
      contexto: s.porta,
      idempotencia: chaveDoPedido(req),
    };
  }

  @Get('contas')
  @Header('cache-control', 'no-store')
  @Permissao(P.contasLer)
  @Auditar(EVENTOS_AUDITAVEIS.portalMedicoContasLidas.codigo)
  contas(@Query() filtro: unknown, @Req() req: RequisicaoAutorizada): Promise<ContasMedicoExterno> {
    const f = corpo(esquemaFiltroContasMedicoExterno, filtro ?? {});
    req.sghAlvo = { tabelaAlvo: 'conta_portal_profissional_externo', idAlvo: 'contas' };
    return this.portal.contas(this.quem(req), f);
  }

  @Get('profissionais')
  @Permissao(P.vincular)
  profissionais(@Query('q') q: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.portal.buscarProfissionais(this.quem(req), q ?? '');
  }

  @Post('contas/:acesso/vinculo')
  @HttpCode(200)
  @Permissao(P.vincular)
  @AuditadoNoHandler(
    'o vínculo (conta_portal_profissional_externo) com a trilha de auditoria na mesma transação',
  )
  vincular(
    @Param('acesso') acesso: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPortalMedico> {
    const e = corpo(esquemaVincularMedicoExterno, b);
    return this.portal.vincular(this.quem(req), id(acesso), e.profissional);
  }

  @Post('contas/:acesso/desvinculo')
  @HttpCode(200)
  @Permissao(P.vincular)
  @AuditadoNoHandler(
    'o desvínculo (conta_portal_profissional_externo) com a trilha de auditoria na mesma transação',
  )
  desvincular(
    @Param('acesso') acesso: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPortalMedico> {
    return this.portal.desvincular(this.quem(req), id(acesso));
  }

  // ── W0-10: bloqueio, desbloqueio e encerramento da conta (com motivo; a conta que operou não se exclui) ─────────

  @Post('contas/:acesso/ato')
  @HttpCode(200)
  @Permissao(P.contaGerir)
  @AuditadoNoHandler(
    'o ato (conta_portal_profissional_externo) e a situação da conta com a trilha de auditoria na mesma transação',
  )
  async atoConta(
    @Param('acesso') acesso: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAtoContaMedicoExterno> {
    const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
    const { senha, ...resto } = o;
    const e = corpo(esquemaAtoContaMedicoExterno, resto);
    if (this.portal.destino !== 'memoria' || req.sgh?.real)
      await reautenticar(this.sessoes, this.resolvedor, req, typeof senha === 'string' ? senha : undefined);
    return this.portal.atoConta(this.quem(req), id(acesso), e);
  }

  @Get('contas/:acesso/atos')
  @Header('cache-control', 'no-store')
  @Permissao(P.contasLer)
  atosConta(
    @Param('acesso') acesso: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AtoContaMedicoExternoItem[]> {
    return this.portal.atosConta(this.quem(req), id(acesso));
  }

  /** W0-10, só dev/ci: as mensagens que o simulador recebeu (nenhuma sai do processo); fora dele, 404. */
  @Get('simulador/mensagens')
  @Header('cache-control', 'no-store')
  @Permissao(P.contasLer)
  simulador(@Query('acesso') acesso: string | undefined, @Req() req: RequisicaoAutorizada) {
    const amb = (process.env['AMBIENTE'] ?? 'dev').trim();
    if (!(this.portal.canal instanceof CanalMedicoSimulador) || (amb !== 'dev' && amb !== 'ci'))
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    return { mensagens: this.portal.canal.mensagens(this.quem(req).hospital, acesso ? id(acesso) : null) };
  }
}
