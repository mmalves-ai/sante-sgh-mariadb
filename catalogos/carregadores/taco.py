"""Carregador versionado da composição nutricional dos alimentos: TACO, Tabela Brasileira de Composição de Alimentos
(NEPA/Unicamp), 4ª edição revisada e ampliada (F8, 04-HOT linha 142; decisão C3-018).

Catálogo público (regra 7): a TACO é de livre uso com a citação da fonte (NEPA-UNICAMP, Tabela brasileira de
composição de alimentos, 4. ed. rev. e ampl., Campinas, 2011). A TBCA (USP/FoRC) pede autorização para uso comercial:
só entra como espelho licenciado (ADR 0006) quando houver licença, com fonte_composicao = 'tbca'.
Sem endereço fixo de download em formato de dados: a planilha da publicação, salva em texto delimitado, é registrada por
`python3 -I catalogos/baixar.py --registrar taco <arquivo.csv> "TACO 4a ed."` e fica em catalogos/cache/taco/ (fora do git).

Formato aceito: texto delimitado (`;`, `,` ou tabulação), UTF-8 ou Latin-1. O cabeçalho é a 1ª linha que tem a coluna
do número do alimento; as colunas são achadas pelo nome (sem acento, minúsculas, sem a unidade entre parênteses). O
grupo do alimento vem da coluna `grupo`/`categoria`, ou da linha de título do grupo (só a 1ª célula preenchida), como
na planilha oficial. Valores com vírgula ou ponto decimal; `Tr` (traço) vale 0; `NA`, `*`, `-` e vazio ficam sem valor
(o nutriente não entra para aquele alimento).

Grava (idempotente; rodar de novo a mesma edição atualiza; edição nova encerra a vigência do que saiu; nada é apagado):
- grupo_alimento (código `taco.<grupo>`);
- nutriente_referencia pelo identificador INFOODS/FAO de cada coluna da TACO;
- alimento_referencia (fonte_composicao 'taco', codigo_fonte = número do alimento, porção de 100 g, energia em kcal,
  versao_fonte = a edição); a ligação com o gênero do estoque (insumo_id), que é do hospital, nunca é tocada;
- alimento_referencia_nutriente: a quantidade em 100 g por edição; a linha que saiu fica com vigencia_fim.
"""
import csv
import hashlib
import io
import re
import subprocess
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PASTA = RAIZ / "catalogos/cache/taco"
REGISTRO = RAIZ / "catalogos/cache/registro.tsv"
LOTE = 500
FONTE = "taco"
AVISOS: list = []

