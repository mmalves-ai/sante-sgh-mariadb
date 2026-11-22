// CRUD genérico (M08) sobre o modelo próprio: a declaração de cada domínio é derivada dos metadados do banco do
// cliente (colunas, comentários e chaves estrangeiras do information_schema) para as tabelas de domínio do modelo
// (TABELAS_DOMINIO). Puro: sem banco nem I/O; a fonte lê os metadados e chama estas funções.
// Melhoria: nada de declaração à mão por tabela nem de opções de menu do sistema de origem; o rótulo é o comentário
// da tabela e da coluna, a obrigatoriedade é o NOT NULL sem padrão, o tamanho é o da coluna e a referência é a FK.
// Melhoria: booleano é booleano (Sim/Não na tela, verdadeiro/falso no banco), sem letra S/N.
import type { AcaoDominio, CampoDescrito, NaturezaDominio, SubitemDominio, ValorCampo } from '@sgh/contratos';
import { TABELAS_DOMINIO } from './dominios-tabelas.js';

/** Coluna como o information_schema a descreve (só o que a declaração usa). */
export interface ColunaMeta {
  readonly coluna: string;
  /** DATA_TYPE (varchar, int, tinyint, decimal, date, time, datetime, text, json...). */
  readonly tipo: string;
  /** COLUMN_TYPE (tinyint(1), int(10) unsigned...). */
  readonly tipoColuna: string;
  readonly nulo: boolean;
  readonly temPadrao: boolean;
  readonly tamanho: number | null;
  readonly escala: number | null;
  readonly comentario: string;
  readonly gerada: boolean;
  /** Tabela referenciada pela FK da coluna, quando há. */
  readonly referencia: string | null;
}

export interface CampoDominio extends CampoDescrito {
  readonly coluna: string;
  readonly booleano?: boolean;
  /** Tabela referenciada (só no servidor; nunca vai à resposta). */
  readonly tabelaReferencia?: string;
}

export interface DominioDeclarado {
  readonly modulo: string;
  readonly recurso: string;
  readonly tabela: string;
  readonly rotulo: { readonly singular: string; readonly plural: string };
  readonly subitem: SubitemDominio;
  readonly natureza: NaturezaDominio;
  readonly motivoSomenteLeitura?: string;
  readonly acoes: readonly AcaoDominio[];
  readonly campos: readonly CampoDominio[];
  /** A tabela tem estabelecimento_id: a lista é do estabelecimento da sessão (mais as linhas da rede inteira). */
  readonly porEstabelecimento: boolean;
  /** estabelecimento_id NOT NULL: a inclusão grava o estabelecimento da sessão; nulo: a linha vale para a rede. */
  readonly estabelecimentoObrigatorio: boolean;
  readonly exclusaoLogica: boolean;
}

/** Área do modelo → módulo dono (prefixo das permissões `<modulo>.<recurso>.<acao>`). */
export const MODULO_DA_AREA: Readonly<Record<string, string>> = {
  SIS: 'sistema',
  ADM: 'administracao',
  CAD: 'cadastro',
  REC: 'recepcao',
  AGE: 'agenda',
  PEP: 'pep',
  INT: 'internacao',
  CC: 'cirurgia',
  HOT: 'hotelaria',
  SADT: 'sadt',
  SUP: 'suprimentos',
  FAT: 'faturamento',
  SUS: 'sus',
  FIN: 'financeiro',
  RH: 'pessoas',
  SGO: 'ocupacional',
  INTG: 'integracao',
  QUA: 'qualidade',
  REL: 'relatorio',
};

const SUBITEM_DA_AREA: Readonly<Record<string, SubitemDominio>> = {
  CAD: 'demograficos',
  REC: 'agenda',
  AGE: 'agenda',
  INT: 'internacao',
  CC: 'internacao',
  PEP: 'clinicos',
  SADT: 'clinicos',
};

/** Catálogos do próprio sistema (carregados pelo criar cliente): só consulta no CRUD genérico. */
const DO_SISTEMA: Readonly<Record<string, string>> = {
  acao_sistema: 'Catálogo de ações do sistema, carregado com o produto.',
  modulo_sistema: 'Módulos do sistema, carregados com o produto.',
  funcionalidade_sistema:
    'Funcionalidades do produto: ligue ou desligue em Funcionalidades por estabelecimento.',
};

/** Colunas do núcleo (id, auditoria, exclusão lógica, gerada) e a situação: nunca campos editáveis. */
const RESERVADAS = new Set([
  'id',
  'criado_em',
  'criado_por',
  'alterado_em',
  'alterado_por',
  'versao',
  'excluido_em',
  'excluido_por',
  'ativo',
  'estabelecimento_id',
  'origem',
]);

