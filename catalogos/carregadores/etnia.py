"""Carregador das etnias indígenas (02-CAD linha 15): povos indígenas da tabela oficial de etnias do SUS, a mesma que
os sistemas de informação ambulatorial e hospitalar exigem quando a raça/cor é indígena.

Fonte: catalogos/cache/etnia_indigena/TAB_SIA.zip (tabelas auxiliares do SIA/SUS publicadas pelo DATASUS), baixado por
`python3 -I catalogos/baixar.py etnia_indigena` e registrado com o SHA-256 em catalogos/cache/registro.tsv. Nada é
transcrito aqui: o carregador lê o arquivo de conversão CNV/etnia.cnv do pacote (código de 4 dígitos e nome do povo,
com os nomes alternativos entre parênteses) e recusa o arquivo fora da forma.

Destino: povo_indigena, pela chave única do código oficial (uq_povo_indigena_codigo_etnia_sus). Idempotente:
INSERT ... ON DUPLICATE KEY UPDATE. Um povo que saia da tabela não é apagado (o cadastro do paciente continua legível):
a nova versão encerra a vigência dele na véspera, e ele deixa de ser oferecido para cadastro novo.
"""
import re
import subprocess
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ARQUIVO = RAIZ / "catalogos/cache/etnia_indigena/TAB_SIA.zip"
REGISTRO = RAIZ / "catalogos/cache/registro.tsv"
FONTE = "etnia_indigena"
MEMBRO = "cnv/etnia.cnv"
MINIMO = 200  # a tabela oficial tem mais de 250 povos; abaixo disso o arquivo está truncado ou mudou de forma
AVISOS = []

_CABECALHO = re.compile(r"^\s*(\d+)\s+\d+\s*$")
# linha do CNV (colunas fixas): sequência, nome (com nomes alternativos; o arquivo oficial corta o nome na largura da
# coluna, com um só espaço antes do código) e o código oficial, que é o último campo da linha
_LINHA = re.compile(r"^\s*(\d{1,4})\s+(\S.*?)\s+(\S+)\s*$")
_CODIGO = re.compile(r"^\d{4}$")


def _fechar_cortado(codigo: str, nome: str, encheu_coluna: bool) -> str:
    """O arquivo de conversão corta o nome na largura da coluna (50), às vezes no meio da lista de nomes alternativos
    entre parênteses. Nunca grava o nome cortado no meio: mantém o nome principal e os nomes alternativos completos
    (até a última vírgula ou barra antes do corte) e fecha o parêntese; sem nenhum alternativo completo, fica só o
    nome principal. Cada correção vira AVISO, com o código (dado público), para a conferência da carga. Também limpa a
    lista com item vazio (", )") e o espaço em volta da vírgula."""
    nome = re.sub(r"\s*,\s*", ", ", nome)
    nome = re.sub(r"\s*[,/]\s*\)", ")", nome)
    abre = nome.rfind("(")
    if abre < 0 or ")" in nome[abre:]:
        # parêntese fechado (ou nenhum): o nome está inteiro; só sem parêntese e enchendo a coluna não há como saber
        if abre < 0 and encheu_coluna:
            AVISOS.append(f"etnia {codigo}: nome na largura toda da coluna, sem parêntese; mantido como veio")
        return nome
    # parêntese aberto e não fechado: o nome foi cortado (o hífen invisível conta na largura, então o corte pode vir
    # com mais de um espaço antes do código)
    principal, lista = nome[:abre].rstrip(), nome[abre + 1:]
    corte = max(lista.rfind(","), lista.rfind("/"))
    completos = lista[:corte].strip(" ,/") if corte >= 0 else ""
    fechado = f"{principal} ({completos})" if completos else principal
    AVISOS.append(f"etnia {codigo}: nome cortado pelo arquivo oficial na largura da coluna; gravados o nome principal"
                  " e os nomes alternativos completos")
    return fechado


def ler_cnv(texto: str):
    """[(código, nome)] da tabela de etnias, em ordem de código. Recusa cabeçalho ausente, quantidade divergente do
    cabeçalho, linha fora da forma, código que não seja de 4 dígitos, código repetido ou menos linhas que o mínimo."""
    linhas = [ln for ln in texto.replace("\r", "").split("\n") if ln.strip()]
    if not linhas or not _CABECALHO.match(linhas[0]):
        raise RuntimeError("etnia: arquivo sem o cabeçalho do CNV (quantidade de linhas e tamanho do código)")
    declarado = int(_CABECALHO.match(linhas[0]).group(1))
    saida = {}
    for n, ln in enumerate(linhas[1:], 2):
        m = _LINHA.match(ln)
        if not m or not _CODIGO.fullmatch(m.group(3)):
            raise RuntimeError(f"etnia: linha {n} fora da forma (sequência, nome e código de 4 dígitos)")
        codigo = m.group(3)
        nome = " ".join(m.group(2).replace("\xad", "").split())
        if not nome:
            raise RuntimeError(f"etnia: linha {n} sem nome")
        # um só espaço entre o nome e o código: o nome encheu a coluna e pode ter sido cortado pelo arquivo oficial
        nome = _fechar_cortado(codigo, nome, m.start(3) - m.end(2) == 1)
        if codigo in saida:
            raise RuntimeError(f"etnia: código repetido na linha {n}")
        saida[codigo] = nome[:150]
    if len(saida) != declarado:
        raise RuntimeError(f"etnia: o cabeçalho declara {declarado} etnias e o arquivo traz {len(saida)}")
    if len(saida) < MINIMO:
        raise RuntimeError(f"etnia: só {len(saida)} etnias (mínimo {MINIMO}); arquivo incompleto?")
    return sorted(saida.items())


