"""Base de controle por cliente `conector_ctl_<codigo>` e usuário MariaDB por execução, com GRANT só em
`cliente_<...>` (o banco do cliente) e `conector_ctl_<codigo>`. O motor grava só por esse usuário.

Guarda só metadados: tabela e chave original, entidade e id de destino, hash, imagem, pendência e conciliação.
"""
import ipaddress
import secrets

from .banco import escapar_curinga, nome_conta_motor, nome_seguro

# Privilégios nos bancos de cliente (sem DROP, TRIGGER, EVENT nem rotinas: regra de negócio nunca vai ao banco).
PRIVS_CLIENTE = ("SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, CREATE TEMPORARY TABLES,"
                 " LOCK TABLES, CREATE VIEW, SHOW VIEW")
PADROES_MOTOR = ("cliente_%", "conector_ctl_%")

DDL = """
CREATE TABLE IF NOT EXISTS {b}.imagem (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  execucao_id BIGINT UNSIGNED NOT NULL COMMENT 'conector_execucao.id na plataforma',
  arquivo VARCHAR(255) NOT NULL COMMENT 'Caminho relativo à pasta autorizada',
  tamanho_bytes BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NULL,
  corte_em DATETIME(6) NOT NULL COMMENT 'mtime do arquivo = horário de corte',
  ods_versao SMALLINT UNSIGNED NOT NULL,
  pagina_bytes INT UNSIGNED NOT NULL,
  tabelas INT UNSIGNED NOT NULL,
  registros_total BIGINT UNSIGNED NOT NULL,
  generators INT UNSIGNED NOT NULL,
  somente_leitura BOOLEAN NOT NULL COMMENT 'Banco aberto em modo somente leitura (no snapshot)',
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_imagem_execucao (execucao_id)
) COMMENT='Imagem da origem lida em cada execução (só metadados e contagens)';
CREATE TABLE IF NOT EXISTS {b}.imagem_tabela (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  imagem_id BIGINT UNSIGNED NOT NULL,
  tabela_origem VARCHAR(63) NOT NULL,
  registros BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_imagem_tabela (imagem_id, tabela_origem),
  CONSTRAINT fk_imagem_tabela_imagem_id FOREIGN KEY (imagem_id) REFERENCES {b}.imagem (id) ON DELETE RESTRICT
) COMMENT='Contagem por tabela da imagem';
CREATE TABLE IF NOT EXISTS {b}.conector_origem (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tabela_origem VARCHAR(63) NOT NULL,
  chave_original VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
                 COMMENT 'Chave da linha na origem (identificador técnico; binária: a origem diferencia maiúsculas)',
  entidade_destino VARCHAR(64) NOT NULL,
  id_destino BIGINT UNSIGNED NULL,
  hash_linha BINARY(16) NOT NULL COMMENT 'BLAKE2b-128 dos bytes crus da linha',
  imagem_id BIGINT UNSIGNED NOT NULL COMMENT 'Última imagem em que a linha foi vista',
  excluido_em DATETIME(3) NULL COMMENT 'Apagada na origem: exclusão lógica',
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_conector_origem_chave (tabela_origem, chave_original),
  KEY ix_conector_origem_destino (entidade_destino, id_destino)
) COMMENT='De-para linha da origem -> registro de destino, com o hash para o diferencial';
ALTER TABLE {b}.conector_origem MODIFY chave_original VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
  COMMENT 'Chave da linha na origem (identificador técnico; binária: a origem diferencia maiúsculas)';
ALTER TABLE {b}.conector_origem
  ADD COLUMN IF NOT EXISTS hash_destino BINARY(32) NULL
    COMMENT 'sha256 do resumo dos campos gravados no destino (texto em bytes CP1252): base da conciliação e do L9',
  ADD COLUMN IF NOT EXISTS regra_recusa VARCHAR(80) NULL COMMENT 'Regra que recusou a linha (nunca o valor)',
  ADD COLUMN IF NOT EXISTS gravidade_recusa VARCHAR(10) NULL;
CREATE TABLE IF NOT EXISTS {b}.conflito_sincronizar (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  execucao_id BIGINT UNSIGNED NOT NULL,
  tabela_origem VARCHAR(63) NOT NULL,
  chave_original VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  tabela_destino VARCHAR(64) NOT NULL,
  id_destino BIGINT UNSIGNED NOT NULL,
  colunas JSON NOT NULL COMMENT 'Colunas em que a edição do destino diverge da origem',
  edicao_destino JSON NOT NULL COMMENT 'Valores do destino ANTES do Sincronizar (a edição guardada)',
  valor_origem JSON NOT NULL COMMENT 'Valores da origem que venceram',
  decisao VARCHAR(20) NOT NULL DEFAULT 'origem_venceu',
  reaplicado_em DATETIME(3) NULL, reaplicado_por BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  KEY ix_conflito_sincronizar_execucao (execucao_id),
  KEY ix_conflito_sincronizar_destino (tabela_destino, id_destino),
  CONSTRAINT ck_conflito_sincronizar_decisao CHECK (decisao IN ('origem_venceu', 'destino_reaplicado'))
) COMMENT='Linha editada no destino E alterada na origem: a origem vence, a edição fica guardada (L9)';
CREATE TABLE IF NOT EXISTS {b}.conector_bloco (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tabela_origem VARCHAR(63) NOT NULL,
  bloco BIGINT NOT NULL COMMENT 'Início da faixa de 10 mil ids',
  hash_bloco BINARY(16) NOT NULL COMMENT 'BLAKE2b-128 dos hashes das linhas do bloco, na ordem da chave',
  linhas INT UNSIGNED NOT NULL,
  imagem_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_conector_bloco (tabela_origem, bloco)
) COMMENT='Hash por bloco de ids do diferencial (estado da última execução)';
CREATE TABLE IF NOT EXISTS {b}.conector_generator (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(63) NOT NULL,
  valor BIGINT NOT NULL,
  execucao_id BIGINT UNSIGNED NOT NULL,
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_conector_generator (nome)
) COMMENT='Último valor lido de cada generator da origem (F4.7)';
CREATE TABLE IF NOT EXISTS {b}.pendencia (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  execucao_id BIGINT UNSIGNED NOT NULL,
  tabela_origem VARCHAR(63) NOT NULL,
  chave_original VARCHAR(500) NULL,
  regra VARCHAR(80) NOT NULL COMMENT 'Regra violada; nunca o valor',
  gravidade VARCHAR(10) NOT NULL,
  situacao VARCHAR(10) NOT NULL DEFAULT 'aberta',
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  KEY ix_pendencia_execucao (execucao_id, situacao),
  CONSTRAINT ck_pendencia_gravidade CHECK (gravidade IN ('critica','alta','media','baixa')),
  CONSTRAINT ck_pendencia_situacao CHECK (situacao IN ('aberta','resolvida'))
) COMMENT='Pendências do conector: tabela, chave original e regra, sem valores';
ALTER TABLE {b}.pendencia
  ADD COLUMN IF NOT EXISTS detalhe VARCHAR(80) NULL
    COMMENT 'C7: metadado da recusa pelo destino (coluna, restrição ou chave); nunca o valor',
  ADD COLUMN IF NOT EXISTS resolvida_execucao_id BIGINT UNSIGNED NULL
    COMMENT 'Execução que não repetiu a pendência (origem corrigida ou destino decidido)',
  ADD INDEX IF NOT EXISTS ix_pendencia_regra (tabela_origem, regra, chave_original(190)),
  ADD INDEX IF NOT EXISTS ix_pendencia_resolvida (resolvida_execucao_id);
CREATE TABLE IF NOT EXISTS {b}.conector_tabela_concluida (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  execucao_id BIGINT UNSIGNED NOT NULL COMMENT 'conector_execucao.id na plataforma',
  imagem_id BIGINT UNSIGNED NOT NULL,
  tabela_origem VARCHAR(63) NOT NULL,
  onda INT UNSIGNED NULL COMMENT 'Onda da carga paralela (índice a partir de 0); NULL na herdada',
  origem VARCHAR(12) NOT NULL COMMENT 'carregada nesta execução ou continuada (concluída pela execução continuada)',
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_conector_tabela_concluida (execucao_id, tabela_origem),
  CONSTRAINT ck_conector_tabela_concluida_origem CHECK (origem IN ('carregada', 'continuada'))
) COMMENT='Tabela da carga pelo mapa concluída e commitada em cada execução: base da continuação (continuar.py)';
CREATE TABLE IF NOT EXISTS {b}.conciliacao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  execucao_id BIGINT UNSIGNED NOT NULL,
  entidade VARCHAR(64) NOT NULL,
  registros_origem BIGINT UNSIGNED NOT NULL,
  registros_destino BIGINT UNSIGNED NOT NULL,
  pendencias BIGINT UNSIGNED NOT NULL DEFAULT 0,
  soma_controle VARCHAR(64) NULL,
  conferido BOOLEAN NOT NULL,
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_conciliacao (execucao_id, entidade)
) COMMENT='Conciliação por entidade em cada execução (contagens e soma de controle)'
"""


