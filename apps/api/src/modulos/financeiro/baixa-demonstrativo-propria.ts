// F3.8, 07-FIN linha 76: baixa dos títulos do convênio pelo demonstrativo de pagamento importado da operadora (o que a
// importação do faturamento grava com o liberado e o glosado por item da conta), no banco próprio, pelo executor do
// @sgh/nucleo. A regra é a do domínio (planejarBaixaDemonstrativo): uma baixa por título, com o recebido e o glosado
// por item, em vez de digitar item a item.
// O que fica no banco: UM crédito na conta bancária pelo total pago; por título, um recebimento com o meio
// "demonstrativo" (número do demonstrativo no documento) e uma linha por item da conta (apresentado, recebido, glosa e
// motivo); a parcela e o título somam o recebido. A glosa NÃO baixa o saldo: fica em aberto no título até ser aceita ou
// o recurso voltar (registro da glosa no título, já existente). O demonstrativo já baixado é recusado.
// Desfazer a baixa (conta, data ou demonstrativo errado): os recebimentos do demonstrativo ficam estornados com o motivo,
// quem e quando; um débito contrário sai da conta na data de hoje, ligado ao crédito da baixa (o crédito original fica
// como estava, no dia dele: período fechado não muda); a parcela e o título recuperam o saldo. Nada é apagado, e o
// demonstrativo volta a poder ser baixado.
import {
  type LinhaDoDemonstrativo,
  planejarBaixaDemonstrativo,
  planejarDesfazerBaixaDemonstrativo,
  type RecusaFinanceiro,
  type TituloDoDemonstrativo,
} from '@sgh/dominio-financeiro';
import {
  type ContextoOperacao,
  definirOperacao,
  garantirSequencia,
  type Leitor,
  recusa,
  type ResultadoOperacao,
} from '@sgh/nucleo';
import {
  apurarReceitaContabilDosItens,
  TABELAS_RECEITA_CONTABIL,
} from '../faturamento/receita-contabil-propria.js';
import { z } from 'zod';
import { exigirPeriodoAberto } from './periodo-propria.js';
import { dataIso, LANCAMENTO_RECEBIMENTO, numero, numeroOuNulo } from './vocabulario.js';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const ph = (n: readonly unknown[]) => n.map(() => '?').join(',');
type Linha = Record<string, unknown>;

export const esquemaBaixarDemonstrativo = z
  .object({ demonstrativo: id, conta: id, dataRecebimento: DATA })
  .strict();
export const esquemaDesfazerBaixaDemonstrativo = z
  .object({ demonstrativo: id, motivo: z.string().trim().max(400) })
  .strict();
/** O número do demonstrativo como fica no documento do recebimento e do movimento (30 posições). */
const documentoDe = (numeroDemonstrativo: unknown) => String(numeroDemonstrativo).slice(0, 30);

function recusar<T extends object>(r: RecusaFinanceiro | T): T {
  if ('codigo' in r && 'mensagem' in r) {
    const x = r as RecusaFinanceiro;
    throw recusa(x.codigo, x.mensagem, x.campos ? { campos: x.campos } : {});
  }
  return r as T;
}

/** O título (não cancelado, do mesmo convênio) da conta de cada item do demonstrativo. */
const TITULO_DO_ITEM = `(SELECT t.id FROM conta_hospitalar_item ci
     JOIN documento_origem_titulo o ON o.entidade = 'conta_hospitalar' AND o.entidade_id = ci.conta_hospitalar_id
          AND o.excluido_em IS NULL
     JOIN titulo_receber t ON t.id = o.titulo_receber_id AND t.excluido_em IS NULL AND t.situacao <> 'cancelado'
          AND t.estabelecimento_id = d.estabelecimento_id AND t.fonte_pagadora_id = d.fonte_pagadora_id
    WHERE ci.id = i.conta_hospitalar_item_id ORDER BY t.id DESC LIMIT 1)`;

