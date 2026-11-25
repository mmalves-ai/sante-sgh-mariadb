// Escrita dos itens de catálogo nas tabelas próprias do cliente (publicação do M13), dentro da operação do lote
// (porta-propria.ts). Mapa de cada entidade do contrato (@sgh/contratos catalogo/definicoes.ts) à tabela própria, à
// coluna da chave natural e às colunas dos campos que o modelo guarda no mesmo vocabulário do contrato (os mesmos da
// leitura da comparação, apps/api/src/modulos/catalogos/leitura-propria.ts). Tabela e colunas só da lista branca
// ESCRITAS, conferidas por conferirNome; valores sempre por parâmetro.
// Os catálogos valem para a rede inteira (um banco por cliente, tabelas sem estabelecimento).
// O mapa de escrita cobre as mesmas entidades que a comparação da API compara (MAPAS de leitura-propria.ts: cid10,
// cbo, procedimento, cep e municipio). Entidade sem mapa de leitura já é recusada na comparação (409 catalogo-sem-mapa)
// e por isso nunca chega aprovada; se chegar, o lote é recusado ("catalogo-sem-mapa"), a carga fica "falhou" com o
// motivo e nada é gravado. Os catálogos licenciados (Brasíndice, Simpro) não entram por este mapa da rede: a escrita
// deles é por estabelecimento licenciado (regra 7; DDL pedido no saida/05-13.json).
// Campo do contrato que no modelo é chave estrangeira (UF, município) é resolvido na transação pela chave natural
// (sigla, código IBGE ou nome na UF); referência que o banco não tem recusa o lote ("referencia-inexistente").
// Melhoria: a alteração confere, na linha relida com trava, os valores que a comparação leu (antes): mudou depois da
//   comparação, o lote é recusado ("item-alterado") em vez de sobrescrever a mudança de outra pessoa.
// Melhoria: o item "novo" que já existe na hora da publicação é recusado ("item-ja-existe"), não duplicado.
// Melhoria: a versão da fonte oficial (edição da carga) fica no item gravado (versao_fonte).
import type { ItemLoteCatalogo } from '@sgh/contratos';
import { conferirNome, recusa, type TxOperacao } from '@sgh/nucleo';

type ValorItem = string | number | null;

interface MapaEscrita {
  readonly tabela: string;
  /** Campo da chave natural no contrato e a coluna dele. */
  readonly chave: { readonly campo: string; readonly coluna: string };
  /** Campo do contrato → coluna (só os que o modelo guarda no mesmo vocabulário). */
  readonly campos: Readonly<Record<string, string>>;
  /** Condição fixa do item (ex.: a terminologia do termo), resolvida na transação. */
  readonly escopo?: (tx: TxOperacao) => Promise<{ readonly coluna: string; readonly valor: number }>;
  /** Colunas a mais na inclusão; recusa (throw) quando a entidade não aceita inclusão pela carga. */
  readonly naInclusao?: (chave: string, edicao: string | null) => Readonly<Record<string, unknown>>;
  /**
   * Campos do contrato que viram chave estrangeira: recebe os campos presentes e o contexto (antes + valores) e
   * devolve as colunas resolvidas. Na alteração, roda também sobre o "antes" para conferir a linha relida.
   */
  readonly derivados?: (
    tx: TxOperacao,
    presentes: Readonly<Record<string, ValorItem>>,
    ctx: Readonly<Record<string, ValorItem>>,
  ) => Promise<Record<string, number>>;
  /** Colunas que a inclusão exige preenchidas (as NOT NULL que vêm dos derivados). */
  readonly exigeNaInclusao?: readonly string[];
}

async function terminologia(tx: TxOperacao, codigo: string): Promise<{ coluna: string; valor: number }> {
  const t = await tx.uma<{ id: unknown }>(
    'SELECT id FROM terminologia WHERE codigo = ? AND excluido_em IS NULL',
    [codigo],
  );
  if (!t)
    throw recusa(
      'catalogo-sem-terminologia',
      `A terminologia ${codigo} não está cadastrada neste banco: cadastre-a pelo carregador de terminologias antes de publicar.`,
    );
  return { coluna: 'terminologia_id', valor: Number(t.id) };
}

const texto = (v: ValorItem | undefined): string => (v === null || v === undefined ? '' : String(v).trim());

async function idDa(tx: TxOperacao, sql: string, params: unknown[], oQue: string): Promise<number> {
  const r = await tx.consultar<{ id: unknown }>(sql, params, { teto: 2 });
  if (r.length !== 1)
    throw recusa(
      'referencia-inexistente',
      r.length === 0
        ? `${oQue} não está cadastrado(a) neste banco: carregue a referência antes de publicar.`
        : `${oQue} é ambíguo(a) neste banco: informe o código.`,
    );
  return Number(r[0]!.id);
}

