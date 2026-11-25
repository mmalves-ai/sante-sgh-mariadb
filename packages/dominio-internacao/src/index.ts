// @sgh/dominio-internacao: motor da internação (M16) — trajetória, censo pela hora de fechamento, base dos
// indicadores e o painel de leitos. Regras puras: sem banco, sem HTTP.
export * from './tempo.js';
export * from './trajetoria.js';
export * from './motor.js';
export * from './painel.js';
export * from './adt.js';
export * from './nir/index.js';
export * from './portaria/index.js';
export * from './digitalizacao/index.js';
export * from './documentos-internacao.js';
export * from './registros-internacao.js';
// F3.4 (04-INT linha 82): gases medicinais por tempo de uso (uso por paciente e regra de cobrança).
export * from './gas-cobranca.js';
export * from './gas-reparticao-conta.js';
export * from './gas-consumo-setor.js';
// F78.04-1 (04-INT linhas 74, 75 e 78): formulários de declaração de óbito, auditoria do isolamento e regulação.
export * from './controles-assistenciais.js';
export * from './bloqueio-isolamento.js';
// F78.04-2 (04-INT linhas 79 e 80): leitos do sistema público (habilitação, programa, capacidade e teto de diárias
// especiais) e comunicação da internação e da alta à operadora.
export * from './leitos-sus.js';
export * from './comunicacao-operadora.js';
export * from './comunicacao-operadora-disparo.js';
export * from './transporte-paciente.js';
export * from './chamado-ambulancia.js';
export * from './internacao-domiciliar.js';
export * from './area-escala-domiciliar.js';
export * from './destino-corpo.js';
// C2-048 (04-INT linha 70): plano previsto da pré-internação (procedimentos, materiais, equipe) e fila de espera.
export * from './pre-internacao-plano.js';
// F8 (09-AREA linha 87): produção hospitalar mensal (Portaria MS 312/2002) e valor da categoria clínica.
export * from './producao-hospitalar.js';
