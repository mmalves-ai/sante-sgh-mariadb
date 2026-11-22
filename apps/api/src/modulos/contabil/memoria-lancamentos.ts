// Lançamentos, períodos e conciliações da porta em MEMÓRIA (M54-F2): a sessão sintética de dev/ci (E2E). As mesmas
// recusas do banco (período encerrado, chave repetida devolve o mesmo lançamento, segundo estorno, partida já
// conciliada, conciliação desfeita) e as conferências do domínio chamadas como a gravação real as chama. Dados
// SINTÉTICOS; nada vai à cópia.
import type { SituacaoFato, TipoLancamento } from '@sgh/contratos';
import type {
  ConciliacaoRegistrada,
  PedidoConciliacao,
  DadosDoEncerramento,
  PedidoDesfazerConciliacao,
  PedidoEncerramento,
  FatoRegistrado,
  FiltroLancamentosPorta,
  FiltroRazaoPorta,
  LancamentoRegistrado,
  LancamentoParaGravar,
  PartidaRegistrada,
  PartidaPendente,
  PeriodoRegistrado,
  PedidoReabertura,
} from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import type { RazaoLido } from './porta.js';

type SemHospital<T> = Omit<T, 'hospital'>;
type LancamentoMem = LancamentoRegistrado & { partidas: PartidaRegistrada[] };

const recusa = (codigo: string, detalhe: string) =>
  new ErroProblema('recusa-de-negocio', 409, 'Não foi possível gravar', detalhe, { codigo });
const agora = () => new Date().toISOString().slice(0, 19);
const mesAno = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
const anterior = (c: string) => {
  const a = Number(c.slice(0, 4));
  const m = Number(c.slice(5, 7));
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};

export class LancamentosMemoria {
  constructor(
    readonly lancs: LancamentoMem[] = [],
    readonly periodosMem: PeriodoRegistrado[] = [],
    readonly conciliacoesMem: ConciliacaoRegistrada[] = [],
    readonly itensConciliacao: { conciliacao: number; partida: number; ativa: boolean }[] = [],
    private seq = 0,
  ) {}

  clonar(): LancamentosMemoria {
    return new LancamentosMemoria(
      this.lancs.map((l) => ({ ...l, partidas: l.partidas.map((p) => ({ ...p })) })),
      this.periodosMem.map((p) => ({ ...p })),
      this.conciliacoesMem.map((c) => ({ ...c })),
      this.itensConciliacao.map((i) => ({ ...i })),
      this.seq,
    );
  }

  substituir(o: LancamentosMemoria): void {
    this.lancs.splice(0, this.lancs.length, ...o.lancs);
    this.periodosMem.splice(0, this.periodosMem.length, ...o.periodosMem);
    this.conciliacoesMem.splice(0, this.conciliacoesMem.length, ...o.conciliacoesMem);
    this.itensConciliacao.splice(0, this.itensConciliacao.length, ...o.itensConciliacao);
    this.seq = o.seq;
  }

  // ── leituras ──

  private conciliacaoDa(partida: number): number | null {
    return this.itensConciliacao.find((i) => i.partida === partida && i.ativa)?.conciliacao ?? null;
  }

  private comEstorno(l: LancamentoMem): LancamentoMem {
    const e = this.lancs.find((x) => x.estornaId === l.id);
    return {
      ...l,
      estornadoPor: e?.id ?? null,
      partidas: l.partidas.map((p) => ({ ...p, conciliacao: this.conciliacaoDa(p.id) })),
    };
  }

  periodos(empresa: number): PeriodoRegistrado[] {
    return this.periodosMem
      .filter((p) => p.empresa === empresa)
      .sort((a, b) => a.competencia.localeCompare(b.competencia))
      .map((p) => ({ ...p }));
  }

