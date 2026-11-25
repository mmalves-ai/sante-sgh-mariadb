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
  alcadaAplicavel,
  conciliarPrevistoRealizado,
  conferirAprovacaoEncontro,
  conferirCancelamentoEncontro,
  conferirCancelamentoOcorrencia,
  conferirEncerramentoPrevisao,
  conferirEstornoEncontro,
  conferirLadoRealizacao,
  conferirPagamento,
  conferirTituloConciliacao,
  conferirTituloReceberConciliacao,
  desfazerCompensacaoParcela,
  estenderPrevisao,
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
import { dataIso, numero, tipoCredorDe } from './vocabulario.js';

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
export const esquemaEstornarEncontro = z
  .object({ encontro: id, motivo: z.string().trim().min(5).max(280) })
  .strict();

/**
 * A alçada do título a pagar vale também na compensação (07-FIN linha 64): cada título do lado a pagar precisa da
 * faixa cumprida (aprovações registradas), e quem efetiva não pode ser quem lançou nem quem aprovou o título. Os
 * leitores da alçada moram em operacoes.ts, que importa este arquivo: a importação é tardia para não criar ciclo na
 * carga dos módulos.
 */
async function exigirAlcadaDosTitulos(
  tx: TxOperacao,
  est: number,
  usuario: number,
  titulos: readonly number[],
  data: string,
): Promise<void> {
  if (titulos.length === 0) return;
  const alc = await import('./operacoes.js');
  const faixas = await alc.faixasLidas(tx, est);
  const pagador = (await alc.loginDe(tx, usuario)) ?? '';
  const aprovacoes = await alc.aprovacoesPorTitulo(tx, est, titulos);
  for (const titulo of titulos) {
    const t = await tx.uma(
      `SELECT t.valor_bruto, t.criado_por, t.centro_custo_id, tc.codigo AS tipo_codigo, tc.natureza
         FROM titulo_pagar t JOIN tipo_credor tc ON tc.id = t.tipo_credor_id WHERE t.id = ?`,
      [titulo],
    );
    if (!t) throw recusa('titulo-inexistente', 'O título a pagar do encontro não existe.');
    const faixa = alcadaAplicavel(
      faixas,
      {
        empresa: 1,
        centroCusto: await alc.centroDaAlcada(tx, titulo, t['centro_custo_id']),
        tipo: tipoCredorDe(t['tipo_codigo'], t['natureza']),
        valor: numero(t['valor_bruto']),
      },
      data,
    );
    recusar(
      conferirPagamento({
        faixa,
        aprovacoes: aprovacoes.get(titulo) ?? [],
        pagador,
        lancador: await alc.loginDe(tx, t['criado_por']),
      }) ?? {},
    );
  }
}

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
    const idsPagar = itens.filter((i) => i['natureza'] === 'pagar').map((i) => numero(i['parcela_pagar_id']));
    const titulosDaAlcada = idsPagar.length
      ? (
          await tx.consultar(
            `SELECT DISTINCT titulo_pagar_id AS t FROM parcela_pagar WHERE id IN (${idsPagar.map(() => '?').join(',')}) ORDER BY 1`,
            idsPagar,
          )
        ).map((r) => numero(r['t']))
      : [];
    await exigirAlcadaDosTitulos(tx, est, usuario, titulosDaAlcada, data);
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

