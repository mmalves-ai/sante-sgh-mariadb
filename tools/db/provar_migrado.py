"""Prova das obrigatoriedades relaxadas só no registro migrado (recusas da carga, fase 2, K1 e K1b).

uso: python3 -I tools/db/provar_migrado.py [--banco validacao] [--montar [--manter]]

Roda num banco de validação (nunca no banco de um cliente): já montado por `validar_migracoes.py --banco <b>
--manter`, ou, com --montar, recriado aqui (todos os */*_tabelas.sql e depois os */*_chaves.sql, na ordem do
validador) e apagado no fim. É o que faz a spec tools/db/provar-migrado.int.spec.ts. Para cada CHECK do K1, cria uma cópia vazia da tabela (CREATE TABLE ... LIKE, sem FKs), tira dela as
outras CHECKs, preenche as colunas obrigatórias com valores neutros e grava:
- origem 'sistema' sem o campo: tem de recusar com ERRO 4025 nomeando a CHECK do caso;
- origem 'migracao' sem o campo: tem de gravar.
Depois, na tabela real (com as FKs e todas as CHECKs), grava um registro clínico migrado e suspenso, com
profissional e sem usuário: os pais obrigatórios são criados antes (só eles com check_constraint_checks=0), numa
transação desfeita no fim (nada fica no banco). Também: profissional inexistente dá ERRO 1452 (FK) e o mesmo registro com origem 'sistema'
dá 4025.
Por fim, as chaves únicas novas do K1b (UNICOS): numa cópia sem CHECKs, a mesma linha gravada duas vezes dá ERRO 1062.
Imprime "ok" (com o número de casos) ou a lista de erros; sai com 1 se houver erro. Não lê dados de pessoas.
"""
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SQL = RAIZ / "tools/db/sql.sh"
MIG = RAIZ / "db/migracoes"
BANCO = sys.argv[sys.argv.index("--banco") + 1] if "--banco" in sys.argv else "validacao"
MONTAR = "--montar" in sys.argv
MANTER = "--manter" in sys.argv  # com --montar, não apaga o banco no fim (para depurar a prova)
if not BANCO.startswith("validacao"):
    raise SystemExit("recusado: a prova roda só em banco de validação (nome começa por 'validacao')")

