// Porta de persistência da efetivação do cancelamento do contrato de plano da operadora (08-SGO L94, C2-108). Só SQL e
// conversão: a decisão (se o pedido pode ser efetivado; qual motivo de exclusão dá a baixa) é das regras do domínio
// (podeEfetivarCancelamento e motivoDaBaixa de @sgh/dominio-operadora), que quem chama passa. A API (botão da tela e
// rota de vencidos) e o worker (rotina diária) gravam por aqui, na transação da operação: o contrato encerra no efeito,
// cada beneficiário vigente recebe a baixa cadastral com o movimento de exclusão e o crédito ao contratante vira crédito
// de fatura em aberto. Nada se apaga: o pedido fica efetivado e o beneficiário fica excluído com a data.
import { ErroOperacao, garantirSequencia, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';

/** As tabelas que a efetivação grava (a operação declara todas). */
export const TABELAS_EFETIVACAO_CANCELAMENTO = [
  'cancelamento_contrato_plano',
  'contrato_plano',
  'beneficiario_plano',
  'movimento_cadastral_beneficiario',
  'credito_fatura_plano',
] as const;

export interface ProblemaEfetivacao {
  readonly codigo: string;
  readonly campo: string;
  readonly detalhe: string;
}

/** As regras do domínio que a efetivação aplica (o chamador passa as de @sgh/dominio-operadora). */
export interface RegrasEfetivacao {
  podeEfetivar(situacao: string, dataEfeito: string, hoje: string): ProblemaEfetivacao | null;
  motivoDaBaixa(
    motivos: readonly { id: number; motivoCancelamento: number | null }[],
    motivoCancelamento: number,
  ): { id: number } | ProblemaEfetivacao;
}

export interface PedidoEncerramento {
  readonly motivo: number;
  readonly protocolo: string;
  readonly credito: number | null;
}

const dois = (n: number) => String(n).padStart(2, '0');
const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return Number.isNaN(v.getTime())
      ? null
      : `${v.getUTCFullYear()}-${dois(v.getUTCMonth() + 1)}-${dois(v.getUTCDate())}`;
  const t = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};
const inteiro = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

function exigir(p: ProblemaEfetivacao): never {
  throw recusa(p.codigo, p.detalhe, { campos: [p.campo] });
}
const naoEncontrado = (): never => {
  throw new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    'O registro não existe neste estabelecimento.',
  );
};

/** Os pedidos do estabelecimento com a data de efeito alcançada, na ordem do efeito. */
export async function cancelamentosVencidos(l: Leitor, estabelecimento: number): Promise<number[]> {
  const r = await l.consultar(
    `SELECT k.id FROM cancelamento_contrato_plano k JOIN contrato_plano cp ON cp.id = k.contrato_plano_id
      WHERE cp.estabelecimento_id = ? AND k.excluido_em IS NULL AND k.situacao IN ('solicitado','agendado')
        AND k.data_efeito <= CURRENT_DATE ORDER BY k.data_efeito, k.id`,
    [estabelecimento],
    { teto: 5000 },
  );
  return r.map((x) => Number(x['id']));
}

/**
 * Encerra o contrato no efeito: o contrato fica encerrado com o fim de vigência, cada beneficiário não excluído recebe a
 * baixa (motivo de exclusão ligado ao motivo do cancelamento, pela regra do domínio) com o movimento de exclusão, e o
 * crédito ao contratante vira crédito de fatura em aberto.
 */
