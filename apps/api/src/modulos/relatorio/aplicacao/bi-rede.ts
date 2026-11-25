// BI consolidado da Rede (M57, etapa 3; ficha, seções 4, 7 e 8; regras 8, 9, 10 e 12; cap-07 §7.7.4): os indicadores
// com a MESMA ficha técnica, o painel operacional e o financeiro de cada estabelecimento da rede, lidos banco a banco
// (cada leitura no banco de UM estabelecimento, pelo serviço do M16; nenhuma consulta cruza os bancos) e consolidados em
// memória pela soma dos numeradores sobre a soma dos denominadores, com as parcelas à vista (@sgh/dominio-relatorio).
//   - Regra 12: só os estabelecimentos da rede da sessão, da lista configurada (ARQ-1); sem rede, ou com a rede de
//     outra hospedagem, recusado antes de qualquer leitura.
//   - A chave `rede.bi` por estabelecimento: o desligado fica fora do consolidado, com o motivo (como o MPI,
//     D-LIB-EST-57); o banco que não responde também (situação `indisponivel`), e o consolidado diz quem entrou.
//   - Regra 9: o modo do pseudônimo (comum só com `rede.pseudonimoComum` em TODOS) vai à tela; por estabelecimento, a
//     reinternação é contada dentro de cada um (a nota diz).
// Nada de pessoa: só contagens e somas por mês e estabelecimento.
import {
  type BiRede,
  CODIGOS_INDICADOR,
  type CodigoIndicador,
  type EstabelecimentoBiRede,
  type FichaIndicador,
  type IndicadorBiRede,
  type ModoPseudonimoRede,
  type PainelConsolidadoRede,
  type RecusaBiRede,
  type SerieIndicadorBiRede,
  type SeriePainelBiRede,
  type ValorConsolidadoRede,
  type ValorIndicador,
} from '@sgh/contratos';
import { ErroIsolamentoRede, estabelecimentosDaRede } from '@sgh/dominio-rede';
import {
  consolidarSerie,
  consolidarSeriePainel,
  contaImpressa,
  type DefinicaoNoEstabelecimento,
  ErroConsolidacao,
  fichaDe,
  FICHAS,
  serieDe,
  type ValorConsolidado,
} from '@sgh/dominio-relatorio';
import type { ContextoNucleo } from '@sgh/nucleo';
import { ErroProblema } from '../../../problema.filter.js';
import type { ParametrosM16 } from '../../internacao/configuracao.js';
import type { CtxInternacao } from '../../internacao/fonte.js';
import type { ServicoInternacao } from '../../internacao/servico.js';

export interface EstabelecimentoDaRede {
  readonly codigo: string;
  readonly nome: string;
}

/** De onde o BI tira a rede e os estabelecimentos (a mesma lista do MPI: a porta da Rede, ARQ-1). */
export interface ListaDaRede {
  redeConfigurada(): string | null;
  estabelecimentos(): readonly EstabelecimentoDaRede[];
}

export interface DependenciasBiRede {
  readonly lista: ListaDaRede;
  readonly internacao: Pick<ServicoInternacao, 'indice' | 'motor' | 'painelGerencial'>;
  /** Parâmetros do M16 de UM estabelecimento (lidos no banco dele). */
  parametros(rede: string, hospital: string): Promise<ParametrosM16>;
  /** A chave `rede.bi` ligada para o estabelecimento inteiro, com os pré-requisitos dele. */
  biLigado(rede: string, hospital: string): Promise<boolean>;
  /** A chave `rede.pseudonimoComum` (DP-42) ligada no estabelecimento. */
  pseudonimoComum(rede: string, hospital: string): Promise<boolean>;
  /**
   * O banco de UM estabelecimento (cliente e id do estabelecimento no @sgh/nucleo): a leitura do movimento vai pela
   * porta própria dele. Ausente: a fonte em memória (dev/ci). Falha: o estabelecimento fica indisponível.
   */
  contextoBanco?(rede: string, hospital: string): Promise<ContextoNucleo>;
  readonly agora?: () => Date;
}

export interface SessaoBiRede {
  readonly rede: string;
  readonly hospital: string;
}

