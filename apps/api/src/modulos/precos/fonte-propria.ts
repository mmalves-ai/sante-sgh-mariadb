// Fonte do M12 sobre o banco do cliente, pelo @sgh/nucleo: os convênios são as fontes pagadoras (fonte_pagadora, da
// rede inteira: não têm estabelecimento), o acordo do estabelecimento (contrato_fonte_pagadora, com as tabelas por
// vigência em contrato_tabela_vigencia), os planos (plano_fonte_pagadora e a vigência no estabelecimento em
// plano_fonte_pagadora_estabelecimento), o histórico do nome (fonte_pagadora_versao), as tabelas de preço
// (tabela_preco, preco_procedimento e os valores por vigência em preco_procedimento_valor; diárias e taxas em
// preco_diaria_taxa e preco_diaria_taxa_valor), os lotes de reajuste (lote_reajuste e lote_reajuste_item), as edições
// da referência de mat/med (edicao_referencia_matmed) e os códigos do prestador (codigo_prestador_fonte_pagadora).
// Leituras somente leitura; gravações pelo Executor (trilha, outbox e idempotência na mesma transação). Toda leitura
// de tabela com estabelecimento filtra o da sessão; toda leitura com exclusão lógica filtra os excluídos.
// Melhoria: suspender ou reativar o convênio vale só no estabelecimento da sessão (fonte_pagadora_estabelecimento,
// trava pela versão), com o retrato completo do registro depois da mudança em fonte_pagadora_versao na mesma
// transação; o prazo de retorno é o da unidade (nulo usa o da fonte pagadora); o contrato altera só os campos que o
// modelo tem, pela versão lida.
// Melhoria: a lista de convênios mostra só as fontes pagadoras credenciadas no estabelecimento da sessão.
// Melhoria: a gravação direta (planos) usa a Idempotency-Key do pedido: o reenvio devolve o mesmo resultado.
// Pendência (pedido do lote 02-12): nome, classificação, ANS, contato, e-mail, prazo de pagamento e validade da
// carteira são da rede inteira; hoje a permissão de editar o contrato os altera, falta a permissão própria de rede.
// Melhoria: a importação de tabela grava a carga e as linhas (os cinco componentes e os vigentes antes) num passo só;
// o mesmo arquivo entra uma vez por tabela; a publicação aponta o lote do reajuste e a rejeição exige o motivo.
// Melhoria: os contatos do convênio por área ficam em contato_fonte_pagadora; o CNPJ, o endereço e a nota fiscal são
// os da pessoa jurídica (a do convênio ou a tomadora) e se editam no cadastro dela.
// Melhoria (06-FAT linha 3): o reajuste e o desfazer pelo lote gravam pelo Executor (reajuste-propria.ts); o desfazer
// grava a exclusão da vigência, nunca apaga, e a leitura dos valores ignora a vigência excluída (VALOR_VALIDO).
// Pendência (pedidos do lote 02-12, saida/02-12.json): os modificadores e as referências de terceiros ainda não são
// lidos do modelo (a tela mostra vazio).
import { randomUUID } from 'node:crypto';
import type {
  AlterarContratoConvenioEntrada,
  AlterarSituacaoConvenioEntrada,
  DesfazerReajusteEntrada,
  EstadoOperacao,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  definirOperacao,
  ErroOperacao,
  erroConflitoVersao,
  erroNaoLiberada,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { civil, FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import { mesmoValor, valorParaGravar } from './campos-contrato.js';
import {
  credenciamentoPropria,
  deParaPropria,
  excecoesCredenciamentoPropria,
  itemMatmedPropria,
  itensMatmedPropria,
  vigenciasMatmedPropria,
} from './cobranca-propria.js';
import {
  indicesConvenioPropria,
  indicesNaDataPropria,
  porteAnestesicoNaDataPropria,
  porteNaDataPropria,
  portesPropria,
  type RegimePorte,
} from './indices-propria.js';
import type {
  ContextoGravacaoPreco,
  CtxPrecos,
  FiltroPagina,
  FontePrecos,
  MudancaCarga,
  TrilhaPreco,
} from './fonte.js';
import { type NomeOperacaoPreco, OPERACOES_PRECO } from './operacoes.js';
import {
  autoriaDoItemPropria,
  conferirDesfazer,
  OP_DESFAZER,
  OP_REAJUSTAR,
  VALOR_VALIDO,
} from './reajuste-propria.js';
import {
  type AutoriaPreco,
  type AlteracaoPlano,
  type CabecalhoTabela,
  type CargaImportacao,
  type ConvenioPreco,
  ErroCarga,
  ErroPlano,
  type FiltroConvenio,
  type ImpactoSituacaoConvenio,
  type ItemDiariaPreco,
  type ItemHonorarioPreco,
  type ItemParaReajuste,
  type LinhaCargaImportacao,
  type LinhaDoLote,
  type LoteReajuste,
  type NovaCarga,
  type NovoPlano,
  type Pagina,
  type PlanoConvenio,
  type TipoModificador,
  type VigenciaItem,
  type VigenciaTabelaConvenio,
  type VigenciaValor,
} from './tipos.js';

/** O mínimo do núcleo que a fonte usa. */
export type NucleoPrecos = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoN = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const numeroDeTexto = (v: unknown) =>
  v !== null && v !== undefined && /^\d{1,15}$/.test(String(v)) ? Number(v) : null;
/** Situação do convênio no vocabulário do contrato da tela (pedido de contrato: a situação nomeada). */
const situacaoDaTela = (s: unknown) => (texto(s) === 'ativa' ? 'A' : 'I');
const situacaoDaTabela = (s: unknown) => (texto(s) === 'ativa' ? 'A' : 'I');
const paginaVazia = (colunas: [string, string][] = []): Pagina => ({
  colunas: colunas.map(([campo, rotulo]) => ({ campo, rotulo })),
  itens: [],
  total: 0,
});

/** Tipo da tela → tipo do item na regra de tabela do acordo. */
const TIPO_ITEM_VIGENCIA: Readonly<Record<string, VigenciaTabelaConvenio['tipo']>> = {
  honorario_internacao: 'honorariosInternacao',
  honorario_ambulatorial: 'honorariosExterna',
  diaria_taxa: 'diarias',
  matmed: 'matmed',
};
/** Tipo da tela → tipo de item da tabela de preço. */
const TIPOS_TABELA: Readonly<Record<'honorarios' | 'diarias' | 'matmed', readonly string[]>> = {
  honorarios: ['honorario'],
  diarias: ['diaria_taxa'],
  matmed: ['material', 'medicamento'],
};

/** Campo editável do contrato → coluna da fonte pagadora (os demais aguardam o modelo). */
const COLUNA_FONTE: Readonly<Record<string, string>> = {
  nome: 'nome',
  registroAns: 'registro_ans',
  classificacao: 'classe_fonte_pagadora_id',
  contato: 'contato_nome',
  convenioEmail: 'email',
  retornoDias: 'dias_retorno',
  prazoPagamentoDias: 'dias_pagamento_remessa',
  validaCarteira: 'exige_validade_carteira',
  telefone: 'telefone',
  uf: 'unidade_federativa_id',
  nfUf: 'nota_fiscal_unidade_federativa_id',
};
/** Contatos por área (contato_fonte_pagadora): campo → [área, coluna]. */
const CONTATO_AREA: Readonly<Record<string, readonly [string, 'nome' | 'telefone' | 'email']>> = {
  convenioTelefone: ['convenio', 'telefone'],
  convenioContato: ['convenio', 'nome'],
  credenciamentoTelefone: ['credenciamento', 'telefone'],
  credenciamentoEmail: ['credenciamento', 'email'],
  credenciamentoContato: ['credenciamento', 'nome'],
  contasMedicasTelefone: ['contas_medicas', 'telefone'],
  contasMedicasEmail: ['contas_medicas', 'email'],
  contasMedicasContato: ['contas_medicas', 'nome'],
  recursoGlosaTelefone: ['recurso_glosa', 'telefone'],
  recursoGlosaEmail: ['recurso_glosa', 'email'],
  recursoGlosaContato: ['recurso_glosa', 'nome'],
  autorizacaoTelefone: ['autorizacao', 'telefone'],
  autorizacaoContato: ['autorizacao', 'nome'],
};
/** Campos da pessoa jurídica (a do convênio ou a tomadora da nota): leitura aqui, edição no cadastro dela. */
const DA_PESSOA_JURIDICA: ReadonlySet<string> = new Set([
  'cnpj',
  'endereco',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'cep',
  'ibge',
  'nfRazaoSocial',
  'nfCnpj',
  'nfEndereco',
  'nfNumero',
  'nfBairro',
  'nfCidade',
  'nfCep',
  'nfTelefone',
  'nfInscricaoMunicipal',
  'nfIbge',
]);
/** A inscrição estadual é da pessoa jurídica do próprio convênio e se edita aqui. */
const CAMPO_INSCRICAO = 'inscricaoEstadual';

/** Endereço principal da pessoa jurídica (o vigente de menor sequência). */
const SQL_ENDERECO_PJ = `
  SELECT e.logradouro, e.numero, e.complemento, COALESCE(b.descricao, e.bairro_nome) AS bairro, m.nome AS cidade,
         e.cep, m.codigo_ibge
    FROM endereco_pessoa e
    LEFT JOIN bairro b ON b.id = e.bairro_id
    LEFT JOIN municipio_ibge m ON m.id = e.municipio_ibge_id
   WHERE e.pessoa_juridica_id = ? AND e.excluido_em IS NULL
     AND (e.vigencia_fim IS NULL OR e.vigencia_fim >= CURRENT_DATE)
   ORDER BY e.principal DESC, e.sequencia, e.id LIMIT 1`;

/** Campos de UF: a tela fala a sigla, o banco guarda a unidade federativa (FK). */
const CAMPOS_UF: ReadonlySet<string> = new Set(['uf', 'nfUf']);

// A situação vale por estabelecimento; a fonte inativa na rede fica inativa em todos.
const SQL_CONVENIO = `
  SELECT f.id, f.nome, CASE WHEN f.situacao = 'ativa' THEN fe.situacao ELSE f.situacao END AS situacao, f.registro_ans, f.classe_fonte_pagadora_id, cl.descricao AS classe,
         (SELECT ctv.tabela_preco_id FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k
             ON k.id = ctv.contrato_fonte_pagadora_id
           WHERE k.fonte_pagadora_id = f.id AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
             AND ctv.tipo_item = 'honorario_internacao' AND ctv.vigencia_inicio <= CURRENT_DATE
             AND (ctv.vigencia_fim IS NULL OR ctv.vigencia_fim >= CURRENT_DATE)
           ORDER BY ctv.vigencia_inicio DESC LIMIT 1) AS tab_internacao,
         (SELECT ctv.tabela_preco_id FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k
             ON k.id = ctv.contrato_fonte_pagadora_id
           WHERE k.fonte_pagadora_id = f.id AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
             AND ctv.tipo_item = 'honorario_ambulatorial' AND ctv.vigencia_inicio <= CURRENT_DATE
             AND (ctv.vigencia_fim IS NULL OR ctv.vigencia_fim >= CURRENT_DATE)
           ORDER BY ctv.vigencia_inicio DESC LIMIT 1) AS tab_externa,
         (SELECT ctv.tabela_preco_id FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k
             ON k.id = ctv.contrato_fonte_pagadora_id
           WHERE k.fonte_pagadora_id = f.id AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
             AND ctv.tipo_item = 'diaria_taxa' AND ctv.vigencia_inicio <= CURRENT_DATE
             AND (ctv.vigencia_fim IS NULL OR ctv.vigencia_fim >= CURRENT_DATE)
           ORDER BY ctv.vigencia_inicio DESC LIMIT 1) AS tab_diarias,
         (SELECT ctv.tabela_preco_id FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k
             ON k.id = ctv.contrato_fonte_pagadora_id
           WHERE k.fonte_pagadora_id = f.id AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
             AND ctv.tipo_item = 'matmed' AND ctv.vigencia_inicio <= CURRENT_DATE
             AND (ctv.vigencia_fim IS NULL OR ctv.vigencia_fim >= CURRENT_DATE)
           ORDER BY ctv.vigencia_inicio DESC LIMIT 1) AS tab_matmed
    FROM fonte_pagadora f
    JOIN fonte_pagadora_estabelecimento fe
      ON fe.fonte_pagadora_id = f.id AND fe.estabelecimento_id = ? AND fe.excluido_em IS NULL
    LEFT JOIN classe_fonte_pagadora cl ON cl.id = f.classe_fonte_pagadora_id
   WHERE f.excluido_em IS NULL`;

function convenioDe(r: Linha): ConvenioPreco {
  return {
    codigo: n(r['id']),
    nome: texto(r['nome']),
    situacao: situacaoDaTela(r['situacao']),
    classificacao: nn(r['classe_fonte_pagadora_id']),
    classificacaoNome: textoN(r['classe']),
    registroAns: numeroDeTexto(r['registro_ans']),
    honorariosInternacao: nn(r['tab_internacao']),
    honorariosExterna: nn(r['tab_externa']),
    diarias: nn(r['tab_diarias']),
    matmed: nn(r['tab_matmed']),
    // Tabela de porte anestésico mostrada na tela do convênio: a de honorários do acordo vigente hoje (internação,
    // senão a ambulatorial). O valor do porte numa data e num regime sai de porteAnestesicoNaData, nunca daqui.
    porte: nn(r['tab_internacao']) ?? nn(r['tab_externa']),
  };
}

/** Valor do componente: honorário, custo operacional, filme, anestesia e outros. */
const componentesDe = (r: Linha) => ({
  ch: Number(r['valor_honorario'] ?? 0),
  co: Number(r['valor_custo_operacional'] ?? 0),
  filme: Number(r['valor_filme'] ?? 0),
  anes: Number(r['valor_anestesia'] ?? 0),
  outros: Number(r['valor_outros'] ?? 0),
});

const SQL_ITENS_HONORARIO = `
  SELECT pp.id, COALESCE(pp.descricao_cobranca, it.descricao) AS nome, pp.ativo, pp.quantidade_indice,
         pp.modelo_valor, po.codigo AS porte,
         v.vigencia_inicio, v.valor_honorario, v.valor_custo_operacional, v.valor_filme, v.valor_anestesia,
         v.valor_outros,
         (SELECT COUNT(*) FROM preco_procedimento_valor x WHERE x.preco_procedimento_id = pp.id AND ${VALOR_VALIDO}) AS vigencias,
         (SELECT MAX(x.vigencia_inicio) FROM preco_procedimento_valor x WHERE x.preco_procedimento_id = pp.id AND ${VALOR_VALIDO}) AS ultima,
         EXISTS (SELECT 1 FROM preco_procedimento_valor x WHERE x.preco_procedimento_id = pp.id
                   AND x.vigencia_inicio = ? AND ${VALOR_VALIDO}) AS tem_na_data
    FROM preco_procedimento pp
    JOIN tabela_preco t ON t.id = pp.tabela_preco_id
    LEFT JOIN item_faturavel it ON it.id = pp.item_faturavel_id
    LEFT JOIN porte_procedimento po ON po.id = pp.porte_procedimento_id
    LEFT JOIN preco_procedimento_valor v ON v.id = (
           SELECT x.id FROM preco_procedimento_valor x
            WHERE x.preco_procedimento_id = pp.id AND x.vigencia_inicio <= ? AND ${VALOR_VALIDO}
            ORDER BY x.vigencia_inicio DESC, x.id DESC LIMIT 1)
   WHERE pp.tabela_preco_id = ? AND t.estabelecimento_id = ? AND pp.excluido_em IS NULL AND t.excluido_em IS NULL`;

function itemHonorarioDe(r: Linha): ItemParaReajuste {
  const vig = dataIso(r['vigencia_inicio']);
  return {
    codigo: n(r['id']),
    nome: texto(r['nome']),
    situacao: verdadeiro(r['ativo']) ? 'A' : 'I',
    ch: texto(r['modelo_valor']) === 'indice' ? Number(r['quantidade_indice'] ?? 0) : 0,
    porte: textoN(r['porte']),
    fracaoPorte: null,
    cope: null,
    filmeM2: null,
    ato: null,
    vigencia: vig,
    valores: vig ? componentesDe(r) : null,
    vigencias: n(r['vigencias']),
    ultimaData: dataIso(r['ultima']),
    temNaData: verdadeiro(r['tem_na_data']),
  };
}

const SQL_ITENS_DIARIA = `
  SELECT d.id, d.codigo, d.nome, d.tipo_item, d.ativo, v.vigencia_inicio, v.valor,
         (SELECT COUNT(*) FROM preco_diaria_taxa_valor x WHERE x.preco_diaria_taxa_id = d.id) AS vigencias
    FROM preco_diaria_taxa d JOIN tabela_preco t ON t.id = d.tabela_preco_id
    LEFT JOIN preco_diaria_taxa_valor v ON v.id = (
           SELECT x.id FROM preco_diaria_taxa_valor x WHERE x.preco_diaria_taxa_id = d.id AND x.vigencia_inicio <= ?
              AND x.operacao <> 'exclusao' ORDER BY x.vigencia_inicio DESC, x.id DESC LIMIT 1)
   WHERE d.tabela_preco_id = ? AND t.estabelecimento_id = ? AND d.excluido_em IS NULL AND t.excluido_em IS NULL`;

function itemDiariaDe(r: Linha): ItemDiariaPreco {
  return {
    id: n(r['id']),
    codigo: textoN(r['codigo']),
    operacao: n(r['id']),
    nome: texto(r['nome']),
    tipo: null,
    subtipo: null,
    situacao: verdadeiro(r['ativo']) ? 'A' : 'I',
    vigencia: dataIso(r['vigencia_inicio']),
    valor: nn(r['valor']),
    vigencias: n(r['vigencias']),
  };
}

/** Os cinco componentes do valor da linha da carga: ch (o `valor`), co, filme, anes e outros. */
const COMPONENTES_CARGA = ['ch', 'co', 'filme', 'anes', 'outros'] as const;

function componentesParaGravar(
  v: Readonly<Record<string, number>> | null | undefined,
  linha: number,
): Record<(typeof COMPONENTES_CARGA)[number], number | null> | null {
  if (!v) return null;
  const fora = Object.keys(v).filter((k) => !(COMPONENTES_CARGA as readonly string[]).includes(k));
  if (fora.length)
    throw recusa('componente-desconhecido', `Linha ${linha}: componente sem coluna (${fora.join(', ')}).`);
  const r = Object.fromEntries(
    COMPONENTES_CARGA.map((k) => [k, typeof v[k] === 'number' ? v[k] : null]),
  ) as Record<(typeof COMPONENTES_CARGA)[number], number | null>;
  for (const k of COMPONENTES_CARGA)
    if (r[k] !== null && !(r[k]! >= 0))
      throw recusa('valor-invalido', `Linha ${linha}: ${k} negativo ou inválido.`);
  return r;
}

function componentesLidos(r: Linha, prefixo: 'valor' | 'anterior'): Record<string, number> | null {
  const col = (k: string) => (prefixo === 'valor' ? `valor_${k}` : `anterior_${k}`);
  const base = prefixo === 'valor' ? r['valor'] : r['anterior_valor'];
  if (base === null || base === undefined) return null;
  const o: Record<string, number> = { ch: Number(base) };
  for (const [k, c] of [
    ['co', 'custo_operacional'],
    ['filme', 'filme'],
    ['anes', 'anestesista'],
    ['outros', 'outros'],
  ] as const) {
    const x = r[col(c)];
    if (x !== null && x !== undefined) o[k] = Number(x);
  }
  return o;
}

const SQL_CARGA = `
  SELECT ct.id, ct.catalogo, ct.tabela_preco_id, ct.arquivo_nome, ct.fonte, ct.arquivo_sha256, ct.arquivo_bytes,
         ct.situacao, ct.total_linhas, ct.linhas_erro, ct.motivo, ct.versao, ct.criado_em, ur.login AS responsavel,
         CASE WHEN ct.situacao = 'publicada' THEN up.login WHEN ct.situacao = 'rejeitada' THEN ua.login END AS aprovador,
         lr.identificador AS lote,
         (SELECT COUNT(*) FROM carga_tabela_preco_linha x WHERE x.carga_tabela_preco_id = ct.id AND x.excluido_em IS NULL AND x.situacao = 'novo') AS novos,
         (SELECT COUNT(*) FROM carga_tabela_preco_linha x WHERE x.carga_tabela_preco_id = ct.id AND x.excluido_em IS NULL AND x.situacao = 'removido') AS removidos,
         (SELECT COUNT(*) FROM carga_tabela_preco_linha x WHERE x.carga_tabela_preco_id = ct.id AND x.excluido_em IS NULL AND x.situacao = 'alterado') AS alterados,
         (SELECT COUNT(*) FROM carga_tabela_preco_linha x WHERE x.carga_tabela_preco_id = ct.id AND x.excluido_em IS NULL AND x.situacao = 'igual') AS iguais
    FROM carga_tabela_preco ct
    LEFT JOIN usuario ur ON ur.id = ct.criado_por
    LEFT JOIN usuario up ON up.id = ct.publicada_por_usuario_id
    LEFT JOIN usuario ua ON ua.id = ct.alterado_por
    LEFT JOIN lote_reajuste lr ON lr.id = ct.lote_reajuste_id
   WHERE ct.estabelecimento_id = ? AND ct.excluido_em IS NULL`;

function cargaDe(r: Linha, fuso: string): CargaImportacao {
  const linhas = n(r['total_linhas']);
  const erros = n(r['linhas_erro']);
  return {
    id: n(r['id']),
    catalogo: texto(r['catalogo']),
    tabela: nn(r['tabela_preco_id']),
    arquivo: texto(r['arquivo_nome'] ?? r['fonte']),
    sha256: texto(r['arquivo_sha256']),
    bytes: n(r['arquivo_bytes']),
    situacao: texto(r['situacao']) as CargaImportacao['situacao'],
    responsavel: texto(r['responsavel']),
    aprovador: textoN(r['aprovador']),
    criadaEm: localDe(r['criado_em'], fuso),
    totais: {
      linhas,
      validas: linhas - erros,
      erros,
      novos: n(r['novos']),
      removidos: n(r['removidos']),
      alterados: n(r['alterados']),
      iguais: n(r['iguais']),
    },
    lote: textoN(r['lote']),
    motivo: textoN(r['motivo']),
    versao: n(r['versao']),
  };
}

function linhaDaCargaDe(r: Linha): LinhaCargaImportacao {
  const sit = texto(r['situacao']);
  const erro = sit === 'erro';
  const cod = texto(r['codigo_item']);
  return {
    linha: n(r['sequencia']),
    codigo: cod === '' || !/^\d+$/.test(cod) ? null : Number(cod),
    valores: erro ? null : componentesLidos(r, 'valor'),
    anteriores: componentesLidos(r, 'anterior'),
    nome: textoN(r['nome_item']),
    resultado: erro ? 'erro' : 'valida',
    comparacao: erro ? null : sit,
    motivo: textoN(r['divergencia']),
  };
}

const naoLido = <T>(v: T) => Promise.resolve(v);

export class FontePrecosPropria implements FontePrecos {
  readonly destino = 'banco' as const;
  readonly gravacao = { permitida: true, motivo: null };
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoPrecos,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: CtxPrecos, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  /** Só as operações já escritas sobre o modelo estão liberadas; as demais aguardam (null: não disponível). */
  estado(op: string): EstadoOperacao | null {
    return op === 'convenio.alterarSituacao' ||
      op === 'convenio.alterarContrato' ||
      op === 'preco.reajustar' ||
      op === 'preco.desfazerReajuste'
      ? 'liberada'
      : null;
  }

  async executar(nome: NomeOperacaoPreco, c: CtxPrecos, entrada: unknown, ctx: ContextoGravacaoPreco) {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    const op =
      nome === 'convenio.alterarSituacao'
        ? OP_SITUACAO
        : nome === 'convenio.alterarContrato'
          ? OP_CONTRATO
          : nome === 'preco.reajustar'
            ? OP_REAJUSTAR
            : nome === 'preco.desfazerReajuste'
              ? OP_DESFAZER
              : null;
    if (!op) throw erroNaoLiberada('operação não liberada na fonte própria');
    const r = await this.executor.executar(op as typeof OP_SITUACAO, c.cliente, entrada, {
      ...contextoDe(c),
      chaveIdempotencia: ctx.chaveIdempotencia,
      ...(ctx.reautenticadoEm !== undefined ? { reautenticadoEm: ctx.reautenticadoEm } : {}),
    });
    return { resultado: r.resultado, repetida: r.repetida };
  }

  // ── Convênios e contrato ──────────────────────────────────────────────────────────────────────────

  hoje(c: CtxPrecos): Promise<string> {
    return this.ler(c, async (l, est) => relogioNoFuso(await fusoDe(l, est)).hoje);
  }

  convenios(c: CtxPrecos): Promise<ConvenioPreco[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(`${SQL_CONVENIO} ORDER BY f.nome, f.id`, [est, est, est, est, est], { teto: 5_000 })
      ).map(convenioDe),
    );
  }

  convenio(c: CtxPrecos, cod: number): Promise<ConvenioPreco | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_CONVENIO} AND f.id = ?`, [est, est, est, est, est, cod]);
      return r ? convenioDe(r) : null;
    });
  }

  valoresContrato(c: CtxPrecos, cod: number) {
    return this.ler(c, async (l, est) => {
      const f = await l.uma(
        `SELECT f.nome, f.registro_ans, f.classe_fonte_pagadora_id, f.contato_nome, f.email, f.exige_validade_carteira,
                f.telefone, ufp.sigla AS uf_sigla, ufn.sigla AS nf_uf_sigla,
                COALESCE(fe.dias_retorno, f.dias_retorno) AS dias_retorno, f.dias_pagamento_remessa, pj.cnpj, pj.inscricao_estadual,
                f.pessoa_juridica_id, f.nota_fiscal_pessoa_juridica_id,
                k.situacao AS situacao_acordo, k.vigencia_inicio, k.vigencia_fim, k.prazo_apresentacao_dias,
                k.dia_corte_faturamento, k.exige_guia, k.cobra_insumos, k.fatura_pela_data_alta, k.abate_devolucao,
                k.exige_auditoria_interna, k.iss_retido_pela_fonte AS iss_acordo, k.percentual_iss AS iss_pct,
                k.percentual_ir AS ir_pct, k.percentual_custo_financeiro
           FROM fonte_pagadora f
           JOIN fonte_pagadora_estabelecimento fe
             ON fe.fonte_pagadora_id = f.id AND fe.estabelecimento_id = ? AND fe.excluido_em IS NULL
           LEFT JOIN pessoa_juridica pj ON pj.id = f.pessoa_juridica_id
           LEFT JOIN unidade_federativa ufp ON ufp.id = f.unidade_federativa_id
           LEFT JOIN unidade_federativa ufn ON ufn.id = f.nota_fiscal_unidade_federativa_id
           LEFT JOIN contrato_fonte_pagadora k ON k.id = (
                  SELECT x.id FROM contrato_fonte_pagadora x
                   WHERE x.fonte_pagadora_id = f.id AND x.estabelecimento_id = ? AND x.excluido_em IS NULL
                   ORDER BY x.situacao = 'vigente' DESC, x.vigencia_inicio DESC LIMIT 1)
          WHERE f.id = ? AND f.excluido_em IS NULL`,
        [est, est, cod],
      );
      if (!f) return null;
      const contatos = await l.consultar(
        'SELECT area, nome, telefone, email FROM contato_fonte_pagadora WHERE fonte_pagadora_id = ? AND excluido_em IS NULL',
        [cod],
      );
      const porArea = new Map(contatos.map((x) => [texto(x['area']), x]));
      const doContato = Object.fromEntries(
        Object.entries(CONTATO_AREA).map(([k, [area, col]]) => [k, textoN(porArea.get(area)?.[col])]),
      );
      const pjId = nn(f['pessoa_juridica_id']);
      const nfId = nn(f['nota_fiscal_pessoa_juridica_id']) ?? pjId;
      const end = pjId === null ? null : await l.uma(SQL_ENDERECO_PJ, [pjId]);
      const nf = nfId === null ? null : await l.uma('SELECT * FROM pessoa_juridica WHERE id = ?', [nfId]);
      const nfEnd = nfId === null ? null : nfId === pjId ? end : await l.uma(SQL_ENDERECO_PJ, [nfId]);
      // Endereço da pessoa jurídica pelas chaves do contrato (as da nota fiscal com o prefixo nf).
      const endereco = (e: Linha | null, nfe: boolean) => {
        const k = (c: string) => (nfe ? `nf${c[0]!.toUpperCase()}${c.slice(1)}` : c);
        return {
          [k('endereco')]: textoN(e?.['logradouro']),
          [k('numero')]: numeroDeTexto(e?.['numero']),
          ...(nfe ? {} : { complemento: textoN(e?.['complemento']) }),
          [k('bairro')]: textoN(e?.['bairro']),
          [k('cidade')]: textoN(e?.['cidade']),
          [k('cep')]: numeroDeTexto(e?.['cep']),
          [k('ibge')]: numeroDeTexto(e?.['codigo_ibge']),
        };
      };
      const sim = (v: unknown) => (v === null || v === undefined ? null : verdadeiro(v) ? 'sim' : 'não');
      const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        nome: texto(f['nome']),
        cnpj: numeroDeTexto(f['cnpj']),
        inscricaoEstadual: textoN(f['inscricao_estadual']),
        registroAns: numeroDeTexto(f['registro_ans']),
        classificacao: f['classe_fonte_pagadora_id'] === null ? null : texto(f['classe_fonte_pagadora_id']),
        contato: textoN(f['contato_nome']),
        convenioEmail: textoN(f['email']),
        telefone: textoN(f['telefone']),
        uf: textoN(f['uf_sigla']),
        nfUf: textoN(f['nf_uf_sigla']),
        // O contrato da tela ainda fala "T"/"F" (pedido de contrato: booleano).
        validaCarteira: verdadeiro(f['exige_validade_carteira']) ? 'T' : 'F',
        retornoDias: f['dias_retorno'] === null ? null : texto(f['dias_retorno']),
        prazoPagamentoDias: f['dias_pagamento_remessa'] === null ? null : texto(f['dias_pagamento_remessa']),
        situacaoAcordo: textoN(f['situacao_acordo']),
        vigenciaInicio: dataIso(f['vigencia_inicio']),
        vigenciaFim: dataIso(f['vigencia_fim']),
        prazoApresentacaoDias: num(f['prazo_apresentacao_dias']),
        diaCorteFaturamento: num(f['dia_corte_faturamento']),
        exigeGuia: sim(f['exige_guia']),
        cobraInsumos: sim(f['cobra_insumos']),
        faturaPelaDataAlta: sim(f['fatura_pela_data_alta']),
        abateDevolucao: sim(f['abate_devolucao']),
        exigeAuditoriaInterna: sim(f['exige_auditoria_interna']),
        issRetidoPelaFonte: sim(f['iss_acordo']),
        percentualIss: num(f['iss_pct']),
        percentualIr: num(f['ir_pct']),
        percentualCustoFinanceiro: num(f['percentual_custo_financeiro']),
        ...doContato,
        ...endereco(end, false),
        ...endereco(nfEnd, true),
        nfRazaoSocial: textoN(nf?.['razao_social']),
        nfCnpj: numeroDeTexto(nf?.['cnpj']),
        nfTelefone: textoN(nf?.['telefone']),
        nfInscricaoMunicipal: textoN(nf?.['inscricao_municipal']),
      } as Record<string, string | number | null>;
    });
  }

  opcoesClassificacao(c: CtxPrecos) {
    // A classificação é da rede inteira (sem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id, descricao FROM classe_fonte_pagadora WHERE ativo = TRUE ORDER BY descricao',
          [],
          {
            teto: 500,
          },
        )
      ).map((r) => ({ valor: texto(r['id']), rotulo: texto(r['descricao']) })),
    );
  }

  vigenciasTabelas(c: CtxPrecos, cod: number): Promise<VigenciaTabelaConvenio[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT ctv.tipo_item, ctv.tabela_preco_id, ctv.vigencia_inicio, ctv.vigencia_fim
             FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k ON k.id = ctv.contrato_fonte_pagadora_id
            WHERE k.fonte_pagadora_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
            ORDER BY ctv.vigencia_inicio DESC, ctv.id`,
          [cod, est],
          { teto: 2_000 },
        )
      ).flatMap((r) => {
        const tipo = TIPO_ITEM_VIGENCIA[texto(r['tipo_item'])];
        return tipo
          ? [
              {
                tipo,
                tabela: n(r['tabela_preco_id']),
                inicio: dataIso(r['vigencia_inicio']) ?? '',
                fim: dataIso(r['vigencia_fim']),
              },
            ]
          : [];
      }),
    );
  }

  indicesConvenio(c: CtxPrecos, cod: number) {
    return this.ler(c, (l, est) => indicesConvenioPropria(l, est, cod));
  }

  tiss(c: CtxPrecos, cod: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT codigo_operadora, codigo_contratado_tiss FROM codigo_prestador_fonte_pagadora
          WHERE fonte_pagadora_id = ? AND estabelecimento_id = ? AND tipo_prestador = 'estabelecimento'
            AND ativo = TRUE AND excluido_em IS NULL ORDER BY vigencia_inicio DESC LIMIT 1`,
        [cod, est],
      );
      return {
        configurado: r !== null,
        valores: r
          ? {
              codigoPrestador: texto(r['codigo_operadora']),
              codigoContratado: textoN(r['codigo_contratado_tiss']),
            }
          : {},
        parametros: [],
      };
    });
  }

  historico(c: CtxPrecos, cod: number) {
    return this.ler(c, async (l, est) => {
      const fuso = await fusoDe(l, est);
      return (
        await l.consultar(
          'SELECT ocorrido_em, nome, classe_fonte_pagadora_id FROM fonte_pagadora_versao WHERE fonte_pagadora_id = ? ORDER BY ocorrido_em DESC, id DESC',
          [cod],
          { teto: 500 },
        )
      ).map((r) => ({
        quando: localDe(r['ocorrido_em'], fuso),
        nome: texto(r['nome']),
        classificacao: nn(r['classe_fonte_pagadora_id']),
      }));
    });
  }

  planos(c: CtxPrecos, cod: number): Promise<PlanoConvenio[] | null> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT pe.id, p.descricao, p.codigo, pe.vigencia_inicio, pe.vigencia_fim, pe.ativo, pe.versao, u.login
             FROM plano_fonte_pagadora_estabelecimento pe
             JOIN plano_fonte_pagadora p ON p.id = pe.plano_fonte_pagadora_id
             LEFT JOIN usuario u ON u.id = pe.criado_por
            WHERE p.fonte_pagadora_id = ? AND pe.estabelecimento_id = ? AND pe.excluido_em IS NULL AND p.excluido_em IS NULL
            ORDER BY pe.vigencia_inicio DESC, pe.id`,
          [cod, est],
          { teto: 500 },
        )
      ).map((r) => ({
        id: n(r['id']),
        nome: texto(r['descricao']),
        planoLegado: numeroDeTexto(r['codigo']),
        inicio: dataIso(r['vigencia_inicio']) ?? '',
        fim: dataIso(r['vigencia_fim']),
        ativo: verdadeiro(r['ativo']),
        criadoPor: texto(r['login']),
        versao: n(r['versao']),
      })),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
  modificadores(_c: CtxPrecos, _t: TipoModificador) {
    return naoLido({ itens: [], total: 0 });
  }

  impactoSituacao(c: CtxPrecos, cod: number): Promise<ImpactoSituacaoConvenio> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT
           (SELECT COUNT(*) FROM agenda_fonte_pagadora af JOIN agenda_servico a ON a.id = af.agenda_servico_id
              JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
             WHERE af.fonte_pagadora_id = ? AND a.estabelecimento_id = ? AND af.excluido_em IS NULL
               AND a.excluido_em IS NULL AND ca.natureza = 'consulta') AS consulta,
           (SELECT COUNT(*) FROM agenda_fonte_pagadora af JOIN agenda_servico a ON a.id = af.agenda_servico_id
              JOIN categoria_agenda ca ON ca.id = a.categoria_agenda_id
             WHERE af.fonte_pagadora_id = ? AND a.estabelecimento_id = ? AND af.excluido_em IS NULL
               AND a.excluido_em IS NULL AND ca.natureza = 'exame') AS exame,
           (SELECT COUNT(*) FROM marcacao_horario m JOIN horario_agenda h ON h.id = m.horario_agenda_id
             WHERE m.fonte_pagadora_id = ? AND m.estabelecimento_id = ? AND m.excluido_em IS NULL
               AND h.inicio_em > CURRENT_TIMESTAMP) AS futuros`,
        [cod, est, cod, est, cod, est],
      );
      return {
        agendasConsulta: n(r?.['consulta']),
        agendasExame: n(r?.['exame']),
        agendamentosFuturos: n(r?.['futuros']),
        // Pendência de leitura: contas abertas e vínculos de profissionais (módulos do faturamento e do cadastro).
        contasAbertas: 0,
        profissionais: 0,
        diariaAcompanhante: null,
      };
    });
  }

  // ── Tabelas de preço ──────────────────────────────────────────────────────────────────────────────

  cabecalhos(c: CtxPrecos, tipo: 'honorarios' | 'diarias' | 'matmed'): Promise<CabecalhoTabela[]> {
    const tipos = TIPOS_TABELA[tipo];
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, descricao, situacao, moeda_calculo FROM tabela_preco
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND tipo_item IN (${tipos.map(() => '?').join(', ')})
            ORDER BY descricao, id`,
          [est, ...tipos],
          { teto: 2_000 },
        )
      ).map((r) => ({
        codigo: n(r['id']),
        nome: texto(r['descricao']),
        situacao: situacaoDaTabela(r['situacao']),
        modo: textoN(r['moeda_calculo']),
      })),
    );
  }

  perfisHonorario(c: CtxPrecos) {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT pp.tabela_preco_id, COUNT(*) AS itens, SUM(pp.modelo_valor = 'indice') AS com_ch,
                SUM(pp.modelo_valor = 'porte') AS com_porte
           FROM preco_procedimento pp JOIN tabela_preco t ON t.id = pp.tabela_preco_id
          WHERE t.estabelecimento_id = ? AND pp.excluido_em IS NULL AND t.excluido_em IS NULL
          GROUP BY pp.tabela_preco_id`,
        [est],
        { teto: 5_000 },
      );
      return new Map(
        ls.map((r) => [
          n(r['tabela_preco_id']),
          { itens: n(r['itens']), comCh: n(r['com_ch']), comPorte: n(r['com_porte']) },
        ]),
      );
    });
  }

  itensHonorario(
    c: CtxPrecos,
    tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemHonorarioPreco[]; total: number }> {
    return this.ler(c, async (l, est) => {
      const busca = f.busca?.trim() ? ` AND COALESCE(pp.descricao_cobranca, it.descricao) LIKE ?` : '';
      const p = [f.data, f.data, tab, est, ...(busca ? [`%${f.busca!.trim().replace(/[%_\\]/g, '')}%`] : [])];
      const total = await l.uma<{ total: unknown }>(
        `SELECT COUNT(*) AS total FROM preco_procedimento pp JOIN tabela_preco t ON t.id = pp.tabela_preco_id
           LEFT JOIN item_faturavel it ON it.id = pp.item_faturavel_id
          WHERE pp.tabela_preco_id = ? AND t.estabelecimento_id = ? AND pp.excluido_em IS NULL
            AND t.excluido_em IS NULL${busca}`,
        p.slice(2),
      );
      const ls = await l.consultar(`${SQL_ITENS_HONORARIO}${busca} ORDER BY nome, pp.id LIMIT ? OFFSET ?`, [
        ...p,
        f.porPagina,
        f.pagina * f.porPagina,
      ]);
      return { itens: ls.map(itemHonorarioDe), total: n(total?.total) };
    });
  }

  itemHonorario(c: CtxPrecos, tab: number, cod: number, data: string): Promise<ItemHonorarioPreco | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_ITENS_HONORARIO} AND pp.id = ?`, [data, data, tab, est, cod]);
      return r ? itemHonorarioDe(r) : null;
    });
  }

  itensParaReajuste(
    c: CtxPrecos,
    tab: number,
    codigos: readonly number[] | null,
    data: string,
    teto: number,
  ) {
    return this.ler(c, async (l, est) => {
      const filtro = codigos && codigos.length ? ` AND pp.id IN (${codigos.map(() => '?').join(', ')})` : '';
      return (
        await l.consultar(`${SQL_ITENS_HONORARIO}${filtro} ORDER BY pp.id LIMIT ?`, [
          data,
          data,
          tab,
          est,
          ...(codigos ?? []),
          teto,
        ])
      ).map(itemHonorarioDe);
    });
  }

  vigenciasDoItem(c: CtxPrecos, tab: number, cod: number): Promise<VigenciaItem[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT x.* FROM preco_procedimento_valor x JOIN preco_procedimento pp ON pp.id = x.preco_procedimento_id
             JOIN tabela_preco t ON t.id = pp.tabela_preco_id
            WHERE pp.id = ? AND pp.tabela_preco_id = ? AND t.estabelecimento_id = ? AND ${VALOR_VALIDO}
            ORDER BY x.vigencia_inicio DESC, x.id DESC`,
          [cod, tab, est],
          { teto: 1_000 },
        )
      ).map((r) => ({ data: dataIso(r['vigencia_inicio']) ?? '', valores: componentesDe(r) })),
    );
  }

  autoriaDoItem(c: CtxPrecos, tab: number, cod: number): Promise<AutoriaPreco[] | null> {
    return this.ler(c, async (l, est) => {
      const fuso = await fusoDe(l, est);
      return autoriaDoItemPropria(l, est, tab, cod, (v) => localDe(v, fuso));
    });
  }

  lotes(c: CtxPrecos, tab: number | null): Promise<LoteReajuste[] | null> {
    return this.ler(c, async (l, est) => {
      const fuso = await fusoDe(l, est);
      return (
        await l.consultar(
          `SELECT lr.identificador, lr.tabela_preco_id, lr.vigencia_inicio, lr.tipo_lote, lr.quantidade_itens,
                  lr.quantidade_desfeitos, lr.situacao, lr.justificativa, lr.criado_em, u.login
             FROM lote_reajuste lr JOIN tabela_preco t ON t.id = lr.tabela_preco_id
             LEFT JOIN usuario u ON u.id = lr.autor_usuario_id
            WHERE t.estabelecimento_id = ? AND lr.excluido_em IS NULL${tab !== null ? ' AND lr.tabela_preco_id = ?' : ''}
            ORDER BY lr.criado_em DESC, lr.id DESC`,
          tab !== null ? [est, tab] : [est],
          { teto: 1_000 },
        )
      ).map((r) => ({
        lote: texto(r['identificador']),
        tabela: n(r['tabela_preco_id']),
        data: dataIso(r['vigencia_inicio']) ?? '',
        origem: texto(r['tipo_lote']),
        itens: n(r['quantidade_itens']),
        autor: texto(r['login']),
        quando: localDe(r['criado_em'], fuso),
        justificativa: texto(r['justificativa']),
        desfeitos: n(r['quantidade_desfeitos']),
        desfeito: texto(r['situacao']) === 'desfeito',
      }));
    });
  }

  linhasDoLote(c: CtxPrecos, lote: string): Promise<LinhaDoLote[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT lr.tabela_preco_id, i.preco_procedimento_id, i.vigencia_base, lr.vigencia_inicio, i.componentes_novos
             FROM lote_reajuste_item i JOIN lote_reajuste lr ON lr.id = i.lote_reajuste_id
             JOIN tabela_preco t ON t.id = lr.tabela_preco_id
            WHERE lr.identificador = ? AND t.estabelecimento_id = ? AND i.excluido_em IS NULL
            ORDER BY i.sequencia`,
          [lote, est],
          { teto: 20_000 },
        )
      ).map((r) => {
        let comp: Record<string, unknown>;
        try {
          comp =
            typeof r['componentes_novos'] === 'string'
              ? JSON.parse(r['componentes_novos'] as string)
              : ((r['componentes_novos'] as Record<string, unknown>) ?? {});
        } catch {
          comp = {};
        }
        return {
          tabela: n(r['tabela_preco_id']),
          codigo: n(r['preco_procedimento_id']),
          data: dataIso(r['vigencia_inicio']) ?? '',
          valores: {
            ch: Number(comp['ch'] ?? 0),
            co: Number(comp['co'] ?? 0),
            filme: Number(comp['filme'] ?? 0),
            anes: Number(comp['anes'] ?? 0),
            outros: Number(comp['outros'] ?? 0),
          },
        };
      }),
    );
  }

  itensDiaria(
    c: CtxPrecos,
    tab: number,
    f: FiltroPagina,
  ): Promise<{ itens: ItemDiariaPreco[]; total: number }> {
    return this.ler(c, async (l, est) => {
      const total = await l.uma<{ total: unknown }>(
        `SELECT COUNT(*) AS total FROM preco_diaria_taxa d JOIN tabela_preco t ON t.id = d.tabela_preco_id
          WHERE d.tabela_preco_id = ? AND t.estabelecimento_id = ? AND d.excluido_em IS NULL AND t.excluido_em IS NULL`,
        [tab, est],
      );
      const ls = await l.consultar(`${SQL_ITENS_DIARIA} ORDER BY d.nome, d.id LIMIT ? OFFSET ?`, [
        f.data,
        tab,
        est,
        f.porPagina,
        f.pagina * f.porPagina,
      ]);
      return { itens: ls.map(itemDiariaDe), total: n(total?.total) };
    });
  }

  itemDiaria(c: CtxPrecos, tab: number, ope: number, data: string): Promise<ItemDiariaPreco | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_ITENS_DIARIA} AND d.id = ?`, [data, tab, est, ope]);
      return r ? itemDiariaDe(r) : null;
    });
  }

  itensMatmed(c: CtxPrecos, tab: number, f: FiltroPagina) {
    return this.ler(c, (l, est) => itensMatmedPropria(l, est, tab, f));
  }

  itemMatmed(c: CtxPrecos, tab: number, cod: number, data: string) {
    return this.ler(c, (l, est) => itemMatmedPropria(l, est, tab, cod, data));
  }

  vigenciasDiaria(c: CtxPrecos, tab: number, ope: number): Promise<VigenciaValor[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT v.vigencia_inicio, v.valor FROM preco_diaria_taxa_valor v JOIN preco_diaria_taxa d ON d.id = v.preco_diaria_taxa_id
             JOIN tabela_preco t ON t.id = d.tabela_preco_id
            WHERE d.id = ? AND d.tabela_preco_id = ? AND t.estabelecimento_id = ? AND v.operacao <> 'exclusao'
            ORDER BY v.vigencia_inicio DESC, v.id DESC`,
          [ope, tab, est],
          { teto: 1_000 },
        )
      ).map((r) => ({ data: dataIso(r['vigencia_inicio']) ?? '', valor: nn(r['valor']) })),
    );
  }

  vigenciasMatmed(c: CtxPrecos, tab: number, cod: number) {
    return this.ler(c, (l, est) => vigenciasMatmedPropria(l, est, tab, cod));
  }

  edicoes(c: CtxPrecos) {
    // As edições da referência de mat/med são da rede inteira (publicação externa, sem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id, numero_edicao FROM edicao_referencia_matmed ORDER BY vigencia_inicio DESC, id DESC',
          [],
          { teto: 500 },
        )
      ).map((r) => ({ id: n(r['id']), versao: Number(String(r['numero_edicao']).replace(/\D/g, '') || 0) })),
    );
  }

  indicesNaData(c: CtxPrecos, conv: number, data: string) {
    return this.ler(c, (l, est) => indicesNaDataPropria(l, est, conv, data));
  }

  porteNaData(c: CtxPrecos, conv: number, porte: string, data: string) {
    return this.ler(c, (l, est) => porteNaDataPropria(l, est, conv, porte, data));
  }

  /** Porte anestésico do acordo pela tabela de honorários do regime vigente na data do atendimento. */
  porteAnestesicoNaData(c: CtxPrecos, conv: number, regime: RegimePorte, porte: string, data: string) {
    return this.ler(c, (l, est) => porteAnestesicoNaDataPropria(l, est, conv, regime, porte, data));
  }

  credenciamento(
    c: CtxPrecos,
    conv: FiltroConvenio,
    pagina: number,
    porPagina: number,
    _bancario: boolean,
    profissional?: string | null,
  ) {
    return this.ler(c, (l, est) => credenciamentoPropria(l, est, conv, pagina, porPagina, profissional));
  }

  /** Os atos do credenciamento: as exceções por procedimento, equipe ou plano. */
  credenciamentoAtos(c: CtxPrecos, conv: FiltroConvenio) {
    return this.ler(c, (l, est) => excecoesCredenciamentoPropria(l, est, conv));
  }

  credenciamentoComplementar() {
    return naoLido({ unimed: paginaVazia(), auditoras: paginaVazia() });
  }

  codigosPrestador(c: CtxPrecos, conv: FiltroConvenio, pagina: number, porPagina: number): Promise<Pagina> {
    return this.ler(c, async (l, est) => {
      const lista = conv == null ? null : typeof conv === 'number' ? [conv] : [...conv];
      if (lista && lista.length === 0) return paginaVazia(COLUNAS_PRESTADOR);
      const filtro = lista ? ` AND cp.fonte_pagadora_id IN (${lista.map(() => '?').join(', ')})` : '';
      const total = await l.uma<{ total: unknown }>(
        `SELECT COUNT(*) AS total FROM codigo_prestador_fonte_pagadora cp
          WHERE cp.estabelecimento_id = ? AND cp.excluido_em IS NULL AND cp.ativo = TRUE${filtro}`,
        [est, ...(lista ?? [])],
      );
      const itens = await l.consultar(
        `SELECT cp.fonte_pagadora_id AS convenio, f.nome AS convenio_nome, cp.tipo_prestador, cp.codigo_operadora,
                cp.vigencia_inicio, cp.vigencia_fim
           FROM codigo_prestador_fonte_pagadora cp JOIN fonte_pagadora f ON f.id = cp.fonte_pagadora_id
          WHERE cp.estabelecimento_id = ? AND cp.excluido_em IS NULL AND cp.ativo = TRUE${filtro}
          ORDER BY f.nome, cp.id LIMIT ? OFFSET ?`,
        [est, ...(lista ?? []), porPagina, pagina * porPagina],
      );
      return {
        colunas: COLUNAS_PRESTADOR.map(([campo, rotulo]) => ({ campo, rotulo })),
        itens: itens.map((r) => ({
          convenio: n(r['convenio']),
          convenioNome: texto(r['convenio_nome']),
          tipo: texto(r['tipo_prestador']),
          codigo: texto(r['codigo_operadora']),
          inicio: dataIso(r['vigencia_inicio']),
          fim: dataIso(r['vigencia_fim']),
        })),
        total: n(total?.total),
      };
    });
  }

  dePara(c: CtxPrecos, conv: FiltroConvenio, exame: string | null, pagina: number, porPagina: number) {
    return this.ler(c, (l) => deParaPropria(l, conv, exame, pagina, porPagina));
  }

  portes(c: CtxPrecos, tab: number | null, pagina: number, porPagina: number) {
    return this.ler(c, (l, est) => portesPropria(l, est, tab, pagina, porPagina));
  }

  terceiros() {
    return naoLido(paginaVazia());
  }

  tabelasTerceiros() {
    return naoLido([]);
  }

  unimed() {
    return naoLido(paginaVazia());
  }

  saneamento() {
    return naoLido([]);
  }

  // ── Importação e planos ───────────────────────────────────────────────────────────────────────────

  /** As importações do catálogo no estabelecimento da sessão (as contagens saem das linhas). */
  cargas(c: CtxPrecos, catalogo: string): Promise<CargaImportacao[] | null> {
    return this.ler(c, async (l, est) => {
      const fuso = await fusoDe(l, est);
      const ls = await l.consultar(
        `${SQL_CARGA} AND ct.catalogo = ? ORDER BY ct.criado_em DESC, ct.id DESC`,
        [est, catalogo],
        {
          teto: 1_000,
        },
      );
      return ls.map((r) => cargaDe(r, fuso));
    });
  }

  carga(c: CtxPrecos, id: number): Promise<CargaImportacao | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_CARGA} AND ct.id = ?`, [est, id]);
      return r ? cargaDe(r, await fusoDe(l, est)) : null;
    });
  }

  linhasDaCarga(
    c: CtxPrecos,
    id: number,
    pagina: number,
    porPagina: number,
    comparacao: string | null,
  ): Promise<{ itens: LinhaCargaImportacao[]; total: number }> {
    return this.ler(c, async (l, est) => {
      const filtro = comparacao ? ' AND li.situacao = ?' : '';
      const p = [id, est, ...(comparacao ? [comparacao] : [])];
      const de = `FROM carga_tabela_preco_linha li JOIN carga_tabela_preco ct ON ct.id = li.carga_tabela_preco_id
         WHERE li.carga_tabela_preco_id = ? AND ct.estabelecimento_id = ? AND li.excluido_em IS NULL
           AND ct.excluido_em IS NULL${filtro}`;
      const t = await l.uma<{ total: unknown }>(`SELECT COUNT(*) AS total ${de}`, p);
      const ls = await l.consultar(`SELECT li.* ${de} ORDER BY li.sequencia LIMIT ? OFFSET ?`, [
        ...p,
        porPagina,
        pagina * porPagina,
      ]);
      return { itens: ls.map(linhaDaCargaDe), total: n(t?.total) };
    });
  }

  /** A carga e as linhas num passo só (Executor, com a trilha): a tabela é do estabelecimento; o arquivo, uma vez por tabela. */
  async gravarCarga(c: CtxPrecos, nova: NovaCarga, t: TrilhaPreco): Promise<{ id: number }> {
    if (nova.tabela === null) throw recusa('tabela-obrigatoria', 'Escolha a tabela de preço da importação.');
    const tab = nova.tabela;
    return this.direta(
      c,
      'preco.importacao.preparar',
      ['carga_tabela_preco_linha', 'carga_tabela_preco'],
      t,
      async (tx, est) => {
        const tb = await tx.uma(
          'SELECT id FROM tabela_preco WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [tab, est],
        );
        if (!tb) throw recusa('nao-encontrado', 'Tabela de preço não encontrada neste estabelecimento.');
        const rep = await tx.uma<{ id: unknown }>(
          'SELECT id FROM carga_tabela_preco WHERE tabela_preco_id = ? AND arquivo_sha256 = ?',
          [tab, nova.sha256],
        );
        if (rep)
          throw recusa(
            'carga-repetida',
            `Este arquivo já foi importado nesta tabela (importação ${n(rep.id)}).`,
          );
        for (const li of nova.linhas) componentesParaGravar(li.valores, li.linha);
        const hoje = relogioNoFuso(await fusoDe(tx, est)).hoje;
        const id = await tx.incluir('carga_tabela_preco', {
          estabelecimento_id: est,
          tabela_preco_id: tab,
          fonte: 'arquivo',
          arquivo_nome: nova.arquivo.slice(0, 120),
          arquivo_bytes: nova.bytes > 0 ? nova.bytes : null,
          catalogo: nova.catalogo,
          arquivo_sha256: nova.sha256,
          situacao: nova.situacao,
          vigencia_inicio: hoje,
          total_linhas: nova.totais.linhas,
          linhas_erro: nova.totais.erros,
          motivo: nova.motivo,
        });
        for (const li of nova.linhas) {
          const v = componentesParaGravar(li.valores, li.linha);
          const a = componentesParaGravar(li.anteriores ?? null, li.linha);
          const item =
            li.codigo === null
              ? null
              : await tx.uma<{ item_faturavel_id: unknown }>(
                  'SELECT item_faturavel_id FROM preco_procedimento WHERE id = ? AND tabela_preco_id = ? AND excluido_em IS NULL',
                  [li.codigo, tab],
                );
          await tx.incluir('carga_tabela_preco_linha', {
            carga_tabela_preco_id: id,
            sequencia: li.linha,
            // Linha sem código legível (só na linha com erro): o código fica vazio e o motivo diz por quê.
            codigo_item: li.codigo === null ? '' : String(li.codigo),
            nome_item: li.nome ? li.nome.slice(0, 300) : null,
            item_faturavel_id: nn(item?.item_faturavel_id),
            valor: v?.ch ?? 0,
            valor_custo_operacional: v?.co ?? null,
            valor_filme: v?.filme ?? null,
            valor_anestesista: v?.anes ?? null,
            valor_outros: v?.outros ?? null,
            anterior_valor: a?.ch ?? null,
            anterior_custo_operacional: a?.co ?? null,
            anterior_filme: a?.filme ?? null,
            anterior_anestesista: a?.anes ?? null,
            anterior_outros: a?.outros ?? null,
            situacao: li.resultado === 'erro' ? 'erro' : (li.comparacao ?? 'novo'),
            divergencia: li.motivo
              ? li.motivo.slice(0, 500)
              : li.resultado === 'erro'
                ? 'Linha inválida.'
                : null,
          });
        }
        return { id };
      },
    );
  }

  /** Publica (com o lote do reajuste) ou rejeita (com o motivo) a carga, pela versão lida. */
  async mudarSituacaoCarga(c: CtxPrecos, m: MudancaCarga, t: TrilhaPreco): Promise<void> {
    try {
      await this.direta(
        c,
        `preco.importacao.${m.para === 'publicada' ? 'publicar' : 'rejeitar'}`,
        ['lote_reajuste', 'carga_tabela_preco'],
        t,
        async (tx, est) => {
          const [k] = await tx.consultarParaAtualizar(
            'SELECT * FROM carga_tabela_preco WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [m.id, est],
          );
          if (!k) throw recusa('nao-encontrado', 'Importação não encontrada.');
          if (n(k['versao']) !== m.versao)
            throw new ErroOperacao(409, 'conflito-concorrente', 'Importação', 'A importação mudou. Releia.');
          if (!m.de.includes(texto(k['situacao'])))
            throw new ErroOperacao(
              409,
              'situacao-invalida',
              'Importação',
              'A situação da importação não permite a ação.',
            );
          const valores: Record<string, unknown> = { situacao: m.para };
          if (m.para === 'publicada') {
            if (tx.contexto.usuario === null)
              throw recusa('sem-usuario', 'A publicação exige o usuário da sessão.');
            let lote: number | null = null;
            if (m.lote !== null) {
              const lr = await tx.uma<{ id: unknown }>(
                'SELECT id FROM lote_reajuste WHERE identificador = ? AND tabela_preco_id = ? AND excluido_em IS NULL',
                [m.lote, k['tabela_preco_id']],
              );
              if (!lr) throw recusa('lote-inexistente', `O lote ${m.lote} não é desta tabela.`);
              lote = n(lr.id);
            }
            Object.assign(valores, {
              publicada_em: new Date(),
              publicada_por_usuario_id: tx.contexto.usuario,
              lote_reajuste_id: lote,
            });
          } else {
            if (!m.motivo?.trim()) throw recusa('motivo-obrigatorio', 'Diga o motivo da rejeição.');
            valores['motivo'] = m.motivo.slice(0, 500);
          }
          await tx.alterar('carga_tabela_preco', m.id, m.versao, valores);
          return { id: m.id };
        },
      );
    } catch (e) {
      // A tela conhece as recusas da importação pelo código da carga.
      if (e instanceof ErroPlano && e.codigo === 'conflito-concorrente')
        throw new ErroCarga('conflito-concorrente', e.message);
      const codigo = e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : '';
      if (codigo === 'conflito-concorrente' || codigo === 'situacao-invalida')
        throw new ErroCarga(codigo, String((e as ErroOperacao).problema.detail ?? ''));
      throw e;
    }
  }

  async gravarPlano(c: CtxPrecos, p: NovoPlano, t: TrilhaPreco): Promise<{ id: number }> {
    const r = await this.direta(
      c,
      'convenio.incluir-plano',
      ['plano_fonte_pagadora', 'plano_fonte_pagadora_estabelecimento'],
      t,
      async (tx, est) => {
        const f = await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [
          p.convenio,
        ]);
        if (!f) throw recusa('nao-encontrado', 'Convênio não encontrado.');
        if (p.fim !== null && p.fim < p.inicio)
          throw recusa('vigencia-invalida', `O fim (${p.fim}) não pode ser antes do início (${p.inicio}).`);
        const codigo = p.planoLegado !== null ? String(p.planoLegado) : null;
        const ja = codigo
          ? await tx.uma<{ id: unknown }>(
              'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND codigo = ? AND excluido_em IS NULL',
              [p.convenio, codigo],
            )
          : null;
        const plano =
          ja !== null
            ? n(ja.id)
            : await tx.incluir('plano_fonte_pagadora', {
                fonte_pagadora_id: p.convenio,
                codigo: codigo ?? `P${Date.now().toString(36).toUpperCase()}`,
                descricao: p.nome.slice(0, 150),
              });
        const id = await tx.incluir('plano_fonte_pagadora_estabelecimento', {
          plano_fonte_pagadora_id: plano,
          estabelecimento_id: est,
          vigencia_inicio: p.inicio,
          vigencia_fim: p.fim,
          observacao: p.justificativa,
        });
        return { id };
      },
    );
    return r;
  }

  async alterarPlano(
    c: CtxPrecos,
    a: AlteracaoPlano,
    t: TrilhaPreco,
  ): Promise<{ id: number; versao: number }> {
    return this.direta(
      c,
      'convenio.alterar-plano',
      ['plano_fonte_pagadora', 'plano_fonte_pagadora_estabelecimento'],
      t,
      async (tx, est) => {
        const [pe] = await tx.consultarParaAtualizar<Linha>(
          `SELECT pe.id, pe.versao, pe.vigencia_inicio, pe.plano_fonte_pagadora_id, p.versao AS versao_plano
           FROM plano_fonte_pagadora_estabelecimento pe JOIN plano_fonte_pagadora p ON p.id = pe.plano_fonte_pagadora_id
          WHERE pe.id = ? AND pe.estabelecimento_id = ? AND p.fonte_pagadora_id = ? AND pe.excluido_em IS NULL`,
          [a.id, est, a.convenio],
        );
        if (!pe) throw recusa('nao-encontrado', 'Plano não encontrado.');
        if (n(pe['versao']) !== a.versao)
          throw recusa('conflito-concorrente', 'O plano mudou depois que você abriu: abra de novo.');
        const inicio = dataIso(pe['vigencia_inicio']) ?? '';
        if (a.fim !== undefined && a.fim !== null && a.fim < inicio)
          throw recusa('vigencia-invalida', `O fim (${a.fim}) não pode ser antes do início (${inicio}).`);
        if (a.nome !== undefined)
          await tx.alterar('plano_fonte_pagadora', n(pe['plano_fonte_pagadora_id']), n(pe['versao_plano']), {
            descricao: a.nome.slice(0, 150),
          });
        const versao = await tx.alterar('plano_fonte_pagadora_estabelecimento', a.id, a.versao, {
          ...(a.fim !== undefined ? { vigencia_fim: a.fim } : {}),
          ...(a.ativo !== undefined ? { ativo: a.ativo } : {}),
        });
        return { id: a.id, versao };
      },
    );
  }

  /** Todas as partes do desfazer conferidas antes da primeira exclusão (só leitura). */
  async preConferirDesfazer(c: CtxPrecos, partes: readonly DesfazerReajusteEntrada[]): Promise<void> {
    await this.ler(c, async (l, est) => {
      for (const p of partes) await conferirDesfazer(l, est, p);
    });
  }

  /** Gravação direta (planos) pelo Executor: trilha e idempotência na mesma transação. */
  private async direta<T extends Record<string, number>>(
    c: CtxPrecos,
    nome: string,
    tabelas: readonly string[],
    t: TrilhaPreco,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    const op = definirOperacao<{ chave: string }, T>({
      nome,
      tabelas,
      entrada: zChave,
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela: tabelas[tabelas.length - 1]!, id: r['id'] ?? null }),
      trilha: () => ({
        dados: {
          evento: t.evento,
          recurso: t.recurso,
          operacao: t.operacao,
          chave: t.chaveNaturalAlvo,
          estacao: t.estacao,
        },
      }),
    });
    // A chave do pedido (Idempotency-Key): o reenvio devolve o mesmo resultado; sem ela, uma chave nova.
    const chave = t.chaveIdempotencia ?? `${nome.slice(0, 30)}:${randomUUID()}`;
    try {
      const r = await this.executor.executar(
        op,
        c.cliente,
        { chave },
        { ...contextoDe(c), chaveIdempotencia: chave },
      );
      return r.resultado as T;
    } catch (e) {
      // As recusas do plano voltam como o erro do plano (a tela as conhece pelo código).
      const codigo = e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : '';
      if (codigo === 'nao-encontrado' || codigo === 'conflito-concorrente' || codigo === 'vigencia-invalida')
        throw new ErroPlano(codigo, String((e as ErroOperacao).problema.detail ?? ''));
      throw e;
    }
  }
}

const COLUNAS_PRESTADOR: [string, string][] = [
  ['convenio', 'Convênio'],
  ['convenioNome', 'Nome do convênio'],
  ['tipo', 'Prestador'],
  ['codigo', 'Código na operadora'],
  ['inicio', 'Vigência: início'],
  ['fim', 'Vigência: fim'],
];

// ── Operações do Executor ───────────────────────────────────────────────────────────────────────────

const zChave = z.object({ chave: z.string() });

/** Situação do convênio no estabelecimento da sessão: suspender ou reativar, com o retrato em fonte_pagadora_versao. */
const OP_SITUACAO = definirOperacao<
  AlterarSituacaoConvenioEntrada,
  { convenio: number; situacaoAntes: string; situacaoDepois: string }
>({
  nome: 'convenio.alterar-situacao',
  tabelas: ['fonte_pagadora_estabelecimento', 'fonte_pagadora_versao'],
  entrada: OPERACOES_PRECO['convenio.alterarSituacao'].entrada as z.ZodType<AlterarSituacaoConvenioEntrada>,
  critica: true,
  async gravar(tx, e) {
    const { f, fe } = await travarNoEstabelecimento(tx, e.convenio);
    if (texto(f['situacao']) === 'inativa')
      throw recusa('convenio-inativo', 'O convênio está inativo na rede: a situação não muda por aqui.');
    const antes = texto(fe['situacao']);
    const depois = e.operacao === 'suspender' ? 'suspensa' : 'ativa';
    if (antes === depois) throw recusa('sem-efeito', `O convênio ${e.convenio} já está nessa situação.`);
    if (antes === 'inativa')
      throw recusa('convenio-inativo', 'O convênio está inativo: a situação não muda por aqui.');
    await tx.alterar('fonte_pagadora_estabelecimento', n(fe['id']), n(fe['versao']), { situacao: depois });
    await retrato(tx, f, { ...fe, situacao: depois }, 'alteracao');
    return {
      convenio: e.convenio,
      situacaoAntes: situacaoDaTela(antes),
      situacaoDepois: situacaoDaTela(depois),
    };
  },
  alvo: (e) => ({ tabela: 'fonte_pagadora', id: e.convenio }),
  trilha: (e) => ({ motivo: e.justificativa }),
});

/** Campos do contrato que o modelo tem, pela comparação com o que a tela leu. */
const OP_CONTRATO = definirOperacao<AlterarContratoConvenioEntrada, { convenio: number; campos: number }>({
  nome: 'convenio.alterar-contrato',
  tabelas: [
    'fonte_pagadora',
    'fonte_pagadora_estabelecimento',
    'fonte_pagadora_versao',
    'contato_fonte_pagadora',
    'pessoa_juridica',
  ],
  entrada: OPERACOES_PRECO['convenio.alterarContrato'].entrada as z.ZodType<AlterarContratoConvenioEntrada>,
  critica: true,
  async gravar(tx, e) {
    const campos = Object.keys(e.valores).sort();
    const doCadastro = campos.filter((k) => DA_PESSOA_JURIDICA.has(k));
    if (doCadastro.length)
      throw recusa(
        'campo-do-cadastro',
        `Os campos ${doCadastro.join(', ')} são da pessoa jurídica (a do convênio ou a tomadora da nota fiscal): altere no cadastro dela.`,
      );
    if (campos.includes('senhaObrigatoria'))
      throw new ErroOperacao(
        409,
        'decisao-pendente',
        'Campo aguardando decisão',
        'A senha de autorização aguarda a decisão do significado dos valores (DP-33): nada foi gravado.',
      );
    const semColuna = campos.filter((k) => !COLUNA_FONTE[k] && !CONTATO_AREA[k] && k !== CAMPO_INSCRICAO);
    if (semColuna.length)
      throw recusa('campo-desconhecido', `Campos desconhecidos no contrato: ${semColuna.join(', ')}.`);
    const { f, fe } = await travarNoEstabelecimento(tx, e.convenio);
    // A chave única é (fonte pagadora, área), sem a exclusão lógica: a linha excluída (pela importação, por exemplo)
    // é lida também e reativada quando a área volta a ter contato, no lugar de incluir outra.
    const contatos = new Map<string, Record<string, unknown>>();
    const excluidos = new Map<string, Record<string, unknown>>();
    for (const x of await tx.consultarParaAtualizar(
      'SELECT * FROM contato_fonte_pagadora WHERE fonte_pagadora_id = ?',
      [e.convenio],
    ))
      (x['excluido_em'] === null || x['excluido_em'] === undefined ? contatos : excluidos).set(
        texto(x['area']),
        x,
      );
    const pjId = nn(f['pessoa_juridica_id']);
    const [pj] =
      campos.includes(CAMPO_INSCRICAO) && pjId !== null
        ? await tx.consultarParaAtualizar('SELECT * FROM pessoa_juridica WHERE id = ?', [pjId])
        : [];
    if (campos.includes(CAMPO_INSCRICAO) && !pj)
      throw recusa(
        'sem-pessoa-juridica',
        'O convênio não tem pessoa jurídica: a inscrição estadual fica no cadastro dela.',
      );
    // As siglas das UFs gravadas (a tela compara e grava pela sigla).
    const siglas = new Map<number, string>();
    for (const k of campos.filter((x) => CAMPOS_UF.has(x))) {
      const idUf = nn(f[COLUNA_FONTE[k]!]);
      if (idUf === null) continue;
      const u = await tx.uma<{ sigla: unknown }>('SELECT sigla FROM unidade_federativa WHERE id = ?', [idUf]);
      if (u) siglas.set(idUf, texto(u.sigla));
    }
    const atual = (k: string) => {
      const ct = CONTATO_AREA[k];
      if (ct) return textoN(contatos.get(ct[0])?.[ct[1]]);
      if (k === CAMPO_INSCRICAO) return textoN(pj?.['inscricao_estadual']);
      if (CAMPOS_UF.has(k)) {
        const idUf = nn(f[COLUNA_FONTE[k]!]);
        return idUf === null ? null : (siglas.get(idUf) ?? null);
      }
      // O retorno é o da unidade; nulo usa o da fonte pagadora.
      const v = k === 'retornoDias' ? (fe['dias_retorno'] ?? f['dias_retorno']) : f[COLUNA_FONTE[k]!];
      if (k === 'validaCarteira') return verdadeiro(v) ? 'T' : 'F';
      return v === null || v === undefined ? null : typeof v === 'number' ? v : String(v);
    };
    const mudaram = campos.filter((k) => !mesmoValor(k, atual(k), e.lidos[k]));
    if (mudaram.length) throw erroConflitoVersao(mudaram);
    if (campos.every((k) => mesmoValor(k, atual(k), e.valores[k])))
      throw recusa('sem-efeito', 'Nenhum campo muda de valor.');
    const valores: Record<string, unknown> = {};
    const daUnidade: Record<string, unknown> = {};
    const porArea = new Map<string, Record<string, unknown>>();
    const daPessoa: Record<string, unknown> = {};
    for (const k of campos) {
      const ct = CONTATO_AREA[k];
      if (ct || k === CAMPO_INSCRICAO) {
        const v = valorParaGravar(k, e.valores[k] ?? null);
        const g = v === '' || v === null ? null : String(v);
        if (ct) porArea.set(ct[0], { ...(porArea.get(ct[0]) ?? {}), [ct[1]]: g });
        else daPessoa['inscricao_estadual'] = g;
        continue;
      }
      const v = valorParaGravar(k, e.valores[k] ?? null);
      const gravar =
        k === 'validaCarteira'
          ? v === 'T'
          : k === 'retornoDias' || k === 'prazoPagamentoDias' || k === 'classificacao'
            ? v === ''
              ? null
              : Number(v)
            : v === ''
              ? null
              : v;
      if (k === 'retornoDias') daUnidade['dias_retorno'] = gravar;
      else if (CAMPOS_UF.has(k))
        valores[COLUNA_FONTE[k]!] = gravar === null ? null : await idDaUf(tx, String(gravar), k);
      else valores[COLUNA_FONTE[k]!] = gravar;
    }
    if (Object.keys(valores).length) await tx.alterar('fonte_pagadora', e.convenio, n(f['versao']), valores);
    if (Object.keys(daUnidade).length)
      await tx.alterar('fonte_pagadora_estabelecimento', n(fe['id']), n(fe['versao']), daUnidade);
    if (pj && Object.keys(daPessoa).length)
      await tx.alterar('pessoa_juridica', n(pj['id']), n(pj['versao']), daPessoa);
    // Contato por área: inclui na primeira vez (ou reativa a linha excluída da área); sem nome, telefone nem e-mail,
    // a linha da área sai (o Executor apaga a linha; a trilha guarda a alteração).
    for (const [area, mud] of porArea) {
      const x = contatos.get(area);
      const depois = {
        nome: x ? (x['nome'] ?? null) : null,
        telefone: x ? (x['telefone'] ?? null) : null,
        email: x ? (x['email'] ?? null) : null,
        ...mud,
      };
      const vazio = depois.nome === null && depois.telefone === null && depois.email === null;
      if (x && vazio) await tx.excluir('contato_fonte_pagadora', n(x['id']), n(x['versao']));
      else if (x) await tx.alterar('contato_fonte_pagadora', n(x['id']), n(x['versao']), mud);
      else if (vazio) continue;
      else {
        const ex = excluidos.get(area);
        if (ex)
          await tx.alterar('contato_fonte_pagadora', n(ex['id']), n(ex['versao']), {
            ...depois,
            excluido_em: null,
            excluido_por: null,
          });
        else await tx.incluir('contato_fonte_pagadora', { fonte_pagadora_id: e.convenio, area, ...depois });
      }
    }
    if (campos.includes('nome') || campos.includes('classificacao'))
      await retrato(tx, { ...f, ...valores }, { ...fe, ...daUnidade }, 'alteracao');
    return { convenio: e.convenio, campos: campos.length };
  },
  alvo: (e) => ({ tabela: 'fonte_pagadora', id: e.convenio }),
  trilha: (e) => ({ motivo: e.justificativa, dados: { campos: Object.keys(e.valores).sort() } }),
});

/** A unidade federativa ativa pela sigla (recusa a sigla desconhecida). */
async function idDaUf(tx: TxOperacao, sigla: string, campo: string): Promise<number> {
  const u = await tx.uma<{ id: unknown }>(
    'SELECT id FROM unidade_federativa WHERE sigla = ? AND ativo = TRUE',
    [sigla.trim().toUpperCase()],
  );
  if (!u) throw recusa('uf-invalida', `A UF ${sigla} não está no cadastro.`, { campos: [campo] });
  return n(u.id);
}

async function travarFonte(tx: TxOperacao, id: number): Promise<Linha> {
  const [f] = await tx.consultarParaAtualizar<Linha>(
    'SELECT * FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL',
    [id],
  );
  if (!f)
    throw new ErroOperacao(404, 'registro-inexistente', 'Registro não encontrado', 'O convênio não existe.');
  return f;
}

/** A fonte pagadora e a linha do estabelecimento da sessão, travadas (o convênio precisa estar credenciado nele). */
async function travarNoEstabelecimento(tx: TxOperacao, id: number): Promise<{ f: Linha; fe: Linha }> {
  const f = await travarFonte(tx, id);
  const [fe] = await tx.consultarParaAtualizar<Linha>(
    `SELECT * FROM fonte_pagadora_estabelecimento
      WHERE fonte_pagadora_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, tx.contexto.estabelecimento],
  );
  if (!fe)
    throw new ErroOperacao(
      404,
      'registro-inexistente',
      'Registro não encontrado',
      'O convênio não está credenciado neste estabelecimento.',
    );
  return { f, fe };
}

/** JSON do registro: data em ISO, inteiro grande como número. */
const jsonDoRegistro = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? Number(x) : Buffer.isBuffer(x) ? null : x));

/** Retrato completo do registro depois da operação: a fonte pagadora e a linha do estabelecimento. */
async function retrato(
  tx: TxOperacao,
  f: Linha,
  fe: Linha,
  operacao: 'inclusao' | 'alteracao',
): Promise<void> {
  await tx.incluir('fonte_pagadora_versao', {
    fonte_pagadora_id: n(f['id']),
    operacao,
    ocorrido_em: new Date(),
    usuario_id: tx.contexto.usuario,
    nome: texto(f['nome']),
    classe_fonte_pagadora_id: nn(f['classe_fonte_pagadora_id']),
    dados: jsonDoRegistro({ ...f, estabelecimento: fe }),
  });
}

async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

function localDe(v: unknown, fuso: string): string {
  if (v === null || v === undefined) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  const c = civil(d, fuso);
  return `${c.data} ${c.hora}`;
}

function contextoDe(c: CtxPrecos): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || c.traceId || 'precos').slice(0, 64),
  };
}
