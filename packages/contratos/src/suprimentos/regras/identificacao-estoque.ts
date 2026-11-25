// F3.6 (05-SUP linha 14): identificação do estoque por código. Duas metades, funções puras:
//   - a etiqueta de identificação (`etiqueta_identificacao`): o identificador único por unidade ou embalagem e o
//     conteúdo do DataMatrix (cadeia GS1 com o separador FNC1/GS) e do código de barras linear, com o texto legível;
//   - a leitura pelo padrão configurado (`padrao_leitura_codigo`): expressão própria com grupos nomeados ou campos por
//     prefixo (identificador de aplicação), posição e tamanho, com o formato da data; sem padrão que reconheça, a
//     leitura GS1 da embalagem. O que foi lido se resolve contra a etiqueta do próprio hospital (identificador) e
//     contra o código de barras do item (`insumo_codigo_barras`, com a quantidade que a leitura representa).
// A mesma leitura serve à entrada, à saída e à dispensação: a tela lê, a API resolve e confere o lote e a validade.
import { GS, gtin14 } from './farmacia-etiqueta.js';
import { lerCodigoEmbalagem } from './opme.js';
import { type RecusaSuprimentos, recusa } from './recusa.js';

// ── Etiqueta ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Dígito verificador GS1 (módulo 10, pesos 3 e 1 a partir da direita) dos dígitos sem o verificador. */
export function digitoGs1(semVerificador: string): number {
  let soma = 0;
  for (let i = 0; i < semVerificador.length; i++) {
    const d = Number(semVerificador[semVerificador.length - 1 - i]);
    soma += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (soma % 10)) % 10;
}

/**
 * Identificador único da etiqueta no estabelecimento: prefixo "E", o número sequencial em base 36 e um dígito de
 * conferência (o leitor que troca um caractere cai na recusa, não noutra etiqueta). Só letras maiúsculas e dígitos:
 * cabe no Code 128 e no campo 21 (série) do GS1.
 */
export function identificadorEtiqueta(sequencial: number): string {
  if (!Number.isSafeInteger(sequencial) || sequencial < 1) throw new RangeError('sequencial inválido');
  const corpo = sequencial.toString(36).toUpperCase().padStart(6, '0');
  return `E${corpo}${conferenciaIdentificador(corpo)}`;
}

function conferenciaIdentificador(corpo: string): string {
  let s = 0;
  for (let i = 0; i < corpo.length; i++) s += parseInt(corpo[i] as string, 36) * (i + 1);
  return (s % 36).toString(36).toUpperCase();
}

/** O identificador tem o formato e o dígito de conferência de uma etiqueta do próprio hospital. */
export function identificadorValido(texto: string): boolean {
  const m = /^E([0-9A-Z]{6,})([0-9A-Z])$/.exec(texto.trim().toUpperCase());
  return m !== null && conferenciaIdentificador(m[1] as string) === m[2];
}

export interface EtiquetaParaMontar {
  readonly identificador: string;
  /** GTIN do item (opcional): sem ele, o DataMatrix leva só a validade, o lote e o identificador. */
  readonly gtin?: string | null;
  readonly lote?: string | null;
  /** AAAA-MM-DD. */
  readonly validade?: string | null;
}

export interface EtiquetaMontada {
  /** Conteúdo do DataMatrix GS1 (campos variáveis terminados pelo separador GS, como o leitor devolve). */
  readonly datamatrix: string;
  /** Conteúdo do código de barras linear (Code 128): o identificador, que a leitura resolve na etiqueta. */
  readonly barras: string;
  /** Texto legível impresso sob os códigos: "(01)…(17)…(10)…(21)…". */
  readonly legivel: string;
}

