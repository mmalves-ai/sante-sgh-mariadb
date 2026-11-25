// Controle orçamentário na compra e no pagamento (C2-112, 07-FIN linha 130, F8) no banco do cliente. As regras são as
// puras de @sgh/dominio-financeiro (controle-orcamentario.ts). Contrato de efeito:
//   - regra: `regra_controle_orcamentario` (ação conferir, alertar, bloquear ou dispensar; recorte por documento, plano,
//     versão, centro, conta e natureza; tolerância, período de apuração, prioridade e vigência); desativar é
//     `ativo = FALSE` com a versão lida, nada se apaga;
//   - reserva: `reserva_orcamentaria` no pedido de compra ou no título a pagar, sobre a linha do orçamento da versão
//     oficial e aprovada; a linha é travada antes do saldo (duas reservas simultâneas não passam do saldo) e o documento
//     antes do total já reservado (a soma das reservas não passa do valor do documento); o excesso autorizado marca
//     `excedeu_saldo` com o autorizador (o próprio usuário, no registro e no alerta confirmado; o aprovador, na exceção);
//   - exceção: `excecao_orcamentaria` pendente com a justificativa e o saldo do momento; a decisão é de outra pessoa
//     (aprovada ou reprovada com o parecer); usada pela reserva, fica `utilizada` e ligada a ela;
//   - nota: a reserva consome o que a nota realizou (parcial ou final; na final a sobra é liberada) e cada nota grava
//     `ajuste_orcamento_nota` (comprometido, realizado e a diferença) em sequência;
//   - liberação: o saldo em aberto vai para `valor_liberado`, com quem, quando e o motivo (migração
//     14_FIN/99_reserva_orcamentaria_liberacao);
//   - a exceção fica presa à linha (e à conta) para a qual foi pedida: a reserva e a nota só usam a exceção da mesma
//     linha e conta; a nota final que passa da reserva segue a regra (ciência no alerta, exceção no bloqueio) e grava
//     no ajuste se excedeu e quem autorizou (migração 14_FIN/99_excecao_orcamentaria_linha);
//   - no documento: a aprovação do pedido de compra (suprimentos) e a do título a pagar (financeiro) chamam
//     `controlarOrcamentoDoDocumento` na mesma transação: o que o documento ainda não tem reservado é reservado na
//     linha oficial do centro (e da natureza) do ano do documento, pela regra que vale; o bloqueio sem exceção
//     recusa a aprovação; no alerta, a aprovação pelo aprovador da alçada vale como a ciência.
// Cada gravação vai pelo executor (trilha na mesma transação) com o usuário da sessão.
import {
  abertoDaReserva,
  ACOES_CONTROLE,
  type AcaoControle,
  conferirAjusteDaNota,
  conferirSaldo,
  DOCUMENTOS_CONTROLE,
  DOCUMENTOS_RESERVA,
  type DocumentoControle,
  type DocumentoReserva,
  efeitoDaNota,
  orcadoNoPeriodo,
  mesesDoPeriodo,
  PERIODOS_APURACAO,
  type PeriodoApuracao,
  type RegraControle,
  regraAplicavel,
  type ReservaParaSaldo,
  type SaldoOrcamentario,
  type SituacaoExcecao,
  type SituacaoReserva,
  saldoOrcamentario,
  validarDecisaoExcecao,
  validarExcecaoOrcamentaria,
  validarLiberacaoReserva,
  validarRegraControle,
} from '@sgh/dominio-financeiro';
import type { Leitor, TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_CONTROLE_ORCAMENTARIO = Symbol('PORTA_CONTROLE_ORCAMENTARIO');

const T_REGRA = 'regra_controle_orcamentario';
const T_RESERVA = 'reserva_orcamentaria';
const T_EXCECAO = 'excecao_orcamentaria';
const T_AJUSTE = 'ajuste_orcamento_nota';
const TABELAS = [T_REGRA, T_RESERVA, T_EXCECAO, T_AJUSTE];
/** O que a aprovação do pedido de compra e a do título a pagar gravam pelo controle (somar às tabelas delas). */
export const TABELAS_CONTROLE_NO_DOCUMENTO = [T_RESERVA, T_EXCECAO] as const;

const dataTxt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const dinheiro = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100;
const recusa = (titulo: string, p: readonly { campo: string; mensagem: string }[]) => {
  if (p.length) throw recusaRegra(titulo, p);
};

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/);
const id = z.number().int().positive();
const idOuNulo = id.nullable().default(null);
const versao = z.number().int().positive();

const esquemaRegra = z
  .object({
    acao: z.enum(ACOES_CONTROLE),
    tipoDocumento: z.enum(DOCUMENTOS_CONTROLE).default('todos'),
    planoOrcamentario: idOuNulo,
    versaoOrcamento: idOuNulo,
    centroCusto: idOuNulo,
    contaOrcamentaria: idOuNulo,
    naturezaFinanceira: idOuNulo,
    tolerancia: z.number().finite().default(0),
    periodo: z.enum(PERIODOS_APURACAO).default('mensal'),
    prioridade: z.number().int().default(100),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().default(null),
    ativo: z.boolean().default(true),
    versao: versao.optional(),
  })
  .strict();

const alvoDocumento = {
  tipoDocumento: z.enum(DOCUMENTOS_RESERVA),
  documento: id,
  linha: id,
  competencia,
  contaOrcamentaria: idOuNulo,
};

const esquemaReserva = z
  .object({
    ...alvoDocumento,
    valor: z.number().finite().nullable().default(null),
    data: data.optional(),
    ciente: z.boolean().default(false),
  })
  .strict();

const esquemaSaldo = z
  .object({
    tipoDocumento: z.enum(DOCUMENTOS_RESERVA).default('pedido_compra'),
    linha: id,
    competencia,
    contaOrcamentaria: idOuNulo,
    data: data.optional(),
  })
  .strict();

