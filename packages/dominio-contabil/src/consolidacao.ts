// Consolidação gerencial de várias empresas (F8, 07-FIN linha 127, C2-101): regras puras, sem banco.
//   - grupo: dois ou mais estabelecimentos, exatamente uma consolidadora (integral, 100%), participação entre 0 e 100
//     (integral só com 100%; a equivalência patrimonial não entra linha a linha);
//   - de-para: cada conta contábil analítica dos membros aponta para uma conta ANALÍTICA do plano gerencial comum de
//     mesma natureza (ativo com ativo, receita com receita...);
//   - apuração mensal (CPC 36 / IFRS 10): soma dos saldos de cada membro pela participação, conta a conta, pelo de-para;
//     eliminação das transações entre empresas do grupo pela conta de contrapartida marcada como entre empresas (débito
//     na conta de saldo credor, crédito na de saldo devedor), uma vez só para o par espelhado; tudo o que impede a
//     consolidação fica listado como pendência (conta com saldo sem de-para, transação sem contrapartida ou fora do
//     grupo, contas da mesma natureza de saldo);
//   - demonstrações: a DRE e o balanço consolidados saem pelas mesmas regras das demonstrações da empresa
//     (demonstracoes.ts) sobre os saldos do plano gerencial comum.
// Valores em centavos (inteiros); saldo com sinal devedor (débitos − créditos).
import type { ContaPlano, GrupoConta } from '@sgh/contratos';
import { montarBalanco, montarDre, reaisBr, type SomaConta } from './demonstracoes.js';

export const METODOS_CONSOLIDACAO = ['integral', 'proporcional', 'equivalencia_patrimonial'] as const;
export type MetodoConsolidacao = (typeof METODOS_CONSOLIDACAO)[number];
export const NATUREZAS_CONTA_GERENCIAL = [
  'ativo',
  'passivo',
  'patrimonio_liquido',
  'receita',
  'custo',
  'despesa',
  'resultado',
  'compensacao',
] as const;
export type NaturezaContaGerencial = (typeof NATUREZAS_CONTA_GERENCIAL)[number];
export type NaturezaSaldo = 'devedora' | 'credora';

