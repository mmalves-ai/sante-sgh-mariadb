import type { ApuracaoLucroRealEcf } from '@sgh/dominio-contabil';
// F7, 07-FIN linha 115 (C3-023): o LALUR/LACS (partes A e B) e a apuração e a provisão do IRPJ e da CSLL do lucro real
// no banco próprio, pelo executor do @sgh/nucleo (trilha, outbox e idempotência na mesma transação). As regras são do
// @sgh/dominio-contabil (lalur.ts); aqui ficam a leitura e a gravação nas tabelas do modelo:
//   configuracao_provisao_irpj_csll (contas, histórico e alíquotas da provisão, uma por estabelecimento);
//   saldo_lalur_parte_b (a conta da parte B com o saldo de abertura) e movimento_lalur_parte_b (cada lançamento, ligado
//   ao ajuste da parte A quando nasce dele; o saldo é o de abertura mais os lançamentos não excluídos);
//   apuracao_irpj_csll (o período com os totais, as bases, os tributos e a provisão) e ajuste_lalur (as adições e
//   exclusões manuais e a compensação de prejuízo que a apuração grava e refaz);
//   lancamento_contabil e partida_contabil (a provisão, pela mesma gravação da contabilização automática).
// O lucro antes dos tributos vem das partidas gravadas das contas de resultado no período (sem o encerramento e sem as
// contas de despesa da própria provisão).
import {
  apurarLucroReal,
  conferirAcaoApuracao,
  conferirAjusteLalur,
  conferirLancamentoParteB,
  conferirPeriodoApuracao,
  type ContaParteB,
  type ContaParteBEcf,
  FORMAS_APURACAO_LUCRO_REAL,
  type FormaApuracaoLucroReal,
  ladoParteB,
  type LinhaParteAEcf,
  type NaturezaSaldoParteB,
  partidasProvisaoIrpjCsll,
  type RecusaLalur,
  registrosBlocoMEcf,
  saldoParteB,
  type SituacaoApuracaoLucroReal,
  type TipoAjusteLalur,
  type TributoParteB,
} from '@sgh/dominio-contabil';
import {
  type ContextoOperacao,
  definirOperacao,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { gravacaoDosFatos, TABELAS_CONTABILIZACAO } from '@sgh/persistencia-contabil';
import { z } from 'zod';

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dinheiro = z.number().finite().nonnegative();
const aliquota = z.number().min(0).max(100);

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const txtOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const dia = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : txt(v).slice(0, 10));
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';
const centavos = (v: unknown): number => Math.round(num(v) * 100);
const reais = (c: number): number => Math.round(c) / 100;
const falhar = (r: RecusaLalur | null): void => {
  if (r) throw recusa(r.codigo, r.mensagem, { campos: [...r.campos] });
};
type Consulta = Pick<Leitor, 'consultar'>;

// ---------------------------------------------------------------- leituras

const SQL_CONTAS_B = `SELECT b.id, b.codigo, b.descricao, b.tributo_apurado, b.natureza_saldo, b.saldo_inicial, b.data_saldo_inicial,
    b.data_limite, b.versao, b.ativo FROM saldo_lalur_parte_b b WHERE b.estabelecimento_id = ? AND b.excluido_em IS NULL ORDER BY b.codigo`;

async function contasParteB(l: Consulta, est: number, ate: string | null) {
  const contas = await l.consultar(SQL_CONTAS_B, [est]);
  const movs = await l.consultar(
    `SELECT m.id, m.saldo_lalur_parte_b_id, m.periodo_referencia, m.data_lancamento, m.historico, m.natureza, m.tipo_lancamento,
        m.valor, m.ajuste_lalur_id FROM movimento_lalur_parte_b m JOIN saldo_lalur_parte_b b ON b.id = m.saldo_lalur_parte_b_id
      WHERE b.estabelecimento_id = ? AND m.excluido_em IS NULL${ate ? ' AND m.periodo_referencia <= ?' : ''}
      ORDER BY m.periodo_referencia, m.sequencia`,
    ate ? [est, ate] : [est],
  );
  return contas.map((c) => {
    const natureza = txt(c['natureza_saldo']) as NaturezaSaldoParteB;
    const lancamentos = movs
      .filter((m) => num(m['saldo_lalur_parte_b_id']) === num(c['id']))
      .map((m) => ({
        id: num(m['id']),
        periodo: dia(m['periodo_referencia']),
        data: dia(m['data_lancamento']),
        historico: txt(m['historico']),
        natureza: txt(m['natureza']) as 'debito' | 'credito',
        tipo: txt(m['tipo_lancamento']),
        valorCentavos: centavos(m['valor']),
        ajuste: numOuNulo(m['ajuste_lalur_id']),
      }));
    return {
      id: num(c['id']),
      codigo: txt(c['codigo']),
      descricao: txt(c['descricao']),
      tributo: txt(c['tributo_apurado']) as TributoParteB,
      natureza,
      saldoInicialCentavos: centavos(c['saldo_inicial']),
      dataSaldoInicial: dia(c['data_saldo_inicial']),
      dataLimite: c['data_limite'] ? dia(c['data_limite']) : null,
      ativo: bool(c['ativo']),
      versao: num(c['versao']),
      saldoCentavos: saldoParteB(natureza, centavos(c['saldo_inicial']), lancamentos),
      lancamentos,
    };
  });
}