const esquemaExcecao = z
  .object({
    ...alvoDocumento,
    contaOrcamentaria: id,
    valor: z.number().finite(),
    justificativa: z.string().trim().max(1000),
    data: data.optional(),
  })
  .strict();

const esquemaDecisao = z
  .object({ versao, aprovar: z.boolean(), parecer: z.string().trim().max(1000).nullable().default(null) })
  .strict();

const esquemaNota = z
  .object({
    versao,
    valorRealizado: z.number().finite(),
    final: z.boolean(),
    notaEntrada: idOuNulo,
    numeroDocumento: z.string().trim().max(30).nullable().default(null),
    dataEmissao: data.nullable().default(null),
    motivo: z.string().trim().max(1000).nullable().default(null),
    ciente: z.boolean().default(false),
  })
  .strict();

const esquemaDocumento = z
  .object({ tipoDocumento: z.enum(DOCUMENTOS_RESERVA), documento: id, ciente: z.boolean().default(false) })
  .strict();

const esquemaLiberacao = z.object({ versao, motivo: z.string().trim().max(400) }).strict();

/** Prefixo do número de negócio por documento (a reserva e a exceção numeram por documento travado). */
const SIGLA: Readonly<Record<DocumentoReserva, string>> = { pedido_compra: 'PC', titulo_pagar: 'TP' };

/** O documento: valor, fornecedor e se está cancelado (no estabelecimento). Travado na gravação. */
const SQL_DOCUMENTO: Readonly<Record<DocumentoReserva, string>> = {
  pedido_compra: `SELECT id, valor_total AS valor, empresa_fornecedora_id, situacao = 'cancelado' AS cancelado,
                         CONCAT(ano, '/', numero) AS numero, centro_custo_id, NULL AS natureza_financeira_id,
                         data_pedido AS data
                    FROM pedido_compra WHERE id = ? AND estabelecimento_id = ?`,
  titulo_pagar: `SELECT id, valor_bruto - valor_desconto + valor_acrescimo AS valor, empresa_fornecedora_id,
                        situacao = 'cancelado' AS cancelado, CAST(numero AS CHAR) AS numero, centro_custo_id,
                        natureza_financeira_id, data_emissao AS data
                   FROM titulo_pagar WHERE id = ? AND estabelecimento_id = ?`,
};

/** A linha oficial e aprovada do ano para o centro do documento (e a natureza, quando há; a exata vem primeiro). */
const SQL_LINHA_DO_DOCUMENTO = `SELECT l.id FROM linha_orcamento l JOIN versao_orcamento v ON v.id = l.versao_orcamento_id
  WHERE v.estabelecimento_id = ? AND v.ano = ? AND v.oficial = TRUE AND v.situacao = 'aprovado'
    AND v.excluido_em IS NULL AND l.excluido_em IS NULL AND l.natureza <> 'receita' AND l.centro_custo_id <=> ?
    AND (l.natureza_financeira_id IS NULL OR ? IS NULL OR l.natureza_financeira_id = ?)
  ORDER BY l.natureza_financeira_id IS NULL, l.sequencia LIMIT 1`;

/** A exceção aprovada do documento para a mesma linha e competência (e a mesma conta, quando a reserva a traz). */
const SQL_EXCECAO_APROVADA = `SELECT id, versao, valor, aprovado_por_usuario_id, conta_orcamentaria_id
   FROM excecao_orcamentaria
  WHERE estabelecimento_id = ? AND entidade = ? AND entidade_id = ? AND competencia = ? AND linha_orcamento_id = ?
    AND (? IS NULL OR conta_orcamentaria_id = ?) AND situacao = 'aprovada' AND excluido_em IS NULL
  ORDER BY id DESC LIMIT 1`;

/** O que reservar no documento (a tela, a aprovação do pedido e a do título usam o mesmo caminho). */
export interface ReservaNoDocumento {
  readonly tipoDocumento: DocumentoReserva;
  readonly documento: number;
  readonly linha: number;
  readonly competencia: string;
  readonly contaOrcamentaria: number | null;
  /** null: o que falta reservar do documento. */
  readonly valor: number | null;
  readonly data: string;
  readonly ciente: boolean;
}

const competenciaDe = (dia: string) => `${dia.slice(0, 7)}-01`;

const regraLida = (r: Record<string, unknown>): RegraControle & { versao: number } => ({
  id: num(r['id']),
  versao: num(r['versao']),
  acao: String(r['acao']) as AcaoControle,
  tipoDocumento: String(r['tipo_documento']) as DocumentoControle,
  planoOrcamentario: numOuNull(r['plano_orcamentario_id']),
  versaoOrcamento: numOuNull(r['versao_orcamento_id']),
  centroCusto: numOuNull(r['centro_custo_id']),
  contaOrcamentaria: numOuNull(r['conta_orcamentaria_id']),
  naturezaFinanceira: numOuNull(r['natureza_financeira_id']),
  tolerancia: Number(r['tolerancia_percentual'] ?? 0),
  periodo: String(r['periodo_apuracao']) as PeriodoApuracao,
  prioridade: num(r['prioridade']),
  vigenciaInicio: dataTxt(r['vigencia_inicio'])!,
  vigenciaFim: dataTxt(r['vigencia_fim']),
  ativo: bool(r['ativo']),
});

const reservaLida = (r: Record<string, unknown>): ReservaParaSaldo => ({
  reservado: dinheiro(r['valor_reservado']),
  consumido: dinheiro(r['valor_consumido']),
  liberado: dinheiro(r['valor_liberado']),
  situacao: String(r['situacao']) as SituacaoReserva,
});

interface LinhaLida {
  readonly id: number;
  readonly versaoOrcamento: number;
  readonly plano: number | null;
  readonly ano: number;
  readonly centro: number | null;
  readonly natureza: number | null;
  readonly meses: number[];
  readonly oficial: boolean;
}

