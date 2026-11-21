// Porta própria da integração da folha com o financeiro e o contábil, sobre o MariaDB do cliente (pelo @sgh/nucleo).
// Lê do modelo próprio: os credores (empresa_fornecedora), as classificações gerenciais (grupo, subgrupo e natureza
// financeira) e o aviso de títulos manuais (titulo_pagar de outro módulo, do mesmo credor, classificação e período).
// O catálogo de rotinas é fixo do produto (ROTINAS_INTEGRACAO_FOLHA).
// O de-para por vigência é lido e gravado em integracao_folha_financeiro e integracao_folha_financeiro_destino: o credor
// é a empresa_fornecedora, a classificação é a natureza_financeira achada pelos códigos numéricos do grupo, do subgrupo
// e do item, e o mês do vencimento é `mesmo` ou `seguinte`.
// O que ainda não está ligado NÃO devolve vazio: recusa com 503 `modelo-pendente`, dizendo a operação, e a liberação da
// operação do lançamento responde "não pode" com o mesmo motivo. O que falta:
//   - o lançamento dos títulos da folha (executar `financeiro.criarTituloPagar`, que grava o título a pagar pela operação
//     do financeiro na mesma transação; lancamentos, lancamento, lancamentoDaOrigem, titulosDoLancamento,
//     chavesLancadas leem o que ele grava): pedido de composição em docs/obra/fatias/f24/saida/03-pessoas.json;
//   - a conta contábil sugerida do destino (o de-para não tem a coluna; pedido de DDL no mesmo arquivo);
//   - o custo de pessoal por centro (custoPessoal);
//   - o retorno conferido da folha externa somado por destino (retorno; falta o papel de resumo da rubrica).
// Melhoria: o credor é o cadastro único de fornecedor (empresa_fornecedora), só os ativos e não excluídos.
// Melhoria: o aviso de títulos manuais ignora títulos cancelados e excluídos e filtra pelo estabelecimento da sessão.
// Melhoria: as classificações só trazem naturezas de despesa ativas, com o plano inteiro não excluído.
// Melhoria: o aviso de títulos manuais conta pelo VENCIMENTO de uma parcela viva no mês (a regra do sistema de origem),
// e compara os códigos da classificação pelo valor numérico (o código '01' casa com 1).
// Pendência registrada: o contrato da classificação é numérico (grupo, subgrupo e item); as naturezas de código não
// numérico ficam fora da escolha do de-para até o contrato passar ao id da natureza (pedido em saida/03-07.json).
// naturezasForaDoContrato conta quantas ficam fora, para o aviso.
import type {
  ClassificacaoFolha,
  CredorFolha,
  IntegracaoFolhaLida,
  RotinaIntegracaoFolha,
} from '@sgh/contratos';
import {
  DESTINOS_TITULO_FOLHA,
  type DestinoIntegracaoFolha,
  type DestinoTituloFolha,
  ROTINA_DO_DESTINO,
} from '@sgh/contratos';
import { ErroOperacao, type Leitor, type NucleoProprio, recusa, type TxOperacao } from '@sgh/nucleo';
import { gravacaoDireta } from '../../enfermagem/gravacao-direta.js';
import type { GravacaoFeita, LiberacaoGravacao, TrilhaDaGravacao } from '../../exames/public-api.js';
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

/** As operações sem tabela no modelo e o recurso que falta a cada uma (o texto vai na recusa). */
const SEM_LANCAMENTO = '(o lançamento dos títulos da folha ainda não está ligado à operação do título a pagar do financeiro)';
export const SEM_MODELO_INTEGRACAO_FOLHA = {
  executar: `lançar os títulos da folha no contas a pagar ${SEM_LANCAMENTO}`,
  lancamentos: `listar os lançamentos dos títulos da folha ${SEM_LANCAMENTO}`,
  lancamento: `consultar o lançamento dos títulos da folha ${SEM_LANCAMENTO}`,
  lancamentoDaOrigem: `consultar o lançamento da origem ${SEM_LANCAMENTO}`,
  titulosDoLancamento: `listar os títulos do lançamento da folha ${SEM_LANCAMENTO}`,
  chavesLancadas: `conferir os títulos já lançados da competência ${SEM_LANCAMENTO}`,
  custoPessoal: `consultar o custo de pessoal por centro (os fatos contábeis da folha nascem do lançamento) ${SEM_LANCAMENTO}`,
  retorno: 'ler o retorno conferido da folha externa para os títulos (a leitura do lote conferido por papel de resumo da rubrica ainda não está ligada)',
  contaContabil:
    'gravar a conta contábil sugerida do destino (o de-para do modelo ainda não tem a coluna; deixe a sugestão vazia)',
} as const;

export type OperacaoSemModeloIntegracaoFolha = keyof typeof SEM_MODELO_INTEGRACAO_FOLHA;

