// F3.8, 07-FIN linha 109: a retenção SOFRIDA no recebimento, no banco próprio pelo executor do @sgh/nucleo (trilha,
// outbox e idempotência na mesma transação). O tomador paga a fatura descontada do tributo que reteve: o retido entra
// na parcela a receber (retencao_titulo com parcela_receber_id, momento "recebimento"), abate o saldo dela e o
// líquido do título (valor_impostos) e vira crédito a compensar. A compensação fecha uma apuração do tributo no
// sentido "retido por tomadores" com as retenções usadas; o saldo a compensar é o que ainda não entrou em apuração.
// As regras são do @sgh/dominio-financeiro (retencao-sofrida.ts, retencao-regra.ts). Nada é apagado: a retenção
// estornada fica marcada como excluída, com o motivo, e a compensação cancelada fica como "cancelada", com o motivo.
// Registrar e estornar mexem no saldo e na quitação da parcela: como a baixa, só entram em período financeiro aberto.
// O município do serviço (regra do ISS) é o da nota de serviço ligada ao título ou, sem nota, o do estabelecimento.
import { centavos } from '@sgh/contratos/regras-financeiro';
import {
  conferirCancelamentoCompensacao,
  conferirCompensacaoSofrida,
  conferirEstornoRetencaoSofrida,
  conferirRetencaoSofrida,
  efeitoRetencaoSofrida,
  municipioDoServicoRetido,
  type RecusaFinanceiro,
  regraVigente,
  saldoACompensar,
  sugerirRetencoes,
  totalRetidoSofrido,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  type Leitor,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { regrasRetencao } from './contabil-fiscal-propria.js';
import { conferirVersao } from './operacoes.js';
import { exigirPeriodoAberto } from './periodo-propria.js';
import { dataIso, numero, texto, versaoTexto } from './vocabulario.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const id = z.number().int().positive();
const dinheiro = z.number().min(0).max(999_999_999);

function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}
function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}
const ABERTO = ['aberto', 'recebido_parcial'];
/** A retenção já usada numa compensação viva (apuração não cancelada). */
const COMPENSADA = `EXISTS (SELECT 1 FROM apuracao_retencao_item ai JOIN apuracao_retencao a ON a.id = ai.apuracao_retencao_id
   WHERE ai.retencao_titulo_id = r.id AND ai.excluido_em IS NULL AND a.excluido_em IS NULL AND a.situacao <> 'cancelada')`;
const PARCELA_ABERTA = `SELECT id, versao, saldo FROM parcela_receber
  WHERE titulo_receber_id = ? AND excluido_em IS NULL AND saldo > 0 AND situacao IN ('aberta','parcial')
  ORDER BY sequencia LIMIT 1`;
/** O hospital é pessoa jurídica: é assim que a regra do momento "recebimento" o enxerga. */
const fatoDoRecebimento = (data: string, valorBruto: number, municipio: number | null) => ({
  data,
  valorBruto,
  momento: 'recebimento' as const,
  participante: 'pessoa_juridica' as const,
  municipio,
});
const hojeIso = () => new Date().toISOString().slice(0, 10);

/**
 * O município do serviço do título, para a regra do ISS retido: o da nota de serviço viva ligada ao título; sem nota, o
 * do estabelecimento prestador (municipioDoServicoRetido, no domínio).
 */
async function municipioDoServico(l: Leitor, est: number, titulo: number): Promise<number | null> {
  const nota = await l.uma<Record<string, unknown>>(
    `SELECT municipio_prestacao_id AS m FROM nota_servico
      WHERE titulo_receber_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
        AND situacao NOT IN ('cancelada','rejeitada','substituida') ORDER BY id DESC LIMIT 1`,
    [titulo, est],
  );
  const e = await l.uma<Record<string, unknown>>(
    'SELECT municipio_ibge_id AS m FROM estabelecimento WHERE id = ?',
    [est],
  );
  const n = (v: unknown) => (v === null || v === undefined ? null : numero(v));
  return municipioDoServicoRetido({ nota: n(nota?.['m']), estabelecimento: n(e?.['m']) });
}

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A retenção sofrida do título a receber: as já registradas (com a compensada marcada), o saldo da parcela em aberto e
 * a sugestão da regra vigente no recebimento sobre o valor da fatura (com o município do serviço, para o ISS), sem os
 * tributos que a parcela já tem, e os tributos ativos (o tomador pode reter fora da regra: a ficha deixa incluir).
 */