const NOTA_POR_ESTABELECIMENTO =
  'Pseudônimo por estabelecimento: o mesmo paciente não é reconhecido entre os estabelecimentos, e a reinternação é contada só dentro de cada um (o pseudônimo comum depende da decisão sobre o compartilhamento entre os estabelecimentos).';
const NOTA_COMUM =
  'Pseudônimo comum: o paciente ligado no MPI da Rede tem o mesmo pseudônimo em todos os estabelecimentos no data mart da Rede.';
const NOTA_CONTA =
  'O valor da Rede é a soma dos numeradores dividida pela soma dos denominadores (nunca a média das taxas); cada valor mostra as parcelas de cada estabelecimento.';
const NOTA_UM =
  'A rede desta sessão tem um só estabelecimento no consolidado: o valor da Rede é o do estabelecimento.';

/** Grandezas cuja contagem depende da hora de fechamento do censo (o parâmetro entra na definição). */
const DO_CENSO = new Set(['pacientesDia', 'pacientesDiaIntensiva', 'leitosDiaOciosos', 'leitosDia']);

/** Os parâmetros que mudam a definição do indicador (a "mesma ficha técnica" confere). */
export function definicaoDoIndicador(f: FichaIndicador, p: ParametrosM16): DefinicaoNoEstabelecimento {
  const gs = [f.numerador.grandeza, f.denominador?.grandeza].filter(Boolean) as string[];
  const parametros: Record<string, string> = {};
  if (gs.some((g) => DO_CENSO.has(g))) parametros['horaFechamento'] = String(p.horaFechamento);
  if (gs.some((g) => g.endsWith('Intensiva')))
    parametros['intensivas'] = [...p.intensivas].sort((a, b) => a - b).join(',');
  return { versao: f.versao, parametros };
}

function fichaDoBi(f: FichaIndicador): IndicadorBiRede['ficha'] {
  return {
    codigo: f.codigo,
    nome: f.nome,
    formula: f.formula,
    numerador: f.numerador.descricao,
    denominador: f.denominador?.descricao ?? null,
    unidade: f.unidade,
    polaridade: f.polaridade,
    versao: f.versao,
    limitacoes: [...f.limitacoes],
  };
}

function recusaDe(e: unknown): RecusaBiRede {
  if (e instanceof ErroConsolidacao) return { motivo: e.motivo, mensagem: e.message };
  throw e;
}

function comConta(f: FichaIndicador, v: ValorConsolidado): ValorConsolidadoRede {
  return { ...v, parcelas: [...v.parcelas], conta: contaImpressa(f, v) };
}

/** O último mês que não é parcial (o "último fechado"), ou o último que houver. */
function ultimoFechado(vs: readonly ValorConsolidadoRede[]): ValorConsolidadoRede | null {
  for (let k = vs.length - 1; k >= 0; k--) if (!vs[k]!.parcial) return vs[k]!;
  return vs.at(-1) ?? null;
}

interface Lido {
  readonly est: EstabelecimentoBiRede;
  readonly parametros: ParametrosM16 | null;
}

export class ServicoBiRede {
  constructor(private readonly d: DependenciasBiRede) {}

  /** O contexto da leitura de UM estabelecimento: com o banco dele (porta própria) quando a instalação o tem. */
  private async ctxDe(s: SessaoBiRede, hospital: string, traceId: string): Promise<CtxInternacao> {
    const base = { rede: s.rede, hospital, traceId };
    if (!this.d.contextoBanco) return base;
    const p = await this.d.contextoBanco(s.rede, hospital);
    return { ...base, porta: { ...p, correlacao: traceId } };
  }

