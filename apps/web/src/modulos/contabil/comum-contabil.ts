// Comuns das telas da contabilidade (M54-F1): a busca e o recuo da árvore do plano, as contas que recebem lançamento, o
// rascunho da nova versão da regra (a partir da última publicada ou vazio), a conferência do rascunho antes de simular
// ou publicar, os campos dos fatos que escolhem a conta e os números no formato do Brasil. Funções puras, testadas.
import type {
  ContaDoPlano,
  OrigemLancamento,
  RegraContabilEntrada,
  TipoFato,
  VersaoRegra,
} from '@sgh/contratos';

export { competenciasAte, reais, rotuloCompetencia } from '../folha/comum-folha.js';

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Busca da árvore: código pelo começo (1.1 traz 1.1.01…) ou trecho do nome, sem acento e sem caixa. A conta achada
 * leva junto as de nível acima, para a árvore continuar legível.
 */
export function filtrarContas(contas: readonly ContaDoPlano[], termo: string): ContaDoPlano[] {
  const t = normalizar(termo.trim());
  if (!t) return [...contas];
  const achadas = new Set(
    contas.filter((c) => c.codigo.startsWith(t) || normalizar(c.nome).includes(t)).map((c) => c.codigo),
  );
  const porCodigo = new Map(contas.map((c) => [c.codigo, c]));
  for (const codigo of [...achadas]) {
    let pai = porCodigo.get(codigo)?.pai ?? null;
    while (pai && !achadas.has(pai)) {
      achadas.add(pai);
      pai = porCodigo.get(pai)?.pai ?? null;
    }
  }
  return contas.filter((c) => achadas.has(c.codigo));
}

/** As contas que recebem lançamento (analíticas e ativas), como opções "código nome". */
export const opcoesContasAnaliticas = (contas: readonly ContaDoPlano[]) =>
  contas
    .filter((c) => c.tipo === 'analitica' && c.ativa)
    .map((c) => ({ valor: c.codigo, rotulo: `${c.codigo} ${c.nome}` }));

/** As contas sintéticas, que podem ser a conta de nível acima de uma conta nova. */
export const opcoesContasSinteticas = (contas: readonly ContaDoPlano[]) =>
  contas
    .filter((c) => c.tipo === 'sintetica')
    .map((c) => ({ valor: c.codigo, rotulo: `${c.codigo} ${c.nome}` }));

/** O próximo código livre debaixo da conta sintética, pela máscara (nível seguinte com zeros à esquerda). */
export function proximoCodigoFilho(
  contas: readonly ContaDoPlano[],
  pai: string | null,
  mascara: string,
): string {
  const niveis = mascara.split('.').map((n) => n.length);
  const nivel = pai ? pai.split('.').length : 0;
  const tamanho = niveis[nivel];
  if (tamanho === undefined) return pai ?? '';
  const irmaos = contas
    .filter((c) => (pai ? c.pai === pai : c.nivel === 1))
    .map((c) => Number(c.codigo.split('.').at(-1)))
    .filter((n) => Number.isFinite(n));
  const proximo = String((irmaos.length ? Math.max(...irmaos) : 0) + 1).padStart(tamanho, '0');
  return pai ? `${pai}.${proximo}` : proximo;
}

// ── Regras ─────────────────────────────────────────────────────────────────────────────────────────

/** Os campos dos fatos que podem escolher a conta pela tabela de integração ou entrar numa condição. */
export const CAMPOS_FATO = {
  tipoLancamento: 'Tipo de lançamento do financeiro',
  convenio: 'Convênio',
  tipoTitulo: 'Tipo do título',
  origemTitulo: 'Origem do título',
  tipoTransferencia: 'Tipo de transferência bancária',
  contaDebito: 'Conta bancária de débito',
  contaCredito: 'Conta bancária de crédito',
  grupo: 'Grupo do item',
  subgrupo: 'Subgrupo do item',
  item: 'Item',
  naturezaOperacao: 'Natureza da operação da nota',
  tipoCompra: 'Tipo de compra',
  empresaFolha: 'Empresa da folha',
  rotina: 'Rotina da folha',
  natureza: 'Natureza da verba',
} as const;
export type CampoFato = keyof typeof CAMPOS_FATO;

/** Partida do rascunho (o mesmo formato da regra, sem os padrões do esquema). */
export type PartidaRascunho = RegraContabilEntrada['partidas'][number];
export type RascunhoRegra = {
  -readonly [K in keyof RegraContabilEntrada]-?: Exclude<RegraContabilEntrada[K], undefined>;
};

