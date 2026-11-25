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
// F3.4 (04-CC linha 91): texto padrão da descrição cirúrgica por procedimento e cirurgião.
export * from './texto-padrao.js';
// F3.4 (04-CC linha 96): descrição cirúrgica assinada (adendo) e intercorrências do ato.
export * from './descricao/index.js';
// F3.4 (04-CC linha 100): gasto de sala do ato (sugestão pela lista padrão, conferência e situação até o débito).
export * from './gasto-sala/index.js';
// F3.4 (04-CC linha 92): grade de funcionamento da sala (faixas por dia, vigência, feriado e reserva).
export * from './grade-sala.js';
// F8 (04-CC linha 105): cartão de preferência do cirurgião (sugestão para o mapa e o gasto de sala).
export * from './cartao-preferencia.js';