/** Confere os dados da etiqueta (identificador do hospital, GTIN com verificador, lote até 20, validade real). */
export function conferirEtiqueta(e: EtiquetaParaMontar): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!identificadorValido(e.identificador))
    r.push(recusa('identificador-invalido', 'O identificador da etiqueta não confere.', ['identificador']));
  if (e.gtin && !gtin14(e.gtin))
    r.push(recusa('gtin-invalido', 'O código GTIN do item não confere (dígito verificador).', ['gtin']));
  if (e.lote && !/^[\x21-\x7e]{1,20}$/.test(e.lote.trim()))
    r.push(
      recusa('lote-etiqueta-invalido', 'O lote da etiqueta tem até 20 caracteres, sem espaço nem acento.', [
        'lote',
      ]),
    );
  if (e.validade && !dataReal(e.validade))
    r.push(recusa('validade-invalida', 'A validade da etiqueta não é uma data válida.', ['validade']));
  return r;
}

/** Monta o conteúdo dos códigos da etiqueta; chame `conferirEtiqueta` antes (dado inválido lança). */
export function montarEtiqueta(e: EtiquetaParaMontar): EtiquetaMontada {
  const recusas = conferirEtiqueta(e);
  if (recusas.length) throw new RangeError(recusas.map((x) => x.codigo).join(', '));
  const id = e.identificador.trim().toUpperCase();
  const g = e.gtin ? gtin14(e.gtin) : null;
  const lote = e.lote?.trim() || null;
  const val = e.validade
    ? `${e.validade.slice(2, 4)}${e.validade.slice(5, 7)}${e.validade.slice(8, 10)}`
    : null;
  // Campos de tamanho fixo primeiro (01, 17), os variáveis depois, cada um fechado pelo GS menos o último.
  const fixos = `${g ? `01${g}` : ''}${val ? `17${val}` : ''}`;
  const variaveis = [lote ? `10${lote}` : null, `21${id}`].filter((x): x is string => x !== null).join(GS);
  return {
    datamatrix: fixos + variaveis,
    barras: id,
    legivel: `${g ? `(01)${g}` : ''}${val ? `(17)${val}` : ''}${lote ? `(10)${lote}` : ''}(21)${id}`,
  };
}

