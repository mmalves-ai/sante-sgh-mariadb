-- Tributo e beneficiário da suspensão do processo tributário (07-FIN linha 111, F3.8, 24/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho; a regra fica no domínio (@sgh/dominio-financeiro, reinf-eventos.ts:
-- processoQueSuspende, o processo do beneficiário vence o geral, só na vigência) e na operação
-- (apps/api/src/modulos/financeiro/reinf-eventos-propria.ts). A suspensão vale para um tributo (INSS, IR ou as
-- contribuições retidas em conjunto) e, quando informado, só para um beneficiário (CPF ou CNPJ, só dígitos).
ALTER TABLE suspensao_processo_tributario
  ADD COLUMN IF NOT EXISTS tributo VARCHAR(10) NOT NULL DEFAULT 'ir' COMMENT 'Tributo suspenso: inss, ir ou csrf (PIS, COFINS e CSLL retidos em conjunto)' AFTER indicativo_suspensao,
  ADD COLUMN IF NOT EXISTS beneficiario_documento VARCHAR(14) NULL COMMENT 'CPF ou CNPJ do beneficiário, só dígitos; vazio vale para todos' AFTER tributo;

ALTER TABLE suspensao_processo_tributario
  ADD CONSTRAINT IF NOT EXISTS ck_suspensao_processo_tributario_tributo CHECK (tributo IN ('inss','ir','csrf')),
  ADD CONSTRAINT IF NOT EXISTS ck_suspensao_processo_tributario_beneficiario CHECK (beneficiario_documento IS NULL OR beneficiario_documento REGEXP '^([0-9]{11}|[0-9]{14})$'),
  ADD KEY IF NOT EXISTS ix_suspensao_processo_tributario_beneficiario (beneficiario_documento, tributo);
