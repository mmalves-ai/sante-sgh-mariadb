"""Carregador versionado da terminologia clínica SNOMED CT a partir do pacote oficial RF2 (Snapshot) (F8, 09-AREA L84).

Licença: o Brasil é membro da SNOMED International; o uso no país é coberto pela licença nacional do Ministério da Saúde
(cada estabelecimento usuário se registra no Centro Nacional de Terminologias). É catálogo do ESPELHO PADRÃO da base
(ADR 0006): o pacote é fornecido pela plataforma, nunca vem do conector nem fica no repositório.

Fonte: os pacotes .zip RF2 em catalogos/cache/snomed/ (ou na pasta da variável SGH_SNOMED_RF2): a edição internacional
e, quando houver, a extensão brasileira (termos em português). Cada pacote traz, em Snapshot/:
- Terminology/sct2_Concept_Snapshot_*.txt       (id, effectiveTime, active, moduleId, definitionStatusId)
- Terminology/sct2_Description_Snapshot-*_*.txt (id, effectiveTime, active, moduleId, conceptId, languageCode, typeId,
                                                 term, caseSignificanceId)
- Terminology/sct2_Relationship_Snapshot_*.txt  (id, effectiveTime, active, moduleId, sourceId, destinationId,
                                                 relationshipGroup, typeId, characteristicTypeId, modifierId)
- Refset/Language/der2_cRefset_LanguageSnapshot-*_*.txt (id, effectiveTime, active, moduleId, refsetId,
                                                 referencedComponentId, acceptabilityId)
Versão da edição: a maior effectiveTime dos conceitos (AAAAMMDD); o SHA-256 é o dos pacotes, em ordem de nome.

Grava (idempotente; rodar de novo a mesma edição atualiza, edição nova inativa o que saiu):
- terminologia 'snomed' (tipo clinica, licenciada) + terminologia_edicao + edição vigente;
- termo_terminologia: um por conceito; descrição = termo preferido em português (refset de idioma), senão o preferido
  em inglês, senão o nome completo (FSN) sem a etiqueta semântica; descricao_completa = FSN; superior = o primeiro pai
  "é um" ativo; nível = profundidade a partir da raiz; inativo na edição = ativo falso (nunca apagado);
- termo_relacao: "é um" (e_um), parte de (parte_de), sítio do achado (localizacao) e agente causal (agente_causal),
  só as relações ativas e inferidas;
- regiao_anatomica_codificada (sistema 'snomed'): os conceitos da hierarquia "estrutura do corpo", com o nível pela
  profundidade abaixo dela (região, localização primária, localização, sublocalização) e a região superior.
"""
import hashlib
import io
import json
import os
import subprocess
import zipfile
from collections import defaultdict, deque
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PASTA = Path(os.environ.get("SGH_SNOMED_RF2") or RAIZ / "catalogos/cache/snomed")
LOTE = 1000
AVISOS: list = []

RAIZ_CONCEITO = "138875005"
ESTRUTURA_CORPO = "123037004"
E_UM = "116680003"
FSN = "900000000000003001"
SINONIMO = "900000000000013009"
PREFERIDO = "900000000000548007"
INFERIDA = "900000000000011006"
TIPO_RELACAO = {E_UM: "e_um", "123005000": "parte_de", "363698007": "localizacao", "246075003": "agente_causal"}
IDIOMAS = ("pt", "en")


# ------------------------------------------------------------------ leitura RF2 (pura, testada em amostra sintética)
def _tabela(zf, nome):
    with zf.open(nome) as f:
        linhas = io.TextIOWrapper(f, encoding="utf-8", newline="").read().split("\n")
    cab = linhas[0].rstrip("\r").split("\t")
    for ln in linhas[1:]:
        ln = ln.rstrip("\r")
        if ln:
            yield dict(zip(cab, ln.split("\t")))


def _arquivos(zf, trecho):
    return sorted(n for n in zf.namelist() if "/Snapshot/" in n and trecho in n.rsplit("/", 1)[-1])


