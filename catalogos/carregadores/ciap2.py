"""Carregador versionado da Classificação Internacional de Atenção Primária, 2ª edição (CIAP-2), e da correspondência
CIAP-2 → CID-10 (F8, 03-PEP L98).

Fonte oficial: a tabela da CIAP-2 com a correspondência para a CID-10 publicada pelo Ministério da Saúde no e-SUS
Atenção Primária (tabela de referência do prontuário eletrônico do cidadão). Sem endereço fixo de download: o arquivo
da publicação oficial é registrado por `python3 -I catalogos/baixar.py --registrar ciap2 <arquivo.csv> <versão>` e
fica em catalogos/cache/ciap2/ (fora do git).

Formato aceito: texto delimitado (`;`, `,` ou tabulação), UTF-8 ou Latin-1, cabeçalho na 1ª linha. As colunas são
achadas pelo nome (sem acento, minúsculas): o código (`codigo`, `co_ciap`, `ciap`, `codigo_ciap`), a descrição
(`descricao`, `ds_ciap`, `titulo`, `nome`), opcionalmente a descrição completa (`descricao_completa`, `inclusao`,
`criterios`) e os CID-10 correspondentes (`cid10`, `cid`, `co_cid10`, `cids`, `codigos_cid10`), vários na mesma célula
separados por vírgula, barra, espaço ou `|`. Um código pode vir em várias linhas (uma por CID). O primeiro CID listado
para o código é o preferencial, salvo coluna `preferencial` (1/S/sim/true).

Grava (idempotente; rodar de novo a mesma edição atualiza, edição nova inativa o que saiu; nada é apagado):
- terminologia 'ciap2' (tipo diagnostico) + terminologia_edicao + edição vigente;
- termo_terminologia em 2 níveis: 1 capítulo (letra, nomes oficiais dos 17 capítulos), 2 código (A01 a Z29);
- correspondencia_ciap_cid: cada par (código CIAP-2, CID-10 já carregado pelo carregador cid10, categoria ou
  subcategoria; o CID com ponto ou sem ponto é aceito); o par que saiu da edição fica excluído logicamente; CID que não
  existe na base vai aos AVISOS só pela contagem.
"""
import csv
import hashlib
import io
import json
import re
import subprocess
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PASTA = RAIZ / "catalogos/cache/ciap2"
REGISTRO = RAIZ / "catalogos/cache/registro.tsv"
LOTE = 1000
AVISOS: list = []

CAPITULOS = {
    "A": "Geral e não especificado",
    "B": "Sangue, órgãos hematopoéticos e linfáticos",
    "D": "Aparelho digestivo",
    "F": "Olhos",
    "H": "Ouvidos",
    "K": "Aparelho circulatório",
    "L": "Sistema musculoesquelético",
    "N": "Sistema nervoso",
    "P": "Psicológico",
    "R": "Aparelho respiratório",
    "S": "Pele",
    "T": "Endócrino, metabólico e nutricional",
    "U": "Aparelho urinário",
    "W": "Gravidez e planejamento familiar",
    "X": "Aparelho genital feminino e mama",
    "Y": "Aparelho genital masculino",
    "Z": "Problemas sociais",
}
CODIGO = re.compile(r"^[ABDFHKLNPRSTUWXYZ]\d{2}$")
CID = re.compile(r"^[A-Z]\d{2}(\.?\d)?$")
COLUNAS = {
    "codigo": ("codigo", "co_ciap", "ciap", "codigo_ciap", "ciap2", "co_ciap2"),
    "descricao": ("descricao", "ds_ciap", "titulo", "nome", "ds_ciap2", "descricao_ciap"),
    "completa": ("descricao_completa", "inclusao", "criterios", "ds_inclusao"),
    "cid": ("cid10", "cid", "co_cid10", "cids", "codigos_cid10", "cid_10"),
    "preferencial": ("preferencial", "st_preferencial"),
}


def _chave(s):
    s = unicodedata.normalize("NFKD", s.strip().lower())
    return re.sub(r"[^a-z0-9]+", "_", "".join(c for c in s if not unicodedata.combining(c))).strip("_")


def _texto(dados: bytes) -> str:
    for cod in ("utf-8-sig", "latin-1"):
        try:
            return dados.decode(cod)
        except UnicodeDecodeError:
            continue
    raise ValueError("ciap2: codificação desconhecida")


def normalizar_cid(c: str):
    c = c.strip().upper().replace(".", "")
    return c if re.fullmatch(r"[A-Z]\d{2}\d?", c) else None


