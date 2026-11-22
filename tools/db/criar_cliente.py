"""Comando "criar novo cliente" (ADR 0002, item 9): cria o banco vazio do cliente, aplica as migrações e o
registra no banco de controle da plataforma. O catálogo de ações do sistema (acao_sistema) é carregado aqui, dos
contratos do produto (tools/db/carregar_acoes.py; decisão do dono 2026-11-20, a), e as sementes dos domínios básicos
(db/sementes, por tools/db/carregar_sementes.py: os vocabulários que o produto consulta por código fixo) e as
numerações de negócio de cada estabelecimento (tools/db/configurar_numeracoes.py; rode de novo quando entrar
estabelecimento novo). A carga dos catálogos públicos é um passo seguinte
(catalogos/carregar.py), e a importação do SPDATA é do conector (só para cliente com origem conector_spdata).
O ESPELHO PADRÃO DA BASE (ADR 0006: catálogos oficiais e licenciados por edição; tools/db/espelho.py) é levado a
todo cliente novo aqui, quando existir (--espelho BANCO ou ESPELHO_BANCO; padrão "espelho"); sem espelho, o cliente
nasce sem catálogos e o resultado avisa. Atualização de edição nos existentes: tools/db/espelho.py atualizar.

uso: python3 -I tools/db/criar_cliente.py <codigo> "<nome>" [--origem vazio|conector_spdata] [--cnpj N]
                                          [--plataforma BANCO] [--espelho BANCO] [--admin ID] [--json]
     python3 -I tools/db/criar_cliente.py --listar

É também o serviço do painel da plataforma (F4 L3): a API chama este comando (função `criar`) com --json, o id do
administrador que pediu (--admin, gravado no evento) e, nos testes, um banco de plataforma de teste (--plataforma ou
PLATAFORMA_BANCO). Com --json, a saída é uma linha JSON, inclusive na recusa ({"erro": "...", "codigo": "..."}).

O banco do cliente se chama cliente_<codigo>. O comando é idempotente: recusa se o cliente já existir.
"""
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SQL = RAIZ / "tools/db/sql.sh"
MIG = RAIZ / "db/migracoes"
PLAT = re.sub(r"[^a-z0-9_]", "", __import__("os").environ.get("PLATAFORMA_BANCO", "plataforma")) or "plataforma"


class Recusa(SystemExit):
    """Recusa com código curto (o painel mostra a mensagem; a API mapeia o código para o HTTP)."""
    def __init__(self, codigo, mensagem):
        super().__init__(mensagem)
        self.codigo = codigo


def sql(banco, entrada=None, *args):
    r = subprocess.run([str(SQL)] + ([banco] if banco else []) + list(args), input=entrada,
                       capture_output=True, text=True)
    return r


def q(texto: str) -> str:
    return "'" + texto.replace("\\", "\\\\").replace("'", "''") + "'"


def garantir_plataforma():
    sql(None, None, "-e", f"CREATE DATABASE IF NOT EXISTS {PLAT}")
    # Trava do servidor: duas criações simultâneas (painel, testes em paralelo) não reaplicam o DDL da plataforma
    # ao mesmo tempo (DROP/ADD CONSTRAINT se atropelavam). A trava é da sessão e cai sozinha se a sessão cair.
    trava = f"sgh_plataforma_ddl_{PLAT}"
    for arq in sorted((RAIZ / "db/plataforma").glob("*.sql")):
        corpo = arq.read_text(encoding="utf-8").rstrip()
        texto = (f"DO GET_LOCK({q(trava)}, 300);\n" + corpo + ("" if corpo.endswith(";") else ";")
                 + f"\nDO RELEASE_LOCK({q(trava)});\n")
        r = sql(PLAT, texto)
        if r.returncode:
            raise SystemExit(f"plataforma: {arq.name}: {r.stderr[:400]}")


def aplicar_migracoes(banco: str) -> tuple[int, list[str]]:
    erros, n = [], 0
    for sufixo in ("_tabelas.sql", "_chaves.sql"):
        for arq in sorted(MIG.glob(f"*/*{sufixo}")):
            r = sql(banco, arq.read_text(encoding="utf-8"))
            n += 1
            if r.returncode:
                erros.append(f"{arq.relative_to(RAIZ)}: {r.stderr.strip()[:300]}")
    return n, erros


