// Telas da operadora própria na árvore do menu. O levantamento das tabelas do sistema de origem é do conector
// (conector/mapa/tabelas.tsv), nunca do produto.

/** Tela (item da árvore do menu) de cada área da operadora. */
export const TELAS_OPERADORA = {
  beneficiarios: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.beneficiarios-planos-e-contratos',
  rede: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.rede-credenciada-e-prestadora',
  atendimento: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.atendimento-autorizacao-e-protocolos',
  cobranca: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.cobranca-e-mensalidades',
  ans: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.envios-a-ans-sib-sip-e-exportacoes',
  dominios:
    'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.dominios-da-operadora-e-do-plano-proprio',
  portal: 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.portal-do-prestador-credenciado',
} as const;
export type TelaOperadora = keyof typeof TELAS_OPERADORA;
