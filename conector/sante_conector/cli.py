"""Ferramenta INTERNA de teste do motor (nunca é o fluxo do dono: esse é o painel da plataforma).

Saída: JSON só com metadados, contagens e hashes; nunca valores de linha.
  listar                                  .fdb da pasta autorizada, com aceite/motivo
  validar <relativo>                      caminho + cabeçalho
  sintetica <arquivo.fdb> [--versao N]    gera a imagem sintética do cliente de exemplo (no trabalho)
  registrar <relativo> [--modo snapshot|copia] [--sem-gstat] [--sha256] [--saida ARQ]
  ler-faixa <relativo> --tabela T [--inicio I --fim F]   linhas e hash agregado da faixa (sem valores)
  testes                                  suíte unittest (precisa de --privileged)
"""
import argparse
import json
import os
import sys
import time


def _json(obj, saida=None):
    txt = json.dumps(obj, indent=1, sort_keys=True, default=str)
    if saida:
        with open(saida, "w") as f:
            f.write(txt + "\n")
        uid = os.environ.get("CONECTOR_UID")
        if uid:
            os.chown(saida, int(uid), int(os.environ.get("CONECTOR_GID", uid)))
    else:
        print(txt)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="conector")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("listar")
    p = sub.add_parser("validar"); p.add_argument("relativo")
    p = sub.add_parser("sintetica"); p.add_argument("arquivo"); p.add_argument("--versao", type=int, default=1)
    p = sub.add_parser("registrar"); p.add_argument("relativo")
    p.add_argument("--modo", default="snapshot", choices=("snapshot", "copia")); p.add_argument("--sem-gstat", action="store_true")
    p.add_argument("--sha256", action="store_true"); p.add_argument("--saida")
    p = sub.add_parser("ler-faixa"); p.add_argument("relativo"); p.add_argument("--tabela", required=True)
    p.add_argument("--inicio", type=int); p.add_argument("--fim", type=int); p.add_argument("--modo", default="snapshot", choices=("snapshot", "copia"))
    sub.add_parser("testes")
    a = ap.parse_args(argv)

    from . import caminho
    if a.cmd == "listar":
        return _json(caminho.listar_origens())
    if a.cmd == "validar":
        v = caminho.validar_origem(a.relativo); v.pop("absoluto")
        return _json(v)
    if a.cmd == "sintetica":
        from . import sintetica
        return _json(sintetica.gerar(a.arquivo, a.versao))
    if a.cmd == "testes":
        import unittest
        r = unittest.main(module=None, argv=["conector", "discover", "-s", "/app/testes", "-t", "/app"], exit=False,
                          verbosity=1)
        return 0 if r.result.wasSuccessful() else 1

    from . import abridor
    from .leitor import Leitor, hash_linha, hash_bloco
    origem = caminho.validar_origem(a.relativo)
    if a.cmd == "registrar":
        from . import imagem
        if a.sha256:
            origem["sha256"] = caminho.sha256_arquivo(origem["absoluto"])
        t0 = time.time()
        with abridor.abrir(origem["absoluto"], modo=a.modo) as ab:
            with Leitor(ab.dispositivo) as lt:
                reg = imagem.registrar(lt, origem, ab, progresso=True)
            if not a.sem_gstat:
                imagem.confrontar_gstat(reg, ab.dispositivo)
        reg["abertura"] = ab.resumo()
        reg["segundos_total"] = round(time.time() - t0, 1)
        return _json(reg, a.saida)
    if a.cmd == "ler-faixa":
        with abridor.abrir(origem["absoluto"], modo=a.modo) as ab:
            with Leitor(ab.dispositivo) as lt:
                pk = lt.chave_primaria(a.tabela)
                if len(pk) != 1:
                    raise SystemExit("ler-faixa exige PK inteira simples")
                ini, fim = a.inicio, a.fim
                if ini is None:
                    ini, mx = lt.limites(a.tabela, pk[0]); fim = (mx or 0) + 1
                nomes, it = lt.ler_faixa(a.tabela, pk[0], ini, fim)
                hs = [hash_linha(l) for l in it]
        return _json({"tabela": a.tabela, "pk": pk[0], "inicio": ini, "fim": fim, "linhas": len(hs),
                      "colunas": len(nomes), "hash_faixa": hash_bloco(hs), "modo": ab.modo})


if __name__ == "__main__":
    sys.exit(main() or 0)
