// F8, 07-FIN linhas 68 e 69: encontro de contas entre o que se paga e o que se recebe do mesmo parceiro, e previsão e
// provisão de pagamentos, no banco próprio, pelo executor do @sgh/nucleo (trilha, outbox e idempotência na mesma
// transação). As regras são as do @sgh/dominio-financeiro (encontro-contas.ts, previsao-provisao.ts); aqui ficam a
// leitura sob a trava e a gravação.
// Encontro de contas: o parceiro é o fornecedor; o lado a receber são os títulos do devedor com o MESMO CNPJ ou CPF.
// A proposta grava o cabeçalho e os itens (valor compensado por parcela) aguardando aprovação; aprovar e efetivar é um
// passo só, de outra pessoa: a parcela a pagar ganha a baixa na forma "encontro_contas" (sem conta bancária: não há
// dinheiro), a parcela a receber tem o valor recebido aumentado pelo item, e os dois títulos recalculam a situação.
// Previsão: as ocorrências saem da regra na hora; realizar liga a ocorrência ao título e grava previsto × realizado.
// Provisão: nasce com saldo; a liquidação pelo título a pagar e a reversão (ajuste com motivo) baixam o saldo.
import {
  conciliarPrevistoRealizado,
  conferirAprovacaoEncontro,
  conferirCancelamentoEncontro,
  gerarOcorrenciasPrevisao,
  liquidarProvisao,
  type ParcelaEncontro,
  PERIODICIDADES,
  planejarEncontroContas,
  type RecusaFinanceiro,
  reverterProvisao,
  TIPOS_PROVISAO,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  garantirSequencia,
  type Leitor,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { exigirPeriodoAberto } from './periodo-propria.js';
import { dataIso, numero } from './vocabulario.js';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const valor = z.number().positive().max(9_999_999_999_999);
const centavos = (v: number) => Math.round(v * 100) / 100;

function recusar<T extends object>(r: RecusaFinanceiro | T): T {
  if ('codigo' in r && 'mensagem' in r) {
    const x = r as RecusaFinanceiro;
    throw recusa(x.codigo, x.mensagem, x.campos ? { campos: x.campos } : {});
  }
  return r as T;
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
function usuarioDe(ctx: ContextoOperacao): number {
  if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return ctx.usuario;
}
const doc = (r: Record<string, unknown>) => String(r['cnpj'] ?? r['cpf'] ?? '').replace(/\D/g, '');

// ── Encontro de contas ─────────────────────────────────────────────────────────────────────────────────────────

export const esquemaProporEncontro = z
  .object({
    fornecedor: id,
    data: DATA,
    parcelasPagar: z.array(id).min(1).max(200),
    parcelasReceber: z.array(id).min(1).max(200),
    observacao: z.string().trim().max(500).optional(),
  })
  .strict();
export const esquemaEfetivarEncontro = z.object({ encontro: id }).strict();
export const esquemaCancelarEncontro = z
  .object({ encontro: id, motivo: z.string().trim().min(5).max(500) })
  .strict();

const PENDENTE = "('aguardando_aprovacao','aprovado')";

async function emOutroEncontro(tx: Leitor, coluna: string, ids: readonly number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const linhas = await tx.consultar(
    `SELECT i.${coluna} AS p FROM encontro_contas_item i JOIN encontro_contas e ON e.id = i.encontro_contas_id
      WHERE i.${coluna} IN (${ids.map(() => '?').join(',')}) AND i.excluido_em IS NULL AND e.situacao IN ${PENDENTE}`,
    [...ids],
  );
  return new Set(linhas.map((l) => numero(l['p'])));
}

const proporEncontro = definirOperacao<z.infer<typeof esquemaProporEncontro>, ResultadoOperacao>({
  nome: 'financeiro.propor_encontro_contas',
  tabelas: ['encontro_contas', 'encontro_contas_item', 'sequencia_negocio'],
  entrada: esquemaProporEncontro as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    await exigirPeriodoAberto(tx, est, e.data, 'data');
    const forn = await tx.uma('SELECT id, cnpj, cpf FROM empresa_fornecedora WHERE id = ?', [e.fornecedor]);
    if (!forn) throw recusa('parceiro-inexistente', 'O parceiro não existe.', { campos: ['fornecedor'] });
    const ph = (n: readonly number[]) => n.map(() => '?').join(',');
    const pagar = await tx.consultarParaAtualizar(
      `SELECT p.id, p.situacao, p.saldo, p.vencimento, f.cnpj, f.cpf
         FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
         LEFT JOIN empresa_fornecedora f ON f.id = t.empresa_fornecedora_id
        WHERE p.id IN (${ph(e.parcelasPagar)}) AND t.estabelecimento_id = ? AND p.excluido_em IS NULL
          AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'`,
      [...e.parcelasPagar, est],
      { teto: 200 },
    );
    const receber = await tx.consultarParaAtualizar(
      `SELECT p.id, p.situacao, p.saldo, p.vencimento, c.cnpj, c.cpf, c.id AS cliente
         FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id
         LEFT JOIN cliente_financeiro c ON c.id = t.cliente_financeiro_id
        WHERE p.id IN (${ph(e.parcelasReceber)}) AND t.estabelecimento_id = ? AND p.excluido_em IS NULL
          AND t.excluido_em IS NULL AND t.situacao NOT IN ('cancelado','renegociado')`,
      [...e.parcelasReceber, est],
      { teto: 200 },
    );
    if (pagar.length !== new Set(e.parcelasPagar).size || receber.length !== new Set(e.parcelasReceber).size)
      throw recusa('parcela-inexistente', 'Há parcela que não existe neste estabelecimento: releia.', {
        campos: ['parcelas'],
      });
    const outrosP = await emOutroEncontro(tx, 'parcela_pagar_id', e.parcelasPagar);
    const outrosR = await emOutroEncontro(tx, 'parcela_receber_id', e.parcelasReceber);
    const parcela = (natureza: 'pagar' | 'receber', l: Record<string, unknown>): ParcelaEncontro => ({
      natureza,
      parcela: numero(l['id']),
      situacao: String(l['situacao']),
      saldo: numero(l['saldo']),
      vencimento: dataIso(l['vencimento']) ?? '',
      documento: doc(l),
      emOutroEncontro: (natureza === 'pagar' ? outrosP : outrosR).has(numero(l['id'])),
    });
    // Parcelas repetidas na entrada também são recusadas pela regra (a consulta devolve cada uma só uma vez).
    const repetida =
      e.parcelasPagar.length !== new Set(e.parcelasPagar).size ||
      e.parcelasReceber.length !== new Set(e.parcelasReceber).size;
    if (repetida)
      throw recusa('parcela-repetida', 'A mesma parcela foi marcada duas vezes.', { campos: ['parcelas'] });
    const plano = recusar(
      planejarEncontroContas({
        documentoParceiro: doc(forn),
        parcelas: [...pagar.map((l) => parcela('pagar', l)), ...receber.map((l) => parcela('receber', l))],
      }),
    );
    await garantirSequencia(
      tx,
      { tipo: 'encontro_contas', estabelecimento: est, prefixo: 'EC-' },
      { usuario, agora: new Date() },
    );
    const num = await tx.proximoNumero('encontro_contas');
    const encontro = await tx.incluir('encontro_contas', {
      estabelecimento_id: est,
      numero: num.formatado,
      data_operacao: e.data,
      empresa_fornecedora_id: e.fornecedor,
      cliente_financeiro_id: numero(receber[0]?.['cliente']) || null,
      total_pagar: plano.totalPagar,
      total_receber: plano.totalReceber,
      saldo_liquido: plano.saldoLiquido,
      situacao: 'aguardando_aprovacao',
      observacao: e.observacao || null,
    });
    for (const it of plano.itens)
      await tx.incluir('encontro_contas_item', {
        encontro_contas_id: encontro,
        sequencia: it.sequencia,
        natureza: it.natureza,
        parcela_pagar_id: it.natureza === 'pagar' ? it.parcela : null,
        parcela_receber_id: it.natureza === 'receber' ? it.parcela : null,
        valor_compensado: it.valorCompensado,
      });
    return {
      encontro,
      numero: num.formatado,
      compensado: plano.compensado,
      saldoLiquido: plano.saldoLiquido,
      itens: plano.itens.length,
    };
  },
  alvo: (_e, r) => ({ tabela: 'encontro_contas', id: numero(r['encontro']) || null }),
});

const efetivarEncontro = definirOperacao<z.infer<typeof esquemaEfetivarEncontro>, ResultadoOperacao>({
  nome: 'financeiro.efetivar_encontro_contas',
  tabelas: [
    'encontro_contas',
    'encontro_contas_item',
    'baixa_titulo',
    'parcela_pagar',
    'titulo_pagar',
    'parcela_receber',
    'titulo_receber',
  ],
  entrada: esquemaEfetivarEncontro as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const [c] = await tx.consultarParaAtualizar(
      'SELECT id, versao, situacao, criado_por, data_operacao FROM encontro_contas WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.encontro, est],
      { teto: 1 },
    );
    if (!c) throw recusa('encontro-inexistente', 'O encontro de contas não existe neste estabelecimento.');
    recusar(
      conferirAprovacaoEncontro({
        situacao: String(c['situacao']),
        propostoPor: c['criado_por'] === null ? null : numero(c['criado_por']),
        aprovador: usuario,
      }) ?? {},
    );
    const data = dataIso(c['data_operacao']) ?? new Date().toISOString().slice(0, 10);
    await exigirPeriodoAberto(tx, est, data, 'data');
    const itens = await tx.consultar(
      'SELECT id, versao, natureza, parcela_pagar_id, parcela_receber_id, valor_compensado FROM encontro_contas_item WHERE encontro_contas_id = ? AND excluido_em IS NULL ORDER BY sequencia',
      [e.encontro],
    );
    const titulosPagar = new Set<number>();
    const titulosReceber = new Map<number, number>();
    for (const it of itens) {
      const v = numero(it['valor_compensado']);
      const pagar = it['natureza'] === 'pagar';
      const tabela = pagar ? 'parcela_pagar' : 'parcela_receber';
      const pid = numero(it[pagar ? 'parcela_pagar_id' : 'parcela_receber_id']);
      const acumulado = pagar ? 'valor_pago' : 'valor_recebido';
      const [p] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, saldo, ${acumulado} AS acumulado, ${pagar ? 'titulo_pagar_id' : 'titulo_receber_id'} AS titulo
           FROM ${tabela} WHERE id = ? AND excluido_em IS NULL`,
        [pid],
        { teto: 1 },
      );
      if (!p || !['aberta', 'parcial'].includes(String(p['situacao'])) || numero(p['saldo']) < v)
        throw recusa(
          'parcela-mudou',
          'Uma parcela do encontro foi baixada por outra via: refaça a proposta.',
        );
      const saldo = centavos(numero(p['saldo']) - v);
      await tx.alterar(tabela, pid, numero(p['versao']), {
        [acumulado]: centavos(numero(p['acumulado']) + v),
        saldo,
        situacao: saldo > 0 ? 'parcial' : pagar ? 'paga' : 'recebida',
        quitada_em: saldo > 0 ? null : data,
      });
      if (pagar) {
        const baixa = await tx.incluir('baixa_titulo', {
          estabelecimento_id: est,
          parcela_pagar_id: pid,
          data_pagamento: data,
          forma_pagamento: 'encontro_contas',
          valor_principal: v,
          valor_pago: v,
          observacao: `Encontro de contas ${e.encontro}`,
        });
        await tx.alterar('encontro_contas_item', numero(it['id']), numero(it['versao']), {
          baixa_titulo_id: baixa,
        });
        titulosPagar.add(numero(p['titulo']));
      } else {
        const t = numero(p['titulo']);
        titulosReceber.set(t, centavos((titulosReceber.get(t) ?? 0) + v));
      }
    }
    for (const t of titulosPagar) {
      const [r] = await tx.consultarParaAtualizar(
        `SELECT t.versao, SUM(p.saldo > 0) AS abertas FROM titulo_pagar t
           JOIN parcela_pagar p ON p.titulo_pagar_id = t.id AND p.excluido_em IS NULL
          WHERE t.id = ? GROUP BY t.id, t.versao`,
        [t],
        { teto: 1 },
      );
      if (r)
        await tx.alterar('titulo_pagar', t, numero(r['versao']), {
          situacao: numero(r['abertas']) > 0 ? 'pago_parcial' : 'pago',
        });
    }
    for (const [t, v] of titulosReceber) {
      const [r] = await tx.consultarParaAtualizar(
        `SELECT t.versao, t.valor_recebido, SUM(p.saldo > 0) AS abertas FROM titulo_receber t
           JOIN parcela_receber p ON p.titulo_receber_id = t.id AND p.excluido_em IS NULL
          WHERE t.id = ? GROUP BY t.id, t.versao, t.valor_recebido`,
        [t],
        { teto: 1 },
      );
      if (r)
        await tx.alterar('titulo_receber', t, numero(r['versao']), {
          valor_recebido: centavos(numero(r['valor_recebido']) + v),
          situacao: numero(r['abertas']) > 0 ? 'recebido_parcial' : 'recebido',
        });
    }
    const agora = new Date();
    await tx.alterar('encontro_contas', e.encontro, numero(c['versao']), {
      situacao: 'efetivado',
      aprovado_por_usuario_id: usuario,
      aprovado_em: agora,
      efetivado_em: agora,
    });
    return { encontro: e.encontro, itens: itens.length, situacao: 'efetivado' };
  },
  alvo: (e) => ({ tabela: 'encontro_contas', id: e.encontro }),
});

const cancelarEncontro = definirOperacao<z.infer<typeof esquemaCancelarEncontro>, ResultadoOperacao>({
  nome: 'financeiro.cancelar_encontro_contas',
  tabelas: ['encontro_contas'],
  entrada: esquemaCancelarEncontro as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [c] = await tx.consultarParaAtualizar(
      'SELECT id, versao, situacao FROM encontro_contas WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.encontro, est],
      { teto: 1 },
    );
    if (!c) throw recusa('encontro-inexistente', 'O encontro de contas não existe neste estabelecimento.');
    recusar(conferirCancelamentoEncontro({ situacao: String(c['situacao']), motivo: e.motivo }) ?? {});
    await tx.alterar('encontro_contas', e.encontro, numero(c['versao']), {
      situacao: 'cancelado',
      motivo: e.motivo,
    });
    return { encontro: e.encontro, situacao: 'cancelado' };
  },
  alvo: (e) => ({ tabela: 'encontro_contas', id: e.encontro }),
  trilha: (e) => ({ motivo: e.motivo }),
});

// ── Previsão de pagamentos ─────────────────────────────────────────────────────────────────────────────────────

export const esquemaCriarPrevisao = z
  .object({
    descricao: z.string().trim().min(3).max(150),
    tipo: z.enum(['despesa', 'receita']),
    natureza: id,
    centroCusto: id.optional(),
    fornecedor: id.optional(),
    fontePagadora: id.optional(),
    contaBancaria: id.optional(),
    valor,
    periodicidade: z.enum(PERIODICIDADES),
    diaVencimento: z.number().int().min(1).max(31).optional(),
    dataInicio: DATA,
    dataFim: DATA.optional(),
    ajuste: z.enum(['antecipar', 'postergar', 'manter']).default('postergar'),
    observacao: z.string().trim().max(500).optional(),
  })
  .strict();
export const esquemaRealizarPrevisao = z.object({ ocorrencia: id, tituloPagar: id }).strict();

const criarPrevisao = definirOperacao<z.infer<typeof esquemaCriarPrevisao>, ResultadoOperacao>({
  nome: 'financeiro.criar_previsao_financeira',
  tabelas: ['previsao_financeira', 'parcela_previsao_financeira'],
  entrada: esquemaCriarPrevisao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const nat = await tx.uma('SELECT tipo FROM natureza_financeira WHERE id = ? AND excluido_em IS NULL', [
      e.natureza,
    ]);
    if (!nat) throw recusa('natureza-inexistente', 'Escolha a natureza da lista.', { campos: ['natureza'] });
    if (String(nat['tipo']) !== e.tipo)
      throw recusa('natureza-de-outro-tipo', `A natureza escolhida não é de ${e.tipo}.`, {
        campos: ['natureza'],
      });
    const ocorrencias = recusar(
      gerarOcorrenciasPrevisao({
        periodicidade: e.periodicidade,
        dataInicio: e.dataInicio,
        dataFim: e.dataFim ?? null,
        diaVencimento: e.diaVencimento ?? null,
        valor: e.valor,
        ajuste: e.ajuste,
      }),
    );
    const previsao = await tx.incluir('previsao_financeira', {
      estabelecimento_id: est,
      descricao: e.descricao,
      tipo: e.tipo,
      natureza_financeira_id: e.natureza,
      centro_custo_id: e.centroCusto ?? null,
      empresa_fornecedora_id: e.tipo === 'despesa' ? (e.fornecedor ?? null) : null,
      fonte_pagadora_id: e.tipo === 'receita' ? (e.fontePagadora ?? null) : null,
      conta_bancaria_id: e.contaBancaria ?? null,
      valor_previsto: e.valor,
      periodicidade: e.periodicidade,
      dia_vencimento: e.diaVencimento ?? null,
      data_inicio: e.dataInicio,
      data_fim: e.dataFim ?? null,
      ajuste_dia_nao_util: e.ajuste,
      observacao: e.observacao || null,
    });
    for (const o of ocorrencias)
      await tx.incluir('parcela_previsao_financeira', {
        previsao_financeira_id: previsao,
        sequencia: o.sequencia,
        competencia: o.competencia,
        data_esperada: o.dataEsperada,
        valor: o.valor,
      });
    return { previsao, ocorrencias: ocorrencias.length, total: centavos(e.valor * ocorrencias.length) };
  },
  alvo: (_e, r) => ({ tabela: 'previsao_financeira', id: numero(r['previsao']) || null }),
});

const realizarPrevisao = definirOperacao<z.infer<typeof esquemaRealizarPrevisao>, ResultadoOperacao>({
  nome: 'financeiro.realizar_previsao_financeira',
  tabelas: ['parcela_previsao_financeira', 'conciliacao_previsao_realizado'],
  entrada: esquemaRealizarPrevisao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const [o] = await tx.consultarParaAtualizar(
      `SELECT o.id, o.versao, o.situacao, o.valor, p.tipo FROM parcela_previsao_financeira o
         JOIN previsao_financeira p ON p.id = o.previsao_financeira_id
        WHERE o.id = ? AND p.estabelecimento_id = ? AND o.excluido_em IS NULL`,
      [e.ocorrencia, est],
      { teto: 1 },
    );
    if (!o) throw recusa('previsao-inexistente', 'A ocorrência prevista não existe neste estabelecimento.');
    if (o['tipo'] !== 'despesa')
      throw recusa('previsao-de-receita', 'A previsão de receita se realiza pelo título a receber.');
    const t = await tx.uma(
      "SELECT id, valor_liquido FROM titulo_pagar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'",
      [e.tituloPagar, est],
    );
    if (!t) throw recusa('titulo-inexistente', 'O título a pagar não existe.', { campos: ['tituloPagar'] });
    const { diferenca } = recusar(
      conciliarPrevistoRealizado({
        situacao: String(o['situacao']),
        previsto: numero(o['valor']),
        realizado: numero(t['valor_liquido']),
      }),
    );
    const hoje = new Date();
    await tx.alterar('parcela_previsao_financeira', e.ocorrencia, numero(o['versao']), {
      situacao: 'realizada',
      realizada_em: hoje.toISOString().slice(0, 10),
      titulo_pagar_id: e.tituloPagar,
    });
    const conciliacao = await tx.incluir('conciliacao_previsao_realizado', {
      parcela_previsao_financeira_id: e.ocorrencia,
      titulo_pagar_id: e.tituloPagar,
      valor_previsto: numero(o['valor']),
      valor_realizado: numero(t['valor_liquido']),
      diferenca,
      conciliado_em: hoje,
      usuario_id: usuario,
    });
    return { ocorrencia: e.ocorrencia, conciliacao, diferenca };
  },
  alvo: (e) => ({ tabela: 'parcela_previsao_financeira', id: e.ocorrencia }),
});

// ── Provisão do passivo ────────────────────────────────────────────────────────────────────────────────────────

export const esquemaProvisionar = z
  .object({
    tipo: z.enum(TIPOS_PROVISAO),
    competencia: z.string().regex(/^\d{4}-\d{2}-01$/),
    descricao: z.string().trim().min(3).max(300),
    contaContabil: id,
    centroCusto: id.optional(),
    profissional: id.optional(),
    fornecedor: id.optional(),
    fontePagadora: id.optional(),
    baseCalculo: valor.optional(),
    valor,
  })
  .strict();
export const esquemaLiquidarProvisao = z.object({ provisao: id, tituloPagar: id }).strict();
export const esquemaReverterProvisao = z
  .object({ provisao: id, valor, motivo: z.string().trim().min(5).max(500), data: DATA })
  .strict();

const provisionar = definirOperacao<z.infer<typeof esquemaProvisionar>, ResultadoOperacao>({
  nome: 'financeiro.provisionar_passivo',
  tabelas: ['provisao_passivo'],
  entrada: esquemaProvisionar as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    await exigirPeriodoAberto(tx, est, e.competencia, 'competencia');
    const conta = await tx.uma('SELECT id FROM conta_contabil WHERE id = ? AND ativo = TRUE', [
      e.contaContabil,
    ]);
    if (!conta)
      throw recusa('conta-inexistente', 'Escolha a conta contábil do passivo.', {
        campos: ['contaContabil'],
      });
    if (e.tipo === 'honorario_medico' && !e.profissional)
      throw recusa('profissional-obrigatorio', 'O honorário provisionado exige o profissional.', {
        campos: ['profissional'],
      });
    const provisao = await tx.incluir('provisao_passivo', {
      estabelecimento_id: est,
      tipo: e.tipo,
      competencia: e.competencia,
      descricao: e.descricao,
      conta_contabil_id: e.contaContabil,
      centro_custo_id: e.centroCusto ?? null,
      base_calculo: e.baseCalculo ?? null,
      valor_provisionado: e.valor,
      saldo: e.valor,
      situacao: 'provisionada',
      profissional_id: e.profissional ?? null,
      empresa_fornecedora_id: e.fornecedor ?? null,
      fonte_pagadora_id: e.fontePagadora ?? null,
    });
    return { provisao, saldo: e.valor };
  },
  alvo: (_e, r) => ({ tabela: 'provisao_passivo', id: numero(r['provisao']) || null }),
});

async function provisaoTravada(tx: TxOperacao, provisao: number, est: number) {
  const [p] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, valor_provisionado, valor_baixado, valor_revertido, saldo
       FROM provisao_passivo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [provisao, est],
    { teto: 1 },
  );
  if (!p) throw recusa('provisao-inexistente', 'A provisão não existe neste estabelecimento.');
  return {
    p,
    v: {
      valorProvisionado: numero(p['valor_provisionado']),
      valorBaixado: numero(p['valor_baixado']),
      valorRevertido: numero(p['valor_revertido']),
      situacao: String(p['situacao']),
    },
  };
}

const liquidar = definirOperacao<z.infer<typeof esquemaLiquidarProvisao>, ResultadoOperacao>({
  nome: 'financeiro.liquidar_provisao_passivo',
  tabelas: ['provisao_passivo', 'conciliacao_previsao_realizado'],
  entrada: esquemaLiquidarProvisao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const { p, v } = await provisaoTravada(tx, e.provisao, est);
    const t = await tx.uma(
      "SELECT id, valor_liquido FROM titulo_pagar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'",
      [e.tituloPagar, est],
    );
    if (!t) throw recusa('titulo-inexistente', 'O título a pagar não existe.', { campos: ['tituloPagar'] });
    const saldoAntes = numero(p['saldo']);
    const r = recusar(liquidarProvisao(v, numero(t['valor_liquido'])));
    await tx.alterar('provisao_passivo', e.provisao, numero(p['versao']), {
      valor_baixado: r.valorBaixado,
      saldo: r.saldo,
      situacao: r.situacao,
      titulo_pagar_id: e.tituloPagar,
    });
    const conciliacao = await tx.incluir('conciliacao_previsao_realizado', {
      provisao_passivo_id: e.provisao,
      titulo_pagar_id: e.tituloPagar,
      valor_previsto: saldoAntes,
      valor_realizado: numero(t['valor_liquido']),
      diferenca: r.diferenca,
      conciliado_em: new Date(),
      usuario_id: usuario,
    });
    return {
      provisao: e.provisao,
      saldo: r.saldo,
      situacao: r.situacao,
      diferenca: r.diferenca,
      conciliacao,
    };
  },
  alvo: (e) => ({ tabela: 'provisao_passivo', id: e.provisao }),
});

const reverter = definirOperacao<z.infer<typeof esquemaReverterProvisao>, ResultadoOperacao>({
  nome: 'financeiro.reverter_provisao_passivo',
  tabelas: ['provisao_passivo', 'ajuste_provisao_passivo'],
  entrada: esquemaReverterProvisao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    await exigirPeriodoAberto(tx, est, e.data, 'data');
    const { p, v } = await provisaoTravada(tx, e.provisao, est);
    const r = recusar(reverterProvisao(v, e.valor, e.motivo));
    const seq = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM ajuste_provisao_passivo WHERE provisao_passivo_id = ?',
      [e.provisao],
    );
    const ajuste = await tx.incluir('ajuste_provisao_passivo', {
      provisao_passivo_id: e.provisao,
      sequencia: numero(seq?.['s']) || 1,
      tipo: 'reversao_parcial',
      data_ajuste: e.data,
      valor: e.valor,
      motivo: e.motivo,
    });
    await tx.alterar('provisao_passivo', e.provisao, numero(p['versao']), {
      valor_revertido: r.valorRevertido,
      saldo: r.saldo,
      situacao: r.situacao,
      revertida_em: r.situacao === 'revertida' ? e.data : null,
    });
    return { provisao: e.provisao, ajuste, saldo: r.saldo, situacao: r.situacao };
  },
  alvo: (e) => ({ tabela: 'provisao_passivo', id: e.provisao }),
  trilha: (e) => ({ motivo: e.motivo }),
});

/** As operações desta parte, pelo nome da tela. */
export const OPERACOES_COMPENSACAO_PREVISAO = {
  'financeiro.proporEncontroContas': proporEncontro,
  'financeiro.efetivarEncontroContas': efetivarEncontro,
  'financeiro.cancelarEncontroContas': cancelarEncontro,
  'financeiro.criarPrevisaoFinanceira': criarPrevisao,
  'financeiro.realizarPrevisaoFinanceira': realizarPrevisao,
  'financeiro.provisionarPassivo': provisionar,
  'financeiro.liquidarProvisaoPassivo': liquidar,
  'financeiro.reverterProvisaoPassivo': reverter,
} as const;

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Parceiros que são fornecedor e devedor ao mesmo tempo (mesmo CNPJ ou CPF), com parcelas em aberto dos dois lados. */
export async function parceirosComEncontro(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT f.id, f.razao_social AS nome,
            (SELECT COALESCE(SUM(p.saldo), 0) FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
              WHERE t.empresa_fornecedora_id = f.id AND t.estabelecimento_id = ? AND p.excluido_em IS NULL
                AND p.situacao IN ('aberta','parcial') AND p.saldo > 0) AS pagar,
            (SELECT COALESCE(SUM(p.saldo), 0) FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id
               JOIN cliente_financeiro c ON c.id = t.cliente_financeiro_id
              WHERE (c.cnpj = f.cnpj OR c.cpf = f.cpf) AND t.estabelecimento_id = ? AND p.excluido_em IS NULL
                AND p.situacao IN ('aberta','parcial') AND p.saldo > 0) AS receber
       FROM empresa_fornecedora f
      WHERE (f.cnpj IS NOT NULL OR f.cpf IS NOT NULL)
        AND EXISTS (SELECT 1 FROM cliente_financeiro c WHERE c.excluido_em IS NULL AND (c.cnpj = f.cnpj OR c.cpf = f.cpf))
      ORDER BY f.razao_social LIMIT 200`,
    [est, est],
  );
  return linhas
    .map((r) => ({
      id: numero(r['id']),
      nome: String(r['nome']),
      pagar: numero(r['pagar']),
      receber: numero(r['receber']),
    }))
    .filter((r) => r.pagar > 0 && r.receber > 0);
}

/** As parcelas em aberto dos dois lados do parceiro, com a marca de "já em outro encontro pendente". */
export async function parcelasDoParceiro(l: Leitor, est: number, fornecedor: number) {
  const ocupada = (col: string) =>
    `EXISTS (SELECT 1 FROM encontro_contas_item i JOIN encontro_contas e ON e.id = i.encontro_contas_id
              WHERE i.${col} = p.id AND i.excluido_em IS NULL AND e.situacao IN ${PENDENTE})`;
  const pagar = await l.consultar(
    `SELECT p.id, t.numero, t.numero_documento, p.sequencia, p.vencimento, p.saldo, ${ocupada('parcela_pagar_id')} AS ocupada
       FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
      WHERE t.empresa_fornecedora_id = ? AND t.estabelecimento_id = ? AND p.excluido_em IS NULL AND t.excluido_em IS NULL
        AND p.situacao IN ('aberta','parcial') AND p.saldo > 0
      ORDER BY p.vencimento, p.id LIMIT 200`,
    [fornecedor, est],
  );
  const receber = await l.consultar(
    `SELECT p.id, t.numero, t.numero_documento, p.sequencia, p.vencimento, p.saldo, ${ocupada('parcela_receber_id')} AS ocupada
       FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id
       JOIN cliente_financeiro c ON c.id = t.cliente_financeiro_id
       JOIN empresa_fornecedora f ON f.id = ? AND (c.cnpj = f.cnpj OR c.cpf = f.cpf)
      WHERE t.estabelecimento_id = ? AND p.excluido_em IS NULL AND t.excluido_em IS NULL
        AND p.situacao IN ('aberta','parcial') AND p.saldo > 0
      ORDER BY p.vencimento, p.id LIMIT 200`,
    [fornecedor, est],
  );
  const mapa = (r: Record<string, unknown>) => ({
    id: numero(r['id']),
    titulo: String(r['numero'] ?? ''),
    documento: String(r['numero_documento'] ?? ''),
    parcela: numero(r['sequencia']),
    vencimento: dataIso(r['vencimento']) ?? '',
    saldo: numero(r['saldo']),
    emOutroEncontro: numero(r['ocupada']) > 0,
  });
  return { pagar: pagar.map(mapa), receber: receber.map(mapa) };
}

export async function encontrosDoEstabelecimento(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT e.id, e.numero, e.data_operacao, e.situacao, e.total_pagar, e.total_receber, e.saldo_liquido, e.criado_por,
            f.razao_social AS parceiro, e.motivo,
            (SELECT COALESCE(SUM(i.valor_compensado), 0) FROM encontro_contas_item i
              WHERE i.encontro_contas_id = e.id AND i.natureza = 'pagar' AND i.excluido_em IS NULL) AS compensado
       FROM encontro_contas e LEFT JOIN empresa_fornecedora f ON f.id = e.empresa_fornecedora_id
      WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL ORDER BY e.id DESC LIMIT 100`,
    [est],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    numero: String(r['numero']),
    data: dataIso(r['data_operacao']) ?? '',
    situacao: String(r['situacao']),
    parceiro: String(r['parceiro'] ?? ''),
    totalPagar: numero(r['total_pagar']),
    totalReceber: numero(r['total_receber']),
    saldoLiquido: numero(r['saldo_liquido']),
    compensado: numero(r['compensado']),
    propostoPor: r['criado_por'] === null ? null : numero(r['criado_por']),
    motivo: r['motivo'] === null ? null : String(r['motivo']),
  }));
}

/** Previsto × realizado por ocorrência, no período (data esperada). */
export async function previstoRealizado(l: Leitor, est: number, de: string, ate: string) {
  const linhas = await l.consultar(
    `SELECT o.id, p.descricao, p.tipo, o.competencia, o.data_esperada, o.valor, o.situacao,
            c.valor_realizado, c.diferenca, t.numero AS titulo
       FROM parcela_previsao_financeira o JOIN previsao_financeira p ON p.id = o.previsao_financeira_id
       LEFT JOIN conciliacao_previsao_realizado c ON c.parcela_previsao_financeira_id = o.id AND c.excluido_em IS NULL
       LEFT JOIN titulo_pagar t ON t.id = o.titulo_pagar_id
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND o.excluido_em IS NULL
        AND o.data_esperada BETWEEN ? AND ?
      ORDER BY o.data_esperada, o.id LIMIT 500`,
    [est, de, ate],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    descricao: String(r['descricao']),
    tipo: String(r['tipo']),
    competencia: dataIso(r['competencia']) ?? '',
    dataEsperada: dataIso(r['data_esperada']) ?? '',
    previsto: numero(r['valor']),
    situacao: String(r['situacao']),
    realizado: r['valor_realizado'] === null ? null : numero(r['valor_realizado']),
    diferenca: r['diferenca'] === null ? null : numero(r['diferenca']),
    titulo: r['titulo'] === null ? null : String(r['titulo']),
  }));
}

export async function provisoesDoEstabelecimento(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT p.id, p.tipo, p.competencia, p.descricao, p.valor_provisionado, p.valor_baixado, p.valor_revertido,
            p.saldo, p.situacao, c.classificacao AS conta
       FROM provisao_passivo p JOIN conta_contabil c ON c.id = p.conta_contabil_id
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL ORDER BY p.competencia DESC, p.id DESC LIMIT 200`,
    [est],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    tipo: String(r['tipo']),
    competencia: dataIso(r['competencia']) ?? '',
    descricao: String(r['descricao']),
    conta: String(r['conta']),
    provisionado: numero(r['valor_provisionado']),
    baixado: numero(r['valor_baixado']),
    revertido: numero(r['valor_revertido']),
    saldo: numero(r['saldo']),
    situacao: String(r['situacao']),
  }));
}

/** Os cadastros que as telas de previsão e provisão oferecem nas listas. */
export async function apoiosPrevisao(l: Leitor) {
  const naturezas = await l.consultar(
    'SELECT id, codigo, descricao, tipo FROM natureza_financeira WHERE excluido_em IS NULL ORDER BY codigo LIMIT 500',
    [],
  );
  const contas = await l.consultar(
    "SELECT id, classificacao, descricao FROM conta_contabil WHERE ativo = TRUE AND excluido_em IS NULL AND natureza = 'passivo' ORDER BY classificacao LIMIT 500",
    [],
  );
  return {
    naturezas: naturezas.map((r) => ({
      id: numero(r['id']),
      rotulo: `${String(r['codigo'])} ${String(r['descricao'])}`,
      tipo: String(r['tipo']),
    })),
    contas: contas.map((r) => ({
      id: numero(r['id']),
      rotulo: `${String(r['classificacao'])} ${String(r['descricao'])}`,
    })),
  };
}
