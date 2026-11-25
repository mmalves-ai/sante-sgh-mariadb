// Regras do acordo com a fonte pagadora aplicadas ao item lançado na conta (06-FAT linha 1, passo 3). Lê, na mesma
// transação do lançamento, as regras vigentes na data do item (percentual por componente, desconto por grupo de
// despesa, via de acesso da fonte e padrão, isento, teto e alto custo) do acordo da fonte da conta vigente nessa data,
// e o que já foi cobrado para o teto; o cálculo é do
// domínio (@sgh/dominio-preco aplicarRegrasAcordo). Só vale para o item valorizado pela tabela do convênio: o preço
// manual aprovado e a regra do particular não passam pelo acordo.
import {
  aplicarRegrasAcordo,
  type ItemParaAcordo,
  regimesDoAtendimento,
  type RegrasVigentesCalc,
  type ResultadoAcordo,
} from '@sgh/dominio-preco';
import { recusa, type TxOperacao } from '@sgh/nucleo';
import { criticarCoberturaDoItemConta } from './cobertura-item-conta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const id = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const sim = (v: unknown) => v === true || v === 1 || v === '1';

/** Tabelas que a aplicação lê (o gerador de privilégios resolve pelos literais abaixo). */
export const TABELAS_ACORDO_CONTA = [
  'regra_percentual_cobranca',
  'regra_desconto_grupo',
  'regra_via_acesso',
  'item_isento_cobranca',
  'teto_cobranca',
  'item_alto_custo_contrato',
  'contrato_fonte_pagadora',
  'regime_atendimento',
  'carater_atendimento_tiss',
  'conta_hospitalar',
  'conta_hospitalar_item',
  'conta_hospitalar_item_memoria',
] as const;

const VIGENTE = (a: string) =>
  `${a}.vigencia_inicio <= ? AND (${a}.vigencia_fim IS NULL OR ${a}.vigencia_fim >= ?)`;
const DO_ESTAB = (a: string) => `(${a}.estabelecimento_id IS NULL OR ${a}.estabelecimento_id = ?)`;

export interface ContaParaAcordo {
  readonly id: number;
  readonly fonte: number;
  readonly plano: number | null;
}

export interface ItemLancadoParaAcordo {
  readonly item: number;
  readonly grupo: number | null;
  readonly tabela: number | null;
  readonly funcaoEquipe: number | null;
  readonly quantidade: number;
  readonly honorario: number;
  readonly custoOperacional: number;
  readonly filme: number;
  /** Data do item (AAAA-MM-DD): a vigência das regras é a desta data. */
  readonly data: string;
  /** Via de acesso cirúrgico e ordem do procedimento no mesmo ato (1 = principal); nula fora da cirurgia múltipla. */
  readonly via: { readonly acesso: number; readonly ordem: number } | null;
}

