"""Carregador versionado das curvas de crescimento de referência (F8, 03-PEP L141).

Fontes oficiais (baixadas por `python3 -I catalogos/baixar.py curvas_...`, em catalogos/cache/curvas_*/, fora do git):
- OMS 2006, padrões de crescimento infantil de 0 a 5 anos (adotados na Caderneta da Criança do Ministério da Saúde):
  peso, comprimento/estatura, perímetro cefálico e IMC para a idade, por sexo. Tabelas LMS (Box-Cox: L, M, S) por dia
  de vida, dos pacotes oficiais da OMS. Grava os pontos das tabelas semanais (0 a 13 semanas) e mensais (3 a 60 meses)
  publicadas pela OMS, que são os mesmos valores diários nesses dias (dia = semana × 7; dia = arredondado(mês ×
  30,4375)); o domínio interpola o LMS entre eles.
- OMS 2007, referência de crescimento de 5 a 19 anos: peso (até 10 anos), estatura e IMC para a idade, por sexo, LMS
  por mês (61 a 228 meses).
- INTERGROWTH-21st, padrões pós-natais do prematuro (27 a 64 semanas de idade pós-menstrual): peso, comprimento e
  perímetro cefálico por sexo, em linhas de escore Z (-3 a +3) por semana.

Grava (idempotente; rodar de novo a mesma edição não duplica, edição nova atualiza os valores e a versão; nada é
apagado):
- parametro_vital antropométricos que faltarem (peso, altura, perimetro_cefalico, imc);
- curva_referencia: uma por publicação × indicador × sexo (código estável, ex.: oms2006_peso_idade_m);
- curva_referencia_ponto: na OMS, faixas 'L', 'M' e 'S' por idade em meses (tipo_curva escore_z, eixo idade_meses); no
  INTERGROWTH, faixas 'Z-3' a 'Z+3' por semana de idade pós-menstrual (eixo idade_gestacional_semanas).
"""
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
CACHE = RAIZ / "catalogos/cache"
DIAS_MES = 30.4375
LOTE = 800
AVISOS: list = []

# parâmetro: (descrição, unidade, casas decimais)
PARAMETROS = {
    "peso": ("Peso", "kg", 3),
    "altura": ("Altura", "cm", 1),
    "perimetro_cefalico": ("Perímetro cefálico", "cm", 1),
    "imc": ("Índice de massa corporal", "kg/m²", 1),
}
# indicador: (parâmetro, nome, unidade)
INDICADORES = {
    "peso": ("peso", "Peso para a idade", "kg"),
    "estatura": ("altura", "Comprimento/estatura para a idade", "cm"),
    "pc": ("perimetro_cefalico", "Perímetro cefálico para a idade", "cm"),
    "imc": ("imc", "IMC para a idade", "kg/m²"),
}
SEXOS = {"m": ("masculino", "meninos"), "f": ("feminino", "meninas")}
FAIXAS_Z = ["Z-3", "Z-2", "Z-1", "Z0", "Z+1", "Z+2", "Z+3"]


def _arquivo(fonte: str) -> Path:
    pasta = CACHE / fonte
    arqs = sorted(p for p in pasta.glob("*") if p.is_file()) if pasta.is_dir() else []
    if not arqs:
        raise RuntimeError(f"curvas: fonte {fonte} não baixada (python3 -I catalogos/baixar.py {fonte})")
    return arqs[-1]


def ler_lms(texto: str) -> dict:
    """Tabela LMS da OMS (sex, age, l, m, s[, loh]) -> {'m'|'f': [(idade, l, m, s), ...]} (sex 1 = masculino)."""
    linhas = [ln.split() for ln in texto.splitlines() if ln.strip()]
    cab = [c.lower() for c in linhas[0]]
    i = {c: cab.index(c) for c in ("sex", "age", "l", "m", "s")}
    saida: dict = {"m": [], "f": []}
    for c in linhas[1:]:
        sx = "m" if c[i["sex"]] == "1" else "f" if c[i["sex"]] == "2" else None
        if sx is None:
            continue
        saida[sx].append((float(c[i["age"]]), float(c[i["l"]]), float(c[i["m"]]), float(c[i["s"]])))
    for sx in saida:
        saida[sx].sort()
    return saida


