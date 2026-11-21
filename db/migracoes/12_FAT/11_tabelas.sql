-- FAT, lote 11 (F2.2 ondas finais, onda 5c; pedido do lote 05-02). Convenções do ADR 0002 (parte 2). Só para frente.

-- 05-02: na UNIQUE (lote_tiss_id, conta_hospitalar_id, guia_tiss_id) a guia é anulável, e o MariaDB não compara NULL
-- com NULL: a mesma conta entrava duas vezes no mesmo lote quando a guia era nula. A coluna gerada abaixo só tem valor
-- na linha sem guia (sem sentinela gravada: com guia, ela é nula e a chave antiga continua valendo).
ALTER TABLE lote_tiss_conta
  ADD COLUMN conta_sem_guia_id BIGINT UNSIGNED AS (IF(guia_tiss_id IS NULL, conta_hospitalar_id, NULL)) PERSISTENT
    COMMENT 'Apoio à unicidade da conta sem guia no lote (nula quando a linha tem guia)' AFTER guia_tiss_id,
  ADD UNIQUE KEY uq_lote_tiss_conta_conta_sem_guia (lote_tiss_id, conta_sem_guia_id);
