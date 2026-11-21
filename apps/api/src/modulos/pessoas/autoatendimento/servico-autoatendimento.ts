// Solicitações do autoatendimento do colaborador e a fila do gestor (W0-06, parte 6b-2; M3 de mercado; matriz, linhas
// "Ponto e escala", "Profissional / usuário" e o atestado pela LGPD):
//   - pedir e desistir é do próprio vínculo (o vínculo sai do login; nunca o de outra pessoa); a desistência só da
//     pendente e só por quem pediu (o banco confere de novo, CHECK da solicitação);
//   - decidir é de outra pessoa (nunca o próprio solicitante nem o próprio vínculo) e só da pendente;
//   - a aprovação grava o efeito NA MESMA transação da decisão (D-W006-SOLIC-EFEITO): férias viram a programação em
//     ferias_colaborador conferida como a tela da folha (`ServicoFeriasFolha.prepararProgramacao`); abono e atestado viram
//     ajustes `justificativa` aprovados, um por dia; o ajuste de ponto nasce pendente com a solicitação e é decidido com
//     ela; a alteração cadastral vira a correção com o valor anterior (correcao_registro e o histórico);
//   - o atestado: toda leitura grava o acesso com a finalidade; o CID só com `pessoas.atestado.verCid` e pedido expresso.
// Chaves de liberação (proibido criar chave nova): a do cadastro de colaboradores para pedir, desistir e decidir; a do
// ponto para o que vira ajuste; a da folha para as férias (conferida na programação).
import {
  type AtestadoPessoaResposta,
  CHAVE_PESSOAS_PONTO,
  type DecidirSolicitacaoEntrada,
  type DesistirSolicitacaoEntrada,
  EVENTOS_AUDITAVEIS,
  type FiltroFilaSolicitacoes,
  type FiltroMinhasSolicitacoes,
  type IncluirSolicitacaoEntrada,
  type LerAtestadoEntrada,
  type ListaSolicitacoesPessoa,
  type ResultadoSolicitacaoPessoa,
  type SolicitacaoPessoaResposta,
  type TipoAjuste,
} from '@sgh/contratos';
import {
  type AjusteLido,
  conferirAjuste,
  conferirSolicitacao,
  DIAS_ATESTADO_EMPRESA,
  diasDaSolicitacao,
  estadoDoPeriodo,
  recusaDecisaoSolicitacao,
  recusaDesistenciaSolicitacao,
} from '@sgh/dominio-pessoas';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import { gravarProgramacaoFerias, type ServicoFeriasFolha } from '../folha/servico-ferias.js';
import type { PortaPessoas } from '../porta.js';
import type { PortaPonto } from '../ponto/porta-ponto.js';
import { CHAVE_PESSOAS_COLABORADOR } from '../servico.js';
import type { GravadorAutoatendimento, PortaAutoatendimento } from './porta-autoatendimento.js';
import { vinculosDoLogin } from './servico-meu-espaco.js';
import type { DadosSolicitacao, SolicitacaoRegistrada, AjusteDaSolicitacao } from './tipos.js';
import { type VinculoColaborador } from './servico-meu-espaco.js';

const E = EVENTOS_AUDITAVEIS;

type AjustePonto = Awaited<ReturnType<GravadorAutoatendimento['ponto']['ajustes']>>[number];
type EventoPeriodo = Awaited<ReturnType<GravadorAutoatendimento['ponto']['eventosPeriodo']>>[number];

export const PERMISSOES_AUTOATENDIMENTO = {
  solicitar: 'pessoas.autoatendimento.solicitar',
  aprovar: 'pessoas.autoatendimento.aprovar',
  verCid: 'pessoas.atestado.verCid',
} as const;

const TETO_LISTA = 500;

const recusaRegra = (codigo: string, mensagem: string, campo?: string | null) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campo ? { campos: [campo] } : {}),
  });
const recusar = (r: { codigo: string; mensagem: string; campo: string | null }) =>
  recusaRegra(r.codigo, r.mensagem, r.campo);

