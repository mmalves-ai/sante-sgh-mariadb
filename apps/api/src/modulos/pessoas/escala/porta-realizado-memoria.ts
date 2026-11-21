// Porta do plantão realizado em memória (M52.6): a sessão sintética de dev/ci e o E2E. Os plantões vêm da escala em
// memória (só as publicadas) e o colaborador da gestão de pessoas em memória; o realizado e as tarifas vivem por
// estabelecimento, numa cópia por transação. O lançamento no repasse é simulado com as mesmas recusas da receita
// (aprovado, com valor, ainda não lançado, do prestador, na competência, a soma igual ao valor). Nada vai à cópia.
import {
  type RegistroPlantaoParaRealizado,
  type RegistroRealizado,
  type RegistroTarifaPlantao,
} from './tipos.js';
import { ErroOperacao, type LinhaTrilha } from '@sgh/nucleo';
import { VINCULOS_PRESTADOR } from '@sgh/contratos';
import type { GravacaoFeita } from '../../exames/public-api.js';
import type { PortaPessoas } from '../porta.js';
import type { PortaEscala } from './porta-escala.js';
import { chaveDe, PortaEscalaMemoria } from './porta-escala-memoria.js';
import type { ContextoRealizado, GravadorRealizado, PortaRealizado } from './porta-realizado.js';

