-- Televisor dos painéis de TV operacionais preso ao aparelho (01-REL L116): só para frente e idempotente (ADR 0002,
-- parte 2). O código de pareamento passa a ter validade, e o pareamento emite um segredo do aparelho que fica só na TV;
-- o banco guarda o resumo SHA-256 dele. A tela da TV e o contato só respondem ao aparelho que apresenta o segredo de um
-- televisor ativo e pareado; desligar anula o resumo, e a TV volta ao pareamento. Sem gatilho: a regra é do domínio
-- (@sgh/dominio-relatorio, painel-tv, pareamentoVigente) e a porta própria (painel-tv-propria.ts) grava os valores.
ALTER TABLE painel_tv_dispositivo
  ADD COLUMN IF NOT EXISTS codigo_expira_em DATETIME(3) NULL
    COMMENT 'Validade do código de pareamento; depois dela o código é recusado e religar gera outro' AFTER codigo_pareamento,
  ADD COLUMN IF NOT EXISTS segredo_resumo CHAR(64) NULL
    COMMENT 'Resumo SHA-256 do segredo emitido ao aparelho no pareamento; anulado ao desligar' AFTER pareado_em;