const SQL_LINHA = `SELECT l.id, l.versao_orcamento_id, l.centro_custo_id, l.natureza_financeira_id,
       l.valor_mes_01, l.valor_mes_02, l.valor_mes_03, l.valor_mes_04, l.valor_mes_05, l.valor_mes_06,
       l.valor_mes_07, l.valor_mes_08, l.valor_mes_09, l.valor_mes_10, l.valor_mes_11, l.valor_mes_12,
       v.ano, v.plano_orcamentario_id, v.oficial AND v.situacao = 'aprovado' AS oficial
  FROM linha_orcamento l JOIN versao_orcamento v ON v.id = l.versao_orcamento_id
 WHERE l.id = ? AND v.estabelecimento_id = ? AND l.excluido_em IS NULL AND v.excluido_em IS NULL`;

const linhaLida = (r: Record<string, unknown>): LinhaLida => ({
  id: num(r['id']),
  versaoOrcamento: num(r['versao_orcamento_id']),
  plano: numOuNull(r['plano_orcamentario_id']),
  ano: num(r['ano']),
  centro: numOuNull(r['centro_custo_id']),
  natureza: numOuNull(r['natureza_financeira_id']),
  meses: Array.from({ length: 12 }, (_, i) => dinheiro(r[`valor_mes_${String(i + 1).padStart(2, '0')}`])),
  oficial: bool(r['oficial']),
});

export interface SaldoDaLinha extends SaldoOrcamentario {
  readonly regra: { readonly id: number; readonly acao: AcaoControle; readonly tolerancia: number } | null;
  readonly acao: AcaoControle;
  readonly periodo: PeriodoApuracao;
}

/** O saldo da linha no período da regra que vale para o documento (sem regra: mensal, só conferir). */
async function saldoDaLinha(
  l: Leitor,
  est: number,
  linha: LinhaLida,
  alvo: { tipoDocumento: DocumentoReserva; competencia: string; conta: number | null; data: string },
): Promise<SaldoDaLinha> {
  const regras = (
    await l.consultar('SELECT * FROM regra_controle_orcamentario WHERE estabelecimento_id = ?', [est])
  ).map(regraLida);
  const regra = regraAplicavel(regras, {
    tipoDocumento: alvo.tipoDocumento,
    planoOrcamentario: linha.plano,
    versaoOrcamento: linha.versaoOrcamento,
    centroCusto: linha.centro,
    contaOrcamentaria: alvo.conta,
    naturezaFinanceira: linha.natureza,
    data: alvo.data,
  });
  const periodo = regra?.periodo ?? 'mensal';
  const meses = mesesDoPeriodo(alvo.competencia, periodo);
  const ano = alvo.competencia.slice(0, 4);
  const de = `${ano}-${String(meses[0]).padStart(2, '0')}-01`;
  const ate = `${ano}-${String(meses[meses.length - 1]).padStart(2, '0')}-01`;
  const reservas = await l.consultar(
    `SELECT valor_reservado, valor_consumido, valor_liberado, situacao FROM reserva_orcamentaria
      WHERE linha_orcamento_id = ? AND competencia BETWEEN ? AND ? AND excluido_em IS NULL`,
    [linha.id, de, ate],
  );
  const ajustes = await l.consultar(
    `SELECT a.valor_ajuste FROM ajuste_orcamento_nota a
       JOIN reserva_orcamentaria r ON r.id = a.reserva_orcamentaria_id
      WHERE r.linha_orcamento_id = ? AND r.competencia BETWEEN ? AND ? AND r.excluido_em IS NULL
        AND a.excluido_em IS NULL AND a.desconsiderar = FALSE`,
    [linha.id, de, ate],
  );
  const s = saldoOrcamentario(
    orcadoNoPeriodo(linha.meses, alvo.competencia, periodo),
    reservas.map(reservaLida),
    ajustes.map((a) => dinheiro(a['valor_ajuste'])),
  );
  return {
    ...s,
    regra: regra ? { id: regra.id, acao: regra.acao, tolerancia: regra.tolerancia } : null,
    acao: regra?.acao ?? 'conferir',
    periodo,
  };
}

/** Problemas da linha para a competência: versão oficial aprovada e o mesmo ano. */
function problemasDaLinha(linha: LinhaLida, comp: string) {
  const p: { campo: string; mensagem: string }[] = [];
  if (!linha.oficial)
    p.push({ campo: 'linha', mensagem: 'A linha precisa ser da versão oficial e aprovada do orçamento.' });
  if (Number(comp.slice(0, 4)) !== linha.ano)
    p.push({ campo: 'competencia', mensagem: 'A competência precisa ser do ano da versão do orçamento.' });
  return p;
}

const hojeTxt = () => new Date().toISOString().slice(0, 10);

export class PortaControleOrcamentarioPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'financeiro.orc_controle');
  }

  /** O painel: regras, exceções e reservas recentes, com as escolhas (linhas oficiais, contas, centros, naturezas). */
  painel(c: ContextoPortaPropria) {
    return this.ler(c, 'painel', async (l, est) => {
      const regras = (
        await l.consultar(
          `SELECT * FROM regra_controle_orcamentario WHERE estabelecimento_id = ? ORDER BY ativo DESC, prioridade, id`,
          [est.id],
        )
      ).map(regraLida);
      const excecoes = (
        await l.consultar(
          `SELECT x.*, u.nome AS solicitante_nome, a.nome AS aprovador_nome, co.descricao AS conta_nome,
                  COALESCE(CONCAT(pc.ano, '/', pc.numero), CAST(tp.numero AS CHAR)) AS documento_numero
             FROM excecao_orcamentaria x
             LEFT JOIN pedido_compra pc ON x.entidade = 'pedido_compra' AND pc.id = x.entidade_id
             LEFT JOIN titulo_pagar tp ON x.entidade = 'titulo_pagar' AND tp.id = x.entidade_id
             LEFT JOIN usuario u ON u.id = x.solicitante_usuario_id
             LEFT JOIN usuario a ON a.id = x.aprovado_por_usuario_id
             LEFT JOIN conta_orcamentaria co ON co.id = x.conta_orcamentaria_id
            WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL
            ORDER BY x.situacao = 'pendente' DESC, x.id DESC LIMIT 200`,
          [est.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        versao: num(x['versao']),
        numero: String(x['numero']),
        tipoDocumento: String(x['entidade']),
        documento: numOuNull(x['entidade_id']),
        documentoNumero: txtOuNull(x['documento_numero']),
        linha: numOuNull(x['linha_orcamento_id']),
        competencia: dataTxt(x['competencia'])!,
        conta: txtOuNull(x['conta_nome']),
        valor: dinheiro(x['valor']),
        saldoDisponivel: x['saldo_disponivel'] === null ? null : dinheiro(x['saldo_disponivel']),
        justificativa: String(x['justificativa']),
        solicitante: num(x['solicitante_usuario_id']),
        solicitanteNome: txtOuNull(x['solicitante_nome']),
        situacao: String(x['situacao']) as SituacaoExcecao,
        aprovadorNome: txtOuNull(x['aprovador_nome']),
        parecer: txtOuNull(x['parecer']),
        reserva: numOuNull(x['reserva_orcamentaria_id']),
      }));
      const reservas = (
        await l.consultar(
          `SELECT r.*, cc.nome AS centro_nome, COALESCE(CONCAT(pc.ano, '/', pc.numero), CAST(tp.numero AS CHAR)) AS documento_numero
             FROM reserva_orcamentaria r
             LEFT JOIN pedido_compra pc ON pc.id = r.pedido_compra_id
             LEFT JOIN titulo_pagar tp ON tp.id = r.titulo_pagar_id
             LEFT JOIN centro_custo cc ON cc.id = r.centro_custo_id
            WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL
            ORDER BY r.situacao IN ('ativa', 'parcial') DESC, r.id DESC LIMIT 200`,
          [est.id],
        )
      ).map((r) => ({
        id: num(r['id']),
        versao: num(r['versao']),
        numero: String(r['numero']),
        tipoDocumento: String(r['tipo_documento']),
        documento: numOuNull(r['pedido_compra_id']) ?? numOuNull(r['titulo_pagar_id']),
        documentoNumero: txtOuNull(r['documento_numero']),
        linha: num(r['linha_orcamento_id']),
        centro: txtOuNull(r['centro_nome']),
        competencia: dataTxt(r['competencia'])!,
        reservado: dinheiro(r['valor_reservado']),
        consumido: dinheiro(r['valor_consumido']),
        liberado: dinheiro(r['valor_liberado']),
        aberto: abertoDaReserva(reservaLida(r)),
        excedeuSaldo: bool(r['excedeu_saldo']),
        situacao: String(r['situacao']) as SituacaoReserva,
        motivoLiberacao: txtOuNull(r['motivo_liberacao']),
      }));
      const linhas = (
        await l.consultar(
          `SELECT l.id, l.sequencia, v.ano, v.numero_versao, cc.nome AS centro_nome, nf.descricao AS natureza_nome,
                  l.natureza, l.observacao
             FROM linha_orcamento l JOIN versao_orcamento v ON v.id = l.versao_orcamento_id
             LEFT JOIN centro_custo cc ON cc.id = l.centro_custo_id
             LEFT JOIN natureza_financeira nf ON nf.id = l.natureza_financeira_id
            WHERE v.estabelecimento_id = ? AND v.oficial = TRUE AND v.situacao = 'aprovado'
              AND v.excluido_em IS NULL AND l.excluido_em IS NULL AND l.natureza <> 'receita'
            ORDER BY v.ano DESC, l.sequencia LIMIT 500`,
          [est.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        nome: [
          `${num(x['ano'])} v${num(x['numero_versao'])} #${num(x['sequencia'])}`,
          txtOuNull(x['centro_nome']),
          txtOuNull(x['natureza_nome']) ?? txtOuNull(x['observacao']),
        ]
          .filter(Boolean)
          .join(' · '),
      }));
      // Os documentos que podem reservar, pelo número de negócio, com o fornecedor, o valor e o já reservado.
      const documentos = (
        await l.consultar(
          `SELECT 'pedido_compra' AS tipo, pc.id, CONCAT(pc.ano, '/', pc.numero) AS numero, ef.razao_social AS fornecedor,
                  pc.valor_total AS valor, pc.data_pedido AS data,
                  (SELECT COALESCE(SUM(r.valor_reservado - r.valor_liberado), 0) FROM reserva_orcamentaria r
                    WHERE r.pedido_compra_id = pc.id AND r.situacao <> 'cancelada' AND r.excluido_em IS NULL) AS reservado
             FROM pedido_compra pc LEFT JOIN empresa_fornecedora ef ON ef.id = pc.empresa_fornecedora_id
            WHERE pc.estabelecimento_id = ? AND pc.excluido_em IS NULL
              AND pc.situacao NOT IN ('cancelado', 'reprovado', 'encerrado', 'recebido')
           UNION ALL
           SELECT 'titulo_pagar', tp.id, CAST(tp.numero AS CHAR), ef.razao_social,
                  tp.valor_bruto - tp.valor_desconto + tp.valor_acrescimo, tp.data_emissao,
                  (SELECT COALESCE(SUM(r.valor_reservado - r.valor_liberado), 0) FROM reserva_orcamentaria r
                    WHERE r.titulo_pagar_id = tp.id AND r.situacao <> 'cancelada' AND r.excluido_em IS NULL)
             FROM titulo_pagar tp LEFT JOIN empresa_fornecedora ef ON ef.id = tp.empresa_fornecedora_id
            WHERE tp.estabelecimento_id = ? AND tp.excluido_em IS NULL AND tp.situacao IN ('aberto', 'em_bordero', 'pago_parcial')
            ORDER BY data DESC LIMIT 400`,
          [est.id, est.id],
        )
      ).map((d) => ({
        tipoDocumento: String(d['tipo']) as DocumentoReserva,
        id: num(d['id']),
        numero: String(d['numero']),
        fornecedor: txtOuNull(d['fornecedor']),
        valor: dinheiro(d['valor']),
        reservado: dinheiro(d['reservado']),
      }));
      const opcoes = async (sql: string, p: unknown[]) =>
        (await l.consultar(sql, p)).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
      return {
        regras,
        excecoes,
        reservas,
        linhas,
        documentos,
        contas: await opcoes(
          `SELECT id, CONCAT(codigo, ' ', descricao) AS nome FROM conta_orcamentaria
            WHERE ativo = TRUE AND excluido_em IS NULL AND grau = 'analitica' ORDER BY codigo LIMIT 500`,
          [],
        ),
        centros: await opcoes(
          `SELECT id, nome FROM centro_custo WHERE estabelecimento_id = ? AND ativo = TRUE ORDER BY nome LIMIT 500`,
          [est.id],
        ),
        naturezas: await opcoes(
          'SELECT id, descricao AS nome FROM natureza_financeira ORDER BY descricao LIMIT 500',
          [],
        ),
        planos: await opcoes(
          'SELECT id, descricao AS nome FROM plano_orcamentario WHERE excluido_em IS NULL ORDER BY descricao',
          [],
        ),
        usuario: c.usuario,
      };
    });
  }

  /** A prévia do saldo da linha para o documento (o que a tela mostra antes de reservar). */
  saldo(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaSaldo, entrada);
    return this.ler(c, 'saldo', async (l, est) => {
      const r = await l.uma(SQL_LINHA, [e.linha, est.id]);
      if (!r) throw naoEncontrado('Linha do orçamento');
      const linha = linhaLida(r);
      return saldoDaLinha(l, est.id, linha, {
        tipoDocumento: e.tipoDocumento,
        competencia: e.competencia,
        conta: e.contaOrcamentaria,
        data: e.data ?? hojeTxt(),
      });
    });
  }

  /** Cria (alvo null) ou altera a regra de controle (inclusive desativar). */
  salvarRegra(c: ContextoPortaPropria, alvo: number | null, entrada: unknown) {
    const e = entradaValida(esquemaRegra, entrada);
    const nome =
      alvo === null ? 'financeiro.orc_controle.criar_regra' : 'financeiro.orc_controle.alterar_regra';
    return this.gravar(c, nome, TABELAS, async (tx, est) => {
      recusa('Regra recusada', validarRegraControle(e));
      const campos = {
        plano_orcamentario_id: e.planoOrcamentario,
        versao_orcamento_id: e.versaoOrcamento,
        centro_custo_id: e.centroCusto,
        conta_orcamentaria_id: e.contaOrcamentaria,
        natureza_financeira_id: e.naturezaFinanceira,
        tipo_documento: e.tipoDocumento,
        acao: e.acao,
        tolerancia_percentual: e.tolerancia,
        periodo_apuracao: e.periodo,
        prioridade: e.prioridade,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        ativo: e.ativo,
      };
      if (e.centroCusto !== null) {
        const cc = await tx.uma('SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ?', [
          e.centroCusto,
          est.id,
        ]);
        if (!cc) throw naoEncontrado('Centro de custo');
      }
      if (alvo === null) {
        const novo = await tx.incluir(T_REGRA, { estabelecimento_id: est.id, ...campos });
        return { tabela: T_REGRA, id: novo };
      }
      if (e.versao === undefined)
        recusa('Regra recusada', [{ campo: 'versao', mensagem: 'Informe a versão lida.' }]);
      const atual = await tx.uma(
        'SELECT id FROM regra_controle_orcamentario WHERE id = ? AND estabelecimento_id = ?',
        [alvo, est.id],
      );
      if (!atual) throw naoEncontrado('Regra de controle');
      await tx.alterar(T_REGRA, alvo, e.versao!, campos);
      return { tabela: T_REGRA, id: alvo };
    });
  }

  /** Reserva o valor do documento na linha do orçamento, conferindo o saldo pela regra que vale. */
  reservar(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaReserva, entrada);
    return this.gravar(c, 'financeiro.orc_controle.reservar', TABELAS, (tx, est, usuario) =>
      reservarNoDocumento(tx, est.id, usuario, { ...e, data: e.data ?? hojeTxt() }),
    );
  }

  /**
   * Reserva pelo documento (o mesmo caminho da aprovação do pedido e do título): o sistema acha a linha oficial do
   * centro e da natureza do documento e reserva o que falta, pela regra que vale.
   */
  controlarDocumento(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaDocumento, entrada);
    return this.gravar(
      c,
      'financeiro.orc_controle.controlar_documento',
      TABELAS,
      async (tx, est, usuario) => {
        const r = await controlarOrcamentoDoDocumento(tx, est.id, usuario, e);
        return { ...r, tabela: T_RESERVA, id: r.reserva };
      },
    );
  }

  /** Pede a exceção justificada para operar sem saldo (o documento ainda sem reserva do excesso). */
  solicitarExcecao(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaExcecao, entrada);
    return this.gravar(c, 'financeiro.orc_controle.pedir_excecao', TABELAS, async (tx, est, usuario) => {
      const r = await tx.uma(SQL_LINHA, [e.linha, est.id]);
      if (!r) throw naoEncontrado('Linha do orçamento');
      const linha = linhaLida(r);
      const [doc] = await tx.consultarParaAtualizar(SQL_DOCUMENTO[e.tipoDocumento], [e.documento, est.id], {
        teto: 1,
      });
      if (!doc) throw naoEncontrado('Documento');
      const conta = await tx.uma(
        'SELECT id, plano_orcamentario_id FROM conta_orcamentaria WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL',
        [e.contaOrcamentaria],
      );
      if (!conta) throw naoEncontrado('Conta orçamentária');
      const problemas = [
        ...(linha.plano !== null && num(conta['plano_orcamentario_id']) !== linha.plano
          ? [{ campo: 'contaOrcamentaria', mensagem: 'A conta não é do plano orçamentário da linha.' }]
          : []),
        ...problemasDaLinha(linha, e.competencia),
        ...validarExcecaoOrcamentaria({ valor: e.valor, justificativa: e.justificativa }),
      ];
      if (bool(doc['cancelado']))
        problemas.push({ campo: 'documento', mensagem: 'O documento está cancelado.' });
      const pendente = await tx.uma(
        `SELECT id FROM excecao_orcamentaria WHERE estabelecimento_id = ? AND entidade = ? AND entidade_id = ?
            AND linha_orcamento_id = ? AND situacao = 'pendente' AND excluido_em IS NULL`,
        [est.id, e.tipoDocumento, e.documento, linha.id],
      );
      if (pendente)
        problemas.push({
          campo: 'documento',
          mensagem: 'O documento já tem uma exceção esperando decisão nesta linha.',
        });
      recusa('Exceção recusada', problemas);
      const saldo = await saldoDaLinha(tx, est.id, linha, {
        tipoDocumento: e.tipoDocumento,
        competencia: e.competencia,
        conta: e.contaOrcamentaria,
        data: e.data ?? hojeTxt(),
      });
      const qtd = await tx.uma(
        'SELECT COUNT(*) AS n FROM excecao_orcamentaria WHERE estabelecimento_id = ? AND entidade = ? AND entidade_id = ?',
        [est.id, e.tipoDocumento, e.documento],
      );
      const novo = await tx.incluir(T_EXCECAO, {
        estabelecimento_id: est.id,
        numero: `E${SIGLA[e.tipoDocumento]}${e.documento}-${num(qtd?.['n']) + 1}`.slice(0, 20),
        plano_orcamentario_id: num(conta['plano_orcamentario_id']),
        conta_orcamentaria_id: e.contaOrcamentaria,
        centro_custo_id: linha.centro,
        linha_orcamento_id: linha.id,
        competencia: e.competencia,
        valor: e.valor,
        saldo_disponivel: saldo.disponivel,
        entidade: e.tipoDocumento,
        entidade_id: e.documento,
        justificativa: e.justificativa,
        solicitante_usuario_id: usuario,
        solicitado_em: new Date(),
        situacao: 'pendente',
      });
      return { tabela: T_EXCECAO, id: novo, saldoDisponivel: saldo.disponivel };
    });
  }

  /** Aprova ou reprova a exceção (outra pessoa que não quem pediu; reprovação com o parecer). */
  decidirExcecao(c: ContextoPortaPropria, excecaoId: number, entrada: unknown) {
    const e = entradaValida(esquemaDecisao, entrada);
    return this.gravar(c, 'financeiro.orc_controle.decidir_excecao', TABELAS, async (tx, est, usuario) => {
      const [x] = await tx.consultarParaAtualizar(
        'SELECT id, situacao, solicitante_usuario_id FROM excecao_orcamentaria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [excecaoId, est.id],
        { teto: 1 },
      );
      if (!x) throw naoEncontrado('Exceção orçamentária');
      recusa(
        'Decisão recusada',
        validarDecisaoExcecao({
          situacao: String(x['situacao']) as SituacaoExcecao,
          solicitante: num(x['solicitante_usuario_id']),
          aprovador: usuario,
          aprovar: e.aprovar,
          parecer: e.parecer,
        }),
      );
      await tx.alterar(T_EXCECAO, excecaoId, e.versao, {
        situacao: e.aprovar ? 'aprovada' : 'reprovada',
        aprovado_por_usuario_id: usuario,
        decidido_em: new Date(),
        parecer: e.parecer || null,
      });
      return { tabela: T_EXCECAO, id: excecaoId };
    });
  }

  /** A nota realiza a reserva: consome, libera a sobra na final e grava o ajuste em sequência. */
  registrarNota(c: ContextoPortaPropria, reservaId: number, entrada: unknown) {
    const e = entradaValida(esquemaNota, entrada);
    return this.gravar(c, 'financeiro.orc_controle.registrar_nota', TABELAS, async (tx, est, usuario) => {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT * FROM reserva_orcamentaria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [reservaId, est.id],
        { teto: 1 },
      );
      if (!r) throw naoEncontrado('Reserva orçamentária');
      if (e.notaEntrada !== null) {
        const nota = await tx.uma('SELECT id FROM nota_entrada WHERE id = ? AND estabelecimento_id = ?', [
          e.notaEntrada,
          est.id,
        ]);
        if (!nota) throw naoEncontrado('Nota de entrada');
      }
      const reserva = reservaLida(r);
      const ef = efeitoDaNota({ reserva, realizado: e.valorRealizado, final: e.final });
      recusa('Nota recusada', ef.problemas);
      // O ajuste positivo da nota final gasta além do comprometido: segue a regra da linha (ciência ou exceção).
      const comp = dataTxt(r['competencia'])!;
      const tipo = String(r['tipo_documento']) as DocumentoReserva;
      const doc = numOuNull(r['pedido_compra_id']) ?? numOuNull(r['titulo_pagar_id']);
      const conta = numOuNull(r['conta_orcamentaria_id']);
      let conf: ReturnType<typeof conferirAjusteDaNota> | null = null;
      let exc: Record<string, unknown> | undefined;
      if (ef.ajuste > 0) {
        const lr = await tx.uma(SQL_LINHA, [num(r['linha_orcamento_id']), est.id]);
        if (!lr) throw naoEncontrado('Linha do orçamento');
        const saldo = await saldoDaLinha(tx, est.id, linhaLida(lr), {
          tipoDocumento: tipo,
          competencia: comp,
          conta,
          data: e.dataEmissao ?? comp,
        });
        [exc] = await tx.consultarParaAtualizar(
          SQL_EXCECAO_APROVADA,
          [est.id, tipo, doc, comp, num(r['linha_orcamento_id']), conta, conta],
          { teto: 1 },
        );
        conf = conferirAjusteDaNota({
          acao: saldo.acao,
          tolerancia: saldo.regra?.tolerancia ?? 0,
          saldo,
          ajuste: ef.ajuste,
          ciente: e.ciente,
          excecaoAprovada: exc ? dinheiro(exc['valor']) : null,
        });
        recusa('Nota recusada', conf.problemas);
      }
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM ajuste_orcamento_nota WHERE reserva_orcamentaria_id = ?',
        [reservaId],
      );
      await tx.alterar(T_RESERVA, reservaId, e.versao, {
        valor_consumido: Math.round((reserva.consumido + ef.consumir) * 100) / 100,
        valor_liberado: Math.round((reserva.liberado + ef.liberar) * 100) / 100,
        situacao: ef.situacao,
        ...(e.notaEntrada !== null && r['nota_entrada_id'] === null
          ? { nota_entrada_id: e.notaEntrada }
          : {}),
      });
      const ajuste = await tx.incluir(T_AJUSTE, {
        reserva_orcamentaria_id: reservaId,
        sequencia: num(seq?.['s']),
        nota_entrada_id: e.notaEntrada,
        pedido_compra_id: numOuNull(r['pedido_compra_id']),
        empresa_fornecedora_id: numOuNull(r['empresa_fornecedora_id']),
        competencia: dataTxt(r['competencia']),
        data_emissao: e.dataEmissao,
        numero_documento: e.numeroDocumento,
        centro_custo_id: numOuNull(r['centro_custo_id']),
        conta_orcamentaria_id: numOuNull(r['conta_orcamentaria_id']),
        valor_comprometido: ef.comprometido,
        valor_realizado: e.valorRealizado,
        valor_ajuste: ef.ajuste,
        motivo: e.motivo || null,
        excedeu_saldo: conf?.excedeuSaldo ?? false,
        autorizador_usuario_id:
          conf?.autorizacao === 'excecao'
            ? num(exc!['aprovado_por_usuario_id'])
            : conf?.autorizacao === 'sessao'
              ? usuario
              : null,
      });
      if (conf?.autorizacao === 'excecao')
        await tx.alterar(T_EXCECAO, num(exc!['id']), num(exc!['versao']), {
          situacao: 'utilizada',
          reserva_orcamentaria_id: reservaId,
        });
      return {
        tabela: T_AJUSTE,
        id: ajuste,
        consumir: ef.consumir,
        liberar: ef.liberar,
        ajuste: ef.ajuste,
        situacao: ef.situacao,
        decisao: conf?.decisao ?? 'livre',
        excesso: conf?.excesso ?? 0,
      };
    });
  }

  /** Libera o saldo em aberto da reserva, com o motivo (nada se apaga). */
  liberar(c: ContextoPortaPropria, reservaId: number, entrada: unknown) {
    const e = entradaValida(esquemaLiberacao, entrada);
    return this.gravar(c, 'financeiro.orc_controle.liberar_reserva', TABELAS, async (tx, est, usuario) => {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT * FROM reserva_orcamentaria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [reservaId, est.id],
        { teto: 1 },
      );
      if (!r) throw naoEncontrado('Reserva orçamentária');
      const reserva = reservaLida(r);
      recusa('Liberação recusada', validarLiberacaoReserva(reserva, e.motivo));
      const aberto = abertoDaReserva(reserva);
      await tx.alterar(T_RESERVA, reservaId, e.versao, {
        valor_liberado: Math.round((reserva.liberado + aberto) * 100) / 100,
        situacao: reserva.consumido > 0 ? 'consumida' : 'liberada',
        liberado_em: new Date(),
        liberado_por: usuario,
        motivo_liberacao: e.motivo,
      });
      return { tabela: T_RESERVA, id: reservaId, liberado: aberto };
    });
  }
}

