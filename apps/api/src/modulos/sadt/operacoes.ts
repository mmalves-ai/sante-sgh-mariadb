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
  'sadt.lancarExame': `o lançamento de exame no setor ${CONTRATO}`,
  'sadt.criarOrcamento': `o orçamento do diagnóstico ${CONTRATO}`,
  'sadt.registrarVisualizacaoPortal': `a visualização no portal ${CONTRATO}`,
  'sadt.abrirRequisicao': `a abertura da requisição ${CONTRATO}`,
};

/**
 * Operações que o banco do cliente já grava pelo contrato novo (o exame pedido pelo id), cada uma com a rota que a tela
 * usa: digitar, liberar e retificar o resultado (F3.5, 05-SADT linha 10; aplicacao/resultado-propria.ts).
 */
export const OPERACOES_SADT_NO_CONTRATO_NOVO: Readonly<Record<string, string>> = {
  // O recebimento do pedido do prontuário no setor (05-SADT linha 4; aplicacao/pedido-propria.ts receberNoSetor).
  'sadt.receberSolicitacao': 'POST /api/sadt/exames-pedidos/receber',
  'sadt.registrarResultado': 'POST /api/sadt/exames-pedidos/:exame/resultado',
  'sadt.liberarExame': 'POST /api/sadt/exames-pedidos/:exame/resultado/liberar',
  'sadt.retificarResultado': 'POST /api/sadt/exames-pedidos/:exame/resultado/retificar',
  // O laudo de imagem e de métodos gráficos (05-SADT linha 16) grava pela redação do laudo (aplicacao/laudo-redacao.ts).
  'sadt.registrarLaudo': 'POST /api/sadt/laudos/redacao/:item',
};

/**
 * Operações que gravam direto pela porta (gravarSgh, com a trilha na mesma transação), sem esperar o contrato novo: a
 * emissão do laudo (F3.5, linha 16) grava a emissão com o número do laudo, o código de autenticação, o hash e os exames.
 * As do contrato novo também estão ligadas para a tela (podeGravar), que grava pela rota do contrato novo.
 */
export const OPERACOES_SADT_DIRETAS: ReadonlySet<string> = new Set([
  'sadt.emitirLaudo',
  ...Object.keys(OPERACOES_SADT_NO_CONTRATO_NOVO),
]);
