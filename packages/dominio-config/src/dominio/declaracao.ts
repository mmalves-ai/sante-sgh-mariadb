// Regra 1 e regra 5 do M08 (cap-09 §9.5; cap-10 §10.8; roteiro 4.8): a declaração é a única fonte do CRUD
// genérico. Esta conferência pura recusa a declaração incompleta ou incoerente ANTES de gerar lista,
// formulário, permissão e operações: sem opção legada nem permissão nova; coluna fora do catálogo RDB$;
// tamanho acima do da coluna; NOT NULL sem valor na inclusão; situação sem coluna; ação de escrita em
// domínio de fonte oficial ou de sistema; item da árvore inexistente; tabela fora da matriz com o destino
// esperado. Recebe os catálogos como dados (o teste e o verificador passam os versionados).
import {
  type AcaoDominio,
  type DeclaracaoDominio,
  type DeclaracaoPermissao,
  permissaoDoDominio,
  SUBITENS_DOMINIOS,
} from '@sgh/contratos';

/** Coluna como o catálogo RDB$ a descreve (packages/legado/src/tipos/catalogo.json). */
export interface ColunaCatalogo {
  readonly nome: string;
  /** Tipo declarado (`VARCHAR(30)`, `SMALLINT`, `NUMERIC(2,0)`, `CHAR(1)`, `TIMESTAMP`…). */
  readonly tipo: string;
  readonly anulavel: boolean;
  readonly padrao: string | null;
}

export interface TabelaCatalogo {
  readonly pk: readonly string[];
  readonly colunas: readonly ColunaCatalogo[];
}

export interface ContextoDeclaracao {
  readonly permissoes: ReadonlyMap<string, DeclaracaoPermissao>;
  readonly tabela: (nome: string) => TabelaCatalogo | null;
  readonly itensArvore: ReadonlySet<string>;
  /** Destino na matriz de cobertura (`migrar-crud`, `carga-referencia`…), ou null fora da matriz. */
  readonly destino: (tabela: string) => string | null;
  /** Generators que os triggers BI da tabela usam (estratégia de ID). */
  readonly triggerGeraChave?: (tabela: string) => boolean;
}

export interface ProblemaDeclaracao {
  readonly regra: string;
  readonly mensagem: string;
}

const ESCRITA: readonly AcaoDominio[] = ['criar', 'editar', 'inativar'];
const CAMPO = /^[a-z][a-zA-Z0-9]{0,40}$/;
const COLUNA = /^[A-Z][A-Z0-9_$]{0,30}$/;

/** Tamanho em caracteres (= bytes CP1252) de VARCHAR(n)/CHAR(n); dígitos de NUMERIC(p,0); null nos demais. */
export function tamanhoDoTipo(tipo: string): { base: string; tamanho: number | null; escala: number | null } {
  const m = /^([A-Z ]+?)(?:\((\d+)(?:,\s*(\d+))?\))?$/.exec(tipo.trim().toUpperCase());
  if (!m) return { base: tipo, tamanho: null, escala: null };
  return {
    base: (m[1] ?? '').trim(),
    tamanho: m[2] === undefined ? null : Number(m[2]),
    escala: m[3] === undefined ? null : Number(m[3]),
  };
}

/** Limite superior de um inteiro do catálogo (SMALLINT, INTEGER, NUMERIC(p,0)). */
export function maximoInteiro(tipo: string): number | null {
  const t = tamanhoDoTipo(tipo);
  if (t.base === 'SMALLINT') return 32_767;
  if (t.base === 'INTEGER') return 2_147_483_647;
  if ((t.base === 'NUMERIC' || t.base === 'DECIMAL') && t.escala === 0 && t.tamanho !== null)
    return 10 ** t.tamanho - 1;
  return null;
}

