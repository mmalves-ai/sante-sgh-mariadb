-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE agendamento_cirurgico
  ADD COLUMN IF NOT EXISTS conta_portal_profissional_externo_id BIGINT UNSIGNED NULL COMMENT 'Conta do portal do médico externo que fez o pedido',
  DROP CONSTRAINT IF EXISTS ck_agendamento_cirurgico_portal,
  ADD CONSTRAINT ck_agendamento_cirurgico_portal CHECK (conta_portal_profissional_externo_id IS NULL OR canal_solicitacao = 'portal'),
  ADD KEY IF NOT EXISTS ix_agendamento_cirurgico_conta_portal (conta_portal_profissional_externo_id);

CREATE TABLE agendamento_cirurgico_recurso (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agendamento_cirurgico_id BIGINT UNSIGNED NOT NULL,
  recurso VARCHAR(30) NOT NULL,
  criado_em DATETIME(3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL,
  alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_agendamento_cirurgico_recurso_recurso CHECK (recurso IN ('microscopio','intensificador_imagem','furadeira','camara','video','torre','material_ortopedia','eletrocauterio','vaga_unidade_coronariana','arco_cirurgico','congelacao','raio_x')),
  UNIQUE KEY uq_agendamento_cirurgico_recurso (agendamento_cirurgico_id, recurso)
) COMMENT='Recurso da sala pedido no agendamento cirúrgico (microscópio, intensificador, vídeo, arco, congelação...)';

