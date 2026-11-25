// Porta própria do reembolso ao beneficiário (08-SGO linha 106, C2-047; F7) sobre o banco do cliente:
//   - tabela_reembolso_referencia (+ _item): a tabela de referência da operadora por município e produto, com vigência;
//   - regra_reembolso_plano: o multiplicador, o percentual, os tetos e o prazo de pagamento de cada plano;
//   - pedido_reembolso (+ _item): o pedido com o prestador do recibo, os itens e o limite de cada um calculado na entrada
//     (tabela escolhida pelo município do atendimento); os comprovantes vão pela porta de arquivos (ADR 0004: disco local,
//     metadado em `arquivo` com o pedido como dono);
//   - pedido_reembolso_glosa: a glosa por item com motivo padronizado, valor e responsável, gravada na conclusão da
//     análise (nunca apagada); o pedido e os itens recebem os valores do domínio (tetos por evento e anual);
//   - o pagamento: o pedido vai a pago e o crédito do reembolso entra na conta corrente do beneficiário
//     (lancamento_conta_beneficiario, tipo reembolso), na mesma transação.
// A regra vem do domínio (reembolso.ts); o banco só guarda. Cada gravação é uma operação do Executor (trilha na mesma
// transação). O escopo é o estabelecimento da sessão (fora, 404).
import {
  analisarReembolso,
  type CanalReembolso,
  diasParaOPrazo,
  type EntradaPedidoReembolso,
  emAnaliseReembolso,
  escolherTabelaReferencia,
  type GlosaItemReembolso,
  limiteDoItem,
  podePassarReembolso,
  prazoDoReembolso,
  problemasDaRegraReembolso,
  problemasDoPedidoReembolso,
  REGRA_REEMBOLSO_SEM_CADASTRO,
  type RegraReembolso,
  type SituacaoReembolso,
  tipoPessoaDoDocumento,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Escritor,
  type Executor,
  garantirSequencia,
  type Leitor,
  type NucleoArmazem,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { type ArquivosDoModulo, arquivosDoAmbiente } from '../arquivos-locais.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  inicioLike,
  instanteIso,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
  trechoLike,
} from './apoio-banco.js';

export const PORTA_REEMBOLSO = Symbol('PORTA_REEMBOLSO_OPERADORA');

export const TABELAS_REEMBOLSO = [
  'tabela_reembolso_referencia',
  'tabela_reembolso_referencia_item',
  'regra_reembolso_plano',
  'pedido_reembolso',
  'pedido_reembolso_item',
  'pedido_reembolso_glosa',
  'lancamento_conta_beneficiario',
  'arquivo',
  // A numeração do pedido (garantirSequencia na primeira gravação do estabelecimento).
  'sequencia_negocio',
] as const;

/** Finalidade e dono do comprovante na porta de arquivos. */
export const FINALIDADE_COMPROVANTE_REEMBOLSO = 'comprovante_reembolso';
const DONO_ANEXO = 'pedido_reembolso';
const TIPOS_ANEXO = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const TAMANHO_MAXIMO_ANEXO = 5 * 1024 * 1024;

export type Gravado = { readonly id: number; readonly versao: number };
type Trilha = (r: Gravado) => RegistroTrilhaTela;
type Problema = { codigo: string; campo?: string };

const TEXTO_PROBLEMA: Readonly<Record<string, string>> = {
  'prestador-obrigatorio': 'Informe o prestador como consta no recibo ou na nota.',
  'documento-invalido': 'Confira o CPF ou o CNPJ do prestador (dígito verificador).',
  'data-atendimento-invalida': 'A data do atendimento não pode ser futura.',
  'alta-antes-do-atendimento': 'A alta não pode ser antes do atendimento.',
  'itens-obrigatorios': 'Inclua ao menos um procedimento.',
  'quantidade-invalida': 'A quantidade tem de ser maior que zero.',
  'valor-invalido': 'O valor apresentado tem de ser maior que zero.',
  'data-realizacao-invalida': 'A data de realização não pode ser futura.',
  'comprovante-obrigatorio': 'Anexe ao menos o recibo ou a nota fiscal (PDF, PNG ou JPEG).',
  'multiplicador-invalido': 'O multiplicador tem de ser maior que zero.',
  'base-obrigatoria': 'Escolha a tabela de referência ou informe o percentual reembolsado.',
  'percentual-invalido': 'O percentual vai de 0,01 a 100.',
  'limite-invalido': 'O teto tem de ser maior que zero.',
  'prazo-acima-do-legal': 'O prazo de pagamento vai de 1 a 30 dias (RN ANS 566/2022).',
  'glosa-invalida': 'O valor da glosa tem de ser maior que zero.',
  'motivo-obrigatorio': 'Escolha o motivo de glosa padronizado.',
  'coparticipacao-invalida': 'A coparticipação não pode ser negativa.',
  'glosa-acima-do-limite': 'A glosa e a coparticipação passam do valor reembolsável do item.',
};
function exigir(problemas: readonly Problema[]): void {
  const p = problemas[0];
  if (p)
    throw recusa(p.codigo, TEXTO_PROBLEMA[p.codigo] ?? p.codigo, {
      campos: [...new Set(problemas.map((x) => x.campo).filter((x): x is string => !!x))],
    });
}
const naoEncontrado = (o = 'O registro') =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    `${o} não existe neste estabelecimento.`,
  );
const situacaoRecusada = (detalhe: string) => recusa('situacao-invalida', detalhe, { campos: ['situacao'] });
const hojeIso = () => new Date().toISOString().slice(0, 10);

// ── entradas e tipos lidos ────────────────────────────────────────────────────────────────────

export interface AnexoEntrada {
  readonly nome: string;
  readonly tipoMime: string;
  readonly base64: string;
}
export interface EntradaPedido extends EntradaPedidoReembolso {
  readonly modalidade: number | null;
  readonly municipio: number | null;
  readonly observacao: string | null;
  readonly anexos: readonly AnexoEntrada[];
}
export interface EntradaTabela {
  readonly codigo: string;
  readonly nome: string;
  readonly produto: number | null;
  readonly municipio: number | null;
  readonly modalidade: number | null;
  readonly fator: number | null;
  readonly padrao: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly itens: readonly { procedimento: number; valor: number; quantidadeMaxima: number | null }[];
}
export interface EntradaRegra extends RegraReembolso {
  readonly plano: number;
  readonly modalidade: number | null;
  readonly tabela: number | null;
  readonly livreEscolha: boolean;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}
