"""Numerações de negócio de um cliente (F2.4): configura em sequencia_negocio, para cada estabelecimento ativo, as
numerações que as operações pedem com proximoNumero sem criá-las (registro do ato cirúrgico, agendamento cirúrgico,
internação, prontuário, laudo, guias e protocolos da operadora...). Sem a linha, a gravação recusa com
"sequencia-nao-configurada".

Roda no "criar novo cliente" (tools/db/criar_cliente.py, depois das sementes) e de novo sempre que entra
estabelecimento novo (importação do conector ou cadastro): é idempotente e nunca altera a numeração que já existe (o
próximo número de quem já gravou fica como está); só inclui a que falta, começando em 1. A numeração importada de outro
sistema começa depois do maior número importado: isso é do conector, que grava a linha antes desta carga.

uso: python3 -I tools/db/configurar_numeracoes.py <codigo-cliente> [--conferir]
     (--conferir só confere: devolve as numerações que faltam, sem gravar)
"""
import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SQL = RAIZ / "tools/db/sql.sh"

# Numerações por estabelecimento que as operações usam sem criar (as que criam a sua, com garantirSequencia, ficam de
# fora). Ordem alfabética; o tipo é o nome de negócio da numeração.
NUMERACOES = (
    "agendamento_cirurgico",
    "agendamento_internacao",
    "atendimento",
    "ato_cirurgico",
    "caso_infeccao",
    "devolucao_dispensacao",
    "dispensacao",
    "documento_estoque",
    "fatura_plano",
    "guia_autorizacao",
    "internacao",
    "inventario_estoque",
    "junta",
    "laudo_exame",
    "nota_entrada",
    "ordem_manipulacao",
    "ordem_servico_manutencao",
    "pedido_compra",
    "pedido_leito",
    "plano_preventivo",
    "prontuario",
    "protocolo_atendimento",
    "protocolo_autorizacao",
    "protocolo_conta",
    "reacao_transfusional",
    "recurso_glosa",
    "remessa_consignada",
    "reposicao_consignada",
    "requisicao_material",
    "requisicao_transfusao",
    "senha_autorizacao",
    "sessao_caixa",
    "solicitacao_limpeza",
    "solicitacao_opme",
    "surto_infeccao",
)


def sql(banco: str, entrada: str | None = None, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([str(SQL), banco, *args], input=entrada, capture_output=True, text=True)


def _tipos_sql() -> str:
    return " UNION ALL ".join(f"SELECT '{t}' AS tipo" for t in NUMERACOES)


def _faltam_sql() -> str:
    return (
        f"SELECT e.id AS estabelecimento_id, t.tipo FROM estabelecimento e CROSS JOIN ({_tipos_sql()}) t "
        "WHERE e.excluido_em IS NULL AND NOT EXISTS (SELECT 1 FROM sequencia_negocio s "
        "WHERE s.estabelecimento_id = e.id AND s.tipo = t.tipo)"
    )


def conferir(banco: str) -> list[tuple[int, str]]:
    r = sql(banco, None, "-N", "-e", _faltam_sql() + " ORDER BY e.id, t.tipo")
    if r.returncode:
        raise SystemExit(f"numerações: leitura falhou: {r.stderr[:400]}")
    return [(int(a), b) for a, b in (l.split("\t") for l in r.stdout.splitlines() if l.strip())]


def carregar(banco: str) -> dict:
    """Inclui as numerações que faltam, numa transação. Devolve as contagens."""
    faltam = conferir(banco)
    if faltam:
        r = sql(banco, f"""START TRANSACTION;
INSERT INTO sequencia_negocio (estabelecimento_id, tipo, proximo_valor, incremento, ativo, criado_em)
{_faltam_sql()}
;
COMMIT;
""".replace("SELECT e.id AS estabelecimento_id, t.tipo", "SELECT e.id, t.tipo, 1, 1, TRUE, UTC_TIMESTAMP(3)", 1))
        if r.returncode:
            raise SystemExit(f"numerações: gravação falhou: {r.stderr[:400]}")
    estabs = sql(banco, None, "-N", "-e", "SELECT COUNT(*) FROM estabelecimento WHERE excluido_em IS NULL").stdout.strip()
    return {"numeracoes": len(faltam), "estabelecimentos": int(estabs or 0), "tipos": len(NUMERACOES)}


def main():
    pos = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(pos) != 1:
        raise SystemExit(__doc__)
    banco = f"cliente_{pos[0]}"
    if "--conferir" in sys.argv:
        faltam = conferir(banco)
        print(json.dumps({"faltam": len(faltam), "tipos": sorted({t for _, t in faltam})}, ensure_ascii=False))
        raise SystemExit(1 if faltam else 0)
    print(json.dumps(carregar(banco), ensure_ascii=False))


if __name__ == "__main__":
    main()
