-- Nota clínica em quatro partes codificada (F8, 03-PEP L98, 25/11/2026): a configuração da nota passa a dizer se a
-- classificação da atenção primária (CIAP-2) aparece nos códigos e se a assinatura exige o CID-10 na avaliação (padrão
-- do hospital: CID-10 obrigatório na avaliação, CIAP-2 desligada). Só para frente e idempotente (ADR 0002, parte 2).
-- Sem gatilho: a regra é do domínio (@sgh/dominio-pep, nota-soap, validarNotaSoap) e a porta própria grava o valor.
ALTER TABLE configuracao_nota_soap
  ADD COLUMN IF NOT EXISTS usa_ciap BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'Mostra e aceita o código da classificação da atenção primária (CIAP-2) na nota' AFTER exige_plano,
  ADD COLUMN IF NOT EXISTS exige_cid_avaliacao BOOLEAN NOT NULL DEFAULT TRUE
    COMMENT 'A assinatura exige ao menos um CID-10 na avaliação' AFTER usa_ciap;
