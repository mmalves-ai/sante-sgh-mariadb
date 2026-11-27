// Valor fixo mensal e mínimo garantido do repasse em memória (C2-100, 06-FAT linha 47): a porta da fonte sintética
// (E2E e desenvolvimento sem banco do cliente), com as mesmas validações e o mesmo cálculo de domínio da porta própria
// (validarValorFixo, validarMinimoGarantido, conflitoDeVigencia, calcularRemuneracaoVariavel). Dados SINTÉTICOS: os
// médicos 7001 e 7002 da busca de prestadores da fonte sintética, os eventos de rendimento 40 e 41 e uma apuração em
// aberto na competência corrente, com a produção sintética do médico 7001. Resultado do centro, meta e custo do
// prestador ficam só no banco próprio (503 aqui, como sem banco).
import {
  calcularRemuneracaoVariavel,
  conflitoDeVigencia,
  ultimoDiaDoMes,
  validarMinimoGarantido,
  validarValorFixo,
  vigenteNaCompetencia,
} from '@sgh/dominio-repasse';
import { ErroProblema } from '../../problema.filter.js';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  recusaRegra,
} from '../../porta-estabelecimento-propria.js';
import {
  esquemaEncerrar,
  esquemaFixo,
  esquemaMinimo,
  type PortaRemuneracaoVariavelPropria,
  type SimulacaoProfissional,
  type TipoRegraVariavel,
} from './remuneracao-variavel-propria.js';

/** O que o controlador usa da porta: a própria (banco do cliente) ou a de memória (fonte sintética). */
export type PortaRemuneracaoVariavel = Pick<
  PortaRemuneracaoVariavelPropria,
  | 'painel'
  | 'simular'
  | 'incluirMinimo'
  | 'incluirFixo'
  | 'incluirResultado'
  | 'incluirMeta'
  | 'informarApurado'
  | 'encerrar'
  | 'lancar'
>;

type Painel = Awaited<ReturnType<PortaRemuneracaoVariavelPropria['painel']>>;

const PROFISSIONAIS: Readonly<Record<number, string>> = {
  7001: 'MEDICO SINTETICO A',
  7002: 'MEDICO SINTETICO B',
};
const EVENTOS = [
  { id: 40, codigo: '40', nome: 'Honorários médicos (sintético)' },
  { id: 41, codigo: '41', nome: 'Consultas (sintético)' },
];
/** Produção sintética na apuração, em centavos (abaixo de qualquer piso do E2E). */
const PRODUCAO: Readonly<Record<number, number>> = { 7001: 92_550 };

interface Regra {
  id: number;
  profissional: number;
  evento: number;
  inicio: string;
  fim: string | null;
  versao: number;
}
type Minimo = Regra & { valorMinimo: number; complementoAutomatico: boolean };
type Fixo = Regra & {
  descricao: string;
  valorMensal: number;
  diaPagamento: number | null;
  lancamentoAutomatico: boolean;
};

const semBanco = () => new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');

export class PortaRemuneracaoVariavelMemoria implements PortaRemuneracaoVariavel {
  private seq = 0;
  private readonly minimos: Minimo[] = [];
  private readonly fixos: Fixo[] = [];
  /** `${apuracao}|${profissional}|${referente}` já lançado. */
  private readonly lancados = new Set<string>();
  /** `${competencia}|${profissional}|${referente}` do fixo lançado (um por competência). */
  private readonly fixosLancados = new Set<string>();
  private readonly apuracao: { id: number; numero: string; competencia: string; situacao: string };

  constructor(hoje: Date = new Date()) {
    const comp = `${hoje.toISOString().slice(0, 7)}-01`;
    this.apuracao = { id: 801, numero: '801', competencia: comp, situacao: 'em_apuracao' };
  }

  private base(r: Regra) {
    return {
      id: r.id,
      profissional: r.profissional,
      profissionalNome: PROFISSIONAIS[r.profissional] ?? null,
      evento: r.evento,
      eventoNome: EVENTOS.find((e) => e.id === r.evento)?.nome ?? null,
      inicio: r.inicio,
      fim: r.fim,
      versao: r.versao,
    };
  }