async function configuracao(l: Consulta, est: number) {
  const [c] = await l.consultar(
    `SELECT c.*, di.classificacao AS irpj_d, ci.classificacao AS irpj_c, dc.classificacao AS csll_d, cc.classificacao AS csll_c
       FROM configuracao_provisao_irpj_csll c
       JOIN conta_contabil di ON di.id = c.irpj_debito_conta_contabil_id JOIN conta_contabil ci ON ci.id = c.irpj_credito_conta_contabil_id
       JOIN conta_contabil dc ON dc.id = c.csll_debito_conta_contabil_id JOIN conta_contabil cc ON cc.id = c.csll_credito_conta_contabil_id
      WHERE c.estabelecimento_id = ? AND c.ativo = TRUE`,
    [est],
  );
  if (!c) return null;
  return {
    id: num(c['id']),
    versao: num(c['versao']),
    irpjDebito: num(c['irpj_debito_conta_contabil_id']),
    irpjCredito: num(c['irpj_credito_conta_contabil_id']),
    csllDebito: num(c['csll_debito_conta_contabil_id']),
    csllCredito: num(c['csll_credito_conta_contabil_id']),
    classificacoes: {
      irpjDebito: txt(c['irpj_d']),
      irpjCredito: txt(c['irpj_c']),
      csllDebito: txt(c['csll_d']),
      csllCredito: txt(c['csll_c']),
    },
    aliquotaIrpj: num(c['aliquota_irpj']),
    aliquotaAdicional: num(c['aliquota_adicional_irpj']),
    limiteAdicionalMensal: num(c['limite_adicional_irpj_mensal']),
    aliquotaCsll: num(c['aliquota_csll']),
  };
}

/** O lucro (prejuízo, negativo) antes do IRPJ e da CSLL: crédito menos débito das contas de resultado no período. */
async function lucroAntesDosTributos(l: Consulta, est: number, inicio: string, fim: string, fora: number[]) {
  const [r] = await l.consultar(
    `SELECT COALESCE(SUM(CASE WHEN p.lado = 'credito' THEN p.valor ELSE -p.valor END), 0) AS resultado
       FROM partida_contabil p JOIN lancamento_contabil l ON l.id = p.lancamento_contabil_id
       JOIN conta_contabil c ON c.id = p.conta_contabil_id
      WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND p.excluido_em IS NULL AND l.tipo <> 'apuracao'
        AND l.data_lancamento BETWEEN ? AND ? AND c.natureza IN ('receita','custo','despesa')
        AND c.id NOT IN (${fora.length ? fora.map(() => '?').join(', ') : '0'})`,
    [est, inicio, fim, ...fora],
  );
  return centavos(r?.['resultado']);
}

async function ajustesDa(l: Consulta, apuracao: number) {
  return (
    await l.consultar(
      `SELECT a.id, a.sequencia, a.tipo, a.codigo_tabela_dinamica, a.data_lancamento, a.descricao, a.fundamento_legal, a.valor,
          a.afeta_irpj, a.afeta_csll, a.indicador_processo, a.numero_processo, a.controla_parte_b, a.versao,
          b.codigo AS conta_b, m.natureza AS natureza_b
         FROM ajuste_lalur a LEFT JOIN movimento_lalur_parte_b m ON m.ajuste_lalur_id = a.id AND m.excluido_em IS NULL
         LEFT JOIN saldo_lalur_parte_b b ON b.id = m.saldo_lalur_parte_b_id
        WHERE a.apuracao_irpj_csll_id = ? AND a.excluido_em IS NULL ORDER BY a.sequencia`,
      [apuracao],
    )
  ).map((a) => ({
    id: num(a['id']),
    sequencia: num(a['sequencia']),
    tipo: txt(a['tipo']) as TipoAjusteLalur,
    codigo: txtOuNulo(a['codigo_tabela_dinamica']),
    data: dia(a['data_lancamento']),
    descricao: txt(a['descricao']),
    fundamento: txtOuNulo(a['fundamento_legal']),
    valorCentavos: centavos(a['valor']),
    irpj: bool(a['afeta_irpj']),
    csll: bool(a['afeta_csll']),
    processo: txtOuNulo(a['numero_processo']),
    contaParteB: txtOuNulo(a['conta_b']),
    versao: num(a['versao']),
  }));
}

function apuracaoDaLinha(a: Record<string, unknown>) {
  return {
    id: num(a['id']),
    estabelecimento: num(a['estabelecimento_id']),
    inicio: dia(a['periodo_inicio']),
    fim: dia(a['periodo_fim']),
    forma: txt(a['forma_apuracao']) as FormaApuracaoLucroReal,
    situacao: txt(a['situacao']) as SituacaoApuracaoLucroReal,
    versao: num(a['versao']),
    lucroAntes: centavos(a['lucro_antes_tributos']),
    totalAdicoes: centavos(a['total_adicoes']),
    totalExclusoes: centavos(a['total_exclusoes']),
    compensacaoPrejuizo: centavos(a['compensacao_prejuizo']),
    baseIrpj: centavos(a['base_irpj']),
    baseCsll: centavos(a['base_csll']),
    limiteAdicional: centavos(a['limite_adicional']),
    irpj: centavos(a['valor_irpj']),
    adicional: centavos(a['valor_adicional_irpj']),
    csll: centavos(a['valor_csll']),
    deducoesIrpj: centavos(a['deducoes_irpj']),
    deducoesCsll: centavos(a['deducoes_csll']),
    irpjRecolher: centavos(a['valor_irpj_recolher']),
    csllRecolher: centavos(a['valor_csll_recolher']),
    provisao: numOuNulo(a['provisao_lancamento_contabil_id']),
  };
}

