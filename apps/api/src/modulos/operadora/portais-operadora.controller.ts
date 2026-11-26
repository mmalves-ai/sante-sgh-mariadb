// C3-027 (08-SGO linha 114, F8): os portais externos da operadora — beneficiário, empresa contratante e corretor.
// A identidade é a única da plataforma (usuário com credencial e segundo fator da administração); a conta do portal liga
// esse usuário ao beneficiário, ao gestor da contratante ou ao corretor. Nada vem da tela sobre quem é o titular: o
// handler do portal acha a conta ativa do usuário da sessão e trabalha só sobre ela.
// Lado do portal (permissão operadora.portal.acessar e conta ativa do usuário):
//   GET  /api/portal-operadora/:portal/conta                 a conta do usuário naquele portal
//   GET  /api/portal-operadora/beneficiario/cartao?beneficiario   o cartão digital (o próprio ou um dependente)
//   GET  /api/portal-operadora/:portal/solicitacoes          as solicitações da conta
//   POST /api/portal-operadora/:portal/solicitacoes          segunda via, reembolso, alteração, exclusão, reativação
//   POST /api/portal-operadora/:portal/solicitacoes/:id/cancelar   a da conta ainda não decidida
//   GET  /api/portal-operadora/contratante/lotes ; POST (exclusão em lote) ; GET lotes/:id/itens
// Lado da operadora (usuário interno, permissão do cadastro de beneficiários):
//   GET  /api/operadora/portais/:portal/contas ; POST (convidar) ; POST contas/:id/situacao
//   GET  /api/operadora/portais/solicitacoes?situacao ; POST solicitacoes/:id/decisao
//   GET  /api/operadora/portais/lotes ; GET lotes/:id/itens ; POST lotes/:id/processar
//   GET  /api/operadora/portais/canal-mensagens              o canal de SMS e e-mail (plataforma Hal-AI, desligado)
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import {
  CANAL_MENSAGEM_PORTAL,
  SITUACOES_CONTA_PORTAL,
  SITUACOES_SOLICITACAO_PORTAL,
  TIPOS_POR_PORTAL,
  TIPOS_PORTAL_OPERADORA,
  TIPOS_SOLICITACAO_PORTAL,
  type TipoPortalOperadora,
} from '@sgh/dominio-operadora';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  type ContaPortalLida,
  PORTA_PORTAIS_OPERADORA,
  type PortaPortaisOperadoraPropria,
} from './portais-operadora-propria.js';

const E = EVENTOS_AUDITAVEIS;
const RECURSO = 'operadora.portais';
const PERM_LER = 'operadora.beneficiario.ler';
const PERM_EDITAR = 'operadora.beneficiario.editar';
const PERM_PORTAL = 'operadora.portal.acessar';

export const ROTAS_PORTAIS_OPERADORA = {
  contaPortal: 'portal-operadora/:portal/conta',
  cartaoPortal: 'portal-operadora/beneficiario/cartao',
  solicitacoesPortal: 'portal-operadora/:portal/solicitacoes',
  cancelarPortal: 'portal-operadora/:portal/solicitacoes/:id/cancelar',
  lotesPortal: 'portal-operadora/contratante/lotes',
  itensPortal: 'portal-operadora/contratante/lotes/:id/itens',
  contas: 'operadora/portais/:portal/contas',
  situacaoConta: 'operadora/portais/:portal/contas/:id/situacao',
  solicitacoes: 'operadora/portais/solicitacoes',
  decisao: 'operadora/portais/solicitacoes/:id/decisao',
  lotes: 'operadora/portais/lotes',
  itens: 'operadora/portais/lotes/:id/itens',
  processar: 'operadora/portais/lotes/:id/processar',
  canal: 'operadora/portais/canal-mensagens',
} as const;
const R = ROTAS_PORTAIS_OPERADORA;

