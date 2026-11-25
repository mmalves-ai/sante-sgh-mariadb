-- Página inicial montada pelo hospital (01-ADM L114): só para frente e idempotente (ADR 0002, parte 2).
-- O bloco passa a poder ser uma lista de trabalho do catálogo de blocos (as filas que a página inicial já tem: médico,
-- recepção, mensagens, PA, NIR e as demais), ligada pelo tipo_bloco_pagina; o catálogo recebe as listas de trabalho,
-- o indicador, o atalho e o texto.

ALTER TABLE modelo_pagina_inicial_bloco
  ADD COLUMN IF NOT EXISTS tipo_bloco_pagina_id BIGINT UNSIGNED NULL COMMENT 'Bloco do catálogo (obrigatório na lista de trabalho)' AFTER tipo_bloco,
  ADD KEY IF NOT EXISTS ix_modelo_pagina_inicial_bloco_tipo_bloco_pagina_id (tipo_bloco_pagina_id),
  DROP CONSTRAINT IF EXISTS ck_modelo_pagina_inicial_bloco_tipo_bloco,
  ADD CONSTRAINT ck_modelo_pagina_inicial_bloco_tipo_bloco CHECK (tipo_bloco IN ('painel_gerencial','indicador','relatorio','analise_salva','atalho','link','texto','lista_trabalho')),
  DROP CONSTRAINT IF EXISTS ck_modelo_pagina_inicial_bloco_alvo,
  ADD CONSTRAINT ck_modelo_pagina_inicial_bloco_alvo CHECK ((tipo_bloco <> 'painel_gerencial' OR painel_gerencial_id IS NOT NULL) AND (tipo_bloco <> 'indicador' OR indicador_id IS NOT NULL) AND (tipo_bloco <> 'relatorio' OR relatorio_id IS NOT NULL) AND (tipo_bloco <> 'analise_salva' OR analise_salva_id IS NOT NULL) AND (tipo_bloco <> 'atalho' OR tela_sistema_id IS NOT NULL) AND (tipo_bloco <> 'link' OR endereco_link IS NOT NULL) AND (tipo_bloco <> 'texto' OR texto IS NOT NULL) AND (tipo_bloco <> 'lista_trabalho' OR tipo_bloco_pagina_id IS NOT NULL));

-- O catálogo de blocos (componente = o que a tela desenha; o código da lista de trabalho é o da fila da página inicial).
INSERT INTO tipo_bloco_pagina (codigo, descricao, categoria, componente, detalhamento, disponivel_celular, universal, criado_em)
SELECT n.codigo, n.descricao, n.categoria, n.componente, n.detalhamento, TRUE, n.universal, NOW(3)
  FROM (
    SELECT 'medico' AS codigo, 'Médico: meus pacientes' AS descricao, 'lista_trabalho' AS categoria, 'lista_trabalho' AS componente, 'Pacientes do médico com as pendências (prescrição, evolução, resultados)' AS detalhamento, FALSE AS universal
    UNION ALL SELECT 'recepcao', 'Recepção: fila de senhas', 'lista_trabalho', 'lista_trabalho', 'Senhas aguardando atendimento, por prioridade e espera', FALSE
    UNION ALL SELECT 'enfermagem', 'Enfermagem: cuidados do turno', 'lista_trabalho', 'lista_trabalho', 'Cuidados e checagens do turno', FALSE
    UNION ALL SELECT 'higienizacao', 'Higienização de leitos', 'lista_trabalho', 'lista_trabalho', 'Leitos aguardando limpeza', FALSE
    UNION ALL SELECT 'assinaturas', 'Documentos a assinar', 'lista_trabalho', 'lista_trabalho', 'Documentos clínicos pendentes de assinatura', FALSE
    UNION ALL SELECT 'mensagens', 'Mensagens e comunicados', 'comunicado', 'lista_trabalho', 'Mensagens não lidas e comunicados da gestão', TRUE
    UNION ALL SELECT 'pa', 'Pronto atendimento: classificação de risco', 'lista_trabalho', 'lista_trabalho', 'Pacientes por cor de risco e tempo restante', FALSE
    UNION ALL SELECT 'nir', 'Núcleo interno de regulação', 'lista_trabalho', 'lista_trabalho', 'Solicitações de leito e barreiras de alta', FALSE
    UNION ALL SELECT 'nutricao', 'Nutrição: triagem', 'lista_trabalho', 'lista_trabalho', 'Pacientes a triar e a reavaliar', FALSE
    UNION ALL SELECT 'qualidade', 'Segurança do paciente: prazos', 'lista_trabalho', 'lista_trabalho', 'Notificações por prazo regulatório', FALSE
    UNION ALL SELECT 'ccih', 'Controle de infecção', 'lista_trabalho', 'lista_trabalho', 'Pacientes em vigilância de infecção', FALSE
    UNION ALL SELECT 'agravos', 'Notificação compulsória', 'lista_trabalho', 'lista_trabalho', 'Casos aguardando notificação e sugestões', FALSE
    UNION ALL SELECT 'indicador', 'Indicador com gráfico', 'indicador', 'indicador', 'Valor das últimas competências apuradas, com a meta', TRUE
    UNION ALL SELECT 'link', 'Atalho', 'links', 'link', 'Atalho para uma tela do sistema ou página https', TRUE
    UNION ALL SELECT 'texto', 'Texto', 'texto', 'texto', 'Texto livre da gestão (orientação, aviso fixo)', TRUE
  ) n
 WHERE NOT EXISTS (SELECT 1 FROM tipo_bloco_pagina t WHERE t.codigo = n.codigo);
