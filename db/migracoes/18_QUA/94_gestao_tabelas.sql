-- Qualidade, gestão no banco próprio (modulos-proprios-1, família qualidade-b, 23/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2).
-- Envio regulatório: o arquivo transmitido ao órgão (PM-QUALISS, IRAS, Notivisa) é guardado pela porta de
-- armazenamento de arquivos (ADR 0004: imutável, conferido pelo resumo SHA-256) e a chave fica no envio. A chave do
-- objeto é obrigatória: reafirma o NOT NULL de 23_tabelas.sql (desfaz, onde tiver sido aplicada, a versão anterior
-- desta migração que a deixava opcional). Se houver envio sem arquivo guardado, a migração falha: nunca se inventa
-- chave.
ALTER TABLE envio_regulatorio_qualidade
  MODIFY COLUMN chave_objeto VARCHAR(500) NOT NULL COMMENT 'Chave do arquivo no armazenamento';