export async function apoioLalur(l: Leitor, est: number | null) {
  const estabelecimentos = await l.consultar(
    'SELECT id, nome_fantasia FROM estabelecimento WHERE excluido_em IS NULL ORDER BY nome_fantasia LIMIT 500',
    [],
  );
  const alvo = est ?? numOuNulo(estabelecimentos[0]?.['id']);
  const apuracoes = alvo
    ? await l.consultar(
        `SELECT id, forma_apuracao, periodo_inicio, periodo_fim, situacao, valor_irpj_recolher, valor_csll_recolher
           FROM apuracao_irpj_csll WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY periodo_inicio DESC LIMIT 60`,
        [alvo],
      )
    : [];
  const contas = alvo
    ? await l.consultar(
        `SELECT c.id, c.classificacao, c.descricao, c.natureza FROM conta_contabil c JOIN plano_contas p ON p.id = c.plano_contas_id
          WHERE c.excluido_em IS NULL AND c.ativo = TRUE AND c.tipo = 'analitica' AND p.tipo = 'contabil'
            AND c.natureza IN ('passivo','despesa','resultado') ORDER BY c.classificacao LIMIT 800`,
        [],
      )
    : [];
  return {
    estabelecimento: alvo,
    estabelecimentos: estabelecimentos.map((r) => ({ id: num(r['id']), nome: txt(r['nome_fantasia']) })),
    formas: FORMAS_APURACAO_LUCRO_REAL,
    configuracao: alvo ? await configuracao(l, alvo) : null,
    contasContabeis: contas.map((r) => ({
      id: num(r['id']),
      classificacao: txt(r['classificacao']),
      descricao: txt(r['descricao']),
      natureza: txt(r['natureza']),
    })),
    contasParteB: alvo ? await contasParteB(l, alvo, null) : [],
    apuracoes: apuracoes.map((r) => ({
      id: num(r['id']),
      forma: txt(r['forma_apuracao']),
      inicio: dia(r['periodo_inicio']),
      fim: dia(r['periodo_fim']),
      situacao: txt(r['situacao']),
      aRecolherCentavos: centavos(r['valor_irpj_recolher']) + centavos(r['valor_csll_recolher']),
    })),
  };
}

/** A apuração com os ajustes da parte A, a prévia do cálculo (sem gravar) e o bloco M da ECF. */
export async function detalheApuracaoLalur(l: Leitor, apuracao: number) {
  const [a] = await l.consultar('SELECT * FROM apuracao_irpj_csll WHERE id = ? AND excluido_em IS NULL', [
    apuracao,
  ]);
  if (!a) return null;
  const ap = apuracaoDaLinha(a);
  const ajustes = await ajustesDa(l, apuracao);
  const contas = await contasParteB(l, ap.estabelecimento, ap.fim);
  const ecf = registrosBlocoMEcf(
    ajustes.map((x): LinhaParteAEcf => ({
      codigo: x.codigo,
      descricao: x.descricao,
      tipo: x.tipo,
      valorCentavos: x.valorCentavos,
      irpj: x.irpj,
      csll: x.csll,
      contaParteB: x.contaParteB,
      processo: x.processo,
    })),
    contas.map((c): ContaParteBEcf => {
      const doPeriodo = c.lancamentos.filter((m) => m.periodo >= ap.inicio && m.periodo <= ap.fim);
      const antes = c.lancamentos.filter((m) => m.periodo < ap.inicio);
      return {
        codigo: c.codigo,
        descricao: c.descricao,
        dataInicial: c.dataSaldoInicial,
        tributo: c.tributo,
        natureza: c.natureza,
        saldoInicioCentavos: saldoParteB(c.natureza, c.saldoInicialCentavos, antes),
        movimentos: doPeriodo.map((m) => ({
          natureza: m.natureza,
          valorCentavos: m.valorCentavos,
          historico: m.historico,
          daParteA: m.ajuste !== null,
        })),
      };
    }),
  );
  return { apuracao: ap, ajustes, contasParteB: contas, ecf, memoria: memoriaDa(ap) };
}

/** As apurações do lucro real do exercício para a ECF (sem as retificadas), com o bloco M de cada uma. */
export async function apuracoesParaEcf(
  l: Leitor,
  est: number,
  exercicio: number,
): Promise<ApuracaoLucroRealEcf[]> {
  const ids = await l.consultar(
    `SELECT id FROM apuracao_irpj_csll WHERE estabelecimento_id = ? AND YEAR(periodo_inicio) = ?
        AND situacao <> 'retificada' AND excluido_em IS NULL ORDER BY periodo_inicio LIMIT 24`,
    [est, exercicio],
  );
  const saida: ApuracaoLucroRealEcf[] = [];
  for (const r of ids) {
    const d = await detalheApuracaoLalur(l, num(r['id']));
    if (!d) continue;
    const a = d.apuracao;
    saida.push({
      inicio: a.inicio,
      fim: a.fim,
      forma: a.forma,
      fechada: a.situacao === 'fechada' || a.situacao === 'provisionada',
      lucroAntes: a.lucroAntes,
      compensacaoPrejuizo: a.compensacaoPrejuizo,
      baseIrpj: a.baseIrpj,
      baseCsll: a.baseCsll,
      irpj: a.irpj,
      adicional: a.adicional,
      deducoesIrpj: a.deducoesIrpj,
      irpjRecolher: a.irpjRecolher,
      csll: a.csll,
      deducoesCsll: a.deducoesCsll,
      csllRecolher: a.csllRecolher,
      blocoM: d.ecf.linhas,
    });
  }
  return saida;
}