export function validarDeclaracao(d: DeclaracaoDominio, ctx: ContextoDeclaracao): ProblemaDeclaracao[] {
  const p: ProblemaDeclaracao[] = [];
  const falha = (regra: string, mensagem: string) => p.push({ regra, mensagem });
  const pub = d.publico;
  const id = `${pub.modulo}.${pub.recurso}`;

  // Regra 1: permissão de cada ação, com opção do legado ou concessão por perfil (recurso novo).
  if (!pub.acoes.includes('ler')) falha('acoes', `${id}: toda declaração tem a ação ler.`);
  for (const a of pub.acoes) {
    const codigo = permissaoDoDominio(pub, a);
    const perm = ctx.permissoes.get(codigo);
    const opcoes = pub.opcoesLegado[a] ?? (a === 'ler' ? pub.opcoesLegado.ler : undefined);
    if (!perm) falha('permissao', `${id}: falta a permissão ${codigo} no catálogo.`);
    else if (perm.opcoesLegado.length === 0 && perm.concessaoPorPerfil === null)
      falha('permissao', `${id}: ${codigo} sem opção do legado nem concessão por perfil.`);
    if (!opcoes || opcoes.length === 0) falha('opcoes-legado', `${id}: a ação ${a} não tem opção do legado.`);
  }
  // Regra 5: fonte oficial, sistema e enumeração interna só para consulta.
  const escreve = pub.acoes.some((a) => ESCRITA.includes(a));
  if (pub.natureza !== 'editavel' && escreve)
    falha('natureza', `${id}: domínio ${pub.natureza} aparece só para consulta (nenhuma ação de escrita).`);
  if (pub.natureza !== 'editavel' && !pub.motivoSomenteLeitura)
    falha('natureza', `${id}: diga por que o domínio é só de consulta.`);
  // M11: editável sem inclusão só com o motivo (todos os códigos do CHECK usados; a linha nasce de outro cadastro).
  if (pub.natureza === 'editavel' && !pub.acoes.includes('criar') && !pub.semInclusao)
    falha('natureza', `${id}: domínio editável inclui (sem incluir, a natureza é outra).`);
  if (pub.semInclusao && pub.acoes.includes('criar'))
    falha('natureza', `${id}: semInclusao com a ação criar (escolha uma).`);
  if (!(pub.subitem in SUBITENS_DOMINIOS) || !ctx.itensArvore.has(SUBITENS_DOMINIOS[pub.subitem]))
    falha('arvore', `${id}: o subitem ${pub.subitem} não existe na árvore de menus.`);

  const destino = ctx.destino(d.tabela);
  // M14: a enumeração interna pode vir de `migrar-leitura` (dias da semana: a matriz manda só ler).
  const destinosAceitos =
    pub.natureza === 'carga-referencia'
      ? ['carga-referencia']
      : pub.natureza === 'enumeracao'
        ? ['migrar-crud', 'migrar-leitura']
        : ['migrar-crud'];
  if (destino === null) falha('matriz', `${id}: a tabela não está na matriz de cobertura.`);
  else if (!destinosAceitos.includes(destino))
    falha('matriz', `${id}: destino ${destino} na matriz não casa com a natureza ${pub.natureza}.`);

  const cat = ctx.tabela(d.tabela);
  if (!cat) {
    falha('catalogo', `${id}: a tabela não existe no catálogo RDB$.`);
    return p;
  }
  // M14: chave composta declarada inteira, na ordem do catálogo.
  const chaves = d.chaveComposta ?? [d.chave];
  // M51.4: tabela sem PK no catálogo (ex.: leitos de UTI): a chave é a coluna gerada pelo trigger BI e a declaração diz o
  // índice único (natural) que o CRUD confere antes do banco; sem os dois, a chave tem de ser a PK.
  const chaveDaColuna = d.colunas.find((c) => c.coluna === d.chave);
  const semPkComChaveGerada =
    cat.pk.length === 0 &&
    !d.chaveComposta &&
    d.unico.length > 0 &&
    chaveDaColuna?.codigo === 'generator' &&
    (ctx.triggerGeraChave?.(d.tabela) ?? true);
  if (!semPkComChaveGerada && (cat.pk.length !== chaves.length || cat.pk.some((k, i) => chaves[i] !== k)))
    falha('chave', `${id}: a chave declarada não é a chave primária do catálogo.`);
  if (d.chaveComposta && d.chaveComposta[0] !== d.chave)
    falha('chave', `${id}: a chave composta começa pela coluna declarada em chave.`);
  const porNome = new Map(cat.colunas.map((c) => [c.nome, c]));
  const campos = new Set<string>();
  for (const c of d.colunas) {
    if (!COLUNA.test(c.coluna) || !CAMPO.test(c.campo)) falha('nome', `${id}: nome inválido (${c.campo}).`);
    if (campos.has(c.campo)) falha('nome', `${id}: campo repetido (${c.campo}).`);
    campos.add(c.campo);
    const k = porNome.get(c.coluna);
    if (!k) {
      falha('catalogo', `${id}: coluna ${c.coluna} não existe no catálogo.`);
      continue;
    }
    const t = tamanhoDoTipo(k.tipo);
    if (c.tipo === 'texto' || (c.tipo === 'letra' && t.tamanho !== null)) {
      if (t.tamanho === null) falha('tipo', `${id}: ${c.coluna} não é texto no catálogo.`);
      else if (c.maxBytes === undefined || c.maxBytes > t.tamanho)
        falha(
          'tamanho',
          `${id}: ${c.coluna} aceita até ${t.tamanho} bytes (declarado ${c.maxBytes ?? '?'}).`,
        );
    }
    if (c.tipo === 'inteiro' || (c.tipo === 'referencia' && maximoInteiro(k.tipo) !== null)) {
      const max = maximoInteiro(k.tipo);
      if (max === null) falha('tipo', `${id}: ${c.coluna} não é inteiro no catálogo.`);
      else if (c.maximo !== undefined && c.maximo > max)
        falha('tamanho', `${id}: ${c.coluna} vai até ${max} (declarado ${c.maximo}).`);
    }
    if (c.tipo === 'letra' && (!c.valores || c.valores.length === 0))
      falha('valores', `${id}: ${c.coluna} (letra) sem os valores vistos no legado.`);
    if (c.tipo === 'referencia' && !c.referencia)
      falha('referencia', `${id}: ${c.coluna} sem a fonte das opções.`);
    if (c.tipo === 'decimal' && t.escala === null && !/DOUBLE|FLOAT/.test(k.tipo.toUpperCase()))
      falha('tipo', `${id}: ${c.coluna} (decimal) não tem escala no catálogo.`);
    if (chaves.includes(c.coluna)) {
      if (!c.codigo) falha('chave', `${id}: diga se o código é digitado ou gerado (manual | generator).`);
      if (d.chaveComposta && c.codigo === 'generator')
        falha('chave', `${id}: chave composta é digitada (nunca generator).`);
      if (c.editavel) falha('chave', `${id}: a chave nunca é alterada.`);
      if (c.codigo === 'generator' && ctx.triggerGeraChave && !ctx.triggerGeraChave(d.tabela))
        falha('chave', `${id}: código "generator" sem trigger BI que gere a chave (nunca MAX+1).`);
      if (c.codigo === 'manual' && !c.naInclusao && pub.acoes.includes('criar'))
        falha('chave', `${id}: código manual é pedido na inclusão.`);
    }
  }
  if (!d.colunas.some((c) => c.coluna === d.chave))
    falha('chave', `${id}: a chave não está entre as colunas.`);
  // NOT NULL sem DEFAULT precisa de valor na inclusão (tela, generator ou constante).
  if (pub.acoes.includes('criar')) {
    for (const k of cat.colunas) {
      if (k.anulavel || k.padrao) continue;
      const c = d.colunas.find((x) => x.coluna === k.nome);
      const temValor =
        c &&
        (c.naInclusao ||
          c.codigo === 'generator' ||
          c.constanteNaInclusao !== undefined ||
          c.padraoNaInclusao !== undefined);
      if (!temValor) falha('inclusao', `${id}: ${k.nome} é NOT NULL e a inclusão não lhe dá valor.`);
    }
  }
  if (!campos.has(d.descricao)) falha('descricao', `${id}: o campo de descrição não está declarado.`);
  for (const u of d.unico)
    for (const c of u) if (!campos.has(c)) falha('unico', `${id}: unicidade sobre campo inexistente (${c}).`);
  const editaveis = d.colunas.filter((c) => c.editavel);
  if (pub.acoes.includes('editar') !== editaveis.length > 0)
    falha('editar', `${id}: a ação editar exige ao menos um campo editável (e vice-versa).`);
  // M14: sem coluna de situação provada, a inativação vale só no novo (situacaoSoNoNovo, com o motivo).
  if (d.situacao && d.situacaoSoNoNovo)
    falha('situacao', `${id}: situação no legado e só no novo ao mesmo tempo (escolha uma).`);
  if (pub.acoes.includes('inativar') !== (d.situacao !== undefined || d.situacaoSoNoNovo !== undefined))
    falha(
      'situacao',
      `${id}: inativar exige a coluna de situação ou a inativação só no novo (e vice-versa).`,
    );
  if (d.situacaoSoNoNovo && !d.situacaoSoNoNovo.motivo)
    falha('situacao', `${id}: diga por que a inativação vale só no novo.`);
  if (d.situacao) {
    if (!porNome.has(d.situacao.coluna)) falha('situacao', `${id}: coluna de situação fora do catálogo.`);
    const { ativo, inativo } = d.situacao;
    if (ativo === inativo) falha('situacao', `${id}: letras de situação iguais.`);
    if (!d.situacao.evidencia) falha('situacao', `${id}: a letra de inativo precisa de evidência.`);
  }
  return p;
}
