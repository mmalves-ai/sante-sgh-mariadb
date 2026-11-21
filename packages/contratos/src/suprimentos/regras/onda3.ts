// Regras puras da onda 3 (ficha do M41, seção 8). As regras 1 a 8 do M40 valem para todas as ondas e moram no M40;
// estas são as próprias da onda: farmácia depois da prescrição (1), efeitos do estoque só pelas operações de movimento
// (2), acompanhamento dos efeitos por documento (painel da seção 7), documentos do dia por sistema (seção 4), horários
// dispensados contra prescritos e a conferência numérica de saldo e preço médio (seção 10). Nada aqui lê o banco.
import type {
  AlertaEfeito,
  DivergenciaNumerica,
  DocumentosPorSistema,
  EfeitosDocumento,
  HorariosUnidade,
  SetorOnda3,
  TipoDocumentoOnda3,
} from '../onda3.js';
import { OPERACOES_MOVIMENTO_ESTOQUE, SETORES_ONDA3, TABELAS_EFEITO_ESTOQUE } from '../onda3.js';

// ── Regra 1: farmácia depois da prescrição em uso ─────────────────────────────────────────────────────────

export type DecisaoFarmaciaUnidades =
  | { readonly permitido: true }
  | { readonly permitido: false; readonly faltam: readonly string[]; readonly mensagem: string };

/**
 * A chave da dispensação de um local de estoque só liga quando TODAS as unidades atendidas por ele já têm a
 * prescrição eletrônica ligada (a fila de horários nasce da prescrição liberada). Desligar nunca recusa (recolher).
 * Local sem unidade atendida conhecida não liga: sem o mapa, não há como provar a regra.
 */
export function decidirChaveFarmacia(
  ligar: boolean,
  unidadesAtendidas: readonly string[],
  unidadesComPrescricao: readonly string[],
): DecisaoFarmaciaUnidades {
  if (!ligar) return { permitido: true };
  const atendidas = [...new Set(unidadesAtendidas.map((u) => u.trim()).filter(Boolean))].sort();
  if (atendidas.length === 0)
    return {
      permitido: false,
      faltam: [],
      mensagem:
        'Não pode ligar: o local não tem unidade atendida registrada; a dispensação nasce da prescrição da unidade.',
    };
  const com = new Set(unidadesComPrescricao.map((u) => u.trim()));
  const faltam = atendidas.filter((u) => !com.has(u));
  if (faltam.length === 0) return { permitido: true };
  return {
    permitido: false,
    faltam,
    mensagem: `Não pode ligar: a prescrição eletrônica ainda não está ligada na(s) unidade(s) ${faltam.join(', ')}.`,
  };
}

/** Mapa local de estoque → unidades atendidas, a partir das dispensações recentes (local, unidade, quantidade). */
export function unidadesPorLocal(
  linhas: readonly { readonly local: number; readonly unidade: string; readonly dispensacoes: number }[],
  minimo = 1,
): Map<number, string[]> {
  const m = new Map<number, Set<string>>();
  for (const x of linhas) {
    const u = x.unidade.trim();
    if (!u || x.dispensacoes < minimo) continue;
    const s = m.get(x.local) ?? new Set<string>();
    s.add(u);
    m.set(x.local, s);
  }
  return new Map([...m].map(([k, v]) => [k, [...v].sort()]));
}

// ── Setores e ordem ───────────────────────────────────────────────────────────────────────────────────────

export function setorOnda3(id: string): SetorOnda3 | undefined {
  return SETORES_ONDA3.find((s) => s.id === id);
}

/**
 * Ordem recomendada (campo 12): um setor só entra depois dos anteriores liberados. Devolve os anteriores que faltam.
 * A ordem é recomendação do roteiro: o painel avisa, quem decide é o comitê (regra 1 do M40).
 */
export function setoresAntesDe(id: string, liberados: readonly string[]): string[] {
  const s = setorOnda3(id);
  if (!s) return [];
  const ok = new Set(liberados);
  return SETORES_ONDA3.filter((x) => x.ordem < s.ordem && !ok.has(x.id)).map((x) => x.id);
}

/** Todas as operações da onda (P1 e P2), sem repetição. */
export function operacoesDaOnda3(): { p1: string[]; p2: string[] } {
  const p1 = new Set<string>();
  const p2 = new Set<string>();
  for (const s of SETORES_ONDA3) {
    for (const o of s.operacoesP1) p1.add(o);
    for (const o of s.operacoesP2) p2.add(o);
  }
  return { p1: [...p1].sort(), p2: [...p2].filter((o) => !p1.has(o)).sort() };
}

// ── Regra 2: os efeitos do estoque são da operação do domínio ────────────────────────────────────────────────────

export interface OperacaoCatalogada {
  readonly nome: string;
  readonly tabelasGravadas: readonly string[];
}

/**
 * Operações da onda que gravariam uma tabela de efeito sem ser operação de movimento de estoque (deve ser vazio: o
 * catálogo é a prova da regra 2). As operações de movimento gravam os efeitos na transação do documento e não entram.
 */