def ler(arquivo: Path):
    """Abre o pacote baixado e lê o CNV das etnias (o nome do membro no pacote é comparado sem caixa)."""
    with zipfile.ZipFile(arquivo) as z:
        nomes = [n for n in z.namelist() if n.replace("\\", "/").lower().endswith(MEMBRO)]
        if len(nomes) != 1:
            raise RuntimeError(f"etnia: o pacote não traz um único {MEMBRO}")
        return ler_cnv(z.read(nomes[0]).decode("latin-1"))


def versao() -> str:
    """Versão registrada do arquivo baixado (a última linha da fonte no registro do cache)."""
    v = None
    if REGISTRO.exists():
        for ln in REGISTRO.read_text(encoding="utf-8").splitlines():
            c = ln.split("\t")
            if c[0] == FONTE and len(c) > 6 and c[6]:
                v = c[6]
    if not v:
        raise RuntimeError(f"etnia: arquivo sem registro (python3 -I catalogos/baixar.py {FONTE})")
    return v[:30]


def _txt(v: str) -> str:
    return "'" + v.replace("\\", "\\\\").replace("'", "''") + "'"


def _sql(banco, entrada):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco], input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"erro no SQL ({banco}): {r.stderr.strip()[:2000]}")
    return r.stdout


CHAVE = "uq_povo_indigena_codigo_etnia_sus"


def estado(banco: str):
    """(o banco tem a chave única do código oficial?, povos vigentes)."""
    saida = _sql(banco, f"""SELECT (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE()
  AND table_name = 'povo_indigena' AND index_name = '{CHAVE}' AND non_unique = 0),
 (SELECT COUNT(*) FROM povo_indigena WHERE vigencia_fim IS NULL OR vigencia_fim >= UTC_DATE());
""")
    chave, vigentes = saida.strip().splitlines()[-1].split()
    return int(chave) > 0, int(vigentes)


def carregar(banco: str) -> dict:
    tem_chave, vigentes = estado(banco)
    if not tem_chave:
        # sem a chave única o INSERT ... ON DUPLICATE KEY não casa pelo código e a carga duplicaria os povos
        raise RuntimeError(f"etnia: o banco {banco} está sem a chave única do código oficial da etnia indígena")
    if not ARQUIVO.exists():
        falta = f"fonte {FONTE} não baixada: rode `python3 -I catalogos/baixar.py {FONTE}` e carregue de novo"
        if vigentes == 0:
            # sem povo vigente a raça/cor indígena não grava no cadastro: a carga falha, nunca vem de outra fonte
            raise RuntimeError(f"etnia: {falta} (o banco {banco} está sem etnias indígenas)")
        AVISOS.append(f"{falta}; mantidas as {vigentes} etnias já carregadas")
        return {"povo_indigena": vigentes}
    ls = ler(ARQUIVO)
    v = _txt(versao())
    vals = ",\n".join(f"({_txt(c)}, {_txt(d)})" for c, d in ls)
    codigos = ", ".join(_txt(c) for c, _ in ls)
    script = f"""SET NAMES utf8mb4;
START TRANSACTION;
CREATE TEMPORARY TABLE tmp_povo_indigena (codigo VARCHAR(10) NOT NULL, descricao VARCHAR(150) NOT NULL);
INSERT INTO tmp_povo_indigena VALUES
{vals};
INSERT INTO povo_indigena (codigo_etnia_sus, descricao, versao_fonte, criado_em, versao)
SELECT t.codigo, t.descricao, {v}, UTC_TIMESTAMP(3), 1 FROM tmp_povo_indigena t
ON DUPLICATE KEY UPDATE
  alterado_em = IF(povo_indigena.descricao <> VALUES(descricao) OR povo_indigena.vigencia_fim IS NOT NULL,
                   UTC_TIMESTAMP(3), povo_indigena.alterado_em),
  versao = IF(povo_indigena.descricao <> VALUES(descricao) OR povo_indigena.vigencia_fim IS NOT NULL,
              povo_indigena.versao + 1, povo_indigena.versao),
  descricao = VALUES(descricao), vigencia_fim = NULL, versao_fonte = VALUES(versao_fonte);
UPDATE povo_indigena
   SET vigencia_fim = DATE_SUB(UTC_DATE(), INTERVAL 1 DAY), versao_fonte = {v}, alterado_em = UTC_TIMESTAMP(3),
       versao = versao + 1
 WHERE codigo_etnia_sus REGEXP '^[0-9]{{4}}$' AND codigo_etnia_sus NOT IN ({codigos})
   AND (vigencia_fim IS NULL OR vigencia_fim >= UTC_DATE())
   AND (vigencia_inicio IS NULL OR vigencia_inicio < UTC_DATE());
COMMIT;
SELECT COUNT(*) FROM povo_indigena WHERE vigencia_fim IS NULL AND versao_fonte = {v} AND codigo_etnia_sus IN ({codigos});
"""
    total = int(_sql(banco, script).strip().splitlines()[-1])
    if total != len(ls):
        raise RuntimeError(f"povo_indigena: esperava {len(ls)} etnias vigentes, ficaram {total}")
    return {"povo_indigena": total}
