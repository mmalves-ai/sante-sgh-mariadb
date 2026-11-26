// Porta própria do pós-fechamento (M31/M42) sobre o banco do cliente, pelo @sgh/nucleo: leituras numa transação
// somente leitura (conta_hospitalar e itens, lote_tiss, lote_tiss_conta, protocolo_recebimento, integracao_mensagem,
// fechamento_competencia_fonte_pagadora, glosa e glosa_item, recurso_glosa, motivo_glosa, demonstrativo_analise_conta
// e itens, configuracao_tiss_fonte_pagadora, endpoint_tiss_fonte_pagadora, versao_padrao_tiss,
// transacao_tiss_webservice, prazo_recurso_fonte_pagadora, arquivo, trilha_auditoria) e gravações pelo Executor:
// as operações faturamento.* (operacoes.ts) e as gravações diretas (decisão da glosa, canal de envio, mensagem TISS)
// numa operação própria, com a trilha, o outbox e a idempotência na mesma transação. Toda leitura filtra o
// estabelecimento da sessão e os registros excluídos; fonte pagadora, motivos de glosa e versões TISS são da rede.
// Melhoria: a situação do lote vem do modelo (gerado, protocolado) somada aos fatos (demonstrativos, baixas e
// recursos), sem marca de texto; o histórico do protocolo sai dos registros de protocolo (nada é apagado); a mensagem
// TISS vai à fila única de integração; a credencial do canal fica no cofre (só a referência no banco).
// Melhoria: o acompanhamento conta as gravações de cada operação pela trilha do núcleo (operação no registro da
// trilha), sem tabela espelho; o uso de outro sistema por grupo não existe mais (sem convivência): o bloco sai nulo.
// A importação do demonstrativo (análise casada item a item e pagamento com deduções) está em
// demonstrativo-importacao-propria.ts. Pendências de modelo (pedidos do lote 03-16): a evidência do prontuário na decisão, o calendário
// de entrega por convênio, o escopo de contas bancárias por usuário e os blocos de títulos e repasse do
// acompanhamento: até lá, as gravações recusam com "operacao-pendente" e as leituras dizem o que falta.
import { randomUUID } from 'node:crypto';
import type {
  CompetenciaLida,
  ConfiguracaoTissLida,
  ContaProntaLote,
  DemonstrativoLido,
  EvidenciaGlosaLida,
  GradeGlosa,
  GuiaLida,
  ItemGlosaLido,
  ListaLotes,
  LoteDetalhe,
  LoteLido,
  MotivoGlosaLido,
  PainelGlosa,
  PrazoEnvio,
} from '@sgh/contratos';
import type { LinhaContasCompetencia } from '@sgh/contratos/regras-faturamento';
import {
  avisoInferida,
  cicloValido,
  conferirDecisaoGlosa,
  criarMontadorLote,
  entregasAFrente,
  faixaDoValor,
  indicadoresGlosa,
  type JanelaEntrega,
  loteCongelado,
  prazoRecurso,
  proximaEntrega,
  ROTULO_SITUACAO_LOTE,
  ROTULO_TIPO_GUIA,
  SCHEMA_LOTE_GUIAS,
  SCHEMA_RECURSO_GLOSA,
  situacaoDoLote,
  VERSAO_TISS_VIGENTE,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { civil } from '../exames/relogio.js';
import { versaoTexto } from '../faturamento/esquemas.js';
import { sincronizarGlosaDoItem, TABELAS_PRODUCAO_CONTA } from '../repasse/producao-conta.js';
import { ProfissionalComplementoProprio } from '../cadastro/profissional-complemento-proprio.js';
import type { ArmazemXmlTiss } from './armazem-xml.js';
import {
  importarDemonstrativoNoBanco,
  lerPagamento,
  listarPagamentos,
  TABELAS_DEMONSTRATIVO,
} from './demonstrativo-importacao-propria.js';
import { nomeNaTrilha, OPERACOES_TISS_PENDENTES, operacoesTiss } from './operacoes.js';
import {
  type ContextoTiss,
  type FiltroAcompanhamentoPorta,
  type FiltroContasLote,
  type FiltroGlosa,
  type FiltroLotes,
  type GravadorSghTiss,
  type LeituraAcompanhamento,
  METODOS_PORTA_TISS,
  type PortaTiss,
} from './porta.js';
import {
  desfechoDoRecurso,
  diaDaCompetencia,
  diasEntre,
  estadoDaGlosa,
  situacaoDaGlosa,
  grupoTissDoItem,
  SITUACAO_MENSAGEM_NO_MODELO,
  situacaoContaNaCompetencia,
  tiposGuiaDaNatureza,
  tipoGuiaDoModelo,
} from './regras-tiss.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoTiss = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const r2 = (x: number) => Math.round(x * 100) / 100;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
/** DATE/DATETIME do banco (UTC) → "AAAA-MM-DD". */
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
/** DATETIME do banco (UTC) → ISO com Z. */
const instante = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v ? new Date(`${String(v).replace(' ', 'T')}Z`).toISOString() : null;
const mesDe = (v: unknown) => (dataIso(v) ?? '').slice(0, 7);
const codigoMotivo = (v: unknown) => {
  const d = texto(v).replace(/\D/g, '');
  return d && Number.isSafeInteger(Number(d)) ? Number(d) : 0;
};

/** Filtro opcional de escopo por convênio (lista branca de ids numéricos, parametrizada). */
function escopo(
  coluna: 'ch.fonte_pagadora_id' | 'lt.fonte_pagadora_id' | 'd.fonte_pagadora_id' | 'cal.fonte_pagadora_id',
  convenios: readonly number[] | null,
) {
  if (convenios === null) return { sql: '', p: [] as unknown[] };
  if (convenios.length === 0) return { sql: ' AND 1 = 0', p: [] as unknown[] };
  return { sql: ` AND ${coluna} IN (${lista(convenios.length)})`, p: [...convenios] as unknown[] };
}

const pendente = (op: string, motivo: string) =>
  new ErroOperacao(
    409,
    'operacao-pendente',
    'Operação ainda indisponível no banco',
    `${op}: ${motivo}. Nada foi gravado.`,
  );

/** Tabelas das gravações diretas (decisão da glosa, canal de envio, mensagem TISS). */
const TABELAS_GRAVACAO_DIRETA = [
  'glosa',
  'glosa_item',
  'conta_hospitalar_item',
  ...TABELAS_PRODUCAO_CONTA,
  'endpoint_tiss_fonte_pagadora',
  'integracao_mensagem',
  ...TABELAS_DEMONSTRATIVO,
];

/**
 * A glosa que vale para o item da conta: a mais recente entre as vivas (glosa não excluída nem cancelada, item não
 * excluído). Um item com mais de uma glosa (demonstrativo e auditoria, ou uma cancelada e outra refeita) conta uma vez.
 */
const glosaVivaDoItem = (
  item: string,
) => `(SELECT MAX(gv.id) FROM glosa_item gv JOIN glosa gg ON gg.id = gv.glosa_id
      WHERE gv.conta_hospitalar_item_id = ${item} AND gv.excluido_em IS NULL AND gg.excluido_em IS NULL
        AND gg.situacao <> 'cancelada')`;

/** Itens da conta com a glosa, o recurso e o motivo (uma linha por item lançado). */
const SQL_ITENS_GLOSA = `
  SELECT ci.id, ci.versao, ci.sequencia, ci.conta_hospitalar_id, ci.quantidade, ci.valor_total, f.codigo, f.descricao,
         f.tipo_item, ch.fonte_pagadora_id, ch.competencia, ch.numero, ch.versao AS versao_conta,
         gi.id AS glosa_item, gi.versao AS versao_glosa, gi.valor_apresentado, gi.valor_glosado, gi.quantidade_apresentada,
         gi.quantidade_glosada, gi.decisao, gi.valor_recursado, gi.quantidade_recursada, gi.valor_recuperado,
         gi.data_recuperacao, gi.justificativa, gi.decidido_em, gi.recurso_glosa_id, ud.login AS decidido_por,
         gi.evidencia_prontuario IS NOT NULL AS tem_evidencia,
         gl.data_glosa, gl.data_limite_recurso, mg.codigo_tuss, mg.descricao AS motivo_nome,
         mg.permite_reapresentacao, rg.enviado_em AS recurso_em, rg.situacao AS situacao_recurso,
         ci.valor_pago AS pago_item,
         (SELECT mr.codigo_tuss FROM recurso_glosa_item rgi JOIN motivo_glosa mr ON mr.id = rgi.motivo_retorno_glosa_id
           WHERE rgi.glosa_item_id = gi.id AND rgi.excluido_em IS NULL ORDER BY rgi.id DESC LIMIT 1) AS motivo_retorno
    FROM conta_hospitalar_item ci
    JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id
    JOIN item_faturavel f ON f.id = ci.item_faturavel_id
    LEFT JOIN glosa_item gi ON gi.id = ${glosaVivaDoItem('ci.id')}
    LEFT JOIN glosa gl ON gl.id = gi.glosa_id
    LEFT JOIN motivo_glosa mg ON mg.id = gi.motivo_glosa_id
    LEFT JOIN recurso_glosa rg ON rg.id = gi.recurso_glosa_id AND rg.excluido_em IS NULL
    LEFT JOIN usuario ud ON ud.id = gi.decidido_por_usuario_id
   WHERE ch.estabelecimento_id = ? AND ch.excluido_em IS NULL AND ci.excluido_em IS NULL
     AND ci.situacao NOT IN ('sem_cobranca','transferido','estornado')`;

function itemGlosaDe(r: Linha, prazoParametro: string): ItemGlosaLido {
  // Conciliado: com glosa baixada, ou pago por inteiro na baixa (valor pago no item, sem glosa).
  const temGlosa = r['glosa_item'] !== null && r['glosa_item'] !== undefined;
  const conciliado = temGlosa || n(r['pago_item']) > 0;
  const cobrado = n(r['valor_total']);
  const glosa = temGlosa ? n(r['valor_glosado']) : 0;
  const retornado = r['data_recuperacao'] !== null && r['data_recuperacao'] !== undefined;
  const estado = estadoDaGlosa({
    conciliado,
    glosado: glosa,
    decisao: temGlosa ? texto(r['decisao']) : null,
    emRecurso: r['recurso_glosa_id'] !== null && r['recurso_glosa_id'] !== undefined,
    retornado,
  });
  const dataPagamento = temGlosa ? dataIso(r['data_glosa']) : null;
  const convenio = n(r['fonte_pagadora_id']);
  const limite = dataIso(r['data_limite_recurso']);
  const p = limite
    ? { prazo: limite, alerta: null }
    : conciliado && glosa > 0
      ? prazoRecurso(prazoParametro, convenio, dataPagamento)
      : { prazo: null, alerta: null };
  return {
    item: n(r['id']),
    versao: versaoTexto(n(r['versao'])),
    sequencial: nn(r['sequencia']),
    conta: n(r['conta_hospitalar_id']),
    convenio,
    competencia: mesDe(r['competencia']),
    tipo: grupoTissDoItem(texto(r['tipo_item'])),
    codigo: texto(r['codigo']),
    descricao: texto(r['descricao']),
    quantidade: n(r['quantidade']),
    valorCobrado: cobrado,
    conciliado,
    valorPago: temGlosa ? r2(n(r['valor_apresentado']) - glosa) : conciliado ? n(r['pago_item']) : 0,
    quantidadePaga: temGlosa
      ? n(r['quantidade_apresentada']) - n(r['quantidade_glosada'])
      : conciliado
        ? n(r['quantidade'])
        : 0,
    dataPagamento,
    glosa,
    motivo: codigoMotivo(r['codigo_tuss']),
    motivoNome: texto(r['motivo_nome']),
    reapresenta: verdadeiro(r['permite_reapresentacao']),
    valorRecurso: n(r['valor_recursado']),
    quantidadeRecurso: n(r['quantidade_recursada']),
    dataRecurso: dataIso(r['recurso_em']),
    valorRetorno: n(r['valor_recuperado']),
    dataRetorno: dataIso(r['data_recuperacao']),
    // O motivo do retorno vem do item do recurso (06-FAT linha 34; 0 = não informado).
    motivoRetorno: r['motivo_retorno'] ? codigoMotivo(r['motivo_retorno']) : 0,
    estado,
    desfecho: desfechoDoRecurso({
      recursado: n(r['valor_recursado']),
      recuperado: n(r['valor_recuperado']),
      retornado,
    }),
    prazoRecurso: estado === 'pendente' ? p.prazo : null,
    alertaPrazo: estado === 'pendente' ? p.alerta : null,
    decisao: r['decidido_em']
      ? {
          motivo: texto(r['justificativa']),
          por: texto(r['decidido_por']),
          em: instante(r['decidido_em']) ?? '',
          // A evidência (dado clínico) só sai pela leitura auditada (evidenciaDoItem); aqui, só se existe.
          temEvidencia: n(r['tem_evidencia']) === 1,
        }
      : null,
  };
}

export class PortaTissPropria implements PortaTiss {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  private readonly operacoes: ReturnType<typeof operacoesTiss>;

  constructor(
    private readonly nucleo: NucleoTiss,
    private readonly cliente: string,
    armazem: ArmazemXmlTiss | null,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
    const complemento = new ProfissionalComplementoProprio(nucleo, cliente, this.executor);
    this.operacoes = operacoesTiss(armazem ? criarMontadorLote(armazem.guardar) : null, (profissional, dia) =>
      complemento.assinaturaNoDia(
        { cliente, correlacao: 'tiss', estabelecimento: null, usuario: null, rede: '', hospital: '' },
        profissional,
        'imagem',
        dia,
      ),
    );
  }

  private contexto(c: ContextoTiss) {
    return { cliente: this.cliente, correlacao: (c.correlacao || 'tiss').slice(0, 64) };
  }

  /** O estabelecimento da sessão: o id do contexto, ou o do código (o mapa da sessão ainda não leu). */
  private async estabelecimento(c: ContextoTiss, l: Leitor): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const e = await l.uma<Linha>('SELECT id FROM estabelecimento WHERE codigo = ?', [c.hospital]);
    if (!e) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return n(e['id']);
  }

  private ler<T>(c: ContextoTiss, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(this.contexto(c), async (l) => fn(l, await this.estabelecimento(c, l)));
  }

  private async fuso(l: Leitor, est: number): Promise<string> {
    const e = await l.uma<Linha>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
    return texto(e?.['fuso_horario']) || 'America/Sao_Paulo';
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(c: ContextoTiss, op: string): Promise<LiberacaoGravacao> {
    const falta = OPERACOES_TISS_PENDENTES[op];
    if (falta)
      return { pode: false, codigo: 'operacao-pendente', motivo: `Operação ainda indisponível: ${falta}.` };
    const operacao = this.operacoes[op];
    if (!operacao) return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida.' };
    return this.executor.liberacao(operacao, {
      cliente: this.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: this.contexto(c).correlacao,
      chaveIdempotencia: 'consulta.liberacao',
    });
  }

  async executar(c: ContextoTiss, op: string, entrada: unknown, ctx: ContextoOperacao) {
    const falta = OPERACOES_TISS_PENDENTES[op];
    if (falta) throw pendente(op, falta);
    const operacao = this.operacoes[op];
    if (!operacao) throw recusa('operacao-desconhecida', 'Operação desconhecida no pós-fechamento.');
    const est = ctx.estabelecimento ?? (await this.ler(c, async (_l, e) => e));
    const r = await this.executor.executar(operacao, this.cliente, entrada, { ...ctx, estabelecimento: est });
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  async gravarSgh<T>(
    c: ContextoTiss,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorSghTiss) => Promise<T>,
  ): Promise<T> {
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const est = c.estabelecimento ?? (await this.ler(c, async (_l, e) => e));
    const op = definirOperacao({
      nome: 'faturamento.tiss-gravacao-direta',
      tabelas: TABELAS_GRAVACAO_DIRETA,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est)) };
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'lote_tiss', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `direta:${randomUUID()}`;
    await this.executor.executar(
      op,
      this.cliente,
      { chave },
      {
        cliente: this.cliente,
        estabelecimento: est,
        usuario: c.usuario,
        correlacao: this.contexto(c).correlacao,
        chaveIdempotencia: chave,
      },
    );
    if (!saida) throw new Error('Gravação direta sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────

  /** O dia de hoje no fuso do estabelecimento. */
  hoje(c: ContextoTiss): Promise<string> {
    return this.ler(c, async (l, est) => civil(new Date(), await this.fuso(l, est)).data);
  }

  /** Fontes pagadoras ativas que faturam por guia (cadastro da rede inteira; o particular não entra em lote). */
  convenios(c: ContextoTiss): Promise<{ codigo: number; nome: string }[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT id, nome FROM fonte_pagadora
            WHERE excluido_em IS NULL AND situacao = 'ativa' AND tipo NOT IN ('particular','publico')
            ORDER BY nome, id`,
        )
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']) })),
    );
  }

  contasProntas(c: ContextoTiss, f: FiltroContasLote): Promise<ContaProntaLote[]> {
    return this.ler(c, async (l, est) => {
      const p: unknown[] = [est, f.convenio];
      let sql = `
        SELECT ch.id, ch.versao, ch.numero, ch.fonte_pagadora_id, ch.natureza, ch.competencia, ch.valor_total,
               ch.fechada_em, pf.nome AS beneficiario,
               (SELECT COUNT(*) FROM conta_hospitalar_item ci WHERE ci.conta_hospitalar_id = ch.id
                  AND ci.excluido_em IS NULL AND ci.situacao NOT IN ('sem_cobranca','transferido','estornado')) AS itens
          FROM conta_hospitalar ch
          JOIN paciente pa ON pa.id = ch.paciente_id
          JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
         WHERE ch.estabelecimento_id = ? AND ch.excluido_em IS NULL AND ch.situacao = 'fechada'
           AND ch.fonte_pagadora_id = ?
           AND NOT EXISTS (SELECT 1 FROM lote_tiss_conta ltc JOIN lote_tiss lt ON lt.id = ltc.lote_tiss_id
                            WHERE ltc.conta_hospitalar_id = ch.id AND ltc.excluido_em IS NULL
                              AND lt.excluido_em IS NULL AND lt.situacao <> 'cancelado')`;
      if (f.ano !== null && f.mes !== null) {
        sql += ' AND ch.competencia = ?';
        p.push(diaDaCompetencia(f.ano, f.mes));
      }
      const e = escopo('ch.fonte_pagadora_id', f.convenios);
      const linhas = await l.consultar<Linha>(`${sql}${e.sql} ORDER BY ch.competencia, ch.numero LIMIT 500`, [
        ...p,
        ...e.p,
      ]);
      return linhas
        .map((r) => ({
          conta: n(r['id']),
          versao: versaoTexto(n(r['versao'])),
          convenio: n(r['fonte_pagadora_id']),
          tipoConta: texto(r['natureza']),
          competencia: mesDe(r['competencia']),
          chave: texto(r['numero']),
          beneficiario: texto(r['beneficiario']),
          total: n(r['valor_total']),
          itens: n(r['itens']),
          dataEmissao: dataIso(r['fechada_em']),
          tiposGuia: tiposGuiaDaNatureza(texto(r['natureza'])),
        }))
        .filter((x) => x.tiposGuia.includes(f.tipoGuia as 1 | 2 | 3 | 4));
    });
  }

  guias(
    c: ContextoTiss,
    f: {
      convenio: number | null;
      ano: number | null;
      mes: number | null;
      convenios: readonly number[] | null;
    },
  ): Promise<GuiaLida[]> {
    return this.ler(c, async (l, est) => {
      const p: unknown[] = [est];
      let sql = `
        SELECT ch.id, ch.versao, ch.numero, ch.fonte_pagadora_id, fp.nome AS fonte, ch.natureza, ch.situacao,
               ch.fechada_em, ch.valor_total, pf.nome AS beneficiario, g.tipo_guia, g.numero_guia_prestador,
               g.data_emissao, g.valor_total AS valor_guia,
               (SELECT MAX(ltc.lote_tiss_id) FROM lote_tiss_conta ltc JOIN lote_tiss lt ON lt.id = ltc.lote_tiss_id
                 WHERE ltc.conta_hospitalar_id = ch.id AND ltc.excluido_em IS NULL AND lt.excluido_em IS NULL
                   AND lt.situacao <> 'cancelado') AS lote
          FROM conta_hospitalar ch
          JOIN fonte_pagadora fp ON fp.id = ch.fonte_pagadora_id
          JOIN paciente pa ON pa.id = ch.paciente_id
          JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          LEFT JOIN guia_tiss g ON g.conta_hospitalar_id = ch.id AND g.excluido_em IS NULL
                AND g.guia_tiss_principal_id IS NULL AND g.situacao <> 'cancelada'
         WHERE ch.estabelecimento_id = ? AND ch.excluido_em IS NULL
           AND ch.situacao IN ('fechada','faturada','enviada','paga')`;
      if (f.convenio !== null) {
        sql += ' AND ch.fonte_pagadora_id = ?';
        p.push(f.convenio);
      }
      if (f.ano !== null && f.mes !== null) {
        sql += ' AND ch.competencia = ?';
        p.push(diaDaCompetencia(f.ano, f.mes));
      } else if (f.ano !== null) {
        sql += ' AND ch.competencia >= ? AND ch.competencia < ?';
        p.push(`${f.ano}-01-01`, `${f.ano + 1}-01-01`);
      }
      const e = escopo('ch.fonte_pagadora_id', f.convenios);
      const linhas = await l.consultar<Linha>(
        `${sql}${e.sql} ORDER BY ch.competencia DESC, ch.numero LIMIT 500`,
        [...p, ...e.p],
      );
      return linhas.map((r) => {
        const tipoGuia = r['tipo_guia']
          ? tipoGuiaDoModelo(
              texto(r['tipo_guia']) === 'honorario' ? 'honorario_individual' : texto(r['tipo_guia']),
            )
          : (tiposGuiaDaNatureza(texto(r['natureza']))[0] ?? 0);
        return {
          conta: n(r['id']),
          versao: versaoTexto(n(r['versao'])),
          chave: texto(r['numero']),
          convenio: n(r['fonte_pagadora_id']),
          convenioNome: texto(r['fonte']),
          tipoConta: texto(r['natureza']),
          tipoGuia,
          tipoGuiaNome: ROTULO_TIPO_GUIA[tipoGuia] ?? '',
          numeroGuia: texto(r['numero_guia_prestador']) || texto(r['numero']),
          beneficiario: texto(r['beneficiario']),
          emitida: true,
          dataEmissao: dataIso(r['data_emissao'] ?? r['fechada_em']),
          total:
            r['valor_guia'] !== null && r['valor_guia'] !== undefined
              ? n(r['valor_guia'])
              : n(r['valor_total']),
          lote: nn(r['lote']),
        };
      });
    });
  }

  private async lotesLidos(l: Leitor, est: number, where: string, p: unknown[], hoje: string, limite = '') {
    const linhas = await l.consultar<Linha>(
      `SELECT lt.id, lt.fonte_pagadora_id, fp.nome AS fonte, lt.tipo_guia, lt.tipo_envio, lt.numero_lote,
              lt.sequencial, lt.numero_protocolo, lt.gerado_em, lt.valor_total, lt.hash_epilogo, lt.hash_arquivo,
              lt.origem, a.chave_armazenamento, v.codigo_tiss,
              (SELECT COUNT(*) FROM lote_tiss_conta ltc WHERE ltc.lote_tiss_id = lt.id AND ltc.excluido_em IS NULL)
                AS contas,
              (SELECT COUNT(*) FROM demonstrativo_analise_conta d WHERE d.lote_tiss_id = lt.id
                 AND d.excluido_em IS NULL) AS demonstrativos,
              (SELECT COUNT(*) FROM conta_hospitalar_item ci JOIN glosa_item gi ON gi.id = ${glosaVivaDoItem('ci.id')}
                 JOIN lote_tiss_conta ltc ON ltc.conta_hospitalar_id = ci.conta_hospitalar_id
                WHERE ltc.lote_tiss_id = lt.id AND ltc.excluido_em IS NULL AND gi.excluido_em IS NULL) AS baixados,
              (SELECT COUNT(*) FROM conta_hospitalar_item ci JOIN glosa_item gi ON gi.id = ${glosaVivaDoItem('ci.id')}
                 JOIN lote_tiss_conta ltc ON ltc.conta_hospitalar_id = ci.conta_hospitalar_id
                WHERE ltc.lote_tiss_id = lt.id AND ltc.excluido_em IS NULL AND gi.excluido_em IS NULL
                  AND gi.recurso_glosa_id IS NOT NULL) AS com_recurso,
              (SELECT COUNT(*) FROM conta_hospitalar_item ci JOIN glosa_item gi ON gi.id = ${glosaVivaDoItem('ci.id')}
                 JOIN lote_tiss_conta ltc ON ltc.conta_hospitalar_id = ci.conta_hospitalar_id
                WHERE ltc.lote_tiss_id = lt.id AND ltc.excluido_em IS NULL AND gi.excluido_em IS NULL
                  AND gi.recurso_glosa_id IS NOT NULL AND gi.data_recuperacao IS NULL) AS recurso_aberto
         FROM lote_tiss lt
         JOIN fonte_pagadora fp ON fp.id = lt.fonte_pagadora_id
         JOIN versao_padrao_tiss v ON v.id = lt.versao_padrao_tiss_id
         LEFT JOIN arquivo a ON a.id = lt.arquivo_id
        WHERE lt.estabelecimento_id = ? AND lt.excluido_em IS NULL${where}
        ORDER BY lt.gerado_em DESC, lt.id DESC${limite}`,
      [est, ...p],
    );
    return linhas.map((r): LoteLido => {
      const protocolo = texto(r['numero_protocolo']);
      const s = situacaoDoLote({
        protocolo,
        registradoNoNovo: texto(r['origem']) !== 'migracao',
        demonstrativos: n(r['demonstrativos']),
        itensBaixados: n(r['baixados']),
        itensComRecurso: n(r['com_recurso']),
        itensRecursoAberto: n(r['recurso_aberto']),
      });
      const tipoGuia = tipoGuiaDoModelo(texto(r['tipo_guia']));
      const gerado = dataIso(r['gerado_em']);
      return {
        id: n(r['id']),
        convenio: n(r['fonte_pagadora_id']),
        convenioNome: texto(r['fonte']),
        tipoGuia,
        tipoGuiaNome: ROTULO_TIPO_GUIA[tipoGuia] ?? '',
        transacao: texto(r['tipo_envio']) === 'recurso_glosa' ? SCHEMA_RECURSO_GLOSA : SCHEMA_LOTE_GUIAS,
        numero: texto(r['numero_lote']),
        sequencial: texto(r['sequencial']),
        protocolo,
        congelado: loteCongelado(protocolo),
        dataHora: instante(r['gerado_em']),
        contas: n(r['contas']),
        valor: n(r['valor_total']),
        situacao: s.situacao,
        situacaoRotulo: ROTULO_SITUACAO_LOTE[s.situacao],
        inferida: s.inferida,
        aviso: avisoInferida(s.inferida),
        xml: r['hash_arquivo']
          ? {
              versao: texto(r['codigo_tiss']) || VERSAO_TISS_VIGENTE,
              hashEpilogo: texto(r['hash_epilogo']),
              hashArquivo: texto(r['hash_arquivo']),
              chave: texto(r['chave_armazenamento']),
              valido: true,
              erros: [],
            }
          : null,
        diasSemProtocolo: protocolo || !gerado ? null : Math.max(0, diasEntre(gerado, hoje)),
      };
    });
  }

  lotes(c: ContextoTiss, f: FiltroLotes): Promise<ListaLotes> {
    return this.ler(c, async (l, est) => {
      let where = ' AND lt.gerado_em >= ? AND lt.gerado_em < DATE_ADD(?, INTERVAL 1 DAY)';
      const p: unknown[] = [f.de, f.ate];
      if (f.convenio !== null) {
        where += ' AND lt.fonte_pagadora_id = ?';
        p.push(f.convenio);
      }
      if (f.semProtocolo) where += ' AND lt.numero_protocolo IS NULL';
      const e = escopo('lt.fonte_pagadora_id', f.convenios);
      const total = await l.uma<Linha>(
        `SELECT COUNT(*) AS q FROM lote_tiss lt WHERE lt.estabelecimento_id = ? AND lt.excluido_em IS NULL${where}${e.sql}`,
        [est, ...p, ...e.p],
      );
      const porPagina = Math.max(1, Math.min(200, f.porPagina));
      const itens = await this.lotesLidos(
        l,
        est,
        `${where}${e.sql}`,
        [...p, ...e.p],
        f.hoje,
        ` LIMIT ${porPagina} OFFSET ${Math.max(0, f.pagina) * porPagina}`,
      );
      return { itens, total: n(total?.['q']), pagina: f.pagina, porPagina };
    });
  }

  lote(c: ContextoTiss, id: number, hoje: string): Promise<LoteDetalhe | null> {
    return this.ler(c, async (l, est) => {
      const [lote] = await this.lotesLidos(l, est, ' AND lt.id = ?', [id], hoje);
      if (!lote) return null;
      const contas = await l.consultar<Linha>(
        `SELECT ch.id, ch.numero, ch.valor_total, ch.situacao, pf.nome AS beneficiario
           FROM lote_tiss_conta ltc
           JOIN conta_hospitalar ch ON ch.id = ltc.conta_hospitalar_id
           JOIN paciente pa ON pa.id = ch.paciente_id
           JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE ltc.lote_tiss_id = ? AND ltc.excluido_em IS NULL AND ch.estabelecimento_id = ?
          ORDER BY ch.numero`,
        [id, est],
      );
      const protocolos = await l.consultar<Linha>(
        `SELECT p.numero_protocolo, p.recibo, p.recebido_em, p.situacao, p.criado_em, u.login,
                sp.numero_tiss AS situacao_numero, sp.nome AS situacao_nome
           FROM protocolo_recebimento p LEFT JOIN usuario u ON u.id = p.criado_por
           LEFT JOIN situacao_protocolo_recebimento sp ON sp.codigo = p.situacao
          WHERE p.lote_tiss_id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
          ORDER BY p.criado_em DESC, p.id DESC`,
        [id, est],
      );
      // A fatura ao pagador gravada com o lote (a mais recente viva): número, situação, contas e o protocolo.
      const fatura = await l.uma<Linha>(
        `SELECT numero, situacao, quantidade_contas, valor_apresentado, protocolo_recebimento, data_entrega
           FROM fatura_fonte_pagadora
          WHERE lote_tiss_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
          ORDER BY id DESC LIMIT 1`,
        [id, est],
      );
      const mensagens = await l.consultar<Linha>(
        `SELECT direcao, situacao, tentativas, ponto, referencia_externa, conteudo, criado_em
           FROM integracao_mensagem
          WHERE entidade = 'lote_tiss' AND entidade_id = ? AND estabelecimento_id = ?
          ORDER BY criado_em DESC, id DESC LIMIT 100`,
        [id, est],
      );
      return {
        ...lote,
        contasDoLote: contas.map((r) => ({
          conta: n(r['id']),
          chave: texto(r['numero']),
          beneficiario: texto(r['beneficiario']),
          total: n(r['valor_total']),
          fechada: texto(r['situacao']),
        })),
        fatura: fatura
          ? {
              numero: texto(fatura['numero']),
              situacao: texto(fatura['situacao']),
              contas: n(fatura['quantidade_contas']),
              valorApresentado: n(fatura['valor_apresentado']),
              protocolo: texto(fatura['protocolo_recebimento']),
              entrega: dataIso(fatura['data_entrega']),
            }
          : null,
        historico: protocolos.map((r) => {
          const situacao = texto(r['situacao']);
          return {
            acao: situacao === 'cancelado' ? ('limpo' as const) : ('registrado' as const),
            protocolo: texto(r['numero_protocolo']),
            data: dataIso(r['recebido_em']),
            recibo: texto(r['recibo']),
            // Número e nome da situação vêm do banco (situacao_protocolo_recebimento), como a escolha da tela.
            situacao: nn(r['situacao_numero']),
            situacaoNome: texto(r['situacao_nome']),
            autor: texto(r['login']),
            em: instante(r['criado_em']) ?? '',
          };
        }),
        mensagens: mensagens.map((r) => {
          const corpo = lerJson(r['conteudo']);
          return {
            direcao: texto(r['direcao']) === 'saida' ? 'envio' : 'resposta',
            destino: texto(corpo['destino']),
            transacao: texto(r['ponto']).replace(/^tiss\./, ''),
            situacao: texto(corpo['situacao']) || texto(r['situacao']),
            tentativa: n(r['tentativas']),
            protocolo: texto(r['referencia_externa']),
            em: instante(r['criado_em']) ?? '',
          };
        }),
      };
    });
  }

  convenioDoLote(c: ContextoTiss, id: number): Promise<number | null> {
    return this.ler(c, async (l, est) =>
      nn(
        (
          await l.uma<Linha>(
            'SELECT fonte_pagadora_id FROM lote_tiss WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [id, est],
          )
        )?.['fonte_pagadora_id'],
      ),
    );
  }

  /** Situações do protocolo do banco (as ativas, na ordem do cadastro); o número é o do status TISS. */
  situacoesProtocolo(c: ContextoTiss): Promise<{ id: number; nome: string }[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar<Linha>(
          'SELECT numero_tiss, nome FROM situacao_protocolo_recebimento WHERE ativo ORDER BY ordem, numero_tiss',
          [],
        )
      ).map((r) => ({ id: n(r['numero_tiss']), nome: texto(r['nome']) })),
    );
  }

  prazos(
    c: ContextoTiss,
    o: { hoje: string; paradoDias: number; prazoRecurso: string; convenios: readonly number[] | null },
  ): Promise<PrazoEnvio[]> {
    return this.ler(c, async (l, est) => {
      const e = escopo('lt.fonte_pagadora_id', o.convenios);
      const ec = escopo('cal.fonte_pagadora_id', o.convenios);
      // O calendário de entrega por convênio (calendario_entrega_fatura): as janelas ativas que ainda não fecharam.
      const calendario = await l.consultar<Linha>(
        `SELECT cal.fonte_pagadora_id, fp.nome AS fonte, cal.competencia, cal.entrega_inicio, cal.entrega_fim,
                cal.pagamento_previsto, cal.prazo_pagamento_dias, cal.restritivo
           FROM calendario_entrega_fatura cal JOIN fonte_pagadora fp ON fp.id = cal.fonte_pagadora_id
          WHERE cal.estabelecimento_id = ? AND cal.ativo AND cal.entrega_fim >= ?${ec.sql}
          ORDER BY cal.entrega_inicio`,
        [est, o.hoje, ...ec.p],
      );
      const janelas = new Map<number, { fonte: string; janelas: JanelaEntrega[] }>();
      for (const r of calendario) {
        const cv = n(r['fonte_pagadora_id']);
        const g = janelas.get(cv) ?? { fonte: texto(r['fonte']), janelas: [] };
        g.janelas.push({
          competencia: dataIso(r['competencia']) ?? '',
          entregaInicio: dataIso(r['entrega_inicio']) ?? '',
          entregaFim: dataIso(r['entrega_fim']) ?? '',
          pagamentoPrevisto: dataIso(r['pagamento_previsto']),
          prazoPagamentoDias: nn(r['prazo_pagamento_dias']),
          restritivo: Boolean(Number(r['restritivo'])),
        });
        janelas.set(cv, g);
      }
      const linhas = await l.consultar<Linha>(
        `SELECT lt.fonte_pagadora_id, fp.nome AS fonte,
                SUM(lt.numero_protocolo IS NULL) AS sem_protocolo,
                SUM(lt.numero_protocolo IS NULL AND lt.gerado_em < DATE_SUB(?, INTERVAL ? DAY)) AS parados,
                MIN(CASE WHEN lt.numero_protocolo IS NULL THEN lt.gerado_em END) AS mais_antigo,
                (SELECT pr.prazo_dias FROM prazo_recurso_fonte_pagadora pr
                  WHERE pr.estabelecimento_id = lt.estabelecimento_id AND pr.fonte_pagadora_id = lt.fonte_pagadora_id
                    AND pr.vigencia_inicio <= ? AND (pr.vigencia_fim IS NULL OR pr.vigencia_fim >= ?)
                  ORDER BY pr.vigencia_inicio DESC LIMIT 1) AS prazo_dias
           FROM lote_tiss lt JOIN fonte_pagadora fp ON fp.id = lt.fonte_pagadora_id
          WHERE lt.estabelecimento_id = ? AND lt.excluido_em IS NULL AND lt.situacao <> 'cancelado'${e.sql}
          GROUP BY lt.estabelecimento_id, lt.fonte_pagadora_id, fp.nome
          ORDER BY fp.nome`,
        [o.hoje, Math.max(0, o.paradoDias), o.hoje, o.hoje, est, ...e.p],
      );
      // O convênio só com calendário (sem lote ainda) também aparece: a entrega dele está à frente.
      const comLote = new Set(linhas.map((r) => n(r['fonte_pagadora_id'])));
      const soCalendario: Linha[] = [...janelas.entries()]
        .filter(([cv]) => !comLote.has(cv))
        .map(([cv, g]) => ({ fonte_pagadora_id: cv, fonte: g.fonte, sem_protocolo: 0, parados: 0 }));
      return [...linhas, ...soCalendario]
        .sort((a, b) => texto(a['fonte']).localeCompare(texto(b['fonte'])))
        .map((r) => {
          const convenio = n(r['fonte_pagadora_id']);
          const cal = janelas.get(convenio)?.janelas ?? [];
          const proxima = proximaEntrega(cal, o.hoje);
          const doParametro = o.prazoRecurso
            .split(';')
            .map((x) => x.split(':').map((y) => Number(y.trim())))
            .find(([cv, d]) => cv === convenio && Number.isInteger(d) && (d ?? 0) > 0)?.[1];
          return {
            convenio,
            convenioNome: texto(r['fonte']),
            entregas: entregasAFrente(cal, o.hoje),
            proximaEntrega: proxima?.janela.entregaInicio ?? null,
            entrega: proxima
              ? {
                  competencia: proxima.janela.competencia,
                  inicio: proxima.janela.entregaInicio,
                  fim: proxima.janela.entregaFim,
                  situacao: proxima.situacao,
                  dias: proxima.dias,
                  pagamentoPrevisto: proxima.pagamentoPrevisto,
                  restritivo: proxima.janela.restritivo,
                }
              : null,
            lotesSemProtocolo: n(r['sem_protocolo']),
            lotesParados: n(r['parados']),
            maisAntigoSemProtocolo: dataIso(r['mais_antigo']),
            prazoRecursoDias: nn(r['prazo_dias']) ?? doParametro ?? null,
          };
        });
    });
  }

  private async competenciasLidas(
    l: Leitor,
    est: number,
    where: string,
    p: unknown[],
  ): Promise<CompetenciaLida[]> {
    const linhas = await l.consultar<Linha>(
      `SELECT ch.fonte_pagadora_id, fp.nome AS fonte, ch.competencia, COUNT(*) AS contas,
              COALESCE(SUM(ch.valor_total), 0) AS valor,
              SUM(EXISTS (SELECT 1 FROM lote_tiss_conta ltc JOIN lote_tiss lt ON lt.id = ltc.lote_tiss_id
                           WHERE ltc.conta_hospitalar_id = ch.id AND ltc.excluido_em IS NULL
                             AND lt.excluido_em IS NULL AND lt.situacao <> 'cancelado')) AS em_lote,
              MAX(fc.situacao) AS situacao_fechamento, MAX(fc.fechado_em) AS fechado_em, MAX(u.login) AS fechado_por,
              MAX(fc.reaberto_em) AS reaberto_em, MAX(ur.login) AS reaberto_por, MAX(fc.motivo_reabertura) AS motivo,
              MAX((SELECT COUNT(*) FROM ciclo_competencia_fonte_pagadora cc
                    WHERE cc.fechamento_competencia_fonte_pagadora_id = fc.id AND cc.excluido_em IS NULL)) AS ciclos
         FROM conta_hospitalar ch
         JOIN fonte_pagadora fp ON fp.id = ch.fonte_pagadora_id
         LEFT JOIN fechamento_competencia_fonte_pagadora fc ON fc.estabelecimento_id = ch.estabelecimento_id
               AND fc.fonte_pagadora_id = ch.fonte_pagadora_id AND fc.competencia = ch.competencia
               AND fc.excluido_em IS NULL
         LEFT JOIN usuario u ON u.id = fc.fechado_por_usuario_id
         LEFT JOIN usuario ur ON ur.id = fc.reaberto_por_usuario_id
        WHERE ch.estabelecimento_id = ? AND ch.excluido_em IS NULL AND ch.situacao <> 'cancelada'${where}
        GROUP BY ch.fonte_pagadora_id, fp.nome, ch.competencia
        ORDER BY ch.competencia DESC, fp.nome`,
      [est, ...p],
    );
    return linhas.map((r) => {
      const d = dataIso(r['competencia']) ?? '0000-00';
      const fechada = texto(r['situacao_fechamento']) === 'fechada';
      const reaberta = texto(r['situacao_fechamento']) === 'reaberta';
      return {
        convenio: n(r['fonte_pagadora_id']),
        convenioNome: texto(r['fonte']),
        ano: Number(d.slice(0, 4)),
        mes: Number(d.slice(5, 7)),
        fechada,
        fechadaEm: fechada ? instante(r['fechado_em']) : null,
        fechadaPor: fechada ? texto(r['fechado_por']) : '',
        reaberta,
        reabertaEm: reaberta ? instante(r['reaberto_em']) : null,
        reabertaPor: reaberta ? texto(r['reaberto_por']) : '',
        motivoReabertura: reaberta ? texto(r['motivo']) : '',
        ciclos: n(r['ciclos']),
        contas: n(r['contas']),
        emLote: n(r['em_lote']),
        valor: n(r['valor']),
      };
    });
  }

  competencias(
    c: ContextoTiss,
    f: { convenio: number | null; ano: number | null; convenios: readonly number[] | null },
  ): Promise<CompetenciaLida[]> {
    return this.ler(c, async (l, est) => {
      let where = '';
      const p: unknown[] = [];
      if (f.convenio !== null) {
        where += ' AND ch.fonte_pagadora_id = ?';
        p.push(f.convenio);
      }
      if (f.ano !== null) {
        where += ' AND ch.competencia >= ? AND ch.competencia < ?';
        p.push(`${f.ano}-01-01`, `${f.ano + 1}-01-01`);
      }
      const e = escopo('ch.fonte_pagadora_id', f.convenios);
      return this.competenciasLidas(l, est, `${where}${e.sql}`, [...p, ...e.p]);
    });
  }

  resumoCompetencia(
    c: ContextoTiss,
    x: { convenio: number; ano: number; mes: number },
  ): Promise<CompetenciaLida> {
    return this.ler(c, async (l, est) => {
      const [r] = await this.competenciasLidas(
        l,
        est,
        ' AND ch.fonte_pagadora_id = ? AND ch.competencia = ?',
        [x.convenio, diaDaCompetencia(x.ano, x.mes)],
      );
      if (r) return r;
      const fp = await l.uma<Linha>('SELECT nome FROM fonte_pagadora WHERE id = ?', [x.convenio]);
      const fc = await l.uma<Linha>(
        `SELECT fc.situacao, fc.fechado_em, u.login, fc.reaberto_em, ur.login AS reaberto_por, fc.motivo_reabertura,
                (SELECT COUNT(*) FROM ciclo_competencia_fonte_pagadora cc
                  WHERE cc.fechamento_competencia_fonte_pagadora_id = fc.id AND cc.excluido_em IS NULL) AS ciclos
           FROM fechamento_competencia_fonte_pagadora fc
           LEFT JOIN usuario u ON u.id = fc.fechado_por_usuario_id
           LEFT JOIN usuario ur ON ur.id = fc.reaberto_por_usuario_id
          WHERE fc.estabelecimento_id = ? AND fc.fonte_pagadora_id = ? AND fc.competencia = ? AND fc.excluido_em IS NULL`,
        [est, x.convenio, diaDaCompetencia(x.ano, x.mes)],
      );
      const fechada = texto(fc?.['situacao']) === 'fechada';
      const reaberta = texto(fc?.['situacao']) === 'reaberta';
      return {
        convenio: x.convenio,
        convenioNome: texto(fp?.['nome']),
        ano: x.ano,
        mes: x.mes,
        fechada,
        fechadaEm: fechada ? instante(fc?.['fechado_em']) : null,
        fechadaPor: fechada ? texto(fc?.['login']) : '',
        reaberta,
        reabertaEm: reaberta ? instante(fc?.['reaberto_em']) : null,
        reabertaPor: reaberta ? texto(fc?.['reaberto_por']) : '',
        motivoReabertura: reaberta ? texto(fc?.['motivo_reabertura']) : '',
        ciclos: n(fc?.['ciclos']),
        contas: 0,
        emLote: 0,
        valor: 0,
      };
    });
  }

  /** Motivos de glosa vigentes da TUSS (catálogo da rede), com o grupo. */
  motivos(c: ContextoTiss): Promise<MotivoGlosaLido[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT mg.codigo_tuss, mg.descricao, mg.permite_reapresentacao, g.id AS grupo, g.descricao AS grupo_nome
             FROM motivo_glosa mg LEFT JOIN grupo_motivo_glosa g ON g.id = mg.grupo_motivo_glosa_id
            WHERE mg.vigencia_inicio <= CURRENT_DATE AND (mg.vigencia_fim IS NULL OR mg.vigencia_fim >= CURRENT_DATE)
            ORDER BY mg.codigo_tuss`,
        )
      )
        .map((r) => ({
          codigo: codigoMotivo(r['codigo_tuss']),
          nome: texto(r['descricao']),
          tipo: n(r['grupo']),
          tipoNome: texto(r['grupo_nome']),
          reapresenta: verdadeiro(r['permite_reapresentacao']),
        }))
        .filter((m) => m.codigo > 0),
    );
  }

  grade(c: ContextoTiss, f: FiltroGlosa): Promise<GradeGlosa> {
    return this.ler(c, async (l, est) => {
      const e = escopo('ch.fonte_pagadora_id', f.convenios);
      const p: unknown[] = [est, diaDaCompetencia(f.ano, f.mes)];
      let where = ' AND ch.competencia = ?';
      if (f.convenio !== null) {
        where += ' AND ch.fonte_pagadora_id = ?';
        p.push(f.convenio);
      }
      const linhas = await l.consultar<Linha>(
        `SELECT ch.id, ch.numero, ch.fonte_pagadora_id, ch.competencia, ch.valor_total, pf.nome AS beneficiario,
                COALESCE(SUM(gi.valor_apresentado - gi.valor_glosado), 0) AS pago,
                COALESCE(SUM(gi.valor_glosado), 0) AS glosa,
                SUM(gi.valor_glosado > 0) AS glosados,
                SUM(gi.recurso_glosa_id IS NOT NULL AND gi.data_recuperacao IS NULL) AS em_recurso,
                SUM(ci.id IS NOT NULL AND gi.id IS NULL) AS nao_conciliados,
                MIN(CASE WHEN gi.decisao = 'pendente' AND gi.valor_glosado > 0 THEN gl.data_limite_recurso END) AS prazo
           FROM conta_hospitalar ch
           JOIN paciente pa ON pa.id = ch.paciente_id
           JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
           LEFT JOIN conta_hospitalar_item ci ON ci.conta_hospitalar_id = ch.id AND ci.excluido_em IS NULL
                 AND ci.situacao NOT IN ('sem_cobranca','transferido','estornado')
           LEFT JOIN glosa_item gi ON gi.id = ${glosaVivaDoItem('ci.id')}
           LEFT JOIN glosa gl ON gl.id = gi.glosa_id
          WHERE ch.estabelecimento_id = ? AND ch.excluido_em IS NULL
            AND ch.situacao IN ('faturada','enviada','paga')${where}${e.sql}
          GROUP BY ch.id, ch.numero, ch.fonte_pagadora_id, ch.competencia, ch.valor_total, pf.nome
          ORDER BY ch.numero LIMIT 5000`,
        [...p, ...e.p],
      );
      const contas = linhas
        .map((r) => ({
          conta: n(r['id']),
          chave: texto(r['numero']),
          convenio: n(r['fonte_pagadora_id']),
          competencia: mesDe(r['competencia']),
          beneficiario: texto(r['beneficiario']),
          cobrado: n(r['valor_total']),
          pago: r2(n(r['pago'])),
          glosa: r2(n(r['glosa'])),
          itensGlosados: n(r['glosados']),
          itensEmRecurso: n(r['em_recurso']),
          prazoMaisProximo: dataIso(r['prazo']),
          naoConciliados: n(r['nao_conciliados']),
        }))
        .filter((x) =>
          f.estado === 'com-glosa'
            ? x.glosa > 0
            : f.estado === 'em-recurso'
              ? x.itensEmRecurso > 0
              : f.estado === 'nao-conciliadas'
                ? x.naoConciliados > 0
                : true,
        );
      const porPagina = Math.max(1, Math.min(200, f.porPagina));
      const pagina = contas
        .slice(f.pagina * porPagina, (f.pagina + 1) * porPagina)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- o campo é descartado de propósito
        .map(({ naoConciliados: _n, ...x }) => x);
      return { regua: 'competencia', contas: pagina, total: contas.length, pagina: f.pagina, porPagina };
    });
  }

  itensDaConta(c: ContextoTiss, conta: number, prazo: string): Promise<ItemGlosaLido[]> {
    return this.ler(c, async (l, est) =>
      (await l.consultar<Linha>(`${SQL_ITENS_GLOSA} AND ch.id = ? ORDER BY ci.sequencia`, [est, conta])).map(
        (r) => itemGlosaDe(r, prazo),
      ),
    );
  }

  /** A evidência do prontuário gravada na decisão de recorrer a glosa viva do item (null quando não há). */
  evidenciaDoItem(c: ContextoTiss, item: number): Promise<EvidenciaGlosaLida | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(
        `SELECT gi.evidencia_prontuario, gi.decidido_em, ud.login AS decidido_por
           FROM conta_hospitalar_item ci
           JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id
           JOIN glosa_item gi ON gi.id = ${glosaVivaDoItem('ci.id')}
           LEFT JOIN usuario ud ON ud.id = gi.decidido_por_usuario_id
          WHERE ci.id = ? AND ch.estabelecimento_id = ? AND ch.excluido_em IS NULL AND gi.evidencia_prontuario IS NOT NULL`,
        [item, est],
      );
      return r
        ? {
            item,
            evidencia: texto(r['evidencia_prontuario']),
            decididoPor: texto(r['decidido_por']),
            decididoEm: instante(r['decidido_em']) ?? '',
          }
        : null;
    });
  }

  convenioDaConta(c: ContextoTiss, conta: number): Promise<number | null> {
    return this.ler(c, async (l, est) =>
      nn(
        (
          await l.uma<Linha>(
            'SELECT fonte_pagadora_id FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [conta, est],
          )
        )?.['fonte_pagadora_id'],
      ),
    );
  }

  contaDoItem(c: ContextoTiss, item: number): Promise<{ conta: number; convenio: number } | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(
        `SELECT ch.id, ch.fonte_pagadora_id FROM conta_hospitalar_item ci
           JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id
          WHERE ci.id = ? AND ch.estabelecimento_id = ? AND ci.excluido_em IS NULL AND ch.excluido_em IS NULL`,
        [item, est],
      );
      return r ? { conta: n(r['id']), convenio: n(r['fonte_pagadora_id']) } : null;
    });
  }

  demonstrativos(
    c: ContextoTiss,
    f: { lote: number | null; convenios: readonly number[] | null },
  ): Promise<DemonstrativoLido[]> {
    return this.ler(c, async (l, est) => {
      const e = escopo('d.fonte_pagadora_id', f.convenios);
      const p: unknown[] = [est];
      let where = '';
      if (f.lote !== null) {
        where = ' AND d.lote_tiss_id = ?';
        p.push(f.lote);
      }
      const linhas = await l.consultar<Linha>(
        `SELECT d.id, d.lote_tiss_id, d.fonte_pagadora_id, d.numero_demonstrativo, d.data_emissao, d.forma_entrada,
                d.valor_informado, d.valor_liberado, d.criado_em, u.login,
                (SELECT COUNT(*) FROM demonstrativo_analise_conta_item i WHERE i.demonstrativo_analise_conta_id = d.id
                   AND i.excluido_em IS NULL) AS itens,
                (SELECT COUNT(*) FROM demonstrativo_analise_conta_item i WHERE i.demonstrativo_analise_conta_id = d.id
                   AND i.excluido_em IS NULL AND i.conta_hospitalar_item_id IS NOT NULL) AS casados,
                (SELECT COUNT(*) FROM demonstrativo_analise_conta_item i WHERE i.demonstrativo_analise_conta_id = d.id
                   AND i.excluido_em IS NULL AND i.situacao_conciliacao = 'conciliado') AS baixados
           FROM demonstrativo_analise_conta d LEFT JOIN usuario u ON u.id = d.criado_por
          WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL${where}${e.sql}
          ORDER BY d.data_emissao DESC, d.id DESC LIMIT 500`,
        [...p, ...e.p],
      );
      const analise: DemonstrativoLido[] = linhas.map((r) => ({
        id: n(r['id']),
        lote: n(r['lote_tiss_id']),
        convenio: n(r['fonte_pagadora_id']),
        tipo: 'analise' as const,
        origem: texto(r['forma_entrada']) === 'digitacao' ? ('digitacao' as const) : ('xml' as const),
        numero: texto(r['numero_demonstrativo']),
        dataEmissao: dataIso(r['data_emissao']) ?? '',
        itens: n(r['itens']),
        casados: n(r['casados']),
        semCasamento: n(r['itens']) - n(r['casados']),
        baixados: n(r['baixados']),
        valorInformado: n(r['valor_informado']),
        valorPago: n(r['valor_liberado']),
        importadoPor: texto(r['login']),
        importadoEm: instante(r['criado_em']) ?? '',
      }));
      return [...analise, ...(await listarPagamentos(l, est, f))];
    });
  }

  demonstrativo(
    c: ContextoTiss,
    id: number,
    tipo: 'analise' | 'pagamento' = 'analise',
  ): ReturnType<PortaTiss['demonstrativo']> {
    return this.ler(c, async (l, est) => {
      if (tipo === 'pagamento') return lerPagamento(l, est, id);
      const d = await l.uma<Linha>(
        `SELECT lote_tiss_id, fonte_pagadora_id FROM demonstrativo_analise_conta
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [id, est],
      );
      if (!d) return null;
      const itens = await l.consultar<Linha>(
        `SELECT i.id, i.conta_hospitalar_item_id, ci.versao AS versao_item, ci.conta_hospitalar_id, ci.valor_total,
                i.numero_guia_prestador, i.sequencia, i.sequencia_item_guia, i.codigo_procedimento, i.valor_informado,
                i.valor_liberado, i.quantidade_executada, i.situacao_conciliacao, mg.codigo_tuss, mg.descricao
           FROM demonstrativo_analise_conta_item i
           LEFT JOIN conta_hospitalar_item ci ON ci.id = i.conta_hospitalar_item_id
           LEFT JOIN motivo_glosa mg ON mg.id = i.motivo_glosa_id
          WHERE i.demonstrativo_analise_conta_id = ? AND i.excluido_em IS NULL
          ORDER BY i.sequencia`,
        [id],
      );
      return {
        lote: n(d['lote_tiss_id']),
        convenio: n(d['fonte_pagadora_id']),
        itens: itens.map((r) => {
          const casado =
            r['conta_hospitalar_item_id'] !== null && r['conta_hospitalar_item_id'] !== undefined;
          return {
            id: n(r['id']),
            item: nn(r['conta_hospitalar_item_id']),
            versaoItem: casado ? versaoTexto(n(r['versao_item'])) : null,
            conta: nn(r['conta_hospitalar_id']),
            numeroGuia: texto(r['numero_guia_prestador']),
            sequencial: n(r['sequencia_item_guia'] ?? r['sequencia']),
            codigoProcedimento: texto(r['codigo_procedimento']),
            valorCobrado: casado ? n(r['valor_total']) : null,
            valorInformado: n(r['valor_informado']),
            valorPago: n(r['valor_liberado']),
            quantidadePaga: n(r['quantidade_executada']),
            motivo: codigoMotivo(r['codigo_tuss']),
            motivoNome: texto(r['descricao']),
            situacao:
              texto(r['situacao_conciliacao']) === 'conciliado'
                ? ('baixado' as const)
                : casado
                  ? ('casado' as const)
                  : ('sem-casamento' as const),
          };
        }),
      };
    });
  }

  configuracao(c: ContextoTiss): Promise<ConfiguracaoTissLida> {
    return this.ler(c, async (l, est) => {
      const versoes = await l.consultar<Linha>(
        "SELECT DISTINCT codigo_tiss FROM versao_padrao_tiss WHERE ativo = TRUE AND componente = 'troca' ORDER BY codigo_tiss",
      );
      const transacoes = await l.consultar<Linha>(
        'SELECT id, nome, tipo_transacao, caminho_padrao FROM transacao_tiss_webservice WHERE ativo = TRUE ORDER BY nome, id',
      );
      const convenios = await l.consultar<Linha>(
        `SELECT fp.id, fp.nome, c.codigo_prestador_operadora, v.codigo_tiss, COALESCE(c.registro_ans, fp.registro_ans) AS ans
           FROM configuracao_tiss_fonte_pagadora c
           JOIN fonte_pagadora fp ON fp.id = c.fonte_pagadora_id
           JOIN versao_padrao_tiss v ON v.id = c.versao_padrao_tiss_id
          WHERE c.estabelecimento_id = ? AND c.ativo = TRUE AND c.vigencia_inicio <= CURRENT_DATE
            AND (c.vigencia_fim IS NULL OR c.vigencia_fim >= CURRENT_DATE)
          ORDER BY fp.nome`,
        [est],
      );
      const endpoints = await l.consultar<Linha>(
        `SELECT e.fonte_pagadora_id, t.codigo_transacao, e.url, e.referencia_cofre, e.ativo,
                COALESCE(e.alterado_em, e.criado_em) AS em, u.login
           FROM endpoint_tiss_fonte_pagadora e
           LEFT JOIN transacao_tiss_webservice t ON t.id = e.transacao_tiss_webservice_id
           LEFT JOIN usuario u ON u.id = COALESCE(e.alterado_por, e.criado_por)
          WHERE e.estabelecimento_id = ?
          ORDER BY e.fonte_pagadora_id, t.codigo_transacao`,
        [est],
      );
      return {
        versoes: versoes.map((r) => ({ codigo: texto(r['codigo_tiss']), conhecidaNoOutroSistema: false })),
        transacoes: transacoes.map((r) => ({
          id: n(r['id']),
          nome: texto(r['nome']),
          tipo: texto(r['tipo_transacao']),
        })),
        // Sem convivência: não há canal de outro sistema a mostrar.
        webservicesOutroSistema: [],
        urlsPadrao: transacoes
          .filter((r) => texto(r['caminho_padrao']))
          .map((r) => ({ transacao: n(r['id']), url: texto(r['caminho_padrao']) })),
        convenios: convenios.map((r) => ({
          convenio: n(r['id']),
          nome: texto(r['nome']),
          codigoPrestador: r['codigo_prestador_operadora'] ? texto(r['codigo_prestador_operadora']) : null,
          versaoConfigurada: r['codigo_tiss'] ? texto(r['codigo_tiss']) : null,
          registroAns: r['ans'] ? texto(r['ans']) : null,
        })),
        endpoints: endpoints.map((r) => ({
          convenio: n(r['fonte_pagadora_id']),
          transacao: texto(r['codigo_transacao']),
          url: texto(r['url']),
          referenciaCofre: texto(r['referencia_cofre']),
          ativo: verdadeiro(r['ativo']),
          alteradoPor: texto(r['login']),
          alteradoEm: instante(r['em']) ?? '',
        })),
        versaoGerada: VERSAO_TISS_VIGENTE,
      };
    });
  }

  painel(
    c: ContextoTiss,
    f: { de: string; ate: string; convenios: readonly number[] | null },
  ): Promise<PainelGlosa> {
    return this.ler(c, async (l, est) => {
      const e = escopo('ch.fonte_pagadora_id', f.convenios);
      const linhas = await l.consultar<Linha>(
        `${SQL_ITENS_GLOSA} AND ch.situacao IN ('faturada','enviada','paga') AND ch.competencia >= ? AND ch.competencia <= ?${e.sql}
           LIMIT 200000`,
        [est, `${f.de.slice(0, 7)}-01`, `${f.ate.slice(0, 7)}-01`, ...e.p],
      );
      const fontes = new Map(
        (await l.consultar<Linha>('SELECT id, nome FROM fonte_pagadora WHERE excluido_em IS NULL')).map(
          (r) => [n(r['id']), texto(r['nome'])],
        ),
      );
      const faturadores = new Map(
        (
          await l.consultar<Linha>(
            `SELECT ch.id, u.login FROM conta_hospitalar ch LEFT JOIN usuario u ON u.id = ch.fechada_por_usuario_id
              WHERE ch.estabelecimento_id = ? AND ch.competencia >= ? AND ch.competencia <= ? AND ch.excluido_em IS NULL`,
            [est, `${f.de.slice(0, 7)}-01`, `${f.ate.slice(0, 7)}-01`],
          )
        ).map((r) => [n(r['id']), texto(r['login'])]),
      );
      const s = {
        emitido: 0,
        itensEmitidos: 0,
        conciliado: 0,
        itensConciliados: 0,
        pago: 0,
        glosaLiquida: 0,
        glosaPositiva: 0,
        itensPagosAMaior: 0,
        contestado: 0,
        recuperado: 0,
      };
      const porMotivo = new Map<number, { codigo: number; nome: string; glosa: number; itens: number }>();
      const porConvenio = new Map<
        number,
        { conciliado: number; glosa: number; contestado: number; recuperado: number }
      >();
      const porFaturador = new Map<string, { faturador: string; glosa: number; itens: number }>();
      const porFaixa = new Map<string, { faixa: string; itens: number; glosa: number }>();
      const ciclos: number[] = [];
      let foraDaFaixa = 0;
      const fila = { pendentes: 0, emRecurso: 0, semPrazo: 0 };
      for (const r of linhas) {
        const i = itemGlosaDe(r, '');
        s.emitido += i.valorCobrado;
        s.itensEmitidos += 1;
        if (!i.conciliado) continue;
        s.conciliado += i.valorCobrado;
        s.itensConciliados += 1;
        s.pago += i.valorPago;
        s.glosaLiquida += i.glosa;
        s.glosaPositiva += Math.max(0, i.glosa);
        s.contestado += i.valorRecurso;
        s.recuperado += i.valorRetorno;
        const cv = porConvenio.get(i.convenio) ?? { conciliado: 0, glosa: 0, contestado: 0, recuperado: 0 };
        cv.conciliado += i.valorCobrado;
        cv.glosa += i.glosa;
        cv.contestado += i.valorRecurso;
        cv.recuperado += i.valorRetorno;
        porConvenio.set(i.convenio, cv);
        if (i.glosa > 0) {
          const m = porMotivo.get(i.motivo) ?? { codigo: i.motivo, nome: i.motivoNome, glosa: 0, itens: 0 };
          m.glosa += i.glosa;
          m.itens += 1;
          porMotivo.set(i.motivo, m);
          const quem = faturadores.get(i.conta) ?? '';
          const fa = porFaturador.get(quem) ?? { faturador: quem, glosa: 0, itens: 0 };
          fa.glosa += i.glosa;
          fa.itens += 1;
          porFaturador.set(quem, fa);
          const fx = faixaDoValor(i.glosa);
          const x = porFaixa.get(fx) ?? { faixa: fx, itens: 0, glosa: 0 };
          x.itens += 1;
          x.glosa += i.glosa;
          porFaixa.set(fx, x);
        }
        if (i.estado === 'pendente') {
          fila.pendentes += 1;
          if (!r['data_limite_recurso']) fila.semPrazo += 1;
        }
        if (i.estado === 'recorrida') fila.emRecurso += 1;
        if (i.dataPagamento && i.dataRetorno) {
          const d = diasEntre(i.dataPagamento, i.dataRetorno);
          if (cicloValido(d)) ciclos.push(d);
          else foraDaFaixa += 1;
        }
      }
      const somas = {
        ...s,
        emitido: r2(s.emitido),
        conciliado: r2(s.conciliado),
        pago: r2(s.pago),
        glosaLiquida: r2(s.glosaLiquida),
        glosaPositiva: r2(s.glosaPositiva),
        contestado: r2(s.contestado),
        recuperado: r2(s.recuperado),
      };
      const ind = indicadoresGlosa(somas);
      return {
        regua: 'competencia',
        de: f.de,
        ate: f.ate,
        somas: { ...somas, nuncaRecorrido: ind.nuncaRecorrido },
        indicadores: {
          taxaLiquida: ind.taxaLiquida,
          taxaPositiva: ind.taxaPositiva,
          exito: ind.exito,
          exitoRotulo: ind.exitoRotulo,
        },
        porMotivo: [...porMotivo.values()]
          .map((m) => ({ ...m, glosa: r2(m.glosa) }))
          .sort((a, b) => b.glosa - a.glosa),
        porConvenio: [...porConvenio].map(([convenio, v]) => ({
          convenio,
          nome: fontes.get(convenio) ?? '',
          conciliado: r2(v.conciliado),
          glosa: r2(v.glosa),
          contestado: r2(v.contestado),
          recuperado: r2(v.recuperado),
          exitoRotulo: indicadoresGlosa({
            emitido: 0,
            conciliado: v.conciliado,
            pago: 0,
            glosaLiquida: v.glosa,
            glosaPositiva: v.glosa,
            contestado: v.contestado,
            recuperado: v.recuperado,
          }).exitoRotulo,
        })),
        porFaturador: [...porFaturador.values()].map((x) => ({ ...x, glosa: r2(x.glosa) })),
        porFaixa: [...porFaixa.values()].map((x) => ({ ...x, glosa: r2(x.glosa) })),
        ciclo: {
          mediaDias: ciclos.length ? Math.round(ciclos.reduce((a, b) => a + b, 0) / ciclos.length) : null,
          itens: ciclos.length,
          foraDaFaixa,
        },
        fila,
        geradoEm: new Date().toISOString(),
        emCache: false,
      };
    });
  }

  xmlDoLote(
    c: ContextoTiss,
    lote: number,
  ): Promise<{ chave: string; hashArquivo: string; convenio: number } | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<Linha>(
        `SELECT a.chave_armazenamento, lt.hash_arquivo, lt.fonte_pagadora_id
           FROM lote_tiss lt JOIN arquivo a ON a.id = lt.arquivo_id
          WHERE lt.id = ? AND lt.estabelecimento_id = ? AND lt.excluido_em IS NULL`,
        [lote, est],
      );
      return r
        ? {
            chave: texto(r['chave_armazenamento']),
            hashArquivo: texto(r['hash_arquivo']),
            convenio: n(r['fonte_pagadora_id']),
          }
        : null;
    });
  }

  acompanhamento(c: ContextoTiss, f: FiltroAcompanhamentoPorta): Promise<LeituraAcompanhamento> {
    return this.ler(c, async (l, est) => {
      const competencia = diaDaCompetencia(f.ano, f.mes);
      const e = escopo('ch.fonte_pagadora_id', f.convenios);
      const p: unknown[] = [est, competencia];
      let where = '';
      if (f.convenio !== null) {
        where = ' AND ch.fonte_pagadora_id = ?';
        p.push(f.convenio);
      }
      const contas = await l.consultar<Linha>(
        `SELECT ch.fonte_pagadora_id, ch.situacao, COUNT(*) AS contas, COALESCE(SUM(ch.valor_total), 0) AS valor,
                SUM(ch.origem = 'sistema' AND ch.fechada_em IS NOT NULL) AS pelo_sistema
           FROM conta_hospitalar ch
          WHERE ch.estabelecimento_id = ? AND ch.competencia = ? AND ch.excluido_em IS NULL${where}${e.sql}
          GROUP BY ch.fonte_pagadora_id, ch.situacao`,
        [...p, ...e.p],
      );
      const linhas = new Map<string, LinhaContasCompetencia>();
      for (const r of contas) {
        const situacao = situacaoContaNaCompetencia(texto(r['situacao']));
        const chave = `${n(r['fonte_pagadora_id'])}:${situacao}`;
        const a = linhas.get(chave);
        linhas.set(chave, {
          convenio: n(r['fonte_pagadora_id']),
          situacao,
          contas: (a?.contas ?? 0) + n(r['contas']),
          fechadasPeloNovo: (a?.fechadasPeloNovo ?? 0) + n(r['pelo_sistema']),
          valor: r2((a?.valor ?? 0) + n(r['valor'])),
        });
      }
      const lotes = await l.uma<Linha>(
        `SELECT COUNT(DISTINCT lt.id) AS lotes,
                COUNT(DISTINCT CASE WHEN lt.numero_protocolo IS NOT NULL THEN lt.id END) AS com_protocolo,
                COUNT(DISTINCT ltc.conta_hospitalar_id) AS contas
           FROM lote_tiss lt
           JOIN lote_tiss_conta ltc ON ltc.lote_tiss_id = lt.id AND ltc.excluido_em IS NULL
           JOIN conta_hospitalar ch ON ch.id = ltc.conta_hospitalar_id
          WHERE lt.estabelecimento_id = ? AND lt.excluido_em IS NULL AND lt.situacao <> 'cancelado'
            AND ch.competencia = ?${where}${e.sql}`,
        [...p, ...e.p],
      );
      const fechados = await l.uma<Linha>(
        `SELECT COUNT(*) AS q FROM fechamento_competencia_fonte_pagadora ch
          WHERE ch.estabelecimento_id = ? AND ch.competencia = ? AND ch.situacao = 'fechada'
            AND ch.excluido_em IS NULL${where}${e.sql}`,
        [...p, ...e.p],
      );
      const comConta = new Set(contas.map((r) => n(r['fonte_pagadora_id']))).size;
      const gravacoes: { operacao: string; peloNovo: number }[] = [];
      if (f.operacoes.length) {
        const proximo = f.mes === 12 ? diaDaCompetencia(f.ano + 1, 1) : diaDaCompetencia(f.ano, f.mes + 1);
        const contagem = await l.consultar<Linha>(
          `SELECT JSON_VALUE(dados_depois, '$.operacao') AS operacao, COUNT(*) AS q FROM trilha_auditoria
            WHERE estabelecimento_id = ? AND ocorrido_em >= ? AND ocorrido_em < ?
              AND JSON_VALUE(dados_depois, '$.operacao') IN (${lista(f.operacoes.length)})
            GROUP BY JSON_VALUE(dados_depois, '$.operacao')`,
          [est, competencia, proximo, ...f.operacoes.map(nomeNaTrilha)],
        );
        const q = new Map(contagem.map((r) => [texto(r['operacao']), n(r['q'])]));
        for (const op of f.operacoes)
          gravacoes.push({ operacao: op, peloNovo: q.get(nomeNaTrilha(op)) ?? 0 });
      }
      return {
        contas: [...linhas.values()],
        lotes: {
          lotes: n(lotes?.['lotes']),
          comProtocolo: n(lotes?.['com_protocolo']),
          contasEmLote: n(lotes?.['contas']),
          conveniosFechados: n(fechados?.['q']),
          conveniosComConta: comConta,
        },
        // Títulos e repasse do mês: leituras dos módulos financeiro e de repasse, pedidas ao orquestrador (lote 03-16).
        titulos: null,
        repasse: null,
        gravacoes,
        // Sem convivência com outro sistema: não há uso de outro sistema a contar.
        uso: null,
      };
    });
  }

  /**
   * O escopo de contas bancárias por usuário aguarda a tabela no modelo (pedido do lote 03-16): falha fechada,
   * nenhuma conta (o movimento não aparece a quem não tem o escopo registrado).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo
  async contasBancariasDoEscopo(_c: ContextoTiss, _login: string | null): Promise<number[] | null> {
    return [];
  }
}

function lerJson(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  try {
    const o = JSON.parse(texto(v)) as unknown;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** As gravações diretas sobre a transação da operação (o estabelecimento vem do contexto). */
function gravadorSobre(tx: TxOperacao, est: number): GravadorSghTiss {
  return {
    // 06-FAT linha 33: análise de conta casada item a item, ou pagamento com linhas e deduções.
    importarDemonstrativo: (d) => importarDemonstrativoNoBanco(tx, est, d),
    async decidirGlosa(d) {
      const [gi] = await tx.consultarParaAtualizar<Linha>(
        `SELECT gi.id, gi.versao, gi.glosa_id, gi.valor_glosado, gi.decisao, gi.recurso_glosa_id, gi.data_recuperacao,
                ci.conta_hospitalar_id
           FROM conta_hospitalar_item ci
           JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id
           JOIN glosa_item gi ON gi.id = ${glosaVivaDoItem('ci.id')}
          WHERE ci.id = ? AND ci.excluido_em IS NULL AND ch.estabelecimento_id = ? AND ch.excluido_em IS NULL`,
        [d.item, est],
      );
      const glosa = n(gi?.['valor_glosado']);
      const atual = gi
        ? estadoDaGlosa({
            conciliado: true,
            glosado: glosa,
            decisao: texto(gi['decisao']),
            emRecurso: gi['recurso_glosa_id'] !== null && gi['recurso_glosa_id'] !== undefined,
            retornado: gi['data_recuperacao'] !== null && gi['data_recuperacao'] !== undefined,
          })
        : null;
      const r = conferirDecisaoGlosa({
        conciliado: gi !== undefined,
        glosa,
        estadoAtual:
          atual === 'pendente' || atual === 'aceita' || atual === 'recorrida' || atual === 'encerrada'
            ? atual
            : null,
        decisao: d.decisao,
        texto: d.texto,
      });
      if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : {});
      const id = n(gi!['id']);
      await tx.alterar('glosa_item', id, n(gi!['versao']), {
        decisao: d.decisao,
        justificativa: d.texto,
        // A evidência do prontuário acompanha só a decisão de recorrer (a mesma regra da porta de memória).
        evidencia_prontuario: d.decisao === 'recorrer' ? d.evidencia.trim().slice(0, 250) || null : null,
        valor_aceito: d.decisao === 'aceitar' ? glosa : 0,
        decidido_por_usuario_id: tx.contexto.usuario,
        decidido_em: new Date(),
      });
      // O cabeçalho acompanha as decisões dos itens (valor aceito e situação), pela regra do domínio, sem gatilho.
      const [cab] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, situacao, valor_aceito FROM glosa WHERE id = ? AND excluido_em IS NULL',
        [gi!['glosa_id']],
      );
      if (cab) {
        const vivos = await tx.consultar<Linha>(
          'SELECT decisao, valor_aceito FROM glosa_item WHERE glosa_id = ? AND excluido_em IS NULL',
          [cab['id']],
        );
        const novo = situacaoDaGlosa(
          texto(cab['situacao']),
          vivos.map((v) => ({ decisao: texto(v['decisao']), valorAceito: n(v['valor_aceito']) })),
        );
        if (novo.situacao !== texto(cab['situacao']) || novo.valorAceito !== n(cab['valor_aceito']))
          await tx.alterar('glosa', n(cab['id']), n(cab['versao']), {
            situacao: novo.situacao,
            valor_aceito: novo.valorAceito,
          });
      }
      // O item da conta guarda a soma das glosas aceitas de todas as glosas vivas do item (a perda definitiva; a
      // recorrida aguarda o recurso), pela mesma regra do worker (glosadoAceitoDoItem), e a produção do repasse
      // acompanha (repasse.estornoEmGlosa): mudança do item, na mesma transação, sem gatilho.
      const conta = n(gi!['conta_hospitalar_id']);
      await sincronizarGlosaDoItem(
        tx,
        { conta, item: d.item },
        { estabelecimento: est, usuario: tx.contexto.usuario },
      );
      return {
        id,
        estado: d.decisao === 'aceitar' ? 'aceita' : 'recorrida',
        conta: n(gi!['conta_hospitalar_id']),
        glosa,
      };
    },
    async editarEndpoint(d) {
      const t = await tx.uma<Linha>(
        'SELECT id FROM transacao_tiss_webservice WHERE codigo_transacao = ? AND ativo = TRUE ORDER BY id DESC LIMIT 1',
        [d.transacao],
      );
      if (!t)
        throw recusa('transacao-inexistente', 'A transação TISS não existe no catálogo.', {
          campos: ['transacao'],
        });
      const fonte = await tx.uma<Linha>(
        'SELECT id FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL',
        [d.convenio],
      );
      if (!fonte) throw recusa('convenio-inexistente', 'O convênio não existe.', { campos: ['convenio'] });
      const [atual] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao FROM endpoint_tiss_fonte_pagadora
          WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND forma_envio = 'servico_web'
            AND transacao_tiss_webservice_id = ?`,
        [est, d.convenio, t['id']],
      );
      // O tipo de autenticação não vem da tela (pedido ao contrato): na alteração fica o cadastrado (certificado, token,
      // básica); na inclusão, credencial no cofre → básica, sem credencial → nenhuma.
      const valores = {
        url: d.url,
        referencia_cofre: d.referenciaCofre,
        ativo: d.ativo,
      };
      if (atual) {
        await tx.alterar('endpoint_tiss_fonte_pagadora', n(atual['id']), n(atual['versao']), valores);
        return { id: n(atual['id']) };
      }
      const id = await tx.incluir('endpoint_tiss_fonte_pagadora', {
        estabelecimento_id: est,
        fonte_pagadora_id: d.convenio,
        transacao_tiss_webservice_id: t['id'],
        forma_envio: 'servico_web',
        tipo_autenticacao: d.referenciaCofre ? 'basica' : 'nenhuma',
        ...valores,
      });
      return { id };
    },
    async registrarMensagem(m) {
      const id = await tx.incluir('integracao_mensagem', {
        estabelecimento_id: est,
        ponto: `tiss.${m.transacao}`.slice(0, 80),
        direcao: m.direcao === 'envio' ? 'saida' : 'entrada',
        situacao: SITUACAO_MENSAGEM_NO_MODELO[m.situacao] ?? 'erro',
        tentativas: m.tentativa,
        entidade: m.lote !== null ? 'lote_tiss' : m.conta !== null ? 'conta_hospitalar' : null,
        entidade_id: m.lote ?? m.conta,
        referencia_externa: m.protocolo,
        conteudo: JSON.stringify({
          destino: m.destino,
          situacao: m.situacao,
          convenio: m.convenio,
          hashRequisicao: m.hashRequisicao,
          hashResposta: m.hashResposta,
          usuario: m.usuario,
        }),
        processada_em: m.situacao === 'aceita' ? new Date() : null,
      });
      return { id };
    },
  };
}

export function portaTissIndisponivel(): PortaTiss {
  return portaIndisponivel<PortaTiss>(METODOS_PORTA_TISS);
}
