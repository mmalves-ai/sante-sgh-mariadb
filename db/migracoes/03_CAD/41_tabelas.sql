-- ADR 0009 (dono, 2026-11-22): cadastro do convênio. Só para frente; convenções do ADR 0002 (parte 2).
-- O credenciamento profissional × convênio já existe (profissional_fonte_pagadora, com vigência, plano e
-- estabelecimento); o plano superior (subplano) já existe em plano_fonte_pagadora.plano_superior_id.
-- O preço por médico em convênio NÃO existe (decisão 24): o valor_consulta duplicado sai em 12_FAT/31_tabelas.sql,
-- depois de copiado para regra_preco_particular (só o das fontes de tipo particular).

ALTER TABLE fonte_pagadora
  ADD COLUMN bloqueia_sem_credenciamento BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Atender com profissional sem credenciamento vigente: falso = só alerta (padrão); verdadeiro = recusa (decisão 25)',
  ADD COLUMN credencia_todos_ao_criar BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Convênio novo credencia todos os profissionais ativos ao ser criado (decisão 26; ligada no cliente importado por continuidade)',
  ADD COLUMN codigo_permissao_atendimento SMALLINT UNSIGNED NULL COMMENT 'Código de permissão de atendimento como a origem o guarda; devolvido sem mudança pela API de compatibilidade (ADR 0008)';