def ler_pacotes(zips):
    """Lê um ou mais pacotes RF2 Snapshot e devolve o modelo intermediário (sem banco)."""
    conceitos, descricoes, preferidos, relacoes = {}, {}, set(), []
    for caminho in zips:
        with zipfile.ZipFile(caminho) as zf:
            for nome in _arquivos(zf, "sct2_Concept_Snapshot"):
                for r in _tabela(zf, nome):
                    atual = conceitos.get(r["id"])
                    if not atual or r["effectiveTime"] >= atual[0]:
                        conceitos[r["id"]] = (r["effectiveTime"], r["active"] == "1")
            for nome in _arquivos(zf, "sct2_Description_Snapshot"):
                for r in _tabela(zf, nome):
                    if r["active"] == "1":
                        descricoes[r["id"]] = (r["conceptId"], r["languageCode"], r["typeId"], r["term"])
            for nome in _arquivos(zf, "der2_cRefset_LanguageSnapshot"):
                for r in _tabela(zf, nome):
                    if r["active"] == "1" and r["acceptabilityId"] == PREFERIDO:
                        preferidos.add(r["referencedComponentId"])
            for nome in _arquivos(zf, "sct2_Relationship_Snapshot"):
                for r in _tabela(zf, nome):
                    if (r["active"] == "1" and r["typeId"] in TIPO_RELACAO
                            and r["characteristicTypeId"] == INFERIDA):
                        relacoes.append((r["sourceId"], r["destinationId"], TIPO_RELACAO[r["typeId"]]))
    return montar(conceitos, descricoes, preferidos, relacoes)


def _sem_etiqueta(fsn):
    if fsn.endswith(")") and " (" in fsn:
        return fsn[:fsn.rfind(" (")]
    return fsn


def montar(conceitos, descricoes, preferidos, relacoes):
    nomes = defaultdict(dict)  # conceito -> {(tipo, idioma, preferido): termo}
    for did, (cid, idioma, tipo, termo) in descricoes.items():
        chave = ("fsn" if tipo == FSN else "sin", idioma[:2], did in preferidos)
        if chave not in nomes[cid] or did < nomes[cid][chave][0]:
            nomes[cid][chave] = (did, termo)

    def descricao(cid):
        n = nomes.get(cid, {})
        for idioma in IDIOMAS:
            if ("sin", idioma, True) in n:
                return n[("sin", idioma, True)][1]
        for chave in sorted(k for k in n if k[0] == "fsn"):
            return _sem_etiqueta(n[chave][1])
        return None

    def fsn(cid):
        n = nomes.get(cid, {})
        for chave in sorted(k for k in n if k[0] == "fsn"):
            return n[chave][1]
        return None

    validas = [(o, d, t) for o, d, t in relacoes if o in conceitos and d in conceitos and o != d]
    pais = defaultdict(list)
    for o, d, t in validas:
        if t == "e_um" and conceitos[d][1]:
            pais[o].append(d)
    filhos = defaultdict(list)
    for o, ps in pais.items():
        for p in ps:
            filhos[p].append(o)
    profundidade = _profundidades(filhos, RAIZ_CONCEITO)
    sob_corpo = _profundidades(filhos, ESTRUTURA_CORPO)
    termos = {}
    for cid, (efetivo, ativo) in conceitos.items():
        termos[cid] = {
            "codigo": cid,
            "descricao": (descricao(cid) or cid)[:500],
            "completa": fsn(cid),
            "superior": min(pais[cid], key=int) if pais.get(cid) else None,
            "nivel": profundidade.get(cid),
            "ativo": ativo,
            "efetivo": efetivo,
        }
    regioes = []
    for cid, prof in sob_corpo.items():
        if prof == 0 or not conceitos[cid][1]:
            continue
        sup = [p for p in pais.get(cid, []) if p in sob_corpo and sob_corpo[p] > 0]
        regioes.append({
            "codigo": cid,
            "descricao": termos[cid]["descricao"][:150],
            "profundidade": prof,
            "superior": min(sup, key=lambda p: (sob_corpo[p], int(p))) if sup else None,
        })
    regioes.sort(key=lambda r: (r["profundidade"], int(r["codigo"])))
    versao = max((c[0] for c in conceitos.values()), default="")
    return {"versao": versao, "termos": termos, "relacoes": sorted(set(validas)), "regioes": regioes}


def _profundidades(filhos, raiz):
    prof, fila = {raiz: 0}, deque([raiz])
    while fila:
        no = fila.popleft()
        for f in filhos.get(no, []):
            if f not in prof:
                prof[f] = prof[no] + 1
                fila.append(f)
    return prof


def nivel_regiao(profundidade):
    """O mesmo mapeamento do domínio (nivelRegiaoPorProfundidade em @sgh/dominio-pep)."""
    return ("regiao" if profundidade <= 1 else "localizacao_primaria" if profundidade == 2
            else "localizacao" if profundidade == 3 else "sublocalizacao")


