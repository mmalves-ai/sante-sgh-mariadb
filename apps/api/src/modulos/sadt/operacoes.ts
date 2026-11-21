// Operações de gravação do SADT pelo executor (M26): a entrada de cada uma (o Zod do contrato das telas) e a situação
// no banco do cliente. A porta em memória valida pela mesma entrada; a porta própria grava pelo Executor do núcleo.
// Pendência (pedido do lote 02-09): as entradas do contrato ainda levam a chave de 7 colunas do exame, o carimbo de
// data como versão, os retratos do atendimento e o prestador/local do sistema de origem. No banco do cliente o exame é
// o exame_item (id + versão inteira) e o prestador é o setor executante: até o contrato novo (exame lido = { id,
// versao: número }, setor executante no lugar de prestador/local, sem retratos), as operações abaixo ficam desligadas
// no banco com o motivo exposto à tela (podeGravar), nunca em silêncio.
import {
  esquemaAbrirRequisicao,
  esquemaCriarOrcamento,
  esquemaEmitirLaudo,
  esquemaLancarExame,
  esquemaLiberarExame,
  esquemaReceberSolicitacao,
  esquemaRegistrarResultado,
  esquemaRegistrarVisualizacaoPortal,
  esquemaRetificarResultado,
} from '@sgh/contratos';
import type { ZodType } from 'zod';

/** A entrada (Zod do contrato) de cada operação do SADT. */
export const ENTRADAS_SADT: Readonly<Record<string, ZodType<unknown>>> = {
  'sadt.receberSolicitacao': esquemaReceberSolicitacao,
  'sadt.lancarExame': esquemaLancarExame,
  'sadt.registrarResultado': esquemaRegistrarResultado,
  'sadt.registrarLaudo': esquemaRegistrarResultado,
  'sadt.liberarExame': esquemaLiberarExame,
  'sadt.retificarResultado': esquemaRetificarResultado,
  'sadt.emitirLaudo': esquemaEmitirLaudo,
  'sadt.criarOrcamento': esquemaCriarOrcamento,
  'sadt.registrarVisualizacaoPortal': esquemaRegistrarVisualizacaoPortal,
  'sadt.abrirRequisicao': esquemaAbrirRequisicao,
};

const CONTRATO =
  'aguarda o contrato novo da tela (exame pelo id e versão do banco, setor executante no lugar de prestador e local)';

/**
 * Operações que o banco do cliente ainda não grava, com o motivo mostrado na tela (a tela fica em consulta). Cada uma
 * está no pedido do lote 02-09 (contrato e operação no banco).
 */
export const OPERACOES_SADT_PENDENTES: Readonly<Record<string, string>> = {
  'sadt.receberSolicitacao': `o recebimento do pedido no setor ${CONTRATO}`,
  'sadt.lancarExame': `o lançamento de exame no setor ${CONTRATO}`,
  'sadt.registrarResultado': `a digitação do resultado ${CONTRATO}`,
  'sadt.registrarLaudo': `o registro do laudo ${CONTRATO}`,
  'sadt.liberarExame': `a liberação do exame ${CONTRATO}`,
  'sadt.retificarResultado': `a retificação do resultado ${CONTRATO}`,
  'sadt.emitirLaudo': `a emissão do laudo ${CONTRATO}`,
  'sadt.criarOrcamento': `o orçamento do diagnóstico ${CONTRATO}`,
  'sadt.registrarVisualizacaoPortal': `a visualização no portal ${CONTRATO}`,
  'sadt.abrirRequisicao': `a abertura da requisição ${CONTRATO}`,
};
