"""Carregador das línguas indígenas (09-AREA linha 73, C1-099): as línguas faladas ou utilizadas pelos povos indígenas,
oferecidas no cadastro do paciente quando a raça/cor é indígena.

Fonte: a classificação oficial "Tronco, família linguística e língua indígena falada ou utilizada" (classificação 2105)
do Censo Demográfico 2022, publicada pelo IBGE nos metadados do agregado 10423 do serviço de dados
(servicodados.ibge.gov.br). O cadastro nacional de usuários e a RNDS não publicam tabela de línguas com código; a do
IBGE é a referência oficial com código. Baixada por `python3 -I catalogos/baixar.py idioma_indigena` e registrada com o
SHA-256 em catalogos/cache/registro.tsv. Nada é transcrito aqui: o carregador lê a hierarquia (tronco no nível 0,
família no nível 1, língua no nível 2) e recusa o arquivo fora da forma. As respostas do questionário que não são
língua ("Não determinada", "Não sabe", "Mal definida") não entram.

Destino: idioma_indigena, pela chave única do código do IBGE (uq_idioma_indigena_codigo_ibge, migração
03_CAD/99z_idioma_indigena_codigo_ibge). Idempotente: INSERT ... ON DUPLICATE KEY UPDATE. Uma língua que saia da
classificação não é apagada (o cadastro do paciente continua legível): a nova versão encerra a vigência dela na véspera.
Sem o arquivo baixado a carga não falha: fica o aviso e o cadastro mostra que a tabela ainda não foi carregada (a
língua é opcional e nada mais depende dela).
"""
import json
import re
import subprocess
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ARQUIVO = RAIZ / "catalogos/cache/idioma_indigena/metadados"
REGISTRO = RAIZ / "catalogos/cache/registro.tsv"
FONTE = "idioma_indigena"
CLASSIFICACAO = 2105
MINIMO = 150  # o Censo 2022 classifica mais de 250 línguas; abaixo disso o arquivo mudou de forma
CHAVE = "uq_idioma_indigena_codigo_ibge"
AVISOS = []

_NUMERO = re.compile(r"^(\d+(?:\.\d+)*)\.\s+(\S.*)$")


def ler_classificacao(dados: dict):
    """[(código, língua, família)] em ordem de código. Recusa a classificação ausente, nome sem a numeração
    hierárquica, nível que não bata com a numeração, língua fora de uma família, código repetido ou menos línguas que
    o mínimo. Nome de língua repetido em famílias diferentes leva a família entre parênteses."""
    cl = [c for c in dados.get("classificacoes", []) if c.get("id") == CLASSIFICACAO]
    if len(cl) != 1:
        raise RuntimeError(f"idioma: o arquivo não traz a classificação {CLASSIFICACAO} das línguas indígenas")
    tronco = familia = None
    linguas = {}
    for n, cat in enumerate(cl[0].get("categorias", []), 1):
        codigo, nome, nivel = str(cat.get("id", "")), " ".join(str(cat.get("nome", "")).split()), cat.get("nivel")
        m = _NUMERO.match(nome)
        if not re.fullmatch(r"\d{1,10}", codigo) or not m or nivel not in (0, 1, 2):
            raise RuntimeError(f"idioma: categoria {n} fora da forma (código, numeração hierárquica e nível 0 a 2)")
        if m.group(1).count(".") != nivel:
            raise RuntimeError(f"idioma: categoria {n} com nível que não bate com a numeração")
        rotulo = m.group(2)
        if nivel == 0:
            tronco, familia = rotulo, None
        elif nivel == 1:
            familia = rotulo
        else:
            if familia is None:
                raise RuntimeError(f"idioma: categoria {n} é língua fora de uma família")
            if codigo in linguas:
                raise RuntimeError(f"idioma: código repetido na categoria {n}")
            grupo = familia if familia == tronco or familia.startswith(tronco) else f"{tronco}, {familia}"
            linguas[codigo] = (rotulo[:150], grupo[:150])
    if len(linguas) < MINIMO:
        raise RuntimeError(f"idioma: só {len(linguas)} línguas (mínimo {MINIMO}); arquivo incompleto?")
    contagem = {}
    for nome, _ in linguas.values():
        contagem[nome.lower()] = contagem.get(nome.lower(), 0) + 1
    saida = []
    for codigo, (nome, grupo) in linguas.items():
        if contagem[nome.lower()] > 1:
            AVISOS.append(f"idioma {codigo}: nome repetido em outra família; gravado com a família entre parênteses")
            nome = f"{nome} ({grupo})"[:150]
        saida.append((codigo, nome, grupo))
    return sorted(saida, key=lambda x: int(x[0]))


def ler(arquivo: Path):
    return ler_classificacao(json.loads(arquivo.read_text(encoding="utf-8")))