# coluna da TACO (chave normalizada, sem a unidade) -> (INFOODS, descrição, tipo, unidade, ordem)
NUTRIENTES = {
    "umidade": ("WATER", "Umidade", "outro", "g", 1),
    "energia_kcal": ("ENERC_KCAL", "Energia", "energia", "kcal", 2),
    "energia_kj": ("ENERC_KJ", "Energia (kJ)", "energia", "kJ", 3),
    "proteina": ("PROCNT", "Proteína", "macronutriente", "g", 4),
    "lipideos": ("FAT", "Lipídeos", "macronutriente", "g", 5),
    "colesterol": ("CHOLE", "Colesterol", "outro", "mg", 6),
    "carboidrato": ("CHOCDF", "Carboidrato", "macronutriente", "g", 7),
    "fibra_alimentar": ("FIBTG", "Fibra alimentar", "macronutriente", "g", 8),
    "cinzas": ("ASH", "Cinzas", "outro", "g", 9),
    "calcio": ("CA", "Cálcio", "micronutriente", "mg", 10),
    "magnesio": ("MG", "Magnésio", "micronutriente", "mg", 11),
    "manganes": ("MN", "Manganês", "micronutriente", "mg", 12),
    "fosforo": ("P", "Fósforo", "micronutriente", "mg", 13),
    "ferro": ("FE", "Ferro", "micronutriente", "mg", 14),
    "sodio": ("NA", "Sódio", "micronutriente", "mg", 15),
    "potassio": ("K", "Potássio", "micronutriente", "mg", 16),
    "cobre": ("CU", "Cobre", "micronutriente", "mg", 17),
    "zinco": ("ZN", "Zinco", "micronutriente", "mg", 18),
    "retinol": ("RETOL", "Retinol", "micronutriente", "mcg", 19),
    "re": ("VITA_RE", "Vitamina A (equivalente de retinol)", "micronutriente", "mcg", 20),
    "rae": ("VITA_RAE", "Vitamina A (equivalente de atividade de retinol)", "micronutriente", "mcg", 21),
    "tiamina": ("THIA", "Tiamina", "micronutriente", "mg", 22),
    "riboflavina": ("RIBF", "Riboflavina", "micronutriente", "mg", 23),
    "piridoxina": ("VITB6A", "Piridoxina", "micronutriente", "mg", 24),
    "niacina": ("NIA", "Niacina", "micronutriente", "mg", 25),
    "vitamina_c": ("VITC", "Vitamina C", "micronutriente", "mg", 26),
}
COL_NUMERO = ("numero_do_alimento", "numero", "codigo", "n", "no", "numero_alimento", "codigo_taco")
COL_DESCRICAO = ("descricao_dos_alimentos", "descricao", "alimento", "nome", "descricao_do_alimento")
COL_GRUPO = ("grupo", "categoria", "grupo_alimento", "grupo_de_alimentos")
SEM_VALOR = {"", "na", "*", "-", "--", "nd"}


def _chave(s):
    s = unicodedata.normalize("NFKD", s.strip().lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    if s.startswith("energia"):  # "Energia (kcal)" e "Energia (kJ)" se distinguem pela unidade
        return "energia_kj" if "kj" in s else "energia_kcal"
    s = re.sub(r"\([^)]*\)", "", s)
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def _texto(dados: bytes) -> str:
    for cod in ("utf-8-sig", "latin-1"):
        try:
            return dados.decode(cod)
        except UnicodeDecodeError:
            continue
    raise ValueError("taco: codificação desconhecida")


def valor(bruto: str):
    """Quantidade da célula: None sem valor; 0 no traço; número com vírgula ou ponto decimal."""
    v = bruto.strip().lower()
    if v in SEM_VALOR:
        return None
    if v in ("tr", "traco", "traço"):
        return 0.0
    v = v.replace(".", "").replace(",", ".") if "," in v else v
    try:
        n = float(v)
    except ValueError:
        return None
    return n if n >= 0 else None


def codigo_grupo(descricao: str) -> str:
    return ("taco." + _chave(descricao).replace("_", "-"))[:30]


def ler_tabela(dados: bytes) -> dict:
    """Lê a planilha da TACO em texto e devolve {"grupos": {codigo: descricao}, "alimentos": [...],
    "nutrientes": [chaves presentes]} (sem banco)."""
    texto = _texto(dados)
    amostra = "\n".join(texto.splitlines()[:5])
    sep = max((";", "\t", ","), key=amostra.count)
    linhas = list(csv.reader(io.StringIO(texto), delimiter=sep))
    ini = next((i for i, ln in enumerate(linhas) if any(_chave(c) in COL_NUMERO for c in ln)), None)
    if ini is None:
        raise ValueError("taco: cabeçalho sem a coluna do número do alimento")
    cab = [_chave(c) for c in linhas[ini]]
    pos_num = next(cab.index(n) for n in COL_NUMERO if n in cab)
    pos_desc = next((cab.index(n) for n in COL_DESCRICAO if n in cab), None)
    pos_grupo = next((cab.index(n) for n in COL_GRUPO if n in cab), None)
    if pos_desc is None:
        raise ValueError("taco: cabeçalho sem a coluna da descrição do alimento")
    pos_nut = {k: cab.index(k) for k in NUTRIENTES if k in cab}
    if "energia_kcal" not in pos_nut:
        raise ValueError("taco: cabeçalho sem a coluna de energia (kcal)")
    grupos, alimentos, vistos, grupo_atual = {}, [], set(), None

    def cel(ln, i):
        return ln[i].strip() if i is not None and i < len(ln) else ""

    for ln in linhas[ini + 1:]:
        num = cel(ln, pos_num)
        if not re.fullmatch(r"\d{1,6}", num):
            preenchidas = [c.strip() for c in ln if c.strip()]
            if len(preenchidas) == 1 and not re.search(r"\d", preenchidas[0]):
                grupo_atual = preenchidas[0][:150]
            continue
        desc = cel(ln, pos_desc)
        if not desc or num in vistos:
            continue
        vistos.add(num)
        g = cel(ln, pos_grupo) or grupo_atual
        if g:
            grupos[codigo_grupo(g)] = g[:150]
        quantidades = {k: v for k, i in pos_nut.items() if (v := valor(cel(ln, i))) is not None}
        alimentos.append({"codigo": str(int(num)), "descricao": desc[:200],
                          "grupo": codigo_grupo(g) if g else None, "quantidades": quantidades})
    return {"grupos": grupos, "alimentos": alimentos, "nutrientes": sorted(pos_nut, key=lambda k: NUTRIENTES[k][4])}


# ------------------------------------------------------------------ gravação
def _sql(banco, entrada, *args):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco] + list(args), input=entrada, capture_output=True,
                       text=True)
    if r.returncode:
        raise RuntimeError(f"taco: erro no SQL: {r.stderr.strip()[:500]}")
    return r.stdout


