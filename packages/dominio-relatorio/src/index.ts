// @sgh/dominio-relatorio: fichas técnicas dos indicadores, cálculo com numerador e denominador e os painéis
// gerenciais (M16). Regras puras: sem banco, sem HTTP. O data mart (pseudonimização) fica em
// `@sgh/dominio-relatorio/datamart` (usa node:crypto; não vai ao pacote da tela).
export * from './fichas.js';
export * from './calculo.js';
export * from './paineis.js';
// M34: triagem dos relatórios de SQL livre, réguas da receita, parâmetros e máscara do catálogo e o envio agendado.
export * from './triagem.js';
export * from './reguas-receita.js';
export * from './catalogo.js';
export * from './agendamento.js';
// M57 (etapa 3): consolidação da Rede (mesma ficha; Σ numeradores ÷ Σ denominadores; parcelas impressas).
export * from './indicador/consolidacao.js';
// 01-ADM L115: registro da carga do data mart pela rotina do worker (regra pura, sem node:crypto).
export * from './datamart-registro.js';
