"""Carregador das tabelas do eSocial que o produto usa como catálogo oficial (recusas da carga, fase 2, K2, C5):
- tabela 03, natureza das rubricas da folha -> natureza_rubrica (código, nome, descrição, vigência);
- tabela 10, tipos de lotação tributária -> tabela_esocial ('esocial', '10') + codigo_esocial (código, descrição e, nos
  atributos, como preencher o número de inscrição).

Fonte: a mesma página pública das tabelas do leiaute do eSocial (gov.br/esocial) que o carregador logradouro lê,
catalogos/cache/logradouro/tabelas.html, baixada por `python3 -I catalogos/baixar.py logradouro` e registrada com o
SHA-256 em catalogos/cache/registro.tsv; a versão do leiaute registrada vai em versao_fonte. Nada é transcrito aqui:
o carregador lê as tabelas de id 03 e 10 do arquivo e recusa o arquivo sem elas ou fora da forma.

Idempotente. natureza_rubrica pela chave única (código, início da vigência); codigo_esocial pelo código dentro da
tabela 10 (uma linha por código, atualizada a cada versão; a tabela_esocial do '10' é uma só, para o de-para
codigo_esocial:10 do conector achar o pai). Nada é apagado: código que sai da tabela 10 ganha fim de vigência.
"""
import json
import re
import subprocess
from html.parser import HTMLParser
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ARQUIVO = RAIZ / "catalogos/cache/logradouro/tabelas.html"
REGISTRO = RAIZ / "catalogos/cache/registro.tsv"
FONTE = "logradouro"  # o arquivo das tabelas do eSocial é registrado com o nome da primeira fonte que o usou
URL = "https://www.gov.br/esocial/pt-br/documentacao-tecnica/leiautes-esocial-versao-s-1-3-nt-08-2026/tabelas.html"
MINIMO = {"03": 100, "10": 5}  # abaixo disso o arquivo está truncado ou mudou de forma
AVISOS = []


class _Tabela(HTMLParser):
    """Título (primeiro th) e linhas do corpo da tabela de id dado, célula a célula."""

    def __init__(self, id_tabela):
        super().__init__(convert_charrefs=True)
        self.id_tabela, self.dentro, self.corpo = id_tabela, False, False
        self.celula = self.linha = None
        self.titulo, self.linhas = "", []

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
        elif tag == "br" and self.celula is not None:
            self.celula.append(" ")

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


def _data(v):
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", v.strip())
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def _tabela(html, id_tabela, titulo, colunas):
    t = _Tabela(id_tabela)
    t.feed(html)
    if titulo not in t.titulo.lower():
        raise RuntimeError(f"esocial: a tabela {id_tabela} do arquivo não é a de {titulo}")
    for n, cels in enumerate(t.linhas, 1):
        if len(cels) != colunas or not cels[0] or not cels[1]:
            raise RuntimeError(f"esocial: tabela {id_tabela}, linha {n} fora da forma")
    if len(t.linhas) < MINIMO[id_tabela]:
        raise RuntimeError(f"esocial: só {len(t.linhas)} linhas na tabela {id_tabela}; arquivo incompleto?")
    return t.linhas


def ler(html):
    """{"03": [(código, nome, descrição, início, fim)], "10": [(código, descrição, preenchimento do nrInsc)]}."""
    naturezas, vistos = [], set()
    for n, (cod, nome, desc, ini, fim, _) in enumerate(_tabela(html, "03", "natureza das rubricas", 6), 1):
        di, df = _data(ini), _data(fim)
        if not re.fullmatch(r"\d{4}", cod) or not di or (fim.strip() not in ("-", "") and not df):
            raise RuntimeError(f"esocial: tabela 03, linha {n}: código ou vigência fora da forma")
        if df and df < di:
            AVISOS.append(f"tabela 03, linha {n}: fim de vigência antes do início, fica sem fim")
            df = None
        if (cod, di) in vistos:
            raise RuntimeError(f"esocial: tabela 03, linha {n}: código e início repetidos")
        vistos.add((cod, di))
        naturezas.append((cod, nome[:150], desc or None, di, df))
    lotacoes, cods = [], set()
    for n, (cod, desc, preench) in enumerate(_tabela(html, "10", "tipos de lotação tributária", 3), 1):
        if not re.fullmatch(r"\d{2}", cod) or cod in cods:
            raise RuntimeError(f"esocial: tabela 10, linha {n}: código fora da forma ou repetido")
        cods.add(cod)
        lotacoes.append((cod, desc[:300], preench))
    return {"03": naturezas, "10": lotacoes}


def versao():
    v = None
    if REGISTRO.exists():
        for ln in REGISTRO.read_text(encoding="utf-8").splitlines():
            c = ln.split("\t")
            if c[0] == FONTE and len(c) > 6 and c[6]:
                v = c[6]
    if not v:
        raise RuntimeError("esocial: arquivo das tabelas sem registro (python3 -I catalogos/baixar.py logradouro)")
    return v[:30]


