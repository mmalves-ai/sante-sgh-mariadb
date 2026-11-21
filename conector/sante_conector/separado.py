"""Lançador do trabalhador separado (`conector.sh worker`): um abridor privilegiado sem rede e sem credencial
(`servico_abridor`, em `unshare --net`) e o motor sem privilégio (`setpriv`: uid não root, sem capacidades, sem
limite de capacidades, `no_new_privs`), que é o único com a rede interna e com a conta restrita do motor no MariaDB
(`sscon_motor_<ficha>`, criada por `conta-motor`; nunca a root). Este processo só lança os dois e espera.
"""
import os
import subprocess
import sys
import time

from . import banco
from .servico_abridor import SEGREDOS

PY = [sys.executable, "-s", "-m"]


def ambiente_limpo():
    return {k: v for k, v in os.environ.items() if k not in SEGREDOS}


def iniciar_abridor(sock, uid, gid):
    ab = subprocess.Popen(["unshare", "--net", "--"] + PY + ["sante_conector.servico_abridor", sock, str(uid), str(gid)],
                          env=ambiente_limpo())
    for _ in range(200):
        if os.path.exists(sock):
            return ab
        if ab.poll() is not None:
            break
        time.sleep(0.05)
    ab.kill()
    raise RuntimeError("abridor separado não subiu")


def main(args):
    uid = int(os.environ.get("CONECTOR_MOTOR_UID") or os.environ.get("CONECTOR_UID") or 65534)
    gid = int(os.environ.get("CONECTOR_MOTOR_GID") or os.environ.get("CONECTOR_GID") or uid)
    if uid == 0 or gid == 0:
        raise SystemExit("o motor nunca roda como root")
    senha = os.environ.get("CONECTOR_MOTOR_SENHA")
    if not senha:
        raise SystemExit("falta a senha da conta restrita do motor (CONECTOR_MOTOR_SENHA)")
    base = "/tmp/sscon-%d" % os.getpid()
    os.makedirs(base + "/fb", exist_ok=True)
    os.chown(base + "/fb", uid, gid)
    sock = base + "/abridor.sock"
    ab = iniciar_abridor(sock, uid, gid)
    try:
        env = dict(ambiente_limpo(), CONECTOR_ABRIDOR_SOCKET=sock, FIREBIRD_LOCK=base + "/fb", HOME=base + "/fb",
                   CONECTOR_MARIADB_USUARIO=banco.nome_conta_motor(), CONECTOR_MARIADB_SENHA=senha)
        m = subprocess.run(["setpriv", "--reuid", str(uid), "--regid", str(gid), "--clear-groups", "--inh-caps=-all",
                            "--bounding-set=-all", "--no-new-privs", "--"] + PY + ["sante_conector.cli", "worker"]
                           + list(args), env=env)
        return m.returncode
    finally:
        ab.terminate()
        try:
            ab.wait(15)
        except subprocess.TimeoutExpired:
            ab.kill()
