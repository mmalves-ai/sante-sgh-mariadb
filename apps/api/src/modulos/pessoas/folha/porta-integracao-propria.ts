// Porta própria da integração da folha com o financeiro e o contábil, sobre o MariaDB do cliente (pelo @sgh/nucleo).
// Lê do modelo próprio: os credores (empresa_fornecedora), as classificações gerenciais (grupo, subgrupo e natureza
// financeira) e o aviso de títulos manuais (titulo_pagar de outro módulo, do mesmo credor, classificação e período).
// O catálogo de rotinas é fixo do produto (ROTINAS_INTEGRACAO_FOLHA).
// O de-para por vigência é lido e gravado em integracao_folha_financeiro e integracao_folha_financeiro_destino: o credor
// é a empresa_fornecedora, a classificação é a natureza_financeira achada pelos códigos numéricos do grupo, do subgrupo
// e do item, o mês do vencimento é `mesmo` ou `seguinte` e a conta contábil sugerida é a conta analítica ativa do plano
// contábil vigente (pelo código reduzido ou pela classificação).
// O lançamento dos títulos da folha (`financeiro.criarTituloPagar`, ação `incluir-folha`) é uma operação do Executor
// que, na mesma transação, grava cada título a pagar pelo gravador do financeiro (gravadorTituloPagar), o lançamento
// (lancamento_titulos_folha), os títulos da folha (titulo_folha), os fatos contábeis (fato_contabil, evento `folha`,
// com a natureza e a rotina nos campos) e, na origem `interface`, marca o retorno conferido como lançado. Ou tudo, ou
// nada. O retorno conferido é lido do lote recebido (lote_folha_intercambio) somado do resumo por rubrica.
// Melhoria: o credor é o cadastro único de fornecedor (empresa_fornecedora), só os ativos e não excluídos.
// Melhoria: o aviso de títulos manuais ignora títulos cancelados e excluídos, os lançados pela folha e filtra pelo
// estabelecimento da sessão.
// Melhoria: as classificações só trazem naturezas de despesa ativas, com o plano inteiro não excluído.
// Melhoria: o aviso de títulos manuais conta pelo VENCIMENTO de uma parcela viva no mês, e compara os códigos da
// classificação pelo valor numérico (o código '01' casa com 1).
// Pendência registrada: o contrato da classificação é numérico (grupo, subgrupo e item); as naturezas de código não
// numérico ficam fora da escolha do de-para até o contrato passar ao id da natureza (pedido em saida/03-07.json).
// naturezasForaDoContrato conta quantas ficam fora, para o aviso.
import { createHash } from 'node:crypto';
import type {
  ApuracaoFolha,
  ClassificacaoFolha,
  CredorFolha,
  CustoPessoalCentro,
  IncluirTitulosFolhaEntrada,
  IntegracaoFolhaLida,
  OrigemLancamentoFolha,
  RotinaIntegracaoFolha,
  TipoEncargoFolha,
} from '@sgh/contratos';
import {
  DESTINOS_TITULO_FOLHA,
  type DestinoIntegracaoFolha,
  type DestinoTituloFolha,
  esquemaIncluirTitulosFolha,
  ROTINA_DO_DESTINO,
} from '@sgh/contratos';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { gravacaoDireta } from '../../enfermagem/gravacao-direta.js';
import type { GravacaoFeita, LiberacaoGravacao, TrilhaDaGravacao } from '../../exames/public-api.js';
import { gravadorTituloPagar, TABELAS_TITULO_PAGAR } from '../../financeiro/public-api.js';
import { exigirUsuario } from '../../qualidade/apoio-propria.js';
import type {
  ContextoIntegracaoFolha,
  FiltroTitulosManuais,
  GravadorIntegracaoFolha,
  PortaIntegracaoFolha,
} from './porta-integracao.js';
import {
  type LancamentoTitulosFolha,
  ROTINAS_INTEGRACAO_FOLHA,
  type TituloFolhaLancado,
} from './apoio-folha.js';
import { type RetornoParaTitulos } from './tipos-folha.js';
import { OPERACAO_TITULOS_FOLHA } from './servico-integracao.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoIntegracaoFolha = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** Quantos credores a busca devolve. */
export const TETO_CREDORES_FOLHA = 50;

/** As tabelas que a gravação do de-para escreve (a transação recusa as outras). */
export const TABELAS_INTEGRACAO_FOLHA = [
  'integracao_folha_financeiro',
  'integracao_folha_financeiro_destino',
] as const;

/** As tabelas do lançamento dos títulos da folha (as do título a pagar do financeiro e as da folha). */
export const TABELAS_LANCAMENTO_FOLHA: readonly string[] = [
  ...TABELAS_TITULO_PAGAR,
  'lancamento_titulos_folha',
  'titulo_folha',
  'fato_contabil',
  'evento_contabil',
  'lote_folha_intercambio',
];