export interface EntradaAnalise {
  readonly versao: number;
  readonly decisao: 'concluir' | 'pendente_documento';
  readonly observacao: string | null;
  readonly itens: readonly { item: number; coparticipacao: number; glosas: readonly GlosaItemReembolso[] }[];
}

export interface PedidoResumo {
  id: number;
  versao: number;
  numero: string;
  beneficiario: { id: number; nome: string; matricula: string };
  prestadorNome: string;
  dataAtendimento: string;
  solicitadoEm: string;
  prazoPagamento: string;
  diasParaOPrazo: number | null;
  atrasado: boolean;
  valorApresentado: number;
  valorGlosado: number;
  valorReembolsado: number;
  situacao: SituacaoReembolso;
}
export interface PedidoDetalhe extends PedidoResumo {
  canal: CanalReembolso;
  prestadorDocumento: string;
  numeroDocumentoFiscal: string | null;
  tabelaReferencia: { id: number; nome: string } | null;
  observacao: string | null;
  analisadoEm: string | null;
  pagoEm: string | null;
  motivoCancelamento: string | null;
  itens: {
    id: number;
    versao: number;
    procedimento: { id: number; codigo: string; descricao: string };
    quantidade: number;
    valorApresentado: number;
    valorLimite: number | null;
    valorGlosado: number;
    valorCoparticipacao: number;
    valorReembolsado: number;
    situacao: string;
    glosas: { motivo: string; valor: number; justificativa: string | null }[];
  }[];
  anexos: { id: number; nome: string; tipoMime: string; bytes: number }[];
}

const procedimentoSql =
  'SELECT id, termo_terminologia_id FROM item_faturavel WHERE id = ? AND excluido_em IS NULL';
const RESUMO_SQL = `SELECT p.id, p.versao, p.numero, p.beneficiario_plano_id, pf.nome AS beneficiario_nome, b.matricula,
         p.prestador_nome, p.data_atendimento, p.solicitado_em, p.prazo_pagamento, p.valor_apresentado,
         p.valor_glosado, p.valor_reembolsado, p.situacao
    FROM pedido_reembolso p
    JOIN beneficiario_plano b ON b.id = p.beneficiario_plano_id
    JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id`;

const DETALHE_SQL = `SELECT p.id, p.versao, p.numero, p.beneficiario_plano_id, pf.nome AS beneficiario_nome, b.matricula,
         p.prestador_nome, p.data_atendimento, p.solicitado_em, p.prazo_pagamento, p.valor_apresentado,
         p.valor_glosado, p.valor_reembolsado, p.situacao, p.canal, p.prestador_cpf_cnpj, p.numero_documento_fiscal,
         p.tabela_reembolso_referencia_id, t.nome AS tabela_nome, p.observacao, p.analisado_em, p.pago_em,
         p.motivo_cancelamento
    FROM pedido_reembolso p
    JOIN beneficiario_plano b ON b.id = p.beneficiario_plano_id
    JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id`;

function resumo(x: Record<string, unknown>, hoje: string): PedidoResumo {
  const situacao = textoObrigatorio(x['situacao']) as SituacaoReembolso;
  const prazo = dataIso(x['prazo_pagamento']) ?? hoje;
  const aberto = !['pago', 'negado', 'cancelado'].includes(situacao);
  const dias = aberto ? diasParaOPrazo(prazo, hoje) : null;
  return {
    id: Number(x['id']),
    versao: Number(x['versao']),
    numero: textoObrigatorio(x['numero']),
    beneficiario: {
      id: Number(x['beneficiario_plano_id']),
      nome: textoObrigatorio(x['beneficiario_nome']),
      matricula: textoObrigatorio(x['matricula']),
    },
    prestadorNome: textoObrigatorio(x['prestador_nome']),
    dataAtendimento: dataIso(x['data_atendimento']) ?? '',
    solicitadoEm: instanteIso(x['solicitado_em']) ?? '',
    prazoPagamento: prazo,
    diasParaOPrazo: dias,
    atrasado: dias !== null && dias < 0,
    valorApresentado: numero(x['valor_apresentado']) ?? 0,
    valorGlosado: numero(x['valor_glosado']) ?? 0,
    valorReembolsado: numero(x['valor_reembolsado']) ?? 0,
    situacao,
  };
}

// ── a porta ───────────────────────────────────────────────────────────────────────────────────

