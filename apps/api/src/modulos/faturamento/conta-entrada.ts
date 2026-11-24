// F3.0 (motores, conta-admissao): a conta aberta na entrada do paciente e a apuração dos lançamentos automáticos (diárias
// por dia de corte e taxas por regra), gravadas na MESMA transação da operação que as dispara: internar, transferir de
// leito, dar alta, cancelar a alta (adt/operacoes.ts), abrir o atendimento ambulatorial ou de pronto atendimento
// (atendimento/porta-propria.ts) e a apuração da conta (`faturamento.apurar-lancamentos-automaticos`, para a rotina
// diária e para o faturista). As regras são do domínio (@sgh/dominio-faturamento, conta/admissao.ts); aqui só se lê a
// configuração e se grava o resultado.
//
// Contrato de efeito (adt/conta-entrada.int.spec.ts):
// - abrir: uma conta_hospitalar por atendimento e fonte pagadora (a segunda chamada devolve a mesma), situação "aberta",
//   natureza pelo tipo base da categoria do atendimento, tipo de conta da natureza, plano e cobertura da cobertura
//   principal do atendimento, tabela de preço vigente (a do plano, depois a da fonte pagadora do estabelecimento, depois
//   a da rede), acomodação cobrada, competência do mês da entrada, número "<número do atendimento>-<ordem>".
// - apurar: para cada lançamento devido e ainda não vigente, um conta_hospitalar_item (situação "lancado", item da regra,
//   preço vigente da tabela da conta ou valor fixo da regra; sem preço, valor zero com a memória "sem_preco_vigente"),
//   a memória do cálculo (conta_hospitalar_item_memoria) e o controle (lancamento_automatico_conta); para cada vigente que
//   deixou de valer, o item e o controle em "estornado" com o motivo; o total da conta refeito dos itens. Conta que não
//   aceita lançamento (fechada, enviada) não é tocada.
// - abrir grava também o vínculo atendimento_conta (é por ele que a recepção e o prontuário acham a conta). Sem tipo de
//   conta da natureza (ou com dois empatados), a entrada do paciente NÃO é barrada: a conta fica por abrir e o resultado
//   devolve a pendência para o faturista (a rotina diária tenta abrir de novo).
// - apurar confere, como o lançamento manual (faturamento.lancar-item), a competência da conta aberta para a fonte
//   pagadora e no geral (fechada: nada é lançado nem estornado e a pendência volta), o item faturável ativo (inativo:
//   pendência), o grupo do catálogo quando a regra não traz o seu, e as exceções da regra de lançamento.
// - cancelar (internação ou atendimento excluídos): estorna os automáticos com o motivo "cancelamento" e cancela a
//   conta; conta com lançamento manual vigente ou já em faturamento recusa a exclusão (passa pelo faturamento).
import {
  dataHoraParaInstante,
  FUSO_PADRAO,
  instanteParaDataHora,
} from '@sgh/contratos';
import {
  apurarLancamentos,
  competenciaDaConta,
  escolherTipoConta,
  NATUREZA_TIPO_CONTA,
  naturezaDaEntrada,
  type NaturezaContaPaciente,
  numeroDaConta,
  type RegraDiaria,
  type ExcecaoRegraLancamento,
  type TaxaAutomatica,
  type TrechoAcomodacao,
} from '@sgh/dominio-faturamento';
import { definirOperacao, recusa, type ResultadoOperacao, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { precoVigente, tabelasDePreco } from './operacoes.js';
import { conferirCompetenciaDaConta, contaAceitaLancamento } from './regras-conta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const r2 = (x: number) => Math.round(x * 100) / 100;

/** As tabelas que a abertura e a apuração gravam: a operação que as chama as declara junto das suas. */
export const TABELAS_CONTA_ENTRADA = [
  'conta_hospitalar',
  'atendimento_conta',
  'motivo_cancelamento_conta',
  'conta_hospitalar_item',
  'conta_hospitalar_item_memoria',
  'lancamento_automatico_conta',
] as const;

async function fusoDoEstabelecimento(tx: Pick<TxOperacao, 'uma'>, est: number): Promise<string> {
  const l = await tx.uma<Linha>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return texto(l?.['fuso_horario']) || FUSO_PADRAO;
}

const local = (d: unknown, fuso: string) => {
  const x = instanteParaDataHora(new Date(d as Date).toISOString(), fuso);
  return `${x.data}T${x.hora}`;
};

export interface AberturaConta {
  /** A conta aberta (ou a já aberta); nula quando a entrada não gera cobrança ou ficou pendente. */
  readonly conta: number | null;
  /** O que impediu a abertura, para o faturista (a entrada do paciente segue). */
  readonly pendencia: { readonly codigo: string; readonly mensagem: string } | null;
}

/** Grava o vínculo atendimento_conta quando falta (a recepção e o prontuário acham a conta por ele). */
async function vincularConta(tx: TxOperacao, atendimento: number, conta: number): Promise<void> {
  const v = await tx.uma<Linha>(
    'SELECT id FROM atendimento_conta WHERE atendimento_id = ? AND conta_hospitalar_id = ? AND excluido_em IS NULL',
    [atendimento, conta],
  );
  if (!v) await tx.incluir('atendimento_conta', { atendimento_id: atendimento, conta_hospitalar_id: conta });
}

/**
 * Abre a conta do atendimento na fonte pagadora dele (ou devolve a já aberta), com o vínculo atendimento_conta. Sem
 * cobrança, conta nula; sem tipo de conta da natureza (ou com dois empatados), conta nula e a pendência.
 */
export async function abrirContaDaEntrada(
  tx: TxOperacao,
  est: number,
  atendimento: number,
  o: { readonly categoriaAcomodacao?: number | null } = {},
): Promise<AberturaConta> {
  const at = await tx.uma<Linha>(
    `SELECT a.id, a.numero, a.paciente_id, a.fonte_pagadora_id, a.entrada_em, ca.tipo_base
       FROM atendimento a JOIN categoria_atendimento ca ON ca.id = a.categoria_atendimento_id
      WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
    [atendimento, est],
  );
  if (!at) throw recusa('registro-inexistente', 'O atendimento da conta não existe neste estabelecimento.');
  const natureza = naturezaDaEntrada(texto(at['tipo_base']));
  if (natureza === null || at['fonte_pagadora_id'] === null) return { conta: null, pendencia: null };
  const fonte = n(at['fonte_pagadora_id']);
  const ja = await tx.uma<Linha>(
    `SELECT id FROM conta_hospitalar WHERE atendimento_id = ? AND fonte_pagadora_id = ? AND situacao <> 'cancelada'
        AND excluido_em IS NULL ORDER BY id LIMIT 1`,
    [atendimento, fonte],
  );
  if (ja) {
    await vincularConta(tx, atendimento, n(ja['id']));
    return { conta: n(ja['id']), pendencia: null };
  }
  const tipos = await tx.consultar<Linha>(
    'SELECT id, ordem FROM tipo_conta WHERE natureza = ? AND ativo = TRUE',
    [NATUREZA_TIPO_CONTA[natureza]],
  );
  const tipo = escolherTipoConta(
    tipos.map((t) => ({ id: n(t['id']), ordem: n(t['ordem']) })),
    natureza,
  );
  // A falta de cadastro do faturamento não barra a entrada do paciente: a conta fica pendente para o faturista.
  if ('recusa' in tipo) return { conta: null, pendencia: { codigo: tipo.recusa, mensagem: tipo.mensagem } };
  const cob = await tx.uma<Linha>(
    `SELECT plano_fonte_pagadora_id, cobertura_paciente_id, senha_autorizacao FROM cobertura_atendimento
      WHERE atendimento_id = ? AND fonte_pagadora_id = ? AND excluido_em IS NULL ORDER BY ordem LIMIT 1`,
    [atendimento, fonte],
  );
  // Sem cobertura no atendimento (a internação grava o plano nela mesma), o plano da internação.
  const daInternacao = cob
    ? null
    : await tx.uma<Linha>(
        'SELECT plano_fonte_pagadora_id FROM internacao WHERE atendimento_id = ? AND excluido_em IS NULL',
        [atendimento],
      );
  const plano = nn(cob?.['plano_fonte_pagadora_id'] ?? daInternacao?.['plano_fonte_pagadora_id']);
  const [tabela] = await tabelasDePreco(tx, est, fonte, plano);
  const fuso = await fusoDoEstabelecimento(tx, est);
  const inicio = new Date(at['entrada_em'] as Date);
  const ordem = await tx.uma<Linha>('SELECT COUNT(*) AS n FROM conta_hospitalar WHERE atendimento_id = ?', [
    atendimento,
  ]);
  const conta = await tx.incluir('conta_hospitalar', {
    estabelecimento_id: est,
    numero: numeroDaConta(texto(at['numero']), n(ordem?.['n']) + 1),
    atendimento_id: atendimento,
    paciente_id: n(at['paciente_id']),
    fonte_pagadora_id: fonte,
    plano_fonte_pagadora_id: plano,
    cobertura_paciente_id: nn(cob?.['cobertura_paciente_id']),
    tabela_preco_id: tabela ?? null,
    tipo_conta_id: tipo.tipo,
    categoria_acomodacao_id: o.categoriaAcomodacao ?? null,
    natureza,
    tipo_cobranca: 'total',
    competencia: competenciaDaConta(local(inicio, fuso).slice(0, 10)),
    inicio_em: inicio,
    senha_autorizacao: cob?.['senha_autorizacao'] ?? null,
    situacao: 'aberta',
    origem: 'sistema',
  });
  await vincularConta(tx, atendimento, conta);
  return { conta, pendencia: null };
}

export interface ResultadoApuracaoConta {
  readonly conta: number;
  readonly lancados: number;
  readonly estornados: number;
  readonly pendencias: readonly { readonly dia: string; readonly motivo: string }[];
  /** Falso: a conta não aceita lançamento (fechada, enviada) e não foi tocada. */
  readonly apurada: boolean;
}

/** As contas abertas do atendimento (a apuração das operações da internação vale para todas elas). */
export async function contasDoAtendimento(tx: Pick<TxOperacao, 'consultar'>, atendimento: number) {
  const r = await tx.consultar<Linha>(
    `SELECT id FROM conta_hospitalar WHERE atendimento_id = ? AND situacao <> 'cancelada' AND excluido_em IS NULL
      ORDER BY id`,
    [atendimento],
  );
  return r.map((x) => n(x['id']));
}

/** Apura e grava os lançamentos automáticos de todas as contas do atendimento (na transação de quem chama). */
export async function apurarContasDoAtendimento(
  tx: TxOperacao,
  est: number,
  atendimento: number,
  agora: Date = new Date(),
): Promise<ResultadoApuracaoConta[]> {
  const out: ResultadoApuracaoConta[] = [];
  for (const c of await contasDoAtendimento(tx, atendimento)) out.push(await apurarConta(tx, est, c, agora));
  return out;
}

/** Apura a conta: lança o devido que falta e estorna o vigente que deixou de valer (idempotente). */
export async function apurarConta(
  tx: TxOperacao,
  est: number,
  contaId: number,
  agora: Date = new Date(),
  o: { readonly cancelada?: boolean } = {},
): Promise<ResultadoApuracaoConta> {
  const [c] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, atendimento_id, natureza, fonte_pagadora_id, plano_fonte_pagadora_id, tabela_preco_id,
            paciente_id, inicio_em, valor_acrescimo, valor_desconto, competencia,
            DATE_FORMAT(competencia, '%Y-%m') AS competencia_mes
       FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [contaId, est],
  );
  if (!c) throw recusa('registro-inexistente', 'A conta não existe neste estabelecimento.');
  if (!contaAceitaLancamento(texto(c['situacao'])))
    return { conta: contaId, lancados: 0, estornados: 0, pendencias: [], apurada: false };
  // Regra 9 do lançamento: a competência da conta aberta para a fonte pagadora e no geral (com trava, como lancarItem).
  const [daFonte] = await tx.consultarParaAtualizar<Linha>(
    `SELECT situacao FROM fechamento_competencia_fonte_pagadora
      WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND competencia = ? AND excluido_em IS NULL`,
    [est, n(c['fonte_pagadora_id']), c['competencia']],
    { teto: 1 },
  );
  const [geral] = await tx.consultarParaAtualizar<Linha>(
    `SELECT situacao FROM competencia_faturamento
      WHERE estabelecimento_id = ? AND modulo = 'fonte_pagadora' AND competencia = ? AND excluido_em IS NULL`,
    [est, c['competencia']],
    { teto: 1 },
  );
  const fechada = conferirCompetenciaDaConta(
    daFonte ? texto(daFonte['situacao']) : null,
    geral ? texto(geral['situacao']) : null,
  );
  if (fechada)
    return {
      conta: contaId,
      lancados: 0,
      estornados: 0,
      pendencias: [{ dia: texto(c['competencia_mes']), motivo: 'competencia-fechada' }],
      apurada: false,
    };
  const fuso = await fusoDoEstabelecimento(tx, est);
  const natureza = texto(c['natureza']) as NaturezaContaPaciente;
  const fonte = n(c['fonte_pagadora_id']);
  const plano = nn(c['plano_fonte_pagadora_id']);
  let entrada = local(c['inicio_em'], fuso);
  let limite = local(agora, fuso);
  let alta = false;
  let modalidade: number | null = null;
  let acompanhante = false;
  let trechos: TrechoAcomodacao[] = [];
  let cancelada = Boolean(o.cancelada);
  const at = await tx.uma<Linha>(
    'SELECT situacao, setor_funcional_id, especialidade_medica_id FROM atendimento WHERE id = ?',
    [n(c['atendimento_id'])],
  );
  if (texto(at?.['situacao']) === 'cancelado') cancelada = true;
  if (natureza === 'internacao') {
    const i = await tx.uma<Linha>(
      `SELECT id, data_hora_entrada, data_hora_alta, situacao, modalidade_internacao_id, tem_acompanhante
         FROM internacao WHERE atendimento_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
      [n(c['atendimento_id'])],
    );
    if (i) {
      entrada = local(i['data_hora_entrada'], fuso);
      if (i['situacao'] === 'alta' && i['data_hora_alta'] !== null) {
        limite = local(i['data_hora_alta'], fuso);
        alta = true;
      }
      // Internação excluída: nada mais é devido (a apuração estorna tudo com o motivo "cancelamento").
      if (i['situacao'] === 'cancelada') cancelada = true;
      modalidade = nn(i['modalidade_internacao_id']);
      acompanhante = Boolean(n(i['tem_acompanhante']));
      const oc = await tx.consultar<Linha>(
        `SELECT ol.data_hora_inicio, ol.data_hora_fim,
                COALESCE(ol.categoria_acomodacao_id, ac.categoria_acomodacao_id) AS categoria
           FROM ocupacao_leito ol LEFT JOIN acomodacao ac ON ac.id = ol.acomodacao_id
          WHERE ol.internacao_id = ? AND ol.situacao <> 'cancelada' AND ol.excluido_em IS NULL
          ORDER BY ol.data_hora_inicio, ol.id`,
        [n(i['id'])],
      );
      trechos = oc.map((x) => ({
        inicio: local(x['data_hora_inicio'], fuso),
        fim: x['data_hora_fim'] === null ? null : local(x['data_hora_fim'], fuso),
        categoriaAcomodacao: nn(x['categoria']),
      }));
    }
  }
  if (limite < entrada) limite = entrada;
  const nasc = await tx.uma<Linha>(
    `SELECT TIMESTAMPDIFF(YEAR, pf.data_nascimento, ?) AS idade
       FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ?`,
    [entrada.slice(0, 10), n(c['paciente_id'])],
  );
  const regrasDiaria: RegraDiaria[] =
    natureza !== 'internacao'
      ? []
      : (
          await tx.consultar<Linha>(
            `SELECT id, fonte_pagadora_id, plano_fonte_pagadora_id, categoria_acomodacao_id, modalidade_internacao_id,
                    idade_minima_anos, idade_maxima_anos, acompanhante, item_faturavel_id, grupo_faturamento_id, quantidade,
                    TIME_FORMAT(hora_virada, '%H:%i') AS virada, tolerancia_minutos, substitui_regra_geral, prioridade,
                    DATE_FORMAT(vigencia_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim
               FROM regra_diaria WHERE estabelecimento_id = ? AND ativo = TRUE`,
            [est],
            { teto: 2000 },
          )
        ).map((r) => ({
          id: n(r['id']),
          fontePagadora: nn(r['fonte_pagadora_id']),
          plano: nn(r['plano_fonte_pagadora_id']),
          categoriaAcomodacao: n(r['categoria_acomodacao_id']),
          modalidade: nn(r['modalidade_internacao_id']),
          idadeMinima: nn(r['idade_minima_anos']),
          idadeMaxima: nn(r['idade_maxima_anos']),
          acompanhante: Boolean(n(r['acompanhante'])),
          item: n(r['item_faturavel_id']),
          grupo: nn(r['grupo_faturamento_id']),
          quantidade: n(r['quantidade']),
          horaVirada: texto(r['virada']),
          toleranciaMinutos: n(r['tolerancia_minutos']),
          substituiGeral: Boolean(n(r['substitui_regra_geral'])),
          prioridade: n(r['prioridade']),
          vigenciaInicio: texto(r['inicio']),
          vigenciaFim: r['fim'] === null ? null : texto(r['fim']),
        }));
  const excecoes = await tx.consultar<Linha>(
    `SELECT x.regra_lancamento_id AS regra, x.estabelecimento_id, x.fonte_pagadora_id, x.plano_fonte_pagadora_id,
            x.setor_funcional_id, x.especialidade_medica_id, x.item_faturavel_id, x.grupo_faturamento_id, x.efeito,
            x.aplica_internacao, x.aplica_ambulatorial, x.aplica_externo, x.aplica_urgencia, x.aplica_domiciliar,
            DATE_FORMAT(x.vigencia_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(x.vigencia_fim, '%Y-%m-%d') AS fim
       FROM regra_lancamento_excecao x JOIN regra_lancamento rl ON rl.id = x.regra_lancamento_id
      WHERE rl.ativo = TRUE AND rl.gatilho IN ('abertura_atendimento','diaria_internacao') AND x.excluido_em IS NULL`,
    [],
    { teto: 5000 },
  );
  const excecoesDa = (regra: number): ExcecaoRegraLancamento[] =>
    excecoes
      .filter((x) => n(x['regra']) === regra)
      .map((x) => ({
        estabelecimento: nn(x['estabelecimento_id']),
        fontePagadora: nn(x['fonte_pagadora_id']),
        plano: nn(x['plano_fonte_pagadora_id']),
        setor: nn(x['setor_funcional_id']),
        especialidade: nn(x['especialidade_medica_id']),
        item: nn(x['item_faturavel_id']),
        grupo: nn(x['grupo_faturamento_id']),
        efeito: texto(x['efeito']) as ExcecaoRegraLancamento['efeito'],
        aplica: {
          internacao: Boolean(n(x['aplica_internacao'])),
          ambulatorial: Boolean(n(x['aplica_ambulatorial'])),
          externo: Boolean(n(x['aplica_externo'])),
          urgencia: Boolean(n(x['aplica_urgencia'])),
          domiciliar: Boolean(n(x['aplica_domiciliar'])),
        },
        vigenciaInicio: x['inicio'] === null ? null : texto(x['inicio']),
        vigenciaFim: x['fim'] === null ? null : texto(x['fim']),
      }));
  const taxas: TaxaAutomatica[] = (
    await tx.consultar<Linha>(
      `SELECT rl.id AS regra, ri.id AS regra_item, ri.tabela_preco_id, rl.gatilho, rl.acao, rl.exige_confirmacao, rl.lanca_uma_vez_por_conta,
              ri.item_faturavel_id, ri.grupo_faturamento_id, ri.quantidade, ri.tipo_valor, ri.valor, ri.aplica_internacao,
              ri.aplica_ambulatorial, ri.aplica_externo, ri.aplica_urgencia, ri.aplica_domiciliar,
              DATE_FORMAT(rl.vigencia_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(rl.vigencia_fim, '%Y-%m-%d') AS fim
         FROM regra_lancamento rl JOIN regra_lancamento_item ri ON ri.regra_lancamento_id = rl.id
        WHERE rl.ativo = TRUE AND rl.gatilho IN ('abertura_atendimento','diaria_internacao') AND ri.excluido_em IS NULL`,
      [],
      { teto: 2000 },
    )
  ).map((r) => ({
    regraLancamento: n(r['regra']),
    regraItem: n(r['regra_item']),
    gatilho: texto(r['gatilho']) as TaxaAutomatica['gatilho'],
    acao: texto(r['acao']),
    exigeConfirmacao: Boolean(n(r['exige_confirmacao'])),
    umaVezPorConta: Boolean(n(r['lanca_uma_vez_por_conta'])),
    item: nn(r['item_faturavel_id']),
    grupo: nn(r['grupo_faturamento_id']),
    quantidade: n(r['quantidade']),
    tipoValor: texto(r['tipo_valor']) as TaxaAutomatica['tipoValor'],
    valor: r['valor'] === null ? null : n(r['valor']),
    aplica: {
      internacao: Boolean(n(r['aplica_internacao'])),
      ambulatorial: Boolean(n(r['aplica_ambulatorial'])),
      externo: Boolean(n(r['aplica_externo'])),
      urgencia: Boolean(n(r['aplica_urgencia'])),
      domiciliar: Boolean(n(r['aplica_domiciliar'])),
    },
    vigenciaInicio: texto(r['inicio']),
    vigenciaFim: r['fim'] === null ? null : texto(r['fim']),
    tabelaPreco: nn(r['tabela_preco_id']),
    excecoes: excecoesDa(n(r['regra'])),
  }));
  const vig = await tx.consultar<Linha>(
    `SELECT l.id, l.versao, l.chave, DATE_FORMAT(l.dia_referencia, '%Y-%m-%d') AS dia, l.categoria_acomodacao_id,
            i.id AS item_id, i.versao AS item_versao, i.item_faturavel_id
       FROM lancamento_automatico_conta l JOIN conta_hospitalar_item i ON i.id = l.conta_hospitalar_item_id
      WHERE l.conta_hospitalar_id = ? AND l.situacao = 'lancado'`,
    [contaId],
    { teto: 20000 },
  );
  const r = apurarLancamentos({
    natureza,
    entrada,
    limite,
    alta,
    trechos,
    fontePagadora: fonte,
    plano,
    modalidade,
    idadeAnos: nasc?.['idade'] === null || nasc?.['idade'] === undefined ? null : n(nasc['idade']),
    acompanhante,
    regrasDiaria,
    taxas,
    vigentes: vig.map((v) => ({
      id: n(v['id']),
      chave: texto(v['chave']),
      dia: texto(v['dia']),
      item: n(v['item_faturavel_id']),
      categoriaAcomodacao: nn(v['categoria_acomodacao_id']),
    })),
    cancelada,
    recorte: {
      estabelecimento: est,
      setor: nn(at?.['setor_funcional_id']),
      especialidade: nn(at?.['especialidade_medica_id']),
    },
  });
  const quando = new Date();
  for (const e of r.estornar) {
    const v = vig.find((x) => n(x['id']) === e.id)!;
    await tx.alterar('conta_hospitalar_item', n(v['item_id']), n(v['item_versao']), { situacao: 'estornado' });
    await tx.alterar('lancamento_automatico_conta', e.id, n(v['versao']), {
      situacao: 'estornado',
      estornado_em: quando,
      motivo_estorno: e.motivo,
    });
  }
  const tabelas = await tabelasDePreco(tx, est, fonte, plano, nn(c['tabela_preco_id']));
  const pendencias: { dia: string; motivo: string }[] = [...r.pendencias];
  // O catálogo de itens faturáveis: o item tem de estar ativo (como no lançamento manual) e dá o grupo.
  const ids = [...new Set(r.lancar.map((d) => d.item))];
  const catalogo = new Map(
    (ids.length
      ? await tx.consultar<Linha>(
          `SELECT id, grupo_faturamento_id FROM item_faturavel
            WHERE id IN (${ids.map(() => '?').join(',')}) AND situacao = 'ativo' AND excluido_em IS NULL`,
          ids,
          { teto: ids.length },
        )
      : []
    ).map((x) => [n(x['id']), nn(x['grupo_faturamento_id'])] as const),
  );
  let lancados = 0;
  for (const d of r.lancar) {
    if (!catalogo.has(d.item)) {
      pendencias.push({ dia: d.dia, motivo: 'item-inativo' });
      continue;
    }
    // A tabela forçada pelo item da regra vale antes das tabelas da conta.
    const daRegra = d.tabelaPreco !== null ? [d.tabelaPreco, ...tabelas.filter((t) => t !== d.tabelaPreco)] : tabelas;
    const preco = d.valorFixo !== null ? null : await precoVigente(tx, daRegra, d.item, d.dia);
    const unitario = d.valorFixo ?? preco?.unitario ?? 0;
    const origemPreco = d.valorFixo !== null ? 'valor_fixo_regra' : preco ? 'tabela' : 'sem_preco_vigente';
    if (origemPreco === 'sem_preco_vigente') pendencias.push({ dia: d.dia, motivo: 'sem-preco' });
    const seq = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS proxima FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
      [contaId],
    );
    const item = await tx.incluir('conta_hospitalar_item', {
      conta_hospitalar_id: contaId,
      sequencia: n(seq?.['proxima']),
      item_faturavel_id: d.item,
      grupo_faturamento_id: d.grupo ?? catalogo.get(d.item) ?? null,
      regra_lancamento_id: d.regraLancamento,
      realizado_em: new Date(dataHoraParaInstante(d.dia, d.hora, fuso)),
      quantidade: d.quantidade,
      valor_unitario: unitario,
      valor_honorario: preco ? r2(preco.honorario * d.quantidade) : 0,
      valor_custo_operacional: preco ? r2(preco.custoOperacional * d.quantidade) : 0,
      valor_filme: preco ? r2(preco.filme * d.quantidade) : 0,
      valor_total: r2(unitario * d.quantidade),
      // Só o preço da tabela é "tabela"; o valor fixo da regra e o zero sem preço são valores atribuídos (a memória diz a
      // origem e o faturista confere a pendência).
      tipo_valorizacao: origemPreco === 'tabela' ? 'tabela' : 'manual',
      situacao: 'lancado',
    });
    await tx.incluir('conta_hospitalar_item_memoria', {
      conta_hospitalar_item_id: item,
      tabela_preco_id: preco?.tabela ?? null,
      regra_lancamento_id: d.regraLancamento,
      valor_unitario_calculado: unitario,
      valor_total_calculado: r2(unitario * d.quantidade),
      preco_manual: 0,
      operacao: 'inclusao',
      dados: JSON.stringify({
        origem: 'lancamento_automatico',
        origemPreco,
        chave: d.chave,
        dia: d.dia,
        regraDiaria: d.regraDiaria,
        regraItem: d.regraItem,
        categoriaAcomodacao: d.categoriaAcomodacao,
        vigencia: preco?.vigencia ?? null,
      }),
      ocorrido_em: quando,
      usuario_id: tx.contexto.usuario,
    });
    await tx.incluir('lancamento_automatico_conta', {
      conta_hospitalar_id: contaId,
      conta_hospitalar_item_id: item,
      chave: d.chave,
      dia_referencia: d.dia,
      categoria_acomodacao_id: d.categoriaAcomodacao,
      regra_diaria_id: d.regraDiaria,
      regra_lancamento_item_id: d.regraItem,
      situacao: 'lancado',
    });
    lancados += 1;
  }
  if (lancados || r.estornar.length) {
    const soma = await tx.uma<Linha>(
      `SELECT COALESCE(SUM(valor_total), 0) AS itens, COALESCE(SUM(valor_filme), 0) AS filme
         FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND excluido_em IS NULL
          AND situacao NOT IN ('estornado','transferido','sem_cobranca')`,
      [contaId],
    );
    const itens = n(soma?.['itens']);
    await tx.alterar('conta_hospitalar', contaId, n(c['versao']), {
      valor_itens: itens,
      valor_filme: n(soma?.['filme']),
      valor_total: Math.max(0, r2(itens + n(c['valor_acrescimo']) - n(c['valor_desconto']))),
      calculada: false,
    });
  }
  return {
    conta: contaId,
    lancados,
    estornados: r.estornar.length,
    pendencias,
    apurada: true,
  };
}