/** O destino do contrato (`liquido-mensal`) no banco (`liquido_mensal`) e de volta. */
const destinoNoBanco = (d: DestinoTituloFolha): string => d.replace(/-/g, '_');
const destinoDoBanco = (v: unknown): DestinoTituloFolha | null => {
  const d = texto(v).replace(/_/g, '-');
  return (DESTINOS_TITULO_FOLHA as readonly string[]).includes(d) ? (d as DestinoTituloFolha) : null;
};
const doisDigitos = (x: number) => String(x).padStart(2, '0');
const dia = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${doisDigitos(v.getMonth() + 1)}-${doisDigitos(v.getDate())}`
    : texto(v).slice(0, 10);
const instante = (v: unknown): string => (v instanceof Date ? v.toISOString() : texto(v));

const SQL_INTEGRACOES = `
  SELECT i.id, i.vigencia_inicio, i.criado_em, u.login,
         d.destino, d.empresa_fornecedora_id, d.dia_vencimento, d.mes_vencimento, cc.codigo_reduzido AS conta,
         g.codigo AS grupo, s.codigo AS subgrupo, n.codigo AS item
    FROM integracao_folha_financeiro i
    JOIN integracao_folha_financeiro_destino d ON d.integracao_folha_financeiro_id = i.id
    JOIN natureza_financeira n ON n.id = d.natureza_financeira_id
    JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
    JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id
    LEFT JOIN conta_contabil cc ON cc.id = d.conta_contabil_id
    LEFT JOIN usuario u ON u.id = i.criado_por
   WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL
   ORDER BY i.vigencia_inicio DESC, i.id DESC, d.id`;

/** As vigências do de-para do estabelecimento (a mais recente primeiro), com os destinos na ordem gravada. */
async function lerIntegracoes(l: Pick<Leitor, 'consultar'>, est: number): Promise<IntegracaoFolhaLida[]> {
  const porId = new Map<
    number,
    IntegracaoFolhaLida & { destinos: (DestinoIntegracaoFolha & { rotina: number })[] }
  >();
  for (const r of await l.consultar(SQL_INTEGRACOES, [est])) {
    const id = numero(r['id']);
    let v = porId.get(id);
    if (!v) {
      v = {
        id,
        empresa: est,
        inicio: dia(r['vigencia_inicio']),
        destinos: [],
        criadoPor: texto(r['login']),
        criadoEm: instante(r['criado_em']),
      };
      porId.set(id, v);
    }
    const destino = destinoDoBanco(r['destino']);
    // O CHECK do banco aceita `outro`, que o contrato não tem: esse destino não entra no de-para da tela.
    if (destino === null) continue;
    v.destinos.push({
      destino,
      rotina: ROTINA_DO_DESTINO[destino],
      credor: numero(r['empresa_fornecedora_id']),
      classificacao: { grupo: numero(r['grupo']), subgrupo: numero(r['subgrupo']), item: numero(r['item']) },
      diaVencimento: numero(r['dia_vencimento']),
      mesesDepois: r['mes_vencimento'] === 'mesmo' ? 0 : 1,
      contaContabil: texto(r['conta']),
    });
  }
  return [...porId.values()];
}

/** A natureza de despesa ativa pelos códigos numéricos do grupo, do subgrupo e do item (a classificação do contrato). */
async function naturezaDaClassificacao(
  tx: TxOperacao,
  c: DestinoIntegracaoFolha['classificacao'],
): Promise<number> {
  const rs = await tx.consultar(
    `SELECT n.id
       FROM natureza_financeira n
       JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
       JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id
      WHERE n.excluido_em IS NULL AND s.excluido_em IS NULL AND g.excluido_em IS NULL
        AND n.ativo = TRUE AND n.tipo = 'despesa'
        AND g.codigo REGEXP '^[0-9]{1,5}$' AND s.codigo REGEXP '^[0-9]{1,5}$' AND n.codigo REGEXP '^[0-9]{1,5}$'
        AND CAST(g.codigo AS UNSIGNED) = ? AND CAST(s.codigo AS UNSIGNED) = ? AND CAST(n.codigo AS UNSIGNED) = ?`,
    [c.grupo, c.subgrupo, c.item],
  );
  if (rs.length !== 1)
    throw recusa(
      rs.length === 0 ? 'classificacao-inexistente' : 'classificacao-ambigua',
      rs.length === 0
        ? `A classificação ${c.grupo}.${c.subgrupo}.${c.item} não é uma natureza de despesa ativa.`
        : `A classificação ${c.grupo}.${c.subgrupo}.${c.item} casa com mais de uma natureza de despesa: corrija os códigos no plano.`,
    );
  return numero(rs[0]!['id']);
}

/**
 * A conta contábil sugerida do destino: conta analítica ativa do plano contábil vigente no início do de-para, pelo
 * código reduzido ou pela classificação. Vazio: sem sugestão.
 */
async function contaContabilSugerida(tx: TxOperacao, codigo: string, inicio: string): Promise<number | null> {
  const c = codigo.trim();
  if (c === '') return null;
  const rs = await tx.consultar(
    `SELECT cc.id
       FROM conta_contabil cc
       JOIN plano_contas p ON p.id = cc.plano_contas_id
      WHERE p.tipo = 'contabil' AND p.ativo = TRUE AND p.excluido_em IS NULL
        AND p.vigencia_inicio <= ? AND (p.vigencia_fim IS NULL OR p.vigencia_fim >= ?)
        AND cc.excluido_em IS NULL AND cc.ativo = TRUE AND cc.tipo = 'analitica'
        AND (cc.codigo_reduzido = ? OR cc.classificacao = ?)`,
    [inicio, inicio, c, c],
  );
  if (rs.length !== 1)
    throw recusa(
      rs.length === 0 ? 'conta-contabil-inexistente' : 'conta-contabil-ambigua',
      rs.length === 0
        ? `A conta contábil ${c} não é uma conta analítica ativa do plano contábil vigente.`
        : `A conta contábil ${c} casa com mais de uma conta do plano vigente: use a classificação completa.`,
    );
  return numero(rs[0]!['id']);
}

function gravadorIntegracao(tx: TxOperacao, est: number): GravadorIntegracaoFolha {
  return {
    integracoes: async (empresa) => (empresa === est ? lerIntegracoes(tx, est) : []),
    async incluirIntegracao(x) {
      if (x.empresa !== est)
        throw recusa('empresa-fora-da-sessao', 'A empresa do de-para é o estabelecimento da sessão.');
      const repetida = await tx.consultarParaAtualizar(
        'SELECT id FROM integracao_folha_financeiro WHERE estabelecimento_id = ? AND vigencia_inicio = ? AND excluido_em IS NULL',
        [est, x.inicio],
      );
      if (repetida.length > 0)
        throw recusa(
          'vigencia-repetida',
          'Já existe um de-para com este início para a empresa: escolha outra data.',
        );
      for (const d of x.destinos) {
        const credor = await tx.uma(
          "SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL AND situacao = 'ativo'",
          [d.credor],
        );
        if (!credor) throw recusa('credor-inexistente', `O credor ${d.credor} não é um fornecedor ativo.`);
      }
      await exigirUsuario(tx, x.por);
      const id = await tx.incluir('integracao_folha_financeiro', {
        estabelecimento_id: est,
        vigencia_inicio: x.inicio,
      });
      for (const d of x.destinos)
        await tx.incluir('integracao_folha_financeiro_destino', {
          integracao_folha_financeiro_id: id,
          destino: destinoNoBanco(d.destino),
          empresa_fornecedora_id: d.credor,
          natureza_financeira_id: await naturezaDaClassificacao(tx, d.classificacao),
          conta_contabil_id: await contaContabilSugerida(tx, d.contaContabil, x.inicio),
          dia_vencimento: d.diaVencimento,
          mes_vencimento: d.mesesDepois === 0 ? 'mesmo' : 'seguinte',
        });
      return id;
    },
  };
}

const numero = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
/** Reais do banco (DECIMAL) em centavos inteiros do contrato, e de volta. */
const centavos = (v: unknown): number => Math.round(numero(v) * 100);
const reais = (c: number): number => Math.round(c) / 100;
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

/** O período do lançamento (AAAA-MM na apuração mensal, AAAA na anual), da competência da folha. */
const periodoDe = (r: Record<string, unknown>): string =>
  r['apuracao'] === 'anual'
    ? String(numero(r['ano']))
    : `${numero(r['ano'])}-${doisDigitos(numero(r['mes']))}`;

const SQL_LANCAMENTOS = `
  SELECT l.id, l.estabelecimento_id, l.origem_lancamento, l.origem_id, lf.numero AS numero_lote, l.apuracao, l.resumo,
         l.total_liquido, l.total_encargos, l.lancado_em, u.login, cf.ano, cf.mes,
         (SELECT COUNT(*) FROM titulo_folha t WHERE t.lancamento_titulos_folha_id = l.id AND t.excluido_em IS NULL) AS titulos,
         (SELECT COUNT(*) FROM fato_contabil f
           WHERE f.entidade_origem = 'lancamento_titulos_folha' AND f.entidade_origem_id = l.id) AS fatos
    FROM lancamento_titulos_folha l
    JOIN competencia_folha cf ON cf.id = l.competencia_folha_id
    LEFT JOIN lote_folha_intercambio lf ON l.origem_lancamento = 'interface' AND lf.id = l.origem_id
    LEFT JOIN usuario u ON u.id = l.lancado_por_usuario_id
   WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL`;

function lancamentoDe(r: Record<string, unknown>): LancamentoTitulosFolha {
  const origem: OrigemLancamentoFolha = r['origem_lancamento'] === 'interface' ? 'interface' : 'fechamento';
  const liquido = centavos(r['total_liquido']);
  const encargos = centavos(r['total_encargos']);
  return {
    id: numero(r['id']),
    empresa: numero(r['estabelecimento_id']),
    origem,
    // A origem `interface` é o lote recebido, que o contrato conhece pelo número de negócio.
    idOrigem: origem === 'interface' ? numero(r['numero_lote']) : numero(r['origem_id']),
    apuracao: r['apuracao'] === 'anual' ? 'anual' : 'mensal',
    periodo: periodoDe(r),
    resumo: texto(r['resumo']),
    titulos: numero(r['titulos']),
    fatos: numero(r['fatos']),
    liquido,
    encargos,
    total: liquido + encargos,
    lancadoPor: texto(r['login']),
    lancadoEm: instante(r['lancado_em']),
  };
}

/** Filtro do período (AAAA-MM ou AAAA) e da apuração sobre a competência da folha do lançamento. */
function filtroPeriodo(apuracao: ApuracaoFolha | null, periodo: string): { sql: string; p: unknown[] } {
  const ano = Number(periodo.slice(0, 4));
  const mes = periodo.length >= 7 ? Number(periodo.slice(5, 7)) : null;
  const ap = apuracao ?? (mes === null ? 'anual' : 'mensal');
  return ap === 'anual'
    ? { sql: " AND l.apuracao = 'anual' AND cf.ano = ?", p: [ano] }
    : { sql: " AND COALESCE(l.apuracao, 'mensal') = 'mensal' AND cf.ano = ? AND cf.mes = ?", p: [ano, mes] };
}

/** O evento contábil da folha (catálogo da rede): o nativo é criado no primeiro lançamento, como faz o contábil. */
async function eventoDaFolha(tx: TxOperacao): Promise<number> {
  const e = await tx.uma('SELECT id FROM evento_contabil WHERE codigo = ?', ['folha']);
  if (e) return numero(e['id']);
  return tx.incluir('evento_contabil', {
    codigo: 'folha',
    descricao: 'Folha e encargos',
    modulo: 'folha',
    nativo: true,
  });
}

/** A competência da folha do estabelecimento do período (a anual cai na competência de dezembro). */
async function competenciaDoPeriodo(tx: TxOperacao, est: number, periodo: string): Promise<number> {
  const ano = Number(periodo.slice(0, 4));
  const mes = periodo.length >= 7 ? Number(periodo.slice(5, 7)) : 12;
  const rs = await tx.consultar(
    `SELECT id FROM competencia_folha
      WHERE estabelecimento_id = ? AND ano = ? AND mes = ? AND excluido_em IS NULL
      ORDER BY numero_folha, id LIMIT 1`,
    [est, ano, mes],
  );
  if (!rs[0])
    throw recusa(
      'competencia-folha-inexistente',
      `O estabelecimento não tem a competência da folha de ${periodo}: abra a competência antes de lançar.`,
    );
  return numero(rs[0]['id']);
}

/** Lança os títulos da folha: título a pagar, lançamento, títulos da folha, fatos e a marca do retorno; tudo ou nada. */
async function lancarTitulos(
  tx: TxOperacao,
  e: IncluirTitulosFolhaEntrada,
  ctx: ContextoOperacao,
): Promise<ResultadoOperacao> {
  const est = ctx.estabelecimento;
  if (est === null || e.empresa !== est)
    throw recusa('empresa-fora-da-sessao', 'A empresa da folha é o estabelecimento da sessão.');
  if (ctx.usuario === null) throw recusa('sem-usuario', 'O lançamento exige o usuário da sessão.');
  const total = e.titulos.reduce((a, t) => a + t.valor, 0);
  if (total !== e.liquido + e.encargos)
    throw recusa('soma-divergente', 'A soma dos títulos não fecha com o líquido mais os encargos da folha.');

  let origemId = e.idOrigem;
  let competencia: number;
  if (e.origem === 'interface') {
    const [lote] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, sentido, competencia_folha_id, competencia FROM lote_folha_intercambio
        WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL`,
      [est, e.idOrigem],
    );
    if (!lote || lote['sentido'] !== 'recebido' || lote['situacao'] !== 'conferido')
      throw recusa(
        'registro-alterado',
        'O registro mudou agora há pouco (outra pessoa ou outra aba): releia.',
      );
    origemId = numero(lote['id']);
    competencia =
      lote['competencia_folha_id'] !== null && lote['competencia_folha_id'] !== undefined
        ? numero(lote['competencia_folha_id'])
        : await competenciaDoPeriodo(tx, est, e.periodo);
    await tx.alterar('lote_folha_intercambio', origemId, numero(lote['versao']), { situacao: 'lancado' });
  } else {
    const f = await tx.uma(
      'SELECT id FROM fechamento_periodo_folha WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.idOrigem, est],
    );
    if (!f)
      throw recusa(
        'registro-alterado',
        'O registro mudou agora há pouco (outra pessoa ou outra aba): releia.',
      );
    competencia = await competenciaDoPeriodo(tx, est, e.periodo);
  }

  const repetido = await tx.consultarParaAtualizar(
    `SELECT id FROM lancamento_titulos_folha
      WHERE estabelecimento_id = ? AND origem_lancamento = ? AND origem_id = ? AND excluido_em IS NULL`,
    [est, e.origem, origemId],
  );
  const filtro = filtroPeriodo(e.apuracao, e.periodo);
  const chaves = new Set(
    (
      await tx.consultar(
        `SELECT t.destino, t.vencimento FROM titulo_folha t
           JOIN lancamento_titulos_folha l ON l.id = t.lancamento_titulos_folha_id
           JOIN competencia_folha cf ON cf.id = l.competencia_folha_id
          WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND t.excluido_em IS NULL${filtro.sql}`,
        [est, ...filtro.p],
      )
    ).map((r) => `${destinoDoBanco(r['destino']) ?? texto(r['destino'])}:${dia(r['vencimento'])}`),
  );
  if (repetido.length > 0 || e.titulos.some((t) => chaves.has(`${t.destino}:${t.vencimento}`)))
    throw recusa('folha-repetida', 'A competência já tem os títulos da folha lançados no contas a pagar.');

  const lancamento = await tx.incluir('lancamento_titulos_folha', {
    estabelecimento_id: est,
    competencia_folha_id: competencia,
    origem_lancamento: e.origem,
    origem_id: origemId,
    apuracao: e.apuracao,
    resumo: e.resumo,
    total_liquido: reais(e.liquido),
    total_encargos: reais(e.encargos),
    lancado_em: new Date(),
    lancado_por_usuario_id: ctx.usuario,
  });

  const financeiro = gravadorTituloPagar(tx);
  const parcelas: number[] = [];
  for (const t of e.titulos) {
    const liquido = t.destino.startsWith('liquido');
    const r = await financeiro.incluir({
      tipo: 'F',
      credor: t.credor,
      documento: t.documento,
      serie: liquido ? 'DP' : 'IMP',
      emissao: e.emissao,
      valorDocumento: reais(t.valor),
      referente: t.referente,
      parcelas: [{ parcela: 1, vencimento: t.vencimento, valor: reais(t.valor) }],
      classificacao: t.classificacao,
    });
    parcelas.push(...r.parcelas);
    await tx.incluir('titulo_folha', {
      competencia_folha_id: competencia,
      lancamento_titulos_folha_id: lancamento,
      titulo_pagar_id: r.tituloPagar,
      destino: destinoNoBanco(t.destino),
      empresa_fornecedora_id: t.credor,
      valor: reais(t.valor),
      vencimento: t.vencimento,
      chave_planejamento: t.chave,
    });
  }

  if (e.fatos.length > 0) {
    const evento = await eventoDaFolha(tx);
    const competenciaContabil = `${e.emissao.slice(0, 7)}-01`;
    for (const [i, f] of e.fatos.entries()) {
      const campos = { natureza: f.natureza, rotina: f.rotina, sequencia: i + 1 };
      const valor = reais(f.valor);
      const centro = f.centroCusto > 0 ? f.centroCusto : null;
      await tx.incluir('fato_contabil', {
        estabelecimento_id: est,
        evento_contabil_id: evento,
        entidade_origem: 'lancamento_titulos_folha',
        entidade_origem_id: lancamento,
        data_fato: e.emissao,
        competencia: competenciaContabil,
        valor,
        centro_custo_id: centro,
        campos: JSON.stringify(campos),
        impressao: sha256(JSON.stringify({ tipo: 'folha', valor, data: e.emissao, centro, campos })),
        situacao: f.contabiliza ? 'pendente' : 'ignorado',
      });
    }
  }
  return {
    acao: 'incluir-folha',
    lancamento,
    titulo: parcelas[0] ?? 0,
    parcelas: parcelas.length,
    documento: e.titulos[0]?.documento ?? 0,
    credor: e.titulos[0]?.credor ?? 0,
    tipo: 'F',
    serie: '',
    ids: parcelas.join(','),
  };
}

