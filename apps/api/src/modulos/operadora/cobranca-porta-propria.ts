// Porta PRÓPRIA da cobrança da operadora (F2.2, lote 02-09) sobre o MariaDB do cliente, pelo @sgh/nucleo:
//   - cobrança = fatura_plano (com os lançamentos em fatura_plano_item), do contrato (contrato_plano) do
//     estabelecimento da sessão; o pagador é a contratante (pessoa física ou jurídica);
//   - reajuste = reajuste_contrato_plano (anual, aplicado ou cancelado);
//   - gravação pelo Executor (apoio-porta-propria): incluir, baixar, cancelar, estornar, registrar e cancelar
//     reajuste, com a trava otimista pela coluna `versao`.
// O número da fatura vem da numeração de negócio `fatura_plano` do estabelecimento; a forma de cobrança, do contrato
// (contrato_forma_cobranca vigente); o tipo de lançamento, do cadastro tipo_lancamento_fatura pelo código do tipo.
// Dado da rede inteira: nenhum (fatura, contrato e reajuste filtram pelo estabelecimento da sessão).
// Melhoria: a cobrança cancelada guarda quem e quando (cancelada_em, cancelada_por_usuario_id; CHECK no banco); a baixa
// exige a data do pagamento junto do valor (CHECK no banco); o número da fatura é único no estabelecimento (UNIQUE).
// Melhoria: o reajuste aplicado guarda quem aplicou e quando; um reajuste por contrato, data-base e tipo (UNIQUE).
// Base das mensalidades: contratos vigentes na competência, preço por faixa (tabela exclusiva do contrato, senão a do
// produto), beneficiários ativos no mês, reajustes aplicados e a mensalidade já gerada.
// Pendente (pedido ao orquestrador): acordos e renegociação (acordo_inadimplencia) e notificação de inadimplência
// (ocorrencia_inadimplencia) respondem 501 `modelo-pendente`;
// multa e juros da baixa ficam somados em valor_acrescimo até o modelo separar as duas colunas.
import { type Leitor, type Linha, recusa, type TxOperacao } from '@sgh/nucleo';
import {
  BasePortaOperadoraPropria,
  competenciaDe,
  data,
  exigirOperadora,
  inexistente,
  instante,
  type NucleoOperadora,
  num,
  numOuNulo,
  pendente,
  primeiroDia,
  txt,
  txtOuNulo,
  versaoDe,
} from './apoio-porta-propria.js';
import type {
  ContextoCobranca,
  FiltroBaseMensalidades,
  GravadorCobranca,
  PortaCobrancaOperadora,
} from './cobranca-porta.js';
import {
  type DadosBaseMensalidade,
  type DadosBeneficiarioBase,
  type DadosCobranca,
  type DadosContratoCobranca,
  type DadosItemCobranca,
  type DadosReajuste,
  type EntradaCobranca,
  type EntradaReajuste,
  type FiltroCobrancasPorta,
  LIMITE_PAGINA_COBRANCA,
  type TotaisCobranca,
  LIMITE_CONTRATOS_GERACAO,
} from './dados-portas.js';

export const TABELAS_COBRANCA = ['fatura_plano', 'fatura_plano_item', 'reajuste_contrato_plano'] as const;

/** Tipo da cobrança na tela ↔ tipo da fatura no banco. */
export const TIPO_FATURA: Readonly<Record<number, string>> = {
  1: 'mensalidade',
  2: 'coparticipacao',
  3: 'avulsa',
  4: 'repactuacao',
};
const TIPO_DA_FATURA: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(TIPO_FATURA).map(([k, v]) => [v, Number(k)]),
);
const SITUACAO_DA_FATURA: Readonly<Record<string, DadosCobranca['situacao']>> = {
  aberta: 'aberta',
  emitida: 'aberta',
  paga: 'paga',
  paga_parcial: 'paga',
  cancelada: 'cancelada',
  renegociada: 'renegociada',
};
const SITUACOES_DA_TELA: Readonly<Record<string, readonly string[]>> = {
  aberta: ['aberta', 'emitida'],
  paga: ['paga', 'paga_parcial'],
  cancelada: ['cancelada'],
  renegociada: ['renegociada'],
};
/** Tipo de contratação do produto ↔ código da tela (1 individual, 2 coletivo empresarial, 3 coletivo por adesão). */
export const CONTRATACAO: Readonly<Record<string, number>> = {
  individual_familiar: 1,
  coletivo_empresarial: 2,
  coletivo_adesao: 3,
};