export async function retencaoSofridaDoTitulo(l: Leitor, est: number, titulo: number, data: string) {
  const t = await l.uma<Record<string, unknown>>(
    'SELECT id, versao, situacao, valor_bruto, valor_impostos FROM titulo_receber WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [titulo, est],
  );
  if (!t) return null;
  const [p] = await l.consultar(PARCELA_ABERTA, [titulo]);
  const linhas = await l.consultar(
    `SELECT r.id, r.tributo_id, tr.codigo AS sigla, r.base_calculo, r.aliquota, r.valor_retido, r.data_fato_gerador,
            ${COMPENSADA} AS compensada
       FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id JOIN tributo tr ON tr.id = r.tributo_id
      WHERE p.titulo_receber_id = ? AND r.excluido_em IS NULL ORDER BY r.id LIMIT 200`,
    [titulo],
  );
  const retencoes = linhas.map((r) => ({
    id: numero(r['id']),
    tributoId: numero(r['tributo_id']),
    tributo: texto(r['sigla']),
    base: numero(r['base_calculo']),
    aliquota: numero(r['aliquota']),
    valor: numero(r['valor_retido']),
    data: dataIso(r['data_fato_gerador']) ?? '',
    compensada: Boolean(Number(r['compensada'])),
  }));
  const emAberto = !!p && ABERTO.includes(texto(t['situacao']));
  const regras = await regrasRetencao(l, est);
  const tributos = new Map(regras.map((r) => [r.tributo, r.tributoId]));
  const tem = new Set(retencoes.map((r) => r.tributo));
  const municipio = await municipioDoServico(l, est, titulo);
  const ativos = await l.consultar(
    'SELECT id, codigo, descricao FROM tributo WHERE ativo = TRUE ORDER BY codigo LIMIT 200',
    [],
  );
  const sugestoes = emAberto
    ? sugerirRetencoes(regras, fatoDoRecebimento(data, numero(t['valor_bruto']), municipio))
        .filter((s) => !tem.has(s.tributo))
        .map((s) => ({ ...s, tributoId: tributos.get(s.tributo) ?? 0 }))
    : [];
  return {
    titulo,
    versao: versaoTexto(t['versao']),
    emAberto,
    valorFatura: numero(t['valor_bruto']),
    saldoParcela: numero(p?.['saldo']),
    retido: totalRetidoSofrido(retencoes),
    retencoes,
    sugestoes,
    municipio,
    tributos: ativos.map((x) => ({
      id: numero(x['id']),
      sigla: texto(x['codigo']),
      descricao: texto(x['descricao']),
    })),
  };
}