/**
 * Reserva o valor do documento na linha, conferindo o saldo pela regra que vale. A linha é travada antes do saldo
 * (reservas simultâneas na mesma linha passam uma de cada vez) e o documento antes do total já reservado. A exceção
 * só vale se for do mesmo documento, linha e competência (e da mesma conta, quando a reserva traz a conta; sem conta,
 * a reserva fica com a conta da exceção usada).
 */
export async function reservarNoDocumento(
  tx: TxOperacao,
  est: number,
  usuario: number,
  e: ReservaNoDocumento,
) {
  const [travaLinha] = await tx.consultarParaAtualizar(
    'SELECT id FROM linha_orcamento WHERE id = ?',
    [e.linha],
    {
      teto: 1,
    },
  );
  if (!travaLinha) throw naoEncontrado('Linha do orçamento');
  const r = await tx.uma(SQL_LINHA, [e.linha, est]);
  if (!r) throw naoEncontrado('Linha do orçamento');
  const linha = linhaLida(r);
  const [doc] = await tx.consultarParaAtualizar(SQL_DOCUMENTO[e.tipoDocumento], [e.documento, est], {
    teto: 1,
  });
  if (!doc) throw naoEncontrado('Documento');
  const coluna = `${e.tipoDocumento}_id`;
  const ja = await tx.uma(
    `SELECT COALESCE(SUM(valor_reservado - valor_liberado), 0) AS v, COUNT(*) AS n FROM reserva_orcamentaria
      WHERE tipo_documento = ? AND (pedido_compra_id = ? OR titulo_pagar_id = ?) AND estabelecimento_id = ?
        AND situacao <> 'cancelada' AND excluido_em IS NULL`,
    [e.tipoDocumento, e.documento, e.documento, est],
  );
  const valorDoc = dinheiro(doc['valor']);
  const jaReservado = dinheiro(ja?.['v']);
  const valor = e.valor ?? Math.max(0, Math.round((valorDoc - jaReservado) * 100) / 100);
  const problemas = problemasDaLinha(linha, e.competencia);
  if (bool(doc['cancelado'])) problemas.push({ campo: 'documento', mensagem: 'O documento está cancelado.' });
  if (valor > 0 && Math.round((jaReservado + valor) * 100) > Math.round(valorDoc * 100))
    problemas.push({
      campo: 'valor',
      mensagem: `O documento vale ${valorDoc.toFixed(2)} e já tem ${jaReservado.toFixed(2)} reservados.`,
    });
  const saldo = await saldoDaLinha(tx, est, linha, {
    tipoDocumento: e.tipoDocumento,
    competencia: e.competencia,
    conta: e.contaOrcamentaria,
    data: e.data,
  });
  const [exc] = await tx.consultarParaAtualizar(
    SQL_EXCECAO_APROVADA,
    [est, e.tipoDocumento, e.documento, e.competencia, linha.id, e.contaOrcamentaria, e.contaOrcamentaria],
    { teto: 1 },
  );
  const conf = conferirSaldo({
    acao: saldo.acao,
    tolerancia: saldo.regra?.tolerancia ?? 0,
    saldo,
    valor,
    ciente: e.ciente,
    excecaoAprovada: exc ? dinheiro(exc['valor']) : null,
  });
  recusa('Reserva recusada', [...problemas, ...conf.problemas]);
  const n = num(ja?.['n']) + 1;
  const reserva = await tx.incluir(T_RESERVA, {
    estabelecimento_id: est,
    numero: `R${SIGLA[e.tipoDocumento]}${e.documento}-${n}`,
    linha_orcamento_id: linha.id,
    centro_custo_id: linha.centro,
    conta_orcamentaria_id:
      e.contaOrcamentaria ?? (conf.autorizacao === 'excecao' ? num(exc!['conta_orcamentaria_id']) : null),
    competencia: e.competencia,
    tipo_documento: e.tipoDocumento,
    [coluna]: e.documento,
    empresa_fornecedora_id: numOuNull(doc['empresa_fornecedora_id']),
    valor_reservado: valor,
    excedeu_saldo: conf.excedeuSaldo,
    autorizador_usuario_id:
      conf.autorizacao === 'excecao'
        ? num(exc!['aprovado_por_usuario_id'])
        : conf.autorizacao === 'sessao'
          ? usuario
          : null,
    situacao: 'ativa',
  });
  if (conf.autorizacao === 'excecao')
    await tx.alterar(T_EXCECAO, num(exc!['id']), num(exc!['versao']), {
      situacao: 'utilizada',
      reserva_orcamentaria_id: reserva,
    });
  return {
    tabela: T_RESERVA,
    id: reserva,
    valor,
    decisao: conf.decisao,
    excesso: conf.excesso,
    disponivel: saldo.disponivel,
  };
}

