-- Kit de implantação (C2-025, 01-ADM L98, 25/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho;
-- Em 02_ADM (27/11): estava em 01_SIS/95 e rodava antes do CREATE TABLE modulo_sistema (02_ADM/02), o que fazia o
-- "criar novo cliente" recusar todo cliente novo (migracao-falhou).
-- as regras ficam no domínio (@sgh/dominio-config, prontidao/implantacao) e na porta (implantacao/kit-implantacao-propria).
--   - modulo_sistema: os módulos que o checklist padrão cita, com códigos de negócio (os que já existem ficam como estão).
--   - modelo_item_prontidao: o checklist padrão de cadastros mínimos e conferências de um hospital novo, sem origem.
--     O item de cadastro mínimo é conferido por contagem no banco do cliente: a `entidade` é a chave de uma contagem
--     conhecida da porta (lista fechada no código, nunca SQL vindo do banco). A plataforma edita o modelo; nada trava a
--     virada (ADR 0002: o checklist é informativo, a virada é decisão do cliente).

INSERT INTO modulo_sistema (codigo, descricao, ativo, ordem, criado_em) VALUES
  ('administracao', 'Administração', TRUE, 0, NOW(3)),
  ('cadastro', 'Cadastros', TRUE, 0, NOW(3)),
  ('internacao', 'Internação e leitos', TRUE, 0, NOW(3)),
  ('atendimento', 'Atendimento e recepção', TRUE, 0, NOW(3)),
  ('centro_cirurgico', 'Centro cirúrgico', TRUE, 0, NOW(3)),
  ('sadt', 'Diagnóstico e terapia', TRUE, 0, NOW(3)),
  ('faturamento', 'Faturamento', TRUE, 0, NOW(3)),
  ('estoque', 'Estoque', TRUE, 0, NOW(3)),
  ('financeiro', 'Financeiro', TRUE, 0, NOW(3))
ON DUPLICATE KEY UPDATE codigo = codigo;

INSERT INTO modelo_item_prontidao
  (codigo, titulo, descricao, modulo_sistema_id, tipo_verificacao, entidade, quantidade_minima, orientacao, ordem, critico,
   ativo, criado_em)
SELECT x.codigo, x.titulo, x.descricao, m.id, x.tipo, x.entidade, x.minima, x.orientacao, x.ordem, x.critico, TRUE, NOW(3)
  FROM (
    SELECT 'ADM-SETORES' AS codigo, 'Setores do estabelecimento' AS titulo,
           'Setores funcionais (assistenciais e administrativos) onde as pessoas trabalham' AS descricao,
           'administracao' AS modulo, 'cadastro_minimo' AS tipo, 'setor_funcional' AS entidade, 3 AS minima,
           'Cadastre ao menos a recepção, um setor assistencial e a administração.' AS orientacao, 10 AS ordem, TRUE AS critico
    UNION ALL SELECT 'ADM-USUARIOS', 'Usuários do sistema', 'Contas de acesso das pessoas da equipe', 'administracao',
           'cadastro_minimo', 'usuario', 2, 'Convide ao menos o responsável pela implantação e um usuário-chave.', 20, TRUE
    UNION ALL SELECT 'ADM-PERFIS', 'Perfis de acesso', 'Perfis com as permissões de cada função', 'administracao',
           'cadastro_minimo', 'perfil_acesso', 1, 'Use os perfis padrão e ajuste os do hospital.', 30, TRUE
    UNION ALL SELECT 'CAD-PROFISSIONAIS', 'Profissionais de saúde', 'Médicos e demais profissionais com conselho',
           'cadastro', 'cadastro_minimo', 'profissional', 1, 'Cadastre os profissionais com o número do conselho e o CBO.', 40, TRUE
    UNION ALL SELECT 'INT-UNIDADES', 'Unidades de internação', 'Unidades (postos) que agrupam os leitos', 'internacao',
           'cadastro_minimo', 'unidade_internacao', 1, NULL, 50, TRUE
    UNION ALL SELECT 'INT-LEITOS', 'Leitos', 'Leitos ativos ligados às unidades de internação', 'internacao',
           'cadastro_minimo', 'leito_hospitalar', 1, 'Os leitos SUS precisam da habilitação do CNES.', 60, TRUE
    UNION ALL SELECT 'FAT-CONVENIOS', 'Convênios atendidos', 'Operadoras de saúde habilitadas no estabelecimento',
           'faturamento', 'cadastro_minimo', 'operadora_saude_estabelecimento', 1,
           'Informe o registro ANS e a versão do padrão TISS de cada operadora.', 70, TRUE
    UNION ALL SELECT 'FAT-TABELAS', 'Tabelas de preço', 'Tabelas de preço vigentes para cobrança', 'faturamento',
           'cadastro_minimo', 'tabela_preco', 1, NULL, 80, TRUE
    UNION ALL SELECT 'SADT-EXAMES', 'Exames oferecidos', 'Catálogo de exames ativos', 'sadt', 'cadastro_minimo', 'exame', 1,
           NULL, 90, FALSE
    UNION ALL SELECT 'CC-SALAS', 'Salas cirúrgicas', 'Salas do centro cirúrgico', 'centro_cirurgico', 'cadastro_minimo',
           'sala_cirurgica', 1, NULL, 100, FALSE
    UNION ALL SELECT 'EST-LOCAIS', 'Locais de estoque', 'Almoxarifado, farmácia e subestoques', 'estoque',
           'cadastro_minimo', 'local_estoque', 1, NULL, 110, TRUE
    UNION ALL SELECT 'FIN-CENTROS', 'Centros de custo', 'Centros de custo ativos do estabelecimento', 'financeiro',
           'cadastro_minimo', 'centro_custo', 1, NULL, 120, FALSE
    UNION ALL SELECT 'FIN-CONTAS', 'Contas bancárias', 'Contas bancárias para recebimento e pagamento', 'financeiro',
           'cadastro_minimo', 'conta_bancaria', 1, NULL, 130, FALSE
    UNION ALL SELECT 'ADM-HOMOLOGACAO', 'Homologação dos processos', 'Roteiros ponta a ponta executados pelos usuários-chave',
           'administracao', 'conferencia', NULL, NULL, 'Registre a evidência de cada roteiro executado.', 900, TRUE
    UNION ALL SELECT 'ADM-TREINAMENTO', 'Treinamento dos usuários-chave', 'Turmas de treinamento por setor', 'administracao',
           'treinamento', NULL, NULL, NULL, 910, FALSE
    UNION ALL SELECT 'ADM-IMPRESSORAS', 'Impressoras de etiqueta e pulseira', 'Equipamentos instalados e testados',
           'administracao', 'infraestrutura', NULL, NULL, NULL, 920, FALSE
  ) x
  JOIN modulo_sistema m ON m.codigo = x.modulo
ON DUPLICATE KEY UPDATE codigo = modelo_item_prontidao.codigo;