function memoriaDa(ap: ReturnType<typeof apuracaoDaLinha>): string[] {
  if (ap.situacao === 'aberta') return [];
  const r = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  return [
    `Lucro antes dos tributos ${r(ap.lucroAntes)} + adições ${r(ap.totalAdicoes)} − exclusões ${r(ap.totalExclusoes)} − compensação ${r(ap.compensacaoPrejuizo)} = base do IRPJ ${r(ap.baseIrpj)}`,
    `IRPJ ${r(ap.irpj)} + adicional ${r(ap.adicional)} − deduções ${r(ap.deducoesIrpj)} = ${r(ap.irpjRecolher)} a recolher`,
    `CSLL ${r(ap.csll)} − deduções ${r(ap.deducoesCsll)} = ${r(ap.csllRecolher)} a recolher`,
  ];
}

// ---------------------------------------------------------------- gravações

const doContexto = (ctx: ContextoOperacao): number | null =>
  numOuNulo((ctx as unknown as { estabelecimento?: number | null }).estabelecimento);

async function travarApuracao(tx: TxOperacao, apuracao: number) {
  const [a] = await tx.consultarParaAtualizar(
    'SELECT * FROM apuracao_irpj_csll WHERE id = ? AND excluido_em IS NULL',
    [apuracao],
    { teto: 1 },
  );
  if (!a) throw recusa('apuracao-inexistente', 'A apuração não existe.', { campos: ['apuracao'] });
  return apuracaoDaLinha(a);
}

async function contaParteBDe(tx: TxOperacao, est: number, conta: number, ate: string): Promise<ContaParteB> {
  const c = (await contasParteB(tx, est, ate)).find((x) => x.id === conta && x.ativo);
  if (!c)
    throw recusa('conta-parte-b-inexistente', 'A conta da parte B não existe neste estabelecimento.', {
      campos: ['parteB'],
    });
  return c;
}

async function lancarParteB(
  tx: TxOperacao,
  conta: ContaParteB,
  efeito: 'constitui' | 'baixa',
  v: { periodo: string; historico: string; valorCentavos: number; tipo: string; ajuste: number | null },
) {
  const [s] = await tx.consultar(
    'SELECT COALESCE(MAX(sequencia), 0) AS n FROM movimento_lalur_parte_b WHERE saldo_lalur_parte_b_id = ?',
    [conta.id],
  );
  return tx.incluir('movimento_lalur_parte_b', {
    saldo_lalur_parte_b_id: conta.id,
    sequencia: num(s?.['n']) + 1,
    periodo_referencia: v.periodo,
    data_lancamento: v.periodo,
    historico: v.historico.slice(0, 400),
    natureza: ladoParteB(conta.natureza, efeito),
    tipo_lancamento: v.tipo,
    valor: reais(v.valorCentavos),
    ajuste_lalur_id: v.ajuste,
  });
}

async function proximaSequenciaAjuste(tx: TxOperacao, apuracao: number) {
  const [s] = await tx.consultar(
    'SELECT COALESCE(MAX(sequencia), 0) AS n FROM ajuste_lalur WHERE apuracao_irpj_csll_id = ?',
    [apuracao],
  );
  return num(s?.['n']) + 1;
}

const esquemaConfiguracao = z.object({
  estabelecimento: id,
  irpjDebito: id,
  irpjCredito: id,
  csllDebito: id,
  csllCredito: id,
  aliquotaIrpj: aliquota.default(15),
  aliquotaAdicional: aliquota.default(10),
  limiteAdicionalMensal: dinheiro.default(20000),
  aliquotaCsll: aliquota.default(9),
});
const salvarConfiguracao = definirOperacao<z.infer<typeof esquemaConfiguracao>, { configuracao: number }>({
  nome: 'contabil.lalur_configuracao_salvar',
  tabelas: ['configuracao_provisao_irpj_csll'],
  entrada: esquemaConfiguracao as never,
  async gravar(tx, e) {
    const ids = [e.irpjDebito, e.irpjCredito, e.csllDebito, e.csllCredito];
    const ok = await tx.consultar(
      `SELECT id FROM conta_contabil WHERE id IN (?, ?, ?, ?) AND excluido_em IS NULL AND ativo = TRUE AND tipo = 'analitica'`,
      ids,
    );
    if (new Set(ok.map((r) => num(r['id']))).size !== new Set(ids).size)
      throw recusa('conta-inexistente', 'As contas da provisão são analíticas e ativas.', {
        campos: ['contas'],
      });
    const valores = {
      irpj_debito_conta_contabil_id: e.irpjDebito,
      irpj_credito_conta_contabil_id: e.irpjCredito,
      csll_debito_conta_contabil_id: e.csllDebito,
      csll_credito_conta_contabil_id: e.csllCredito,
      aliquota_irpj: e.aliquotaIrpj,
      aliquota_adicional_irpj: e.aliquotaAdicional,
      limite_adicional_irpj_mensal: e.limiteAdicionalMensal,
      aliquota_csll: e.aliquotaCsll,
      ativo: true,
    };
    const [atual] = await tx.consultarParaAtualizar(
      'SELECT id, versao FROM configuracao_provisao_irpj_csll WHERE estabelecimento_id = ?',
      [e.estabelecimento],
      { teto: 1 },
    );
    if (atual) {
      await tx.alterar('configuracao_provisao_irpj_csll', num(atual['id']), num(atual['versao']), valores);
      return { configuracao: num(atual['id']) };
    }
    return {
      configuracao: await tx.incluir('configuracao_provisao_irpj_csll', {
        ...valores,
        estabelecimento_id: e.estabelecimento,
      }),
    };
  },
  alvo: (_e, r) => ({ tabela: 'configuracao_provisao_irpj_csll', id: r.configuracao }),
});

