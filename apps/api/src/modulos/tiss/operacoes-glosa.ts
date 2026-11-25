// F3.7 (06-FAT linhas 33 e 34): a baixa do retorno por item, o lote de recurso e o retorno do recurso sobre o banco do
// cliente, pelo Executor do @sgh/nucleo (trilha, outbox e idempotência na mesma transação; sem gatilho).
// - Baixa (faturamento.registrarGlosa): grava o pago no item da conta e, quando há glosa, a glosa (uma por conta, com
//   o número da sequência do estabelecimento) e o item glosado com o motivo da terminologia; ligada ao demonstrativo
//   quando veio dele. Regra 7 do domínio (conferirBaixa).
// - Recurso (faturamento.registrarRecurso): um lote de recurso por fonte pagadora, com os itens decididos como
//   "recorrer" (a justificativa da decisão vai ao item do recurso), o valor pleiteado e o protocolo; a glosa vai a
//   "em recurso". Regra do domínio: conferirItemDoRecurso. Cada recurso vira a guia de recurso TISS 04.03.00
//   (RECURSO_GLOSA, por item): um lote de recurso por fonte pagadora e lote de origem; o XML passa no XSD, é guardado
//   pela porta de arquivos e fica num lote_tiss "recurso_glosa" (arquivo, hash, valor), ligado ao recurso
//   (recurso_glosa.lote_tiss_id) e ao lote de origem. Sem lote de origem protocolado ou cadastro TISS, o recurso é
//   gravado e o alerta diz o que falta para a guia (faltasDoRecursoTiss); XSD recusado não grava nada.
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
  faltasDoRecursoTiss,
  type ItemRecursoTiss,
  type MontadorRecursoTiss,
  recursoTissDoLote,
  conferirDesfecho,
  conferirItemDoRecurso,
  lotesDeRecurso,
  MOTIVO_NAO_INFORMADO,
  prazoRecurso,
  situacaoDaGlosaNoRecurso,
  situacaoDoRecurso,
  valorPadraoDoRecurso,
  VERSAO_TISS_VIGENTE,
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
import { tabelaTissDoItem } from './regras-tiss.js';

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

/** O lote TISS de origem da conta (o mais recente não cancelado, fora os de recurso) e a guia principal nele. */
const SQL_ORIGEM = `
  SELECT lt.id AS lote, lt.numero_lote, lt.numero_protocolo,
         (SELECT gt.numero_guia_prestador FROM guia_tiss gt WHERE gt.lote_tiss_id = lt.id AND gt.conta_hospitalar_id = ltc.conta_hospitalar_id
             AND gt.excluido_em IS NULL ORDER BY gt.guia_tiss_principal_id IS NOT NULL, gt.id LIMIT 1) AS numero_guia,
         (SELECT gt.numero_guia_operadora FROM guia_tiss gt WHERE gt.lote_tiss_id = lt.id AND gt.conta_hospitalar_id = ltc.conta_hospitalar_id
             AND gt.excluido_em IS NULL ORDER BY gt.guia_tiss_principal_id IS NOT NULL, gt.id LIMIT 1) AS guia_operadora,
         (SELECT gt.senha FROM guia_tiss gt WHERE gt.lote_tiss_id = lt.id AND gt.conta_hospitalar_id = ltc.conta_hospitalar_id
             AND gt.excluido_em IS NULL ORDER BY gt.guia_tiss_principal_id IS NOT NULL, gt.id LIMIT 1) AS senha
    FROM lote_tiss_conta ltc JOIN lote_tiss lt ON lt.id = ltc.lote_tiss_id
   WHERE ltc.conta_hospitalar_id = ? AND ltc.excluido_em IS NULL AND lt.excluido_em IS NULL
     AND lt.situacao <> 'cancelado' AND lt.tipo_envio <> 'recurso_glosa'
   ORDER BY lt.id DESC LIMIT 1`;

/** O item recorrido como vai à guia de recurso: o item faturável, a data e o motivo da glosa na terminologia. */
const SQL_ITEM_TISS = `
  SELECT ifa.codigo, ifa.descricao, ifa.tipo_item, ci.realizado_em, mg.codigo_tuss
    FROM conta_hospitalar_item ci
    JOIN item_faturavel ifa ON ifa.id = ci.item_faturavel_id
    LEFT JOIN motivo_glosa mg ON mg.id = ?
   WHERE ci.id = ?`;