export function gravacoesEmTabelaDeEfeito(
  operacoes: readonly OperacaoCatalogada[],
): { operacao: string; tabela: string }[] {
  const efeito = new Set<string>(TABELAS_EFEITO_ESTOQUE);
  const { p1, p2 } = operacoesDaOnda3();
  const movimento = new Set<string>(OPERACOES_MOVIMENTO_ESTOQUE);
  const daOnda = new Set([...p1, ...p2].filter((o) => !movimento.has(o)));
  const r: { operacao: string; tabela: string }[] = [];
  for (const o of operacoes) {
    if (!daOnda.has(o.nome)) continue;
    for (const t of new Set(o.tabelasGravadas.map((x) => x.toLowerCase())))
      if (efeito.has(t)) r.push({ operacao: o.nome, tabela: t });
  }
  return r;
}

// ── Efeitos dos gatilhos por documento (painel) ───────────────────────────────────────────────────────────

export interface DocumentoLidoParaEfeito {
  readonly tipo: TipoDocumentoOnda3;
  readonly consolidado: boolean;
  /** Itens do documento com o valor do gatilho e se o item é rastreável. */
  readonly itens: readonly {
    readonly item: number;
    readonly valorMedio: number | null;
    readonly rastreavel: boolean;
    readonly comLote: boolean;
  }[];
  /** Itens com linha no saldo mensal (saldo_estoque_mensal) da competência do documento. */
  readonly itensComSaldoMensal: readonly number[];
  /** O documento tem consumo registrado (consumo_centro_custo); null quando não se aplica (centro técnico, sem centro). */
  readonly comConsumo: boolean | null;
  /** Itens com saldo no local na competência (saldo_estoque); informativo (D-MOTOR-28). */
  readonly itensComSaldoLocal: readonly number[];
}

/** Os tipos cujos itens o gatilho valoriza e lança no saldo mensal (saída, devolução, transferência, nota). */
const MOVIMENTA_SALDO: ReadonlySet<TipoDocumentoOnda3> = new Set([
  'saida',
  'devolucao',
  'transferencia',
  'nota',
]);

/**
 * O efeito esperado num documento do novo. O consumo (consumo_centro_custo) é informativo por padrão: na cópia pc, 274 de 9.619
 * saídas consolidadas de 06/2026 com centro de custo fora de 9901 a 9999 não têm a linha do consumo (a condição do
 * gatilho ainda não foi levantada linha a linha); `exigirConsumo` liga o alerta quando o construtor a fixar.
 */
export function efeitosDoDocumento(
  d: DocumentoLidoParaEfeito,
  opcoes: { readonly exigirConsumo?: boolean } = {},
): {
  efeitos: EfeitosDocumento;
  alertas: AlertaEfeito[];
} {
  if (!d.consolidado || !MOVIMENTA_SALDO.has(d.tipo) || d.itens.length === 0) {
    const nada: EfeitosDocumento = {
      valorizado: null,
      saldoMensal: null,
      consumo: null,
      lote: null,
      saldoLocal: null,
    };
    // A dispensação não movimenta saldo por si: o efeito está na saída que ela gera (acompanhada como saída).
    const alertas: AlertaEfeito[] = !d.consolidado && d.tipo !== 'dispensacao' ? ['nao-consolidado'] : [];
    return { efeitos: nada, alertas };
  }
  const itens = [...new Set(d.itens.map((i) => i.item))];
  const mensal = new Set(d.itensComSaldoMensal);
  const local = new Set(d.itensComSaldoLocal);
  const valorizado = d.itens.every((i) => i.valorMedio !== null && i.valorMedio > 0);
  const saldoMensal = itens.every((i) => mensal.has(i));
  const rastreaveis = d.itens.filter((i) => i.rastreavel);
  const lote = rastreaveis.length === 0 ? null : rastreaveis.every((i) => i.comLote);
  const consumo = d.tipo === 'saida' ? d.comConsumo : null;
  const efeitos: EfeitosDocumento = {
    valorizado,
    saldoMensal,
    consumo,
    lote,
    saldoLocal: itens.every((i) => local.has(i)),
  };
  const alertas: AlertaEfeito[] = [];
  if (!valorizado) alertas.push('sem-valorizacao');
  if (!saldoMensal) alertas.push('sem-saldo-mensal');
  if (consumo === false && opcoes.exigirConsumo === true) alertas.push('sem-consumo');
  if (lote === false) alertas.push('sem-lote');
  return { efeitos, alertas };
}

// ── Documentos do dia por sistema ─────────────────────────────────────────────────────────────────────────

/**
 * Totais do dia (todos os documentos, por tipo e local) contra os do novo (trilha): demais = total − novo. Um total
 * menor que o do novo (documento do novo fora do filtro de data, ou excluído depois) não vira negativo: o painel mostra
 * 0 nos demais e mantém o do novo.
 */
