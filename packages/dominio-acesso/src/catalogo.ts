// Catálogo de permissões gerado da árvore de opções do legado (ficha do M06, regra 2; cap-08 §8.6), em
// quatro passos: (1) reconstruir a árvore de cada módulo por INDICE e NIVEL (não há chave de pai); (2)
// agrupar opções iguais de executáveis diferentes do mesmo módulo do Sante SGH num recurso; (3) converter
// Incluir, Alterar, Excluir e Consultar em criar, editar (retificar no PEP), inativar e ler, e as ações
// próprias em verbos próprios; (4) deixar de fora SGO e SGS sem uso, módulos sem opção e opções inativas,
// com registro. Puro: recebe as linhas lidas (ou o retrato versionado) e devolve o catálogo.
import type { CategoriaPermissao, DeclaracaoPermissao } from '@sgh/contratos';
import { ESCOPOS_DO_MODULO } from './ability.js';

export interface OpcaoArvore {
  readonly id: number;
  readonly modulo: number;
  readonly indice: number;
  readonly nivel: number;
  readonly ativo: boolean;
  readonly nome: string;
  readonly titulo: string;
}

export interface ModuloArvore {
  readonly id: number;
  readonly sistema: string;
  readonly executavel: string | null;
  readonly nome: string;
}

/** Módulo do Sante SGH de cada executável do SGH (convencoes.md §4) e o prefixo do recurso, se houver. */
export interface DestinoExecutavel {
  readonly modulo: string;
  readonly prefixo?: string;
}

/**
 * Executável do legado → módulo do Sante SGH. Recepção interna e externa são o mesmo módulo (as opções
 * iguais viram um recurso, regra 2); os faturamentos ficam no módulo faturamento com o prefixo do tipo
 * (fechar conta de AIH não é fechar conta de convênio).
 */
export const DESTINO_EXECUTAVEL: Readonly<Record<string, DestinoExecutavel>> = {
  sghspd: { modulo: 'sistema' },
  sghblc: { modulo: 'cirurgia' },
  sghest: { modulo: 'suprimentos' },
  sghaih: { modulo: 'faturamento', prefixo: 'aih' },
  sghamb: { modulo: 'faturamento', prefixo: 'ambulatorio' },
  sghconv: { modulo: 'faturamento', prefixo: 'convenio' },
  sghdiver: { modulo: 'faturamento', prefixo: 'diversos' },
  sghapac: { modulo: 'faturamento', prefixo: 'apac' },
  sghpint: { modulo: 'recepcao' },
  sghpext: { modulo: 'recepcao' },
  sghsadt: { modulo: 'sadt' },
  sghtab: { modulo: 'cadastro' },
  sghcusto: { modulo: 'custos' },
  sghfin: { modulo: 'financeiro' },
  sghcont: { modulo: 'contabil' },
  sghadm: { modulo: 'relatorio', prefixo: 'sig' },
  sghsac: { modulo: 'sac' },
  sghgpa: { modulo: 'patrimonio' },
  sghfolha: { modulo: 'pessoas', prefixo: 'folha' },
  sghpep: { modulo: 'pep' },
  sghorc: { modulo: 'orcamento' },
  sghsus: { modulo: 'catalogo', prefixo: 'sus' },
  sghhemo: { modulo: 'hemoterapia' },
  sghagenda: { modulo: 'agenda' },
  sghpainel: { modulo: 'painel' },
  sghdmed: { modulo: 'fiscal', prefixo: 'dmed' },
  sghfiscal: { modulo: 'fiscal', prefixo: 'sped' },
  sghctracesso: { modulo: 'portaria' },
  sghsms: { modulo: 'sms' },
  sghhigienizacao: { modulo: 'internacao', prefixo: 'higienizacao' },
  sghreport: { modulo: 'relatorio' },
  spdnfse: { modulo: 'fiscal', prefixo: 'nfse' },
  spdpontoeletronico: { modulo: 'pessoas', prefixo: 'ponto' },
  spdesocial: { modulo: 'pessoas', prefixo: 'esocial' },
  sghdiops: { modulo: 'fiscal', prefixo: 'diops' },
};

/** Módulos do SGH sem executável (Central de Regulação, Segurança do trabalho, Ponto antigo): pelo id. */
export const DESTINO_MODULO_SEM_EXECUTAVEL: Readonly<Record<number, DestinoExecutavel>> = {
  17: { modulo: 'regulacao' },
  24: { modulo: 'pessoas', prefixo: 'segurancaTrabalho' },
  25: { modulo: 'pessoas', prefixo: 'pontoAntigo' },
};