const recusa = (codigo: string, mensagem: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', mensagem);
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

interface Estado {
  seq: number;
  realizados: RegistroRealizado[];
  tarifas: RegistroTarifaPlantao[];
  lancamentos: number;
}
const novo = (): Estado => ({ seq: 5270, realizados: [], tarifas: [], lancamentos: 99_000 });
const copiar = (s: Estado): Estado => ({
  seq: s.seq,
  realizados: s.realizados.map((x) => ({ ...x })),
  tarifas: s.tarifas.map((x) => ({ ...x })),
  lancamentos: s.lancamentos,
});

const p2 = (x: number) => String(x).padStart(2, '0');
const local = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const centavos = (v: number) => Math.round(v * 100);
/** As competências (AAAA-MM) que a janela [de, ate) toca. */
function competencias(de: string, ate: string): string[] {
  const r: string[] = [];
  let [a, m] = de.slice(0, 7).split('-').map(Number) as [number, number];
  const fim = ate.slice(0, 7);
  for (let i = 0; i < 24; i++) {
    const c = `${a}-${p2(m)}`;
    if (c > fim) break;
    r.push(c);
    if (m === 12) {
      a += 1;
      m = 1;
    } else m += 1;
  }
  return r;
}

export class PortaRealizadoMemoria implements PortaRealizado {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** Testes: o relógio sintético. */
  agoraFixo: string | null = null;
  /** Testes: os lançamentos simulados no repasse (entrada da receita). */
  readonly lancados: Record<string, unknown>[] = [];
  /** W0-06, testes e E2E: as apurações do repasse por competência (empresa 1); vazio = nenhuma apurada. */
  readonly apuracoes = new Map<string, { id: number; estado: string }>();

  constructor(
    private readonly escala: PortaEscala | null = null,
    private readonly pessoas: PortaPessoas | null = null,
  ) {
    // W0-06: o realizado é vínculo do plantão no mapa de dependências (a exclusão do rascunho da escala recusa).
    if (escala instanceof PortaEscalaMemoria)
      escala.realizadosDosPlantoes = (h, ids) =>
        (this.estados.get(h)?.realizados ?? []).filter((r) => ids.includes(r.plantao)).length;
  }

  private e(c: ContextoRealizado): Estado {
    let s = this.estados.get(chaveDe(c));
    if (!s) this.estados.set(chaveDe(c), (s = novo()));
    return s;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoRealizado, op: string, entrada: unknown): Promise<GravacaoFeita> {
    if (op !== 'repasse.lancarEvento')
      throw new ErroOperacao(
        409,
        'operacao-desconhecida',
        'Operação recusada',
        `Operação ${op} não simulada.`,
      );
    const x = entrada as {
      origem: string;
      plantoes: number[];
      valor: number;
      competencia: string;
      profissional: number;
      estornaDe: number | null;
    };
    if (x.origem === 'estorno') return this.estornoSimulado(c, x);
    const s = copiar(this.e(c));
    const rs = x.plantoes.map((id) => s.realizados.find((r) => r.id === id));
    if (rs.some((r) => !r))
      throw recusa('plantao-inexistente', 'Um dos plantões realizados não existe neste estabelecimento.');
    const ps = await this.plantoesPorIds(
      c,
      rs.map((r) => r!.plantao),
    );
    for (const r of rs) {
      if (r!.situacao !== 'aprovado' || r!.lancamento !== null || r!.valor === null)
        throw recusa(
          'plantao-nao-lancavel',
          'Um dos plantões realizados não está aprovado, está sem valor ou já foi lançado.',
        );
      const p = ps.find((y) => y.plantao === r!.plantao);
      if (!p || !VINCULOS_PRESTADOR.includes(p.tipoVinculo as never) || p.registro !== x.profissional)
        throw recusa(
          'plantao-de-outro-prestador',
          'Um dos plantões é de outro profissional ou de vínculo que não é de prestador.',
        );
      if (r!.inicio.slice(0, 7) !== x.competencia)
        throw recusa('plantao-fora-da-competencia', 'Um dos plantões realizados começa fora da competência.');
    }
    if (centavos(rs.reduce((t, r) => t + (r!.valor ?? 0), 0)) !== centavos(x.valor))
      throw recusa('valor-diferente-dos-plantoes', 'O valor não é a soma dos plantões realizados.');
    const lancamento = ++s.lancamentos;
    for (const r of rs) Object.assign(r!, { lancamento, lancadoPor: 'memoria' });
    this.estados.set(chaveDe(c), s);
    this.lancados.push(x as unknown as Record<string, unknown>);
    return { resultado: { lancamento, valor: x.valor }, repetida: false, trilha: null };
  }

  /** W0-06: o lançamento negativo simulado com as recusas da receita (original existe, negativo, competência posterior). */
  private estornoSimulado(
    c: ContextoRealizado,
    x: { valor: number; competencia: string; estornaDe: number | null },
  ): GravacaoFeita {
    const s = copiar(this.e(c));
    const originais = s.realizados.filter((r) => r.lancamento === x.estornaDe);
    if (originais.length === 0) throw recusa('original-inexistente', 'O lançamento original não existe.');
    if (!(x.valor < 0)) throw recusa('original-negativo', 'O estorno é negativo.');
    if (originais.some((r) => r.inicio.slice(0, 7) >= x.competencia))
      throw recusa(
        'estorno-fora-do-periodo',
        'O estorno entra numa competência posterior à do lançamento original.',
      );
    const lancamento = ++s.lancamentos;
    this.estados.set(chaveDe(c), s);
    this.lancados.push({ ...(x as unknown as Record<string, unknown>), lancamento });
    return { resultado: { lancamento, valor: x.valor }, repetida: false, trilha: null };
  }

  async gravarSgh<T>(
    c: ContextoRealizado,
    _trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorRealizado) => Promise<T>,
  ): Promise<T> {
    const s = copiar(this.e(c));
    const id = () => ++s.seq;
    const { agora } = await this.relogio();
    const g: GravadorRealizado = {
      plantao: (i) => this.plantao(c, i),
      realizadosDoPlantao: async (p) => s.realizados.filter((r) => r.plantao === p),
      realizadosDaPessoa: async (pessoa, de, ate) =>
        s.realizados.filter(
          (r) =>
            r.pessoa === pessoa &&
            r.inicio >= de &&
            r.inicio < ate &&
            (r.situacao === 'informado' || r.situacao === 'aprovado'),
        ),
      realizado: async (i) => s.realizados.find((r) => r.id === i) ?? null,
      tarifas: async () => s.tarifas,
      incluirRealizado: async (r) => {
        for (const x of s.realizados)
          if (x.plantao === r.plantao && (x.situacao === 'informado' || x.situacao === 'recusado'))
            Object.assign(x, { situacao: 'substituido', versao: x.versao + 1 });
        const p = await this.plantao(c, r.plantao);
        const n = id();
        s.realizados.push({
          id: n,
          plantao: r.plantao,
          vinculo: r.vinculo,
          pessoa: p?.pessoa ?? 0,
          inicio: r.inicio,
          fim: r.fim,
          minutos: r.minutos,
          origem: r.origem,
          observacao: r.observacao,
          situacao: 'informado',
          informadoPor: r.por,
          informadoEm: agora,
          decididoPor: null,
          decididoEm: null,
          motivo: null,
          tarifa: null,
          valorHora: null,
          valor: null,
          lancamento: null,
          lancadoPor: null,
          versao: 0,
        });
        return n;
      },
      decidirRealizado: async (d) => {
        const r = s.realizados.find((x) => x.id === d.id);
        if (!r || r.versao !== d.versao || r.situacao !== 'informado') throw desatualizado();
        if (r.informadoPor.toUpperCase() === d.por.toUpperCase())
          throw recusa('quatro-olhos', 'Quem registrou o realizado não o aprova.');
        Object.assign(r, {
          situacao: d.situacao,
          motivo: d.motivo,
          decididoPor: d.por,
          decididoEm: agora,
          tarifa: d.tarifa,
          valorHora: d.valorHora,
          valor: d.valor,
          versao: r.versao + 1,
        });
      },
      incluirTarifa: async (t) => {
        const n = id();
        s.tarifas.push({
          id: n,
          tipo: t.tipo,
          unidade: t.unidade,
          inicio: t.inicio,
          fim: t.fim,
          valorHora: t.valorHora,
          criadoPor: t.por,
        });
        return n;
      },
      encerrarTarifa: async (t) => {
        const i = s.tarifas.findIndex((y) => y.id === t.id);
        const x = s.tarifas[i];
        if (!x || t.fim < x.inicio || (x.fim !== null && t.fim > x.fim))
          throw recusa('vigencia-invalida', 'O fim fica antes do início da tarifa ou depois do fim atual.');
        s.tarifas[i] = { ...x, fim: t.fim };
      },
      realizadosSemValor: async (de, ate) =>
        s.realizados.filter(
          (r) =>
            r.situacao === 'aprovado' &&
            r.valor === null &&
            r.lancamento === null &&
            r.inicio.slice(0, 10) >= de &&
            (ate === null || r.inicio.slice(0, 10) <= ate),
        ),
      plantoesPorIds: (ids) => this.plantoesPorIds(c, ids),
      valorarRealizado: async (v) => {
        const r = s.realizados.find((x) => x.id === v.id);
        if (!r || r.situacao !== 'aprovado' || r.valor !== null || r.lancamento !== null) return false;
        Object.assign(r, { tarifa: v.tarifa, valorHora: v.valorHora, valor: v.valor, versao: r.versao + 1 });
        return true;
      },
      apuracaoRepasse: async (comp) => this.apuracoes.get(comp) ?? null,
      estornarRealizado: async (x) => {
        const r = s.realizados.find((y) => y.id === x.id);
        if (!r || r.versao !== x.versao || r.situacao !== 'aprovado') throw desatualizado();
        Object.assign(r, {
          situacao: 'estornado',
          estorno: { por: x.por, em: agora, motivo: x.motivo, lancamento: null },
          versao: r.versao + 1,
        });
      },
      ligarEstorno: async (x) => {
        const r = s.realizados.find((y) => y.id === x.id);
        if (!r || r.situacao !== 'estornado' || r.lancamento === null || r.estorno?.lancamento)
          throw desatualizado();
        Object.assign(r, { estorno: { ...r.estorno!, lancamento: x.lancamento }, versao: r.versao + 1 });
      },
      desfazerEstorno: async (i) => {
        const r = s.realizados.find((y) => y.id === i);
        if (!r || r.situacao !== 'estornado' || r.estorno?.lancamento) throw desatualizado();
        Object.assign(r, { situacao: 'aprovado', estorno: null, versao: r.versao + 1 });
      },
      estornoLancado: async (x) => {
        const ligados = new Set(s.realizados.map((r) => r.estorno?.lancamento ?? null));
        const achado = this.lancados.find(
          (l) =>
            l['origem'] === 'estorno' &&
            l['estornaDe'] === x.original &&
            String(l['justificativa'] ?? '').startsWith(`Estorno do plantão realizado ${x.id} (`) &&
            !ligados.has(Number(l['lancamento'])),
        );
        return achado ? Number(achado['lancamento']) : null;
      },
    };
    const r = await fn(g);
    this.estados.set(chaveDe(c), s);
    return r;
  }

  async relogio(): Promise<{ hoje: string; agora: string }> {
    const agora = this.agoraFixo ?? local(new Date());
    return { hoje: agora.slice(0, 10), agora };
  }

  private async todosPlantoes(c: ContextoRealizado, cs: readonly string[], unidade?: number) {
    if (!this.escala) return [];
    const r: RegistroPlantaoParaRealizado[] = [];
    for (const competencia of cs) {
      const es = await this.escala.escalas(c, {
        competencia,
        estado: 'publicada',
        ...(unidade !== undefined ? { unidade } : {}),
      });
      for (const e of es)
        for (const p of await this.escala.plantoesDaEscala(c, e.id)) {
          const v = this.pessoas ? await this.pessoas.vinculo(c, p.vinculo) : null;
          r.push({
            plantao: p.id,
            escala: e.id,
            estadoEscala: e.estado,
            unidade: e.unidade,
            vinculo: p.vinculo,
            pessoa: p.pessoa,
            nome: v?.nome ?? `Vínculo ${p.vinculo}`,
            tipoVinculo: v?.tipo ?? 'clt',
            usuario: v?.usuario ?? null,
            registro: p.registro,
            tipo: p.tipo,
            inicio: p.inicio,
            fim: p.fim,
            situacao: p.situacao,
          });
        }
    }
    return r;
  }

  async plantoes(c: ContextoRealizado, f: { de: string; ate: string; unidade?: number }) {
    return (await this.todosPlantoes(c, competencias(f.de, f.ate), f.unidade))
      .filter((p) => p.situacao === 'previsto' && p.inicio >= f.de && p.inicio < f.ate)
      .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.plantao - b.plantao);
  }
  async plantao(c: ContextoRealizado, id: number) {
    if (!this.escala) return null;
    const p = await this.escala.plantao(c, id);
    if (!p) return null;
    const e = await this.escala.escala(c, p.escala);
    const v = this.pessoas ? await this.pessoas.vinculo(c, p.vinculo) : null;
    return e
      ? {
          plantao: p.id,
          escala: e.id,
          estadoEscala: e.estado,
          unidade: e.unidade,
          vinculo: p.vinculo,
          pessoa: p.pessoa,
          nome: v?.nome ?? `Vínculo ${p.vinculo}`,
          tipoVinculo: v?.tipo ?? 'clt',
          usuario: v?.usuario ?? null,
          registro: p.registro,
          tipo: p.tipo,
          inicio: p.inicio,
          fim: p.fim,
          situacao: p.situacao,
        }
      : null;
  }
  async plantoesPorIds(c: ContextoRealizado, ids: readonly number[]) {
    const r: RegistroPlantaoParaRealizado[] = [];
    for (const id of new Set(ids)) {
      const p = await this.plantao(c, id);
      if (p) r.push(p);
    }
    return r;
  }
  async realizadosDosPlantoes(c: ContextoRealizado, ps: readonly number[]) {
    return this.e(c).realizados.filter((r) => ps.includes(r.plantao));
  }
  async realizadosAprovados(c: ContextoRealizado, de: string, ate: string) {
    return this.e(c).realizados.filter((r) => r.situacao === 'aprovado' && r.inicio >= de && r.inicio < ate);
  }
  async realizado(c: ContextoRealizado, id: number) {
    return this.e(c).realizados.find((r) => r.id === id) ?? null;
  }
  async tarifas(c: ContextoRealizado) {
    return this.e(c).tarifas;
  }
  /** Os registros sintéticos: o código de prestador é o próprio registro + 9000 (nenhum dado real). */
  async codigosDosRegistros(_c: ContextoRealizado, rs: readonly number[]) {
    return new Map(rs.map((r) => [r, r + 9000]));
  }
  async apuracaoRepasse(_c: ContextoRealizado, competencia: string) {
    return this.apuracoes.get(competencia) ?? null;
  }
}
