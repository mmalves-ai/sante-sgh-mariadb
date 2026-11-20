"""Fatias dos carregadores de catálogo (F1.4), pelo protocolo de tokens: para cada fonte, o DDL das
tabelas de destino (com as chaves) e o formato dos arquivos baixados.

uso: python3 -I tools/obra/fatiar_catalogos.py      (saída em docs/obra/fatias/catalogos/<fonte>.md)
"""
import glob
import json
import re
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
OUT = RAIZ / "docs/obra/fatias/catalogos"
OUT.mkdir(parents=True, exist_ok=True)
C = RAIZ / "catalogos/cache"


CID10_TABELAS = [
    "terminologia", "terminologia_edicao", "termo_terminologia", "capitulo_cid10",
    "agrupamento_cid10", "topografia_tumor", "correspondencia_cid_morfologia",
]


def main():
    ddl = "\n".join(open(f, encoding="utf-8").read() for f in sorted(glob.glob(str(RAIZ / "db/migracoes/*/*_tabelas.sql"))))
    chv = "\n".join(open(f, encoding="utf-8").read() for f in sorted(glob.glob(str(RAIZ / "db/migracoes/*/*_chaves.sql"))))
    blocos = {m.group(1): m.group(0) for m in re.finditer(r"CREATE TABLE (\w+) \(.*?\n\)[^;\n]*;", ddl, re.S)}

    def fks(t):
        return "\n".join(re.findall(r"ALTER TABLE " + t + r"\b.*?;\n", chv, re.S))

    alvo = {
        "ibge": ["unidade_federativa", "municipio_ibge"],
        "bcb": ["banco"],
        "cid10": CID10_TABELAS,
        "sigtap": sorted(t for t in blocos if "sigtap" in t) + ["ocupacao_cbo"],
    }
    fonte = {"ibge": "cache/ibge_uf/estados.json e cache/ibge_municipios/municipios.json (view=nivelado)",
             "bcb": "cache/bcb_bancos/ParticipantesSTR.csv", "cid10": "cache/cid10/CID10CSV.zip",
             "sigtap": "cache/sigtap/TabelaUnificada_*.zip (a mais recente)"}
    for f, ts in alvo.items():
        L = [f"# Fatia do carregador: {f}", "", f"Fonte: catalogos/{fonte[f]}. Tabelas de destino: {', '.join(ts)}", ""]
        for t in ts:
            if t not in blocos:
                L.append(f"-- {t}: NÃO EXISTE no DDL")
                continue
            L += [blocos[t], fks(t), ""]
        if f == "sigtap":
            z = zipfile.ZipFile(sorted(glob.glob(str(C / "sigtap/*.zip")))[-1])
            L.append("## Leiautes dos arquivos (posição fixa, latin-1)")
            for n in sorted(z.namelist()):
                if n.endswith("_layout.txt"):
                    L.append(f"### {n}\n" + z.read(n).decode("latin-1"))
        if f == "cid10":
            z = zipfile.ZipFile(C / "cid10/CID10CSV.zip")
            for n in z.namelist():
                L.append(f"### {n} (cabeçalho e 2 linhas, separador ;)\n" + "\n".join(z.read(n).decode("latin-1").splitlines()[:3]))
        if f == "bcb":
            L.append("## Cabeçalho e 2 linhas\n" + "\n".join(open(C / "bcb_bancos/ParticipantesSTR.csv", encoding="utf-8-sig", errors="replace").read().splitlines()[:3]))
        if f == "ibge":
            L.append("## estados.json (1 item)\n" + json.dumps(json.load(open(C / "ibge_uf/estados.json"))[0], ensure_ascii=False))
            L.append("## municipios.json (1 item)\n" + json.dumps(json.load(open(C / "ibge_municipios/municipios.json"))[0], ensure_ascii=False))
        (OUT / f"{f}.md").write_text("\n".join(L) + "\n", encoding="utf-8")
        print(f, len(ts), "tabelas", (OUT / f"{f}.md").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
