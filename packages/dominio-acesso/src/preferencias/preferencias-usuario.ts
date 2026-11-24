// Preferências do usuário (01-ADM L84): as gerais (tema, densidade, tamanho do texto, tela inicial, filtro inicial
// de atendimento) e as visões salvas por tela (colunas visíveis na ordem, ordenação, filtros e itens por página).
// Regras puras: a API grava no banco próprio o que estas funções aceitam. Desenho próprio: a preferência segue o
// usuário em qualquer computador; a visão padrão de cada tela é uma só e a ordenação só usa coluna visível.

export type TemaPreferido = 'claro' | 'escuro' | 'sistema';
export type DensidadePreferida = 'compacta' | 'normal' | 'confortavel';
export type TipoAtendimentoPreferido = 'ambulatorial' | 'urgencia' | 'internacao' | 'externo' | 'todos';

export const TEMAS_PREFERIDOS: readonly TemaPreferido[] = ['claro', 'escuro', 'sistema'];
export const DENSIDADES_PREFERIDAS: readonly DensidadePreferida[] = ['compacta', 'normal', 'confortavel'];
export const TIPOS_ATENDIMENTO_PREFERIDOS: readonly TipoAtendimentoPreferido[] = [
  'ambulatorial',
  'urgencia',
  'internacao',
  'externo',
  'todos',
];
/** Zoom gravado quando a pessoa pede texto ampliado (o padrão é nulo: 100%). */
export const ZOOM_TEXTO_AMPLIADO = 125;
export const ZOOM_MINIMO = 50;
export const ZOOM_MAXIMO = 300;
export const ITENS_POR_PAGINA_MINIMO = 5;
export const ITENS_POR_PAGINA_MAXIMO = 500;
export const COLUNAS_MAXIMAS_VISAO = 60;
export const NOME_VISAO_PADRAO = 'padrao';

export type RecusaPreferencia =
  | 'sem-conta'
  | 'tema-invalido'
  | 'densidade-invalida'
  | 'zoom-fora-da-faixa'
  | 'tipo-atendimento-invalido'
  | 'tela-inexistente'
  | 'tela-inicial-sem-rota'
  | 'tela-sem-permissao'
  | 'visao-sem-colunas'
  | 'coluna-repetida'
  | 'coluna-desconhecida'
  | 'ordenacao-fora-das-colunas'
  | 'ordenacao-repetida'
  | 'itens-por-pagina-fora-da-faixa'
  | 'nome-visao-invalido';

export const MENSAGEM_PREFERENCIA: Readonly<Record<RecusaPreferencia, string>> = {
  'sem-conta': 'Preferências só são guardadas para uma conta de pessoa.',
  'tema-invalido': 'Escolha o tema claro, escuro ou igual ao computador.',
  'densidade-invalida': 'Escolha a densidade compacta, normal ou confortável.',
  'zoom-fora-da-faixa': `O tamanho do texto deve ficar entre ${ZOOM_MINIMO}% e ${ZOOM_MAXIMO}%.`,
  'tipo-atendimento-invalido': 'O filtro inicial de atendimento não é conhecido.',
  'tela-inexistente': 'Essa tela não existe ou não está ativa.',
  'tela-inicial-sem-rota': 'A tela inicial precisa ser uma tela do menu, com endereço próprio.',
  'tela-sem-permissao': 'Seu cargo não dá acesso a essa tela; escolha uma tela do seu menu.',
  'visao-sem-colunas': 'Deixe ao menos uma coluna visível.',
  'coluna-repetida': 'A mesma coluna aparece duas vezes.',
  'coluna-desconhecida': 'Uma das colunas não existe nesta tela.',
  'ordenacao-fora-das-colunas': 'Só dá para ordenar por coluna visível.',
  'ordenacao-repetida': 'A mesma coluna aparece duas vezes na ordenação.',
  'itens-por-pagina-fora-da-faixa': `Itens por página entre ${ITENS_POR_PAGINA_MINIMO} e ${ITENS_POR_PAGINA_MAXIMO}.`,
  'nome-visao-invalido': 'Dê à visão um nome de 1 a 100 caracteres.',
};

