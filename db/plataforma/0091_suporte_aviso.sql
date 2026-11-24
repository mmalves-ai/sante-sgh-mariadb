-- Suporte técnico (ADR 0021, R2): o aviso ao Auditor de cada sessão do login como, registrado no banco plataforma na
-- abertura da sessão. Só de acréscimo (o papel da aplicação recebe SELECT e INSERT: tools/implantacao SO_ACRESCIMO):
-- o registro nunca é alterado nem apagado. Sem ele, a sessão não fica aberta (falha fechada no ServicoComo). A
-- entrega ao Auditor é pela fila de e-mail da rede (worker; fora de produção, captura local: regra 6).
-- Para a frente e idempotente; sem gatilho.

CREATE TABLE IF NOT EXISTS sessao_suporte_aviso (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sessao_suporte_id     BIGINT UNSIGNED NOT NULL,
  tipo                  VARCHAR(40) NOT NULL COMMENT 'Tipo do aviso (alerta-suporte)',
  chave                 VARCHAR(120) NOT NULL COMMENT 'Chave única do aviso (estabelecimento e sessão)',
  conteudo              JSON NOT NULL COMMENT 'Só identificadores e códigos (nunca nome nem justificativa)',
  criado_em             DATETIME(3) NOT NULL,
  criado_por            BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_sessao_suporte_aviso_chave (chave),
  KEY ix_sessao_suporte_aviso_sessao (sessao_suporte_id, id),
  CONSTRAINT ck_sessao_suporte_aviso_conteudo CHECK (JSON_VALID(conteudo)),
  CONSTRAINT ck_sessao_suporte_aviso_tipo CHECK (tipo <> ''),
  CONSTRAINT fk_sessao_suporte_aviso_sessao FOREIGN KEY (sessao_suporte_id) REFERENCES sessao_suporte (id) ON DELETE RESTRICT
) COMMENT='Aviso ao Auditor da abertura de cada sessão do login como (só de acréscimo)';