const esquemaContaB = z.object({
  estabelecimento: id,
  codigo: z.string().trim().min(1).max(30),
  descricao: z.string().trim().min(1).max(150),
  tributo: z.enum(['irpj', 'csll', 'ambos']),
  natureza: z.enum(['devedor', 'credor']),
  saldoInicial: dinheiro.default(0),
  dataSaldoInicial: data,
  dataLimite: data.nullable().default(null),
  historico: z.string().trim().max(300).nullable().default(null),
});
const incluirContaParteB = definirOperacao<z.infer<typeof esquemaContaB>, { conta: number }>({
  nome: 'contabil.lalur_conta_parte_b_incluir',
  tabelas: ['saldo_lalur_parte_b'],
  entrada: esquemaContaB as never,
  async gravar(tx, e) {
    const [existe] = await tx.consultar(
      'SELECT id FROM saldo_lalur_parte_b WHERE estabelecimento_id = ? AND codigo = ?',
      [e.estabelecimento, e.codigo],
    );
    if (existe)
      throw recusa('conta-parte-b-repetida', `Já existe a conta ${e.codigo} na parte B.`, {
        campos: ['codigo'],
      });
    if (e.dataLimite && e.dataLimite < e.dataSaldoInicial)
      throw recusa('data-limite-invalida', 'A data limite não vem antes do saldo inicial.', {
        campos: ['dataLimite'],
      });
    return {
      conta: await tx.incluir('saldo_lalur_parte_b', {
        estabelecimento_id: e.estabelecimento,
        codigo: e.codigo,
        descricao: e.descricao,
        tributo_apurado: e.tributo,
        natureza_saldo: e.natureza,
        saldo_inicial: e.saldoInicial,
        data_saldo_inicial: e.dataSaldoInicial,
        data_limite: e.dataLimite,
        historico: e.historico,
        ativo: true,
      }),
    };
  },
  alvo: (_e, r) => ({ tabela: 'saldo_lalur_parte_b', id: r.conta }),
});

const esquemaAbrir = z.object({
  estabelecimento: id,
  forma: z.string(),
  inicio: data,
  fim: data,
});
const abrirApuracao = definirOperacao<z.infer<typeof esquemaAbrir>, { apuracao: number }>({
  nome: 'contabil.lalur_apuracao_abrir',
  tabelas: ['apuracao_irpj_csll'],
  entrada: esquemaAbrir as never,
  async gravar(tx, e, ctx) {
    falhar(conferirPeriodoApuracao(e.forma, e.inicio, e.fim));
    const [existe] = await tx.consultar(
      'SELECT id FROM apuracao_irpj_csll WHERE estabelecimento_id = ? AND forma_apuracao = ? AND periodo_inicio = ? AND excluido_em IS NULL',
      [e.estabelecimento, e.forma, e.inicio],
    );
    if (existe)
      throw recusa('apuracao-repetida', 'Já existe a apuração deste período.', { campos: ['inicio'] });
    const c = await configuracao(tx, e.estabelecimento);
    return {
      apuracao: await tx.incluir('apuracao_irpj_csll', {
        estabelecimento_id: e.estabelecimento,
        periodo_inicio: e.inicio,
        periodo_fim: e.fim,
        forma_apuracao: e.forma,
        aliquota_irpj: c?.aliquotaIrpj ?? 15,
        aliquota_adicional_irpj: c?.aliquotaAdicional ?? 10,
        aliquota_csll: c?.aliquotaCsll ?? 9,
        situacao: 'aberta',
        responsavel_usuario_id: ctx.usuario,
      }),
    };
  },
  alvo: (_e, r) => ({ tabela: 'apuracao_irpj_csll', id: r.apuracao }),
});

const esquemaAjuste = z.object({
  apuracao: id,
  tipo: z.string(),
  descricao: z.string().trim().max(500),
  data,
  valor: z.number().finite(),
  irpj: z.boolean().default(true),
  csll: z.boolean().default(true),
  codigoTabelaDinamica: z.string().trim().max(10).nullable().default(null),
  fundamentoLegal: z.string().trim().max(500).nullable().default(null),
  indicadorProcesso: z.enum(['judicial', 'administrativo']).nullable().default(null),
  numeroProcesso: z.string().trim().max(30).nullable().default(null),
  parteB: z
    .object({ conta: id, efeito: z.enum(['constitui', 'baixa']) })
    .nullable()
    .default(null),
});
const incluirAjuste = definirOperacao<
  z.infer<typeof esquemaAjuste>,
  { ajuste: number; movimento: number | null }
