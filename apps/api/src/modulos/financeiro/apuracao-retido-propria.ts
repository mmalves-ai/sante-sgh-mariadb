// F7, 07-FIN linha 110: leitura da apuração do retido pelo hospital (por competência, com as parcelas por código de
// receita), do DARF da guia gravada pelo recolhimento (contabil-fiscal-propria.ts, financeiro.gerar_recolhimento_retencao)
// e do batimento do retido com a EFD-Reinf da competência. As regras são do @sgh/dominio-financeiro
// (apuracao-retido.ts); aqui só a leitura no banco próprio. A DCTFWeb não sai daqui: a Receita a monta pela Reinf.
import {
  baterComReinf,
  montarDarf,
  parcelasPorReceita,
  type RecusaFinanceiro,
} from '@sgh/dominio-financeiro';
import { type Leitor, recusa } from '@sgh/nucleo';
import { dataIso, numero, texto } from './vocabulario.js';

function recusar(r: RecusaFinanceiro | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
}
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : texto(v));

/** As apurações do retido de terceiros na competência, com a guia, o título e as parcelas por código de receita. */
export async function apuracoesRetido(l: Leitor, est: number, competencia: string) {
  const linhas = await l.consultar(
    `SELECT a.id, a.numero, a.situacao, a.data_vencimento, a.valor_total, a.valor_base_total, tr.codigo AS sigla,
            COALESCE(c.codigo_receita, g.codigo_receita) AS receita, g.id AS guia, g.numero AS guia_numero,
            g.situacao AS guia_situacao, t.numero AS titulo
       FROM apuracao_retencao a JOIN tributo tr ON tr.id = a.tributo_id
       LEFT JOIN guia_recolhimento g ON g.id = a.guia_recolhimento_id
       LEFT JOIN codigo_receita_federal c ON c.id = COALESCE(a.codigo_receita_federal_id, g.codigo_receita_federal_id)
       LEFT JOIN titulo_pagar t ON t.id = a.titulo_pagar_id
      WHERE a.estabelecimento_id = ? AND a.sentido = 'retido_de_terceiros' AND a.competencia_inicio = ?
        AND a.excluido_em IS NULL
      ORDER BY tr.codigo, a.id`,
    [est, `${competencia}-01`],
  );
  if (linhas.length === 0) return [];
  const ids = linhas.map((r) => numero(r['id']));
  const itens = await l.consultar(
    `SELECT i.apuracao_retencao_id AS apuracao, c.codigo_receita AS receita, i.valor_base, i.valor_retido
       FROM apuracao_retencao_item i JOIN retencao_titulo r ON r.id = i.retencao_titulo_id
       LEFT JOIN codigo_receita_federal c ON c.id = r.codigo_receita_federal_id
      WHERE i.apuracao_retencao_id IN (${ids.map(() => '?').join(', ')}) AND i.excluido_em IS NULL
      ORDER BY i.id`,
    ids,
  );
  return linhas.map((r) => {
    const id = numero(r['id']);
    const receita = textoOuNulo(r['receita']) ?? '';
    const p = parcelasPorReceita(
      itens
        .filter((i) => numero(i['apuracao']) === id)
        .map((i) => ({
          codigoReceita: textoOuNulo(i['receita']),
          base: numero(i['valor_base']),
          valor: numero(i['valor_retido']),
        })),
      receita,
    );
    return {
      id,
      numero: texto(r['numero']),
      sigla: texto(r['sigla']),
      codigoReceita: receita || null,
      situacao: texto(r['situacao']),
      vencimento: dataIso(r['data_vencimento']),
      base: numero(r['valor_base_total']),
      total: numero(r['valor_total']),
      parcelas: p.parcelas,
      somaParcelas: p.total,
      guia: r['guia'] == null ? null : numero(r['guia']),
      guiaNumero: r['guia_numero'] == null ? null : numero(r['guia_numero']),
      guiaSituacao: textoOuNulo(r['guia_situacao']),
      titulo: textoOuNulo(r['titulo']),
    };
  });
}

