-- SADT, região anatômica do exame pedido (F8, 09-AREA linha 84, C2-032; 27/11/2026). Só para frente e idempotente
-- (ADR 0002, parte 2). Sem gatilho: a regra (a região pedida tem de estar ligada e ativa no exame; sem região
-- informada vale a padrão do exame) fica no domínio (@sgh/dominio-pep, terminologia-clinica.ts, regiaoDoItemPedido).
-- Nula quando o exame não tem região ligada (exames de laboratório, por exemplo).
ALTER TABLE exame_item
  ADD COLUMN IF NOT EXISTS regiao_anatomica_codificada_id BIGINT UNSIGNED NULL
    COMMENT 'Região anatômica pedida, entre as que o exame admite (exame_regiao_anatomica)';
ALTER TABLE exame_item ADD KEY IF NOT EXISTS ix_exame_item_regiao_anatomica (regiao_anatomica_codificada_id);
