-- SADT, laudos estruturados de mamografia e de anatomia patológica (F7, 05-SADT linha 18, função C2-071; 25/11/2026).
-- Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho: as regras ficam no domínio
-- (@sgh/dominio-sadt, mama-patologia/laudos.ts) e na porta própria (laudo-mama-patologia-propria.ts).
-- 1. O laudo anatomopatológico guarda a descrição cirúrgica que enviou a peça (recebimento da peça pelo laboratório).
ALTER TABLE laudo_anatomopatologico
  ADD COLUMN IF NOT EXISTS descricao_cirurgica_id BIGINT UNSIGNED NULL
    COMMENT 'Descrição cirúrgica que enviou a peça recebida pelo laboratório' AFTER atendimento_id,
  ADD KEY IF NOT EXISTS ix_laudo_anatomopatologico_descricao_cirurgica (descricao_cirurgica_id);

-- 2. Categorias de avaliação do laudo mamário padronizado (CBR/ACR; as mesmas do resultado de mamografia do SISCAN,
--    do INCA), com a conduta e o intervalo de seguimento. Todo cliente nasce com elas; a que já existir fica.
INSERT INTO categoria_achado_mama
  (codigo, descricao, categoria, conduta_recomendada, intervalo_seguimento_meses, risco_malignidade, ordem, ativo, criado_em) VALUES
  ('MAMA_0', 'Inconclusivo: avaliação adicional necessária', '0', 'Avaliação complementar por imagem ou comparação com exame anterior', NULL, NULL, 1, TRUE, UTC_TIMESTAMP(3)),
  ('MAMA_1', 'Negativo', '1', 'Rastreamento de rotina', 12, 'Essencialmente 0%', 2, TRUE, UTC_TIMESTAMP(3)),
  ('MAMA_2', 'Achado benigno', '2', 'Rastreamento de rotina', 12, 'Essencialmente 0%', 3, TRUE, UTC_TIMESTAMP(3)),
  ('MAMA_3', 'Provavelmente benigno', '3', 'Controle radiológico em intervalo curto', 6, 'Até 2%', 4, TRUE, UTC_TIMESTAMP(3)),
  ('MAMA_4', 'Suspeito', '4', 'Biópsia', NULL, 'Mais de 2% e menos de 95%', 5, TRUE, UTC_TIMESTAMP(3)),
  ('MAMA_4A', 'Baixa suspeita de malignidade', '4A', 'Biópsia', NULL, 'Mais de 2% até 10%', 6, TRUE, UTC_TIMESTAMP(3)),
  ('MAMA_4B', 'Suspeita intermediária de malignidade', '4B', 'Biópsia', NULL, 'Mais de 10% até 50%', 7, TRUE, UTC_TIMESTAMP(3)),
  ('MAMA_4C', 'Alta suspeita de malignidade', '4C', 'Biópsia', NULL, 'Mais de 50% e menos de 95%', 8, TRUE, UTC_TIMESTAMP(3)),
  ('MAMA_5', 'Altamente sugestivo de malignidade', '5', 'Biópsia', NULL, '95% ou mais', 9, TRUE, UTC_TIMESTAMP(3)),
  ('MAMA_6', 'Malignidade comprovada por biópsia', '6', 'Tratamento', NULL, 'Comprovada', 10, TRUE, UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE codigo = codigo;

-- 3. Graus histológicos de uso geral: Nottingham (mama), diferenciação da OMS e grupos de grau da ISUP (próstata).
INSERT INTO grau_histologico (codigo, descricao, sistema_graduacao, ordem, ativo, criado_em) VALUES
  ('GX', 'Grau não avaliável', NULL, 1, TRUE, UTC_TIMESTAMP(3)),
  ('NOTTINGHAM_1', 'Grau 1 (bem diferenciado)', 'Nottingham', 10, TRUE, UTC_TIMESTAMP(3)),
  ('NOTTINGHAM_2', 'Grau 2 (moderadamente diferenciado)', 'Nottingham', 11, TRUE, UTC_TIMESTAMP(3)),
  ('NOTTINGHAM_3', 'Grau 3 (pouco diferenciado)', 'Nottingham', 12, TRUE, UTC_TIMESTAMP(3)),
  ('OMS_G1', 'G1, bem diferenciado', 'OMS', 20, TRUE, UTC_TIMESTAMP(3)),
  ('OMS_G2', 'G2, moderadamente diferenciado', 'OMS', 21, TRUE, UTC_TIMESTAMP(3)),
  ('OMS_G3', 'G3, pouco diferenciado', 'OMS', 22, TRUE, UTC_TIMESTAMP(3)),
  ('OMS_G4', 'G4, indiferenciado', 'OMS', 23, TRUE, UTC_TIMESTAMP(3)),
  ('ISUP_1', 'Grupo de grau 1 (Gleason até 6)', 'ISUP', 30, TRUE, UTC_TIMESTAMP(3)),
  ('ISUP_2', 'Grupo de grau 2 (Gleason 3+4=7)', 'ISUP', 31, TRUE, UTC_TIMESTAMP(3)),
  ('ISUP_3', 'Grupo de grau 3 (Gleason 4+3=7)', 'ISUP', 32, TRUE, UTC_TIMESTAMP(3)),
  ('ISUP_4', 'Grupo de grau 4 (Gleason 8)', 'ISUP', 33, TRUE, UTC_TIMESTAMP(3)),
  ('ISUP_5', 'Grupo de grau 5 (Gleason 9 e 10)', 'ISUP', 34, TRUE, UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE codigo = codigo;
