-- PEP, porta própria dos documentos (família exames, anexos e termo de consentimento; pep-gravacao, 23/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). O termo de consentimento do paciente nunca é apagado nem reescrito: cada
-- mudança de situação (assinatura, revogação) é uma nova versão ligada à anterior por termo_anterior_id. A chave única
-- garante um só sucessor por versão (duas mudanças sobre a mesma leitura: a segunda é recusada como conflito de versão).
-- As regras do ciclo ficam no domínio e na porta; aqui só chaves e coerência.

ALTER TABLE termo_consentimento_paciente
  ADD COLUMN IF NOT EXISTS termo_anterior_id BIGINT UNSIGNED NULL COMMENT 'Versão anterior deste termo (a mudança de situação grava nova versão; nulo = primeira emissão)' AFTER arquivo_id,
  ADD UNIQUE KEY IF NOT EXISTS uq_termo_consentimento_paciente_anterior (termo_anterior_id);
