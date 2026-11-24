// Gestão do pedido de compra emitido (F3.6, 05-SUP linha 20): as gravações pelo Executor (trilha, outbox, idempotência
// e trava de versão na mesma transação) e a leitura da tela. As regras puras moram em `regras/pedido-gestao.ts` do
// contrato; aqui ficam só a leitura das referências no banco e a escrita.
// - Entregas programadas: o item ganha a agenda de entregas (dia, limite, quantidade). Reprogramar não apaga: a entrega
//   que já recebeu algo fica como está; a que nada recebeu e sai da agenda recebe a marca de exclusão.
// - Acompanhamento: cada contato com o fornecedor é uma linha nova (quem, quando, previsão, pendência), nunca editada.
// - Cancelamento: do pedido inteiro ou do item (todo o pendente ou parte), com motivo do cadastro e justificativa quando
//   o motivo exige. Marca quantidade, data e motivo; a agenda de entregas abate da mais distante para a mais próxima.
// - O recebimento pela nota abate a agenda da entrega mais antiga para a mais nova (`baixarEntregasRecebidas`).
import {
  type AcompanharPedidoEntrada,
  type CancelarCompraEntrada,
  conferirAcompanhamentoPedido,
  conferirCancelamentoCompra,
  conferirEntregasProgramadas,
  entregaAtrasada,
  type GestaoPedidoCompra,
  type GravarMotivoCancelamentoCompraEntrada,
  type ItemPedidoConferido,
  pendenteItem,
  type ProgramarEntregasPedidoEntrada,
  repartirEntregas,
  type SituacaoAcompanhamentoPedido,
  situacaoAposCancelamento,
} from '@sgh/contratos';
import type { RecusaSuprimentos } from '@sgh/contratos/regras-suprimentos';
import { recusa, type Leitor, type ResultadoOperacao, type TxOperacao } from '@sgh/nucleo';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const q3 = (v: number) => Math.round(v * 1000) / 1000;
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const textoOuNulo = (v: unknown) => (v === null || v === undefined ? null : String(v));
const doisDigitos = (x: number) => String(x).padStart(2, '0');
function dia(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${doisDigitos(v.getMonth() + 1)}-${doisDigitos(v.getDate())}`;
  return String(v).slice(0, 10);
}
const instante = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

export const OPERACAO_PROGRAMAR_ENTREGAS = 'suprimentos.programarEntregasPedido';
export const OPERACAO_ACOMPANHAR_PEDIDO = 'suprimentos.acompanharPedido';
export const OPERACAO_CANCELAR_COMPRA = 'suprimentos.cancelarCompra';
export const OPERACAO_MOTIVO_CANCELAMENTO = 'suprimentos.gravarMotivoCancelamentoCompra';
export const OPERACOES_GESTAO_PEDIDO = [
  OPERACAO_PROGRAMAR_ENTREGAS,
  OPERACAO_ACOMPANHAR_PEDIDO,
  OPERACAO_CANCELAR_COMPRA,
  OPERACAO_MOTIVO_CANCELAMENTO,
] as const;
export const TABELAS_GESTAO_PEDIDO = [
  'pedido_compra_entrega',
  'pedido_compra_acompanhamento',
  'motivo_cancelamento_compra',
] as const;

function recusarTodas(rs: readonly RecusaSuprimentos[]): void {
  const [r] = rs;
  if (r)
    throw recusa(r.codigo, rs.map((x) => x.mensagem).join(' '), {
      campos: [...new Set(rs.flatMap((x) => x.campos ?? []))],
    });
}

async function pedidoTravado(tx: TxOperacao, est: number, p: { ano: number; doc: number }): Promise<Linha> {
  const [r] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, situacao, data_pedido FROM pedido_compra
      WHERE estabelecimento_id = ? AND ano = ? AND numero = ? AND excluido_em IS NULL`,
    [est, p.ano, p.doc],
  );
  if (!r) throw recusa('pedido-inexistente', 'O pedido não existe.', { campos: ['pedido'] });
  return r;
}