const opc = <T extends z.ZodTypeAny>(t: T) => t.nullable().default(null);
const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const esquemaConvite = z
  .object({
    login: z.string().trim().min(1).max(254),
    email: opc(z.string().trim().max(254)),
    celular: opc(z.string().trim().max(20)),
    usuario: opc(id),
    beneficiario: opc(id),
    contratante: opc(id),
    gestor: opc(id),
    corretora: opc(id),
    vendedor: opc(id),
  })
  .strict();
const esquemaSituacaoConta = z
  .object({
    versao: id,
    acao: z.enum(['ativar', 'bloquear', 'desbloquear', 'encerrar']),
    motivo: opc(z.string().trim().max(200)),
    termosAceitos: z.boolean().default(false),
  })
  .strict();
const esquemaSolicitacao = z
  .object({
    tipo: z.enum(TIPOS_SOLICITACAO_PORTAL),
    beneficiario: opc(id),
    motivo: opc(id),
    dataEfeito: opc(data),
    pedidoReembolso: opc(id),
    dados: opc(z.record(z.string(), z.unknown())),
    observacao: opc(z.string().trim().max(2000)),
  })
  .strict();
const esquemaDecisao = z
  .object({
    versao: id,
    acao: z.enum(['analisar', 'pedir_documento', 'aprovar', 'reprovar', 'concluir']),
    resultado: opc(z.string().trim().max(1000)),
  })
  .strict();
const esquemaVersao = z.object({ versao: id }).strict();
const esquemaLote = z
  .object({
    linhas: z
      .array(
        z
          .object({
            sequencia: z.number().int().positive(),
            matricula: z.string().max(30),
            motivo: opc(id),
            dataEfeito: opc(data),
          })
          .strict(),
      )
      .min(1)
      .max(5000),
  })
  .strict();

const idRota = (v: string): number => {
  if (!/^[1-9]\d{0,17}$/.test(v)) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
  return Number(v);
};
const portalRota = (v: string): TipoPortalOperadora => {
  if (!(TIPOS_PORTAL_OPERADORA as readonly string[]).includes(v))
    throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
  return v as TipoPortalOperadora;
};

/** A conta para o portal: sem o vínculo com o usuário nem os dados de bloqueio. */
const contaPublica = (c: ContaPortalLida) => ({
  id: c.id,
  portal: c.portal,
  login: c.login,
  email: c.email,
  celular: c.celular,
  situacao: c.situacao,
  tipos: TIPOS_POR_PORTAL[c.portal],
});

@Controller()
export class PortaisOperadoraController {
  constructor(@Inject(PORTA_PORTAIS_OPERADORA) private readonly porta: PortaPortaisOperadoraPropria) {}

  private linha(s: SessaoCadastro, evento: string, operacao: string, tabela: string) {
    return (r: { id: number }) => linhaTrilha(s, evento, RECURSO, operacao, { tabela, id: String(r.id) });
  }

  private falha = (x: unknown): never => {
    throw problemaDoCadastro(x);
  };

  /** A conta ativa do usuário da sessão no portal; sem ela, 403 (nada é lido). */
  private async conta(req: RequisicaoAutorizada, portal: TipoPortalOperadora) {
    const s = sessaoDe(req);
    const usuario = s.porta.usuario;
    const c =
      typeof usuario === 'number'
        ? await this.porta.contaDoUsuario(s.porta, portal, usuario).catch(this.falha)
        : null;
    if (!c)
      throw new ErroProblema('sem-permissao', 403, 'Sem conta no portal', 'Sem conta ativa neste portal.');
    return { s, c };
  }

  // ── Portal ────────────────────────────────────────────────────────────────────────────────────

  @Get(R.contaPortal)
  @Permissao(PERM_PORTAL)
  async contaPortal(@Param('portal') p: string, @Req() req: RequisicaoAutorizada) {
    const { c } = await this.conta(req, portalRota(p));
    return contaPublica(c);
  }

  @Get(R.cartaoPortal)
  @Permissao(PERM_PORTAL)
  async cartaoPortal(@Query('beneficiario') b: string | undefined, @Req() req: RequisicaoAutorizada) {
    const { s, c } = await this.conta(req, 'beneficiario');
    const cartao = await this.porta.cartaoDigital(s.porta, c, b ? idRota(b) : undefined).catch(this.falha);
    if (!cartao) throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    return cartao;
  }

