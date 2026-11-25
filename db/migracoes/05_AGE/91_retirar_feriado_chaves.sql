-- Agenda, retirada da tabela `feriado` (F3.1, 02-CAD linha 28, 25/11/2026): só para frente e idempotente (ADR 0002,
-- parte 2). Sem gatilho.
-- A 05_AGE/90 copiou o conteúdo de `feriado` para o cadastro único `dia_nao_util`, e desde então nada do produto grava
-- nem lê `feriado`: todos os leitores (agenda de consultas e de exames, acréscimo de feriado da conta, grade da sala
-- cirúrgica, ponto, portal do paciente, prazos da qualidade e SLA do contrato com fornecedor) passam pelo leitor comum
-- `apps/api/src/modulos/agenda/dias-sem-expediente-leitor.ts`, e o mapa do conector leva o calendário da origem direto
-- para `dia_nao_util`. Fica nas chaves (aplicadas depois de todas as tabelas e das chaves do lote 03, que criam as FK
-- de `feriado`), para a cópia da 05_AGE/90 rodar antes num banco novo.
-- Nada se perde (regra 7 e histórico nunca apagado), em três passos:
-- 1) cópia do que a 05_AGE/90 deixou de fora: a linha já excluída vem excluída (com a data e o autor da exclusão, e a
--    criação original), e qualquer linha ativa que ainda não tenha par em `dia_nao_util` vem também;
-- 2) conciliação: conta as linhas de `feriado` sem par em `dia_nao_util` (mesma data, nome, abrangência, alvo e
--    situação de exclusão) e grava a contagem numa tabela temporária cujo CHECK só aceita 0. Se sobrar alguma (por
--    exemplo, o feriado estadual com sigla de UF que não existe em `unidade_federativa`, que não tem alvo possível), a
--    migração FALHA no CHECK `ck_feriado_linha_sem_copia` e a tabela não sai: corrija a UF e rode de novo;
-- 3) só então a tabela sai, com as suas chaves.
-- Num banco em que `feriado` já saiu, os passos 1 e 2 viram no-op (SQL preparado conforme a tabela exista).
SET @feriado_existe := (SELECT COUNT(*) FROM information_schema.tables
                         WHERE table_schema = DATABASE() AND table_name = 'feriado' AND table_type = 'BASE TABLE');

SET @copia := IF(@feriado_existe = 0, 'DO 0', '
INSERT INTO dia_nao_util (descricao, abrangencia, unidade_federativa_id, municipio_ibge_id, estabelecimento_id,
                          recorrencia, data, facultativo, ativo, origem, criado_em, criado_por, alterado_em,
                          alterado_por, versao, excluido_em, excluido_por)
SELECT f.nome, f.abrangencia, CASE WHEN f.abrangencia = ''estadual'' THEN u.id END,
       CASE WHEN f.abrangencia = ''municipal'' THEN f.municipio_ibge_id END,
       CASE WHEN f.abrangencia = ''estabelecimento'' THEN f.estabelecimento_id END,
       ''data_unica'', f.data, f.ponto_facultativo, f.ativo, ''sistema'', f.criado_em, f.criado_por, f.alterado_em,
       f.alterado_por, 1, f.excluido_em, f.excluido_por
  FROM feriado f
  LEFT JOIN unidade_federativa u ON u.sigla = f.uf
 WHERE (f.abrangencia <> ''estadual'' OR u.id IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1 FROM dia_nao_util d
      WHERE d.recorrencia = ''data_unica'' AND d.data = f.data AND d.descricao = f.nome AND d.abrangencia = f.abrangencia
        AND d.unidade_federativa_id <=> CASE WHEN f.abrangencia = ''estadual'' THEN u.id END
        AND d.municipio_ibge_id <=> CASE WHEN f.abrangencia = ''municipal'' THEN f.municipio_ibge_id END
        AND d.estabelecimento_id <=> CASE WHEN f.abrangencia = ''estabelecimento'' THEN f.estabelecimento_id END
        AND (d.excluido_em IS NULL) = (f.excluido_em IS NULL))');
PREPARE passo_feriado FROM @copia;
EXECUTE passo_feriado;
DEALLOCATE PREPARE passo_feriado;

DROP TEMPORARY TABLE IF EXISTS conferencia_feriado;
CREATE TEMPORARY TABLE conferencia_feriado (
  linhas_sem_copia BIGINT UNSIGNED NOT NULL,
  CONSTRAINT ck_feriado_linha_sem_copia CHECK (linhas_sem_copia = 0)
);
SET @conferencia := IF(@feriado_existe = 0, 'INSERT INTO conferencia_feriado (linhas_sem_copia) VALUES (0)', '
INSERT INTO conferencia_feriado (linhas_sem_copia)
SELECT COUNT(*)
  FROM feriado f
  LEFT JOIN unidade_federativa u ON u.sigla = f.uf
 WHERE NOT EXISTS (
     SELECT 1 FROM dia_nao_util d
      WHERE d.recorrencia = ''data_unica'' AND d.data = f.data AND d.descricao = f.nome AND d.abrangencia = f.abrangencia
        AND d.unidade_federativa_id <=> CASE WHEN f.abrangencia = ''estadual'' THEN u.id END
        AND d.municipio_ibge_id <=> CASE WHEN f.abrangencia = ''municipal'' THEN f.municipio_ibge_id END
        AND d.estabelecimento_id <=> CASE WHEN f.abrangencia = ''estabelecimento'' THEN f.estabelecimento_id END
        AND (d.excluido_em IS NULL) = (f.excluido_em IS NULL))');
PREPARE passo_feriado FROM @conferencia;
EXECUTE passo_feriado;
DEALLOCATE PREPARE passo_feriado;
DROP TEMPORARY TABLE conferencia_feriado;

DROP TABLE IF EXISTS feriado;