const SELECT_FATURA = `
  SELECT f.id, f.versao, f.numero, f.tipo_fatura, f.competencia, f.data_vencimento, f.data_emissao, f.valor_total,
         f.valor_pago, f.data_pagamento, f.valor_acrescimo, f.situacao, f.parcela, f.observacao,
         f.cancelada_em, f.criado_em, f.alterado_em, f.responsavel_beneficiario_plano_id,
         k.id AS contrato_id, k.numero AS contrato_numero, k.operadora_saude_id,
         p.tipo_contratacao,
         COALESCE(pfc.nome, pjc.razao_social) AS pagador_nome, COALESCE(pfc.cpf, pjc.cnpj) AS pagador_documento,
         (SELECT i.descricao FROM fatura_plano_item i WHERE i.fatura_plano_id = f.id ORDER BY i.sequencia LIMIT 1)
           AS descricao,
         uc.login AS criado_login, ua.login AS alterado_login
    FROM fatura_plano f
    JOIN contrato_plano k ON k.id = f.contrato_plano_id
    JOIN contratante_plano ct ON ct.id = k.contratante_plano_id
    LEFT JOIN pessoa_fisica pfc ON pfc.id = ct.pessoa_fisica_id
    LEFT JOIN pessoa_juridica pjc ON pjc.id = ct.pessoa_juridica_id
    LEFT JOIN produto_plano p ON p.id = k.produto_plano_id
    LEFT JOIN usuario uc ON uc.id = f.criado_por
    LEFT JOIN usuario ua ON ua.id = f.alterado_por`;

function cobrancaDe(f: Linha): DadosCobranca {
  const contratacao = CONTRATACAO[txt(f['tipo_contratacao'])] ?? 1;
  const situacao = SITUACAO_DA_FATURA[txt(f['situacao'])] ?? 'aberta';
  const paga = situacao === 'paga';
  return {
    id: num(f['id']),
    operadora: num(f['operadora_saude_id']),
    contrato: num(f['contrato_id']),
    contratoNumero: txt(f['contrato_numero']),
    tipoContrato: contratacao === 1 ? 1 : 2,
    tipoContratacao: contratacao,
    beneficiario: numOuNulo(f['responsavel_beneficiario_plano_id']),
    pagadorNome: txt(f['pagador_nome']),
    pagadorDocumento: txt(f['pagador_documento']),
    tipo: TIPO_DA_FATURA[txt(f['tipo_fatura'])] ?? 3,
    competencia: competenciaDe(f['competencia']),
    descricao: txt(f['descricao']),
    valor: num(f['valor_total']),
    vencimento: data(f['data_vencimento']) ?? '',
    situacao,
    situacaoEm:
      instante(f['cancelada_em']) ??
      (paga ? `${data(f['data_pagamento'])}T00:00:00` : null) ??
      instante(f['alterado_em'] ?? f['criado_em']) ??
      '',
    pagoEm: data(f['data_pagamento']),
    valorPago: numOuNulo(f['valor_pago']),
    multa: paga ? num(f['valor_acrescimo']) : null,
    juros: paga ? 0 : null,
    dispensaMotivo: null,
    motivo: situacao === 'cancelada' || (!paga && f['observacao'] !== null) ? txtOuNulo(f['observacao']) : null,
    acordoOrigem: null,
    parcela: numOuNulo(f['parcela']),
    parcelas: null,
    acordoDestino: null,
    notificadoEm: null,
    notificacaoMeio: null,
    notificacaoReferencia: null,
    versao: num(f['versao']),
    emitidaEm: data(f['data_emissao']) ?? '',
    criadoEm: instante(f['criado_em']) ?? '',
    criadoPor: txt(f['criado_login']),
    alteradoEm: instante(f['alterado_em'] ?? f['criado_em']) ?? '',
    alteradoPor: txt(f['alterado_login'] ?? f['criado_login']),
  };
}

function reajusteDe(r: Linha): DadosReajuste {
  return {
    id: num(r['id']),
    operadora: num(r['operadora_saude_id']),
    contrato: num(r['contrato_plano_id']),
    contratoNumero: txt(r['contrato_numero']),
    tipoContratacao: CONTRATACAO[txt(r['tipo_contratacao'])] ?? 1,
    competencia: competenciaDe(r['data_base']),
    percentual: num(r['percentual']),
    tetoAns: null,
    oficioAns: null,
    vidas: num(r['quantidade_vidas']),
    motivo: txt(r['observacao']),
    situacao: txt(r['situacao']) === 'cancelado' ? 'cancelado' : 'vigente',
    canceladoMotivo: txt(r['situacao']) === 'cancelado' ? txtOuNulo(r['motivo_cancelamento']) : null,
    registradoEm: instante(r['aplicado_em'] ?? r['criado_em']) ?? '',
    registradoPor: txt(r['login']),
    versao: num(r['versao']),
  };
}

/** Acrescenta a nota à observação existente (o histórico não se perde; a mudança também fica na trilha). */
function anexarNota(atual: unknown, nota: string | null): string | null {
  const antes = txtOuNulo(atual);
  if (!nota) return antes;
  return [antes, nota].filter(Boolean).join('\n').slice(0, 60_000);
}

const SELECT_REAJUSTE = `
  SELECT r.id, r.contrato_plano_id, r.data_base, r.percentual, r.quantidade_vidas, r.observacao, r.situacao,
         r.aplicado_em, r.criado_em, r.versao, r.motivo_cancelamento,
         k.numero AS contrato_numero, k.operadora_saude_id, p.tipo_contratacao, u.login
    FROM reajuste_contrato_plano r
    JOIN contrato_plano k ON k.id = r.contrato_plano_id
    LEFT JOIN produto_plano p ON p.id = k.produto_plano_id
    LEFT JOIN usuario u ON u.id = COALESCE(r.aplicado_por_usuario_id, r.criado_por)`;