/** O cadastro TISS vigente do convênio no estabelecimento (como na geração do lote) e o nome da operadora. */
const SQL_CADASTRO_TISS = `
  SELECT f.nome, c.registro_ans, c.codigo_prestador_operadora, c.versao_padrao_tiss_id, f.registro_ans AS registro_fonte
    FROM fonte_pagadora f
    LEFT JOIN configuracao_tiss_fonte_pagadora c ON c.fonte_pagadora_id = f.id AND c.estabelecimento_id = ?
          AND c.ativo = TRUE AND c.vigencia_inicio <= CURRENT_DATE
          AND (c.vigencia_fim IS NULL OR c.vigencia_fim >= CURRENT_DATE)
   WHERE f.id = ? AND f.excluido_em IS NULL
   ORDER BY c.vigencia_inicio DESC LIMIT 1`;

/**
 * A guia de recurso TISS do recurso gravado: confere as faltas (alerta, nada de XML), monta e valida no XSD (recusa
 * se o XSD não aceita), guarda o XML e grava o lote_tiss "recurso_glosa" com o arquivo; devolve o id do lote ou null.
 */
async function guiaDeRecursoTiss(
  tx: TxOperacao,
  montador: MontadorRecursoTiss | null,
  d: {
    readonly est: number;
    readonly usuario: number | null;
    readonly fonte: number;
    readonly loteOrigem: number | null;
    readonly numeroRecurso: string;
    readonly dataRecurso: string;
    readonly enviado: Date;
    readonly origem: Linha | null;
    readonly itens: readonly ItemRecursoTiss[];
  },
  alertas: Set<string>,
): Promise<number | null> {
  const cfg = await tx.uma<Linha>(SQL_CADASTRO_TISS, [d.est, d.fonte]);
  const o = {
    numeroLote: d.origem ? texto(d.origem['numero_lote']) || null : null,
    numeroProtocolo: d.origem ? texto(d.origem['numero_protocolo']) || null : null,
    registroAns: texto(cfg?.['registro_ans'] ?? cfg?.['registro_fonte']).replace(/\D/g, ''),
    codigoPrestador: texto(cfg?.['codigo_prestador_operadora']).trim(),
    nomeOperadora: texto(cfg?.['nome']),
  };
  const faltas = faltasDoRecursoTiss(o, d.itens);
  if (faltas.length) {
    alertas.add(
      `A guia de recurso TISS do recurso ${d.numeroRecurso} não foi gerada: falta ${faltas.join(', ')}. O recurso ficou registrado.`,
    );
    return null;
  }
  if (!montador) {
    alertas.add(
      `A guia de recurso TISS do recurso ${d.numeroRecurso} não foi gerada: a guarda do XML TISS não está configurada.`,
    );
    return null;
  }
  const versao =
    cfg?.['versao_padrao_tiss_id'] ??
    (
      await tx.uma<Linha>(
        'SELECT id FROM versao_padrao_tiss WHERE codigo_tiss = ? AND ativo = TRUE LIMIT 1',
        [VERSAO_TISS_VIGENTE],
      )
    )?.['id'];
  if (!versao)
    throw recusa(
      'versao-tiss-ausente',
      `A versão ${VERSAO_TISS_VIGENTE} do padrão TISS não está no catálogo do estabelecimento.`,
    );
  await garantirSequencia(
    tx,
    { tipo: 'lote_tiss', estabelecimento: d.est, inicio: 1 },
    { usuario: d.usuario, agora: new Date() },
  );
  const numeroLote = String((await tx.proximoNumero('lote_tiss')).valor).padStart(12, '0');
  const m = await montador({
    hospital: String(d.est),
    convenio: d.fonte,
    numeroLote,
    prestador: { registroAns: o.registroAns, codigoPrestador: o.codigoPrestador },
    recurso: recursoTissDoLote(d.numeroRecurso, d.dataRecurso, o, d.itens),
    agora: new Date(),
  });
  if (!m.valido)
    throw recusa(
      'xsd-invalido',
      `A guia de recurso não passou no XSD da TISS ${VERSAO_TISS_VIGENTE}: ${m.explicacao.slice(0, 3).join(' ')}`,
    );
  const arquivo = await tx.incluir('arquivo', {
    estabelecimento_id: d.est,
    entidade: 'lote_tiss',
    finalidade: 'xml_lote_tiss',
    nome_original: `recurso-${numeroLote}.xml`,
    tipo_mime: 'application/xml',
    tamanho_bytes: m.bytes,
    hash_sha256: m.hashArquivo,
    chave_armazenamento: m.chaveObjeto,
    imutavel: true,
  });
  const lote = await tx.incluir('lote_tiss', {
    estabelecimento_id: d.est,
    fonte_pagadora_id: d.fonte,
    numero_lote: numeroLote,
    sequencial: numeroLote,
    tipo_envio: 'recurso_glosa',
    original_lote_tiss_id: d.loteOrigem,
    tipo_guia: 'recurso_glosa',
    versao_padrao_tiss_id: versao,
    gerado_em: new Date(),
    quantidade_guias: m.guias,
    valor_total: m.valor,
    hash_epilogo: m.hashEpilogo,
    hash_arquivo: m.hashArquivo,
    tamanho_bytes: m.bytes,
    arquivo_id: arquivo,
    situacao: 'enviado',
    enviado_em: d.enviado,
  });
  await tx.alterar('arquivo', arquivo, 1, { entidade_id: lote });
  return lote;
}

