// F3.7 (06-FAT linhas 33 e 34): a baixa do retorno por item, o lote de recurso e o retorno do recurso sobre o banco do
// cliente, pelo Executor do @sgh/nucleo (trilha, outbox e idempotência na mesma transação; sem gatilho).
// - Baixa (faturamento.registrarGlosa): grava o pago no item da conta e, quando há glosa, a glosa (uma por conta, com
//   o número da sequência do estabelecimento) e o item glosado com o motivo da terminologia; ligada ao demonstrativo
//   quando veio dele. Regra 7 do domínio (conferirBaixa).
// - Recurso (faturamento.registrarRecurso): um lote de recurso por fonte pagadora, com os itens decididos como
//   "recorrer" (a justificativa da decisão vai ao item do recurso), o valor pleiteado e o protocolo; a glosa vai a
//   "em recurso". Regra do domínio: conferirItemDoRecurso.
// - Retorno (faturamento.registrarRetornoRecurso): acatado, parcial ou negado por item, com o demonstrativo e o
//   motivo; o recurso e a glosa mudam de situação quando o último item retorna (situacaoDoRecurso,
//   situacaoDaGlosaNoRecurso). Nada é apagado: o retorno é gravado uma vez no item do recurso.
import {
  esquemaRegistrarRetornoRecurso,
  type RegistrarGlosaEntrada,
  type RegistrarRecursoEntrada,
  type RegistrarRetornoRecursoEntrada,
} from '@sgh/contratos';
import {
  conferirBaixa,
  conferirDesfecho,
  conferirItemDoRecurso,
  lotesDeRecurso,
  MOTIVO_NAO_INFORMADO,
  prazoRecurso,
  situacaoDaGlosaNoRecurso,
  situacaoDoRecurso,
  valorPadraoDoRecurso,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  garantirSequencia,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { versaoNumero } from '../faturamento/esquemas.js';
import { esquemaBaixaComPrazo, esquemaRecursoComPrazo } from './esquemas.js';
import { sincronizarGlosaDoItem, TABELAS_PRODUCAO_CONTA } from '../repasse/producao-conta.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const r2 = (v: number) => Math.round(v * 100) / 100;

// O prazo do recurso pela regra que a grade mostra (prazoRecurso: os dias do convênio no parâmetro, contados da data
// da baixa); o parâmetro chega pelo serviço (esquemaBaixaComPrazo e esquemaRecursoComPrazo em ./esquemas.ts).
type BaixaComPrazo = RegistrarGlosaEntrada & { readonly prazoParametro?: string };
type RecursoComPrazo = RegistrarRecursoEntrada & { readonly prazoParametro?: string };

function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}

const conflito = (item: number) =>
  new ErroOperacao(
    409,
    'conflito-versao',
    'Registro alterado',
    `O item ${item} mudou desde a leitura: releia e repita.`,
  );

/** A glosa viva do item da conta (a mais recente, não excluída nem cancelada). */
const GLOSA_VIVA = `(SELECT MAX(gv.id) FROM glosa_item gv JOIN glosa gg ON gg.id = gv.glosa_id
   WHERE gv.conta_hospitalar_item_id = ci.id AND gv.excluido_em IS NULL AND gg.excluido_em IS NULL
     AND gg.situacao <> 'cancelada')`;

/** Item da conta do estabelecimento, travado, com a glosa viva e o recurso (quando há). */
const SQL_ITEM = `
  SELECT ci.id, ci.versao, ci.quantidade, ci.valor_total, ci.valor_pago, ci.item_faturavel_id, ci.conta_hospitalar_id,
         ch.fonte_pagadora_id, ch.competencia, ch.situacao AS situacao_conta,
         EXISTS (SELECT 1 FROM lote_tiss_conta ltc JOIN lote_tiss lt ON lt.id = ltc.lote_tiss_id
                  WHERE ltc.conta_hospitalar_id = ch.id AND ltc.excluido_em IS NULL AND lt.excluido_em IS NULL
                    AND lt.situacao <> 'cancelado') AS em_lote,
         gi.id AS glosa_item, gi.versao AS versao_glosa, gi.glosa_id, gi.motivo_glosa_id, gi.valor_glosado,
         gi.valor_aceito, gi.valor_recursado, gi.quantidade_glosada, gi.decisao, gi.justificativa, gi.recurso_glosa_id,
         gi.valor_recuperado, gi.data_recuperacao, gl.data_limite_recurso, gl.data_glosa, rg.enviado_em AS recurso_em
    FROM conta_hospitalar_item ci
    JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id
    LEFT JOIN glosa_item gi ON gi.id = ${GLOSA_VIVA}
    LEFT JOIN glosa gl ON gl.id = gi.glosa_id
    LEFT JOIN recurso_glosa rg ON rg.id = gi.recurso_glosa_id AND rg.excluido_em IS NULL
   WHERE ci.id = ? AND ci.excluido_em IS NULL AND ch.estabelecimento_id = ? AND ch.excluido_em IS NULL`;

