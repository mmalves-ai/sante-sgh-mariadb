"""Validação do arquivo de origem: só dentro da pasta autorizada, regular, sem symlink, .fdb, cabeçalho ODS 12.

A pasta autorizada vem de CONECTOR_ORIGENS_DIR. Dentro do container ela é montada somente leitura em
/origens; no host, o padrão é o diretório de backups do banco-dev (resolvido por conector.sh).
O painel só oferece o que `listar_origens` devolve; caminho livre é recusado.
"""
import os
import stat
import struct

RAIZ_PADRAO_CONTAINER = "/origens"
PAGINAS_ACEITAS = (4096, 8192, 16384, 32768)
ODS_ACEITOS = (12,)  # Firebird 3.x
TIPO_PAGINA_CABECALHO = 1
BANDEIRA_ODS_FIREBIRD = 0x8000


class OrigemRecusada(ValueError):
    """Arquivo de origem recusado; a mensagem diz a regra violada, nunca conteúdo do arquivo."""


def raiz_autorizada():
    raiz = os.environ.get("CONECTOR_ORIGENS_DIR") or RAIZ_PADRAO_CONTAINER
    real = os.path.realpath(raiz)
    if not os.path.isdir(real):
        raise OrigemRecusada("pasta autorizada inexistente: %s" % raiz)
    return real


def ler_cabecalho(caminho):
    """Lê só os primeiros bytes (página de cabeçalho: metadados do arquivo, sem dado de pessoa)."""
    with open(caminho, "rb") as f:
        b = f.read(64)
    if len(b) < 32:
        raise OrigemRecusada("arquivo curto demais para ter cabeçalho Firebird")
    tipo = b[0]
    pagina, ods_bruto = struct.unpack_from("<HH", b, 16)
    if tipo != TIPO_PAGINA_CABECALHO:
        raise OrigemRecusada("primeira página não é cabeçalho Firebird (tipo %d)" % tipo)
    if not ods_bruto & BANDEIRA_ODS_FIREBIRD:
        raise OrigemRecusada("ODS sem a marca do Firebird")
    ods = ods_bruto & 0x7FFF
    if pagina not in PAGINAS_ACEITAS:
        raise OrigemRecusada("tamanho de página não aceito: %d" % pagina)
    if ods not in ODS_ACEITOS:
        raise OrigemRecusada("ODS %d não aceito (aceitos: %s)" % (ods, ODS_ACEITOS))
    return {"ods": ods, "pagina": pagina}


def validar_origem(relativo, raiz=None):
    """Valida um caminho relativo à pasta autorizada e devolve os dados do arquivo (sem sha256: é caro)."""
    raiz = raiz or raiz_autorizada()
    if not relativo or os.path.isabs(relativo) or "\x00" in relativo:
        raise OrigemRecusada("caminho deve ser relativo à pasta autorizada")
    partes = os.path.normpath(relativo).split(os.sep)
    if ".." in partes:
        raise OrigemRecusada("caminho sai da pasta autorizada")
    alvo = os.path.join(raiz, *partes)
    # nenhum componente pode ser symlink
    atual = raiz
    for p in partes:
        atual = os.path.join(atual, p)
        if os.path.islink(atual):
            raise OrigemRecusada("symlink não é aceito")
    real = os.path.realpath(alvo)
    if os.path.commonpath([real, raiz]) != raiz:
        raise OrigemRecusada("caminho sai da pasta autorizada")
    if not real.lower().endswith(".fdb"):
        raise OrigemRecusada("extensão deve ser .fdb")
    try:
        st = os.lstat(real)
    except FileNotFoundError:
        raise OrigemRecusada("arquivo inexistente")
    if not stat.S_ISREG(st.st_mode):
        raise OrigemRecusada("não é arquivo regular")
    if not os.access(real, os.R_OK):
        raise OrigemRecusada("arquivo sem permissão de leitura")
    cab = ler_cabecalho(real)
    if st.st_size == 0 or st.st_size % cab["pagina"]:
        raise OrigemRecusada("tamanho não é múltiplo da página (arquivo truncado?)")
    return {
        "relativo": os.path.relpath(real, raiz),
        "absoluto": real,
        "tamanho": st.st_size,
        "mtime": int(st.st_mtime),
        "ods": cab["ods"],
        "pagina": cab["pagina"],
    }


def listar_origens(raiz=None):
    """Lista os .fdb válidos da pasta autorizada (para o painel); os recusados vêm com o motivo."""
    raiz = raiz or raiz_autorizada()
    saida = []
    for dirpath, dirnames, arquivos in os.walk(raiz, followlinks=False):
        dirnames.sort()
        for nome in sorted(arquivos):
            if not nome.lower().endswith(".fdb"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, nome), raiz)
            try:
                saida.append(dict(validar_origem(rel, raiz), aceito=True))
            except OrigemRecusada as e:
                saida.append({"relativo": rel, "aceito": False, "motivo": str(e)})
    for s in saida:
        s.pop("absoluto", None)
    return saida


def sha256_arquivo(caminho, bloco=8 << 20):
    import hashlib
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        while True:
            b = f.read(bloco)
            if not b:
                break
            h.update(b)
    return h.hexdigest()
