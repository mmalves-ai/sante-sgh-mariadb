// Cadastro do estoque (F3.6, linhas 1, 3 e 6 da análise de suprimentos): as regras do cadastro do item (material e
// medicamento), do local de estoque, do escopo do usuário por local, classificação e centro de custo, e a lista de
// separação da requisição a atender. Tudo puro: a porta lê e grava, o domínio decide.
// Desenho próprio: o item é gravado inteiro de uma vez (identificação, unidades e fatores, princípios ativos, vias,
// códigos de barras, apresentações com o registro sanitário e as estabilidades), com a recusa apontando o campo; o
// item e o local nunca são apagados (inativação com motivo, recusada com saldo); o escopo retirado fecha a vigência.

export interface RecusaCadastroEstoque {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

const r = (codigo: string, mensagem: string, ...campos: string[]): RecusaCadastroEstoque => ({
  codigo,
  mensagem,
  ...(campos.length ? { campos } : {}),
});

export const TIPOS_ITEM_ESTOQUE = [
  'medicamento',
  'material',
  'dieta',
  'solucao',
  'gas_medicinal',
  'opme',
  'outro',
] as const;
export type TipoItemEstoque = (typeof TIPOS_ITEM_ESTOQUE)[number];

export const PADROES_CODIGO_BARRAS = ['gtin', 'datamatrix', 'interno', 'outro'] as const;
export const CONDICOES_ESTABILIDADE = [
  'aberto',
  'reconstituido',
  'diluido',
  'lacre_rompido',
  'reembalado',
] as const;
export const SITUACOES_REGISTRO_SANITARIO = [
  'valido',
  'vencido',
  'cancelado',
  'suspenso',
  'em_revalidacao',
  'isento',
] as const;

/** GTIN-8, 12, 13 ou 14 com o dígito verificador (módulo 10). */
export function gtinValido(codigo: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(codigo)) return false;
  const d = [...codigo].map(Number);
  const dv = d.pop()!;
  const soma = d.reverse().reduce((t, x, i) => t + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === dv;
}

export interface PrincipioAtivoItem {
  readonly principio: number;
  readonly concentracao?: number | null;
  readonly unidade?: number | null;
  readonly principal?: boolean;
}
export interface ViaItem {
  readonly via: number;
  readonly padrao?: boolean;
}
export interface CodigoBarrasItem {
  readonly codigo: string;
  readonly padrao: (typeof PADROES_CODIGO_BARRAS)[number];
  readonly quantidade: number;
  readonly unidade: number;
  readonly principal?: boolean;
}
export interface ApresentacaoItem {
  readonly nomeComercial: string;
  readonly apresentacao?: string | null;
  readonly fabricante?: number | null;
  readonly quantidadeEmbalagem: number;
  readonly registro?: {
    readonly numero: string;
    readonly validade?: string | null;
    readonly situacao?: (typeof SITUACOES_REGISTRO_SANITARIO)[number];
  } | null;
}
export interface EstabilidadeItem {
  readonly condicao: (typeof CONDICOES_ESTABILIDADE)[number];
  readonly horas: number;
  readonly horasInfusaoMaxima?: number | null;
  /** A guarda a que a estabilidade se refere (ambiente, refrigerado, ao abrigo da luz); nula: qualquer. */
  readonly condicaoArmazenamento?: number | null;
  /** O diluente, na estabilidade da solução diluída; nulo: não se aplica. */
  readonly diluente?: number | null;
}

/** A chave da estabilidade: a condição, a guarda e o diluente (a mesma condição vale em diluentes diferentes). */
export const chaveEstabilidade = (s: {
  readonly condicao: string;
  readonly condicaoArmazenamento?: number | null;
  readonly diluente?: number | null;
}): string => `${s.condicao}|${s.condicaoArmazenamento ?? 0}|${s.diluente ?? 0}`;

export interface ItemEstoqueEntrada {
  readonly codigo: string;
  readonly nome: string;
  readonly nomeResumido?: string | null;
  readonly tipo: TipoItemEstoque;
  readonly grupo: number;
  readonly subgrupo?: number | null;
  readonly unidadeEstoque: number;
  readonly unidadeCompra?: number | null;
  readonly fatorCompraEstoque: number;
  readonly unidadeConsumo?: number | null;
  readonly fatorEstoqueConsumo: number;
  readonly unidadePrescricao?: number | null;
  readonly fatorConsumoPrescricao: number;
  readonly fabricante?: number | null;
  readonly gtin?: string | null;
  readonly ncm?: string | null;
  readonly cest?: string | null;
  readonly classeRisco?: 'I' | 'II' | 'III' | 'IV' | null;
  readonly controlaLote: boolean;
  readonly controlaValidade: boolean;
  readonly controlado: boolean;
  readonly antimicrobiano: boolean;
  readonly altaVigilancia: boolean;
  readonly fracionavel: boolean;
  readonly prescritivel: boolean;
  readonly estoqueMinimo?: number | null;
  readonly estoqueMaximo?: number | null;
  readonly principiosAtivos: readonly PrincipioAtivoItem[];
  readonly vias: readonly ViaItem[];
  readonly codigosBarras: readonly CodigoBarrasItem[];
  readonly apresentacoes: readonly ApresentacaoItem[];
  readonly estabilidades: readonly EstabilidadeItem[];
}

const repetidos = <T>(xs: readonly T[]) => xs.length !== new Set(xs).size;

/** As recusas do cadastro do item (vazia: pode gravar). A tela mostra todas de uma vez, cada uma no seu campo. */
export function conferirItemEstoque(e: ItemEstoqueEntrada): RecusaCadastroEstoque[] {
  const f: RecusaCadastroEstoque[] = [];
  if (!e.codigo.trim()) f.push(r('item-sem-codigo', 'Informe o código do item.', 'codigo'));
  if (!e.nome.trim()) f.push(r('item-sem-nome', 'Informe o nome do item.', 'nome'));
  if (!TIPOS_ITEM_ESTOQUE.includes(e.tipo)) f.push(r('item-tipo', 'Tipo de item inválido.', 'tipo'));
  for (const [k, v] of [
    ['fatorCompraEstoque', e.fatorCompraEstoque],
    ['fatorEstoqueConsumo', e.fatorEstoqueConsumo],
    ['fatorConsumoPrescricao', e.fatorConsumoPrescricao],
  ] as const)
    if (!(v > 0))
      f.push(r('item-fator', 'O fator de conversão entre unidades tem de ser maior que zero.', k));
  if (e.unidadeCompra && e.unidadeCompra === e.unidadeEstoque && e.fatorCompraEstoque !== 1)
    f.push(
      r(
        'item-fator-mesma-unidade',
        'Mesma unidade na compra e no estoque: o fator é 1.',
        'fatorCompraEstoque',
      ),
    );
  if (e.controlaLote && !e.controlaValidade)
    f.push(r('item-lote-sem-validade', 'Quem controla lote controla a validade.', 'controlaValidade'));
  if (e.controlado && e.tipo !== 'medicamento')
    f.push(r('item-controlado-tipo', 'Só medicamento é de controle especial.', 'controlado'));
  if (e.antimicrobiano && e.tipo !== 'medicamento')
    f.push(r('item-antimicrobiano-tipo', 'Só medicamento é antimicrobiano.', 'antimicrobiano'));
  if (e.tipo === 'medicamento' && e.principiosAtivos.length === 0)
    f.push(
      r(
        'item-sem-principio',
        'Medicamento sem princípio ativo não passa pela checagem de alergia e de duplicidade: informe ao menos um.',
        'principiosAtivos',
      ),
    );
  if (e.prescritivel && e.tipo === 'medicamento' && e.vias.length === 0)
    f.push(r('item-sem-via', 'Medicamento prescritível precisa de ao menos uma via de uso.', 'vias'));
  if (repetidos(e.principiosAtivos.map((p) => p.principio)))
    f.push(r('item-principio-repetido', 'Princípio ativo repetido.', 'principiosAtivos'));
  if (e.principiosAtivos.filter((p) => p.principal).length > 1)
    f.push(r('item-principio-principal', 'Só um princípio ativo é o principal.', 'principiosAtivos'));
  if (e.principiosAtivos.some((p) => p.concentracao != null && (!(p.concentracao > 0) || !p.unidade)))
    f.push(
      r('item-concentracao', 'Concentração maior que zero e com a unidade de medida.', 'principiosAtivos'),
    );
  if (repetidos(e.vias.map((v) => v.via))) f.push(r('item-via-repetida', 'Via de uso repetida.', 'vias'));
  if (e.vias.filter((v) => v.padrao).length > 1)
    f.push(r('item-via-padrao', 'Só uma via de uso é a padrão.', 'vias'));
  if (e.gtin && !gtinValido(e.gtin))
    f.push(r('item-gtin', 'GTIN inválido (dígito verificador não confere).', 'gtin'));
  if (e.ncm && !/^\d{8}$/.test(e.ncm)) f.push(r('item-ncm', 'A classificação fiscal tem 8 dígitos.', 'ncm'));
  if (e.cest && !/^\d{7}$/.test(e.cest)) f.push(r('item-cest', 'O código CEST tem 7 dígitos.', 'cest'));
  if (e.estoqueMinimo != null && e.estoqueMaximo != null && e.estoqueMaximo < e.estoqueMinimo)
    f.push(r('item-estoque-limites', 'O estoque máximo não pode ser menor que o mínimo.', 'estoqueMaximo'));
  if (repetidos(e.codigosBarras.map((c) => c.codigo)))
    f.push(r('item-barras-repetido', 'Código de barras repetido no item.', 'codigosBarras'));
  for (const c of e.codigosBarras) {
    if (!c.codigo.trim()) f.push(r('item-barras-vazio', 'Código de barras vazio.', 'codigosBarras'));
    else if (c.padrao === 'gtin' && !gtinValido(c.codigo))
      f.push(r('item-barras-gtin', `Código ${c.codigo}: GTIN inválido.`, 'codigosBarras'));
    if (!(c.quantidade > 0))
      f.push(
        r('item-barras-quantidade', 'A quantidade do código de barras é maior que zero.', 'codigosBarras'),
      );
  }
  if (e.codigosBarras.filter((c) => c.principal).length > 1)
    f.push(r('item-barras-principal', 'Só um código de barras é o principal.', 'codigosBarras'));
  for (const a of e.apresentacoes) {
    if (!a.nomeComercial.trim())
      f.push(r('item-apresentacao-nome', 'Informe o nome comercial da apresentação.', 'apresentacoes'));
    if (!(a.quantidadeEmbalagem > 0))
      f.push(
        r('item-apresentacao-quantidade', 'A quantidade da embalagem é maior que zero.', 'apresentacoes'),
      );
    if (a.registro && !/^\d{9,13}$/.test(a.registro.numero))
      f.push(r('item-registro', 'O registro sanitário tem de 9 a 13 dígitos.', 'apresentacoes'));
  }
  if (
    repetidos(
      e.apresentacoes.map((a) => `${a.fabricante ?? 0}|${a.nomeComercial.trim()}|${a.apresentacao ?? ''}`),
    )
  )
    f.push(
      r('item-apresentacao-repetida', 'Apresentação repetida (mesmo fabricante e nome).', 'apresentacoes'),
    );
  if (e.tipo === 'opme' && !e.apresentacoes.some((a) => a.registro))
    f.push(
      r(
        'item-opme-sem-registro',
        'OPME exige ao menos uma apresentação com registro sanitário.',
        'apresentacoes',
      ),
    );
  if (repetidos(e.estabilidades.map(chaveEstabilidade)))
    f.push(
      r(
        'item-estabilidade-repetida',
        'Estabilidade repetida (mesma condição, guarda e diluente).',
        'estabilidades',
      ),
    );
  if (e.estabilidades.some((s) => s.diluente != null && s.condicao !== 'diluido'))
    f.push(r('item-estabilidade-diluente', 'O diluente só vale na condição diluída.', 'estabilidades'));
  for (const s of e.estabilidades) {
    if (!CONDICOES_ESTABILIDADE.includes(s.condicao))
      f.push(r('item-estabilidade-condicao', 'Condição de estabilidade inválida.', 'estabilidades'));
    if (!(s.horas > 0) || (s.horasInfusaoMaxima != null && !(s.horasInfusaoMaxima > 0)))
      f.push(r('item-estabilidade-horas', 'As horas de estabilidade são maiores que zero.', 'estabilidades'));
  }
  return f;
}

/** A situação do registro sanitário na data: o vencido aparece como vencido, mesmo gravado como válido. */
export function situacaoRegistroNaData(
  situacao: (typeof SITUACOES_REGISTRO_SANITARIO)[number],
  validade: string | null | undefined,
  hoje: string,
): (typeof SITUACOES_REGISTRO_SANITARIO)[number] {
  return situacao === 'valido' && validade && validade < hoje ? 'vencido' : situacao;
}

/** O que o item já tem no estoque: com saldo ou movimento, a unidade, os fatores e o controle de lote ficam. */
export interface UsoDoItem {
  readonly saldoTotal: number;
  readonly movimentos: number;
}
type IdentidadeEstoque = Pick<
  ItemEstoqueEntrada,
  | 'tipo'
  | 'unidadeEstoque'
  | 'unidadeCompra'
  | 'fatorCompraEstoque'
  | 'unidadeConsumo'
  | 'fatorEstoqueConsumo'
  | 'unidadePrescricao'
  | 'fatorConsumoPrescricao'
  | 'controlaLote'
  | 'controlaValidade'
>;
const CAMPOS_TRAVADOS_COM_USO: readonly (keyof IdentidadeEstoque)[] = [
  'tipo',
  'unidadeEstoque',
  'unidadeCompra',
  'fatorCompraEstoque',
  'unidadeConsumo',
  'fatorEstoqueConsumo',
  'unidadePrescricao',
  'fatorConsumoPrescricao',
  'controlaLote',
  'controlaValidade',
];

/**
 * Alterar o item que já tem saldo ou movimento: a unidade do estoque, as unidades e os fatores de conversão, o tipo e
 * o controle de lote e de validade não mudam, porque mudariam o significado do saldo, do custo e dos lotes gravados.
 * Para mudar, cadastre um item novo e transfira (ou zere e inative o antigo).
 */
export function conferirAlteracaoItem(
  atual: IdentidadeEstoque,
  novo: IdentidadeEstoque,
  uso: UsoDoItem,
): RecusaCadastroEstoque[] {
  if (uso.saldoTotal <= 0 && uso.movimentos <= 0) return [];
  const mudou = CAMPOS_TRAVADOS_COM_USO.filter(
    (k) => (atual[k] ?? null) !== (novo[k] ?? null) && Number(atual[k] ?? 0) !== Number(novo[k] ?? 0),
  );
  return mudou.map((k) =>
    r(
      'item-com-uso-trava',
      'O item já tem saldo ou movimento: unidade, fator de conversão, tipo e controle de lote e validade não mudam. Cadastre um item novo para a nova forma.',
      k,
    ),
  );
}

/** Inativar o item: com motivo, sem saldo em nenhum local e sem requisição ou pedido de compra em aberto. */
export function conferirInativacaoItem(e: {
  readonly motivo: string;
  readonly saldoTotal: number;
  readonly requisicoesAbertas?: number;
  readonly pedidosAbertos?: number;
}): RecusaCadastroEstoque | null {
  if (e.motivo.trim().length < 5)
    return r('inativar-sem-motivo', 'Informe o motivo da inativação.', 'motivo');
  if (e.saldoTotal > 0)
    return r(
      'inativar-com-saldo',
      `O item ainda tem ${e.saldoTotal} em estoque: zere o saldo (saída, devolução ou acerto) antes de inativar.`,
      'situacao',
    );
  if ((e.requisicoesAbertas ?? 0) > 0)
    return r(
      'inativar-item-com-requisicao',
      `O item está em ${e.requisicoesAbertas} requisição(ões) em aberto: atenda ou cancele antes de inativar.`,
      'situacao',
    );
  if ((e.pedidosAbertos ?? 0) > 0)
    return r(
      'inativar-item-com-pedido',
      `O item está em ${e.pedidosAbertos} pedido(s) de compra em aberto: receba ou cancele antes de inativar.`,
      'situacao',
    );
  return null;
}

// ── Local de estoque ─────────────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_LOCAL_ESTOQUE = [
  'almoxarifado',
  'farmacia_central',
  'farmacia_satelite',
  'carrinho',
  'posto',
  'consignado',
  'producao',
  'cme',
  'outro',
] as const;