const lancarTitulosFolha = definirOperacao<IncluirTitulosFolhaEntrada, ResultadoOperacao>({
  nome: 'pessoas.integracao_folha.lancar_titulos',
  tabelas: TABELAS_LANCAMENTO_FOLHA,
  entrada: esquemaIncluirTitulosFolha as never,
  gravar: lancarTitulos,
  alvo: (_e, r) => ({ tabela: 'lancamento_titulos_folha', id: numero(r['lancamento']) || null }),
  eventos: (_e, r) => [
    {
      tipo: 'financeiro.titulo_pagar.lancado',
      carga: { titulo: numero(r['titulo']), parcelas: numero(r['parcelas']) },
    },
  ],
});

export class PortaIntegracaoFolhaPropria implements PortaIntegracaoFolha {
  readonly destino = 'banco' as const;

  private executor: Executor | null = null;

  constructor(private readonly nucleo: NucleoIntegracaoFolha) {}

  private ler<T>(c: ContextoIntegracaoFolha, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(c, (l) => fn(l, est));
  }

  // ── Gravação: o de-para grava; o lançamento dos títulos recusa com o motivo ────────────────────────────────────

  async podeGravar(c?: ContextoIntegracaoFolha, operacao?: string): Promise<LiberacaoGravacao> {
    void c;
    void operacao;
    return { pode: true, codigo: null, motivo: null };
  }

