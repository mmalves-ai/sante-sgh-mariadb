"""Prova das obrigatoriedades relaxadas só no registro migrado (recusas da carga, fase 2, K1).

uso: python3 -I tools/db/provar_migrado.py [--banco validacao]

Roda num banco de validação já montado por `validar_migracoes.py --banco <b> --manter` (nunca no banco de um
cliente). Para cada CHECK do K1, cria uma cópia vazia da tabela (CREATE TABLE ... LIKE, sem FKs), tira dela as
outras CHECKs, preenche as colunas obrigatórias com valores neutros e grava:
- origem 'sistema' sem o campo: tem de recusar com ERRO 4025 nomeando a CHECK do caso;
- origem 'migracao' sem o campo: tem de gravar.
Imprime "ok" (com o número de casos) ou a lista de erros; sai com 1 se houver erro. Não lê dados de pessoas.
"""
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SQL = RAIZ / "tools/db/sql.sh"
BANCO = sys.argv[sys.argv.index("--banco") + 1] if "--banco" in sys.argv else "validacao"
if BANCO.startswith("cliente_") or BANCO.startswith("conector_"):
    raise SystemExit("recusado: a prova roda só em banco de validação")

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
    ("tipo_fechamento_balanco", "ck_tipo_fechamento_balanco_periodo_obrigatorio", {"periodo_horas": None},
     [(S, "4025"), (M, "ok")]),
    ("exportacao_documento", "ck_exportacao_documento_autor", {"usuario_id": None, "profissional_id": 1},
     [(S, "4025"), (M, "ok"), ({**M, "profissional_id": None}, "4025")]),
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
     [(S, "4025"), (M, "ok"), ({**S, "percentual": 10}, "ok")]),
    ("rubrica", "ck_rubrica_natureza", {"natureza_rubrica_id": None}, [(S, "4025"), (M, "ok")]),
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


def main() -> int:
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
        base = {}
        for col, tipo, dtipo, nulo, padrao, extra in linhas(
                f"SELECT column_name, column_type, data_type, is_nullable, IFNULL(column_default,'<SEM>'), extra "
                f"FROM information_schema.columns WHERE table_schema='{BANCO}' AND table_name='{copia}'"):
            if "auto_increment" in extra or "GENERATED" in extra.upper() or "VIRTUAL" in extra.upper() \
                    or "STORED" in extra.upper():
                continue
            if nulo == "NO" and padrao in ("<SEM>", "NULL"):
                base[col] = neutro(tipo, dtipo)
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
    if erros:
        print("\n".join(erros))
        return 1
    print(f"ok ({n} casos em {len(CASOS)} CHECKs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