/** As compensações vivas do estabelecimento (apuração "retido por tomadores" não cancelada), da mais nova para a mais antiga. */
export async function compensacoesSofridas(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT a.id, a.numero, a.tributo_id, tr.codigo, DATE_FORMAT(a.competencia_fim, '%Y-%m') AS competencia,
            a.valor_total, a.fechado_em,
            (SELECT COUNT(*) FROM apuracao_retencao_item i WHERE i.apuracao_retencao_id = a.id AND i.excluido_em IS NULL) AS n
       FROM apuracao_retencao a JOIN tributo tr ON tr.id = a.tributo_id
      WHERE a.estabelecimento_id = ? AND a.sentido = 'retido_por_tomadores' AND a.excluido_em IS NULL
        AND a.situacao <> 'cancelada'
      ORDER BY a.id DESC LIMIT 200`,
    [est],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    numero: texto(r['numero']),
    tributoId: numero(r['tributo_id']),
    tributo: texto(r['codigo']),
    competencia: texto(r['competencia']),
    valor: numero(r['valor_total']),
    retencoes: numero(r['n']),
    em: dataIso(r['fechado_em']) ?? '',
  }));
}

/** O saldo a compensar por tributo: o retido pelos tomadores (títulos vivos) menos o que já entrou em compensação. */
export async function saldoRetencaoSofrida(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT tr.id, tr.codigo, DATE_FORMAT(r.competencia, '%Y-%m') AS competencia, ${COMPENSADA} AS compensada,
            SUM(r.valor_retido) AS valor
       FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id
       JOIN titulo_receber t ON t.id = p.titulo_receber_id JOIN tributo tr ON tr.id = r.tributo_id
      WHERE t.estabelecimento_id = ? AND r.excluido_em IS NULL AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
        AND p.excluido_em IS NULL
      GROUP BY tr.id, tr.codigo, competencia, compensada ORDER BY tr.codigo LIMIT 5000`,
    [est],
  );
  const ids = new Map(linhas.map((r) => [texto(r['codigo']), numero(r['id'])]));
  return saldoACompensar(
    linhas.map((r) => ({
      tributo: texto(r['codigo']),
      competencia: texto(r['competencia']),
      valor: numero(r['valor']),
      compensado: Boolean(Number(r['compensada'])),
    })),
  ).map((s) => ({ ...s, tributoId: ids.get(s.tributo) ?? 0 }));
}

/** Busca do município pelo nome (a regra do ISS retido é do município do serviço; a tela nunca pede o código). */
export async function buscarMunicipiosRetencao(l: Leitor, termo: string) {
  const t = termo.trim().slice(0, 80);
  if (t.length < 2) return [];
  const linhas = await l.consultar(
    `SELECT m.id, m.nome, u.sigla AS uf FROM municipio_ibge m JOIN unidade_federativa u ON u.id = m.unidade_federativa_id
      WHERE m.nome LIKE ? ORDER BY m.nome LIMIT 20`,
    [`${t.replace(/[\\%_]/g, '\\$&')}%`],
  );
  return linhas.map((r) => ({ id: numero(r['id']), nome: texto(r['nome']), uf: texto(r['uf']) }));
}

// ── Registrar e estornar ───────────────────────────────────────────────────────────────────────────────────────

export const esquemaRetencaoSofrida = z.union([
  z
    .object({
      acao: z.literal('registrar'),
      titulo: id,
      versao: z.string().max(20).nullable().optional(),
      data: z.string().regex(DATA),
      itens: z
        .array(
          z
            .object({ tributo: id, base: dinheiro, aliquota: z.number().min(0).max(100), valor: dinheiro })
            .strict(),
        )
        .min(1)
        .max(10),
    })
    .strict(),
  z
    .object({ acao: z.literal('estornar'), titulo: id, retencao: id, motivo: z.string().trim().max(300) })
    .strict(),
]);
export type RetencaoSofridaEntrada = z.infer<typeof esquemaRetencaoSofrida>;