const ufPorSigla = (tx: TxOperacao, sigla: string) =>
  idDa(
    tx,
    'SELECT id FROM unidade_federativa WHERE sigla = ? AND ativo = TRUE',
    [sigla.toUpperCase()],
    `A UF ${sigla}`,
  );

async function municipio(tx: TxOperacao, ctx: Readonly<Record<string, ValorItem>>): Promise<number> {
  const ibge = texto(ctx['ibge']);
  if (ibge)
    return idDa(tx, 'SELECT id FROM municipio_ibge WHERE codigo_ibge = ?', [ibge], `O município ${ibge}`);
  const cidade = texto(ctx['cidade']);
  const uf = texto(ctx['uf']);
  if (!cidade || !uf)
    throw recusa('item-incompleto', 'Item de CEP sem o município (código IBGE, ou cidade e UF).');
  return idDa(
    tx,
    `SELECT m.id FROM municipio_ibge m JOIN unidade_federativa u ON u.id = m.unidade_federativa_id
      WHERE u.sigla = ? AND UPPER(m.nome) = UPPER(?) AND m.ativo = TRUE`,
    [uf.toUpperCase(), cidade],
    `O município ${cidade}/${uf}`,
  );
}

const SEM_INCLUSAO_PROCEDIMENTO =
  'Procedimento novo da tabela unificada entra pelo cadastro de procedimentos: a carga só grava a competência dos que já existem.';

/** Entidade do contrato → escrita na tabela própria. */
export const ESCRITAS: Readonly<Record<string, MapaEscrita>> = Object.freeze({
  cbo: {
    tabela: 'ocupacao_cbo',
    chave: { campo: 'codigo', coluna: 'codigo_cbo' },
    campos: { nome: 'descricao' },
    naInclusao: (chave: string) => ({ familia_cbo: chave.slice(0, 4), ativo: true }),
  },
  cid10: {
    tabela: 'termo_terminologia',
    chave: { campo: 'codigo', coluna: 'codigo_termo' },
    campos: { nome: 'descricao' },
    escopo: (tx: TxOperacao) => terminologia(tx, 'cid10'),
    naInclusao: () => ({ ativo: true }),
  },
  // Só alteração (o contrato marca semInclusao): o procedimento novo exige a forma de organização e os domínios, que
  // vêm do cadastro de procedimentos, não do arquivo da competência.
  procedimento: {
    tabela: 'procedimento_sigtap',
    chave: { campo: 'codigo', coluna: 'codigo_sigtap' },
    campos: {
      nome: 'descricao',
      quantidadeMaxima: 'quantidade_maxima',
      permanencia: 'permanencia_dias',
      pontos: 'pontos',
      idadeMinima: 'idade_minima_meses',
      idadeMaxima: 'idade_maxima_meses',
    },
    naInclusao: () => {
      throw recusa('catalogo-sem-inclusao', SEM_INCLUSAO_PROCEDIMENTO);
    },
  },
  municipio: {
    tabela: 'municipio_ibge',
    chave: { campo: 'ibge', coluna: 'codigo_ibge' },
    campos: { nome: 'nome' },
    derivados: async (tx, presentes) =>
      Object.hasOwn(presentes, 'uf')
        ? { unidade_federativa_id: await ufPorSigla(tx, texto(presentes['uf'])) }
        : {},
    exigeNaInclusao: ['unidade_federativa_id'],
    naInclusao: () => ({ ativo: true }),
  },
  // A cidade e o código IBGE do arquivo apontam o mesmo município (o IBGE manda quando vier); a cidade não é gravada
  // como texto: o endereço lê o nome do município.
  // O tipo de logradouro do arquivo (rua, avenida…) vira a espécie do catálogo oficial, pela sigla ou pela descrição;
  // tipo vazio ou fora do catálogo não recusa o lote: o CEP entra sem espécie (o endereço lê só o logradouro).
  cep: {
    tabela: 'logradouro_cep',
    chave: { campo: 'cep', coluna: 'codigo_cep' },
    campos: { logradouro: 'logradouro' },
    derivados: async (tx, presentes, ctx) => {
      const r: Record<string, number> = {};
      if (Object.hasOwn(presentes, 'uf'))
        r['unidade_federativa_id'] = await ufPorSigla(tx, texto(presentes['uf']));
      if (Object.hasOwn(presentes, 'ibge') || Object.hasOwn(presentes, 'cidade'))
        r['municipio_ibge_id'] = await municipio(tx, ctx);
      const tipo = texto(presentes['tipoLogradouro']);
      if (tipo) {
        const especies = await tx.consultar<{ id: unknown }>(
          'SELECT id FROM especie_logradouro WHERE ativo = TRUE AND (sigla = ? OR descricao = ?)',
          [tipo, tipo],
          { teto: 2 },
        );
        if (especies.length === 1) r['especie_logradouro_id'] = Number(especies[0]!.id);
      }
      return r;
    },
    exigeNaInclusao: ['unidade_federativa_id', 'municipio_ibge_id'],
    naInclusao: () => ({ ativo: true }),
  },
});

