// Remuneração variável por faixa e rateio da equipe em memória (C2-106, 06-FAT linha 48): a porta da fonte sintética
// (E2E e desenvolvimento sem banco do cliente), com as mesmas validações e o mesmo cálculo de domínio da porta própria
// (validarMembroEquipe, conferirComposicao, validarRegraVariavelFaixa, conflitoRegraVariavel, calcularVariavelFaixa,
// ratearEquipe). Dados SINTÉTICOS: os médicos 7001 e 7002 da busca de prestadores da fonte sintética, os eventos 40
// e 41 (rendimento) e 42 (desconto), e uma apuração em aberto na competência corrente com a produção sintética dos dois
// médicos. O resultado do centro (custeio) não existe aqui: a margem é zero.
import {
  calcularVariavelFaixa,
  conferirComposicao,
  conflitoRegraVariavel,
  type FaixaVariavel,
  type IndicadorVariavel,
  type MembroEquipeVariavel,
  membrosVigentes,
  periodoDaCompetencia,
  ratearEquipe,
  ultimoDiaDoMes,
  validarMembroEquipe,
  validarRegraVariavelFaixa,
} from '@sgh/dominio-repasse';
import type { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  recusaRegra,
} from '../../porta-estabelecimento-propria.js';
import {
  esquemaEncerrar,
  esquemaEquipe,
  type esquemaMembro,
  esquemaRecompor,
  esquemaRegra,
  type PortaVariavelFaixaPropria,
  type RegraSimulada,
} from './variavel-faixa-propria.js';

/** O que o controlador usa da porta: a própria (banco do cliente) ou a de memória (fonte sintética). */
export type PortaVariavelFaixa = Pick<
  PortaVariavelFaixaPropria,
  'painel' | 'simular' | 'incluirEquipe' | 'recomporEquipe' | 'incluirRegra' | 'encerrarRegra' | 'lancar'
>;

type Painel = Awaited<ReturnType<PortaVariavelFaixaPropria['painel']>>;
type RegraPainel = Painel['regras'][number];
type EquipePainel = Painel['equipes'][number];

const PROFISSIONAIS: Readonly<Record<number, string>> = {
  7001: 'MEDICO SINTETICO A',
  7002: 'MEDICO SINTETICO B',
};
const EVENTOS = [
  { id: 40, codigo: '40', nome: 'Honorários médicos (sintético)', natureza: 'rendimento' },
  { id: 41, codigo: '41', nome: 'Consultas (sintético)', natureza: 'rendimento' },
  { id: 42, codigo: '42', nome: 'Desconto (sintético)', natureza: 'desconto' },
];
const FONTES = [
  { id: 41, nome: 'OPERADORA SINTETICA A' },
  { id: 42, nome: 'OPERADORA SINTETICA B' },
];
/** Produção sintética da apuração por médico: itens, cirurgias e valores em centavos. */
const PRODUCAO: Readonly<
  Record<number, { itens: number; cirurgias: number; produzido: number; recebido: number; repasse: number }>
> = {
  7001: { itens: 4, cirurgias: 1, produzido: 185_100, recebido: 170_000, repasse: 92_550 },
  7002: { itens: 3, cirurgias: 0, produzido: 60_000, recebido: 60_000, repasse: 30_000 },
};
const SITUACOES_LANCAVEIS = ['em_apuracao', 'apurada'];

const diaAnterior = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};

export class PortaVariavelFaixaMemoria implements PortaVariavelFaixa {
  private seq = 0;
  private readonly equipes: EquipePainel[] = [];
  private readonly regras: RegraPainel[] = [];
  /** `${referente}|${profissional}` já lançado. */
  private readonly lancados = new Set<string>();
  private readonly apuracao: { id: number; numero: string; competencia: string; situacao: string };

  constructor(hoje: Date = new Date()) {
    const comp = `${hoje.toISOString().slice(0, 7)}-01`;
    this.apuracao = { id: 801, numero: '801', competencia: comp, situacao: 'em_apuracao' };
  }

  private conferirMembros(
    membros: readonly z.infer<typeof esquemaMembro>[],
    inicio: string,
  ): MembroEquipeVariavel[] {
    const ms: MembroEquipeVariavel[] = membros.map((m) => ({ ...m, inicio, fim: null }));
    const problemas = [...ms.flatMap((m) => validarMembroEquipe(m)), ...conferirComposicao(ms, inicio)];
    if (problemas.length) throw recusaRegra('Composição da equipe recusada', problemas);
    for (const m of ms) {
      if (m.profissional !== null && !PROFISSIONAIS[m.profissional]) throw naoEncontrado('Profissional');
      if (m.terceiro !== null) throw naoEncontrado('Prestador terceiro');
    }
    return ms;
  }

