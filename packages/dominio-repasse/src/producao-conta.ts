// Sincronização da produção do repasse com os itens da conta do paciente (F3, motores). A regra mora aqui, pura sobre
// uma porta (PortaProducaoConta): quem fala com o banco é @sgh/persistencia (repasse-producao/porta.ts), e a API
// (faturamento, repasse, operadora/TISS) e o worker (glosa do financeiro) chamam a mesma função, na transação de quem
// mudou a conta. Contrato de efeito (apps/api/src/modulos/repasse/producao-conta.int.spec.ts e
// glosa-repasse.int.spec.ts):
//   - lançamento (repasse.momentoProducao = lancamento) ou fechamento: uma produção 'pendente' por profissional e
//     função do item cobrado, com a base faturada e a prévia do repasse pela regra vigente na data do item;
//   - item estornado, sem cobrança, transferido ou excluído: a produção não apurada passa a 'estornado'; a já apurada
//     ou paga ganha débito (estorno_repasse 'pendente') do restante no período seguinte e passa a 'estornado';
//   - glosa (repasse.estornoEmGlosa): antes da apuração reduz a base (total: estorna); depois, débito proporcional;
//   - glosa revertida: antes da apuração a base volta; depois, o débito ainda não descontado é cancelado e o excesso
//     já descontado numa apuração conferida volta ao profissional como crédito (lançamento de repasse de ajuste);
//   - o débito cai no primeiro período aberto a partir do seguinte ao da conta e do mês do evento.
// Idempotente: sincronizar de novo não duplica produção, débito nem crédito.
import {
  type BaseCalculoRepasse,
  definicaoParametro,
  type ItemProducao,
  type RegraRepasse,
} from '@sgh/contratos';
import type { ModoAdicional } from './adicionais.js';
import { calcularItem, type OpcoesCalculo } from './calculo.js';
import { centavos, reais } from './dinheiro.js';
import {
  type RegraRepasseParticularIntegral,
  regraRepasseParticularIntegral,
} from './particular-integral.js';
import {
  type AcaoEstornoProducao,
  competenciaDoDebito,
  estornoDaProducao,
  type EventoProducao,
  type FuncaoCobranca,
  funcaoTitular,
  geraNoEvento,
  type ItemContaProducao,
  momentoDoParametro,
  type ProducaoPlanejada,
  producoesDoItem,
} from './producao.js';

/** A conta, travada pela porta (as sincronizações da mesma conta correm em fila). */
export interface ContaDaProducao {
  readonly id: number;
  readonly fontePagadora: number;
  readonly natureza: string;
  /** AAAA-MM. */
  readonly competencia: string;
  readonly situacao: string;
  readonly especialidade: number | null;
  readonly local: number | null;
  readonly unidade: number | null;
  readonly centroCusto: number | null;
  /** O mês civil de hoje no fuso do estabelecimento (AAAA-MM). */
  readonly mesAtual: string;
}

export interface ItemDaConta {
  readonly item: ItemContaProducao;
  /** Data e hora civis da realização no fuso do estabelecimento (AAAA-MM-DD, HH:MM). */
  readonly data: string;
  readonly hora: string;
  readonly procedimento: number;
  readonly grupoAto: number | null;
  readonly centroCusto: number | null;
  readonly tipoLancamento: number | null;
}

/** Uma produção já gravada do item, com o que a apuração conferida já levou e o já debitado (reais). */
export interface ProducaoExistente {
  readonly id: number;
  readonly versao: number;
  readonly item: number;
  readonly profissional: number;
  readonly prestador: number | null;
  readonly funcao: number;
  readonly situacao: string;
  readonly valorBase: number;
  readonly valorRepasse: number | null;
  /** Repasse da produção numa apuração que já passou da fase aberta; null: não integrada. */
  readonly apurado: number | null;
  /** Débitos não cancelados menos os créditos já lançados para a produção (reais). */
  readonly estornado: number;
}