const SELECT_CONTRATO = `
  SELECT k.id, k.operadora_saude_id, k.numero, k.situacao, k.inicio_vigencia, k.fim_vigencia,
         k.dia_vencimento, k.mes_reajuste, p.id AS produto_id, p.nome AS produto_nome, p.tipo_contratacao,
         COALESCE(pfc.nome, pjc.razao_social) AS contratante_nome,
         COALESCE(pfc.cpf, pjc.cnpj) AS contratante_documento, ct.natureza
    FROM contrato_plano k
    JOIN contratante_plano ct ON ct.id = k.contratante_plano_id
    LEFT JOIN pessoa_fisica pfc ON pfc.id = ct.pessoa_fisica_id
    LEFT JOIN pessoa_juridica pjc ON pjc.id = ct.pessoa_juridica_id
    LEFT JOIN produto_plano p ON p.id = k.produto_plano_id`;

function contratoDe(k: Linha): DadosContratoCobranca {
  const contratacao = CONTRATACAO[txt(k['tipo_contratacao'])] ?? 1;
  return {
    id: num(k['id']),
    operadora: num(k['operadora_saude_id']),
    numero: txt(k['numero']),
    tipo: contratacao === 1 ? 1 : 2,
    tipoContratacao: contratacao,
    situacao: txt(k['situacao']),
    inicio: data(k['inicio_vigencia']) ?? '',
    fim: data(k['fim_vigencia']),
    diaVencimento: numOuNulo(k['dia_vencimento']),
    mesReajuste: num(k['mes_reajuste']),
    contratanteNome: txt(k['contratante_nome']),
    contratanteDocumento: txt(k['contratante_documento']),
    produto: num(k['produto_id']),
    produtoNome: txt(k['produto_nome']),
    natureza: 'plano',
    coparticipacao: { tipo: 0, valor: null },
    precos: null,
  };
}

/**
 * O preço por faixa etária do contrato (na ordem das faixas): a tabela exclusiva vigente do contrato, senão a tabela
 * vigente do produto (a mesma que a porta do produto grava). Sem tabela: null (a geração recusa o contrato sem preço).
 */
async function precosDoContrato(l: Leitor, contrato: number, produto: number | null): Promise<number[] | null> {
  if (produto === null) return null;
  const linhas = await l.consultar(
    `SELECT t.exclusiva_contrato_plano_id AS exclusiva, f.sequencia, f.valor_mensalidade
       FROM tabela_preco_plano_faixa f
       JOIN tabela_preco_plano t ON t.id = f.tabela_preco_plano_id
      WHERE f.produto_plano_id = ? AND t.situacao = 'vigente' AND t.excluido_em IS NULL AND f.excluido_em IS NULL
        AND (t.exclusiva_contrato_plano_id IS NULL OR t.exclusiva_contrato_plano_id = ?)
      ORDER BY f.sequencia`,
    [produto, contrato],
  );
  const exclusiva = linhas.filter((x) => numOuNulo(x['exclusiva']) === contrato);
  const usadas = exclusiva.length > 0 ? exclusiva : linhas.filter((x) => numOuNulo(x['exclusiva']) === null);
  return usadas.length > 0 ? usadas.map((x) => num(x['valor_mensalidade'])) : null;
}