const estornarEncontro = definirOperacao<z.infer<typeof esquemaEstornarEncontro>, ResultadoOperacao>({
  nome: 'financeiro.estornar_encontro_contas',
  tabelas: [
    'encontro_contas',
    'baixa_titulo',
    'parcela_pagar',
    'titulo_pagar',
    'parcela_receber',
    'titulo_receber',
  ],
  entrada: esquemaEstornarEncontro as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const [c] = await tx.consultarParaAtualizar(
      'SELECT id, versao, situacao FROM encontro_contas WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.encontro, est],
      { teto: 1 },
    );
    if (!c) throw recusa('encontro-inexistente', 'O encontro de contas não existe neste estabelecimento.');
    recusar(conferirEstornoEncontro({ situacao: String(c['situacao']), motivo: e.motivo }) ?? {});
    const agora = new Date();
    await exigirPeriodoAberto(tx, est, agora.toISOString().slice(0, 10), 'data');
    const itens = await tx.consultar(
      'SELECT natureza, parcela_pagar_id, parcela_receber_id, valor_compensado, baixa_titulo_id FROM encontro_contas_item WHERE encontro_contas_id = ? AND excluido_em IS NULL ORDER BY sequencia',
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
      if (!p)
        throw recusa('parcela-mudou', 'Uma parcela do encontro não existe mais: confira antes de estornar.');
      const d = recusar(
        desfazerCompensacaoParcela({
          situacao: String(p['situacao']),
          saldo: numero(p['saldo']),
          acumulado: numero(p['acumulado']),
          compensado: v,
        }),
      );
      await tx.alterar(tabela, pid, numero(p['versao']), {
        [acumulado]: d.acumulado,
        saldo: d.saldo,
        situacao: d.situacao,
        quitada_em: null,
      });
      if (pagar) {
        const [b] = await tx.consultarParaAtualizar(
          "SELECT id, versao FROM baixa_titulo WHERE id = ? AND situacao = 'efetivada' AND excluido_em IS NULL",
          [numero(it['baixa_titulo_id'])],
          { teto: 1 },
        );
        if (!b)
          throw recusa('baixa-ja-estornada', 'A baixa do encontro já foi estornada por outra via: releia.');
        await tx.alterar('baixa_titulo', numero(b['id']), numero(b['versao']), {
          situacao: 'estornada',
          estornado_em: agora,
          estornador_usuario_id: usuario,
          motivo_estorno: `Estorno do encontro de contas: ${e.motivo}`.slice(0, 300),
        });
        titulosPagar.add(numero(p['titulo']));
      } else {
        const t = numero(p['titulo']);
        titulosReceber.set(t, centavos((titulosReceber.get(t) ?? 0) + v));
      }
    }
    for (const t of titulosPagar) {
      const [r] = await tx.consultarParaAtualizar(
        `SELECT t.versao, SUM(p.valor_pago > 0) AS pagas, SUM(p.saldo > 0) AS abertas FROM titulo_pagar t
           JOIN parcela_pagar p ON p.titulo_pagar_id = t.id AND p.excluido_em IS NULL
          WHERE t.id = ? GROUP BY t.id, t.versao`,
        [t],
        { teto: 1 },
      );
      if (r)
        await tx.alterar('titulo_pagar', t, numero(r['versao']), {
          situacao: numero(r['pagas']) > 0 ? (numero(r['abertas']) > 0 ? 'pago_parcial' : 'pago') : 'aberto',
        });
    }
    for (const [t, v] of titulosReceber) {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT versao, valor_recebido FROM titulo_receber WHERE id = ?',
        [t],
        { teto: 1 },
      );
      if (r) {
        const recebido = Math.max(0, centavos(numero(r['valor_recebido']) - v));
        await tx.alterar('titulo_receber', t, numero(r['versao']), {
          valor_recebido: recebido,
          situacao: recebido > 0 ? 'recebido_parcial' : 'aberto',
        });
      }
    }
    await tx.alterar('encontro_contas', e.encontro, numero(c['versao']), {
      situacao: 'cancelado',
      motivo: `Estorno: ${e.motivo}`.slice(0, 500),
    });
    return { encontro: e.encontro, itens: itens.length, situacao: 'cancelado', estornado: true };
  },
  alvo: (e) => ({ tabela: 'encontro_contas', id: e.encontro }),
  trilha: (e) => ({ motivo: e.motivo }),
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
/** A despesa se realiza pelo título a pagar; a receita, pelo título a receber (um dos dois, conferido no domínio). */
export const esquemaRealizarPrevisao = z
  .object({ ocorrencia: id, tituloPagar: id.optional(), tituloReceber: id.optional() })
  .strict();
export const esquemaEstenderPrevisao = z.object({ previsao: id }).strict();
export const esquemaCancelarOcorrencia = z
  .object({ ocorrencia: id, motivo: z.string().trim().min(5).max(500) })
  .strict();
export const esquemaEncerrarPrevisao = z
  .object({ previsao: id, data: DATA, motivo: z.string().trim().min(5).max(500) })
  .strict();

