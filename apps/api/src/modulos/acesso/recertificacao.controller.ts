// W1-01 (parte 9c2): API da RECERTIFICAÇÃO DE ACESSOS (gestor de acessos; mesma permissão das telas de acesso).
//   GET  /api/acesso/gestao/recertificacoes                 campanhas (mais nova primeiro) com o relatório de cada uma
//   GET  /api/acesso/gestao/recertificacoes/:id             a campanha com as contas do retrato
//   POST /api/acesso/gestao/recertificacoes                 abrir {escopo, alvo, prazo, motivo, senha}
//   POST /api/acesso/gestao/recertificacoes/:id/decisoes    decidir uma conta {login, decisao, acao, perfil, motivo, senha}
//   POST /api/acesso/gestao/recertificacoes/:id/fechar      encerrar ou cancelar {situacao, motivo, senha}
// A regra é a do domínio (recertificacao.ts); a gravação, a da SGH_ 1206 com a trilha na mesma transação. RETIRAR tem
// efeito na mesma requisição: bloqueio pelo executor (acesso.bloquearUsuario, as sessões do usuário caem) ou revogação
// das concessões vigentes do perfil (revogarPerfil com o motivo, W0-09). Antes de gravar a decisão, tudo o que pode
// recusar o efeito é conferido (receita desligada, último gestor de acessos, perfil já retirado); se o efeito ainda
// falhar, a resposta diz que a decisão ficou registrada e o efeito não (código `efeito-pendente`).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  type CampanhaRecertTela,
  type DecisaoRecertTela,
  EVENTOS_AUDITAVEIS,
  esquemaAbrirRecert,
  esquemaDecidirRecert,
  esquemaFecharRecert,
  type ItemRecertTela,
  PERMISSOES_ACESSO,
  type RecertificacaoGestaoTela,
  type RecertificacoesGestaoTela,
} from '@sgh/contratos';
import {
  itensDaCampanhaRecert,
  PRAZO_RECERT_MAXIMO_DIAS,
  prazoRecertPadrao,
  relatorioRecert,
  validarDecisaoRecert,
  validarNovaCampanhaRecert,
} from '@sgh/dominio-acesso';
import { ErroOperacao } from '@sgh/nucleo';
import type { z } from 'zod';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema, tipoPorStatus } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from './acesso.controller.js';
import { FONTE_GESTAO, type FonteGestao } from './gestao-fonte.js';
import type { CampanhaRecertLida, ItemRecertLido } from './tipos-gestao-acesso.js';
import type { ContextoGestao, DestinoGestao, TrilhaGestao } from './gestao-tipos.js';
import { exigirGestorRestante } from './ultimo-gestor.js';

/**
 * O contrato da tela ainda tipa o destino como 'legado' | 'memoria' (pedido do lote 02-03: 'banco' | 'memoria'); o
 * valor enviado é o da fonte (a tela não decide nada por ele).
 */
const destinoTela = (d: DestinoGestao) => d as unknown as DecisaoRecertTela['destino'];


export const OPERACAO_BLOQUEIO_RECERT = 'acesso.bloquearUsuario';
const FUSO = 'America/Sao_Paulo';
/** Campanhas com o relatório na lista (as mais novas); as demais abrem pelo id. */
export const CAMPANHAS_NA_LISTA = 50;

const iso = (d: Date | null) => d?.toISOString() ?? null;

function campanhaTela(
  c: CampanhaRecertLida,
  itens: readonly ItemRecertLido[],
  hoje: string,
): CampanhaRecertTela {
  return {
    id: c.id,
    escopo: c.escopo,
    alvo: c.alvo,
    prazo: c.prazo,
    motivo: c.motivo,
    situacao: c.situacao,
    criadoPor: c.criadoPor,
    criadoEm: iso(c.criadoEm),
    fechadoPor: c.fechadoPor,
    fechadoEm: iso(c.fechadoEm),
    motivoFechamento: c.motivoFechamento,
    relatorio: { ...relatorioRecert(itens, c.prazo, hoje, c.situacao) },
  };
}

