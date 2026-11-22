-- RH, lote 30 (era o 06; renumerado na junção com o conector, que usou o mesmo número) (F2.2 ondas finais, onda 5c; pedido do lote 05-16). Convenções do ADR 0002 (parte 2). Só para frente.
-- Sem FOREIGN KEY: a tabela só guarda contagens da rede inteira (nenhum id de pessoa nem de estabelecimento).

-- 05-16: retrato diário da validade do registro no conselho dos colaboradores (M52.1). O worker calcula pela regra do
-- domínio e grava pela operação pessoas.registrar_retrato_conselho (Executor); rodar de novo no mesmo dia refaz a linha.
CREATE TABLE retrato_validade_conselho (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dia           DATE NOT NULL COMMENT 'Dia civil do retrato (refeito se o worker rodar de novo no dia)',
  janela_dias   SMALLINT UNSIGNED NOT NULL COMMENT 'Janela de alerta do parâmetro pessoas.alertaConselhoDias usada',
  registros     INT UNSIGNED NOT NULL COMMENT 'Inscrições ativas de colaboradores ativos',
  vencidos      INT UNSIGNED NOT NULL COMMENT 'Inscrições com a validade vigente já vencida no dia',
  a_vencer      INT UNSIGNED NOT NULL COMMENT 'Inscrições que vencem dentro da janela de alerta',
  sem_validade  INT UNSIGNED NOT NULL COMMENT 'Inscrições sem validade conhecida',
  criado_em     DATETIME(3) NOT NULL,
  criado_por    BIGINT UNSIGNED NULL,
  alterado_em   DATETIME(3) NULL,
  alterado_por  BIGINT UNSIGNED NULL,
  versao        INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_retrato_validade_conselho_contagens CHECK (vencidos + a_vencer + sem_validade <= registros),
  UNIQUE KEY uq_retrato_validade_conselho_dia (dia)
) COMMENT='Retrato diário da validade do registro no conselho dos colaboradores (só contagens; sem dado de pessoa)';