async function itensTravados(
  tx: TxOperacao,
  est: number,
  pedidos: readonly { item: number; versao: string }[],
): Promise<Linha[]> {
  const vistos = new Set<number>();
  const linhas: Linha[] = [];
  for (const p of pedidos) {
    if (vistos.has(p.item)) throw recusa('item-repetido', `O item ${p.item} veio repetido no pedido.`);
    vistos.add(p.item);
    const [l] = await tx.consultarParaAtualizar<Linha>(SQL_ITEM, [p.item, est]);
    if (!l) throw recusa('item-inexistente', `O item ${p.item} não existe neste estabelecimento.`);
    if (versaoNumero(p.versao) !== n(l['versao'])) throw conflito(p.item);
    linhas.push(l);
  }
  return linhas;
}

/** Motivo da terminologia pelo código numérico (0 = não informado). */
async function motivoPorCodigo(tx: TxOperacao, codigo: number): Promise<number | null> {
  if (codigo === MOTIVO_NAO_INFORMADO) return null;
  const m = await tx.uma<Linha>(
    `SELECT id FROM motivo_glosa WHERE codigo_tuss = ? OR CAST(codigo_tuss AS UNSIGNED) = ?
      ORDER BY codigo_tuss = ? DESC, id LIMIT 1`,
    [String(codigo), codigo, String(codigo)],
  );
  return m ? n(m['id']) : null;
}

async function numeroNegocio(tx: TxOperacao, tipo: string, est: number, usuario: number | null) {
  await garantirSequencia(tx, { tipo, estabelecimento: est, inicio: 1 }, { usuario, agora: new Date() });
  return String((await tx.proximoNumero(tipo)).valor).padStart(10, '0');
}

// ── Baixa do retorno por item ───────────────────────────────────────────────────────────────────────────

