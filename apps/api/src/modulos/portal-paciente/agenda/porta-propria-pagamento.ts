// Confirmação PRÓPRIA do pagamento do portal (modulos-proprios-2, família portal-leituras): `confirmarPagamento` do
// GravadorAgendaOnline sobre a transação da operação (`TxOperacao`), com a mesma regra da porta de memória:
//   - a intenção travada pela transação do gateway, no estabelecimento da sessão (a de outro não é encontrada);
//   - a repetida (já decidida) devolve `mudou: false` sem gravar outro recebimento;
//   - a vencida aprovada pelo gateway (paga no fim do prazo) ainda vai ao caixa; se a marcação já estava paga por outra
//     intenção, fica `duplicado` (o faturamento devolve); senão as outras pendentes da marcação vencem;
//   - a aprovada baixa no recebimento particular do caixa do portal (finalidade avulso, número RP- por estabelecimento),
//     e a intenção guarda o recebimento, o instante e o caminho da confirmação (retorno ou conferência, migração 92).
// O caixa do portal (código CAIXA_PORTAL no estabelecimento) e a forma de recebimento do meio (pix ou cartão de crédito)
// vêm do cadastro: sem eles, 503 `catalogo-incompleto` e nada é gravado (falha fechada, nunca um caixa inventado).
// Nenhuma mensagem sai daqui (regra 6).
import { ErroOperacao, garantirSequencia, type Linha, type TxOperacao } from '@sgh/nucleo';
import { ErroPortal } from '../tipos.js';
import type { ConfirmacaoParaGravar } from './porta.js';
import type { PagamentoPortal, ResultadoConfirmacaoPortal } from './tipos.js';

/** Código do caixa que recebe os pagamentos do portal em cada estabelecimento (cadastro do caixa). */
export const CAIXA_PORTAL = 'PORTAL';
/** Tabelas que a confirmação toca (somar às TABELAS_AGENDA_ONLINE da operação). */
export const TABELAS_CONFIRMACAO_PAGAMENTO = [
  'intencao_pagamento_portal',
  'recebimento_particular',
  'sequencia_negocio',
] as const;

const num = (v: unknown): number => Number(v);

const catalogoIncompleto = (o: string) =>
  new ErroOperacao(
    503,
    'catalogo-incompleto',
    'Catálogo incompleto',
    `${o} Nada foi gravado: o pagamento continua pendente e será conferido de novo.`,
  );

/** O que a confirmação precisa da porta da agenda online: a releitura e o mapa da linha, e onde marcar a escrita. */
export interface ApoioConfirmacao {
  /** O SELECT da intenção com a natureza da agenda (SQL_PAGAMENTO), terminado no filtro do estabelecimento. */
  readonly sqlPagamento: string;
  readonly daLinha: (x: Linha) => PagamentoPortal;
  readonly marcar: (tabela: string, id: number) => void;
}

