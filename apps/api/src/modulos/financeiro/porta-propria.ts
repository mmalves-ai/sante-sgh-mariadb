// Porta do financeiro e fiscal sobre o banco do cliente (M32), pelo @sgh/nucleo: leituras somente leitura no modelo
// próprio (titulo_pagar/parcela_pagar, titulo_receber/parcela_receber, conta_bancaria, movimento_bancario, extrato,
// conciliação, alçada em fluxo_aprovacao, aprovação em pedido_aprovacao/decisao_aprovacao, fiscal) e gravações pelo
// Executor: as quatro operações das telas (operacoes.ts) e as gravações diretas (alçada, aprovação, glosa no título,
// extrato, conciliação, crédito, remessa, lote contábil) numa operação de gravação direta, com trilha, outbox e
// idempotência na mesma transação. Toda leitura filtra o estabelecimento da sessão e os registros excluídos; os
// cadastros da rede inteira (natureza financeira, tributo, tipo de credor, fonte pagadora) não têm estabelecimento.
// Melhoria: o "título" das telas de contas a pagar é a parcela (baixa, borderô e conciliação por parcela); a alçada
// é o fluxo de aprovação do modelo (faixa = fluxo, aprovações = quórum da etapa 1, tipo de credor e permissão na
// condição de entrada); a aprovação vira pedido e decisões, e o título aprovado fica autorizado (autorizado_em).
// Melhoria: segregação conferida também na conciliação (quem pagou, recebeu ou lançou o movimento não o concilia), com
// a linha do extrato conferida contra a natureza e o valor do movimento.
// Melhoria: escopo de contas separado em consulta (pode_consultar) e movimentação (pode_movimentar).
// Melhoria: gravação direta idempotente pela Idempotency-Key do pedido; remessa e lote contábil não se repetem pelo hash.
// Pendências de modelo (pedidos do lote 02-07): NFS-e e declarações (DMED/EFD-REINF) simuladas pedem um registro de
// arquivo fiscal gerado (a nota_servico e a declaracao_dmed exigem tomador, município e responsável); glosa no título
// por evento (hoje somada nas colunas de glosa do título e da parcela); de-para contábil por evento; regua e
// destino do lote/remessa em colunas próprias (hoje em observacao, JSON).
import type {
  AdiantamentoResposta,
  BorderoResposta,
  ContaBancariaResposta,
  ContaSemTituloResposta,
  CreditoPendenteResposta,
  DetalheTituloPagarResposta,
  DetalheTituloReceberResposta,
  EscrituracaoResposta,
  LinhaExtratoResposta,
  ListaApropriacoes,
  ListaTitulosPagar,
  ListaTitulosReceber,
  MovimentoResposta,
  RegistroFiscalResposta,
  TituloPagarResposta,
  TituloReceberResposta,
} from '@sgh/contratos';
import {
  alcadaAplicavel,
  centavos,
  conferirAprovacao,
  conferirFaixas,
  conferirSegregacao,
  type FaixaAlcada,
  situacaoAprovacao,
  situacaoTituloPagar,
} from '@sgh/dominio-financeiro';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import {
  aprovacoesPorTitulo,
  centroDaAlcada,
  conferirItemGlosado,
  conferirLinhaContraMovimento,
  contasDoEscopo,
  efeitoDaGlosa,
  itemGlosavelDe,
  faixasLidas,
  loginDe,
  OPERACOES_FINANCEIRO,
  recusar,
  SITUACOES_CONTA_TITULAVEL,
  TIPO_APROVACAO_TITULO,
} from './operacoes.js';
import {
  type BasesDrePorta,
  type BasesIndicadoresPorta,
  type ContextoFinanceiro,
  type FiltroPagar,
  type FiltroReceber,
  type GravadorSghFinanceiro,
  type LancamentoFluxoPorta,
  METODOS_PORTA_FINANCEIRO,
  type PortaFinanceiro,
  type RetencaoReinfPorta,
} from './porta.js';
import {
  CREDOR_DO_TIPO,
  classificacaoDoCodigo,
  dataIso,
  documentoNumerico,
  fimDoMes,
  FORMAS_PAGAMENTO,
  inicioDoMes,
  instanteIso,
  numero,
  numeroOuNulo,
  statusDaParcela,
  texto,
  TIPO_DA_ESFERA,
  tipoCredorDe,
  tipoDoMovimento,
  versaoTexto,
} from './vocabulario.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoFinanceiro = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const POR_PAGINA_PAGAR = 200;
const POR_PAGINA_APROPRIACAO = 50;
const POR_PAGINA_RECEBER = 200;
/** Movimento conciliável na conta: com quem lançou, a natureza e o valor (conferidos contra a linha do extrato). */
const SQL_MOVIMENTO_CONCILIAVEL = `SELECT id, versao, conciliado, natureza, valor, criado_por FROM movimento_bancario
  WHERE id = ? AND conta_bancaria_id = ? AND situacao = 'ativo' AND excluido_em IS NULL`;
const SITUACOES_TITULAVEIS = SITUACOES_CONTA_TITULAVEL.map((s) => `'${s}'`).join(',');

/** Tabelas das gravações diretas (a operação de gravação direta só grava nelas). */
const TABELAS_GRAVACAO_DIRETA = [
  'tipo_documento_aprovacao',
  'fluxo_aprovacao',
  'etapa_fluxo_aprovacao',
  'pedido_aprovacao',
  'decisao_aprovacao',
  'titulo_pagar',
  'titulo_receber',
  'parcela_receber',
  'extrato_bancario',
  'linha_extrato',
  'conciliacao_bancaria',
  'conciliacao_bancaria_item',
  'movimento_bancario',
  'credito_nao_identificado',
  'conta_bancaria',
  'remessa_bancaria',
  'lote_exportacao_contabil',
  'sequencia_negocio',
];

const ORIGEM_DO_MODULO: Readonly<Record<string, string>> = { estoque: 'E', repasse: 'R' };

const SQL_PARCELAS_PAGAR = `
  SELECT p.id, p.sequencia, p.vencimento, p.valor, p.valor_pago, p.saldo, p.situacao, p.quitada_em, p.versao,
         t.id AS titulo_id, t.numero_documento, t.serie_documento, t.modulo_origem, t.data_emissao, t.valor_bruto,
         t.referente, t.empresa_fornecedora_id, t.profissional_id, t.colaborador_id, t.natureza_financeira_id,
         tc.codigo AS tipo_codigo, tc.natureza AS tipo_natureza, u.login AS lancado_por,
         COALESCE(ef.razao_social, pf.nome, co.nome) AS credor_nome,
         (SELECT bp.numero FROM baixa_titulo b JOIN bordero_pagamento bp ON bp.id = b.bordero_pagamento_id
           WHERE b.parcela_pagar_id = p.id AND b.situacao = 'efetivada' AND b.excluido_em IS NULL
           ORDER BY b.id DESC LIMIT 1) AS bordero_numero,
         (SELECT COUNT(*) FROM pedido_aprovacao pa
            JOIN decisao_aprovacao d ON d.pedido_aprovacao_id = pa.id AND d.decisao = 'aprovado'
           WHERE pa.entidade = 'titulo_pagar' AND pa.entidade_id = t.id AND pa.excluido_em IS NULL
             AND pa.situacao <> 'cancelado') AS aprovacoes
    FROM parcela_pagar p
    JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
    JOIN tipo_credor tc ON tc.id = t.tipo_credor_id
    LEFT JOIN empresa_fornecedora ef ON ef.id = t.empresa_fornecedora_id
    LEFT JOIN profissional pr ON pr.id = t.profissional_id
    LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
    LEFT JOIN colaborador co ON co.id = t.colaborador_id
    LEFT JOIN usuario u ON u.id = t.criado_por
   WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND p.excluido_em IS NULL AND t.situacao <> 'cancelado'`;

const SQL_TITULOS_RECEBER = `
  SELECT t.id, t.tipo_devedor, t.fonte_pagadora_id, t.paciente_id, t.cliente_financeiro_id, t.numero_documento,
         t.data_emissao, t.valor_liquido, t.valor_recebido, t.valor_glosa_aceita, t.situacao, t.versao,
         COALESCE(f.nome, pf.nome, cf.nome) AS nome,
         (SELECT MIN(p.vencimento) FROM parcela_receber p
           WHERE p.titulo_receber_id = t.id AND p.excluido_em IS NULL) AS vencimento,
         (SELECT MAX(r.data_recebimento) FROM recebimento r JOIN parcela_receber p ON p.id = r.parcela_receber_id
           WHERE p.titulo_receber_id = t.id AND r.situacao = 'efetivado' AND r.excluido_em IS NULL) AS data_recebimento,
         (SELECT MIN(r.meio_baixa) FROM recebimento r JOIN parcela_receber p ON p.id = r.parcela_receber_id
           WHERE p.titulo_receber_id = t.id AND r.situacao = 'efetivado' AND r.excluido_em IS NULL) AS meio_baixa,
         (SELECT COUNT(*) FROM documento_origem_titulo d WHERE d.titulo_receber_id = t.id
             AND d.entidade = 'conta_hospitalar' AND d.excluido_em IS NULL) AS contas
    FROM titulo_receber t
    LEFT JOIN fonte_pagadora f ON f.id = t.fonte_pagadora_id
    LEFT JOIN paciente pa ON pa.id = t.paciente_id
    LEFT JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
    LEFT JOIN cliente_financeiro cf ON cf.id = t.cliente_financeiro_id
   WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'`;

/** Letra do devedor da tela ↔ tipo de devedor do modelo. */
const DEVEDOR_DO_TIPO: Readonly<Record<string, string>> = {
  fonte_pagadora: 'C',
  paciente: 'E',
  cliente: 'O',
};
const TIPO_DO_DEVEDOR: Readonly<Record<string, string>> = {
  C: 'fonte_pagadora',
  E: 'paciente',
  I: 'paciente',
  T: 'cliente',
  L: 'cliente',
  O: 'cliente',
};

/** Resultado de uma gravação direta repetida (o guardado na idempotência), marcado como repetido. */
function repetidaDe<T>(bruto: unknown): T {
  const v: unknown = typeof bruto === 'string' ? JSON.parse(bruto) : null;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('repetida' in o) return { ...o, repetida: true } as T;
    if ('repetido' in o) return { ...o, repetido: true } as T;
  }
  return v as T;
}

function contextoDe(c: ContextoFinanceiro): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'financeiro').slice(0, 64),
  };
}