export interface PreferenciaGeralPedida {
  readonly tema?: string | undefined;
  readonly densidade?: string | undefined;
  /** Texto ampliado: grava o zoom de texto ampliado; falso volta ao padrão (nulo). */
  readonly textoAmpliado?: boolean | undefined;
  readonly zoomPercentual?: number | null | undefined;
  readonly tipoAtendimentoPadrao?: string | null | undefined;
  readonly alertaJanelaSuspensa?: boolean | undefined;
}

export interface PreferenciaGeralNormalizada {
  readonly tema: TemaPreferido;
  readonly densidade: DensidadePreferida;
  readonly zoomPercentual: number | null;
  readonly tipoAtendimentoPadrao: TipoAtendimentoPreferido | null;
  readonly alertaJanelaSuspensa: boolean;
}

export const PREFERENCIA_GERAL_PADRAO: PreferenciaGeralNormalizada = Object.freeze({
  tema: 'sistema',
  densidade: 'normal',
  zoomPercentual: null,
  tipoAtendimentoPadrao: null,
  alertaJanelaSuspensa: true,
});

const em = <T extends string>(lista: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (lista as readonly string[]).includes(v);

/**
 * Junta o pedido à preferência atual (o que não veio fica como está) e confere cada campo. Devolve a recusa ou
 * a preferência completa a gravar.
 */
export function normalizarPreferenciaGeral(
  atual: PreferenciaGeralNormalizada,
  p: PreferenciaGeralPedida,
): { recusa: RecusaPreferencia } | { preferencia: PreferenciaGeralNormalizada } {
  if (p.tema !== undefined && !em(TEMAS_PREFERIDOS, p.tema)) return { recusa: 'tema-invalido' };
  if (p.densidade !== undefined && !em(DENSIDADES_PREFERIDAS, p.densidade))
    return { recusa: 'densidade-invalida' };
  let zoom = atual.zoomPercentual;
  if (p.textoAmpliado !== undefined) zoom = p.textoAmpliado ? ZOOM_TEXTO_AMPLIADO : null;
  if (p.zoomPercentual !== undefined) zoom = p.zoomPercentual;
  if (zoom !== null && !(Number.isFinite(zoom) && zoom >= ZOOM_MINIMO && zoom <= ZOOM_MAXIMO))
    return { recusa: 'zoom-fora-da-faixa' };
  if (zoom === 100) zoom = null;
  let tipo = atual.tipoAtendimentoPadrao;
  if (p.tipoAtendimentoPadrao !== undefined) {
    if (p.tipoAtendimentoPadrao !== null && !em(TIPOS_ATENDIMENTO_PREFERIDOS, p.tipoAtendimentoPadrao))
      return { recusa: 'tipo-atendimento-invalido' };
    tipo = p.tipoAtendimentoPadrao;
  }
  return {
    preferencia: {
      tema: (p.tema as TemaPreferido | undefined) ?? atual.tema,
      densidade: (p.densidade as DensidadePreferida | undefined) ?? atual.densidade,
      zoomPercentual: zoom,
      tipoAtendimentoPadrao: tipo,
      alertaJanelaSuspensa: p.alertaJanelaSuspensa ?? atual.alertaJanelaSuspensa,
    },
  };
}

/** Texto ampliado é qualquer zoom acima de 100%. */
export const textoAmpliado = (zoom: number | null): boolean => zoom !== null && zoom > 100;

/**
 * A tela inicial precisa existir, estar ativa, ter endereço, não ser avulsa (aberta só por outra tela) e estar no
 * menu da pessoa (`permitida`: a permissão de leitura da entrada do menu ligada à rota está entre as do cargo).
 */
export function conferirTelaInicial(
  t: { ativa: boolean; rota: string | null; avulsa: boolean; permitida: boolean } | null,
): RecusaPreferencia | null {
  if (!t || !t.ativa) return 'tela-inexistente';
  if (!t.rota || t.avulsa) return 'tela-inicial-sem-rota';
  if (!t.permitida) return 'tela-sem-permissao';
  return null;
}

/**
 * A rota está no menu da pessoa: alguma entrada do menu com essa rota tem permissão de leitura que o cargo dá. Rota
 * fora do menu ou entrada sem permissão não conta (falha fechada, como o próprio menu).
 */
export function rotaPermitida(
  rota: string | null,
  menu: readonly { readonly rota: string | null; readonly permissao: string | null }[],
  permissoes: ReadonlySet<string>,
): boolean {
  if (!rota) return false;
  return menu.some((i) => i.rota === rota && i.permissao !== null && permissoes.has(i.permissao));
}

export interface OrdenacaoColuna {
  readonly coluna: string;
  readonly direcao: 'asc' | 'desc';
}

export interface VisaoTelaPedida {
  readonly nome?: string | undefined;
  readonly colunas: readonly string[];
  readonly ordenacao?: readonly OrdenacaoColuna[] | undefined;
  readonly itensPorPagina?: number | null | undefined;
  readonly padrao?: boolean | undefined;
}

export interface VisaoTelaNormalizada {
  readonly nome: string;
  readonly colunas: readonly string[];
  readonly ordenacao: readonly OrdenacaoColuna[];
  readonly itensPorPagina: number | null;
  readonly padrao: boolean;
}

/**
 * Confere uma visão salva de tela. `colunasDaTela` (opcional) é a lista de colunas que a tela oferece: quando
 * vem, coluna fora dela é recusada. O nome é aparado; sem nome, é a visão "padrao". A marca de padrão só muda com
 * `padrao` explícito: sem ele, a visão regravada mantém a marca que tinha (`padraoAtual`) e a primeira visão da tela
 * (`primeiraDaTela`) já nasce padrão, para a tela abrir nela sem mais um clique.
 */
export function conferirVisaoTela(
  v: VisaoTelaPedida,
  f: {
    colunasDaTela?: readonly string[] | undefined;
    primeiraDaTela?: boolean | undefined;
    padraoAtual?: boolean | undefined;
  } = {},
): { recusa: RecusaPreferencia } | { visao: VisaoTelaNormalizada } {
  const nome = (v.nome ?? NOME_VISAO_PADRAO).trim();
  if (nome.length < 1 || nome.length > 100) return { recusa: 'nome-visao-invalido' };
  const colunas = v.colunas.map((c) => c.trim());
  if (colunas.length === 0 || colunas.some((c) => c === '')) return { recusa: 'visao-sem-colunas' };
  if (new Set(colunas).size !== colunas.length) return { recusa: 'coluna-repetida' };
  if (f.colunasDaTela && colunas.some((c) => !f.colunasDaTela!.includes(c)))
    return { recusa: 'coluna-desconhecida' };
  const ordenacao = (v.ordenacao ?? []).map((o) => ({ coluna: o.coluna.trim(), direcao: o.direcao }));
  if (ordenacao.some((o) => !colunas.includes(o.coluna))) return { recusa: 'ordenacao-fora-das-colunas' };
  if (new Set(ordenacao.map((o) => o.coluna)).size !== ordenacao.length)
    return { recusa: 'ordenacao-repetida' };
  const itens = v.itensPorPagina ?? null;
  if (
    itens !== null &&
    !(Number.isInteger(itens) && itens >= ITENS_POR_PAGINA_MINIMO && itens <= ITENS_POR_PAGINA_MAXIMO)
  )
    return { recusa: 'itens-por-pagina-fora-da-faixa' };
  return {
    visao: {
      nome,
      colunas,
      ordenacao,
      itensPorPagina: itens,
      padrao: v.padrao ?? (f.padraoAtual === true || f.primeiraDaTela === true),
    },
  };
}

/**
 * Qual visão a tela abre: a marcada como padrão; sem nenhuma marcada, a de nome "padrao"; sem ela, nenhuma
 * (a tela usa as colunas de fábrica).
 */
export function visaoInicial<T extends { nome: string; padrao: boolean }>(visoes: readonly T[]): T | null {
  return visoes.find((v) => v.padrao) ?? visoes.find((v) => v.nome === NOME_VISAO_PADRAO) ?? null;
}