  /** Lança os títulos da folha (`financeiro.criarTituloPagar`, ação `incluir-folha`) numa operação do executor. */
  async executar(
    c: ContextoIntegracaoFolha,
    op: string,
    entrada: unknown,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita> {
    if (op !== OPERACAO_TITULOS_FOLHA)
      throw recusa('operacao-desconhecida', 'A integração da folha só lança os títulos da folha.');
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    this.executor ??= this.nucleo.criarExecutor();
    const r = await this.executor.executar(lancarTitulosFolha, c.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  /** Grava a vigência do de-para numa operação do executor, com a trilha e a releitura na mesma transação. */
  gravarSgh<T>(
    c: ContextoIntegracaoFolha,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorIntegracaoFolha) => Promise<T>,
  ): Promise<T> {
    if (c.estabelecimento === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    this.executor ??= this.nucleo.criarExecutor();
    return gravacaoDireta(this.executor, c, {
      nome: 'pessoas.integracao_folha.gravar',
      tabelas: TABELAS_INTEGRACAO_FOLHA,
      trilha,
      gravador: (tx, est) => gravadorIntegracao(tx, est),
      fn,
    });
  }

  /** As vigências do de-para da empresa (o estabelecimento da sessão), a mais recente primeiro. */
  integracoes(c: ContextoIntegracaoFolha, empresa: number): Promise<IntegracaoFolhaLida[]> {
    return this.ler(c, async (l, est) => (empresa === est ? lerIntegracoes(l, est) : []));
  }

  // ── Leituras com modelo ─────────────────────────────────────────────────────────────────────────────────────

  async rotinas(): Promise<RotinaIntegracaoFolha[]> {
    return [...ROTINAS_INTEGRACAO_FOLHA];
  }

  /** Plano gerencial: cadastro da rede inteira (sem estabelecimento). Só códigos numéricos (o contrato é numérico). */
  classificacoes(c: ContextoIntegracaoFolha): Promise<ClassificacaoFolha[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT g.codigo AS grupo, s.codigo AS subgrupo, n.codigo AS item, n.descricao AS nome
           FROM natureza_financeira n
           JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
           JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id
          WHERE n.excluido_em IS NULL AND s.excluido_em IS NULL AND g.excluido_em IS NULL
            AND n.ativo = TRUE AND n.tipo = 'despesa'
            AND g.codigo REGEXP '^[0-9]{1,5}$' AND s.codigo REGEXP '^[0-9]{1,5}$' AND n.codigo REGEXP '^[0-9]{1,5}$'
          ORDER BY CAST(g.codigo AS UNSIGNED), CAST(s.codigo AS UNSIGNED), CAST(n.codigo AS UNSIGNED)`,
      );
      return linhas.map((r) => ({
        grupo: numero(r['grupo']),
        subgrupo: numero(r['subgrupo']),
        item: numero(r['item']),
        nome: texto(r['nome']),
      }));
    });
  }

  /** Fornecedor: cadastro da rede inteira (sem estabelecimento). Busca por código exato ou parte do nome (>= 2). */
  credores(
    c: ContextoIntegracaoFolha,
    f: { readonly termo?: string; readonly codigos?: readonly number[] },
  ): Promise<CredorFolha[]> {
    const codigos = (f.codigos ?? []).filter((x) => Number.isSafeInteger(x) && x > 0);
    const termo = (f.termo ?? '').trim();
    if (!codigos.length && termo.length < 2) return Promise.resolve([]);
    return this.ler(c, async (l) => {
      const filtro = codigos.length
        ? { sql: `id IN (${codigos.map(() => '?').join(', ')})`, p: codigos as readonly unknown[] }
        : {
            sql: '(id = ? OR razao_social LIKE ?)',
            p: [/^\d+$/.test(termo) ? Number(termo) : 0, `%${termo}%`],
          };
      const linhas = await l.consultar(
        `SELECT id, razao_social FROM empresa_fornecedora
          WHERE excluido_em IS NULL AND situacao = 'ativo' AND ${filtro.sql}
          ORDER BY razao_social, id LIMIT ${TETO_CREDORES_FOLHA}`,
        filtro.p,
      );
      return linhas.map((r) => ({ codigo: numero(r['id']), nome: texto(r['razao_social']) }));
    });
  }

  /**
   * Títulos lançados à mão (fora da folha) para o credor e a classificação no período: o aviso da prévia. A empresa do
   * filtro é o estabelecimento da sessão.
   */
  titulosManuais(c: ContextoIntegracaoFolha, f: FiltroTitulosManuais): Promise<number> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT COUNT(*) AS n
           FROM titulo_pagar t
           JOIN natureza_financeira n ON n.id = t.natureza_financeira_id
           JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
           JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
            AND t.modulo_origem <> 'folha' AND t.empresa_fornecedora_id = ?
            AND NOT EXISTS (SELECT 1 FROM titulo_folha tf WHERE tf.titulo_pagar_id = t.id)
            AND g.codigo REGEXP '^[0-9]{1,5}$' AND s.codigo REGEXP '^[0-9]{1,5}$' AND n.codigo REGEXP '^[0-9]{1,5}$'
            AND CAST(g.codigo AS UNSIGNED) = ? AND CAST(s.codigo AS UNSIGNED) = ? AND CAST(n.codigo AS UNSIGNED) = ?
            AND EXISTS (SELECT 1 FROM parcela_pagar p
                         WHERE p.titulo_pagar_id = t.id AND p.excluido_em IS NULL
                           AND p.situacao NOT IN ('cancelada','renegociada')
                           AND p.vencimento BETWEEN ? AND ?)`,
        [est, f.credor, f.grupo, f.subgrupo, f.item, f.de, f.ate],
      );
      return numero(r?.['n']);
    });
  }

