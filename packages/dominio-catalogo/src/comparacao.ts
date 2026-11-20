// Comparação da edição nova com o que o banco do estabelecimento tem (ficha do M13, regra 6, terceiro passo;
// regras 4 e 5): cada item válido é novo, alterado (só os campos que mudaram) ou igual; o item que saiu da fonte
// é "removido na fonte" e fica como está (nada referenciado é apagado: o importador nunca exclui), salvo na entidade de
// lista positiva (EntidadeCatalogo.naSaidaDaFonte), em que ele vira alteração publicada para os valores de saída. Item
// protegido (motivos de glosa locais 0 e 3095) nunca muda. Entidade "só inclusão" (edição, competência ou
// vigência) nunca altera a linha passada: a diferença aparece, e a publicação inclui a linha nova da edição.
import type { DefinicaoCatalogo, TabelaReferenciaCatalogo } from '@sgh/contratos';
import type { ItemValidado, ValorItem } from './validacao.js';
import { camposDaChave, entidadeDe } from './validacao.js';

export type Comparacao = 'novo' | 'alterado' | 'igual' | 'removido';

export interface ItemComparado {
  readonly entidade: string;
  readonly linha: number;
  readonly chave: string;
  readonly resultado: 'valida' | 'erro';
  readonly comparacao: Comparacao | null;
  /** Valores atuais no banco (alterado, igual, removido). */
  readonly antes: Readonly<Record<string, ValorItem>> | null;
  /** Valores do arquivo (novo: todos; alterado: só os que mudam). */
  readonly depois: Readonly<Record<string, ValorItem>> | null;
  readonly motivos: readonly string[];
  /** Vai à publicação? (válido, não protegido, novo ou alterado). */
  readonly publicar: boolean;
}

/** Itens atuais da entidade lidos do banco (chave → campos no vocabulário do novo). */
export type AtuaisDaEntidade = ReadonlyMap<string, Readonly<Record<string, ValorItem>>>;

export interface TotaisComparacao {
  readonly novos: number;
  readonly alterados: number;
  readonly iguais: number;
  readonly removidos: number;
}

function iguais(a: ValorItem | undefined, b: ValorItem | undefined): boolean {
  const n = (v: ValorItem | undefined) =>
    v === undefined || v === null ? '' : typeof v === 'number' ? v : v.trim();
  const x = n(a);
  const y = n(b);
  if (typeof x === 'number' || typeof y === 'number') return Math.abs(Number(x) - Number(y)) < 1e-9;
  return x === y;
}

/** Campos que mudam (os campos da chave nunca: são a identidade do item). */
export function camposAlterados(
  chaves: ReadonlySet<string>,
  atual: Readonly<Record<string, ValorItem>>,
  novo: Readonly<Record<string, ValorItem>>,
): Record<string, ValorItem> {
  const r: Record<string, ValorItem> = {};
  for (const [k, v] of Object.entries(novo)) {
    if (chaves.has(k) || !(k in atual)) continue;
    if (!iguais(atual[k], v)) r[k] = v;
  }
  return r;
}

export interface OpcoesComparacao {
  /**
   * Escopo da comparação de removidos por entidade: só as chaves atuais que passam no filtro (ex.: CEP das UFs
   * do arquivo; a base vem por UF). Sem filtro, todas as atuais da entidade.
   */
  readonly escopo?: (entidade: string, campos: Readonly<Record<string, ValorItem>>) => boolean;
  /** Linha usada para os removidos (não estão no arquivo). */
  readonly linhaRemovido?: number;
  /**
   * Chaves que existem no banco, por entidade (para achar os removidos sem ler todos os campos). Sem ela, as
   * chaves de `atuais`.
   */
  readonly existentes?: ReadonlyMap<string, Iterable<string>>;
  /**
   * Códigos que existem no banco, por tabela referenciada (EntidadeCatalogo.referencias). Sem a tabela no mapa,
   * a referência não é conferida.
   */
  readonly referencias?: ReadonlyMap<TabelaReferenciaCatalogo, ReadonlySet<string>>;
}

/**
 * O item novo cujo código referenciado não existe no banco nem entra nesta carga não é incluído (o lote nunca
 * é recusado por referência inexistente): devolve os itens com o motivo e publicar = false.
 */