export interface DebitoAberto {
  readonly id: number;
  readonly versao: number;
  readonly valor: number;
}

/** A regra integral da consulta particular como o banco a guarda (ADR 0009); o domínio a confere. */
export interface IntegralBruta {
  readonly fontePagadoraId: number;
  readonly tipoFonte: string;
  readonly profissionalId: number | null;
  readonly itemFaturavelId: number | null;
  readonly grupoFaturamentoId: number | null;
}

export interface IntegraisBrutas {
  readonly brutas: readonly IntegralBruta[];
  readonly grupoDoProcedimento: ReadonlyMap<number, number>;
}

export interface NovaProducao {
  readonly item: number;
  readonly conta: number;
  readonly profissional: number;
  readonly prestador: number | null;
  readonly funcao: number;
  readonly tipoLancamento: number | null;
  readonly quantidade: number;
  readonly valorBase: number;
  readonly percentual: number | null;
  readonly valorRepasse: number | null;
  readonly pertencePacote: boolean;
}

export interface NovoDebito {
  readonly producao: number;
  readonly conta: number;
  readonly item: number;
  readonly valor: number;
  /** AAAA-MM. */
  readonly competencia: string;
  readonly motivo: 'glosa' | 'ajuste';
}

/** O excesso de débito já descontado numa apuração conferida, devolvido ao profissional (glosa revertida). */
export interface NovoCredito {
  readonly producao: number;
  readonly conta: number;
  readonly item: number;
  readonly valor: number;
  readonly competencia: string;
}

export interface PortaProducaoConta {
  travarConta(conta: number): Promise<ContaDaProducao>;
  /** O valor vigente de cada chave (estabelecimento, senão rede, senão o padrão do catálogo). */
  parametros(chaves: readonly string[]): Promise<ReadonlyMap<string, string>>;
  itens(conta: number, itens?: readonly number[]): Promise<readonly ItemDaConta[]>;
  funcoes(): Promise<readonly FuncaoCobranca[]>;
  /** Travadas (FOR UPDATE). */
  producoes(itens: readonly number[]): Promise<readonly ProducaoExistente[]>;
  /** Competências (AAAA-MM) depois de `depoisDe` com apuração já conferida. */
  competenciasFechadas(depoisDe: string): Promise<ReadonlySet<string>>;
  regras(data: string, fontePagadora: number): Promise<readonly RegraRepasse[]>;
  integrais(data: string): Promise<IntegraisBrutas>;
  cooperativa(profissional: number): Promise<number | null>;
  incluirProducao(p: NovaProducao): Promise<number>;
  alterarProducao(
    id: number,
    versao: number,
    campos: { readonly situacao?: string; readonly valorBase?: number; readonly limparPrevia?: boolean },
  ): Promise<void>;
  /** Débitos ainda não descontados (pendentes, ou aplicados numa apuração ainda aberta), do mais novo ao mais velho. */
  debitosAbertos(producao: number): Promise<readonly DebitoAberto[]>;
  cancelarDebito(id: number, versao: number): Promise<void>;
  incluirDebito(d: NovoDebito): Promise<void>;
  /** Falso: ainda não há o lançamento da apuração de onde tirar o favorecido e o evento (fica para depois). */
  incluirCredito(c: NovoCredito): Promise<boolean>;
}

export interface ResumoProducaoConta {
  readonly geradas: number;
  readonly estornadas: number;
  readonly reduzidas: number;
  readonly debitos: number;
  /** Produções com débito a mais desfeito (glosa revertida depois da apuração). */
  readonly creditos: number;
  /** Itens que não geraram produção, por motivo (contagem). */
  readonly pendencias: Readonly<Record<string, number>>;
}

export const CHAVES_PARAMETRO_PRODUCAO = [
  'repasse.momentoProducao',
  'repasse.estornoEmGlosa',
  'repasse.basePadrao',
  'repasse.adicionalModo',
  'repasse.feriados',
] as const;

