// Porta própria da remuneração e do pagamento do prestador da rede (08-SGO L102, C2-120) sobre o banco do cliente:
// - tabela negociada e itens (tabela_remuneracao_rede, tabela_remuneracao_rede_item);
// - regra de valoração (regra_valoracao_item) e a valoração de um evento (simulação, sem gravar);
// - pacote com valor global e itens (pacote_remuneracao_rede, pacote_remuneracao_rede_item);
// - reajuste do contrato (reajuste_contrato_rede): o item antigo é encerrado na véspera e o reajustado entra no início
//   (o histórico de valores fica);
// - calendário de pagamento (calendario_pagamento_rede), com fechamento da competência;
// - adiantamento (adiantamento_rede) com o título a pagar do adiantamento;
// - lote de pagamento (lote_pagamento_rede, _item, _tributo): contas analisadas do prestador, tributos retidos,
//   compensação do adiantamento (débito em lancamento_avulso_prestador) e o título no contas a pagar (titulo_pagar,
//   parcela_pagar, retencao_titulo).
// As regras são do domínio (remuneracao-rede.ts); o banco só guarda. Cada gravação é uma operação do Executor (trilha
// na mesma transação). Escopo: a operadora ligada ao estabelecimento da sessão; fora dele, 404 sem dizer se existe.
import {
  type AdiantamentoCadastro,
  calcularPagamento,
  type CalculoPagamento,
  type CalendarioPagamentoCadastro,
  diaAnterior,
  diasParaPagamento,
  escolherRegra,
  type ItemTabelaCadastro,
  type PacoteCadastro,
  type ProblemaRemuneracao,
  problemasDaRegraValoracao,
  problemasDaTabelaRemuneracao,
  problemasDoAdiantamento,
  problemasDoCalendario,
  problemasDoItemTabela,
  problemasDoLotePagamento,
  problemasDoPacote,
  problemasDoReajusteRede,
  proximoReajuste,
  reajustarUnidade,
  reajustarValor,
  type ReajusteRedeCadastro,
  type RegraParaEscolha,
  type RegraValoracaoCadastro,
  type TabelaRemuneracaoCadastro,
  type TipoValorTabela,
  problemasDoCalculoPagamento,
  resolverTributoDoLote,
  type TributoDoCadastro,
  type TributoInformado,
  type TributoResolvido,
  type Valoracao,
  valorar,
  valorDoItem,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  inteiro,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_REMUNERACAO_REDE = Symbol('PORTA_REMUNERACAO_REDE_OPERADORA');
export const TABELAS_REMUNERACAO_REDE = [
  'tabela_remuneracao_rede',
  'tabela_remuneracao_rede_item',
  'regra_valoracao_item',
  'pacote_remuneracao_rede',
  'pacote_remuneracao_rede_item',
  'reajuste_contrato_rede',
  'calendario_pagamento_rede',
  'adiantamento_rede',
  'lote_pagamento_rede',
  'lote_pagamento_rede_item',
  'lote_pagamento_rede_tributo',
  'lancamento_avulso_prestador',
  'empresa_fornecedora',
  'lote_conta_recebida',
  'titulo_pagar',
  'parcela_pagar',
  'retencao_titulo',
  'sequencia_negocio',
] as const;

export type Gravado = { readonly id: number; readonly versao: number };
type Trilha = (r: Gravado & { tabela: string }) => RegistroTrilhaTela;
export interface Opcao {
  id: number;
  rotulo: string;
}

const naoEncontrado = () =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    'O registro não existe neste estabelecimento.',
  );
function exigir(problemas: readonly ProblemaRemuneracao[]): void {
  const p = problemas[0];
  if (p) throw recusa(p.codigo, p.detalhe, { campos: [...new Set(problemas.map((x) => x.campo))] });
}
const esquemaEntrada = z.record(z.string(), z.unknown());
const hojeIso = () => new Date().toISOString().slice(0, 10);
const opcoesDe = (rs: Record<string, unknown>[]): Opcao[] =>
  rs.map((r) => ({ id: Number(r['id']), rotulo: textoObrigatorio(r['rotulo']) }));
const num0 = (v: unknown) => numero(v) ?? 0;

export interface TabelaLida extends TabelaRemuneracaoCadastro {
  id: number;
  versao: number;
  situacao: string;
  prestadorNome: string | null;
  itens: number;
}
export interface ItemTabelaLido extends ItemTabelaCadastro {
  id: number;
  sequencia: number;
  procedimentoRotulo: string | null;
  grupoRotulo: string | null;
  prestador: number | null;
  valorCalculado: number;
}
export interface LoteLido {
  id: number;
  versao: number;
  numero: string;
  competencia: string;
  prestador: number;
  prestadorNome: string;
  vencimento: string;
  situacao: string;
  bruto: number;
  tributos: number;
  liquido: number;
  titulo: number | null;
  tituloNumero: string | null;
  contas: number;
}
export interface NovoLote {
  prestador: number;
  competencia: string;
  vencimento: string;
  contas: number[];
  tributos: TributoInformado[];
  mensagemPrestador: string | null;
}

export class PortaRemuneracaoRedePropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora & Pick<NucleoProprio, 'escrever'>,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-remuneracao' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async gravar<R extends Gravado & { tabela: string }>(
    c: ContextoPorta,
    nome: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number) => Promise<R>,
  ): Promise<R> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, R>({
      nome,
      tabelas: TABELAS_REMUNERACAO_REDE,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela: r.tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const r = await this.executor.executar(
      operacao,
      this.cliente,
      {},
      contextoDireto(this.cliente, est, c, null),
    );
    return r.resultado;
  }

  private static async operadora(l: Leitor, est: number, op: number): Promise<void> {
    const r = await l.uma(
      'SELECT 1 AS ok FROM operadora_saude_estabelecimento WHERE operadora_saude_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [op, est],
    );
    if (!r) throw naoEncontrado();
  }
  private static async prestador(l: Leitor, est: number, id: number, campo = 'prestador') {
    const r = await l.uma(
      'SELECT id, tipo_prestador_rede_id, nome, pessoa, cpf, cnpj, profissional_id FROM prestador_rede WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
    );
    if (!r)
      throw recusa('referencia-inexistente', 'O prestador não existe neste estabelecimento.', {
        campos: [campo],
      });
    return r;
  }
  private static async tabelaDaOperadora(l: Leitor, est: number, id: number) {
    const [t] = await l.consultar(
      `SELECT t.* FROM tabela_remuneracao_rede t
         JOIN operadora_saude_estabelecimento o ON o.operadora_saude_id = t.operadora_saude_id AND o.estabelecimento_id = ? AND o.excluido_em IS NULL
        WHERE t.id = ? AND t.excluido_em IS NULL`,
      [est, id],
      { teto: 1 },
    );
    if (!t) throw naoEncontrado();
    return t;
  }

  // ------------------------------------------------------------ leituras

  /** Listas para a tela: prestadores, tabelas, grupos, índices, tributos retidos, naturezas, documentos e contratos. */
  opcoes(c: ContextoPorta, op: number) {
    return this.ler(c, async (l, est) => {
      await PortaRemuneracaoRedePropria.operadora(l, est, op);
      const q = (sql: string, p: unknown[] = []) => l.consultar(sql, p, { teto: 2000 }).then(opcoesDe);
      const [
        prestadores,
        tabelas,
        grupos,
        indices,
        tributos,
        naturezas,
        documentos,
        contratos,
        tiposPrestador,
      ] = await Promise.all([
        q(
          `SELECT id, CONCAT(codigo, ' — ', nome) AS rotulo FROM prestador_rede
              WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome`,
          [est],
        ),
        q(
          `SELECT id, CONCAT(codigo, ' — ', nome) AS rotulo FROM tabela_remuneracao_rede
              WHERE operadora_saude_id = ? AND excluido_em IS NULL ORDER BY codigo`,
          [op],
        ),
        q(
          `SELECT id, CONCAT(codigo, ' — ', descricao) AS rotulo FROM grupo_procedimento_operadora WHERE ativo = TRUE ORDER BY codigo`,
        ),
        q(
          `SELECT id, CONCAT(codigo_indice, ' — ', descricao) AS rotulo FROM indice_reajuste_plano ORDER BY codigo_indice, vigencia_inicio DESC`,
        ),
        q(
          `SELECT id, CONCAT(codigo, ' — ', descricao) AS rotulo FROM tributo WHERE ativo = TRUE AND incidencia IN ('retido','ambos') ORDER BY codigo`,
        ),
        q(
          `SELECT id, CONCAT(codigo, ' — ', descricao) AS rotulo FROM natureza_financeira WHERE ativo = TRUE AND tipo = 'despesa' ORDER BY codigo`,
        ),
        q(
          `SELECT id, descricao AS rotulo FROM tipo_documento_financeiro WHERE ativo = TRUE AND sentido IN ('pagar','ambos') ORDER BY descricao`,
        ),
        q(
          `SELECT k.id, CONCAT(k.numero, ' — ', p.nome) AS rotulo FROM contrato_rede_prestador k
               JOIN prestador_rede p ON p.id = k.prestador_rede_id
              WHERE k.operadora_saude_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL ORDER BY k.numero`,
          [op, est],
        ),
        q(`SELECT id, descricao AS rotulo FROM tipo_prestador_rede WHERE ativo = TRUE ORDER BY descricao`),
      ]);
      return {
        prestadores,
        tabelas,
        grupos,
        indices,
        tributos,
        naturezas,
        documentos,
        contratos,
        tiposPrestador,
      };
    });
  }

  /** Procedimentos (terminologia) ou itens faturáveis por código ou trecho, para itens de tabela e pacotes. */
  procedimentos(c: ContextoPorta, tipo: 'termo' | 'item', busca: string): Promise<Opcao[]> {
    const t = busca.trim();
    if (t.length < 2) return Promise.resolve([]);
    const like = `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    return this.ler(c, async (l) =>
      opcoesDe(
        tipo === 'termo'
          ? await l.consultar(
              `SELECT id, CONCAT(codigo, ' — ', LEFT(descricao, 120)) AS rotulo FROM termo_terminologia
                WHERE codigo LIKE ? OR descricao LIKE ? ORDER BY codigo LIMIT 20`,
              [like, like],
              { teto: 20 },
            )
          : await l.consultar(
              `SELECT id, CONCAT(codigo, ' — ', LEFT(descricao, 120)) AS rotulo FROM item_faturavel
                WHERE excluido_em IS NULL AND (codigo LIKE ? OR descricao LIKE ?) ORDER BY codigo LIMIT 20`,
              [like, like],
              { teto: 20 },
            ),
      ),
    );
  }

  tabelas(c: ContextoPorta, op: number): Promise<TabelaLida[]> {
    return this.ler(c, async (l, est) => {
      await PortaRemuneracaoRedePropria.operadora(l, est, op);
      const rs = await l.consultar(
        `SELECT t.*, p.nome AS prestador_nome,
                (SELECT COUNT(*) FROM tabela_remuneracao_rede_item i WHERE i.tabela_remuneracao_rede_id = t.id AND i.excluido_em IS NULL) AS itens
           FROM tabela_remuneracao_rede t LEFT JOIN prestador_rede p ON p.id = t.prestador_rede_id
          WHERE t.operadora_saude_id = ? AND t.excluido_em IS NULL ORDER BY t.vigencia_fim IS NOT NULL, t.codigo`,
        [op],
        { teto: 500 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        versao: Number(r['versao']),
        codigo: textoObrigatorio(r['codigo']),
        nome: textoObrigatorio(r['nome']),
        finalidade: textoObrigatorio(r['finalidade']) as TabelaLida['finalidade'],
        tipoValor: textoObrigatorio(r['tipo_valor']) as TipoValorTabela,
        valorCh: numero(r['valor_ch']),
        valorUco: numero(r['valor_uco']),
        valorFilme: numero(r['valor_filme']),
        prestador: inteiro(r['prestador_rede_id']),
        prestadorNome: texto(r['prestador_nome']),
        situacao: textoObrigatorio(r['situacao']),
        inicio: dataIso(r['vigencia_inicio']) ?? '',
        fim: dataIso(r['vigencia_fim']),
        itens: Number(r['itens']),
      }));
    });
  }

  itens(c: ContextoPorta, tabela: number): Promise<ItemTabelaLido[]> {
    return this.ler(c, async (l, est) => {
      const t = await PortaRemuneracaoRedePropria.tabelaDaOperadora(l, est, tabela);
      const rs = await l.consultar(
        `SELECT i.*, CONCAT(tt.codigo, ' — ', LEFT(tt.descricao, 120)) AS procedimento_rotulo, g.descricao AS grupo_rotulo
           FROM tabela_remuneracao_rede_item i
           LEFT JOIN termo_terminologia tt ON tt.id = i.procedimento_termo_terminologia_id
           LEFT JOIN grupo_procedimento_operadora g ON g.id = i.grupo_procedimento_operadora_id
          WHERE i.tabela_remuneracao_rede_id = ? AND i.excluido_em IS NULL
          ORDER BY i.vigencia_fim IS NOT NULL, i.sequencia DESC`,
        [tabela],
        { teto: 5000 },
      );
      const tv = {
        tipoValor: textoObrigatorio(t['tipo_valor']) as TipoValorTabela,
        valorCh: numero(t['valor_ch']),
        valorUco: numero(t['valor_uco']),
        valorFilme: numero(t['valor_filme']),
      };
      return rs.map((r) => {
        const i = {
          procedimento: inteiro(r['procedimento_termo_terminologia_id']),
          grupo: inteiro(r['grupo_procedimento_operadora_id']),
          valor: numero(r['valor']),
          quantidadeCh: numero(r['quantidade_ch']),
          quantidadeUco: numero(r['quantidade_uco']),
          quantidadeFilme: numero(r['quantidade_filme']),
          inicio: dataIso(r['vigencia_inicio']) ?? '',
          fim: dataIso(r['vigencia_fim']),
        };
        return {
          ...i,
          id: Number(r['id']),
          sequencia: Number(r['sequencia']),
          procedimentoRotulo: texto(r['procedimento_rotulo']),
          grupoRotulo: texto(r['grupo_rotulo']),
          prestador: inteiro(r['prestador_rede_id']),
          valorCalculado: valorDoItem(i, tv),
        };
      });
    });
  }

  regras(c: ContextoPorta, op: number) {
    return this.ler(c, async (l, est) => {
      await PortaRemuneracaoRedePropria.operadora(l, est, op);
      const rs = await l.consultar(
        `SELECT r.*, t.codigo AS tabela_codigo, p.nome AS prestador_nome FROM regra_valoracao_item r
           JOIN tabela_remuneracao_rede t ON t.id = r.tabela_remuneracao_rede_id
           LEFT JOIN prestador_rede p ON p.id = r.prestador_rede_id
          WHERE r.operadora_saude_id = ? AND r.ativo = TRUE ORDER BY r.prioridade, r.codigo`,
        [op],
        { teto: 1000 },
      );
      return rs.map((r) => ({
        ...regraDe(r),
        codigo: textoObrigatorio(r['codigo']),
        descricao: textoObrigatorio(r['descricao']),
        tabelaCodigo: textoObrigatorio(r['tabela_codigo']),
        prestadorNome: texto(r['prestador_nome']),
      }));
    });
  }

  pacotes(c: ContextoPorta, op: number) {
    return this.ler(c, async (l, est) => {
      await PortaRemuneracaoRedePropria.operadora(l, est, op);
      const rs = await l.consultar(
        `SELECT k.id, k.versao, k.codigo, k.descricao, k.tipo_pacote, k.regime, k.quantidade_diarias, k.valor_global,
                k.vigencia_inicio, k.vigencia_fim, p.nome AS prestador_nome, CONCAT(i.codigo, ' — ', i.descricao) AS principal,
                (SELECT COUNT(*) FROM pacote_remuneracao_rede_item x WHERE x.pacote_remuneracao_rede_id = k.id) AS itens
           FROM pacote_remuneracao_rede k
           JOIN item_faturavel i ON i.id = k.procedimento_item_faturavel_id
           LEFT JOIN prestador_rede p ON p.id = k.prestador_rede_id
          WHERE k.operadora_saude_id = ? AND k.ativo = TRUE ORDER BY k.codigo, k.vigencia_inicio DESC`,
        [op],
        { teto: 1000 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        versao: Number(r['versao']),
        codigo: textoObrigatorio(r['codigo']),
        descricao: textoObrigatorio(r['descricao']),
        tipo: textoObrigatorio(r['tipo_pacote']),
        regime: texto(r['regime']),
        diarias: inteiro(r['quantidade_diarias']),
        valorGlobal: num0(r['valor_global']),
        inicio: dataIso(r['vigencia_inicio']) ?? '',
        fim: dataIso(r['vigencia_fim']),
        prestadorNome: texto(r['prestador_nome']),
        principal: textoObrigatorio(r['principal']),
        itens: Number(r['itens']),
      }));
    });
  }

  reajustes(c: ContextoPorta, contrato: number) {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT r.id, r.forma, r.percentual, r.data_base, r.vigencia_inicio, r.proximo_reajuste, r.descricao, r.cancelado_em,
                t.codigo AS tabela_codigo, g.descricao AS grupo_descricao, r.dados
           FROM reajuste_contrato_rede r
           JOIN contrato_rede_prestador k ON k.id = r.contrato_rede_prestador_id AND k.estabelecimento_id = ?
           LEFT JOIN tabela_remuneracao_rede t ON t.id = r.tabela_remuneracao_rede_id
           LEFT JOIN grupo_procedimento_operadora g ON g.id = r.grupo_procedimento_operadora_id
          WHERE r.contrato_rede_prestador_id = ? ORDER BY r.vigencia_inicio DESC, r.id DESC`,
        [est, contrato],
        { teto: 500 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        forma: textoObrigatorio(r['forma']),
        percentual: num0(r['percentual']),
        dataBase: dataIso(r['data_base']) ?? '',
        inicio: dataIso(r['vigencia_inicio']) ?? '',
        proximo: dataIso(r['proximo_reajuste']),
        descricao: texto(r['descricao']),
        tabela: texto(r['tabela_codigo']),
        grupo: texto(r['grupo_descricao']),
        cancelado: r['cancelado_em'] !== null && r['cancelado_em'] !== undefined,
      }));
    });
  }

  calendario(c: ContextoPorta, op: number, ano: number) {
    return this.ler(c, async (l, est) => {
      await PortaRemuneracaoRedePropria.operadora(l, est, op);
      const rs = await l.consultar(
        `SELECT k.*, p.nome AS prestador_nome FROM calendario_pagamento_rede k
           LEFT JOIN prestador_rede p ON p.id = k.prestador_rede_id
          WHERE k.operadora_saude_id = ? AND YEAR(k.competencia) = ? ORDER BY k.competencia, k.prestador_rede_id IS NOT NULL`,
        [op, ano],
        { teto: 500 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        versao: Number(r['versao']),
        competencia: dataIso(r['competencia']) ?? '',
        prestador: inteiro(r['prestador_rede_id']),
        prestadorNome: texto(r['prestador_nome']),
        atendimentoInicio: dataIso(r['atendimento_inicio']) ?? '',
        atendimentoFim: dataIso(r['atendimento_fim']) ?? '',
        entregaInicio: dataIso(r['entrega_inicio']),
        entregaFim: dataIso(r['entrega_fim']),
        corte: dataIso(r['data_corte']),
        pagamento: dataIso(r['data_pagamento']),
        dias: inteiro(r['dias_para_pagamento']),
        fechado: booleano(r['fechado']),
      }));
    });
  }

  /** A visão pelo prestador: contas analisadas ainda sem lote, adiantamentos e os lotes de pagamento. */
  prestadorPagamento(c: ContextoPorta, op: number, prestador: number) {
    return this.ler(c, async (l, est) => {
      await PortaRemuneracaoRedePropria.operadora(l, est, op);
      await PortaRemuneracaoRedePropria.prestador(l, est, prestador);
      const [contas, adiantamentos, lotes] = await Promise.all([
        l.consultar(
          `SELECT c.id, c.numero_protocolo, c.competencia, c.tipo_guia, c.valor_apresentado, c.valor_glosado, c.valor_liberado
             FROM lote_conta_recebida c
            WHERE c.estabelecimento_id = ? AND c.operadora_saude_id = ? AND c.prestador_rede_id = ? AND c.situacao = 'analisada'
              AND NOT EXISTS (SELECT 1 FROM lote_pagamento_rede_item i JOIN lote_pagamento_rede lp ON lp.id = i.lote_pagamento_rede_id
                               WHERE i.lote_conta_recebida_id = c.id AND lp.situacao <> 'cancelado' AND i.situacao <> 'estornado')
            ORDER BY c.competencia, c.id`,
          [est, op, prestador],
          { teto: 1000 },
        ),
        l.consultar(
          `SELECT a.id, a.numero, a.descricao, a.data_adiantamento, a.valor, a.valor_compensado, a.quantidade_parcelas_compensacao,
                  a.competencia_inicio_compensacao, a.situacao, t.numero AS titulo_numero
             FROM adiantamento_rede a LEFT JOIN titulo_pagar t ON t.id = a.titulo_pagar_id
            WHERE a.estabelecimento_id = ? AND a.prestador_rede_id = ? ORDER BY a.data_adiantamento DESC, a.id DESC`,
          [est, prestador],
          { teto: 500 },
        ),
        this.lotesDe(l, est, op, prestador),
      ]);
      return {
        contas: contas.map((r) => ({
          id: Number(r['id']),
          protocolo: textoObrigatorio(r['numero_protocolo']),
          competencia: dataIso(r['competencia']) ?? '',
          tipoGuia: textoObrigatorio(r['tipo_guia']),
          apresentado: num0(r['valor_apresentado']),
          glosado: num0(r['valor_glosado']),
          liberado: num0(r['valor_liberado']),
        })),
        adiantamentos: adiantamentos.map((r) => ({
          id: Number(r['id']),
          numero: textoObrigatorio(r['numero']),
          descricao: textoObrigatorio(r['descricao']),
          data: dataIso(r['data_adiantamento']) ?? '',
          valor: num0(r['valor']),
          compensado: num0(r['valor_compensado']),
          parcelas: Number(r['quantidade_parcelas_compensacao']),
          inicioCompensacao: dataIso(r['competencia_inicio_compensacao']),
          situacao: textoObrigatorio(r['situacao']),
          titulo: texto(r['titulo_numero']),
        })),
        lotes,
      };
    });
  }

  private async lotesDe(l: Leitor, est: number, op: number, prestador: number | null): Promise<LoteLido[]> {
    const rs = await l.consultar(
      `SELECT lp.*, p.nome AS prestador_nome,
              (SELECT MIN(i.titulo_pagar_id) FROM lote_pagamento_rede_item i WHERE i.lote_pagamento_rede_id = lp.id) AS titulo_id,
              (SELECT t.numero FROM titulo_pagar t WHERE t.id = (SELECT MIN(i.titulo_pagar_id) FROM lote_pagamento_rede_item i WHERE i.lote_pagamento_rede_id = lp.id)) AS titulo_numero,
              (SELECT COUNT(*) FROM lote_pagamento_rede_item i WHERE i.lote_pagamento_rede_id = lp.id) AS contas
         FROM lote_pagamento_rede lp JOIN prestador_rede p ON p.id = lp.prestador_rede_id
        WHERE lp.estabelecimento_id = ? AND lp.operadora_saude_id = ? AND (? IS NULL OR lp.prestador_rede_id = ?)
        ORDER BY lp.competencia DESC, lp.id DESC`,
      [est, op, prestador, prestador],
      { teto: 500 },
    );
    return rs.map((r) => ({
      id: Number(r['id']),
      versao: Number(r['versao']),
      numero: textoObrigatorio(r['numero']),
      competencia: dataIso(r['competencia']) ?? '',
      prestador: Number(r['prestador_rede_id']),
      prestadorNome: textoObrigatorio(r['prestador_nome']),
      vencimento: dataIso(r['data_vencimento']) ?? '',
      situacao: textoObrigatorio(r['situacao']),
      bruto: num0(r['valor_bruto']),
      tributos: num0(r['valor_tributos']),
      liquido: num0(r['valor_liquido']),
      titulo: inteiro(r['titulo_id']),
      tituloNumero: texto(r['titulo_numero']),
      contas: Number(r['contas']),
    }));
  }

  lotes(c: ContextoPorta, op: number): Promise<LoteLido[]> {
    return this.ler(c, async (l, est) => {
      await PortaRemuneracaoRedePropria.operadora(l, est, op);
      return this.lotesDe(l, est, op, null);
    });
  }

  /** Valora um evento (simulação): a regra que vale, o item da tabela (a exceção do prestador primeiro) e o valor. */
  valorar(
    c: ContextoPorta,
    op: number,
    e: {
      prestador: number;
      procedimento: number;
      item: number | null;
      grupo: number | null;
      data: string;
      hora: string | null;
      urgencia: boolean;
      quantidade: number;
    },
  ): Promise<Valoracao & { tabelaCodigo: string; itemTabela: number }> {
    return this.ler(c, async (l, est) => {
      await PortaRemuneracaoRedePropria.operadora(l, est, op);
      const p = await PortaRemuneracaoRedePropria.prestador(l, est, e.prestador);
      const rs = await l.consultar(
        'SELECT * FROM regra_valoracao_item WHERE operadora_saude_id = ? AND ativo = TRUE',
        [op],
        { teto: 2000 },
      );
      const evento = {
        prestador: e.prestador,
        tipoPrestador: inteiro(p['tipo_prestador_rede_id']),
        grupos: e.grupo === null ? [] : [e.grupo],
        item: e.item,
        data: e.data,
        hora: e.hora,
        urgencia: e.urgencia,
      };
      const regra = escolherRegra(rs.map(regraDe), evento);
      if (!regra)
        throw recusa('sem-regra', 'Nenhuma regra de valoração vale para este prestador e data.', {
          campos: ['prestador'],
        });
      const t = await PortaRemuneracaoRedePropria.tabelaDaOperadora(l, est, regra.tabela);
      const [i] = await l.consultar(
        `SELECT * FROM tabela_remuneracao_rede_item
          WHERE tabela_remuneracao_rede_id = ? AND excluido_em IS NULL
            AND (procedimento_termo_terminologia_id = ? OR (? IS NOT NULL AND grupo_procedimento_operadora_id = ?))
            AND (prestador_rede_id IS NULL OR prestador_rede_id = ?)
            AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
          ORDER BY prestador_rede_id IS NULL, procedimento_termo_terminologia_id IS NULL, prioridade, id DESC`,
        [regra.tabela, e.procedimento, e.grupo, e.grupo, e.prestador, e.data, e.data],
        { teto: 1 },
      );
      if (!i)
        throw recusa('sem-item-na-tabela', 'O procedimento não tem valor vigente na tabela da regra.', {
          campos: ['procedimento'],
        });
      const unitario = valorDoItem(
        {
          valor: numero(i['valor']),
          quantidadeCh: numero(i['quantidade_ch']),
          quantidadeUco: numero(i['quantidade_uco']),
          quantidadeFilme: numero(i['quantidade_filme']),
        },
        {
          tipoValor: textoObrigatorio(t['tipo_valor']) as TipoValorTabela,
          valorCh: numero(t['valor_ch']),
          valorUco: numero(t['valor_uco']),
          valorFilme: numero(t['valor_filme']),
        },
      );
      return {
        ...valorar(regra, evento, unitario, e.quantidade),
        tabelaCodigo: textoObrigatorio(t['codigo']),
        itemTabela: Number(i['id']),
      };
    });
  }

  // ------------------------------------------------------------ gravações

  async incluirTabela(c: ContextoPorta, op: number, e: TabelaRemuneracaoCadastro, trilha: Trilha) {
    exigir(problemasDaTabelaRemuneracao(e));
    return this.gravar(c, 'operadora.remuneracao.tabela.incluir', trilha, async (tx, est) => {
      await PortaRemuneracaoRedePropria.operadora(tx, est, op);
      if (e.prestador !== null) await PortaRemuneracaoRedePropria.prestador(tx, est, e.prestador);
      if (
        await tx.uma(
          'SELECT 1 AS ok FROM tabela_remuneracao_rede WHERE operadora_saude_id = ? AND codigo = ?',
          [op, e.codigo.trim()],
        )
      )
        throw recusa('codigo-em-uso', 'Já existe tabela com este código na operadora.', {
          campos: ['codigo'],
        });
      const id = await tx.incluir('tabela_remuneracao_rede', {
        operadora_saude_id: op,
        codigo: e.codigo.trim(),
        nome: e.nome.trim(),
        finalidade: e.finalidade,
        tipo_valor: e.tipoValor,
        valor_ch: e.valorCh,
        valor_uco: e.valorUco,
        valor_filme: e.valorFilme,
        prestador_rede_id: e.prestador,
        situacao: 'vigente',
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
      });
      return { id, versao: 1, tabela: 'tabela_remuneracao_rede' };
    });
  }

  incluirItem(
    c: ContextoPorta,
    tabela: number,
    e: ItemTabelaCadastro & { prestador: number | null },
    trilha: Trilha,
  ) {
    return this.gravar(c, 'operadora.remuneracao.item.incluir', trilha, async (tx, est) => {
      const t = await PortaRemuneracaoRedePropria.tabelaDaOperadora(tx, est, tabela);
      exigir(
        problemasDoItemTabela(e, {
          tipoValor: textoObrigatorio(t['tipo_valor']) as TipoValorTabela,
          inicio: dataIso(t['vigencia_inicio']) ?? '',
          fim: dataIso(t['vigencia_fim']),
        }),
      );
      if (e.prestador !== null) await PortaRemuneracaoRedePropria.prestador(tx, est, e.prestador);
      if (
        e.procedimento !== null &&
        !(await tx.uma('SELECT 1 AS ok FROM termo_terminologia WHERE id = ?', [e.procedimento]))
      )
        throw recusa('referencia-inexistente', 'O procedimento não existe na terminologia.', {
          campos: ['procedimento'],
        });
      // Duas linhas do mesmo procedimento e prestador com vigência sobreposta deixariam o valor ambíguo.
      const sobreposto = await tx.consultarParaAtualizar(
        `SELECT id FROM tabela_remuneracao_rede_item
          WHERE tabela_remuneracao_rede_id = ? AND excluido_em IS NULL
            AND procedimento_termo_terminologia_id <=> ? AND grupo_procedimento_operadora_id <=> ? AND prestador_rede_id <=> ?
            AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND (? IS NULL OR vigencia_inicio <= ?)`,
        [tabela, e.procedimento, e.grupo, e.prestador, e.inicio, e.fim, e.fim],
        { teto: 1 },
      );
      if (sobreposto.length)
        throw recusa(
          'item-sobreposto',
          'O item já tem valor vigente no período; reajuste ou encerre o anterior.',
          {
            campos: ['inicio'],
          },
        );
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM tabela_remuneracao_rede_item WHERE tabela_remuneracao_rede_id = ?',
        [tabela],
      );
      const id = await tx.incluir('tabela_remuneracao_rede_item', {
        tabela_remuneracao_rede_id: tabela,
        sequencia: Number(seq?.['s'] ?? 1),
        tipo_item: e.prestador === null ? 'valor_referencia' : 'excecao',
        procedimento_termo_terminologia_id: e.procedimento,
        grupo_procedimento_operadora_id: e.grupo,
        prestador_rede_id: e.prestador,
        valor: e.valor,
        quantidade_ch: e.quantidadeCh,
        quantidade_uco: e.quantidadeUco,
        quantidade_filme: e.quantidadeFilme,
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
      });
      return { id, versao: 1, tabela: 'tabela_remuneracao_rede_item' };
    });
  }

  async incluirRegra(c: ContextoPorta, op: number, e: RegraValoracaoCadastro, trilha: Trilha) {
    exigir(problemasDaRegraValoracao(e));
    return this.gravar(c, 'operadora.remuneracao.regra.incluir', trilha, async (tx, est) => {
      await PortaRemuneracaoRedePropria.operadora(tx, est, op);
      const t = await PortaRemuneracaoRedePropria.tabelaDaOperadora(tx, est, e.tabela);
      if (Number(t['operadora_saude_id']) !== op) throw naoEncontrado();
      if (e.prestador !== null) await PortaRemuneracaoRedePropria.prestador(tx, est, e.prestador);
      if (
        await tx.uma('SELECT 1 AS ok FROM regra_valoracao_item WHERE operadora_saude_id = ? AND codigo = ?', [
          op,
          e.codigo.trim(),
        ])
      )
        throw recusa('codigo-em-uso', 'Já existe regra com este código na operadora.', {
          campos: ['codigo'],
        });
      const id = await tx.incluir('regra_valoracao_item', {
        operadora_saude_id: op,
        codigo: e.codigo.trim(),
        descricao: e.descricao.trim(),
        prioridade: e.prioridade,
        prestador_rede_id: e.prestador,
        tipo_prestador_rede_id: e.tipoPrestador,
        grupo_procedimento_operadora_id: e.grupo,
        item_faturavel_id: e.item,
        tabela_remuneracao_rede_id: e.tabela,
        fator: e.fator,
        percentual_acrescimo: e.acrescimo,
        urgencia_dia_semana: e.diaSemana,
        urgencia_hora_inicio: e.horaInicio,
        urgencia_hora_fim: e.horaFim,
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
        ativo: true,
      });
      return { id, versao: 1, tabela: 'regra_valoracao_item' };
    });
  }

  async incluirPacote(c: ContextoPorta, op: number, e: PacoteCadastro, trilha: Trilha) {
    exigir(problemasDoPacote(e));
    return this.gravar(c, 'operadora.remuneracao.pacote.incluir', trilha, async (tx, est) => {
      await PortaRemuneracaoRedePropria.operadora(tx, est, op);
      if (e.prestador !== null) await PortaRemuneracaoRedePropria.prestador(tx, est, e.prestador);
      const ids = [...new Set([e.principal, ...e.itens.map((i) => i.item)])];
      const achados = await tx.consultar(
        `SELECT id FROM item_faturavel WHERE excluido_em IS NULL AND id IN (${ids.map(() => '?').join(', ')})`,
        ids,
        { teto: ids.length },
      );
      if (achados.length !== ids.length)
        throw recusa('referencia-inexistente', 'Um item do pacote não existe no cadastro.', {
          campos: ['itens'],
        });
      const sobreposto = await tx.consultarParaAtualizar(
        `SELECT id FROM pacote_remuneracao_rede WHERE operadora_saude_id = ? AND prestador_rede_id <=> ? AND codigo = ? AND ativo = TRUE
            AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND (? IS NULL OR vigencia_inicio <= ?)`,
        [op, e.prestador, e.codigo.trim(), e.inicio, e.fim, e.fim],
        { teto: 1 },
      );
      if (sobreposto.length)
        throw recusa('pacote-sobreposto', 'O pacote já tem versão vigente no período.', {
          campos: ['inicio'],
        });
      const id = await tx.incluir('pacote_remuneracao_rede', {
        operadora_saude_id: op,
        prestador_rede_id: e.prestador,
        codigo: e.codigo.trim(),
        descricao: e.descricao.trim(),
        procedimento_item_faturavel_id: e.principal,
        tipo_pacote: e.tipo,
        regime: e.regime,
        quantidade_diarias: e.diarias,
        valor_global: e.valorGlobal,
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
        inclusoes: e.inclusoes?.trim() || null,
        ativo: true,
      });
      const itens = e.itens.some((i) => i.item === e.principal)
        ? e.itens
        : [{ item: e.principal, inclusao: 'incluido' as const, quantidade: 1 }, ...e.itens];
      for (const [k, i] of itens.entries())
        await tx.incluir('pacote_remuneracao_rede_item', {
          pacote_remuneracao_rede_id: id,
          sequencia: k + 1,
          item_faturavel_id: i.item,
          inclusao: i.inclusao,
          quantidade_padrao: i.quantidade,
          principal: i.item === e.principal,
        });
      return { id, versao: 1, tabela: 'pacote_remuneracao_rede' };
    });
  }

  /**
   * Reajusta o contrato: grava o reajuste e, na tabela escolhida (o grupo, se informado), encerra cada item vigente na
   * véspera do início e inclui o item reajustado a partir dele; na tabela em unidades sem grupo, reajusta o valor das
   * unidades. Devolve quantos itens foram reajustados.
   */
  async reajustar(
    c: ContextoPorta,
    contrato: number,
    e: ReajusteRedeCadastro & { tabela: number | null; grupo: number | null },
    trilha: Trilha,
  ) {
    exigir(problemasDoReajusteRede(e));
    return this.gravar(c, 'operadora.remuneracao.reajuste.aplicar', trilha, async (tx, est) => {
      const [k] = await tx.consultarParaAtualizar(
        'SELECT id, prestador_rede_id, operadora_saude_id FROM contrato_rede_prestador WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [contrato, est],
        { teto: 1 },
      );
      if (!k) throw naoEncontrado();
      const prestador = Number(k['prestador_rede_id']);
      let itens = 0;
      if (e.tabela !== null) {
        const t = await PortaRemuneracaoRedePropria.tabelaDaOperadora(tx, est, e.tabela);
        const vigentes = await tx.consultarParaAtualizar(
          `SELECT * FROM tabela_remuneracao_rede_item
            WHERE tabela_remuneracao_rede_id = ? AND excluido_em IS NULL AND (? IS NULL OR grupo_procedimento_operadora_id = ?)
              AND (prestador_rede_id IS NULL OR prestador_rede_id = ?)
              AND vigencia_inicio < ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
          [e.tabela, e.grupo, e.grupo, prestador, e.inicio, e.inicio],
          { teto: 5000 },
        );
        const seq = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) AS s FROM tabela_remuneracao_rede_item WHERE tabela_remuneracao_rede_id = ?',
          [e.tabela],
        );
        let proxima = Number(seq?.['s'] ?? 0);
        for (const i of vigentes) {
          const fimAntigo = dataIso(i['vigencia_fim']);
          await tx.alterar('tabela_remuneracao_rede_item', Number(i['id']), Number(i['versao']), {
            vigencia_fim: diaAnterior(e.inicio),
          });
          const v = numero(i['valor']);
          proxima += 1;
          await tx.incluir('tabela_remuneracao_rede_item', {
            tabela_remuneracao_rede_id: e.tabela,
            sequencia: proxima,
            tipo_item: textoObrigatorio(i['tipo_item']),
            procedimento_termo_terminologia_id: inteiro(i['procedimento_termo_terminologia_id']),
            grupo_procedimento_operadora_id: inteiro(i['grupo_procedimento_operadora_id']),
            prestador_rede_id: inteiro(i['prestador_rede_id']),
            local_atendimento_rede_id: inteiro(i['local_atendimento_rede_id']),
            produto_plano_id: inteiro(i['produto_plano_id']),
            especialidade_medica_id: inteiro(i['especialidade_medica_id']),
            porte_procedimento_id: inteiro(i['porte_procedimento_id']),
            valor: v === null ? null : reajustarValor(v, e.percentual),
            valor_custo: numero(i['valor_custo']),
            quantidade_ch: numero(i['quantidade_ch']),
            quantidade_uco: numero(i['quantidade_uco']),
            quantidade_filme: numero(i['quantidade_filme']),
            percentual: numero(i['percentual']),
            prioridade: Number(i['prioridade']),
            vigencia_inicio: e.inicio,
            vigencia_fim: fimAntigo,
          });
          itens += 1;
        }
        if (e.grupo === null && textoObrigatorio(t['tipo_valor']) === 'indice') {
          const u = (x: unknown) => {
            const n = numero(x);
            return n === null ? null : reajustarUnidade(n, e.percentual);
          };
          await tx.alterar('tabela_remuneracao_rede', e.tabela, Number(t['versao']), {
            valor_ch: u(t['valor_ch']),
            valor_uco: u(t['valor_uco']),
            valor_filme: u(t['valor_filme']),
          });
        }
      }
      const id = await tx.incluir('reajuste_contrato_rede', {
        contrato_rede_prestador_id: contrato,
        operacao: 'inclusao',
        dados: JSON.stringify({ itensReajustados: itens }),
        ocorrido_em: new Date(),
        usuario_id: c.usuario ?? null,
        prestador_rede_id: prestador,
        tabela_remuneracao_rede_id: e.tabela,
        grupo_procedimento_operadora_id: e.grupo,
        forma: e.forma,
        indice_reajuste_plano_id: e.indice,
        percentual: e.percentual,
        data_base: e.dataBase,
        vigencia_inicio: e.inicio,
        proximo_reajuste: proximoReajuste(e.dataBase),
        atualiza_excecoes: true,
        descricao: e.descricao?.trim() || null,
      });
      return { id, versao: 1, tabela: 'reajuste_contrato_rede', itens };
    });
  }

  async incluirCalendario(c: ContextoPorta, op: number, e: CalendarioPagamentoCadastro, trilha: Trilha) {
    exigir(problemasDoCalendario(e));
    return this.gravar(c, 'operadora.remuneracao.calendario.incluir', trilha, async (tx, est) => {
      await PortaRemuneracaoRedePropria.operadora(tx, est, op);
      if (e.prestador !== null) await PortaRemuneracaoRedePropria.prestador(tx, est, e.prestador);
      if (
        await tx.uma(
          'SELECT 1 AS ok FROM calendario_pagamento_rede WHERE operadora_saude_id = ? AND competencia = ? AND prestador_rede_id <=> ?',
          [op, e.competencia, e.prestador],
        )
      )
        throw recusa('competencia-em-uso', 'A competência já tem calendário para este alcance.', {
          campos: ['competencia'],
        });
      const id = await tx.incluir('calendario_pagamento_rede', {
        operadora_saude_id: op,
        competencia: e.competencia,
        prestador_rede_id: e.prestador,
        atendimento_inicio: e.atendimentoInicio,
        atendimento_fim: e.atendimentoFim,
        entrega_inicio: e.entregaInicio,
        entrega_fim: e.entregaFim,
        data_corte: e.corte,
        data_pagamento: e.pagamento,
        dias_para_pagamento: diasParaPagamento(e.atendimentoFim, e.pagamento),
        fechado: false,
      });
      return { id, versao: 1, tabela: 'calendario_pagamento_rede' };
    });
  }

  fecharCalendario(c: ContextoPorta, id: number, versao: number, trilha: Trilha) {
    return this.gravar(c, 'operadora.remuneracao.calendario.fechar', trilha, async (tx, est) => {
      const [k] = await tx.consultarParaAtualizar(
        `SELECT k.id, k.fechado FROM calendario_pagamento_rede k
           JOIN operadora_saude_estabelecimento o ON o.operadora_saude_id = k.operadora_saude_id AND o.estabelecimento_id = ? AND o.excluido_em IS NULL
          WHERE k.id = ?`,
        [est, id],
        { teto: 1 },
      );
      if (!k) throw naoEncontrado();
      if (booleano(k['fechado'])) throw recusa('ja-fechado', 'A competência já está fechada.');
      const v = await tx.alterar('calendario_pagamento_rede', id, versao, {
        fechado: true,
        fechado_em: new Date(),
      });
      return { id, versao: v, tabela: 'calendario_pagamento_rede' };
    });
  }

  /** Adiantamento ao prestador: grava o adiantamento e o título a pagar dele (tipo adiantamento). */
  async incluirAdiantamento(
    c: ContextoPorta,
    prestador: number,
    e: AdiantamentoCadastro & { natureza: number; documento: number; vencimento: string },
    trilha: Trilha,
  ) {
    exigir(problemasDoAdiantamento(e));
    return this.gravar(c, 'operadora.remuneracao.adiantamento.incluir', trilha, async (tx, est) => {
      const p = await PortaRemuneracaoRedePropria.prestador(tx, est, prestador);
      const carimbo = { usuario: c.usuario ?? null, agora: new Date() };
      await garantirSequencia(
        tx,
        { tipo: 'adiantamento_rede', estabelecimento: est, prefixo: 'AD-' },
        carimbo,
      );
      const numeroAd = (await tx.proximoNumero('adiantamento_rede')).formatado;
      const titulo = await gerarTitulo(tx, est, c, p, {
        natureza: e.natureza,
        documento: e.documento,
        numeroDocumento: numeroAd,
        vencimento: e.vencimento,
        bruto: e.valor,
        desconto: 0,
        retencoes: [],
        tipoTitulo: 'adiantamento',
        referente: `Adiantamento ao prestador ${numeroAd}`,
      });
      const id = await tx.incluir('adiantamento_rede', {
        estabelecimento_id: est,
        numero: numeroAd,
        prestador_rede_id: prestador,
        descricao: e.descricao.trim(),
        data_adiantamento: e.data,
        valor: e.valor,
        valor_compensado: 0,
        quantidade_parcelas_compensacao: e.parcelas,
        competencia_inicio_compensacao: e.inicioCompensacao,
        titulo_pagar_id: titulo.titulo,
        situacao: 'aberto',
      });
      return { id, versao: 1, tabela: 'adiantamento_rede', titulo: titulo.titulo, numero: numeroAd };
    });
  }

  /** Cria o lote calculado: as contas analisadas do prestador, os tributos retidos e a prévia da compensação. */
  async criarLote(c: ContextoPorta, op: number, e: NovoLote, trilha: Trilha) {
    exigir(problemasDoLotePagamento(e));
    return this.gravar(c, 'operadora.remuneracao.lote.criar', trilha, async (tx, est) => {
      await PortaRemuneracaoRedePropria.operadora(tx, est, op);
      const contas = await tx.consultarParaAtualizar(
        `SELECT c.id, c.valor_apresentado, c.valor_glosado, c.valor_liberado FROM lote_conta_recebida c
          WHERE c.estabelecimento_id = ? AND c.operadora_saude_id = ? AND c.prestador_rede_id = ? AND c.situacao = 'analisada'
            AND c.id IN (${e.contas.map(() => '?').join(', ')})
            AND NOT EXISTS (SELECT 1 FROM lote_pagamento_rede_item i JOIN lote_pagamento_rede lp ON lp.id = i.lote_pagamento_rede_id
                             WHERE i.lote_conta_recebida_id = c.id AND lp.situacao <> 'cancelado' AND i.situacao <> 'estornado')`,
        [est, op, e.prestador, ...e.contas],
        { teto: e.contas.length },
      );
      if (contas.length !== e.contas.length)
        throw recusa(
          'conta-indisponivel',
          'Uma conta não está analisada, é de outro prestador ou já está em outro lote.',
          {
            campos: ['contas'],
          },
        );
      const p = await PortaRemuneracaoRedePropria.prestador(tx, est, e.prestador);
      const tributos = await tributosDoCadastro(tx, est, p, e.tributos, e.vencimento);
      const bruto = contas.reduce((s, x) => s + num0(x['valor_liberado']), 0);
      if (!(bruto > 0))
        throw recusa('lote-sem-valor', 'As contas escolhidas não têm valor liberado.', {
          campos: ['contas'],
        });
      const calc = calcularPagamento(bruto, tributos, [], e.competencia);
      exigir(problemasDoCalculoPagamento(calc));
      const carimbo = { usuario: c.usuario ?? null, agora: new Date() };
      await garantirSequencia(
        tx,
        { tipo: 'lote_pagamento_rede', estabelecimento: est, prefixo: 'PR-' },
        carimbo,
      );
      const numeroLote = (await tx.proximoNumero('lote_pagamento_rede')).formatado;
      const id = await tx.incluir('lote_pagamento_rede', {
        estabelecimento_id: est,
        operadora_saude_id: op,
        numero: numeroLote,
        competencia: e.competencia,
        prestador_rede_id: e.prestador,
        tipo_folha: 'producao',
        data_vencimento: e.vencimento,
        mensagem_prestador: e.mensagemPrestador?.trim() || null,
        gera_titulo_pagar: true,
        valor_bruto: calc.bruto,
        valor_tributos: calc.valorTributos,
        valor_liquido: calc.liquidoLote,
        situacao: 'calculado',
        processado_em: new Date(),
      });
      for (const [k, x] of contas.entries())
        await tx.incluir('lote_pagamento_rede_item', {
          lote_pagamento_rede_id: id,
          sequencia: k + 1,
          prestador_rede_id: e.prestador,
          lote_conta_recebida_id: Number(x['id']),
          valor_apresentado: num0(x['valor_apresentado']),
          valor_glosado: num0(x['valor_glosado']),
          valor_pago: num0(x['valor_liberado']),
          situacao: 'incluido',
        });
      for (const [k, t] of calc.tributos.entries())
        await tx.incluir('lote_pagamento_rede_tributo', {
          lote_pagamento_rede_id: id,
          sequencia: k + 1,
          prestador_rede_id: e.prestador,
          tributo_id: t.tributo,
          valor_remuneracao: calc.bruto,
          valor_base_antes_retencao: calc.bruto,
          valor_base_calculo: t.base,
          aliquota: t.aliquota,
          valor_deducao: t.deducao,
          valor_imposto: t.imposto,
          valor_retido: t.retido,
          detalhamento: (tributos[k]?.detalhamento ?? '').slice(0, 1000) || null,
        });
      return {
        id,
        versao: 1,
        tabela: 'lote_pagamento_rede',
        numero: numeroLote,
        calculo: calc,
        excecoes: tributos.filter((t) => t.excecao).map((t) => t.tributo),
      };
    });
  }

  /**
   * Fecha o lote: compensa os adiantamentos em compensação (débito avulso do prestador ligado ao lote), gera o título
   * a pagar com as retenções e liga o título às contas e aos tributos do lote.
   */
  fecharLote(
    c: ContextoPorta,
    id: number,
    x: { versao: number; natureza: number; documento: number },
    trilha: Trilha,
  ) {
    return this.gravar(c, 'operadora.remuneracao.lote.fechar', trilha, async (tx, est) => {
      const [lote] = await tx.consultarParaAtualizar(
        'SELECT * FROM lote_pagamento_rede WHERE id = ? AND estabelecimento_id = ?',
        [id, est],
        { teto: 1 },
      );
      if (!lote) throw naoEncontrado();
      if (textoObrigatorio(lote['situacao']) !== 'calculado')
        throw recusa('lote-nao-calculado', 'Só o lote calculado pode ser fechado.');
      const prestador = Number(lote['prestador_rede_id']);
      const competencia = dataIso(lote['competencia']) ?? '';
      const p = await PortaRemuneracaoRedePropria.prestador(tx, est, prestador);
      const tributos = await tx.consultarParaAtualizar(
        'SELECT * FROM lote_pagamento_rede_tributo WHERE lote_pagamento_rede_id = ? ORDER BY sequencia',
        [id],
        { teto: 50 },
      );
      const adiant = await tx.consultarParaAtualizar(
        `SELECT id, versao, valor, valor_compensado, quantidade_parcelas_compensacao, competencia_inicio_compensacao
           FROM adiantamento_rede WHERE estabelecimento_id = ? AND prestador_rede_id = ? AND situacao IN ('aberto','compensando')`,
        [est, prestador],
        { teto: 200 },
      );
      // Os tributos ficaram calculados no lote; aqui só a compensação, sobre o líquido do lote.
      const comp: CalculoPagamento = calcularPagamento(
        num0(lote['valor_liquido']),
        [],
        adiant.map((a) => ({
          id: Number(a['id']),
          valor: num0(a['valor']),
          compensado: num0(a['valor_compensado']),
          parcelas: Number(a['quantidade_parcelas_compensacao']),
          inicioCompensacao: dataIso(a['competencia_inicio_compensacao']),
        })),
        competencia,
      );
      const calc = {
        bruto: num0(lote['valor_bruto']),
        valorCompensado: comp.valorCompensado,
        compensacoes: comp.compensacoes,
        liquidoTitulo: comp.liquidoTitulo,
        tributos: tributos.map((t) => ({
          tributo: Number(t['tributo_id']),
          base: num0(t['valor_base_calculo']),
          aliquota: num0(t['aliquota']),
          deducao: num0(t['valor_deducao']),
          retido: num0(t['valor_retido']),
        })),
      };
      const titulo = await gerarTitulo(tx, est, c, p, {
        natureza: x.natureza,
        documento: x.documento,
        numeroDocumento: textoObrigatorio(lote['numero']),
        vencimento: dataIso(lote['data_vencimento']) ?? hojeIso(),
        bruto: calc.bruto,
        desconto: calc.valorCompensado,
        retencoes: calc.tributos.filter((t) => t.retido > 0),
        tipoTitulo: 'normal',
        referente: `Pagamento da produção ${competencia.slice(0, 7)} (${textoObrigatorio(lote['numero'])})`,
      });
      for (const [k, t] of tributos.entries()) {
        const ret = titulo.retencoes.get(Number(t['tributo_id'])) ?? null;
        await tx.alterar('lote_pagamento_rede_tributo', Number(t['id']), Number(t['versao']), {
          retencao_titulo_id: ret,
          tipo_documento_financeiro_id: x.documento,
          detalhamento: [texto(t['detalhamento']), `Retenção ${k + 1} do título ${titulo.numero}`]
            .filter(Boolean)
            .join('; ')
            .slice(0, 1000),
        });
      }
      const itens = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM lote_pagamento_rede_item WHERE lote_pagamento_rede_id = ?',
        [id],
        { teto: 5000 },
      );
      for (const i of itens)
        await tx.alterar('lote_pagamento_rede_item', Number(i['id']), Number(i['versao']), {
          titulo_pagar_id: titulo.titulo,
        });
      // A conta do lote fechado fica paga pelo título (valor liberado, data e documento), na mesma transação: sai do
      // painel "a pagar" e não pode ser paga de novo pelo pagamento avulso da conta.
      const contas = await tx.consultarParaAtualizar(
        `SELECT c.id, c.versao, c.situacao, i.valor_pago FROM lote_pagamento_rede_item i
           JOIN lote_conta_recebida c ON c.id = i.lote_conta_recebida_id
          WHERE i.lote_pagamento_rede_id = ? AND i.situacao <> 'estornado'`,
        [id],
        { teto: 5000 },
      );
      for (const k of contas) {
        if (textoObrigatorio(k['situacao']) !== 'analisada')
          throw recusa(
            'conta-indisponivel',
            'Uma conta do lote não está mais analisada (paga ou devolvida).',
            {
              campos: ['contas'],
            },
          );
        await tx.alterar('lote_conta_recebida', Number(k['id']), Number(k['versao']), {
          situacao: 'paga',
          valor_pago: num0(k['valor_pago']),
          pago_em: hojeIso(),
          documento_pagamento: `${titulo.numero} (${textoObrigatorio(lote['numero'])})`.slice(0, 60),
        });
      }
      const versaoAd = new Map(adiant.map((a) => [Number(a['id']), a] as const));
      for (const comp of calc.compensacoes) {
        const a = versaoAd.get(comp.id);
        if (!a) continue;
        await tx.alterar('adiantamento_rede', comp.id, Number(a['versao']), {
          valor_compensado: Math.round((num0(a['valor_compensado']) + comp.valor) * 100) / 100,
          situacao: comp.quitado ? 'compensado' : 'compensando',
        });
        const seq = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM lancamento_avulso_prestador WHERE prestador_rede_id = ?',
          [prestador],
        );
        await tx.incluir('lancamento_avulso_prestador', {
          estabelecimento_id: est,
          prestador_rede_id: prestador,
          sequencia: Number(seq?.['s'] ?? 1),
          natureza: 'debito',
          tipo: 'adiantamento',
          descricao: `Compensação do adiantamento ${comp.id} no lote ${textoObrigatorio(lote['numero'])}`,
          competencia,
          valor: comp.valor,
          lote_pagamento_rede_id: id,
          titulo_pagar_id: titulo.titulo,
        });
      }
      const v = await tx.alterar('lote_pagamento_rede', id, x.versao, {
        situacao: 'fechado',
        fechado_em: new Date(),
        fechado_por_usuario_id: c.usuario ?? null,
        data_lancamento: hojeIso(),
      });
      return {
        id,
        versao: v,
        tabela: 'lote_pagamento_rede',
        titulo: titulo.titulo,
        tituloNumero: titulo.numero,
        compensado: calc.valorCompensado,
        liquidoTitulo: calc.liquidoTitulo,
      };
    });
  }

  /** Cancela o lote ainda não fechado: as contas voltam a ficar disponíveis; a linha fica com o histórico. */
  cancelarLote(c: ContextoPorta, id: number, versao: number, trilha: Trilha) {
    return this.gravar(c, 'operadora.remuneracao.lote.cancelar', trilha, async (tx, est) => {
      const [lote] = await tx.consultarParaAtualizar(
        'SELECT id, situacao FROM lote_pagamento_rede WHERE id = ? AND estabelecimento_id = ?',
        [id, est],
        { teto: 1 },
      );
      if (!lote) throw naoEncontrado();
      if (!['rascunho', 'calculado'].includes(textoObrigatorio(lote['situacao'])))
        throw recusa('lote-fechado', 'O lote fechado já gerou título; cancele o título no financeiro.');
      const v = await tx.alterar('lote_pagamento_rede', id, versao, { situacao: 'cancelado' });
      return { id, versao: v, tabela: 'lote_pagamento_rede' };
    });
  }
}

function regraDe(r: Record<string, unknown>): RegraParaEscolha & { versao: number } {
  const hora = (v: unknown) => texto(v)?.slice(0, 5) ?? null;
  return {
    id: Number(r['id']),
    versao: Number(r['versao']),
    prioridade: Number(r['prioridade']),
    prestador: inteiro(r['prestador_rede_id']),
    tipoPrestador: inteiro(r['tipo_prestador_rede_id']),
    grupo: inteiro(r['grupo_procedimento_operadora_id']),
    item: inteiro(r['item_faturavel_id']),
    tabela: Number(r['tabela_remuneracao_rede_id']),
    fator: num0(r['fator']),
    acrescimo: numero(r['percentual_acrescimo']),
    diaSemana: inteiro(r['urgencia_dia_semana']),
    horaInicio: hora(r['urgencia_hora_inicio']),
    horaFim: hora(r['urgencia_hora_fim']),
    inicio: dataIso(r['vigencia_inicio']) ?? '',
    fim: dataIso(r['vigencia_fim']),
  };
}

/**
 * Os tributos do lote pelo cadastro, na data do pagamento: a alíquota de retenção vigente para o tipo de pessoa do
 * prestador, o mínimo de retenção (o da vigência, senão o do tributo) e o enquadramento tributário vigente do
 * fornecedor com o documento do prestador (o do tributo vale sobre o geral).
 */
async function tributosDoCadastro(
  tx: TxOperacao,
  est: number,
  p: Record<string, unknown>,
  informados: readonly TributoInformado[],
  data: string,
): Promise<TributoResolvido[]> {
  if (!informados.length) return [];
  const pessoa = texto(p['pessoa']) === 'fisica' ? 'fisica' : 'juridica';
  const vigencia = `FROM aliquota_tributo_vigencia v WHERE v.tributo_id = t.id AND v.estabelecimento_id = ?
      AND v.aplicacao = 'retencao_pagar' AND v.ativo = TRUE AND v.tipo_pessoa IN ('todas', ?)
      AND v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
    ORDER BY v.tipo_pessoa = 'todas', v.vigencia_inicio DESC LIMIT 1`;
  const ts = await tx.consultar(
    `SELECT t.id, t.codigo, t.valor_minimo_retencao AS minimo_tributo,
            (SELECT v.aliquota ${vigencia}) AS aliquota,
            (SELECT v.valor_minimo_retencao ${vigencia}) AS minimo_vigencia
       FROM tributo t
      WHERE t.ativo = TRUE AND t.incidencia IN ('retido','ambos') AND t.id IN (${informados.map(() => '?').join(', ')})`,
    [est, pessoa, data, data, est, pessoa, data, data, ...informados.map((t) => t.tributo)],
    { teto: informados.length },
  );
  if (ts.length !== informados.length)
    throw recusa('referencia-inexistente', 'Um tributo retido não existe no cadastro.', {
      campos: ['tributos'],
    });
  const documento = texto(p['cnpj']) ?? texto(p['cpf']);
  const enqs = documento
    ? await tx.consultar(
        `SELECT e.tributo_id, e.regime, e.retem_tributo, e.aliquota_iss
           FROM enquadramento_tributario_participante e
           JOIN empresa_fornecedora f ON f.id = e.empresa_fornecedora_id
          WHERE e.ativo = TRUE AND (e.estabelecimento_id IS NULL OR e.estabelecimento_id = ?) AND f.excluido_em IS NULL
            AND (f.cnpj = ? OR f.cpf = ?) AND e.vigencia_inicio <= ? AND (e.vigencia_fim IS NULL OR e.vigencia_fim >= ?)
          ORDER BY e.tributo_id IS NULL, e.vigencia_inicio DESC`,
        [est, documento, documento, data, data],
        { teto: 100 },
      )
    : [];
  const porId = new Map(ts.map((r) => [Number(r['id']), r] as const));
  const problemas: ProblemaRemuneracao[] = [];
  const out: TributoResolvido[] = [];
  for (const inf of informados) {
    const r = porId.get(inf.tributo)!;
    const enq = enqs.find((x) => inteiro(x['tributo_id']) === inf.tributo || x['tributo_id'] === null);
    const cad: TributoDoCadastro = {
      tributo: inf.tributo,
      codigo: textoObrigatorio(r['codigo']),
      aliquota: numero(r['aliquota']),
      minimo: numero(r['minimo_vigencia']) ?? numero(r['minimo_tributo']),
      enquadramento: enq
        ? {
            regime: textoObrigatorio(enq['regime']),
            retem: booleano(enq['retem_tributo']),
            aliquotaIss: numero(enq['aliquota_iss']),
          }
        : null,
    };
    const x = resolverTributoDoLote(cad, inf);
    problemas.push(...x.problemas);
    if (x.tributo) out.push(x.tributo);
  }
  exigir(problemas);
  return out;
}

/** Credor do título: o profissional (prestador pessoa física da saúde) ou a empresa pelo documento (criada se faltar). */
async function credorDoPrestador(
  tx: TxOperacao,
  p: Record<string, unknown>,
): Promise<{ coluna: 'profissional_id' | 'empresa_fornecedora_id'; id: number }> {
  const profissional = inteiro(p['profissional_id']);
  if (profissional !== null) return { coluna: 'profissional_id', id: profissional };
  const cnpj = texto(p['cnpj']);
  const cpf = texto(p['cpf']);
  if (!cnpj && !cpf)
    throw recusa('prestador-sem-documento', 'O prestador não tem CNPJ nem CPF para o título a pagar.', {
      campos: ['prestador'],
    });
  const achada = await tx.uma(
    cnpj
      ? 'SELECT id FROM empresa_fornecedora WHERE cnpj = ? AND excluido_em IS NULL ORDER BY id LIMIT 1'
      : 'SELECT id FROM empresa_fornecedora WHERE cpf = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
    [cnpj ?? cpf],
  );
  if (achada) return { coluna: 'empresa_fornecedora_id', id: Number(achada['id']) };
  const id = await tx.incluir('empresa_fornecedora', {
    tipo_pessoa: cnpj ? 'juridica' : 'fisica',
    cnpj,
    cpf: cnpj ? null : cpf,
    razao_social: textoObrigatorio(p['nome']),
    prestador_servico: true,
    situacao: 'ativo',
  });
  return { coluna: 'empresa_fornecedora_id', id };
}

/** Título a pagar ao prestador (uma parcela no vencimento) com as retenções do lote. */
async function gerarTitulo(
  tx: TxOperacao,
  est: number,
  c: ContextoPorta,
  p: Record<string, unknown>,
  t: {
    natureza: number;
    documento: number;
    numeroDocumento: string;
    vencimento: string;
    bruto: number;
    desconto: number;
    retencoes: readonly {
      tributo: number;
      base: number;
      aliquota: number;
      deducao: number;
      retido: number;
    }[];
    tipoTitulo: 'normal' | 'adiantamento';
    referente: string;
  },
): Promise<{ titulo: number; numero: string; retencoes: Map<number, number> }> {
  if (
    !(await tx.uma(
      "SELECT 1 AS ok FROM natureza_financeira WHERE id = ? AND ativo = TRUE AND tipo = 'despesa'",
      [t.natureza],
    ))
  )
    throw recusa('referencia-inexistente', 'A natureza financeira não existe ou não é de despesa.', {
      campos: ['natureza'],
    });
  if (
    !(await tx.uma(
      "SELECT 1 AS ok FROM tipo_documento_financeiro WHERE id = ? AND ativo = TRUE AND sentido IN ('pagar','ambos')",
      [t.documento],
    ))
  )
    throw recusa('referencia-inexistente', 'O tipo de documento não serve para contas a pagar.', {
      campos: ['documento'],
    });
  const tipoCredor = await tx.uma(
    `SELECT id FROM tipo_credor WHERE ativo = TRUE AND sentido IN ('pagar','ambos') AND natureza IN ('prestador','fornecedor','medico')
      ORDER BY FIELD(natureza, 'prestador', 'fornecedor', 'medico'), id LIMIT 1`,
    [],
  );
  if (!tipoCredor)
    throw recusa('tipo-credor-ausente', 'Cadastre o tipo de credor de prestador no financeiro.', {
      campos: ['natureza'],
    });
  const credor = await credorDoPrestador(tx, p);
  const carimbo = { usuario: c.usuario ?? null, agora: new Date() };
  await garantirSequencia(tx, { tipo: 'titulo_pagar', estabelecimento: est, prefixo: 'TP-' }, carimbo);
  const num = await tx.proximoNumero('titulo_pagar');
  const retido = Math.round(t.retencoes.reduce((s, r) => s + r.retido, 0) * 100) / 100;
  const hoje = hojeIso();
  const titulo = await tx.incluir('titulo_pagar', {
    estabelecimento_id: est,
    numero: num.formatado,
    tipo_credor_id: Number(tipoCredor['id']),
    [credor.coluna]: credor.id,
    tipo_titulo: t.tipoTitulo,
    modulo_origem: 'contrato',
    tipo_documento_financeiro_id: t.documento,
    numero_documento: t.numeroDocumento,
    data_emissao: hoje,
    data_lancamento: hoje,
    data_prevista_pagamento: t.vencimento,
    valor_bruto: t.bruto,
    valor_desconto: t.desconto,
    valor_retencoes: retido,
    valor_liquido: Math.round((t.bruto - t.desconto - retido) * 100) / 100,
    quantidade_parcelas: 1,
    natureza_financeira_id: t.natureza,
    referente: t.referente.slice(0, 150),
  });
  const valorParcela = Math.round((t.bruto - t.desconto) * 100) / 100;
  const parcela = await tx.incluir('parcela_pagar', {
    titulo_pagar_id: titulo,
    sequencia: 1,
    vencimento: t.vencimento,
    vencimento_original: t.vencimento,
    valor: valorParcela,
    saldo: valorParcela,
  });
  const retencoes = new Map<number, number>();
  for (const [i, r] of t.retencoes.entries())
    retencoes.set(
      r.tributo,
      await tx.incluir('retencao_titulo', {
        parcela_pagar_id: parcela,
        sequencia: i + 1,
        tributo_id: r.tributo,
        competencia: `${hoje.slice(0, 7)}-01`,
        data_fato_gerador: hoje,
        base_calculo: r.base,
        valor_deducao: r.deducao,
        aliquota: r.aliquota,
        valor_retido: r.retido,
      }),
    );
  return { titulo, numero: num.formatado, retencoes };
}

export const METODOS_REMUNERACAO_REDE: ReadonlySet<string> = new Set([
  'opcoes',
  'procedimentos',
  'tabelas',
  'itens',
  'regras',
  'pacotes',
  'reajustes',
  'calendario',
  'prestadorPagamento',
  'lotes',
  'valorar',
  'incluirTabela',
  'incluirItem',
  'incluirRegra',
  'incluirPacote',
  'reajustar',
  'incluirCalendario',
  'fecharCalendario',
  'incluirAdiantamento',
  'criarLote',
  'fecharLote',
  'cancelarLote',
]);