const manterRetencaoSofrida = definirOperacao<RetencaoSofridaEntrada, ResultadoOperacao>({
  nome: 'financeiro.manter_retencao_sofrida',
  tabelas: ['retencao_titulo', 'parcela_receber', 'titulo_receber'],
  entrada: esquemaRetencaoSofrida as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [t] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, valor_bruto, valor_impostos, valor_liquido FROM titulo_receber
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.titulo, est],
      { teto: 1 },
    );
    if (!t) throw recusa('titulo-inexistente', 'O título não existe.', { campos: ['titulo'] });
    const situacao = texto(t['situacao']);

    if (e.acao === 'estornar') {
      const [r] = await tx.consultarParaAtualizar(
        `SELECT r.id, r.versao, r.valor_retido, r.parcela_receber_id, r.data_fato_gerador, ${COMPENSADA} AS compensada
           FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id
          WHERE r.id = ? AND p.titulo_receber_id = ? AND r.excluido_em IS NULL`,
        [e.retencao, e.titulo],
        { teto: 1 },
      );
      recusar(
        conferirEstornoRetencaoSofrida({
          existe: !!r && !['cancelado', 'renegociado'].includes(situacao),
          compensada: Boolean(Number(r?.['compensada'])),
          motivo: e.motivo,
        }),
      );
      if (!r) throw recusa('nao-encontrado', 'A retenção não é deste título.', { campos: ['retencao'] });
      // O estorno reabre a parcela e o título na data em que a retenção os abateu: mês fechado não se mexe.
      await exigirPeriodoAberto(tx, est, dataIso(r['data_fato_gerador']) ?? hojeIso(), 'retencao');
      const valor = numero(r['valor_retido']);
      const [p] = await tx.consultarParaAtualizar(
        'SELECT id, versao, saldo, valor_recebido FROM parcela_receber WHERE id = ?',
        [r['parcela_receber_id']],
        { teto: 1 },
      );
      if (!p) throw recusa('nao-encontrado', 'A parcela da retenção não existe.');
      await tx.alterar('retencao_titulo', numero(r['id']), numero(r['versao']), {
        excluido_em: new Date(),
        excluido_por: ctx.usuario,
        motivo_estorno: e.motivo.trim(),
      });
      // O crédito some e o valor volta a ser devido pelo tomador: a parcela reabre com o saldo de volta.
      const saldo = centavos(numero(p['saldo']) + valor);
      await tx.alterar('parcela_receber', numero(p['id']), numero(p['versao']), {
        saldo,
        situacao: numero(p['valor_recebido']) > 0 ? 'parcial' : 'aberta',
        quitada_em: null,
      });
      const recebeu = await tx.uma(
        'SELECT COALESCE(SUM(valor_recebido), 0) AS v FROM parcela_receber WHERE titulo_receber_id = ? AND excluido_em IS NULL',
        [e.titulo],
      );
      await tx.alterar('titulo_receber', e.titulo, numero(t['versao']), {
        valor_impostos: centavos(numero(t['valor_impostos']) - valor),
        valor_liquido: centavos(numero(t['valor_liquido']) + valor),
        situacao: numero(recebeu?.['v']) > 0 ? 'recebido_parcial' : 'aberto',
      });
      return { titulo: e.titulo, acao: 'estornar', retencoes: 1, valor, saldo };
    }

    conferirVersao(e.versao, t['versao']);
    const [p] = await tx.consultarParaAtualizar(PARCELA_ABERTA, [e.titulo], { teto: 1 });
    const jaRetidos = p
      ? (
          await tx.consultar(
            'SELECT tributo_id FROM retencao_titulo WHERE parcela_receber_id = ? AND excluido_em IS NULL',
            [p['id']],
          )
        ).map((r) => numero(r['tributo_id']))
      : [];
    recusar(
      conferirRetencaoSofrida({
        emAberto: !!p && ABERTO.includes(situacao),
        saldoParcela: numero(p?.['saldo']),
        itens: e.itens,
        jaRetidos,
        data: e.data,
        hoje: hojeIso(),
      }),
    );
    // Como a baixa: a retenção abate o saldo e pode quitar a parcela e o título nesta data.
    await exigirPeriodoAberto(tx, est, e.data, 'data');
    if (!p) throw recusa('titulo-ja-baixado', 'O título já foi baixado por outra via: releia.');
    const regras = await regrasRetencao(tx, est);
    const municipio = await municipioDoServico(tx, est, e.titulo);
    const seq = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) AS n FROM retencao_titulo WHERE parcela_receber_id = ?',
      [p['id']],
    );
    let sequencia = numero(seq?.['n']);
    for (const i of e.itens) {
      const trib = await tx.uma<{ codigo: string }>(
        'SELECT codigo FROM tributo WHERE id = ? AND ativo = TRUE',
        [i.tributo],
      );
      if (!trib) throw recusa('tributo-inexistente', 'O tributo não existe.', { campos: ['itens'] });
      const regra = regraVigente(
        regras,
        String(trib.codigo),
        fatoDoRecebimento(e.data, numero(t['valor_bruto']), municipio),
      );
      await tx.incluir('retencao_titulo', {
        parcela_receber_id: p['id'],
        sequencia: ++sequencia,
        tributo_id: i.tributo,
        regra_retencao_id: regra?.id ?? null,
        momento: 'recebimento',
        competencia: `${e.data.slice(0, 7)}-01`,
        data_fato_gerador: e.data,
        base_calculo: i.base,
        aliquota: i.aliquota,
        valor_retido: i.valor,
      });
    }
    const valor = totalRetidoSofrido(e.itens);
    const efeito = efeitoRetencaoSofrida(numero(p['saldo']), valor);
    await tx.alterar('parcela_receber', numero(p['id']), numero(p['versao']), {
      saldo: efeito.saldo,
      ...(efeito.quita ? { situacao: 'recebida', quitada_em: e.data } : {}),
    });
    const abertas = await tx.uma(
      'SELECT COUNT(*) AS n FROM parcela_receber WHERE titulo_receber_id = ? AND excluido_em IS NULL AND saldo > 0 AND id <> ?',
      [e.titulo, p['id']],
    );
    await tx.alterar('titulo_receber', e.titulo, numero(t['versao']), {
      valor_impostos: centavos(numero(t['valor_impostos']) + valor),
      valor_liquido: centavos(numero(t['valor_liquido']) - valor),
      ...(efeito.quita ? { situacao: numero(abertas?.['n']) > 0 ? 'recebido_parcial' : 'recebido' } : {}),
    });
    return { titulo: e.titulo, acao: 'registrar', retencoes: e.itens.length, valor, saldo: efeito.saldo };
  },
  alvo: (e) => ({ tabela: 'titulo_receber', id: e.titulo }),
});

