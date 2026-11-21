// Serviço da contabilidade, etapa 2 (M54-F2): monta as respostas (lançamentos, razão, conciliação, períodos) e os
// planos de gravação (manual, estorno, contabilização dos fatos) com as regras puras de @sgh/dominio-contabil. A
// gravação em si (na transação do Executor, com a trilha) é do controlador; aqui nada grava.
import {
  type ApoioLancamentos,
  CODIGOS_TIPO_LANCAMENTO,
  type ConciliacaoListada,
  type ContaPlano,
  type DetalheLancamento,
  type LancamentoListado,
  type LancamentoManual,
  type LancamentosContabeis,
  LOTE_CONTABILIZACAO,
  type PendentesConciliacao,
  type PeriodosContabeis,
  type RazaoConta,
  type SituacaoDoPeriodo,
  type SituacaoFato,
  TETO_PARTIDAS_CONCILIACAO,
  TETO_RAZAO_MOVIMENTOS,
  TIPOS_FATO,
  TIPOS_LANCAMENTO,
  rotuloDaFonte,
} from '@sgh/contratos';
import {
  type AcaoContabilizacao,
  chaveManual,
  competenciaDaData,
  contextoDeAplicacao,
  impedimentosDoEncerramento,
  type LancamentoNovo,
  montarRazao,
  partidasDoManual,
  type PeriodoContabil,
  planoDaContabilizacao,
  planoDoEstorno,
  problemasDoLancamentoManual,
  recusaDataFutura,
  recusaDaReabertura,
  resumoDaContabilizacao,
} from '@sgh/dominio-contabil';
import type { ContaPlanoVersionada, FiltroLancamentosPorta, LancamentoRegistrado } from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoContabil, PortaContabil } from './porta.js';

const recusa = (codigo: string, detalhe: string) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', detalhe, { codigo });

const semCampos = (c: ContaPlanoVersionada): ContaPlano => ({
  empresa: c.empresa,
  codigo: c.codigo,
  nome: c.nome,
  grupo: c.grupo,
  tipo: c.tipo,
  natureza: c.natureza,
  referencialTipo: c.referencialTipo,
  referencialConta: c.referencialConta,
  contaExportacao: c.contaExportacao,
  exigeCentroCusto: c.exigeCentroCusto,
  ativa: c.ativa,
});

const periodosDoDominio = (
  ps: readonly { empresa: number; competencia: string; situacao: 'aberto' | 'encerrado' }[],
) =>
  ps.map((p): PeriodoContabil => ({ empresa: p.empresa, competencia: p.competencia, situacao: p.situacao }));

function listado(l: LancamentoRegistrado): LancamentoListado {
  return {
    id: l.id,
    empresa: l.empresa,
    tipo: l.tipo,
    tipoRotulo: TIPOS_LANCAMENTO[l.tipo],
    data: l.data,
    competencia: l.competencia,
    historico: l.historico,
    debitosCentavos: l.debitos,
    creditosCentavos: l.creditos,
    origem: l.fato?.origem ?? null,
    tipoFatoRotulo: l.fato ? TIPOS_FATO[l.fato.tipo].rotulo : null,
    estornaId: l.estornaId,
    estornadoPor: l.estornadoPor,
    criadoPor: l.criadoPor,
    criadoEm: l.criadoEm,
  };
}

export interface FlagsApoio {
  readonly ligada: boolean;
  readonly motivo: string | null;
  readonly podeVerFatos: boolean;
  readonly podeLancar: boolean;
  readonly podeEstornar: boolean;
  readonly podeConciliar: boolean;
  readonly podeEncerrar: boolean;
  readonly podeReabrir: boolean;
}

export class ServicoLancamentos {
  constructor(private readonly porta: PortaContabil) {}

  async apoio(c: ContextoContabil, flags: FlagsApoio, empresa: number): Promise<ApoioLancamentos> {
    const [empresas, hoje, plano] = await Promise.all([
      this.porta.empresas(c),
      this.porta.hoje(c),
      flags.ligada ? this.porta.plano(c, empresa) : Promise.resolve([]),
    ]);
    return {
      ...flags,
      empresas: empresas.length ? empresas : [1],
      hoje,
      tipos: CODIGOS_TIPO_LANCAMENTO.map((codigo) => ({ codigo, rotulo: TIPOS_LANCAMENTO[codigo] })),
      contas: plano
        .filter((x) => x.tipo === 'analitica' && x.ativa)
        .map((x) => ({
          codigo: x.codigo,
          nome: x.nome,
          natureza: x.natureza,
          exigeCentroCusto: x.exigeCentroCusto,
        })),
    };
  }