export interface ControleNoDocumento {
  /** reservado: reservou o que faltava; coberto: já estava todo reservado; sem_orcamento: o ano não tem linha. */
  readonly situacao: 'reservado' | 'coberto' | 'sem_orcamento';
  readonly reserva: number | null;
  readonly linha: number | null;
  readonly valor: number;
  readonly decisao: string | null;
  readonly excesso: number;
}

/**
 * O controle no documento, na mesma transação da aprovação do pedido de compra e da do título a pagar: o que o
 * documento ainda não tem reservado é reservado na linha oficial do centro (e da natureza) do ano do documento, pela
 * regra que vale. O bloqueio sem exceção aprovada da mesma linha recusa (e desfaz) a aprovação; o alerta passa quando
 * `ciente` (a aprovação pelo aprovador da alçada é a ciência dele) e marca o excesso com ele. Sem linha no orçamento
 * oficial do ano não há saldo a conferir: o documento segue (ADR 0002, ferramentas e alertas, sem trava automática).
 */
export async function controlarOrcamentoDoDocumento(
  tx: TxOperacao,
  est: number,
  usuario: number,
  e: { tipoDocumento: DocumentoReserva; documento: number; ciente: boolean },
): Promise<ControleNoDocumento> {
  const doc = await tx.uma(SQL_DOCUMENTO[e.tipoDocumento], [e.documento, est]);
  if (!doc) throw naoEncontrado('Documento');
  const dia = dataTxt(doc['data']) ?? hojeTxt();
  const natureza = numOuNull(doc['natureza_financeira_id']);
  const l = await tx.uma(SQL_LINHA_DO_DOCUMENTO, [
    est,
    Number(dia.slice(0, 4)),
    numOuNull(doc['centro_custo_id']),
    natureza,
    natureza,
  ]);
  const vazio = { reserva: null, valor: 0, decisao: null, excesso: 0 };
  if (!l) return { ...vazio, situacao: 'sem_orcamento', linha: null };
  const linha = num(l['id']);
  const ja = await tx.uma(
    `SELECT COALESCE(SUM(valor_reservado - valor_liberado), 0) AS v FROM reserva_orcamentaria
      WHERE tipo_documento = ? AND (pedido_compra_id = ? OR titulo_pagar_id = ?) AND estabelecimento_id = ?
        AND situacao <> 'cancelada' AND excluido_em IS NULL`,
    [e.tipoDocumento, e.documento, e.documento, est],
  );
  const falta = Math.round((dinheiro(doc['valor']) - dinheiro(ja?.['v'])) * 100) / 100;
  if (falta <= 0) return { ...vazio, situacao: 'coberto', linha };
  const r = await reservarNoDocumento(tx, est, usuario, {
    tipoDocumento: e.tipoDocumento,
    documento: e.documento,
    linha,
    competencia: competenciaDe(dia),
    contaOrcamentaria: null,
    valor: falta,
    data: dia,
    ciente: e.ciente,
  });
  return {
    situacao: 'reservado',
    reserva: r.id,
    linha,
    valor: r.valor,
    decisao: r.decisao,
    excesso: r.excesso,
  };
}
