// Declaração FÍSICA de uma consulta somente leitura (M14; F2.2): a parte pública vem de @sgh/contratos
// (CONSULTAS_DECLARADAS); a física é a tabela do modelo próprio (tabelas.gerado.ts) com as colunas lidas do próprio banco
// (information_schema), como o CRUD genérico dos domínios faz. Nada de nome de tabela ou coluna sai para a tela: a
// descrição pública só tem o campo (camelCase), o rótulo, o tipo, a máscara, o filtro e a chave.
// Melhoria: a chave de paginação é sempre o id da tabela (keyset por um número), os filtros são as colunas indexadas do
// banco (o período nas datas) e o estabelecimento e a exclusão lógica entram em toda leitura.
// Melhoria: a máscara de dado de pessoa vem do nome da coluna no modelo (nome, documento, contato, endereço,
// nascimento) e, na consulta clínica, também dos textos longos.
// Melhoria: a tabela sem estabelecimento_id que guarda movimento de um estabelecimento (cancelamento do atendimento,
// troca da internação, item da conta ou da nota) filtra pelo estabelecimento da tabela-pai (EXISTS pela chave
// estrangeira, pais de lista branca); chave para pai desconhecido sem pai conhecido recusa a leitura (falha fechada).
// Melhoria: tabela compartilhada por várias consultas leva o filtro fixo da consulta (coluna e valor gerados por lista
// branca em tabelas.gerado.ts); sem ele, a consulta nem entra no índice.
import type { ColunaConsulta, ConsultaPublica, EscopoPermissao } from '@sgh/contratos';
import type { FiltroLido } from '@sgh/dominio-config';
import { conferirNome } from '@sgh/nucleo';

export type EscopoConsulta = Exclude<EscopoPermissao, 'vinculo'>;
/** Os valores aceitos de cada escopo restrito da sessão (null: sem restrição). */
export type FiltroEscopo = Partial<Record<EscopoConsulta, readonly string[] | null>>;
export type FiltroConsulta = FiltroLido;

export interface ColunaConsultaFisica {
  readonly coluna: string;
  readonly campo: string;
  readonly rotulo: string;
  readonly tipo: ColunaConsulta['tipo'];
  /** Dado de pessoa: mascarada na lista; aparece só ao abrir o registro (evento auditado). */
  readonly mascarada?: boolean;
  readonly filtro?: 'igual' | 'periodo';
  /** Sim ou não guardado como booleano. */
  readonly booleano?: boolean;
}

/**
 * Filtro fixo que distingue a consulta numa tabela compartilhada: `coluna = valor`, ou, com `em`,
 * `coluna IN (SELECT id FROM em.tabela WHERE <em.filtro>)`. Coluna, tabela e valor vêm só do gerador (lista branca).
 */
export type FiltroFixoConsulta =
  | { readonly coluna: string; readonly valor: string }
  | {
      readonly coluna: string;
      readonly em: { readonly tabela: string; readonly filtro: FiltroFixoConsulta };
    };

/** O destino de uma consulta no modelo (tabelas.gerado.ts). */
export interface DestinoConsulta {
  readonly tabela: string;
  readonly fixo?: FiltroFixoConsulta;
}

/** Chave estrangeira da tabela para uma tabela-pai que tem estabelecimento_id (information_schema). */
export interface PaiDoBanco {
  readonly coluna: string;
  readonly tabela: string;
  /** A chave aceita nulo (o registro sem pai não é de estabelecimento nenhum). */
  readonly colunaNula: boolean;
  /** O estabelecimento_id do pai aceita nulo (pai da rede inteira). */
  readonly estabelecimentoNulo: boolean;
}

/**
 * Pais cujo estabelecimento É o do registro filho (movimento): a leitura do filho filtra por eles.
 * Lista branca: um pai novo entra aqui ou em PAIS_DE_REFERENCIA, nunca por dedução.
 */