  /**
   * Quantas naturezas de despesa ativas ficam fora da escolha do de-para por terem código não numérico (o contrato da
   * classificação é numérico): o número do aviso, nunca um sumiço silencioso.
   */
  naturezasForaDoContrato(c: ContextoIntegracaoFolha): Promise<number> {
    return this.ler(c, async (l) => {
      const r = await l.uma(
        `SELECT COUNT(*) AS n
           FROM natureza_financeira n
           JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
           JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id
          WHERE n.excluido_em IS NULL AND s.excluido_em IS NULL AND g.excluido_em IS NULL
            AND n.ativo = TRUE AND n.tipo = 'despesa'
            AND NOT (g.codigo REGEXP '^[0-9]{1,5}$' AND s.codigo REGEXP '^[0-9]{1,5}$' AND n.codigo REGEXP '^[0-9]{1,5}$')`,
      );
      return numero(r?.['n']);
    });
  }

  // ── Retorno conferido e lançamentos ──────────────────────────────────────────────────────────────────────────

  /** O lote recebido (pelo número) somado do resumo por rubrica, centro e vencimento, como os títulos o usam. */
  retorno(c: ContextoIntegracaoFolha, id: number): Promise<RetornoParaTitulos | null> {
    return this.ler(c, async (l, est) => {
      const lote = await l.uma(
        `SELECT id, numero, estabelecimento_id, competencia, sentido, situacao FROM lote_folha_intercambio
          WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL`,
        [est, id],
      );
      if (!lote) return null;
      const linhas = await l.consultar(
        `SELECT rubrica, centro_custo_id, vencimento, SUM(valor) AS valor
           FROM lote_folha_intercambio_resumo
          WHERE lote_folha_intercambio_id = ? AND excluido_em IS NULL
          GROUP BY rubrica, centro_custo_id, vencimento
          ORDER BY rubrica, centro_custo_id, vencimento`,
        [numero(lote['id'])],
      );
      let liquido = 0;
      let vencimentoLiquido: string | null = null;
      const encargos: { tipo: TipoEncargoFolha; valor: number; vencimento: string | null }[] = [];
      const proventos: { centroCusto: number | null; proventos: number }[] = [];
      for (const r of linhas) {
        const rubrica = texto(r['rubrica']);
        const valor = centavos(r['valor']);
        const venc = r['vencimento'] === null || r['vencimento'] === undefined ? null : dia(r['vencimento']);
        const centro = r['centro_custo_id'] === null ? null : numero(r['centro_custo_id']);
        if (rubrica === 'liquido') {
          liquido += valor;
          if (venc && (!vencimentoLiquido || venc < vencimentoLiquido)) vencimentoLiquido = venc;
        } else if (rubrica === 'proventos') proventos.push({ centroCusto: centro, proventos: valor });
        else if (rubrica !== 'descontos')
          encargos.push({ tipo: rubrica as TipoEncargoFolha, valor, vencimento: venc });
      }
      return {
        id,
        empresa: est,
        competencia: dia(lote['competencia']).slice(0, 7),
        sentido: lote['sentido'] === 'recebido' ? 'recebido' : 'exportado',
        situacao: texto(lote['situacao']),
        liquido,
        vencimentoLiquido,
        encargos,
        proventos,
      };
    });
  }