/** O DARF da guia de recolhimento do estabelecimento, com os campos numerados do modelo (01 a 10). */
export async function darfDaGuia(l: Leitor, est: number, guia: number) {
  const g = await l.uma<Record<string, unknown>>(
    `SELECT g.numero, g.tipo_guia, g.competencia, g.periodo_apuracao, g.data_vencimento, g.valor_principal,
            g.valor_multa, g.valor_juros, g.numero_referencia, g.situacao, COALESCE(c.codigo_receita, g.codigo_receita) AS receita,
            e.razao_social, e.cnpj
       FROM guia_recolhimento g JOIN estabelecimento e ON e.id = g.estabelecimento_id
       LEFT JOIN codigo_receita_federal c ON c.id = g.codigo_receita_federal_id
      WHERE g.id = ? AND g.estabelecimento_id = ? AND g.excluido_em IS NULL`,
    [guia, est],
  );
  if (!g) throw recusa('guia-inexistente', 'Guia de recolhimento não encontrada.', { campos: ['guia'] });
  if (!['darf', 'darf_numerado'].includes(texto(g['tipo_guia'])))
    throw recusa('guia-nao-darf', 'Esta guia não é um DARF.', { campos: ['guia'] });
  const competencia = (dataIso(g['competencia']) ?? '').slice(0, 7);
  const { darf, recusa: r } = montarDarf({
    razaoSocial: texto(g['razao_social']),
    cnpj: textoOuNulo(g['cnpj']),
    competencia,
    periodoApuracao: dataIso(g['periodo_apuracao']),
    codigoReceita: textoOuNulo(g['receita']),
    referencia: textoOuNulo(g['numero_referencia']),
    vencimento: dataIso(g['data_vencimento']) ?? '',
    principal: numero(g['valor_principal']),
    multa: numero(g['valor_multa']),
    juros: numero(g['valor_juros']),
  });
  recusar(r);
  return {
    guia,
    numero: numero(g['numero']),
    competencia,
    situacao: texto(g['situacao']),
    campos: darf?.campos ?? [],
    total: darf?.total ?? 0,
  };
}

/**
 * O batimento da competência: o retido pelo hospital (títulos a pagar vivos, retenção não dispensada) por tributo
 * contra os totais dos eventos vigentes da Reinf (sem os rejeitados, os cancelados, as exclusões e os já retificados).
 */
export async function batimentoReinf(l: Leitor, est: number, competencia: string) {
  const inicio = `${competencia}-01`;
  const apurado = await l.consultar(
    `SELECT tr.codigo AS sigla, SUM(r.valor_retido) AS valor
       FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id
       JOIN titulo_pagar t ON t.id = p.titulo_pagar_id JOIN tributo tr ON tr.id = r.tributo_id
      WHERE t.estabelecimento_id = ? AND r.competencia = ? AND r.excluido_em IS NULL AND t.excluido_em IS NULL
        AND t.situacao <> 'cancelado' AND p.excluido_em IS NULL AND r.retencao_dispensada = FALSE
      GROUP BY tr.codigo ORDER BY tr.codigo`,
    [est, inicio],
  );
  const [reinf] = await l.consultar(
    `SELECT COALESCE(SUM(i.valor_irrf), 0) AS irrf, COALESCE(SUM(i.valor_csrf), 0) AS csrf,
            COALESCE(SUM(i.valor_inss), 0) AS inss, COUNT(DISTINCT e.id) AS eventos
       FROM evento_reinf e JOIN evento_reinf_item i ON i.evento_reinf_id = e.id AND i.excluido_em IS NULL
      WHERE e.estabelecimento_id = ? AND e.competencia = ? AND e.excluido_em IS NULL
        AND e.situacao NOT IN ('rejeitado', 'cancelado') AND e.acao <> 'exclusao'
        AND NOT EXISTS (SELECT 1 FROM evento_reinf x WHERE x.retificado_evento_reinf_id = e.id
                         AND x.excluido_em IS NULL AND x.situacao NOT IN ('rejeitado', 'cancelado'))`,
    [est, inicio],
  );
  const porTributo = apurado.map((r) => ({ sigla: texto(r['sigla']), valor: numero(r['valor']) }));
  return {
    competencia,
    porTributo,
    eventosReinf: numero(reinf?.['eventos']),
    ...baterComReinf(porTributo, {
      irrf: numero(reinf?.['irrf']),
      csrf: numero(reinf?.['csrf']),
      inss: numero(reinf?.['inss']),
    }),
  };
}