export interface LocalEstoqueEntrada {
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: (typeof TIPOS_LOCAL_ESTOQUE)[number];
  readonly setor?: number | null;
  readonly centroCusto?: number | null;
  readonly localOrigem?: number | null;
  readonly localDevolucao?: number | null;
  readonly atendeSetor: boolean;
  readonly atendePaciente: boolean;
  readonly atendeTransferencia: boolean;
  readonly atendimentoParcial: boolean;
  /**
   * Só informativo (divergência intencional, 05-SUP linha 3): a saída confere sempre o saldo, e o saldo nunca fica
   * negativo (prática de mercado e rastreabilidade de lote e validade, RDC 430/2020). O campo é guardado como veio do
   * cadastro e não libera saída sem saldo.
   */
  readonly verificaSaldo: boolean;
  readonly usaCodigoBarras: boolean;
  readonly apenasUrgente: boolean;
  readonly tipoReposicao?: 'manual' | 'ponto_pedido' | 'cota' | null;
  readonly horasAntecedencia?: number | null;
  /** Os setores atendidos (requisição, dispensação ou ambos); um é o padrão. */
  readonly setores: readonly {
    readonly setor: number;
    readonly tipo: 'requisicao' | 'dispensacao' | 'ambos';
    readonly padrao?: boolean;
  }[];
  /** A classificação do local: o grupo, o subgrupo ou o item que ele movimenta (um alvo por linha). */
  readonly classificacoes: readonly {
    readonly grupo?: number | null;
    readonly subgrupo?: number | null;
    readonly item?: number | null;
  }[];
}