>({
  nome: 'contabil.lalur_ajuste_incluir',
  tabelas: ['apuracao_irpj_csll', 'ajuste_lalur', 'movimento_lalur_parte_b', 'saldo_lalur_parte_b'],
  entrada: esquemaAjuste as never,
  async gravar(tx, e) {
    const ap = await travarApuracao(tx, e.apuracao);
    falhar(conferirAcaoApuracao(ap.situacao, 'ajustar'));
    const valorCentavos = Math.round(e.valor * 100);
    falhar(
      conferirAjusteLalur(
        {
          tipo: e.tipo,
          descricao: e.descricao,
          data: e.data,
          valorCentavos,
          irpj: e.irpj,
          csll: e.csll,
          indicadorProcesso: e.indicadorProcesso,
          numeroProcesso: e.numeroProcesso,
          parteB: e.parteB,
        },
        ap,
      ),
    );
    const conta = e.parteB ? await contaParteBDe(tx, ap.estabelecimento, e.parteB.conta, ap.fim) : null;
    if (conta && e.parteB) falhar(conferirLancamentoParteB(conta, e.parteB.efeito, valorCentavos, e));
    const ajuste = await tx.incluir('ajuste_lalur', {
      apuracao_irpj_csll_id: ap.id,
      sequencia: await proximaSequenciaAjuste(tx, ap.id),
      tipo: e.tipo,
      codigo_tabela_dinamica: e.codigoTabelaDinamica,
      data_lancamento: e.data,
      descricao: e.descricao,
      fundamento_legal: e.fundamentoLegal,
      valor: reais(valorCentavos),
      afeta_irpj: e.irpj,
      afeta_csll: e.csll,
      indicador_processo: e.indicadorProcesso,
      numero_processo: e.numeroProcesso,
      controla_parte_b: conta !== null,
    });
    const movimento =
      conta && e.parteB
        ? await lancarParteB(tx, conta, e.parteB.efeito, {
            periodo: ap.fim,
            historico: e.descricao,
            valorCentavos,
            tipo: 'ajuste_parte_a',
            ajuste,
          })
        : null;
    // A apuração calculada volta a aberta: o ajuste muda a base.
    if (ap.situacao === 'apurada')
      await tx.alterar('apuracao_irpj_csll', ap.id, ap.versao, { situacao: 'aberta' });
    return { ajuste, movimento };
  },
  alvo: (_e, r) => ({ tabela: 'ajuste_lalur', id: r.ajuste }),
});

const esquemaExcluirAjuste = z.object({ apuracao: id, ajuste: id, versao: z.number().int().positive() });
const excluirAjuste = definirOperacao<
  z.infer<typeof esquemaExcluirAjuste>,
  { ajuste: number; movimentos: number }
>({
  nome: 'contabil.lalur_ajuste_excluir',
  tabelas: ['apuracao_irpj_csll', 'ajuste_lalur', 'movimento_lalur_parte_b'],
  entrada: esquemaExcluirAjuste as never,
  async gravar(tx, e) {
    const ap = await travarApuracao(tx, e.apuracao);
    falhar(conferirAcaoApuracao(ap.situacao, 'ajustar'));
    const [a] = await tx.consultar(
      'SELECT tipo FROM ajuste_lalur WHERE id = ? AND apuracao_irpj_csll_id = ? AND excluido_em IS NULL',
      [e.ajuste, ap.id],
    );
    if (!a) throw recusa('ajuste-inexistente', 'O ajuste não existe nesta apuração.', { campos: ['ajuste'] });
    if (txt(a['tipo']) === 'compensacao_prejuizo')
      throw recusa('ajuste-da-apuracao', 'A compensação sai da apuração: apure de novo para mudá-la.', {
        campos: ['ajuste'],
      });
    const movs = await tx.consultar(
      'SELECT id, versao FROM movimento_lalur_parte_b WHERE ajuste_lalur_id = ? AND excluido_em IS NULL',
      [e.ajuste],
    );
    for (const m of movs) await tx.excluir('movimento_lalur_parte_b', num(m['id']), num(m['versao']));
    await tx.excluir('ajuste_lalur', e.ajuste, e.versao);
    if (ap.situacao === 'apurada')
      await tx.alterar('apuracao_irpj_csll', ap.id, ap.versao, { situacao: 'aberta' });
    return { ajuste: e.ajuste, movimentos: movs.length };
  },
  alvo: (e) => ({ tabela: 'ajuste_lalur', id: e.ajuste }),
});

