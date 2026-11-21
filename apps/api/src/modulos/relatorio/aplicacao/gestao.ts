// Triagem dos relatórios de SQL livre, pedidos de relatório novo e envio agendado (M34; ficha, seção 7, regras 2 e 5):
//   - triagem: a página com o resumo (o critério de aceite: total, sem destino, sem dono) e a decisão da área (destino,
//     marco, artefato, papel dono, onda e o motivo), auditada;
//   - pedidos: quem tem `relatorio.pedido.criar` pede e acompanha os seus; o curador (`relatorio.pedido.publicar`) vê
//     todos e responde (em análise, publicado com o relatório do catálogo, recusado);
//   - envio agendado: o relatório, os parâmetros (fixos ou relativos ao dia do envio), os destinatários (grupos e
//     endereços), a periodicidade e a hora; o e-mail leva só o link autenticado; "enviar agora" põe na fila do worker;
//     a falha conta as seguidas e alerta o dono (o worker); a chave `relatorio.envioAgendado` liga o envio.
import {
  type AgendamentoLido,
  esquemaAlteracaoPedido,
  esquemaMotivoGestaoRelatorio,
  esquemaMotivoRelatorio,
  type EventoGestaoRelatorio,
  mascararEnderecoEmail,
  EVENTOS_AUDITAVEIS,
  esquemaDecisaoTriagem,
  esquemaNovoAgendamento,
  esquemaNovoPedido,
  esquemaRespostaPedido,
  type HistoricoEnvioOrigem,
  type JobEnvioRelatorio,
  type PaginaTriagem,
  type PedidoLido,
  permissaoExecutarRelatorio,
  PERMISSOES_M34_CODIGOS as P,
  relatorioDoCatalogo,
  SITUACOES_ENVIO_ORIGEM,
  type TriagemLida,
  DESTINOS_TRIAGEM,
  SITUACOES_TRIAGEM,
} from '@sgh/contratos';
import { linkDoRelatorio, proximoEnvio } from '@sgh/dominio-relatorio';
import type { AgendamentoRelatorio, EventoRelatorio, PedidoRelatorio, ItemTriagem } from '../tipos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { exigir, linhaTrilha, type SessaoCadastro } from '../../cadastro/comum.js';
import type { PortaRelatorio } from '../porta.js';
import type { ConfiguracaoM34 } from './configuracao.js';
import { relatorioOu404, type ServicoExecucao } from './executar.js';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 19) : null);
const segura = (n: number): number | string => (n > 0 && n < 5 ? '<5' : n);

function invalido(issues: readonly { message: string; path: readonly PropertyKey[] }[]): ErroProblema {
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    issues.map((i) => i.message).join(' '),
    { campos: issues.map((i) => String(i.path[0] ?? '')) },
  );
}

export interface FilaEnvioRelatorio {
  enfileirar(job: JobEnvioRelatorio): Promise<'enfileirado' | 'sem-fila'>;
  encerrar?(): Promise<void>;
}

const triagemLida = (t: ItemTriagem): TriagemLida => ({
  id: t.id,
  nome: t.nome,
  area: t.artefato,
  destino: t.destino as TriagemLida['destino'],
  marco: t.marco,
  artefato: t.artefato,
  papelDono: t.papelDono,
  onda: t.onda,
  situacao: t.situacao as TriagemLida['situacao'],
  regra: t.regra,
  motivo: t.motivo,
  // A tela mostra quem confirmou por último: o aceite da área, ou a decisão quando ainda é só proposta (o contrato
  // ainda não separa os dois; pedido do lote 04-04).
  decididoPor: t.aceitoPor ?? t.decididoPor,
  decididoEm: t.aceitoEm ?? t.decididoEm,
  parametros: t.parametros,
  acessoRestrito: t.acessoRestrito,
});

/**
 * A versão que a tela leu, para a trava otimista (conflito-versao quando outra pessoa gravou antes). Opcional enquanto
 * o contrato da tela não a leva em todo corpo (pedido do lote 04-04); sem ela, vale a lida na transação.
 */