export const PAIS_QUE_DEFINEM_ESTABELECIMENTO: ReadonlySet<string> = new Set([
  'agendamento_cirurgico',
  'agendamento_relatorio',
  'alta_hospitalar',
  'atendimento',
  'capela_manipulacao',
  'conta_bancaria',
  'conta_hospitalar',
  'contrato_rede_prestador',
  'emissao_laudo',
  'evento_auditoria',
  'execucao_relatorio',
  'fechamento_estoque',
  'ficha_antimicrobiano',
  'guia_tiss',
  'horario_administracao',
  'integracao_mensagem',
  'internacao',
  'inventario_estoque',
  'laudo_diagnostico',
  'leito_hospitalar',
  'lote_insumo',
  'marcacao_horario',
  'movimento_estoque',
  'nota_entrada',
  'pedido_compra',
  'relatorio',
  'saldo_estoque',
]);
/** Pais de cadastro ou configuração apontados por dado da rede: não definem o estabelecimento do filho. */
export const PAIS_DE_REFERENCIA: ReadonlySet<string> = new Set([
  'acrescimo_horario_especial',
  'arquivo',
  'cabecalho_impressao_documento',
  'centro_custo',
  'ponto_integracao',
  'regra_alerta',
  'regra_repasse',
  'rubrica',
  'sala_cirurgica',
  'setor_diagnostico',
  'setor_funcional',
]);

export interface DeclaracaoConsulta {
  readonly publico: ConsultaPublica;
  readonly tabela: string;
  /** Chave de paginação (keyset): o id da tabela. */
  readonly chave: readonly string[];
  readonly colunas: readonly ColunaConsultaFisica[];
  /** A coluna de cada escopo do M06 que a tabela tem (escopo restrito sem coluna aqui falha fechado). */
  readonly escopos?: Readonly<Partial<Record<EscopoConsulta, string>>>;
  /** A tabela tem estabelecimento_id: toda leitura filtra o da sessão (nulo = da rede inteira, quando aceita nulo). */
  readonly porEstabelecimento?: 'obrigatorio' | 'opcional' | null;
  /** A tabela tem exclusão lógica (excluido_em): toda leitura tira os excluídos. */
  readonly exclusaoLogica?: boolean;
  /** Sem estabelecimento_id: o estabelecimento vem destes pais (todos têm de ser o da sessão). */
  readonly estabelecimentoPorPai?: readonly PaiDoBanco[];
  /** Sem caminho conhecido para o estabelecimento (pai fora das listas): toda leitura é recusada. */
  readonly semCaminhoEstabelecimento?: boolean;
  /** O filtro fixo da consulta na tabela compartilhada. */
  readonly fixo?: FiltroFixoConsulta;
}

export type CodigoErroConsulta =
  'sem-filtro' | 'exportacao-grande' | 'sem-chave' | 'filtro-invalido' | 'pagina-invalida';