S, M = {"origem": "sistema"}, {"origem": "migracao"}
# (tabela, check, campos comuns, [(campos do caso, resultado esperado)]); "4025" = recusa pela check do caso.
CASOS = [
    ("registro_assistencial", "ck_registro_assistencial_autor_usuario", {"autor_usuario_id": None},
     [(S, "4025"), (M, "ok")]),
    ("registro_assistencial", "ck_registro_assistencial_suspensao",
     {"situacao": "suspenso", "suspenso_em": "2026-01-01 00:00:00", "justificativa_suspensao": "x",
      "suspenso_por_usuario_id": None, "suspenso_por_profissional_id": 1},
     [(S, "4025"), (M, "ok"), ({**M, "suspenso_por_profissional_id": None}, "4025"),
      ({**S, "suspenso_por_usuario_id": 1}, "ok")]),
    ("alta_medica", "ck_alta_medica_profissional", {"profissional_id": None}, [(S, "4025"), (M, "ok")]),
    ("receita_medica", "ck_receita_medica_retroativa",
     {"emitida_em": "2026-01-01 00:00:00", "registrada_em": "2026-02-01 00:00:00", "justificativa_retroativa": None},
     [(S, "4025"), (M, "ok")]),
    ("documento_emitido", "ck_documento_emitido_texto", {"texto": None}, [(S, "4025"), (M, "ok")]),
    ("ficha_antimicrobiano", "ck_ficha_antimicrobiano_atendimento", {"atendimento_id": None},
     [(S, "4025"), (M, "ok")]),
    # D2: a auditoria da ficha migrada sem atendimento grava o atendimento nulo, sempre ligada à ficha.
    ("auditoria_prescricao_ccih", "ck_auditoria_prescricao_ccih_atendimento", {"atendimento_id": None},
     [({**S, "ficha_antimicrobiano_id": None}, "4025"), ({**S, "ficha_antimicrobiano_id": 1}, "ok"),
      ({**S, "atendimento_id": 1, "ficha_antimicrobiano_id": None}, "ok")]),
    ("tipo_fechamento_balanco", "ck_tipo_fechamento_balanco_periodo_obrigatorio", {"periodo_horas": None},
     [(S, "4025"), (M, "ok")]),
    ("tipo_fechamento_balanco", "ck_tipo_fechamento_balanco_origem", {},
     [({"origem": "invalida"}, "4025"), (M, "ok"), (S, "ok")]),
    ("exportacao_documento", "ck_exportacao_documento_autor", {"usuario_id": None, "profissional_id": 1},
     [(S, "4025"), (M, "ok"), ({**M, "profissional_id": None}, "4025")]),
    ("exportacao_documento", "ck_exportacao_documento_origem", {},
     [({"origem": "invalida"}, "4025"), (M, "ok"), (S, "ok")]),
    ("solicitante_externo", "ck_solicitante_externo_conselho_uf", {"conselho_unidade_federativa_id": None},
     [(S, "4025"), (M, "ok")]),
    ("situacao_marcacao", "ck_situacao_marcacao_significado", {},
     [({"significado": "nao_informada"}, "ok"), ({"significado": "inexistente"}, "4025")]),
    ("profissional_higienizacao", "ck_profissional_higienizacao_vinculo",
     {"vinculo": "proprio", "colaborador_id": None, "empresa_fornecedora_id": None}, [(S, "4025"), (M, "ok")]),
    ("exame_laboratorio_apoio", "ck_exame_laboratorio_apoio_exame", {"exame_id": None},
     [({"ativo": 1}, "4025"), ({"ativo": 0}, "ok")]),
    ("conta_hospitalar_segurado", "ck_conta_hospitalar_segurado_carteira", {"numero_carteira": None},
     [(S, "4025"), (M, "ok")]),
    ("guia_fonte_pagadora", "ck_guia_fonte_pagadora_paciente", {"paciente_id": None}, [(S, "4025"), (M, "ok")]),
    ("regra_repasse_item", "ck_regra_repasse_item_valor", {"percentual": 0, "valor_fixo": 0},
     [(S, "4025"), (M, "ok"), ({**S, "percentual": 10}, "ok"),
      ({**M, "percentual": 10, "valor_fixo": 10}, "4025"), ({**S, "percentual": 10, "valor_fixo": 10}, "4025")]),
    ("rubrica", "ck_rubrica_natureza", {"natureza_rubrica_id": None}, [(S, "4025"), (M, "ok")]),
    # K1b
    ("rateio_lancamento", "ck_rateio_lancamento_pai",
     {"titulo_pagar_id": None, "titulo_receber_id": None, "baixa_titulo_id": None, "movimento_bancario_id": None,
      "movimento_caixa_id": None, "adiantamento_id": 1},
     [(S, "ok"), (M, "ok"), ({**S, "adiantamento_id": None}, "4025"), ({**M, "titulo_pagar_id": 1}, "4025")]),
    ("requisicao_material", "ck_requisicao_material_setor",
     {"tipo": "setor", "setor_funcional_id": None, "centro_custo_id": None},
     [(S, "4025"), (M, "ok"), ({**S, "centro_custo_id": 1}, "ok"), ({**S, "tipo": "paciente"}, "ok")]),
    ("lote_insumo", "ck_lote_insumo_validade", {"validade": None}, [(S, "4025"), (M, "ok"),
                                                                    ({**S, "validade": "2027-01-01"}, "ok")]),
]
# (tabela, chave única, linha): a mesma linha gravada duas vezes tem de dar ERRO 1062 nomeando a chave.
UNICOS = [
    ("rateio_lancamento", "uq_rateio_lancamento_adiantamento", {**M, "adiantamento_id": 1, "sequencia": 1}),
    ("lote_insumo", "uq_lote_insumo_sem_validade", {**M, "validade": None, "numero_lote": "SEM_LOTE"}),
]


def sql(texto: str) -> subprocess.CompletedProcess:
    return subprocess.run([str(SQL), BANCO, "-N", "-B"], input=texto, capture_output=True, text=True)


def linhas(q: str) -> list[list[str]]:
    r = sql(q)
    if r.returncode != 0:
        raise SystemExit(f"consulta falhou: {r.stderr[:300]}")
    return [ln.split("\t") for ln in r.stdout.splitlines() if ln]


