"""Abridor: expõe o .fdb ao Firebird sem nunca abri-lo para escrita e sem copiá-lo inteiro.

Plano A (padrão): snapshot de bloco copy-on-write do device-mapper.
  - `losetup --read-only` sobre o original (o kernel recusa qualquer escrita; conferido por `blockdev --getro`);
  - um arquivo COW esparso no diretório de trabalho da execução, também em loop;
  - `dmsetup create <nome> snapshot <origem> <cow> N 16` (não persistente);
  - `gfix -mode read_only` no snapshot: a escrita do cabeçalho cai no COW; o banco aberto não faz GC nem sweep;
  - no fim: remove o snapshot, os loops e o COW; mede o COW usado.
  Exige container privilegiado (só o do conector, sem rede).
Plano B: cópia integral para o diretório de trabalho. Contraria o ADR 0003 item 7 ("nunca copiado inteiro"),
  por isso NUNCA é automático: não há recuo do snapshot para a cópia, em nenhuma falha (nem de loop, nem da
  conferência de somente leitura). Só roda com `modo="copia"` E autorização explícita registrada como decisão
  do dono para o ambiente (`CONECTOR_PLANO_B_AUTORIZADO=sim`, ou `plano_b_autorizado=True`), e só se o disco
  livre após a cópia ficar >= reserva (CONECTOR_RESERVA_GB, padrão 100); a cópia é apagada no fim.
"""
import contextlib
import os
import re
import shutil
import subprocess
import uuid

GFIX = "/opt/firebird/bin/gfix"
NOME_OK = re.compile(r"^[a-z0-9-]{1,40}$")


class AbridorErro(RuntimeError):
    pass