function dataReal(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

// ── Leitura pelo padrão configurado ─────────────────────────────────────────────────────────────────────────────────

export type CampoLeitura = 'produto' | 'validade' | 'lote' | 'serie';

/** Um campo do padrão: prefixo (identificador de aplicação), posição na leitura e tamanho fixo ("6") ou faixa ("1-20"). */
export interface CampoPadrao {
  readonly prefixo: string | null;
  readonly ordem: number | null;
  readonly tamanho: string | null;
}

/** O padrão de leitura configurado (vocabulário neutro de `padrao_leitura_codigo`). */
export interface PadraoLeitura {
  readonly id: number;
  readonly ativo: boolean;
  /** Expressão com grupos nomeados `produto`, `validade`, `lote` e `serie` (tem precedência sobre os campos). */
  readonly expressao: string | null;
  readonly campos: Partial<Record<CampoLeitura, CampoPadrao>>;
  /** AAMMDD (padrão GS1), AAAAMMDD, DDMMAAAA, DDMMAA, MMAAAA ou MMAA; mês sem dia vira o último dia do mês. */
  readonly formatoData: string | null;
  /** Tira os zeros à esquerda do código do produto antes de procurar o item. */
  readonly zerosEsquerda: boolean;
}

export interface CodigoLido {
  /** Código do produto como lido (GTIN ou código próprio do fornecedor). */
  readonly produto: string | null;
  readonly lote: string | null;
  readonly serie: string | null;
  /** AAAA-MM-DD. */
  readonly validade: string | null;
  /** Padrão que reconheceu a leitura (nulo: leitura GS1 ou código simples). */
  readonly padraoId: number | null;
}

/** Converte a data lida conforme o formato do padrão para AAAA-MM-DD (nulo se não for uma data real). */
export function dataPeloFormato(texto: string, formato: string | null): string | null {
  const f = (formato ?? 'AAMMDD').toUpperCase();
  const t = texto.trim();
  if (!/^\d+$/.test(t) || t.length !== f.length) return null;
  const pega = (k: string): string | null => {
    const i = f.indexOf(k);
    return i < 0 ? null : t.slice(i, i + k.length);
  };
  const ano = pega('AAAA') ?? (pega('AA') !== null ? `20${pega('AA')}` : null);
  const mes = pega('MM');
  if (ano === null || mes === null) return null;
  const m = Number(mes);
  if (m < 1 || m > 12) return null;
  let dia = f.includes('DD') ? Number(pega('DD')) : 0;
  if (dia === 0) dia = new Date(Date.UTC(Number(ano), m, 0)).getUTCDate();
  const iso = `${ano}-${mes}-${String(dia).padStart(2, '0')}`;
  return dataReal(iso) ? iso : null;
}

function faixa(tamanho: string | null): readonly [number, number] | null {
  if (!tamanho) return null;
  const m = /^\s*(\d{1,3})\s*(?:-\s*(\d{1,3}))?\s*$/.exec(tamanho);
  if (!m) return null;
  const min = Number(m[1]);
  const max = m[2] !== undefined ? Number(m[2]) : min;
  return min >= 1 && max >= min ? [min, max] : null;
}

/** Aplica um padrão à leitura; nulo quando o padrão não reconhece o texto (outro padrão ou a leitura GS1 tentam). */
export function lerPeloPadrao(texto: string, p: PadraoLeitura): CodigoLido | null {
  if (!p.ativo) return null;
  const t = texto.trim().replace(/^\][A-Za-z]\d/, '');
  if (!t) return null;
  const brutos: Partial<Record<CampoLeitura, string>> = {};
  if (p.expressao) {
    let re: RegExp;
    try {
      re = new RegExp(p.expressao);
    } catch {
      return null;
    }
    const g = re.exec(t)?.groups;
    if (!g) return null;
    for (const k of ['produto', 'validade', 'lote', 'serie'] as const) if (g[k]) brutos[k] = g[k];
  } else {
    const ordem = (Object.entries(p.campos) as [CampoLeitura, CampoPadrao][])
      .filter(([, c]) => c.ordem !== null)
      .sort((a, b) => (a[1].ordem as number) - (b[1].ordem as number));
    if (!ordem.length) return null;
    const s = t.startsWith(GS) ? t.slice(1) : t;
    let pos = 0;
    for (const [k, c] of ordem) {
      const pre = c.prefixo ?? '';
      if (s.slice(pos, pos + pre.length) !== pre) return null;
      pos += pre.length;
      const f = faixa(c.tamanho);
      if (!f) return null;
      const [min, max] = f;
      let fim: number;
      if (min === max) fim = pos + min;
      else {
        const gs = s.indexOf(GS, pos);
        fim = Math.min(gs < 0 ? s.length : gs, pos + max);
      }
      const v = s.slice(pos, fim);
      if (v.length < min) return null;
      brutos[k] = v;
      pos = s[fim] === GS ? fim + 1 : fim;
    }
    if (pos < s.length) return null;
  }
  const validade = brutos.validade !== undefined ? dataPeloFormato(brutos.validade, p.formatoData) : null;
  if (brutos.validade !== undefined && validade === null) return null;
  let produto = brutos.produto?.trim() || null;
  if (produto && p.zerosEsquerda) produto = produto.replace(/^0+(?=.)/, '');
  return {
    produto,
    lote: brutos.lote?.trim() || null,
    serie: brutos.serie?.trim() || null,
    validade,
    padraoId: p.id,
  };
}

/**
 * Lê o código: o primeiro padrão ativo que reconhecer (os do fabricante do item vêm antes, a ordem é de quem chama);
 * sem padrão, a leitura GS1 da embalagem; sem GS1, o texto inteiro como código simples (o código de barras do item ou
 * o identificador da etiqueta).
 */
export function lerCodigo(texto: string, padroes: readonly PadraoLeitura[]): CodigoLido {
  for (const p of padroes) {
    const l = lerPeloPadrao(texto, p);
    if (l) return l;
  }
  // Um GTIN puro (8, 12, 13 ou 14 dígitos com o verificador certo) é o código do item, nunca uma cadeia GS1 que
  // começa por acaso com "10" ou "21".
  const puro = texto.trim().replace(/^\][A-Za-z]\d/, '');
  if (gtin14(puro)) return { produto: puro, lote: null, serie: null, validade: null, padraoId: null };
  const g = lerCodigoEmbalagem(texto);
  if (g.gtin || g.lote || g.serie)
    return { produto: g.gtin, lote: g.lote, serie: g.serie, validade: g.validade, padraoId: null };
  return { produto: puro || null, lote: null, serie: null, validade: null, padraoId: null };
}

