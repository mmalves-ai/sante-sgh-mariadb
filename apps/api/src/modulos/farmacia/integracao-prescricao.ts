// A regra de integração prescrição × estoque aplicada às doses (F3.6-04, 05-SUP linha 7), sobre o banco próprio.
// Chamado DENTRO da transação de quem cria ou muda o horário: a prescrição (cada item com produto de estoque), o
// parecer do farmacêutico e o aprazamento da enfermagem. A decisão é do domínio (decidirDoses, liberacaoPorEvento, em
// @sgh/contratos); aqui só se lê o contexto (unidade, setor e centro de custo da internação; grupo e subgrupo do
// item; regras ativas; saldo nos locais) e se grava o resultado em integracao_dose_estoque, uma linha por horário.
// Sem regra que atenda o item nada é gravado: a dose segue sem integração automática. Nada se apaga: a decisão de uma
// dose muda por alteração com trava de versão (o histórico da mudança fica na trilha da operação que a causou).
// Sem dependência de outro arquivo do módulo, para a prescrição e a enfermagem importarem sem ciclo.
import type { TxOperacao } from '@sgh/nucleo';
import {
  decidirDoses,
  type EventoLiberacaoDose,
  liberacaoPorEvento,
  type RegraCandidata,
} from '@sgh/contratos/regras-suprimentos';

/** A tabela que estas funções escrevem (quem as chama declara na lista de tabelas da sua operação). */
export const TABELA_INTEGRACAO_DOSE = 'integracao_dose_estoque';

const n = (v: unknown): number => Number(v);
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const data = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const dn = (v: unknown): Date | null => (v === null || v === undefined ? null : data(v));

interface RegraLida extends RegraCandidata {
  readonly forma: string;
}

export interface IntegracaoDoItem {
  /** A regra que decidiu, ou null quando nenhuma atende (nada gravado). */
  readonly regra: number | null;
  /** Doses com decisão gravada. */
  readonly doses: number;
  /** Doses sem local: nem o que atende nem o substituto têm saldo do item. */
  readonly semSaldo: number;
}

/**
 * Decide e grava a integração de cada horário pendente de um item prescrito. `prescritoEm` é o instante da prescrição
 * (as doses da regra "na prescrição" entram na fila nele).
 */
export async function integrarDosesDoItem(
  tx: TxOperacao,
  o: { est: number; atendimento: number; item: number; prescritoEm: Date },
): Promise<IntegracaoDoItem> {
  const nada: IntegracaoDoItem = { regra: null, doses: 0, semSaldo: 0 };
  const it = await tx.uma(
    `SELECT pi.tipo_item_prescricao_id, ip.insumo_id, ins.grupo_insumo_id, ins.subgrupo_insumo_id
       FROM prescricao_item pi
       JOIN item_prescritivel ip ON ip.id = pi.item_prescritivel_id
       JOIN insumo ins ON ins.id = ip.insumo_id
      WHERE pi.id = ? AND pi.excluido_em IS NULL`,
    [o.item],
  );
  if (!it) return nada;
  const insumo = n(it['insumo_id']);
  const regras = await regrasAtivas(tx, o.est);
  if (regras.length === 0) return nada;
  const horarios = await tx.consultar(
    `SELECT h.id, h.previsto_em FROM horario_administracao h
      WHERE h.prescricao_item_id = ? AND h.estabelecimento_id = ? AND h.excluido_em IS NULL
        AND NOT h.suspenso AND h.dispensacao_id IS NULL
      ORDER BY h.previsto_em, h.id`,
    [o.item, o.est],
  );
  if (horarios.length === 0) return nada;
  const a = await tx.uma(
    `SELECT COALESCE(ui.centro_custo_id, a.centro_custo_id) AS centro,
            COALESCE(ui.setor_funcional_id, a.setor_funcional_id) AS setor, ui.id AS unidade
       FROM atendimento a
       LEFT JOIN internacao i ON i.atendimento_id = a.id AND i.estabelecimento_id = a.estabelecimento_id
                             AND i.situacao IN ('ativa','alta_medica') AND i.excluido_em IS NULL
       LEFT JOIN unidade_internacao ui ON ui.id = i.unidade_internacao_id
      WHERE a.id = ? AND a.estabelecimento_id = ?
      ORDER BY i.id DESC LIMIT 1`,
    [o.atendimento, o.est],
  );
  const saldos = await tx.consultar(
    `SELECT local_estoque_id, SUM(quantidade - quantidade_reservada) AS livre
       FROM saldo_estoque WHERE estabelecimento_id = ? AND insumo_id = ? GROUP BY local_estoque_id`,
    [o.est, insumo],
  );
  const comSaldo = new Set(saldos.filter((s) => n(s['livre']) > 0).map((s) => n(s['local_estoque_id'])));
  const d = decidirDoses(
    regras,
    {
      centroCusto: nn(a?.['centro']),
      setor: nn(a?.['setor']),
      unidade: nn(a?.['unidade']),
      tipoItem: nn(it['tipo_item_prescricao_id']),
      grupo: nn(it['grupo_insumo_id']),
      subgrupo: nn(it['subgrupo_insumo_id']),
      item: insumo,
    },
    {
      temSaldo: (local) => comSaldo.has(local),
      prescritoEm: o.prescritoEm,
      horarios: horarios.map((h) => data(h['previsto_em'])),
    },
  );
  if (!d.regra) return nada;
  let semSaldo = 0;
  for (const [i, dose] of d.doses.entries()) {
    const horario = n(horarios[i]!['id']);
    if (dose.integraEstoque && dose.local === null) semSaldo += 1;
    const valores = {
      regra_integracao_prescricao_id: d.regra.regra,
      integra_estoque: dose.integraEstoque,
      tipo_integracao: d.regra.tipoIntegracao,
      momento_integracao: d.regra.momento,
      forma_dispensacao: d.regra.forma,
      atendente_local_estoque_id: dose.local,
      usou_substituto: dose.usouSubstituto,
      // O instante é o da regra mesmo sem local: a dose sem saldo aparece como tal (situacaoDoseIntegrada), não some.
      liberar_em: dose.integraEstoque ? dose.liberarEm : null,
      evento_liberacao: null,
    };
    const [atual] = await tx.consultarParaAtualizar(
      `SELECT id, versao FROM ${TABELA_INTEGRACAO_DOSE} WHERE horario_administracao_id = ?`,
      [horario],
    );
    if (atual) await tx.alterar(TABELA_INTEGRACAO_DOSE, n(atual['id']), n(atual['versao']), valores);
    else
      await tx.incluir(TABELA_INTEGRACAO_DOSE, {
        estabelecimento_id: o.est,
        horario_administracao_id: horario,
        prescricao_item_id: o.item,
        ...valores,
      });
  }
  return { regra: d.regra.regra, doses: d.doses.length, semSaldo };
}