const itemTela = (i: ItemRecertLido): ItemRecertTela => ({
  login: i.login,
  grupo: i.grupo,
  perfis: [...i.perfis],
  decisao: i.decisao,
  acao: i.acao,
  perfil: i.perfil,
  motivo: i.motivo,
  decididoPor: i.decididoPor,
  decididoEm: iso(i.decididoEm),
});

@Controller('acesso/gestao/recertificacoes')
export class RecertificacaoController {
  /** O relógio (os testes simulam o tempo). */
  agora: () => number = () => Date.now();

  constructor(
    @Inject(FONTE_GESTAO) private readonly fonte: FonteGestao,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  private hoje(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(this.agora()));
  }

  private sessao(req: RequisicaoAutorizada): { rede: string; hospital: string; login: string } {
    const s = req.sgh?.sessao;
    if (!s?.rede || !s.estabelecimentoAtivo || !s.usuario.login)
      throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return { rede: s.rede, hospital: s.estabelecimentoAtivo, login: s.usuario.login };
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

  private problema(e: unknown): never {
    if (e instanceof ErroProblema) throw e;
    if (e instanceof ErroOperacao) {
      const p = e.problema;
      const tipo = p.status === 409 ? 'recusa-de-negocio' : tipoPorStatus(p.status);
      throw new ErroProblema(tipo, p.status, p.title, p.detail, p.codigo ? { codigo: p.codigo } : {});
    }
    throw e;
  }

  private recusa(codigo: string, mensagem: string): never {
    throw new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, { codigo });
  }

  private trilha(req: RequisicaoAutorizada, evento: string, operacao: string): TrilhaGestao {
    const { rede, hospital, login } = this.sessao(req);
    return {
      rede,
      hospital,
      usuario: login,
      evento,
      recurso: 'acesso.usuario',
      operacao,
      resultado: 'sucesso',
      estacao: estacaoDaRequisicao(req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(req, 'acesso-recert').slice(0, 64),
    };
  }

  private id(bruto: string): string {
    if (!/^\d{1,18}$/.test(bruto)) throw new ErroProblema('nao-encontrado', 404, 'Campanha não encontrada');
    return bruto;
  }

  private async campanha(
    rede: string,
    hospital: string,
    id: string,
  ): Promise<{ campanha: CampanhaRecertLida; itens: ItemRecertLido[] }> {
    const c = await this.fonte.campanhaRecert(rede, hospital, id).catch((e: unknown) => this.problema(e));
    if (!c) throw new ErroProblema('nao-encontrado', 404, 'Campanha não encontrada');
    return c;
  }

  @Get()
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async listar(@Req() req: RequisicaoAutorizada): Promise<RecertificacoesGestaoTela> {
    const { rede, hospital } = this.sessao(req);
    const hoje = this.hoje();
    const lidas = await this.fonte.campanhasRecert(rede, hospital).catch((e: unknown) => this.problema(e));
    const campanhas = await Promise.all(
      lidas.slice(0, CAMPANHAS_NA_LISTA).map(async (c) => {
        const um = await this.fonte
          .campanhaRecert(rede, hospital, c.id)
          .catch((e: unknown) => this.problema(e));
        return campanhaTela(c, um?.itens ?? [], hoje);
      }),
    );
    const b = this.fonte.receita(OPERACAO_BLOQUEIO_RECERT, hospital);
    return {
      hoje,
      prazoPadrao: prazoRecertPadrao(hoje),
      prazoMaximoDias: PRAZO_RECERT_MAXIMO_DIAS,
      campanhas,
      bloqueio: { ligada: b.ligada, motivo: b.motivo },
    };
  }

  @Get(':id')
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @Auditar(EVENTOS_AUDITAVEIS.grupoConsultado.codigo)
  async ler(@Param('id') bruto: string, @Req() req: RequisicaoAutorizada): Promise<RecertificacaoGestaoTela> {
    const { rede, hospital } = this.sessao(req);
    const hoje = this.hoje();
    const c = await this.campanha(rede, hospital, this.id(bruto));
    return { hoje, campanha: campanhaTela(c.campanha, c.itens, hoje), itens: c.itens.map(itemTela) };
  }

  @Post()
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'SGH_ACESSO_RECERT_CAMPANHA, SGH_ACESSO_RECERT_ITEM e SGH_TRILHA na mesma transação SGH_ (memória: registrador da API)',
  )
  async abrir(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: string; itens: number; destino: FonteGestao['destino'] }> {
    const p = this.analisar(esquemaAbrirRecert, corpo);
    const { rede, hospital, login } = this.sessao(req);
    const hoje = this.hoje();
    const alvo = p.escopo === 'todos' ? null : (p.alvo ?? '').trim() || null;
    const r = validarNovaCampanhaRecert({ escopo: p.escopo, alvo, prazo: p.prazo, motivo: p.motivo }, hoje);
    if (r) this.recusa(r.codigo, r.mensagem);
    const contas = await this.fonte.contasRecert(rede, hospital).catch((e: unknown) => this.problema(e));
    const itens = itensDaCampanhaRecert(contas, p.escopo, alvo);
    if (itens.length === 0)
      this.recusa('escopo-vazio', 'Nenhuma conta ativa neste escopo: não há o que recertificar.');
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    const g = await this.fonte
      .abrirCampanhaRecert(
        rede,
        hospital,
        { hospital, escopo: p.escopo, alvo, prazo: p.prazo, motivo: p.motivo, por: login, hoje, itens },
        this.trilha(req, EVENTOS_AUDITAVEIS.recertificacaoAberta.codigo, 'acesso.abrirRecertificacao'),
      )
      .catch((e: unknown) => this.problema(e));
    return { ...g, destino: this.fonte.destino };
  }