def _consulta(banco, q):
    return [ln.split("\t") for ln in _sql(banco, q, "-N", "-B").splitlines() if ln]


def _q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(round(v, 4)) if isinstance(v, float) else str(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def _upsert(banco, tabela, colunas, linhas, atualizar):
    upd = ", ".join(f"{c} = VALUES({c})" for c in atualizar) + ", alterado_em = UTC_TIMESTAMP(3)"
    for i in range(0, len(linhas), LOTE):
        vals = ",\n".join("(" + ", ".join(v if v in ("UTC_TIMESTAMP(3)", "UTC_DATE()") else _q(v) for v in ln) + ")"
                          for ln in linhas[i:i + LOTE])
        _sql(banco, f"SET NAMES utf8mb4;\nINSERT INTO {tabela} ({', '.join(colunas)}) VALUES\n{vals}\n"
                    f"ON DUPLICATE KEY UPDATE {upd};")


def _encerrar(banco, tabela, ids):
    for i in range(0, len(ids), LOTE):
        _sql(banco, f"UPDATE {tabela} SET vigencia_fim = GREATEST(vigencia_inicio, UTC_DATE()), "
                    f"alterado_em = UTC_TIMESTAMP(3), versao = versao + 1 "
                    f"WHERE vigencia_fim IS NULL AND id IN ({', '.join(map(str, ids[i:i + LOTE]))});")


def _fonte():
    """(arquivo, versão) do último registro da fonte taco; sem registro, o .csv mais novo da pasta."""
    if REGISTRO.exists():
        for ln in reversed(REGISTRO.read_text(encoding="utf-8").splitlines()):
            c = ln.split("\t")
            if c[0] == "taco" and len(c) > 5 and (RAIZ / c[2]).is_file():
                return RAIZ / c[2], (c[6] if len(c) > 6 and c[6] else c[5])[:30]
    arqs = sorted(PASTA.glob("*.csv")) if PASTA.is_dir() else []
    return (arqs[-1], arqs[-1].stem[:30]) if arqs else (None, None)


def carregar(banco: str) -> dict:
    arq, versao = _fonte()
    if not arq:
        AVISOS.append("tabela TACO ausente (baixar.py --registrar taco <arquivo> <versão>): nada carregado")
        return {}
    dados = arq.read_bytes()
    AVISOS.append(f"arquivo sha256 {hashlib.sha256(dados).hexdigest()[:16]}")
    return gravar(banco, ler_tabela(dados), versao)


def gravar(banco, m, versao) -> dict:
    agora, hoje = "UTC_TIMESTAMP(3)", "UTC_DATE()"
    _upsert(banco, "grupo_alimento", ["codigo", "descricao", "sigla", "ativo", "criado_em", "versao"],
            [[c, d, "TACO", True, agora, 1] for c, d in sorted(m["grupos"].items())], ["descricao", "ativo"])
    _upsert(banco, "nutriente_referencia",
            ["codigo_infoods", "descricao", "tipo", "simbolo_unidade", "ordem_exibicao", "vigencia_inicio",
             "versao_fonte", "criado_em", "versao"],
            [[*NUTRIENTES[k][:4], NUTRIENTES[k][4], hoje, versao, agora, 1] for k in m["nutrientes"]],
            ["descricao", "tipo", "simbolo_unidade", "ordem_exibicao", "versao_fonte"])
    grupos = {c: int(i) for c, i in _consulta(banco, "SELECT codigo, id FROM grupo_alimento WHERE codigo LIKE 'taco.%'")}
    nutr = {c: int(i) for c, i in _consulta(banco, "SELECT codigo_infoods, id FROM nutriente_referencia")}
    _upsert(banco, "alimento_referencia",
            ["fonte_composicao", "codigo_fonte", "descricao", "grupo_alimento_id", "porcao_referencia", "energia_kcal",
             "vigencia_inicio", "vigencia_fim", "versao_fonte", "criado_em", "versao"],
            [[FONTE, a["codigo"], a["descricao"], grupos.get(a["grupo"]), 100, a["quantidades"].get("energia_kcal"),
              hoje, None, versao, agora, 1] for a in m["alimentos"]],
            ["descricao", "grupo_alimento_id", "energia_kcal", "vigencia_fim", "versao_fonte"])
    alim = {c: int(i) for c, i in _consulta(
        banco, f"SELECT codigo_fonte, id FROM alimento_referencia WHERE fonte_composicao = '{FONTE}'")}
    linhas, vivos = [], set()
    for a in m["alimentos"]:
        for k, q in a["quantidades"].items():
            n = nutr[NUTRIENTES[k][0]]
            vivos.add((alim[a["codigo"]], n))
            linhas.append([alim[a["codigo"]], n, q, hoje, None, versao, agora, 1])
    _upsert(banco, "alimento_referencia_nutriente",
            ["alimento_referencia_id", "nutriente_referencia_id", "quantidade_100g", "vigencia_inicio", "vigencia_fim",
             "versao_fonte", "criado_em", "versao"], linhas, ["quantidade_100g", "vigencia_fim"])
    # o que saiu da edição: o alimento e as linhas de nutriente de outra edição ou ausentes ficam com vigência encerrada
    codigos = {a["codigo"] for a in m["alimentos"]}
    saiu_alim = [i for c, i in alim.items() if c not in codigos]
    _encerrar(banco, "alimento_referencia", saiu_alim)
    saiu_nutr = [int(i) for i, a, n, v in _consulta(
        banco, "SELECT an.id, an.alimento_referencia_id, an.nutriente_referencia_id, an.versao_fonte "
               "FROM alimento_referencia_nutriente an JOIN alimento_referencia ar ON ar.id = an.alimento_referencia_id "
               f"WHERE ar.fonte_composicao = '{FONTE}' AND an.vigencia_fim IS NULL")
        if v != versao or (int(a), int(n)) not in vivos]
    _encerrar(banco, "alimento_referencia_nutriente", saiu_nutr)
    return {"grupo_alimento": len(m["grupos"]), "nutriente_referencia": len(m["nutrientes"]),
            "alimento_referencia": len(m["alimentos"]), "alimento_referencia_nutriente": len(linhas),
            "alimentos_encerrados": len(saiu_alim), "nutrientes_encerrados": len(saiu_nutr)}