  private conferirAlvos(e: { profissional: number; evento: number }) {
    if (!PROFISSIONAIS[e.profissional]) throw naoEncontrado('Profissional');
    if (!EVENTOS.some((x) => x.id === e.evento)) throw naoEncontrado('Evento do repasse');
  }

  async painel(_c: ContextoPortaPropria, profissional: number | null): Promise<Painel> {
    const doProf = <T extends Regra>(xs: T[]) =>
      xs
        .filter((x) => profissional === null || x.profissional === profissional)
        .sort((a, b) => b.inicio.localeCompare(a.inicio) || b.id - a.id);
    return {
      minimos: doProf(this.minimos).map((x) => ({
        ...this.base(x),
        valorMinimo: x.valorMinimo,
        complementoAutomatico: x.complementoAutomatico,
      })),
      fixos: doProf(this.fixos).map((x) => ({
        ...this.base(x),
        descricao: x.descricao,
        valorMensal: x.valorMensal,
        diaPagamento: x.diaPagamento,
        lancamentoAutomatico: x.lancamentoAutomatico,
      })),
      resultados: [],
      metas: [],
      custos: [],
      eventos: EVENTOS,
      indicadores: [],
      centros: [],
      apuracoes: [{ ...this.apuracao }],
    };
  }

  private conferirApuracao(apuracao: number) {
    if (apuracao !== this.apuracao.id) throw naoEncontrado('Apuração do repasse');
    return this.apuracao;
  }

  private calcular(apuracao: number, comp: string, profissional: number | null): SimulacaoProfissional[] {
    const fimMes = ultimoDiaDoMes(comp);
    const vig = (r: Regra) =>
      (profissional === null || r.profissional === profissional) &&
      r.inicio <= fimMes &&
      (r.fim === null || r.fim >= comp) &&
      vigenteNaCompetencia({ inicio: r.inicio, fim: r.fim }, comp);
    const mins = this.minimos.filter((m) => vig(m) && m.complementoAutomatico);
    const fixos = this.fixos.filter((f) => vig(f) && f.lancamentoAutomatico);
    const profs = [...new Set([...mins, ...fixos].map((x) => x.profissional))].sort((a, b) =>
      (PROFISSIONAIS[a] ?? '').localeCompare(PROFISSIONAIS[b] ?? ''),
    );
    return profs.map((prof) => {
      const m0 = mins
        .filter((m) => m.profissional === prof)
        .sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
      const producaoCentavos = PRODUCAO[prof] ?? 0;
      const r = calcularRemuneracaoVariavel({
        competencia: comp,
        producaoCentavos,
        minimo: m0 ? { id: m0.id, valorMinimo: m0.valorMinimo, evento: m0.evento } : null,
        fixos: fixos
          .filter((f) => f.profissional === prof)
          .map((f) => {
            const ref = `Valor fixo mensal ${comp.slice(0, 7)} (regra ${f.id})`;
            return {
              id: f.id,
              descricao: f.descricao,
              valorMensal: f.valorMensal,
              evento: f.evento,
              lancadoNaCompetencia:
                this.fixosLancados.has(`${comp}|${prof}|${ref}`) &&
                !this.lancados.has(`${apuracao}|${prof}|${ref}`),
            };
          }),
        resultados: [],
        metas: [],
        custos: [],
      });
      return {
        profissional: prof,
        nome: PROFISSIONAIS[prof] ?? '',
        producao: producaoCentavos / 100,
        credito: r.creditoCentavos / 100,
        debito: r.debitoCentavos / 100,
        pendencias: r.pendencias,
        itens: r.itens.map((i) => ({
          tipo: i.tipo,
          regra: i.regra,
          evento: i.evento,
          sentido: i.sentido,
          valor: i.valorCentavos / 100,
          memoria: i.memoria,
          referente: i.referente,
          lancado: this.lancados.has(`${apuracao}|${prof}|${i.referente}`),
        })),
      };
    });
  }

