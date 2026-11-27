"""Banco descartável do E2E com banco (tools/obra/e2e-vm.sh --banco). Nada de dado real: só contas e estabelecimentos
sintéticos. Os nomes têm prefixo fixo e só eles são criados ou apagados (o apagar recusa qualquer outro nome).

  criar  <arvore> <sufixo>  cria o cliente e2e_<sufixo> (banco cliente_e2e_<sufixo>) numa plataforma descartável
                            (plataforma_e2e_<sufixo>) pelo "criar novo cliente" DA ÁRVORE do commit (migrações, ações,
                            sementes); semeia os estabelecimentos sintéticos (ESTABELECIMENTOS, REDE_SINTETICA_SEGUNDO) e
                            as contas sintéticas da fonte sintética da árvore, com o mesmo id que a sessão sintética usa
                            (900000 + posição em CONTAS_SINTETICAS), e refaz as numerações dos estabelecimentos.
  apagar <arvore> <sufixo>  DROP só de cliente_e2e_<sufixo> e plataforma_e2e_<sufixo>, conferido o prefixo.

A senha do MariaDB vem de MARIADB_SENHA ou do arquivo SGH_ARQUIVO_AMBIENTE (o e2e-vm.sh o grava; nunca impressa). Espelho padrão da base: E2E_ESPELHO
(padrão: nenhum, para não copiar ~0,8 GB a cada rodada; o cliente nasce sem catálogos, com aviso).
uso: python3 -I tools/obra/e2e_banco.py criar <arvore> <sufixo> | apagar <arvore> <sufixo>
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SUFIXO = re.compile(r"[0-9a-f]{7,12}")
NOME = re.compile(r"(cliente|plataforma)_e2e_[0-9a-f]{7,12}")
ID_BASE = 900000  # o mesmo de idSintetico (apps/api/src/modulos/acesso/fonte-sintetica.ts)


def nomes(sufixo):
    if not SUFIXO.fullmatch(sufixo or ""):
        raise SystemExit(f"e2e_banco: sufixo inválido: {sufixo!r}")
    return f"cliente_e2e_{sufixo}", f"plataforma_e2e_{sufixo}"


def sql(arvore, banco, entrada=None, *args):
    r = subprocess.run([str(Path(arvore) / "tools/db/sql.sh")] + ([banco] if banco else []) + list(args),
                       input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"e2e_banco: SQL falhou em {banco}: {r.stderr.strip()[:300]}")
    return r.stdout


def apagar(arvore, sufixo):
    for banco in nomes(sufixo):
        if not NOME.fullmatch(banco):  # dupla conferência do prefixo antes do DROP
            raise SystemExit(f"e2e_banco: recuso apagar {banco}")
        sql(arvore, None, None, "-e", f"DROP DATABASE IF EXISTS `{banco}`")
    print(f"e2e_banco: apagados cliente_e2e_{sufixo} e plataforma_e2e_{sufixo}")


def contas_sinteticas(arvore):
    """Logins de CONTAS_SINTETICAS na ordem do objeto (a ordem dá o id)."""
    fonte = (Path(arvore) / "apps/api/src/modulos/acesso/fonte-sintetica.ts").read_text(encoding="utf-8")
    m = re.search(r"^export const CONTAS_SINTETICAS\b.*?^};", fonte, re.S | re.M)
    if not m:
        raise SystemExit("e2e_banco: CONTAS_SINTETICAS não encontrado")
    bloco = m.group(0)
    logins = re.findall(r"^  '([A-Z0-9._]+)': \{", bloco, re.M)
    chaves = re.findall(r"^  ['A-Za-z\[.]", bloco, re.M)  # chave, spread ou computada (não comentário nem })
    if not logins or len(logins) != len(chaves):  # chave fora do formato mudaria a ordem: recusa
        raise SystemExit(f"e2e_banco: {len(chaves)} chaves em CONTAS_SINTETICAS, {len(logins)} reconhecidas")
    return logins


def q(t):
    return "'" + t.replace("\\", "\\\\").replace("'", "''") + "'"


def estabelecimentos():
    codigos = [c.strip() for c in os.environ.get("ESTABELECIMENTOS", "pc,hs").split(",") if c.strip()]
    for extra in (os.environ.get("REDE_SINTETICA_SEGUNDO", "sx:"),):
        c = extra.split(":", 1)[0].strip()
        if c and c not in codigos:
            codigos.append(c)
    return [c for c in codigos if re.fullmatch(r"[a-z0-9_]{1,30}", c)]


def modulo(arvore, nome):
    spec = importlib.util.spec_from_file_location(f"{nome}_e2e", Path(arvore) / f"tools/db/{nome}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def criar(arvore, sufixo):
    cliente, plataforma = nomes(sufixo)
    arq = os.environ.get("SGH_ARQUIVO_AMBIENTE", "")
    if not os.environ.get("MARIADB_SENHA") and arq and Path(arq).is_file():  # o arquivo 600 que o e2e-vm.sh grava
        for linha in Path(arq).read_text(encoding="utf-8").splitlines():
            if linha.startswith("MARIADB_SENHA="):
                os.environ["MARIADB_SENHA"] = linha.split("=", 1)[1]
    if not os.environ.get("MARIADB_SENHA"):
        raise SystemExit("e2e_banco: MARIADB_SENHA ausente no ambiente")
    apagar(arvore, sufixo)  # sobra de rodada interrompida (SIGKILL) com o mesmo commit
    os.environ["PLATAFORMA_BANCO"] = plataforma
    cc = modulo(arvore, "criar_cliente")
    cc.PLAT = plataforma
    try:
        r = cc.criar(f"e2e_{sufixo}", "Cliente E2E descartável", espelho=os.environ.get("E2E_ESPELHO") or "e2e_sem_espelho")
    except cc.Recusa as e:
        raise SystemExit(f"e2e_banco: criar cliente recusado ({e.codigo}): {str(e)[:400]}")
    ests = estabelecimentos()
    logins = contas_sinteticas(arvore)
    agora = "UTC_TIMESTAMP(3)"
    linhas = [f"INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES "
              + ",".join(f"({q(c)}, {q('Estabelecimento sintético ' + c)}, {q('Estabelecimento sintético ' + c)}, {agora})"
                         for c in ests) + ";"]
    linhas.append("INSERT INTO usuario (id, login, nome, dispensa_cpf, criado_em) VALUES "
                  + ",".join(f"({ID_BASE + i}, {q(l)}, 'Usuário sintético (desenvolvimento)', TRUE, {agora})"
                             for i, l in enumerate(logins)) + ";")
    sql(arvore, cliente, "\n".join(linhas))
    num = modulo(arvore, "configurar_numeracoes").carregar(cliente)
    print(json.dumps({"cliente": f"e2e_{sufixo}", "banco": cliente, "plataforma": plataforma, "tabelas": r["tabelas"],
                      "estabelecimentos": len(ests), "contas": len(logins), "numeracoes": num.get("numeracoes"),
                      "espelho": "aviso" not in r["espelho"]}, ensure_ascii=False))


def main():
    a = sys.argv[1:]
    if len(a) == 3 and a[0] == "criar":
        criar(a[1], a[2])
    elif len(a) == 3 and a[0] == "apagar":
        apagar(a[1], a[2])
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