export class PortaReembolsoPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora & Pick<NucleoProprio, 'escrever'>,
    private readonly cliente: string,
    executor?: Executor,
    /** Porta de arquivos (disco local, ADR 0004) para os comprovantes; sem ela, anexar dá 503. */
    private arquivos?: ArquivosDoModulo | null,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private arquivosDe(): ArquivosDoModulo | null {
    if (this.arquivos === undefined)
      this.arquivos = arquivosDoAmbiente(this.nucleo as unknown as NucleoArmazem, this.cliente);
    return this.arquivos;
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-reembolso' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async gravar(
    c: ContextoPorta,
    nome: string,
    tabela: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number) => Promise<Gravado>,
  ): Promise<Gravado> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_REEMBOLSO,
      entrada: z.record(z.string(), z.unknown()),
      acao: 'operacao',
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela, id: r.id }),
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

  private static async operadoraDoEst(l: Leitor | Escritor, est: number, op: number): Promise<void> {
    const x = await l.uma(
      `SELECT 1 AS ok FROM operadora_saude_estabelecimento
        WHERE operadora_saude_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [op, est],
    );
    if (!x) throw naoEncontrado('A operadora');
  }

  private static async pedidoDoEst(l: Leitor | Escritor, est: number, id: number) {
    const x = await l.uma<Record<string, unknown>>(
      `SELECT id, versao, numero, situacao, beneficiario_plano_id, data_atendimento, valor_reembolsado
         FROM pedido_reembolso WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est],
    );
    if (!x) throw naoEncontrado('O pedido de reembolso');
    return {
      id,
      versao: Number(x['versao']),
      numero: textoObrigatorio(x['numero']),
      situacao: textoObrigatorio(x['situacao']) as SituacaoReembolso,
      beneficiario: Number(x['beneficiario_plano_id']),
      dataAtendimento: dataIso(x['data_atendimento']) ?? '',
      reembolsado: numero(x['valor_reembolsado']) ?? 0,
    };
  }

  /** A regra do plano vigente na data (a da modalidade antes da geral) ou a padrão sem cadastro. */
  private static async regraDoPlano(
    l: Leitor | Escritor,
    op: number,
    plano: number,
    modalidade: number | null,
    data: string,
  ): Promise<RegraReembolso & { tabela: number | null }> {
    const r = await l.uma<Record<string, unknown>>(
      `SELECT tabela_reembolso_referencia_id, multiplicador, percentual, limite_por_evento, limite_anual,
              prazo_pagamento_dias
         FROM regra_reembolso_plano
        WHERE operadora_saude_id = ? AND plano_comercializado_id = ? AND ativo = TRUE
          AND (modalidade_reembolso_id = ? OR modalidade_reembolso_id IS NULL)
          AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
        ORDER BY modalidade_reembolso_id IS NULL, vigencia_inicio DESC LIMIT 1`,
      [op, plano, modalidade, data, data],
    );
    if (!r) return { ...REGRA_REEMBOLSO_SEM_CADASTRO, tabela: null };
    return {
      tabela: numero(r['tabela_reembolso_referencia_id']),
      multiplicador: numero(r['multiplicador']) ?? 1,
      percentual: numero(r['percentual']),
      limitePorEvento: numero(r['limite_por_evento']),
      limiteAnual: numero(r['limite_anual']),
      prazoPagamentoDias: numero(r['prazo_pagamento_dias']) ?? 30,
    };
  }

  private static async reembolsadoNoAno(l: Leitor | Escritor, benef: number, data: string, fora: number) {
    const r = await l.uma<{ total: unknown }>(
      `SELECT COALESCE(SUM(valor_reembolsado), 0) AS total FROM pedido_reembolso
        WHERE beneficiario_plano_id = ? AND id <> ? AND excluido_em IS NULL
          AND situacao IN ('aprovado','aprovado_parcial','pago') AND YEAR(data_atendimento) = YEAR(?)`,
      [benef, fora, data],
    );
    return numero(r?.total) ?? 0;
  }

  // ── leituras ──

  /** Operadoras do estabelecimento, modalidades e motivos de glosa vigentes (para as telas). */
  apoio(c: ContextoPorta) {
    return this.ler(c, async (l, est) => {
      const operadoras = await l.consultar(
        `SELECT o.id, o.nome FROM operadora_saude o
           JOIN operadora_saude_estabelecimento e ON e.operadora_saude_id = o.id AND e.excluido_em IS NULL
          WHERE e.estabelecimento_id = ? AND o.excluido_em IS NULL ORDER BY o.nome`,
        [est],
      );
      const modalidades = await l.consultar(
        'SELECT id, codigo, descricao FROM modalidade_reembolso WHERE ativo = TRUE ORDER BY descricao',
      );
      const motivos = await l.consultar(
        `SELECT id, codigo_tuss, descricao FROM motivo_glosa
          WHERE (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE) ORDER BY codigo_tuss LIMIT 500`,
      );
      return {
        operadoras: operadoras.map((x) => ({ id: Number(x['id']), nome: textoObrigatorio(x['nome']) })),
        modalidades: modalidades.map((x) => ({
          id: Number(x['id']),
          codigo: textoObrigatorio(x['codigo']),
          descricao: textoObrigatorio(x['descricao']),
        })),
        motivos: motivos.map((x) => ({
          id: Number(x['id']),
          codigo: textoObrigatorio(x['codigo_tuss']),
          descricao: textoObrigatorio(x['descricao']),
        })),
      };
    });
  }

  /** Busca do apoio: beneficiários (matrícula ou nome), procedimentos (código ou descrição) ou municípios (nome). */
  buscar(c: ContextoPorta, alvo: 'beneficiarios' | 'procedimentos' | 'municipios', termo: string) {
    const t = termo.trim().slice(0, 60);
    if (t.length < 2) return Promise.resolve([] as { id: number; rotulo: string }[]);
    return this.ler(c, async (l, est) => {
      if (alvo === 'beneficiarios') {
        const r = await l.consultar(
          `SELECT b.id, b.matricula, pf.nome FROM beneficiario_plano b
             JOIN contrato_plano k ON k.id = b.contrato_plano_id
             JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
            WHERE k.estabelecimento_id = ? AND b.excluido_em IS NULL AND (b.matricula LIKE ? OR pf.nome LIKE ?)
            ORDER BY pf.nome LIMIT 20`,
          [est, inicioLike(t), trechoLike(t.toUpperCase())],
        );
        return r.map((x) => ({
          id: Number(x['id']),
          rotulo: `${textoObrigatorio(x['matricula'])} · ${textoObrigatorio(x['nome'])}`,
        }));
      }
      if (alvo === 'procedimentos') {
        const r = await l.consultar(
          `SELECT id, codigo, descricao FROM item_faturavel
            WHERE excluido_em IS NULL AND termo_terminologia_id IS NOT NULL AND (codigo LIKE ? OR descricao LIKE ?)
            ORDER BY codigo LIMIT 20`,
          [inicioLike(t), trechoLike(t.toUpperCase())],
        );
        return r.map((x) => ({
          id: Number(x['id']),
          rotulo: `${textoObrigatorio(x['codigo'])} · ${textoObrigatorio(x['descricao'])}`,
        }));
      }
      const r = await l.consultar(
        'SELECT id, codigo_ibge, nome FROM municipio_ibge WHERE ativo = TRUE AND nome LIKE ? ORDER BY nome LIMIT 20',
        [inicioLike(t)],
      );
      return r.map((x) => ({
        id: Number(x['id']),
        rotulo: `${textoObrigatorio(x['nome'])} (${textoObrigatorio(x['codigo_ibge'])})`,
      }));
    });
  }

  /** Tabelas de referência da operadora, com a contagem de procedimentos. */
  tabelas(c: ContextoPorta, op: number) {
    return this.ler(c, async (l, est) => {
      await PortaReembolsoPropria.operadoraDoEst(l, est, op);
      const r = await l.consultar(
        `SELECT t.id, t.versao, t.codigo, t.nome, t.produto_plano_id, t.municipio_ibge_id, m.nome AS municipio_nome,
                t.padrao, t.vigencia_inicio, t.vigencia_fim, t.ativo,
                (SELECT COUNT(*) FROM tabela_reembolso_referencia_item i
                  WHERE i.tabela_reembolso_referencia_id = t.id AND i.excluido_em IS NULL) AS itens
           FROM tabela_reembolso_referencia t LEFT JOIN municipio_ibge m ON m.id = t.municipio_ibge_id
          WHERE t.operadora_saude_id = ? ORDER BY t.ativo DESC, t.codigo`,
        [op],
      );
      return r.map((x) => ({
        id: Number(x['id']),
        versao: Number(x['versao']),
        codigo: textoObrigatorio(x['codigo']),
        nome: textoObrigatorio(x['nome']),
        produto: numero(x['produto_plano_id']),
        municipio:
          x['municipio_ibge_id'] == null
            ? null
            : { id: Number(x['municipio_ibge_id']), nome: textoObrigatorio(x['municipio_nome']) },
        padrao: booleano(x['padrao']),
        vigenciaInicio: dataIso(x['vigencia_inicio']) ?? '',
        vigenciaFim: dataIso(x['vigencia_fim']),
        ativo: booleano(x['ativo']),
        itens: Number(x['itens']),
      }));
    });
  }

  /** Regras de reembolso dos planos da operadora. */
  regras(c: ContextoPorta, op: number) {
    return this.ler(c, async (l, est) => {
      await PortaReembolsoPropria.operadoraDoEst(l, est, op);
      const r = await l.consultar(
        `SELECT g.id, g.versao, g.plano_comercializado_id, p.nome_comercial, g.tabela_reembolso_referencia_id,
                g.multiplicador, g.percentual, g.limite_por_evento, g.limite_anual, g.prazo_pagamento_dias,
                g.vigencia_inicio, g.vigencia_fim, g.ativo
           FROM regra_reembolso_plano g JOIN plano_comercializado p ON p.id = g.plano_comercializado_id
          WHERE g.operadora_saude_id = ? ORDER BY p.nome_comercial, g.vigencia_inicio DESC`,
        [op],
      );
      return r.map((x) => ({
        id: Number(x['id']),
        versao: Number(x['versao']),
        plano: { id: Number(x['plano_comercializado_id']), nome: textoObrigatorio(x['nome_comercial']) },
        tabela: numero(x['tabela_reembolso_referencia_id']),
        multiplicador: numero(x['multiplicador']) ?? 1,
        percentual: numero(x['percentual']),
        limitePorEvento: numero(x['limite_por_evento']),
        limiteAnual: numero(x['limite_anual']),
        prazoPagamentoDias: numero(x['prazo_pagamento_dias']) ?? 30,
        vigenciaInicio: dataIso(x['vigencia_inicio']) ?? '',
        vigenciaFim: dataIso(x['vigencia_fim']),
        ativo: booleano(x['ativo']),
      }));
    });
  }

  /** A fila do estabelecimento (abertos primeiro, pelo prazo), com filtro de situação. */
  fila(c: ContextoPorta, situacao: SituacaoReembolso | null) {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `${RESUMO_SQL} WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND (? IS NULL OR p.situacao = ?)
          ORDER BY p.situacao IN ('pago','negado','cancelado'), p.prazo_pagamento, p.id LIMIT 200`,
        [est, situacao, situacao],
      );
      const hoje = hojeIso();
      return r.map((x) => resumo(x, hoje));
    });
  }

  /** A visão por beneficiário: os pedidos dele e o total reembolsado no ano corrente. */
  doBeneficiario(c: ContextoPorta, benef: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `${RESUMO_SQL} JOIN contrato_plano k ON k.id = b.contrato_plano_id
          WHERE p.beneficiario_plano_id = ? AND k.estabelecimento_id = ? AND p.excluido_em IS NULL
          ORDER BY p.solicitado_em DESC LIMIT 200`,
        [benef, est],
      );
      const hoje = hojeIso();
      return {
        pedidos: r.map((x) => resumo(x, hoje)),
        reembolsadoNoAno: await PortaReembolsoPropria.reembolsadoNoAno(l, benef, hoje, 0),
      };
    });
  }

  /** O pedido com os itens, as glosas e os comprovantes. */
  pedido(c: ContextoPorta, id: number): Promise<PedidoDetalhe> {
    return this.ler(c, async (l, est) => {
      const [x] = await l.consultar(
        `${DETALHE_SQL}
           LEFT JOIN tabela_reembolso_referencia t ON t.id = p.tabela_reembolso_referencia_id
          WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
        [id, est],
      );
      if (!x) throw naoEncontrado('O pedido de reembolso');
      const itens = await l.consultar(
        `SELECT i.id, i.versao, i.item_faturavel_id, f.codigo, f.descricao, i.quantidade, i.valor_apresentado,
                i.valor_referencia, i.valor_glosado, i.valor_coparticipacao, i.valor_reembolsado, i.situacao
           FROM pedido_reembolso_item i JOIN item_faturavel f ON f.id = i.item_faturavel_id
          WHERE i.pedido_reembolso_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
        [id],
      );
      const glosas = await l.consultar(
        `SELECT g.pedido_reembolso_item_id, m.codigo_tuss, m.descricao, g.valor_glosado, g.justificativa
           FROM pedido_reembolso_glosa g JOIN pedido_reembolso_item i ON i.id = g.pedido_reembolso_item_id
           JOIN motivo_glosa m ON m.id = g.motivo_glosa_id
          WHERE i.pedido_reembolso_id = ? AND g.excluido_em IS NULL ORDER BY g.pedido_reembolso_item_id, g.sequencia`,
        [id],
      );
      const anexos = await l.consultar(
        `SELECT id, nome_original, tipo_mime, tamanho_bytes FROM arquivo
          WHERE entidade = 'pedido_reembolso' AND entidade_id = ? AND excluido_em IS NULL ORDER BY id`,
        [id],
      );
      return {
        ...resumo(x, hojeIso()),
        canal: textoObrigatorio(x['canal']) as CanalReembolso,
        prestadorDocumento: textoObrigatorio(x['prestador_cpf_cnpj']),
        numeroDocumentoFiscal: texto(x['numero_documento_fiscal']),
        tabelaReferencia:
          x['tabela_reembolso_referencia_id'] == null
            ? null
            : { id: Number(x['tabela_reembolso_referencia_id']), nome: textoObrigatorio(x['tabela_nome']) },
        observacao: texto(x['observacao']),
        analisadoEm: instanteIso(x['analisado_em']),
        pagoEm: dataIso(x['pago_em']),
        motivoCancelamento: texto(x['motivo_cancelamento']),
        itens: itens.map((i) => ({
          id: Number(i['id']),
          versao: Number(i['versao']),
          procedimento: {
            id: Number(i['item_faturavel_id']),
            codigo: textoObrigatorio(i['codigo']),
            descricao: textoObrigatorio(i['descricao']),
          },
          quantidade: numero(i['quantidade']) ?? 0,
          valorApresentado: numero(i['valor_apresentado']) ?? 0,
          valorLimite: numero(i['valor_referencia']),
          valorGlosado: numero(i['valor_glosado']) ?? 0,
          valorCoparticipacao: numero(i['valor_coparticipacao']) ?? 0,
          valorReembolsado: numero(i['valor_reembolsado']) ?? 0,
          situacao: textoObrigatorio(i['situacao']),
          glosas: glosas
            .filter((g) => Number(g['pedido_reembolso_item_id']) === Number(i['id']))
            .map((g) => ({
              motivo: `${textoObrigatorio(g['codigo_tuss'])} · ${textoObrigatorio(g['descricao'])}`,
              valor: numero(g['valor_glosado']) ?? 0,
              justificativa: texto(g['justificativa']),
            })),
        })),
        anexos: anexos.map((a) => ({
          id: Number(a['id']),
          nome: textoObrigatorio(a['nome_original']),
          tipoMime: textoObrigatorio(a['tipo_mime']),
          bytes: Number(a['tamanho_bytes']),
        })),
      };
    });
  }

  /** O conteúdo de um comprovante do pedido (base64), conferido pelo hash na porta de arquivos. */
  async comprovante(c: ContextoPorta, id: number, arquivo: number) {
    await this.ler(c, async (l, est) => {
      await PortaReembolsoPropria.pedidoDoEst(l, est, id);
      if (
        !(await l.uma(
          "SELECT id FROM arquivo WHERE id = ? AND entidade = 'pedido_reembolso' AND entidade_id = ? AND excluido_em IS NULL",
          [arquivo, id],
        ))
      )
        throw naoEncontrado('O comprovante');
    });
    const a = await this.exigirArquivos(c).ler(c.hospital, arquivo);
    if (!a) throw naoEncontrado('O comprovante');
    return {
      nome: a.metadado.nomeOriginal,
      tipoMime: a.metadado.tipoMime,
      base64: a.conteudo.toString('base64'),
    };
  }

  // ── gravações ──

  incluirTabela(c: ContextoPorta, op: number, e: EntradaTabela, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.reembolso.tabela.incluir',
      'tabela_reembolso_referencia',
      trilha,
      async (tx, est) => {
        await PortaReembolsoPropria.operadoraDoEst(tx, est, op);
        const codigo = e.codigo.trim().toUpperCase();
        if (!/^[A-Z0-9._-]{1,30}$/.test(codigo))
          throw recusa('codigo-invalido', 'Informe o código da tabela (até 30 letras ou números).', {
            campos: ['codigo'],
          });
        if (!e.nome.trim())
          throw recusa('nome-obrigatorio', 'Informe o nome da tabela.', { campos: ['nome'] });
        if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
          throw recusa('vigencia-invalida', 'O fim da vigência não pode ser antes do início.', {
            campos: ['vigenciaFim'],
          });
        if (
          await tx.uma(
            'SELECT id FROM tabela_reembolso_referencia WHERE operadora_saude_id = ? AND codigo = ?',
            [op, codigo],
          )
        )
          throw recusa('codigo-repetido', 'Já existe uma tabela com este código na operadora.', {
            campos: ['codigo'],
          });
        const termos = new Set<number>();
        for (const [n, i] of e.itens.entries()) {
          const p = await tx.uma<Record<string, unknown>>(procedimentoSql, [i.procedimento]);
          const termo = p ? numero(p['termo_terminologia_id']) : null;
          if (termo === null)
            throw recusa(
              'procedimento-sem-termo',
              'O procedimento não existe ou não tem o código TUSS equivalente.',
              {
                campos: [`itens.${n}.procedimento`],
              },
            );
          if (termos.has(termo))
            throw recusa('procedimento-repetido', 'O procedimento já está na tabela.', {
              campos: [`itens.${n}.procedimento`],
            });
          if (!(i.valor >= 0))
            throw recusa('valor-invalido', 'O valor de referência não pode ser negativo.', {
              campos: [`itens.${n}.valor`],
            });
          termos.add(termo);
        }
        const id = await tx.incluir('tabela_reembolso_referencia', {
          operadora_saude_id: op,
          codigo,
          nome: e.nome.trim().slice(0, 150),
          produto_plano_id: e.produto,
          municipio_ibge_id: e.municipio,
          modalidade_reembolso_id: e.modalidade,
          fator_multiplicador: e.fator,
          padrao: e.padrao,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          ativo: true,
        });
        const lista = [...termos];
        for (const [n, i] of e.itens.entries())
          await tx.incluir('tabela_reembolso_referencia_item', {
            tabela_reembolso_referencia_id: id,
            sequencia: n + 1,
            procedimento_termo_terminologia_id: lista[n],
            valor_referencia: i.valor,
            quantidade_maxima: i.quantidadeMaxima,
            vigencia_inicio: e.vigenciaInicio,
            vigencia_fim: e.vigenciaFim,
          });
        return { id, versao: 1 };
      },
    );
  }

  incluirRegra(c: ContextoPorta, op: number, e: EntradaRegra, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.reembolso.regra.incluir',
      'regra_reembolso_plano',
      trilha,
      async (tx, est) => {
        await PortaReembolsoPropria.operadoraDoEst(tx, est, op);
        exigir(problemasDaRegraReembolso(e));
        if (e.vigenciaFim !== null && e.vigenciaFim < e.vigenciaInicio)
          throw recusa('vigencia-invalida', 'O fim da vigência não pode ser antes do início.', {
            campos: ['vigenciaFim'],
          });
        if (
          !(await tx.uma(
            'SELECT id FROM plano_comercializado WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [e.plano, est],
          ))
        )
          throw recusa('plano-inexistente', 'O plano não é deste estabelecimento.', { campos: ['plano'] });
        if (
          e.tabela !== null &&
          !(await tx.uma(
            'SELECT id FROM tabela_reembolso_referencia WHERE id = ? AND operadora_saude_id = ?',
            [e.tabela, op],
          ))
        )
          throw recusa('tabela-inexistente', 'A tabela de referência não é desta operadora.', {
            campos: ['tabela'],
          });
        if (
          await tx.uma(
            `SELECT id FROM regra_reembolso_plano WHERE plano_comercializado_id = ? AND modalidade_reembolso_id <=> ? AND vigencia_inicio = ?`,
            [e.plano, e.modalidade, e.vigenciaInicio],
          )
        )
          throw recusa('regra-repetida', 'Já existe regra deste plano e modalidade com o mesmo início.', {
            campos: ['vigenciaInicio'],
          });
        const id = await tx.incluir('regra_reembolso_plano', {
          operadora_saude_id: op,
          plano_comercializado_id: e.plano,
          modalidade_reembolso_id: e.modalidade,
          tabela_reembolso_referencia_id: e.tabela,
          multiplicador: e.multiplicador,
          percentual: e.percentual,
          livre_escolha: e.livreEscolha,
          limite_por_evento: e.limitePorEvento,
          limite_anual: e.limiteAnual,
          referencia_prazo: 'realizacao',
          prazo_pagamento_dias: e.prazoPagamentoDias,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          ativo: true,
        });
        return { id, versao: 1 };
      },
    );
  }

  private exigirArquivos(c: ContextoPorta): ArquivosDoModulo {
    const a = this.arquivosDe();
    if (!a || !c.hospital)
      throw new ErroOperacao(
        503,
        'indisponivel',
        'Indisponível',
        'O armazenamento de arquivos não está configurado.',
      );
    return a;
  }

  private static conteudoDoAnexo(a: AnexoEntrada, n: number): Buffer {
    const conteudo = Buffer.from(a.base64, 'base64');
    if (!TIPOS_ANEXO.has(a.tipoMime) || conteudo.length === 0 || conteudo.length > TAMANHO_MAXIMO_ANEXO)
      throw recusa('anexo-invalido', 'O comprovante tem de ser PDF, PNG ou JPEG, com até 5 MB.', {
        campos: [`anexos.${n}`],
      });
    return conteudo;
  }

  /**
   * Inclui o pedido: confere pelo domínio (com os comprovantes contados), guarda os comprovantes na porta de arquivos
   * e grava o pedido e os itens com o limite de cada um (tabela do município ou percentual do plano) numa operação só,
   * que também liga os comprovantes ao pedido. O prazo é o da regra do plano (até 30 dias).
   */
  async incluirPedido(
    c: ContextoPorta,
    e: EntradaPedido,
    trilha: Trilha,
  ): Promise<Gravado & { numero: string; prazoPagamento: string }> {
    exigir(problemasDoPedidoReembolso(e, hojeIso(), e.anexos.length));
    const conteudos = e.anexos.map((a, n) => PortaReembolsoPropria.conteudoDoAnexo(a, n));
    // O beneficiário é conferido antes de guardar (nada fica no disco para um pedido que não existe).
    await this.ler(c, async (l, est) => {
      if (
        !(await l.uma(
          `SELECT b.id FROM beneficiario_plano b JOIN contrato_plano k ON k.id = b.contrato_plano_id
            WHERE b.id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL`,
          [e.beneficiario, est],
        ))
      )
        throw recusa('beneficiario-inexistente', 'O beneficiário não é deste estabelecimento.', {
          campos: ['beneficiario'],
        });
    });
    const arquivos = this.exigirArquivos(c);
    const guardados: number[] = [];
    for (const [n, a] of e.anexos.entries())
      guardados.push(
        (
          await arquivos.guardar(c.hospital, {
            conteudo: conteudos[n]!,
            nomeOriginal: a.nome.slice(0, 255) || 'comprovante',
            tipoMime: a.tipoMime,
            finalidade: FINALIDADE_COMPROVANTE_REEMBOLSO,
            entidade: DONO_ANEXO,
            entidadeId: null,
          })
        ).id,
      );
    let saida = { numero: '', prazoPagamento: '' };
    const g = await this.gravar(
      c,
      'operadora.reembolso.pedido.incluir',
      'pedido_reembolso',
      trilha,
      async (tx, est) => {
        const b = await tx.uma<Record<string, unknown>>(
          `SELECT b.plano_comercializado_id, k.operadora_saude_id, p.produto_plano_id
           FROM beneficiario_plano b JOIN contrato_plano k ON k.id = b.contrato_plano_id
           JOIN plano_comercializado p ON p.id = b.plano_comercializado_id
          WHERE b.id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL`,
          [e.beneficiario, est],
        );
        if (!b)
          throw recusa('beneficiario-inexistente', 'O beneficiário não é deste estabelecimento.', {
            campos: ['beneficiario'],
          });
        const op = Number(b['operadora_saude_id']);
        const regra = await PortaReembolsoPropria.regraDoPlano(
          tx,
          op,
          Number(b['plano_comercializado_id']),
          e.modalidade,
          e.dataAtendimento,
        );
        let tabela = regra.tabela;
        if (tabela === null && regra.percentual === null) {
          const candidatas = await tx.consultar(
            `SELECT id, municipio_ibge_id, produto_plano_id, modalidade_reembolso_id, padrao, vigencia_inicio, vigencia_fim, ativo
             FROM tabela_reembolso_referencia WHERE operadora_saude_id = ?`,
            [op],
          );
          tabela =
            escolherTabelaReferencia(
              candidatas.map((t) => ({
                id: Number(t['id']),
                municipio: numero(t['municipio_ibge_id']),
                produto: numero(t['produto_plano_id']),
                modalidade: numero(t['modalidade_reembolso_id']),
                padrao: booleano(t['padrao']),
                vigenciaInicio: dataIso(t['vigencia_inicio']) ?? '',
                vigenciaFim: dataIso(t['vigencia_fim']),
                ativo: booleano(t['ativo']),
              })),
              {
                municipio: e.municipio,
                produto: numero(b['produto_plano_id']),
                modalidade: e.modalidade,
                data: e.dataAtendimento,
              },
            )?.id ?? null;
        }
        const itens: {
          procedimento: number;
          quantidade: number;
          valorApresentado: number;
          dataRealizacao: string | null;
          limite: number;
        }[] = [];
        for (const [n, i] of e.itens.entries()) {
          const p = await tx.uma<Record<string, unknown>>(procedimentoSql, [i.procedimento]);
          if (!p)
            throw recusa('procedimento-inexistente', 'O procedimento não existe.', {
              campos: [`itens.${n}.procedimento`],
            });
          const termo = numero(p['termo_terminologia_id']);
          const data = i.dataRealizacao ?? e.dataAtendimento;
          const ref =
            tabela !== null && termo !== null
              ? await tx.uma<Record<string, unknown>>(
                  `SELECT valor_referencia, quantidade_maxima FROM tabela_reembolso_referencia_item
                  WHERE tabela_reembolso_referencia_id = ? AND procedimento_termo_terminologia_id = ? AND excluido_em IS NULL
                    AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
                  ORDER BY vigencia_inicio DESC LIMIT 1`,
                  [tabela, termo, data, data],
                )
              : null;
          const limite = limiteDoItem(
            i,
            ref
              ? {
                  valor: numero(ref['valor_referencia']) ?? 0,
                  quantidadeMaxima: numero(ref['quantidade_maxima']),
                }
              : null,
            regra,
          );
          itens.push({ ...i, limite });
        }
        const agora = new Date();
        // A numeração do pedido nasce na primeira gravação do estabelecimento (RB-1, RB-2...), sem depender de semeadura.
        await garantirSequencia(
          tx,
          { tipo: 'pedido_reembolso', estabelecimento: est, prefixo: 'RB-' },
          { usuario: tx.contexto.usuario ?? null, agora },
        );
        const numeroPedido = (await tx.proximoNumero('pedido_reembolso')).formatado;
        const prazo = prazoDoReembolso(agora.toISOString(), regra.prazoPagamentoDias);
        const apresentado = itens.reduce((a, i) => a + Math.round(i.valorApresentado * 100), 0) / 100;
        const id = await tx.incluir('pedido_reembolso', {
          estabelecimento_id: est,
          numero: numeroPedido,
          beneficiario_plano_id: e.beneficiario,
          modalidade_reembolso_id: e.modalidade,
          canal: e.canal,
          prestador_nome: e.prestadorNome.trim().slice(0, 150),
          prestador_tipo_pessoa: tipoPessoaDoDocumento(e.prestadorDocumento),
          prestador_cpf_cnpj: e.prestadorDocumento.replace(/\D/g, ''),
          data_atendimento: e.dataAtendimento,
          data_alta: e.dataAlta,
          numero_documento_fiscal: e.numeroDocumentoFiscal,
          tabela_reembolso_referencia_id: tabela,
          solicitado_em: agora,
          prazo_pagamento: prazo,
          valor_apresentado: apresentado,
          situacao: 'em_analise',
          observacao: e.observacao,
        });
        for (const [n, i] of itens.entries())
          await tx.incluir('pedido_reembolso_item', {
            pedido_reembolso_id: id,
            sequencia: n + 1,
            item_faturavel_id: i.procedimento,
            data_realizacao: i.dataRealizacao,
            quantidade: i.quantidade,
            valor_apresentado: i.valorApresentado,
            valor_referencia: i.limite,
            situacao: 'pendente',
          });
        for (const a of guardados) {
          const v = await tx.uma<{ versao: unknown }>(
            "SELECT versao FROM arquivo WHERE id = ? AND entidade = 'pedido_reembolso' AND entidade_id IS NULL",
            [a],
          );
          if (v) await tx.alterar('arquivo', a, Number(v.versao), { entidade_id: id });
        }
        saida = { numero: numeroPedido, prazoPagamento: prazo };
        return { id, versao: 1 };
      },
    );
    return { ...g, ...saida };
  }

  /** Anexa um comprovante ao pedido ainda em análise; o pendente de documento volta à análise. */
  async anexar(
    c: ContextoPorta,
    id: number,
    versao: number,
    a: AnexoEntrada,
    trilha: Trilha,
  ): Promise<Gravado> {
    const conteudo = PortaReembolsoPropria.conteudoDoAnexo(a, 0);
    await this.ler(c, async (l, est) => {
      const p = await PortaReembolsoPropria.pedidoDoEst(l, est, id);
      if (!emAnaliseReembolso(p.situacao))
        throw situacaoRecusada('Só o pedido em análise recebe comprovante.');
    });
    const arquivo = await this.exigirArquivos(c).guardar(c.hospital, {
      conteudo,
      nomeOriginal: a.nome.slice(0, 255) || 'comprovante',
      tipoMime: a.tipoMime,
      finalidade: FINALIDADE_COMPROVANTE_REEMBOLSO,
      entidade: DONO_ANEXO,
      entidadeId: id,
    });
    return this.gravar(
      c,
      'operadora.reembolso.pedido.anexar',
      'pedido_reembolso',
      trilha,
      async (tx, est) => {
        const p = await PortaReembolsoPropria.pedidoDoEst(tx, est, id);
        if (!emAnaliseReembolso(p.situacao))
          throw situacaoRecusada('Só o pedido em análise recebe comprovante.');
        const nova = await tx.alterar('pedido_reembolso', id, versao, {
          situacao: p.situacao === 'pendente_documento' ? 'em_analise' : p.situacao,
          observacao: null,
        });
        void arquivo;
        return { id, versao: nova };
      },
    );
  }

  /**
   * A análise: pendência de documento (com o motivo na observação) ou a conclusão, com as glosas por item gravadas, os
   * valores do domínio (coparticipação, tetos por evento e anual) e a situação que resulta.
   */
  analisar(
    c: ContextoPorta,
    id: number,
    e: EntradaAnalise,
    trilha: Trilha,
  ): Promise<Gravado & { situacao?: string }> {
    let situacaoFinal = '';
    return this.gravar(
      c,
      'operadora.reembolso.pedido.analisar',
      'pedido_reembolso',
      trilha,
      async (tx, est) => {
        const p = await PortaReembolsoPropria.pedidoDoEst(tx, est, id);
        if (!emAnaliseReembolso(p.situacao))
          throw situacaoRecusada('O pedido já foi concluído; a análise não muda mais.');
        const usuario = tx.contexto.usuario ?? null;
        if (e.decisao === 'pendente_documento') {
          if (!e.observacao?.trim())
            throw recusa('motivo-obrigatorio', 'Diga qual documento falta.', { campos: ['observacao'] });
          const v = await tx.alterar('pedido_reembolso', id, e.versao, {
            situacao: 'pendente_documento',
            observacao: e.observacao.trim().slice(0, 2000),
          });
          situacaoFinal = 'pendente_documento';
          return { id, versao: v };
        }
        const linhas = await tx.consultar(
          `SELECT i.id, i.versao, i.valor_apresentado, i.valor_referencia, b.plano_comercializado_id, k.operadora_saude_id,
                p.modalidade_reembolso_id
           FROM pedido_reembolso_item i JOIN pedido_reembolso p ON p.id = i.pedido_reembolso_id
           JOIN beneficiario_plano b ON b.id = p.beneficiario_plano_id JOIN contrato_plano k ON k.id = b.contrato_plano_id
          WHERE i.pedido_reembolso_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
          [id],
        );
        const base = linhas[0];
        if (!base) throw naoEncontrado('O item do pedido');
        for (const [n, i] of e.itens.entries())
          if (!linhas.some((x) => Number(x['id']) === i.item))
            throw recusa('item-inexistente', 'O item não é deste pedido.', { campos: [`itens.${n}.item`] });
        const regra = await PortaReembolsoPropria.regraDoPlano(
          tx,
          Number(base['operadora_saude_id']),
          Number(base['plano_comercializado_id']),
          numero(base['modalidade_reembolso_id']),
          p.dataAtendimento,
        );
        const motivos = new Set(e.itens.flatMap((i) => i.glosas.map((g) => g.motivo)));
        for (const m of motivos)
          if (!(await tx.uma('SELECT id FROM motivo_glosa WHERE id = ?', [m])))
            throw recusa('motivo-inexistente', 'O motivo de glosa não existe.', { campos: ['itens'] });
        const resultado = analisarReembolso(
          linhas.map((x) => {
            const d = e.itens.find((i) => i.item === Number(x['id']));
            const apresentado = numero(x['valor_apresentado']) ?? 0;
            return {
              id: Number(x['id']),
              valorApresentado: apresentado,
              valorLimite: numero(x['valor_referencia']) ?? apresentado,
              glosas: d?.glosas ?? [],
              coparticipacao: d?.coparticipacao ?? 0,
            };
          }),
          regra,
          await PortaReembolsoPropria.reembolsadoNoAno(tx, p.beneficiario, p.dataAtendimento, id),
        );
        exigir(resultado.problemas);
        const agora = new Date();
        for (const x of linhas) {
          const itemId = Number(x['id']);
          const r = resultado.itens.find((i) => i.id === itemId)!;
          const d = e.itens.find((i) => i.item === itemId);
          for (const [s, g] of (d?.glosas ?? []).entries())
            await tx.incluir('pedido_reembolso_glosa', {
              pedido_reembolso_item_id: itemId,
              sequencia: s + 1,
              motivo_glosa_id: g.motivo,
              valor_glosado: g.valor,
              justificativa: g.justificativa?.trim().slice(0, 1000) || null,
              glosado_em: agora,
              responsavel_usuario_id: usuario,
            });
          await tx.alterar('pedido_reembolso_item', itemId, Number(x['versao']), {
            valor_glosado: r.valorGlosado,
            valor_coparticipacao: r.valorCoparticipacao,
            valor_reembolsado: r.valorReembolsado,
            situacao: r.situacao,
          });
        }
        if (!podePassarReembolso(p.situacao, resultado.situacao))
          throw situacaoRecusada('Passagem de situação recusada.');
        const v = await tx.alterar('pedido_reembolso', id, e.versao, {
          valor_glosado: resultado.valorGlosado,
          valor_coparticipacao: resultado.valorCoparticipacao,
          valor_reembolsado: resultado.valorReembolsado,
          situacao: resultado.situacao,
          analisado_em: agora,
          analisado_por_usuario_id: usuario,
          observacao: e.observacao?.trim().slice(0, 2000) || null,
        });
        situacaoFinal = resultado.situacao;
        return { id, versao: v };
      },
    ).then((g) => ({ ...g, situacao: situacaoFinal }));
  }

  /** O pagamento do aprovado: o pedido vai a pago e o crédito do reembolso entra na conta corrente do beneficiário. */
  pagar(
    c: ContextoPorta,
    id: number,
    e: { versao: number; pagoEm: string },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(c, 'operadora.reembolso.pedido.pagar', 'pedido_reembolso', trilha, async (tx, est) => {
      const p = await PortaReembolsoPropria.pedidoDoEst(tx, est, id);
      if (!podePassarReembolso(p.situacao, 'pago'))
        throw situacaoRecusada('Só o pedido aprovado pode ser pago.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.pagoEm) || e.pagoEm > hojeIso())
        throw recusa('data-pagamento-invalida', 'A data do pagamento não pode ser futura.', {
          campos: ['pagoEm'],
        });
      if (!(p.reembolsado > 0)) throw situacaoRecusada('Não há valor a reembolsar.');
      await tx.incluir('lancamento_conta_beneficiario', {
        estabelecimento_id: est,
        beneficiario_plano_id: p.beneficiario,
        operacao: 'inclusao',
        ocorrido_em: new Date(),
        usuario_id: tx.contexto.usuario ?? null,
        natureza: 'credito',
        tipo_movimento: 'reembolso',
        valor: p.reembolsado,
        competencia: `${e.pagoEm.slice(0, 7)}-01`,
        complemento: `Reembolso ${p.numero}`.slice(0, 200),
        pedido_reembolso_id: id,
      });
      const v = await tx.alterar('pedido_reembolso', id, e.versao, { situacao: 'pago', pago_em: e.pagoEm });
      return { id, versao: v };
    });
  }

  /** Cancela o pedido ainda não pago, com o motivo (nunca apaga). */
  cancelar(
    c: ContextoPorta,
    id: number,
    e: { versao: number; motivo: string },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.reembolso.pedido.cancelar',
      'pedido_reembolso',
      trilha,
      async (tx, est) => {
        const p = await PortaReembolsoPropria.pedidoDoEst(tx, est, id);
        if (!podePassarReembolso(p.situacao, 'cancelado'))
          throw situacaoRecusada('O pedido pago ou encerrado não é cancelado.');
        if (e.motivo.trim().length < 5)
          throw recusa('motivo-obrigatorio', 'Diga o motivo do cancelamento.', { campos: ['motivo'] });
        const v = await tx.alterar('pedido_reembolso', id, e.versao, {
          situacao: 'cancelado',
          cancelado_em: new Date(),
          motivo_cancelamento: e.motivo.trim().slice(0, 500),
        });
        return { id, versao: v };
      },
    );
  }
}

export const METODOS_REEMBOLSO: ReadonlySet<string> = new Set([
  'apoio',
  'buscar',
  'tabelas',
  'regras',
  'fila',
  'doBeneficiario',
  'pedido',
  'comprovante',
  'incluirTabela',
  'incluirRegra',
  'incluirPedido',
  'anexar',
  'analisar',
  'pagar',
  'cancelar',
]);
