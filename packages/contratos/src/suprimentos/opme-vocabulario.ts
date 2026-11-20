// Vocabulário do OPME (ficha do M46, etapa 3; seções 5 a 8; regras 6 a 9): órteses, próteses e materiais especiais
// pedidos para a cirurgia, autorizados pela operadora, consignados ou comprados, consumidos em sala com o rastreio por
// lote ou série, devolvidos quando não usados e conciliados com a conta. Vocabulário do produto (nada aqui fala do
// sistema anterior): o item é o do cadastro de itens do estoque (a classe 50, OPME), o agendamento é o da agenda
// cirúrgica e o código do procedimento de saúde é o TUSS (oito dígitos).

/** A classe dos itens de OPME no cadastro de itens do estoque (TBCLASSI 50). */
export const CLASSE_OPME = 50;

/** As situações da solicitação (a máquina de estados do domínio; SGH_SUP_OPME_SOLIC.SITUACAO). */
export const SITUACOES_OPME = [
  { codigo: 'solicitada', rotulo: 'Solicitada' },
  { codigo: 'cotacao', rotulo: 'Em cotação' },
  { codigo: 'autorizada', rotulo: 'Autorizada pela operadora' },
  { codigo: 'negada', rotulo: 'Negada pela operadora' },
  { codigo: 'pedido', rotulo: 'Pedido de compra feito' },
  { codigo: 'consignada', rotulo: 'Recebida em consignação' },
  { codigo: 'cme', rotulo: 'Pronta na esterilização' },
  { codigo: 'consumida', rotulo: 'Consumida em sala' },
  { codigo: 'devolvida', rotulo: 'Devolvida sem uso' },
  { codigo: 'faturada', rotulo: 'Nota fiscal recebida' },
  { codigo: 'cancelada', rotulo: 'Cancelada' },
] as const;
export type SituacaoOpme = (typeof SITUACOES_OPME)[number]['codigo'];
export const CODIGOS_SITUACAO_OPME = SITUACOES_OPME.map((s) => s.codigo) as [SituacaoOpme, ...SituacaoOpme[]];

/** As etapas registradas (SGH_SUP_OPME_ETAPA.ETAPA). O consumo e a devolução nascem dos documentos do estoque. */
export const ETAPAS_OPME = [
  { codigo: 'solicitacao', rotulo: 'Solicitação', manual: false },
  { codigo: 'cotacao', rotulo: 'Cotação com os fornecedores', manual: true },
  { codigo: 'autorizacao', rotulo: 'Autorização da operadora', manual: true },
  { codigo: 'negativa', rotulo: 'Negativa da operadora', manual: true },
  { codigo: 'pedido', rotulo: 'Pedido de compra', manual: true },
  { codigo: 'consignacao', rotulo: 'Recebimento em consignação', manual: true },
  { codigo: 'cme', rotulo: 'Esterilização (CME)', manual: true },
  { codigo: 'consumo', rotulo: 'Consumo em sala', manual: false },
  { codigo: 'devolucao', rotulo: 'Devolução do não usado', manual: false },
  { codigo: 'nf', rotulo: 'Nota fiscal de reposição ou faturamento', manual: true },
  { codigo: 'cancelamento', rotulo: 'Cancelamento', manual: true },
] as const;
export type EtapaOpme = (typeof ETAPAS_OPME)[number]['codigo'];
export const CODIGOS_ETAPA_OPME = ETAPAS_OPME.map((e) => e.codigo) as [EtapaOpme, ...EtapaOpme[]];
/** As etapas que a tela de suprimentos registra (suprimentos.avancarEtapaOpme). */
export const ETAPAS_OPME_MANUAIS = ETAPAS_OPME.filter((e) => e.manual).map((e) => e.codigo) as [
  EtapaManualOpme,
  ...EtapaManualOpme[],
];
export type EtapaManualOpme = Extract<
  EtapaOpme,
  'cotacao' | 'autorizacao' | 'negativa' | 'pedido' | 'consignacao' | 'cme' | 'nf' | 'cancelamento'
>;

/** As três vias da etiqueta do consumo em sala (regra 6): o prontuário, o paciente e o faturamento. */
export const VIAS_ETIQUETA_OPME = [
  { codigo: 'prontuario', rotulo: 'Prontuário' },
  { codigo: 'paciente', rotulo: 'Paciente' },
  { codigo: 'faturamento', rotulo: 'Faturamento' },
] as const;
export type ViaEtiquetaOpme = (typeof VIAS_ETIQUETA_OPME)[number]['codigo'];

/** A situação de cada consumo na conciliação com a conta (regra 9). */
export const SITUACOES_CONCILIACAO_OPME = [
  { codigo: 'conciliado', rotulo: 'Na conta' },
  { codigo: 'sem-cobranca', rotulo: 'Usado sem cobrança' },
  { codigo: 'cobranca-menor', rotulo: 'Cobrado a menos' },
  { codigo: 'cobranca-maior', rotulo: 'Cobrado a mais' },
  { codigo: 'devolvido', rotulo: 'Devolvido (nada a cobrar)' },
] as const;
export type SituacaoConciliacaoOpme = (typeof SITUACOES_CONCILIACAO_OPME)[number]['codigo'];
