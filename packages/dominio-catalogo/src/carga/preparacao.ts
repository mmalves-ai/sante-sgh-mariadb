// Preparação da carga (ficha do M13, regra 6): lê os arquivos, valida e compara com o banco, e devolve as
// linhas da área de preparação (SGH_CAT_CARGA_LINHA), os totais e os itens a publicar, já divididos em lotes.
// O banco é lido por quem chama (fonte da API), nas chaves do arquivo e nas chaves do escopo dos removidos.
import {
  ITENS_POR_LOTE_CATALOGO,
  type DefinicaoCatalogo,
  type ItemLoteCatalogo,
  type TabelaReferenciaCatalogo,
} from '@sgh/contratos';
import {
  type AtuaisDaEntidade,
  compararEdicao,
  type EquivalenciasDoCampo,
  type ItemComparado,
} from '../comparacao.js';
import { conferirEdicao, type DecisaoEdicao } from '../edicao/vigencia.js';
import { type ArquivoCarga, lerArquivosDaCarga, type OpcoesLeitura } from '../leitura.js';
import { camposDaChave, validarItens, type ValorItem } from '../validacao.js';
import { planejarLotes } from './ciclo.js';

export interface LeituraDoBanco {
  /** Itens atuais (campos no vocabulário do novo) das chaves pedidas, por entidade. */
  atuais(entidade: string, chaves: readonly string[]): Promise<AtuaisDaEntidade>;
  /** Chaves atuais no escopo do arquivo (para os removidos); null: a entidade não lista removidos. */
  existentes(
    entidade: string,
    escopo: ReadonlyMap<string, ReadonlySet<string>>,
  ): Promise<Iterable<string> | null>;
  /** Edição mais nova que o banco tem e as versões TISS. */
  edicao(): Promise<{ ultima: string | null; versoesTiss: readonly string[] }>;
  /**
   * Dos códigos pedidos, os que existem na tabela referenciada (procedimento SIGTAP, CID-10, CBO). Sem ela
   * (dublês de teste), as referências não são conferidas.
   */
  referencias?(tabela: TabelaReferenciaCatalogo, codigos: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * Equivalências dos campos que o banco guarda por referência a um catálogo (campo → valor normalizado do arquivo →
   * valor que `atuais` devolve). Sem ela, os campos são comparados como vêm.
   */
  equivalencias?(entidade: string): Promise<ReadonlyMap<string, EquivalenciasDoCampo>>;
}

/** Códigos referenciados pelos itens válidos, por tabela (para uma leitura só por tabela). */
function codigosReferenciados(
  def: DefinicaoCatalogo,
  itens: readonly { entidade: string; chave: string; resultado: string }[],
): Map<TabelaReferenciaCatalogo, Set<string>> {
  const r = new Map<TabelaReferenciaCatalogo, Set<string>>();
  for (const i of itens) {
    if (i.resultado !== 'valida') continue;
    const e = def.entidades.find((x) => x.codigo === i.entidade);
    for (const ref of e?.referencias ?? []) {
      const v = camposDaChave(i.chave)[ref.campo];
      if (v) (r.get(ref.tabela) ?? r.set(ref.tabela, new Set()).get(ref.tabela))?.add(v);
    }
  }
  return r;
}

/**
 * Ordem de publicação: as entidades na ordem da definição (o CID-10 antes do par CID-O, o procedimento antes
 * dos pares), e dentro de cada uma a ordem do arquivo. Assim o código novo nunca vem num lote depois do par
 * que o usa.
 */
export function ordemDePublicacao<T extends { readonly entidade: string }>(
  def: DefinicaoCatalogo,
  itens: readonly T[],
): T[] {
  const pos = new Map(def.entidades.map((e, k) => [e.codigo, k]));
  return itens
    .map((x, k) => ({ x, k }))
    .sort((a, b) => (pos.get(a.x.entidade) ?? 99) - (pos.get(b.x.entidade) ?? 99) || a.k - b.k)
    .map(({ x }) => x);
}

export interface CargaPreparada {
  readonly edicao: string | null;
  readonly decisaoEdicao: DecisaoEdicao;
  readonly errosArquivo: readonly string[];
  readonly linhas: readonly ItemComparado[];
  readonly totais: {
    readonly linhas: number;
    readonly validas: number;
    readonly erros: number;
    readonly novos: number;
    readonly alterados: number;
    readonly iguais: number;
    readonly removidos: number;
  };
  readonly aPublicar: readonly ItemLoteCatalogo[];
  readonly lotes: number;
}

/** Valores do escopo (campo → valores do arquivo) que limitam os removidos: a UF na base de CEP. */
function escopoDoArquivo(
  def: DefinicaoCatalogo,
  linhas: readonly { entidade: string; campos: Readonly<Record<string, ValorItem>> }[],
) {
  const r = new Map<string, Set<string>>();
  if (def.codigo === 'cep')
    for (const l of linhas) {
      const uf = l.campos['uf'];
      if (typeof uf === 'string' && uf) (r.get('uf') ?? r.set('uf', new Set()).get('uf'))?.add(uf);
    }
  return r;
}

export function itemDoLote(i: ItemComparado): ItemLoteCatalogo {
  const chave = camposDaChave(i.chave);
  return {
    entidade: i.entidade,
    acao: i.comparacao === 'novo' ? 'incluir' : 'alterar',
    chave,
    valores: { ...(i.depois ?? {}) },
    ...(i.comparacao === 'alterado' && i.antes
      ? { antes: Object.fromEntries(Object.keys(i.depois ?? {}).map((k) => [k, i.antes?.[k] ?? null])) }
      : {}),
  };
}

export async function prepararCarga(
  def: DefinicaoCatalogo,
  arquivos: readonly ArquivoCarga[],
  edicaoInformada: string | null,
  banco: LeituraDoBanco,
  o: OpcoesLeitura & { readonly tamanhoLote?: number } = {},
): Promise<CargaPreparada> {
  const leitura = lerArquivosDaCarga(def.codigo, arquivos, edicaoInformada, o);
  const validacao = validarItens(def, leitura.itens);
  const ed = await banco.edicao();
  const decisaoEdicao = conferirEdicao({
    tipo: def.edicao,
    nova: leitura.edicao,
    ultimaNoBanco: ed.ultima,
    versoesTiss: ed.versoesTiss,
  });
  const porEntidade = new Map<string, string[]>();
  for (const i of validacao.itens)
    if (i.resultado === 'valida')
      (porEntidade.get(i.entidade) ?? porEntidade.set(i.entidade, []).get(i.entidade))?.push(i.chave);
  const atuais = new Map<string, AtuaisDaEntidade>();
  const existentes = new Map<string, Iterable<string>>();
  const escopo = escopoDoArquivo(def, validacao.itens);
  for (const e of def.entidades) {
    const chaves = porEntidade.get(e.codigo) ?? [];
    if (chaves.length === 0) continue;
    atuais.set(e.codigo, await banco.atuais(e.codigo, chaves));
    const lidas = await banco.existentes(e.codigo, escopo);
    const ex = lidas ? [...lidas] : null;
    existentes.set(e.codigo, ex ?? atuais.get(e.codigo)?.keys() ?? []);
    if (e.naSaidaDaFonte && ex) {
      // Lista positiva: os valores atuais das chaves que saíram da fonte (a alteração de saída leva o "antes").
      const noArquivo = new Set(chaves);
      const fora = ex.filter((k) => !noArquivo.has(k));
      if (fora.length > 0)
        atuais.set(
          e.codigo,
          new Map([...(atuais.get(e.codigo) ?? []), ...(await banco.atuais(e.codigo, fora))]),
        );
    }
  }
  const referencias = new Map<TabelaReferenciaCatalogo, ReadonlySet<string>>();
  if (banco.referencias)
    for (const [tabela, codigos] of codigosReferenciados(def, validacao.itens))
      referencias.set(tabela, await banco.referencias(tabela, [...codigos]));
  const equivalencias = new Map<string, ReadonlyMap<string, EquivalenciasDoCampo>>();
  if (banco.equivalencias)
    for (const ent of atuais.keys()) equivalencias.set(ent, await banco.equivalencias(ent));
  const cmp = compararEdicao(def, validacao.itens, atuais, { existentes, referencias, equivalencias });
  const errosArquivo = [
    ...leitura.erros.map((e) => e.mensagem),
    ...(decisaoEdicao.ok ? [] : [decisaoEdicao.motivo]),
  ];
  const aPublicar =
    errosArquivo.length === 0 && validacao.totais.erros === 0
      ? ordemDePublicacao(
          def,
          cmp.itens.filter((i) => i.publicar),
        ).map(itemDoLote)
      : [];
  return {
    edicao: leitura.edicao,
    decisaoEdicao,
    errosArquivo,
    linhas: cmp.itens,
    totais: { ...validacao.totais, ...cmp.totais },
    aPublicar,
    lotes: planejarLotes(aPublicar, o.tamanhoLote ?? ITENS_POR_LOTE_CATALOGO).length,
  };
}
