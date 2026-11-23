// Porta do repasse em MEMÓRIA (M33): a sessão sintética de dev/ci (E2E). Regras, produção, lançamentos e RPAs
// SINTÉTICOS (médicos 7001 e 7002, convênios 301 e 302, eventos 40 e 41), com as mesmas validações (o Zod dos contratos
// pela receita) e as mesmas recusas das receitas (já em RPA, estorno que passa do original, apuração não aprovada,
// período apurado no outro sistema). O título do RPA vai ao financeiro em memória (o contas a pagar o mostra). Nada vai
// à cópia nem ao banco.
import type { ItemProducao, RegraRepasse } from '@sgh/contratos';
import {
  type ContextoOperacao,
  ErroOperacao,
  type LinhaTrilha,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import { ENTRADAS_OPERACAO_REPASSE } from './operacoes.js';
import type {
  ApuracaoRepasseRegistrada,
  LancamentoRepasseRegistrado,
  MemoriaCalculoRegistrada,
  PrestadorRepasse,
  RpaDetalhe,
  RpaRegistrado,
  VersaoRegraRegistrada,
} from './tipos.js';
import type {
  BasesIndicadoresRepassePorta,
  ContextoRepasse,
  FiltroRegrasPorta,
  GravadorRepasse,
  OpcaoPorta,
  PortaRepasse,
} from './porta.js';

/** Chave do estabelecimento da sessão no estado em memória (o id; sem ele, o código da sessão). */
const chaveEstabelecimento = (c: ContextoRepasse) =>
  String(c.estabelecimento ?? (c as ContextoRepasse & { hospital?: string }).hospital ?? '');

/** Estado de cada operação por estabelecimento (verde, bloqueada); sem ele, todas liberadas. */
export interface EstadoOperacoesRepasse {
  estado(operacao: string, estabelecimento: string): string | null;
}

/** O financeiro em memória que recebe o título do RPA (o M32 em memória). */
export interface TituloRepasseMemoria {
  incluirTituloRepasse(
    c: ContextoRepasse,
    t: {
      credor: number;
      documento: number;
      tipo: 'M' | 'E';
      emissao: string;
      vencimento: string;
      valor: number;
      profissional: number | null;
      usuario: string;
    },
  ): number;
}

/** Médicos sintéticos: o código do prestador → o id do profissional. */
const REGISTROS: Readonly<Record<number, number>> = { 7001: 17001, 7002: 17002 };
/** Os nomes SINTÉTICOS da busca de médicos (nenhuma pessoa real). */
const NOMES: Readonly<Record<number, string>> = { 7001: 'MEDICO SINTETICO A', 7002: 'MEDICO SINTETICO B' };
/** O vínculo usuário → profissional da sessão sintética (regra 12: o extrato do próprio médico). */
const VINCULOS: Readonly<Record<string, readonly number[]>> = { 'SINT.REP.MEDICO': [7001] };
/** Competência que o outro sistema já apurou na sessão sintética (regra 10). */
const COMPETENCIA_DO_OUTRO_SISTEMA = '2026-06';

const p2 = (n: number) => String(n).padStart(2, '0');
const hojeUtc = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
};
const centavos = (v: number) => Math.round(v * 100);
const semCompetencia = (l: LancamentoRepasseRegistrado): LancamentoRepasseRegistrado => ({
  id: l.id,
  tipo: l.tipo,
  prestador: l.prestador,
  data: l.data,
  evento: l.evento,
  valor: l.valor,
  origem: l.origem,
  emRpa: l.emRpa,
  registro: l.registro,
});

function regra(
  id: number,
  parcial: Partial<RegraRepasse> & Pick<RegraRepasse, 'convenio' | 'percentual' | 'valorFixo'>,
): RegraRepasse {
  return {
    id,
    vigencia: '2024-01-01',
    beneficiario: 'M',
    profissional: null,
    prestador: null,
    procedimentoInicial: null,
    procedimentoFinal: null,
    especialidade: null,
    ato: null,
    grupoAto: null,
    local: null,
    unidade: null,
    centroCusto: null,
    cooperativa: null,
    tipoLancamento: null,
    tipoConta: 'A',
    horaInicial: '00:00',
    horaFinal: '23:59',
    percentualFeriado: 0,
    percentualFimDeSemana: 0,
    base: null,
    evento: 40,
    ...parcial,
  };
}

