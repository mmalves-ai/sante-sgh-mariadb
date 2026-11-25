// Classificação de risco externa (F3.9, 08-INTG L140): o conteúdo do envio ativo dos perfis de prioridade ao sistema
// de triagem. A mensagem MFN^M13 é montada pela API no momento do pedido (o pacote de perfis daquele instante, pelo
// perfil de mensagem HL7 do sistema) e gravada na fila de saída; o worker entrega exatamente o que foi gravado.
import { EVENTO_ENVIO_PERFIS_TRIAGEM } from '@sgh/dominio-integracao';
import type { Leitor } from '@sgh/nucleo';

/** A mensagem gravada do envio (null: o envio não é de perfis deste estabelecimento ou está sem conteúdo). */
export async function conteudoPerfisTriagem(
  l: Leitor,
  hospital: string,
  envio: string,
): Promise<string | null> {
  if (!/^\d{1,15}$/.test(envio)) return null;
  const x = await l.uma(
    `SELECT s.conteudo FROM mensagem_integracao_saida s JOIN estabelecimento e ON e.id = s.estabelecimento_id
      WHERE s.id = ? AND e.codigo = ? AND s.tipo_mensagem = ? AND s.formato = 'hl7v2' AND s.excluido_em IS NULL`,
    [Number(envio), hospital, EVENTO_ENVIO_PERFIS_TRIAGEM],
  );
  const c = x?.['conteudo'];
  return typeof c === 'string' && c.startsWith('MSH|') ? c : null;
}