  private membro(m: MembroEquipeVariavel) {
    return {
      id: ++this.seq,
      profissional: m.profissional,
      terceiro: m.terceiro,
      nome: m.profissional !== null ? (PROFISSIONAIS[m.profissional] ?? '') : '',
      cota: m.cota,
      chefe: m.chefe,
      inicio: m.inicio,
      fim: m.fim,
    };
  }

  async painel(_c: ContextoPortaPropria): Promise<Painel> {
    void _c;
    return {
      regras: [...this.regras]
        .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.codigo.localeCompare(b.codigo))
        .map((r) => ({ ...r, faixas: [...r.faixas] })),
      equipes: [...this.equipes]
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
        .map((e) => ({
          ...e,
          membros: [...e.membros].sort((a, b) => b.inicio.localeCompare(a.inicio) || a.id - b.id),
        })),
      eventos: EVENTOS.map((e) => ({ ...e })),
      fontes: FONTES.map((f) => ({ ...f })),
      apuracoes: [{ ...this.apuracao }],
    };
  }

  async incluirEquipe(_c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaEquipe, entrada);
    const ms = this.conferirMembros(e.membros, e.inicio);
    if (this.equipes.some((x) => x.codigo === e.codigo))
      throw recusaRegra('Equipe recusada', [
        { campo: 'codigo', mensagem: 'Já existe equipe com este código.' },
      ]);
    const id = ++this.seq;
    this.equipes.push({
      id,
      codigo: e.codigo,
      nome: e.nome,
      descricao: e.descricao,
      ativo: true,
      versao: 1,
      membros: ms.map((m) => this.membro(m)),
    });
    return { id };
  }

  async recomporEquipe(_c: ContextoPortaPropria, equipe: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaRecompor, entrada);
    const eq = this.equipes.find((x) => x.id === equipe);
    if (!eq) throw naoEncontrado('Equipe');
    const ms = this.conferirMembros(e.membros, e.inicio);
    if (eq.versao !== e.versao)
      throw recusaRegra('Composição recusada', [
        { campo: 'versao', mensagem: 'A equipe mudou; recarregue.' },
      ]);
    const abertos = eq.membros.filter((m) => m.fim === null || m.fim >= e.inicio);
    if (abertos.some((m) => m.inicio >= e.inicio))
      throw recusaRegra('Composição recusada', [
        {
          campo: 'inicio',
          mensagem: 'Já há composição começando nesta data ou depois; a nova composição começa depois dela.',
        },
      ]);
    const ontem = diaAnterior(e.inicio);
    const membros = eq.membros.map((m) => (abertos.includes(m) ? { ...m, fim: ontem } : m));
    const i = this.equipes.indexOf(eq);
    this.equipes[i] = {
      ...eq,
      ativo: true,
      versao: eq.versao + 1,
      membros: [...membros, ...ms.map((m) => this.membro(m))],
    };
    return { id: equipe };
  }

  async incluirRegra(_c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaRegra, entrada);
    const problemas = validarRegraVariavelFaixa(e);
    if (e.faixas.some((f) => f.ajuste === 'desconto') && e.eventoDesconto === null)
      problemas.push({ campo: 'eventoDesconto', mensagem: 'Faixa de desconto pede o evento de desconto.' });
    if (problemas.length) throw recusaRegra('Regra recusada', problemas);
    const evento = EVENTOS.find((x) => x.id === e.evento && x.natureza === 'rendimento');
    if (!evento)
      throw recusaRegra('Regra recusada', [
        { campo: 'evento', mensagem: 'O evento do acréscimo é um rendimento ativo do estabelecimento.' },
      ]);
    const desconto =
      e.eventoDesconto === null
        ? null
        : EVENTOS.find((x) => x.id === e.eventoDesconto && x.natureza === 'desconto');
    if (desconto === undefined)
      throw recusaRegra('Regra recusada', [
        { campo: 'eventoDesconto', mensagem: 'O evento do desconto é um desconto ativo do estabelecimento.' },
      ]);
    if (e.profissional !== null && !PROFISSIONAIS[e.profissional]) throw naoEncontrado('Profissional');
    const eq = e.equipe === null ? null : this.equipes.find((x) => x.id === e.equipe && x.ativo);
    if (eq === undefined) throw naoEncontrado('Equipe');
    const fonte = e.fontePagadora === null ? null : FONTES.find((x) => x.id === e.fontePagadora);
    if (fonte === undefined) throw naoEncontrado('Fonte pagadora');
    if (e.plano !== null) throw naoEncontrado('Plano');
    if (e.itemFaturavel !== null) throw naoEncontrado('Item faturável');
    if (this.regras.some((r) => r.codigo === e.codigo))
      throw recusaRegra('Regra recusada', [
        { campo: 'codigo', mensagem: 'Já existe regra com este código.' },
      ]);
    const conflito = conflitoRegraVariavel(
      e,
      this.regras
        .filter(
          (r) =>
            r.ativo &&
            r.indicador === e.indicador &&
            r.profissional === e.profissional &&
            r.equipe === e.equipe,
        )
        .map((r) => ({ inicio: r.inicio, fim: r.fim })),
    );
    if (conflito.length) throw recusaRegra('Regra recusada', conflito);
    const id = ++this.seq;
    this.regras.push({
      id,
      codigo: e.codigo,
      descricao: e.descricao,
      profissional: e.profissional,
      equipe: e.equipe,
      beneficiario: eq ? eq.nome : e.profissional !== null ? (PROFISSIONAIS[e.profissional] ?? '') : '',
      indicador: e.indicador,
      periodo: e.periodo,
      fontePagadora: e.fontePagadora,
      fonteNome: fonte?.nome ?? null,
      plano: null,
      itemFaturavel: null,
      considerarPacote: e.considerarPacote,
      percentualPacote: e.percentualPacote,
      evento: e.evento,
      eventoNome: evento.nome,
      eventoDesconto: e.eventoDesconto,
      eventoDescontoNome: desconto?.nome ?? null,
      inicio: e.inicio,
      fim: e.fim,
      ativo: true,
      versao: 1,
      faixas: [...e.faixas].sort((a, b) => a.de - b.de).map((f): FaixaVariavel => ({ ...f })),
    });
    return { id };
  }

  async encerrarRegra(_c: ContextoPortaPropria, regra: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaEncerrar, entrada);
    const i = this.regras.findIndex((r) => r.id === regra);
    const r = this.regras[i];
    if (!r) throw naoEncontrado('Regra de remuneração variável');
    if (x.fim < r.inicio || (r.fim !== null && x.fim >= r.fim))
      throw recusaRegra('Encerramento recusado', [
        {
          campo: 'fim',
          mensagem: 'O fim fica entre o início da vigência e o fim atual; encerrar não estende.',
        },
      ]);
    if (r.versao !== x.versao)
      throw recusaRegra('Encerramento recusado', [
        { campo: 'versao', mensagem: 'A regra mudou; recarregue.' },
      ]);
    this.regras[i] = { ...r, fim: x.fim, versao: r.versao + 1 };
    return { id: regra };
  }

  private conferirApuracao(apuracao: number) {
    if (apuracao !== this.apuracao.id) throw naoEncontrado('Apuração do repasse');
    return this.apuracao;
  }

  /** Medida da regra na produção sintética (só a competência da apuração tem produção). */
  private medir(indicador: IndicadorVariavel, profs: readonly number[], comps: readonly string[]) {
    const p = comps.includes(this.apuracao.competencia)
      ? profs.map((x) => PRODUCAO[x]).filter((x) => !!x)
      : [];
    const soma = (k: 'itens' | 'cirurgias' | 'produzido' | 'recebido' | 'repasse') =>
      p.reduce((s, x) => s + x![k], 0);
    const medidas: Record<IndicadorVariavel, number> = {
      quantidade_procedimentos: soma('itens'),
      quantidade_cirurgias: soma('cirurgias'),
      valor_produzido: soma('produzido') / 100,
      valor_recebido: soma('recebido') / 100,
      resultado: 0,
    };
    return {
      medida: medidas[indicador],
      bruta: soma('repasse'),
      margem: indicador === 'resultado' ? 0 : null,
    };
  }

  private calcular(competencia: string): RegraSimulada[] {
    const fimMes = ultimoDiaDoMes(competencia);
    const out: RegraSimulada[] = [];
    for (const r of this.regras.filter(
      (x) => x.ativo && x.inicio <= fimMes && (x.fim === null || x.fim >= competencia),
    )) {
      const per = periodoDaCompetencia(r.periodo, competencia);
      const dataFim = ultimoDiaDoMes(per.fim);
      const pendencias: string[] = [];
      const referente = `VARF ${r.codigo} ${competencia.slice(0, 7)}`;
      let membros: {
        profissional: number | null;
        terceiro: number | null;
        nome: string;
        cota: number;
        chefe: boolean;
      }[];
      if (r.equipe !== null) {
        const eq = this.equipes.find((x) => x.id === r.equipe);
        membros = eq ? membrosVigentes(eq.membros, dataFim) : [];
        pendencias.push(...(eq ? conferirComposicao(eq.membros, dataFim) : []).map((x) => x.mensagem));
      } else {
        membros = [
          { profissional: r.profissional, terceiro: null, nome: r.beneficiario, cota: 100, chefe: true },
        ];
      }
      const profs = membros.map((x) => x.profissional).filter((x): x is number => x !== null);
      const med = this.medir(r.indicador, profs, per.competencias);
      const calc = calcularVariavelFaixa({
        indicador: r.indicador,
        faixas: r.faixas,
        medida: med.medida,
        producaoBrutaCentavos: med.bruta,
        producaoLiquidaCentavos: med.bruta,
        margemCentavos: med.margem,
      });
      if (!per.fecha)
        pendencias.push(
          `O período ${per.inicio.slice(0, 7)} a ${per.fim.slice(0, 7)} fecha em ${per.fim.slice(0, 7)}; nada a lançar nesta competência.`,
        );
      if (calc.valorCentavos < 0 && r.eventoDesconto === null)
        pendencias.push('Faixa de desconto sem evento de desconto.');
      const partes =
        per.fecha && calc.valorCentavos !== 0 && !pendencias.length
          ? ratearEquipe(calc.valorCentavos, membros)
          : [];
      out.push({
        regra: r.id,
        codigo: r.codigo,
        descricao: r.descricao,
        beneficiario: r.beneficiario,
        indicador: r.indicador,
        periodo: r.periodo,
        periodoInicio: per.inicio,
        periodoFim: per.fim,
        fecha: per.fecha,
        medida: med.medida,
        base: calc.baseCentavos / 100,
        faixa: calc.ordemFaixa,
        percentual: calc.percentual,
        valor: calc.valorCentavos / 100,
        memoria: calc.memoria,
        referente,
        partes: partes.map((pt) => ({
          profissional: pt.membro.profissional,
          terceiro: pt.membro.terceiro,
          nome: pt.membro.nome,
          cota: pt.membro.cota,
          valor: pt.valorCentavos / 100,
          lancado:
            pt.membro.profissional !== null && this.lancados.has(`${referente}|${pt.membro.profissional}`),
        })),
        pendencias,
      });
    }
    return out;
  }

  async simular(_c: ContextoPortaPropria, apuracao: number) {
    const a = this.conferirApuracao(apuracao);
    return {
      apuracao,
      competencia: a.competencia,
      situacao: a.situacao,
      regras: this.calcular(a.competencia),
    };
  }

  async lancar(
    _c: ContextoPortaPropria,
    apuracao: number,
  ): Promise<{ lancamentos: number; credito: number; debito: number; pendencias: string[] }> {
    const a = this.conferirApuracao(apuracao);
    if (!SITUACOES_LANCAVEIS.includes(a.situacao))
      throw recusaRegra('Lançamento recusado', [
        {
          campo: 'apuracao',
          mensagem: 'Só a apuração em apuração ou apurada recebe a remuneração variável.',
        },
      ]);
    const pendencias: string[] = [];
    let lancamentos = 0;
    let credito = 0;
    let debito = 0;
    for (const s of this.calcular(a.competencia)) {
      pendencias.push(...s.pendencias.map((x) => `${s.codigo}: ${x}`));
      const r = this.regras.find((x) => x.id === s.regra)!;
      for (const pt of s.partes) {
        if (pt.lancado || pt.profissional === null || pt.valor === 0) continue;
        if ((pt.valor > 0 ? r.evento : r.eventoDesconto) === null) continue;
        this.lancados.add(`${s.referente}|${pt.profissional}`);
        const cents = Math.round(Math.abs(pt.valor) * 100);
        lancamentos += 1;
        if (pt.valor > 0) credito += cents;
        else debito += cents;
      }
    }
    return { lancamentos, credito: credito / 100, debito: debito / 100, pendencias };
  }
}