export function conferirLocalEstoque(
  e: LocalEstoqueEntrada,
  id: number | null = null,
): RecusaCadastroEstoque[] {
  const f: RecusaCadastroEstoque[] = [];
  if (!e.codigo.trim()) f.push(r('local-sem-codigo', 'Informe o código do local.', 'codigo'));
  if (!e.nome.trim()) f.push(r('local-sem-nome', 'Informe o nome do local.', 'nome'));
  if (!TIPOS_LOCAL_ESTOQUE.includes(e.tipo)) f.push(r('local-tipo', 'Tipo de local inválido.', 'tipo'));
  if (id !== null && (e.localOrigem === id || e.localDevolucao === id))
    f.push(r('local-proprio', 'O local não abastece nem recebe devolução de si mesmo.', 'localOrigem'));
  if (e.horasAntecedencia != null && !(e.horasAntecedencia >= 0 && e.horasAntecedencia <= 720))
    f.push(r('local-antecedencia', 'Antecedência entre 0 e 720 horas.', 'horasAntecedencia'));
  if (e.tipoReposicao === 'ponto_pedido' && !e.localOrigem)
    f.push(
      r(
        'local-reposicao-sem-origem',
        'Reposição por ponto de pedido precisa do local que abastece.',
        'localOrigem',
      ),
    );
  if (repetidos(e.setores.map((s) => s.setor)))
    f.push(r('local-setor-repetido', 'Setor repetido no local.', 'setores'));
  if (e.setores.filter((s) => s.padrao).length > 1)
    f.push(r('local-setor-padrao', 'Só um setor é o padrão do local.', 'setores'));
  for (const c of e.classificacoes)
    if ([c.grupo, c.subgrupo, c.item].filter((x) => x != null).length !== 1)
      f.push(
        r(
          'local-classificacao',
          'Cada linha da classificação é um grupo, um subgrupo ou um item.',
          'classificacoes',
        ),
      );
  const alvos = e.classificacoes.map((c) => `${c.grupo ?? ''}|${c.subgrupo ?? ''}|${c.item ?? ''}`);
  if (repetidos(alvos))
    f.push(r('local-classificacao-repetida', 'Classificação repetida.', 'classificacoes'));
  return f;
}