const ROTULOS: Readonly<Record<string, string>> = {
  codigo: 'Código',
  descricao: 'Descrição',
  sigla: 'Sigla',
  nome: 'Nome',
  ordem: 'Ordem',
  cor: 'Cor',
  observacao: 'Observação',
  detalhamento: 'Detalhamento',
  sequencia: 'Sequência',
};

/** snake_case → camelCase (nome do campo e do recurso). */
export function camelo(nome: string): string {
  return nome.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function humanizar(nome: string): string {
  const t = nome.replace(/_id$/, '').replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function rotuloDaColuna(c: ColunaMeta): string {
  if (ROTULOS[c.coluna]) return ROTULOS[c.coluna]!;
  const doComentario = c.comentario.trim();
  if (doComentario && doComentario.length <= 60 && !/[.;:(]/.test(doComentario)) return doComentario;
  return humanizar(c.coluna);
}

function rotuloDaTabela(tabela: string, comentario: string): { singular: string; plural: string } {
  const singular = humanizar(tabela);
  const c = comentario.trim();
  const plural = c && c.length <= 80 ? c.replace(/[.]$/, '') : singular;
  return { singular, plural };
}

export const ehBooleano = (c: ColunaMeta): boolean =>
  c.tipo === 'tinyint' && /^tinyint\(1\)/.test(c.tipoColuna);

const LIMITES_INTEIRO: Readonly<Record<string, readonly [number, number]>> = {
  tinyint: [-128, 255],
  smallint: [-32768, 65535],
  mediumint: [-8388608, 16777215],
  int: [-2147483648, 4294967295],
  bigint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
};

/** O campo da tela para a coluna, ou null quando a coluna não vai à tela (reservada, gerada, binária, JSON). */
export function campoDaColuna(c: ColunaMeta, recursoDe: (tabela: string) => string): CampoDominio | null {
  if (RESERVADAS.has(c.coluna) || c.gerada) return null;
  const obrigatorio = !c.nulo && !c.temPadrao;
  const base = {
    coluna: c.coluna,
    campo: camelo(c.coluna),
    rotulo: rotuloDaColuna(c),
    obrigatorio,
    editavel: c.coluna !== 'codigo',
    naInclusao: true,
    naLista: c.coluna === 'codigo' || c.coluna === 'descricao',
    ...(c.coluna === 'codigo' ? { codigo: 'manual' as const } : {}),
  };
  if (c.referencia)
    return {
      ...base,
      tipo: 'referencia',
      referencia: recursoDe(c.referencia),
      tabelaReferencia: c.referencia,
    };
  if (ehBooleano(c))
    return {
      ...base,
      tipo: 'letra',
      booleano: true,
      valores: [
        { valor: 'sim', rotulo: 'Sim' },
        { valor: 'nao', rotulo: 'Não' },
      ],
    };
  const sinal = /unsigned/.test(c.tipoColuna);
  if (LIMITES_INTEIRO[c.tipo]) {
    const [min, max] = LIMITES_INTEIRO[c.tipo]!;
    return { ...base, tipo: 'inteiro', minimo: sinal ? 0 : min, maximo: max };
  }
  if (c.tipo === 'decimal')
    return { ...base, tipo: 'decimal', casas: c.escala ?? 0, ...(sinal ? { minimo: 0 } : {}) };
  if (c.tipo === 'date') return { ...base, tipo: 'data' };
  if (c.tipo === 'time') return { ...base, tipo: 'hora' };
  if (c.tipo === 'datetime' || c.tipo === 'timestamp')
    return { ...base, tipo: 'texto', editavel: false, naInclusao: false };
  if (['varchar', 'char', 'text', 'mediumtext', 'tinytext'].includes(c.tipo))
    return { ...base, tipo: 'texto', ...(c.tamanho ? { maxBytes: c.tamanho } : {}) };
  return null;
}

/** As tabelas de domínio do modelo, com a área (TABELAS_DOMINIO). */
export function tabelasDeDominio(): ReadonlyMap<string, string> {
  const m = new Map<string, string>();
  for (const [area, tabelas] of Object.entries(TABELAS_DOMINIO)) for (const t of tabelas) m.set(t, area);
  return m;
}

/**
 * A declaração do domínio a partir dos metadados; null quando a tabela não tem a forma de domínio (codigo, descricao,
 * ativo e versao) ou a área não tem módulo.
 */
export function declararDominio(
  tabela: string,
  area: string,
  comentario: string,
  colunas: readonly ColunaMeta[],
  recursoDe: (tabela: string) => string = camelo,
): DominioDeclarado | null {
  const nomes = new Set(colunas.map((c) => c.coluna));
  const modulo = MODULO_DA_AREA[area];
  if (!modulo || !['codigo', 'descricao', 'ativo', 'versao'].every((c) => nomes.has(c))) return null;
  const campos = colunas.map((c) => campoDaColuna(c, recursoDe)).filter((c): c is CampoDominio => c !== null);
  const est = colunas.find((c) => c.coluna === 'estabelecimento_id');
  const sistema = DO_SISTEMA[tabela];
  return {
    modulo,
    recurso: camelo(tabela),
    tabela,
    rotulo: rotuloDaTabela(tabela, comentario),
    subitem: SUBITEM_DA_AREA[area] ?? 'hotelaria',
    natureza: sistema ? 'sistema' : 'editavel',
    ...(sistema ? { motivoSomenteLeitura: sistema } : {}),
    acoes: sistema ? ['ler', 'exportar'] : ['ler', 'criar', 'editar', 'inativar', 'exportar'],
    campos,
    porEstabelecimento: est !== undefined,
    estabelecimentoObrigatorio: est !== undefined && !est.nulo,
    exclusaoLogica: nomes.has('excluido_em'),
  };
}

export class ErroValorCampo extends Error {
  override readonly name = 'ErroValorCampo';
  constructor(readonly campos: readonly string[]) {
    super('Valores inválidos.');
  }
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Valor do banco → valor da tela. */
export function valorParaTela(c: CampoDominio, v: unknown): ValorCampo {
  if (v === null || v === undefined) return null;
  if (c.booleano) return v === true || Number(v) === 1 ? 'sim' : 'nao';
  if (c.tipo === 'inteiro' || c.tipo === 'referencia') return Number(v);
  if (c.tipo === 'decimal') return Number(v);
  if (c.tipo === 'data')
    return v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
  if (c.tipo === 'hora') return String(v).slice(0, 5);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Valores da tela → colunas do banco, conferidos pelo campo (tipo, tamanho, faixa, obrigatoriedade). Na inclusão, os
 * obrigatórios têm de vir; na alteração, só os editáveis enviados mudam. Campo desconhecido é recusado.
 */
export function valoresParaBanco(
  d: DominioDeclarado,
  valores: Readonly<Record<string, ValorCampo>>,
  modo: 'incluir' | 'alterar',
): Record<string, unknown> {
  const erros: string[] = [];
  const saida: Record<string, unknown> = {};
  for (const k of Object.keys(valores)) if (!d.campos.some((c) => c.campo === k)) erros.push(k);
  for (const c of d.campos) {
    const pode = modo === 'incluir' ? c.naInclusao : c.editavel;
    const bruto = valores[c.campo];
    if (bruto === undefined) {
      if (modo === 'incluir' && c.obrigatorio) erros.push(c.campo);
      continue;
    }
    if (!pode) {
      erros.push(c.campo);
      continue;
    }
    const vazio = bruto === null || (typeof bruto === 'string' && bruto.trim() === '');
    if (vazio) {
      if (c.obrigatorio) erros.push(c.campo);
      else saida[c.coluna] = null;
      continue;
    }
    const v = typeof bruto === 'string' ? bruto.trim() : bruto;
    let ok: boolean;
    let valor: unknown = v;
    if (c.booleano) {
      ok = v === 'sim' || v === 'nao';
      valor = v === 'sim';
    } else if (c.tipo === 'inteiro' || c.tipo === 'referencia') {
      const n = typeof v === 'number' ? v : Number(v);
      ok =
        Number.isSafeInteger(n) &&
        (c.minimo === undefined || n >= c.minimo) &&
        (c.maximo === undefined || n <= c.maximo) &&
        (c.tipo !== 'referencia' || n > 0);
      valor = n;
    } else if (c.tipo === 'decimal') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      const casas = (String(v).split(/[.,]/)[1] ?? '').length;
      ok = Number.isFinite(n) && casas <= (c.casas ?? 0) && (c.minimo === undefined || n >= c.minimo);
      valor = n;
    } else if (c.tipo === 'data') ok = typeof v === 'string' && DATA.test(v) && !Number.isNaN(Date.parse(v));
    else if (c.tipo === 'hora') ok = typeof v === 'string' && HORA.test(v);
    else {
      valor = String(v);
      ok = c.maxBytes === undefined || [...String(v)].length <= c.maxBytes;
    }
    if (ok) saida[c.coluna] = valor;
    else erros.push(c.campo);
  }
  if (erros.length > 0) throw new ErroValorCampo([...new Set(erros)]);
  return saida;
}