const naoEncontrada = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Solicitação não encontrada',
    'A solicitação não existe neste estabelecimento.',
  );

const desatualizada = () =>
  new ErroProblema(
    'conflito-de-versao',
    409,
    'Registro alterado',
    'A solicitação mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
    { codigo: 'desatualizado' },
  );

/** Sessão "como" (ADR 0021): pedir, desistir e decidir são atos pessoais (como no ponto, D-COMO-524). */
function naoComo(s: SessaoCadastro): void {
  if (s.req?.sghComo)
    throw new ErroProblema(
      'recusa-de-negocio',
      403,
      'Ação pessoal',
      'Na sessão de suporte não se pede, desiste ou decide solicitação: entre com a sua própria conta.',
      { codigo: 'sessao-como' },
    );
}

const paraEvento = (e: EventoPeriodo) => ({
  id: e.id,
  acao: e.acao,
  ref: e.ref,
  concorda: e.concorda,
  registradoPor: e.registradoPor,
  registradoEm: e.registradoEm,
});
const paraAjuste = (a: AjustePonto): AjusteLido => ({
  id: a.id,
  tipo: a.tipo as TipoAjuste,
  dia: a.dia,
  marcacao: a.marcacao,
  instante: a.instante,
  movimento: a.movimento,
  minutos: a.minutos,
  situacao: a.situacao as AjusteLido['situacao'],
  pedidoPor: a.pedidoPor,
});

function primeiroDia(competencia: string): string {
  return `${competencia}-01`;
}
function ultimoDia(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  return new Date(Date.UTC(a!, m!, 0)).toISOString().slice(0, 10);
}
function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const mesmo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** Os dados do pedido validado pelo contrato. */
function dadosDoPedido(e: IncluirSolicitacaoEntrada, v: VinculoColaborador): DadosSolicitacao {
  const vazio: DadosSolicitacao = {
    tipo: e.tipo,
    inicio: null,
    fim: null,
    diasGozo: null,
    diasAbono: null,
    adiantaDecimo: null,
    movimento: null,
    justificativa: null,
    campo: null,
    valorAnterior: null,
    valorNovo: null,
    observacao: e.observacao,
  };
  switch (e.tipo) {
    case 'ferias':
      return {
        ...vazio,
        inicio: e.inicio,
        diasGozo: e.diasGozo,
        diasAbono: e.diasAbono,
        adiantaDecimo: e.adiantaDecimo,
      };
    case 'abono':
      return {
        ...vazio,
        inicio: e.inicio,
        fim: e.fim,
        movimento: e.movimento,
        justificativa: e.justificativa,
      };
    case 'atestado':
      return { ...vazio, inicio: e.inicio, fim: e.fim, movimento: e.movimento };
    case 'ajuste_ponto':
      return {
        ...vazio,
        inicio: e.dia,
        fim: e.dia,
        movimento: e.movimento,
        justificativa: e.justificativa,
      };
    case 'alteracao_cadastral':
      return { ...vazio, campo: e.campo, valorAnterior: v.nome, valorNovo: e.valorNovo.trim() };
  }
}

export class ServicoAutoatendimento {
  readonly apoio: ApoioGravacao<GravadorAutoatendimento>;
  /** Só a liberação do ponto (o abono, o atestado e o ajuste viram ajuste no ponto). */
  readonly apoioPonto: ApoioGravacao<GravadorAutoatendimento>;

