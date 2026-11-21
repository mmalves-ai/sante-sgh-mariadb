"""Continuidade da operação do hospital (ADR 0006 e 0007, F4 rodada 5): peças genéricas que o motor
(`carga_mapa.py`) e as ferramentas do conector usam. Só nomes, contagens e regras saem daqui, nunca valores.

- Cofre de segredos do CLIENTE (ADR 0007, item 17): o `#cofre:<COLUNA>` grava o segredo da origem (senha de e-mail,
  token, certificado) CIFRADO em `segredo_cofre` do banco do cliente, no envelope `v1.<iv>.<tag>.<corpo>` (AES-256-GCM,
  base64url; o mesmo da API, `apps/api/src/modulos/assinatura/infra/cofre.ts`), com a chave mestra do deploy
  (`PLATAFORMA_CHAVE_MESTRA`, 32 bytes em base64). A coluna do destino recebe só a referência
  `cofre:migracao/<tabela>/<coluna>/<resumo>`. Sem chave ou sem biblioteca: falha fechada (NULL e a pendência
  `segredo_aguarda_cofre`, como antes); nunca em claro, nunca em log.
- Senha de login (item 17): legível ou reversível na origem vira argon2id já na carga (`#senha:<COLUNA>`); hash de
  algoritmo conhecido (`#senha_hash:<COLUNA>:<algoritmo>`) é importado como está, conferido pelo formato, com o
  algoritmo marcado na credencial para a API regravar em argon2id no primeiro login.
- Mescla não destrutiva (item 20): a linha adotada recebe só o que está vazio no destino; o conflito mantém o destino
  e guarda o valor da origem em `historico_mescla_migracao` (banco do cliente, visível ao hospital).
- Prova de "não copiar" (ADR 0006, item 1): `comparar` confronta as linhas da origem com as recalculadas no destino.
- Vigência pela evidência (item 16): colunas de data que indicam criação ou início (`colunas_de_evidencia`).
"""
import base64
import datetime
import hashlib
import os
import re

# ---------------- DDL das tabelas de continuidade no banco do cliente (mesmo texto de db/migracoes/17_INTG/41) ----
DDL_COFRE = """CREATE TABLE IF NOT EXISTS segredo_cofre (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  referencia VARCHAR(200) NOT NULL COMMENT 'Referência gravada na coluna que usa o segredo (cofre:...)',
  envelope TEXT NOT NULL COMMENT 'Segredo cifrado: v1.<iv>.<tag>.<corpo> (AES-256-GCM, base64url); nunca em claro',
  versao_chave VARCHAR(20) NOT NULL DEFAULT 'v1' COMMENT 'Versão do envelope e da chave mestra (rotação)',
  finalidade VARCHAR(60) NOT NULL COMMENT 'Tabela e coluna do destino que usam o segredo',
  origem VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT ck_segredo_cofre_referencia CHECK (referencia LIKE 'cofre:%'),
  CONSTRAINT ck_segredo_cofre_origem CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_segredo_cofre_referencia (referencia)
) COMMENT='Cofre de segredos do cliente: credenciais cifradas com a chave mestra do deploy; a tabela de uso guarda só a referência'"""

DDL_MESCLA = """CREATE TABLE IF NOT EXISTS historico_mescla_migracao (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tabela_destino VARCHAR(64) NOT NULL COMMENT 'Tabela do registro que já existia e foi adotado',
  registro_id BIGINT UNSIGNED NOT NULL COMMENT 'Id do registro adotado (mantido como estava na coluna em conflito)',
  coluna VARCHAR(64) NOT NULL,
  valor_origem TEXT NULL COMMENT 'Valor que a origem trazia para a coluna (o do destino foi mantido)',
  tabela_origem VARCHAR(63) NOT NULL,
  chave_origem VARCHAR(500) NOT NULL,
  criado_em DATETIME(3) NOT NULL, criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL, versao INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_historico_mescla_migracao (tabela_destino, registro_id, coluna, tabela_origem, chave_origem),
  KEY ix_historico_mescla_migracao_registro (tabela_destino, registro_id)
) COMMENT='Mescla não destrutiva da migração: valor da origem guardado quando o destino já tinha outro'"""

# ---------------- cofre ----------------
VERSAO_ENVELOPE = "v1"


def chave_mestra(env=None):
    """Chave mestra do deploy (32 bytes, base64 em PLATAFORMA_CHAVE_MESTRA) ou None (cofre indisponível)."""
    t = ((env if env is not None else os.environ).get("PLATAFORMA_CHAVE_MESTRA") or "").strip()
    if not t:
        return None
    try:
        b = base64.b64decode(t + "=" * (-len(t) % 4))
    except (ValueError, TypeError):
        return None
    return b if len(b) == 32 else None


