// Regras do acordo com a fonte pagadora aplicadas ao item lançado na conta (06-FAT linha 1, passo 3). Lê, na mesma
// transação do lançamento, as regras vigentes na data do item (percentual por componente, desconto por grupo de
// despesa, isento, teto e alto custo) do acordo da fonte da conta, e o que já foi cobrado para o teto; o cálculo é do
// domínio (@sgh/dominio-preco aplicarRegrasAcordo). Só vale para o item valorizado pela tabela do convênio: o preço
// manual aprovado e a regra do particular não passam pelo acordo.
import {
  aplicarRegrasAcordo,
  type ItemParaAcordo,
  regimesDoAtendimento,
  type RegrasVigentesCalc,
  type ResultadoAcordo,
} from '@sgh/dominio-preco';
import type { TxOperacao } from '@sgh/nucleo';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const id = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const sim = (v: unknown) => v === true || v === 1 || v === '1';

/** Tabelas que a aplicação lê (o gerador de privilégios resolve pelos literais abaixo). */
export const TABELAS_ACORDO_CONTA = [
  'regra_percentual_cobranca',
  'regra_desconto_grupo',
  'item_isento_cobranca',
  'teto_cobranca',
  'item_alto_custo_contrato',
  'contrato_fonte_pagadora',
  'regime_atendimento',
  'carater_atendimento_tiss',
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
}

/** As regras vigentes do acordo da fonte da conta na data do item, já no formato do cálculo. */
export async function regrasVigentesDaConta(
  tx: TxOperacao,
  est: number,
  fonte: number,
  data: string,
): Promise<RegrasVigentesCalc> {
  const percentuais = await tx.consultar<Linha>(
    `SELECT r.id, r.tabela_preco_id, r.componente, r.tipo_paciente, r.plano_fonte_pagadora_id, r.grupo_faturamento_id,
            r.item_faturavel_id, r.funcao_equipe_cobranca_id, r.tipo_conta_id, r.percentual, r.valor_fixo
       FROM regra_percentual_cobranca r
      WHERE r.fonte_pagadora_id = ? AND ${DO_ESTAB('r')} AND r.ativo = 1 AND ${VIGENTE('r')}`,
    [fonte, est, data, data],
  );
  const descontos = await tx.consultar<Linha>(
    `SELECT r.* FROM regra_desconto_grupo r
       JOIN contrato_fonte_pagadora k ON k.id = r.contrato_fonte_pagadora_id
      WHERE k.fonte_pagadora_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL AND ${VIGENTE('r')}`,
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
       JOIN contrato_fonte_pagadora k ON k.id = r.contrato_fonte_pagadora_id
      WHERE k.fonte_pagadora_id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL AND r.ativo = 1
        AND ${VIGENTE('r')}`,
    [fonte, est, data, data],
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
    // A via de acesso pede a via e a ordem do procedimento no ato, que o lançamento avulso não traz.
    vias: [],
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
    `SELECT c.tipo_conta_id, a.regime_atendimento_id, ra.descricao AS regime, ct.urgencia
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
  const entrada: ItemParaAcordo = {
    item: i.item,
    grupo: i.grupo,
    subgrupo: id(sub?.['subgrupo_faturamento_id']),
    plano: conta.plano,
    tabela: i.tabela,
    regimeId: id(ctx?.['regime_atendimento_id']),
    regimes: regimesDoAtendimento(
      ctx?.['regime'] === null || ctx?.['regime'] === undefined ? null : String(ctx['regime']),
      sim(ctx?.['urgencia']),
    ),
    funcaoEquipe: i.funcaoEquipe,
    tipoConta: id(ctx?.['tipo_conta_id']),
    quantidade: i.quantidade,
    honorario: i.honorario,
    custoOperacional: i.custoOperacional,
    filme: i.filme,
    via: null,
    ordemNoAto: null,
    jaCobrado: await jaCobrado(tx, conta.id, i.item, i.grupo),
  };
  return aplicarRegrasAcordo(entrada, await regrasVigentesDaConta(tx, est, conta.fonte, i.data));
}