interface Estado {
  seq: number;
  regras: RegraRepasse[];
  versoes: Map<number, VersaoRegraRegistrada>;
  apuracoes: Map<number, ApuracaoRepasseRegistrada>;
  memorias: Map<number, MemoriaCalculoRegistrada[]>;
  lancamentos: Map<number, LancamentoRepasseRegistrado & { competencia: string }>;
  estornos: Map<number, { original: number; valor: number }>;
  rpas: Map<
    number,
    RpaRegistrado & {
      valor: number;
      titulo: number | null;
      lancamentosIds: number[];
      retencoes: RpaDetalhe['retencoes'];
      vencimento: string | null;
    }
  >;
  /** Apuração:prestador já lançado (a receita recusa ja-lancado). */
  lancadosDaApuracao: Set<string>;
  integrados: Set<number>;
  usadas: Set<number>;
  idem: Map<string, { hash: string; resultado: ResultadoOperacao }>;
}

export class PortaRepasseMemoria implements PortaRepasse {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(
    private readonly catalogo: EstadoOperacoesRepasse | null,
    private readonly financeiro: TituloRepasseMemoria | null = null,
  ) {}

  private e(c: ContextoRepasse): Estado {
    let s = this.estados.get(chaveEstabelecimento(c));
    if (!s) {
      s = this.semear();
      this.estados.set(chaveEstabelecimento(c), s);
    }
    return s;
  }

  private semear(): Estado {
    const s: Estado = {
      seq: 100,
      regras: [
        regra(9001, { convenio: 301, profissional: 7001, prestador: 7001, percentual: 18.5, valorFixo: 0 }),
        regra(9002, { convenio: 301, percentual: 10, valorFixo: 0 }),
        regra(9003, { convenio: 302, profissional: 7002, prestador: 7002, percentual: 0, valorFixo: 50 }),
      ],
      versoes: new Map(),
      apuracoes: new Map(),
      memorias: new Map(),
      lancamentos: new Map(),
      estornos: new Map(),
      rpas: new Map(),
      integrados: new Set(),
      usadas: new Set([9002]),
      idem: new Map(),
      lancadosDaApuracao: new Set(),
    };
    // Um lançamento do médico 7001 em 2026-05, já pago por RPA (o extrato mostra; o estorno por glosa parte dele).
    s.lancamentos.set(51, {
      id: 51,
      tipo: 'M',
      prestador: 7001,
      data: '2026-05-15',
      evento: 40,
      valor: 925.5,
      origem: 'V',
      emRpa: 61,
      registro: 17001,
      competencia: '2026-05',
    });
    s.rpas.set(61, {
      id: 61,
      serie: 'RPA',
      numero: 5401,
      inicio: '2026-05-15',
      fim: '2026-05-31',
      emissao: '2026-05-31',
      tipo: 'M',
      prestador: 7001,
      situacao: 'G',
      lancamentos: 1,
      valor: 925.5,
      titulo: null,
      lancamentosIds: [51],
      retencoes: null,
      vencimento: null,
    });
    return s;
  }

  private estadoOp(op: string, hospital: string) {
    return this.catalogo?.estado(op, hospital) ?? 'verde';
  }