export interface RecusaConsolidacao {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

// ── Grupo ────────────────────────────────────────────────────────────────────────────────────────

export interface MembroGrupo {
  readonly estabelecimento: number;
  readonly percentual: number;
  readonly metodo: MetodoConsolidacao;
  readonly consolidadora: boolean;
}

export function conferirGrupoConsolidacao(g: {
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly membros: readonly MembroGrupo[];
}): RecusaConsolidacao | null {
  if (g.vigenciaFim !== null && g.vigenciaFim < g.vigenciaInicio)
    return {
      codigo: 'vigencia-invalida',
      mensagem: 'O fim da vigência é anterior ao início.',
      campos: ['vigenciaFim'],
    };
  if (g.membros.length < 2)
    return {
      codigo: 'membros-insuficientes',
      mensagem: 'Consolidar exige pelo menos dois estabelecimentos no grupo.',
      campos: ['membros'],
    };
  const vistos = new Set<number>();
  for (const m of g.membros) {
    if (vistos.has(m.estabelecimento))
      return {
        codigo: 'membro-repetido',
        mensagem: 'O estabelecimento aparece duas vezes no grupo.',
        campos: ['membros'],
      };
    vistos.add(m.estabelecimento);
    if (!(m.percentual > 0 && m.percentual <= 100))
      return {
        codigo: 'participacao-invalida',
        mensagem: 'A participação fica acima de 0% e até 100%.',
        campos: ['membros'],
      };
    if (m.metodo === 'integral' && m.percentual !== 100)
      return {
        codigo: 'integral-sem-100',
        mensagem:
          'A consolidação integral é de 100%; abaixo disso, use a proporcional ou a equivalência patrimonial.',
        campos: ['membros'],
      };
  }
  const consolidadoras = g.membros.filter((m) => m.consolidadora);
  if (consolidadoras.length !== 1)
    return {
      codigo: 'consolidadora-unica',
      mensagem: 'Marque exatamente um estabelecimento como consolidador do grupo.',
      campos: ['membros'],
    };
  if (consolidadoras[0]!.metodo !== 'integral')
    return {
      codigo: 'consolidadora-integral',
      mensagem: 'O consolidador entra pelo método integral, com 100%.',
      campos: ['membros'],
    };
  return null;
}

/** Fator da participação na soma linha a linha (a equivalência patrimonial não soma linha a linha). */
export function fatorDoMembro(m: Pick<MembroGrupo, 'percentual' | 'metodo'>): number {
  if (m.metodo === 'equivalencia_patrimonial') return 0;
  return m.metodo === 'integral' ? 1 : m.percentual / 100;
}

// ── De-para ──────────────────────────────────────────────────────────────────────────────────────

export interface ContaParaDePara {
  readonly id: number;
  readonly natureza: NaturezaContaGerencial;
  readonly tipo: 'sintetica' | 'analitica';
}

export function conferirDeParaConsolidacao(
  contabil: ContaParaDePara,
  gerencial: ContaParaDePara,
): RecusaConsolidacao | null {
  if (contabil.tipo !== 'analitica')
    return {
      codigo: 'conta-sintetica',
      mensagem: 'Só a conta analítica (a que recebe lançamento) entra no de-para.',
      campos: ['conta'],
    };
  if (gerencial.tipo !== 'analitica')
    return {
      codigo: 'gerencial-sintetica',
      mensagem: 'Escolha uma conta gerencial analítica; a sintética soma as de baixo dela.',
      campos: ['gerencial'],
    };
  if (contabil.natureza !== gerencial.natureza)
    return {
      codigo: 'natureza-diferente',
      mensagem: `A conta é de ${contabil.natureza.replace('_', ' ')} e a gerencial de ${gerencial.natureza.replace('_', ' ')}: escolha uma de mesma natureza.`,
      campos: ['gerencial'],
    };
  return null;
}

export function conferirContaGerencial(c: {
  readonly classificacao: string;
  readonly nivel: number;
  readonly pai: { readonly classificacao: string; readonly tipo: string; readonly natureza: string } | null;
  readonly natureza: string;
}): RecusaConsolidacao | null {
  if (!/^\d+(\.\d+)*$/.test(c.classificacao))
    return {
      codigo: 'classificacao-invalida',
      mensagem: 'A classificação é numérica, com os níveis separados por ponto (ex.: 3.1.01).',
      campos: ['classificacao'],
    };
  if (c.nivel !== c.classificacao.split('.').length)
    return {
      codigo: 'nivel-invalido',
      mensagem: 'O nível é o número de partes da classificação.',
      campos: ['nivel'],
    };
  if (c.nivel > 1 && !c.pai)
    return {
      codigo: 'sem-conta-pai',
      mensagem: 'Cadastre antes a conta sintética de cima (a classificação sem a última parte).',
      campos: ['classificacao'],
    };
  if (c.pai && (c.pai.tipo !== 'sintetica' || c.pai.natureza !== c.natureza))
    return {
      codigo: 'pai-invalido',
      mensagem: 'A conta de cima precisa ser sintética e da mesma natureza.',
      campos: ['classificacao'],
    };
  return null;
}

// ── Apuração ─────────────────────────────────────────────────────────────────────────────────────

export interface SaldoContaMembro {
  readonly estabelecimento: number;
  readonly conta: number;
  readonly anterior: number;
  readonly debitos: number;
  readonly creditos: number;
  /** Partes de débitos e créditos que vieram do lançamento de apuração do resultado. */
  readonly debitosApuracao: number;
  readonly creditosApuracao: number;
}

export interface TransacaoEntreEmpresas {
  readonly id: number;
  readonly estabelecimento: number;
  readonly contraparte: number;
  readonly conta: number;
  readonly contaContraparte: number | null;
  readonly valor: number;
}

export interface EntradaApuracaoConsolidacao {
  readonly competencia: string;
  readonly membros: readonly MembroGrupo[];
  readonly saldos: readonly SaldoContaMembro[];
  /** conta contábil → conta gerencial */
  readonly depara: ReadonlyMap<number, number>;
  /** conta contábil → natureza do saldo (devedora ou credora) */
  readonly naturezaSaldo: ReadonlyMap<number, NaturezaSaldo>;
  readonly transacoes: readonly TransacaoEntreEmpresas[];
  readonly eliminaEntreEmpresas: boolean;
}

export interface LinhaSaldoConsolidado {
  readonly gerencial: number;
  /** null: a linha do total consolidado (com as eliminações) */
  readonly origem: number | null;
  readonly anterior: number;
  readonly debitos: number;
  readonly creditos: number;
  readonly final: number;
  readonly debitosSemApuracao: number;
  readonly creditosSemApuracao: number;
  readonly finalSemApuracao: number;
  readonly eliminadoDebito: number;
  readonly eliminadoCredito: number;
}

export interface EliminacaoGerada {
  readonly sequencia: number;
  readonly transacao: number;
  readonly origem: number;
  readonly contraparte: number;
  readonly debitoConta: number;
  readonly creditoConta: number;
  readonly valor: number;
}

export type TipoPendencia =
  'conta-sem-depara' | 'transacao-sem-contrapartida' | 'transacao-fora-do-grupo' | 'transacao-mesma-natureza';

export interface PendenciaConsolidacao {
  readonly tipo: TipoPendencia;
  readonly estabelecimento: number;
  readonly conta: number | null;
  readonly transacao: number | null;
  readonly valor: number;
}

export interface ResultadoApuracaoConsolidacao {
  readonly linhas: readonly LinhaSaldoConsolidado[];
  readonly eliminacoes: readonly EliminacaoGerada[];
  readonly pendencias: readonly PendenciaConsolidacao[];
  readonly transacoesEliminadas: readonly number[];
  readonly totalEliminado: number;
  readonly conferencia: string;
}

export function conferirCompetenciaConsolidacao(competencia: string): RecusaConsolidacao | null {
  return COMPETENCIA.test(competencia)
    ? null
    : {
        codigo: 'competencia-invalida',
        mensagem: 'Informe a competência no formato AAAA-MM.',
        campos: ['competencia'],
      };
}

const arred = (v: number): number => Math.round(v);

interface Acumulador {
  anterior: number;
  debitos: number;
  creditos: number;
  debitosApuracao: number;
  creditosApuracao: number;
  eliminadoDebito: number;
  eliminadoCredito: number;
}
const novo = (): Acumulador => ({
  anterior: 0,
  debitos: 0,
  creditos: 0,
  debitosApuracao: 0,
  creditosApuracao: 0,
  eliminadoDebito: 0,
  eliminadoCredito: 0,
});

export function apurarConsolidacao(e: EntradaApuracaoConsolidacao): ResultadoApuracaoConsolidacao {
  const membros = new Map(e.membros.map((m) => [m.estabelecimento, m]));
  const pendencias: PendenciaConsolidacao[] = [];
  const porOrigem = new Map<string, Acumulador>();
  const total = new Map<number, Acumulador>();
  const acc = (gerencial: number, origem: number | null): Acumulador => {
    if (origem === null) {
      let a = total.get(gerencial);
      if (!a) total.set(gerencial, (a = novo()));
      return a;
    }
    const k = `${gerencial}:${origem}`;
    let a = porOrigem.get(k);
    if (!a) porOrigem.set(k, (a = novo()));
    return a;
  };
  for (const s of e.saldos) {
    const m = membros.get(s.estabelecimento);
    if (!m) continue;
    const fator = fatorDoMembro(m);
    if (fator === 0) continue;
    const g = e.depara.get(s.conta);
    if (g === undefined) {
      const final = s.anterior + s.debitos - s.creditos;
      if (s.anterior !== 0 || s.debitos !== 0 || s.creditos !== 0)
        pendencias.push({
          tipo: 'conta-sem-depara',
          estabelecimento: s.estabelecimento,
          conta: s.conta,
          transacao: null,
          valor: final,
        });
      continue;
    }
    for (const a of [acc(g, s.estabelecimento), acc(g, null)]) {
      a.anterior += arred(s.anterior * fator);
      a.debitos += arred(s.debitos * fator);
      a.creditos += arred(s.creditos * fator);
      a.debitosApuracao += arred(s.debitosApuracao * fator);
      a.creditosApuracao += arred(s.creditosApuracao * fator);
    }
  }
  // Eliminações (CPC 36): pela conta de contrapartida marcada; o par espelhado (registrado pelos dois lados) uma vez.
  const eliminacoes: EliminacaoGerada[] = [];
  const eliminadas: number[] = [];
  // Registro já eliminado à espera do espelho: a chave do par de contas e do valor → estabelecimentos que registraram.
  const aEspelhar = new Map<string, number[]>();
  if (e.eliminaEntreEmpresas) {
    for (const t of [...e.transacoes].sort((a, b) => a.id - b.id)) {
      const ma = membros.get(t.estabelecimento);
      const mb = membros.get(t.contraparte);
      if (!ma || !mb || fatorDoMembro(ma) === 0 || fatorDoMembro(mb) === 0) {
        pendencias.push({
          tipo: 'transacao-fora-do-grupo',
          estabelecimento: t.estabelecimento,
          conta: t.conta,
          transacao: t.id,
          valor: t.valor,
        });
        continue;
      }
      if (t.contaContraparte === null) {
        pendencias.push({
          tipo: 'transacao-sem-contrapartida',
          estabelecimento: t.estabelecimento,
          conta: t.conta,
          transacao: t.id,
          valor: t.valor,
        });
        continue;
      }
      const chave = [
        Math.min(t.conta, t.contaContraparte),
        Math.max(t.conta, t.contaContraparte),
        t.valor,
      ].join(':');
      const espera = aEspelhar.get(chave) ?? [];
      const espelho = espera.indexOf(t.contraparte);
      if (espelho >= 0) {
        // O outro lado já registrou e foi eliminado: este é o espelho, eliminado junto (uma vez só).
        espera.splice(espelho, 1);
        eliminadas.push(t.id);
        continue;
      }
      const na = e.naturezaSaldo.get(t.conta);
      const nb = e.naturezaSaldo.get(t.contaContraparte);
      if (!na || !nb || na === nb) {
        pendencias.push({
          tipo: 'transacao-mesma-natureza',
          estabelecimento: t.estabelecimento,
          conta: t.conta,
          transacao: t.id,
          valor: t.valor,
        });
        continue;
      }
      const ga = e.depara.get(t.conta);
      const gb = e.depara.get(t.contaContraparte);
      if (ga === undefined || gb === undefined) {
        pendencias.push({
          tipo: 'conta-sem-depara',
          estabelecimento: ga === undefined ? t.estabelecimento : t.contraparte,
          conta: ga === undefined ? t.conta : t.contaContraparte,
          transacao: t.id,
          valor: t.valor,
        });
        continue;
      }
      aEspelhar.set(chave, [...espera, t.estabelecimento]);
      // Proporcional: elimina-se a parte do membro de menor participação.
      const valor = arred(t.valor * Math.min(fatorDoMembro(ma), fatorDoMembro(mb)));
      const debitoConta = na === 'credora' ? t.conta : t.contaContraparte;
      const creditoConta = na === 'credora' ? t.contaContraparte : t.conta;
      eliminacoes.push({
        sequencia: eliminacoes.length + 1,
        transacao: t.id,
        origem: t.estabelecimento,
        contraparte: t.contraparte,
        debitoConta,
        creditoConta,
        valor,
      });
      eliminadas.push(t.id);
      acc(e.depara.get(debitoConta)!, null).eliminadoDebito += valor;
      acc(e.depara.get(creditoConta)!, null).eliminadoCredito += valor;
    }
  }
  const linha = (gerencial: number, origem: number | null, a: Acumulador): LinhaSaldoConsolidado => {
    const debitos = a.debitos + a.eliminadoDebito;
    const creditos = a.creditos + a.eliminadoCredito;
    const debitosSemApuracao = debitos - a.debitosApuracao;
    const creditosSemApuracao = creditos - a.creditosApuracao;
    return {
      gerencial,
      origem,
      anterior: a.anterior,
      debitos,
      creditos,
      final: a.anterior + debitos - creditos,
      debitosSemApuracao,
      creditosSemApuracao,
      finalSemApuracao: a.anterior + debitosSemApuracao - creditosSemApuracao,
      eliminadoDebito: a.eliminadoDebito,
      eliminadoCredito: a.eliminadoCredito,
    };
  };
  const linhas: LinhaSaldoConsolidado[] = [];
  for (const [k, a] of porOrigem) {
    const [g, o] = k.split(':').map(Number) as [number, number];
    linhas.push(linha(g, o, a));
  }
  for (const [g, a] of total) linhas.push(linha(g, null, a));
  linhas.sort((x, y) => x.gerencial - y.gerencial || (x.origem ?? 0) - (y.origem ?? 0));
  const totalEliminado = eliminacoes.reduce((s, x) => s + x.valor, 0);
  const totais = linhas.filter((l) => l.origem === null);
  const somaD = totais.reduce((s, l) => s + l.debitos, 0);
  const somaC = totais.reduce((s, l) => s + l.creditos, 0);
  const conferencia = `Débitos ${reaisBr(somaD)} = créditos ${reaisBr(somaC)} no consolidado (com ${eliminacoes.length} eliminação(ões) somando ${reaisBr(totalEliminado)})`;
  return { linhas, eliminacoes, pendencias, transacoesEliminadas: eliminadas, totalEliminado, conferencia };
}

/** A apuração só grava sem pendência; liberada não se refaz. */
export function conferirApuracaoConsolidacao(a: {
  readonly pendencias: number;
  readonly situacaoAnterior: string | null;
}): RecusaConsolidacao | null {
  if (a.situacaoAnterior === 'liberada')
    return {
      codigo: 'apuracao-liberada',
      mensagem: 'A consolidação desta competência já foi liberada; ela não se refaz.',
      campos: ['competencia'],
    };
  if (a.pendencias > 0)
    return {
      codigo: 'consolidacao-com-pendencia',
      mensagem: `Há ${a.pendencias} pendência(s) na consolidação: resolva o de-para e as contrapartidas antes de apurar.`,
      campos: ['competencia'],
    };
  return null;
}

// ── Demonstrações consolidadas ──────────────────────────────────────────────────────────────────

export interface ContaGerencial {
  readonly id: number;
  readonly classificacao: string;
  readonly descricao: string;
  readonly natureza: NaturezaContaGerencial;
  readonly naturezaSaldo: NaturezaSaldo;
  readonly tipo: 'sintetica' | 'analitica';
}

const GRUPO_DA_NATUREZA: Record<NaturezaContaGerencial, GrupoConta> = {
  ativo: 'ativo',
  passivo: 'passivo',
  patrimonio_liquido: 'patrimonioLiquido',
  resultado: 'patrimonioLiquido',
  receita: 'receita',
  custo: 'custo',
  despesa: 'despesa',
  compensacao: 'compensacao',
};

export function planoGerencialComoPlano(contas: readonly ContaGerencial[], grupo: number): ContaPlano[] {
  return contas.map((c) => ({
    empresa: grupo,
    codigo: c.classificacao,
    nome: c.descricao,
    grupo: GRUPO_DA_NATUREZA[c.natureza],
    tipo: c.tipo,
    natureza: c.naturezaSaldo,
    referencialTipo: null,
    referencialConta: null,
    contaExportacao: null,
    exigeCentroCusto: false,
    ativa: true,
  }));
}

export interface SaldoGerencialMes {
  readonly gerencial: number;
  readonly competencia: string;
  readonly debitosSemApuracao: number;
  readonly creditosSemApuracao: number;
  readonly final: number;
}

/**
 * A DRE do mês e o balanço no fim do mês consolidados: os saldos do total (origem nula) do plano gerencial comum, de
 * janeiro até a competência (o resultado do exercício ainda não apurado).
 */
export function demonstracoesConsolidadas(
  contas: readonly ContaGerencial[],
  grupo: number,
  competencia: string,
  saldos: readonly SaldoGerencialMes[],
) {
  const plano = planoGerencialComoPlano(contas, grupo);
  const codigo = new Map(contas.map((c) => [c.id, c.classificacao]));
  const doMes = saldos.filter((s) => s.competencia === competencia);
  const mov = (l: readonly SaldoGerencialMes[]): SomaConta[] =>
    l.flatMap((s) => {
      const conta = codigo.get(s.gerencial);
      return conta ? [{ conta, debitos: s.debitosSemApuracao, creditos: s.creditosSemApuracao }] : [];
    });
  const acumulado: SomaConta[] = doMes.flatMap((s) => {
    const conta = codigo.get(s.gerencial);
    if (!conta) return [];
    return [{ conta, debitos: Math.max(s.final, 0), creditos: Math.max(-s.final, 0) }];
  });
  const exercicio = competencia.slice(0, 4);
  const doExercicio = mov(
    saldos.filter((s) => s.competencia.startsWith(exercicio) && s.competencia <= competencia),
  );
  return {
    dre: montarDre(plano, mov(doMes)),
    balanco: montarBalanco(plano, acumulado, doExercicio),
  };
}
