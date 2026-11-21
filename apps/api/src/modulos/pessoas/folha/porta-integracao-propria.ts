// Porta própria da integração da folha com o financeiro e o contábil, sobre o MariaDB do cliente (pelo @sgh/nucleo).
// Lê do modelo próprio: os credores (empresa_fornecedora), as classificações gerenciais (grupo, subgrupo e natureza
// financeira) e o aviso de títulos manuais (titulo_pagar de outro módulo, do mesmo credor, classificação e período).
// O catálogo de rotinas é fixo do produto (ROTINAS_INTEGRACAO_FOLHA).
// O que ainda não tem tabela no modelo NÃO devolve vazio: recusa com 503 `modelo-pendente`, dizendo a operação, e a
// liberação de gravação responde "não pode" com o mesmo motivo. O DDL foi pedido em docs/obra/fatias/f22/saida/03-07.json.
// No serviço, o apoio da tela trata a falta do de-para como "sem de-para vigente" (as classificações e os credores
// continuam consultáveis); a prévia, o lançamento, a lista, as origens, o detalhe e o custo de pessoal respondem 503.
// O que falta:
//   - o de-para de integração por vigência (integracoes; gravarSgh, que grava a vigência);
//   - o lançamento dos títulos da folha (executar `financeiro.criarTituloPagar`; lancamentos, lancamento,
//     lancamentoDaOrigem, titulosDoLancamento, chavesLancadas);
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
import { ErroOperacao, type Leitor, type NucleoProprio, recusa } from '@sgh/nucleo';
import type { GravacaoFeita, LiberacaoGravacao } from '../../exames/public-api.js';
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

/** O mínimo do núcleo que a porta usa. */
export type NucleoIntegracaoFolha = Pick<NucleoProprio, 'lerSomente'>;

/** Quantos credores a busca devolve. */
export const TETO_CREDORES_FOLHA = 50;

/** As operações sem tabela no modelo e o recurso que falta a cada uma (o texto vai na recusa). */
export const SEM_MODELO_INTEGRACAO_FOLHA = {
  integracoes: 'consultar o de-para da integração da folha (falta a tabela da vigência do de-para)',
  gravarSgh: 'gravar o de-para da integração da folha (falta a tabela da vigência do de-para)',
  executar:
    'lançar os títulos da folha no contas a pagar (falta a tabela do lançamento dos títulos da folha)',
  lancamentos:
    'listar os lançamentos dos títulos da folha (falta a tabela do lançamento dos títulos da folha)',
  lancamento:
    'consultar o lançamento dos títulos da folha (falta a tabela do lançamento dos títulos da folha)',
  lancamentoDaOrigem: 'consultar o lançamento da origem (falta a tabela do lançamento dos títulos da folha)',
  titulosDoLancamento:
    'listar os títulos do lançamento da folha (falta a tabela do lançamento dos títulos da folha)',
  chavesLancadas:
    'conferir os títulos já lançados da competência (falta a tabela do lançamento dos títulos da folha)',
  custoPessoal: 'consultar o custo de pessoal por centro (falta a tabela dos fatos contábeis da folha)',
  retorno: 'ler o retorno conferido da folha externa para os títulos (falta o papel de resumo da rubrica)',
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

const MOTIVO_SEM_GRAVACAO =
  'A integração da folha com o financeiro ainda não tem as tabelas do de-para e do lançamento dos títulos no modelo: as telas ficam em consulta.';

const numero = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export class PortaIntegracaoFolhaPropria implements PortaIntegracaoFolha {
  readonly destino = 'banco' as const;

  constructor(private readonly nucleo: NucleoIntegracaoFolha) {}

  private ler<T>(c: ContextoIntegracaoFolha, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(c, (l) => fn(l, est));
  }

  // ── Gravação (sem modelo: liberação negada com o motivo; a chamada recusa com 503) ─────────────────────────────

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_SEM_GRAVACAO };
  }

  async executar(): Promise<GravacaoFeita> {
    throw erroSemModelo('executar');
  }

  /* eslint-disable @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo */
  async gravarSgh<T>(
    _c: ContextoIntegracaoFolha,
    _t: unknown,
    _fn: (g: GravadorIntegracaoFolha) => Promise<T>,
  ): Promise<T> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
    throw erroSemModelo('gravarSgh');
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

  async integracoes(): Promise<IntegracaoFolhaLida[]> {
    throw erroSemModelo('integracoes');
  }
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
