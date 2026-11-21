-- AGE, lote 05 (F2.2 ondas finais, onda 3; pedidos do lote 03-15). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (05_chaves.sql).
ALTER TABLE teleconsulta
  ADD COLUMN local_paciente_municipio_id BIGINT UNSIGNED NULL COMMENT 'Município de onde o paciente participa' AFTER local_paciente_unidade_federativa_id,
  ADD COLUMN ciente_alerta_cronico BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'O médico confirmou ciência do alerta do paciente crônico sem consulta presencial' AFTER declaracao_profissional_em,
  ADD KEY ix_teleconsulta_local_paciente_municipio (local_paciente_municipio_id);