// ── Resolução contra o cadastro ────────────────────────────────────────────────────────────────────────────────────

export interface EtiquetaConhecida {
  readonly identificador: string;
  readonly insumoId: number;
  readonly lote: string | null;
  readonly validade: string | null;
  readonly quantidade: number;
  readonly situacao: 'ativa' | 'consumida' | 'devolvida' | 'descartada' | 'cancelada';
}

export interface CodigoBarrasConhecido {
  readonly codigo: string;
  readonly insumoId: number;
  readonly quantidadeRepresentada: number;
}

export type LeituraResolvida =
  | {
      readonly ok: true;
      readonly insumoId: number;
      readonly quantidade: number;
      readonly lote: string | null;
      readonly validade: string | null;
      readonly identificador: string | null;
      readonly origem: 'etiqueta' | 'codigo-item';
    }
  | { readonly ok: false; readonly recusa: RecusaSuprimentos };

/**
 * Resolve a leitura: a etiqueta do hospital primeiro (pelo identificador lido na série ou no texto inteiro), depois o
 * código de barras do item (GTIN-14 ou como lido). A etiqueta que não está ativa é recusada (já saiu, foi devolvida ou
 * descartada); a leitura que diverge do lote ou da validade da etiqueta também.
 */
export function resolverLeitura(
  lido: CodigoLido,
  cadastro: {
    readonly etiqueta: (identificador: string) => EtiquetaConhecida | undefined;
    readonly codigoItem: (codigo: string) => CodigoBarrasConhecido | undefined;
  },
): LeituraResolvida {
  const candidato = [lido.serie, lido.produto].find((x): x is string => !!x && identificadorValido(x));
  if (candidato) {
    const e = cadastro.etiqueta(candidato.trim().toUpperCase());
    if (!e)
      return {
        ok: false,
        recusa: recusa('etiqueta-desconhecida', 'Etiqueta não encontrada neste estabelecimento.', ['codigo']),
      };
    if (e.situacao !== 'ativa')
      return {
        ok: false,
        recusa: recusa('etiqueta-inativa', `Etiqueta ${e.situacao}: não pode ser movimentada de novo.`, [
          'codigo',
        ]),
      };
    if (
      (lido.lote && e.lote && lido.lote !== e.lote) ||
      (lido.validade && e.validade && lido.validade !== e.validade)
    )
      return {
        ok: false,
        recusa: recusa('etiqueta-divergente', 'O lote ou a validade lidos não conferem com a etiqueta.', [
          'codigo',
        ]),
      };
    return {
      ok: true,
      insumoId: e.insumoId,
      quantidade: e.quantidade,
      lote: e.lote,
      validade: e.validade,
      identificador: e.identificador,
      origem: 'etiqueta',
    };
  }
  if (!lido.produto)
    return { ok: false, recusa: recusa('codigo-vazio', 'Leia ou digite o código.', ['codigo']) };
  const g = gtin14(lido.produto);
  const c =
    (g ? cadastro.codigoItem(g) : undefined) ??
    cadastro.codigoItem(lido.produto) ??
    (g ? cadastro.codigoItem(g.replace(/^0+(?=.)/, '')) : undefined);
  if (!c)
    return { ok: false, recusa: recusa('codigo-desconhecido', 'Código sem item cadastrado.', ['codigo']) };
  return {
    ok: true,
    insumoId: c.insumoId,
    quantidade: c.quantidadeRepresentada,
    lote: lido.lote,
    validade: lido.validade,
    identificador: null,
    origem: 'codigo-item',
  };
}

// ── Emissão das etiquetas e baixa na movimentação ─────────────────────────────────────────────────────────────────