/** Código do motivo de cancelamento que o sistema usa para a conta da entrada excluída. */
export const MOTIVO_CANCELAMENTO_ENTRADA = 'ENTRADA_EXCLUIDA';

/**
 * A entrada excluída (internação ou atendimento cancelado): estorna os lançamentos automáticos com o motivo
 * "cancelamento" e cancela as contas do atendimento, na transação de quem chama. Conta já em faturamento ou com
 * lançamento que não é automático (lançado por alguém) recusa: a exclusão passa pelo faturamento.
 */
export async function cancelarContasDaEntrada(tx: TxOperacao, est: number, atendimento: number): Promise<number> {
  const contas = await contasDoAtendimento(tx, atendimento);
  let canceladas = 0;
  for (const id of contas) {
    const manuais = await tx.uma<Linha>(
      `SELECT COUNT(*) AS n FROM conta_hospitalar_item i
        WHERE i.conta_hospitalar_id = ? AND i.excluido_em IS NULL AND i.situacao NOT IN ('estornado','transferido')
          AND NOT EXISTS (SELECT 1 FROM lancamento_automatico_conta l WHERE l.conta_hospitalar_item_id = i.id)`,
      [id],
    );
    if (n(manuais?.['n']) > 0)
      throw recusa('exclusao-recusada', 'A conta do atendimento tem lançamentos: estorne-os no faturamento antes de excluir.');
    const r = await apurarConta(tx, est, id, new Date(), { cancelada: true });
    if (!r.apurada)
      throw recusa('exclusao-recusada', 'A conta do atendimento já está em faturamento: a exclusão passa pelo faturamento.');
    let motivo = await tx.uma<Linha>('SELECT id FROM motivo_cancelamento_conta WHERE codigo = ?', [
      MOTIVO_CANCELAMENTO_ENTRADA,
    ]);
    const motivoId =
      motivo !== null && motivo !== undefined
        ? n(motivo['id'])
        : await tx.incluir('motivo_cancelamento_conta', {
            codigo: MOTIVO_CANCELAMENTO_ENTRADA,
            descricao: 'Entrada do paciente excluída (internação ou atendimento cancelado)',
            ativo: true,
            exige_justificativa: false,
          });
    motivo = await tx.uma<Linha>('SELECT versao FROM conta_hospitalar WHERE id = ?', [id]);
    await tx.alterar('conta_hospitalar', id, n(motivo?.['versao']), {
      situacao: 'cancelada',
      cancelada_em: new Date(),
      motivo_cancelamento_conta_id: motivoId,
    });
    canceladas += 1;
  }
  return canceladas;
}

