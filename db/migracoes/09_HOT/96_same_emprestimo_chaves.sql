-- SAME: solicitação e empréstimo de prontuário (F3.9-5, 04-HOT L128): as chaves das colunas novas. Idempotente.
ALTER TABLE emprestimo_prontuario ADD CONSTRAINT fk_emprestimo_prontuario_solicitacao FOREIGN KEY IF NOT EXISTS (solicitacao_prontuario_id) REFERENCES solicitacao_prontuario (id) ON DELETE RESTRICT;