const ENTREGAS_DO_ITEM = `SELECT id, versao, sequencia, data_prevista, data_limite, quantidade, quantidade_recebida,
         quantidade_cancelada FROM pedido_compra_entrega WHERE pedido_compra_item_id = ? AND excluido_em IS NULL`;

const aberta = (e: Linha) => ({
  id: n(e['id']),
  dataPrevista: dia(e['data_prevista']) as string,
  quantidade: n(e['quantidade']),
  recebida: n(e['quantidade_recebida']),
  cancelada: n(e['quantidade_cancelada']),
});

/** A agenda de entregas do item (substitui a parte que nada recebeu). */
export async function programarEntregasPedido(
  tx: TxOperacao,
  est: number,
  e: ProgramarEntregasPedidoEntrada,
): Promise<ResultadoOperacao> {
  const p = await pedidoTravado(tx, est, e.pedido);
  const [item] = await tx.consultarParaAtualizar<Linha>(
    'SELECT id, versao, quantidade, quantidade_cancelada FROM pedido_compra_item WHERE id = ? AND pedido_compra_id = ? AND excluido_em IS NULL',
    [e.item, n(p['id'])],
  );
  if (!item) throw recusa('item-inexistente', 'O item não é deste pedido.', { campos: ['item'] });
  const atuais = await tx.consultarParaAtualizar<Linha>(ENTREGAS_DO_ITEM, [e.item]);
  const fixas = atuais.filter((x) => n(x['quantidade_recebida']) > 0);
  recusarTodas(
    conferirEntregasProgramadas({
      situacaoPedido: String(p['situacao']),
      dataPedido: dia(p['data_pedido']) as string,
      quantidadeValida: q3(n(item['quantidade']) - n(item['quantidade_cancelada'])),
      quantidadeFixa: q3(fixas.reduce((s, x) => s + n(x['quantidade']) - n(x['quantidade_cancelada']), 0)),
      entregas: e.entregas,
    }),
  );
  const diasFixos = new Set(fixas.map((x) => dia(x['data_prevista'])));
  const choque = e.entregas.findIndex((x) => diasFixos.has(x.dataPrevista));
  if (choque >= 0)
    throw recusa('entrega-repetida', `O dia da entrega ${choque + 1} já tem entrega com recebimento.`, {
      campos: [`entregas.${choque}.dataPrevista`],
    });
  const agora = new Date();
  const usuario = tx.contexto.usuario ?? null;
  for (const x of atuais)
    if (n(x['quantidade_recebida']) === 0)
      await tx.alterar('pedido_compra_entrega', n(x['id']), n(x['versao']), {
        excluido_em: agora,
        excluido_por: usuario,
      });
  const [ult] = await tx.consultar<Linha>(
    'SELECT MAX(sequencia) AS s FROM pedido_compra_entrega WHERE pedido_compra_item_id = ?',
    [e.item],
  );
  let seq = n(ult?.['s']);
  const ids: number[] = [];
  for (const x of [...e.entregas].sort((a, b) => a.dataPrevista.localeCompare(b.dataPrevista))) {
    seq += 1;
    ids.push(
      await tx.incluir('pedido_compra_entrega', {
        pedido_compra_item_id: e.item,
        sequencia: seq,
        data_prevista: x.dataPrevista,
        data_limite: x.dataLimite,
        quantidade: x.quantidade,
      }),
    );
  }
  // O item passa a prever a primeira entrega em aberto.
  await tx.alterar('pedido_compra_item', e.item, n(item['versao']), {
    data_prevista_entrega: [...e.entregas].map((x) => x.dataPrevista).sort()[0],
  });
  return { id: n(p['id']), item: e.item, entregas: ids };
}