const esquemaApurar = z.object({ conta: z.number().int().positive() }).strict();

/** A apuração da conta pela rotina diária (uma chamada por conta aberta) ou pelo faturista. */
export const apurarLancamentosAutomaticos = definirOperacao<z.infer<typeof esquemaApurar>, ResultadoOperacao>({
  nome: 'faturamento.apurar-lancamentos-automaticos',
  tabelas: [...TABELAS_CONTA_ENTRADA],
  entrada: esquemaApurar,
  async gravar(tx, e) {
    const est = tx.contexto.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    const r = await apurarConta(tx, est, e.conta);
    return {
      conta: r.conta,
      lancados: r.lancados,
      estornados: r.estornados,
      pendencias: r.pendencias.length,
      apurada: r.apurada,
    };
  },
  eventos: (_e, r) =>
    Number(r['lancados']) || Number(r['estornados'])
      ? [{ tipo: 'faturamento.conta.apurada', carga: { conta: Number(r['conta']) } }]
      : [],
  alvo: (_e, r) => ({ tabela: 'conta_hospitalar', id: Number(r['conta']) }),
});

const esquemaApurarDia = z.object({}).strict();

/**
 * A rotina diária do estabelecimento da sessão: abre a conta das internações em curso que ficaram sem conta (falta de
 * tipo de conta no dia da entrada) e apura todas as contas de internação abertas, lançando a diária do dia de corte sem
 * depender de nenhum evento do ADT (admissão, alta e transferência). Idempotente.
 */
