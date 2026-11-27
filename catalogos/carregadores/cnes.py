"""Carregador do cadastro nacional de estabelecimentos de saúde (C3-011, 02-CAD linha 29): estabelecimentos,
habilitações, serviços e classificações e leitos da base pública mensal do DATASUS, por competência.

Fonte: pacote oficial BASE_DE_DADOS_CNES_AAAAMM.ZIP (ftp.datasus.gov.br/cnes), baixado por
`python3 -I catalogos/baixar.py cnes` para catalogos/cache/cnes/ (fora do git, com SHA-256 no registro). Os arquivos
do pacote são CSV separados por ponto e vírgula, em latin-1, com cabeçalho. O nome de cada tabela e das colunas é
procurado entre os nomes conhecidos do pacote; se o pacote mudar de leiaute, a carga para com a lista do que achou
(nunca grava pela metade).

Filtro (a base nacional tem centenas de milhares de estabelecimentos): só entram os estabelecimentos com número
nacional cadastrado no banco (estabelecimento e unidade assistencial) ou, com SANTE_CNES_UFS="35,33" no ambiente, os
das UFs pedidas (código do IBGE). Em espelho sem estabelecimento e sem UF, não carrega nada e avisa.

Idempotente: INSERT ... ON DUPLICATE KEY UPDATE sobre (competência, número nacional, código). Competências antigas
ficam: a conferência de uma competência passada continua reproduzível.
"""
import csv
import io
import os
import re
import subprocess
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
CACHE = RAIZ / "catalogos/cache/cnes"
AVISOS: list[str] = []

# tabela -> (prefixos do arquivo no pacote, {campo: nomes de coluna aceitos})
LEIAUTE = {
    "estabelecimento": (("tbEstabelecimento",), {
        "unidade": ("CO_UNIDADE",), "cnes": ("CO_CNES",), "municipio": ("CO_MUNICIPIO_GESTOR", "CO_MUNICIPIO"),
        "cnpj": ("NU_CNPJ",), "razao": ("NO_RAZAO_SOCIAL",), "fantasia": ("NO_FANTASIA",),
        "tipo": ("TP_UNIDADE", "CO_TIPO_UNIDADE"),
    }),
    "habilitacao": (("rlEstabHabilitacao", "rlEstabSipac", "rlEstabHab"), {
        "unidade": ("CO_UNIDADE",), "codigo": ("CO_HABILITACAO", "CO_CODIGO_GRUPO", "CO_GRUPO_HABILITACAO"),
        "inicio": ("NU_COMPETENCIA_INICIAL", "CO_COMPETENCIA_INICIAL", "DT_COMPETENCIA_INICIAL"),
        "fim": ("NU_COMPETENCIA_FINAL", "CO_COMPETENCIA_FINAL", "DT_COMPETENCIA_FINAL"),
        "portaria": ("NU_PORTARIA",), "leitos": ("QT_LEITOS",),
    }),
    "servico": (("rlEstabServClass",), {
        "unidade": ("CO_UNIDADE",), "servico": ("CO_SERVICO",), "classificacao": ("CO_CLASSIFICACAO",),
    }),
    "leito": (("rlEstabComplementar",), {
        "unidade": ("CO_UNIDADE",), "tipo": ("CO_TIPO_LEITO",), "leito": ("CO_LEITO",),
        "existente": ("QT_EXIST",), "sus": ("QT_SUS",),
    }),
}
OPCIONAIS = {"campo": {"municipio", "cnpj", "fantasia", "tipo", "inicio", "fim", "portaria", "leitos"}}


def competencia_do_pacote(nome: str) -> str:
    m = re.search(r"(\d{4})(\d{2})", Path(nome).name)
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise ValueError(f"pacote sem competência AAAAMM no nome: {Path(nome).name}")
    return f"{m.group(1)}{m.group(2)}"


def _competencia_data(v: str) -> str | None:
    s = re.sub(r"\D", "", v or "")
    if len(s) >= 6 and 1 <= int(s[4:6]) <= 12:
        return f"{s[:4]}-{s[4:6]}-01"
    return None


def _arquivo(zf: zipfile.ZipFile, prefixos) -> str | None:
    for p in prefixos:
        for n in zf.namelist():
            if Path(n).name.lower().startswith(p.lower()) and n.lower().endswith(".csv"):
                return n
    return None


