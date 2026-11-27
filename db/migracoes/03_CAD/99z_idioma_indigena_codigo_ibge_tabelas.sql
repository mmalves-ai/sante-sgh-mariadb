-- Línguas indígenas pela classificação oficial do IBGE (C1-099, 09-AREA linha 73, 27/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). O cadastro nacional de usuários não publica tabela de línguas com código; a fonte
-- oficial com código é a classificação "Tronco, família linguística e língua indígena falada ou utilizada" do Censo
-- Demográfico 2022 (IBGE), carregada por catalogos/carregadores/idioma.py (regra 7: dado público da fonte oficial, por
-- carregador versionado). O código do cadastro nacional fica opcional, para quando houver publicação; uma das duas
-- referências oficiais é obrigatória.

ALTER TABLE idioma_indigena
  ADD COLUMN IF NOT EXISTS codigo_ibge VARCHAR(10) NULL
    COMMENT 'Código da língua na classificação oficial do Censo Demográfico (IBGE)' AFTER codigo_cadsus,
  ADD COLUMN IF NOT EXISTS familia_linguistica VARCHAR(150) NULL
    COMMENT 'Tronco e família linguística da classificação oficial' AFTER descricao,
  MODIFY codigo_cadsus VARCHAR(10) NULL COMMENT 'Código oficial da língua no cadastro nacional de usuários, quando publicado';

ALTER TABLE idioma_indigena
  ADD UNIQUE KEY IF NOT EXISTS uq_idioma_indigena_codigo_ibge (codigo_ibge);

ALTER TABLE idioma_indigena
  ADD CONSTRAINT IF NOT EXISTS ck_idioma_indigena_codigo_oficial CHECK (codigo_ibge IS NOT NULL OR codigo_cadsus IS NOT NULL);