export function conferirInativacaoLocal(e: {
  readonly motivo: string;
  readonly saldoTotal: number;
  readonly requisicoesAbertas: number;
}): RecusaCadastroEstoque | null {
  if (e.motivo.trim().length < 5)
    return r('inativar-sem-motivo', 'Informe o motivo da inativação.', 'motivo');
  if (e.saldoTotal > 0)
    return r('inativar-local-com-saldo', 'O local ainda tem saldo: transfira antes de inativar.', 'situacao');
  if (e.requisicoesAbertas > 0)
    return r(
      'inativar-local-com-requisicao',
      `O local tem ${e.requisicoesAbertas} requisição(ões) em aberto: atenda ou cancele antes.`,
      'situacao',
    );
  return null;
}

// ── Escopo do usuário ────────────────────────────────────────────────────────────────────────────────────────────

export const PERMISSOES_LOCAL_USUARIO = [
  'requisitar',
  'atender',
  'autorizarRequisicao',
  'receberNota',
  'conferirRecebimento',
  'transferir',
  'devolver',
  'ajustar',
  'inventariar',
  'autorizarPedido',
  'movimentarControlado',
  'movimentarAntimicrobiano',
  'desbloquearFechamento',
  'visualizaPreco',
] as const;
export type PermissaoLocalUsuario = (typeof PERMISSOES_LOCAL_USUARIO)[number];

