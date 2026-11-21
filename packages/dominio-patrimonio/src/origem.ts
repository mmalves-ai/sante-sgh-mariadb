// Origem do bem patrimonial (M54, etapa 6; ficha, regra 11): o bem nasce da nota fiscal de entrada; sem documento de
// origem, só a doação com o termo registrado. Também: as unidades disponíveis de um item da nota (uma plaqueta por
// unidade, nunca mais bens que a quantidade da nota), o valor de cada unidade (o total do item repartido, a sobra do
// arredondamento na primeira, para a soma bater com a nota) e os padrões da depreciação (vida útil do grupo, início no
// mês seguinte ao da aquisição).
import {
  type CadastrarBem,
  GRUPOS_BEM,
  type GrupoBem,
  type GrupoSemente,
  ORIGEM_BEM_DOACAO,
} from '@sgh/contratos';

export interface ProblemaCadastro {
  readonly codigo: string;
  readonly campo: string | null;
  readonly mensagem: string;
}

export interface ItemNotaLido {
  readonly id: number;
  /** Nota de entrada do item. */
  readonly nota: number;
  readonly quantidade: number;
  readonly valorTotalCent: number;
  /** Bens já cadastrados deste item. */
  readonly jaCadastrados: number;
}

export interface ContextoCadastro {
  /** Origens do bem cadastradas: id → deprecia. */
  readonly origens: ReadonlyMap<number, { readonly depreciar: boolean }>;
  readonly tiposResponsavel: ReadonlySet<number>;
  readonly coeficientes: ReadonlySet<number>;
  /** Centros de custo ativos (ids). */
  readonly centrosAtivos: ReadonlySet<number>;
  readonly empresas: ReadonlySet<number>;
  /**
   * W0-08: os grupos do cadastro do estabelecimento (SGH_PAT_GRUPO; sem a chave, só a semente GRUPOS_BEM): o bem entra
   * só em grupo ativo, e a vida útil padrão é a do grupo NA HORA do cadastro (o bem a guarda; a do grupo mudar depois
   * não mexe no bem nem nas cotas já calculadas).
   */
  readonly grupos?: GruposDoCadastro;
  /** O item da nota (só no documento `nota`; null quando não existe ou não é da nota). */
  readonly item: ItemNotaLido | null;
  /** A data da nota (AAAA-MM-DD; só no documento `nota`). */
  readonly dataNota: string | null;
  readonly hoje: string;
}

/** Unidades do item que viram bem: a quantidade inteira da nota (fração ou menos de 1: o item é um bem só). */
export function unidadesDoItem(quantidade: number): number {
  const q = Math.floor(quantidade + 1e-9);
  return q >= 1 ? q : 1;
}

export function disponiveisDoItem(item: Pick<ItemNotaLido, 'quantidade' | 'jaCadastrados'>): number {
  return Math.max(0, unidadesDoItem(item.quantidade) - item.jaCadastrados);
}

/**
 * Valor de cada unidade cadastrada agora: as unidades `jaCadastrados` a `jaCadastrados + quantidade - 1` do item. A
 * unidade 0 leva a sobra do arredondamento; a soma das n unidades é o total do item.
 */
export function valoresDasUnidades(
  item: Pick<ItemNotaLido, 'quantidade' | 'valorTotalCent' | 'jaCadastrados'>,
  quantidade: number,
): number[] {
  const n = unidadesDoItem(item.quantidade);
  const base = Math.floor(item.valorTotalCent / n);
  const sobra = item.valorTotalCent - base * n;
  const r: number[] = [];
  for (let k = item.jaCadastrados; k < item.jaCadastrados + quantidade; k++)
    r.push(k === 0 ? base + sobra : base);
  return r;
}

/** Os grupos do cadastro: código → ativo e vida útil padrão (W0-08). */
export type GruposDoCadastro = ReadonlyMap<
  GrupoBem,
  { readonly ativo: boolean; readonly vidaUtilMeses: number }
>;

/** Os grupos da semente (GRUPOS_BEM, IN RFB) no formato do cadastro, todos ativos. */
export const gruposDaSemente = (): GruposDoCadastro =>
  new Map(Object.entries(GRUPOS_BEM).map(([k, v]) => [k, { ativo: true, vidaUtilMeses: v.vidaUtilMeses }]));

/** Vida útil padrão do grupo: a do cadastro; sem o cadastro, a da semente; grupo desconhecido, 120 meses. */
export const vidaUtilPadrao = (grupo: GrupoBem, grupos?: GruposDoCadastro): number =>
  grupos?.get(grupo)?.vidaUtilMeses ??
  (grupo in GRUPOS_BEM ? GRUPOS_BEM[grupo as GrupoSemente].vidaUtilMeses : 120);

/** A competência seguinte à da data (AAAA-MM-DD → AAAA-MM). */
export function mesSeguinte(dataOuCompetencia: string): string {
  const ano = Number(dataOuCompetencia.slice(0, 4));
  const mes = Number(dataOuCompetencia.slice(5, 7));
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
}

