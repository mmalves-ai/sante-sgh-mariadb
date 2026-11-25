-- Prontuário de acesso restrito (F8, 03-PEP L93, 25/11/2026): o limite de aberturas fica gravado na autorização, no
-- momento da concessão. A configuração da unidade mudada depois não altera de forma retroativa o que quem autorizou
-- concedeu. Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho: a regra é do domínio
-- (@sgh/dominio-pep, prontuario-restrito, avaliarAbertura) e a porta própria grava o valor.
ALTER TABLE autorizacao_acesso_prontuario_restrito
  ADD COLUMN IF NOT EXISTS limite_acessos INT UNSIGNED NULL
    COMMENT 'Limite de aberturas concedido (nulo = sem limite), copiado da configuração na concessão'
    CHECK (limite_acessos IS NULL OR limite_acessos BETWEEN 1 AND 999) AFTER vigencia_fim;
