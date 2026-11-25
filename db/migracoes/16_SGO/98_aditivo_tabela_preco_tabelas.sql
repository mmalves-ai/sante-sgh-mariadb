-- Aditivo do contrato de plano (08-SGO linha 94, F7, C2-108, 25/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- Sem gatilho; a regra fica no domínio (@sgh/dominio-operadora, efeitoDoAditivo) e na porta
-- (apps/api/src/modulos/operadora/cadastro-complementar-porta-propria.ts).
--   - aditivo_contrato_plano.tabela_preco_plano_id: a tabela de preço que passa a valer no efeito do aditivo de inclusão
--     de plano, de preço ou de troca de plano (na troca, sem ela, segue a do plano anterior). A assinatura encerra a
--     oferta antiga na véspera e abre a nova em contrato_plano_oferta (nada é sobrescrito).

ALTER TABLE aditivo_contrato_plano
  ADD COLUMN IF NOT EXISTS tabela_preco_plano_id BIGINT UNSIGNED NULL COMMENT 'Tabela de preço que passa a valer no efeito' AFTER valor_novo,
  ADD KEY IF NOT EXISTS ix_aditivo_contrato_plano_tabela_preco_plano_id (tabela_preco_plano_id);