function conferirReferencias(
  def: DefinicaoCatalogo,
  itens: ItemComparado[],
  referencias: ReadonlyMap<TabelaReferenciaCatalogo, ReadonlySet<string>> | undefined,
): ItemComparado[] {
  if (!referencias) return itens;
  const novos = new Map<string, Set<string>>();
  for (const i of itens)
    if (i.comparacao === 'novo' && i.publicar) {
      const e = entidadeDe(def, i.entidade);
      const campo = e?.campos.find((c) => c.chave)?.nome;
      const v = campo ? camposDaChave(i.chave)[campo] : undefined;
      if (v) (novos.get(i.entidade) ?? novos.set(i.entidade, new Set()).get(i.entidade))?.add(v);
    }
  return itens.map((i) => {
    const e = entidadeDe(def, i.entidade);
    if (!e?.referencias || i.comparacao !== 'novo' || !i.publicar) return i;
    const chave = camposDaChave(i.chave);
    const faltam = e.referencias.filter((ref) => {
      const existentes = referencias.get(ref.tabela);
      if (!existentes) return false;
      const v = chave[ref.campo] ?? '';
      return !existentes.has(v) && !(ref.nestaCarga && novos.get(ref.nestaCarga)?.has(v));
    });
    if (faltam.length === 0) return i;
    return {
      ...i,
      publicar: false,
      motivos: [
        ...i.motivos,
        `não incluído: ${faltam.map((f) => `${f.titulo} ${chave[f.campo] ?? ''}`).join(' e ')} não existe no banco nem entra nesta carga`,
      ],
    };
  });
}

export function compararEdicao(
  def: DefinicaoCatalogo,
  itens: readonly ItemValidado[],
  atuais: ReadonlyMap<string, AtuaisDaEntidade>,
  o: OpcoesComparacao = {},
): { itens: ItemComparado[]; totais: TotaisComparacao } {
  const r: ItemComparado[] = [];
  const vistos = new Map<string, Set<string>>();
  for (const i of itens) {
    const e = entidadeDe(def, i.entidade);
    if (!e || i.resultado === 'erro') {
      r.push({ ...i, comparacao: null, antes: null, depois: null, publicar: false });
      continue;
    }
    const doBanco = atuais.get(i.entidade) ?? new Map();
    const set = vistos.get(i.entidade) ?? new Set<string>();
    set.add(i.chave);
    vistos.set(i.entidade, set);
    const atual = doBanco.get(i.chave);
    const chaveCampos = camposDaChave(i.chave);
    const protegido = (e.protegidos ?? []).some((p) => Object.values(chaveCampos).includes(p));
    if (!atual) {
      r.push({
        ...i,
        comparacao: 'novo',
        antes: null,
        depois: i.campos,
        motivos: protegido
          ? [...i.motivos, 'código protegido: nunca incluído']
          : e.semInclusao
            ? [...i.motivos, `não incluído: ${e.semInclusao}`]
            : i.motivos,
        publicar: !protegido && !e.semInclusao,
      });
      continue;
    }
    const chaves = new Set(e.campos.filter((c) => c.chave).map((c) => c.nome));
    const mudou = camposAlterados(chaves, atual, i.campos);
    const alterado = Object.keys(mudou).length > 0;
    const motivos = [...i.motivos];
    if (alterado && protegido) motivos.push('código protegido: nunca alterado');
    if (alterado && e.soInclusao) motivos.push('edição passada nunca é sobrescrita');
    r.push({
      ...i,
      comparacao: alterado ? 'alterado' : 'igual',
      antes: atual,
      depois: alterado ? mudou : null,
      motivos,
      publicar: !protegido && (e.porEdicao === true || (alterado && !e.soInclusao)),
    });
  }
  r.splice(0, r.length, ...conferirReferencias(def, r, o.referencias));
  let linha = o.linhaRemovido ?? 9_000_000;
  const porEntidade = new Map<string, Iterable<string>>(
    o.existentes ?? [...atuais].map(([e, m]) => [e, m.keys()] as [string, Iterable<string>]),
  );
  for (const [entidade, chavesBanco] of porEntidade) {
    const set = vistos.get(entidade) ?? new Set<string>();
    const doBanco = atuais.get(entidade) ?? new Map();
    for (const chave of chavesBanco) {
      if (set.has(chave)) continue;
      const campos = doBanco.get(chave) ?? camposDaChave(chave);
      if (o.escopo && !o.escopo(entidade, campos)) continue;
      const saida = entidadeDe(def, entidade)?.naSaidaDaFonte;
      if (saida) {
        // Lista positiva: o item que saiu da fonte volta aos valores de saída (alteração, nunca exclusão).
        const chaves = new Set(
          entidadeDe(def, entidade)
            ?.campos.filter((c) => c.chave)
            .map((c) => c.nome),
        );
        const mudou = camposAlterados(chaves, campos, saida);
        if (Object.keys(mudou).length === 0) continue;
        r.push({
          entidade,
          linha: linha++,
          chave,
          resultado: 'valida',
          comparacao: 'alterado',
          antes: campos,
          depois: mudou,
          motivos: ['saiu da lista na fonte: volta ao valor de fora da lista (nada é apagado)'],
          publicar: true,
        });
        continue;
      }
      r.push({
        entidade,
        linha: linha++,
        chave,
        resultado: 'valida',
        comparacao: 'removido',
        antes: campos,
        depois: null,
        motivos: ['removido na fonte: fica como está (nada é apagado)'],
        publicar: false,
      });
    }
  }
  const conta = (c: Comparacao) => r.filter((x) => x.comparacao === c).length;
  return {
    itens: r,
    totais: {
      novos: conta('novo'),
      alterados: conta('alterado'),
      iguais: conta('igual'),
      removidos: conta('removido'),
    },
  };
}
