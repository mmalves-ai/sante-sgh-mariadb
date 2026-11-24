// @sgh/dominio-cirurgia (M18): regras puras do centro cirúrgico, sem banco. Usadas pela API (mapa, recusa de
// sobreposição antes de gravar, ligação com a cirurgia realizada), pela tela e pela porta em memória da sessão
// sintética; as gravações da API reconferem no banco, sob a trava da sala, o que vale.
export * from './tempo.js';
export * from './sobreposicao.js';
export * from './equipe.js';
export * from './participacao.js';
export * from './estados.js';
export * from './agenda-modelo.js';
export * from './ligacao.js';
export * from './registro.js';
export * from './mapa.js';
export * from './pedido-portal.js';
// M46 (etapa 1): avaliação pré-anestésica, ficha anestésica e recuperação pós-anestésica.
export * from './apa/index.js';
export * from './ficha/index.js';
export * from './srpa/index.js';
// M46 (etapa 2): checklist de cirurgia segura, trava da incisão, rastreio no bloco e código do painel para familiares.
export * from './checklist/index.js';
export * from './rastreio/index.js';