/** Grupo de opções GRT (módulo 27) divide o executável com a gestão patrimonial: vai ao repasse. */
export const DESTINO_POR_MODULO: Readonly<Record<number, DestinoExecutavel>> = {
  27: { modulo: 'repasse' },
};

const MODULOS_CLINICOS = new Set(['pep', 'sadt', 'cirurgia', 'hemoterapia']);
const MODULOS_FINANCEIROS = new Set([
  'faturamento',
  'financeiro',
  'contabil',
  'custos',
  'repasse',
  'fiscal',
  'orcamento',
]);

export type MotivoExclusao = 'sistema-sgo-sgs' | 'opcao-inativa' | 'modulo-sem-destino';

export interface ExclusaoOpcao {
  readonly opcao: number;
  readonly modulo: number;
  readonly motivo: MotivoExclusao;
}

export interface NoArvore {
  readonly opcao: number;
  readonly pai: number | null;
  readonly caminho: readonly string[];
  readonly folha: boolean;
}

/** Permissão gerada da árvore do menu de origem, com as opções que a concedem (viram linhas do mapa do conector). */
export interface PermissaoGerada extends DeclaracaoPermissao {
  readonly opcoesLegado: readonly number[];
  readonly modulosLegado: readonly number[];
}

export interface CatalogoGerado {
  readonly permissoes: readonly PermissaoGerada[];
  readonly exclusoes: readonly ExclusaoOpcao[];
  /** Opção ativa → nó da árvore reconstruída. */
  readonly arvore: ReadonlyMap<number, NoArvore>;
  /** Opção ativa → código da permissão. */
  readonly permissaoDaOpcao: ReadonlyMap<number, string>;
  readonly contagens: {
    readonly opcoes: number;
    readonly ativas: number;
    readonly porNivel: readonly number[];
    readonly modulos: number;
    /** Nós cujo pai teve de ser o ancestral mais próximo (salto de nível na sequência). */
    readonly saltosDeNivel: number;
  };
}

/** Texto sem acento, em minúsculas, só letras e números separados por espaço. */
export function normalizarTitulo(t: string): string {
  return t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\(a\)|\(o\)/gi, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ROMANO = /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)$/;