def data_rf2(aaaammdd):
    return f"{aaaammdd[:4]}-{aaaammdd[4:6]}-{aaaammdd[6:8]}" if len(aaaammdd) == 8 else None


# ------------------------------------------------------------------ gravação
def _sql(banco, entrada, *args):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco] + list(args), input=entrada, capture_output=True,
                       text=True)
    if r.returncode:
        raise RuntimeError(f"snomed: erro no SQL: {r.stderr.strip()[:500]}")
    return r.stdout


def _consulta(banco, q):
    return [ln.split("\t") for ln in _sql(banco, q, "-N", "-B").splitlines() if ln]


class _Raw:
    def __init__(self, s):
        self.s = s


def _q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, _Raw):
        return v.s
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


AGORA = _Raw("UTC_TIMESTAMP(3)")


def _upsert(banco, tabela, colunas, linhas, atualizar):
    if not linhas:
        return
    upd = ", ".join(f"{c} = VALUES({c})" for c in atualizar) + ", alterado_em = UTC_TIMESTAMP(3)"
    for i in range(0, len(linhas), LOTE):
        vals = ",\n".join("(" + ", ".join(_q(v) for v in ln) + ")" for ln in linhas[i:i + LOTE])
        _sql(banco, f"SET NAMES utf8mb4;\nINSERT INTO {tabela} ({', '.join(colunas)}) VALUES\n{vals}\n"
                    f"ON DUPLICATE KEY UPDATE {upd};")


def _pacotes():
    zips = sorted(PASTA.glob("*.zip")) if PASTA.is_dir() else []
    return zips


def carregar(banco: str) -> dict:
    zips = _pacotes()
    if not zips:
        AVISOS.append("pacote RF2 ausente (catalogos/cache/snomed/*.zip ou SGH_SNOMED_RF2): nada carregado")
        return {}
    sha = hashlib.sha256()
    for z in zips:
        sha.update(z.read_bytes())
    m = ler_pacotes(zips)
    return gravar(banco, m, sha.hexdigest())