  movimentoPorCompetencia(empresa: number) {
    const por = new Map<
      string,
      { competencia: string; lancamentos: number; debitos: number; creditos: number }
    >();
    for (const l of this.lancs.filter((x) => x.empresa === empresa)) {
      const x = por.get(l.competencia) ?? {
        competencia: l.competencia,
        lancamentos: 0,
        debitos: 0,
        creditos: 0,
      };
      x.lancamentos += 1;
      x.debitos += l.debitos;
      x.creditos += l.creditos;
      por.set(l.competencia, x);
    }
    return [...por.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
  }

  totaisDoPeriodo(empresa: number, competencia: string) {
    const por = new Map<
      TipoLancamento,
      { tipo: TipoLancamento; lancamentos: number; debitos: number; creditos: number }
    >();
    for (const l of this.lancs.filter((x) => x.empresa === empresa && x.competencia === competencia)) {
      const x = por.get(l.tipo) ?? { tipo: l.tipo, lancamentos: 0, debitos: 0, creditos: 0 };
      x.lancamentos += 1;
      x.debitos += l.debitos;
      x.creditos += l.creditos;
      por.set(l.tipo, x);
    }
    return [...por.values()].sort((a, b) => a.tipo.localeCompare(b.tipo));
  }

  lancamentos(f: FiltroLancamentosPorta, pagina: number, tamanho: number) {
    const todos = this.lancs
      .filter(
        (l) =>
          l.empresa === f.empresa &&
          (f.competencia === undefined || l.competencia === f.competencia) &&
          (f.tipo === undefined || l.tipo === f.tipo) &&
          (f.conta === undefined || l.partidas.some((p) => p.conta === f.conta)),
      )
      .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
    const ini = (Math.max(1, pagina) - 1) * tamanho;
    return {
      itens: todos.slice(ini, ini + tamanho).map((l) => {
        const { partidas: _p, ...cab } = this.comEstorno(l);
        void _p;
        return cab;
      }),
      total: todos.length,
    };
  }

  lancamento(id: number): LancamentoMem | null {
    const l = this.lancs.find((x) => x.id === id);
    return l ? this.comEstorno(l) : null;
  }

  lancamentosDosFatos(ids: readonly number[]) {
    const r = new Map<
      number,
      { id: number; idFato: number; partidas: PartidaRegistrada[]; estornadoPor: number | null }
    >();
    for (const l of this.lancs)
      if (l.fatoId !== null && ids.includes(l.fatoId)) {
        const c = this.comEstorno(l);
        r.set(l.fatoId, { id: l.id, idFato: l.fatoId, partidas: c.partidas, estornadoPor: c.estornadoPor });
      }
    return r;
  }

  private partidasDa(empresa: number, conta: string) {
    return this.lancs
      .filter((l) => l.empresa === empresa)
      .flatMap((l) => l.partidas.filter((p) => p.conta === conta).map((p) => ({ l, p })));
  }

  razao(f: FiltroRazaoPorta, teto: number, pagina = 1): RazaoLido {
    const todas = this.partidasDa(f.empresa, f.conta).filter(
      ({ p }) => f.centroCusto === undefined || p.centroCusto === f.centroCusto,
    );
    const soma = (xs: typeof todas) => ({
      debitos: xs.filter(({ p }) => p.lado === 'D').reduce((s, { p }) => s + p.valorCentavos, 0),
      creditos: xs.filter(({ p }) => p.lado === 'C').reduce((s, { p }) => s + p.valorCentavos, 0),
    });
    const intervalo = todas
      .filter(({ l }) => l.data >= f.de && l.data <= f.ate)
      .sort((a, b) => a.l.data.localeCompare(b.l.data) || a.l.id - b.l.id || a.p.ordem - b.p.ordem);
    const pular = (Math.max(1, pagina) - 1) * teto;
    return {
      anterior: soma(todas.filter(({ l }) => l.data < f.de)),
      totais: soma(intervalo),
      antesDaPagina: soma(intervalo.slice(0, pular)),
      movimentos: intervalo.slice(pular, pular + teto + 1).map(({ l, p }) => ({
        lancamento: l.id,
        partida: p.id,
        data: l.data,
        tipo: l.tipo,
        historico: p.historico,
        centroCusto: p.centroCusto,
        lado: p.lado,
        valorCentavos: p.valorCentavos,
        conciliado: this.conciliacaoDa(p.id) !== null,
      })),
    };
  }

  pendentesConciliacao(empresa: number, conta: string, ate: string | null, teto: number): PartidaPendente[] {
    return this.partidasDa(empresa, conta)
      .filter(({ l, p }) => (!ate || l.data <= ate) && this.conciliacaoDa(p.id) === null)
      .sort((a, b) => a.l.data.localeCompare(b.l.data) || a.p.id - b.p.id)
      .slice(0, teto + 1)
      .map(({ l, p }) => ({
        id: p.id,
        lancamento: l.id,
        data: l.data,
        lado: p.lado,
        valorCentavos: p.valorCentavos,
        historico: p.historico,
        centroCusto: p.centroCusto,
      }));
  }

  conciliacoes(empresa: number, conta: string, teto: number): ConciliacaoRegistrada[] {
    return this.conciliacoesMem
      .filter((c) => c.empresa === empresa && c.conta === conta)
      .sort((a, b) => b.id - a.id)
      .slice(0, teto)
      .map((c) => ({ ...c }));
  }

  // ── gravações (dentro da "transação": o chamador clona antes e substitui no fim) ──

  private periodo(empresa: number, competencia: string): PeriodoRegistrado {
    let p = this.periodosMem.find((x) => x.empresa === empresa && x.competencia === competencia);
    if (!p) {
      p = {
        empresa,
        competencia,
        situacao: 'aberto',
        lancamentos: 0,
        debitos: 0,
        creditos: 0,
        observacao: null,
        encerradoPor: null,
        encerradoEm: null,
        reabertoPor: null,
        reabertoEm: null,
        versao: 0,
      };
      this.periodosMem.push(p);
    }
    return p;
  }

  private trocarPeriodo(p: PeriodoRegistrado, novo: Partial<PeriodoRegistrado>): void {
    const i = this.periodosMem.indexOf(p);
    this.periodosMem[i] = { ...p, ...novo, versao: p.versao + 1 };
  }

  gravarLancamento(l: LancamentoParaGravar, usuario: string): { id: number; repetido: boolean } {
    const d = l.partidas.filter((p) => p.lado === 'D').reduce((s, p) => s + p.valorCentavos, 0);
    const c = l.partidas.filter((p) => p.lado === 'C').reduce((s, p) => s + p.valorCentavos, 0);
    if (d !== c || d <= 0)
      throw recusa(
        'lancamento-desequilibrado',
        `Débitos (${d}) diferentes dos créditos (${c}): nada foi gravado.`,
      );
    const ja = this.lancs.find((x) => x.chave === l.chave);
    if (ja) return { id: ja.id, repetido: true };
    if (this.periodo(l.empresa, l.competencia).situacao === 'encerrado')
      throw recusa(
        'periodo-encerrado',
        `O período ${mesAno(l.competencia)} está encerrado: nenhum lançamento entra nele. Lance num período aberto.`,
      );
    if (l.estornaId !== null && this.lancs.some((x) => x.estornaId === l.estornaId))
      throw recusa('ja-estornado', 'Este lançamento acabou de ser estornado por outra pessoa.');
    const id = ++this.seq;
    this.lancs.push({
      id,
      empresa: l.empresa,
      chave: l.chave,
      tipo: l.tipo,
      data: l.data,
      competencia: l.competencia,
      historico: l.historico,
      debitos: d,
      creditos: c,
      fatoId: l.fatoId,
      regraId: l.regraId,
      regra: l.regra,
      estornaId: l.estornaId,
      estornadoPor: null,
      justificativa: l.justificativa,
      criadoPor: usuario,
      criadoEm: agora(),
      fato: null,
      partidas: l.partidas.map((p, i) => ({
        ...p,
        id: id * 100 + i + 1,
        lancamento: id,
        ordem: i + 1,
        conciliacao: null,
      })),
    });
    return { id, repetido: false };
  }

  encerrarPeriodo(x: SemHospital<PedidoEncerramento>, fatos: readonly FatoRegistrado[]): DadosDoEncerramento {
    const periodo = this.periodo(x.empresa, x.competencia);
    const porSituacao: Partial<Record<SituacaoFato, number>> = {};
    for (const f of fatos.filter((y) => y.empresa === x.empresa && y.competencia === x.competencia))
      porSituacao[f.situacao] = (porSituacao[f.situacao] ?? 0) + 1;
    const tipos = this.totaisDoPeriodo(x.empresa, x.competencia);
    const ant = anterior(x.competencia);
    const pa = this.periodosMem.find((p) => p.empresa === x.empresa && p.competencia === ant);
    const movimentoAnterior =
      this.lancs.some((l) => l.empresa === x.empresa && l.competencia === ant) ||
      fatos.some((f) => f.empresa === x.empresa && f.competencia === ant);
    const dados: DadosDoEncerramento = {
      periodo: { ...periodo },
      fatos: porSituacao,
      lancamentos: tipos.reduce((s, t) => s + t.lancamentos, 0),
      debitos: tipos.reduce((s, t) => s + t.debitos, 0),
      creditos: tipos.reduce((s, t) => s + t.creditos, 0),
      anteriorAbertaComMovimento: pa?.situacao !== 'encerrado' && movimentoAnterior ? ant : null,
    };
    const impedimentos = x.conferir(dados);
    if (impedimentos.length)
      throw recusa('encerramento-impedido', impedimentos.map((i) => i.mensagem).join(' '));
    this.trocarPeriodo(periodo, {
      situacao: 'encerrado',
      lancamentos: dados.lancamentos,
      debitos: dados.debitos,
      creditos: dados.creditos,
      observacao: x.observacao,
      encerradoPor: x.usuario,
      encerradoEm: agora(),
    });
    return dados;
  }

  reabrirPeriodo(x: SemHospital<PedidoReabertura>): PeriodoRegistrado {
    const periodo = this.periodo(x.empresa, x.competencia);
    const motivo = x.conferir(this.periodos(x.empresa));
    if (motivo) throw recusa('reabertura-recusada', motivo);
    this.trocarPeriodo(periodo, { situacao: 'aberto', reabertoPor: x.usuario, reabertoEm: agora() });
    return { ...periodo };
  }

  conciliar(x: SemHospital<PedidoConciliacao>): { id: number; valor: number } {
    const todas = this.lancs.flatMap((l) => l.partidas.map((p) => ({ l, p })));
    const achadas = [...new Set(x.partidas)]
      .map((id) => todas.find(({ p }) => p.id === id))
      .filter((y): y is (typeof todas)[number] => !!y)
      .map(({ l, p }) => ({
        id: p.id,
        empresa: l.empresa,
        conta: p.conta,
        lado: p.lado,
        valorCentavos: p.valorCentavos,
        conciliacao: this.conciliacaoDa(p.id),
      }));
    const problemas = x.conferir(achadas);
    if (problemas.length) throw recusa('conciliacao-recusada', problemas.join(' '));
    const id = ++this.seq;
    const valor = achadas.filter((p) => p.lado === 'D').reduce((s, p) => s + p.valorCentavos, 0);
    this.conciliacoesMem.push({
      id,
      empresa: x.empresa,
      conta: x.conta,
      situacao: 'ativa',
      partidas: achadas.length,
      valorCentavos: valor,
      observacao: x.observacao,
      criadaPor: x.usuario,
      criadaEm: agora(),
      desfeitaPor: null,
      desfeitaEm: null,
    });
    for (const p of achadas) this.itensConciliacao.push({ conciliacao: id, partida: p.id, ativa: true });
    return { id, valor };
  }

  desfazerConciliacao(x: SemHospital<PedidoDesfazerConciliacao>): ConciliacaoRegistrada {
    const i = this.conciliacoesMem.findIndex((c) => c.id === x.id && c.empresa === x.empresa);
    if (i < 0) throw recusa('conciliacao-inexistente', 'Conciliação não encontrada.');
    const c = this.conciliacoesMem[i]!;
    if (c.situacao !== 'ativa') throw recusa('conciliacao-desfeita', 'Esta conciliação já foi desfeita.');
    this.conciliacoesMem[i] = { ...c, situacao: 'desfeita', desfeitaPor: x.usuario, desfeitaEm: agora() };
    for (const it of this.itensConciliacao) if (it.conciliacao === x.id) it.ativa = false;
    return { ...c };
  }
}