export const apurarLancamentosDoDia = definirOperacao<z.infer<typeof esquemaApurarDia>, ResultadoOperacao>({
  nome: 'faturamento.apurar-lancamentos-do-dia',
  tabelas: [...TABELAS_CONTA_ENTRADA],
  entrada: esquemaApurarDia,
  async gravar(tx) {
    const est = tx.contexto.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    const semConta = await tx.consultar<Linha>(
      `SELECT i.atendimento_id FROM internacao i
        WHERE i.estabelecimento_id = ? AND i.situacao IN ('ativa','alta_medica') AND i.excluido_em IS NULL
          AND NOT EXISTS (SELECT 1 FROM conta_hospitalar c WHERE c.atendimento_id = i.atendimento_id
                            AND c.situacao <> 'cancelada' AND c.excluido_em IS NULL)`,
      [est],
      { teto: 5000 },
    );
    let abertas = 0;
    let pendentes = 0;
    for (const x of semConta) {
      const a = await abrirContaDaEntrada(tx, est, n(x['atendimento_id']));
      if (a.conta !== null) abertas += 1;
      if (a.pendencia !== null) pendentes += 1;
    }
    const contas = (
      await tx.consultar<Linha>(
      `SELECT id, situacao FROM conta_hospitalar WHERE estabelecimento_id = ? AND natureza = 'internacao'
          AND situacao <> 'cancelada' AND excluido_em IS NULL ORDER BY id`,
      [est],
      { teto: 20000 },
    )
    ).filter((c) => contaAceitaLancamento(texto(c['situacao'])));
    let lancados = 0;
    let estornados = 0;
    let pendencias = 0;
    for (const c of contas) {
      const r = await apurarConta(tx, est, n(c['id']));
      lancados += r.lancados;
      estornados += r.estornados;
      pendencias += r.pendencias.length;
    }
    return { estabelecimento: est, contas: contas.length, abertas, pendentes, lancados, estornados, pendencias };
  },
  eventos: (_e, r) =>
    Number(r['lancados']) || Number(r['estornados'])
      ? [{ tipo: 'faturamento.contas.apuradas', carga: { contas: Number(r['contas']) } }]
      : [],
  alvo: (_e, r) => ({ tabela: 'estabelecimento', id: Number(r['estabelecimento']) }),
});