export function versaoDaTela(corpo: unknown): number | undefined {
  const v = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>)['versao'] : undefined;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;
}

/** O corpo sem a versão (os esquemas do contrato validam só os campos de negócio). */
function semVersao(corpo: unknown): unknown {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return corpo;
  const r = { ...(corpo as Record<string, unknown>) };
  delete r['versao'];
  return r;
}

function agendamentoLido(a: AgendamentoRelatorio): AgendamentoLido & { readonly versao?: number } {
  return {
    ...(a.versao !== undefined ? { versao: a.versao } : {}),
    id: a.id,
    relatorio: a.relatorio,
    titulo: a.titulo,
    parametros: { ...a.parametros },
    grupos: [...a.grupos],
    enderecos: a.enderecos.length,
    enderecosMascarados: a.enderecos.map(mascararEnderecoEmail),
    periodicidade: a.periodicidade as AgendamentoLido['periodicidade'],
    hora: a.hora,
    diaSemana: a.diaSemana,
    diaMes: a.diaMes,
    ativo: a.ativo,
    dono: a.dono,
    proximoEnvio: iso(a.proximoEnvio),
    ultimoEnvio: iso(a.ultimoEnvio),
    ultimaSituacao: a.ultimaSituacao,
    ultimaFalha: a.ultimaFalha,
    falhasSeguidas: a.falhasSeguidas,
  };
}

/** O valor anterior do pedido (a linha inteira; vai ao trilha de auditoria, nunca à trilha). */
const retratoPedido = (p: PedidoRelatorio) => ({
  titulo: p.titulo,
  descricao: p.descricao,
  finalidade: p.finalidade,
  area: p.area,
  prazo: p.prazo,
  solicitante: p.solicitante,
  situacao: p.situacao,
  criadoEm: iso(p.criadoEm),
});

/** O valor anterior do envio (a linha inteira, os endereços inclusive: trilha de auditoria tem a mesma guarda da tabela). */
const retratoAgendamento = (a: AgendamentoRelatorio) => ({
  relatorio: a.relatorio,
  titulo: a.titulo,
  parametros: a.parametros,
  grupos: a.grupos,
  enderecos: a.enderecos,
  periodicidade: a.periodicidade,
  hora: a.hora,
  diaSemana: a.diaSemana,
  diaMes: a.diaMes,
  ativo: a.ativo,
  dono: a.dono,
  ultimoEnvio: iso(a.ultimoEnvio),
});

const eventoLido = (e: {
  evento: EventoRelatorio;
  motivo: string;
  por: string;
  em: Date;
}): EventoGestaoRelatorio => ({
  evento: e.evento,
  motivo: e.motivo,
  por: e.por,
  em: iso(e.em) ?? '',
});

/** Exclusão recusada (regra 4): quantos e quais (rótulo de produto) e a oferta de cancelar ou desativar. */
function recusaExclusao(
  codigo: string,
  titulo: string,
  detalhe: string,
  v: readonly { grupo: string; quantidade: number; origem: 'fk' | 'logica' }[],
  podeInativar: boolean,
): ErroProblema {
  return new ErroProblema('recusa-de-negocio', 409, titulo, detalhe, {
    codigo,
    dependentes: v.map((x) => ({ rotulo: x.grupo, quantidade: x.quantidade, amostra: [], origem: x.origem })),
    total: v.reduce((a, x) => a + x.quantidade, 0),
    podeInativar,
  });
}

export class ServicoGestaoRelatorios {
  constructor(
    private readonly porta: PortaRelatorio,
    private readonly trilha: RegistradorTrilha,
    private readonly config: ConfiguracaoM34,
    private readonly execucao: ServicoExecucao,
    private readonly fila: FilaEnvioRelatorio | null,
  ) {}

  // ── Triagem (regra 2) ───────────────────────────────────────────────────────────────────────────────