export async function encerrarContratoPlano(
  tx: TxOperacao,
  estabelecimento: number,
  contrato: number,
  efeito: string,
  k: PedidoEncerramento,
  regras: Pick<RegrasEfetivacao, 'motivoDaBaixa'>,
): Promise<{ baixados: number }> {
  const ctr = await tx.uma(
    'SELECT id, versao, inicio_vigencia FROM contrato_plano WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [contrato, estabelecimento],
  );
  if (!ctr) return naoEncontrado();
  const bens = await tx.consultarParaAtualizar(
    `SELECT b.id, b.versao, b.inicio_vigencia, b.situacao, b.fim_vigencia, cp.produto_plano_id
       FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id
      WHERE b.contrato_plano_id = ? AND b.excluido_em IS NULL AND (b.fim_vigencia IS NULL OR b.situacao <> 'excluido')`,
    [contrato],
    { teto: 100_000 },
  );
  let motivoBaixa: number | null = null;
  if (bens.length > 0) {
    const ms = await tx.consultar(
      "SELECT id, motivo_cancelamento_contrato_id FROM motivo_movimento_cadastral WHERE tipo_movimento = 'exclusao' AND ativo = TRUE AND motivo_cancelamento_contrato_id = ?",
      [k.motivo],
      { teto: 50 },
    );
    const m = regras.motivoDaBaixa(
      ms.map((x) => ({
        id: Number(x['id']),
        motivoCancelamento: inteiro(x['motivo_cancelamento_contrato_id']),
      })),
      k.motivo,
    );
    if ('codigo' in m) exigir(m);
    motivoBaixa = m.id;
  }
  const inicio = dataIso(ctr['inicio_vigencia']) ?? efeito;
  await tx.alterar('contrato_plano', contrato, Number(ctr['versao']), {
    situacao: 'encerrado',
    fim_vigencia: efeito < inicio ? inicio : efeito,
    tipo_vigencia: 'determinada',
  });
  let baixados = 0;
  for (const b of bens) {
    const ini = dataIso(b['inicio_vigencia']) ?? efeito;
    const fim = efeito < ini ? ini : efeito;
    const ja = texto(b['situacao']) === 'excluido';
    await tx.alterar(
      'beneficiario_plano',
      Number(b['id']),
      Number(b['versao']),
      ja
        ? { fim_vigencia: dataIso(b['fim_vigencia']) ?? fim }
        : {
            fim_vigencia: fim,
            situacao: 'excluido',
            data_exclusao: fim,
            motivo_movimento_cadastral_id: motivoBaixa,
          },
    );
    if (ja) continue;
    baixados++;
    await tx.incluir('movimento_cadastral_beneficiario', {
      beneficiario_plano_id: Number(b['id']),
      operacao: 'alteracao',
      dados: JSON.stringify({ tipo: 'exclusao', cancelamento: k.protocolo }),
      ocorrido_em: new Date(),
      usuario_id: tx.contexto.usuario,
      tipo_movimento: 'exclusao',
      motivo_movimento_cadastral_id: motivoBaixa,
      data_efeito: fim,
      situacao: 'efetivado',
      contrato_plano_id: contrato,
      produto_plano_id: inteiro(b['produto_plano_id']),
      cancela_mensalidades: true,
      canal: 'manual',
    });
  }
  if (k.credito !== null && k.credito > 0) {
    await garantirSequencia(
      tx,
      { tipo: 'credito_fatura_plano', estabelecimento },
      { usuario: tx.contexto.usuario, agora: new Date() },
    );
    const num = await tx.proximoNumero('credito_fatura_plano');
    await tx.incluir('credito_fatura_plano', {
      estabelecimento_id: estabelecimento,
      numero: num.formatado,
      contrato_plano_id: contrato,
      tipo_credito: 'devolucao',
      data_credito: efeito,
      valor: k.credito,
      saldo: k.credito,
      motivo: `Cancelamento ${k.protocolo}: pagamento adiante do efeito`,
      situacao: 'aberto',
    });
  }
  return { baixados };
}

/** Efetiva um pedido de cancelamento do estabelecimento (travado na transação) pela regra do domínio. */
export async function efetivarCancelamentoContrato(
  tx: TxOperacao,
  estabelecimento: number,
  id: number,
  hoje: string,
  regras: RegrasEfetivacao,
): Promise<{ id: number; baixados: number }> {
  const [r] = await tx.consultarParaAtualizar(
    `SELECT k.id, k.versao, k.situacao, k.data_efeito, k.contrato_plano_id, k.motivo_cancelamento_contrato_id,
            k.protocolo, k.valor_credito FROM cancelamento_contrato_plano k
       JOIN contrato_plano cp ON cp.id = k.contrato_plano_id WHERE k.id = ? AND cp.estabelecimento_id = ?`,
    [id, estabelecimento],
    { teto: 1 },
  );
  if (!r) return naoEncontrado();
  const efeito = dataIso(r['data_efeito']) ?? hoje;
  const p = regras.podeEfetivar(texto(r['situacao']), efeito, hoje);
  if (p) exigir(p);
  await tx.alterar('cancelamento_contrato_plano', id, Number(r['versao']), {
    situacao: 'efetivado',
    efetivado_em: new Date(),
    efetivado_por_usuario_id: tx.contexto.usuario,
  });
  const { baixados } = await encerrarContratoPlano(
    tx,
    estabelecimento,
    Number(r['contrato_plano_id']),
    efeito,
    {
      motivo: Number(r['motivo_cancelamento_contrato_id']),
      protocolo: texto(r['protocolo']),
      credito: numero(r['valor_credito']),
    },
    regras,
  );
  return { id, baixados };
}
