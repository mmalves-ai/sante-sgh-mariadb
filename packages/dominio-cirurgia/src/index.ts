// @sgh/dominio-cirurgia (M18): regras puras do centro cirúrgico, sem banco. Usadas pela API (mapa, recusa de
// sobreposição antes de gravar, ligação com a cirurgia realizada), pela tela e pela porta em memória da sessão
// sintética; as gravações da API reconferem no banco, sob a trava da sala, o que vale.
export * from './tempo.js';
export * from './sobreposicao.js';
export * from './equipe.js';
export * from './participacao.js';
export * from './membros-equipe.js';
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
// F3.6 (05-SUP linha 13): kit padrão sugerido no agendamento cirúrgico (lista de materiais previstos).
export * from './kit-agendamento.js';
export * from './reserva-cirurgia.js';
// F3.4 (04-CC linha 91): cadastro do procedimento cirúrgico (grupo, porte, especialidade, natureza, caráter).
export * from './procedimento-cirurgico.js';
// F7 (04-CC linha 102): autorização prévia da cirurgia eletiva por etapas e a trava da confirmação sem senha.
export * from './autorizacao-convenio.js';
// F8 (04-CC linha 104): documentos obrigatórios antes da cirurgia, com bloqueio do início.
export * from './documentos-pre-operatorio.js';
export * from './profilaxia-cirurgica.js';
// F8 (04-CC linha 108): projetos e mutirões cirúrgicos do SUS (portaria, metas SIGTAP, AIH e APAC marcadas).
export * from './mutirao.js';
// F7 (05-SUP linha 29): central de material esterilizado (caixas, ciclo com indicadores, etiqueta, rastreio).
export * from './cme/cme.js';
// F7 (04-CME linha 115): cadastro da CME (produto reprocessável, caixa e kit com composição, fases e foto).
export * from './cme/cadastro.js';
// F7, 04-CME L116: testes dos indicadores do ciclo e rejeição no reprocessamento.
export * from './cme/ciclo-testes.js';
// F7, 04-CME L117: solicitação, entrega ao setor, recolhimento e permissões da CME por setor.
export * from './cme/fluxo-material.js';