/** Tabelas que a publicação das entidades dadas grava (as sem mapa ficam de fora: o lote delas é recusado). */
export function tabelasDaEscrita(entidades: readonly string[]): string[] {
  return [...new Set(entidades.filter((e) => Object.hasOwn(ESCRITAS, e)).map((e) => ESCRITAS[e]!.tabela))];
}

/** Entidades do lote sem mapa de escrita. */
export function entidadesSemEscrita(itens: readonly ItemLoteCatalogo[]): string[] {
  return [...new Set(itens.map((i) => i.entidade).filter((e) => !Object.hasOwn(ESCRITAS, e)))];
}

const comparavel = (v: unknown): string =>
  v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trimEnd();

/** Grava um item do lote (inclusão ou alteração) e devolve o id da linha. */
export async function escreverItem(
  tx: TxOperacao,
  item: ItemLoteCatalogo,
  edicao: string | null,
): Promise<number> {
  const m = Object.hasOwn(ESCRITAS, item.entidade) ? ESCRITAS[item.entidade] : undefined;
  if (!m)
    throw recusa(
      'catalogo-sem-mapa',
      `A publicação da entidade ${item.entidade} ainda não tem o mapa ao modelo próprio: nada do lote foi gravado.`,
    );
  const chave = item.chave[m.chave.campo];
  if (!chave)
    throw recusa('item-sem-chave', `Item de ${item.entidade} sem o campo da chave (${m.chave.campo}).`);
  const tabela = conferirNome(m.tabela);
  const colChave = conferirNome(m.chave.coluna);
  const esc = m.escopo ? await m.escopo(tx) : null;
  const colunas = Object.entries(m.campos).map(([campo, coluna]) => [campo, conferirNome(coluna)] as const);
  const ctx = { ...(item.antes ?? {}), ...item.valores };
  const derivados = m.derivados ? await m.derivados(tx, item.valores, ctx) : {};
  const colDerivadas = Object.keys(derivados).map(conferirNome);
  const atual = (
    await tx.consultarParaAtualizar(
      `SELECT id, versao${[...colunas.map(([, c]) => c), ...colDerivadas].map((c) => `, ${c}`).join('')} FROM ${tabela}
        WHERE ${colChave} = ?${esc ? ` AND ${conferirNome(esc.coluna)} = ?` : ''}`,
      esc ? [chave, esc.valor] : [chave],
      { teto: 2 },
    )
  )[0];
  const valores: Record<string, ValorItem> = {};
  for (const [campo, coluna] of colunas)
    if (Object.hasOwn(item.valores, campo)) valores[coluna] = item.valores[campo] ?? null;
  Object.assign(valores, derivados);
  const fonte = edicao ? { versao_fonte: edicao } : {};
  if (item.acao === 'incluir') {
    if (atual)
      throw recusa(
        'item-ja-existe',
        `O item ${chave} de ${item.entidade} já existe: o banco mudou depois da comparação; compare a carga de novo.`,
      );
    const extras = m.naInclusao?.(chave, edicao) ?? {};
    for (const col of m.exigeNaInclusao ?? [])
      if (valores[col] === undefined || valores[col] === null)
        throw recusa(
          'item-incompleto',
          `O item ${chave} de ${item.entidade} não traz ${col.replace(/_id$/, '')}.`,
        );
    return tx.incluir(tabela, {
      [colChave]: chave,
      ...(esc ? { [esc.coluna]: esc.valor } : {}),
      ...valores,
      ...extras,
      ...fonte,
    });
  }
  if (!atual)
    throw recusa('item-inexistente', `O item ${chave} de ${item.entidade} não existe mais no banco.`);
  for (const [campo, coluna] of colunas)
    if (
      item.antes &&
      Object.hasOwn(item.antes, campo) &&
      comparavel(atual[coluna]) !== comparavel(item.antes[campo])
    )
      throw recusa(
        'item-alterado',
        `O item ${chave} de ${item.entidade} mudou depois da comparação: compare a carga de novo.`,
      );
  if (m.derivados && item.antes) {
    const antesPresentes = Object.fromEntries(
      Object.entries(item.antes).filter(([k]) => Object.hasOwn(item.valores, k)),
    );
    const antes = await m.derivados(tx, antesPresentes, item.antes).catch(() => null);
    for (const [col, v] of Object.entries(antes ?? {}))
      if (Object.hasOwn(atual, col) && Number(atual[col]) !== v)
        throw recusa(
          'item-alterado',
          `O item ${chave} de ${item.entidade} mudou depois da comparação: compare a carga de novo.`,
        );
  }
  const id = Number(atual['id']);
  if (Object.keys(valores).length > 0)
    await tx.alterar(tabela, id, Number(atual['versao']), { ...valores, ...fonte });
  return id;
}