// ── Compensar ──────────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaCompensacaoSofrida = z
  .object({ competencia: z.string().regex(/^\d{4}-\d{2}$/), tributo: id })
  .strict();
export type CompensacaoSofridaEntrada = z.infer<typeof esquemaCompensacaoSofrida>;

const compensarRetencaoSofrida = definirOperacao<CompensacaoSofridaEntrada, ResultadoOperacao>({
  nome: 'financeiro.compensar_retencao_sofrida',
  tabelas: ['apuracao_retencao', 'apuracao_retencao_item'],
  entrada: esquemaCompensacaoSofrida as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    // A trava: a linha do tributo serializa as compensações dele (o mesmo crédito não entra em duas apurações).
    const [trib] = await tx.consultarParaAtualizar(
      'SELECT id, codigo FROM tributo WHERE id = ?',
      [e.tributo],
      {
        teto: 1,
      },
    );
    if (!trib) throw recusa('tributo-inexistente', 'O tributo não existe.', { campos: ['tributo'] });
    const creditos = (
      await tx.consultarParaAtualizar(
        `SELECT r.id, r.parcela_receber_id, r.base_calculo, r.aliquota, r.valor_retido,
                DATE_FORMAT(r.competencia, '%Y-%m') AS competencia
           FROM retencao_titulo r JOIN parcela_receber p ON p.id = r.parcela_receber_id
           JOIN titulo_receber t ON t.id = p.titulo_receber_id
          WHERE t.estabelecimento_id = ? AND r.tributo_id = ? AND r.excluido_em IS NULL AND t.excluido_em IS NULL
            AND t.situacao <> 'cancelado' AND p.excluido_em IS NULL AND NOT ${COMPENSADA}
          ORDER BY r.id`,
        [est, e.tributo],
        { teto: 5000 },
      )
    ).map((r) => ({
      id: numero(r['id']),
      parcela: numero(r['parcela_receber_id']),
      base: numero(r['base_calculo']),
      aliquota: numero(r['aliquota']),
      valor: numero(r['valor_retido']),
      competencia: texto(r['competencia']),
    }));
    recusar(conferirCompensacaoSofrida(creditos, e.competencia));
    const usados = creditos.filter((c) => c.competencia <= e.competencia);
    const valor = totalRetidoSofrido(usados);
    const ja = await tx.uma(
      "SELECT COUNT(*) AS n FROM apuracao_retencao WHERE estabelecimento_id = ? AND tributo_id = ? AND sentido = 'retido_por_tomadores'",
      [est, e.tributo],
    );
    const agora = new Date();
    const numeroApuracao = `CS-${e.competencia}-${e.tributo}-${numero(ja?.['n']) + 1}`.slice(0, 30);
    const inicio = usados.reduce((m, c) => (c.competencia < m ? c.competencia : m), e.competencia);
    const apuracao = await tx.incluir('apuracao_retencao', {
      estabelecimento_id: est,
      numero: numeroApuracao,
      descricao: `Compensação ${texto(trib['codigo'])} retido por tomadores até ${e.competencia}`.slice(
        0,
        150,
      ),
      tributo_id: e.tributo,
      sentido: 'retido_por_tomadores',
      competencia_inicio: `${inicio}-01`,
      competencia_fim: `${e.competencia}-01`,
      valor_base_total: centavos(usados.reduce((s, c) => s + c.base, 0)),
      valor_total: valor,
      situacao: 'fechada',
      aberto_em: agora,
      abridor_usuario_id: ctx.usuario,
      fechado_em: agora,
      fechador_usuario_id: ctx.usuario,
    });
    for (const c of usados)
      await tx.incluir('apuracao_retencao_item', {
        apuracao_retencao_id: apuracao,
        retencao_titulo_id: c.id,
        parcela_receber_id: c.parcela,
        valor_base: c.base,
        aliquota: c.aliquota,
        valor_retido: c.valor,
        valor_baixado: c.valor,
      });
    return { apuracao, numero: numeroApuracao, retencoes: usados.length, valor };
  },
  alvo: (_e, r) => ({ tabela: 'apuracao_retencao', id: numero(r['apuracao']) || null }),
});