/** O título a pagar que concilia: existe, não está cancelado, não conciliou outra coisa e é do credor esperado. */
async function tituloParaConciliar(
  tx: TxOperacao,
  est: number,
  titulo: number,
  esperado: { fornecedor: number | null; profissional: number | null },
  /** Conferência do alvo (ocorrência ou provisão) com o valor do título, antes da do título. */
  antes: (valorTitulo: number) => void,
) {
  const t = await tx.uma(
    "SELECT id, valor_liquido, empresa_fornecedora_id, profissional_id FROM titulo_pagar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'",
    [titulo, est],
  );
  if (!t) throw recusa('titulo-inexistente', 'O título a pagar não existe.', { campos: ['tituloPagar'] });
  antes(numero(t['valor_liquido']));
  const ja = await tx.uma(
    'SELECT id FROM conciliacao_previsao_realizado WHERE titulo_pagar_id = ? AND excluido_em IS NULL LIMIT 1',
    [titulo],
  );
  const ou = (v: unknown) => (v === null || v === undefined ? null : numero(v));
  recusar(
    conferirTituloConciliacao({
      jaConciliado: !!ja,
      esperado,
      titulo: { fornecedor: ou(t['empresa_fornecedora_id']), profissional: ou(t['profissional_id']) },
    }) ?? {},
  );
  return t;
}

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

/** Realiza a ocorrência de receita pelo título a receber: mesma fonte pagadora, título ainda não conciliado. */
async function realizarPorReceber(
  tx: TxOperacao,
  o: Record<string, unknown>,
  ocorrencia: number,
  titulo: number,
  est: number,
  usuario: number,
) {
  const t = await tx.uma(
    "SELECT id, valor_liquido, fonte_pagadora_id FROM titulo_receber WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao NOT IN ('cancelado','renegociado')",
    [titulo, est],
  );
  if (!t) throw recusa('titulo-inexistente', 'O título a receber não existe.', { campos: ['tituloReceber'] });
  const { diferenca } = recusar(
    conciliarPrevistoRealizado({
      situacao: String(o['situacao']),
      previsto: numero(o['valor']),
      realizado: numero(t['valor_liquido']),
    }),
  );
  const ja = await tx.uma(
    'SELECT id FROM conciliacao_previsao_realizado WHERE titulo_receber_id = ? AND excluido_em IS NULL LIMIT 1',
    [titulo],
  );
  const fonte = (v: unknown) => (v === null || v === undefined ? null : numero(v));
  recusar(
    conferirTituloReceberConciliacao({
      jaConciliado: !!ja,
      fonteEsperada: fonte(o['fonte_pagadora_id']),
      fonteTitulo: fonte(t['fonte_pagadora_id']),
    }) ?? {},
  );
  const hoje = new Date();
  await tx.alterar('parcela_previsao_financeira', ocorrencia, numero(o['versao']), {
    situacao: 'realizada',
    realizada_em: hoje.toISOString().slice(0, 10),
    titulo_receber_id: titulo,
  });
  const conciliacao = await tx.incluir('conciliacao_previsao_realizado', {
    parcela_previsao_financeira_id: ocorrencia,
    titulo_receber_id: titulo,
    valor_previsto: numero(o['valor']),
    valor_realizado: numero(t['valor_liquido']),
    diferenca,
    conciliado_em: hoje,
    usuario_id: usuario,
  });
  return { ocorrencia, conciliacao, diferenca };
}

