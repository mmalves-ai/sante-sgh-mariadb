-- Autorização prévia à operadora: situação honesta do envio pelo webservice (06-FAT linha 27, F78.06-2, 24/11/2026).
-- Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; as gravações são da porta própria
-- (apps/api/src/modulos/tiss/autorizacao-previa-propria.ts).
--   - situação 'pronta_envio': a mensagem foi montada, validada no XSD e guardada (arquivo_id), mas ainda não saiu do
--     hospital; só a transmissão registrada (canal real usado e instante) leva o pedido a 'enviada'. Nada é dado como
--     enviado sem ter sido;
--   - CHECK do envio: o rascunho, o pedido pronto para envio e o cancelado antes de sair ficam sem enviada_em (antes o
--     cancelamento de um rascunho precisaria inventar um instante de envio).

ALTER TABLE solicitacao_autorizacao DROP CONSTRAINT IF EXISTS ck_solicitacao_autorizacao_situacao;
ALTER TABLE solicitacao_autorizacao
  ADD CONSTRAINT ck_solicitacao_autorizacao_situacao CHECK (situacao IN ('rascunho','pronta_envio','enviada','em_analise','autorizada','autorizada_parcial','negada','cancelada','erro_envio'));

ALTER TABLE solicitacao_autorizacao DROP CONSTRAINT IF EXISTS ck_solicitacao_autorizacao_envio;
ALTER TABLE solicitacao_autorizacao
  ADD CONSTRAINT ck_solicitacao_autorizacao_envio CHECK (situacao IN ('rascunho','pronta_envio','cancelada') OR enviada_em IS NOT NULL OR canal <> 'webservice');