/** JSON guardado em observacao (registro do lote e da remessa); vazio quando não é JSON. */
function jsonDe(v: unknown): Record<string, unknown> {
  try {
    const j = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function tituloPagarDe(r: Linha, hoje: string): TituloPagarResposta {
  const bordero = documentoNumerico(r['bordero_numero']);
  const t = {
    vencimento: dataIso(r['vencimento']),
    dataPagamento: dataIso(r['quitada_em']),
    valor: numero(r['valor']),
    pago: numero(r['valor_pago']),
    bordero,
  };
  return {
    id: numero(r['id']),
    credor: numero(r['empresa_fornecedora_id'] ?? r['profissional_id'] ?? r['colaborador_id']),
    credorNome: texto(r['credor_nome']),
    credorEncontrado: r['credor_nome'] !== null && r['credor_nome'] !== undefined,
    documento: documentoNumerico(r['numero_documento']),
    parcela: numero(r['sequencia']),
    tipo: tipoCredorDe(r['tipo_codigo'], r['tipo_natureza']),
    serie: texto(r['serie_documento']),
    origem: ORIGEM_DO_MODULO[texto(r['modulo_origem'])] ?? 'F',
    emissao: dataIso(r['data_emissao']),
    vencimento: t.vencimento,
    valor: t.valor,
    valorDocumento: numero(r['valor_bruto']),
    pago: t.pago,
    dataPagamento: t.dataPagamento,
    bordero,
    status: statusDaParcela(r['situacao'], bordero > 0),
    situacao: situacaoTituloPagar(t, hoje),
    lancadoPor: texto(r['lancado_por']),
    referente: texto(r['referente']),
    aprovacoes: numero(r['aprovacoes']),
    versao: versaoTexto(r['versao']),
  };
}

function tituloReceberDe(r: Linha, hoje: string): TituloReceberResposta {
  const tipo = texto(r['tipo_devedor']);
  const vencimento = dataIso(r['vencimento']);
  const sit = texto(r['situacao']);
  return {
    id: numero(r['id']),
    devedor: DEVEDOR_DO_TIPO[tipo] ?? 'O',
    codigo: numero(r['fonte_pagadora_id'] ?? r['paciente_id'] ?? r['cliente_financeiro_id']),
    convenio: numero(r['fonte_pagadora_id']),
    documento: documentoNumerico(r['numero_documento']),
    apresentacao: dataIso(r['data_emissao']),
    vencimento,
    valor: numero(r['valor_liquido']),
    recebido: numero(r['valor_recebido']),
    dataRecebimento: dataIso(r['data_recebimento']),
    origem: 'V',
    origemBaixa: r['meio_baixa'] ? (texto(r['meio_baixa']) === 'manual' ? 'M' : 'B') : '',
    nome: texto(r['nome']),
    contas: numero(r['contas']),
    glosaAceita: numero(r['valor_glosa_aceita']),
    situacao:
      sit === 'recebido'
        ? 'recebido'
        : sit === 'recebido_parcial'
          ? 'recebido-parcial'
          : vencimento && vencimento < hoje
            ? 'vencido'
            : 'aberto',
    versao: versaoTexto(r['versao']),
  };
}

export class PortaFinanceiroPropria implements PortaFinanceiro {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoFinanceiro,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoFinanceiro, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(c: ContextoFinanceiro, op: string): Promise<LiberacaoGravacao> {
    const operacao = OPERACOES_FINANCEIRO[op];
    if (!operacao) return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida.' };
    return this.executor.liberacao(operacao, { ...contextoDe(c), chaveIdempotencia: 'consulta.liberacao' });
  }

  async executar(c: ContextoFinanceiro, op: string, entrada: unknown, ctx: ContextoOperacao) {
    const operacao = OPERACOES_FINANCEIRO[op];
    if (!operacao) throw recusa('operacao-desconhecida', 'Operação desconhecida no financeiro.');
    const r = await this.executor.executar(operacao, c.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  /**
   * Gravação direta: o gravador roda dentro de uma operação do executor (trilha, outbox e idempotência juntas). A
   * chave de idempotência é a Idempotency-Key do pedido (o serviço a põe no contexto), obrigatória como nas
   * operações; o reenvio com a mesma chave devolve o resultado gravado, sem gravar de novo.
   */
  async gravarSgh<T>(
    c: ContextoFinanceiro & { readonly chaveIdempotencia?: string },
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorSghFinanceiro) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = (): TrilhaDaGravacao => {
      if (typeof trilha !== 'function') return trilha;
      if (!saida) throw new Error('Gravação direta sem resultado para a trilha.');
      return trilha(saida.valor);
    };
    const op = definirOperacao({
      nome: 'financeiro.gravacao-direta',
      tabelas: TABELAS_GRAVACAO_DIRETA,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        const valor = await fn(gravadorSobre(tx, est));
        saida = { valor };
        return { valor: JSON.stringify(valor ?? null) } as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l.entidade, id: l.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha().dadosDepois ?? null, motivo: linha().motivo ?? null }),
    });
    if (!c.chaveIdempotencia)
      throw new ErroOperacao(400, 'entrada-invalida', 'Pedido incompleto', 'Falta a Idempotency-Key do pedido de gravação.');
    const chave = `direta:${c.chaveIdempotencia}`.slice(0, 100);
    const r = await this.executor.executar(op, c.cliente, { chave }, { ...contextoDe(c), chaveIdempotencia: chave });
    if (!r.repetida) {
      if (!saida) throw new Error('Gravação direta sem resultado.');
      return (saida as { valor: T }).valor;
    }
    return repetidaDe<T>(r.resultado['valor']);
  }

  // ── Leituras: apoio ───────────────────────────────────────────────────────────────────────────────────────

  hoje(c: ContextoFinanceiro): Promise<string> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<{ fuso_horario: string | null }>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [
        est,
      ]);
      return new Intl.DateTimeFormat('en-CA', { timeZone: r?.fuso_horario || 'America/Sao_Paulo' }).format(new Date());
    });
  }

  contas(c: ContextoFinanceiro, usuario: string | null): Promise<ContaBancariaResposta[]> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT c.id, c.codigo, c.descricao, c.situacao, c.numero_agencia, b.codigo_compensacao,
                c.saldo_inicial + COALESCE((SELECT SUM(CASE WHEN m.natureza = 'credito' THEN m.valor ELSE -m.valor END)
                   FROM movimento_bancario m
                  WHERE m.conta_bancaria_id = c.id AND m.situacao = 'ativo' AND m.excluido_em IS NULL
                    AND (c.data_saldo_inicial IS NULL OR m.data_movimento >= c.data_saldo_inicial)), 0) AS saldo
           FROM conta_bancaria c LEFT JOIN banco b ON b.id = c.banco_id
          WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao = 'ativa'
          ORDER BY c.codigo, c.id`,
        [est],
      );
      // Com o usuário: só as contas do escopo dele (regra 15); sem: todas as do estabelecimento.
      const escopo = usuario !== null ? new Set(await contasDoEscopo(l, est, c.usuario)) : null;
      return linhas
        .filter((r) => !escopo || escopo.has(numero(r['id'])))
        .map((r) => ({
          id: numero(r['id']),
          banco: documentoNumerico(r['codigo_compensacao']),
          agencia: documentoNumerico(r['numero_agencia']),
          codigo: documentoNumerico(r['codigo']) || numero(r['id']),
          descricao: texto(r['descricao']),
          situacao: texto(r['situacao']),
          saldo: centavos(numero(r['saldo'])),
          saldoFechadoEm: null,
          saldoApuradoOutroSistema: null,
        }));
    });
  }

  classificacoes(c: ContextoFinanceiro) {
    // Natureza financeira é cadastro da rede inteira (sem estabelecimento).
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        'SELECT codigo, descricao FROM natureza_financeira WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY codigo',
      );
      return linhas.flatMap((r) => {
        const k = classificacaoDoCodigo(r['codigo']);
        return k ? [{ ...k, nome: texto(r['descricao']) }] : [];
      });
    });
  }

  retencoes(c: ContextoFinanceiro) {
    // Tributo é cadastro da rede inteira.
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          "SELECT id, descricao, esfera FROM tributo WHERE ativo = TRUE AND incidencia IN ('retido','ambos') ORDER BY descricao",
        )
      ).map((r) => ({ codigo: numero(r['id']), descricao: texto(r['descricao']), tipo: TIPO_DA_ESFERA[texto(r['esfera'])] ?? 0 })),
    );
  }

  async formasPagamento() {
    return FORMAS_PAGAMENTO.map((f) => ({ codigo: f.codigo, nome: f.nome }));
  }

  // ── Contas a pagar ────────────────────────────────────────────────────────────────────────────────────────

  titulosPagar(c: ContextoFinanceiro, f: FiltroPagar): Promise<ListaTitulosPagar> {
    return this.ler(c, async (l, est) => {
      const cond: string[] = [];
      const p: unknown[] = [est];
      switch (f.situacao) {
        case 'pago':
          cond.push("p.situacao = 'paga'");
          break;
        case 'pago-parcial':
          cond.push("p.situacao = 'parcial'");
          break;
        case 'em-bordero':
          cond.push('1 = 0');
          break;
        case 'vencido':
          cond.push("p.situacao = 'aberta' AND p.vencimento < ?");
          p.push(f.hoje);
          break;
        case 'aberto':
          cond.push("p.situacao = 'aberta' AND p.vencimento >= ?");
          p.push(f.hoje);
          break;
        default:
          break;
      }
      if (f.vencimentoDe) {
        cond.push('p.vencimento >= ?');
        p.push(f.vencimentoDe);
      }
      if (f.vencimentoAte) {
        cond.push('p.vencimento <= ?');
        p.push(f.vencimentoAte);
      }
      if (f.credor !== null) {
        cond.push('COALESCE(t.empresa_fornecedora_id, t.profissional_id, t.colaborador_id) = ?');
        p.push(f.credor);
      }
      if (f.tipo) {
        const m = CREDOR_DO_TIPO[f.tipo as keyof typeof CREDOR_DO_TIPO];
        cond.push('tc.codigo = ?');
        p.push(m ? m.codigo : f.tipo);
      }
      const pagina = Math.max(0, f.pagina);
      const linhas = await l.consultar(
        `${SQL_PARCELAS_PAGAR} ${cond.map((x) => `AND ${x}`).join(' ')}
          ORDER BY p.vencimento DESC, p.id DESC LIMIT ? OFFSET ?`,
        [...p, POR_PAGINA_PAGAR + 1, pagina * POR_PAGINA_PAGAR],
      );
      return {
        itens: linhas.slice(0, POR_PAGINA_PAGAR).map((r) => tituloPagarDe(r, f.hoje)),
        pagina,
        mais: linhas.length > POR_PAGINA_PAGAR,
      };
    });
  }

  tituloPagar(
    c: ContextoFinanceiro,
    id: number,
    hoje: string,
  ): Promise<Omit<DetalheTituloPagarResposta, 'alcada' | 'legendaStatus'> | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_PARCELAS_PAGAR} AND p.id = ?`, [est, id]);
      if (!r) return null;
      const titulo = numero(r['titulo_id']);
      const irmas = await l.consultar(
        'SELECT id, sequencia, vencimento, valor, situacao FROM parcela_pagar WHERE titulo_pagar_id = ? AND excluido_em IS NULL ORDER BY sequencia',
        [titulo],
      );
      const nat = await l.uma('SELECT codigo, descricao FROM natureza_financeira WHERE id = ?', [r['natureza_financeira_id']]);
      const k = classificacaoDoCodigo(nat?.['codigo']);
      const retencoes = await l.consultar(
        `SELECT tr.id, tr.descricao, tr.esfera, r.valor_retido FROM retencao_titulo r
           JOIN parcela_pagar p ON p.id = r.parcela_pagar_id JOIN tributo tr ON tr.id = r.tributo_id
          WHERE p.titulo_pagar_id = ? AND r.excluido_em IS NULL ORDER BY r.sequencia`,
        [titulo],
      );
      const rateio = await l.consultar(
        'SELECT centro_custo_id, percentual, valor FROM rateio_lancamento WHERE titulo_pagar_id = ? AND excluido_em IS NULL ORDER BY sequencia',
        [titulo],
      );
      const aprov = (await aprovacoesPorTitulo(l, est, [titulo])).get(titulo) ?? [];
      return {
        ...tituloPagarDe(r, hoje),
        parcelas: irmas.map((x) => ({
          id: numero(x['id']),
          parcela: numero(x['sequencia']),
          vencimento: dataIso(x['vencimento']),
          valor: numero(x['valor']),
          situacao: texto(x['situacao']),
        })),
        classificacao: k ? { ...k, nome: texto(nat?.['descricao']), valor: numero(r['valor_bruto']) } : null,
        retencoes: retencoes.map((x) => ({
          codigo: numero(x['id']),
          descricao: texto(x['descricao']),
          tipo: TIPO_DA_ESFERA[texto(x['esfera'])] ?? 0,
          valor: numero(x['valor_retido']),
        })),
        profissional: numeroOuNulo(r['profissional_id']),
        rateio: rateio.map((x) => ({
          centroCusto: numero(x['centro_custo_id']),
          percentual: numero(x['percentual']),
          valor: numero(x['valor']),
        })),
        aprovacoesFeitas: aprov.map((a) => ({ aprovador: a.aprovador, ordem: a.ordem, em: a.em })),
        // O documento do credor só aparece pelo "mostrar dado" (auditado).
        documentoCredor: '',
      };
    });
  }

  documentoCredor(c: ContextoFinanceiro, titulo: number): Promise<string | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT COALESCE(ef.cnpj, ef.cpf, pf.cpf, co.cpf) AS documento
           FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
           LEFT JOIN empresa_fornecedora ef ON ef.id = t.empresa_fornecedora_id
           LEFT JOIN profissional pr ON pr.id = t.profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
           LEFT JOIN colaborador co ON co.id = t.colaborador_id
          WHERE p.id = ? AND t.estabelecimento_id = ? AND t.excluido_em IS NULL`,
        [titulo, est],
      );
      return r?.['documento'] ? String(r['documento']) : null;
    });
  }

  filaAprovacao(c: ContextoFinanceiro, hoje: string, ate: string): Promise<TituloPagarResposta[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_PARCELAS_PAGAR} AND p.situacao = 'aberta' AND p.vencimento <= ? ORDER BY p.vencimento, p.id LIMIT 500`,
          [est, ate],
        )
      ).map((r) => tituloPagarDe(r, hoje)),
    );
  }

  faixas(c: ContextoFinanceiro): Promise<FaixaAlcada[]> {
    return this.ler(c, (l, est) => faixasLidas(l, est));
  }

  aprovacoesDosTitulos(c: ContextoFinanceiro, ids: readonly number[]) {
    return this.ler(c, async (l, est) => {
      const m = new Map<number, { aprovador: string; faixa: number }[]>();
      if (ids.length === 0) return m;
      const pares = await l.consultar(
        `SELECT p.id, p.titulo_pagar_id FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
          WHERE t.estabelecimento_id = ? AND p.id IN (${lista(ids.length)})`,
        [est, ...ids],
      );
      const titulos = [...new Set(pares.map((x) => numero(x['titulo_pagar_id'])))];
      const ap = await aprovacoesPorTitulo(l, est, titulos);
      for (const x of pares)
        m.set(
          numero(x['id']),
          (ap.get(numero(x['titulo_pagar_id'])) ?? []).map((a) => ({ aprovador: a.aprovador, faixa: a.faixa })),
        );
      return m;
    });
  }

  borderos(c: ContextoFinanceiro, de: string, ate: string): Promise<BorderoResposta[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT b.id, b.numero, b.data_pagamento, b.valor_total, b.conta_bancaria_id, u.login,
                  (SELECT COUNT(*) FROM baixa_titulo x WHERE x.bordero_pagamento_id = b.id AND x.excluido_em IS NULL) AS titulos
             FROM bordero_pagamento b LEFT JOIN usuario u ON u.id = b.criado_por
            WHERE b.estabelecimento_id = ? AND b.excluido_em IS NULL AND b.data_pagamento BETWEEN ? AND ?
            ORDER BY b.data_pagamento DESC, b.id DESC LIMIT 500`,
          [est, de, ate],
        )
      ).map((r) => ({
        id: numero(r['id']),
        numero: documentoNumerico(r['numero']),
        data: dataIso(r['data_pagamento']),
        valor: numero(r['valor_total']),
        conta: numero(r['conta_bancaria_id']),
        usuario: texto(r['login']),
        titulos: numero(r['titulos']),
      })),
    );
  }

  adiantamentos(c: ContextoFinanceiro): Promise<AdiantamentoResposta[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, numero, tipo_credor, empresa_fornecedora_id, profissional_id, data_emissao, valor, saldo_compensar
             FROM adiantamento WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'
            ORDER BY data_emissao DESC, id DESC LIMIT 500`,
          [est],
        )
      ).map((r) => ({
        id: numero(r['id']),
        credor: numero(r['empresa_fornecedora_id'] ?? r['profissional_id']),
        tipoCredor: texto(r['tipo_credor']) === 'profissional' ? 'M' : 'F',
        documento: documentoNumerico(r['numero']),
        emissao: dataIso(r['data_emissao']),
        valor: numero(r['valor']),
        compensado: centavos(Math.max(0, numero(r['valor']) - numero(r['saldo_compensar']))),
        saldo: numero(r['saldo_compensar']),
      })),
    );
  }

  // ── Contas a receber ──────────────────────────────────────────────────────────────────────────────────────

  titulosReceber(c: ContextoFinanceiro, f: FiltroReceber): Promise<ListaTitulosReceber> {
    return this.ler(c, async (l, est) => {
      const cond: string[] = [];
      const p: unknown[] = [est];
      if (f.devedor) {
        cond.push('t.tipo_devedor = ?');
        p.push(TIPO_DO_DEVEDOR[f.devedor] ?? f.devedor);
      }
      if (f.convenio !== null) {
        cond.push('t.fonte_pagadora_id = ?');
        p.push(f.convenio);
      }
      if (f.aberto === true) cond.push("t.situacao IN ('aberto','recebido_parcial')");
      if (f.aberto === false) cond.push("t.situacao = 'recebido'");
      if (f.vencimentoDe || f.vencimentoAte) {
        cond.push(
          'EXISTS (SELECT 1 FROM parcela_receber x WHERE x.titulo_receber_id = t.id AND x.excluido_em IS NULL AND x.vencimento >= ? AND x.vencimento <= ?)',
        );
        p.push(f.vencimentoDe ?? '1900-01-01', f.vencimentoAte ?? '2999-12-31');
      }
      const pagina = Math.max(0, f.pagina);
      const linhas = await l.consultar(
        `${SQL_TITULOS_RECEBER} ${cond.map((x) => `AND ${x}`).join(' ')}
          ORDER BY t.data_emissao DESC, t.id DESC LIMIT ? OFFSET ?`,
        [...p, POR_PAGINA_RECEBER + 1, pagina * POR_PAGINA_RECEBER],
      );
      return {
        itens: linhas.slice(0, POR_PAGINA_RECEBER).map((r) => tituloReceberDe(r, f.hoje)),
        pagina,
        mais: linhas.length > POR_PAGINA_RECEBER,
      };
    });
  }

  tituloReceber(
    c: ContextoFinanceiro,
    id: number,
    hoje: string,
  ): Promise<(Omit<DetalheTituloReceberResposta, 'saldo' | 'recebivelRecurso'> & { recursoDeferido: number }) | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_TITULOS_RECEBER} AND t.id = ?`, [est, id]);
      if (!r) return null;
      const contas = await l.consultar(
        `SELECT ch.id, ch.natureza, ch.competencia, ch.valor_total FROM documento_origem_titulo d
           JOIN conta_hospitalar ch ON ch.id = d.entidade_id
          WHERE d.titulo_receber_id = ? AND d.entidade = 'conta_hospitalar' AND d.excluido_em IS NULL ORDER BY ch.id`,
        [id],
      );
      const g = await l.uma(
        `SELECT COUNT(*) AS itens, SUM(i.valor_pago > 0) AS baixados,
                SUM(CASE WHEN i.valor_pago > 0 THEN i.valor_total ELSE 0 END) AS cobrado,
                SUM(i.valor_pago) AS pago, SUM(i.valor_glosado) AS glosado,
                SUM(GREATEST(i.valor_pago - i.valor_total, 0)) AS a_maior
           FROM conta_hospitalar_item i
           JOIN documento_origem_titulo d ON d.entidade = 'conta_hospitalar' AND d.entidade_id = i.conta_hospitalar_id
          WHERE d.titulo_receber_id = ? AND d.excluido_em IS NULL AND i.excluido_em IS NULL`,
        [id],
      );
      const cobrado = numero(g?.['cobrado']);
      const rec = await l.uma(
        'SELECT SUM(valor_recurso) AS recurso FROM parcela_receber WHERE titulo_receber_id = ? AND excluido_em IS NULL',
        [id],
      );
      return {
        ...tituloReceberDe(r, hoje),
        recursoDeferido: centavos(numero(rec?.['recurso'])),
        contasLigadas: contas.map((x) => ({
          id: numero(x['id']),
          tipo: texto(x['natureza']) === 'internacao' ? 'I' : 'E',
          competencia: (dataIso(x['competencia']) ?? '').slice(0, 7),
          total: numero(x['valor_total']),
        })),
        glosa: {
          itens: numero(g?.['itens']),
          baixados: numero(g?.['baixados']),
          cobradoBaixado: centavos(cobrado),
          pagoBaixado: centavos(numero(g?.['pago'])),
          glosado: centavos(numero(g?.['glosado'])),
          pagoAMaior: centavos(numero(g?.['a_maior'])),
          taxa: cobrado > 0 ? Math.round((numero(g?.['glosado']) / cobrado) * 10_000) / 10_000 : 0,
        },
        // Pendência de modelo (glosa_titulo_receber): a lista das glosas por evento; o recurso deferido vem somado
        // da parcela (recursoDeferido) e alimenta o recebível do recurso.
        glosas: [],
      };
    });
  }

  tituloDoItem(c: ContextoFinanceiro, item: number): Promise<number | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT d.titulo_receber_id FROM conta_hospitalar_item i
           JOIN documento_origem_titulo d ON d.entidade = 'conta_hospitalar' AND d.entidade_id = i.conta_hospitalar_id
                AND d.excluido_em IS NULL
           JOIN titulo_receber t ON t.id = d.titulo_receber_id AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
          WHERE i.id = ? AND t.estabelecimento_id = ? ORDER BY t.id DESC LIMIT 1`,
        [item, est],
      );
      return r ? numero(r['titulo_receber_id']) : null;
    });
  }

  contasSemTitulo(
    c: ContextoFinanceiro,
    f: { convenio: number | null; ano: number; mes: number | null },
  ): Promise<ContaSemTituloResposta[]> {
    return this.ler(c, async (l, est) => {
      const de = f.mes ? inicioDoMes(f.ano, f.mes) : `${f.ano}-01-01`;
      const ate = f.mes ? inicioDoMes(f.ano, f.mes) : `${f.ano}-12-01`;
      const linhas = await l.consultar(
        `SELECT c.id, c.fonte_pagadora_id, c.natureza, c.competencia, c.situacao, c.valor_total, c.fechada_em, c.versao
           FROM conta_hospitalar c
          WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao IN (${SITUACOES_TITULAVEIS})
            AND c.valor_total > 0 AND c.competencia BETWEEN ? AND ? AND (? IS NULL OR c.fonte_pagadora_id = ?)
            AND NOT EXISTS (SELECT 1 FROM documento_origem_titulo d JOIN titulo_receber t ON t.id = d.titulo_receber_id
                             WHERE d.entidade = 'conta_hospitalar' AND d.entidade_id = c.id AND d.excluido_em IS NULL
                               AND t.excluido_em IS NULL AND t.situacao <> 'cancelado')
          ORDER BY c.competencia, c.id LIMIT 2000`,
        [est, de, ate, f.convenio, f.convenio],
      );
      return linhas.map((r) => ({
        id: numero(r['id']),
        convenio: numero(r['fonte_pagadora_id']),
        tipo: texto(r['natureza']) === 'internacao' ? 'I' : 'E',
        competencia: (dataIso(r['competencia']) ?? '').slice(0, 7),
        // Vocabulário da tela: S fechada, A apresentada (faturada ou enviada).
        fechada: texto(r['situacao']) === 'fechada' ? 'S' : 'A',
        total: numero(r['valor_total']),
        apresentacao: dataIso(r['fechada_em']),
        versao: versaoTexto(r['versao']),
      }));
    });
  }

  contaCorrenteConvenios(c: ContextoFinanceiro) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT cf.id, cf.data_credito, cf.numero_documento, cf.valor, cf.historico, cf.conta_bancaria_id,
                  cf.fonte_pagadora_id, f.nome
             FROM credito_fonte_pagadora cf JOIN fonte_pagadora f ON f.id = cf.fonte_pagadora_id
            WHERE cf.estabelecimento_id = ? AND cf.excluido_em IS NULL
            ORDER BY cf.data_credito DESC, cf.id DESC LIMIT 1000`,
          [est],
        )
      ).map((r) => ({
        id: numero(r['id']),
        data: dataIso(r['data_credito']),
        documento: documentoNumerico(r['numero_documento']),
        valor: numero(r['valor']),
        devedor: texto(r['nome']),
        codigo: numero(r['fonte_pagadora_id']),
        historico: texto(r['historico']),
        conta: numeroOuNulo(r['conta_bancaria_id']),
      })),
    );
  }

  renegociacoes(c: ContextoFinanceiro) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT r.id, r.renegociado_em, u.login,
                  (SELECT COUNT(*) FROM titulo_renegociado x WHERE x.renegociacao_id = r.id AND x.excluido_em IS NULL) AS titulos
             FROM renegociacao r LEFT JOIN usuario u ON u.id = r.responsavel_usuario_id
            WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL ORDER BY r.renegociado_em DESC LIMIT 500`,
          [est],
        )
      ).map((r) => ({
        id: numero(r['id']),
        em: instanteIso(r['renegociado_em']) ?? '',
        responsavel: texto(r['login']),
        titulos: numero(r['titulos']),
      })),
    );
  }

  // ── Tesouraria ────────────────────────────────────────────────────────────────────────────────────────────

  movimento(
    c: ContextoFinanceiro,
    conta: number,
    de: string,
    ate: string,
  ): Promise<Omit<MovimentoResposta, 'rotuloTipo'>[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT m.id, m.data_movimento, m.numero_documento, m.tipo_origem, m.natureza, m.valor, m.historico,
                  m.conta_bancaria_id, m.contrapartida_conta_bancaria_id, n.codigo AS natureza_codigo, u.login
             FROM movimento_bancario m
             LEFT JOIN natureza_financeira n ON n.id = m.natureza_financeira_id
             LEFT JOIN usuario u ON u.id = m.criado_por
            WHERE m.estabelecimento_id = ? AND m.conta_bancaria_id = ? AND m.excluido_em IS NULL
              AND m.situacao = 'ativo' AND m.data_movimento BETWEEN ? AND ?
            ORDER BY m.data_movimento, m.id LIMIT 5000`,
          [est, conta, de, ate],
        )
      ).map((r) => {
        const credito = texto(r['natureza']) === 'credito';
        const propria = numero(r['conta_bancaria_id']);
        const outra = numeroOuNulo(r['contrapartida_conta_bancaria_id']);
        return {
          id: numero(r['id']),
          data: dataIso(r['data_movimento']),
          documento: documentoNumerico(r['numero_documento']) || numero(r['id']),
          tipo: tipoDoMovimento(r['tipo_origem'], r['natureza']),
          valor: numero(r['valor']),
          historico: texto(r['historico']),
          contaCredito: credito ? propria : outra,
          contaDebito: credito ? outra : propria,
          classificacao: texto(r['natureza_codigo']),
          usuario: texto(r['login']),
        };
      }),
    );
  }

  linhasExtrato(c: ContextoFinanceiro, conta: number, situacao: string | null): Promise<LinhaExtratoResposta[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT x.id, x.data_movimento, x.valor, x.historico, x.documento, x.situacao_conciliacao
             FROM linha_extrato x JOIN extrato_bancario e ON e.id = x.extrato_bancario_id
            WHERE e.estabelecimento_id = ? AND e.conta_bancaria_id = ? AND e.excluido_em IS NULL
              AND x.excluido_em IS NULL AND (? IS NULL OR x.situacao_conciliacao = ?)
            ORDER BY x.data_movimento, x.id LIMIT 2000`,
          [est, conta, situacao, situacao],
        )
      ).map((r) => ({
        id: numero(r['id']),
        data: dataIso(r['data_movimento']) ?? '',
        valor: numero(r['valor']),
        historico: texto(r['historico']),
        documento: texto(r['documento']),
        situacao: texto(r['situacao_conciliacao']),
      })),
    );
  }

  creditosPendentes(c: ContextoFinanceiro, desde: string): Promise<CreditoPendenteResposta[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, conta_bancaria_id, data_credito, valor, situacao, titulo_receber_id, movimento_bancario_id
             FROM credito_nao_identificado
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND data_credito >= ?
            ORDER BY data_credito, id LIMIT 2000`,
          [est, desde],
        )
      ).map((r) => ({
        id: numero(r['id']),
        conta: numero(r['conta_bancaria_id']),
        data: dataIso(r['data_credito']) ?? '',
        valor: numero(r['valor']),
        situacao: texto(r['situacao']),
        tituloReceber: numeroOuNulo(r['titulo_receber_id']),
        origem: r['movimento_bancario_id'] ? 'movimento' : 'extrato',
      })),
    );
  }

  lancamentosFluxo(c: ContextoFinanceiro, de: string, ate: string): Promise<LancamentoFluxoPorta[]> {
    return this.ler(c, async (l, est) => {
      const movs = await l.consultar(
        `SELECT data_movimento, valor, natureza FROM movimento_bancario
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'ativo' AND data_movimento BETWEEN ? AND ?`,
        [est, de, ate],
      );
      const pagar = await l.consultar(
        `SELECT p.vencimento, p.saldo FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND p.excluido_em IS NULL
            AND p.situacao IN ('aberta','parcial') AND p.saldo > 0 AND p.vencimento BETWEEN ? AND ?`,
        [est, de, ate],
      );
      const receber = await l.consultar(
        `SELECT p.vencimento, p.saldo, t.fonte_pagadora_id FROM parcela_receber p
           JOIN titulo_receber t ON t.id = p.titulo_receber_id
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND p.excluido_em IS NULL
            AND p.situacao IN ('aberta','parcial') AND p.saldo > 0 AND p.vencimento BETWEEN ? AND ?`,
        [est, de, ate],
      );
      return [
        ...movs.map((r) => ({
          data: dataIso(r['data_movimento']) ?? de,
          valor: numero(r['valor']),
          sentido: (texto(r['natureza']) === 'credito' ? 'entrada' : 'saida') as 'entrada' | 'saida',
          origem: 'movimento' as const,
          realizado: true,
        })),
        ...pagar.map((r) => ({
          data: dataIso(r['vencimento']) ?? de,
          valor: numero(r['saldo']),
          sentido: 'saida' as const,
          origem: 'pagar' as const,
          realizado: false,
        })),
        ...receber.map((r) => ({
          data: dataIso(r['vencimento']) ?? de,
          valor: numero(r['saldo']),
          sentido: 'entrada' as const,
          origem: 'receber' as const,
          realizado: false,
          ...(r['fonte_pagadora_id'] ? { convenio: numero(r['fonte_pagadora_id']) } : {}),
        })),
      ];
    });
  }

  historicosConvenio(c: ContextoFinanceiro, desde: string) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT t.fonte_pagadora_id, SUM(t.valor_bruto) AS bruto, SUM(t.valor_glosa) AS glosa,
                  AVG((SELECT DATEDIFF(MAX(r.data_recebimento), MIN(p.vencimento)) FROM parcela_receber p
                         JOIN recebimento r ON r.parcela_receber_id = p.id AND r.situacao = 'efetivado' AND r.excluido_em IS NULL
                        WHERE p.titulo_receber_id = t.id)) AS atraso
             FROM titulo_receber t
            WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.fonte_pagadora_id IS NOT NULL
              AND t.situacao <> 'cancelado' AND t.data_emissao >= ?
            GROUP BY t.fonte_pagadora_id`,
          [est, desde],
        )
      ).map((r) => ({
        convenio: numero(r['fonte_pagadora_id']),
        taxaGlosa: numero(r['bruto']) > 0 ? Math.round((numero(r['glosa']) / numero(r['bruto'])) * 10_000) / 10_000 : 0,
        atrasoMedioDias: Math.round(numero(r['atraso'])),
      })),
    );
  }

  // ── Gerencial ─────────────────────────────────────────────────────────────────────────────────────────────

  basesDre(c: ContextoFinanceiro, de: number, ate: number): Promise<BasesDrePorta> {
    return this.ler(c, async (l, est) => {
      const ini = inicioDoMes(Math.floor(de / 100), de % 100);
      const fim = fimDoMes(Math.floor(ate / 100), ate % 100);
      const receitas = await l.consultar(
        `SELECT DATE_FORMAT(COALESCE(competencia, data_emissao), '%Y%m') AS mes, SUM(valor_bruto) AS valor,
                SUM(valor_glosa_aceita) AS glosa
           FROM titulo_receber WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'
            AND COALESCE(competencia, data_emissao) BETWEEN ? AND ? GROUP BY mes`,
        [est, ini, fim],
      );
      const despesas = await l.consultar(
        `SELECT DATE_FORMAT(t.data_emissao, '%Y%m') AS mes, g.codigo AS grupo, SUM(t.valor_bruto) AS valor
           FROM titulo_pagar t JOIN natureza_financeira n ON n.id = t.natureza_financeira_id
           JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
           JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
            AND t.data_emissao BETWEEN ? AND ? GROUP BY mes, g.codigo`,
        [est, ini, fim],
      );
      const pagos = await l.consultar(
        `SELECT b.data_pagamento AS data, g.codigo AS grupo, b.valor_pago AS valor
           FROM baixa_titulo b JOIN parcela_pagar p ON p.id = b.parcela_pagar_id
           JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
           JOIN natureza_financeira n ON n.id = t.natureza_financeira_id
           JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
           JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id
          WHERE b.estabelecimento_id = ? AND b.excluido_em IS NULL AND b.situacao = 'efetivada'
            AND b.data_pagamento BETWEEN ? AND ?`,
        [est, ini, fim],
      );
      const recebidos = await l.consultar(
        `SELECT data_recebimento AS data, valor_recebido AS valor FROM recebimento
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'efetivado' AND data_recebimento BETWEEN ? AND ?`,
        [est, ini, fim],
      );
      return {
        receitas: receitas.map((r) => ({
          competencia: numero(r['mes']),
          valor: numero(r['valor']),
          glosaAceita: numero(r['glosa']),
        })),
        despesas: despesas.map((r) => ({
          competencia: numero(r['mes']),
          valor: numero(r['valor']),
          grupo: documentoNumerico(r['grupo']),
        })),
        caixa: [
          ...recebidos.map((r) => ({
            data: dataIso(r['data']) ?? ini,
            valor: numero(r['valor']),
            natureza: 'receita' as const,
            grupo: 0,
          })),
          ...pagos.map((r) => ({
            data: dataIso(r['data']) ?? ini,
            valor: numero(r['valor']),
            natureza: 'despesa' as const,
            grupo: documentoNumerico(r['grupo']),
          })),
        ],
      };
    });
  }

  apropriacoes(
    c: ContextoFinanceiro,
    f: { de: string; ate: string; grupo: number | null; pagina: number },
  ): Promise<ListaApropriacoes> {
    return this.ler(c, async (l, est) => {
      const pagina = Math.max(0, f.pagina);
      const linhas = await l.consultar(
        `SELECT t.id, t.numero_documento, t.serie_documento, t.data_emissao, t.valor_bruto,
                COALESCE(t.empresa_fornecedora_id, t.profissional_id, t.colaborador_id) AS credor,
                tc.codigo AS tipo_codigo, tc.natureza AS tipo_natureza, n.codigo, n.descricao,
                (SELECT MIN(p.id) FROM parcela_pagar p WHERE p.titulo_pagar_id = t.id AND p.excluido_em IS NULL) AS parcela,
                (SELECT COUNT(*) FROM rateio_lancamento r WHERE r.titulo_pagar_id = t.id AND r.excluido_em IS NULL) AS centros
           FROM titulo_pagar t JOIN tipo_credor tc ON tc.id = t.tipo_credor_id
           JOIN natureza_financeira n ON n.id = t.natureza_financeira_id
           JOIN subgrupo_natureza_financeira s ON s.id = n.subgrupo_natureza_financeira_id
           JOIN grupo_natureza_financeira g ON g.id = s.grupo_natureza_financeira_id
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
            AND t.data_emissao BETWEEN ? AND ? AND (? IS NULL OR g.codigo = ?)
          ORDER BY t.data_emissao, t.id LIMIT ? OFFSET ?`,
        [
          est,
          f.de,
          f.ate,
          f.grupo === null ? null : String(f.grupo),
          f.grupo === null ? null : String(f.grupo),
          POR_PAGINA_APROPRIACAO + 1,
          pagina * POR_PAGINA_APROPRIACAO,
        ],
      );
      return {
        itens: linhas.slice(0, POR_PAGINA_APROPRIACAO).map((r) => {
          const k = classificacaoDoCodigo(r['codigo']) ?? { grupo: 0, subgrupo: 0, item: 0 };
          return {
            titulo: numeroOuNulo(r['parcela']),
            credor: numero(r['credor']),
            documento: documentoNumerico(r['numero_documento']),
            tipo: tipoCredorDe(r['tipo_codigo'], r['tipo_natureza']),
            serie: texto(r['serie_documento']),
            data: dataIso(r['data_emissao']),
            ...k,
            nome: texto(r['descricao']),
            valor: numero(r['valor_bruto']),
            centrosCusto: numero(r['centros']),
          };
        }),
        pagina,
        mais: linhas.length > POR_PAGINA_APROPRIACAO,
      };
    });
  }

  basesIndicadores(c: ContextoFinanceiro, de: string, ate: string): Promise<BasesIndicadoresPorta> {
    return this.ler(c, async (l, est) => {
      const pg = await l.uma(
        `SELECT COUNT(DISTINCT t.id) AS pagos,
                COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM pedido_aprovacao pa WHERE pa.entidade = 'titulo_pagar'
                      AND pa.entidade_id = t.id AND pa.situacao = 'aprovado' AND pa.excluido_em IS NULL) THEN t.id END) AS aprovados
           FROM baixa_titulo b JOIN parcela_pagar p ON p.id = b.parcela_pagar_id JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
          WHERE b.estabelecimento_id = ? AND b.situacao = 'efetivada' AND b.excluido_em IS NULL
            AND b.data_pagamento BETWEEN ? AND ?`,
        [est, de, ate],
      );
      const ct = await l.uma(
        `SELECT COUNT(*) AS contas,
                SUM(EXISTS (SELECT 1 FROM documento_origem_titulo d JOIN titulo_receber t ON t.id = d.titulo_receber_id
                             WHERE d.entidade = 'conta_hospitalar' AND d.entidade_id = c.id AND d.excluido_em IS NULL
                               AND t.excluido_em IS NULL AND t.situacao <> 'cancelado')) AS com_titulo
           FROM conta_hospitalar c
          WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL AND c.situacao IN (${SITUACOES_TITULAVEIS})
            AND c.fechada_em >= ? AND c.fechada_em < DATE_ADD(?, INTERVAL 1 DAY)`,
        [est, de, ate],
      );
      const tt = await l.uma(
        `SELECT COUNT(*) AS titulos FROM titulo_pagar
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND data_emissao BETWEEN ? AND ?`,
        [est, de, ate],
      );
      const pagos = numero(pg?.['pagos']);
      return {
        pagos,
        aprovados: numero(pg?.['aprovados']),
        // Todo pagamento é deste sistema (não há outro gravando no banco do cliente).
        pagosPeloNovo: pagos,
        contas: numero(ct?.['contas']),
        contasComTitulo: numero(ct?.['com_titulo']),
        titulos: numero(tt?.['titulos']),
        // Credor órfão não existe no modelo: o título referencia o credor por chave estrangeira.
        orfaos: 0,
      };
    });
  }

  // ── Fiscal ────────────────────────────────────────────────────────────────────────────────────────────────

  escrituracao(c: ContextoFinanceiro, ano: number, mes: number): Promise<EscrituracaoResposta[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT e.id, e.numero_documento, e.data_emissao, e.empresa_fornecedora_id, e.modelo_documento, e.chave_acesso,
                  cf.codigo AS cfop,
                  (SELECT COUNT(*) FROM escrituracao_item_entrada i WHERE i.escrituracao_entrada_id = e.id AND i.excluido_em IS NULL) AS itens,
                  (SELECT COUNT(*) FROM escrituracao_item_entrada i WHERE i.escrituracao_entrada_id = e.id AND i.excluido_em IS NULL
                      AND i.cfop_id IS NOT NULL) AS itens_cfop
             FROM escrituracao_entrada e LEFT JOIN cfop cf ON cf.id = e.cfop_id
            WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL AND e.competencia = ?
            ORDER BY e.data_entrada, e.id LIMIT 2000`,
          [est, inicioDoMes(ano, mes)],
        )
      ).map((r) => ({
        nota: numero(r['id']),
        numero: texto(r['numero_documento']),
        emissao: dataIso(r['data_emissao']),
        fornecedor: numero(r['empresa_fornecedora_id']),
        cfop: r['cfop'] ? documentoNumerico(r['cfop']) : null,
        tipoDocumento: documentoNumerico(r['modelo_documento']) || null,
        chaveNfe: texto(r['chave_acesso']),
        itens: numero(r['itens']),
        itensComCfop: numero(r['itens_cfop']),
      })),
    );
  }

  /** Pendência de modelo: o de-para contábil por evento (regra de contabilização); sem ele, o lote sai "sem de-para". */
  async deParaContabil() {
    return [] as {
      convenio: number;
      tipoConta: string;
      tipoLancamento: number;
      grupo: number;
      subgrupo: number;
      item: number;
      conta: number | null;
    }[];
  }

  retencoesDaCompetencia(c: ContextoFinanceiro, ano: number, mes: number): Promise<RetencaoReinfPorta[]> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT t.id, COALESCE(ef.cnpj, ef.cpf) AS documento, t.numero_documento, t.data_emissao, t.valor_bruto,
                LOWER(tr.codigo) AS tributo, SUM(r.valor_retido) AS valor
           FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id
           JOIN titulo_pagar t ON t.id = p.titulo_pagar_id JOIN tributo tr ON tr.id = r.tributo_id
           LEFT JOIN empresa_fornecedora ef ON ef.id = t.empresa_fornecedora_id
          WHERE t.estabelecimento_id = ? AND r.competencia = ? AND r.excluido_em IS NULL AND t.excluido_em IS NULL
            AND r.retencao_dispensada = FALSE
          GROUP BY t.id, documento, t.numero_documento, t.data_emissao, t.valor_bruto, tributo
          ORDER BY t.id`,
        [est, inicioDoMes(ano, mes)],
      );
      const porTitulo = new Map<number, { -readonly [K in keyof RetencaoReinfPorta]: RetencaoReinfPorta[K] }>();
      for (const r of linhas) {
        const id = numero(r['id']);
        const x = porTitulo.get(id) ?? {
          cnpjPrestador: texto(r['documento']),
          documento: documentoNumerico(r['numero_documento']),
          dataEmissao: dataIso(r['data_emissao']) ?? '',
          valorBruto: numero(r['valor_bruto']),
          inss: 0,
          ir: 0,
          csll: 0,
          pis: 0,
          cofins: 0,
        };
        const t = texto(r['tributo']);
        const v = numero(r['valor']);
        if (t.includes('inss')) x.inss = centavos(x.inss + v);
        else if (t.includes('csll')) x.csll = centavos(x.csll + v);
        else if (t.includes('cofins')) x.cofins = centavos(x.cofins + v);
        else if (t.includes('pis')) x.pis = centavos(x.pis + v);
        else if (t.startsWith('ir')) x.ir = centavos(x.ir + v);
        porTitulo.set(id, x);
      }
      return [...porTitulo.values()];
    });
  }

  registrosFiscais(
    c: ContextoFinanceiro,
    tipo: 'nfse' | 'declaracao' | 'lote' | 'remessa',
  ): Promise<RegistroFiscalResposta[]> {
    // As chaves são as colunas que as telas fiscais mostram (contrato RegistroFiscalResposta).
    return this.ler(c, async (l, est) => {
      switch (tipo) {
        case 'remessa':
          return (
            await l.consultar(
              `SELECT id, sequencia_arquivo, conta_bancaria_id, formato, quantidade_registros, valor_total, situacao,
                      observacao, gerado_em, enviado_em
                 FROM remessa_bancaria WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY gerado_em DESC LIMIT 500`,
              [est],
            )
          ).map((r) => {
            const o = jsonDe(r['observacao']);
            return {
              ID: numero(r['id']),
              SEQUENCIAL: numero(r['sequencia_arquivo']),
              CONTA: numero(r['conta_bancaria_id']),
              LEIAUTE: texto(r['formato']),
              TITULOS: numero(r['quantidade_registros']),
              VALOR_TOTAL: numero(r['valor_total']),
              DESTINO: texto(o['destino']) || (r['enviado_em'] ? 'banco' : 'simulador'),
              SITUACAO: texto(r['situacao']),
              OCORRENCIAS: o['ocorrencias'] ? texto(o['ocorrencias']) : null,
              GERADO_EM: instanteIso(r['gerado_em']),
            };
          });
        case 'lote':
          return (
            await l.consultar(
              `SELECT id, competencia, quantidade_lancamentos, valor_total, observacao, gerado_em, situacao
                 FROM lote_exportacao_contabil WHERE estabelecimento_id = ? AND excluido_em IS NULL
                ORDER BY gerado_em DESC LIMIT 500`,
              [est],
            )
          ).map((r) => {
            const o = jsonDe(r['observacao']);
            return {
              ID: numero(r['id']),
              PERIODO: (dataIso(r['competencia']) ?? '').slice(0, 7),
              REGUA: texto(o['regua']),
              LANCAMENTOS: numero(r['quantidade_lancamentos']),
              SOMA_DEBITOS: numero(r['valor_total']),
              SOMA_CREDITOS: o['somaCreditos'] === undefined ? numero(r['valor_total']) : numero(o['somaCreditos']),
              SEM_DE_PARA: numero(o['semDePara']),
              SITUACAO: texto(r['situacao']),
              EXPORTADO_EM: instanteIso(r['gerado_em']),
            };
          });
        case 'nfse':
          return (
            await l.consultar(
              `SELECT id, numero_nota, titulo_receber_id, valor_servicos, valor_iss, valor_liquido, ambiente, situacao,
                      data_emissao
                 FROM nota_servico WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY data_emissao DESC LIMIT 500`,
              [est],
            )
          ).map((r) => ({
            ID: numero(r['id']),
            NUMERO: texto(r['numero_nota']),
            TITULO_RECEBER: numeroOuNulo(r['titulo_receber_id']),
            MOMENTO: '',
            VALOR_SERVICOS: numero(r['valor_servicos']),
            VALOR_ISS: numero(r['valor_iss']),
            VALOR_IBS: 0,
            VALOR_CBS: 0,
            VALOR_LIQUIDO: numero(r['valor_liquido']),
            DESTINO: texto(r['ambiente']) === 'producao' ? 'prefeitura' : 'simulador',
            SITUACAO: texto(r['situacao']),
            EMITIDO_EM: instanteIso(r['data_emissao']),
          }));
        case 'declaracao':
          return (
            await l.consultar(
              `SELECT id, ano_calendario, codigo_leiaute, situacao, gerada_em FROM declaracao_dmed
                WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY ano_calendario DESC LIMIT 500`,
              [est],
            )
          ).map((r) => ({
            ID: numero(r['id']),
            TIPO: 'dmed',
            PERIODO: String(numero(r['ano_calendario'])),
            LEIAUTE: texto(r['codigo_leiaute']),
            REGISTROS: null,
            VALOR_TOTAL: null,
            SITUACAO: texto(r['situacao']),
            GERADO_EM: instanteIso(r['gerada_em']),
          }));
      }
    });
  }
}

