// Vocabulário do estoque, do almoxarifado e das compras (M28; ficha, seções 5, 7 e 8). Os códigos são os que o
// estoque do hospital grava (Anexo A; ref 02 §2.5) e só os valores vistos no perfil; os de baixa confiança levam a
// legenda "a confirmar" na tela.

/** Destino da saída: 1 paciente internado, 2 centro de custo (setor), 3 paciente externo, 5 terceiro. */
export const DESTINOS_SAIDA = [
  { codigo: 1, rotulo: 'Paciente internado' },
  { codigo: 2, rotulo: 'Setor (centro de custo)' },
  { codigo: 3, rotulo: 'Paciente externo' },
  { codigo: 5, rotulo: 'Terceiro' },
] as const;
export const CODIGOS_DESTINO_SAIDA = [1, 2, 3, 5] as const;
export type DestinoSaida = (typeof CODIGOS_DESTINO_SAIDA)[number];

/** Origem da saída feita nesta tela: E manual; B baixa para o setor (a confirmar). P é da dispensação (M29). */
export const ORIGENS_SAIDA = [
  { codigo: 'E', rotulo: 'Saída manual' },
  { codigo: 'B', rotulo: 'Baixa para o setor (a confirmar)' },
] as const;
export const CODIGOS_ORIGEM_SAIDA = ['E', 'B'] as const;
export type OrigemSaida = (typeof CODIGOS_ORIGEM_SAIDA)[number];

/** Destino da devolução (o mesmo da saída que volta): 1 internado, 2 setor, 3 externo. */
export const CODIGOS_DESTINO_DEVOLUCAO = [1, 2, 3] as const;

/** Tipos de documento de estoque (a numeração por ano, mês e tipo é do banco). */
export const TIPOS_DOCUMENTO_ESTOQUE = [
  { codigo: 'saida', rotulo: 'Saída' },
  { codigo: 'devolucao', rotulo: 'Devolução' },
  { codigo: 'transferencia', rotulo: 'Transferência' },
  { codigo: 'nota', rotulo: 'Entrada por nota fiscal' },
  { codigo: 'balanco', rotulo: 'Balanço' },
  { codigo: 'requisicao', rotulo: 'Requisição' },
] as const;
export const CODIGOS_TIPO_DOCUMENTO = [
  'saida',
  'devolucao',
  'transferencia',
  'nota',
  'balanco',
  'requisicao',
] as const;
export type TipoDocumentoEstoque = (typeof CODIGOS_TIPO_DOCUMENTO)[number];

/** Situações do pedido de compra (cadastro de situações, só leitura): as gravadas pelo novo são 1 e 2. */
export const SITUACOES_PEDIDO_COMPRA = [
  { id: 1, rotulo: 'Aberto' },
  { id: 2, rotulo: 'Em andamento' },
  { id: 3, rotulo: 'Aguardando cotação' },
  { id: 4, rotulo: 'Autorizado parcialmente' },
  { id: 5, rotulo: 'Autorizado' },
  { id: 6, rotulo: 'Comprado parcialmente' },
  { id: 7, rotulo: 'Comprado' },
  { id: 8, rotulo: 'Entregue parcialmente' },
  { id: 9, rotulo: 'Finalizado' },
  { id: 10, rotulo: 'Cancelado' },
] as const;

/** Tipo de compra do pedido (domínio visto: P 85%, E 15%, N <1%). */
export const TIPOS_COMPRA = [
  { codigo: 'P', rotulo: 'Compra programada' },
  { codigo: 'E', rotulo: 'Compra emergencial' },
  { codigo: 'N', rotulo: 'Outra (a confirmar)' },
] as const;
export const CODIGOS_TIPO_COMPRA = ['P', 'E', 'N'] as const;

/** Estado do item do pedido pela nota (gatilho): P pendente, I incompleto, C completo. */
export const ESTADOS_ITEM_PEDIDO: Readonly<Record<string, string>> = {
  O: 'Em cotação',
  P: 'Pendente',
  I: 'Entregue em parte',
  C: 'Entregue',
  N: 'Não comprado',
  E: 'Excluído da compra',
};

/** Tipos de movimento por local do usuário do estoque (o cadastro de usuários do estoque). */
export const TIPOS_MOVIMENTO_LOCAL = [
  { codigo: 'S', rotulo: 'Saída' },
  { codigo: 'E', rotulo: 'Entrada' },
  { codigo: 'D', rotulo: 'Devolução' },
  { codigo: 'TO', rotulo: 'Transferência (origem)' },
  { codigo: 'TD', rotulo: 'Transferência (destino)' },
  { codigo: 'I', rotulo: 'Inventário' },
  { codigo: 'R', rotulo: 'Requisição' },
  { codigo: 'V', rotulo: 'Venda externa' },
] as const;
export const CODIGOS_TIPO_MOVIMENTO = ['S', 'E', 'D', 'TO', 'TD', 'I', 'R', 'V'] as const;

/** Etapas da transferência em dois passos (só no novo: o documento do estoque só existe no recebimento). */
export const ETAPAS_TRANSFERENCIA = ['enviada', 'recebida', 'divergente', 'cancelada'] as const;
export type EtapaTransferencia = (typeof ETAPAS_TRANSFERENCIA)[number];

/** Ocorrências registradas no novo sobre um documento (motivo, autor e data). */
export const TIPOS_OCORRENCIA = [
  'estorno',
  'desconsolidacao',
  'divergencia-recebimento',
  'reabertura-mes',
  'fechamento-mes',
  'correcao-validade',
] as const;
export type TipoOcorrencia = (typeof TIPOS_OCORRENCIA)[number];

/** Centros de custo técnicos (9901 a 9999): não geram consumo. */
export const CENTRO_TECNICO = { de: 9901, ate: 9999 } as const;
