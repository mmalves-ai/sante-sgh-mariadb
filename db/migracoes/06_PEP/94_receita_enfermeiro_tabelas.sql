-- PEP, receita do enfermeiro no banco próprio (família sae-cadastro, modulos-proprios-3, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio e na porta.
--   - receita_medica_item: a via e a quantidade impressas cabem no que a tela aceita (via até 30 e quantidade até 60
--     caracteres), sem cortar o texto que sai na receita assinada. Só alarga: nenhuma linha existente muda.
--   - receita_medica.justificativa_suspensao: o motivo da suspensão ou do cancelamento cabe no que a tela aceita (até
--     300 caracteres), sem cortar o motivo clínico. Só alarga.

ALTER TABLE receita_medica_item
  MODIFY COLUMN via_descricao VARCHAR(30) NULL COMMENT 'Via como sai impressa',
  MODIFY COLUMN quantidade_descricao VARCHAR(60) NOT NULL COMMENT 'Quantidade como sai impressa (ex.: 2 caixas)';

ALTER TABLE receita_medica
  MODIFY COLUMN justificativa_suspensao VARCHAR(300) NULL COMMENT 'Motivo da suspensão ou do cancelamento';
