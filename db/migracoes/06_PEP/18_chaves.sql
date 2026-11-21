-- PEP, lote 18: chaves e sementes (aplicadas depois de todos os tabelas.sql)

-- L6-05: finalidades nativas do antimicrobiano (classificação da comissão de controle de infecção: profilática,
-- empírica, terapêutica). A ficha migrada acha o id pelo código (`cod:`); o hospital pode inativá-las e criar outras.
-- Idempotente (código único).
INSERT IGNORE INTO finalidade_terapeutica (codigo, descricao, exige_justificativa, exige_cultura, ordem, criado_em) VALUES
  ('profilatica', 'Profilática', FALSE, FALSE, 1, UTC_TIMESTAMP(3)),
  ('empirica', 'Empírica', TRUE, FALSE, 2, UTC_TIMESTAMP(3)),
  ('terapeutica', 'Terapêutica', TRUE, TRUE, 3, UTC_TIMESTAMP(3));