/** O número sequencial que o identificador carrega (nulo se não é uma etiqueta do próprio hospital). */
export function sequencialDoIdentificador(identificador: string | null | undefined): number | null {
  if (!identificador || !identificadorValido(identificador)) return null;
  const corpo = identificador.trim().toUpperCase().slice(1, -1);
  const n = parseInt(corpo, 36);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export const MAXIMO_ETIQUETAS_POR_EMISSAO = 200;
export const TIPOS_ETIQUETA_ESTOQUE = ['unidade', 'embalagem', 'dose', 'caixa'] as const;
export type TipoEtiquetaEstoque = (typeof TIPOS_ETIQUETA_ESTOQUE)[number];

export interface EmissaoEtiquetas {
  /** O item controla lote (rastreável): a etiqueta leva o lote e a validade. */
  readonly controlaLote: boolean;
  readonly itemAtivo: boolean;
  /** O lote escolhido (nulo: sem lote). */
  readonly lote: { readonly validade: string; readonly situacao: string } | null;
  readonly quantidadePorEtiqueta: number;
  readonly etiquetas: number;
  /** AAAA-MM-DD. */
  readonly hoje: string;
}

/**
 * Confere a emissão: item ativo; item rastreável só com o lote; lote vencido ou bloqueado não ganha etiqueta nova;
 * quantidade positiva e de 1 a 200 etiquetas por vez.
 */
export function conferirEmissaoEtiquetas(e: EmissaoEtiquetas): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!e.itemAtivo) r.push(recusa('item-inativo', 'O item está inativo.', ['insumo']));
  if (e.controlaLote && !e.lote)
    r.push(recusa('lote-obrigatorio', 'O item é rastreável: escolha o lote da etiqueta.', ['lote']));
  if (e.lote && e.lote.validade < e.hoje)
    r.push(recusa('lote-vencido', 'O lote está vencido: não ganha etiqueta nova.', ['lote']));
  if (e.lote && e.lote.situacao !== 'liberado')
    r.push(recusa('lote-bloqueado', 'O lote não está liberado para uso.', ['lote']));
  if (!(e.quantidadePorEtiqueta > 0) || e.quantidadePorEtiqueta > 999_999)
    r.push(
      recusa('quantidade-invalida', 'Informe a quantidade que cada etiqueta representa.', ['quantidade']),
    );
  if (!Number.isInteger(e.etiquetas) || e.etiquetas < 1 || e.etiquetas > MAXIMO_ETIQUETAS_POR_EMISSAO)
    r.push(
      recusa('etiquetas-invalidas', `Emita de 1 a ${MAXIMO_ETIQUETAS_POR_EMISSAO} etiquetas por vez.`, [
        'etiquetas',
      ]),
    );
  return r;
}

export const BAIXAS_ETIQUETA = ['consumida', 'devolvida', 'descartada', 'cancelada'] as const;
export type BaixaEtiqueta = (typeof BAIXAS_ETIQUETA)[number];

/**
 * A baixa da etiqueta na movimentação: só a ativa sai (consumida na saída, devolvida ao fornecedor, descartada na
 * perda, cancelada no erro de emissão). A devolvida ao estoque pela devolução interna volta a ativa.
 */
export function proximaSituacaoEtiqueta(
  atual: EtiquetaConhecida['situacao'],
  pedido: BaixaEtiqueta | 'reativar',
): { ok: true; situacao: EtiquetaConhecida['situacao'] } | { ok: false; recusa: RecusaSuprimentos } {
  if (pedido === 'reativar')
    return atual === 'devolvida'
      ? { ok: true, situacao: 'ativa' }
      : {
          ok: false,
          recusa: recusa('etiqueta-nao-devolvida', 'Só a etiqueta devolvida volta a ativa.', ['codigo']),
        };
  if (atual !== 'ativa')
    return {
      ok: false,
      recusa: recusa('etiqueta-inativa', `Etiqueta ${atual}: não pode ser movimentada de novo.`, ['codigo']),
    };
  return { ok: true, situacao: pedido };
}