  async simular(_c: ContextoPortaPropria, apuracao: number, profissional: number | null) {
    const a = this.conferirApuracao(apuracao);
    return {
      apuracao,
      competencia: a.competencia,
      situacao: a.situacao,
      profissionais: this.calcular(apuracao, a.competencia, profissional),
    };
  }

  async incluirMinimo(_c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaMinimo, entrada);
    this.conferirAlvos(e);
    const problemas = [
      ...validarMinimoGarantido(e),
      ...conflitoDeVigencia(
        e,
        this.minimos.filter((x) => x.profissional === e.profissional),
      ),
    ];
    if (problemas.length) throw recusaRegra('Mínimo garantido recusado', problemas);
    const id = ++this.seq;
    this.minimos.push({
      id,
      profissional: e.profissional,
      evento: e.evento,
      valorMinimo: e.valorMinimo,
      complementoAutomatico: e.complementoAutomatico,
      inicio: e.inicio,
      fim: e.fim,
      versao: 1,
    });
    return { id };
  }

  async incluirFixo(_c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaFixo, entrada);
    this.conferirAlvos(e);
    const problemas = [
      ...validarValorFixo(e),
      ...conflitoDeVigencia(
        e,
        this.fixos.filter((x) => x.profissional === e.profissional && x.descricao === e.descricao),
      ),
    ];
    if (problemas.length) throw recusaRegra('Valor fixo recusado', problemas);
    const id = ++this.seq;
    this.fixos.push({
      id,
      profissional: e.profissional,
      evento: e.evento,
      descricao: e.descricao,
      valorMensal: e.valorMensal,
      diaPagamento: e.diaPagamento,
      lancamentoAutomatico: e.lancamentoAutomatico,
      inicio: e.inicio,
      fim: e.fim,
      versao: 1,
    });
    return { id };
  }

  async incluirResultado(): Promise<{ id: number }> {
    throw semBanco();
  }

  async incluirMeta(): Promise<{ id: number }> {
    throw semBanco();
  }

  async informarApurado(): Promise<{ id: number }> {
    throw semBanco();
  }

  async encerrar(
    _c: ContextoPortaPropria,
    tipo: TipoRegraVariavel,
    regra: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const x = entradaValida(esquemaEncerrar, entrada);
    if (tipo !== 'minimo' && tipo !== 'fixo') throw semBanco();
    const r: Regra | undefined = (tipo === 'minimo' ? this.minimos : this.fixos).find((y) => y.id === regra);
    if (!r) throw naoEncontrado('Regra');
    if (x.versao !== r.versao)
      throw new ErroProblema('conflito-de-versao', 409, 'A regra mudou desde a leitura; recarregue.');
    if (x.fim < r.inicio || (r.fim !== null && x.fim > r.fim))
      throw recusaRegra('Encerramento recusado', [
        {
          campo: 'fim',
          mensagem: 'O fim fica entre o início da vigência e o fim atual; encerrar não estende.',
        },
      ]);
    r.fim = x.fim;
    r.versao += 1;
    return { id: regra };
  }

  async lancar(_c: ContextoPortaPropria, apuracao: number, profissional: number | null) {
    const a = this.conferirApuracao(apuracao);
    const pendencias: string[] = [];
    let lancamentos = 0;
    let credito = 0;
    for (const p of this.calcular(apuracao, a.competencia, profissional)) {
      for (const i of p.itens) {
        if (i.lancado || i.sentido === 'debito' || i.evento === null) continue;
        this.lancados.add(`${apuracao}|${p.profissional}|${i.referente}`);
        if (i.tipo === 'valor_fixo')
          this.fixosLancados.add(`${a.competencia}|${p.profissional}|${i.referente}`);
        lancamentos += 1;
        credito += Math.round(i.valor * 100);
      }
      pendencias.push(...p.pendencias.map((x) => `${p.nome}: ${x}`));
    }
    return { lancamentos, descontos: 0, credito: credito / 100, debito: 0, pendencias };
  }
}