// ── Cancelar a compensação ─────────────────────────────────────────────────────────────────────────────────────

export const esquemaCancelamentoCompensacao = z
  .object({ apuracao: id, motivo: z.string().trim().max(300) })
  .strict();
export type CancelamentoCompensacaoEntrada = z.infer<typeof esquemaCancelamentoCompensacao>;

const cancelarCompensacaoSofrida = definirOperacao<CancelamentoCompensacaoEntrada, ResultadoOperacao>({
  nome: 'financeiro.cancelar_compensacao_sofrida',
  tabelas: ['apuracao_retencao'],
  entrada: esquemaCancelamentoCompensacao as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [a] = await tx.consultarParaAtualizar(
      `SELECT id, versao, situacao, valor_total, tributo_id FROM apuracao_retencao
        WHERE id = ? AND estabelecimento_id = ? AND sentido = 'retido_por_tomadores' AND excluido_em IS NULL`,
      [e.apuracao, est],
      { teto: 1 },
    );
    recusar(
      conferirCancelamentoCompensacao({
        existe: !!a,
        cancelada: texto(a?.['situacao']) === 'cancelada',
        motivo: e.motivo,
      }),
    );
    if (!a) throw recusa('nao-encontrado', 'A compensação não é deste estabelecimento.');
    // Nada é apagado: a apuração e os itens ficam; cancelada, ela deixa de contar e o crédito volta ao saldo.
    await tx.alterar('apuracao_retencao', numero(a['id']), numero(a['versao']), {
      situacao: 'cancelada',
      cancelado_em: new Date(),
      cancelado_por: ctx.usuario,
      motivo_cancelamento: e.motivo.trim(),
    });
    const itens = await tx.uma(
      'SELECT COUNT(*) AS n FROM apuracao_retencao_item WHERE apuracao_retencao_id = ? AND excluido_em IS NULL',
      [a['id']],
    );
    return {
      apuracao: numero(a['id']),
      tributo: numero(a['tributo_id']),
      retencoes: numero(itens?.['n']),
      valor: numero(a['valor_total']),
    };
  },
  alvo: (e) => ({ tabela: 'apuracao_retencao', id: e.apuracao }),
});

/** As operações desta parte, pelo nome da rota. */
export const OPERACOES_RETENCAO_SOFRIDA = {
  'financeiro.manterRetencaoSofrida': manterRetencaoSofrida,
  'financeiro.compensarRetencaoSofrida': compensarRetencaoSofrida,
  'financeiro.cancelarCompensacaoSofrida': cancelarCompensacaoSofrida,
} as const;
