"""Carregador das áreas de DDD (02-CAD linha 14): os 67 códigos de área do plano de numeração nacional da Anatel,
cada um com a sua UF, os dígitos do número fixo (8) e do móvel (9) e as máscaras. Base para validar o telefone.

Fonte: plano geral de códigos nacionais (Anatel), transcrito aqui por ser uma lista curta, pública e estável; a
versão vai em versao_fonte. Depende do carregador ibge (unidade_federativa pela sigla).

Idempotente: INSERT ... ON DUPLICATE KEY UPDATE sobre codigo_anatel. Um código que saia do plano não é apagado: a
nova versão o marca inativo com fim de vigência (o histórico de telefones gravados continua legível).
"""
import subprocess
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
VERSAO = "anatel-pgcn-67-areas"

AREAS = {
    "SP": ["11", "12", "13", "14", "15", "16", "17", "18", "19"],
    "RJ": ["21", "22", "24"],
    "ES": ["27", "28"],
    "MG": ["31", "32", "33", "34", "35", "37", "38"],
    "PR": ["41", "42", "43", "44", "45", "46"],
    "SC": ["47", "48", "49"],
    "RS": ["51", "53", "54", "55"],
    "DF": ["61"],
    "GO": ["62", "64"],
    "TO": ["63"],
    "MT": ["65", "66"],
    "MS": ["67"],
    "AC": ["68"],
    "RO": ["69"],
    "BA": ["71", "73", "74", "75", "77"],
    "SE": ["79"],
    "PE": ["81", "87"],
    "AL": ["82"],
    "PB": ["83"],
    "RN": ["84"],
    "CE": ["85", "88"],
    "PI": ["86", "89"],
    "PA": ["91", "93", "94"],
    "AM": ["92", "97"],
    "RR": ["95"],
    "AP": ["96"],
    "MA": ["98", "99"],
}


def linhas():
    """(código, UF) de todas as áreas, em ordem de código."""
    return sorted((c, uf) for uf, cs in AREAS.items() for c in cs)


def _sql(banco, entrada):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco], input=entrada, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"erro no SQL ({banco}): {r.stderr.strip()[:2000]}")
    return r.stdout


def carregar(banco: str) -> dict:
    ls = linhas()
    vals = ",\n".join(
        f"('{c}', 'Área {c} ({uf})', '{uf}')" for c, uf in ls)
    codigos = ", ".join(f"'{c}'" for c, _ in ls)
    script = f"""SET NAMES utf8mb4;
START TRANSACTION;
CREATE TEMPORARY TABLE tmp_area_ddd (codigo CHAR(2) NOT NULL, descricao VARCHAR(150) NOT NULL, uf CHAR(2) NOT NULL);
INSERT INTO tmp_area_ddd VALUES
{vals};
INSERT INTO area_ddd (codigo_anatel, descricao, unidade_federativa_id, digitos_fixo, digitos_movel, mascara_fixo,
                      mascara_movel, ativo, versao_fonte, criado_em, versao)
SELECT t.codigo, t.descricao, u.id, 8, 9, '(00) 0000-0000', '(00) 00000-0000', TRUE, '{VERSAO}', UTC_TIMESTAMP(3), 1
  FROM tmp_area_ddd t JOIN unidade_federativa u ON u.sigla = t.uf
ON DUPLICATE KEY UPDATE descricao = VALUES(descricao), unidade_federativa_id = VALUES(unidade_federativa_id),
  digitos_fixo = 8, digitos_movel = 9, mascara_fixo = VALUES(mascara_fixo), mascara_movel = VALUES(mascara_movel),
  ativo = TRUE, vigencia_fim = NULL, versao_fonte = VALUES(versao_fonte);
UPDATE area_ddd SET ativo = FALSE, vigencia_fim = COALESCE(vigencia_fim, UTC_DATE()), versao_fonte = '{VERSAO}'
 WHERE codigo_anatel NOT IN ({codigos}) AND ativo;
COMMIT;
SELECT COUNT(*) FROM area_ddd WHERE ativo AND versao_fonte = '{VERSAO}';
"""
    total = int(_sql(banco, script).strip().splitlines()[-1])
    if total != len(ls):
        raise RuntimeError(f"area_ddd: esperava {len(ls)} áreas ativas, ficaram {total} (UF sem carga do ibge?)")
    return {"area_ddd": total}