  async podeGravar(c: ContextoRepasse, op: string): Promise<LiberacaoGravacao> {
    const e = this.estadoOp(op, chaveEstabelecimento(c));
    if (e === null || e === 'bloqueada')
      return {
        pode: false,
        codigo: 'operacao-bloqueada',
        motivo: 'A gravação está bloqueada neste estabelecimento.',
      };
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoRepasse, op: string, bruto: unknown, ctx: ContextoOperacao) {
    const entrada = ENTRADAS_OPERACAO_REPASSE[op];
    if (!entrada) throw recusa('operacao-desconhecida', `Operação ${op} não existe no repasse.`);
    const a = entrada.safeParse(bruto);
    if (!a.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(a.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const s = this.e(c);
    const chave = `${op}:${ctx.chaveIdempotencia}`;
    const hash = JSON.stringify(a.data);
    const anterior = s.idem.get(chave);
    if (anterior) {
      if (anterior.hash !== hash)
        throw new ErroOperacao(
          422,
          'idempotencia-divergente',
          'Pedido repetido diferente',
          'A mesma chave veio com outro conteúdo.',
        );
      return { resultado: anterior.resultado, repetida: true, trilha: null };
    }
    const resultado = this.aplicar(c, s, op, a.data as Record<string, never>, String(ctx.usuario ?? ''));
    s.idem.set(chave, { hash, resultado });
    return { resultado, repetida: false, trilha: null };
  }

  private aplicar(
    c: ContextoRepasse,
    s: Estado,
    op: string,
    e: Record<string, never>,
    usuario: string,
  ): ResultadoOperacao {
    const x = e as Record<string, unknown>;
    switch (op) {
      case 'repasse.lancarEvento': {
        if (x['tipo'] !== 'M' || x['empresa'] !== 1)
          throw recusa('tipo-nao-suportado', 'O lançamento de empresa médica continua no outro sistema.');
        const prestador = Number(x['prestador']);
        if (REGISTROS[prestador] !== x['profissional'])
          throw recusa(
            'profissional-inexistente',
            'O registro do médico não confere com o código do prestador.',
          );
        if (x['origem'] === 'apuracao') {
          const ap = s.apuracoes.get(Number(x['apuracao']));
          if (!ap || ap.estado !== 'aprovada')
            throw recusa('apuracao-nao-aprovada', 'A apuração do período não está aprovada.');
          if (ap.simulacao)
            throw recusa(
              'apuracao-em-simulacao',
              'A apuração está em simulação: ela não gera lançamento, e o período continua sendo lançado no outro sistema.',
            );
          if (s.lancadosDaApuracao.has(`${ap.id}:${prestador}`))
            throw recusa('ja-lancado', 'O total do prestador nesta apuração já foi lançado.');
          const total = (s.memorias.get(ap.id) ?? [])
            .filter((m) => m.prestador === prestador && !m.pendencia)
            .reduce((t, m) => t + centavos(m.valor), 0);
          if (total !== centavos(Number(x['valor'])))
            throw recusa(
              'valor-diferente-da-apuracao',
              'O valor não é o total do prestador na apuração aprovada.',
            );
        }
        if (x['origem'] === 'estorno') {
          const o = s.lancamentos.get(Number(x['estornaDe']));
          if (!o) throw recusa('original-inexistente', 'O lançamento original não existe.');
          if (o.prestador !== prestador)
            throw recusa('original-de-outro-prestador', 'O lançamento original é de outro prestador.');
          if (String(x['competencia']) <= o.competencia)
            throw recusa(
              'estorno-fora-do-periodo',
              'O estorno entra numa competência posterior à do lançamento original.',
            );
          const ja = [...s.estornos.values()]
            .filter((v) => v.original === o.id)
            .reduce((t, v) => t + centavos(-v.valor), 0);
          if (ja + centavos(-Number(x['valor'])) > centavos(o.valor))
            throw recusa('ja-estornado', 'O estorno passa do valor do lançamento original.');
        }
        const id = ++s.seq;
        s.lancamentos.set(id, {
          id,
          tipo: 'M',
          prestador,
          data: String(x['data']),
          evento: Number(x['evento']),
          valor: Number(x['valor']),
          origem: 'V',
          emRpa: null,
          registro: Number(x['profissional']) || null,
          competencia: String(x['competencia']),
        });
        if (x['origem'] === 'apuracao') s.lancadosDaApuracao.add(`${Number(x['apuracao'])}:${prestador}`);
        if (x['origem'] === 'estorno')
          s.estornos.set(id, { original: Number(x['estornaDe']), valor: Number(x['valor']) });
        return { lancamento: id, prestador, valor: Number(x['valor']), origem: String(x['origem']) };
      }
      case 'repasse.emitirRpa': {
        const ids = [...new Set(x['lancamentos'] as number[])];
        const ls = ids.map((i) => s.lancamentos.get(i));
        if (ls.some((l) => !l)) throw recusa('lancamento-inexistente', 'Algum lançamento não existe mais.');
        if (ls.some((l) => l!.emRpa !== null))
          throw recusa('ja-em-rpa', 'Algum lançamento já está em um RPA: releia a lista.');
        if (ls.some((l) => l!.prestador !== x['prestador'] || l!.competencia !== x['competencia']))
          throw recusa(
            'lancamento-de-outro-prestador',
            'Os lançamentos têm de ser do prestador, da empresa e da competência.',
          );
        const r = x['retencoes'] as Record<string, number>;
        const bruto = ls.reduce((t, l) => t + centavos(l!.valor), 0);
        if (bruto !== centavos(r['bruto']!))
          throw recusa('bruto-diferente', 'O bruto do RPA não é a soma dos lançamentos: recalcule.');
        const id = ++s.seq;
        const numero = 5400 + id;
        const titulo =
          this.financeiro?.incluirTituloRepasse(c, {
            credor: Number(x['prestador']),
            documento: numero,
            tipo: 'M',
            emissao: String(x['emissao']),
            vencimento: String(x['vencimento']),
            valor: r['liquido']!,
            profissional: Number(x['profissional']),
            usuario,
          }) ?? null;
        s.rpas.set(id, {
          id,
          serie: 'RPA',
          numero,
          inicio: ls.map((l) => l!.data ?? '').sort()[0] ?? null,
          fim: String(x['emissao']),
          emissao: String(x['emissao']),
          tipo: 'M',
          prestador: Number(x['prestador']),
          situacao: 'G',
          lancamentos: ids.length,
          valor: bruto / 100,
          titulo,
          lancamentosIds: ids,
          retencoes: {
            bruto: r['bruto']!,
            baseInss: r['baseInss']!,
            inss: r['inss']!,
            baseIrrf: r['baseIrrf']!,
            irrf: r['irrf']!,
            iss: r['iss']!,
            liquido: r['liquido']!,
          },
          vencimento: String(x['vencimento']),
        });
        for (const l of ls) s.lancamentos.set(l!.id, { ...l!, emRpa: id });
        return {
          rpa: id,
          numero,
          titulo: titulo ?? 0,
          prestador: Number(x['prestador']),
          lancamentos: ids.length,
        };
      }
      case 'repasse.integrarItens': {
        if (x['competencia'] === COMPETENCIA_DO_OUTRO_SISTEMA)
          throw recusa('periodo-ja-apurado', 'O período já tem apuração gravada no outro sistema.');
        let n = 0;
        for (const l of x['lancamentos'] as { itens: { item: number }[] }[])
          for (const i of l.itens) {
            if (s.integrados.has(i.item)) throw recusa('ja-integrado', 'Item já integrado ao repasse.');
            s.integrados.add(i.item);
            n += 1;
          }
        return { apuracao: String(x['apuracao']), linhas: n, lancamentos: '' };
      }
      case 'repasse.incluirRegra': {
        const v = s.versoes.get(Number(x['versao']));
        if (!v || v.estado !== 'aprovada')
          throw recusa('versao-nao-aprovada', 'A versão da regra não está aprovada.');
        const id = 9000 + ++s.seq;
        s.regras.push(
          regra(id, {
            vigencia: String(x['vigencia']),
            convenio: Number(x['convenio']) || null,
            profissional: Number(x['prestador']) || null,
            prestador: Number(x['prestador']) || null,
            procedimentoInicial: Number(x['procedimentoInicial']) || null,
            procedimentoFinal: Number(x['procedimentoFinal']) || null,
            tipoConta: x['tipoConta'] as RegraRepasse['tipoConta'],
            percentual: Number(x['percentual']),
            valorFixo: Number(x['valorFixo']),
            evento: Number(x['evento']),
          }),
        );
        s.versoes.set(v.id, { ...v, estado: 'incluida', regraIncluida: id });
        return { regra: id, versao: String(v.id) };
      }
      default:
        throw recusa('operacao-desconhecida', 'Operação fora do repasse.');
    }
  }

  async gravarSgh<T>(
    c: ContextoRepasse,
    _trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorRepasse) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const agora = () => new Date().toISOString();
    const g: GravadorRepasse = {
      proporVersao: async (d) => {
        const id = ++s.seq;
        s.versoes.set(id, {
          id,
          estado: 'rascunho',
          substitui: d.substitui,
          proposta: d.proposta,
          justificativa: d.justificativa,
          simulada: false,
          autor: d.autor,
          propostaEm: agora(),
          decididaPor: null,
          decididaEm: null,
          justificativaDecisao: null,
          regraIncluida: null,
        });
        return { versao: id };
      },
      marcarSimulada: async (d) => {
        const v = s.versoes.get(d.versao);
        if (v && (v.estado === 'rascunho' || v.estado === 'simulada'))
          s.versoes.set(v.id, { ...v, simulada: true, estado: 'simulada' });
        return { versao: d.versao };
      },
      decidirVersao: async (d) => {
        const v = s.versoes.get(d.versao);
        if (!v) throw recusa('versao-inexistente', 'A versão da regra não existe.');
        if (!['rascunho', 'simulada'].includes(v.estado))
          throw recusa('versao-decidida', 'A versão já foi decidida.');
        if (v.autor === d.por) throw recusa('mesma-pessoa', 'Quem propôs a regra não a aprova.');
        s.versoes.set(v.id, {
          ...v,
          estado: d.para,
          decididaPor: d.por,
          decididaEm: agora(),
          justificativaDecisao: d.justificativa,
        });
        return { versao: v.id, estado: d.para };
      },
      gravarApuracao: async (d) => {
        const atual = [...s.apuracoes.values()].find(
          (a) => a.empresa === d.empresa && a.competencia === d.competencia,
        );
        if (atual && atual.estado !== 'aberta')
          throw recusa(
            'apuracao-fechada',
            'A apuração do período já foi conferida: a correção entra no período seguinte.',
          );
        const id = atual?.id ?? ++s.seq;
        s.apuracoes.set(id, {
          id,
          empresa: d.empresa,
          competencia: d.competencia,
          estado: 'aberta',
          simulacao: d.simulacao,
          ...d.totais,
          apuradoPor: d.apuradoPor,
          conferidoPor: null,
          aprovadoPor: null,
        });
        s.memorias.set(
          id,
          d.memorias.map((m) => ({ ...m })),
        );
        return { apuracao: id, recalculada: atual !== undefined };
      },
      transicionarApuracao: async (d) => {
        const a = s.apuracoes.get(d.apuracao);
        if (!a) throw recusa('apuracao-inexistente', 'A apuração não existe.');
        if (a.estado !== d.de) throw recusa('apuracao-alterada', 'A apuração mudou agora há pouco: releia.');
        if (d.para === 'aprovada' && a.apuradoPor === d.por)
          throw recusa('mesma-pessoa', 'Quem apurou não aprova.');
        s.apuracoes.set(a.id, {
          ...a,
          estado: d.para,
          conferidoPor: d.para === 'conferida' ? d.por : d.para === 'aberta' ? null : a.conferidoPor,
          aprovadoPor: d.para === 'aprovada' ? d.por : a.aprovadoPor,
        });
        return { apuracao: a.id, estado: d.para };
      },
    };
    return fn(g);
  }

  async hoje(): Promise<string> {
    return hojeUtc();
  }

  async opcoes(): Promise<{ eventos: OpcaoPorta[]; convenios: OpcaoPorta[] }> {
    return {
      eventos: [
        { codigo: 40, rotulo: 'Honorários médicos (sintético)' },
        { codigo: 41, rotulo: 'Consultas (sintético)' },
      ],
      convenios: [
        { codigo: 301, rotulo: 'Convênio sintético A' },
        { codigo: 302, rotulo: 'Convênio sintético B' },
      ],
    };
  }

  async regras(c: ContextoRepasse, f: FiltroRegrasPorta) {
    const p = f.procedimento ?? null;
    return this.e(c)
      .regras.filter(
        (r) =>
          (r.convenio === null || r.convenio === f.convenio) &&
          r.vigencia <= f.data &&
          r.id > f.depoisDe &&
          (!p ||
            r.procedimentoInicial === null ||
            (r.procedimentoInicial <= p && (r.procedimentoFinal ?? r.procedimentoInicial) >= p)) &&
          (!f.profissional || r.prestador === null || r.prestador === f.profissional),
      )
      .sort((a, b) => a.id - b.id)
      .slice(0, f.teto ?? 3000);
  }

  async todasRegras(c: ContextoRepasse, f: { convenio: number; data: string }) {
    return this.regras(c, { ...f, depoisDe: 0 });
  }

  /** A sessão sintética não tem regra integral da consulta particular (vem só da migração). */
  async integraisParticular() {
    return {
      integrais: [],
      grupoDoProcedimento: new Map<number, number>(),
      fontesParticulares: new Set<number>(),
    };
  }

  async regrasUsadas(c: ContextoRepasse, ids: readonly number[]) {
    const u = this.e(c).usadas;
    return new Set(ids.filter((i) => u.has(i)));
  }

  async versoes(c: ContextoRepasse) {
    return [...this.e(c).versoes.values()].sort((a, b) => b.id - a.id);
  }

  async versao(c: ContextoRepasse, id: number) {
    return this.e(c).versoes.get(id) ?? null;
  }

  async producao(_c: ContextoRepasse, competencia: string, depoisDe: number) {
    const base = Number(competencia.replace('-', '')) * 100;
    const dia = `${competencia}-10`;
    const item = (n: number, p: Partial<ItemProducao>): ItemProducao => ({
      id: base + n,
      data: dia,
      hora: '10:00',
      convenio: 301,
      procedimento: 10101012,
      especialidade: null,
      ato: null,
      grupoAto: null,
      local: null,
      unidade: null,
      centroCusto: null,
      cooperativa: null,
      tipoLancamento: null,
      tipoConta: 'I',
      executante: 7001,
      cobrado: 1000,
      pago: 1000,
      recursoDeferido: 0,
      conciliado: true,
      ...p,
    });
    const itens = [
      item(1, { cobrado: 1000 }),
      item(2, { cobrado: 800 }),
      item(3, { convenio: 302, executante: 7002, cobrado: 300 }),
      item(4, { executante: 7002, cobrado: 500 }),
      item(5, { executante: null, cobrado: 200 }),
    ].filter((i) => i.id > depoisDe);
    return { itens, ultimo: null };
  }

  async jaIntegrados(c: ContextoRepasse, itens: readonly number[]) {
    const s = this.e(c).integrados;
    return new Set(itens.filter((i) => s.has(i)));
  }

  async estadoPeriodo(c: ContextoRepasse, _empresa: number, competencia: string) {
    const n = [...this.e(c).lancamentos.values()].filter((l) => l.competencia === competencia).length;
    return competencia === COMPETENCIA_DO_OUTRO_SISTEMA
      ? { lancamentos: n + 12, daApuracao: 12 }
      : { lancamentos: n, daApuracao: 0 };
  }

  async apuracaoDoPeriodo(c: ContextoRepasse, empresa: number, competencia: string) {
    return (
      [...this.e(c).apuracoes.values()].find((a) => a.empresa === empresa && a.competencia === competencia) ??
      null
    );
  }

  async apuracao(c: ContextoRepasse, id: number) {
    return this.e(c).apuracoes.get(id) ?? null;
  }

  async memorias(c: ContextoRepasse, apuracao: number, prestador: number | null) {
    return (this.e(c).memorias.get(apuracao) ?? []).filter(
      (m) => prestador === null || m.prestador === prestador,
    );
  }

  async lancamentos(c: ContextoRepasse, f: { empresa: number; competencia: string; prestador?: number }) {
    return [...this.e(c).lancamentos.values()]
      .filter((l) => l.competencia === f.competencia && (!f.prestador || l.prestador === f.prestador))
      .sort((a, b) => a.id - b.id)
      .map(semCompetencia);
  }

  async estornos(c: ContextoRepasse, ids: readonly number[]) {
    const s = this.e(c).estornos;
    return new Map(ids.filter((i) => s.has(i)).map((i) => [i, s.get(i)!.original] as const));
  }

  async rpas(c: ContextoRepasse, f: { empresa: number; competencia: string }) {
    return [...this.e(c).rpas.values()]
      .filter((r) => (r.emissao ?? '').startsWith(f.competencia))
      .map((r) => ({
        id: r.id,
        serie: r.serie,
        numero: r.numero,
        inicio: r.inicio,
        fim: r.fim,
        emissao: r.emissao,
        tipo: r.tipo,
        prestador: r.prestador,
        situacao: r.situacao,
        lancamentos: r.lancamentos,
      }));
  }

  async rpaDetalhe(c: ContextoRepasse, id: number): Promise<RpaDetalhe | null> {
    const s = this.e(c);
    const r = s.rpas.get(id);
    if (!r) return null;
    return {
      rpa: {
        id: r.id,
        serie: r.serie,
        numero: r.numero,
        inicio: r.inicio,
        fim: r.fim,
        emissao: r.emissao,
        tipo: r.tipo,
        prestador: r.prestador,
        situacao: r.situacao,
        lancamentos: r.lancamentos,
      },
      lancamentos: r.lancamentosIds.map((i) => {
        const l = s.lancamentos.get(i)!;
        return { id: l.id, data: l.data, evento: l.evento, valor: l.valor };
      }),
      retencoes: r.retencoes,
      titulo: r.titulo ? { id: r.titulo, valor: r.retencoes?.liquido ?? 0, vencimento: r.vencimento } : null,
      contribuinte: NOMES[r.prestador]
        ? { nome: NOMES[r.prestador]!, conselho: `${r.prestador}/SP`, documento: '***.***.***-00' }
        : null,
    };
  }

  async buscarPrestadores(_c: ContextoRepasse, termo: string): Promise<PrestadorRepasse[]> {
    const t = termo.trim().toUpperCase();
    if (!t) return [];
    return Object.entries(NOMES)
      .filter(([cod, nome]) => cod === t || nome.includes(t))
      .map(([cod, nome]) => ({
        prestador: Number(cod),
        registro: REGISTROS[Number(cod)]!,
        nome,
        conselho: `${cod}/SP`,
      }));
  }

  async jaEmRpa(c: ContextoRepasse, ids: readonly number[]) {
    const s = this.e(c).lancamentos;
    return new Set(ids.filter((i) => s.get(i)?.emRpa));
  }

  async prestadoresDoUsuario(_c: ContextoRepasse, login: string) {
    return [...(VINCULOS[login] ?? [])];
  }

  async registroDoPrestador(_c: ContextoRepasse, prestador: number) {
    return REGISTROS[prestador] ?? null;
  }

  async lancamentosDosPrestadores(
    c: ContextoRepasse,
    ps: readonly number[],
    desde: string,
    ate: string | null = null,
  ) {
    return [...this.e(c).lancamentos.values()]
      .filter((l) => ps.includes(l.prestador) && (l.data ?? '') >= desde && (!ate || (l.data ?? '') <= ate))
      .sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''))
      .map(semCompetencia);
  }

  async rpasDosPrestadores(
    c: ContextoRepasse,
    ps: readonly number[],
    desde: string,
    ate: string | null = null,
  ) {
    return [...this.e(c).rpas.values()]
      .filter(
        (r) => ps.includes(r.prestador) && (r.emissao ?? '') >= desde && (!ate || (r.emissao ?? '') <= ate),
      )
      .map((r) => ({
        id: r.id,
        serie: r.serie,
        numero: r.numero,
        inicio: r.inicio,
        fim: r.fim,
        emissao: r.emissao,
        tipo: r.tipo,
        prestador: r.prestador,
        situacao: r.situacao,
        lancamentos: r.lancamentos,
        valor: r.valor,
        titulo: r.titulo,
      }));
  }

  async adiantamentos(): Promise<number> {
    return 0;
  }

  async basesIndicadores(c: ContextoRepasse): Promise<BasesIndicadoresRepassePorta> {
    const s = this.e(c);
    const memorias = [...s.memorias.values()].flat().filter((m) => !m.pendencia);
    const estornos = [...s.estornos.values()];
    return {
      repasse: memorias.reduce((t, m) => t + m.valor, 0),
      honorarios: memorias.reduce((t, m) => t + m.baseValor, 0),
      linhas: memorias.length,
      estornos: estornos.length,
      valorEstornos: estornos.reduce((t, e) => t + e.valor, 0),
      rpas: s.rpas.size,
      rpasPagos: 1,
      diasAtePagamento: 9,
    };
  }
}
