-- SADT, vias do laudo e numeração do laudo semeada (F3.5, correção da revisão, 24/11/2026). Só para frente e idempotente
-- (ADR 0002, parte 2).
-- O número e o código de autenticação identificam o LAUDO: a 2ª via (reimpressão com motivo) é outra emissão do mesmo
-- laudo, com o mesmo número e o mesmo código, ligada à emissão original e com o seu número de via. Antes, as chaves
-- únicas de número e de código recusavam a 2ª via que repetia o código (e a 2ª via ganhava um número novo, de modo que
-- o mesmo laudo tinha dois números). Agora a unicidade é do número e do código POR VIA.
ALTER TABLE emissao_laudo
  ADD COLUMN IF NOT EXISTS numero_via SMALLINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT 'Via da emissão do laudo (1 na original; 2 em diante nas reimpressões com motivo)' AFTER codigo_autenticacao,
  ADD COLUMN IF NOT EXISTS emissao_original_id BIGINT UNSIGNED NULL
    COMMENT 'Emissão original do laudo (preenchida só nas vias seguintes)' AFTER numero_via;
ALTER TABLE emissao_laudo
  ADD UNIQUE KEY IF NOT EXISTS uq_emissao_laudo_numero_via (estabelecimento_id, numero, numero_via),
  ADD UNIQUE KEY IF NOT EXISTS uq_emissao_laudo_codigo_via (codigo_autenticacao, numero_via),
  ADD KEY IF NOT EXISTS ix_emissao_laudo_emissao_original_id (emissao_original_id);
-- As chaves novas (que começam pelo estabelecimento) atendem a chave estrangeira dele antes de as antigas saírem.
ALTER TABLE emissao_laudo
  DROP INDEX IF EXISTS uq_emissao_laudo_numero,
  DROP INDEX IF EXISTS uq_emissao_laudo_codigo_autenticacao;
ALTER TABLE emissao_laudo
  DROP CONSTRAINT IF EXISTS ck_emissao_laudo_via;
ALTER TABLE emissao_laudo
  ADD CONSTRAINT ck_emissao_laudo_via CHECK (
    (numero_via = 1 AND emissao_original_id IS NULL) OR (numero_via > 1 AND emissao_original_id IS NOT NULL));

-- A numeração do laudo de cada estabelecimento (a mesma que tools/db/configurar_numeracoes.py inclui no "criar novo
-- cliente" e a cada estabelecimento novo): semeada aqui para os clientes já criados, de modo que a emissão só lê e
-- trava a linha (sem criá-la sob demanda, o que corria entre duas primeiras emissões simultâneas). Começa depois do
-- maior número inteiro já gravado no estabelecimento (laudo importado ou emitido), para não repetir número.
INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, incremento, ativo, criado_em, versao)
SELECT e.id, 'laudo_exame',
       COALESCE((SELECT MAX(CAST(el.numero AS UNSIGNED)) FROM emissao_laudo el
                  WHERE el.estabelecimento_id = e.id AND el.numero REGEXP '^[0-9]{1,18}$'), 0) + 1,
       1, TRUE, UTC_TIMESTAMP(3), 1
  FROM estabelecimento e
 WHERE e.excluido_em IS NULL
   AND NOT EXISTS (SELECT 1 FROM sequencia_negocio s WHERE s.estabelecimento_id = e.id AND s.tipo = 'laudo_exame');