  /** Regra 12: os estabelecimentos da rede da sessão (recusa antes de qualquer leitura). */
  private daRede(s: SessaoBiRede): EstabelecimentoDaRede[] {
    let codigos: readonly string[];
    try {
      codigos = estabelecimentosDaRede({
        redeSessao: s.rede,
        redeConfigurada: this.d.lista.redeConfigurada(),
        estabelecimentos: this.d.lista.estabelecimentos().map((e) => e.codigo),
      });
    } catch (e) {
      if (e instanceof ErroIsolamentoRede)
        throw new ErroProblema(
          'sem-permissao',
          403,
          'Fora da rede',
          e.codigo === 'rede-ausente'
            ? 'O BI da Rede precisa do código da rede da sessão.'
            : 'A rede da sessão não é a desta configuração.',
          { codigo: e.codigo },
        );
      throw e;
    }
    if (!codigos.includes(s.hospital))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora da rede',
        'O estabelecimento da sessão não é um estabelecimento desta rede.',
        { codigo: 'fora-da-rede' },
      );
    const nomes = new Map(this.d.lista.estabelecimentos().map((e) => [e.codigo, e.nome]));
    // O da sessão primeiro (o período padrão vem dele); os outros em ordem de código.
    return [s.hospital, ...codigos.filter((c) => c !== s.hospital)].map((codigo) => ({
      codigo,
      nome: nomes.get(codigo) ?? codigo,
    }));
  }

  /** Quem entra no consolidado: a chave `rede.bi` de cada um e os parâmetros (banco fora: indisponível). */
  private async situacoes(s: SessaoBiRede): Promise<Lido[]> {
    const r: Lido[] = [];
    for (const e of this.daRede(s)) {
      const base = { codigo: e.codigo, nome: e.nome, dadosAte: null, ultimoMovimento: null };
      const ligado = e.codigo === s.hospital || (await this.d.biLigado(s.rede, e.codigo).catch(() => false));
      if (!ligado) {
        r.push({
          est: {
            ...base,
            situacao: 'desligado',
            motivo: `O BI da Rede ainda não foi liberado em ${e.nome}: os números desse estabelecimento ficam fora do consolidado até a liberação.`,
          },
          parametros: null,
        });
        continue;
      }
      try {
        r.push({
          est: { ...base, situacao: 'incluido', motivo: null },
          parametros: await this.d.parametros(s.rede, e.codigo),
        });
      } catch {
        r.push({ est: { ...base, situacao: 'indisponivel', motivo: MOTIVO_FORA }, parametros: null });
      }
    }
    return r;
  }

  private async modoPseudonimo(s: SessaoBiRede, ests: readonly string[]): Promise<ModoPseudonimoRede> {
    if (ests.length === 0) return 'por-estabelecimento';
    for (const e of ests) {
      const ok = await this.d.pseudonimoComum(s.rede, e).catch(() => false);
      if (!ok) return 'por-estabelecimento';
    }
    return 'comum';
  }

  /** As séries de todos os indicadores de cada estabelecimento incluído no período (o da sessão define o padrão). */
  private async lerIndicadores(
    s: SessaoBiRede,
    de?: string,
    ate?: string,
  ): Promise<{
    lidos: Lido[];
    periodo: { de: string; ate: string };
    series: Map<
      string,
      {
        definicao: (f: FichaIndicador) => DefinicaoNoEstabelecimento;
        valores: (f: FichaIndicador) => ValorIndicador[];
      }
    >;
  }> {
    const lidos = await this.situacoes(s);
    let periodo: { de: string; ate: string } | null = de && ate ? { de, ate } : null;
    const series = new Map<
      string,
      {
        definicao: (f: FichaIndicador) => DefinicaoNoEstabelecimento;
        valores: (f: FichaIndicador) => ValorIndicador[];
      }
    >();
    for (let k = 0; k < lidos.length; k++) {
      const l = lidos[k]!;
      if (l.est.situacao !== 'incluido' || !l.parametros) continue;
      try {
        const ctx = await this.ctxDe(s, l.est.codigo, 'bi-rede');
        const indice = await this.d.internacao.indice(
          ctx,
          l.parametros,
          periodo?.de ?? de,
          periodo?.ate ?? ate,
        );
        periodo ??= indice.periodo;
        const { motor } = await this.d.internacao.motor(ctx, l.parametros);
        const bases = motor.basesMensais(periodo.de, periodo.ate);
        const p = l.parametros;
        series.set(l.est.codigo, {
          definicao: (f) => definicaoDoIndicador(f, p),
          valores: (f) => serieDe(f, bases),
        });
        lidos[k] = {
          ...l,
          est: { ...l.est, dadosAte: indice.dadosAte, ultimoMovimento: indice.ultimoMovimento },
        };
      } catch (e) {
        if (e instanceof ErroProblema && e.getStatus() === 400) throw e;
        lidos[k] = { ...l, est: { ...l.est, situacao: 'indisponivel', motivo: MOTIVO_FORA } };
      }
    }
    if (!periodo) {
      const agora = (this.d.agora?.() ?? new Date()).toISOString().slice(0, 7);
      periodo = { de: de ?? agora, ate: ate ?? agora };
    }
    return { lidos, periodo, series };
  }

  private seriesDoIndicador(
    f: FichaIndicador,
    series: Awaited<ReturnType<ServicoBiRede['lerIndicadores']>>['series'],
  ): { valores: ValorConsolidadoRede[]; recusa: RecusaBiRede | null } {
    if (series.size === 0)
      return {
        valores: [],
        recusa: { motivo: 'sem-parcelas', mensagem: 'Nenhum estabelecimento da rede entrou no consolidado.' },
      };
    try {
      const v = consolidarSerie(
        f,
        [...series.entries()].map(([estabelecimento, x]) => ({
          estabelecimento,
          definicao: x.definicao(f),
          valores: x.valores(f),
        })),
      );
      return { valores: v.map((x) => comConta(f, x)), recusa: null };
    } catch (e) {
      return { valores: [], recusa: recusaDe(e) };
    }
  }

  private notas(lidos: readonly Lido[], modo: ModoPseudonimoRede): string[] {
    const incluidos = lidos.filter((l) => l.est.situacao === 'incluido').length;
    return [
      NOTA_CONTA,
      modo === 'comum' ? NOTA_COMUM : NOTA_POR_ESTABELECIMENTO,
      ...(incluidos === 1 ? [NOTA_UM] : []),
    ];
  }

  /** O índice dos indicadores consolidados: o último mês fechado da Rede, com as parcelas e a conta. */
  async consolidado(s: SessaoBiRede, de?: string, ate?: string): Promise<BiRede> {
    if (de && ate && de > ate) throw periodoInvalido();
    const { lidos, periodo, series } = await this.lerIndicadores(s, de, ate);
    const modo = await this.modoPseudonimo(
      s,
      lidos.filter((l) => l.est.situacao === 'incluido').map((l) => l.est.codigo),
    );
    return {
      periodo,
      estabelecimentos: lidos.map((l) => l.est),
      indicadores: FICHAS.map((f) => {
        const r = this.seriesDoIndicador(f, series);
        return { ficha: fichaDoBi(f), ultimo: ultimoFechado(r.valores), recusa: r.recusa };
      }),
      pseudonimo: modo,
      notas: this.notas(lidos, modo),
      geradoEm: (this.d.agora?.() ?? new Date()).toISOString(),
    };
  }

  /** A série consolidada de um indicador (mês a mês, com as parcelas). */
  async serie(s: SessaoBiRede, codigo: string, de?: string, ate?: string): Promise<SerieIndicadorBiRede> {
    if (!(CODIGOS_INDICADOR as readonly string[]).includes(codigo))
      throw new ErroProblema('nao-encontrado', 404, 'Indicador não encontrado');
    if (de && ate && de > ate) throw periodoInvalido();
    const f = fichaDe(codigo as CodigoIndicador)!;
    const { lidos, periodo, series } = await this.lerIndicadores(s, de, ate);
    const modo = await this.modoPseudonimo(
      s,
      lidos.filter((l) => l.est.situacao === 'incluido').map((l) => l.est.codigo),
    );
    const r = this.seriesDoIndicador(f, series);
    return {
      ficha: fichaDoBi(f),
      periodo,
      estabelecimentos: lidos.map((l) => l.est),
      valores: r.valores,
      recusa: r.recusa,
      notas: this.notas(lidos, modo),
    };
  }

  /** O painel operacional ou o financeiro da Rede (as séries somadas; os percentuais por Σ÷Σ). */
  async painel(
    s: SessaoBiRede,
    painel: 'operacional' | 'financeiro',
    de?: string,
    ate?: string,
  ): Promise<PainelConsolidadoRede> {
    if (de && ate && de > ate) throw periodoInvalido();
    const lidos = await this.situacoes(s);
    let periodo: { de: string; ate: string } | null = null;
    const porEst: { estabelecimento: string; series: PainelGerencialSeries }[] = [];
    const notas = new Set<string>();
    for (let k = 0; k < lidos.length; k++) {
      const l = lidos[k]!;
      if (l.est.situacao !== 'incluido' || !l.parametros) continue;
      try {
        const ctx = await this.ctxDe(s, l.est.codigo, `bi-rede-${painel}`);
        const p = await this.d.internacao.painelGerencial(
          ctx,
          l.parametros,
          painel,
          periodo?.de ?? de,
          periodo?.ate ?? ate,
        );
        periodo ??= p.periodo;
        porEst.push({ estabelecimento: l.est.codigo, series: p.series });
        for (const n of p.notas) notas.add(n);
        lidos[k] = { ...l, est: { ...l.est, dadosAte: p.dadosAte } };
      } catch (e) {
        if (e instanceof ErroProblema && e.getStatus() === 400) throw e;
        lidos[k] = { ...l, est: { ...l.est, situacao: 'indisponivel', motivo: MOTIVO_FORA } };
      }
    }
    const codigos = [...new Set(porEst.flatMap((x) => x.series.map((y) => y.codigo)))];
    const series: SeriePainelBiRede[] = codigos.map((codigo) => {
      const partes = porEst.flatMap((x) => {
        const serie = x.series.find((y) => y.codigo === codigo);
        return serie ? [{ estabelecimento: x.estabelecimento, serie }] : [];
      });
      try {
        const c = consolidarSeriePainel(partes);
        return {
          ...c,
          valores: [...c.valores],
          parcelas: c.parcelas.map((p) => ({ ...p, valores: [...p.valores] })),
          recusa: null,
        };
      } catch (e) {
        const b = partes[0]!.serie;
        return {
          codigo,
          rotulo: b.rotulo,
          unidade: b.unidade,
          regua: b.regua,
          valores: [],
          parcelas: [],
          recusa: recusaDe(e),
        };
      }
    });
    const modo = await this.modoPseudonimo(
      s,
      lidos.filter((l) => l.est.situacao === 'incluido').map((l) => l.est.codigo),
    );
    const agora = (this.d.agora?.() ?? new Date()).toISOString().slice(0, 7);
    return {
      painel,
      periodo: periodo ?? { de: de ?? agora, ate: ate ?? agora },
      estabelecimentos: lidos.map((l) => l.est),
      series,
      notas: [
        ...this.notas(lidos, modo).filter((n) => n !== NOTA_POR_ESTABELECIMENTO && n !== NOTA_COMUM),
        ...notas,
      ],
    };
  }
}

