// @sgh/dominio-qualidade (M48): regras puras da qualidade e segurança do paciente, sem banco nem Nest. Usadas pela API
// (serviço da notificação, fila de prazos, campos do Notivisa) e pela tela (proposta de classificação no diálogo).
// Pastas da ficha (seção 10): nsp (etapas 1 e 2), ccih (etapa 3), vigilancia (etapa 4) e gestao (etapa 5).
export * from './nsp/index.js';
// Etapa 3 do M48: CCIH (dispositivos e denominadores, IRAS, antimicrobianos, precauções, mãos e surtos).
export * from './ccih/index.js';
// Etapa 4 do M48: notificação compulsória (gatilhos, prazo, ficha SINAN pré-preenchida e o ciclo do caso).
export * from './vigilancia/index.js';
// Etapa 5 do M48: gestão da qualidade (documentos, indicadores, auditorias, comissões, riscos, não conformidades,
// ouvidoria) e envios regulatórios.
export * from './gestao/index.js';
