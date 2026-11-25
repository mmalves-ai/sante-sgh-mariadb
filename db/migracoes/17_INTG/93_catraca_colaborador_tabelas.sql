-- Catraca com o crachá do colaborador (08-INTG L141): só para frente e idempotente (ADR 0002, parte 2).
-- O crachá do colaborador fica ligado à matrícula (vínculo de trabalho), com o código que a catraca lê (cartão de
-- proximidade ou barras; LGPD: só o código, nada biométrico). As regras de acesso passam a valer também para o terminal
-- da portaria (terminal_acesso), além do dispositivo de integração, por perfil, setor, dias, faixa horária e sentido.

ALTER TABLE vinculo_trabalho
  ADD COLUMN IF NOT EXISTS codigo_cracha VARCHAR(60) NULL COMMENT 'Código gravado no crachá do colaborador, lido na catraca',
  DROP CONSTRAINT IF EXISTS ck_vinculo_trabalho_codigo_cracha,
  ADD CONSTRAINT ck_vinculo_trabalho_codigo_cracha CHECK (codigo_cracha IS NULL OR codigo_cracha REGEXP '^[A-Z0-9]{6,20}$'),
  ADD UNIQUE KEY IF NOT EXISTS uq_vinculo_trabalho_codigo_cracha (estabelecimento_id, codigo_cracha);

ALTER TABLE regra_acesso_dispositivo
  MODIFY dispositivo_acesso_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS terminal_acesso_id BIGINT UNSIGNED NULL COMMENT 'Terminal da portaria ao qual a regra se aplica' AFTER dispositivo_acesso_id,
  DROP CONSTRAINT IF EXISTS ck_regra_acesso_dispositivo_equipamento,
  ADD CONSTRAINT ck_regra_acesso_dispositivo_equipamento CHECK (dispositivo_acesso_id IS NOT NULL OR terminal_acesso_id IS NOT NULL),
  ADD KEY IF NOT EXISTS ix_regra_acesso_dispositivo_terminal (terminal_acesso_id, categoria_pessoa, ativo);