  @Get(R.solicitacoesPortal)
  @Permissao(PERM_PORTAL)
  async solicitacoesPortal(@Param('portal') p: string, @Req() req: RequisicaoAutorizada) {
    const portal = portalRota(p);
    const { s, c } = await this.conta(req, portal);
    const f = portal === 'contratante' ? { contaContratante: c.id } : { contaBeneficiario: c.id };
    return { itens: await this.porta.solicitacoes(s.porta, f).catch(this.falha) };
  }

  @Post(R.solicitacoesPortal)
  @HttpCode(201)
  @Permissao(PERM_PORTAL)
  @AuditadoNoHandler(
    'a solicitação do portal (solicitacao_portal_beneficiario) com a trilha na mesma transação',
  )
  async abrirPortal(@Param('portal') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSolicitacao, b);
    const { s, c } = await this.conta(req, portalRota(p));
    return this.porta
      .abrirSolicitacao(
        s.porta,
        c,
        e,
        this.linha(
          s,
          E.operadoraPortalSolicitacaoAberta.codigo,
          'operadora.portal.solicitacao.abrir',
          'solicitacao_portal_beneficiario',
        ),
      )
      .catch(this.falha);
  }

  @Post(R.cancelarPortal)
  @HttpCode(200)
  @Permissao(PERM_PORTAL)
  @AuditadoNoHandler(
    'o cancelamento da solicitação pelo próprio solicitante, com a trilha na mesma transação',
  )
  async cancelarPortal(
    @Param('portal') p: string,
    @Param('id') n: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const portal = portalRota(p);
    const e = corpo(esquemaVersao, b);
    const { s, c } = await this.conta(req, portal);
    return this.porta
      .decidirSolicitacao(
        s.porta,
        {
          id: idRota(n),
          versao: e.versao,
          acao: 'cancelar',
          resultado: null,
          analista: null,
          dono: { portal, conta: c.id },
        },
        this.linha(
          s,
          E.operadoraPortalSolicitacaoDecidida.codigo,
          'operadora.portal.solicitacao.decidir',
          'solicitacao_portal_beneficiario',
        ),
      )
      .catch(this.falha);
  }

  @Get(R.lotesPortal)
  @Permissao(PERM_PORTAL)
  async lotesPortal(@Req() req: RequisicaoAutorizada) {
    const { s, c } = await this.conta(req, 'contratante');
    return { itens: await this.porta.lotes(s.porta, c.contratante ?? -1).catch(this.falha) };
  }

  @Get(R.itensPortal)
  @Permissao(PERM_PORTAL)
  async itensPortal(@Param('id') n: string, @Req() req: RequisicaoAutorizada) {
    const { s, c } = await this.conta(req, 'contratante');
    return { itens: await this.porta.itensDoLote(s.porta, idRota(n), c.contratante ?? -1).catch(this.falha) };
  }

  @Post(R.lotesPortal)
  @HttpCode(201)
  @Permissao(PERM_PORTAL)
  @AuditadoNoHandler('o lote de exclusão da contratante criticado, com a trilha na mesma transação')
  async loteExclusao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaLote, b);
    const { s, c } = await this.conta(req, 'contratante');
    return this.porta
      .receberExclusaoLote(
        s.porta,
        c,
        e.linhas,
        this.linha(
          s,
          E.operadoraPortalLoteExclusao.codigo,
          'operadora.portal-contratante.lote.receber',
          'movimentacao_lote_contratante',
        ),
      )
      .catch(this.falha);
  }

  // ── Operadora ─────────────────────────────────────────────────────────────────────────────────

  @Get(R.contas)
  @Permissao(PERM_LER)
  async contas(
    @Param('portal') p: string,
    @Query('situacao') situacao: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const sit = z
      .enum(SITUACOES_CONTA_PORTAL)
      .optional()
      .safeParse(situacao || undefined);
    if (!sit.success)
      throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
    const s = sessaoDe(req);
    return { itens: await this.porta.contas(s.porta, portalRota(p), sit.data).catch(this.falha) };
  }

  @Post(R.contas)
  @HttpCode(201)
  @Permissao(PERM_EDITAR)
  @AuditadoNoHandler('o convite da conta do portal externo, com a trilha na mesma transação')
  async convidar(@Param('portal') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const portal = portalRota(p);
    const e = corpo(esquemaConvite, b);
    const s = sessaoDe(req);
    return this.porta
      .convidarConta(
        s.porta,
        { ...e, portal },
        this.linha(
          s,
          E.operadoraPortalContaConvidada.codigo,
          `operadora.portal-${portal}.conta.convidar`,
          `conta_portal_${portal}`,
        ),
      )
      .catch(this.falha);
  }

  @Post(R.situacaoConta)
  @HttpCode(200)
  @Permissao(PERM_EDITAR)
  @AuditadoNoHandler('a mudança de situação da conta do portal externo, com a trilha na mesma transação')
  async situacaoConta(
    @Param('portal') p: string,
    @Param('id') n: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const portal = portalRota(p);
    const e = corpo(esquemaSituacaoConta, b);
    const s = sessaoDe(req);
    return this.porta
      .mudarSituacaoConta(
        s.porta,
        { portal, id: idRota(n), ...e },
        this.linha(
          s,
          E.operadoraPortalContaSituacao.codigo,
          `operadora.portal-${portal}.conta.situacao`,
          `conta_portal_${portal}`,
        ),
      )
      .catch(this.falha);
  }

  @Get(R.solicitacoes)
  @Permissao(PERM_LER)
  async solicitacoes(@Query('situacao') situacao: string | undefined, @Req() req: RequisicaoAutorizada) {
    const sit = z
      .enum(SITUACOES_SOLICITACAO_PORTAL)
      .optional()
      .safeParse(situacao || undefined);
    if (!sit.success)
      throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
    const s = sessaoDe(req);
    return {
      itens: await this.porta.solicitacoes(s.porta, sit.data ? { situacao: sit.data } : {}).catch(this.falha),
    };
  }

  @Post(R.decisao)
  @HttpCode(200)
  @Permissao(PERM_EDITAR)
  @AuditadoNoHandler('a decisão da solicitação do portal, com a trilha na mesma transação')
  async decidir(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaDecisao, b);
    const s = sessaoDe(req);
    return this.porta
      .decidirSolicitacao(
        s.porta,
        { id: idRota(n), ...e, analista: typeof s.porta.usuario === 'number' ? s.porta.usuario : null },
        this.linha(
          s,
          E.operadoraPortalSolicitacaoDecidida.codigo,
          'operadora.portal.solicitacao.decidir',
          'solicitacao_portal_beneficiario',
        ),
      )
      .catch(this.falha);
  }

  @Get(R.lotes)
  @Permissao(PERM_LER)
  async lotes(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return { itens: await this.porta.lotes(s.porta).catch(this.falha) };
  }

  @Get(R.itens)
  @Permissao(PERM_LER)
  async itens(@Param('id') n: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return { itens: await this.porta.itensDoLote(s.porta, idRota(n)).catch(this.falha) };
  }

  @Post(R.processar)
  @HttpCode(200)
  @Permissao(PERM_EDITAR)
  @AuditadoNoHandler(
    'o processamento do lote de exclusão (beneficiários excluídos), com a trilha na mesma transação',
  )
  async processar(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaVersao, b);
    const s = sessaoDe(req);
    return this.porta
      .processarLote(
        s.porta,
        { id: idRota(n), versao: e.versao },
        this.linha(
          s,
          E.operadoraPortalLoteExclusao.codigo,
          'operadora.portal-contratante.lote.processar',
          'movimentacao_lote_contratante',
        ),
      )
      .catch(this.falha);
  }

  @Get(R.canal)
  @Permissao(PERM_LER)
  canal() {
    return CANAL_MENSAGEM_PORTAL;
  }
}