/** camelCase de um texto (romanos em maiúsculas: "Modelo II" → modeloII). Vazio vira "geral". */
export function camelo(t: string): string {
  const palavras = normalizarTitulo(t).split(' ').filter(Boolean);
  if (palavras.length === 0) return 'geral';
  const r = palavras
    .map((p, i) =>
      ROMANO.test(p) && i > 0 ? p.toUpperCase() : i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join('');
  return /^[0-9]/.test(r) ? `n${r}` : r;
}

const VERBOS: Readonly<Record<string, string>> = {
  incluir: 'criar',
  novo: 'criar',
  nova: 'criar',
  inserir: 'criar',
  adicionar: 'criar',
  cadastrar: 'criar',
  alterar: 'editar',
  editar: 'editar',
  edicao: 'editar',
  manter: 'editar',
  excluir: 'inativar',
  inativar: 'inativar',
  consultar: 'ler',
  consulta: 'ler',
  visualizar: 'ler',
  imprimir: 'imprimir',
  impressao: 'imprimir',
  exportar: 'exportar',
};

/** Verbo do novo para o título da opção folha; null quando não é ação conhecida. */
export function verboDoTitulo(titulo: string, modulo: string): string | null {
  const v = VERBOS[normalizarTitulo(titulo)];
  if (!v) return null;
  // No PEP, alterar registro clínico é retificar (cap-08 §8.6).
  return v === 'editar' && MODULOS_CLINICOS.has(modulo) ? 'retificar' : v;
}

/** Recurso em camelCase limitado a 60 caracteres (o excesso vira um resumo estável). */
function recursoDe(partes: readonly string[]): string {
  const r = camelo(partes.join(' '));
  if (r.length <= 60) return r;
  let h = 0;
  for (const c of r) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${r.slice(0, 52)}${h.toString(36).slice(0, 8)}`;
}

function destinoDe(m: ModuloArvore): DestinoExecutavel | null {
  return (
    DESTINO_POR_MODULO[m.id] ??
    (m.executavel ? DESTINO_EXECUTAVEL[m.executavel.toLowerCase()] : undefined) ??
    DESTINO_MODULO_SEM_EXECUTAVEL[m.id] ??
    null
  );
}

/**
 * Recursos dos módulos clínicos que não são dado clínico (menu, configuração, cadastro e busca do paciente,
 * relatórios gerenciais, utilitários): categoria administrativa, para a recepção não perder o que usa.
 */
const RECURSOS_NAO_CLINICOS =
  /^(?:modulo|configurac|cadastroPaciente|localizarPaciente|tabelas|relatorios|meusRelatorios|utilitarios|sobre|ajuda|sair|parametros|geral)/;

function categoriaDe(modulo: string, recurso = ''): CategoriaPermissao {
  if (MODULOS_CLINICOS.has(modulo)) return RECURSOS_NAO_CLINICOS.test(recurso) ? 'administrativa' : 'clinica';
  if (MODULOS_FINANCEIROS.has(modulo)) return 'financeira';
  if (modulo === 'sistema') return 'tecnica';
  return 'administrativa';
}

/** Árvore de um módulo pela sequência (INDICE, ID) e NIVEL: pai = último visto no nível anterior. */
function reconstruir(ativas: readonly OpcaoArvore[]): { nos: Map<number, NoArvore>; saltos: number } {
  const ordenadas = [...ativas].sort((a, b) => a.indice - b.indice || a.id - b.id);
  const pilha: (OpcaoArvore | undefined)[] = [];
  const caminhos = new Map<number, string[]>();
  const pais = new Map<number, number | null>();
  let saltos = 0;
  for (const o of ordenadas) {
    let pai: OpcaoArvore | undefined;
    for (let n = o.nivel - 1; n >= 0 && !pai; n--) {
      pai = pilha[n];
      if (pai && n !== o.nivel - 1) saltos++;
    }
    pilha[o.nivel] = o;
    pilha.length = o.nivel + 1;
    pais.set(o.id, pai?.id ?? null);
    // Caminho sem a raiz do módulo (nível 0): os títulos dos ancestrais e o próprio.
    const base = pai && pai.nivel > 0 ? (caminhos.get(pai.id) ?? []) : [];
    caminhos.set(o.id, o.nivel === 0 ? [] : [...base, o.titulo || o.nome]);
  }
  const temFilho = new Set([...pais.values()].filter((p): p is number => p !== null));
  const nos = new Map<number, NoArvore>();
  for (const o of ordenadas) {
    nos.set(o.id, {
      opcao: o.id,
      pai: pais.get(o.id) ?? null,
      caminho: caminhos.get(o.id) ?? [],
      folha: !temFilho.has(o.id),
    });
  }
  return { nos, saltos };
}

/** Títulos canônicos de cada verbo (cap-08 §8.6): os sinônimos só ficam com o verbo sem conflito. */
const CANONICO: Readonly<Record<string, string>> = {
  criar: 'incluir',
  editar: 'alterar',
  retificar: 'alterar',
  inativar: 'excluir',
  ler: 'consultar',
  imprimir: 'imprimir',
  exportar: 'exportar',
};

interface CodigoOpcao {
  readonly codigo: string;
  /** Código com o título como verbo (quando o verbo vem de sinônimo e colide com outra opção). */
  readonly alternativo: string | null;
  readonly titulo: string;
  readonly caminhoPai: string;
}

/** Código da permissão de uma opção ativa da árvore. */
function codigoDa(no: NoArvore, o: OpcaoArvore, d: DestinoExecutavel): CodigoOpcao {
  const pre = d.prefixo ? [d.prefixo] : [];
  const titulo = normalizarTitulo(o.titulo || o.nome);
  const caminhoPai = no.caminho.slice(0, -1).join('\u0001');
  if (o.nivel === 0)
    return {
      codigo: `${d.modulo}.${recursoDe([...pre, 'modulo'])}.acessar`,
      alternativo: null,
      titulo,
      caminhoPai,
    };
  const verbo = no.folha ? verboDoTitulo(o.titulo || o.nome, d.modulo) : null;
  if (verbo) {
    const pai = no.caminho.slice(0, -1);
    const recurso = recursoDe([...pre, ...(pai.length > 0 ? pai : ['geral'])]);
    return {
      codigo: `${d.modulo}.${recurso}.${verbo}`,
      alternativo: CANONICO[verbo] === titulo ? null : `${d.modulo}.${recurso}.${camelo(o.titulo || o.nome)}`,
      titulo,
      caminhoPai,
    };
  }
  if (no.folha && no.caminho.length > 1) {
    return {
      codigo: `${d.modulo}.${recursoDe([...pre, ...no.caminho.slice(0, -1)])}.${camelo(no.caminho.at(-1) ?? '')}`,
      alternativo: null,
      titulo,
      caminhoPai,
    };
  }
  return {
    codigo: `${d.modulo}.${recursoDe([...pre, ...no.caminho])}.acessar`,
    alternativo: null,
    titulo,
    caminhoPai,
  };
}

/**
 * Opções diferentes (títulos diferentes sob o mesmo pai) que cairiam no mesmo código: o sinônimo fica com o
 * título como verbo ("Corrigir" ao lado de "Alterar" não vira retificar), para ninguém ganhar uma função
 * por agrupamento indevido. Opções iguais (mesmo título e caminho) continuam juntas (regra 2).
 */
function resolverColisoes(codigos: Map<number, CodigoOpcao>): Map<number, string> {
  const porCodigo = new Map<string, number[]>();
  for (const [id, c] of codigos) porCodigo.set(c.codigo, [...(porCodigo.get(c.codigo) ?? []), id]);
  const r = new Map<number, string>();
  for (const [id, c] of codigos) {
    const juntos = porCodigo.get(c.codigo) ?? [];
    const colide = juntos.some((x) => {
      const y = codigos.get(x) as CodigoOpcao;
      return y.titulo !== c.titulo && y.caminhoPai === c.caminhoPai;
    });
    r.set(id, colide && c.alternativo ? c.alternativo : c.codigo);
  }
  return r;
}

export function construirCatalogo(
  opcoes: readonly OpcaoArvore[],
  modulos: readonly ModuloArvore[],
): CatalogoGerado {
  const porId = new Map(modulos.map((m) => [m.id, m]));
  const exclusoes: ExclusaoOpcao[] = [];
  const porNivel = [0, 0, 0, 0, 0, 0, 0];
  const ativasPorModulo = new Map<number, OpcaoArvore[]>();
  for (const o of opcoes) {
    porNivel[o.nivel] = (porNivel[o.nivel] ?? 0) + 1;
    const m = porId.get(o.modulo);
    if (!m || m.sistema === 'SGO' || m.sistema === 'SGS') {
      exclusoes.push({ opcao: o.id, modulo: o.modulo, motivo: 'sistema-sgo-sgs' });
      continue;
    }
    if (!o.ativo) {
      exclusoes.push({ opcao: o.id, modulo: o.modulo, motivo: 'opcao-inativa' });
      continue;
    }
    if (!destinoDe(m)) {
      exclusoes.push({ opcao: o.id, modulo: o.modulo, motivo: 'modulo-sem-destino' });
      continue;
    }
    const lista = ativasPorModulo.get(o.modulo) ?? [];
    lista.push(o);
    ativasPorModulo.set(o.modulo, lista);
  }
  const arvore = new Map<number, NoArvore>();
  const permissaoDaOpcao = new Map<number, string>();
  const acumulado = new Map<
    string,
    { opcoes: number[]; modulos: Set<number>; exemplo: string; modulo: string }
  >();
  let saltosDeNivel = 0;
  for (const [idModulo, ativas] of [...ativasPorModulo].sort((a, b) => a[0] - b[0])) {
    const m = porId.get(idModulo) as ModuloArvore;
    const d = destinoDe(m) as DestinoExecutavel;
    const { nos, saltos } = reconstruir(ativas);
    saltosDeNivel += saltos;
    const codigos = resolverColisoes(
      new Map(ativas.map((o) => [o.id, codigoDa(nos.get(o.id) as NoArvore, o, d)])),
    );
    for (const o of ativas) {
      const no = nos.get(o.id) as NoArvore;
      arvore.set(o.id, no);
      const codigo = codigos.get(o.id) as string;
      permissaoDaOpcao.set(o.id, codigo);
      const a = acumulado.get(codigo) ?? {
        opcoes: [],
        modulos: new Set<number>(),
        exemplo: [m.nome, ...no.caminho].join(' › '),
        modulo: d.modulo,
      };
      a.opcoes.push(o.id);
      a.modulos.add(idModulo);
      acumulado.set(codigo, a);
    }
  }
  const permissoes: PermissaoGerada[] = [...acumulado]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([codigo, a]) => {
      const verbo = codigo.split('.')[2] ?? '';
      return {
        codigo,
        descricao: a.exemplo,
        opcoesLegado: [...a.opcoes].sort((x, y) => x - y),
        concessaoPorPerfil: null,
        categoria: categoriaDe(a.modulo, codigo.split('.')[1] ?? ''),
        criticidade: verbo === 'inativar' ? 'sensivel' : 'normal',
        escopos: ESCOPOS_DO_MODULO[a.modulo] ?? [],
        modulosLegado: [...a.modulos].sort((x, y) => x - y),
      };
    });
  return {
    permissoes,
    exclusoes,
    arvore,
    permissaoDaOpcao,
    contagens: {
      opcoes: opcoes.length,
      ativas: opcoes.filter((o) => o.ativo).length,
      porNivel,
      modulos: modulos.length,
      saltosDeNivel,
    },
  };
}