const partidaVazia = (lado: 'D' | 'C'): PartidaRascunho => ({
  lado,
  conta: { modo: 'fixa', conta: '' },
  valor: { base: 'valorFato' },
  historico: '{documento} {competencia}',
  centroCusto: lado === 'D' ? 'doFato' : 'nenhum',
});

/** A última versão publicada da mesma chave (empresa, origem, fato e nome); `null` se não houver. */
export function ultimaVersao(
  itens: readonly VersaoRegra[],
  chave: { empresa: number; origem: number; tipoFato: string; nome?: string },
): VersaoRegra | null {
  const da = itens.filter(
    (v) =>
      v.regra.empresa === chave.empresa &&
      v.regra.origem === chave.origem &&
      v.regra.tipoFato === chave.tipoFato &&
      (chave.nome === undefined || v.regra.nome === chave.nome),
  );
  return da.reduce<VersaoRegra | null>((m, v) => (!m || v.regra.versao > m.regra.versao ? v : m), null);
}

/**
 * Rascunho da nova versão: copia a última publicada (versão + 1, vigência a começar no dia seguinte ao início dela, se o
 * início pedido não vier) ou começa vazio com uma partida de débito e uma de crédito.
 */
export function novoRascunho(
  base: VersaoRegra | null,
  c: { empresa: number; origem: OrigemLancamento; tipoFato: TipoFato; hoje: string },
): RascunhoRegra {
  if (base) {
    const r = base.regra;
    return {
      empresa: r.empresa,
      origem: r.origem,
      tipoFato: r.tipoFato,
      versao: r.versao + 1,
      nome: r.nome,
      vigenciaInicio: c.hoje > r.vigenciaInicio ? c.hoje : diaSeguinte(r.vigenciaInicio),
      vigenciaFim: null,
      prioridade: r.prioridade,
      condicoes: r.condicoes.map((x) => ({ ...x })),
      partidas: r.partidas.map((p) => ({
        ...p,
        conta: { ...p.conta },
        valor: { ...p.valor },
      })),
    };
  }
  return {
    empresa: c.empresa,
    origem: c.origem,
    tipoFato: c.tipoFato,
    versao: 1,
    nome: '',
    vigenciaInicio: c.hoje,
    vigenciaFim: null,
    prioridade: 100,
    condicoes: [],
    partidas: [partidaVazia('D'), partidaVazia('C')],
  };
}

export const novaPartida = partidaVazia;

export function diaSeguinte(data: string): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Conferência do rascunho na tela, antes de ir ao servidor (que confere de novo com o plano e as outras regras):
 * nome, vigência, contas preenchidas, um débito e um crédito, e os percentuais de cada lado somando 100.
 */
export function problemasDoRascunho(r: RascunhoRegra): string[] {
  const p: string[] = [];
  if (!r.nome.trim()) p.push('nome');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.vigenciaInicio)) p.push('vigencia');
  if (r.vigenciaFim && r.vigenciaFim < r.vigenciaInicio) p.push('vigencia');
  const lados = new Set(r.partidas.map((x) => x.lado));
  if (!lados.has('D') || !lados.has('C')) p.push('lados');
  for (const x of r.partidas) {
    if (x.conta.modo === 'fixa' && !x.conta.conta) p.push('conta');
    if (x.conta.modo === 'dePara' && !x.conta.campoChave) p.push('campoChave');
    if (!x.historico.trim()) p.push('historico');
  }
  for (const lado of ['D', 'C'] as const) {
    const perc = r.partidas.filter((x) => x.lado === lado && x.valor.base === 'percentual');
    if (perc.length) {
      const soma = perc.reduce((s, x) => s + (x.valor.base === 'percentual' ? x.valor.percentual : 0), 0);
      if (Math.abs(soma - 100) > 0.001) p.push('percentual');
    }
  }
  return [...new Set(p)];
}

/** A soma das situações (para o total do resumo, com as parcelas). */
export const somaSituacoes = (s: Readonly<Partial<Record<string, number>>>) =>
  Object.values(s).reduce<number>((a, n) => a + (n ?? 0), 0);

/** 2026-10-28T09:00:00Z → 28/10/2026 09:00 (hora local). */
export function instante(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 2026-09-01 → 01/09/2026. */
export const dataBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '');
