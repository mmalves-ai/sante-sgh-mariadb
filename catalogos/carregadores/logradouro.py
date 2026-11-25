"""Carregador das espécies de logradouro (02-CAD linha 14): rua, avenida, travessa e as demais, da lista pública
oficial de tipos de logradouro (Tabela 20 das tabelas do leiaute do eSocial, publicada em gov.br/esocial).

Fonte: catalogos/cache/logradouro/tabelas.html, baixado por `python3 -I catalogos/baixar.py logradouro` e registrado
com o SHA-256 em catalogos/cache/registro.tsv. A versão (a do leiaute) vai em versao_fonte. Nada é transcrito aqui:
o carregador lê a tabela de id 20 do arquivo baixado (código e descrição) e recusa o arquivo sem ela.

Destino: especie_logradouro, pela chave única do código oficial (codigo_esocial; a sigla é o próprio código, que é a
abreviatura do tipo). Idempotente: INSERT ... ON DUPLICATE KEY UPDATE. Um tipo que saia da tabela não é apagado: a
nova versão o marca inativo com fim de vigência (o endereço gravado continua legível). O código da base postal
(catálogo licenciado) e o do cadastro nacional de usuários de saúde não vêm desta fonte e ficam como estão.
"""
import re
import subprocess
from html.parser import HTMLParser
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ARQUIVO = RAIZ / "catalogos/cache/logradouro/tabelas.html"
REGISTRO = RAIZ / "catalogos/cache/registro.tsv"
FONTE = "logradouro"
ID_TABELA = "20"
TITULO = "tipos de logradouro"
MINIMO = 50  # a tabela oficial tem bem mais; abaixo disso o arquivo está truncado ou mudou de forma
AVISOS = []

# Código oficial: até 4 caracteres, letras maiúsculas e dígitos, com espaço ou hífen no meio (ex.: duas letras separadas).
_CODIGO = re.compile(r"^[A-Z0-9](?:[A-Z0-9 -]{0,2}[A-Z0-9])?$")


class _Tabela(HTMLParser):
    """Lê a tabela de id dado: o título (cabeçalho) e as linhas do corpo, célula a célula."""

    def __init__(self, id_tabela):
        super().__init__(convert_charrefs=True)
        self.id_tabela = id_tabela
        self.dentro = False
        self.corpo = False
        self.celula = None
        self.linha = None
        self.titulo = ""
        self.linhas = []

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.dentro = dict(attrs).get("id") == self.id_tabela
        elif not self.dentro:
            return
        elif tag == "tbody":
            self.corpo = True
        elif tag == "tr" and self.corpo:
            self.linha = []
        elif tag in ("td", "th"):
            self.celula = []

    def handle_endtag(self, tag):
        if not self.dentro:
            return
        if tag == "table":
            self.dentro = self.corpo = False
        elif tag == "tbody":
            self.corpo = False
        elif tag in ("td", "th") and self.celula is not None:
            texto = " ".join("".join(self.celula).split())
            if self.linha is not None:
                self.linha.append(texto)
            elif tag == "th" and not self.titulo:
                self.titulo = texto
            self.celula = None
        elif tag == "tr" and self.linha is not None:
            self.linhas.append(self.linha)
            self.linha = None

    def handle_data(self, data):
        if self.dentro and self.celula is not None:
            self.celula.append(data)


def ler(html: str):
    """[(código, descrição)] da tabela oficial de tipos de logradouro, em ordem de código. Recusa o arquivo sem a
    tabela, com outro título, com código fora da forma, repetido ou com menos linhas que o mínimo."""
    t = _Tabela(ID_TABELA)
    t.feed(html)
    if TITULO not in t.titulo.lower():
        raise RuntimeError(f"logradouro: a tabela {ID_TABELA} do arquivo não é a de tipos de logradouro")
    saida = {}
    for n, cels in enumerate(t.linhas, 1):
        if len(cels) != 2 or not _CODIGO.fullmatch(cels[0]) or not cels[1]:
            raise RuntimeError(f"logradouro: linha {n} da tabela fora da forma (código e descrição)")
        if cels[0] in saida:
            raise RuntimeError(f"logradouro: código repetido na linha {n} da tabela")
        saida[cels[0]] = cels[1][:150]
    if len(saida) < MINIMO:
        raise RuntimeError(f"logradouro: só {len(saida)} tipos na tabela (mínimo {MINIMO}); arquivo incompleto?")
    return sorted(saida.items())


def versao() -> str:
    """Versão registrada do arquivo baixado (a última linha da fonte no registro do cache)."""
    v = None
    if REGISTRO.exists():
        for ln in REGISTRO.read_text(encoding="utf-8").splitlines():
            c = ln.split("\t")
            if c[0] == FONTE and len(c) > 6 and c[6]:
                v = c[6]
    if not v:
        raise RuntimeError("logradouro: arquivo sem registro (python3 -I catalogos/baixar.py logradouro)")
    return v[:30]


def _txt(v: str) -> str:
    return "'" + v.replace("\\", "\\\\").replace("'", "''") + "'"


def _sql(banco, entrada):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco], input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"erro no SQL ({banco}): {r.stderr.strip()[:2000]}")
    return r.stdout


def carregar(banco: str) -> dict:
    if not ARQUIVO.exists():
        # sem a tabela oficial baixada, nada é carregado (nunca de outra fonte): o aviso fica no evento da carga
        AVISOS.append(f"fonte {FONTE} não baixada: rode `python3 -I catalogos/baixar.py {FONTE}` e carregue de novo")
        return {"especie_logradouro": 0}
    ls = ler(ARQUIVO.read_text(encoding="utf-8"))
    v = _txt(versao())
    vals = ",\n".join(f"({_txt(c)}, {_txt(d)})" for c, d in ls)
    codigos = ", ".join(_txt(c) for c, _ in ls)
    script = f"""SET NAMES utf8mb4;
START TRANSACTION;
CREATE TEMPORARY TABLE tmp_especie_logradouro (codigo VARCHAR(4) NOT NULL, descricao VARCHAR(150) NOT NULL);
INSERT INTO tmp_especie_logradouro VALUES
{vals};
INSERT INTO especie_logradouro (codigo_esocial, descricao, sigla, ativo, versao_fonte, criado_em, versao)
SELECT t.codigo, t.descricao, t.codigo, TRUE, {v}, UTC_TIMESTAMP(3), 1 FROM tmp_especie_logradouro t
ON DUPLICATE KEY UPDATE descricao = VALUES(descricao), sigla = VALUES(sigla), ativo = TRUE, vigencia_fim = NULL,
  versao_fonte = VALUES(versao_fonte);
UPDATE especie_logradouro SET ativo = FALSE, vigencia_fim = COALESCE(vigencia_fim, UTC_DATE()), versao_fonte = {v}
 WHERE codigo_esocial IS NOT NULL AND codigo_esocial NOT IN ({codigos}) AND ativo;
COMMIT;
SELECT COUNT(*) FROM especie_logradouro WHERE ativo AND versao_fonte = {v};
"""
    total = int(_sql(banco, script).strip().splitlines()[-1])
    if total != len(ls):
        raise RuntimeError(f"especie_logradouro: esperava {len(ls)} tipos ativos, ficaram {total}")
    return {"especie_logradouro": total}
