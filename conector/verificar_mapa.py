"""Verificador do mapa do conector na esteira (F4 L4, item 3). Uso: python3 -I conector/verificar_mapa.py

Falha (saída 1) em: tabela sem destino nem descarte justificado, ciclo não declarado, coluna ou tabela de destino
inexistente no DDL, regra/de-para desconhecidos, mapa gerado desatualizado e conflito entre os arquivos de colunas
declaradas (declarado/colunas.tsv e declarado/colunas.d/<fatia>.tsv). Sem banco e sem Firebird.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sante_conector import mapa  # noqa: E402


def main():
    d = mapa.carregar()
    erros = mapa.verificar_dados(**d)
    tab = d["tabelas"]
    carregaveis = [r for r in tab if r["tabelas_destino"]]
    if erros:
        print("mapa do conector: %d erro(s)" % len(erros))
        for e in erros[:200]:
            print("  - " + e)
        return 1
    print("mapa do conector ok: %d tabelas (%d carregáveis, %d descartadas ou sem carga), %d dependências (%d em duas fases), "
          "%d colunas geradas, %d declaradas (em %d arquivo(s))" % (
              len(tab), len(carregaveis), len(tab) - len(carregaveis), len(d["deps"]),
              sum(1 for x in d["deps"] if x.get("quebra")), len(d["colunas"]), len(d["colunas_decl"]),
              len({c["_arquivo"] for c in d["colunas_decl"]})))
    return 0


if __name__ == "__main__":
    sys.exit(main())
