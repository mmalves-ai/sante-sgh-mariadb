"""Ferramenta INTERNA de teste do motor (nunca é o fluxo do dono: esse é o painel da plataforma).

Saída: JSON só com metadados, contagens e hashes; nunca valores de linha.
  listar                                  .fdb da pasta autorizada, com aceite/motivo
  validar <relativo>                      caminho + cabeçalho
  sintetica <arquivo.fdb> [--versao N] [--mapa]  gera a imagem sintética do cliente de exemplo (no trabalho)
  registrar <relativo> [--modo snapshot|copia] [--sem-gstat] [--sha256] [--saida ARQ]
  ler-faixa <relativo> --tabela T [--inicio I --fim F]   linhas e hash agregado da faixa (sem valores)
  dicionario <relativo> --saida ARQ        dicionário de colunas (tabela|coluna|tipo|bytes|escala|obrigatória|subtipo),
                                          só metadado, para o gerador do mapa (tools/obra/gerar_mapa_conector.py)
  testes                                  suíte unittest (precisa de --privileged e do MariaDB)
Fila e motor (L2; banco plataforma em CONECTOR_PLATAFORMA_BANCO):
  vincular <codigo> <relativo>            valida o .fdb, registra a origem ativa do cliente (evento conector_vinculo)
  enfileirar <codigo> importar|sincronizar   põe na fila (erro 409 se já há execução ativa do cliente)
  cancelar <id>                           cancela execução ainda na fila
  execucao <id>                           estado, etapa, % e contadores
  fila [--limite N]                       últimas execuções
  worker [--uma] [--espera S]             trabalhador (com --uma: no máximo uma execução; precisa do abridor)
  worker-separado [--uma] [--espera S]    abridor privilegiado sem rede + motor sem privilégio (o conector.sh usa)
  conta-motor --rede CIDR                 cria/renova a conta restrita do motor (feita pela root, fora do worker)
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
    p.add_argument("--mapa", action="store_true")
    p = sub.add_parser("registrar"); p.add_argument("relativo")
    p.add_argument("--modo", default="snapshot", choices=("snapshot", "copia")); p.add_argument("--sem-gstat", action="store_true")
    p.add_argument("--sha256", action="store_true"); p.add_argument("--saida")
    p = sub.add_parser("dicionario"); p.add_argument("relativo"); p.add_argument("--saida", required=True)
    p.add_argument("--modo", default="snapshot", choices=("snapshot", "copia"))
    p = sub.add_parser("ler-faixa"); p.add_argument("relativo"); p.add_argument("--tabela", required=True)
    p.add_argument("--inicio", type=int); p.add_argument("--fim", type=int); p.add_argument("--modo", default="snapshot", choices=("snapshot", "copia"))
    sub.add_parser("testes")
    p = sub.add_parser("vincular"); p.add_argument("codigo"); p.add_argument("relativo")
    p.add_argument("--admin", type=int)
    p = sub.add_parser("enfileirar"); p.add_argument("codigo"); p.add_argument("tipo", choices=("importar", "sincronizar"))
    p = sub.add_parser("cancelar"); p.add_argument("id", type=int)
    p = sub.add_parser("execucao"); p.add_argument("id", type=int)
    p = sub.add_parser("fila"); p.add_argument("--limite", type=int, default=20)
    p = sub.add_parser("worker"); p.add_argument("--uma", action="store_true"); p.add_argument("--espera", type=float, default=5)
    sub.add_parser("worker-separado")
    p = sub.add_parser("conta-motor"); p.add_argument("--rede", required=True)
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["worker-separado"]:
        from . import separado
        return separado.main(argv[1:])
    a = ap.parse_args(argv)

    if a.cmd in ("vincular", "enfileirar", "cancelar", "execucao", "fila"):
        from . import banco, caminho, plataforma
        conn = banco.conectar(banco.plataforma_banco())
        try:
            if a.cmd == "vincular":
                try:
                    return _json(plataforma.vincular_origem(conn, a.codigo, a.relativo, admin_id=a.admin))
                except plataforma.ExecucaoAtiva as e:
                    _json({"erro": 409, "motivo": str(e)}); return 3
                except (plataforma.PlataformaErro, caminho.OrigemRecusada) as e:
                    _json({"erro": 400, "motivo": str(e)}); return 3
            if a.cmd == "enfileirar":
                try:
                    return _json({"execucao_id": plataforma.enfileirar(conn, a.codigo, a.tipo)})
                except plataforma.ExecucaoAtiva as e:
                    _json({"erro": 409, "motivo": str(e)}); return 3
            if a.cmd == "cancelar":
                plataforma.cancelar(conn, a.id); return _json(plataforma.consultar(conn, a.id))
            if a.cmd == "execucao":
                return _json(plataforma.consultar(conn, a.id))
            return _json(plataforma.listar(conn, a.limite))
        except (plataforma.PlataformaErro, caminho.OrigemRecusada) as e:
            _json({"erro": 422, "motivo": str(e)}); return 3
        finally:
            conn.close()
    if a.cmd == "worker":
        from .trabalhador import Trabalhador
        t = Trabalhador()
        try:
            r = t.laco(uma=a.uma, espera=a.espera)
            if isinstance(r, dict):
                r["separacao"] = t.diagnostico()
            return _json(r)
        finally:
            t.fechar()

    if a.cmd == "conta-motor":
        from . import banco, controle
        conn = banco.conectar(None)
        try:
            plat = banco.plataforma_banco()
            return _json({"conta": controle.criar_conta_motor(conn, plat, os.environ.get("CONECTOR_MOTOR_SENHA"),
                                                              controle.host_da_rede(a.rede))})
        finally:
            conn.close()

    from . import caminho
    if a.cmd == "listar":
        return _json(caminho.listar_origens())
    if a.cmd == "validar":
        v = caminho.validar_origem(a.relativo); v.pop("absoluto")
        return _json(v)
    if a.cmd == "sintetica":
        from . import sintetica
        return _json(sintetica.gerar(a.arquivo, a.versao, mapa=a.mapa))
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
    if a.cmd == "dicionario":
        n = 0
        with abridor.abrir(origem["absoluto"], modo=a.modo) as ab, Leitor(ab.dispositivo) as lt, \
                open(a.saida, "w", encoding="utf-8") as f:
            for t in lt.tabelas():
                for c in lt.colunas(t):
                    f.write("%s|%s|%d|%d|%d|%d|%d\n" % (t, c["nome"], c["codigo_tipo"], c["bytes"], c["escala"],
                                                         1 if c["obrigatoria"] else 0, c["subtipo"]))
                    n += 1
        uid = os.environ.get("CONECTOR_UID")
        if uid:
            os.chown(a.saida, int(uid), int(os.environ.get("CONECTOR_GID", uid)))
        return _json({"colunas": n, "modo": ab.modo})
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
