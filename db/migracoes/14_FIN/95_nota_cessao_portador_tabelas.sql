-- Nota de crédito e de débito aplicada à parcela e operação de desconto ou cessão pelo portador (07-FIN linhas 70 e
-- 79, F8, 24/11/2026): só para frente e idempotente (ADR 0002, parte 2). Sem gatilho; as regras ficam no domínio
-- (@sgh/dominio-financeiro, nota-credito-cessao.ts) e nas operações (apps/api/src/modulos/financeiro/
-- nota-cessao-propria.ts).
-- A nota ajusta UMA parcela do título (a escolhida, ou a mais antiga em aberto): a parcela e o efeito ficam gravados
-- para o cancelamento desfazer exatamente o que a aplicação fez, sem apagar nada.
-- A operação de desconto ou cessão guarda o portador que a fez: o limite do portador soma as operações vivas dele.
ALTER TABLE nota_credito_debito
  ADD COLUMN IF NOT EXISTS parcela_pagar_id BIGINT UNSIGNED NULL COMMENT 'Parcela a pagar ajustada pela nota' AFTER titulo_receber_id,
  ADD COLUMN IF NOT EXISTS parcela_receber_id BIGINT UNSIGNED NULL COMMENT 'Parcela a receber ajustada pela nota' AFTER parcela_pagar_id,
  ADD COLUMN IF NOT EXISTS efeito VARCHAR(10) NULL COMMENT 'abate ou acresce: o que a nota faz no título' AFTER parcela_receber_id,
  ADD COLUMN IF NOT EXISTS valor_ajuste DECIMAL(15,2) NULL COMMENT 'Total menos os tributos retidos: o quanto a parcela muda' AFTER efeito,
  ADD COLUMN IF NOT EXISTS aplicada_em DATETIME(3) NULL COMMENT 'Quando o ajuste foi feito na parcela' AFTER valor_ajuste,
  ADD KEY IF NOT EXISTS ix_nota_credito_debito_parcela_pagar_id (parcela_pagar_id),
  ADD KEY IF NOT EXISTS ix_nota_credito_debito_parcela_receber_id (parcela_receber_id);
ALTER TABLE nota_credito_debito
  ADD CONSTRAINT IF NOT EXISTS ck_nota_credito_debito_efeito CHECK (efeito IS NULL OR efeito IN ('abate','acresce')),
  ADD CONSTRAINT IF NOT EXISTS ck_nota_credito_debito_aplicada CHECK (situacao <> 'aplicada' OR (aplicada_em IS NOT NULL AND efeito IS NOT NULL AND valor_ajuste > 0 AND (parcela_pagar_id IS NOT NULL) + (parcela_receber_id IS NOT NULL) = 1));

ALTER TABLE operacao_cessao_recebivel
  ADD COLUMN IF NOT EXISTS portador_titulo_id BIGINT UNSIGNED NULL COMMENT 'Portador (banco do desconto, cessionário ou fomento) da operação' AFTER conta_bancaria_id,
  ADD COLUMN IF NOT EXISTS cancelada_em DATETIME(3) NULL AFTER situacao,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(500) NULL AFTER cancelada_em,
  ADD KEY IF NOT EXISTS ix_operacao_cessao_recebivel_portador_titulo_id (portador_titulo_id);
ALTER TABLE operacao_cessao_recebivel
  ADD CONSTRAINT IF NOT EXISTS ck_operacao_cessao_recebivel_cancelamento CHECK (situacao <> 'cancelada' OR (cancelada_em IS NOT NULL AND motivo_cancelamento IS NOT NULL));

ALTER TABLE operacao_cessao_recebivel_item
  ADD COLUMN IF NOT EXISTS liquidada_em DATE NULL COMMENT 'Quando o sacado pagou ao portador' AFTER situacao;

ALTER TABLE nota_credito_debito ADD CONSTRAINT fk_nota_credito_debito_parcela_pagar_id FOREIGN KEY IF NOT EXISTS (parcela_pagar_id) REFERENCES parcela_pagar (id) ON DELETE RESTRICT;
ALTER TABLE nota_credito_debito ADD CONSTRAINT fk_nota_credito_debito_parcela_receber_id FOREIGN KEY IF NOT EXISTS (parcela_receber_id) REFERENCES parcela_receber (id) ON DELETE RESTRICT;
ALTER TABLE operacao_cessao_recebivel ADD CONSTRAINT fk_operacao_cessao_recebivel_portador_titulo_id FOREIGN KEY IF NOT EXISTS (portador_titulo_id) REFERENCES portador_titulo (id) ON DELETE RESTRICT;

-- Valores padrão de produto (não do hospital): motivos usuais da nota e do cancelamento; o hospital acrescenta ou
-- desliga os seus. INSERT IGNORE pelo código: não reescreve o que o hospital já ajustou.
INSERT IGNORE INTO motivo_nota_credito_debito (codigo, descricao, natureza, exige_nota_referencia, criado_em) VALUES
  ('devolucao', 'Devolução de mercadoria ou serviço não prestado', 'credito', TRUE, NOW(3)),
  ('diferenca_preco', 'Diferença de preço ou de quantidade faturada', 'ambos', FALSE, NOW(3)),
  ('bonificacao', 'Bonificação ou desconto comercial concedido depois da emissão', 'credito', FALSE, NOW(3)),
  ('multa_contratual', 'Multa ou penalidade contratual', 'debito', FALSE, NOW(3)),
  ('juros_atraso', 'Juros ou encargos por atraso', 'debito', FALSE, NOW(3));
INSERT IGNORE INTO motivo_cancelamento_documento_fiscal (codigo, descricao, criado_em) VALUES
  ('erro_emissao', 'Erro de emissão (valor, contraparte ou título)', NOW(3)),
  ('acordo_desfeito', 'Acordo com a contraparte desfeito', NOW(3));