export function erroSemModelo(op: OperacaoSemModeloIntegracaoFolha): ErroOperacao {
  return new ErroOperacao(
    503,
    'modelo-pendente',
    'Recurso ainda sem modelo de dados',
    `Ainda não é possível ${SEM_MODELO_INTEGRACAO_FOLHA[op]}. Nada foi lido nem gravado.`,
  );
}

const MOTIVO_SEM_LANCAMENTO =
  'O lançamento dos títulos da folha no contas a pagar ainda não está ligado ao financeiro: a prévia fica em consulta.';

/** As tabelas que a gravação do de-para escreve (a transação recusa as outras). */
export const TABELAS_INTEGRACAO_FOLHA = ['integracao_folha_financeiro', 'integracao_folha_financeiro_destino'] as const;

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
         d.destino, d.empresa_fornecedora_id, d.dia_vencimento, d.mes_vencimento,
         g.codigo AS grupo, s.codigo AS subgrupo, n.codigo AS item
    FROM integracao_folha_financeiro i
    JOIN integracao_folha_financeiro_destino d ON d.integracao_folha_financeiro_id = i.id
    JOIN natureza_financeira n ON n.id = d.natureza_financeira_id
    JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
    JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id
    LEFT JOIN usuario u ON u.id = i.criado_por
   WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL
   ORDER BY i.vigencia_inicio DESC, i.id DESC, d.id`;

/** As vigências do de-para do estabelecimento (a mais recente primeiro), com os destinos na ordem gravada. */
async function lerIntegracoes(l: Pick<Leitor, 'consultar'>, est: number): Promise<IntegracaoFolhaLida[]> {
  const porId = new Map<number, IntegracaoFolhaLida & { destinos: (DestinoIntegracaoFolha & { rotina: number })[] }>();
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
      contaContabil: '',
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

function gravadorIntegracao(tx: TxOperacao, est: number): GravadorIntegracaoFolha {
  return {
    integracoes: async (empresa) => (empresa === est ? lerIntegracoes(tx, est) : []),
    async incluirIntegracao(x) {
      if (x.empresa !== est)
        throw recusa('empresa-fora-da-sessao', 'A empresa do de-para é o estabelecimento da sessão.');
      if (x.destinos.some((d) => d.contaContabil.trim() !== '')) throw erroSemModelo('contaContabil');
      const repetida = await tx.consultarParaAtualizar(
        'SELECT id FROM integracao_folha_financeiro WHERE estabelecimento_id = ? AND vigencia_inicio = ? AND excluido_em IS NULL',
        [est, x.inicio],
      );
      if (repetida.length > 0)
        throw recusa('vigencia-repetida', 'Já existe um de-para com este início para a empresa: escolha outra data.');
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
          dia_vencimento: d.diaVencimento,
          mes_vencimento: d.mesesDepois === 0 ? 'mesmo' : 'seguinte',
        });
      return id;
    },
  };
}

const numero = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export class PortaIntegracaoFolhaPropria implements PortaIntegracaoFolha {
  readonly destino = 'banco' as const;

  private executor: ReturnType<NucleoIntegracaoFolha['criarExecutor']> | null = null;

  constructor(private readonly nucleo: NucleoIntegracaoFolha) {}

  private ler<T>(c: ContextoIntegracaoFolha, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(c, (l) => fn(l, est));
  }

  // ── Gravação: o de-para grava; o lançamento dos títulos recusa com o motivo ────────────────────────────────────

  async podeGravar(_c: ContextoIntegracaoFolha, operacao?: string): Promise<LiberacaoGravacao> {
    return operacao === OPERACAO_TITULOS_FOLHA
      ? { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_SEM_LANCAMENTO }
      : { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<GravacaoFeita> {
    throw erroSemModelo('executar');
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

  // ── Leituras sem modelo (recusa explícita, nunca vazio) ─────────────────────────────────────────────────────

  async retorno(): Promise<RetornoParaTitulos | null> {
    throw erroSemModelo('retorno');
  }
  async lancamentos(): Promise<LancamentoTitulosFolha[]> {
    throw erroSemModelo('lancamentos');
  }
  async lancamento(): Promise<LancamentoTitulosFolha | null> {
    throw erroSemModelo('lancamento');
  }
  async lancamentoDaOrigem(): Promise<LancamentoTitulosFolha | null> {
    throw erroSemModelo('lancamentoDaOrigem');
  }
  async titulosDoLancamento(): Promise<TituloFolhaLancado[]> {
    throw erroSemModelo('titulosDoLancamento');
  }
  async chavesLancadas(): Promise<string[]> {
    throw erroSemModelo('chavesLancadas');
  }
  async custoPessoal(): Promise<{ centros: never[]; lancamentos: number }> {
    throw erroSemModelo('custoPessoal');
  }
}