def _b64(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def cifrar(chave, valor):
    """Envelope v1 (AES-256-GCM). None sem a biblioteca de cifra (falha fechada)."""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        return None
    iv = os.urandom(12)
    ct = AESGCM(chave).encrypt(iv, valor.encode("utf-8"), None)
    return ".".join([VERSAO_ENVELOPE, _b64(iv), _b64(ct[-16:]), _b64(ct[:-16])])


def decifrar(chave, envelope):
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        v, iv, tag, corpo = envelope.split(".")
        if v != VERSAO_ENVELOPE:
            return None
        return AESGCM(chave).decrypt(_unb64(iv), _unb64(corpo) + _unb64(tag), None).decode("utf-8")
    except Exception:  # noqa: BLE001 (envelope inválido ou chave errada: nada a revelar)
        return None


def referencia_cofre(tabela_destino, coluna, tabela_origem, chave):
    """Referência estável (a mesma em toda execução): o resumo é da tabela e da chave da origem, nunca do segredo."""
    r = hashlib.sha256(("%s|%s" % (tabela_origem, chave)).encode("utf-8")).hexdigest()[:24]
    return "cofre:migracao/%s/%s/%s" % (tabela_destino, coluna, r)


# ---------------- senha ----------------
# algoritmo conhecido -> formato do resumo importado (a API regrava em argon2id no 1º login: ADR 0007, item 17)
HASH_CONHECIDO = {
    "md5": re.compile(r"[0-9a-f]{32}"), "sha1": re.compile(r"[0-9a-f]{40}"),
    "sha256": re.compile(r"[0-9a-f]{64}"), "sha512": re.compile(r"[0-9a-f]{128}"),
    "bcrypt": re.compile(r"\$2[abxy]?\$[0-9]{2}\$[./A-Za-z0-9]{53}"),
    "scrypt": re.compile(r"\$scrypt\$.+|\$7\$.+"), "argon2id": re.compile(r"\$argon2id\$.+"),
}


def hash_importado(valor, algoritmo):
    """(resumo, regra): o resumo da origem no formato do algoritmo (hex em minúsculas; base64 da origem vira hex)
    ou (None, 'senha_hash_invalido')."""
    if valor is None:
        return None, None
    if isinstance(valor, (bytes, bytearray)):  # texto da origem sem charset, ou o resumo binário
        b = bytes(valor).rstrip(b" \x00")
        try:
            t = b.decode("ascii")
            valor = t if t.isprintable() else b.hex()
        except UnicodeDecodeError:
            valor = b.hex()
    s = str(valor).strip()
    if not s:
        return None, None
    rx = HASH_CONHECIDO.get(algoritmo)
    if rx is None:
        return None, "senha_hash_invalido"
    if algoritmo in ("md5", "sha1", "sha256", "sha512"):
        if not rx.fullmatch(s.lower()):
            try:  # base64 do resumo binário
                b = base64.b64decode(s, validate=True)
                s = b.hex()
            except (ValueError, TypeError):
                return None, "senha_hash_invalido"
        s = s.lower()
    return (s, None) if rx.fullmatch(s) else (None, "senha_hash_invalido")


def argon2id(senha):
    """Resumo argon2id (PHC) da senha legível ou reversível da origem; None sem a biblioteca."""
    try:
        from argon2 import PasswordHasher
    except ImportError:
        return None
    return PasswordHasher().hash(senha)


# ---------------- vigência pela evidência ----------------
_EVIDENCIA = re.compile(r"CAD|INCL|CRIA|INIC|^INI|_INI|DTINI|VIGEN|ABERT|REGIST|LANC|GRAV|EMIS|DATA$|^DT$|^DATA_?ATE|^DT_?ATE")
_NAO_EVIDENCIA = re.compile(r"NASC|VALID|VENC|FIM|ALT|ULT|EXCL|BAIXA|CANCEL|OBITO|SAIDA|ALTA|PREV|ENTREGA|FECH")
TIPOS_DATA = (12, 35)  # Firebird DATE, TIMESTAMP


def colunas_de_evidencia(colunas):
    """Das colunas [(nome, tipo)] da origem, as de data que indicam criação, início ou primeiro uso (nunca
    nascimento, validade, fim, alteração)."""
    return [n for n, t in colunas if t in TIPOS_DATA and _EVIDENCIA.search(n) and not _NAO_EVIDENCIA.search(n)]


def data_valida(x):
    """Data da origem como date (sem as sentinelas 1899/1900 nem datas futuras) ou None."""
    if isinstance(x, datetime.datetime):
        x = x.date()
    if not isinstance(x, datetime.date) or x.year <= 1900 or x > datetime.date.today():
        return None
    return x


# ---------------- prova de "não copiar" ----------------
def comparar(origem, destino):
    """Linhas {chave: valores (texto canônico)} da origem e do destino recalculado -> contagens da conciliação linha a
    linha (iguais, divergentes, faltando no destino, sobrando no destino) e `conferido`."""
    iguais = sum(1 for k, v in origem.items() if k in destino and destino[k] == v)
    div = sum(1 for k, v in origem.items() if k in destino and destino[k] != v)
    falta = sum(1 for k in origem if k not in destino)
    sobra = sum(1 for k in destino if k not in origem)
    return {"linhas_origem": len(origem), "linhas_destino": len(destino), "iguais": iguais, "divergentes": div,
            "faltando_no_destino": falta, "sobrando_no_destino": sobra,
            "conferido": div == 0 and falta == 0 and sobra == 0}