def nome_ctl(codigo):
    return nome_seguro("conector_ctl_" + codigo)


def preparar(conn, codigo, banco_cliente):
    """Garante a base de controle do cliente. Recusa se o banco do cliente não existir."""
    nome_seguro(banco_cliente)
    if banco_cliente != "cliente_" + codigo:
        raise RuntimeError("banco do cliente fora do padrão cliente_<codigo>")
    ctl = nome_ctl(codigo)
    with conn.cursor() as c:
        c.execute("SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name=%s", (banco_cliente,))
        if not c.fetchone()[0]:
            raise RuntimeError("banco do cliente inexistente")
        c.execute("CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci" % ctl)
        for st in DDL.format(b="`%s`" % ctl).split(";\n"):
            if st.strip():
                c.execute(st)
    return ctl


def host_do_motor(conn):
    """Endereço do motor como o servidor o vê: o usuário da execução só entra dali."""
    with conn.cursor() as c:
        c.execute("SELECT SUBSTRING_INDEX(USER(), '@', -1)")
        return c.fetchone()[0]


def criar_usuario(conn, nome, banco_cliente, ctl, host):
    """Usuário só desta execução, senha aleatória em memória, GRANT só nos dois bancos do cliente."""
    nome_seguro(banco_cliente); nome_seguro(ctl)
    if not nome.startswith("sscon_") or not nome.replace("_", "").isalnum() or len(nome) > 80:
        raise ValueError("nome de usuário inválido")
    senha = secrets.token_urlsafe(24)
    with conn.cursor() as c:
        c.execute("DROP USER IF EXISTS %s@%s", (nome, host))
        c.execute("CREATE USER %s@%s IDENTIFIED BY %s", (nome, host, senha))
        for b in (banco_cliente, ctl):  # `_` escapado: o GRANT vale só para este banco, não por curinga
            c.execute("GRANT %s ON `%s`.* TO %%s@%%s" % (PRIVS_CLIENTE, escapar_curinga(b)), (nome, host))
    return senha