export function conferirEscopoLocal(e: {
  readonly permissoes: readonly PermissaoLocalUsuario[];
  readonly variacaoValorPct?: number | null;
}): RecusaCadastroEstoque | null {
  if (e.permissoes.length === 0)
    return r(
      'escopo-vazio',
      'Marque ao menos uma ação no local (ou retire o local do usuário).',
      'permissoes',
    );
  if (e.permissoes.some((p) => !PERMISSOES_LOCAL_USUARIO.includes(p)))
    return r('escopo-acao', 'Ação desconhecida no local.', 'permissoes');
  if (e.variacaoValorPct != null && !(e.variacaoValorPct >= 0 && e.variacaoValorPct <= 100))
    return r('escopo-variacao', 'A variação do valor unitário vai de 0 a 100%.', 'variacaoValorPct');
  return null;
}

/** A concessão por classificação ou por centro de custo: vigência coerente e ao menos uma permissão. */
export function conferirConcessaoVigente(e: {
  readonly inicio: string;
  readonly fim?: string | null;
  readonly permissoes: readonly string[];
}): RecusaCadastroEstoque | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.inicio))
    return r('concessao-inicio', 'Informe o início da vigência.', 'inicio');
  if (e.fim && e.fim < e.inicio)
    return r('concessao-vigencia', 'O fim da vigência é depois do início.', 'fim');
  if (e.permissoes.length === 0) return r('concessao-vazia', 'Marque ao menos uma permissão.', 'permissoes');
  return null;
}

