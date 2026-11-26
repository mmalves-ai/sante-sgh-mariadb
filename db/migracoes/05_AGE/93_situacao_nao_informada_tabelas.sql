-- Recusas da carga (fase 2, K1): a marcação migrada sem situação na origem entra com o significado 'nao_informada'
-- (decisão do dono de 25/11). Idempotente e válida em qualquer ordem (ADR 0002).
ALTER TABLE situacao_marcacao DROP CONSTRAINT IF EXISTS ck_situacao_marcacao_significado;
ALTER TABLE situacao_marcacao
  ADD CONSTRAINT ck_situacao_marcacao_significado CHECK (significado IN ('aguardando','confirmada','chegou','em_atendimento','realizada','cancelada','falta','bloqueada','nao_informada'));