  async lancamentos(
    c: ContextoContabil,
    f: FiltroLancamentosPorta,
    pagina: number,
    tamanho: number,
  ): Promise<LancamentosContabeis> {
    const r = await this.porta.lancamentos(c, f, pagina, tamanho);
    return { itens: r.itens.map(listado), total: r.total, pagina, tamanho };
  }

  async detalhe(c: ContextoContabil, empresa: number, id: number): Promise<DetalheLancamento> {
    const l = await this.porta.lancamento(c, id);
    if (!l || l.empresa !== empresa)
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'Lançamento não encontrado.');
    const plano = await this.porta.plano(c, empresa);
    const nomes = new Map(plano.map((x) => [x.codigo, x.nome]));
    const motivoNaoEstornavel =
      l.tipo === 'estorno'
        ? 'Um estorno não se estorna: faça um lançamento novo com as partidas certas.'
        : l.estornadoPor !== null
          ? `Já estornado pelo lançamento ${l.estornadoPor}.`
          : null;
    return {
      ...listado(l),
      partidas: l.partidas.map((p) => ({
        id: p.id,
        ordem: p.ordem,
        lado: p.lado,
        conta: p.conta,
        contaNome: nomes.get(p.conta) ?? null,
        valorCentavos: p.valorCentavos,
        centroCusto: p.centroCusto,
        historico: p.historico,
        conciliacao: p.conciliacao,
      })),
      fato:
        l.fato && l.fatoId !== null
          ? {
              id: l.fatoId,
              fonte: rotuloDaFonte(l.fato.tabela),
              documento: l.fato.documento,
              data: l.fato.data,
              tipo: l.fato.tipo,
            }
          : null,
      regra: l.regra,
      justificativa: l.justificativa,
      estornavel: motivoNaoEstornavel === null,
      motivoNaoEstornavel,
    };
  }

  private async contaAnalitica(c: ContextoContabil, empresa: number, codigo: string) {
    const plano = await this.porta.plano(c, empresa);
    const conta = plano.find((x) => x.codigo === codigo);
    if (!conta) throw recusa('conta-inexistente', `A conta ${codigo} não existe no plano.`);
    if (conta.tipo !== 'analitica')
      throw recusa('conta-sintetica', `A conta ${codigo} é sintética: escolha uma conta analítica.`);
    return conta;
  }

  async razao(
    c: ContextoContabil,
    f: { empresa: number; conta: string; de: string; ate: string; centroCusto?: number },
    pagina = 1,
  ): Promise<RazaoConta> {
    const conta = await this.contaAnalitica(c, f.empresa, f.conta);
    const lido = await this.porta.razao(c, f, TETO_RAZAO_MOVIMENTOS, pagina);
    const r = montarRazao(
      conta.natureza,
      lido.anterior,
      lido.movimentos,
      lido.totais,
      TETO_RAZAO_MOVIMENTOS,
      lido.antesDaPagina,
    );
    return {
      pagina,
      empresa: f.empresa,
      conta: conta.codigo,
      contaNome: conta.nome,
      natureza: conta.natureza,
      de: f.de,
      ate: f.ate,
      ...r,
    };
  }

  async pendentesConciliacao(
    c: ContextoContabil,
    empresa: number,
    codigo: string,
    ate: string | null,
  ): Promise<PendentesConciliacao> {
    const conta = await this.contaAnalitica(c, empresa, codigo);
    const lidas = await this.porta.pendentesConciliacao(c, empresa, codigo, ate, TETO_PARTIDAS_CONCILIACAO);
    const itens = lidas.slice(0, TETO_PARTIDAS_CONCILIACAO);
    return {
      empresa,
      conta: conta.codigo,
      contaNome: conta.nome,
      itens,
      debitosCentavos: itens.filter((p) => p.lado === 'D').reduce((s, p) => s + p.valorCentavos, 0),
      creditosCentavos: itens.filter((p) => p.lado === 'C').reduce((s, p) => s + p.valorCentavos, 0),
      parcial: lidas.length > TETO_PARTIDAS_CONCILIACAO,
    };
  }

  async conciliacoes(c: ContextoContabil, empresa: number, conta: string): Promise<ConciliacaoListada[]> {
    const cs = await this.porta.conciliacoes(c, empresa, conta, 100);
    return cs.map((x) => ({
      id: x.id,
      conta: x.conta,
      situacao: x.situacao,
      partidas: x.partidas,
      valorCentavos: x.valorCentavos,
      observacao: x.observacao,
      criadaPor: x.criadaPor,
      criadaEm: x.criadaEm,
      desfeitaPor: x.desfeitaPor,
      desfeitaEm: x.desfeitaEm,
    }));
  }

  // ── Planos de gravação ─────────────────────────────────────────────────────────────────────────

  /** O lançamento manual conferido (período aberto, contas, centro, equilíbrio) ou a recusa com os problemas. */
  async planoManual(c: ContextoContabil, l: LancamentoManual): Promise<LancamentoNovo> {
    const [plano, periodos, hoje] = await Promise.all([
      this.porta.plano(c, l.empresa),
      this.porta.periodos(c, l.empresa),
      this.porta.hoje(c),
    ]);
    const problemas = problemasDoLancamentoManual(l, plano.map(semCampos), periodosDoDominio(periodos), hoje);
    // D-FUTURO-542: a data futura tem código próprio (a tela diz o motivo e o caminho).
    const futura = recusaDataFutura(l.data, hoje);
    if (futura) throw recusa('data-futura', problemas.join(' '));
    // O período encerrado tem código próprio: a tela mostra o motivo e o caminho (lançar no aberto ou reabrir).
    const comp = l.data.slice(0, 7);
    if (periodos.some((p) => p.empresa === l.empresa && p.competencia === comp && p.situacao === 'encerrado'))
      throw recusa('periodo-encerrado', problemas.join(' '));
    if (problemas.length) throw recusa('lancamento-com-problemas', problemas.join(' '));
    return {
      chave: chaveManual(l.idempotencia),
      tipo: 'manual',
      empresa: l.empresa,
      data: l.data,
      competencia: competenciaDaData(l.data),
      historico: l.historico.trim(),
      partidas: partidasDoManual(l.partidas, l.historico.trim()),
      fatoId: null,
      regraId: null,
      regra: null,
      estornaId: null,
      justificativa: null,
    };
  }

  /** O estorno do lançamento ou a recusa (estorno de estorno, já estornado, data antes, período encerrado). */
  async planoEstorno(
    c: ContextoContabil,
    empresa: number,
    id: number,
    justificativa: string,
    data?: string,
  ): Promise<LancamentoNovo> {
    const [l, periodos, hoje] = await Promise.all([
      this.porta.lancamento(c, id),
      this.porta.periodos(c, empresa),
      this.porta.hoje(c),
    ]);
    if (!l || l.empresa !== empresa)
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'Lançamento não encontrado.');
    const r = planoDoEstorno(
      { ...l, partidas: l.partidas },
      periodosDoDominio(periodos),
      hoje,
      justificativa.trim(),
      data,
    );
    if (!r.ok) throw recusa(r.codigo, r.motivo);
    return r.lancamento;
  }

  /** As ações da contabilização de um lote de fatos (puro sobre o que a porta leu). */
  async planoContabilizacao(
    c: ContextoContabil,
    empresa: number,
    competencia: string | null,
    incluirRecusados: boolean,
  ): Promise<{ acoes: AcaoContabilizacao[]; restam: boolean; fatos: number }> {
    const situacoes: SituacaoFato[] = incluirRecusados ? ['pendente', 'semRegra', 'semConta'] : ['pendente'];
    const [lido, plano, dePara, publicadas, periodos] = await Promise.all([
      this.porta.paraContabilizar(c, empresa, situacoes, competencia, LOTE_CONTABILIZACAO),
      this.porta.plano(c, empresa),
      this.porta.dePara(c, empresa),
      this.porta.regras(c, empresa, {}),
      this.porta.periodos(c, empresa),
    ]);
    const acoes = planoDaContabilizacao({
      candidatos: lido.candidatos,
      registrados: lido.registrados,
      lancamentos: lido.lancamentos,
      publicadas: publicadas.map((p) => ({ id: p.id, regra: p.regra })),
      ctx: contextoDeAplicacao(plano.map(semCampos), dePara),
      periodos: periodosDoDominio(periodos),
    });
    return { acoes, restam: lido.restam, fatos: lido.candidatos.length };
  }

  resumo(acoes: readonly AcaoContabilizacao[]) {
    return resumoDaContabilizacao(acoes);
  }

  // ── Períodos ───────────────────────────────────────────────────────────────────────────────────

  async periodos(c: ContextoContabil, empresa: number): Promise<PeriodosContabeis> {
    const [ps, mov] = await Promise.all([
      this.porta.periodos(c, empresa),
      this.porta.movimentoPorCompetencia(c, empresa),
    ]);
    const porComp = new Map(ps.map((p) => [p.competencia, p]));
    const comps = [...new Set([...ps.map((p) => p.competencia), ...mov.map((m) => m.competencia)])]
      .sort()
      .reverse();
    const movPor = new Map(mov.map((m) => [m.competencia, m]));
    return {
      empresa,
      itens: comps.map((competencia) => {
        const p = porComp.get(competencia);
        const m = movPor.get(competencia);
        return {
          competencia,
          situacao: p?.situacao ?? 'aberto',
          lancamentos: m?.lancamentos ?? 0,
          debitosCentavos: m?.debitos ?? 0,
          creditosCentavos: m?.creditos ?? 0,
          encerradoPor: p?.situacao === 'encerrado' ? p.encerradoPor : null,
          encerradoEm: p?.situacao === 'encerrado' ? p.encerradoEm : null,
        };
      }),
    };
  }

  async situacaoPeriodo(
    c: ContextoContabil,
    empresa: number,
    competencia: string,
  ): Promise<SituacaoDoPeriodo> {
    const [ps, tipos, fatos, hoje, mov] = await Promise.all([
      this.porta.periodos(c, empresa),
      this.porta.totaisDoPeriodo(c, empresa, competencia),
      this.porta.fatosDoPeriodo(c, empresa, competencia),
      this.porta.hoje(c),
      this.porta.movimentoPorCompetencia(c, empresa),
    ]);
    const p = ps.find((x) => x.competencia === competencia);
    const encerrado = p?.situacao === 'encerrado';
    const anterior = (() => {
      const a = Number(competencia.slice(0, 4));
      const m = Number(competencia.slice(5, 7));
      return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
    })();
    const pa = ps.find((x) => x.competencia === anterior);
    const fatosAnterior =
      pa?.situacao === 'encerrado' ? {} : await this.porta.fatosDoPeriodo(c, empresa, anterior);
    const movimentoAnterior =
      mov.some((x) => x.competencia === anterior && x.lancamentos > 0) ||
      Object.values(fatosAnterior).some((n) => (n ?? 0) > 0);
    const debitos = tipos.reduce((s, t) => s + t.debitos, 0);
    const creditos = tipos.reduce((s, t) => s + t.creditos, 0);
    const impedimentos = impedimentosDoEncerramento({
      competencia,
      hoje,
      encerrado,
      fatos,
      debitos,
      creditos,
      anteriorAbertaComMovimento: pa?.situacao !== 'encerrado' && movimentoAnterior ? anterior : null,
    });
    const motivoNaoReabre = encerrado
      ? recusaDaReabertura(periodosDoDominio(ps), empresa, competencia)
      : null;
    return {
      empresa,
      competencia,
      situacao: encerrado ? 'encerrado' : 'aberto',
      lancamentos: tipos.reduce((s, t) => s + t.lancamentos, 0),
      debitosCentavos: debitos,
      creditosCentavos: creditos,
      encerradoPor: encerrado ? (p?.encerradoPor ?? null) : null,
      encerradoEm: encerrado ? (p?.encerradoEm ?? null) : null,
      parcelas: tipos.map((t) => ({
        tipo: t.tipo,
        lancamentos: t.lancamentos,
        debitosCentavos: t.debitos,
        creditosCentavos: t.creditos,
      })),
      fatos,
      impedimentos,
      podeEncerrar: !encerrado && impedimentos.length === 0,
      podeReabrir: encerrado && motivoNaoReabre === null,
      motivoNaoReabre: encerrado ? motivoNaoReabre : 'O período está aberto.',
    };
  }

  /** As regras do encerramento e da reabertura que a gravação chama na transação. */
  conferirEncerramento(competencia: string, hoje: string) {
    return (d: {
      periodo: { situacao: 'aberto' | 'encerrado' };
      fatos: Partial<Record<SituacaoFato, number>>;
      debitos: number;
      creditos: number;
      anteriorAbertaComMovimento: string | null;
    }) =>
      impedimentosDoEncerramento({
        competencia,
        hoje,
        encerrado: d.periodo.situacao === 'encerrado',
        fatos: d.fatos,
        debitos: d.debitos,
        creditos: d.creditos,
        anteriorAbertaComMovimento: d.anteriorAbertaComMovimento,
      });
  }

  conferirReabertura(empresa: number, competencia: string) {
    return (ps: readonly { empresa: number; competencia: string; situacao: 'aberto' | 'encerrado' }[]) =>
      recusaDaReabertura(periodosDoDominio(ps), empresa, competencia);
  }
}