const registrarGlosa = definirOperacao<BaixaComPrazo, ResultadoOperacao>({
  nome: 'faturamento.registrar-glosa',
  tabelas: ['conta_hospitalar_item', 'glosa', 'glosa_item', 'sequencia_negocio', ...TABELAS_PRODUCAO_CONTA],
  entrada: esquemaBaixaComPrazo,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const linhas = await itensTravados(tx, est, e.itens);
    let demonstrativo: number | null = null;
    if (e.demonstrativo !== null) {
      const d = await tx.uma<Linha>(
        `SELECT d.id FROM demonstrativo_analise_conta d
          WHERE d.id = ? AND d.estabelecimento_id = ? AND d.excluido_em IS NULL`,
        [e.demonstrativo, est],
      );
      if (!d) throw recusa('demonstrativo-inexistente', 'O demonstrativo não existe neste estabelecimento.');
      demonstrativo = n(d['id']);
    }
    const motivos: (number | null)[] = [];
    for (const [k, it] of e.itens.entries()) {
      const l = linhas[k]!;
      const apresentada =
        n(l['em_lote']) === 1 || ['faturada', 'enviada', 'paga'].includes(texto(l['situacao_conta']));
      if (!apresentada)
        throw recusa(
          'conta-nao-apresentada',
          `Item ${it.item}: a conta ainda não foi apresentada à fonte pagadora.`,
        );
      const motivo = await motivoPorCodigo(tx, it.motivo);
      const r = conferirBaixa({
        valorCobrado: n(l['valor_total']),
        valorPago: it.valorPago,
        quantidadePaga: it.quantidadePaga,
        motivo: it.motivo,
        motivoExiste: it.motivo === MOTIVO_NAO_INFORMADO || motivo !== null,
        jaBaixado: l['glosa_item'] !== null || n(l['valor_pago']) > 0,
      });
      if (r)
        throw recusa(r.codigo, `Item ${it.item}: ${r.mensagem}`, r.campos ? { campos: [...r.campos] } : {});
      motivos.push(motivo);
    }
    // Uma glosa por conta, com os itens glosados dela.
    const glosas = new Map<number, number>();
    const seq = new Map<number, number>();
    const somas = new Map<number, { apresentado: number; glosado: number }>();
    let glosados = 0;
    for (const [k, it] of e.itens.entries()) {
      const l = linhas[k]!;
      const id = n(l['id']);
      await tx.alterar('conta_hospitalar_item', id, n(l['versao']), { valor_pago: r2(it.valorPago) });
      const cobrado = n(l['valor_total']);
      const glosa = r2(cobrado - it.valorPago);
      if (glosa <= 0) continue;
      const conta = n(l['conta_hospitalar_id']);
      let g = glosas.get(conta);
      if (g === undefined) {
        g = await tx.incluir('glosa', {
          estabelecimento_id: est,
          numero: await numeroNegocio(tx, 'glosa', est, ctx.usuario),
          fonte_pagadora_id: n(l['fonte_pagadora_id']),
          procedencia: demonstrativo !== null ? 'demonstrativo' : 'digitacao',
          conta_hospitalar_id: conta,
          demonstrativo_analise_conta_id: demonstrativo,
          data_glosa: e.dataPagamento,
          // O prazo fica gravado na baixa: a grade e a conferência do recurso leem a mesma data.
          data_limite_recurso: prazoRecurso(
            e.prazoParametro ?? '',
            n(l['fonte_pagadora_id']),
            e.dataPagamento,
          ).prazo,
          competencia: l['competencia'] ?? null,
          valor_apresentado: 0,
          valor_glosado: 0,
          situacao: 'em_analise',
          responsavel_usuario_id: ctx.usuario,
        });
        glosas.set(conta, g);
      }
      const s = (seq.get(g) ?? 0) + 1;
      seq.set(g, s);
      const q = n(l['quantidade']);
      await tx.incluir('glosa_item', {
        glosa_id: g,
        sequencia: s,
        conta_hospitalar_item_id: id,
        item_faturavel_id: l['item_faturavel_id'] ?? null,
        motivo_glosa_id: motivos[k],
        quantidade_apresentada: q,
        quantidade_glosada: Math.max(0, Math.round((q - it.quantidadePaga) * 10_000) / 10_000),
        valor_apresentado: cobrado,
        valor_glosado: glosa,
        decisao: 'pendente',
      });
      const soma = somas.get(g) ?? { apresentado: 0, glosado: 0 };
      somas.set(g, { apresentado: r2(soma.apresentado + cobrado), glosado: r2(soma.glosado + glosa) });
      glosados += 1;
    }
    for (const [g, s] of somas) {
      await tx.alterar('glosa', g, 1, { valor_apresentado: s.apresentado, valor_glosado: s.glosado });
    }
    // O item da conta e a produção do repasse acompanham a glosa (mesma transação, sem gatilho).
    for (const l of linhas) {
      await sincronizarGlosaDoItem(
        tx,
        { conta: n(l['conta_hospitalar_id']), item: n(l['id']) },
        { estabelecimento: est, usuario: ctx.usuario },
      );
    }
    return { itens: e.itens.length, primeiro: e.itens[0]!.item, glosados, glosas: glosas.size };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar_item', id: e.itens[0]!.item }),
  trilha: (e, r) => ({
    dados: { itens: e.itens.length, glosados: r['glosados'], dataPagamento: e.dataPagamento },
  }),
});

// ── Lote de recurso ─────────────────────────────────────────────────────────────────────────────────────