async function demonstrativoLido(l: Leitor, est: number, demonstrativo: number) {
  const d = await l.uma(
    `SELECT id, situacao, numero_demonstrativo, fonte_pagadora_id FROM demonstrativo_analise_conta
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [demonstrativo, est],
  );
  if (!d) throw recusa('demonstrativo-inexistente', 'O demonstrativo não existe neste estabelecimento.');
  const linhas = await l.consultar(
    `SELECT i.conta_hospitalar_item_id, i.valor_informado, i.valor_liberado, i.valor_glosa, i.motivo_glosa_id,
            ${TITULO_DO_ITEM} AS titulo
       FROM demonstrativo_analise_conta_item i JOIN demonstrativo_analise_conta d ON d.id = i.demonstrativo_analise_conta_id
      WHERE i.demonstrativo_analise_conta_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia LIMIT 20000`,
    [demonstrativo],
  );
  const ja = await l.uma(
    `SELECT r.id FROM recebimento r JOIN parcela_receber p ON p.id = r.parcela_receber_id
       JOIN titulo_receber t ON t.id = p.titulo_receber_id
      WHERE r.estabelecimento_id = ? AND r.meio_baixa = 'demonstrativo' AND r.situacao = 'efetivado'
        AND r.excluido_em IS NULL AND r.numero_documento = ? AND t.fonte_pagadora_id = ? LIMIT 1`,
    [est, documentoDe(d['numero_demonstrativo']), d['fonte_pagadora_id']],
  );
  return {
    cabecalho: d,
    jaBaixado: !!ja,
    linhas: linhas.map((x): LinhaDoDemonstrativo => ({
      itemConta: numeroOuNulo(x['conta_hospitalar_item_id']),
      titulo: numeroOuNulo(x['titulo']),
      informado: numero(x['valor_informado']),
      liberado: numero(x['valor_liberado']),
      glosa: numero(x['valor_glosa']),
      motivoGlosa: numeroOuNulo(x['motivo_glosa_id']),
    })),
  };
}

const titulosDasLinhas = (linhas: readonly LinhaDoDemonstrativo[]) => [
  ...new Set(linhas.filter((x) => x.itemConta !== null && x.titulo !== null).map((x) => x.titulo as number)),
];
function tituloDoPlano(t: Linha, p: Linha | undefined): TituloDoDemonstrativo {
  return {
    titulo: numero(t['id']),
    situacao: String(t['situacao']),
    parcela: p ? numero(p['id']) : null,
    saldo: numero(p?.['saldo']),
  };
}
const PARCELAS_ABERTAS = (n: readonly number[]) =>
  `SELECT id, versao, titulo_receber_id, saldo, valor_recebido, situacao FROM parcela_receber
    WHERE titulo_receber_id IN (${ph(n)}) AND excluido_em IS NULL AND saldo > 0 AND situacao IN ('aberta','parcial')
    ORDER BY titulo_receber_id, sequencia`;
/** A primeira parcela em aberto de cada título. */
function primeiraPorTitulo(parcelas: readonly Linha[]): Map<number, Linha> {
  const m = new Map<number, Linha>();
  for (const p of parcelas)
    if (!m.has(numero(p['titulo_receber_id']))) m.set(numero(p['titulo_receber_id']), p);
  return m;
}

const baixarDemonstrativo = definirOperacao<z.infer<typeof esquemaBaixarDemonstrativo>, ResultadoOperacao>({
  nome: 'financeiro.baixar_demonstrativo_pagamento',
  tabelas: [
    'recebimento',
    'recebimento_item_conta',
    'movimento_bancario',
    'parcela_receber',
    'titulo_receber',
    'sequencia_negocio',
    ...TABELAS_RECEITA_CONTABIL,
  ],
  entrada: esquemaBaixarDemonstrativo as never,
  async gravar(tx, e, ctx: ContextoOperacao) {
    if (ctx.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
    const est = ctx.estabelecimento;
    const usuario = ctx.usuario;
    await exigirPeriodoAberto(tx, est, e.dataRecebimento, 'dataRecebimento');
    // O escopo de contas do usuário mora em operacoes.ts (importação tardia, sem ciclo na carga dos módulos).
    const { contasDoEscopo } = await import('./operacoes.js');
    if (!(await contasDoEscopo(tx, est, usuario, 'movimentar')).includes(e.conta))
      throw recusa('fora-do-escopo', 'A conta bancária não está no seu escopo de contas.', {
        campos: ['conta'],
      });
    const conta = await tx.uma(
      'SELECT id, permite_recebimento FROM conta_bancaria WHERE id = ? AND estabelecimento_id = ?',
      [e.conta, est],
    );
    if (!conta || !Number(conta['permite_recebimento']))
      throw recusa('conta-nao-recebe', 'Esta conta bancária não é usada para recebimentos.', {
        campos: ['conta'],
      });
    const lido = await demonstrativoLido(tx, est, e.demonstrativo);
    const ids = titulosDasLinhas(lido.linhas);
    const titulos = ids.length
      ? await tx.consultarParaAtualizar(
          `SELECT id, versao, situacao, valor_recebido, natureza_financeira_id FROM titulo_receber
            WHERE id IN (${ph(ids)}) AND estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id`,
          [...ids, est],
          { teto: 5000 },
        )
      : [];
    const parcelas = ids.length
      ? await tx.consultarParaAtualizar(PARCELAS_ABERTAS(ids), [...ids], { teto: 20000 })
      : [];
    const primeira = primeiraPorTitulo(parcelas);
    const plano = recusar(
      planejarBaixaDemonstrativo({
        situacao: String(lido.cabecalho['situacao']),
        jaBaixado: lido.jaBaixado,
        linhas: lido.linhas,
        titulos: titulos.map((t) => tituloDoPlano(t, primeira.get(numero(t['id'])))),
      }),
    );
    const numeroDemonstrativo = String(lido.cabecalho['numero_demonstrativo']);
    const forma = await tx.uma(
      `SELECT id FROM forma_recebimento WHERE ativo = TRUE AND uso IN ('recebimento','ambos')
        ORDER BY (meio IN ('transferencia','credito_conta')) DESC, padrao DESC, id LIMIT 1`,
      [],
    );
    if (!forma)
      throw recusa('cadastro-ausente', 'Falta no cadastro uma forma de recebimento ativa.', {
        campos: ['conta'],
      });
    const porTitulo = new Map(titulos.map((t) => [numero(t['id']), t]));
    let movimento: number | null = null;
    if (plano.totalRecebido > 0) {
      const tipo = await tx.uma('SELECT id FROM tipo_lancamento_bancario WHERE codigo = ? AND ativo = TRUE', [
        LANCAMENTO_RECEBIMENTO,
      ]);
      if (!tipo)
        throw recusa('cadastro-ausente', 'Falta no cadastro o tipo de lançamento bancário do recebimento.');
      movimento = await tx.incluir('movimento_bancario', {
        estabelecimento_id: est,
        conta_bancaria_id: e.conta,
        tipo_lancamento_bancario_id: tipo['id'],
        natureza: 'credito',
        tipo_origem: 'manual',
        data_movimento: e.dataRecebimento,
        numero_documento: numeroDemonstrativo.slice(0, 30),
        historico: `Recebimento pelo demonstrativo de pagamento ${numeroDemonstrativo}`.slice(0, 300),
        valor: plano.totalRecebido,
        natureza_financeira_id:
          porTitulo.get(plano.baixas[0]?.titulo ?? 0)?.['natureza_financeira_id'] ?? null,
      });
    }
    await garantirSequencia(
      tx,
      { tipo: 'recebimento', estabelecimento: est, prefixo: 'RC-' },
      { usuario, agora: new Date() },
    );
    let itens = 0;
    for (const b of plano.baixas) {
      const t = porTitulo.get(b.titulo) as Linha;
      const p = primeira.get(b.titulo) as Linha;
      const num = await tx.proximoNumero('recebimento');
      const recebimento = await tx.incluir('recebimento', {
        estabelecimento_id: est,
        numero: num.formatado,
        parcela_receber_id: b.parcela,
        data_recebimento: e.dataRecebimento,
        forma_recebimento_id: forma['id'],
        conta_bancaria_id: e.conta,
        numero_documento: numeroDemonstrativo.slice(0, 30),
        valor_recebido: b.recebido,
        valor_glosa: b.glosa,
        meio_baixa: 'demonstrativo',
        movimento_bancario_id: b.recebido > 0 ? movimento : null,
        observacao: `Baixa pelo demonstrativo de pagamento ${numeroDemonstrativo}`.slice(0, 500),
      });
      let sequencia = 0;
      for (const i of b.itens) {
        sequencia += 1;
        itens += 1;
        await tx.incluir('recebimento_item_conta', {
          recebimento_id: recebimento,
          sequencia,
          conta_hospitalar_item_id: i.itemConta,
          valor_apresentado: i.apresentado,
          valor_recebido: i.recebido,
          valor_glosa: i.glosa,
          motivo_glosa_id: i.glosa > 0 ? i.motivoGlosa : null,
          glosa_identificada: i.glosa > 0 && i.motivoGlosa !== null,
          situacao: i.situacao,
        });
      }
      if (b.recebido > 0) {
        await tx.alterar('parcela_receber', b.parcela, numero(p['versao']), {
          valor_recebido: centavos(numero(p['valor_recebido']) + b.recebido),
          saldo: b.saldoRestante,
          situacao: b.quita ? 'recebida' : 'parcial',
          quitada_em: b.quita ? e.dataRecebimento : null,
        });
        const outrasAbertas = parcelas.some(
          (x) => numero(x['titulo_receber_id']) === b.titulo && numero(x['id']) !== b.parcela,
        );
        await tx.alterar('titulo_receber', b.titulo, numero(t['versao']), {
          valor_recebido: centavos(numero(t['valor_recebido']) + b.recebido),
          situacao: b.quita && !outrasAbertas ? 'recebido' : 'recebido_parcial',
        });
      }
    }
    // F3.7 (06-FAT L37): o recebido de cada item entra na receita contábil da conta (mesma transação).
    await apurarReceitaContabilDosItens(
      tx,
      est,
      plano.baixas.flatMap((b) => b.itens.map((i) => i.itemConta)),
    );
    return {
      demonstrativo: e.demonstrativo,
      numero: numeroDemonstrativo,
      titulos: plano.baixas.length,
      itens,
      recebido: plano.totalRecebido,
      glosa: plano.totalGlosa,
      linhasSemTitulo: plano.linhasSemTitulo,
      valorSemTitulo: plano.valorSemTitulo,
      conta: e.conta,
      movimento,
    };
  },
  alvo: (e) => ({ tabela: 'demonstrativo_analise_conta', id: e.demonstrativo }),
  eventos: (_e, r) => [
    {
      tipo: 'financeiro.titulo_receber.recebido',
      carga: { titulos: numero(r['titulos']), conta: numero(r['conta']) },
    },
  ],
});

const desfazerBaixaDemonstrativo = definirOperacao<
  z.infer<typeof esquemaDesfazerBaixaDemonstrativo>,
  ResultadoOperacao
>({
  nome: 'financeiro.desfazer_baixa_demonstrativo',
  tabelas: ['recebimento', 'movimento_bancario', 'parcela_receber', 'titulo_receber'],
  entrada: esquemaDesfazerBaixaDemonstrativo as never,
  async gravar(tx, e, ctx: ContextoOperacao) {
    if (ctx.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    if (ctx.usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
    const est = ctx.estabelecimento;
    const usuario = ctx.usuario;
    const agora = new Date();
    const hoje = agora.toISOString().slice(0, 10);
    await exigirPeriodoAberto(tx, est, hoje, 'motivo');
    const d = await tx.uma(
      `SELECT id, numero_demonstrativo, fonte_pagadora_id FROM demonstrativo_analise_conta
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.demonstrativo, est],
    );
    if (!d) throw recusa('demonstrativo-inexistente', 'O demonstrativo não existe neste estabelecimento.');
    const documento = documentoDe(d['numero_demonstrativo']);
    const recebimentos = await tx.consultarParaAtualizar(
      `SELECT r.id, r.versao, r.parcela_receber_id, r.valor_recebido, r.conta_bancaria_id, r.movimento_bancario_id,
              p.titulo_receber_id
         FROM recebimento r JOIN parcela_receber p ON p.id = r.parcela_receber_id
         JOIN titulo_receber t ON t.id = p.titulo_receber_id
        WHERE r.estabelecimento_id = ? AND r.meio_baixa = 'demonstrativo' AND r.situacao = 'efetivado'
          AND r.excluido_em IS NULL AND r.numero_documento = ? AND t.fonte_pagadora_id = ? ORDER BY r.id`,
      [est, documento, d['fonte_pagadora_id']],
      { teto: 5000 },
    );
    const idsParcela = [...new Set(recebimentos.map((r) => numero(r['parcela_receber_id'])))];
    const idsTitulo = [...new Set(recebimentos.map((r) => numero(r['titulo_receber_id'])))];
    const idsMovimento = [
      ...new Set(recebimentos.map((r) => numero(r['movimento_bancario_id'])).filter((x) => x > 0)),
    ];
    const titulos = idsTitulo.length
      ? await tx.consultarParaAtualizar(
          `SELECT id, versao, situacao, valor_recebido FROM titulo_receber WHERE id IN (${ph(idsTitulo)}) ORDER BY id`,
          [...idsTitulo],
          { teto: 5000 },
        )
      : [];
    const parcelas = idsParcela.length
      ? await tx.consultarParaAtualizar(
          `SELECT id, versao, situacao, saldo, valor_recebido FROM parcela_receber WHERE id IN (${ph(idsParcela)}) ORDER BY id`,
          [...idsParcela],
          { teto: 5000 },
        )
      : [];
    const movimentos = idsMovimento.length
      ? await tx.consultarParaAtualizar(
          `SELECT id, conta_bancaria_id, tipo_lancamento_bancario_id, valor, conciliado, natureza_financeira_id
             FROM movimento_bancario WHERE id IN (${ph(idsMovimento)}) AND situacao = 'ativo' ORDER BY id`,
          [...idsMovimento],
          { teto: 100 },
        )
      : [];
    const parcelaDe = new Map(parcelas.map((p) => [numero(p['id']), p]));
    const tituloDe = new Map(titulos.map((t) => [numero(t['id']), t]));
    const plano = recusar(
      planejarDesfazerBaixaDemonstrativo({
        recebimentos: recebimentos.map((r) => {
          const p = parcelaDe.get(numero(r['parcela_receber_id']));
          const t = tituloDe.get(numero(r['titulo_receber_id']));
          return {
            recebimento: numero(r['id']),
            parcela: numero(r['parcela_receber_id']),
            titulo: numero(r['titulo_receber_id']),
            recebido: numero(r['valor_recebido']),
            situacaoParcela: String(p?.['situacao'] ?? ''),
            saldoParcela: numero(p?.['saldo']),
            recebidoParcela: numero(p?.['valor_recebido']),
            situacaoTitulo: String(t?.['situacao'] ?? ''),
            recebidoTitulo: numero(t?.['valor_recebido']),
          };
        }),
        creditoConciliado: movimentos.some((m) => !!Number(m['conciliado'])),
        motivo: e.motivo,
      }),
    );
    // Quem desfaz precisa movimentar a conta em que o crédito entrou.
    const { contasDoEscopo } = await import('./operacoes.js');
    const escopo = await contasDoEscopo(tx, est, usuario, 'movimentar');
    if (recebimentos.some((r) => !escopo.includes(numero(r['conta_bancaria_id']))))
      throw recusa('fora-do-escopo', 'A conta bancária desta baixa não está no seu escopo de contas.');
    const motivo = e.motivo.trim();
    for (const r of recebimentos)
      await tx.alterar('recebimento', numero(r['id']), numero(r['versao']), {
        situacao: 'estornado',
        estornado_em: agora,
        estorno_usuario_id: usuario,
        motivo_estorno: motivo.slice(0, 500),
      });
    // O débito contrário, na data de hoje, ligado ao crédito da baixa (que fica no dia dele).
    const debitos: number[] = [];
    for (const m of movimentos)
      debitos.push(
        await tx.incluir('movimento_bancario', {
          estabelecimento_id: est,
          conta_bancaria_id: numero(m['conta_bancaria_id']),
          tipo_lancamento_bancario_id: numero(m['tipo_lancamento_bancario_id']),
          natureza: 'debito',
          tipo_origem: 'estorno',
          data_movimento: hoje,
          numero_documento: documento,
          historico: `Estorno da baixa pelo demonstrativo de pagamento ${documento}: ${motivo}`.slice(0, 300),
          valor: numero(m['valor']),
          natureza_financeira_id: m['natureza_financeira_id'] ?? null,
          estornado_movimento_bancario_id: numero(m['id']),
        }),
      );
    // A parcela e o título ficam como o plano diz (a última devolução de cada parcela traz o saldo final).
    const finalDaParcela = new Map(plano.devolucoes.map((x) => [x.parcela, x]));
    for (const [parcela, x] of finalDaParcela)
      await tx.alterar('parcela_receber', parcela, numero(parcelaDe.get(parcela)?.['versao']), {
        valor_recebido: x.recebidoParcela,
        saldo: x.saldoParcela,
        situacao: x.situacaoParcela,
        quitada_em: null,
      });
    for (const t of plano.titulos)
      await tx.alterar('titulo_receber', t.titulo, numero(tituloDe.get(t.titulo)?.['versao']), {
        valor_recebido: t.recebido,
        situacao: t.situacao,
      });
    return {
      demonstrativo: e.demonstrativo,
      numero: String(d['numero_demonstrativo']),
      recebimentos: recebimentos.length,
      titulos: plano.titulos.length,
      estornado: plano.totalEstornado,
      debitos: debitos.length,
    };
  },
  alvo: (e) => ({ tabela: 'demonstrativo_analise_conta', id: e.demonstrativo }),
  trilha: (e) => ({ dados: null, motivo: e.motivo.trim() }),
  eventos: (_e, r) => [
    {
      tipo: 'financeiro.titulo_receber.recebimento_estornado',
      carga: { titulos: numero(r['titulos']), recebimentos: numero(r['recebimentos']) },
    },
  ],
});