def amostrar_oms2006(pontos: list) -> list:
    """Dias das tabelas publicadas pela OMS: semanas 0 a 13 e meses 3 a 60 -> [(idade_meses, l, m, s)]."""
    por_dia = {int(p[0]): p for p in pontos}
    dias = sorted({7 * s for s in range(14)} | {round(m * DIAS_MES) for m in range(3, 61)})
    return [(d / DIAS_MES, *por_dia[d][1:]) for d in dias if d in por_dia]


def ler_linhas_z(texto: str) -> list:
    """Tabela de escore Z do INTERGROWTH (semana, Z-3 ... Z+3), com ou sem cabeçalho -> [(semana, [7 valores])]."""
    saida = []
    for ln in texto.splitlines():
        c = [x for x in re.split(r"[,;\s]+", ln.strip().strip('"')) if x]
        if len(c) != 8:
            continue
        try:
            v = [float(x.strip('"')) for x in c]
        except ValueError:
            continue  # cabeçalho
        saida.append((v[0], v[1:]))
    if any(sorted(z) != z for _, z in saida):
        raise RuntimeError("curvas: linha do INTERGROWTH fora de ordem crescente de Z")
    return sorted(saida)


def _sql(banco, entrada, *args):
    r = subprocess.run([str(RAIZ / "tools/db/sql.sh"), banco] + list(args), input=entrada, capture_output=True,
                       text=True)
    if r.returncode:
        raise RuntimeError(f"curvas: erro no SQL: {r.stderr.strip()[:500]}")
    return r.stdout


def _consulta(banco, q):
    return [ln.split("\t") for ln in _sql(banco, q, "-N", "-B").splitlines() if ln]


