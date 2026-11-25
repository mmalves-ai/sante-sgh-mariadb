-- PEP, declaração de óbito: cartório de registro civil escolhido (C1-112, 09-AREA linha 74, 25/11/2026).
-- Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio
-- (@sgh/dominio-internacao, destino-corpo: decidirDestinoDeclaracao) e na porta própria do destino do corpo.
--   - declaracao_obito.cartorio_registro_civil_id (nova): o cartório para onde a família leva a declaração para o
--     registro do óbito, escolhido junto com a funerária (servico_funerario_id, já existente); vazio: ainda não
--     escolhido. Cartório fora de uso continua nas declarações antigas.

ALTER TABLE declaracao_obito
  ADD COLUMN IF NOT EXISTS cartorio_registro_civil_id BIGINT UNSIGNED NULL COMMENT 'Cartório de registro civil escolhido para o registro do óbito' AFTER servico_funerario_id,
  ADD KEY IF NOT EXISTS ix_declaracao_obito_cartorio_registro_civil (cartorio_registro_civil_id);