const registrarRecurso = definirOperacao<RecursoComPrazo, ResultadoOperacao>({
  nome: 'faturamento.registrar-recurso',
  tabelas: ['recurso_glosa', 'recurso_glosa_item', 'glosa', 'glosa_item', 'sequencia_negocio'],
  entrada: esquemaRecursoComPrazo,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const linhas = await itensTravados(tx, est, e.itens);
    const alertas = new Set<string>();
    const pedidos = e.itens.map((it, k) => {
      const l = linhas[k]!;
      if (l['glosa_item'] === null)
        throw recusa(
          'nao-conciliado',
          `Item ${it.item}: sem glosa baixada; baixe o retorno antes de recorrer.`,
        );
      const g = {
        decisao: texto(l['decisao']),
        justificativa: l['justificativa'] === null ? null : texto(l['justificativa']),
        valorGlosado: n(l['valor_glosado']),
        valorAceito: n(l['valor_aceito']),
        emRecurso: l['recurso_glosa_id'] !== null || n(l['valor_recursado']) > 0,
        // Glosa sem prazo gravado (anterior à baixa por item, ou de outra origem): a mesma regra da grade.
        prazo:
          dataIso(l['data_limite_recurso']) ??
          prazoRecurso(e.prazoParametro ?? '', n(l['fonte_pagadora_id']), dataIso(l['data_glosa'])).prazo,
      };
      const valor = r2(it.valor ?? valorPadraoDoRecurso(g));
      const r = conferirItemDoRecurso(g, valor, e.dataProtocolo);
      if (r)
        throw recusa(r.codigo, `Item ${it.item}: ${r.mensagem}`, r.campos ? { campos: [...r.campos] } : {});
      const quantidade = it.quantidade ?? (n(l['quantidade_glosada']) || n(l['quantidade']) || 1);
      return { l, valor, quantidade, prazo: g.prazo, fontePagadora: n(l['fonte_pagadora_id']) };
    });
    for (const p of pedidos) {
      const m = await tx.uma<Linha>('SELECT permite_reapresentacao FROM motivo_glosa WHERE id = ?', [
        p.l['motivo_glosa_id'],
      ]);
      if (m && !n(m['permite_reapresentacao']))
        alertas.add(
          'O motivo desta glosa não admite reapresentação pela terminologia: o recurso pode ser negado.',
        );
    }
    const enviado = new Date(`${e.dataProtocolo}T12:00:00Z`);
    const recursos: number[] = [];
    const porGlosa = new Map<number, number>();
    for (const lote of lotesDeRecurso(pedidos)) {
      const total = r2(lote.itens.reduce((t, p) => t + p.valor, 0));
      const prazos = lote.itens.map((p) => p.prazo).filter((x): x is string => !!x);
      const rec = await tx.incluir('recurso_glosa', {
        estabelecimento_id: est,
        numero: await numeroNegocio(tx, 'recurso_glosa', est, ctx.usuario),
        fonte_pagadora_id: lote.fontePagadora,
        objeto: 'item',
        prazo_ate: prazos.length ? prazos.sort()[0] : null,
        enviado_em: enviado,
        situacao: 'enviado',
        valor_recursado: total,
      });
      recursos.push(rec);
      for (const [k, p] of lote.itens.entries()) {
        await tx.incluir('recurso_glosa_item', {
          recurso_glosa_id: rec,
          sequencia: k + 1,
          glosa_item_id: n(p.l['glosa_item']),
          conta_hospitalar_item_id: n(p.l['id']),
          motivo_glosa_id: p.l['motivo_glosa_id'] ?? null,
          justificativa: texto(p.l['justificativa']),
          quantidade_recursada: p.quantidade,
          valor_recursado: p.valor,
        });
        await tx.alterar('glosa_item', n(p.l['glosa_item']), n(p.l['versao_glosa']), {
          valor_recursado: p.valor,
          quantidade_recursada: p.quantidade,
          recurso_glosa_id: rec,
        });
        const gid = n(p.l['glosa_id']);
        porGlosa.set(gid, r2((porGlosa.get(gid) ?? 0) + p.valor));
      }
    }
    for (const [gid, valor] of porGlosa) {
      const [cab] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, valor_recursado FROM glosa WHERE id = ? AND excluido_em IS NULL',
        [gid],
      );
      if (cab)
        await tx.alterar('glosa', gid, n(cab['versao']), {
          valor_recursado: r2(n(cab['valor_recursado']) + valor),
          situacao: 'em_recurso',
        });
    }
    return {
      itens: e.itens.length,
      primeiro: e.itens[0]!.item,
      recursos: recursos.join(','),
      alertas: [...alertas].join(' '),
    };
  },
  alvo: (_e, r) => ({ tabela: 'recurso_glosa', id: n(String(r['recursos']).split(',')[0]) }),
  trilha: (e, r) => ({
    dados: { itens: e.itens.length, dataProtocolo: e.dataProtocolo, recursos: r['recursos'] },
  }),
});

// ── Retorno do recurso ──────────────────────────────────────────────────────────────────────────────────

