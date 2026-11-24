-- PEP, alergias (família pep-resto2, modulos-proprios-3, 24/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- Sem gatilho; as regras ficam no domínio e na porta.
--   - alergia_paciente.motivo_inativacao: até 500 caracteres, o mesmo limite do contrato da tela (o motivo nunca é
--     truncado). Só alarga a coluna: nenhum valor gravado muda. Registro clínico nunca é apagado (SBIS-26).

ALTER TABLE alergia_paciente
  MODIFY COLUMN motivo_inativacao VARCHAR(500) NULL COMMENT 'Motivo da inativação (até 500 caracteres)';