  constructor(
    readonly porta: PortaAutoatendimento,
    readonly pessoas: PortaPessoas,
    readonly ponto: PortaPonto,
    readonly ferias: ServicoFeriasFolha,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorAutoatendimento>(
      { chave: CHAVE_PESSOAS_COLABORADOR, nome: 'o autoatendimento', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.apoioPonto = new ApoioGravacao<GravadorAutoatendimento>(
      { chave: CHAVE_PESSOAS_PONTO, nome: 'o ponto eletrônico', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  // ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────────

  private async meus(s: SessaoCadastro): Promise<VinculoColaborador[]> {
    return vinculosDoLogin(this.pessoas, this.ponto, s);
  }

  private async resposta(
    s: SessaoCadastro,
    x: SolicitacaoRegistrada,
    v: VinculoColaborador | null,
    ajustes: readonly AjusteDaSolicitacao[],
    proprios: ReadonlySet<number>,
  ): Promise<SolicitacaoPessoaResposta> {
    const pendente = x.situacao === 'pendente';
    return {
      id: x.id,
      vinculo: x.vinculo,
      colaborador: v?.nome ?? null,
      matricula: v?.matricula ?? null,
      tipo: x.tipo,
      inicio: x.inicio,
      fim: x.fim,
      diasGozo: x.diasGozo,
      diasAbono: x.diasAbono,
      adiantaDecimo: x.adiantaDecimo,
      movimento: x.movimento,
      justificativa: x.justificativa,
      campo: x.campo,
      valorAnterior: x.valorAnterior,
      valorNovo: x.valorNovo,
      observacao: x.observacao,
      situacao: x.situacao,
      pedidoPor: x.pedidoPor,
      pedidoEm: x.pedidoEm,
      decididoPor: x.decididoPor,
      decididoEm: x.decididoEm,
      motivoDecisao: x.motivoDecisao,
      ferias: x.ferias,
      ajustes: ajustes.map((a) => ({ id: a.id, dia: a.dia, situacao: a.situacao })),
      temAtestado: x.temAtestado,
      versao: x.versao,
      acoes: {
        desistir: pendente && mesmo(x.pedidoPor, s.login),
        decidir:
          pendente &&
          !mesmo(x.pedidoPor, s.login) &&
          !proprios.has(x.vinculo) &&
          s.pode(PERMISSOES_AUTOATENDIMENTO.aprovar),
      },
    };
  }

  private async lista(
    s: SessaoCadastro,
    xs: readonly SolicitacaoRegistrada[],
    proprios: ReadonlySet<number>,
  ): Promise<ListaSolicitacoesPessoa> {
    const corte = xs.slice(0, TETO_LISTA);
    const [hoje, vs, ajustes] = await Promise.all([
      this.porta.hoje(s.porta),
      Promise.all([...new Set(corte.map((x) => x.vinculo))].map((id) => this.pessoas.vinculo(s.porta, id))),
      Promise.all(
        corte.map((x) =>
          x.tipo === 'ferias' || x.tipo === 'alteracao_cadastral'
            ? Promise.resolve([])
            : this.porta.ajustesDaSolicitacao(s.porta, x.id),
        ),
      ),
    ]);
    const porId = new Map(vs.filter((v): v is VinculoColaborador => v !== null).map((v) => [v.id, v]));
    return {
      hoje,
      itens: await Promise.all(
        corte.map((x, i) => this.resposta(s, x, porId.get(x.vinculo) ?? null, ajustes[i] ?? [], proprios)),
      ),
      limitado: xs.length > TETO_LISTA,
    };
  }

  /** As solicitações do próprio colaborador (todos os vínculos do login, ou o pedido). */
  async minhas(s: SessaoCadastro, f: FiltroMinhasSolicitacoes): Promise<ListaSolicitacoesPessoa> {
    const meus = (await this.meus(s)).map((v) => v.id);
    const vinculos = f.vinculo !== undefined ? meus.filter((v) => v === f.vinculo) : meus;
    const xs = await this.porta.solicitacoes(s.porta, { vinculos, situacao: f.situacao ?? null });
    return this.lista(s, xs, new Set(meus));
  }

  /** A fila do gestor: as solicitações dos outros (o próprio vínculo é tratado por outra pessoa). */
  async fila(s: SessaoCadastro, f: FiltroFilaSolicitacoes): Promise<ListaSolicitacoesPessoa> {
    const proprios = new Set((await this.meus(s)).map((v) => v.id));
    let xs = (await this.porta.solicitacoes(s.porta, { situacao: f.situacao })).filter(
      (x) => !proprios.has(x.vinculo) && (f.tipo === undefined || x.tipo === f.tipo),
    );
    if (f.unidade !== undefined) {
      const vs = await Promise.all(
        [...new Set(xs.map((x) => x.vinculo))].map((id) => this.pessoas.vinculo(s.porta, id)),
      );
      const daUnidade = new Set(vs.filter((v) => v?.unidade === f.unidade).map((v) => v!.id));
      xs = xs.filter((x) => daUnidade.has(x.vinculo));
    }
    return this.lista(s, xs, proprios);
  }

  private async solicitacaoOu404(s: SessaoCadastro, id: number): Promise<SolicitacaoRegistrada> {
    const x = await this.porta.solicitacao(s.porta, id);
    if (!x) throw naoEncontrada();
    return x;
  }

  // ── Pedido ──────────────────────────────────────────────────────────────────────────────────────────────────

  async incluir(s: SessaoCadastro, e: IncluirSolicitacaoEntrada): Promise<ResultadoSolicitacaoPessoa> {
    naoComo(s);
    const meus = await this.meus(s);
    const ativos = meus.filter((v) => v.desligamento === null);
    const v =
      e.vinculo === null
        ? ativos.length === 1
          ? ativos[0]!
          : null
        : (ativos.find((x) => x.id === e.vinculo) ?? null);
    if (!v) {
      if (e.vinculo !== null || ativos.length === 0)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Vínculo não encontrado',
          'Você não tem vínculo ativo de colaborador com este número neste estabelecimento.',
        );
      throw recusaRegra('vinculo-obrigatorio', 'Você tem mais de um vínculo: escolha qual.', 'vinculo');
    }
    const hoje = await this.porta.hoje(s.porta);
    const dados = dadosDoPedido(e, v);
    const conf = conferirSolicitacao(
      {
        tipo: e.tipo,
        inicio: dados.inicio,
        fim: dados.fim,
        diasGozo: dados.diasGozo,
        diasAbono: dados.diasAbono,
        campo: dados.campo,
        valorNovo: dados.valorNovo,
        atestado: e.tipo === 'atestado' ? { emitidoEm: e.atestado.emitidoEm, dias: e.atestado.dias } : null,
      },
      hoje,
    );
    if (conf.recusas.length > 0) throw recusar(conf.recusas[0]!);
    if (e.tipo === 'alteracao_cadastral' && dados.valorNovo === v.nome)
      throw recusaRegra('valor-igual', 'O valor pedido é igual ao do cadastro.', 'valorNovo');
    const viraAjuste = e.tipo === 'ajuste_ponto';
    if (viraAjuste) await this.apoioPonto.exigirLiberacao(s);
    const [dominios, hmacs] = viraAjuste
      ? await Promise.all([this.ponto.dominios(s.porta), this.ponto.hmacs(s.porta, [v.id])])
      : [null, null];
    if (
      e.tipo === 'ajuste_ponto' &&
      e.justificativa !== null &&
      !dominios!.justificativas.some((x) => x.codigo === e.justificativa)
    )
      throw recusaRegra('justificativa', 'Escolha o motivo da lista.', 'justificativa');
    if (
      e.tipo === 'ajuste_ponto' &&
      e.periodo !== null &&
      !dominios!.periodos.some((x) => x.codigo === e.periodo)
    )
      throw recusaRegra('periodo', 'Escolha a marcação da jornada da lista.', 'periodo');
    const id = await this.apoio.sgh(
      s,
      E.pessoasSolicitacaoGravada.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      (r: number) => ({ tabela: 'solicitacao_colaborador', id: String(r) }),
      async (g) => {
        const n = await g.incluirSolicitacao({ ...dados, vinculo: v.id, por: s.login });
        if (e.tipo === 'atestado') await g.incluirAtestado({ ...e.atestado, solicitacao: n, por: s.login });
        if (e.tipo === 'ajuste_ponto') {
          await g.ponto.travarPessoa(v.pessoa);
          const competencia = e.dia.slice(0, 7);
          const eventos = (await g.ponto.eventosPeriodo(v.id)).filter((x) => x.competencia === competencia);
          const hmac = hmacs!.get(v.id) ?? null;
          const originais = hmac
            ? await g.ponto.marcacoes(hmac, `${e.dia}T00:00`, `${somarDias(e.dia, 2)}T00:00`)
            : [];
          const recusa = conferirAjuste(
            {
              tipo: e.ajuste,
              dia: e.dia,
              marcacao: e.marcacao,
              instante: e.instante,
              movimento: e.movimento,
              minutos: e.minutos,
            },
            {
              hoje,
              admissao: v.admissao,
              desligamento: v.desligamento,
              periodoFechado: estadoDoPeriodo(eventos.map(paraEvento)).estado === 'fechado',
              originais: originais.map((m) => ({ id: m.id, instante: m.instante })),
              ajustes: (await g.ponto.ajustes(v.id, primeiroDia(competencia), ultimoDia(competencia))).map(
                paraAjuste,
              ),
              movimentos: dominios!.movimentos.map((x) => x.codigo),
            },
          );
          if (recusa) throw recusar(recusa);
          const ajuste = await g.ponto.incluirAjuste({
            vinculo: v.id,
            dia: e.dia,
            tipo: e.ajuste,
            marcacao: e.ajuste === 'desconsiderar' ? e.marcacao : null,
            instante: e.ajuste === 'inclusao' ? e.instante : null,
            movimento: e.ajuste === 'justificativa' ? e.movimento : null,
            justificativa: e.ajuste === 'justificativa' ? e.justificativa : null,
            periodo: e.ajuste === 'inclusao' ? e.periodo : null,
            minutos: e.ajuste === 'justificativa' ? e.minutos : null,
            motivo: e.observacao,
            por: s.login,
          });
          await g.ligarAjuste({ ajuste, solicitacao: n });
        }
        return n;
      },
    );
    return this.resultado(s, id, 'Solicitação enviada: aguarda a aprovação do gestor.', conf.avisos);
  }

  private async resultado(
    s: SessaoCadastro,
    id: number,
    mensagem: string,
    avisos: readonly string[] = [],
  ): Promise<ResultadoSolicitacaoPessoa> {
    const x = await this.porta.solicitacao(s.porta, id);
    const proprios = new Set((await this.meus(s)).map((v) => v.id));
    const [v, ajustes] = x
      ? await Promise.all([
          this.pessoas.vinculo(s.porta, x.vinculo),
          this.porta.ajustesDaSolicitacao(s.porta, x.id),
        ])
      : [null, []];
    return {
      ok: true,
      id,
      mensagem,
      avisos,
      solicitacao: x ? await this.resposta(s, x, v, ajustes, proprios) : null,
    };
  }

  /** Desistência da pendente pelo próprio solicitante, com motivo; o ajuste pendente ligado desiste junto. */
  async desistir(s: SessaoCadastro, e: DesistirSolicitacaoEntrada): Promise<ResultadoSolicitacaoPessoa> {
    naoComo(s);
    const x = await this.solicitacaoOu404(s, e.solicitacao);
    const meus = new Set((await this.meus(s)).map((v) => v.id));
    // Quem não é dono nem vê a fila: 404 (não revela a solicitação); o gestor recebe a recusa explícita.
    if (!meus.has(x.vinculo) && !mesmo(x.pedidoPor, s.login) && !s.pode(PERMISSOES_AUTOATENDIMENTO.aprovar))
      throw naoEncontrada();
    const r = recusaDesistenciaSolicitacao(x, s.login);
    if (r) throw recusar(r);
    if (x.versao !== e.versao) throw desatualizada();
    const motivo = e.motivo.trim();
    await this.apoio.sgh(
      s,
      E.pessoasSolicitacaoGravada.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      { tabela: 'solicitacao_colaborador', id: String(x.id), chave: 'desistencia' },
      async (g) => {
        await g.desistirSolicitacao({ id: x.id, versao: e.versao, motivo, por: s.login });
        for (const a of await g.ajustesDaSolicitacao(x.id))
          if (a.situacao === 'pendente')
            await g.ponto.desistirAjuste({ id: a.id, versao: a.versao, motivo, por: s.login });
      },
    );
    return this.resultado(s, x.id, 'Você desistiu da solicitação.');
  }

  // ── Decisão do gestor ───────────────────────────────────────────────────────────────────────────────────────

  /** Férias: a empresa (a única, se não veio) e o período aquisitivo (o mais antigo com saldo, se não veio). */
  private async programacaoDasFerias(
    s: SessaoCadastro,
    x: SolicitacaoRegistrada,
    e: DecidirSolicitacaoEntrada,
  ) {
    let empresa = e.empresa;
    if (empresa === null) {
      const es = (await this.ferias.apoioTela(s)).empresas;
      if (es.length !== 1)
        throw recusaRegra(
          'empresa-obrigatoria',
          'Escolha a empresa da folha em que as férias serão programadas.',
          'empresa',
        );
      empresa = es[0]!.codigo;
    }
    const dias = x.diasGozo ?? 0;
    const abono = x.diasAbono ?? 0;
    let aquisitivoInicio = e.aquisitivoInicio;
    if (aquisitivoInicio === null) {
      const { periodos } = await this.ferias.saldo(s, x.vinculo);
      const p = periodos.find(
        (y) => (y.situacao === 'vencido' || y.situacao === 'aberto') && y.saldo >= dias + abono,
      );
      if (!p)
        throw recusaRegra(
          'sem-periodo-com-saldo',
          `O colaborador não tem período aquisitivo com ${dias + abono} dias de saldo: confira o saldo nas férias da folha.`,
          'aquisitivoInicio',
        );
      aquisitivoInicio = p.inicio;
    }
    return this.ferias.prepararProgramacao(s, {
      vinculo: x.vinculo,
      empresa,
      aquisitivoInicio,
      inicio: x.inicio!,
      dias,
      abono,
      adiantarDecimo: x.adiantaDecimo ?? false,
    });
  }

  async decidir(s: SessaoCadastro, e: DecidirSolicitacaoEntrada): Promise<ResultadoSolicitacaoPessoa> {
    naoComo(s);
    const x = await this.solicitacaoOu404(s, e.solicitacao);
    const r = recusaDecisaoSolicitacao(x, s.login);
    if (r) throw recusar(r);
    const proprios = new Set((await this.meus(s)).map((v) => v.id));
    if (proprios.has(x.vinculo))
      throw recusaRegra('proprio-vinculo', 'A sua própria solicitação é decidida por outra pessoa.');
    if (x.versao !== e.versao) throw desatualizada();
    const v = await this.pessoas.vinculo(s.porta, x.vinculo);
    if (!v) throw naoEncontrada();
    const aprovar = e.decisao === 'aprovar';
    const motivo = e.motivo?.trim() || null;
    const noPonto = x.tipo === 'abono' || x.tipo === 'atestado' || x.tipo === 'ajuste_ponto';
    if (noPonto) await this.apoioPonto.exigirLiberacao(s);
    // Antes da transação: o que se confere sem trava (a programação das férias; o movimento do abono e do atestado).
    const programacao = aprovar && x.tipo === 'ferias' ? await this.programacaoDasFerias(s, x, e) : null;
    const movimento = e.movimento ?? x.movimento;
    const justificativa = e.justificativa ?? x.justificativa;
    const dominios = aprovar && noPonto ? await this.ponto.dominios(s.porta) : null;
    if (aprovar && (x.tipo === 'abono' || x.tipo === 'atestado')) {
      if (movimento === null)
        throw recusaRegra(
          'movimento-obrigatorio',
          'Escolha o tipo de movimento do ponto (falta justificada, folga...) para aprovar.',
          'movimento',
        );
      if (!dominios!.movimentos.some((m) => m.codigo === movimento))
        throw recusaRegra('movimento', 'Escolha o tipo de movimento da lista.', 'movimento');
      if (justificativa !== null && !dominios!.justificativas.some((j) => j.codigo === justificativa))
        throw recusaRegra('justificativa', 'Escolha o motivo da lista.', 'justificativa');
    }
    const hoje = await this.porta.hoje(s.porta);
    await this.apoio.sgh(
      s,
      E.pessoasSolicitacaoGravada.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      { tabela: 'solicitacao_colaborador', id: String(x.id), chave: aprovar ? 'aprovacao' : 'recusa' },
      async (g) => {
        const atual = await g.solicitacao(x.id);
        if (!atual || atual.versao !== e.versao || atual.situacao !== 'pendente') throw desatualizada();
        let ferias: number | null = null;
        if (noPonto) await g.ponto.travarPessoa(v.pessoa);
        const fechado = async (dia: string) => {
          const c = dia.slice(0, 7);
          const ev = (await g.ponto.eventosPeriodo(v.id)).filter((y) => y.competencia === c);
          return estadoDoPeriodo(ev.map(paraEvento)).estado === 'fechado';
        };
        if (x.tipo === 'ajuste_ponto') {
          for (const a of await g.ajustesDaSolicitacao(x.id)) {
            if (a.situacao !== 'pendente') continue;
            if (await fechado(a.dia))
              throw recusaRegra('periodo-fechado', `O período do dia ${a.dia} está fechado: reabra antes.`);
            await g.ponto.decidirAjuste({
              id: a.id,
              versao: a.versao,
              situacao: aprovar ? 'aprovado' : 'recusado',
              motivo,
              por: s.login,
            });
          }
        } else if (aprovar && x.tipo === 'ferias') {
          ferias = await gravarProgramacaoFerias(g.folha, programacao!, s.login);
        } else if (aprovar && (x.tipo === 'abono' || x.tipo === 'atestado')) {
          // D-W006-SOLIC-FUTURO: o abono e o atestado aprovados justificam também os dias que ainda vão chegar (a
          // folga combinada, o afastamento em curso); as outras conferências do ajuste valem (período fechado,
          // admissão, desligamento, dia já justificado).
          const dias = diasDaSolicitacao(x.inicio!, x.fim!);
          const ultimo = dias[dias.length - 1]!;
          for (const dia of dias) {
            const c = dia.slice(0, 7);
            const recusa = conferirAjuste(
              { tipo: 'justificativa', dia, marcacao: null, instante: null, movimento, minutos: null },
              {
                hoje: ultimo > hoje ? ultimo : hoje,
                admissao: v.admissao,
                desligamento: v.desligamento,
                periodoFechado: await fechado(dia),
                originais: [],
                ajustes: (await g.ponto.ajustes(v.id, primeiroDia(c), ultimoDia(c))).map(paraAjuste),
                movimentos: dominios!.movimentos.map((m) => m.codigo),
              },
            );
            if (recusa) throw recusaRegra(recusa.codigo, `${dia}: ${recusa.mensagem}`, recusa.campo);
            // O ajuste é pedido pelo colaborador (a solicitação) e aprovado pelo gestor: a segregação do ponto vale.
            const ajuste = await g.ponto.incluirAjuste({
              vinculo: v.id,
              dia,
              tipo: 'justificativa',
              marcacao: null,
              instante: null,
              movimento,
              justificativa,
              periodo: null,
              minutos: null,
              motivo: `Solicitação ${x.id} (${x.tipo === 'abono' ? 'abono' : 'atestado'}) aprovada`,
              por: x.pedidoPor,
            });
            await g.ligarAjuste({ ajuste, solicitacao: x.id });
            const a = await g.ponto.ajuste(ajuste);
            if (!a) throw desatualizada();
            await g.ponto.decidirAjuste({
              id: a.id,
              versao: a.versao,
              situacao: 'aprovado',
              motivo,
              por: s.login,
            });
          }
        } else if (aprovar && x.tipo === 'alteracao_cadastral') {
          const atualV = await g.pessoas.vinculo(v.id);
          if (!atualV) throw naoEncontrada();
          const antes = { nome: atualV.nome };
          const depois = { nome: x.valorNovo! };
          const porque = `Solicitação ${x.id} do colaborador: ${x.observacao ?? ''}`.trim().slice(0, 400);
          await g.pessoas.corrigirVinculo({
            id: atualV.id,
            versao: atualV.versao,
            nome: depois.nome,
            matricula: atualV.matricula,
            tipo: atualV.tipo,
            admissao: atualV.admissao,
            por: s.login,
          });
          await g.pessoas.incluirHistorico({
            vinculo: atualV.id,
            tipo: 'correcao',
            vigencia: hoje,
            antes: `nome: ${antes.nome}`,
            depois: `nome: ${depois.nome}`,
            motivo: porque,
            por: s.login,
          });
          await g.pessoas.registrarCorrecao({
            vinculo: atualV.id,
            operacao: 'colaborador.corrigido',
            antes,
            depois,
            motivo: porque,
            por: s.login,
          });
        }
        await g.decidirSolicitacao({
          id: x.id,
          versao: e.versao,
          situacao: aprovar ? 'aprovada' : 'recusada',
          motivo,
          ferias,
          por: s.login,
        });
      },
    );
    return this.resultado(
      s,
      x.id,
      aprovar ? 'Solicitação aprovada.' : 'Solicitação recusada.',
      programacao?.avisos ?? [],
    );
  }

  // ── Atestado (LGPD arts. 11 e 46) ───────────────────────────────────────────────────────────────────────────

  /** Lê o atestado: o próprio colaborador ou quem decide; cada leitura grava o acesso com a finalidade. */
  async atestado(
    s: SessaoCadastro,
    solicitacao: number,
    e: LerAtestadoEntrada,
  ): Promise<AtestadoPessoaResposta> {
    const x = await this.solicitacaoOu404(s, solicitacao);
    const proprios = new Set((await this.meus(s)).map((v) => v.id));
    const proprio = proprios.has(x.vinculo);
    if (!proprio && !s.pode(PERMISSOES_AUTOATENDIMENTO.aprovar)) throw naoEncontrada();
    const podeCid = s.pode(PERMISSOES_AUTOATENDIMENTO.verCid);
    if (e.verCid && !podeCid && !proprio)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Dado de saúde restrito',
        'O CID do atestado é restrito a quem lê o exame ocupacional (LGPD, art. 11).',
        { codigo: 'cid-restrito' },
      );
    const a = await this.apoio.sgh(
      s,
      E.pessoasAtestadoLido.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      { tabela: 'atestado_colaborador_acesso', id: String(x.id) },
      (g) =>
        g.atestado({ solicitacao: x.id, verCid: e.verCid, finalidade: e.finalidade.trim(), por: s.login }),
    );
    if (!a)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Atestado não encontrado',
        'Esta solicitação não tem atestado.',
      );
    const acessos = podeCid ? await this.porta.acessosAtestado(s.porta, x.id) : [];
    return {
      id: a.id,
      solicitacao: a.solicitacao,
      emitidoEm: a.emitidoEm,
      dias: a.dias,
      cid: a.cid,
      temCid: a.temCid,
      emitente: a.emitente,
      registroConselho: a.registroConselho,
      arquivo: a.arquivo ? { tipo: a.arquivo.tipo, tamanho: a.arquivo.tamanho, hash: a.arquivo.hash } : null,
      criadoPor: a.criadoPor,
      criadoEm: a.criadoEm,
      avisoInss: a.dias > DIAS_ATESTADO_EMPRESA,
      acessos: acessos.map((y) => ({
        acessadoPor: y.acessadoPor,
        acessadoEm: y.acessadoEm,
        viuCid: y.viuCid,
        finalidade: y.finalidade,
      })),
    };
  }
}