def _linhas(zf, nome, campos):
    with zf.open(nome) as f:
        r = csv.reader(io.TextIOWrapper(f, encoding="latin-1", newline=""), delimiter=";")
        cab = [c.strip().strip('"').upper() for c in next(r)]
        idx = {}
        for campo, aceitos in campos.items():
            i = next((cab.index(a) for a in aceitos if a in cab), None)
            if i is None and campo not in OPCIONAIS["campo"]:
                raise ValueError(f"{Path(nome).name}: coluna de {campo} ausente (aceitos {aceitos}; achou {cab[:40]})")
            idx[campo] = i
        for ln in r:
            if not ln:
                continue
            yield {c: (ln[i].strip() if i is not None and i < len(ln) else "") for c, i in idx.items()}


def _cnes_da_unidade(unidade: str) -> str:
    d = re.sub(r"\D", "", unidade)
    return d[-7:] if len(d) >= 7 else ""


def ler_pacote(zf: zipfile.ZipFile, aceitar) -> dict:
    """Lê o pacote e devolve {tabela: [linhas]} só dos números nacionais que `aceitar(cnes, unidade)` aceita."""
    saida = {}
    for tabela, (prefixos, campos) in LEIAUTE.items():
        nome = _arquivo(zf, prefixos)
        if nome is None:
            if tabela == "estabelecimento":
                raise ValueError(f"pacote sem a tabela de estabelecimentos (procurei {prefixos})")
            AVISOS.append(f"pacote sem a tabela {tabela} (procurei {', '.join(prefixos)}): não carregada")
            saida[tabela] = []
            continue
        ls = []
        for x in _linhas(zf, nome, campos):
            cnes = re.sub(r"\D", "", x.get("cnes") or "") or _cnes_da_unidade(x["unidade"])
            if len(cnes) != 7 or not aceitar(cnes, re.sub(r"\D", "", x["unidade"])):
                continue
            x["cnes"] = cnes
            ls.append(x)
        saida[tabela] = ls
    return saida


def _q(v):
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def _sql(banco, entrada, *args):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco, *args], input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"erro no SQL ({banco}): {r.stderr.strip()[:2000]}")
    return r.stdout


def _upsert(tabela, colunas, linhas, atualizar):
    partes = []
    for i in range(0, len(linhas), 500):
        vals = ",\n".join("(" + ", ".join(v if isinstance(v, str) and v.startswith("@") else _q(v) for v in ln)
                          + ", UTC_TIMESTAMP(3), 1)" for ln in linhas[i:i + 500])
        upd = ", ".join(f"{c} = VALUES({c})" for c in atualizar)
        partes.append(f"INSERT INTO {tabela} ({', '.join(colunas)}, criado_em, versao) VALUES\n{vals}\n"
                      f"ON DUPLICATE KEY UPDATE {upd}, alterado_em = UTC_TIMESTAMP(3);")
    return "\n".join(partes)


def _filtro(banco):
    ufs = {u.strip() for u in os.environ.get("SANTE_CNES_UFS", "").split(",") if re.fullmatch(r"\d{2}", u.strip())}
    if ufs:
        return (lambda cnes, unidade: unidade[:2] in ufs), f"UFs {sorted(ufs)}"
    proprios = set(_sql(banco, "SELECT codigo_cnes FROM estabelecimento WHERE codigo_cnes IS NOT NULL "
                               "UNION SELECT codigo_cnes FROM unidade_assistencial WHERE codigo_cnes IS NOT NULL;",
                        "-N").split())
    return (lambda cnes, unidade: cnes in proprios), f"{len(proprios)} números nacionais do cadastro"