const esquemaApurar = z.object({
  apuracao: id,
  versao: z.number().int().positive(),
  contaPrejuizo: id.nullable().default(null),
  contaBaseNegativa: id.nullable().default(null),
  deducoesIrpj: dinheiro.default(0),
  deducoesCsll: dinheiro.default(0),
});
const apurar = definirOperacao<z.infer<typeof esquemaApurar>, ResultadoOperacao>({
  nome: 'contabil.lalur_apurar',
  tabelas: ['apuracao_irpj_csll', 'ajuste_lalur', 'movimento_lalur_parte_b', 'saldo_lalur_parte_b'],
  entrada: esquemaApurar as never,
  async gravar(tx, e) {
    const ap = await travarApuracao(tx, e.apuracao);
    falhar(conferirAcaoApuracao(ap.situacao, 'apurar'));
    const cfg = await configuracao(tx, ap.estabelecimento);
    // A compensação anterior desta apuração sai antes de calcular (o saldo volta e a nova a substitui).
    for (const a of (await ajustesDa(tx, ap.id)).filter((x) => x.tipo === 'compensacao_prejuizo')) {
      for (const m of await tx.consultar(
        'SELECT id, versao FROM movimento_lalur_parte_b WHERE ajuste_lalur_id = ? AND excluido_em IS NULL',
        [a.id],
      ))
        await tx.excluir('movimento_lalur_parte_b', num(m['id']), num(m['versao']));
      await tx.excluir('ajuste_lalur', a.id, a.versao);
    }
    const prejuizo = e.contaPrejuizo
      ? await contaParteBDe(tx, ap.estabelecimento, e.contaPrejuizo, ap.fim)
      : null;
    const baseNeg = e.contaBaseNegativa
      ? await contaParteBDe(tx, ap.estabelecimento, e.contaBaseNegativa, ap.fim)
      : null;
    if (prejuizo?.tributo === 'csll')
      throw recusa('tributo-da-conta', 'O prejuízo fiscal fica numa conta da parte B do IRPJ.', {
        campos: ['contaPrejuizo'],
      });
    if (baseNeg?.tributo === 'irpj')
      throw recusa('tributo-da-conta', 'A base negativa fica numa conta da parte B da CSLL.', {
        campos: ['contaBaseNegativa'],
      });
    const manuais = (await ajustesDa(tx, ap.id)).filter(
      (x): x is typeof x & { tipo: 'adicao' | 'exclusao' } => x.tipo !== 'compensacao_prejuizo',
    );
    const lucroAntes = await lucroAntesDosTributos(
      tx,
      ap.estabelecimento,
      ap.inicio,
      ap.fim,
      cfg ? [cfg.irpjDebito, cfg.csllDebito] : [],
    );
    const r = apurarLucroReal({
      forma: ap.forma,
      inicio: ap.inicio,
      fim: ap.fim,
      lucroAntesCentavos: lucroAntes,
      ajustes: manuais,
      saldoPrejuizoCentavos: prejuizo?.saldoCentavos ?? null,
      saldoBaseNegativaCentavos: baseNeg?.saldoCentavos ?? null,
      aliquotaIrpj: cfg?.aliquotaIrpj ?? 15,
      aliquotaAdicional: cfg?.aliquotaAdicional ?? 10,
      limiteAdicionalMensalCentavos: Math.round((cfg?.limiteAdicionalMensal ?? 20000) * 100),
      aliquotaCsll: cfg?.aliquotaCsll ?? 9,
      deducoesIrpjCentavos: Math.round(e.deducoesIrpj * 100),
      deducoesCsllCentavos: Math.round(e.deducoesCsll * 100),
    });
    let seq = await proximaSequenciaAjuste(tx, ap.id);
    for (const [conta, valor, irpj, descricao] of [
      [prejuizo, r.compensacaoPrejuizo, true, 'Compensação de prejuízo fiscal (limite de 30%)'],
      [baseNeg, r.compensacaoBaseNegativa, false, 'Compensação de base negativa da CSLL (limite de 30%)'],
    ] as const) {
      if (!conta || valor <= 0) continue;
      const ajuste = await tx.incluir('ajuste_lalur', {
        apuracao_irpj_csll_id: ap.id,
        sequencia: seq++,
        tipo: 'compensacao_prejuizo',
        data_lancamento: ap.fim,
        descricao,
        fundamento_legal: 'Lei 9.065/1995, arts. 15 e 16',
        valor: reais(valor),
        afeta_irpj: irpj,
        afeta_csll: !irpj,
        controla_parte_b: true,
      });
      await lancarParteB(tx, conta, 'baixa', {
        periodo: ap.fim,
        historico: descricao,
        valorCentavos: valor,
        tipo: 'compensacao_prejuizo',
        ajuste,
      });
    }
    await tx.alterar('apuracao_irpj_csll', ap.id, e.versao, {
      lucro_antes_tributos: reais(lucroAntes),
      total_adicoes: reais(r.adicoesIrpj),
      total_exclusoes: reais(r.exclusoesIrpj),
      compensacao_prejuizo: reais(r.compensacaoPrejuizo),
      base_irpj: reais(r.baseIrpj),
      base_csll: reais(r.baseCsll),
      limite_adicional: reais(r.limiteAdicional),
      valor_irpj: reais(r.irpj),
      valor_adicional_irpj: reais(r.adicional),
      valor_csll: reais(r.csll),
      deducoes_irpj: e.deducoesIrpj,
      deducoes_csll: e.deducoesCsll,
      valor_irpj_recolher: reais(r.irpjRecolher),
      valor_csll_recolher: reais(r.csllRecolher),
      situacao: 'apurada',
    });
    return {
      apuracao: ap.id,
      lucroAntes,
      baseIrpj: r.baseIrpj,
      baseCsll: r.baseCsll,
      compensacaoPrejuizo: r.compensacaoPrejuizo,
      compensacaoBaseNegativa: r.compensacaoBaseNegativa,
      irpjRecolher: r.irpjRecolher,
      csllRecolher: r.csllRecolher,
      // A memória completa sai no detalhe da apuração; o resultado da operação só leva valores simples.
      memoria: r.memoria.join('\n'),
    };
  },
  alvo: (e) => ({ tabela: 'apuracao_irpj_csll', id: e.apuracao }),
});

const esquemaVersao = z.object({ apuracao: id, versao: z.number().int().positive() });
const provisionar = definirOperacao<
  z.infer<typeof esquemaVersao>,
  { apuracao: number; lancamento: number | null }
