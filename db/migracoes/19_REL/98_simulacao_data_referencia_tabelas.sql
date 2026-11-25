-- Simulação de receita (F8, 01-ADM L120, 25/11/2026): o recorte de data da produção base (competência da conta ou data
-- do atendimento) passa a ser premissa gravada do cenário. A execução lê o recorte do cenário, e simular de novo usa o
-- mesmo recorte que foi salvo. Pela competência, o período gravado começa e termina no dia 1 do mês (a competência da
-- conta é sempre o dia 1). Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho: a regra é do domínio
-- (@sgh/dominio-faturamento, simulacao-receita, normalizarPeriodoCenario) e a porta própria grava o valor.
ALTER TABLE cenario_simulacao_receita
  ADD COLUMN IF NOT EXISTS data_referencia VARCHAR(20) NOT NULL DEFAULT 'competencia'
    COMMENT 'Recorte de data da produção base: competência da conta ou data do atendimento' AFTER producao_fim,
  DROP CONSTRAINT IF EXISTS ck_cenario_simulacao_receita_data_referencia,
  ADD CONSTRAINT ck_cenario_simulacao_receita_data_referencia
    CHECK (data_referencia IN ('competencia','atendimento'));
