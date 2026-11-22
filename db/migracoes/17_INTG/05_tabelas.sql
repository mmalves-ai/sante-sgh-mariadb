-- INTG, lote 5 (F4 conector, rodada 4: pedidos de modelo das fatias, registrados para a trilha F2.2 em
-- docs/obra/passagens/F4-pedidos-f22.md). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY aqui (05_chaves.sql).

-- L8-16 (6): equivalência a conferir pelo cliente (o motor de integração só usa a linha com os dois preenchidos)
ALTER TABLE material_laboratorio_apoio
  MODIFY COLUMN material_biologico_id BIGINT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE elemento_exame_laboratorio_apoio
  MODIFY COLUMN analito_id BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Campo de resultado interno';