const registrarRetornoRecurso = definirOperacao<RegistrarRetornoRecursoEntrada, ResultadoOperacao>({
  nome: 'faturamento.registrar-retorno-recurso',
  tabelas: ['recurso_glosa', 'recurso_glosa_item', 'glosa', 'glosa_item'],
  entrada: esquemaRegistrarRetornoRecurso,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const linhas = await itensTravados(tx, est, e.itens);
    const numero = e.numeroDemonstrativo.trim().slice(0, 20);
    const preparados = [];
    for (const [k, it] of e.itens.entries()) {
      const l = linhas[k]!;
      const d = conferirDesfecho({
        item: {
          valorRecurso: l['glosa_item'] === null ? 0 : n(l['valor_recursado']),
          quantidadeRecurso: 0,
          dataRecurso: dataIso(l['recurso_em']),
          valorRetorno: n(l['valor_recuperado']),
          dataRetorno: dataIso(l['data_recuperacao']),
        },
        desfecho: it.desfecho,
        data: e.data,
        numeroDemonstrativo: numero,
        valor: it.valor,
        motivo: it.motivo,
      });
      if (!d.ok)
        throw recusa(
          d.recusa.codigo,
          `Item ${it.item}: ${d.recusa.mensagem}`,
          d.recusa.campos ? { campos: [...d.recusa.campos] } : {},
        );
      const motivo = it.desfecho === 'acatado' ? null : await motivoPorCodigo(tx, d.valores.motivo);
      if (it.desfecho !== 'acatado' && d.valores.motivo !== MOTIVO_NAO_INFORMADO && motivo === null)
        throw recusa('motivo-inexistente', `Item ${it.item}: o motivo não existe.`, { campos: ['motivo'] });
      const [ri] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao FROM recurso_glosa_item
          WHERE glosa_item_id = ? AND recurso_glosa_id = ? AND excluido_em IS NULL`,
        [l['glosa_item'], l['recurso_glosa_id']],
      );
      if (!ri) throw recusa('sem-recurso', `Item ${it.item}: o item do recurso não foi encontrado.`);
      preparados.push({ l, valor: d.valores.valor, motivo, ri });
    }
    const recursos = new Set<number>();
    const glosas = new Set<number>();
    for (const p of preparados) {
      await tx.alterar('recurso_glosa_item', n(p.ri['id']), n(p.ri['versao']), {
        valor_acatado: p.valor,
        numero_demonstrativo_retorno: numero,
        motivo_retorno_glosa_id: p.motivo,
        retornado_em: e.data,
        retornado_por_usuario_id: ctx.usuario,
      });
      await tx.alterar('glosa_item', n(p.l['glosa_item']), n(p.l['versao_glosa']), {
        valor_recuperado: p.valor,
        data_recuperacao: e.data,
      });
      recursos.add(n(p.l['recurso_glosa_id']));
      glosas.add(n(p.l['glosa_id']));
    }
    for (const rid of recursos) {
      const [rg] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao FROM recurso_glosa WHERE id = ? AND excluido_em IS NULL',
        [rid],
      );
      if (!rg) continue;
      const itens = await tx.consultar<Linha>(
        'SELECT valor_recursado, valor_acatado FROM recurso_glosa_item WHERE recurso_glosa_id = ? AND excluido_em IS NULL',
        [rid],
      );
      const s = situacaoDoRecurso(
        itens.map((i) => ({
          valorRecursado: n(i['valor_recursado']),
          valorAcatado: i['valor_acatado'] === null ? null : n(i['valor_acatado']),
        })),
      );
      await tx.alterar('recurso_glosa', rid, n(rg['versao']), {
        situacao: s.situacao,
        valor_acatado: s.completo ? s.valorAcatado : null,
        retorno_em: e.data,
      });
    }
    for (const gid of glosas) {
      const [cab] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, situacao FROM glosa WHERE id = ? AND excluido_em IS NULL',
        [gid],
      );
      if (!cab) continue;
      const itens = await tx.consultar<Linha>(
        `SELECT decisao, recurso_glosa_id, data_recuperacao, valor_recuperado FROM glosa_item
          WHERE glosa_id = ? AND excluido_em IS NULL`,
        [gid],
      );
      const s = situacaoDaGlosaNoRecurso(
        texto(cab['situacao']),
        itens.map((i) => ({
          decisao: texto(i['decisao']),
          emRecurso: i['recurso_glosa_id'] !== null,
          retornado: i['data_recuperacao'] !== null,
          valorRecuperado: n(i['valor_recuperado']),
        })),
      );
      await tx.alterar('glosa', gid, n(cab['versao']), {
        situacao: s.situacao,
        valor_recuperado: s.valorRecuperado,
        encerrado_em: s.encerrada ? new Date() : null,
      });
    }
    return { itens: e.itens.length, primeiro: e.itens[0]!.item, recursos: [...recursos].join(',') };
  },
  alvo: (_e, r) => ({ tabela: 'recurso_glosa', id: n(String(r['recursos']).split(',')[0]) }),
  trilha: (e) => ({
    dados: {
      itens: e.itens.length,
      data: e.data,
      numeroDemonstrativo: e.numeroDemonstrativo,
      desfechos: e.itens.map((i) => i.desfecho),
    },
  }),
});

/** As três operações do ciclo da glosa por item, pelo nome do executor. */
export const operacoesGlosa = {
  'faturamento.registrarGlosa': registrarGlosa,
  'faturamento.registrarRecurso': registrarRecurso,
  'faturamento.registrarRetornoRecurso': registrarRetornoRecurso,
} as const;