// ── Gravações diretas (dentro da operação do executor) ──────────────────────────────────────────────────────────

const modeloPendente = (oQue: string) =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Registro indisponível',
    `${oQue} aguarda a tabela no modelo do banco: o arquivo foi gerado e guardado, mas o registro não é gravado.`,
  );

function gravadorSobre(tx: TxOperacao, est: number): GravadorSghFinanceiro {
  const usuario = tx.contexto.usuario;
  const agora = () => new Date();
  const login = () => loginDe(tx, usuario);
  const foraDoEscopo = () =>
    new ErroOperacao(403, 'fora-do-escopo', 'Fora do escopo', 'A conta bancária não está no seu escopo de contas.');

  async function tipoAprovacao(): Promise<number> {
    const r = await tx.uma('SELECT id FROM tipo_documento_aprovacao WHERE codigo = ?', [TIPO_APROVACAO_TITULO]);
    if (r) return numero(r['id']);
    return tx.incluir('tipo_documento_aprovacao', {
      codigo: TIPO_APROVACAO_TITULO,
      descricao: 'Título a pagar',
      entidade: 'titulo_pagar',
      tipo_limite: 'valor',
    });
  }

  return {
    async salvarFaixa(d) {
      const tipo = await tipoAprovacao();
      const atuais = await faixasLidas(tx, est);
      const nova: FaixaAlcada = {
        id: d.id ?? 0,
        empresa: 1,
        centroCusto: d.centroCusto,
        tipoCredor: d.tipoCredor,
        valorDe: d.valorDe,
        valorAte: d.valorAte,
        aprovacoes: d.aprovacoes,
        permissao: d.permissao,
        vigenciaInicio: d.vigenciaInicio,
        vigenciaFim: d.vigenciaFim,
        ativa: d.ativa,
      };
      if (d.id !== null && !atuais.some((f) => f.id === d.id))
        throw recusa('faixa-inexistente', 'A faixa de alçada não existe.');
      recusar(conferirFaixas([...atuais.filter((f) => f.id !== d.id), nova]));
      if (d.centroCusto !== null && !(await tx.uma('SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ?', [d.centroCusto, est])))
        throw recusa('centro-custo-inexistente', 'O centro de custo não existe neste estabelecimento.', {
          campos: ['centroCusto'],
        });
      const condicao = JSON.stringify({ tipoCredor: d.tipoCredor, permissao: d.permissao });
      const fluxo = {
        centro_custo_id: d.centroCusto,
        valor_minimo: d.valorDe,
        valor_maximo: d.valorAte,
        vigencia_inicio: d.vigenciaInicio,
        vigencia_fim: d.vigenciaFim,
        ativo: d.ativa,
        descricao: `Alçada do título a pagar: ${d.valorDe.toFixed(2)} a ${d.valorAte === null ? 'sem teto' : d.valorAte.toFixed(2)}`,
      };
      const etapa = { quantidade_minima_aprovadores: d.aprovacoes, regra_quorum: 'minimo', condicao_entrada: condicao };
      if (d.id !== null) {
        const [f] = await tx.consultarParaAtualizar('SELECT id, versao FROM fluxo_aprovacao WHERE id = ?', [d.id], {
          teto: 1,
        });
        await tx.alterar('fluxo_aprovacao', d.id, numero(f?.['versao']), fluxo);
        const [e] = await tx.consultarParaAtualizar(
          'SELECT id, versao FROM etapa_fluxo_aprovacao WHERE fluxo_aprovacao_id = ? AND sequencia = 1 AND excluido_em IS NULL',
          [d.id],
          { teto: 1 },
        );
        if (e) await tx.alterar('etapa_fluxo_aprovacao', numero(e['id']), numero(e['versao']), etapa);
        else await tx.incluir('etapa_fluxo_aprovacao', { fluxo_aprovacao_id: d.id, sequencia: 1, nome: 'Aprovação', ...etapa });
        return { id: d.id };
      }
      await garantirSequencia(tx, { tipo: 'fluxo_aprovacao', estabelecimento: est, prefixo: `ALC${est}-` }, { usuario, agora: agora() });
      const num = await tx.proximoNumero('fluxo_aprovacao');
      const id = await tx.incluir('fluxo_aprovacao', {
        estabelecimento_id: est,
        codigo: num.formatado,
        tipo_documento_aprovacao_id: tipo,
        prioridade: 1,
        ...fluxo,
      });
      await tx.incluir('etapa_fluxo_aprovacao', { fluxo_aprovacao_id: id, sequencia: 1, nome: 'Aprovação', ...etapa });
      return { id };
    },

    async aprovarTitulo(d) {
      const [p] = await tx.consultarParaAtualizar(
        `SELECT t.id, t.versao, t.situacao, t.valor_bruto, t.criado_por, t.centro_custo_id, t.numero_documento,
                t.empresa_fornecedora_id, tc.codigo AS tipo_codigo, tc.natureza
           FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
           JOIN tipo_credor tc ON tc.id = t.tipo_credor_id
          WHERE p.id = ? AND t.estabelecimento_id = ? AND p.excluido_em IS NULL AND t.excluido_em IS NULL`,
        [d.titulo, est],
        { teto: 1 },
      );
      if (!p) throw recusa('titulo-inexistente', 'O título não existe.');
      const titulo = numero(p['id']);
      const hoje = new Date().toISOString().slice(0, 10);
      const faixa = alcadaAplicavel(
        await faixasLidas(tx, est),
        {
          empresa: 1,
          centroCusto: await centroDaAlcada(tx, titulo, p['centro_custo_id']),
          tipo: tipoCredorDe(p['tipo_codigo'], p['natureza']),
          valor: numero(p['valor_bruto']),
        },
        hoje,
      );
      const aprovacoes = (await aprovacoesPorTitulo(tx, est, [titulo])).get(titulo) ?? [];
      const aprovador = (await login()) ?? '';
      recusar(
        conferirAprovacao({
          faixa,
          aprovacoes,
          aprovador,
          lancador: await loginDe(tx, p['criado_por']),
          temPermissaoDaFaixa: faixa ? d.temPermissao(faixa.permissao) : false,
          valor: numero(p['valor_bruto']),
          emAberto: texto(p['situacao']) === 'aberto',
        }),
      );
      const tipo = await tipoAprovacao();
      const [pedido] = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM pedido_aprovacao WHERE estabelecimento_id = ? AND entidade = 'titulo_pagar'
            AND entidade_id = ? AND excluido_em IS NULL AND situacao IN ('pendente','em_aprovacao')`,
        [est, titulo],
        { teto: 1 },
      );
      const pedidoId = pedido
        ? numero(pedido['id'])
        : await tx.incluir('pedido_aprovacao', {
            estabelecimento_id: est,
            tipo_documento_aprovacao_id: tipo,
            entidade: 'titulo_pagar',
            entidade_id: titulo,
            numero_documento: texto(p['numero_documento']).slice(0, 60),
            valor: numero(p['valor_bruto']),
            centro_custo_id: p['centro_custo_id'] ?? null,
            empresa_fornecedora_id: p['empresa_fornecedora_id'] ?? null,
            resumo_documento: JSON.stringify({ faixa: faixa?.id ?? 0 }),
            solicitante_usuario_id: p['criado_por'] ?? usuario,
            solicitado_em: agora(),
            situacao: 'em_aprovacao',
          });
      const daFaixa = aprovacoes.filter((a) => a.faixa === faixa?.id);
      const ordem = daFaixa.length + 1;
      const decisao = await tx.incluir('decisao_aprovacao', {
        pedido_aprovacao_id: pedidoId,
        nivel: ordem,
        aprovador_usuario_id: usuario,
        decisao: 'aprovado',
        justificativa: d.observacao.trim() || null,
        valor_aprovado: numero(p['valor_bruto']),
        ocorrido_em: agora(),
      });
      const sit = situacaoAprovacao(faixa, [...daFaixa, { aprovador, ordem: ordem === 2 ? 2 : 1, faixa: faixa?.id ?? 0, em: '' }]);
      const [pv] = await tx.consultarParaAtualizar('SELECT versao FROM pedido_aprovacao WHERE id = ?', [pedidoId], { teto: 1 });
      await tx.alterar('pedido_aprovacao', pedidoId, numero(pv?.['versao']), {
        nivel_atual: sit.aprovado ? ordem : ordem + 1,
        situacao: sit.aprovado ? 'aprovado' : 'em_aprovacao',
        concluido_em: sit.aprovado ? agora() : null,
      });
      if (sit.aprovado)
        await tx.alterar('titulo_pagar', titulo, numero(p['versao']), {
          autorizado: true,
          autorizado_em: agora(),
          autorizador_usuario_id: usuario,
          pedido_aprovacao_id: pedidoId,
        });
      return { id: decisao, ordem, aprovado: sit.aprovado, faltam: sit.faltam };
    },

    async registrarGlosaTitulo(d) {
      // Sem a glosa por evento no modelo (pedido glosa_titulo_receber), a chave do evento não tem onde ser guardada:
      // recusar em vez de somar o mesmo evento duas vezes.
      if (d.chaveEvento) throw modeloPendente('O registro da glosa por evento (com a chave do evento)');
      const [t] = await tx.consultarParaAtualizar(
        `SELECT id, versao, valor_liquido, valor_recebido, valor_glosa, valor_glosa_aceita, situacao FROM titulo_receber
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [d.tituloReceber, est],
        { teto: 1 },
      );
      if (!t) throw recusa('titulo-inexistente', 'O título não existe.');
      const [p] = await tx.consultarParaAtualizar(
        `SELECT id, versao, valor_glosa, valor_glosa_aceita, valor_recurso FROM parcela_receber
          WHERE titulo_receber_id = ? AND excluido_em IS NULL ORDER BY sequencia LIMIT 1`,
        [d.tituloReceber],
        { teto: 1 },
      );
      if (!p) throw recusa('titulo-sem-parcela', 'O título não tem parcela para registrar a glosa.');
      if (d.item !== null) {
        const item = await tx.uma(
          `SELECT i.valor_total, i.valor_pago, i.valor_glosado, i.situacao FROM conta_hospitalar_item i
             JOIN documento_origem_titulo o ON o.entidade = 'conta_hospitalar' AND o.entidade_id = i.conta_hospitalar_id
                  AND o.excluido_em IS NULL
            WHERE i.id = ? AND o.titulo_receber_id = ? AND i.excluido_em IS NULL LIMIT 1`,
          [d.item, d.tituloReceber],
        );
        recusar(conferirItemGlosado(item ? itemGlosavelDe(item) : null, d.valor));
      }
      const regra = efeitoDaGlosa(d.situacao);
      const disponivel = centavos(numero(t['valor_liquido']) - numero(t['valor_recebido']) - numero(t['valor_glosa_aceita']));
      if (regra.aceita && d.valor > disponivel + 0.005)
        throw recusa('glosa-acima-do-saldo', 'A glosa passa do saldo do título.', { campos: ['valor'] });
      const soma = (a: unknown) => centavos(numero(a) + d.valor);
      await tx.alterar('parcela_receber', numero(p['id']), numero(p['versao']), {
        valor_glosa: soma(p['valor_glosa']),
        ...(regra.aceita ? { valor_glosa_aceita: soma(p['valor_glosa_aceita']) } : {}),
        ...(regra.recurso ? { valor_recurso: soma(p['valor_recurso']) } : {}),
      });
      await tx.alterar('titulo_receber', d.tituloReceber, numero(t['versao']), {
        valor_glosa: soma(t['valor_glosa']),
        ...(regra.aceita ? { valor_glosa_aceita: soma(t['valor_glosa_aceita']) } : {}),
      });
      return { id: d.tituloReceber, repetida: false };
    },

    async importarExtrato(d) {
      const conta = await tx.uma('SELECT id FROM conta_bancaria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL', [
        d.conta,
        est,
      ]);
      if (!conta) throw foraDoEscopo();
      const ja = await tx.uma(
        'SELECT id, quantidade_linhas FROM extrato_bancario WHERE conta_bancaria_id = ? AND hash_conteudo = ? AND excluido_em IS NULL',
        [d.conta, d.hashArquivo],
      );
      if (ja) return { id: numero(ja['id']), linhas: numero(ja['quantidade_linhas']), repetido: true };
      const linhas = d.linhas.filter((x) => Math.abs(x.valor) >= 0.005);
      const datas = linhas.map((x) => x.data).sort();
      const hoje = new Date().toISOString().slice(0, 10);
      const id = await tx.incluir('extrato_bancario', {
        estabelecimento_id: est,
        conta_bancaria_id: d.conta,
        formato: d.origem,
        periodo_inicio: datas[0] ?? hoje,
        periodo_fim: datas[datas.length - 1] ?? hoje,
        total_creditos: centavos(linhas.filter((x) => x.valor > 0).reduce((s, x) => s + x.valor, 0)),
        total_debitos: centavos(linhas.filter((x) => x.valor < 0).reduce((s, x) => s - x.valor, 0)),
        quantidade_linhas: linhas.length,
        hash_conteudo: d.hashArquivo,
        importado_em: agora(),
        importado_por_usuario_id: usuario,
      });
      for (const [i, x] of linhas.entries())
        await tx.incluir('linha_extrato', {
          extrato_bancario_id: id,
          sequencia: i + 1,
          data_movimento: x.data,
          valor: centavos(x.valor),
          historico: x.historico.slice(0, 200) || '(sem histórico)',
          documento: x.documento.slice(0, 50) || null,
        });
      return { id, linhas: linhas.length, repetido: false };
    },

    async conciliar(d) {
      const [x] = await tx.consultarParaAtualizar(
        `SELECT x.id, x.versao, x.valor, x.data_movimento, x.historico, x.documento, x.situacao_conciliacao,
                e.id AS extrato, e.conta_bancaria_id, e.periodo_inicio, e.periodo_fim
           FROM linha_extrato x JOIN extrato_bancario e ON e.id = x.extrato_bancario_id
          WHERE x.id = ? AND e.estabelecimento_id = ? AND x.excluido_em IS NULL AND e.excluido_em IS NULL`,
        [d.linha, est],
        { teto: 1 },
      );
      if (!x) throw recusa('linha-inexistente', 'A linha do extrato não existe.');
      const conta = numero(x['conta_bancaria_id']);
      if (!d.contasEscopo.includes(conta)) throw foraDoEscopo();
      if (texto(x['situacao_conciliacao']) !== 'pendente')
        throw recusa('linha-conciliada', 'A linha do extrato já foi tratada: releia.');
      if (d.alvo.tipo === 'credito-pendente') {
        if (!(numero(x['valor']) > 0)) throw recusa('nao-e-credito', 'Só um crédito vai à fila de crédito não identificado.');
        const credito = await tx.incluir('credito_nao_identificado', {
          estabelecimento_id: est,
          conta_bancaria_id: conta,
          data_credito: dataIso(x['data_movimento']),
          numero_documento: texto(x['documento']).slice(0, 30) || null,
          historico_extrato: texto(x['historico']).slice(0, 200),
          valor: numero(x['valor']),
        });
        await tx.alterar('linha_extrato', d.linha, numero(x['versao']), { situacao_conciliacao: 'ignorada' });
        return { id: credito };
      }
      let mov: Linha | null = null;
      let pagou: unknown = null;
      const escopoMov = await contasDoEscopo(tx, est, usuario, 'movimentar');
      if (!escopoMov.includes(conta)) throw foraDoEscopo();
      if (d.alvo.tipo === 'movimento')
        mov = await tx.uma(
          `SELECT id, versao, conciliado, natureza, valor, criado_por FROM movimento_bancario
            WHERE id = ? AND conta_bancaria_id = ? AND estabelecimento_id = ? AND situacao = 'ativo' AND excluido_em IS NULL`,
          [d.alvo.id, conta, est],
        );
      else if (d.alvo.tipo === 'titulo-pagar') {
        const b = await tx.uma(
          `SELECT b.movimento_bancario_id, b.criado_por FROM baixa_titulo b
            WHERE b.parcela_pagar_id = ? AND b.estabelecimento_id = ? AND b.situacao = 'efetivada' AND b.excluido_em IS NULL
            ORDER BY b.id DESC LIMIT 1`,
          [d.alvo.id, est],
        );
        pagou = b?.['criado_por'] ?? null;
        if (b?.['movimento_bancario_id'])
          mov = await tx.uma(SQL_MOVIMENTO_CONCILIAVEL, [b['movimento_bancario_id'], conta]);
      } else {
        const r = await tx.uma(
          `SELECT r.movimento_bancario_id, r.criado_por FROM recebimento r JOIN parcela_receber p ON p.id = r.parcela_receber_id
            WHERE p.titulo_receber_id = ? AND r.estabelecimento_id = ? AND r.situacao = 'efetivado' AND r.excluido_em IS NULL
            ORDER BY r.id DESC LIMIT 1`,
          [d.alvo.id, est],
        );
        pagou = r?.['criado_por'] ?? null;
        if (r?.['movimento_bancario_id'])
          mov = await tx.uma(SQL_MOVIMENTO_CONCILIAVEL, [r['movimento_bancario_id'], conta]);
      }
      if (!mov) throw recusa('alvo-sem-movimento', 'O alvo escolhido não tem movimento nesta conta bancária.');
      if (Number(mov['conciliado'] ?? 0)) throw recusa('movimento-conciliado', 'O movimento já foi conciliado.');
      // Quem lançou o movimento (ou registrou o pagamento ou o recebimento que o gerou) não o concilia.
      pagou ??= mov['criado_por'] ?? null;
      recusar(
        conferirLinhaContraMovimento(numero(x['valor']), {
          natureza: texto(mov['natureza']) === 'credito' ? 'credito' : 'debito',
          valor: numero(mov['valor']),
        }),
      );
      recusar(conferirSegregacao('conciliar', (await login()) ?? '', { lancou: null, aprovaram: [], pagou: await loginDe(tx, pagou) }));
      const [aberta] = await tx.consultarParaAtualizar(
        "SELECT id FROM conciliacao_bancaria WHERE extrato_bancario_id = ? AND situacao IN ('aberta','reaberta') AND excluido_em IS NULL",
        [x['extrato']],
        { teto: 1 },
      );
      const conciliacao = aberta
        ? numero(aberta['id'])
        : await tx.incluir('conciliacao_bancaria', {
            estabelecimento_id: est,
            conta_bancaria_id: conta,
            extrato_bancario_id: x['extrato'],
            periodo_inicio: dataIso(x['periodo_inicio']),
            periodo_fim: dataIso(x['periodo_fim']),
            saldo_extrato: 0,
            saldo_sistema: 0,
          });
      const item = await tx.incluir('conciliacao_bancaria_item', {
        conciliacao_bancaria_id: conciliacao,
        linha_extrato_id: d.linha,
        movimento_bancario_id: mov['id'],
        valor_conciliado: numero(x['valor']),
        forma: d.regra === 'manual' ? 'manual' : 'sugerida',
        confirmado: true,
      });
      await tx.alterar('linha_extrato', d.linha, numero(x['versao']), {
        situacao_conciliacao: 'conciliada',
        movimento_bancario_id: mov['id'],
        conciliado_em: agora(),
        conciliacao_usuario_id: usuario,
      });
      await tx.alterar('movimento_bancario', numero(mov['id']), numero(mov['versao']), {
        conciliado: true,
        conciliacao_bancaria_id: conciliacao,
      });
      return { id: item };
    },

    async atribuirCredito(d) {
      const [cr] = await tx.consultarParaAtualizar(
        'SELECT id, versao, conta_bancaria_id, situacao FROM credito_nao_identificado WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [d.credito, est],
        { teto: 1 },
      );
      if (!cr) throw recusa('credito-inexistente', 'O crédito não existe.');
      if (!d.contasEscopo.includes(numero(cr['conta_bancaria_id']))) throw foraDoEscopo();
      if (!(await contasDoEscopo(tx, est, usuario, 'movimentar')).includes(numero(cr['conta_bancaria_id'])))
        throw foraDoEscopo();
      if (texto(cr['situacao']) !== 'pendente') throw recusa('credito-identificado', 'O crédito já foi identificado.');
      const t = await tx.uma(
        "SELECT id FROM titulo_receber WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ('aberto','recebido_parcial')",
        [d.tituloReceber, est],
      );
      if (!t) throw recusa('titulo-inexistente', 'O título a receber não existe ou já foi recebido.');
      await tx.alterar('credito_nao_identificado', d.credito, numero(cr['versao']), {
        destino: 'titulo_receber',
        titulo_receber_id: d.tituloReceber,
        identificado_em: agora(),
        identificado_por_usuario_id: usuario,
        situacao: 'identificado',
        observacao: d.observacao.trim() || null,
      });
      return { id: d.credito };
    },

    async registrarRemessa(d) {
      const [conta] = await tx.consultarParaAtualizar(
        'SELECT id, versao, sequencia_remessa, banco_id FROM conta_bancaria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [d.conta, est],
        { teto: 1 },
      );
      if (!conta) throw foraDoEscopo();
      // O mesmo arquivo (hash) já registrado nesta conta não avança a sequência nem o número de novo.
      const jaRemessa = await tx.uma(
        `SELECT id, sequencia_arquivo FROM remessa_bancaria
          WHERE conta_bancaria_id = ? AND estabelecimento_id = ? AND hash_arquivo = ? AND excluido_em IS NULL
          ORDER BY id DESC LIMIT 1`,
        [d.conta, est, d.hashArquivo],
      );
      if (jaRemessa) return { id: numero(jaRemessa['id']), sequencial: numero(jaRemessa['sequencia_arquivo']) };
      const leiaute = await tx.uma(
        `SELECT id FROM leiaute_bancario WHERE banco_id = ? AND padrao = ? AND servico = 'pagamento' AND ativo = TRUE
            AND sentido IN ('remessa','ambos') ORDER BY id DESC LIMIT 1`,
        [conta['banco_id'], d.leiaute],
      );
      if (!leiaute)
        throw recusa(
          'cadastro-incompleto',
          'Falta no cadastro do financeiro: o leiaute bancário de pagamento do banco desta conta. Peça ao administrador para cadastrar.',
        );
      const sequencial = numero(conta['sequencia_remessa']) + 1;
      await tx.alterar('conta_bancaria', d.conta, numero(conta['versao']), { sequencia_remessa: sequencial });
      await garantirSequencia(tx, { tipo: 'remessa_bancaria', estabelecimento: est, prefixo: 'RM-' }, { usuario, agora: agora() });
      const num = await tx.proximoNumero('remessa_bancaria');
      const id = await tx.incluir('remessa_bancaria', {
        estabelecimento_id: est,
        numero: num.formatado,
        conta_bancaria_id: d.conta,
        leiaute_bancario_id: leiaute['id'],
        formato: d.leiaute,
        sequencia_arquivo: sequencial,
        gerado_em: agora(),
        gerado_usuario_id: usuario,
        quantidade_registros: d.titulos,
        valor_total: d.valorTotal,
        hash_arquivo: d.hashArquivo,
        situacao: d.situacao === 'retornada' ? 'processada' : 'gerada',
        observacao: JSON.stringify({
          destino: d.destino,
          ocorrencias: d.ocorrencias ? d.ocorrencias.slice(0, 300) : null,
          retorno: d.hashRetorno,
        }).slice(0, 500),
      });
      return { id, sequencial };
    },

    async registrarNfse() {
      throw modeloPendente('O registro da NFS-e simulada');
    },

    async registrarDeclaracao() {
      throw modeloPendente('O registro da declaração (DMED ou EFD-REINF) gerada');
    },

    async registrarLoteContabil(d) {
      const ano = Number(d.periodo.slice(0, 4));
      const mes = Number(d.periodo.slice(5, 7));
      // O mesmo arquivo (hash de conferência) já registrado não gera outro lote.
      const jaLote = await tx.uma(
        'SELECT id FROM lote_exportacao_contabil WHERE estabelecimento_id = ? AND hash_conferencia = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1',
        [est, d.hashArquivo],
      );
      if (jaLote) return { id: numero(jaLote['id']) };
      await garantirSequencia(
        tx,
        { tipo: 'lote_exportacao_contabil', estabelecimento: est, prefixo: null },
        { usuario, agora: agora() },
      );
      const num = await tx.proximoNumero('lote_exportacao_contabil');
      const id = await tx.incluir('lote_exportacao_contabil', {
        estabelecimento_id: est,
        numero: num.valor,
        competencia: inicioDoMes(ano, mes),
        data_inicial: inicioDoMes(ano, mes),
        data_final: fimDoMes(ano, mes),
        leiaute: 'txt_padrao',
        quantidade_lancamentos: d.lancamentos,
        valor_total: d.somaDebitos,
        hash_conferencia: d.hashArquivo,
        gerado_em: agora(),
        observacao: JSON.stringify({ regua: d.regua, somaCreditos: d.somaCreditos, semDePara: d.semDePara }),
      });
      return { id };
    },
  };
}

/** Porta indisponível (fora de dev/ci sem o núcleo): 503 em tudo, nada lido nem gravado. */
export function portaFinanceiroIndisponivel(): PortaFinanceiro {
  return portaIndisponivel<PortaFinanceiro>(METODOS_PORTA_FINANCEIRO);
}