def versao() -> str:
    """Versão registrada do arquivo baixado (a última linha da fonte no registro do cache)."""
    v = None
    if REGISTRO.exists():
        for ln in REGISTRO.read_text(encoding="utf-8").splitlines():
            c = ln.split("\t")
            if c[0] == FONTE and len(c) > 6 and c[6]:
                v = c[6]
    if not v:
        raise RuntimeError(f"idioma: arquivo sem registro (python3 -I catalogos/baixar.py {FONTE})")
    return v[:30]


def _txt(v: str) -> str:
    return "'" + v.replace("\\", "\\\\").replace("'", "''") + "'"


def _sql(banco, entrada):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco], input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"erro no SQL ({banco}): {r.stderr.strip()[:2000]}")
    return r.stdout


def estado(banco: str):
    """(o banco tem a chave única do código do IBGE?, línguas vigentes)."""
    saida = _sql(banco, f"""SELECT (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE()
  AND table_name = 'idioma_indigena' AND index_name = '{CHAVE}' AND non_unique = 0),
 (SELECT COUNT(*) FROM idioma_indigena WHERE ativo AND (vigencia_fim IS NULL OR vigencia_fim >= UTC_DATE()));
""")
    chave, vigentes = saida.strip().splitlines()[-1].split()
    return int(chave) > 0, int(vigentes)


def montar_script(ls, v: str) -> str:
    vals = ",\n".join(f"({_txt(c)}, {_txt(d)}, {_txt(f)})" for c, d, f in ls)
    codigos = ", ".join(_txt(c) for c, _, _ in ls)
    v = _txt(v)
    return f"""SET NAMES utf8mb4;
START TRANSACTION;
CREATE TEMPORARY TABLE tmp_idioma_indigena (codigo VARCHAR(10) NOT NULL, descricao VARCHAR(150) NOT NULL,
  familia VARCHAR(150) NOT NULL);
INSERT INTO tmp_idioma_indigena VALUES
{vals};
INSERT INTO idioma_indigena (codigo_ibge, descricao, familia_linguistica, versao_fonte, criado_em, versao)
SELECT t.codigo, t.descricao, t.familia, {v}, UTC_TIMESTAMP(3), 1 FROM tmp_idioma_indigena t
ON DUPLICATE KEY UPDATE
  alterado_em = IF(idioma_indigena.descricao <> VALUES(descricao)
                   OR NOT (idioma_indigena.familia_linguistica <=> VALUES(familia_linguistica))
                   OR idioma_indigena.vigencia_fim IS NOT NULL, UTC_TIMESTAMP(3), idioma_indigena.alterado_em),
  versao = IF(idioma_indigena.descricao <> VALUES(descricao)
              OR NOT (idioma_indigena.familia_linguistica <=> VALUES(familia_linguistica))
              OR idioma_indigena.vigencia_fim IS NOT NULL, idioma_indigena.versao + 1, idioma_indigena.versao),
  descricao = VALUES(descricao), familia_linguistica = VALUES(familia_linguistica), vigencia_fim = NULL,
  versao_fonte = VALUES(versao_fonte);
UPDATE idioma_indigena
   SET vigencia_fim = DATE_SUB(UTC_DATE(), INTERVAL 1 DAY), versao_fonte = {v}, alterado_em = UTC_TIMESTAMP(3),
       versao = versao + 1
 WHERE codigo_ibge IS NOT NULL AND codigo_ibge NOT IN ({codigos})
   AND (vigencia_fim IS NULL OR vigencia_fim >= UTC_DATE())
   AND (vigencia_inicio IS NULL OR vigencia_inicio < UTC_DATE());
COMMIT;
SELECT COUNT(*) FROM idioma_indigena WHERE vigencia_fim IS NULL AND versao_fonte = {v} AND codigo_ibge IN ({codigos});
"""


def carregar(banco: str) -> dict:
    tem_chave, vigentes = estado(banco)
    if not tem_chave:
        # sem a chave única o INSERT ... ON DUPLICATE KEY não casa pelo código e a carga duplicaria as línguas
        raise RuntimeError(f"idioma: o banco {banco} está sem a chave única do código do IBGE (migração "
                           "03_CAD/99z_idioma_indigena_codigo_ibge)")
    if not ARQUIVO.exists():
        AVISOS.append(f"fonte {FONTE} não baixada: rode `python3 -I catalogos/baixar.py {FONTE}` e carregue de novo; "
                      f"mantidas as {vigentes} línguas já carregadas")
        return {"idioma_indigena": vigentes}
    ls = ler(ARQUIVO)
    total = int(_sql(banco, montar_script(ls, versao())).strip().splitlines()[-1])
    if total != len(ls):
        raise RuntimeError(f"idioma_indigena: esperava {len(ls)} línguas vigentes, ficaram {total}")
    return {"idioma_indigena": total}