/** Um contato com o fornecedor sobre o pedido (nunca editado: o seguimento é outra linha). */
export async function acompanharPedido(
  tx: TxOperacao,
  est: number,
  e: AcompanharPedidoEntrada,
): Promise<ResultadoOperacao> {
  const p = await pedidoTravado(tx, est, e.pedido);
  recusarTodas(
    conferirAcompanhamentoPedido({
      situacaoPedido: String(p['situacao']),
      dataPedido: dia(p['data_pedido']) as string,
      previsaoEntrega: e.previsaoEntrega,
      andamento: e.andamento,
    }),
  );
  if (
    e.anterior !== null &&
    !(await tx.uma('SELECT id FROM pedido_compra_acompanhamento WHERE id = ? AND pedido_compra_id = ?', [
      e.anterior,
      n(p['id']),
    ]))
  )
    throw recusa('acompanhamento-inexistente', 'O contato anterior não é deste pedido.', {
      campos: ['anterior'],
    });
  const agora = new Date();
  const id = await tx.incluir('pedido_compra_acompanhamento', {
    pedido_compra_id: n(p['id']),
    operacao: 'inclusao',
    ocorrido_em: agora,
    usuario_id: tx.contexto.usuario ?? null,
    acompanhamento_anterior_id: e.anterior,
    contatado_em: agora,
    contato_nome: e.contatoNome,
    contato_telefone: e.contatoTelefone,
    contato_email: e.contatoEmail,
    previsao_entrega: e.previsaoEntrega,
    situacao_acompanhamento: e.situacao,
    andamento: e.andamento,
  });
  return { id: n(p['id']), acompanhamento: id };
}

/** Cancela o pedido inteiro ou o item, com motivo; nada é apagado. */
export async function cancelarCompra(
  tx: TxOperacao,
  est: number,
  e: CancelarCompraEntrada,
): Promise<ResultadoOperacao> {
  const p = await pedidoTravado(tx, est, e.pedido);
  const motivo = await tx.uma<Linha>(
    'SELECT id, ativo, aplica_pedido, aplica_item, exige_justificativa FROM motivo_cancelamento_compra WHERE id = ?',
    [e.motivo],
  );
  const linhas = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, quantidade, quantidade_recebida, quantidade_cancelada FROM pedido_compra_item
      WHERE pedido_compra_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [n(p['id'])],
  );
  const itens: ItemPedidoConferido[] = linhas.map((r) => ({
    id: n(r['id']),
    quantidade: n(r['quantidade']),
    recebida: n(r['quantidade_recebida']),
    cancelada: n(r['quantidade_cancelada']),
  }));
  const c = conferirCancelamentoCompra({
    situacaoPedido: String(p['situacao']),
    item: e.item,
    quantidade: e.quantidade,
    motivo: motivo
      ? {
          ativo: verdadeiro(motivo['ativo']),
          aplicaPedido: verdadeiro(motivo['aplica_pedido']),
          aplicaItem: verdadeiro(motivo['aplica_item']),
          exigeJustificativa: verdadeiro(motivo['exige_justificativa']),
        }
      : null,
    justificativa: e.justificativa,
    itens,
  });
  recusarTodas(c.recusas);
  const agora = new Date();
  const depois = itens.map((i) => ({ ...i }));
  for (const x of c.cancelar) {
    const r = linhas.find((l) => n(l['id']) === x.item) as Linha;
    const i = depois.find((d) => d.id === x.item) as { cancelada: number };
    i.cancelada = q3(i.cancelada + x.quantidade);
    const tudo = pendenteItem({ ...(i as ItemPedidoConferido) }) === 0;
    await tx.alterar('pedido_compra_item', x.item, n(r['versao']), {
      quantidade_cancelada: i.cancelada,
      ...(tudo ? { cancelado_em: agora, motivo_cancelamento_compra_id: e.motivo } : {}),
    });
    const ents = (await tx.consultarParaAtualizar<Linha>(ENTREGAS_DO_ITEM, [x.item])).map((l) => ({
      ...aberta(l),
      versao: n(l['versao']),
    }));
    for (const b of repartirEntregas(ents, x.quantidade, 'cancelamento')) {
      const en = ents.find((y) => y.id === b.id)!;
      const cancelada = q3(en.cancelada + b.quantidade);
      await tx.alterar('pedido_compra_entrega', b.id, en.versao, {
        quantidade_cancelada: cancelada,
        ...(q3(en.quantidade - en.recebida - cancelada) === 0
          ? { cancelado_em: agora, motivo_cancelamento_compra_id: e.motivo }
          : {}),
      });
    }
  }
  const situacao = situacaoAposCancelamento(String(p['situacao']), depois);
  const inteiro = e.item === null || situacao !== String(p['situacao']);
  await tx.alterar('pedido_compra', n(p['id']), n(p['versao']), {
    situacao,
    ...(inteiro
      ? {
          cancelado_em: agora,
          motivo_cancelamento_compra_id: e.motivo,
          justificativa_cancelamento: e.justificativa,
        }
      : {}),
  });
  return { id: n(p['id']), situacao, itens: c.cancelar.map((x) => x.item) };
}