def carregador(nome="carregar_acoes"):
    """tools/db/<nome>.py (com -I, a pasta do script não entra no sys.path: carrega pelo caminho)."""
    spec = importlib.util.spec_from_file_location(nome, RAIZ / f"tools/db/{nome}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def espelho_mod():
    spec = importlib.util.spec_from_file_location("espelho_mod", RAIZ / "tools/db/espelho.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def criar(codigo, nome, origem="vazio", cnpj=None, admin=None, espelho=None):
    """Cria o banco cliente_<codigo>, aplica as migrações e as ações do sistema e registra na plataforma (com o
    evento 'criado'). Recusa (Recusa) se o código for inválido ou o cliente/banco já existir."""
    garantir_plataforma()
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,39}", codigo or ""):
        raise Recusa("codigo-invalido", "código inválido: minúsculas, dígitos e _, começando por letra (2 a 40)")
    if not nome or not nome.strip() or len(nome) > 150:
        raise Recusa("nome-invalido", "nome obrigatório, até 150 caracteres")
    if origem not in ("vazio", "conector_spdata"):
        raise Recusa("origem-invalida", "origem: vazio ou conector_spdata")
    if cnpj is not None and not re.fullmatch(r"[0-9]{14}", cnpj):
        raise Recusa("cnpj-invalido", "CNPJ com 14 dígitos")
    banco = f"cliente_{codigo}"
    ja = sql(PLAT, None, "-N", "-e", f"select count(*) from cliente where codigo={q(codigo)}").stdout.strip()
    if ja != "0":
        raise Recusa("cliente-existe", f"cliente {codigo} já existe")
    existe = sql(None, None, "-N", "-e", f"select count(*) from information_schema.schemata where schema_name={q(banco)}").stdout.strip()
    if existe != "0":
        raise Recusa("banco-existe", f"o banco {banco} já existe; não sobrescrevo")
    sql(None, None, "-e", f"CREATE DATABASE {banco} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci")
    n, erros = aplicar_migracoes(banco)
    if erros:
        sql(None, None, "-e", f"DROP DATABASE {banco}")
        raise Recusa("migracao-falhou", "migrações com erro; banco removido:\n" + "\n".join(erros[:20]))
    try:
        acoes = carregador().carregar(banco)
    except SystemExit as e:
        sql(None, None, "-e", f"DROP DATABASE {banco}")
        raise Recusa("acoes-falharam", f"{e}; banco removido")
    try:
        sementes = carregador("carregar_sementes").carregar(banco)
    except SystemExit as e:
        sql(None, None, "-e", f"DROP DATABASE {banco}")
        raise Recusa("sementes-falharam", f"{e}; banco removido")
    try:
        numeracoes = carregador("configurar_numeracoes").carregar(banco)
    except SystemExit as e:
        sql(None, None, "-e", f"DROP DATABASE {banco}")
        raise Recusa("numeracoes-falharam", f"{e}; banco removido")
    esp = espelho_mod()
    nome_esp = esp.nome_banco(espelho) if espelho else esp.ESPELHO
    if esp.existe(nome_esp):
        try:
            r_esp = esp.aplicar(banco, nome_esp)
        except SystemExit as e:
            sql(None, None, "-e", f"DROP DATABASE {banco}")
            raise Recusa("espelho-falhou", f"espelho: {e}; banco removido")
        if r_esp["orfaos"] or r_esp["divergentes"]:
            sql(None, None, "-e", f"DROP DATABASE {banco}")
            raise Recusa("espelho-falhou", f"espelho: órfãos {r_esp['orfaos'][:5]}, divergentes "
                                           f"{r_esp['divergentes'][:5]}; banco removido")
        espelho_res = {"espelho": nome_esp, "linhas": r_esp["linhas_no_cliente"], "tabelas": len(r_esp["tabelas"]),
                       "edicoes": r_esp["edicoes"]}
    else:
        espelho_res = {"espelho": nome_esp, "aviso": "espelho inexistente: cliente sem catálogos padrão"}
    tabelas = sql(None, None, "-N", "-e", f"select count(*) from information_schema.tables where table_schema={q(banco)}").stdout.strip()
    versao = sorted(p.parent.name + "/" + p.name for p in MIG.glob("*/*_chaves.sql"))[-1]
    agora = "UTC_TIMESTAMP(3)"
    adm = str(int(admin)) if admin is not None else "NULL"
    detalhe = {'arquivos_migracao': n, 'tabelas': int(tabelas or 0), 'acoes_sistema': acoes['ativas'],
               'sementes': sementes['sementes'], 'numeracoes': numeracoes['numeracoes'], 'origem': origem,
               'espelho': espelho_res}
    r = sql(PLAT, f"""
INSERT INTO cliente (codigo, nome, documento_cnpj, situacao, banco_nome, versao_migracao, origem_dados, criado_em, criado_por)
VALUES ({q(codigo)}, {q(nome.strip())}, {q(cnpj) if cnpj else 'NULL'}, 'implantacao', {q(banco)}, {q(versao)}, {q(origem)}, {agora}, {adm});
INSERT INTO cliente_evento (cliente_id, tipo, detalhe, ocorrido_em, administrador_plataforma_id, criado_em, criado_por)
VALUES (LAST_INSERT_ID(), 'criado', {q(json.dumps(detalhe))}, {agora}, {adm}, {agora}, {adm});
""")
    if r.returncode:
        sql(None, None, "-e", f"DROP DATABASE {banco}")
        raise Recusa("registro-falhou", f"registro na plataforma falhou: {r.stderr[:400]}")
    return {"cliente": codigo, "banco": banco, "tabelas": int(tabelas or 0), "acoes_sistema": acoes["ativas"],
            "sementes": sementes["sementes"], "numeracoes": numeracoes["numeracoes"], "origem": origem, "versao_migracao": versao,
            "espelho": espelho_res,
            "proximo_passo": "catalogos/carregar.py " + codigo + (" e conector" if origem == "conector_spdata" else "")}


def _arg(nome):
    return sys.argv[sys.argv.index(nome) + 1] if nome in sys.argv else None


def main():
    global PLAT
    if _arg("--plataforma"):
        PLAT = re.sub(r"[^a-z0-9_]", "", _arg("--plataforma"))
    if "--listar" in sys.argv:
        garantir_plataforma()
        print(sql(PLAT, None, "-e", "select id, codigo, nome, situacao, origem_dados, banco_nome, versao_migracao from cliente").stdout)
        return
    pos = [a for i, a in enumerate(sys.argv[1:], 1)
           if not a.startswith("--") and not (sys.argv[i - 1] in ("--origem", "--cnpj", "--plataforma", "--admin", "--espelho"))]
    if len(pos) < 2:
        raise SystemExit(__doc__)
    admin = _arg("--admin")
    try:
        r = criar(pos[0], pos[1], _arg("--origem") or "vazio", _arg("--cnpj"), int(admin) if admin else None,
                  _arg("--espelho"))
    except Recusa as e:
        if "--json" in sys.argv:
            print(json.dumps({"erro": str(e)[:600], "codigo": e.codigo}, ensure_ascii=False))
            raise SystemExit(3)
        raise
    print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main()