  async triagem(s: SessaoCadastro, q: Record<string, string | undefined>): Promise<PaginaTriagem> {
    const destino =
      q['destino'] && (DESTINOS_TRIAGEM as readonly string[]).includes(q['destino'])
        ? q['destino']
        : undefined;
    const situacao =
      q['situacao'] && (SITUACOES_TRIAGEM as readonly string[]).includes(q['situacao'])
        ? q['situacao']
        : undefined;
    const marco = q['marco'] && /^M\d{2}$/.test(q['marco']) ? q['marco'] : undefined;
    const termo = q['termo']?.trim().slice(0, 60) || undefined;
    const pagina = Math.max(0, Math.min(1000, Number(q['pagina'] ?? 0) || 0));
    const tamanho = Math.max(1, Math.min(100, Number(q['tamanho'] ?? 50) || 50));
    const [p, r] = await Promise.all([
      this.porta.triagem(s.porta, {
        ...(destino ? { destino } : {}),
        ...(situacao ? { situacao } : {}),
        ...(marco ? { marco } : {}),
        ...(termo ? { termo } : {}),
        pagina,
        tamanho,
      }),
      this.porta.resumoTriagem(s.porta),
    ]);
    return { itens: p.itens.map(triagemLida), total: p.total, resumo: r };
  }