/** O cadastro do motivo de cancelamento (inclui sem `motivo`; altera com `motivo` e `versao`). Nunca apagado. */
export async function gravarMotivoCancelamentoCompra(
  tx: TxOperacao,
  _est: number,
  e: GravarMotivoCancelamentoCompraEntrada,
): Promise<ResultadoOperacao> {
  const outro = await tx.uma<Linha>(
    'SELECT id FROM motivo_cancelamento_compra WHERE codigo = ? AND id <> ?',
    [e.codigo, e.motivo ?? 0],
  );
  if (outro)
    throw recusa('motivo-codigo-duplicado', `O código ${e.codigo} já é de outro motivo.`, {
      campos: ['codigo'],
    });
  const valores = {
    codigo: e.codigo,
    descricao: e.descricao,
    aplica_pedido: e.aplicaPedido,
    aplica_item: e.aplicaItem,
    exige_justificativa: e.exigeJustificativa,
    ativo: e.ativo,
  };
  if (e.motivo === undefined) return { id: await tx.incluir('motivo_cancelamento_compra', valores) };
  if (!(await tx.uma('SELECT id FROM motivo_cancelamento_compra WHERE id = ?', [e.motivo])))
    throw recusa('motivo-inexistente', 'O motivo não existe.', { campos: ['motivo'] });
  await tx.alterar('motivo_cancelamento_compra', e.motivo, e.versao ?? 0, valores);
  return { id: e.motivo };
}

/** Chamado pelo recebimento da nota: abate a agenda do item da entrega mais antiga para a mais nova. */
export async function baixarEntregasRecebidas(
  tx: TxOperacao,
  item: number,
  quantidade: number,
): Promise<void> {
  const ents = (await tx.consultarParaAtualizar<Linha>(ENTREGAS_DO_ITEM, [item])).map((l) => ({
    ...aberta(l),
    versao: n(l['versao']),
  }));
  for (const b of repartirEntregas(ents, quantidade, 'recebimento')) {
    const en = ents.find((y) => y.id === b.id)!;
    await tx.alterar('pedido_compra_entrega', b.id, en.versao, {
      quantidade_recebida: q3(en.recebida + b.quantidade),
    });
  }
}