/**
 * Retirar a concessão deixa de valer na hora, com o histórico guardado:
 * - a que começou antes de hoje é encerrada (o fim vai para a véspera de hoje);
 * - a que começa hoje ou no futuro nunca valeu um dia inteiro: é cancelada (marca e motivo na trilha);
 * - a já encerrada é recusada.
 */
export type RetiradaConcessao =
  | { readonly acao: 'encerrar'; readonly fim: string }
  | { readonly acao: 'cancelar' }
  | { readonly acao: 'recusar'; readonly recusa: RecusaCadastroEstoque };

export function retiradaDaConcessao(
  e: { readonly inicio: string; readonly fim?: string | null; readonly motivo: string },
  hoje: string,
): RetiradaConcessao {
  if (e.motivo.trim().length < 5)
    return { acao: 'recusar', recusa: r('retirar-sem-motivo', 'Informe o motivo da retirada.', 'motivo') };
  if (e.inicio >= hoje) return { acao: 'cancelar' };
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const fim = d.toISOString().slice(0, 10);
  if (e.fim && e.fim <= fim)
    return { acao: 'recusar', recusa: r('concessao-encerrada', 'A concessão já está encerrada.', 'id') };
  return { acao: 'encerrar', fim };
}

/**
 * Os centros de custo do escopo pelas concessões do usuário no estabelecimento. Sem restrição só quando o usuário
 * nunca teve concessão de centro de custo ali (nem vigente, nem encerrada, nem cancelada): retirar a última não abre
 * todos os centros. Requisitar e dar saída pesam cada um pela sua marca.
 */
export function centrosDasConcessoes(
  concessoes: readonly {
    readonly centro: number;
    readonly requisitar: boolean;
    readonly saida: boolean;
    readonly vigente: boolean;
  }[],
): { todosCentros: boolean; centrosCusto: Set<number>; centrosSaida: Set<number> } {
  const vig = concessoes.filter((x) => x.vigente);
  return {
    todosCentros: concessoes.length === 0,
    centrosCusto: new Set(vig.filter((x) => x.requisitar).map((x) => x.centro)),
    centrosSaida: new Set(vig.filter((x) => x.saida).map((x) => x.centro)),
  };
}

// ── Lista de separação ───────────────────────────────────────────────────────────────────────────────────────────

