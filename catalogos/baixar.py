"""Baixa as fontes oficiais dos catálogos públicos para catalogos/cache/ (fora do git) e registra a versão.

uso: python3 -I catalogos/baixar.py [fonte ...]       (sem argumento: todas as fontes pequenas)
     python3 -I catalogos/baixar.py --listar
     python3 -I catalogos/baixar.py --registrar <fonte> <arquivo> [versão]
       (fonte oficial sem endereço fixo de download, ex.: a tabela de CFOP do convênio SINIEF: o arquivo obtido da
       publicação oficial é copiado para catalogos/cache/<fonte>/ e registrado com o SHA-256, como um download)

Cada fonte grava catalogos/cache/<fonte>/<arquivo> e uma linha em catalogos/cache/registro.tsv:
fonte, url, arquivo, bytes, sha256, baixado_em, versao. Antes de baixar, confere o tamanho anunciado
(HEAD), o espaço livre em disco (mínimo 120 GB, pedido do dono) e o limite da fonte.
"""
import hashlib
import json
import re
import shutil
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
CACHE = RAIZ / "cache"
MIN_LIVRE_GB = 120
UA = {"User-Agent": "catalogos-publicos/1.0"}


def sigtap_url() -> tuple[str, str]:
    base = "ftp://ftp2.datasus.gov.br/pub/sistemas/tup/downloads/"
    nomes = urllib.request.urlopen(base, timeout=60).read().decode("latin-1").split()
    zips = sorted(n for n in nomes if re.fullmatch(r"TabelaUnificada_\d{6}_v\d+\.zip", n))
    return base + zips[-1], zips[-1].split("_")[1]


# fonte -> (url ou função, limite em MB, versão fixa ou None)
FONTES = {
    "ibge_uf": ("https://servicodados.ibge.gov.br/api/v1/localidades/estados", 5, None),
    "ibge_municipios": ("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado", 20, None),
    "bcb_bancos": ("https://www.bcb.gov.br/content/estabilidadefinanceira/str1/ParticipantesSTR.csv", 5, None),
    "cid10": ("http://www2.datasus.gov.br/cid10/V2008/downloads/CID10CSV.zip", 10, "2008"),
    "sigtap": (sigtap_url, 200, None),
}


def livre_gb() -> float:
    return shutil.disk_usage("/").free / 1024 ** 3


def baixar(nome: str) -> dict:
    alvo, lim_mb, versao = FONTES[nome]
    url = alvo
    if callable(alvo):
        url, versao = alvo()
    if livre_gb() < MIN_LIVRE_GB:
        raise SystemExit(f"disco: {livre_gb():.0f} GB livres < {MIN_LIVRE_GB} GB; não baixo {nome}")
    pasta = CACHE / nome
    pasta.mkdir(parents=True, exist_ok=True)
    arq = pasta / (url.rstrip("/").split("/")[-1].split("?")[0] or nome)
    if arq.suffix == "" and "json" in url or url.endswith("estados") or "localidades" in url:
        arq = arq.with_suffix(".json")
    req = urllib.request.Request(url, headers=UA) if url.startswith("http") else url
    h = hashlib.sha256()
    total = 0
    with urllib.request.urlopen(req, timeout=300) as r, open(arq, "wb") as f:
        while True:
            bloco = r.read(1 << 20)
            if not bloco:
                break
            total += len(bloco)
            if total > lim_mb * 1024 * 1024:
                f.close(); arq.unlink()
                raise SystemExit(f"{nome}: passou do limite de {lim_mb} MB; abortado")
            h.update(bloco); f.write(bloco)
    reg = {"fonte": nome, "url": url, "arquivo": str(arq.relative_to(RAIZ)), "bytes": total,
           "sha256": h.hexdigest(), "baixado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "versao": versao or datetime.now(timezone.utc).strftime("%Y-%m-%d")}
    with open(CACHE / "registro.tsv", "a", encoding="utf-8") as f:
        f.write("\t".join(str(reg[k]) for k in reg) + "\n")
    return reg


# fontes oficiais sem endereço fixo: só por --registrar (o carregador lê o arquivo registrado)
MANUAIS = {"cfop", "tiss"}


def registrar(nome: str, origem: str, versao: str | None = None) -> dict:
    if nome not in MANUAIS:
        raise SystemExit(f"{nome}: fonte não é de registro manual ({', '.join(sorted(MANUAIS))})")
    org = Path(origem)
    if not org.is_file() or org.stat().st_size > 20 * 1024 * 1024:
        raise SystemExit(f"{origem}: arquivo ausente ou maior que 20 MB")
    pasta = CACHE / nome
    pasta.mkdir(parents=True, exist_ok=True)
    arq = pasta / org.name
    dados = org.read_bytes()
    arq.write_bytes(dados)
    reg = {"fonte": nome, "url": "registro_manual", "arquivo": str(arq.relative_to(RAIZ)), "bytes": len(dados),
           "sha256": hashlib.sha256(dados).hexdigest(),
           "baixado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "versao": versao or datetime.now(timezone.utc).strftime("%Y-%m-%d")}
    with open(CACHE / "registro.tsv", "a", encoding="utf-8") as f:
        f.write("\t".join(str(reg[k]) for k in reg) + "\n")
    return reg


def main() -> None:
    if "--registrar" in sys.argv:
        a = sys.argv[sys.argv.index("--registrar") + 1:]
        if len(a) < 2:
            raise SystemExit(__doc__)
        CACHE.mkdir(exist_ok=True)
        r = registrar(a[0], a[1], a[2] if len(a) > 2 else None)
        print(json.dumps({k: r[k] for k in ("fonte", "bytes", "versao")}, ensure_ascii=False))
        return
    if "--listar" in sys.argv:
        for k, (u, lim, v) in FONTES.items():
            print(f"{k}\t{lim} MB\t{u if isinstance(u, str) else '(dinâmica)'}")
        for k in sorted(MANUAIS):
            print(f"{k}\t-\t(registro manual da publicação oficial: --registrar)")
        return
    nomes = [a for a in sys.argv[1:] if not a.startswith("-")] or list(FONTES)
    CACHE.mkdir(exist_ok=True)
    for n in nomes:
        r = baixar(n)
        print(json.dumps({k: r[k] for k in ("fonte", "bytes", "versao")}, ensure_ascii=False))
    print(f"livre: {livre_gb():.0f} GB")


if __name__ == "__main__":
    main()