def _sh(*args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise AbridorErro("%s falhou (rc=%d): %s" % (args[0], r.returncode, (r.stderr or r.stdout).strip()[-300:]))
    return r.stdout.strip()


def _garantir_no_bloco(caminho, maj_min):
    """Em container privilegiado, nós de dispositivo criados depois da partida podem não existir em /dev."""
    if os.path.exists(caminho):
        return False
    maj, mi = maj_min.split(":")
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    os.mknod(caminho, 0o600 | 0o060000, os.makedev(int(maj), int(mi)))
    return True


def _loop(arquivo, somente_leitura):
    # O container só tem os nós /dev/loopN que existiam quando subiu. Depois de um reinício do host o kernel cria os
    # loops sob demanda, e "losetup --find" pode escolher um número sem nó aqui ("No such file or directory"). Por isso:
    # pede o livre (losetup -f cria o dispositivo no kernel), garante o nó (bloco, major 7) e monta nele, explícito.
    livre = _sh("losetup", "-f")
    num = os.path.basename(livre)
    try:
        with open("/sys/block/%s/dev" % num) as f:
            _garantir_no_bloco(livre, f.read().strip())
    except FileNotFoundError:
        _garantir_no_bloco(livre, "7:%s" % num.replace("loop", ""))
    args = ["losetup", "--show"] + (["--read-only"] if somente_leitura else []) + [livre, arquivo]
    dev = _sh(*args)
    num = os.path.basename(dev)
    with open("/sys/block/%s/dev" % num) as f:
        _garantir_no_bloco(dev, f.read().strip())
    return dev


def _gfix_somente_leitura(dispositivo):
    _sh(GFIX, "-mode", "read_only", dispositivo, "-user", os.environ.get("ISC_USER", "SYSDBA"))


class Abertura:
    def __init__(self, modo, dispositivo, original):
        self.modo = modo
        self.dispositivo = dispositivo
        self.original = original
        self.cow_usado_bytes = None
        self.cow_limite_bytes = None
        self.copia_bytes = None

    def resumo(self):
        return {k: v for k, v in vars(self).items() if k not in ("dispositivo", "original")}


def disco_livre(caminho):
    return shutil.disk_usage(caminho).free


def guarda_copia(tamanho, trabalho, reserva_gb):
    """Plano B só se, depois da cópia, o disco livre continuar >= reserva."""
    livre = disco_livre(trabalho)
    depois = livre - tamanho
    if depois < reserva_gb * 10**9:
        raise AbridorErro("plano B recusado pela guarda de disco: livre %.1f GB, cópia %.1f GB, sobraria %.1f GB "
                          "(< reserva %d GB)" % (livre / 1e9, tamanho / 1e9, depois / 1e9, reserva_gb))
    return depois


@contextlib.contextmanager
def _snapshot(original, trabalho, cow_mb, nome):
    criados = []  # pilha de desfazer
    ab = None
    try:
        loop_o = _loop(original, True)
        criados.append(("loop", loop_o))
        if _sh("blockdev", "--getro", loop_o) != "1":
            raise AbridorErro("loop do original não ficou somente leitura")
        cow = os.path.join(trabalho, "cow-%s.img" % nome)
        with open(cow, "wb") as f:
            f.truncate(cow_mb << 20)
        criados.append(("arquivo", cow))
        loop_c = _loop(cow, False)
        criados.append(("loop", loop_c))
        setores = _sh("blockdev", "--getsz", loop_o)
        dm = "sscon-%s" % nome
        _sh("dmsetup", "create", "--noudevsync", dm, "--table", "0 %s snapshot %s %s N 16" % (setores, loop_o, loop_c))
        criados.append(("dm", dm))
        disp = "/dev/mapper/%s" % dm
        mm = _sh("dmsetup", "info", "-c", "--noheadings", "-o", "major,minor", "--separator", ":", dm)
        if _garantir_no_bloco(disp, mm):
            criados.append(("no", disp))
        _gfix_somente_leitura(disp)
        ab = Abertura("snapshot", disp, original)
        ab.cow_limite_bytes = cow_mb << 20
        yield ab
    finally:
        erros = []
        for tipo, alvo in reversed(criados):
            try:
                if tipo == "dm":
                    st = _sh("dmsetup", "status", alvo).split()
                    # "0 <setores> snapshot <usados>/<total> <metadados>" ou "Invalid"/"Overflow"
                    if ab is not None:
                        if len(st) >= 4 and "/" in st[3]:
                            ab.cow_usado_bytes = int(st[3].split("/")[0]) * 512
                        else:
                            erros.append("snapshot inválido ao fechar (COW cheio?): %s" % " ".join(st[2:]))
                    _sh("dmsetup", "remove", "--noudevsync", alvo)
                elif tipo == "loop":
                    _sh("losetup", "-d", alvo)
                elif tipo in ("arquivo", "no"):
                    os.unlink(alvo)
            except Exception as e:  # segue desfazendo o resto
                erros.append(str(e))
        if erros:
            raise AbridorErro("; ".join(erros))


@contextlib.contextmanager
def _copia(original, trabalho, reserva_gb, nome):
    tamanho = os.path.getsize(original)
    guarda_copia(tamanho, trabalho, reserva_gb)
    destino = os.path.join(trabalho, "copia-%s.fdb" % nome)
    try:
        with open(original, "rb") as o, open(destino, "wb") as d:
            shutil.copyfileobj(o, d, 16 << 20)
        os.chmod(destino, 0o600)
        _gfix_somente_leitura(destino)
        ab = Abertura("copia", destino, original)
        ab.copia_bytes = tamanho
        yield ab
    finally:
        if os.path.exists(destino):
            os.unlink(destino)


def snapshot_disponivel():
    try:
        return "snapshot" in _sh("dmsetup", "targets") or os.path.exists("/dev/mapper/control")
    except Exception:
        return False


MODOS = ("snapshot", "copia")


def plano_b_autorizado_no_ambiente():
    return os.environ.get("CONECTOR_PLANO_B_AUTORIZADO", "").strip().lower() == "sim"


@contextlib.contextmanager
def abrir(original, modo="snapshot", trabalho=None, cow_mb=None, reserva_gb=None, nome=None,
          plano_b_autorizado=None):
    """Abre `original` (caminho já validado) para leitura pelo Firebird embarcado. Devolve uma `Abertura`.

    Padrão: snapshot (plano A), sem recuo. A cópia (plano B) só com `modo="copia"` e autorização explícita."""
    trabalho = trabalho or os.environ.get("CONECTOR_TRABALHO_DIR", "/trabalho")
    cow_mb = int(cow_mb or os.environ.get("CONECTOR_COW_MB", 2048))
    reserva_gb = int(reserva_gb if reserva_gb is not None else os.environ.get("CONECTOR_RESERVA_GB", 100))
    nome = nome or uuid.uuid4().hex[:12]
    if not NOME_OK.match(nome):
        raise AbridorErro("nome de execução inválido")
    if modo not in MODOS:
        raise AbridorErro("modo inválido: %s (sem modo automático: a cópia nunca é recuo)" % modo)
    os.makedirs(trabalho, exist_ok=True)
    if modo == "snapshot":
        with _snapshot(original, trabalho, cow_mb, nome) as ab:
            yield ab
        return
    if plano_b_autorizado is None:
        plano_b_autorizado = plano_b_autorizado_no_ambiente()
    if not plano_b_autorizado:
        raise AbridorErro("plano B (cópia integral) recusado: o arquivo apontado nunca é copiado inteiro (ADR 0003 "
                          "item 7); só com decisão do dono registrada (CONECTOR_PLANO_B_AUTORIZADO=sim)")
    with _copia(original, trabalho, reserva_gb, nome) as ab:
        ab.motivo_plano_b = "cópia pedida explicitamente, com autorização do dono"
        yield ab
