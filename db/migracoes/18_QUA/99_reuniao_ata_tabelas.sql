-- Qualidade, reuniões das comissões no banco próprio (modulos-proprios-3, família qualidade-q4, 24/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2).
-- A reunião registrada pela tela guarda o retrato da ata: os nomes dos presentes como foram registrados (a composição
-- da comissão muda depois; a presença estruturada por membro continua em reuniao_comissao_participante), o total de
-- membros na data e os convidados em texto. O instante do cancelamento fica em coluna própria.
-- A assinatura da ata (ata_assinada_em/_por_usuario_id, chave e índice) vem de 18_QUA/23, e a assinatura da versão
-- anterior (assinatura_anterior_em/_por_usuario_id, CHECK e chave) vem de 18_QUA/96: não se repetem aqui.
ALTER TABLE reuniao_comissao
  ADD COLUMN IF NOT EXISTS presentes_registrados LONGTEXT NULL COMMENT 'Nomes dos presentes como registrados na ata (lista JSON)',
  ADD COLUMN IF NOT EXISTS membros_quantidade SMALLINT UNSIGNED NULL COMMENT 'Membros da composição na data da reunião',
  ADD COLUMN IF NOT EXISTS convidados TEXT NULL COMMENT 'Convidados sem cadastro, como registrados na ata',
  ADD COLUMN IF NOT EXISTS cancelada_em DATETIME(3) NULL COMMENT 'Instante do cancelamento da reunião lançada por engano',
  ADD COLUMN IF NOT EXISTS assinatura_anterior_em DATETIME(3) NULL COMMENT 'Assinatura da versão anterior, quando a ata assinada foi retificada',
  ADD COLUMN IF NOT EXISTS assinatura_anterior_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem assinou a versão anterior da ata retificada';

ALTER TABLE reuniao_comissao
  ADD CONSTRAINT IF NOT EXISTS ck_reuniao_comissao_presentes_registrados CHECK (presentes_registrados IS NULL OR JSON_VALID(presentes_registrados)),
  ADD CONSTRAINT IF NOT EXISTS ck_reuniao_comissao_presentes_quantidade CHECK (presentes_quantidade IS NULL OR membros_quantidade IS NULL OR presentes_quantidade <= membros_quantidade),
  ADD CONSTRAINT IF NOT EXISTS ck_reuniao_comissao_cancelada_em CHECK (cancelada_em IS NULL OR situacao = 'cancelada');

ALTER TABLE reuniao_comissao
  ADD CONSTRAINT IF NOT EXISTS ck_reuniao_comissao_assinatura_anterior CHECK ((assinatura_anterior_em IS NULL) = (assinatura_anterior_por_usuario_id IS NULL));