def ler_tabela(dados: bytes) -> dict:
    """Lê a tabela oficial e devolve {"termos": {codigo: {...}}, "pares": [(ciap, cid, preferencial)]} (sem banco)."""
    texto = _texto(dados)
    primeira = texto.splitlines()[0] if texto else ""
    sep = max((";", ",", "\t"), key=primeira.count)
    linhas = list(csv.reader(io.StringIO(texto), delimiter=sep))
    if not linhas:
        raise ValueError("ciap2: arquivo vazio")
    cab = [_chave(c) for c in linhas[0]]
    pos = {k: next((cab.index(n) for n in nomes if n in cab), None) for k, nomes in COLUNAS.items()}
    if pos["codigo"] is None or pos["descricao"] is None:
        raise ValueError("ciap2: cabeçalho sem as colunas de código e descrição")
    termos, pares, vistos = {}, [], set()

    def col(ln, k):
        i = pos[k]
        return ln[i].strip() if i is not None and i < len(ln) else ""

    for ln in linhas[1:]:
        cod = col(ln, "codigo").upper().replace("-", "")
        if not CODIGO.fullmatch(cod):
            continue
        desc = col(ln, "descricao")
        if cod not in termos:
            termos[cod] = {"codigo": cod, "descricao": (desc or cod)[:500], "completa": col(ln, "completa") or None}
        pref_col = col(ln, "preferencial").lower()
        for i, bruto in enumerate(c for c in re.split(r"[,/|\s]+", col(ln, "cid")) if c):
            cid = normalizar_cid(bruto)
            if not cid or (cod, cid) in vistos:
                continue
            vistos.add((cod, cid))
            primeira_do_codigo = not any(p[0] == cod for p in pares)
            pref = pref_col in ("1", "s", "sim", "true") if pos["preferencial"] is not None else (
                i == 0 and primeira_do_codigo)
            pares.append((cod, cid, pref))
    return {"termos": termos, "pares": pares}


# ------------------------------------------------------------------ gravação
def _sql(banco, entrada, *args):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco] + list(args), input=entrada, capture_output=True,
                       text=True)
    if r.returncode:
        raise RuntimeError(f"ciap2: erro no SQL: {r.stderr.strip()[:500]}")
    return r.stdout


def _consulta(banco, q):
    return [ln.split("\t") for ln in _sql(banco, q, "-N", "-B").splitlines() if ln]


def _q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def _upsert(banco, tabela, colunas, linhas, atualizar):
    upd = ", ".join(f"{c} = VALUES({c})" for c in atualizar) + ", alterado_em = UTC_TIMESTAMP(3)"
    for i in range(0, len(linhas), LOTE):
        vals = ",\n".join("(" + ", ".join("UTC_TIMESTAMP(3)" if v == "__agora__" else _q(v) for v in ln) + ")"
                          for ln in linhas[i:i + LOTE])
        _sql(banco, f"SET NAMES utf8mb4;\nINSERT INTO {tabela} ({', '.join(colunas)}) VALUES\n{vals}\n"
                    f"ON DUPLICATE KEY UPDATE {upd};")


def _fonte():
    """(arquivo, versão) do último registro da fonte ciap2; sem registro, o .csv mais novo da pasta."""
    if REGISTRO.exists():
        for ln in reversed(REGISTRO.read_text(encoding="utf-8").splitlines()):
            c = ln.split("\t")
            if c[0] == "ciap2" and len(c) > 5 and (RAIZ / c[2]).is_file():
                return RAIZ / c[2], (c[6] if len(c) > 6 and c[6] else c[5])[:30]
    arqs = sorted(PASTA.glob("*.csv")) if PASTA.is_dir() else []
    return (arqs[-1], arqs[-1].stem[:30]) if arqs else (None, None)


def carregar(banco: str) -> dict:
    arq, versao = _fonte()
    if not arq:
        AVISOS.append("tabela oficial ausente (baixar.py --registrar ciap2 <arquivo> <versão>): nada carregado")
        return {}
    dados = arq.read_bytes()
    return gravar(banco, ler_tabela(dados), versao, hashlib.sha256(dados).hexdigest())