export class PortaCobrancaOperadoraPropria
  extends BasePortaOperadoraPropria<GravadorCobranca>
  implements PortaCobrancaOperadora
{
  constructor(nucleo: NucleoOperadora, cliente: string) {
    super(nucleo, cliente, 'operadora.cobranca', TABELAS_COBRANCA);
  }

  // ---- leituras ----

  /**
   * A base das mensalidades da competência: os contratos da operadora vigentes no mês (página por id), cada um com o
   * preço por faixa (a tabela exclusiva do contrato, senão a vigente do produto), os beneficiários ativos no mês, os
   * reajustes aplicados até a competência e se a mensalidade da competência já foi gerada.
   */
  baseMensalidades(c: ContextoCobranca, f: FiltroBaseMensalidades): Promise<{ itens: DadosBaseMensalidade[]; proxima: number | null }> {
    return this.ler(c, async (l) => {
      const cond = [
        'k.estabelecimento_id = ?',
        'k.operadora_saude_id = ?',
        'k.excluido_em IS NULL',
        "k.situacao <> 'encerrado'",
        'k.inicio_vigencia <= ?',
        '(k.fim_vigencia IS NULL OR k.fim_vigencia >= ?)',
        'k.id > ?',
      ];
      const p: unknown[] = [c.estabelecimento ?? 0, f.operadora, f.ultimoDia, f.primeiroDia, f.apos ?? 0];
      if (f.contrato) {
        cond.push('k.id = ?');
        p.push(f.contrato);
      }
      const linhas = await l.consultar(
        `${SELECT_CONTRATO} WHERE ${cond.join(' AND ')} ORDER BY k.id LIMIT ${LIMITE_CONTRATOS_GERACAO + 1}`,
        p,
      );
      const pagina = linhas.slice(0, LIMITE_CONTRATOS_GERACAO);
      const itens: DadosBaseMensalidade[] = [];
      for (const k of pagina) {
        const id = num(k['id']);
        const bens = await l.consultar(
          `SELECT b.id, b.titular_beneficiario_plano_id, b.data_adesao, b.situacao, b.data_exclusao,
                  pf.nome, pf.data_nascimento
             FROM beneficiario_plano b JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
            WHERE b.contrato_plano_id = ? AND b.excluido_em IS NULL
              AND b.data_adesao <= ? AND (b.data_exclusao IS NULL OR b.data_exclusao > ?)
            ORDER BY b.titular_beneficiario_plano_id IS NOT NULL, b.id`,
          [id, f.ultimoDia, f.primeiroDia],
        );
        const reajustes = await l.consultar(
          `SELECT data_base, percentual FROM reajuste_contrato_plano
            WHERE contrato_plano_id = ? AND situacao = 'aplicado' AND excluido_em IS NULL AND data_base <= ?
            ORDER BY data_base, id`,
          [id, f.ultimoDia],
        );
        const gerada = await l.uma(
          `SELECT 1 AS ok FROM fatura_plano
            WHERE contrato_plano_id = ? AND tipo_fatura = 'mensalidade' AND competencia = ?
              AND situacao <> 'cancelada' AND excluido_em IS NULL LIMIT 1`,
          [id, primeiroDia(f.competencia)],
        );
        itens.push({
          ...contratoDe(k),
          precos: await precosDoContrato(l, id, numOuNulo(k['produto_id'])),
          beneficiarios: bens.map((b) => ({
            id: num(b['id']),
            titular: numOuNulo(b['titular_beneficiario_plano_id']),
            nome: txt(b['nome']),
            nascimento: data(b['data_nascimento']) ?? '',
            inclusao: data(b['data_adesao']) ?? '',
            situacao: txt(b['situacao']),
            exclusao: data(b['data_exclusao']),
          })),
          reajustes: reajustes.map((r) => ({ competencia: competenciaDe(r['data_base']), percentual: num(r['percentual']) })),
          jaGerada: Boolean(gerada),
        });
      }
      return { itens, proxima: linhas.length > LIMITE_CONTRATOS_GERACAO ? num(pagina[pagina.length - 1]?.['id']) : null };
    });
  }

  contrato(c: ContextoCobranca, id: number): Promise<DadosContratoCobranca | null> {
    return this.ler(c, async (l) => {
      const k = await l.uma(`${SELECT_CONTRATO} WHERE k.id = ? AND k.estabelecimento_id = ? AND k.excluido_em IS NULL`, [
        id,
        c.estabelecimento ?? 0,
      ]);
      return k ? { ...contratoDe(k), precos: await precosDoContrato(l, num(k['id']), numOuNulo(k['produto_id'])) } : null;
    });
  }

  beneficiario(c: ContextoCobranca, id: number): Promise<(DadosBeneficiarioBase & { contrato: number }) | null> {
    return this.ler(c, async (l) => {
      const b = await l.uma(
        `SELECT b.id, b.titular_beneficiario_plano_id, b.contrato_plano_id, b.data_adesao, b.situacao, b.data_exclusao,
                pf.nome, pf.data_nascimento
           FROM beneficiario_plano b
           JOIN contrato_plano k ON k.id = b.contrato_plano_id
           JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
          WHERE b.id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL`,
        [id, c.estabelecimento ?? 0],
      );
      if (!b) return null;
      return {
        id: num(b['id']),
        titular: numOuNulo(b['titular_beneficiario_plano_id']),
        nome: txt(b['nome']),
        nascimento: data(b['data_nascimento']) ?? '',
        inclusao: data(b['data_adesao']) ?? '',
        situacao: txt(b['situacao']),
        exclusao: data(b['data_exclusao']),
        contrato: num(b['contrato_plano_id']),
      };
    });
  }

  titular(c: ContextoCobranca, contrato: number): Promise<{ id: number; nome: string; cpf: string | null } | null> {
    return this.ler(c, async (l) => {
      const t = await l.uma(
        `SELECT b.id, pf.nome, pf.cpf
           FROM beneficiario_plano b
           JOIN contrato_plano k ON k.id = b.contrato_plano_id
           JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
          WHERE b.contrato_plano_id = ? AND k.estabelecimento_id = ? AND b.tipo = 'titular'
            AND b.situacao <> 'excluido' AND b.excluido_em IS NULL
          ORDER BY b.id LIMIT 1`,
        [contrato, c.estabelecimento ?? 0],
      );
      return t ? { id: num(t['id']), nome: txt(t['nome']), cpf: txtOuNulo(t['cpf']) } : null;
    });
  }

  cobrancas(c: ContextoCobranca, f: FiltroCobrancasPorta): Promise<{ itens: DadosCobranca[]; proxima: number | null }> {
    const cond = ['f.estabelecimento_id = ?', 'k.operadora_saude_id = ?', 'f.excluido_em IS NULL', 'f.id > ?'];
    const p: unknown[] = [c.estabelecimento ?? 0, f.operadora, f.apos ?? 0];
    if (f.competencia) {
      cond.push('f.competencia = ?');
      p.push(primeiroDia(f.competencia));
    }
    if (f.situacao && SITUACOES_DA_TELA[f.situacao]) {
      const s = SITUACOES_DA_TELA[f.situacao]!;
      cond.push(`f.situacao IN (${s.map(() => '?').join(', ')})`);
      p.push(...s);
    }
    if (f.tipo !== undefined && TIPO_FATURA[f.tipo]) {
      cond.push('f.tipo_fatura = ?');
      p.push(TIPO_FATURA[f.tipo]);
    }
    if (f.contrato !== undefined) {
      cond.push('f.contrato_plano_id = ?');
      p.push(f.contrato);
    }
    if (f.vencidasAntesDe) {
      cond.push("f.situacao IN ('aberta','emitida') AND f.data_vencimento < ?");
      p.push(f.vencidasAntesDe);
    }
    if (f.numero) {
      cond.push('f.numero = ?');
      p.push(f.numero);
    }
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `${SELECT_FATURA} WHERE ${cond.join(' AND ')} ORDER BY f.id LIMIT ${LIMITE_PAGINA_COBRANCA + 1}`,
        p,
      );
      const itens = linhas.slice(0, LIMITE_PAGINA_COBRANCA).map(cobrancaDe);
      return { itens, proxima: linhas.length > LIMITE_PAGINA_COBRANCA ? (itens.at(-1)?.id ?? null) : null };
    });
  }

  cobranca(c: ContextoCobranca, id: number): Promise<DadosCobranca | null> {
    return this.ler(c, async (l) => {
      const f = await l.uma(`${SELECT_FATURA} WHERE f.id = ? AND f.estabelecimento_id = ? AND f.excluido_em IS NULL`, [
        id,
        c.estabelecimento ?? 0,
      ]);
      return f ? cobrancaDe(f) : null;
    });
  }

  itens(c: ContextoCobranca, cobranca: number): Promise<DadosItemCobranca[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT i.beneficiario_plano_id, i.descricao, i.valor_unitario, i.valor, pf.nome
           FROM fatura_plano_item i
           JOIN fatura_plano f ON f.id = i.fatura_plano_id
           LEFT JOIN beneficiario_plano b ON b.id = i.beneficiario_plano_id
           LEFT JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
          WHERE i.fatura_plano_id = ? AND f.estabelecimento_id = ? AND i.excluido_em IS NULL
          ORDER BY i.sequencia`,
        [cobranca, c.estabelecimento ?? 0],
      );
      return linhas.map((i) => ({
        beneficiario: numOuNulo(i['beneficiario_plano_id']),
        beneficiarioNome: txtOuNulo(i['nome']),
        descricao: txt(i['descricao']),
        idade: null,
        faixa: null,
        valorBase: numOuNulo(i['valor_unitario']),
        valor: num(i['valor']),
      }));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
  async renegociadas(_c: ContextoCobranca, _acordo: number): Promise<DadosCobranca[]> {
    return pendente('Acordos de regularização');
  }

  doContrato(c: ContextoCobranca, contratos: readonly number[], desde: string): Promise<DadosCobranca[]> {
    if (contratos.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `${SELECT_FATURA}
            WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL
              AND f.contrato_plano_id IN (${contratos.map(() => '?').join(', ')})
              AND (f.data_vencimento >= ? OR f.situacao IN ('aberta','emitida'))
            ORDER BY f.data_vencimento, f.id`,
          [c.estabelecimento ?? 0, ...contratos, desde],
        )
      ).map(cobrancaDe),
    );
  }

  totais(c: ContextoCobranca, operadora: number, hoje: string): Promise<TotaisCobranca> {
    return this.ler(c, async (l) => {
      const t = await l.uma(
        `SELECT
           SUM(f.situacao IN ('aberta','emitida')) AS abertas,
           COALESCE(SUM(CASE WHEN f.situacao IN ('aberta','emitida') THEN f.valor_total END), 0) AS valor_aberto,
           SUM(f.situacao IN ('aberta','emitida') AND f.data_vencimento < ?) AS vencidas,
           COALESCE(SUM(CASE WHEN f.situacao IN ('aberta','emitida') AND f.data_vencimento < ? THEN f.valor_total END), 0)
             AS valor_vencido,
           SUM(f.situacao IN ('paga','paga_parcial') AND DATE_FORMAT(f.data_pagamento, '%Y-%m') = ?) AS pagas_mes,
           COALESCE(SUM(CASE WHEN f.situacao IN ('paga','paga_parcial') AND DATE_FORMAT(f.data_pagamento, '%Y-%m') = ?
                             THEN f.valor_pago END), 0) AS valor_pago_mes
           FROM fatura_plano f JOIN contrato_plano k ON k.id = f.contrato_plano_id
          WHERE f.estabelecimento_id = ? AND k.operadora_saude_id = ? AND f.excluido_em IS NULL`,
        [hoje, hoje, hoje.slice(0, 7), hoje.slice(0, 7), c.estabelecimento ?? 0, operadora],
      );
      return {
        abertas: num(t?.['abertas']),
        valorAberto: num(t?.['valor_aberto']),
        vencidas: num(t?.['vencidas']),
        valorVencido: num(t?.['valor_vencido']),
        pagasNoMes: num(t?.['pagas_mes']),
        valorPagoNoMes: num(t?.['valor_pago_mes']),
      };
    });
  }

  inadimplentes(
    c: ContextoCobranca,
    f: { operadora: number; hoje: string; apos?: number },
  ): Promise<{
    itens: { contrato: number; vencidas: number; valorVencido: number; maisAntigo: string }[];
    proxima: number | null;
  }> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT f.contrato_plano_id AS contrato, COUNT(*) AS vencidas, SUM(f.valor_total) AS valor,
                MIN(f.data_vencimento) AS mais_antigo
           FROM fatura_plano f JOIN contrato_plano k ON k.id = f.contrato_plano_id
          WHERE f.estabelecimento_id = ? AND k.operadora_saude_id = ? AND f.excluido_em IS NULL
            AND f.situacao IN ('aberta','emitida') AND f.data_vencimento < ? AND f.contrato_plano_id > ?
          GROUP BY f.contrato_plano_id ORDER BY f.contrato_plano_id LIMIT ${LIMITE_PAGINA_COBRANCA + 1}`,
        [c.estabelecimento ?? 0, f.operadora, f.hoje, f.apos ?? 0],
      );
      const itens = linhas.slice(0, LIMITE_PAGINA_COBRANCA).map((x) => ({
        contrato: num(x['contrato']),
        vencidas: num(x['vencidas']),
        valorVencido: num(x['valor']),
        maisAntigo: data(x['mais_antigo']) ?? '',
      }));
      return { itens, proxima: linhas.length > LIMITE_PAGINA_COBRANCA ? (itens.at(-1)?.contrato ?? null) : null };
    });
  }

  reajustes(
    c: ContextoCobranca,
    f: { operadora: number; contrato?: number; apos?: number },
  ): Promise<{ itens: DadosReajuste[]; proxima: number | null }> {
    const cond = ['r.estabelecimento_id = ?', 'k.operadora_saude_id = ?', 'r.excluido_em IS NULL', 'r.id > ?'];
    const p: unknown[] = [c.estabelecimento ?? 0, f.operadora, f.apos ?? 0];
    if (f.contrato !== undefined) {
      cond.push('r.contrato_plano_id = ?');
      p.push(f.contrato);
    }
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `${SELECT_REAJUSTE} WHERE ${cond.join(' AND ')} ORDER BY r.id LIMIT ${LIMITE_PAGINA_COBRANCA + 1}`,
        p,
      );
      const itens = linhas.slice(0, LIMITE_PAGINA_COBRANCA).map(reajusteDe);
      return { itens, proxima: linhas.length > LIMITE_PAGINA_COBRANCA ? (itens.at(-1)?.id ?? null) : null };
    });
  }

  reajuste(c: ContextoCobranca, id: number): Promise<DadosReajuste | null> {
    return this.ler(c, async (l) => {
      const r = await l.uma(`${SELECT_REAJUSTE} WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`, [
        id,
        c.estabelecimento ?? 0,
      ]);
      return r ? reajusteDe(r) : null;
    });
  }

  situacaoReajuste(
    c: ContextoCobranca,
    contrato: number,
  ): Promise<{ vigentes: string[]; ultimaMensalidade: string | null; vidas: number }> {
    return this.ler(c, async (l) => {
      const est = c.estabelecimento ?? 0;
      const vig = await l.consultar(
        `SELECT data_base FROM reajuste_contrato_plano
          WHERE contrato_plano_id = ? AND estabelecimento_id = ? AND situacao = 'aplicado' AND excluido_em IS NULL
          ORDER BY data_base`,
        [contrato, est],
      );
      const ult = await l.uma(
        `SELECT MAX(competencia) AS c FROM fatura_plano
          WHERE contrato_plano_id = ? AND estabelecimento_id = ? AND tipo_fatura = 'mensalidade'
            AND situacao <> 'cancelada' AND excluido_em IS NULL`,
        [contrato, est],
      );
      const vidas = await l.uma(
        `SELECT COUNT(*) AS n FROM beneficiario_plano b JOIN contrato_plano k ON k.id = b.contrato_plano_id
          WHERE b.contrato_plano_id = ? AND k.estabelecimento_id = ? AND b.situacao <> 'excluido'
            AND b.excluido_em IS NULL`,
        [contrato, est],
      );
      return {
        vigentes: vig.map((r) => competenciaDe(r['data_base'])),
        ultimaMensalidade: ult?.['c'] ? competenciaDe(ult['c']) : null,
        vidas: num(vidas?.['n']),
      };
    });
  }

  // ---- gravação ----

  protected gravador(tx: TxOperacao): GravadorCobranca {
    const est = tx.contexto.estabelecimento ?? 0;
    const fatura = async (id: number) => {
      const f = await versaoDe(tx, 'fatura_plano', id, 'A cobrança');
      if (num(f['estabelecimento_id']) !== est) throw inexistente('A cobrança');
      return f;
    };
    return {
      incluir: (e) => incluirFatura(tx, est, e),
      async baixar(b) {
        const f = await fatura(b.id);
        if (!['aberta', 'emitida'].includes(txt(f['situacao'])))
          throw recusa('cobranca-nao-aberta', 'Só a cobrança em aberto pode ser baixada.');
        const versao = await tx.alterar('fatura_plano', b.id, b.versao, {
          situacao: 'paga',
          valor_pago: b.valorPago,
          data_pagamento: b.pagoEm,
          valor_acrescimo: Math.round((b.multa + b.juros) * 100) / 100,
          observacao: anexarNota(f['observacao'], b.dispensaMotivo ? `Dispensa na baixa: ${b.dispensaMotivo}` : null),
        });
        return { id: b.id, versao };
      },
      async cancelar(x) {
        const f = await fatura(x.id);
        if (!['aberta', 'emitida'].includes(txt(f['situacao'])))
          throw recusa('cobranca-nao-aberta', 'Só a cobrança em aberto pode ser cancelada.');
        // O motivo estruturado do cancelamento (cadastro motivo_ajuste_fatura, código 'cancelamento'); o texto da tela
        // é acrescentado à observação até a coluna própria do motivo existir (pedido na saída do lote).
        const motivo = await tx.uma(
          "SELECT id FROM motivo_ajuste_fatura WHERE codigo = 'cancelamento' AND ativo = TRUE LIMIT 1",
        );
        const versao = await tx.alterar('fatura_plano', x.id, x.versao, {
          situacao: 'cancelada',
          cancelada_em: new Date(),
          cancelada_por_usuario_id: tx.contexto.usuario,
          motivo_ajuste_fatura_id: motivo ? num(motivo['id']) : null,
          motivo_cancelamento: x.motivo.slice(0, 500),
          observacao: anexarNota(f['observacao'], `Cancelamento: ${x.motivo}`),
        });
        return { id: x.id, versao };
      },
      async estornar(x) {
        const f = await fatura(x.id);
        if (!['paga', 'paga_parcial'].includes(txt(f['situacao'])))
          throw recusa('cobranca-nao-paga', 'Só a cobrança paga pode ter a baixa estornada.');
        const versao = await tx.alterar('fatura_plano', x.id, x.versao, {
          situacao: 'aberta',
          valor_pago: null,
          data_pagamento: null,
          valor_acrescimo: 0,
          observacao: anexarNota(f['observacao'], `Estorno da baixa: ${x.motivo}`),
        });
        return { id: x.id, versao };
      },
      proximoAcordo: () => pendente('Acordos de regularização'),
      renegociar: () => pendente('Renegociação da cobrança'),
      notificar: () => pendente('Notificação de inadimplência'),
      registrarReajuste: (r) => registrarReajuste(tx, est, r),
      async cancelarReajuste(x) {
        const r = await versaoDe(tx, 'reajuste_contrato_plano', x.id, 'O reajuste');
        if (num(r['estabelecimento_id']) !== est) throw inexistente('O reajuste');
        if (txt(r['situacao']) === 'cancelado') throw recusa('reajuste-cancelado', 'O reajuste já foi cancelado.');
        // A versão vista pela tela (relida pelo serviço antes das regras): mudou no meio, 409 conflito-versao.
        await tx.alterar('reajuste_contrato_plano', x.id, x.versao ?? num(r['versao']), {
          situacao: 'cancelado',
          cancelado_em: new Date(),
          cancelado_por_usuario_id: tx.contexto.usuario,
          motivo_cancelamento: x.motivo.slice(0, 500),
          observacao: `${txt(r['observacao'])}\nCancelado: ${x.motivo}`.trim().slice(0, 60_000),
        });
        return { id: x.id };
      },
    };
  }
}