export const OPERACOES_BAIXA_DEMONSTRATIVO = {
  'financeiro.baixarDemonstrativoPagamento': baixarDemonstrativo,
  'financeiro.desfazerBaixaDemonstrativo': desfazerBaixaDemonstrativo,
} as const;

// ── Leituras ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Os demonstrativos importados do estabelecimento, com o que já foi baixado nos títulos. */
export async function demonstrativosImportados(l: Leitor, est: number) {
  const linhas = await l.consultar(
    `SELECT d.id, d.numero_demonstrativo, d.data_emissao, d.situacao, d.valor_informado, d.valor_liberado,
            d.valor_glosa, f.nome AS convenio,
            (SELECT COUNT(*) FROM demonstrativo_analise_conta_item i
              WHERE i.demonstrativo_analise_conta_id = d.id AND i.excluido_em IS NULL) AS linhas,
            EXISTS (SELECT 1 FROM recebimento r JOIN parcela_receber p ON p.id = r.parcela_receber_id
                      JOIN titulo_receber t ON t.id = p.titulo_receber_id
                     WHERE r.estabelecimento_id = d.estabelecimento_id AND r.meio_baixa = 'demonstrativo'
                       AND r.situacao = 'efetivado' AND r.excluido_em IS NULL
                       AND r.numero_documento = LEFT(d.numero_demonstrativo, 30)
                       AND t.fonte_pagadora_id = d.fonte_pagadora_id) AS baixado
       FROM demonstrativo_analise_conta d JOIN fonte_pagadora f ON f.id = d.fonte_pagadora_id
      WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao <> 'cancelado'
      ORDER BY d.data_emissao DESC, d.id DESC LIMIT 200`,
    [est],
  );
  return linhas.map((r) => ({
    id: numero(r['id']),
    numero: String(r['numero_demonstrativo']),
    emissao: dataIso(r['data_emissao']) ?? '',
    convenio: String(r['convenio']),
    situacao: String(r['situacao']),
    informado: numero(r['valor_informado']),
    liberado: numero(r['valor_liberado']),
    glosa: numero(r['valor_glosa']),
    linhas: numero(r['linhas']),
    baixado: !!Number(r['baixado']),
  }));
}