export function documentosPorSistema(
  totais: readonly { tipo: TipoDocumentoOnda3; local: number | null; total: number }[],
  doNovo: readonly { tipo: TipoDocumentoOnda3; local: number | null }[],
): DocumentosPorSistema[] {
  const chave = (t: string, l: number | null) => `${t}|${l ?? ''}`;
  const novo = new Map<string, number>();
  for (const d of doNovo) novo.set(chave(d.tipo, d.local), (novo.get(chave(d.tipo, d.local)) ?? 0) + 1);
  const r = new Map<string, DocumentosPorSistema>();
  for (const t of totais) {
    const k = chave(t.tipo, t.local);
    const anterior = r.get(k);
    const total = (anterior?.total ?? 0) + t.total;
    const nv = novo.get(k) ?? 0;
    r.set(k, { tipo: t.tipo, local: t.local, total, novo: nv, demais: Math.max(0, total - nv) });
  }
  for (const [k, nv] of novo) {
    if (r.has(k)) continue;
    const [tipo, local] = k.split('|') as [TipoDocumentoOnda3, string];
    r.set(k, { tipo, local: local === '' ? null : Number(local), total: nv, novo: nv, demais: 0 });
  }
  return [...r.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || (a.local ?? -1) - (b.local ?? -1));
}

// ── Horários dispensados contra prescritos ────────────────────────────────────────────────────────────────

export function horariosPorUnidade(
  linhas: readonly { unidade: string; prescritos: number; dispensados: number; dispensadosNovo: number }[],
): HorariosUnidade[] {
  const m = new Map<string, { p: number; d: number; n: number }>();
  for (const x of linhas) {
    const u = x.unidade.trim() || '(sem unidade)';
    const a = m.get(u) ?? { p: 0, d: 0, n: 0 };
    m.set(u, { p: a.p + x.prescritos, d: a.d + x.dispensados, n: a.n + x.dispensadosNovo });
  }
  return [...m]
    .map(([unidade, v]) => ({
      unidade,
      prescritos: v.p,
      dispensados: v.d,
      dispensadosNovo: Math.min(v.n, v.d),
      percentual: v.p > 0 ? Math.round((v.d / v.p) * 1000) / 10 : null,
    }))
    .sort((a, b) => a.unidade.localeCompare(b.unidade));
}

// ── Conferência numérica (campo 10) ───────────────────────────────────────────────────────────────────────

export interface LeituraNumerica {
  readonly item: number;
  readonly local: number | null;
  readonly saldo: number;
  readonly precoMedio: number;
}

/** Tolerâncias: quantidade com 3 casas (como o banco) e preço médio com 4 casas (arredondamento do custo médio). */
export const TOLERANCIA_SALDO = 0.0005;
export const TOLERANCIA_PRECO_MEDIO = 0.00005;

/**
 * Para os itens movimentados pelo novo: saldo e preço médio lidos pela outra estação (esperado) contra os lidos aqui.
 * Item que falta de um lado é divergência (lido 0 contra o esperado). O critério de aceite é 0 divergência.
 */
export function conferenciaNumerica(
  esperado: readonly LeituraNumerica[],
  lido: readonly LeituraNumerica[],
): DivergenciaNumerica[] {
  const k = (x: { item: number; local: number | null }) => `${x.item}|${x.local ?? ''}`;
  const daqui = new Map(lido.map((x) => [k(x), x]));
  const r: DivergenciaNumerica[] = [];
  const arred = (v: number, casas: number) => Math.round(v * 10 ** casas) / 10 ** casas;
  for (const e of esperado) {
    const l = daqui.get(k(e)) ?? { item: e.item, local: e.local, saldo: 0, precoMedio: 0 };
    if (Math.abs(e.saldo - l.saldo) > TOLERANCIA_SALDO)
      r.push({
        item: e.item,
        local: e.local,
        campo: 'saldo',
        esperado: e.saldo,
        lido: l.saldo,
        diferenca: arred(l.saldo - e.saldo, 3),
      });
    if (Math.abs(e.precoMedio - l.precoMedio) > TOLERANCIA_PRECO_MEDIO)
      r.push({
        item: e.item,
        local: e.local,
        campo: 'precoMedio',
        esperado: e.precoMedio,
        lido: l.precoMedio,
        diferenca: arred(l.precoMedio - e.precoMedio, 4),
      });
    daqui.delete(k(e));
  }
  for (const l of daqui.values()) {
    if (Math.abs(l.saldo) > TOLERANCIA_SALDO)
      r.push({
        item: l.item,
        local: l.local,
        campo: 'saldo',
        esperado: 0,
        lido: l.saldo,
        diferenca: arred(l.saldo, 3),
      });
    if (Math.abs(l.precoMedio) > TOLERANCIA_PRECO_MEDIO)
      r.push({
        item: l.item,
        local: l.local,
        campo: 'precoMedio',
        esperado: 0,
        lido: l.precoMedio,
        diferenca: arred(l.precoMedio, 4),
      });
  }
  return r.sort(
    (a, b) => a.item - b.item || (a.local ?? -1) - (b.local ?? -1) || a.campo.localeCompare(b.campo),
  );
}

/** Contagem agregada para a tela: abaixo de 5 (e acima de 0) vira '<5'. */
export function contagemAgregada(n: number): number | '<5' {
  return n > 0 && n < 5 ? '<5' : n;
}