type PainelGerencialSeries = Awaited<ReturnType<ServicoInternacao['painelGerencial']>>['series'];

const MOTIVO_FORA =
  'O banco deste estabelecimento não respondeu: os números dele ficam fora do consolidado nesta consulta.';

function periodoInvalido(): ErroProblema {
  return new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O início vem depois do fim.');
}

/** Planilha da série consolidada: a Rede e as parcelas de cada estabelecimento, com a conta (";" e vírgula decimal). */
export function planilhaDaSerieRede(s: SerieIndicadorBiRede): string {
  const num = (v: number | null | undefined) =>
    v === null || v === undefined ? '' : String(v).replace('.', ',');
  const q = (t: string) => `"${t.replaceAll('"', '""')}"`;
  const ests = s.estabelecimentos.filter((e) => e.situacao === 'incluido');
  const cab = [
    'periodo',
    `${s.ficha.numerador} (Rede)`,
    s.ficha.denominador ? `${s.ficha.denominador} (Rede)` : '',
    `${s.ficha.nome} (Rede)`,
    ...ests.flatMap((e) => [`numerador ${e.nome}`, `denominador ${e.nome}`, `valor ${e.nome}`]),
    'conta',
    'parcial',
  ].map(q);
  const linhas = s.valores.map((v) =>
    [
      v.periodo,
      num(v.numerador),
      num(v.denominador),
      num(v.valor),
      ...ests.flatMap((e) => {
        const p = v.parcelas.find((x) => x.estabelecimento === e.codigo);
        return [num(p?.numerador), num(p?.denominador), num(p?.valor)];
      }),
      q(v.conta),
      v.parcial ? 'sim' : 'não',
    ].join(';'),
  );
  return [cab.join(';'), ...linhas].join('\r\n') + '\r\n';
}
