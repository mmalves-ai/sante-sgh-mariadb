// Motor da assinatura ICP-Brasil (M49, etapa 1): leitura do certificado e CPF do titular, política por tipo de
// documento, validação no servidor, carimbo do tempo, conector PSC (OAuth 2.0 + PKCE), agente local A1/A3,
// reprocessamento, cofre e numeração SNCR. Tudo puro: o HTTP, o banco e o cofre são do serviço que chama.
export * from './der.js';
export * from './oids.js';
export * from './certificado.js';
export * from './politica.js';
export * from './validacao.js';
export * from './carimbo.js';
export * from './psc-oauth.js';
export * from './agente-local.js';
export * from './reprocessamento.js';
export * from './cofre.js';
export * from './sncr.js';
export * from './servico.js';
export * from './icp-sintetica.js';
export * from './cadeia.js';
// M49, etapa 2: PAdES sobre o PDF/A emitido (revisão incremental, CMS destacado com carimbo) e o selo/rodapé.
export * from './pades.js';
export * from './selo.js';
export * from './verificador.js';