def host_da_rede(cidr):
    """Sub-rede Docker interna (`172.20.0.0/16`) no formato de host do MariaDB (`172.20.0.0/255.255.0.0`)."""
    r = ipaddress.ip_network(cidr, strict=False)
    if r.version != 4:
        raise ValueError("sub-rede IPv4 esperada")
    return "%s/%s" % (r.network_address, r.netmask)


def criar_conta_motor(conn, plat, senha, host):
    """Conta restrita do motor (feita pela root, fora do trabalhador): DML na plataforma, CREATE USER, e os
    privilégios de cliente com GRANT OPTION só nos padrões `cliente\\_%` e `conector\\_ctl\\_%`."""
    nome = nome_conta_motor(plat)
    if not senha or len(senha) < 20:
        raise ValueError("senha da conta do motor fraca ou ausente")
    with conn.cursor() as c:
        c.execute("CREATE USER IF NOT EXISTS %s@%s IDENTIFIED BY %s", (nome, host, senha))
        c.execute("ALTER USER %s@%s IDENTIFIED BY %s", (nome, host, senha))
        c.execute("REVOKE ALL PRIVILEGES, GRANT OPTION FROM %s@%s", (nome, host))
        c.execute("GRANT CREATE USER ON *.* TO %s@%s", (nome, host))
        c.execute("GRANT SELECT, INSERT, UPDATE ON `%s`.* TO %%s@%%s" % escapar_curinga(plat), (nome, host))
        for p in PADROES_MOTOR:
            esc = p.replace("_", "\\_").replace("%", "%%")  # %% = % literal para o pymysql
            c.execute("GRANT %s ON `%s`.* TO %%s@%%s WITH GRANT OPTION" % (PRIVS_CLIENTE, esc), (nome, host))
    return nome


def remover_usuario(conn, nome, host):
    with conn.cursor() as c:
        c.execute("DROP USER IF EXISTS %s@%s", (nome, host))