/** O contrato do estabelecimento e da operadora (recusa 404 sem revelar outro). */
async function contratoDaOperadora(l: Leitor, est: number, contrato: number, operadora: number): Promise<Linha> {
  await exigirOperadora(l, est, operadora);
  const k = await l.uma(
    'SELECT id, operadora_saude_id FROM contrato_plano WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [contrato, est],
  );
  if (!k || num(k['operadora_saude_id']) !== operadora) throw inexistente('O contrato');
  return k;
}

async function incluirFatura(
  tx: TxOperacao,
  est: number,
  e: EntradaCobranca & { readonly por: string },
): Promise<{ id: number; versao: number }> {
  await contratoDaOperadora(tx, est, e.contrato, e.operadora);
  const tipo = TIPO_FATURA[e.tipo];
  if (!tipo) throw recusa('tipo-cobranca-invalido', 'Tipo de cobrança inválido.', { campos: ['tipo'] });
  const forma = await tx.uma(
    `SELECT forma_cobranca_plano_id FROM contrato_forma_cobranca
      WHERE contrato_plano_id = ? AND ativo = TRUE
        AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
        AND (beneficiario_plano_id IS NULL OR beneficiario_plano_id <=> ?)
      ORDER BY beneficiario_plano_id IS NULL, id LIMIT 1`,
    [e.contrato, e.beneficiario],
  );
  if (!forma)
    throw recusa('forma-cobranca-ausente', 'O contrato não tem forma de cobrança vigente. Cadastre-a no contrato.');
  const lanc = await tx.uma(
    'SELECT id FROM tipo_lancamento_fatura WHERE codigo = ? AND ativo = TRUE',
    [tipo],
  );
  if (!lanc)
    throw recusa(
      'tipo-lancamento-ausente',
      `O tipo de lançamento "${tipo}" não está cadastrado. Cadastre-o na configuração da cobrança.`,
    );
  if (e.beneficiario !== null) {
    const b = await tx.uma('SELECT contrato_plano_id FROM beneficiario_plano WHERE id = ? AND excluido_em IS NULL', [
      e.beneficiario,
    ]);
    if (!b || num(b['contrato_plano_id']) !== e.contrato) throw inexistente('O beneficiário');
  }
  const numero = await tx.proximoNumero('fatura_plano');
  const valor = Math.round(e.valor * 100) / 100;
  const id = await tx.incluir('fatura_plano', {
    estabelecimento_id: est,
    numero: numero.formatado,
    contrato_plano_id: e.contrato,
    responsavel_beneficiario_plano_id: e.beneficiario,
    tipo_fatura: tipo,
    competencia: primeiroDia(e.competencia),
    parcela: e.parcela,
    data_emissao: new Date(),
    data_vencimento: e.vencimento,
    data_vencimento_original: e.vencimento,
    forma_cobranca_plano_id: num(forma['forma_cobranca_plano_id']),
    valor_bruto: valor,
    valor_total: valor,
    situacao: 'aberta',
  });
  const itens = e.itens.length
    ? e.itens
    : [{ beneficiario: e.beneficiario, descricao: e.descricao, valorBase: null, valor, idade: null, faixa: null }];
  let seq = 0;
  for (const i of itens) {
    seq++;
    await tx.incluir('fatura_plano_item', {
      fatura_plano_id: id,
      sequencia: seq,
      tipo_lancamento_fatura_id: num(lanc['id']),
      natureza: 'debito',
      beneficiario_plano_id: i.beneficiario,
      descricao: (seq === 1 ? e.descricao || i.descricao : i.descricao).slice(0, 200),
      competencia_referencia: primeiroDia(e.competencia),
      quantidade: 1,
      valor_unitario: i.valorBase ?? i.valor,
      valor: i.valor,
    });
  }
  return { id, versao: 1 };
}