  async decidir(s: SessaoCadastro, id: number, corpo: unknown): Promise<TriagemLida> {
    const d = esquemaDecisaoTriagem.safeParse(corpo);
    if (!d.success) throw invalido(d.error.issues);
    if (!(await this.porta.umaTriagem(s.porta, id)))
      throw new ErroProblema('nao-encontrado', 404, 'Relatório não encontrado na triagem');
    if (d.data.destino === 'catalogo' && !relatorioDoCatalogo(d.data.artefato))
      throw invalido([
        {
          message: 'Destino "catálogo" exige o código de um relatório do catálogo no artefato.',
          path: ['artefato'],
        },
      ]);
    const n = await this.porta.gravarSgh(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.relatorioTriagemDecidida.codigo,
        'relatorio.triagem',
        `decidir:${d.data.destino}`,
        { tabela: 'triagem_relatorio_legado', id: String(id), chave: d.data.marco ?? 'descartado' },
      ),
      (g) => g.decidirTriagem(id, d.data, s.login),
    );
    if (n !== 1)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'A triagem não foi gravada',
        'Atualize a lista e tente de novo.',
      );
    return triagemLida((await this.porta.umaTriagem(s.porta, id))!);
  }

  // ── Pedidos de relatório novo ───────────────────────────────────────────────────────────────────────

  async pedidos(s: SessaoCadastro): Promise<PedidoLido[]> {
    const curador = s.pode(P.pedidoPublicar);
    const { hoje } = await this.porta.relogio(s.porta);
    const l = await this.porta.pedidos(s.porta, curador ? {} : { solicitante: s.login });
    return l.map((p) => this.pedidoLido(s, p, hoje));
  }

  private pedidoLido(
    s: SessaoCadastro,
    p: PedidoRelatorio,
    hoje: string,
  ): PedidoLido & { readonly versao?: number } {
    const cancelado = p.canceladoEm !== null;
    const meu = p.solicitante === s.login || s.pode(P.pedidoPublicar);
    const aberto = !cancelado && p.situacao === 'aberto' && p.respondidoEm === null;
    return {
      ...(p.versao !== undefined ? { versao: p.versao } : {}),
      id: p.id,
      titulo: p.titulo,
      descricao: p.descricao,
      finalidade: p.finalidade,
      area: p.area,
      solicitante: p.solicitante,
      prazo: p.prazo,
      situacao: (cancelado ? 'cancelado' : p.situacao) as PedidoLido['situacao'],
      relatorio: p.relatorio,
      resposta: p.resposta,
      respondidoPor: p.respondidoPor,
      respondidoEm: iso(p.respondidoEm),
      criadoEm: iso(p.criadoEm) ?? '',
      atrasado: !cancelado && ['aberto', 'em-analise'].includes(p.situacao) && p.prazo < hoje,
      canceladoEm: iso(p.canceladoEm),
      canceladoPor: p.canceladoPor,
      motivoCancelamento: p.motivoCancelamento,
      editavel: meu && aberto,
      cancelavel: meu && !cancelado && ['aberto', 'em-analise'].includes(p.situacao),
      excluivel: meu && aberto,
    };
  }

  // ── W0-09: ciclo do pedido (editar enquanto aberto, cancelar com motivo, excluir só o nunca atendido) ──────

  /** O pedido do estabelecimento que a sessão pode mexer: o solicitante ou o curador. */
  private async pedidoMeu(s: SessaoCadastro, id: string): Promise<PedidoRelatorio> {
    const p = /^\d{1,20}$/.test(id) ? await this.porta.pedido(s.porta, id) : null;
    if (!p || (p.solicitante !== s.login && !s.pode(P.pedidoPublicar)))
      throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado');
    return p;
  }

  private trilhaPedido(s: SessaoCadastro, operacao: string, id: string) {
    return linhaTrilha(s, EVENTOS_AUDITAVEIS.relatorioPedidoRegistrado.codigo, 'relatorio.pedido', operacao, {
      tabela: 'pedido_relatorio',
      id,
    });
  }

  async alterarPedido(s: SessaoCadastro, id: string, corpo: unknown): Promise<{ ok: true }> {
    const atual = await this.pedidoMeu(s, id);
    const versao = versaoDaTela(corpo);
    const p = esquemaAlteracaoPedido.safeParse(semVersao(corpo));
    if (!p.success) throw invalido(p.error.issues);
    const { hoje } = await this.porta.relogio(s.porta);
    if (p.data.prazo < hoje)
      throw invalido([{ message: 'O prazo não pode estar no passado.', path: ['prazo'] }]);
    const { motivo, ...novo } = p.data;
    const n = await this.porta.gravarSgh(s.porta, this.trilhaPedido(s, 'alterar', id), async (g) => {
      const antes = (await g.lerPedidoTravado(id)) ?? atual;
      const k = await g.alterarPedido(id, novo, s.login, versao);
      if (k === 1)
        await g.registrarEvento(
          { alvo: 'pedido', id, evento: 'alteracao', antes: retratoPedido(antes), motivo },
          s.login,
        );
      return k;
    });
    if (n !== 1)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'O pedido não está mais aberto',
        'O curador já respondeu ou o pedido foi cancelado: só o pedido aberto se corrige. Cancele e faça outro.',
        { codigo: 'pedido-nao-aberto' },
      );
    return { ok: true };
  }

  async cancelarPedido(s: SessaoCadastro, id: string, corpo: unknown): Promise<{ ok: true }> {
    const atual = await this.pedidoMeu(s, id);
    const versao = versaoDaTela(corpo);
    const m = esquemaMotivoGestaoRelatorio.safeParse(semVersao(corpo));
    if (!m.success) throw invalido(m.error.issues);
    const n = await this.porta.gravarSgh(s.porta, this.trilhaPedido(s, 'cancelar', id), async (g) => {
      const antes = (await g.lerPedidoTravado(id)) ?? atual;
      const k = await g.cancelarPedido(id, m.data.motivo, s.login, versao);
      if (k === 1)
        await g.registrarEvento(
          { alvo: 'pedido', id, evento: 'cancelamento', antes: retratoPedido(antes), motivo: m.data.motivo },
          s.login,
        );
      return k;
    });
    if (n !== 1)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'O pedido não pode ser cancelado',
        'Só o pedido aberto ou em análise se cancela; o publicado ou recusado já foi respondido.',
        { codigo: 'pedido-nao-cancelavel' },
      );
    return { ok: true };
  }

  /**
   * Exclusão física só do pedido nunca atendido (matriz: pedido sem desdobramento), com log (o evento leva a linha
   * inteira). Atendido (resposta do curador) ou cancelado: 409 com os vínculos e a oferta do cancelamento.
   */
  async excluirPedido(s: SessaoCadastro, id: string, corpo: unknown): Promise<{ ok: true }> {
    const atual = await this.pedidoMeu(s, id);
    const m = esquemaMotivoGestaoRelatorio.safeParse(corpo);
    if (!m.success) throw invalido(m.error.issues);
    const v = await this.porta.dependencias(s.porta, 'pedido', id);
    const recusa = () =>
      recusaExclusao(
        'pedido-ja-executado',
        'O pedido já foi atendido e não se exclui',
        atual.canceladoEm
          ? 'O pedido já está cancelado e fica no histórico.'
          : 'O pedido já tem resposta do curador: cancele-o com o motivo (ele fica no histórico).',
        v,
        atual.canceladoEm === null && ['aberto', 'em-analise'].includes(atual.situacao),
      );
    if (v.length) throw recusa();
    await this.porta.gravarSgh(s.porta, this.trilhaPedido(s, 'excluir', id), async (g) => {
      await g.registrarEvento(
        { alvo: 'pedido', id, evento: 'exclusao', antes: retratoPedido(atual), motivo: m.data.motivo },
        s.login,
      );
      // Mudou entre a conferência e a exclusão: desfaz o evento junto (a transação é desfeita pelo erro).
      if ((await g.excluirPedido(id)) !== 1) throw recusa();
    });
    return { ok: true };
  }

  async historicoPedido(s: SessaoCadastro, id: string): Promise<EventoGestaoRelatorio[]> {
    await this.pedidoMeu(s, id);
    return (await this.porta.eventos(s.porta, 'pedido', id)).map(eventoLido);
  }

  async criarPedido(s: SessaoCadastro, corpo: unknown): Promise<{ id: string }> {
    const p = esquemaNovoPedido.safeParse(corpo);
    if (!p.success) throw invalido(p.error.issues);
    const { hoje } = await this.porta.relogio(s.porta);
    if (p.data.prazo < hoje)
      throw invalido([{ message: 'O prazo não pode estar no passado.', path: ['prazo'] }]);
    const id = await this.porta.gravarSgh(
      s.porta,
      (x: string) =>
        linhaTrilha(s, EVENTOS_AUDITAVEIS.relatorioPedidoRegistrado.codigo, 'relatorio.pedido', 'criar', {
          tabela: 'pedido_relatorio',
          id: x,
        }),
      (g) => g.criarPedido(p.data, s.login),
    );
    return { id };
  }

  async responderPedido(s: SessaoCadastro, id: string, corpo: unknown): Promise<{ ok: true }> {
    if (!/^\d{1,20}$/.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado');
    const versao = versaoDaTela(corpo);
    const r = esquemaRespostaPedido.safeParse(semVersao(corpo));
    if (!r.success) throw invalido(r.error.issues);
    if (r.data.situacao === 'publicado' && !relatorioDoCatalogo(r.data.relatorio ?? ''))
      throw invalido([{ message: 'O relatório publicado precisa estar no catálogo.', path: ['relatorio'] }]);
    const n = await this.porta.gravarSgh(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.relatorioPedidoRegistrado.codigo,
        'relatorio.pedido',
        `responder:${r.data.situacao}`,
        { tabela: 'pedido_relatorio', id },
      ),
      (g) => g.responderPedido(id, r.data, s.login, versao),
    );
    if (n !== 1)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'O pedido não está aberto',
        'Só o pedido aberto ou em análise pode ser respondido.',
      );
    return { ok: true };
  }

  // ── Envio agendado (regra 5) ────────────────────────────────────────────────────────────────────────

  async agendamentos(s: SessaoCadastro): Promise<{
    agendamentos: AgendamentoLido[];
    origem: HistoricoEnvioOrigem;
    envioLigado: boolean;
    motivo: string | null;
  }> {
    const [l, h, e] = await Promise.all([
      this.porta.agendamentos(s.porta),
      this.porta.historicoOrigem(s.porta),
      this.config.estado(
        { rede: s.rede, hospital: s.hospital, login: s.login, setor: s.req.sgh?.sessao.unidadeAtiva ?? null },
        'relatorio.envioAgendado',
      ),
    ]);
    const naoEnviados = h.porAno.filter((x) => x.situacao !== 1).reduce((a, x) => a + x.quantidade, 0);
    return {
      agendamentos: l.map(agendamentoLido),
      origem: {
        agendamentos: h.agendamentos,
        porAno: h.porAno.map((x) => ({
          ano: x.ano,
          situacao: SITUACOES_ENVIO_ORIGEM[x.situacao] ?? `Situação ${x.situacao}`,
          quantidade: segura(x.quantidade),
        })),
        ultimoEnviado: h.ultimoEnviado ? h.ultimoEnviado.toISOString().slice(0, 10) : null,
        naoEnviados: segura(naoEnviados),
      },
      envioLigado: e.ligado,
      motivo: e.motivo,
    };
  }

  /** Os parâmetros do envio: fixos validados pelo Zod do relatório; os relativos resolvidos no dia do envio. */
  private async validarAgendamento(s: SessaoCadastro, corpo: unknown) {
    const a = esquemaNovoAgendamento.safeParse(corpo);
    if (!a.success) throw invalido(a.error.issues);
    const r = relatorioOu404(a.data.relatorio);
    // Quem agenda precisa poder emitir o relatório (o link só abre para quem tem a permissão).
    await exigir(s, permissaoExecutarRelatorio(r.codigo), this.trilha);
    await this.execucao.valores(s, r, a.data.parametros);
    return { a: a.data, r };
  }

  async criarAgendamento(s: SessaoCadastro, corpo: unknown): Promise<{ id: string; proximoEnvio: string }> {
    const { a } = await this.validarAgendamento(s, corpo);
    const { agora } = await this.porta.relogio(s.porta);
    const proximo = proximoEnvio(a, agora);
    const id = await this.porta.gravarSgh(
      s.porta,
      (x: string) =>
        linhaTrilha(
          s,
          EVENTOS_AUDITAVEIS.relatorioAgendamentoAlterado.codigo,
          'relatorio.agendamento',
          'criar',
          {
            tabela: 'agendamento_relatorio',
            id: x,
            chave: a.relatorio,
          },
        ),
      (g) => g.criarAgendamento(a, s.login, proximo),
    );
    return { id, proximoEnvio: iso(proximo)! };
  }

  async alterarAgendamento(s: SessaoCadastro, id: string, corpo: unknown): Promise<{ ok: true }> {
    const atual = await this.agendamentoOu404(s, id);
    const c = (corpo ?? {}) as Record<string, unknown>;
    const resto = { ...c };
    delete resto['ativo'];
    delete resto['motivo'];
    delete resto['manterEnderecos'];
    delete resto['versao'];
    const versao = versaoDaTela(c);
    // W0-09: os endereços gravados não voltam à tela (só mascarados): "manter" os reaproveita sem redigitar.
    if (c['manterEnderecos'] === true) resto['enderecos'] = [...atual.enderecos];
    const motivo = esquemaMotivoRelatorio.safeParse(c['motivo']);
    if (!motivo.success) throw invalido(motivo.error.issues.map((x) => ({ ...x, path: ['motivo'] })));
    const { a } = await this.validarAgendamento(s, resto);
    const { agora } = await this.porta.relogio(s.porta);
    const ativo = c['ativo'];
    const ligado = typeof ativo === 'boolean' ? ativo : atual.ativo;
    const evento: EventoRelatorio =
      ligado === atual.ativo ? 'alteracao' : ligado ? 'ativacao' : 'desativacao';
    const n = await this.porta.gravarSgh(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.relatorioAgendamentoAlterado.codigo,
        'relatorio.agendamento',
        ligado ? 'alterar' : 'desativar',
        { tabela: 'agendamento_relatorio', id, chave: a.relatorio },
      ),
      async (g) => {
        const antes = await g.lerAgendamentoTravado(id);
        if (!antes) return 0;
        const k = await g.alterarAgendamento(
          id,
          { ...a, ativo: ligado },
          s.login,
          ligado ? proximoEnvio(a, agora) : null,
          versao,
        );
        if (k === 1)
          await g.registrarEvento(
            { alvo: 'agendamento', id, evento, antes: retratoAgendamento(antes), motivo: motivo.data },
            s.login,
          );
        return k;
      },
    );
    if (n !== 1) throw new ErroProblema('nao-encontrado', 404, 'Envio agendado não encontrado');
    return { ok: true };
  }

  /**
   * Ativar ou desativar sem mexer no resto (os endereços gravados não voltam à tela). As duas exigem o motivo (W0-09
   * revisão: reativar volta a disparar o e-mail na próxima janela; o histórico guarda o motivo de quem reativou).
   */
  async ativarAgendamento(s: SessaoCadastro, id: string, corpo: unknown): Promise<{ ok: true }> {
    const c = (corpo ?? {}) as Record<string, unknown>;
    const ativo = c['ativo'];
    if (typeof ativo !== 'boolean')
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Diga se o envio fica ativo.', {
        campos: ['ativo'],
      });
    const motivo = esquemaMotivoRelatorio.safeParse(c['motivo'] ?? '');
    if (!motivo.success) throw invalido(motivo.error.issues.map((x) => ({ ...x, path: ['motivo'] })));
    const lido = await this.agendamentoOu404(s, id);
    const { agora } = await this.porta.relogio(s.porta);
    const n = await this.porta.gravarSgh(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.relatorioAgendamentoAlterado.codigo,
        'relatorio.agendamento',
        ativo ? 'ativar' : 'desativar',
        { tabela: 'agendamento_relatorio', id, chave: lido.relatorio },
      ),
      async (g) => {
        // W0-09 revisão: o envio relido na transação, com trava: o resto da linha e o "antes" são os vigentes.
        const a = await g.lerAgendamentoTravado(id);
        if (!a) return 0;
        const agenda = {
          periodicidade: a.periodicidade as 'diaria' | 'semanal' | 'mensal',
          hora: a.hora,
          diaSemana: a.diaSemana,
          diaMes: a.diaMes,
        };
        const k = await g.alterarAgendamento(
          id,
          {
            relatorio: a.relatorio,
            titulo: a.titulo,
            parametros: a.parametros,
            grupos: a.grupos,
            enderecos: a.enderecos,
            ...agenda,
            ativo,
          },
          s.login,
          ativo ? proximoEnvio(agenda, agora) : null,
          versaoDaTela(c),
        );
        if (k === 1)
          await g.registrarEvento(
            {
              alvo: 'agendamento',
              id,
              evento: ativo ? 'ativacao' : 'desativacao',
              antes: retratoAgendamento(a),
              motivo: motivo.data,
            },
            s.login,
          );
        return k;
      },
    );
    if (n !== 1) throw new ErroProblema('nao-encontrado', 404, 'Envio agendado não encontrado');
    return { ok: true };
  }

  /**
   * W0-09: exclusão física só do envio que nunca rodou (nenhuma execução, nunca enviado), com log. O que já rodou:
   * 409 com quantos envios e execuções o mantêm e a oferta de desativar.
   */
  async excluirAgendamento(s: SessaoCadastro, id: string, corpo: unknown): Promise<{ ok: true }> {
    const a = await this.agendamentoOu404(s, id);
    const m = esquemaMotivoGestaoRelatorio.safeParse(corpo);
    if (!m.success) throw invalido(m.error.issues);
    const v = await this.porta.dependencias(s.porta, 'agendamento', id);
    const recusa = () =>
      recusaExclusao(
        'agendamento-ja-executado',
        'O envio já rodou e não se exclui',
        a.ativo
          ? 'O envio já tem execuções registradas: desative-o com o motivo (ele fica no histórico).'
          : 'O envio já tem execuções registradas e já está desativado: ele fica no histórico.',
        v,
        // W0-09 revisão: a oferta de desativar só para o envio ativo (o desativado não tem o que oferecer).
        a.ativo,
      );
    if (v.length) throw recusa();
    await this.porta.gravarSgh(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.relatorioAgendamentoAlterado.codigo,
        'relatorio.agendamento',
        'excluir',
        { tabela: 'agendamento_relatorio', id, chave: a.relatorio },
      ),
      async (g) => {
        await g.registrarEvento(
          {
            alvo: 'agendamento',
            id,
            evento: 'exclusao',
            antes: retratoAgendamento(a),
            motivo: m.data.motivo,
          },
          s.login,
        );
        if ((await g.excluirAgendamento(id)) !== 1) throw recusa();
      },
    );
    return { ok: true };
  }

  async historicoAgendamento(s: SessaoCadastro, id: string): Promise<EventoGestaoRelatorio[]> {
    if (!/^\d{1,20}$/.test(id))
      throw new ErroProblema('nao-encontrado', 404, 'Envio agendado não encontrado');
    return (await this.porta.eventos(s.porta, 'agendamento', id)).map(eventoLido);
  }

  private async agendamentoOu404(s: SessaoCadastro, id: string): Promise<AgendamentoRelatorio> {
    const a = /^\d{1,20}$/.test(id) ? await this.porta.agendamento(s.porta, id) : null;
    if (!a) throw new ErroProblema('nao-encontrado', 404, 'Envio agendado não encontrado');
    return a;
  }

  /** "Enviar agora": o job na fila do worker (só o link; o e-mail fora de produção vai ao coletor local). */
  async enviarAgora(
    s: SessaoCadastro,
    id: string,
    baseWeb: string,
  ): Promise<{ situacao: 'enfileirado' | 'sem-fila'; link: string }> {
    await this.config.exigir(
      { rede: s.rede, hospital: s.hospital, login: s.login, setor: s.req.sgh?.sessao.unidadeAtiva ?? null },
      'relatorio.envioAgendado',
    );
    const a = await this.agendamentoOu404(s, id);
    const r = relatorioOu404(a.relatorio);
    const link = linkDoRelatorio(baseWeb, r.codigo, a.parametros);
    const situacao = this.fila
      ? await this.fila.enfileirar({
          rede: s.rede,
          hospital: s.hospital,
          agendamento: id,
          titulo: a.titulo.slice(0, 120),
          relatorio: r.titulo,
          link,
          enderecos: [...a.enderecos],
          grupos: [...a.grupos],
          dono: a.dono.slice(0, 31),
          registrar: this.porta.destino === 'banco',
        })
      : 'sem-fila';
    await this.porta.gravarSgh(
      s.porta,
      linhaTrilha(
        s,
        EVENTOS_AUDITAVEIS.relatorioAgendamentoAlterado.codigo,
        'relatorio.agendamento',
        `enviar:${situacao}`,
        {
          tabela: 'agendamento_relatorio',
          id,
          chave: a.relatorio,
        },
      ),
      (g) =>
        g.registrarExecucao({
          relatorio: r.codigo,
          tipo: 'envio',
          formato: 'link',
          usuario: s.login,
          parametros: JSON.stringify(a.parametros),
          linhas: 0,
          duracaoMs: 0,
          dadoPessoal: false,
          mascarado: true,
          justificativa: null,
          situacao: situacao === 'enfileirado' ? 'ok' : 'falhou',
          agendamento: id,
        }),
    );
    return { situacao, link };
  }
}
