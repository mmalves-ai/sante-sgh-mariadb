"""Abridor separado do motor (F4 L2): o único processo privilegiado do trabalhador.

- Roda como root no container privilegiado, mas numa rede própria vazia (`unshare --net`: só `lo`, desligada) e
  sem nenhuma credencial do MariaDB no ambiente (o lançador `separado.py` limpa o ambiente antes).
- Atende o motor por um soquete Unix (arquivo, 0600, dono = usuário do motor); confere o par por SO_PEERCRED.
- Operações: `abrir` (valida o caminho de novo pela pasta autorizada, monta o snapshot somente leitura, entrega o
  dispositivo ao usuário do motor e o desmonta quando o motor pede `fechar` ou a conexão cai), `listar` e
  `remover` (snapshots `sscon-e<id>-<ficha>` órfãos) e `diagnostico` (prova de separação, sem segredos).
- O motor nunca tem privilégio: sem capacidades, uid não root, `no_new_privs`.
"""
import contextlib
import json
import os
import re
import signal
import socket
import struct
import subprocess
import sys
import threading

from . import abridor, caminho

NOME_AB = re.compile(r"^e\d{1,18}-[0-9a-f]{6}$")
NOME_SNAP = re.compile(r"^sscon-e\d{1,18}-[0-9a-f]{6}$")
SEGREDOS = ("CONECTOR_MARIADB_SENHA", "CONECTOR_MOTOR_SENHA")


def _ler(f):
    ln = f.readline()
    return json.loads(ln) if ln else None


def _enviar(f, obj):
    f.write(json.dumps(obj) + "\n")
    f.flush()


def _interfaces():
    with open("/proc/self/net/dev") as f:
        return sorted(ln.split(":")[0].strip() for ln in f.readlines()[2:] if ":" in ln)


def _cap(campo):
    with open("/proc/self/status") as f:
        for ln in f:
            if ln.startswith(campo + ":"):
                return ln.split()[1]
    return None


def diagnostico():
    """Fatos do processo, sem segredos: uid, capacidades efetivas, interfaces de rede, segredo no ambiente."""
    return {"uid": os.getuid(), "cap_efetivas": _cap("CapEff"), "cap_limite": _cap("CapBnd"),
            "no_new_privs": _cap("NoNewPrivs"), "interfaces": _interfaces(),
            "segredo_no_ambiente": any(k in os.environ for k in SEGREDOS)}


def snapshots():
    saida = subprocess.run(["dmsetup", "ls"], capture_output=True, text=True, timeout=20).stdout
    return sorted(ln.split()[0] for ln in saida.splitlines() if ln.split() and NOME_SNAP.match(ln.split()[0]))


def remover_snapshot(nome):
    if not NOME_SNAP.match(nome or ""):
        raise ValueError("nome de snapshot inválido")
    deps = subprocess.run(["dmsetup", "deps", "-o", "devname", nome], capture_output=True, text=True).stdout
    subprocess.run(["dmsetup", "remove", "--noudevsync", nome], capture_output=True)
    for d in deps.replace("(", " ").replace(")", " ").split():
        if d.startswith("loop"):
            subprocess.run(["losetup", "-d", "/dev/" + d], capture_output=True)


def _atender(conn, uid, gid):
    f = conn.makefile("rw", encoding="utf-8")
    try:
        pid, puid, pgid = struct.unpack("3i", conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if puid not in (uid, 0):
            raise PermissionError("par não autorizado (uid %d)" % puid)
        req = _ler(f) or {}
        op = req.get("op")
        if op == "diagnostico":
            return _enviar(f, dict(diagnostico(), ok=True))
        if op == "listar":
            return _enviar(f, {"ok": True, "nomes": snapshots()})
        if op == "remover":
            remover_snapshot(req.get("nome"))
            return _enviar(f, {"ok": True})
        if op != "abrir":
            raise ValueError("operação desconhecida")
        if not NOME_AB.match(req.get("nome") or ""):
            raise ValueError("nome de execução inválido")
        origem = caminho.validar_origem(req.get("relativo"))  # o abridor confere por conta própria
        with abridor.abrir(origem["absoluto"], modo="snapshot", nome=req["nome"]) as ab:
            os.chown(ab.dispositivo, uid, gid)
            os.chmod(ab.dispositivo, 0o600)
            _enviar(f, {"ok": True, "dispositivo": ab.dispositivo})
            _ler(f)  # `fechar` ou conexão caída: desmonta do mesmo jeito
        _enviar(f, {"ok": True, "resumo": ab.resumo()})
    except Exception as e:  # motivo técnico, sem valores de linha
        with contextlib.suppress(Exception):
            _enviar(f, {"ok": False, "erro": "%s: %s" % (type(e).__name__, str(e)[:400])})
    finally:
        with contextlib.suppress(Exception):
            f.close()
        conn.close()


def servir(caminho_sock, uid, gid):
    if any(k in os.environ for k in SEGREDOS):
        raise SystemExit("abridor recusado: credencial no ambiente")
    with contextlib.suppress(FileNotFoundError):
        os.unlink(caminho_sock)
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.bind(caminho_sock)
    os.chown(caminho_sock, uid, gid)
    os.chmod(caminho_sock, 0o600)
    s.listen(16)
    ativos = []
    signal.signal(signal.SIGTERM, lambda *a: s.shutdown(socket.SHUT_RDWR))
    while True:
        try:
            c, _ = s.accept()
        except OSError:  # SIGTERM: para de aceitar e espera os snapshots abertos serem desmontados
            break
        t = threading.Thread(target=_atender, args=(c, uid, gid))
        t.start()
        ativos = [x for x in ativos if x.is_alive()] + [t]
    for t in ativos:
        t.join(120)


# ---------- lado do motor ----------

class AbridorIndisponivel(RuntimeError):
    pass


def _soquete():
    p = os.environ.get("CONECTOR_ABRIDOR_SOCKET")
    if not p:
        raise AbridorIndisponivel("abridor separado indisponível (CONECTOR_ABRIDOR_SOCKET)")
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(p)
    return s, s.makefile("rw", encoding="utf-8")


def pedir(op, **kw):
    s, f = _soquete()
    try:
        _enviar(f, dict(kw, op=op))
        r = _ler(f) or {"ok": False, "erro": "sem resposta"}
    finally:
        f.close(); s.close()
    if not r.get("ok"):
        raise abridor.AbridorErro("abridor: %s" % r.get("erro"))
    return r


@contextlib.contextmanager
def abrir_remoto(relativo, nome):
    """Pede o snapshot ao abridor; o dispositivo vale enquanto a conexão estiver aberta."""
    s, f = _soquete()
    try:
        _enviar(f, {"op": "abrir", "relativo": relativo, "nome": nome})
        r = _ler(f) or {"ok": False, "erro": "sem resposta"}
        if not r.get("ok"):
            raise abridor.AbridorErro("abridor: %s" % r.get("erro"))
        ab = abridor.Abertura("snapshot", r["dispositivo"], None)
        ab.separado = True
        try:
            yield ab
        finally:
            _enviar(f, {"op": "fechar"})
            r2 = _ler(f) or {"ok": False, "erro": "sem resposta ao fechar"}
            if not r2.get("ok"):
                raise abridor.AbridorErro("abridor ao fechar: %s" % r2.get("erro"))
            for k, v in r2["resumo"].items():
                setattr(ab, k, v)
    finally:
        with contextlib.suppress(Exception):
            f.close()
        s.close()


if __name__ == "__main__":
    servir(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