/** As regras vigentes do acordo da fonte da conta na data do item, já no formato do cálculo. */
export async function regrasVigentesDaConta(
  tx: TxOperacao,
  est: number,
  fonte: number,
  data: string,
): Promise<RegrasVigentesCalc> {
  // O acordo da fonte vigente na data do item (o mais recente, se dois se sobrepõem): desconto por grupo e alto custo
  // são do acordo, e a regra de um acordo velho não vale no novo.
  const acordo = await tx.uma<Linha>(
    `SELECT k.id FROM contrato_fonte_pagadora k
      WHERE k.fonte_pagadora_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL
        AND k.situacao IN ('vigente', 'encerrado') AND ${VIGENTE('k')}
      ORDER BY k.vigencia_inicio DESC, k.id DESC LIMIT 1`,
    [fonte, est, data, data],
  );
  const contrato = acordo ? n(acordo['id']) : 0;
  const percentuais = await tx.consultar<Linha>(
    `SELECT r.id, r.tabela_preco_id, r.componente, r.tipo_paciente, r.plano_fonte_pagadora_id, r.grupo_faturamento_id,
            r.item_faturavel_id, r.funcao_equipe_cobranca_id, r.tipo_conta_id, r.percentual, r.valor_fixo
       FROM regra_percentual_cobranca r
      WHERE r.fonte_pagadora_id = ? AND ${DO_ESTAB('r')} AND r.ativo = 1 AND ${VIGENTE('r')}`,
    [fonte, est, data, data],
  );
  const descontos = await tx.consultar<Linha>(
    `SELECT r.* FROM regra_desconto_grupo r WHERE r.contrato_fonte_pagadora_id = ? AND ${VIGENTE('r')}`,
    [contrato, data, data],
  );
  // A via de acesso da fonte e a padrão (fonte nula); a regra só de um tipo de lançamento não entra no item avulso.
  const vias = await tx.consultar<Linha>(
    `SELECT r.id, r.fonte_pagadora_id, r.via_acesso_cirurgico_id, r.item_faturavel_id, r.ordem_procedimento,
            r.percentual
       FROM regra_via_acesso r
      WHERE (r.fonte_pagadora_id = ? OR r.fonte_pagadora_id IS NULL) AND ${DO_ESTAB('r')} AND r.ativo = 1
        AND r.tipo_lancamento_id IS NULL AND ${VIGENTE('r')}`,
    [fonte, est, data, data],
  );
  const isentos = await tx.consultar<Linha>(
    `SELECT r.id, r.item_faturavel_id, r.grupo_faturamento_id, r.plano_fonte_pagadora_id, r.regime_atendimento_id,
            r.motivo
       FROM item_isento_cobranca r
      WHERE r.fonte_pagadora_id = ? AND ${DO_ESTAB('r')} AND ${VIGENTE('r')}`,
    [fonte, est, data, data],
  );
  const tetos = await tx.consultar<Linha>(
    `SELECT r.id, r.abrangencia, r.item_faturavel_id, r.grupo_faturamento_id, r.plano_fonte_pagadora_id, r.valor_teto,
            r.quantidade_maxima, r.ocorrencias_maximas, r.acao, r.excedente_fonte_pagadora_id,
            r.excedente_plano_fonte_pagadora_id
       FROM teto_cobranca r
      WHERE r.fonte_pagadora_id = ? AND ${DO_ESTAB('r')} AND r.ativo = 1 AND ${VIGENTE('r')}`,
    [fonte, est, data, data],
  );
  const altoCusto = await tx.consultar<Linha>(
    `SELECT r.id, r.item_faturavel_id, r.grupo_faturamento_id, r.plano_fonte_pagadora_id, r.regra, r.valor_negociado
       FROM item_alto_custo_contrato r
      WHERE r.contrato_fonte_pagadora_id = ? AND r.ativo = 1 AND ${VIGENTE('r')}`,
    [contrato, data, data],
  );
  return {
    percentuais: percentuais.map((r) => ({
      id: n(r['id']),
      tabela: id(r['tabela_preco_id']),
      componente: String(r['componente']),
      tipoPaciente: String(r['tipo_paciente']),
      plano: id(r['plano_fonte_pagadora_id']),
      grupo: id(r['grupo_faturamento_id']),
      item: id(r['item_faturavel_id']),
      funcaoEquipe: id(r['funcao_equipe_cobranca_id']),
      tipoConta: id(r['tipo_conta_id']),
      percentual: num(r['percentual']),
      valorFixo: num(r['valor_fixo']),
    })),
    descontos: descontos.map((r) => ({
      id: n(r['id']),
      grupo: n(r['grupo_faturamento_id']),
      subgrupo: id(r['subgrupo_faturamento_id']),
      acrescimo: n(r['percentual_acrescimo']),
      desconto: n(r['percentual_desconto']),
      sobre: (
        [
          ['sobre_honorario', 'honorario'],
          ['sobre_custo_operacional', 'custo_operacional'],
          ['sobre_filme', 'filme'],
        ] as const
      )
        .filter(([c]) => sim(r[c]))
        .map(([, x]) => x),
      regimes: (
        [
          ['aplica_ambulatorial', 'ambulatorial'],
          ['aplica_externo', 'externo'],
          ['aplica_internacao', 'internacao'],
          ['aplica_urgencia', 'urgencia'],
          ['aplica_domiciliar', 'domiciliar'],
        ] as const
      )
        .filter(([c]) => sim(r[c]))
        .map(([, x]) => x),
    })),
    vias: vias.map((r) => ({
      id: n(r['id']),
      via: n(r['via_acesso_cirurgico_id']),
      ordem: n(r['ordem_procedimento']),
      percentual: n(r['percentual']),
      item: id(r['item_faturavel_id']),
      padraoDeTodas: r['fonte_pagadora_id'] === null || r['fonte_pagadora_id'] === undefined,
    })),
    isentos: isentos.map((r) => ({
      id: n(r['id']),
      item: id(r['item_faturavel_id']),
      grupo: id(r['grupo_faturamento_id']),
      plano: id(r['plano_fonte_pagadora_id']),
      regime: id(r['regime_atendimento_id']),
      motivo: String(r['motivo'] ?? ''),
    })),
    tetos: tetos.map((r) => ({
      id: n(r['id']),
      abrangencia: String(r['abrangencia']),
      item: id(r['item_faturavel_id']),
      grupo: id(r['grupo_faturamento_id']),
      plano: id(r['plano_fonte_pagadora_id']),
      valorTeto: num(r['valor_teto']),
      quantidadeMaxima: num(r['quantidade_maxima']),
      ocorrenciasMaximas: num(r['ocorrencias_maximas']),
      acao: String(r['acao']),
      excedenteFonte: id(r['excedente_fonte_pagadora_id']),
      excedentePlano: id(r['excedente_plano_fonte_pagadora_id']),
    })),
    altoCusto: altoCusto.map((r) => ({
      id: n(r['id']),
      item: id(r['item_faturavel_id']),
      grupo: id(r['grupo_faturamento_id']),
      plano: id(r['plano_fonte_pagadora_id']),
      regra: String(r['regra']),
      valorNegociado: num(r['valor_negociado']),
    })),
  };
}

