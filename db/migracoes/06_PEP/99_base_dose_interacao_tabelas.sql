-- Base licenciada de doses e interações (F3, 03-PEP L108, C2-104, 25/11/2026; ADR 0006): o espelho padrão da base
-- leva a todo cliente os limites de dose por princípio ativo e as interações entre princípios ativos, versionados
-- por edição (catalogos/licenciados/carregar.py, fontes base_dose e base_interacao). A linha da base guarda a edição
-- que a trouxe; o limite próprio do hospital fica com a edição nula e nunca é tocado pela carga. Só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho: o motor de alertas do domínio lê as linhas ativas.
ALTER TABLE limite_dose_principio
  ADD COLUMN IF NOT EXISTS codigo_base VARCHAR(30) NULL
    COMMENT 'Código do limite na base licenciada (nulo: limite próprio do hospital)' AFTER referencia_bibliografica,
  ADD COLUMN IF NOT EXISTS edicao_base VARCHAR(30) NULL
    COMMENT 'Edição da base licenciada que trouxe ou atualizou o limite' AFTER codigo_base,
  ADD UNIQUE KEY IF NOT EXISTS uq_limite_dose_principio_codigo_base (codigo_base);

ALTER TABLE interacao_medicamentosa
  ADD COLUMN IF NOT EXISTS edicao_base VARCHAR(30) NULL
    COMMENT 'Edição da base licenciada que trouxe ou atualizou a interação (nulo: cadastro próprio do hospital)'
    AFTER referencia_bibliografica;
