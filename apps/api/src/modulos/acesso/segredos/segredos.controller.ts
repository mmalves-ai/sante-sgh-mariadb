// Rotas do M59-F3 (ficha do M59, seção 5, regras 1 e 7; cap-08 §8.11): segredos de parceiros e senhas secundárias.
//   GET  /api/administracao/integracao/segredos-legado           situação por tabela e por linha (nunca o valor)
//   POST /api/administracao/integracao/segredos-legado/guardar   a credencial do Sante para o cofre (reautenticação)
//   POST /api/administracao/integracao/segredos-legado/retirar   integracao.cifrarSegredoLegado pelo executor
//   GET  /api/administracao/acesso/senhas-secundarias            quem ainda tem senha secundária (página, busca)
//   POST /api/administracao/acesso/senhas-secundarias/:login/retirar  acesso.retirarSenhaSecundaria pelo executor
// As leituras entram na trilha própria (@Auditar); as gravações, na mesma transação (o registro do cofre pela porta
// SGH_; a retirada pelo executor, com a trilha do legado e a SGH_TRILHA). Toda gravação é crítica: reautenticação
// recente (SBIS-07) e Idempotency-Key na retirada. Nenhuma resposta leva o valor de segredo nenhum.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  esquemaFiltroSenhasSecundarias,
  esquemaGuardarSegredoPedido,
  esquemaLogin,
  esquemaRetirarSegredoPedido,
  esquemaSenhaPedido,
  EVENTOS_AUDITAVEIS,
  PERMISSOES_M59_CODIGOS as P,
  type SegredosLegadoResposta,
  type SenhasSecundariasResposta,
} from '@sgh/contratos';
import type { ContextoOperacao } from '@sgh/legado';
import type { z } from 'zod';
import { Auditar, AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { reautenticar } from '../../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { ServicoSessao } from '../../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso.controller.js';
import type { Cofre } from '../../assinatura/public-api.js';
import { COFRE_SEGREDOS, EXECUTOR_SEGREDOS, PORTA_SEGREDOS, type PortaSegredos } from './porta.js';
import {
  type AtorSegredos,
  type EstadoReceita,
  OPERACAO_SEGREDO,
  OPERACAO_SENHA_SECUNDARIA,
  ServicoSegredos,
} from './servico.js';

export interface ExecutorSegredos {
  receita(nome: string, hospital: string): EstadoReceita;
  executar(nome: string, hospital: string, entrada: unknown, ctx: ContextoOperacao): Promise<void>;
}

/** A situação do hospital (desligamento do M58 e contingência): a mesma do painel de contas do banco. */
export const SITUACAO_HOSPITAL_SEGREDOS = Symbol('SITUACAO_HOSPITAL_SEGREDOS');
export type SituacaoHospitalSegredos = (c: {
  rede: string;
  hospital: string;
}) => Promise<{ desligado: boolean; contingenciaAtiva: boolean }>;

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;
const BASE_SEGREDOS = 'administracao/integracao/segredos-legado';
const BASE_SENHAS = 'administracao/acesso/senhas-secundarias';

@Controller()
export class SegredosController {
  readonly servico: ServicoSegredos;

  constructor(
    @Inject(PORTA_SEGREDOS) porta: PortaSegredos,
    @Inject(COFRE_SEGREDOS) cofre: Cofre,
    @Inject(SITUACAO_HOSPITAL_SEGREDOS) situacao: SituacaoHospitalSegredos,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(EXECUTOR_SEGREDOS) private readonly executor: ExecutorSegredos | null = null,
  ) {
    this.servico = new ServicoSegredos({
      porta,
      cofre,
      situacao,
      receita: (n, h) =>
        this.executor?.receita(n, h) ?? { ligada: false, motivo: 'executor indisponível neste servidor' },
    });
  }

  private ator(req: RequisicaoAutorizada): AtorSegredos {
    const s = req.sgh?.sessao;
    if (!s?.rede || !s.estabelecimentoAtivo || !s.usuario.login)
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return {
      rede: s.rede,
      hospital: s.estabelecimentoAtivo,
      login: s.usuario.login,
      estacao: estacaoDaRequisicao(req).slice(0, 80) || null,
      correlacao: correlacaoDaRequisicao(req, 'segredos'),
    };
  }

  private analisar<T extends z.ZodType>(esquema: T, corpo: unknown): z.infer<T> {
    const r = esquema.safeParse(corpo);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        r.error.issues[0]?.message ?? undefined,
      );
    return r.data;
  }

  private chaveIdempotencia(req: RequisicaoAutorizada): string {
    const bruta = req.headers['idempotency-key'];
    const chave = Array.isArray(bruta) ? bruta[0] : bruta;
    if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'Falta a Idempotency-Key do pedido.',
      );
    return chave;
  }

  private async executar(
    nome: string,
    a: AtorSegredos,
    entrada: unknown,
    chave: string,
    reautenticadoEm: number,
  ) {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    const receita = this.executor.receita(nome, a.hospital);
    if (!receita.ligada)
      throw new ErroProblema('operacao-bloqueada', 409, 'Operação desligada', receita.motivo ?? undefined, {
        codigo: 'operacao-desligada',
      });
    await this.executor.executar(nome, a.hospital, entrada, {
      rede: a.rede,
      hospital: a.hospital,
      traceId: a.correlacao,
      usuarioLegado: a.login,
      idempotencyKey: chave,
      ...(a.estacao ? { estacao: a.estacao } : {}),
      reautenticadoEm,
    });
  }

  // ── segredos de parceiros ───────────────────────────────────────────────────────────────────

  @Get(BASE_SEGREDOS)
  @Permissao(P.segredoLegadoLer)
  @Auditar(EVENTOS_AUDITAVEIS.segredosLegadoConsultados.codigo)
  situacao(@Req() req: RequisicaoAutorizada): Promise<SegredosLegadoResposta> {
    return this.servico.situacaoSegredos(this.ator(req));
  }

  @Post(`${BASE_SEGREDOS}/guardar`)
  @HttpCode(200)
  @Permissao(P.segredoLegadoGerir)
  @AuditadoNoHandler('porta SGH_: SGH_INTG_SEGREDO_LEGADO e SGH_TRILHA na mesma transação (nunca o valor)')
  async guardar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ guardado: true; novo: boolean }> {
    const p = this.analisar(esquemaGuardarSegredoPedido, corpo);
    const a = this.ator(req);
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    return this.servico.guardar(a, p);
  }

  @Post(`${BASE_SEGREDOS}/retirar`)
  @HttpCode(200)
  @Permissao(P.segredoLegadoGerir)
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita integracao.cifrarSegredoLegado')
  async retirar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<{ retirado: true }> {
    const p = this.analisar(esquemaRetirarSegredoPedido, corpo);
    const chave = this.chaveIdempotencia(req);
    const a = this.ator(req);
    // Regras 1 e 7 antes de tudo (o executor confere de novo, na transação).
    await this.servico.conferirRetiradaSegredo(a, p.tabela, p.chave);
    const em = await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    await this.executar(OPERACAO_SEGREDO, a, { tabela: p.tabela, chave: p.chave }, chave, em);
    return { retirado: true };
  }

  // ── senhas secundárias ──────────────────────────────────────────────────────────────────────

  @Get(BASE_SENHAS)
  @Permissao(P.senhaSecundariaLer)
  @Auditar(EVENTOS_AUDITAVEIS.senhasSecundariasConsultadas.codigo)
  senhas(@Query() q: unknown, @Req() req: RequisicaoAutorizada): Promise<SenhasSecundariasResposta> {
    const f = this.analisar(esquemaFiltroSenhasSecundarias, q ?? {});
    const a = this.ator(req);
    return this.servico.senhasSecundarias(
      a,
      { ...(f.busca ? { busca: f.busca } : {}), pagina: f.pagina },
      a.login,
    );
  }

  @Post(`${BASE_SENHAS}/:login/retirar`)
  @HttpCode(200)
  @Permissao(P.senhaSecundariaRetirar)
  @AuditadoNoHandler('executor: TBCABTRILHA como o Delphi e SGH_TRILHA na mesma transação da receita')
  async retirarSenhas(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ retirada: true }> {
    const login = this.analisar(esquemaLogin, bruto);
    const p = this.analisar(esquemaSenhaPedido, corpo);
    const chave = this.chaveIdempotencia(req);
    const a = this.ator(req);
    await this.servico.conferirRetiradaSenhaSecundaria(a, login, a.login);
    const em = await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    await this.executar(OPERACAO_SENHA_SECUNDARIA, a, { login }, chave, em);
    return { retirada: true };
  }
}