def _q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(round(v, 8)) if isinstance(v, float) else str(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def curvas_das_fontes() -> list:
    """Lista de curvas: dict com codigo, descricao, fonte, versao, sexo, indicador, eixo, tipo, idade e pontos
    [(x, faixa, y)]. Pura sobre os arquivos do cache (testável sem banco)."""
    curvas = []
    for ind in ("peso", "estatura", "pc", "imc"):
        tab = ler_lms(_arquivo(f"curvas_oms2006_{ind}").read_text(encoding="utf-8"))
        for sx in ("m", "f"):
            amostra = amostrar_oms2006(tab[sx])
            curvas.append(_curva_lms("oms2006", "OMS 2006", "oms-2006", ind, sx, amostra))
    for ind in ("peso", "estatura", "imc"):
        tab = ler_lms(_arquivo(f"curvas_oms2007_{ind}").read_text(encoding="utf-8"))
        for sx in ("m", "f"):
            amostra = [(p[0], p[1], p[2], p[3]) for p in tab[sx]]
            curvas.append(_curva_lms("oms2007", "OMS 2007", "oms-2007", ind, sx, amostra))
    for ind in ("peso", "estatura", "pc"):
        for sx in ("m", "f"):
            linhas = ler_linhas_z(_arquivo(f"curvas_ig_{ind}_{sx}").read_text(encoding="utf-8"))
            par, nome, un = INDICADORES[ind]
            pontos = [(x, FAIXAS_Z[k], z[k]) for x, z in linhas for k in range(7)]
            curvas.append({
                "codigo": f"intergrowth_{ind}_pma_{sx}",
                "descricao": f"INTERGROWTH-21st prematuro: {nome.lower().replace(' para a idade', '')} para a idade "
                             f"pós-menstrual, {SEXOS[sx][1]}",
                "fonte": "intergrowth", "versao": "intergrowth-2015", "sexo": sx, "parametro": par, "unidade": un,
                "eixo": "idade_gestacional_semanas", "tipo": "escore_z", "inicio": None, "fim": None,
                "pontos": pontos,
            })
    return curvas


def _curva_lms(pub, rotulo, versao, ind, sx, amostra):
    par, nome, un = INDICADORES[ind]
    pontos = [(x, f, v) for x, l, m, s in amostra for f, v in (("L", l), ("M", m), ("S", s))]
    xs = [a[0] for a in amostra]
    return {
        "codigo": f"{pub}_{ind}_idade_{sx}", "descricao": f"{rotulo}: {nome}, {SEXOS[sx][1]}",
        "fonte": "oms", "versao": versao, "sexo": sx, "parametro": par, "unidade": un, "eixo": "idade_meses",
        "tipo": "escore_z", "inicio": round(min(xs), 2), "fim": round(max(xs), 2), "pontos": pontos,
    }


def carregar(banco: str) -> dict:
    agora = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    curvas = curvas_das_fontes()
    ins = []
    for cod, (desc, un, casas) in PARAMETROS.items():
        ins.append(
            "INSERT INTO parametro_vital (codigo, descricao, tipo, tipo_resposta, unidade, casas_decimais, criado_em) "
            f"SELECT {_q(cod)}, {_q(desc)}, 'antropometrico', 'numero', {_q(un)}, {casas}, {_q(agora)} FROM DUAL "
            f"WHERE NOT EXISTS (SELECT 1 FROM parametro_vital WHERE codigo = {_q(cod)});")
    _sql(banco, "\n".join(ins))
    par = {c: int(i) for i, c in _consulta(banco, "SELECT id, codigo FROM parametro_vital WHERE codigo IN "
                                                  "('peso','altura','perimetro_cefalico','imc')")}
    sexo = {c: int(i) for i, c in _consulta(banco, "SELECT id, codigo FROM sexo WHERE codigo IN "
                                                   "('masculino','feminino')")}
    if len(sexo) < 2:
        raise RuntimeError("curvas: o catálogo de sexo do cliente não tem masculino e feminino")
    cabecas = []
    for ordem, c in enumerate(curvas, 1):
        val = [c["codigo"], c["descricao"][:150], c["fonte"], sexo[SEXOS[c["sexo"]][0]], par[c["parametro"]],
               c["eixo"], c["unidade"], c["inicio"], c["fim"], c["tipo"], True, ordem, c["versao"], agora]
        cabecas.append(
            "INSERT INTO curva_referencia (codigo_curva, descricao, fonte, sexo_id, parametro_vital_id, eixo_x, "
            "unidade_eixo_y, idade_inicio_meses, idade_fim_meses, tipo_curva, visivel, ordem_exibicao, versao_fonte, "
            f"criado_em) VALUES ({', '.join(_q(v) for v in val)}) ON DUPLICATE KEY UPDATE "
            "versao = versao + (versao_fonte <> VALUES(versao_fonte) OR descricao <> VALUES(descricao)), "
            "alterado_em = IF(versao_fonte <> VALUES(versao_fonte) OR descricao <> VALUES(descricao), "
            "VALUES(criado_em), alterado_em), descricao = VALUES(descricao), versao_fonte = VALUES(versao_fonte), "
            "idade_inicio_meses = VALUES(idade_inicio_meses), idade_fim_meses = VALUES(idade_fim_meses);")
    _sql(banco, "\n".join(cabecas))
    ids = {c: int(i) for i, c in _consulta(banco, "SELECT id, codigo_curva FROM curva_referencia")}
    total = 0
    for c in curvas:
        cid = ids[c["codigo"]]
        valores = [f"({cid}, {_q(f)}, {_q(round(x, 8))}, {_q(round(y, 8))}, {_q(c['versao'])}, {_q(agora)})"
                   for x, f, y in c["pontos"]]
        for i in range(0, len(valores), LOTE):
            _sql(banco,
                 "INSERT INTO curva_referencia_ponto (curva_referencia_id, codigo_faixa, valor_x, valor_y, "
                 "versao_fonte, criado_em) VALUES " + ",".join(valores[i:i + LOTE]) +
                 " ON DUPLICATE KEY UPDATE versao = versao + (valor_y <> VALUES(valor_y) OR versao_fonte <> "
                 "VALUES(versao_fonte)), alterado_em = IF(valor_y <> VALUES(valor_y) OR versao_fonte <> "
                 "VALUES(versao_fonte), VALUES(criado_em), alterado_em), valor_y = VALUES(valor_y), "
                 "versao_fonte = VALUES(versao_fonte);")
        total += len(valores)
    return {"curva_referencia": len(curvas), "curva_referencia_ponto": total}
