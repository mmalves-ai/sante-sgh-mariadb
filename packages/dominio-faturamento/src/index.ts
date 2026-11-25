// Regras puras do faturamento. M09: estrutura da mensagem TISS 04.03.00, guias de prova, hash do epílogo e
// validação no XSD oficial (cap-12 §12.2; DP-37, DP-47.7). O gerador a partir da conta é do M31.
// M30: as regras da conta do paciente (situação, grupo do item, fechamento e reabertura, explicador de preço, vigência,
// pacote, réguas de data, particular, escopo por convênio e faturabilidade), que moram em
// `@sgh/contratos/regras-faturamento` (o adaptador do legado também as confere); aqui ficam os testes e a cobertura.
export * from './tiss/md5.js';
export * from './tiss/xml.js';
export * from './tiss/lote.js';
export * from './tiss/validacao.js';
export * from '@sgh/contratos/regras-faturamento';
export * from './tiss/montagem.js';
export * from './tiss/montador.js';
export * from './tiss/demonstrativo.js';
// M56.6: o lado da operadora própria (o lote recebido e o demonstrativo de análise da conta).
export * from './tiss/operadora.js';
// M51: faturamento SUS próprio (competência SUS, crítica prévia, CIHA; BPA, APAC e AIH nas etapas 2 a 4).
export * from './sus/index.js';
// F3.0: a conta aberta na entrada do paciente e o lançamento automático de diárias e taxas (apuração idempotente).
export * from './conta/admissao.js';
export * from './conta/diferenca-acomodacao.js';
// F3.7: a reabertura da competência do convênio (motivo e confirmação do impacto da conta já apresentada).
export * from './competencia/reabertura.js';
// F3.7 (06-FAT linhas 10 e 12): período da conta parcial, segurado na conta e campo adicional da operadora na guia.
export * from './conta/complementos.js';
// F3.7 (06-FAT linha 36): a nota fiscal de serviço que documenta a fatura do convênio ou a conta do particular.
export * from './conta/nota-vinculo.js';
export * from './conta/regras-comerciais.js';
export * from './conta/tarifador.js';
// F3.7 (06-FAT linha 37): o evento contábil da receita faturada, glosada e recuperada pela regra de conta contábil.
export * from './conta/receita-contabil.js';
// F3.7 (06-FAT linhas 14, 15 e 16): equipe do item, kit de cobrança e transferência de itens entre contas.
export * from './conta/movimentos.js';
// F3.7 (06-FAT linhas 17, 18 e 20): horário especial, ajuste da conta com alçada e pacote na conta.
export * from './conta/ajustes.js';
// F3.1 (02-CAD linha 25): configuração TISS por fonte pagadora e faixa de numeração de guias.
export * from './tiss/configuracao.js';
export * from './tiss/elegibilidade.js';
export * from './tiss/autorizacao-previa.js';
export * from './tiss/apresentacao.js';
// F3.7 (06-FAT linhas 21, 22 e 24): parecer do item na auditoria, protocolo entre setores e acompanhamento da guia.
export * from './conta/auditoria-tramite.js';
// F3.7 (06-FAT linha 34): o lote de recurso da glosa por item, o retorno da operadora e a situação da glosa.
export * from './glosa/recurso-lote.js';
// F3.7 (06-FAT linhas 39 e 40): adiantamento, caução e conta corrente do paciente; modelo de orçamento padrão.
export * from './conta/adiantamento-paciente.js';
export * from './conta/modelo-orcamento.js';