def montar_script(dados: dict, versao: str) -> tuple[str, dict]:
    comp = f"{versao[:4]}-{versao[4:6]}-01"
    i = lambda v: str(int(v)) if re.fullmatch(r"\d+", v or "") else None
    est = [[comp, x["cnes"], (re.sub(r"\D", "", x.get("municipio") or "")[:6] or None),
            (re.sub(r"\D", "", x.get("cnpj") or "") if len(re.sub(r"\D", "", x.get("cnpj") or "")) == 14 else None),
            (x["razao"] or x.get("fantasia") or "Sem razão social")[:150], (x.get("fantasia") or None) and x["fantasia"][:150],
            (x.get("tipo") or None) and x["tipo"][:3], versao] for x in dados["estabelecimento"]]
    hab = [[comp, x["cnes"], str(int(x["codigo"])), _competencia_data(x.get("inicio")), _competencia_data(x.get("fim")),
            (x.get("portaria") or None) and x["portaria"][:30], i(x.get("leitos")), versao]
           for x in dados["habilitacao"] if re.fullmatch(r"\d{1,6}", x["codigo"] or "")]
    srv = [[comp, x["cnes"], x["servico"].zfill(3), x["classificacao"].zfill(3), versao] for x in dados["servico"]
           if re.fullmatch(r"\d{1,3}", x["servico"] or "") and re.fullmatch(r"\d{1,3}", x["classificacao"] or "")]
    lei = []
    for x in dados["leito"]:
        ex, sus = int(i(x["existente"]) or 0), int(i(x["sus"]) or 0)
        if x["tipo"] and x["leito"]:
            lei.append([comp, x["cnes"], x["tipo"][:3], x["leito"][:3], ex, min(sus, ex), versao])
    partes = ["SET NAMES utf8mb4;", "START TRANSACTION;"]
    if est:
        partes.append(_upsert("estabelecimento_cadastro_nacional",
                              ["competencia", "codigo_cnes", "codigo_municipio", "cnpj", "razao_social", "nome_fantasia",
                               "codigo_tipo_unidade", "versao_fonte"], est,
                              ["codigo_municipio", "cnpj", "razao_social", "nome_fantasia", "codigo_tipo_unidade",
                               "versao_fonte"]))
    if hab:
        partes.append(_upsert("habilitacao_cadastro_nacional",
                              ["competencia", "codigo_cnes", "codigo_habilitacao", "competencia_inicio", "competencia_fim",
                               "numero_portaria", "leitos_habilitados", "versao_fonte"], hab,
                              ["competencia_inicio", "competencia_fim", "numero_portaria", "leitos_habilitados",
                               "versao_fonte"]))
    if srv:
        partes.append(_upsert("servico_cadastro_nacional",
                              ["competencia", "codigo_cnes", "codigo_servico", "codigo_classificacao", "versao_fonte"],
                              srv, ["versao_fonte"]))
    if lei:
        partes.append(_upsert("leito_cadastro_nacional",
                              ["competencia", "codigo_cnes", "codigo_tipo_leito", "codigo_leito",
                               "quantidade_existente", "quantidade_sus", "versao_fonte"], lei,
                              ["quantidade_existente", "quantidade_sus", "versao_fonte"]))
    partes.append("COMMIT;")
    return "\n".join(partes) + "\n", {"estabelecimento_cadastro_nacional": len(est),
                                       "habilitacao_cadastro_nacional": len(hab),
                                       "servico_cadastro_nacional": len(srv), "leito_cadastro_nacional": len(lei)}


def _pacote() -> Path:
    zips = sorted(CACHE.glob("*.[zZ][iI][pP]"), key=lambda p: competencia_do_pacote(p.name))
    if not zips:
        raise SystemExit(
            "sem pacote do cadastro nacional em catalogos/cache/cnes (python3 -I catalogos/baixar.py cnes). Sem rede "
            "de saída: baixe BASE_DE_DADOS_CNES_AAAAMM.ZIP em ftp.datasus.gov.br/cnes e ponha nessa pasta, ou envie o "
            "arquivo das habilitações na tela Faturamento SUS > Estabelecimento (POST /api/sus/estabelecimento/cnes/arquivo)")
    return zips[-1]


def carregar(banco: str) -> dict:
    AVISOS.clear()
    pac = _pacote()
    versao = competencia_do_pacote(pac.name)
    aceitar, descricao = _filtro(banco)
    with zipfile.ZipFile(pac) as zf:
        dados = ler_pacote(zf, aceitar)
    if not dados["estabelecimento"]:
        AVISOS.append(f"nenhum estabelecimento da competência {versao} no filtro ({descricao}): nada carregado")
        return {k: 0 for k in ("estabelecimento_cadastro_nacional", "habilitacao_cadastro_nacional",
                               "servico_cadastro_nacional", "leito_cadastro_nacional")}
    script, contagem = montar_script(dados, versao)
    _sql(banco, script)
    AVISOS.append(f"competência {versao}, filtro: {descricao}")
    return contagem
