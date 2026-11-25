-- PEP, quantidade de cada órgão ou tecido por doador (F8, linha 03-PEP L145, correção de 25/11/2026). Só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho: a regra fica no domínio (conferirTransicaoDestino), que recusa
-- aceitar ou transplantar o mesmo órgão do doador em mais receptores do que a quantidade dele.
--   - quantidade_por_doador: 1 por padrão; o cliente informa 2 para os órgãos pares (rim, pulmão, córnea) no cadastro.

ALTER TABLE orgao_transplante
  ADD COLUMN IF NOT EXISTS quantidade_por_doador TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Quantos receptores podem receber este órgão de um mesmo doador (2 nos pares)' AFTER tipo;

ALTER TABLE orgao_transplante DROP CONSTRAINT IF EXISTS ck_orgao_transplante_quantidade;
ALTER TABLE orgao_transplante ADD CONSTRAINT ck_orgao_transplante_quantidade CHECK (quantidade_por_doador BETWEEN 1 AND 10);