def _q(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def gerar_sql(tab, v):
    """Script idempotente da carga (sem acesso ao banco: testável)."""
    nat = ",\n".join(f"({_q(c)}, {_q(n)}, {_q(d)}, {_q(i)}, {_q(f)}, {_q(v)}, UTC_TIMESTAMP(3), 1)"
                     for c, n, d, i, f in tab["03"])
    lot = ",\n".join(f"({_q(c)}, {_q(d)}, {_q(json.dumps({'preenchimento_numero_inscricao': p}, ensure_ascii=False))})"
                     for c, d, p in tab["10"])
    cods = ", ".join(_q(c) for c, _, _ in tab["10"])
    return f"""SET NAMES utf8mb4;
START TRANSACTION;
INSERT INTO natureza_rubrica (codigo_esocial, descricao, descricao_detalhada, vigencia_inicio, vigencia_fim, versao_fonte,
  criado_em, versao) VALUES
{nat}
ON DUPLICATE KEY UPDATE descricao = VALUES(descricao), descricao_detalhada = VALUES(descricao_detalhada),
  vigencia_fim = VALUES(vigencia_fim), versao_fonte = VALUES(versao_fonte);
INSERT INTO tabela_esocial (fonte, codigo_oficial, descricao, url_fonte, versao_fonte, criado_em, versao)
  SELECT 'esocial', '10', 'Tipos de lotação tributária', {_q(URL)}, {_q(v)}, UTC_TIMESTAMP(3), 1 FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM tabela_esocial WHERE fonte = 'esocial' AND codigo_oficial = '10');
SET @t = (SELECT MIN(id) FROM tabela_esocial WHERE fonte = 'esocial' AND codigo_oficial = '10');
UPDATE tabela_esocial SET versao_fonte = {_q(v)}, url_fonte = {_q(URL)}, quantidade_itens = {len(tab["10"])},
  carregado_em = UTC_TIMESTAMP(3) WHERE id = @t;
CREATE TEMPORARY TABLE tmp_lotacao_tributaria (codigo VARCHAR(20) NOT NULL, descricao VARCHAR(300) NOT NULL, atributos JSON);
INSERT INTO tmp_lotacao_tributaria VALUES
{lot};
UPDATE codigo_esocial c JOIN tmp_lotacao_tributaria t ON t.codigo = c.codigo_esocial
  SET c.descricao = t.descricao, c.atributos = t.atributos, c.vigencia_fim = NULL, c.versao_fonte = {_q(v)}
  WHERE c.tabela_esocial_id = @t;
INSERT INTO codigo_esocial (tabela_esocial_id, codigo_esocial, descricao, atributos, versao_fonte, criado_em, versao)
  SELECT @t, t.codigo, t.descricao, t.atributos, {_q(v)}, UTC_TIMESTAMP(3), 1 FROM tmp_lotacao_tributaria t
  WHERE NOT EXISTS (SELECT 1 FROM codigo_esocial c WHERE c.tabela_esocial_id = @t AND c.codigo_esocial = t.codigo);
UPDATE codigo_esocial SET vigencia_fim = COALESCE(vigencia_fim, UTC_DATE()), versao_fonte = {_q(v)}
  WHERE tabela_esocial_id = @t AND codigo_esocial NOT IN ({cods}) AND vigencia_fim IS NULL
    AND (vigencia_inicio IS NULL OR vigencia_inicio <= UTC_DATE());
DROP TEMPORARY TABLE tmp_lotacao_tributaria;
COMMIT;
SELECT (SELECT COUNT(*) FROM natureza_rubrica WHERE versao_fonte = {_q(v)}),
  (SELECT COUNT(*) FROM codigo_esocial WHERE tabela_esocial_id = @t AND vigencia_fim IS NULL);
"""


def carregar(banco: str) -> dict:
    if not ARQUIVO.exists():
        # nunca de outra fonte: sem o arquivo oficial, nada é carregado e o aviso fica no evento
        AVISOS.append("fonte das tabelas do eSocial não baixada: rode `python3 -I catalogos/baixar.py logradouro`")
        return {"natureza_rubrica": 0, "codigo_esocial_10": 0}
    tab = ler(ARQUIVO.read_text(encoding="utf-8"))
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco, "-N"], input=gerar_sql(tab, versao()),
                       capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"erro no SQL do carregador esocial: {r.stderr.strip()[:500]}")
    nat, lot = (int(x) for x in r.stdout.strip().splitlines()[-1].split())
    if nat != len(tab["03"]) or lot != len(tab["10"]):
        raise RuntimeError(f"esocial: esperava {len(tab['03'])} naturezas e {len(tab['10'])} lotações, ficaram {nat} e {lot}")
    return {"natureza_rubrica": nat, "codigo_esocial_10": lot}