export class ErroConsulta extends Error {
  override readonly name = 'ErroConsulta';
  constructor(
    readonly codigo: CodigoErroConsulta,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Escopo restrito da sessão sem coluna na consulta, ou tabela sem caminho para o estabelecimento: leitura recusada (falha fechada). */
export class ErroEscopo extends Error {
  override readonly name = 'ErroEscopo';
}

/** Colunas como a API as descreve à tela (sem nome de tabela nem de coluna). */
export function colunasDescritas(d: DeclaracaoConsulta): ColunaConsulta[] {
  return d.colunas.map((c) => ({
    campo: c.campo,
    rotulo: c.rotulo,
    tipo: c.tipo,
    mascarada: c.mascarada === true,
    ...(c.filtro ? { filtro: c.filtro } : {}),
    chave: d.chave.includes(c.coluna),
  }));
}

// ── Montagem a partir do banco ───────────────────────────────────────────────────────────────────────────────────

/** Uma coluna como o information_schema a descreve. */
export interface ColunaDoBanco {
  readonly nome: string;
  /** DATA_TYPE (int, varchar, date…). */
  readonly tipo: string;
  /** COLUMN_TYPE (tinyint(1)…). */
  readonly tipoCompleto: string;
  readonly aceitaNulo: boolean;
  readonly comentario: string;
}

/** Colunas que nunca vão à consulta (auditoria técnica e as de filtro automático). */
const FORA = new Set([
  'criado_por',
  'alterado_por',
  'alterado_em',
  'excluido_em',
  'excluido_por',
  'versao',
  'estabelecimento_id',
]);
const TIPOS_FORA = new Set([
  'json',
  'blob',
  'longblob',
  'mediumblob',
  'tinyblob',
  'binary',
  'varbinary',
  'geometry',
]);
/** Dado de pessoa pelo nome da coluna (a máscara da lista). */
const PESSOAL =
  /(^|_)(nome|cpf|cns|rg|documento|telefone|celular|email|endereco|logradouro|cep|nascimento|mae|pai|carteira|prontuario|social|apelido|responsavel)(_|$)/;
/** Colunas de escopo do M06, pelo nome no modelo. */
const COLUNA_DO_ESCOPO: Readonly<Partial<Record<EscopoConsulta, readonly string[]>>> = {
  unidade: ['unidade_assistencial_id', 'setor_funcional_id'],
  local: ['local_atendimento_id'],
  convenio: ['fonte_pagadora_id'],
  centroCusto: ['centro_custo_id'],
  localEstoque: ['local_estoque_id'],
  contaBancaria: ['conta_bancaria_id'],
  tipoAgenda: ['categoria_agenda_id'],
  tipoProntuario: ['tipo_prontuario_id'],
};

export const campoDaColuna = (c: string) => c.replace(/_([a-z0-9])/g, (_m, x: string) => x.toUpperCase());

function rotuloDaColuna(c: ColunaDoBanco): string {
  const curto = c.comentario.trim();
  if (curto && curto.length <= 40 && !/[:;(]/.test(curto)) return curto;
  const base = c.nome === 'id' ? 'Id' : c.nome.replace(/_id$/, '').replace(/_/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function tipoDaColuna(c: ColunaDoBanco): { tipo: ColunaConsulta['tipo']; booleano?: boolean } | null {
  const t = c.tipo.toLowerCase();
  if (TIPOS_FORA.has(t)) return null;
  if (t === 'tinyint' && /^tinyint\(1\)/i.test(c.tipoCompleto)) return { tipo: 'texto', booleano: true };
  if (['int', 'bigint', 'smallint', 'tinyint', 'mediumint'].includes(t)) return { tipo: 'inteiro' };
  if (['decimal', 'float', 'double'].includes(t)) return { tipo: 'decimal' };
  if (t === 'date') return { tipo: 'data' };
  if (t === 'datetime' || t === 'timestamp') return { tipo: 'dataHora' };
  if (t === 'time') return { tipo: 'hora' };
  return { tipo: 'texto' };
}

/**
 * A declaração física a partir das colunas e dos índices do banco. `indexadas`: a primeira coluna de cada índice
 * (vira filtro: período nas datas, igual nas demais). Lança se a tabela não tiver id.
 */
export function montarDeclaracao(
  publico: ConsultaPublica,
  tabela: string,
  colunasDoBanco: readonly ColunaDoBanco[],
  indexadas: ReadonlySet<string>,
  extra: { readonly fixo?: FiltroFixoConsulta; readonly pais?: readonly PaiDoBanco[] } = {},
): DeclaracaoConsulta {
  conferirNome(tabela);
  if (!colunasDoBanco.some((c) => c.nome === 'id'))
    throw new Error(`Consulta ${publico.recurso}: tabela sem id.`);
  const clinica = publico.classe === 'clinica';
  const comPessoa = publico.classe !== 'comum';
  const colunas: ColunaConsultaFisica[] = [];
  for (const c of colunasDoBanco) {
    if (FORA.has(c.nome)) continue;
    const t = tipoDaColuna(c);
    if (!t) continue;
    conferirNome(c.nome);
    const longo = /text$/i.test(c.tipo);
    const mascarada =
      comPessoa && c.nome !== 'id' && (PESSOAL.test(c.nome) || (clinica && longo && t.tipo === 'texto'));
    const filtro =
      c.nome === 'id' || indexadas.has(c.nome)
        ? t.tipo === 'data' || t.tipo === 'dataHora'
          ? ('periodo' as const)
          : t.booleano || longo
            ? undefined
            : ('igual' as const)
        : undefined;
    colunas.push({
      coluna: c.nome,
      campo: campoDaColuna(c.nome),
      rotulo: rotuloDaColuna(c),
      tipo: t.tipo,
      ...(mascarada ? { mascarada: true } : {}),
      ...(filtro ? { filtro } : {}),
      ...(t.booleano ? { booleano: true } : {}),
    });
  }
  const nomes = new Set(colunasDoBanco.map((c) => c.nome));
  const escopos: Partial<Record<EscopoConsulta, string>> = {};
  for (const [e, candidatas] of Object.entries(COLUNA_DO_ESCOPO) as [EscopoConsulta, readonly string[]][]) {
    const c = candidatas.find((x) => nomes.has(x));
    if (c) escopos[e] = c;
  }
  const est = colunasDoBanco.find((c) => c.nome === 'estabelecimento_id');
  if (extra.fixo) conferirFixo(extra.fixo, nomes, publico.recurso);
  let caminho: { estabelecimentoPorPai?: readonly PaiDoBanco[]; semCaminhoEstabelecimento?: boolean } = {};
  if (!est && extra.pais?.length) {
    const definem = extra.pais.filter((p) => PAIS_QUE_DEFINEM_ESTABELECIMENTO.has(p.tabela));
    for (const p of definem) {
      conferirNome(p.coluna);
      conferirNome(p.tabela);
    }
    if (definem.length) caminho = { estabelecimentoPorPai: Object.freeze(definem) };
    else if (extra.pais.some((p) => !PAIS_DE_REFERENCIA.has(p.tabela)))
      caminho = { semCaminhoEstabelecimento: true };
  }
  return Object.freeze({
    publico,
    tabela,
    chave: ['id'],
    colunas,
    ...(Object.keys(escopos).length ? { escopos } : {}),
    porEstabelecimento: est ? (est.aceitaNulo ? 'opcional' : 'obrigatorio') : null,
    exclusaoLogica: nomes.has('excluido_em'),
    ...caminho,
    ...(extra.fixo ? { fixo: extra.fixo } : {}),
  });
}

/** Confere os nomes do filtro fixo (a coluna de primeiro nível tem de existir na tabela da consulta). */
function conferirFixo(f: FiltroFixoConsulta, nomes: ReadonlySet<string> | null, recurso: string): void {
  conferirNome(f.coluna);
  if (nomes && !nomes.has(f.coluna))
    throw new Error(`Consulta ${recurso}: coluna do filtro fixo fora da tabela.`);
  if ('em' in f) {
    conferirNome(f.em.tabela);
    conferirFixo(f.em.filtro, null, recurso);
  }
}

/** Declaração SINTÉTICA (memória de dev/ci): id, código, descrição e data de criação, sem banco. */
export function declaracaoSintetica(
  publico: ConsultaPublica,
  tabela = 'consulta_sintetica',
): DeclaracaoConsulta {
  const coluna = (nome: string, tipo: string, comentario = ''): ColunaDoBanco => ({
    nome,
    tipo,
    tipoCompleto: tipo,
    aceitaNulo: false,
    comentario,
  });
  return montarDeclaracao(
    publico,
    tabela,
    [
      coluna('id', 'bigint', 'Id'),
      coluna('codigo', 'varchar', 'Código'),
      coluna('nome', 'varchar', 'Nome'),
      coluna('descricao', 'varchar', 'Descrição'),
      coluna('criado_em', 'datetime', 'Registrado em'),
    ],
    new Set(['codigo', 'criado_em']),
  );
}