async function jaCobrado(tx: TxOperacao, conta: number, item: number, grupo: number | null) {
  const r = await tx.uma<Linha>(
    `SELECT COALESCE(SUM(CASE WHEN i.item_faturavel_id = ? THEN i.valor_total END), 0) AS v_item,
            COALESCE(SUM(CASE WHEN i.item_faturavel_id = ? THEN i.quantidade END), 0) AS q_item,
            COALESCE(SUM(i.item_faturavel_id = ?), 0) AS o_item,
            COALESCE(SUM(CASE WHEN i.grupo_faturamento_id = ? THEN i.valor_total END), 0) AS v_grupo,
            COALESCE(SUM(CASE WHEN i.grupo_faturamento_id = ? THEN i.quantidade END), 0) AS q_grupo,
            COALESCE(SUM(i.grupo_faturamento_id = ?), 0) AS o_grupo,
            COALESCE(SUM(i.valor_total), 0) AS v_conta, COALESCE(SUM(i.quantidade), 0) AS q_conta, COUNT(*) AS o_conta
       FROM conta_hospitalar_item i
      WHERE i.conta_hospitalar_id = ? AND i.situacao NOT IN ('estornado', 'transferido', 'sem_cobranca')`,
    [item, item, item, grupo, grupo, grupo, conta],
  );
  const de = (k: string) => ({
    valor: n(r?.[`v_${k}`]),
    quantidade: n(r?.[`q_${k}`]),
    ocorrencias: n(r?.[`o_${k}`]),
  });
  return { item: de('item'), grupo: de('grupo'), conta: de('conta') };
}

/** Aplica o acordo ao item que vai ser lançado (sem gravar: a operação grava o item e a memória com o resultado). */
export async function aplicarAcordoNoItem(
  tx: TxOperacao,
  est: number,
  conta: ContaParaAcordo,
  i: ItemLancadoParaAcordo,
): Promise<ResultadoAcordo> {
  const ctx = await tx.uma<Linha>(
    `SELECT c.tipo_conta_id, a.regime_atendimento_id, ra.codigo_tiss AS regime, ct.urgencia
       FROM conta_hospitalar c
       JOIN atendimento a ON a.id = c.atendimento_id
       LEFT JOIN regime_atendimento ra ON ra.id = a.regime_atendimento_id
       LEFT JOIN carater_atendimento_tiss ct ON ct.id = a.carater_atendimento_tiss_id
      WHERE c.id = ?`,
    [conta.id],
  );
  const sub = await tx.uma<Linha>('SELECT subgrupo_faturamento_id FROM item_faturavel WHERE id = ?', [
    i.item,
  ]);
  // O regime pelo código oficial (nunca pela descrição); código sem mapeamento volta como alerta do acordo.
  const regime = regimesDoAtendimento(
    ctx?.['regime'] === null || ctx?.['regime'] === undefined ? null : String(ctx['regime']),
    sim(ctx?.['urgencia']),
  );
  const entrada: ItemParaAcordo = {
    item: i.item,
    grupo: i.grupo,
    subgrupo: id(sub?.['subgrupo_faturamento_id']),
    plano: conta.plano,
    tabela: i.tabela,
    regimeId: id(ctx?.['regime_atendimento_id']),
    regimes: regime.regimes,
    funcaoEquipe: i.funcaoEquipe,
    tipoConta: id(ctx?.['tipo_conta_id']),
    quantidade: i.quantidade,
    honorario: i.honorario,
    custoOperacional: i.custoOperacional,
    filme: i.filme,
    via: i.via?.acesso ?? null,
    ordemNoAto: i.via?.ordem ?? null,
    jaCobrado: await jaCobrado(tx, conta.id, i.item, i.grupo),
  };
  const r = aplicarRegrasAcordo(entrada, await regrasVigentesDaConta(tx, est, conta.fonte, i.data));
  return regime.alerta ? { ...r, alertas: [...r.alertas, regime.alerta] } : r;
}

export interface ExcedenteLancado {
  readonly conta: number;
  readonly versao: number;
  readonly item: number;
  readonly valor: number;
}