  @Post(':id/decisoes')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'item da recertificação e trilha na mesma transação; retirar: executor acesso.bloquearUsuario ou revogarPerfil, com a trilha',
  )
  async decidir(
    @Param('id') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DecisaoRecertTela> {
    const id = this.id(bruto);
    const p = this.analisar(esquemaDecidirRecert, corpo);
    const { rede, hospital, login: operador } = this.sessao(req);
    const pedido = { decisao: p.decisao, acao: p.acao, perfil: p.perfil, motivo: p.motivo };
    // A regra responde antes da senha e antes de gravar: nada fica decidido sem o efeito poder correr.
    const c = await this.campanha(rede, hospital, id);
    const item = c.itens.find((i) => i.login === p.login);
    if (!item) this.recusa('item-inexistente', 'Esta conta não faz parte da campanha.');
    const r = validarDecisaoRecert(c.campanha.situacao, item, pedido, operador);
    if (r) this.recusa(r.codigo, r.mensagem);
    let concessoes: string[] = [];
    if (p.decisao === 'retirar' && p.acao === 'bloqueio') {
      const b = this.fonte.receita(OPERACAO_BLOQUEIO_RECERT, hospital);
      if (!b.ligada)
        throw new ErroProblema('operacao-bloqueada', 409, 'Operação desligada', b.motivo ?? undefined, {
          codigo: 'operacao-desligada',
        });
      await exigirGestorRestante(this.fonte, rede, hospital, { tipo: 'bloquear', login: p.login });
    } else if (p.decisao === 'retirar' && p.acao === 'revogacao') {
      const agora = this.agora();
      const hist = await this.fonte
        .historicoPerfis(rede, hospital, p.login)
        .catch((e: unknown) => this.problema(e));
      concessoes = hist
        .filter(
          (x) =>
            x.perfil === p.perfil &&
            !x.revogadoEm &&
            x.inicio.getTime() <= agora &&
            (!x.fim || x.fim.getTime() > agora),
        )
        .map((x) => x.id);
      if (concessoes.length === 0)
        this.recusa(
          'perfil-ja-retirado',
          'A conta já não tem este perfil vigente: decida manter ou bloquear a conta.',
        );
      for (const concessao of concessoes)
        await exigirGestorRestante(this.fonte, rede, hospital, { tipo: 'retirar-perfil', concessao });
    }
    const reautenticadoEm = await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    await this.fonte
      .decidirRecert(
        rede,
        hospital,
        { hospital, campanha: id, login: p.login, ...pedido, por: operador },
        this.trilha(req, EVENTOS_AUDITAVEIS.recertificacaoDecidida.codigo, 'acesso.decidirRecertificacao'),
        (situacao, lido) => validarDecisaoRecert(situacao, lido, pedido, operador),
      )
      .catch((e: unknown) => this.problema(e));
    try {
      if (p.decisao === 'retirar' && p.acao === 'bloqueio') {
        const ctx: ContextoGestao = {
          rede,
          hospital,
          correlacao: correlacaoDaRequisicao(req, 'acesso-recert'),
          usuario: operador,
          chaveIdempotencia: `recert-${id}-${p.login}`,
          estacao: estacaoDaRequisicao(req).slice(0, 80),
          reautenticadoEm,
        };
        await this.fonte.executar(OPERACAO_BLOQUEIO_RECERT, hospital, { login: p.login }, ctx);
        await this.sessoes?.revogarSessoesDoUsuario(rede, hospital, p.login);
      } else if (p.decisao === 'retirar' && p.acao === 'revogacao') {
        for (const concessao of concessoes)
          await this.fonte.revogarPerfil(
            rede,
            hospital,
            concessao,
            operador,
            this.trilha(req, EVENTOS_AUDITAVEIS.perfilRevogado.codigo, 'acesso.revogarPerfil'),
            `Recertificação ${id}: ${p.motivo.trim()}`.slice(0, 200),
          );
      }
    } catch (e) {
      const detalhe =
        e instanceof ErroOperacao
          ? e.problema.detail
          : e instanceof ErroProblema
            ? e.message
            : 'falha interna';
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Efeito não aplicado',
        `A decisão ficou registrada, mas ${p.acao === 'bloqueio' ? 'o bloqueio' : 'a revogação do perfil'} não foi aplicado(a): ${detalhe ?? ''} Aplique pela ficha do usuário.`,
        { codigo: 'efeito-pendente' },
      );
    }
    if (p.decisao === 'retirar')
      await this.sessoes?.servicoAutorizacao?.invalidar(rede, hospital, p.login).catch(() => undefined);
    return {
      login: p.login,
      decisao: p.decisao,
      acao: p.acao,
      perfil: p.perfil,
      destino: destinoTela(this.fonte.destino),
    };
  }

  @Post(':id/fechar')
  @HttpCode(200)
  @Permissao(PERMISSOES_ACESSO.perfilGerir)
  @AuditadoNoHandler(
    'SGH_ACESSO_RECERT_CAMPANHA e SGH_TRILHA na mesma transação SGH_ (memória: registrador da API)',
  )
  async fechar(
    @Param('id') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    id: string;
    situacao: 'encerrada' | 'cancelada';
    pendentes: number;
    destino: FonteGestao['destino'];
  }> {
    const id = this.id(bruto);
    const p = this.analisar(esquemaFecharRecert, corpo);
    const { rede, hospital, login } = this.sessao(req);
    const c = await this.campanha(rede, hospital, id);
    if (c.campanha.situacao !== 'aberta')
      this.recusa('campanha-fechada', 'Esta campanha já foi encerrada ou cancelada.');
    await reautenticar(this.sessoes, this.resolvedor, req, p.senha);
    const r = await this.fonte
      .fecharCampanhaRecert(
        rede,
        hospital,
        { hospital, campanha: id, situacao: p.situacao, motivo: p.motivo, por: login },
        this.trilha(req, EVENTOS_AUDITAVEIS.recertificacaoFechada.codigo, 'acesso.fecharRecertificacao'),
      )
      .catch((e: unknown) => this.problema(e));
    return { ...r, destino: this.fonte.destino };
  }
}