/** O padrão do catálogo de parâmetros (para quem lê o valor do banco e não acha). */
export const padraoParametro = (chave: string): string => definicaoParametro(chave)?.padrao ?? '';

/** As regras integrais conferidas pelo domínio, com as fontes particulares (opções do motor de cálculo). */
export function integraisDoDia(x: IntegraisBrutas): {
  integrais: RegraRepasseParticularIntegral[];
  grupoDoProcedimento: ReadonlyMap<number, number>;
  fontesParticulares: ReadonlySet<number>;
} {
  const integrais = x.brutas.map((b) => regraRepasseParticularIntegral(b));
  return {
    integrais,
    grupoDoProcedimento: x.grupoDoProcedimento,
    fontesParticulares: new Set(integrais.map((i) => i.fontePagadoraId)),
  };
}

const chave = (p: { profissional: number; prestador: number | null; funcao: number }) =>
  `${p.profissional}:${p.prestador ?? 0}:${p.funcao}`;

type Resumo = {
  geradas: number;
  estornadas: number;
  reduzidas: number;
  debitos: number;
  creditos: number;
  pendencias: Record<string, number>;
};

/** Sincroniza a produção do repasse com os itens da conta (todos, ou só os informados). */
export async function sincronizarProducaoDaConta(
  porta: PortaProducaoConta,
  d: { readonly conta: number; readonly itens?: readonly number[]; readonly evento: EventoProducao },
): Promise<ResumoProducaoConta> {
  const conta = await porta.travarConta(d.conta);
  const par = await porta.parametros(CHAVES_PARAMETRO_PRODUCAO);
  const momento = momentoDoParametro(par.get('repasse.momentoProducao'));
  const estornoEmGlosa = par.get('repasse.estornoEmGlosa') !== 'false';
  const opcoesBase = {
    basePadrao: (par.get('repasse.basePadrao') || 'cobrado') as BaseCalculoRepasse,
    modoAdicional: (par.get('repasse.adicionalModo') || 'sobre-valor') as ModoAdicional,
    feriados: new Set(
      (par.get('repasse.feriados') ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  };
  const itens = await porta.itens(conta.id, d.itens);
  const resumo: Resumo = { geradas: 0, estornadas: 0, reduzidas: 0, debitos: 0, creditos: 0, pendencias: {} };
  if (itens.length === 0) return resumo;
  const contaFechada = ['fechada', 'faturada', 'enviada', 'paga'].includes(conta.situacao);
  const titular = funcaoTitular(await porta.funcoes());
  const existentes = await porta.producoes(itens.map((i) => i.item.id));
  const fechadas = await porta.competenciasFechadas(conta.competencia);
  const competenciaDebito = competenciaDoDebito(conta.competencia, conta.mesAtual, fechadas);
  const porItem = new Map<number, ProducaoExistente[]>();
  for (const p of existentes) porItem.set(p.item, [...(porItem.get(p.item) ?? []), p]);

  const motores = new Map<string, { regras: readonly RegraRepasse[]; opcoes: OpcoesCalculo }>();
  const motorDoDia = async (data: string) => {
    let m = motores.get(data);
    if (!m) {
      const regras = await porta.regras(data, conta.fontePagadora);
      m = { regras, opcoes: { ...opcoesBase, ...integraisDoDia(await porta.integrais(data)) } };
      motores.set(data, m);
    }
    return m;
  };
  const cooperativas = new Map<number, number | null>();
  const cooperativaDe = async (profissional: number) => {
    if (!cooperativas.has(profissional))
      cooperativas.set(profissional, await porta.cooperativa(profissional));
    return cooperativas.get(profissional) ?? null;
  };

  for (const it of itens) {
    const plano = producoesDoItem(it.item, titular);
    if (plano.pendencia) resumo.pendencias[plano.pendencia] = (resumo.pendencias[plano.pendencia] ?? 0) + 1;
    const planejadas = new Map(plano.producoes.map((p) => [chave(p), p]));
    const vistas = new Set<string>();
    for (const g of porItem.get(it.item.id) ?? []) {
      const k = chave(g);
      vistas.add(k);
      const integrada = g.apurado !== null || g.situacao === 'apurado' || g.situacao === 'pago';
      const base = centavos(g.valorBase);
      const acao = estornoDaProducao(
        it.item,
        {
          situacao: g.situacao,
          integrada,
          vigente: planejadas.has(k),
          baseCentavos: base,
          baseOriginalCentavos: planejadas.get(k)?.baseCentavos ?? base,
          repassadoCentavos: centavos(g.apurado ?? g.valorRepasse ?? 0),
          jaEstornadoCentavos: centavos(g.estornado),
          competenciaDebito,
        },
        estornoEmGlosa,
      );
      await aplicar(porta, acao, { id: g.id, versao: g.versao, conta: conta.id, item: it.item.id }, resumo);
    }
    if (!geraNoEvento(momento, d.evento, contaFechada)) continue;
    for (const p of plano.producoes) {
      if (vistas.has(chave(p))) continue;
      // Glosa já registrada no item quando a produção nasce: a mesma regra do estorno antes da apuração.
      const antes = estornoDaProducao(
        it.item,
        {
          situacao: 'pendente',
          integrada: false,
          vigente: true,
          baseCentavos: p.baseCentavos,
          baseOriginalCentavos: p.baseCentavos,
          repassadoCentavos: 0,
          jaEstornadoCentavos: 0,
          competenciaDebito,
        },
        estornoEmGlosa,
      );
      if (antes.acao === 'estornar') continue;
      const baseCentavos = antes.acao === 'reduzir' ? antes.baseCentavos : p.baseCentavos;
      await gerar(
        porta,
        { ...p, baseCentavos },
        it,
        conta,
        await motorDoDia(it.data),
        await cooperativaDe(p.profissional),
      );
      resumo.geradas += 1;
    }
  }
  return resumo;
}

async function gerar(
  porta: PortaProducaoConta,
  p: ProducaoPlanejada,
  it: ItemDaConta,
  conta: ContaDaProducao,
  motor: { regras: readonly RegraRepasse[]; opcoes: OpcoesCalculo },
  cooperativa: number | null,
): Promise<number> {
  // As mesmas dimensões que a apuração lê da produção: a prévia bate com o recálculo (teste dourado).
  const item: ItemProducao = {
    id: it.item.id,
    data: it.data,
    hora: it.hora.slice(0, 5),
    convenio: conta.fontePagadora,
    procedimento: it.procedimento,
    especialidade: conta.especialidade,
    ato: p.funcao,
    grupoAto: it.grupoAto,
    local: conta.local,
    unidade: conta.unidade,
    centroCusto: it.centroCusto ?? conta.centroCusto,
    cooperativa,
    tipoLancamento: it.tipoLancamento,
    tipoConta: conta.natureza === 'internacao' ? 'I' : 'E',
    executante: p.profissional,
    cobrado: reais(p.baseCentavos),
    pago: 0,
    recursoDeferido: 0,
    conciliado: false,
  };
  const m = calcularItem(item, [...motor.regras], motor.opcoes);
  return porta.incluirProducao({
    item: it.item.id,
    conta: conta.id,
    profissional: p.profissional,
    prestador: p.prestador,
    funcao: p.funcao,
    tipoLancamento: it.tipoLancamento,
    quantidade: p.quantidade,
    valorBase: reais(p.baseCentavos),
    percentual: m.pendencia ? null : m.percentual || null,
    valorRepasse: m.pendencia ? null : reais(m.valorCentavos),
    pertencePacote: it.item.pertencePacote,
  });
}

type Alvo = { id: number; versao: number; conta: number; item: number };

async function aplicar(
  porta: PortaProducaoConta,
  acao: AcaoEstornoProducao,
  p: Alvo,
  resumo: Resumo,
): Promise<void> {
  if (acao.acao === 'nada') return;
  if (acao.acao === 'estornar') {
    await porta.alterarProducao(p.id, p.versao, { situacao: 'estornado' });
    resumo.estornadas += 1;
    return;
  }
  if (acao.acao === 'reduzir' || acao.acao === 'reativar') {
    // A prévia do repasse é refeita pela apuração (o recálculo usa a base nova); aqui ela sai até lá.
    await porta.alterarProducao(p.id, p.versao, {
      valorBase: reais(acao.baseCentavos),
      limparPrevia: true,
      ...(acao.acao === 'reativar' ? { situacao: 'pendente' } : {}),
    });
    resumo.reduzidas += 1;
    return;
  }
  const alvo = { producao: p.id, conta: p.conta, item: p.item };
  if (acao.acao === 'debitar') {
    await porta.incluirDebito({
      ...alvo,
      valor: reais(acao.valorCentavos),
      competencia: acao.competencia,
      motivo: acao.motivo,
    });
    if (acao.encerrar) await porta.alterarProducao(p.id, p.versao, { situacao: 'estornado' });
    resumo.debitos += 1;
    return;
  }
  const r = planoDoCredito(acao.valorCentavos, await porta.debitosAbertos(p.id));
  for (const e of r.cancelar) await porta.cancelarDebito(e.id, e.versao);
  if (r.debitoNovoCentavos > 0)
    await porta.incluirDebito({
      ...alvo,
      valor: reais(r.debitoNovoCentavos),
      competencia: acao.competencia,
      motivo: 'glosa',
    });
  if (r.creditoCentavos > 0) {
    // O excesso já descontado numa apuração conferida não volta pelo cancelamento: vira crédito ao profissional. O
    // já estornado da produção (ProducaoExistente.estornado) é líquido dos créditos: repetir não lança de novo.
    if (
      !(await porta.incluirCredito({
        ...alvo,
        valor: reais(r.creditoCentavos),
        competencia: acao.competencia,
      }))
    )
      resumo.pendencias['credito-sem-lancamento'] = (resumo.pendencias['credito-sem-lancamento'] ?? 0) + 1;
  }
  if (acao.reabrir) await porta.alterarProducao(p.id, p.versao, { situacao: 'apurado' });
  resumo.creditos += 1;
}

/**
 * Glosa revertida depois da apuração: cancela os débitos ainda não descontados, do mais novo ao mais velho, até
 * cobrir o excesso; o que passar do excesso volta como débito novo; o que faltar (já descontado numa apuração
 * conferida) é o crédito ao profissional.
 */
export function planoDoCredito(
  excessoCentavos: number,
  abertos: readonly DebitoAberto[],
): { cancelar: DebitoAberto[]; debitoNovoCentavos: number; creditoCentavos: number } {
  const cancelar: DebitoAberto[] = [];
  let cancelado = 0;
  for (const e of abertos) {
    if (cancelado >= excessoCentavos) break;
    cancelar.push(e);
    cancelado += centavos(e.valor);
  }
  return {
    cancelar,
    debitoNovoCentavos: Math.max(0, cancelado - excessoCentavos),
    creditoCentavos: Math.max(0, excessoCentavos - cancelado),
  };
}

/**
 * O débito do repasse (estornos de produção descontados na apuração) abatido no lançamento do profissional: o
 * lançamento da apuração leva o bruto, e o débito sai num lançamento de estorno ligado a ele (o RPA soma os dois e
 * paga o líquido). O estorno nunca passa do bruto do lançamento; o que sobra fica como saldo devedor do profissional.
 */
export function descontoDoDebito(
  brutoCentavos: number,
  debitoCentavos: number,
): { estornoCentavos: number; saldoCentavos: number } {
  const bruto = Math.max(0, brutoCentavos);
  const debito = Math.max(0, debitoCentavos);
  const estorno = Math.min(bruto, debito);
  return { estornoCentavos: estorno, saldoCentavos: debito - estorno };
}
