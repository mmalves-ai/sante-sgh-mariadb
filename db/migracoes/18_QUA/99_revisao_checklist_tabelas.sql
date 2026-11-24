-- Qualidade, revisão de prontuários no banco próprio (modulos-proprios-3, família qualidade-q3, 24/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2).
-- O item do checklist da qualidade ganha o código estável do item (ex.: 'assinatura'). A resposta da revisão e a
-- pendência gerada ao profissional apontam o item pelo código, que não muda entre as versões publicadas (o enunciado
-- pode mudar). Opcional: os checklists de outras finalidades e os já carregados podem não ter código; dentro da mesma
-- versão o código é único.
ALTER TABLE modelo_checklist_qualidade_item
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(40) NULL COMMENT 'Código estável do item entre as versões do checklist'
  AFTER sequencia;
ALTER TABLE modelo_checklist_qualidade_item
  ADD UNIQUE KEY IF NOT EXISTS uq_modelo_checklist_qualidade_item_versao_codigo (modelo_checklist_qualidade_versao_id, codigo);

-- A comissão dona do checklist em chave (FK no 99_revisao_checklist_chaves): o checklist da revisão de prontuários é
-- de uma comissão hospitalar, e o estabelecimento vem da comissão. Nulo nos checklists de outras finalidades (auditoria
-- interna, visita de segurança) e nos já carregados sem dono. Um checklist por comissão e finalidade.
ALTER TABLE modelo_checklist_qualidade
  ADD COLUMN IF NOT EXISTS comissao_hospitalar_id BIGINT UNSIGNED NULL COMMENT 'Comissão dona do checklist (revisão de prontuários)'
  AFTER finalidade;
ALTER TABLE modelo_checklist_qualidade
  ADD UNIQUE KEY IF NOT EXISTS uq_modelo_checklist_qualidade_comissao_finalidade (comissao_hospitalar_id, finalidade);

-- A inativação da versão publicada: quem, quando e o motivo em colunas próprias (o motivo_publicacao é o da
-- publicação). A versão inativada deixa de valer sem ser substituída; nada é apagado.
ALTER TABLE modelo_checklist_qualidade_versao
  ADD COLUMN IF NOT EXISTS inativado_em DATETIME(3) NULL COMMENT 'Instante da inativação da versão',
  ADD COLUMN IF NOT EXISTS inativado_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem inativou a versão',
  ADD COLUMN IF NOT EXISTS motivo_inativacao VARCHAR(1000) NULL COMMENT 'Motivo da inativação da versão';
ALTER TABLE modelo_checklist_qualidade_versao
  DROP CONSTRAINT IF EXISTS ck_modelo_checklist_qualidade_versao_situacao;
ALTER TABLE modelo_checklist_qualidade_versao
  ADD CONSTRAINT IF NOT EXISTS ck_modelo_checklist_qualidade_versao_situacao CHECK (situacao IN ('rascunho','vigente','substituida','inativa')),
  ADD CONSTRAINT IF NOT EXISTS ck_modelo_checklist_qualidade_versao_inativacao CHECK ((situacao = 'inativa') = (inativado_em IS NOT NULL AND inativado_por_usuario_id IS NOT NULL AND motivo_inativacao IS NOT NULL)),
  ADD KEY IF NOT EXISTS ix_modelo_checklist_qualidade_versao_inativado_por (inativado_por_usuario_id);