/** A prévia da baixa (sem gravar): o que cada título receberia, o que fica glosado e o que ficou de fora. */
export async function previaDaBaixa(l: Leitor, est: number, demonstrativo: number) {
  const lido = await demonstrativoLido(l, est, demonstrativo);
  const ids = titulosDasLinhas(lido.linhas);
  const titulos = ids.length
    ? await l.consultar(
        `SELECT id, situacao, numero, numero_documento FROM titulo_receber
          WHERE id IN (${ph(ids)}) AND estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id`,
        [...ids, est],
      )
    : [];
  const primeira = primeiraPorTitulo(ids.length ? await l.consultar(PARCELAS_ABERTAS(ids), [...ids]) : []);
  const plano = planejarBaixaDemonstrativo({
    situacao: String(lido.cabecalho['situacao']),
    jaBaixado: lido.jaBaixado,
    linhas: lido.linhas,
    titulos: titulos.map((t) => tituloDoPlano(t, primeira.get(numero(t['id'])))),
  });
  if ('codigo' in plano)
    return {
      id: demonstrativo,
      impedimento: { codigo: plano.codigo, mensagem: plano.mensagem },
      plano: null,
    };
  const porId = new Map(titulos.map((t) => [numero(t['id']), t]));
  return {
    id: demonstrativo,
    impedimento: null,
    plano: {
      totalRecebido: plano.totalRecebido,
      totalGlosa: plano.totalGlosa,
      linhasSemTitulo: plano.linhasSemTitulo,
      valorSemTitulo: plano.valorSemTitulo,
      titulos: plano.baixas.map((b) => ({
        titulo: b.titulo,
        numero: String(porId.get(b.titulo)?.['numero'] ?? ''),
        documento: String(porId.get(b.titulo)?.['numero_documento'] ?? ''),
        saldo: centavos(b.saldoRestante + b.recebido),
        recebido: b.recebido,
        glosa: b.glosa,
        saldoRestante: b.saldoRestante,
        quita: b.quita,
        itens: b.itens.length,
      })),
    },
  };
}