const realizarPrevisao = definirOperacao<z.infer<typeof esquemaRealizarPrevisao>, ResultadoOperacao>({
  nome: 'financeiro.realizar_previsao_financeira',
  tabelas: ['parcela_previsao_financeira', 'conciliacao_previsao_realizado'],
  entrada: esquemaRealizarPrevisao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = usuarioDe(ctx);
    const [o] = await tx.consultarParaAtualizar(
      `SELECT o.id, o.versao, o.situacao, o.valor, p.tipo, p.empresa_fornecedora_id, p.fonte_pagadora_id
         FROM parcela_previsao_financeira o
         JOIN previsao_financeira p ON p.id = o.previsao_financeira_id
        WHERE o.id = ? AND p.estabelecimento_id = ? AND o.excluido_em IS NULL`,
      [e.ocorrencia, est],
      { teto: 1 },
    );
    if (!o) throw recusa('previsao-inexistente', 'A ocorrência prevista não existe neste estabelecimento.');
    recusar(
      conferirLadoRealizacao({
        tipo: String(o['tipo']),
        tituloPagar: e.tituloPagar !== undefined,
        tituloReceber: e.tituloReceber !== undefined,
      }) ?? {},
    );
    const hojeIso = new Date().toISOString().slice(0, 10);
    await exigirPeriodoAberto(tx, est, hojeIso, 'data');
    if (e.tituloReceber !== undefined)
      return realizarPorReceber(tx, o, e.ocorrencia, e.tituloReceber, est, usuario);
    const tituloPagar = e.tituloPagar as number;
    let diferenca = 0;
    const t = await tituloParaConciliar(
      tx,
      est,
      tituloPagar,
      {
        fornecedor: o['empresa_fornecedora_id'] === null ? null : numero(o['empresa_fornecedora_id']),
        profissional: null,
      },
      (realizado) => {
        ({ diferenca } = recusar(
          conciliarPrevistoRealizado({
            situacao: String(o['situacao']),
            previsto: numero(o['valor']),
            realizado,
          }),
        ));
      },
    );
    const hoje = new Date();
    await tx.alterar('parcela_previsao_financeira', e.ocorrencia, numero(o['versao']), {
      situacao: 'realizada',
      realizada_em: hoje.toISOString().slice(0, 10),
      titulo_pagar_id: tituloPagar,
    });
    const conciliacao = await tx.incluir('conciliacao_previsao_realizado', {
      parcela_previsao_financeira_id: e.ocorrencia,
      titulo_pagar_id: tituloPagar,
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

const estenderPrevisaoOp = definirOperacao<z.infer<typeof esquemaEstenderPrevisao>, ResultadoOperacao>({
  nome: 'financeiro.estender_previsao_financeira',
  tabelas: ['previsao_financeira', 'parcela_previsao_financeira'],
  entrada: esquemaEstenderPrevisao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [p] = await tx.consultarParaAtualizar(
      `SELECT id, versao, ativa, periodicidade, data_inicio, data_fim, dia_vencimento, valor_previsto, ajuste_dia_nao_util
         FROM previsao_financeira WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.previsao, est],
      { teto: 1 },
    );
    if (!p) throw recusa('previsao-inexistente', 'A previsão não existe neste estabelecimento.');
    const u = await tx.uma(
      'SELECT sequencia, data_esperada FROM parcela_previsao_financeira WHERE previsao_financeira_id = ? ORDER BY sequencia DESC LIMIT 1',
      [e.previsao],
    );
    const novas = recusar(
      estenderPrevisao({
        ativa: Number(p['ativa'] ?? 0) === 1 || p['ativa'] === true,
        periodicidade: String(p['periodicidade']) as (typeof PERIODICIDADES)[number],
        dataInicio: dataIso(p['data_inicio']) ?? '',
        dataFim: dataIso(p['data_fim']),
        diaVencimento: p['dia_vencimento'] === null ? null : numero(p['dia_vencimento']),
        valor: numero(p['valor_previsto']),
        ajuste: String(p['ajuste_dia_nao_util']) as 'antecipar' | 'postergar' | 'manter',
        ultimaSequencia: numero(u?.['sequencia']),
        ultimaData: dataIso(u?.['data_esperada']) ?? dataIso(p['data_inicio']) ?? '',
      }),
    );
    for (const o of novas)
      await tx.incluir('parcela_previsao_financeira', {
        previsao_financeira_id: e.previsao,
        sequencia: o.sequencia,
        competencia: o.competencia,
        data_esperada: o.dataEsperada,
        valor: o.valor,
      });
    return {
      previsao: e.previsao,
      ocorrencias: novas.length,
      ate: novas[novas.length - 1]?.dataEsperada ?? null,
    };
  },
  alvo: (e) => ({ tabela: 'previsao_financeira', id: e.previsao }),
});

const cancelarOcorrencia = definirOperacao<z.infer<typeof esquemaCancelarOcorrencia>, ResultadoOperacao>({
  nome: 'financeiro.cancelar_ocorrencia_previsao',
  tabelas: ['parcela_previsao_financeira'],
  entrada: esquemaCancelarOcorrencia as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [o] = await tx.consultarParaAtualizar(
      `SELECT o.id, o.versao, o.situacao FROM parcela_previsao_financeira o
         JOIN previsao_financeira p ON p.id = o.previsao_financeira_id
        WHERE o.id = ? AND p.estabelecimento_id = ? AND o.excluido_em IS NULL`,
      [e.ocorrencia, est],
      { teto: 1 },
    );
    if (!o) throw recusa('previsao-inexistente', 'A ocorrência prevista não existe neste estabelecimento.');
    recusar(conferirCancelamentoOcorrencia({ situacao: String(o['situacao']), motivo: e.motivo }) ?? {});
    await tx.alterar('parcela_previsao_financeira', e.ocorrencia, numero(o['versao']), {
      situacao: 'cancelada',
      motivo_cancelamento: e.motivo,
    });
    return { ocorrencia: e.ocorrencia, situacao: 'cancelada' };
  },
  alvo: (e) => ({ tabela: 'parcela_previsao_financeira', id: e.ocorrencia }),
  trilha: (e) => ({ motivo: e.motivo }),
});

const encerrarPrevisao = definirOperacao<z.infer<typeof esquemaEncerrarPrevisao>, ResultadoOperacao>({
  nome: 'financeiro.encerrar_previsao_financeira',
  tabelas: ['previsao_financeira', 'parcela_previsao_financeira'],
  entrada: esquemaEncerrarPrevisao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [p] = await tx.consultarParaAtualizar(
      'SELECT id, versao, ativa, data_inicio, observacao FROM previsao_financeira WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.previsao, est],
      { teto: 1 },
    );
    if (!p) throw recusa('previsao-inexistente', 'A previsão não existe neste estabelecimento.');
    recusar(
      conferirEncerramentoPrevisao({
        ativa: Number(p['ativa'] ?? 0) === 1 || p['ativa'] === true,
        dataInicio: dataIso(p['data_inicio']) ?? '',
        data: e.data,
        motivo: e.motivo,
      }) ?? {},
    );
    const abertas = await tx.consultarParaAtualizar(
      "SELECT id, versao FROM parcela_previsao_financeira WHERE previsao_financeira_id = ? AND situacao = 'aberta' AND data_esperada > ? AND excluido_em IS NULL",
      [e.previsao, e.data],
      { teto: 2000 },
    );
    for (const o of abertas)
      await tx.alterar('parcela_previsao_financeira', numero(o['id']), numero(o['versao']), {
        situacao: 'cancelada',
        motivo_cancelamento: `Encerramento da previsão em ${e.data}: ${e.motivo}`.slice(0, 500),
      });
    const obs = [p['observacao'] ? String(p['observacao']) : '', `Encerrada em ${e.data}: ${e.motivo}`]
      .filter(Boolean)
      .join(' | ')
      .slice(-500);
    await tx.alterar('previsao_financeira', e.previsao, numero(p['versao']), {
      ativa: false,
      data_fim: e.data,
      observacao: obs,
    });
    return { previsao: e.previsao, canceladas: abertas.length };
  },
  alvo: (e) => ({ tabela: 'previsao_financeira', id: e.previsao }),
  trilha: (e) => ({ motivo: e.motivo }),
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
    `SELECT id, versao, situacao, valor_provisionado, valor_baixado, valor_revertido, saldo, titulo_pagar_id,
            empresa_fornecedora_id, profissional_id
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
    await exigirPeriodoAberto(tx, est, new Date().toISOString().slice(0, 10), 'data');
    const { p, v } = await provisaoTravada(tx, e.provisao, est);
    const ou = (x: unknown) => (x === null || x === undefined ? null : numero(x));
    let mov: Exclude<ReturnType<typeof liquidarProvisao>, RecusaFinanceiro> | null = null;
    const t = await tituloParaConciliar(
      tx,
      est,
      e.tituloPagar,
      { fornecedor: ou(p['empresa_fornecedora_id']), profissional: ou(p['profissional_id']) },
      (valorTitulo) => {
        mov = recusar(liquidarProvisao(v, valorTitulo));
      },
    );
    const r = mov as unknown as Exclude<ReturnType<typeof liquidarProvisao>, RecusaFinanceiro>;
    // O vínculo do cabeçalho guarda o PRIMEIRO título; todos os títulos ficam nas linhas de conciliação.
    await tx.alterar('provisao_passivo', e.provisao, numero(p['versao']), {
      valor_baixado: r.valorBaixado,
      saldo: r.saldo,
      situacao: r.situacao,
      titulo_pagar_id: ou(p['titulo_pagar_id']) ?? e.tituloPagar,
    });
    const conciliacao = await tx.incluir('conciliacao_previsao_realizado', {
      provisao_passivo_id: e.provisao,
      titulo_pagar_id: e.tituloPagar,
      valor_previsto: r.previsto,
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
  'financeiro.estornarEncontroContas': estornarEncontro,
  'financeiro.criarPrevisaoFinanceira': criarPrevisao,
  'financeiro.realizarPrevisaoFinanceira': realizarPrevisao,
  'financeiro.estenderPrevisaoFinanceira': estenderPrevisaoOp,
  'financeiro.cancelarOcorrenciaPrevisao': cancelarOcorrencia,
  'financeiro.encerrarPrevisaoFinanceira': encerrarPrevisao,
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
    `SELECT o.id, o.previsao_financeira_id, p.descricao, p.tipo, p.ativa, o.competencia, o.data_esperada, o.valor,
            o.situacao, o.motivo_cancelamento, c.valor_realizado, c.diferenca, COALESCE(t.numero, r.numero) AS titulo
       FROM parcela_previsao_financeira o JOIN previsao_financeira p ON p.id = o.previsao_financeira_id
       LEFT JOIN conciliacao_previsao_realizado c ON c.parcela_previsao_financeira_id = o.id AND c.excluido_em IS NULL
       LEFT JOIN titulo_pagar t ON t.id = o.titulo_pagar_id
       LEFT JOIN titulo_receber r ON r.id = o.titulo_receber_id
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND o.excluido_em IS NULL
        AND o.data_esperada BETWEEN ? AND ?
      ORDER BY o.data_esperada, o.id LIMIT 500`,
    [est, de, ate],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    previsao: numero(r['previsao_financeira_id']),
    previsaoAtiva: Number(r['ativa'] ?? 0) === 1 || r['ativa'] === true,
    descricao: String(r['descricao']),
    tipo: String(r['tipo']),
    competencia: dataIso(r['competencia']) ?? '',
    dataEsperada: dataIso(r['data_esperada']) ?? '',
    previsto: numero(r['valor']),
    situacao: String(r['situacao']),
    realizado: r['valor_realizado'] === null ? null : numero(r['valor_realizado']),
    diferenca: r['diferenca'] === null ? null : numero(r['diferenca']),
    titulo: r['titulo'] === null ? null : String(r['titulo']),
    motivoCancelamento: r['motivo_cancelamento'] === null ? null : String(r['motivo_cancelamento']),
  }));
}

/**
 * Os títulos que podem realizar a ocorrência, sem digitar número: do mesmo lado (a pagar na despesa, a receber na
 * receita), do mesmo credor ou fonte pagadora quando a previsão tem um, vivos e ainda não conciliados; os de valor mais
 * próximo do previsto primeiro.
 */
export async function titulosParaRealizar(l: Leitor, est: number, ocorrencia: number) {
  const [o] = await l.consultar(
    `SELECT o.valor, p.tipo, p.empresa_fornecedora_id, p.fonte_pagadora_id FROM parcela_previsao_financeira o
       JOIN previsao_financeira p ON p.id = o.previsao_financeira_id
      WHERE o.id = ? AND p.estabelecimento_id = ? AND o.excluido_em IS NULL`,
    [ocorrencia, est],
  );
  if (!o) return [];
  const previsto = numero(o['valor']);
  const receita = String(o['tipo']) === 'receita';
  const linhas = receita
    ? await l.consultar(
        `SELECT t.id, t.numero, t.data_emissao AS data, t.valor_liquido FROM titulo_receber t
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao NOT IN ('cancelado','renegociado')
            AND (? IS NULL OR t.fonte_pagadora_id = ?)
            AND NOT EXISTS (SELECT 1 FROM conciliacao_previsao_realizado c WHERE c.titulo_receber_id = t.id AND c.excluido_em IS NULL)
          ORDER BY ABS(t.valor_liquido - ?), t.id DESC LIMIT 50`,
        [est, o['fonte_pagadora_id'], o['fonte_pagadora_id'], previsto],
      )
    : await l.consultar(
        `SELECT t.id, t.numero, t.data_emissao AS data, t.valor_liquido FROM titulo_pagar t
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
            AND (? IS NULL OR t.empresa_fornecedora_id = ?)
            AND NOT EXISTS (SELECT 1 FROM conciliacao_previsao_realizado c WHERE c.titulo_pagar_id = t.id AND c.excluido_em IS NULL)
          ORDER BY ABS(t.valor_liquido - ?), t.id DESC LIMIT 50`,
        [est, o['empresa_fornecedora_id'], o['empresa_fornecedora_id'], previsto],
      );
  return linhas.map((r) => ({
    id: numero(r['id']),
    lado: receita ? ('receber' as const) : ('pagar' as const),
    numero: String(r['numero']),
    data: dataIso(r['data']) ?? '',
    valor: numero(r['valor_liquido']),
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

/**
 * Os títulos a pagar que podem liquidar a provisão, sem digitar número: vivos, ainda não conciliados e do mesmo credor
 * (fornecedor e profissional, quando a provisão tem); os de valor mais próximo do saldo primeiro. Provisão já liquidada
 * ou revertida não tem candidato.
 */
export async function titulosParaLiquidar(l: Leitor, est: number, provisao: number) {
  const [p] = await l.consultar(
    `SELECT saldo, empresa_fornecedora_id, profissional_id FROM provisao_passivo
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ('provisionada','parcial')`,
    [provisao, est],
  );
  if (!p) return [];
  const linhas = await l.consultar(
    `SELECT t.id, t.numero, t.data_emissao AS data, t.valor_liquido FROM titulo_pagar t
      WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
        AND (? IS NULL OR t.empresa_fornecedora_id = ?) AND (? IS NULL OR t.profissional_id = ?)
        AND NOT EXISTS (SELECT 1 FROM conciliacao_previsao_realizado c WHERE c.titulo_pagar_id = t.id AND c.excluido_em IS NULL)
      ORDER BY ABS(t.valor_liquido - ?), t.id DESC LIMIT 50`,
    [
      est,
      p['empresa_fornecedora_id'],
      p['empresa_fornecedora_id'],
      p['profissional_id'],
      p['profissional_id'],
      numero(p['saldo']),
    ],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    lado: 'pagar' as const,
    numero: String(r['numero']),
    data: dataIso(r['data']) ?? '',
    valor: numero(r['valor_liquido']),
  }));
}

/**
 * Os cadastros que as telas de previsão e provisão oferecem nas listas: naturezas, contas do passivo, e o credor ou a
 * fonte pagadora, o centro de custo, a conta bancária e o profissional (para a previsão ficar presa a quem paga ou
 * recebe, e o honorário provisionado ao profissional).
 */
export async function apoiosPrevisao(l: Leitor, est: number) {
  const naturezas = await l.consultar(
    'SELECT id, codigo, descricao, tipo FROM natureza_financeira WHERE excluido_em IS NULL ORDER BY codigo LIMIT 500',
    [],
  );
  const contas = await l.consultar(
    "SELECT id, classificacao, descricao FROM conta_contabil WHERE ativo = TRUE AND excluido_em IS NULL AND natureza = 'passivo' ORDER BY classificacao LIMIT 500",
    [],
  );
  const fornecedores = await l.consultar(
    "SELECT id, razao_social AS nome FROM empresa_fornecedora WHERE excluido_em IS NULL AND situacao = 'ativo' ORDER BY razao_social LIMIT 1000",
    [],
  );
  const fontes = await l.consultar(
    'SELECT id, nome FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome LIMIT 1000',
    [],
  );
  const centros = await l.consultar(
    'SELECT id, nome FROM centro_custo WHERE estabelecimento_id = ? AND ativo = TRUE AND analitico = TRUE AND excluido_em IS NULL ORDER BY nome LIMIT 1000',
    [est],
  );
  const bancarias = await l.consultar(
    'SELECT id, descricao AS nome FROM conta_bancaria WHERE estabelecimento_id = ? ORDER BY descricao LIMIT 200',
    [est],
  );
  const profissionais = await l.consultar(
    `SELECT pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome
       FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
      WHERE pr.excluido_em IS NULL AND pr.situacao = 'ativo' ORDER BY nome LIMIT 2000`,
    [],
  );
  const lista = (rs: readonly Record<string, unknown>[]) =>
    rs.map((r) => ({ id: numero(r['id']), rotulo: String(r['nome'] ?? '') }));
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
    fornecedores: lista(fornecedores),
    fontesPagadoras: lista(fontes),
    centrosCusto: lista(centros),
    contasBancarias: lista(bancarias),
    profissionais: lista(profissionais),
  };
}