  lancamentos(c: ContextoIntegracaoFolha, empresa: number, ano: number): Promise<LancamentoTitulosFolha[]> {
    return this.ler(c, async (l, est) =>
      empresa !== est
        ? []
        : (await l.consultar(`${SQL_LANCAMENTOS} AND cf.ano = ? ORDER BY l.id DESC`, [est, ano])).map(
            lancamentoDe,
          ),
    );
  }

  lancamento(c: ContextoIntegracaoFolha, id: number): Promise<LancamentoTitulosFolha | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_LANCAMENTOS} AND l.id = ?`, [est, id]);
      return r ? lancamentoDe(r) : null;
    });
  }

  lancamentoDaOrigem(
    c: ContextoIntegracaoFolha,
    origem: OrigemLancamentoFolha,
    id: number,
  ): Promise<LancamentoTitulosFolha | null> {
    return this.ler(c, async (l, est) => {
      const r =
        origem === 'interface'
          ? await l.uma(`${SQL_LANCAMENTOS} AND l.origem_lancamento = 'interface' AND lf.numero = ?`, [
              est,
              id,
            ])
          : await l.uma(`${SQL_LANCAMENTOS} AND l.origem_lancamento = 'fechamento' AND l.origem_id = ?`, [
              est,
              id,
            ]);
      return r ? lancamentoDe(r) : null;
    });
  }

  titulosDoLancamento(c: ContextoIntegracaoFolha, lancamento: number): Promise<TituloFolhaLancado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT t.destino, t.empresa_fornecedora_id, t.valor, t.vencimento, tp.numero_documento,
                  (SELECT MIN(p.id) FROM parcela_pagar p WHERE p.titulo_pagar_id = tp.id AND p.excluido_em IS NULL) AS parcela,
                  NOT EXISTS (SELECT 1 FROM parcela_pagar p
                               WHERE p.titulo_pagar_id = tp.id AND p.excluido_em IS NULL AND p.situacao <> 'paga') AS pago
             FROM titulo_folha t
             JOIN lancamento_titulos_folha lt ON lt.id = t.lancamento_titulos_folha_id
             JOIN titulo_pagar tp ON tp.id = t.titulo_pagar_id
            WHERE lt.estabelecimento_id = ? AND lt.id = ? AND t.excluido_em IS NULL
            ORDER BY t.id`,
          [est, lancamento],
        )
      ).flatMap((r) => {
        const destino = destinoDoBanco(r['destino']);
        if (destino === null) return [];
        return [
          {
            destino,
            rotina: ROTINA_DO_DESTINO[destino],
            titulo: numero(r['parcela']),
            credor: numero(r['empresa_fornecedora_id']),
            documento: numero(r['numero_documento']),
            vencimento: dia(r['vencimento']),
            valor: centavos(r['valor']),
            pago: Boolean(numero(r['pago'])),
          },
        ];
      }),
    );
  }

  chavesLancadas(
    c: ContextoIntegracaoFolha,
    empresa: number,
    apuracao: ApuracaoFolha,
    periodo: string,
  ): Promise<string[]> {
    return this.ler(c, async (l, est) => {
      if (empresa !== est) return [];
      const f = filtroPeriodo(apuracao, periodo);
      return (
        await l.consultar(
          `SELECT t.destino, t.vencimento FROM titulo_folha t
             JOIN lancamento_titulos_folha l ON l.id = t.lancamento_titulos_folha_id
             JOIN competencia_folha cf ON cf.id = l.competencia_folha_id
            WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND t.excluido_em IS NULL${f.sql}
            ORDER BY t.id`,
          [est, ...f.p],
        )
      ).map((r) => `${destinoDoBanco(r['destino']) ?? texto(r['destino'])}:${dia(r['vencimento'])}`);
    });
  }

  /** O custo de pessoal por centro do período: os fatos da folha (provento ou encargo) dos lançamentos do período. */
  custoPessoal(
    c: ContextoIntegracaoFolha,
    empresa: number,
    periodo: string,
  ): Promise<{ centros: CustoPessoalCentro[]; lancamentos: number }> {
    return this.ler(c, async (l, est) => {
      if (empresa !== est) return { centros: [], lancamentos: 0 };
      const f = filtroPeriodo(null, periodo);
      const fatos = await l.consultar(
        `SELECT COALESCE(fc.centro_custo_id, 0) AS centro, JSON_VALUE(fc.campos, '$.natureza') AS natureza,
                SUM(fc.valor) AS valor
           FROM fato_contabil fc
           JOIN lancamento_titulos_folha l ON l.id = fc.entidade_origem_id
           JOIN competencia_folha cf ON cf.id = l.competencia_folha_id
          WHERE fc.entidade_origem = 'lancamento_titulos_folha' AND fc.estabelecimento_id = ? AND fc.estorno = FALSE
            AND l.estabelecimento_id = ? AND l.excluido_em IS NULL${f.sql}
          GROUP BY COALESCE(fc.centro_custo_id, 0), JSON_VALUE(fc.campos, '$.natureza')
          ORDER BY centro`,
        [est, est, ...f.p],
      );
      const acc = new Map<number, { proventos: number; encargos: number }>();
      for (const r of fatos) {
        const k = numero(r['centro']);
        const a = acc.get(k) ?? { proventos: 0, encargos: 0 };
        if (r['natureza'] === 'provento') a.proventos += centavos(r['valor']);
        else a.encargos += centavos(r['valor']);
        acc.set(k, a);
      }
      const n = await l.uma(
        `SELECT COUNT(*) AS n FROM lancamento_titulos_folha l
           JOIN competencia_folha cf ON cf.id = l.competencia_folha_id
          WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL${f.sql}`,
        [est, ...f.p],
      );
      return {
        centros: [...acc.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([centroCusto, a]) => ({ centroCusto, ...a, total: a.proventos + a.encargos })),
        lancamentos: numero(n?.['n']),
      };
    });
  }
}