/** As situações em que a requisição pode ser atendida (as mesmas que o atendimento aceita). */
export const SITUACOES_REQUISICAO_ATENDIVEIS = [
  'solicitada',
  'autorizada',
  'em_separacao',
  'atendida_parcial',
] as const;

/** A lista de separação só sai para requisição que pode ser atendida. */
export function conferirRequisicaoSeparavel(situacao: string): RecusaCadastroEstoque | null {
  return (SITUACOES_REQUISICAO_ATENDIVEIS as readonly string[]).includes(situacao)
    ? null
    : r(
        'separacao-requisicao-nao-atendivel',
        `A requisição está ${situacao.replace('_', ' ')}: não há o que separar.`,
        'requisicao',
      );
}

export interface ItemASeparar {
  readonly sequencia: number;
  readonly item: number;
  readonly nome: string;
  readonly unidade: string;
  readonly solicitada: number;
  readonly atendida: number;
  readonly cancelada: number;
  /** O item controla lote: a falta é o que os lotes liberados e válidos não cobrem. */
  readonly controlaLote?: boolean;
}
export interface LoteParaSeparar {
  readonly lote: string;
  readonly validade: string;
  readonly quantidade: number;
}
export interface LinhaSeparacao {
  readonly sequencia: number;
  readonly item: number;
  readonly nome: string;
  readonly unidade: string;
  readonly aSeparar: number;
  readonly endereco: string | null;
  readonly outrosEnderecos: readonly string[];
  readonly lotes: readonly {
    readonly lote: string;
    readonly validade: string;
    readonly quantidade: number;
  }[];
  readonly saldo: number;
  readonly falta: number;
}

const q4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * A lista de separação da requisição: só o que falta atender, na ordem do caminho no armazém (o endereço
 * preferencial do item, itens sem endereço no fim), com os lotes sugeridos pela validade mais próxima (vencidos de
 * fora) e a falta quando o saldo não cobre.
 */
export function montarSeparacao(
  itens: readonly ItemASeparar[],
  enderecos: ReadonlyMap<number, readonly { readonly codigo: string; readonly preferencial: boolean }[]>,
  lotes: ReadonlyMap<number, readonly LoteParaSeparar[]>,
  saldos: ReadonlyMap<number, number>,
  hoje: string,
): LinhaSeparacao[] {
  const linhas: LinhaSeparacao[] = [];
  for (const it of itens) {
    const aSeparar = q4(it.solicitada - it.atendida - it.cancelada);
    if (aSeparar <= 0) continue;
    const ends = [...(enderecos.get(it.item) ?? [])].sort(
      (a, b) => Number(b.preferencial) - Number(a.preferencial) || a.codigo.localeCompare(b.codigo),
    );
    const validos = [...(lotes.get(it.item) ?? [])]
      .filter((l) => l.quantidade > 0 && l.validade >= hoje)
      .sort((a, b) => a.validade.localeCompare(b.validade) || a.lote.localeCompare(b.lote));
    const sugeridos: { lote: string; validade: string; quantidade: number }[] = [];
    let resta = aSeparar;
    for (const l of validos) {
      if (resta <= 0) break;
      const tira = Math.min(resta, l.quantidade);
      sugeridos.push({ lote: l.lote, validade: l.validade, quantidade: q4(tira) });
      resta = q4(resta - tira);
    }
    const saldo = saldos.get(it.item) ?? 0;
    const comLote = it.controlaLote ?? (lotes.get(it.item)?.length ?? 0) > 0;
    const cobre = comLote ? aSeparar - resta : Math.min(aSeparar, saldo);
    linhas.push({
      sequencia: it.sequencia,
      item: it.item,
      nome: it.nome,
      unidade: it.unidade,
      aSeparar,
      endereco: ends[0]?.codigo ?? null,
      outrosEnderecos: ends.slice(1).map((e) => e.codigo),
      lotes: sugeridos,
      saldo,
      falta: q4(Math.max(0, aSeparar - cobre)),
    });
  }
  return linhas.sort(
    (a, b) =>
      Number(a.endereco === null) - Number(b.endereco === null) ||
      (a.endereco ?? '').localeCompare(b.endereco ?? '') ||
      a.nome.localeCompare(b.nome) ||
      a.sequencia - b.sequencia,
  );
}