/** A leitura da tela de gestão do pedido: itens com a agenda, os contatos e os motivos. */
export async function lerGestaoPedido(
  l: Leitor,
  est: number,
  ano: number,
  doc: number,
  hoje: string,
): Promise<GestaoPedidoCompra | null> {
  const p = await l.uma<Linha>(
    `SELECT p.id, p.ano, p.numero, p.situacao, p.data_pedido, p.cancelado_em, p.justificativa_cancelamento,
            m.descricao AS motivo, COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor
       FROM pedido_compra p
       LEFT JOIN motivo_cancelamento_compra m ON m.id = p.motivo_cancelamento_compra_id
       LEFT JOIN empresa_fornecedora f ON f.id = p.empresa_fornecedora_id
      WHERE p.estabelecimento_id = ? AND p.ano = ? AND p.numero = ? AND p.excluido_em IS NULL`,
    [est, ano, doc],
  );
  if (!p) return null;
  const id = n(p['id']);
  const itens = await l.consultar<Linha>(
    `SELECT x.id, x.sequencia, x.insumo_id, COALESCE(i.nome, x.descricao_servico) AS nome, x.quantidade,
            x.quantidade_recebida, x.quantidade_cancelada, x.cancelado_em, m.descricao AS motivo
       FROM pedido_compra_item x
       LEFT JOIN insumo i ON i.id = x.insumo_id
       LEFT JOIN motivo_cancelamento_compra m ON m.id = x.motivo_cancelamento_compra_id
      WHERE x.pedido_compra_id = ? AND x.excluido_em IS NULL ORDER BY x.sequencia`,
    [id],
  );
  const entregas = await l.consultar<Linha>(
    `SELECT e.id, e.pedido_compra_item_id, e.sequencia, e.data_prevista, e.data_limite, e.quantidade,
            e.quantidade_recebida, e.quantidade_cancelada
       FROM pedido_compra_entrega e JOIN pedido_compra_item x ON x.id = e.pedido_compra_item_id
      WHERE x.pedido_compra_id = ? AND e.excluido_em IS NULL ORDER BY e.data_prevista, e.sequencia`,
    [id],
  );
  const contatos = await l.consultar<Linha>(
    `SELECT a.id, a.ocorrido_em, u.login, a.contato_nome, a.contato_telefone, a.contato_email, a.previsao_entrega,
            a.situacao_acompanhamento, a.andamento, a.acompanhamento_anterior_id
       FROM pedido_compra_acompanhamento a LEFT JOIN usuario u ON u.id = a.usuario_id
      WHERE a.pedido_compra_id = ? ORDER BY a.ocorrido_em DESC, a.id DESC`,
    [id],
  );
  const motivos = await l.consultar<Linha>(
    `SELECT id, versao, codigo, descricao, aplica_pedido, aplica_item, exige_justificativa, ativo
       FROM motivo_cancelamento_compra ORDER BY ativo DESC, descricao`,
    [],
  );
  return {
    pedido: {
      id,
      ano: n(p['ano']),
      doc: n(p['numero']),
      situacao: String(p['situacao']),
      dataPedido: dia(p['data_pedido']) as string,
      fornecedor: textoOuNulo(p['fornecedor']),
      canceladoEm: instante(p['cancelado_em']),
      motivoCancelamento: textoOuNulo(p['motivo']),
      justificativaCancelamento: textoOuNulo(p['justificativa_cancelamento']),
    },
    hoje,
    itens: itens.map((x) => {
      const i = {
        id: n(x['id']),
        quantidade: n(x['quantidade']),
        recebida: n(x['quantidade_recebida']),
        cancelada: n(x['quantidade_cancelada']),
      };
      return {
        ...i,
        sequencia: n(x['sequencia']),
        insumo: x['insumo_id'] === null ? null : n(x['insumo_id']),
        nome: String(x['nome'] ?? ''),
        pendente: pendenteItem(i),
        canceladoEm: instante(x['cancelado_em']),
        motivoCancelamento: textoOuNulo(x['motivo']),
        entregas: entregas
          .filter((e) => n(e['pedido_compra_item_id']) === i.id)
          .map((e) => {
            const a = { ...aberta(e), dataLimite: dia(e['data_limite']) };
            return { ...a, sequencia: n(e['sequencia']), atrasada: entregaAtrasada(a, hoje) };
          }),
      };
    }),
    acompanhamentos: contatos.map((a) => ({
      id: n(a['id']),
      ocorridoEm: instante(a['ocorrido_em']) as string,
      usuario: textoOuNulo(a['login']),
      contatoNome: textoOuNulo(a['contato_nome']),
      contatoTelefone: textoOuNulo(a['contato_telefone']),
      contatoEmail: textoOuNulo(a['contato_email']),
      previsaoEntrega: dia(a['previsao_entrega']),
      situacao: (a['situacao_acompanhamento'] ?? null) as SituacaoAcompanhamentoPedido | null,
      andamento: String(a['andamento'] ?? ''),
      anterior: a['acompanhamento_anterior_id'] === null ? null : n(a['acompanhamento_anterior_id']),
    })),
    motivos: motivos.map((m) => ({
      id: n(m['id']),
      versao: n(m['versao']),
      codigo: String(m['codigo']),
      descricao: String(m['descricao']),
      aplicaPedido: verdadeiro(m['aplica_pedido']),
      aplicaItem: verdadeiro(m['aplica_item']),
      exigeJustificativa: verdadeiro(m['exige_justificativa']),
      ativo: verdadeiro(m['ativo']),
    })),
  };
}
