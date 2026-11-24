-- SADT, escala de execução (F3.5, 05-SADT linha 19; 24/11/2026). Só para frente e idempotente (ADR 0002, parte 2).
-- 1) O papel do profissional na escala: quem executa o exame (profissional, sala ou equipamento) ou quem o lauda
--    (sempre um profissional). As escalas que já existem são de execução (padrão).
-- 2) O horário do plantão segue a regra do domínio (dominio-sadt/src/escala/execucao.ts): fim antes do início é o
--    plantão que vira a noite (19:00 às 07:00) e fim igual ao início é o de 24 horas. A trava antiga (fim > início)
--    recusava esses plantões de setor 24 horas; a nova exige as duas horas dentro do dia (00:00 a 23:59:59), que é o
--    que a coluna TIME, sozinha, não garante (ela aceita até 838 horas e valor negativo).
ALTER TABLE escala_execucao
  ADD COLUMN IF NOT EXISTS papel VARCHAR(10) NOT NULL DEFAULT 'executa'
    COMMENT 'executa: executa o exame; lauda: lauda o exame (só profissional)' AFTER recurso_agendavel_id;
ALTER TABLE escala_execucao DROP CONSTRAINT IF EXISTS ck_escala_execucao_papel;
ALTER TABLE escala_execucao
  ADD CONSTRAINT ck_escala_execucao_papel CHECK (papel IN ('executa','lauda') AND (papel = 'executa' OR profissional_id IS NOT NULL));
ALTER TABLE escala_execucao_dia DROP CONSTRAINT IF EXISTS ck_escala_execucao_dia_horario;
ALTER TABLE escala_execucao_dia
  ADD CONSTRAINT ck_escala_execucao_dia_horario CHECK (hora_inicio >= '00:00:00' AND hora_inicio < '24:00:00' AND hora_fim >= '00:00:00' AND hora_fim < '24:00:00');