/**
 * O excedente do teto que transfere vai, na mesma transação, para a conta aberta do mesmo atendimento na fonte (ou no
 * plano) de destino: um item do mesmo procedimento com o valor que passou do teto, nas mesmas parcelas proporcionais,
 * com a memória ligando os dois lados. Sem essa conta aberta, o lançamento é recusado (o valor nunca some): abre-se a
 * conta da fonte do excedente e lança-se de novo. O total da conta de destino é refeito por quem chama.
 */
export async function lancarExcedenteNoDestino(
  tx: TxOperacao,
  est: number,
  origem: { readonly conta: number; readonly fonte: number; readonly item: number },
  excedente: { readonly valor: number; readonly fonte: number | null; readonly plano: number | null },
  lancado: {
    readonly itemFaturavel: number;
    readonly grupo: number | null;
    readonly realizado: Date;
    readonly honorario: number;
    readonly custoOperacional: number;
    readonly filme: number;
    readonly executante: number | null;
    readonly funcao: number | null;
  },
  usuario: number | null,
): Promise<ExcedenteLancado> {
  const fonte = excedente.fonte ?? origem.fonte;
  const [destino] = await tx.consultarParaAtualizar<Linha>(
    `SELECT d.id, d.versao FROM conta_hospitalar d
       JOIN conta_hospitalar o ON o.id = ? AND o.atendimento_id = d.atendimento_id
      WHERE d.estabelecimento_id = ? AND d.fonte_pagadora_id = ? AND d.id <> o.id AND d.excluido_em IS NULL
        AND d.situacao = 'aberta' AND (? IS NULL OR d.plano_fonte_pagadora_id = ?)
      ORDER BY d.id LIMIT 1`,
    [origem.conta, est, fonte, excedente.plano, excedente.plano],
  );
  if (!destino)
    throw recusa(
      'excedente-sem-conta-destino',
      'O teto do acordo transfere o excedente para outra fonte, mas o atendimento não tem conta aberta nela: abra a conta da fonte do excedente e lance de novo.',
      { campos: ['codigo'] },
    );
  const contaDestino = n(destino['id']);
  // As parcelas do excedente na proporção das parcelas do item que ficou no limite (o centavo da sobra no custo).
  const base = lancado.honorario + lancado.custoOperacional + lancado.filme;
  const parte = (v: number) => (base > 0 ? Math.round(((v * excedente.valor) / base) * 100) / 100 : 0);
  const honorario = parte(lancado.honorario);
  const filme = parte(lancado.filme);
  const custo = Math.round((excedente.valor - honorario - filme) * 100) / 100;
  const seq = await tx.uma<Linha>(
    'SELECT COALESCE(MAX(sequencia), 0) + 1 AS proxima FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
    [contaDestino],
  );
  // F7 (09-AREA linha 76): a cobertura da fonte pagadora antes de incluir o item (o bloqueio recusa).
  await criticarCoberturaDoItemConta(tx, est, {
    conta: contaDestino,
    item: lancado.itemFaturavel,
    realizado: lancado.realizado,
    quantidade: 1,
    valorTotal: excedente.valor,
    profissional: lancado.executante,
  });
  const item = await tx.incluir('conta_hospitalar_item', {
    conta_hospitalar_id: contaDestino,
    sequencia: n(seq?.['proxima']),
    item_faturavel_id: lancado.itemFaturavel,
    grupo_faturamento_id: lancado.grupo,
    setor_funcional_id: null,
    realizado_em: lancado.realizado,
    quantidade: 1,
    valor_unitario: excedente.valor,
    valor_honorario: honorario,
    valor_custo_operacional: custo,
    valor_filme: filme,
    valor_total: excedente.valor,
    tipo_valorizacao: 'tabela',
    executante_profissional_id: lancado.executante,
    funcao_equipe_cobranca_id: lancado.funcao,
    situacao: 'lancado',
    observacao: 'Excedente do teto do acordo transferido de outra conta do atendimento.',
  });
  await tx.incluir('conta_hospitalar_item_memoria', {
    conta_hospitalar_item_id: item,
    tabela_preco_id: null,
    regra_preco_particular_id: null,
    valor_unitario_calculado: excedente.valor,
    valor_total_calculado: excedente.valor,
    preco_manual: 0,
    operacao: 'inclusao',
    dados: JSON.stringify({
      origemPreco: 'excedente_teto_acordo',
      origem: { conta: origem.conta, item: origem.item, fonte: origem.fonte },
      excedente,
    }),
    ocorrido_em: new Date(),
    usuario_id: usuario,
  });
  return { conta: contaDestino, versao: n(destino['versao']), item, valor: excedente.valor };
}