const registrarRecurso = (montador: MontadorRecursoTiss | null) =>
  definirOperacao<RecursoComPrazo, ResultadoOperacao>({
    nome: 'faturamento.registrar-recurso',
    tabelas: [
      'recurso_glosa',
      'recurso_glosa_item',
      'glosa',
      'glosa_item',
      'sequencia_negocio',
      'lote_tiss',
      'arquivo',
    ],
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
        const emRecurso = l['recurso_glosa_id'] !== null || n(l['valor_recursado']) > 0;
        // Reapresentação: o recurso atual do item já teve retorno (negado ou em parte); o novo fica ligado a ele, com o
        // prazo contado da data do retorno e o teto descontado do que já voltou.
        const retornado = emRecurso && l['data_recuperacao'] !== null;
        const g = {
          decisao: texto(l['decisao']),
          justificativa: l['justificativa'] === null ? null : texto(l['justificativa']),
          valorGlosado: n(l['valor_glosado']),
          valorAceito: n(l['valor_aceito']),
          emRecurso,
          retornoAnterior: retornado ? { valorAcatado: n(l['valor_recuperado']) } : null,
          // Glosa sem prazo gravado (anterior à baixa por item, ou de outra origem): a mesma regra da grade.
          prazo: retornado
            ? prazoRecurso(e.prazoParametro ?? '', n(l['fonte_pagadora_id']), dataIso(l['data_recuperacao']))
                .prazo
            : (dataIso(l['data_limite_recurso']) ??
              prazoRecurso(e.prazoParametro ?? '', n(l['fonte_pagadora_id']), dataIso(l['data_glosa']))
                .prazo),
        };
        const valor = r2(it.valor ?? valorPadraoDoRecurso(g));
        const r = conferirItemDoRecurso(g, valor, e.dataProtocolo);
        if (r)
          throw recusa(r.codigo, `Item ${it.item}: ${r.mensagem}`, r.campos ? { campos: [...r.campos] } : {});
        const quantidade = it.quantidade ?? (n(l['quantidade_glosada']) || n(l['quantidade']) || 1);
        return {
          l,
          valor,
          quantidade,
          prazo: g.prazo,
          fontePagadora: n(l['fonte_pagadora_id']),
          recursoAnterior: retornado ? n(l['recurso_glosa_id']) : null,
        };
      });
      // O lote TISS de origem de cada conta: a guia de recurso cita um lote e o protocolo dele.
      const origens = new Map<number, Linha | null>();
      for (const p of pedidos) {
        const conta = n(p.l['conta_hospitalar_id']);
        if (!origens.has(conta)) origens.set(conta, (await tx.uma<Linha>(SQL_ORIGEM, [conta])) ?? null);
      }
      const comOrigem = pedidos.map((p) => {
        const og = origens.get(n(p.l['conta_hospitalar_id'])) ?? null;
        return { ...p, origem: og, loteOrigem: og ? n(og['lote']) : null };
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
      const lotesTiss: number[] = [];
      for (const lote of lotesDeRecurso(comOrigem)) {
        const total = r2(lote.itens.reduce((t, p) => t + p.valor, 0));
        const prazos = lote.itens.map((p) => p.prazo).filter((x): x is string => !!x);
        const numeroRecurso = await numeroNegocio(tx, 'recurso_glosa', est, ctx.usuario);
        const rec = await tx.incluir('recurso_glosa', {
          estabelecimento_id: est,
          numero: numeroRecurso,
          fonte_pagadora_id: lote.fontePagadora,
          recurso_glosa_anterior_id: lote.recursoAnterior,
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
          // No item da glosa, o recursado é o total pleiteado na cadeia de recursos: o que já voltou nos anteriores mais o
          // valor deste (sem reapresentação, só este); o valor de cada recurso fica no item do recurso.
          const recursado = r2(n(p.l['valor_recuperado']) + p.valor);
          await tx.alterar('glosa_item', n(p.l['glosa_item']), n(p.l['versao_glosa']), {
            valor_recursado: recursado,
            quantidade_recursada: p.quantidade,
            recurso_glosa_id: rec,
            // Reapresentação: o item volta a esperar retorno; o anterior fica no item do recurso antigo (retornado_em) e
            // o valor recuperado segue somado.
            ...(lote.recursoAnterior !== null ? { data_recuperacao: null } : {}),
          });
          const gid = n(p.l['glosa_id']);
          porGlosa.set(gid, r2((porGlosa.get(gid) ?? 0) + recursado - n(p.l['valor_recursado'])));
        }
        const itensTiss: ItemRecursoTiss[] = [];
        for (const p of lote.itens) {
          const it = await tx.uma<Linha>(SQL_ITEM_TISS, [p.l['motivo_glosa_id'] ?? null, n(p.l['id'])]);
          itensTiss.push({
            numeroGuia: p.origem ? texto(p.origem['numero_guia']) || null : null,
            numeroGuiaOperadora: p.origem ? texto(p.origem['guia_operadora']) || null : null,
            senha: p.origem ? texto(p.origem['senha']) || null : null,
            data: dataIso(it?.['realizado_em']),
            codigoTabela: tabelaTissDoItem(texto(it?.['tipo_item'])),
            codigo: texto(it?.['codigo']),
            descricao: texto(it?.['descricao']),
            codigoGlosa: it?.['codigo_tuss'] ? texto(it['codigo_tuss']).padStart(4, '0') : null,
            valorRecursado: p.valor,
            justificativa: texto(p.l['justificativa']),
          });
        }
        const loteTiss = await guiaDeRecursoTiss(
          tx,
          montador,
          {
            est,
            usuario: ctx.usuario ?? null,
            fonte: lote.fontePagadora,
            loteOrigem: lote.loteOrigem,
            numeroRecurso,
            dataRecurso: e.dataProtocolo,
            enviado,
            origem: lote.itens[0]!.origem,
            itens: itensTiss,
          },
          alertas,
        );
        if (loteTiss !== null) {
          await tx.alterar('recurso_glosa', rec, 1, { lote_tiss_id: loteTiss });
          lotesTiss.push(loteTiss);
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
            encerrado_em: null,
          });
      }
      return {
        itens: e.itens.length,
        primeiro: e.itens[0]!.item,
        recursos: recursos.join(','),
        lotesTiss: lotesTiss.join(','),
        alertas: [...alertas].join(' '),
      };
    },
    alvo: (_e, r) => ({ tabela: 'recurso_glosa', id: n(String(r['recursos']).split(',')[0]) }),
    trilha: (e, r) => ({
      dados: {
        itens: e.itens.length,
        dataProtocolo: e.dataProtocolo,
        recursos: r['recursos'],
        lotesTiss: r['lotesTiss'],
      },
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
      // O retorno é do recurso atual do item (na reapresentação, o anterior já retornou e fica no item antigo).
      const [ri] =
        l['glosa_item'] === null || l['recurso_glosa_id'] === null
          ? []
          : await tx.consultarParaAtualizar<Linha>(
              `SELECT id, versao, valor_recursado, valor_acatado, retornado_em FROM recurso_glosa_item
                WHERE glosa_item_id = ? AND recurso_glosa_id = ? AND excluido_em IS NULL`,
              [l['glosa_item'], l['recurso_glosa_id']],
            );
      const d = conferirDesfecho({
        item: {
          valorRecurso: ri ? n(ri['valor_recursado']) : 0,
          quantidadeRecurso: 0,
          dataRecurso: dataIso(l['recurso_em']),
          valorRetorno: ri ? n(ri['valor_acatado']) : 0,
          dataRetorno: ri ? dataIso(ri['retornado_em']) : null,
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
        // Somado: na reapresentação, o que voltou nos recursos anteriores continua no item.
        valor_recuperado: r2(n(p.l['valor_recuperado']) + p.valor),
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

/** O montador da guia de recurso que acompanha o do lote (criarMontadorLote); null sem a guarda do XML. */
export function montadorRecursoDe(montador: unknown): MontadorRecursoTiss | null {
  const r = (montador as { readonly recurso?: unknown } | null)?.recurso;
  return typeof r === 'function' ? (r as MontadorRecursoTiss) : null;
}

/** As três operações do ciclo da glosa por item, pelo nome do executor (o recurso gera a guia TISS com o montador). */
export function operacoesGlosaCom(montador: unknown) {
  return {
    'faturamento.registrarGlosa': registrarGlosa,
    'faturamento.registrarRecurso': registrarRecurso(montadorRecursoDe(montador)),
    'faturamento.registrarRetornoRecurso': registrarRetornoRecurso,
  } as const;
}

/** Sem a guarda do XML: o recurso é gravado e o alerta diz que a guia TISS não foi gerada. */
export const operacoesGlosa = operacoesGlosaCom(null);