def gravar(banco, m, sha):
    versao, vig = m["versao"], data_rf2(m["versao"]) or "2000-01-01"
    _sql(banco, "SET NAMES utf8mb4;\n"
         "INSERT INTO terminologia (codigo, nome, sigla, tipo, orgao_responsavel, url_fonte, idioma, licenciada, "
         "origem, criado_em, versao) VALUES ('snomed', 'SNOMED CT - Nomenclatura Sistematizada de Medicina, Termos "
         "Clínicos', 'SNOMED CT', 'clinica', 'SNOMED International; licença nacional pelo Ministério da Saúde', "
         "'https://www.snomed.org', 'pt-BR', 1, 'sistema', UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE "
         "nome = VALUES(nome), tipo = VALUES(tipo), licenciada = 1, alterado_em = UTC_TIMESTAMP(3);")
    tid = int(_consulta(banco, "SELECT id FROM terminologia WHERE codigo = 'snomed'")[0][0])
    antes = int(_consulta(banco, f"SELECT COUNT(*) FROM termo_terminologia WHERE terminologia_id = {tid}")[0][0])
    _sql(banco, "SET NAMES utf8mb4;\n"
         "INSERT INTO terminologia_edicao (terminologia_id, operacao, ocorrido_em, versao_edicao, vigencia_inicio, "
         "situacao_carga, hash_sha256, total_termos, criado_em, versao) VALUES "
         f"({tid}, 'inclusao', UTC_TIMESTAMP(3), {_q(versao)}, {_q(vig)}, 'carregando', {_q(sha)}, "
         f"{len(m['termos'])}, UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE situacao_carga = 'carregando', "
         "hash_sha256 = VALUES(hash_sha256), total_termos = VALUES(total_termos), alterado_em = UTC_TIMESTAMP(3);")
    eid = int(_consulta(banco, f"SELECT id FROM terminologia_edicao WHERE terminologia_id = {tid} "
                               f"AND versao_edicao = {_q(versao)}")[0][0])
    cols = ["terminologia_id", "codigo_termo", "descricao", "descricao_completa", "nivel", "terminologia_edicao_id",
            "ativo", "vigencia_inicio", "versao_fonte", "criado_em", "versao"]
    upd = ["descricao", "descricao_completa", "nivel", "terminologia_edicao_id", "ativo", "vigencia_inicio",
           "versao_fonte"]
    termos = sorted(m["termos"].values(), key=lambda t: int(t["codigo"]))
    _upsert(banco, "termo_terminologia", cols,
            [[tid, t["codigo"], t["descricao"], t["completa"], t["nivel"], eid, t["ativo"],
              data_rf2(t["efetivo"]), versao, AGORA, 1] for t in termos], upd)
    # o que saiu do pacote não é apagado: fica inativo (histórico preservado)
    _sql(banco, f"UPDATE termo_terminologia SET ativo = 0, alterado_em = UTC_TIMESTAMP(3) WHERE terminologia_id = "
                f"{tid} AND ativo = 1 AND NOT (terminologia_edicao_id <=> {eid});")
    ids = {c: int(i) for c, i in _consulta(
        banco, f"SELECT codigo_termo, id FROM termo_terminologia WHERE terminologia_id = {tid}")}
    sup = [(ids[t["superior"]], ids[t["codigo"]]) for t in termos if t["superior"] in ids]
    for i in range(0, len(sup), LOTE):
        casos = " ".join(f"WHEN {f} THEN {p}" for p, f in sup[i:i + LOTE])
        alvo = ",".join(str(f) for _, f in sup[i:i + LOTE])
        _sql(banco, f"UPDATE termo_terminologia SET termo_superior_id = CASE id {casos} END WHERE id IN ({alvo}) "
                    "AND NOT (termo_superior_id <=> CASE id " + casos + " END);")
    _upsert(banco, "termo_relacao",
            ["termo_terminologia_id", "relacionado_termo_terminologia_id", "tipo_relacao", "versao_fonte", "ativo",
             "criado_em", "versao"],
            [[ids[o], ids[d], t, versao, 1, AGORA, 1] for o, d, t in m["relacoes"]], ["versao_fonte", "ativo"])
    _sql(banco, f"UPDATE termo_relacao r JOIN termo_terminologia t ON t.id = r.termo_terminologia_id "
                f"SET r.ativo = 0, r.alterado_em = UTC_TIMESTAMP(3) WHERE t.terminologia_id = {tid} AND r.ativo = 1 "
                f"AND NOT (r.versao_fonte <=> {_q(versao)});")
    # regiões, de cima para baixo (a superior já existe quando a de baixo entra)
    for prof in sorted({r["profundidade"] for r in m["regioes"]}):
        reg = {c: int(i) for c, i in _consulta(
            banco, "SELECT codigo_anatomico, id FROM regiao_anatomica_codificada WHERE sistema_codificacao = 'snomed'")}
        _upsert(banco, "regiao_anatomica_codificada",
                ["sistema_codificacao", "nivel", "codigo_anatomico", "descricao", "regiao_superior_id",
                 "vigencia_inicio", "versao_fonte", "ativo", "criado_em", "versao"],
                [["snomed", nivel_regiao(r["profundidade"]), r["codigo"], r["descricao"],
                  reg.get(r["superior"]) if r["superior"] else None, vig, versao, 1, AGORA, 1]
                 for r in m["regioes"] if r["profundidade"] == prof],
                ["descricao", "regiao_superior_id", "versao_fonte", "ativo"])
    _sql(banco, "UPDATE regiao_anatomica_codificada SET ativo = 0, alterado_em = UTC_TIMESTAMP(3) WHERE "
                f"sistema_codificacao = 'snomed' AND ativo = 1 AND NOT (versao_fonte <=> {_q(versao)});")
    depois = int(_consulta(banco, f"SELECT COUNT(*) FROM termo_terminologia WHERE terminologia_id = {tid}")[0][0])
    resumo = {"conceitos": len(termos), "ativos": sum(1 for t in termos if t["ativo"]),
              "relacoes": len(m["relacoes"]), "regioes": len(m["regioes"]), "termos_no_banco": depois}
    _sql(banco, "SET NAMES utf8mb4;\n"
         f"UPDATE terminologia_edicao SET situacao_carga = 'carregada', carregada_em = UTC_TIMESTAMP(3), "
         f"termos_incluidos = {depois - antes}, dados = {_q(json.dumps(resumo))}, alterado_em = UTC_TIMESTAMP(3) "
         f"WHERE id = {eid};\n"
         f"UPDATE terminologia SET edicao_vigente_terminologia_edicao_id = {eid}, alterado_em = UTC_TIMESTAMP(3) "
         f"WHERE id = {tid} AND NOT (edicao_vigente_terminologia_edicao_id <=> {eid});")
    return {"termo_terminologia": len(termos), "termo_relacao": len(m["relacoes"]),
            "regiao_anatomica_codificada": len(m["regioes"])}