async function registrarReajuste(
  tx: TxOperacao,
  est: number,
  r: EntradaReajuste & { readonly por: string },
): Promise<{ id: number }> {
  await contratoDaOperadora(tx, est, r.contrato, r.operadora);
  const base = primeiroDia(r.competencia);
  const notas = [
    r.motivo,
    r.tetoAns !== null ? `Teto ANS: ${r.tetoAns}%` : null,
    r.oficioAns ? `Ofício: ${r.oficioAns}` : null,
  ].filter(Boolean);
  // O reajuste da mesma data-base, travado na transação: o estado esperado para reativar é o cancelado.
  const [anterior] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, observacao FROM reajuste_contrato_plano
      WHERE contrato_plano_id = ? AND data_base = ? AND tipo_reajuste = 'anual' AND complementar = FALSE
        AND excluido_em IS NULL`,
    [r.contrato, base],
  );
  if (anterior && txt(anterior['situacao']) !== 'cancelado')
    throw recusa('reajuste-duplicado', 'Já existe reajuste vigente deste contrato nesta competência.');
  const valores = {
    percentual: r.percentual,
    quantidade_vidas: r.vidas,
    situacao: 'aplicado',
    aplicado_em: new Date(),
    aplicado_por_usuario_id: tx.contexto.usuario,
    observacao: notas.join('\n'),
  };
  // O reajuste cancelado da mesma data-base volta a valer (a unicidade do banco é por contrato, data-base e tipo).
  if (anterior) {
    await tx.alterar('reajuste_contrato_plano', num(anterior['id']), num(anterior['versao']), {
      ...valores,
      observacao: anexarNota(anterior['observacao'], `Reativado: ${notas.join('; ')}`),
    });
    return { id: num(anterior['id']) };
  }
  const id = await tx.incluir('reajuste_contrato_plano', {
    estabelecimento_id: est,
    contrato_plano_id: r.contrato,
    tipo_reajuste: 'anual',
    data_base: base,
    complementar: false,
    ...valores,
  });
  return { id };
}