/** A confirmação do pagamento do portal pelo retorno do gateway ou pela conferência (regra da porta de memória). */
export async function confirmarPagamentoProprio(
  tx: TxOperacao,
  estabelecimento: number,
  x: ConfirmacaoParaGravar,
  apoio: ApoioConfirmacao,
): Promise<ResultadoConfirmacaoPortal> {
  const [atual] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, paciente_id, marcacao_horario_id, valor, forma
       FROM intencao_pagamento_portal
      WHERE transacao = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [x.transacao, estabelecimento],
  );
  if (!atual) throw new ErroPortal('nao-encontrado', 'Pagamento não encontrado.');
  const id = num(atual['id']);
  const reler = async () => {
    const l = await tx.uma(`${apoio.sqlPagamento} AND p.id = ?`, [estabelecimento, id]);
    if (!l) throw new ErroPortal('nao-encontrado', 'Pagamento não encontrado.');
    return apoio.daLinha(l);
  };
  const situacao = String(atual['situacao']);
  const tardia = situacao === 'expirado' && x.resultado === 'aprovado';
  if (situacao !== 'pendente' && !tardia) return { mudou: false, pagamento: await reler() };

  const agora = new Date();
  if (x.resultado !== 'aprovado') {
    await tx.alterar('intencao_pagamento_portal', id, num(atual['versao']), {
      situacao: x.resultado === 'recusado' ? 'recusado' : 'expirado',
      confirmado_por: x.por,
    });
    apoio.marcar('intencao_pagamento_portal', id);
    return { mudou: true, pagamento: await reler() };
  }

  const marcacao = atual['marcacao_horario_id'];
  const outras =
    marcacao === null || marcacao === undefined
      ? []
      : await tx.consultarParaAtualizar(
          `SELECT id, versao, situacao FROM intencao_pagamento_portal
            WHERE marcacao_horario_id = ? AND estabelecimento_id = ? AND id <> ? AND excluido_em IS NULL
              AND situacao IN ('pendente', 'confirmado')
            ORDER BY id`,
          [marcacao, estabelecimento, id],
        );
  const paga = outras.some((k) => String(k['situacao']) === 'confirmado');
  if (!paga && tardia)
    for (const k of outras)
      if (String(k['situacao']) === 'pendente')
        await tx.alterar('intencao_pagamento_portal', num(k['id']), num(k['versao']), { situacao: 'expirado' });

  const recebimento = await baixarNoCaixa(tx, estabelecimento, {
    paciente: num(atual['paciente_id']),
    valor: num(atual['valor']),
    forma: String(atual['forma']),
    comprovante: x.comprovante,
    agora,
  });
  await tx.alterar('intencao_pagamento_portal', id, num(atual['versao']), {
    situacao: paga ? 'duplicado' : 'confirmado',
    recebimento_particular_id: recebimento,
    confirmado_em: agora,
    confirmado_por: x.por,
  });
  apoio.marcar('intencao_pagamento_portal', id);
  return { mudou: true, pagamento: await reler() };
}

/** O recebimento particular no caixa do portal (avulso, pago pelo paciente ou responsável); devolve o id. */
async function baixarNoCaixa(
  tx: TxOperacao,
  estabelecimento: number,
  p: { paciente: number; valor: number; forma: string; comprovante: string; agora: Date },
): Promise<number> {
  const caixa = await tx.uma(
    `SELECT id FROM caixa
      WHERE estabelecimento_id = ? AND codigo = ? AND ativo AND permite_recebimento AND excluido_em IS NULL`,
    [estabelecimento, CAIXA_PORTAL],
  );
  if (!caixa)
    throw catalogoIncompleto(`Cadastre o caixa "${CAIXA_PORTAL}" que recebe os pagamentos do portal do paciente.`);
  const meio = p.forma === 'cartao_credito' ? 'cartao_credito' : 'pix';
  const forma = await tx.uma(
    `SELECT id FROM forma_recebimento
      WHERE meio = ? AND ativo AND uso IN ('recebimento', 'ambos')
      ORDER BY padrao DESC, id LIMIT 1`,
    [meio],
  );
  if (!forma) throw catalogoIncompleto(`Cadastre uma forma de recebimento ativa do meio "${meio}".`);
  const pagador = await tx.uma(
    `SELECT pf.nome FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id WHERE pa.id = ?`,
    [p.paciente],
  );
  await garantirSequencia(
    tx,
    { tipo: 'recebimento_particular', estabelecimento, prefixo: 'RP-' },
    { usuario: tx.contexto.usuario, agora: p.agora },
  );
  const numero = await tx.proximoNumero('recebimento_particular');
  return tx.incluir('recebimento_particular', {
    estabelecimento_id: estabelecimento,
    numero: numero.formatado,
    recebido_em: p.agora,
    finalidade: 'avulso',
    paciente_id: p.paciente,
    pagador_nome: (pagador ? String(pagador['nome']) : 'Pagador do portal do paciente').slice(0, 150),
    caixa_id: num(caixa['id']),
    forma_recebimento_id: num(forma['id']),
    valor: p.valor,
    cartao_autorizacao: meio === 'cartao_credito' ? p.comprovante.slice(0, 40) || null : null,
    cartao_parcelas: meio === 'cartao_credito' ? 1 : null,
    observacao: 'Pagamento pelo portal do paciente',
  });
}