def gravar(banco, m, versao, sha):
    _sql(banco, "SET NAMES utf8mb4;\n"
         "INSERT INTO terminologia (codigo, nome, sigla, tipo, orgao_responsavel, url_fonte, idioma, origem, "
         "criado_em, versao) VALUES ('ciap2', 'Classificação Internacional de Atenção Primária, 2ª edição', 'CIAP-2', "
         "'diagnostico', 'WONCA; tradução e correspondência com a CID-10 pelo Ministério da Saúde (e-SUS APS)', "
         "'https://sisaps.saude.gov.br/esus/', 'pt-BR', 'sistema', UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE "
         "nome = VALUES(nome), sigla = VALUES(sigla), tipo = VALUES(tipo), alterado_em = UTC_TIMESTAMP(3);")
    tid = int(_consulta(banco, "SELECT id FROM terminologia WHERE codigo = 'ciap2'")[0][0])
    antes = int(_consulta(banco, f"SELECT COUNT(*) FROM termo_terminologia WHERE terminologia_id = {tid}")[0][0])
    total = len(m["termos"]) + len({c[0] for c in m["termos"]})
    _sql(banco, "SET NAMES utf8mb4;\n"
         "INSERT INTO terminologia_edicao (terminologia_id, operacao, ocorrido_em, versao_edicao, vigencia_inicio, "
         f"situacao_carga, hash_sha256, total_termos, criado_em, versao) VALUES ({tid}, 'inclusao', UTC_TIMESTAMP(3), "
         f"{_q(versao)}, UTC_DATE(), 'carregando', {_q(sha)}, {total}, UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE "
         "situacao_carga = 'carregando', hash_sha256 = VALUES(hash_sha256), total_termos = VALUES(total_termos), "
         "alterado_em = UTC_TIMESTAMP(3);")
    eid = int(_consulta(banco, f"SELECT id FROM terminologia_edicao WHERE terminologia_id = {tid} "
                               f"AND versao_edicao = {_q(versao)}")[0][0])
    cols = ["terminologia_id", "codigo_termo", "descricao", "descricao_completa", "nivel", "terminologia_edicao_id",
            "ativo", "versao_fonte", "criado_em", "versao"]
    upd = ["descricao", "descricao_completa", "nivel", "terminologia_edicao_id", "ativo", "versao_fonte"]
    caps = sorted({c[0] for c in m["termos"]})
    _upsert(banco, "termo_terminologia", cols,
            [[tid, c, CAPITULOS.get(c, c), None, 1, eid, True, versao, "__agora__", 1] for c in caps], upd)
    termos = sorted(m["termos"].values(), key=lambda t: t["codigo"])
    _upsert(banco, "termo_terminologia", cols,
            [[tid, t["codigo"], t["descricao"], t["completa"], 2, eid, True, versao, "__agora__", 1] for t in termos],
            upd)
    _sql(banco, f"UPDATE termo_terminologia SET ativo = 0, alterado_em = UTC_TIMESTAMP(3) WHERE terminologia_id = "
                f"{tid} AND ativo = 1 AND NOT (terminologia_edicao_id <=> {eid});")
    ids = {c: int(i) for c, i in _consulta(
        banco, f"SELECT codigo_termo, id FROM termo_terminologia WHERE terminologia_id = {tid}")}
    for cap in caps:
        _sql(banco, f"UPDATE termo_terminologia SET termo_superior_id = {ids[cap]} WHERE terminologia_id = {tid} "
                    f"AND nivel = 2 AND codigo_termo LIKE {_q(cap + '%')} AND NOT (termo_superior_id <=> {ids[cap]});")
    cids = {c.replace(".", ""): int(i) for c, i in _consulta(
        banco, "SELECT tt.codigo_termo, tt.id FROM termo_terminologia tt JOIN terminologia t ON t.id = "
               "tt.terminologia_id WHERE t.codigo = 'cid10' AND tt.nivel IN (3, 4)")}
    pares = [(ids[a], cids[b], p) for a, b, p in m["pares"] if a in ids and b in cids]
    sem_cid = len(m["pares"]) - len(pares)
    if sem_cid:
        AVISOS.append(f"{sem_cid} pares com CID-10 ausente da base (carregue o cid10 antes): não ligados")
    _upsert(banco, "correspondencia_ciap_cid",
            ["ciap_termo_terminologia_id", "cid_termo_terminologia_id", "preferencial", "criado_em", "versao",
             "excluido_em", "excluido_por"],
            [[a, b, p, "__agora__", 1, None, None] for a, b, p in pares], ["preferencial", "excluido_em",
                                                                            "excluido_por"])
    if pares:
        vivos = " OR ".join(f"(ciap_termo_terminologia_id = {a} AND cid_termo_terminologia_id = {b})"
                            for a, b, _ in pares)
        _sql(banco, "UPDATE correspondencia_ciap_cid c JOIN termo_terminologia t ON t.id = c.ciap_termo_terminologia_id "
                    f"SET c.excluido_em = UTC_TIMESTAMP(3), c.alterado_em = UTC_TIMESTAMP(3) WHERE t.terminologia_id = "
                    f"{tid} AND c.excluido_em IS NULL AND NOT ({vivos});")
    depois = int(_consulta(banco, f"SELECT COUNT(*) FROM termo_terminologia WHERE terminologia_id = {tid}")[0][0])
    resumo = {"capitulos": len(caps), "codigos": len(termos), "pares": len(pares), "pares_sem_cid": sem_cid,
              "termos_no_banco": depois}
    _sql(banco, "SET NAMES utf8mb4;\n"
         f"UPDATE terminologia_edicao SET situacao_carga = 'carregada', carregada_em = UTC_TIMESTAMP(3), "
         f"termos_incluidos = {depois - antes}, dados = {_q(json.dumps(resumo))}, alterado_em = UTC_TIMESTAMP(3) "
         f"WHERE id = {eid};\n"
         f"UPDATE terminologia SET edicao_vigente_terminologia_edicao_id = {eid}, alterado_em = UTC_TIMESTAMP(3) "
         f"WHERE id = {tid} AND NOT (edicao_vigente_terminologia_edicao_id <=> {eid});")
    return {"termo_terminologia": len(caps) + len(termos), "correspondencia_ciap_cid": len(pares)}
