"""Conexão do motor com o MariaDB (só pelo container do conector, numa rede Docker interna sem saída).

Variáveis: CONECTOR_MARIADB_HOST (padrão `mariadb`), CONECTOR_MARIADB_PORTA (3306), CONECTOR_MARIADB_USUARIO (root),
CONECTOR_MARIADB_SENHA (vem do .env pelo conector.sh, nunca impressa), CONECTOR_PLATAFORMA_BANCO (plataforma).
"""
import hashlib
import os
import re

import pymysql
from pymysql.constants import CLIENT

NOME_BANCO = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
RESERVADOS = {"mysql", "information_schema", "performance_schema", "sys"}


def nome_seguro(nome):
    if not isinstance(nome, str) or not NOME_BANCO.match(nome) or nome in RESERVADOS:
        raise ValueError("nome de banco inválido")
    return nome


def plataforma_banco():
    return nome_seguro(os.environ.get("CONECTOR_PLATAFORMA_BANCO") or "plataforma")


def ficha_plataforma():
    """Ficha curta da plataforma usada em nomes de trava e de snapshot (várias plataformas no mesmo servidor)."""
    return hashlib.sha1(plataforma_banco().encode()).hexdigest()[:6]


def conectar(banco=None, usuario=None, senha=None, autocommit=True, multi=False):
    return pymysql.connect(
        host=os.environ.get("CONECTOR_MARIADB_HOST", "mariadb"),
        port=int(os.environ.get("CONECTOR_MARIADB_PORTA", 3306)),
        user=usuario or os.environ.get("CONECTOR_MARIADB_USUARIO", "root"),
        password=senha if senha is not None else os.environ.get("CONECTOR_MARIADB_SENHA", ""),
        database=banco, charset="utf8mb4", autocommit=autocommit, connect_timeout=10,
        client_flag=CLIENT.MULTI_STATEMENTS if multi else 0)


def aplicar_script(conn, texto):
    """Executa um script SQL inteiro (conexão com multi=True) e consome todos os resultados."""
    with conn.cursor() as c:
        c.execute(texto)
        while c.nextset():
            pass
