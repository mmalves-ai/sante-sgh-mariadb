-- PEP, processo de enfermagem ligado à terminologia com que foi registrado (família sae-terminologia, fecho-1,
-- correção da revisão, 24/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho.
-- O processo guarda o pacote (NNN, CIPE ou SINT, o sintético) e a versão vigente da terminologia no registro (a edição
-- licenciada carregada, ou o rótulo das edições vigentes de mais de um pacote); a leitura devolve os dois, e o serviço
-- resolve as descrições das características e dos fatores quando a terminologia em uso é a mesma. Processo registrado
-- antes desta migração fica com os dois nulos (a leitura cai no que havia: o sistema pelo termo do diagnóstico).
ALTER TABLE processo_enfermagem
  ADD COLUMN IF NOT EXISTS pacote_terminologia VARCHAR(10) NULL
    COMMENT 'Pacote da terminologia em uso no registro: NNN (NANDA-I, NIC e NOC), CIPE ou SINT (sintético)' AFTER avaliacao,
  ADD COLUMN IF NOT EXISTS edicao_terminologia VARCHAR(100) NULL
    COMMENT 'Versão da terminologia em uso no registro (vazia: o catálogo de uso, sem edição carregada)' AFTER pacote_terminologia;
ALTER TABLE processo_enfermagem
  ADD CONSTRAINT IF NOT EXISTS ck_processo_enfermagem_pacote_terminologia CHECK (
    (pacote_terminologia IS NULL AND edicao_terminologia IS NULL)
    OR pacote_terminologia IN ('NNN','CIPE','SINT'));