/**
 * Um evento depois da prescrição sobre horários já decididos: o parecer do farmacêutico (todos os horários pendentes
 * do item) ou o aprazamento (o horário aprazado). Devolve quantas doses mudaram de instante de liberação.
 */
export async function liberarDosesPorEvento(
  tx: TxOperacao,
  o: { est: number; evento: EventoLiberacaoDose; quando: Date } & (
    { item: number; horario?: undefined } | { horario: number; item?: undefined }
  ),
): Promise<number> {
  const linhas = await tx.consultarParaAtualizar(
    `SELECT d.id, d.versao, d.momento_integracao, d.liberar_em, d.integra_estoque, h.previsto_em,
            r.antecedencia_minutos
       FROM ${TABELA_INTEGRACAO_DOSE} d
       JOIN horario_administracao h ON h.id = d.horario_administracao_id AND h.excluido_em IS NULL
       JOIN regra_integracao_prescricao r ON r.id = d.regra_integracao_prescricao_id
      WHERE d.estabelecimento_id = ? AND d.integra_estoque AND h.dispensacao_id IS NULL AND NOT h.suspenso
        AND ${o.item !== undefined ? 'd.prescricao_item_id = ?' : 'd.horario_administracao_id = ?'}
      ORDER BY d.id`,
    [o.est, o.item ?? o.horario],
  );
  let mudou = 0;
  for (const l of linhas) {
    const atual = dn(l['liberar_em']);
    const novo = liberacaoPorEvento(
      { momento: String(l['momento_integracao']), antecedenciaMinutos: nn(l['antecedencia_minutos']) },
      atual,
      o.evento,
      { quando: o.quando, horarioDose: data(l['previsto_em']) },
    );
    if ((novo?.getTime() ?? null) === (atual?.getTime() ?? null)) continue;
    await tx.alterar(TABELA_INTEGRACAO_DOSE, n(l['id']), n(l['versao']), {
      liberar_em: novo,
      evento_liberacao: o.evento,
    });
    mudou += 1;
  }
  return mudou;
}

async function regrasAtivas(tx: TxOperacao, est: number): Promise<RegraLida[]> {
  const rs = await tx.consultar(
    `SELECT id, centro_custo_id, setor_funcional_id, unidade_internacao_id, tipo_item_prescricao_id,
            grupo_insumo_id, subgrupo_insumo_id, insumo_id, atendente_local_estoque_id,
            substituto_local_estoque_id, tipo_integracao, momento_integracao, antecedencia_minutos,
            forma_dispensacao, gera_autorizacao_manipulacao, prioridade
       FROM regra_integracao_prescricao WHERE estabelecimento_id = ? AND ativo ORDER BY id`,
    [est],
  );
  return rs.map((r) => ({
    regra: n(r['id']),
    centroCusto: nn(r['centro_custo_id']),
    setor: nn(r['setor_funcional_id']),
    unidade: nn(r['unidade_internacao_id']),
    tipoItem: nn(r['tipo_item_prescricao_id']),
    grupo: nn(r['grupo_insumo_id']),
    subgrupo: nn(r['subgrupo_insumo_id']),
    item: nn(r['insumo_id']),
    localAtendente: n(r['atendente_local_estoque_id']),
    localSubstituto: nn(r['substituto_local_estoque_id']),
    tipoIntegracao: String(r['tipo_integracao']) as RegraCandidata['tipoIntegracao'],
    momento: String(r['momento_integracao']) as RegraCandidata['momento'],
    antecedenciaMinutos: nn(r['antecedencia_minutos']),
    geraManipulacao: Boolean(Number(r['gera_autorizacao_manipulacao'])),
    prioridade: n(r['prioridade']),
    ativo: true,
    forma: String(r['forma_dispensacao']),
  }));
}