def literal(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def neutro(tipo: str, dtipo: str):
    if dtipo in ("tinyint", "smallint", "mediumint", "int", "bigint", "decimal", "float", "double", "bit"):
        return 1
    if dtipo == "date":
        return "2026-01-01"
    if dtipo in ("datetime", "timestamp"):
        return "2026-01-01 00:00:00"
    if dtipo == "time":
        return "00:00:00"
    if dtipo == "year":
        return 2026
    if dtipo == "enum":
        return tipo[tipo.index("'") + 1:tipo.index("'", tipo.index("'") + 1)]
    if dtipo == "json" or "json" in tipo:
        return "{}"
    return "x"


def colunas_obrigatorias(tabela: str) -> dict:
    """Colunas NOT NULL sem padrão (fora id, geradas e auditoria com padrão), com valor neutro."""
    base = {}
    for col, tipo, dtipo, nulo, padrao, extra in linhas(
            f"SELECT column_name, column_type, data_type, is_nullable, IFNULL(column_default,'<SEM>'), extra "
            f"FROM information_schema.columns WHERE table_schema='{BANCO}' AND table_name='{tabela}'"):
        if "auto_increment" in extra or "GENERATED" in extra.upper() or "VIRTUAL" in extra.upper() \
                or "STORED" in extra.upper():
            continue
        if nulo == "NO" and padrao in ("<SEM>", "NULL"):
            base[col] = neutro(tipo, dtipo)
    return base


def fks(tabela: str) -> dict:
    return {c: r for c, r in linhas(
        f"SELECT column_name, referenced_table_name FROM information_schema.key_column_usage "
        f"WHERE table_schema='{BANCO}' AND table_name='{tabela}' AND referenced_table_name IS NOT NULL")}


def valor(v) -> str:
    return v[len("@@var:"):] if isinstance(v, str) and v.startswith("@@var:") else literal(v)


def provar_real() -> tuple[list[str], int]:
    """Registro clínico migrado, suspenso, com profissional e sem usuário, na tabela real (FKs e CHECKs)."""
    tabela = "registro_assistencial"
    criados: list[tuple[str, str]] = []  # (tabela, variável), em ordem de criação
    script = ["SET SESSION check_constraint_checks = 0;"]  # só nos pais; o alvo grava com todas as CHECKs

    def criar(t: str, pilha: tuple = ()) -> str:
        var = f"@k1_{t}"[:60]
        if any(t == c for c, _ in criados):
            return var
        if t in pilha:
            raise SystemExit(f"ciclo de FK obrigatória: {' > '.join(pilha + (t,))}")
        base, ref = colunas_obrigatorias(t), fks(t)
        for col in list(base):
            if col in ref and ref[col] != t:
                base[col] = "@@var:" + criar(ref[col], pilha + (t,))
        script.append(f"INSERT INTO {t} ({', '.join(base)}) VALUES ({', '.join(valor(v) for v in base.values())});"
                      f" SET {var} = LAST_INSERT_ID();")
        criados.append((t, var))
        return var

    alvo, ref = colunas_obrigatorias(tabela), fks(tabela)
    for col in list(alvo):
        if col in ref:
            alvo[col] = "@@var:" + criar(ref[col])
    prof = "@@var:" + criar("profissional")
    linha = {**alvo, "origem": "migracao", "situacao": "suspenso", "suspenso_em": "2026-01-01 00:00:00",
             "justificativa_suspensao": "x", "autor_usuario_id": None, "suspenso_por_usuario_id": None,
             "impressao_digital": "0" * 64,
             "suspenso_por_profissional_id": prof}
    if "autor_profissional_id" in ref:
        linha["autor_profissional_id"] = prof
    casos = [(linha, "ok", ""), ({**linha, "suspenso_por_profissional_id": 999999999}, "1452", ""),
             ({**linha, "origem": "sistema"}, "4025", "ck_registro_assistencial_")]
    # Uma sessão só, numa transação desfeita no fim (nada fica no banco); --force segue depois de cada erro, e o
    # erro é atribuído ao caso pela linha ("at line N"): cada caso ocupa uma linha.
    script = ["START TRANSACTION;"] + script + ["SET SESSION check_constraint_checks = 1;"]
    linha_caso = {}
    for k, (campos, _, _) in enumerate(casos):
        linha_caso[len(script) + 1] = k
        script.append(f"INSERT INTO {tabela} ({', '.join(campos)}) VALUES ({', '.join(valor(v) for v in campos.values())});")
    script.append("ROLLBACK;")
    r = subprocess.run([str(SQL), BANCO, "--force", "-N", "-B"], input="\n".join(script) + "\n",
                       capture_output=True, text=True)
    falhas = {}
    for ln in r.stderr.splitlines():
        m = re.match(r"ERROR (\d+) .* at line (\d+): (.*)", ln)
        if m:
            falhas[int(m.group(2))] = (m.group(1), ln)
    erros = [f"real: pai não criado: {t[1][:200]}" for nl, t in falhas.items() if nl not in linha_caso]
    for nl, k in linha_caso.items():
        campos, esperado, ck = casos[k]
        cod, msg = falhas.get(nl, ("ok", ""))
        obtido = cod if cod in ("ok", "1452") else ("4025" if cod == "4025" and ck in msg else "outro")
        if obtido != esperado:
            erros.append(f"real {tabela} origem={campos['origem']} profissional={campos['suspenso_por_profissional_id']}:"
                         f" esperado {esperado}, obtido {obtido} {msg[:200]}")
    return erros, len(casos)


def montar() -> list[str]:
    r = subprocess.run([str(SQL), "-e", f"DROP DATABASE IF EXISTS {BANCO}; CREATE DATABASE {BANCO}"],
                       capture_output=True, text=True)
    erros = [f"montar: {r.stderr.strip()[:200]}"] if r.returncode else []
    for sufixo in ("_tabelas.sql", "_chaves.sql"):
        for arq in sorted(MIG.glob(f"*/*{sufixo}")):
            r = subprocess.run([str(SQL), BANCO, "--force"], input=arq.read_text(encoding="utf-8"),
                               capture_output=True, text=True)
            erros += [f"{arq.relative_to(RAIZ)}: {ln.strip()[:200]}" for ln in r.stderr.splitlines() if ln.strip()]
    return erros


def main() -> int:
    if MONTAR:
        # O validador de migrações é quem julga o DDL; aqui os erros de aplicação só aparecem como aviso (a prova
        # abaixo acusa se faltar o que ela precisa).
        avisos = [a for a in montar() if a.split(": ", 1)[-1].startswith("ERROR")]
        if avisos:
            print(f"aviso: {len(avisos)} erro(s) ao aplicar as migrações; o primeiro: {avisos[0][:200]}")
    try:
        return provar()
    finally:
        if MONTAR and not MANTER:
            subprocess.run([str(SQL), "-e", f"DROP DATABASE IF EXISTS {BANCO}"], capture_output=True, text=True)


def provar() -> int:
    erros, n = [], 0
    for tabela, check, comuns, variantes in CASOS:
        copia = f"k1prova_{tabela}"[:64]
        r = sql(f"DROP TABLE IF EXISTS {copia}; CREATE TABLE {copia} LIKE {tabela};")
        if r.returncode != 0:
            erros.append(f"{tabela}: cópia falhou: {r.stderr.strip()[:200]}")
            continue
        checks = [c for (c,) in linhas(f"SELECT constraint_name FROM information_schema.check_constraints "
                                       f"WHERE constraint_schema='{BANCO}' AND table_name='{copia}'")]
        if check not in checks:
            erros.append(f"{tabela}: CHECK {check} ausente")
        outras = [c for c in checks if c != check]
        for c in outras:  # uma por vez: a CHECK de coluna (ex.: JSON) não sai por DROP CONSTRAINT e não atrapalha
            sql(f"ALTER TABLE {copia} DROP CONSTRAINT `{c}`;")
        base = colunas_obrigatorias(copia)
        for campos, esperado in variantes:
            n += 1
            linha = {**base, **comuns, **campos}
            r = sql(f"INSERT INTO {copia} ({', '.join(linha)}) VALUES ({', '.join(literal(v) for v in linha.values())});"
                    f" DELETE FROM {copia};")
            obtido = "ok" if r.returncode == 0 else ("4025" if "4025" in r.stderr and check in r.stderr else "outro")
            if obtido != esperado:
                erros.append(f"{tabela}/{check} {campos}: esperado {esperado}, obtido {obtido}"
                             + (f" ({r.stderr.strip()[:160]})" if obtido == "outro" else ""))
        sql(f"DROP TABLE IF EXISTS {copia};")
    for tabela, chave, campos in UNICOS:
        n += 1
        copia = f"k1prova_{tabela}"[:64]
        sql(f"DROP TABLE IF EXISTS {copia}; CREATE TABLE {copia} LIKE {tabela};")
        for (c,) in linhas(f"SELECT constraint_name FROM information_schema.check_constraints "
                           f"WHERE constraint_schema='{BANCO}' AND table_name='{copia}'"):
            sql(f"ALTER TABLE {copia} DROP CONSTRAINT `{c}`;")
        linha = {**colunas_obrigatorias(copia), **campos}
        ins = f"INSERT INTO {copia} ({', '.join(linha)}) VALUES ({', '.join(literal(v) for v in linha.values())});"
        r = sql(ins + ins)
        if not ("1062" in r.stderr and chave in r.stderr):
            erros.append(f"{tabela}/{chave}: esperado 1062 na segunda linha, obtido {r.stderr.strip()[:160] or 'ok'}")
        sql(f"DROP TABLE IF EXISTS {copia};")
    erros_r, n_r = provar_real()
    erros += erros_r
    n += n_r
    if erros:
        print("\n".join(erros))
        return 1
    print(f"ok ({n} casos em {len(CASOS)} CHECKs e {len(UNICOS)} chaves únicas, {n_r} na tabela real com FKs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
