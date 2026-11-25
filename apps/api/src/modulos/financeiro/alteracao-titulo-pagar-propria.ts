// F3.8, 07-FIN linha 63: alterar o título a pagar ainda não pago (financeiro.alterar_titulo_pagar), pelo executor do
// núcleo (trilha com o antes e o depois, outbox e idempotência na mesma transação). A regra é a do domínio
// (planejarAlteracaoTituloPagar): o descritivo muda sem tocar na aprovação; credor, documento, série, emissão, valor,
// parcelas, retenções ou centro de custo cancelam os pedidos de aprovação do título (as decisões ficam no histórico do
// pedido cancelado) e o título volta à alçada, sem a marca de autorizado.
// As parcelas são casadas pela sequência: a que continua é atualizada (vencimento, valor e saldo; a não prorrogada leva o
// vencimento original junto), a que sai é excluída de forma lógica e a que volta reaparece na mesma linha. As retenções
// trocadas são excluídas de forma lógica e as novas entram em sequência nova; o rateio segue os percentuais sobre o valor
// novo. Nada é apagado.
import {
  calcularRateio,
  centavos,
  planejarAlteracaoTituloPagar,
  type TituloPagarAlteravel,
} from '@sgh/dominio-financeiro';
import { definirOperacao, recusa, type ResultadoOperacao, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import { aprovacoesPorTitulo, conferirVersao, estabelecimentoDe, recusar } from './operacoes.js';
import { dataIso, numero, texto } from './vocabulario.js';

const id = z.number().int().positive();
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dinheiro = z.number().positive().max(999_999_999);

export const esquemaAlterarTituloPagar = z
  .object({
    /** A parcela (o "id do título" das telas). */
    titulo: id,
    versao: z.string().max(40).nullable().default(null),
    credor: id.optional(),
    documento: z.string().trim().min(1).max(20).optional(),
    serie: z.string().trim().max(3).optional(),
    emissao: DATA.optional(),
    valorDocumento: dinheiro.optional(),
    centroCusto: id.nullable().optional(),
    referente: z.string().trim().max(60).optional(),
    observacao: z.string().trim().max(100).optional(),
    parcelas: z
      .array(
        z.object({ parcela: z.number().int().min(1).max(120), vencimento: DATA, valor: dinheiro }).strict(),
      )
      .min(1)
      .max(120)
      .optional(),
    retencoes: z
      .array(z.object({ tributo: id, valor: dinheiro }).strict())
      .max(12)
      .optional(),
    justificativa: z.string().trim().max(500).optional(),
  })
  .strict();
export type AlterarTituloPagarEntrada = z.infer<typeof esquemaAlterarTituloPagar>;

type Linha = Record<string, unknown>;
const COLUNA_CREDOR = ['empresa_fornecedora_id', 'profissional_id', 'colaborador_id'] as const;

/** O título relido sob trava, com as parcelas (todas as linhas, inclusive as excluídas, pela chave da sequência). */
async function relerTitulo(tx: TxOperacao, est: number, parcela: number) {
  const [p] = await tx.consultarParaAtualizar(
    `SELECT p.versao, p.titulo_pagar_id FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id
      WHERE p.id = ? AND t.estabelecimento_id = ? AND p.excluido_em IS NULL AND t.excluido_em IS NULL`,
    [parcela, est],
    { teto: 1 },
  );
  if (!p) throw recusa('titulo-inexistente', 'O título não existe (talvez já excluído).');
  const titulo = numero(p['titulo_pagar_id']);
  const [t] = await tx.consultarParaAtualizar('SELECT * FROM titulo_pagar WHERE id = ?', [titulo], {
    teto: 1,
  });
  const parcelas = await tx.consultarParaAtualizar(
    'SELECT * FROM parcela_pagar WHERE titulo_pagar_id = ? ORDER BY sequencia',
    [titulo],
  );
  return { versaoParcela: p['versao'], t: t as Linha, parcelas };
}

const alterarTituloPagar = definirOperacao<AlterarTituloPagarEntrada, ResultadoOperacao>({
  nome: 'financeiro.alterar_titulo_pagar',
  tabelas: ['titulo_pagar', 'parcela_pagar', 'retencao_titulo', 'rateio_lancamento', 'pedido_aprovacao'],
  entrada: esquemaAlterarTituloPagar as never,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const usuario = ctx.usuario;
    const { versaoParcela, t, parcelas: todas } = await relerTitulo(tx, est, e.titulo);
    conferirVersao(e.versao, versaoParcela);
    const titulo = numero(t['id']);
    const ativas = todas.filter((p) => p['excluido_em'] === null);
    const ids = ativas.map((p) => numero(p['id']));
    const q = ids.map(() => '?').join(', ');
    const coluna = COLUNA_CREDOR.find((c) => t[c] !== null) ?? 'empresa_fornecedora_id';
    const [bordero, notas, prorrogadas, retencoes] = await Promise.all([
      tx.uma(
        `SELECT COUNT(*) AS n FROM item_bordero i JOIN parcela_pagar p ON p.id = i.parcela_pagar_id
          WHERE p.titulo_pagar_id = ? AND i.excluido_em IS NULL AND i.situacao NOT IN ('rejeitado','retirado')`,
        [titulo],
      ),
      tx.uma(
        "SELECT COUNT(*) AS n FROM nota_credito_debito WHERE titulo_pagar_id = ? AND situacao = 'aplicada' AND excluido_em IS NULL",
        [titulo],
      ),
      tx.consultar(
        `SELECT DISTINCT parcela_pagar_id FROM prorrogacao_parcela WHERE parcela_pagar_id IN (${q})`,
        ids,
      ),
      tx.consultarParaAtualizar(
        `SELECT id, versao, parcela_pagar_id, sequencia, tributo_id, valor_retido FROM retencao_titulo
          WHERE excluido_em IS NULL AND parcela_pagar_id IN (${q}) ORDER BY sequencia`,
        ids,
      ),
    ]);
    const prorrogada = new Set(prorrogadas.map((r) => numero(r['parcela_pagar_id'])));
    const aprovacoes = (await aprovacoesPorTitulo(tx, est, [titulo])).get(titulo) ?? [];
    const atual: TituloPagarAlteravel = {
      situacao: texto(t['situacao']),
      pago: centavos(ativas.reduce((x, p) => x + numero(p['valor_pago']), 0)),
      bordero: numero(bordero?.['n']),
      notasAplicadas: numero(notas?.['n']),
      aprovacoes: aprovacoes.length,
      credor: numero(t[coluna]),
      documento: texto(t['numero_documento'] ?? ''),
      serie: texto(t['serie_documento'] ?? ''),
      emissao: dataIso(t['data_emissao']) ?? '',
      valorDocumento: numero(t['valor_bruto']),
      centroCusto: t['centro_custo_id'] === null ? null : numero(t['centro_custo_id']),
      referente: texto(t['referente'] ?? ''),
      observacao: texto(t['observacao'] ?? ''),
      parcelas: ativas.map((p) => ({
        parcela: numero(p['sequencia']),
        vencimento: dataIso(p['vencimento']) ?? '',
        valor: numero(p['valor']),
        prorrogada: prorrogada.has(numero(p['id'])),
      })),
      retencoes: retencoes.map((r) => ({
        tributo: numero(r['tributo_id']),
        valor: numero(r['valor_retido']),
      })),
    };
    const plano = planejarAlteracaoTituloPagar(atual, e);
    if (!plano.ok) {
      recusar(plano.recusa);
      throw recusa('titulo-invalido', 'Alteração inválida.');
    }
    const d = plano.depois;
    const muda = new Set(plano.campos);

    if (muda.has('credor')) {
      const tabela = {
        empresa_fornecedora_id: 'empresa_fornecedora',
        profissional_id: 'profissional',
        colaborador_id: 'colaborador',
      }[coluna];
      const ativo = coluna === 'colaborador_id' ? 'ativo = TRUE' : "situacao <> 'inativo'";
      const existe =
        tabela === 'empresa_fornecedora'
          ? await tx.uma(
              `SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL AND ${ativo}`,
              [d.credor],
            )
          : tabela === 'profissional'
            ? await tx.uma(`SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL AND ${ativo}`, [
                d.credor,
              ])
            : await tx.uma(`SELECT id FROM colaborador WHERE id = ? AND excluido_em IS NULL AND ${ativo}`, [
                d.credor,
              ]);
      if (!existe)
        throw recusa('credor-inexistente', 'O credor não existe ou está inativo.', { campos: ['credor'] });
    }
    if (muda.has('credor') || muda.has('documento') || muda.has('serie')) {
      const credorCol = coluna;
      const duplicado =
        credorCol === 'empresa_fornecedora_id'
          ? await tx.uma(
              `SELECT id FROM titulo_pagar WHERE estabelecimento_id = ? AND tipo_credor_id = ? AND empresa_fornecedora_id = ?
                  AND numero_documento = ? AND COALESCE(serie_documento, '') = ? AND situacao <> 'cancelado'
                  AND excluido_em IS NULL AND id <> ?`,
              [est, t['tipo_credor_id'], d.credor, d.documento, d.serie, titulo],
            )
          : await tx.uma(
              `SELECT id FROM titulo_pagar WHERE estabelecimento_id = ? AND tipo_credor_id = ?
                  AND COALESCE(profissional_id, colaborador_id) = ? AND numero_documento = ?
                  AND COALESCE(serie_documento, '') = ? AND situacao <> 'cancelado' AND excluido_em IS NULL AND id <> ?`,
              [est, t['tipo_credor_id'], d.credor, d.documento, d.serie, titulo],
            );
      if (duplicado)
        throw recusa('duplicado', 'Já existe título com este credor, documento e série.', {
          campos: ['documento'],
        });
    }
    if (muda.has('centroCusto') && d.centroCusto !== null) {
      const cc = await tx.uma('SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ?', [
        d.centroCusto,
        est,
      ]);
      if (!cc)
        throw recusa('centro-custo-inexistente', 'O centro de custo não existe neste estabelecimento.', {
          campos: ['centroCusto'],
        });
    }
    if (muda.has('retencoes') && d.retencoes.length) {
      const trib = [...new Set(d.retencoes.map((r) => r.tributo))];
      const qt = trib.map(() => '?').join(', ');
      const achados = await tx.consultar(`SELECT id FROM tributo WHERE ativo = TRUE AND id IN (${qt})`, trib);
      if (achados.length !== trib.length)
        throw recusa('retencao-inexistente', 'A conta de retenção não existe no cadastro.', {
          campos: ['retencoes'],
        });
    }

    const agora = new Date();
    // Parcelas: casadas pela sequência (a chave única da parcela no título).
    let primeira = 0;
    if (muda.has('parcelas')) {
      const porSequencia = new Map(todas.map((p) => [numero(p['sequencia']), p]));
      const novas = new Set(d.parcelas.map((p) => p.parcela));
      for (const n of d.parcelas) {
        const linha = porSequencia.get(n.parcela);
        const valores = {
          vencimento: n.vencimento,
          valor: n.valor,
          saldo: n.valor,
          excluido_em: null,
          excluido_por: null,
        };
        if (!linha)
          await tx.incluir('parcela_pagar', {
            titulo_pagar_id: titulo,
            sequencia: n.parcela,
            vencimento: n.vencimento,
            vencimento_original: n.vencimento,
            valor: n.valor,
            saldo: n.valor,
          });
        else
          await tx.alterar('parcela_pagar', numero(linha['id']), numero(linha['versao']), {
            ...valores,
            ...(prorrogada.has(numero(linha['id'])) ? {} : { vencimento_original: n.vencimento }),
          });
      }
      for (const p of ativas)
        if (!novas.has(numero(p['sequencia'])))
          await tx.alterar('parcela_pagar', numero(p['id']), numero(p['versao']), {
            excluido_em: agora,
            excluido_por: usuario,
          });
    }
    const relidas = await tx.consultar(
      'SELECT id, sequencia FROM parcela_pagar WHERE titulo_pagar_id = ? AND excluido_em IS NULL ORDER BY sequencia',
      [titulo],
    );
    primeira = numero(relidas[0]?.['id']);
    // Retenções: as que saem ficam excluídas de forma lógica; as novas, em sequência nova, na primeira parcela.
    if (
      muda.has('retencoes') ||
      (muda.has('parcelas') && retencoes.some((r) => numero(r['parcela_pagar_id']) !== primeira))
    ) {
      for (const r of retencoes)
        await tx.alterar('retencao_titulo', numero(r['id']), numero(r['versao']), {
          excluido_em: agora,
          excluido_por: usuario,
        });
      const [mx] = await tx.consultar(
        'SELECT COALESCE(MAX(sequencia), 0) AS s FROM retencao_titulo WHERE parcela_pagar_id = ?',
        [primeira],
      );
      let seq = numero(mx?.['s']);
      const competencia = `${d.emissao.slice(0, 7)}-01`;
      for (const r of d.retencoes)
        await tx.incluir('retencao_titulo', {
          parcela_pagar_id: primeira,
          sequencia: ++seq,
          tributo_id: r.tributo,
          competencia,
          data_fato_gerador: d.emissao,
          base_calculo: d.valorDocumento,
          aliquota: Math.round((r.valor / d.valorDocumento) * 1_000_000) / 10_000,
          valor_retido: r.valor,
        });
    }
    // Rateio: os mesmos percentuais sobre o valor novo.
    if (muda.has('valorDocumento')) {
      const rateio = await tx.consultarParaAtualizar(
        'SELECT id, versao, centro_custo_id, percentual FROM rateio_lancamento WHERE titulo_pagar_id = ? AND excluido_em IS NULL ORDER BY sequencia',
        [titulo],
      );
      if (rateio.length) {
        const r = calcularRateio(
          rateio.map((x) => ({
            centroCusto: numero(x['centro_custo_id']),
            percentual: numero(x['percentual']),
          })),
          d.valorDocumento,
        );
        if (!r.ok) recusar(r.recusa);
        if (r.ok)
          for (const [i, x] of rateio.entries())
            await tx.alterar('rateio_lancamento', numero(x['id']), numero(x['versao']), {
              valor: r.rateio[i]?.valor ?? 0,
            });
      }
    }
    // Aprovações: a mudança material cancela os pedidos do título; a alçada recomeça.
    let cancelados = 0;
    if (plano.materiais.length) {
      const pedidos = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM pedido_aprovacao WHERE estabelecimento_id = ? AND entidade = 'titulo_pagar'
            AND entidade_id = ? AND excluido_em IS NULL AND situacao IN ('pendente','em_aprovacao','aprovado')`,
        [est, titulo],
      );
      for (const p of pedidos) {
        await tx.alterar('pedido_aprovacao', numero(p['id']), numero(p['versao']), {
          situacao: 'cancelado',
          concluido_em: agora,
          motivo_conclusao:
            `Título alterado (${plano.materiais.join(', ')}): ${(e.justificativa ?? '').trim() || 'sem aprovação anterior'}`.slice(
              0,
              2000,
            ),
        });
        cancelados += 1;
      }
    }
    const retido = centavos(d.retencoes.reduce((x, r) => x + r.valor, 0));
    const lancamento = dataIso(t['data_lancamento']) ?? d.emissao;
    await tx.alterar('titulo_pagar', titulo, numero(t['versao']), {
      [coluna]: d.credor,
      numero_documento: d.documento,
      serie_documento: d.serie || null,
      data_emissao: d.emissao,
      data_lancamento: lancamento < d.emissao ? d.emissao : lancamento,
      valor_bruto: d.valorDocumento,
      valor_retencoes: retido,
      valor_liquido: centavos(
        d.valorDocumento - numero(t['valor_desconto']) + numero(t['valor_acrescimo']) - retido,
      ),
      quantidade_parcelas: d.parcelas.length,
      centro_custo_id: d.centroCusto,
      referente: d.referente || null,
      observacao: d.observacao || null,
      ...(plano.materiais.length
        ? { autorizado: false, autorizado_em: null, autorizador_usuario_id: null, pedido_aprovacao_id: null }
        : {}),
    });
    const antes = {
      ...atual,
      parcelas: atual.parcelas.map((p) => ({ parcela: p.parcela, vencimento: p.vencimento, valor: p.valor })),
    };
    return {
      titulo: primeira,
      tituloPagar: titulo,
      parcelas: d.parcelas.length,
      campos: plano.campos.join(','),
      materiais: plano.materiais.join(','),
      reabreAlcada: plano.materiais.length > 0,
      aprovacoesCanceladas: cancelados,
      antes: JSON.stringify(antes),
      depois: JSON.stringify(d),
    };
  },
  alvo: (_e, r) => ({ tabela: 'titulo_pagar', id: numero(r['tituloPagar']) || null }),
  trilha: (e, r) => ({
    motivo: e.justificativa?.trim() || null,
    dados: {
      campos: r['campos'],
      antes: JSON.parse(String(r['antes'])),
      depois: JSON.parse(String(r['depois'])),
    },
  }),
  eventos: (_e, r) => [
    {
      tipo: 'financeiro.titulo_pagar.alterado',
      carga: { titulo: numero(r['tituloPagar']), parcelas: numero(r['parcelas']) },
    },
  ],
});

export const OPERACOES_ALTERACAO_TITULO_PAGAR = { alterarTituloPagar } as const;