export const competenciaDe = (data: string): string => data.slice(0, 7);

function dataValida(d: string): boolean {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/** Problemas do cadastro (vazio: pode gravar). Regra 11 primeiro: documento de origem. */
export function problemasDoCadastro(x: CadastrarBem, c: ContextoCadastro): ProblemaCadastro[] {
  const p: ProblemaCadastro[] = [];
  const add = (codigo: string, campo: string | null, mensagem: string) => p.push({ codigo, campo, mensagem });
  const grupos = c.grupos ?? gruposDaSemente();
  const grupo = grupos.get(x.grupo);
  if (!grupo) add('grupo', 'grupo', 'Grupo do bem desconhecido.');
  else if (!grupo.ativo) add('grupo-inativo', 'grupo', 'O grupo do bem está inativo: escolha outro.');
  if (x.documento === 'termo') {
    if (x.origem !== ORIGEM_BEM_DOACAO)
      add(
        'sem-nota',
        'documento',
        'Sem nota fiscal de entrada, o bem só entra como doação, com o termo registrado.',
      );
    if (!dataValida(x.termoData) || x.termoData > c.hoje)
      add('termo-data', 'termoData', 'A data do termo é inválida ou futura.');
    if (!dataValida(x.dataAquisicao) || x.dataAquisicao > c.hoje)
      add('aquisicao-data', 'dataAquisicao', 'A data de aquisição é inválida ou futura.');
    if (!c.empresas.has(x.empresa)) add('empresa', 'empresa', 'Empresa desconhecida.');
  } else {
    const it = c.item;
    if (!it || it.nota !== x.nota) {
      add('item-nota', 'itemNota', 'O item não é desta nota fiscal de entrada.');
    } else {
      const disp = disponiveisDoItem(it);
      if (disp === 0)
        add('item-esgotado', 'quantidade', 'Todas as unidades deste item da nota já viraram bem.');
      else if (x.quantidade > disp)
        add(
          'item-quantidade',
          'quantidade',
          `Este item da nota tem só ${disp} unidade(s) sem bem cadastrado.`,
        );
      if (it.valorTotalCent <= 0) add('item-valor', 'itemNota', 'O item da nota não tem valor.');
    }
    if (!c.dataNota) add('nota-data', 'nota', 'A nota fiscal não tem data de entrada.');
  }
  const origem = c.origens.get(x.origem);
  if (!origem) add('origem', 'origem', 'Origem desconhecida.');
  if (!c.centrosAtivos.has(x.centro)) add('centro', 'centro', 'Centro de custo desconhecido ou inativo.');
  if (x.tipoResponsavel !== null && !c.tiposResponsavel.has(x.tipoResponsavel))
    add('tipo-responsavel', 'tipoResponsavel', 'Tipo de responsável desconhecido.');
  if (x.coeficiente !== null && !c.coeficientes.has(x.coeficiente))
    add('coeficiente', 'coeficiente', 'Coeficiente de turnos desconhecido.');
  const valorUnidade =
    x.documento === 'termo'
      ? x.valorCent
      : c.item
        ? Math.floor(c.item.valorTotalCent / unidadesDoItem(c.item.quantidade))
        : null;
  if (valorUnidade !== null && x.residualCent >= valorUnidade)
    add('residual', 'residualCent', 'O valor residual tem de ser menor que o valor do bem.');
  const aquisicao = x.documento === 'termo' ? x.dataAquisicao : c.dataNota;
  if (x.inicioDepreciacao !== null && aquisicao && x.inicioDepreciacao < competenciaDe(aquisicao))
    add('inicio', 'inicioDepreciacao', 'A depreciação não começa antes da aquisição.');
  return p;
}

export interface ValoresDoCadastro {
  readonly empresa: number | null;
  readonly dataAquisicao: string;
  readonly valores: readonly number[];
  readonly vidaUtilMeses: number;
  readonly inicioDepreciacao: string;
  readonly depreciavel: boolean;
}

/** Os valores efetivos do cadastro já conferido (padrões aplicados). */
export function valoresDoCadastro(
  x: CadastrarBem,
  c: Pick<ContextoCadastro, 'origens' | 'item' | 'dataNota' | 'grupos'>,
  empresaDaNota: number | null,
): ValoresDoCadastro {
  const dataAquisicao = x.documento === 'termo' ? x.dataAquisicao : (c.dataNota ?? '');
  const valores =
    x.documento === 'termo'
      ? Array.from({ length: x.quantidade }, () => x.valorCent)
      : c.item
        ? valoresDasUnidades(c.item, x.quantidade)
        : [];
  return {
    empresa: x.documento === 'termo' ? x.empresa : empresaDaNota,
    dataAquisicao,
    valores,
    vidaUtilMeses: x.vidaUtilMeses ?? vidaUtilPadrao(x.grupo, c.grupos),
    inicioDepreciacao: x.inicioDepreciacao ?? mesSeguinte(dataAquisicao),
    depreciavel: x.depreciavel ?? c.origens.get(x.origem)?.depreciar ?? false,
  };
}
