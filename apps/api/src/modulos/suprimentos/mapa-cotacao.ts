// Cotação por portal externo (05-SUP linha 19, C3-008): a importação das respostas do mapa devolvido pelo primeiro
// adaptador da porta genérica (troca por arquivo) e a leitura dos portais do pedido. A regra de leitura do arquivo mora
// em `regras/cotacao-arquivo.ts` do contrato; aqui ficam só a leitura das referências no banco e a escrita, pelo
// Executor (trilha, outbox, idempotência e trava de versão na mesma transação).
// - Cada resposta grava o preço e a marca pela mesma operação da proposta digitada no mapa (registrarProposta, que a
//   porta passa), e o fornecedor que respondeu fica 'respondida'. Qualquer linha recusada barra o arquivo inteiro.
// - O pedido fica ligado ao portal (vinculo_pedido_compra_portal, 'cotado'); reimportar atualiza a mesma ligação.
import { type ImportarRespostasCotacaoEntrada, OPERACAO_IMPORTAR_RESPOSTAS_COTACAO } from '@sgh/contratos';
import {
  ADAPTADOR_ARQUIVO_COTACAO,
  type PropostaDoMapa,
  recusaDaLeitura,
} from '@sgh/contratos/regras-suprimentos';
import { recusa, type Leitor, type TxOperacao } from '@sgh/nucleo';

type Linha = Record<string, unknown>;
type Ids = Record<string, number | string>;
const n = (v: unknown) => Number(v ?? 0);
const instante = (v: unknown): string =>
  v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);

export { OPERACAO_IMPORTAR_RESPOSTAS_COTACAO };
export const TABELAS_MAPA_COTACAO = ['portal_cotacao', 'vinculo_pedido_compra_portal'] as const;

const ROTULO_SITUACAO: Readonly<Record<string, string>> = {
  enviado: 'enviado',
  em_cotacao: 'em cotação',
  cotado: 'cotado',
  encerrado: 'encerrado',
  cancelado: 'cancelado',
};

/** O que a importação usa da porta do estoque (sem importar a porta: evita o ciclo). */
export interface ApoioImportacaoCotacao {
  pedidoTravado(tx: TxOperacao, est: number, ano: number, doc: number): Promise<Linha>;
  propostasDoPedido(tx: TxOperacao, pedido: Linha): Promise<readonly PropostaDoMapa[]>;
  registrarProposta(
    tx: TxOperacao,
    est: number,
    e: { pedido: { ano: number; doc: number }; proposta: number; valorUnitario: number; marca?: string },
  ): Promise<Ids>;
}

/** A importação das respostas do arquivo devolvido (o manipulador da operação). */
export function importarRespostasCotacao(apoio: ApoioImportacaoCotacao) {
  return async (tx: TxOperacao, est: number, e: ImportarRespostasCotacaoEntrada): Promise<Ids> => {
    const pedido = await apoio.pedidoTravado(tx, est, e.pedido.ano, e.pedido.doc);
    if (!['rascunho', 'em_cotacao'].includes(String(pedido['situacao'])))
      throw recusa('pedido-fechado', 'O pedido não está mais em cotação.', { campos: ['pedido'] });
    const propostas = await apoio.propostasDoPedido(tx, pedido);
    const leitura = ADAPTADOR_ARQUIVO_COTACAO.lerRespostas(e.conteudo, propostas);
    const r = recusaDaLeitura(leitura);
    if (r) throw recusa(r.codigo, r.mensagem, { campos: r.campos ?? ['arquivo'] });
    for (const x of leitura.respostas)
      await apoio.registrarProposta(tx, est, {
        pedido: e.pedido,
        proposta: x.proposta,
        valorUnitario: x.valorUnitario,
        ...(x.marca !== undefined ? { marca: x.marca } : {}),
      });
    const portal = await tx.uma<Linha>(
      "SELECT id FROM portal_cotacao WHERE codigo = ? AND ativo AND tipo_integracao = 'arquivo'",
      [ADAPTADOR_ARQUIVO_COTACAO.codigo],
    );
    if (!portal)
      throw recusa('portal-inexistente', 'A troca por arquivo não está ativa no cadastro de portais.', {
        campos: ['arquivo'],
      });
    const pedidoId = n(pedido['id']);
    const codigo = `${e.pedido.ano}-${e.pedido.doc}`;
    const [v] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao FROM vinculo_pedido_compra_portal WHERE pedido_compra_id = ? AND portal_cotacao_id = ? AND excluido_em IS NULL',
      [pedidoId, n(portal['id'])],
    );
    const agora = new Date();
    const vinculo = v
      ? (await tx.alterar('vinculo_pedido_compra_portal', n(v['id']), n(v['versao']), {
          situacao: 'cotado',
          encerrado_em: agora,
        }),
        n(v['id']))
      : await tx.incluir('vinculo_pedido_compra_portal', {
          pedido_compra_id: pedidoId,
          portal_cotacao_id: n(portal['id']),
          codigo_cotacao_portal: codigo,
          situacao: 'cotado',
          enviado_em: agora,
          encerrado_em: agora,
        });
    return {
      id: vinculo,
      respostas: leitura.respostas.length,
      semPreco: leitura.semPreco,
    };
  };
}

/** Os portais do pedido para o mapa: o portal, a situação e quando a troca foi feita. */
export async function portaisDoPedido(
  l: Leitor,
  pedidoId: number,
): Promise<{ portal: string; enviadoEm: string }[]> {
  const linhas = await l.consultar<Linha>(
    `SELECT pc.descricao, v.situacao, COALESCE(v.alterado_em, v.enviado_em, v.criado_em) AS em
       FROM vinculo_pedido_compra_portal v JOIN portal_cotacao pc ON pc.id = v.portal_cotacao_id
      WHERE v.pedido_compra_id = ? AND v.excluido_em IS NULL ORDER BY v.id`,
    [pedidoId],
  );
  return linhas.map((x) => ({
    portal: `${String(x['descricao'])} (${ROTULO_SITUACAO[String(x['situacao'])] ?? String(x['situacao'])})`,
    enviadoEm: instante(x['em']),
  }));
}