>({
  nome: 'contabil.lalur_provisionar',
  tabelas: ['apuracao_irpj_csll', 'configuracao_provisao_irpj_csll', ...TABELAS_CONTABILIZACAO],
  entrada: esquemaVersao as never,
  async gravar(tx, e, ctx) {
    const ap = await travarApuracao(tx, e.apuracao);
    falhar(conferirAcaoApuracao(ap.situacao, 'provisionar'));
    const est = doContexto(ctx);
    if (est !== null && est !== ap.estabelecimento)
      throw recusa('outro-estabelecimento', 'Provisione a partir do estabelecimento da apuração.', {
        campos: ['apuracao'],
      });
    const cfg = await configuracao(tx, ap.estabelecimento);
    if (!cfg)
      throw recusa(
        'sem-configuracao',
        'Configure as contas da provisão do IRPJ e da CSLL antes de provisionar.',
        {
          campos: ['configuracao'],
        },
      );
    const rotulo = `${ap.inicio.slice(0, 7)} a ${ap.fim.slice(0, 7)}`;
    const partidas = partidasProvisaoIrpjCsll(
      cfg.classificacoes,
      { irpjCentavos: ap.irpjRecolher, csllCentavos: ap.csllRecolher },
      rotulo,
    );
    let lancamento: number | null = null;
    if (partidas.length) {
      const g = gravacaoDosFatos(tx, ap.estabelecimento);
      lancamento = (
        await g.gravarLancamento({
          chave: `provisao-irpj-csll:${ap.id}:${ap.versao}`,
          tipo: 'automatico',
          empresa: ap.estabelecimento,
          data: ap.fim,
          competencia: ap.fim.slice(0, 7),
          historico: `Provisão do IRPJ e da CSLL do lucro real ${rotulo}`,
          partidas,
          fatoId: null,
          regraId: null,
          regra: null,
          estornaId: null,
          justificativa: null,
        })
      ).id;
    }
    await tx.alterar('apuracao_irpj_csll', ap.id, e.versao, {
      situacao: 'provisionada',
      provisao_lancamento_contabil_id: lancamento,
    });
    return { apuracao: ap.id, lancamento };
  },
  alvo: (e) => ({ tabela: 'apuracao_irpj_csll', id: e.apuracao }),
});

const esquemaFechar = esquemaVersao.extend({
  contaPrejuizo: id.nullable().default(null),
  contaBaseNegativa: id.nullable().default(null),
});
const fechar = definirOperacao<z.infer<typeof esquemaFechar>, ResultadoOperacao>({
  nome: 'contabil.lalur_fechar',
  tabelas: ['apuracao_irpj_csll', 'ajuste_lalur', 'movimento_lalur_parte_b', 'saldo_lalur_parte_b'],
  entrada: esquemaFechar as never,
  async gravar(tx, e, ctx) {
    const ap = await travarApuracao(tx, e.apuracao);
    falhar(conferirAcaoApuracao(ap.situacao, 'fechar', ap.irpjRecolher + ap.csllRecolher));
    // O prejuízo fiscal e a base negativa do período entram na parte B para compensar nos períodos seguintes.
    const manuais = (await ajustesDa(tx, ap.id)).filter((x) => x.tipo !== 'compensacao_prejuizo');
    const soma = (t: string, trib: 'irpj' | 'csll') =>
      manuais.filter((x) => x.tipo === t && x[trib]).reduce((s, x) => s + x.valorCentavos, 0);
    const prejuizo = Math.max(0, -(ap.lucroAntes + soma('adicao', 'irpj') - soma('exclusao', 'irpj')));
    const baseNegativa = Math.max(0, -(ap.lucroAntes + soma('adicao', 'csll') - soma('exclusao', 'csll')));
    const constituidos: string[] = [];
    for (const [conta, valor, campo, texto] of [
      [e.contaPrejuizo, prejuizo, 'contaPrejuizo', 'Prejuízo fiscal do período'],
      [e.contaBaseNegativa, baseNegativa, 'contaBaseNegativa', 'Base negativa da CSLL do período'],
    ] as const) {
      if (valor <= 0) continue;
      if (!conta)
        throw recusa('sem-conta-parte-b', `${texto}: escolha a conta da parte B que o controla.`, {
          campos: [campo],
        });
      const c = await contaParteBDe(tx, ap.estabelecimento, conta, ap.fim);
      await lancarParteB(tx, c, 'constitui', {
        periodo: ap.fim,
        historico: `${texto} ${ap.inicio.slice(0, 7)} a ${ap.fim.slice(0, 7)}`,
        valorCentavos: valor,
        tipo: 'manual',
        ajuste: null,
      });
      constituidos.push(c.codigo);
    }
    await tx.alterar('apuracao_irpj_csll', ap.id, e.versao, {
      situacao: 'fechada',
      fechado_em: new Date(),
      responsavel_usuario_id: ctx.usuario,
    });
    return { apuracao: ap.id, prejuizo, baseNegativa, constituidos: constituidos.join(',') };
  },
  alvo: (e) => ({ tabela: 'apuracao_irpj_csll', id: e.apuracao }),
});

export const OPERACOES_LALUR = {
  salvarConfiguracao,
  incluirContaParteB,
  abrirApuracao,
  incluirAjuste,
  excluirAjuste,
  apurar,
  provisionar,
  fechar,
} as const;
