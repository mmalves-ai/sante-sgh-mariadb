"""Preço particular por médico, vigência por evidência, repasse integral e agenda → profissional (ADR 0009, lote conector).

Roda depois da carga do mapa, em toda execução (importar e Sincronizar), no banco do cliente. Ordem:
1. **Agenda sem profissional → profissional pelo nome** (levantamento, seção 5.3, item 5): as palavras do nome da agenda
   que existem em algum nome de profissional (civil ou de exibição), sem títulos e conectivos, precisam ser pelo menos
   duas e estar TODAS no nome de um único profissional. Um só candidato: grava `agenda_servico.profissional_id`
   (melhor estimativa). Mais de um: pendência visível `agenda:profissional_ambiguo_pelo_nome` (nada gravado).
2. **Vigência por evidência** (decisão 16): nunca a data da carga. Por agenda, a data mais antiga entre a criação da
   agenda na origem, o início da vigência cadastrada e o primeiro horário da agenda; na falta, a do registro mais
   antigo da origem (a menor dessas datas no cliente). Datas antes de `PISO` (sentinelas) e no futuro são ignoradas.
3. **Texto da agenda** (`estruturar.executar`) com essas vigências.
4. **Valor de consulta do profissional por fonte** (o `VLR_CONSULTA` do código do médico no convênio) →
   `preco_consulta_origem`, íntegro, com a vigência da evidência das agendas do profissional (senão a mais antiga).
   Sincronizar: valor igual não muda; valor novo fecha a linha anterior (e a regra) ontem e abre outra hoje; valor
   que sumiu fecha a linha.
5. **Classificação da fonte particular** (ADR 0007, 18: melhor estimativa): vale a fonte de tipo `particular` do
   cadastro. Se nenhuma, a ÚNICA fonte ainda `outro` que tem valor de consulta por profissional e cujo nome ou classe
   diz PARTICULAR passa a `particular` (pendência baixa `fonte:particular_estimada`, o cliente confirma no cadastro).
6. **Carga condicional**: fonte particular → `regra_preco_particular` (dono o profissional, alvo consulta, origem
   migracao, situação estimada: o cliente confirma) e a linha fica `aplicada`; fonte de tipo conhecido e não
   particular → `descartada` (decisão 24: não existe preço por médico em convênio); fonte `outro` → fica pendente.
7. **Repasse integral** (marca da origem "consulta particular vai inteira ao médico") → `regra_repasse` +
   `regra_repasse_item` a 100% sobre o grupo de consulta do cliente (senão o item de consulta em consultório), com a
   fonte da marca. Sem grupo/item ou sem evento de repasse: pendência, nada gravado. Marca que sumiu fecha a regra.
Só contagens saem daqui (nunca valores nem nomes).
"""
import datetime as dt
import re

from . import estrutura_agenda as ea
from . import estruturar
from .texto import cp1252_para_texto

PISO = dt.date(1990, 1, 1)
IGNORAR = frozenset("DR DRA DRS DOUTOR DOUTORA PROF PROFA DE DA DO DAS DOS E".split())
CODIGO_CONSULTA = "10101012"   # consulta em consultório (terminologia pública de procedimentos)
OBS_PRECO = "Valor de consulta do profissional na fonte particular, da origem (ADR 0009)"
DESCR_REPASSE = "Consulta particular: repasse integral ao médico, sobre o valor cobrado (marca da origem)"
PREFIXO_REPASSE = "INTEGRAL-PART-"
REGRA_AMBIGUO = "agenda:profissional_ambiguo_pelo_nome"


# ---------------------------------------------------------------- funções puras

def palavras(s):
    return [w for w in re.findall(r"[A-Z0-9]+", ea.normalizar(s or "")) if len(w) > 1 and w not in IGNORAR]


def profissional_pelo_nome(nome_agenda, profissionais):
    """profissionais: {id: [nomes]}. Devolve ("ligada", id) | ("ambigua", n) | ("sem", 0)."""
    vocab = {}
    for pid, nomes in profissionais.items():
        vocab[pid] = set(w for n in nomes if n for w in palavras(n))
    todas = set().union(*vocab.values()) if vocab else set()
    alvo = [w for w in dict.fromkeys(palavras(nome_agenda)) if w in todas]
    if len(alvo) < 2:
        return ("sem", 0)
    cand = sorted(pid for pid, v in vocab.items() if all(w in v for w in alvo))
    if len(cand) == 1:
        return ("ligada", cand[0])
    return ("ambigua", len(cand)) if cand else ("sem", 0)


def _data(v, hoje):
    if isinstance(v, dt.datetime):
        v = v.date()
    if isinstance(v, dt.date) and PISO <= v <= hoje:
        return v
    return None


def data_evidencia(datas, hoje=None):
    """A mais antiga das datas válidas (sem sentinela nem futuro); None se nenhuma."""
    hoje = hoje or dt.date.today()
    ok = [d for d in (_data(x, hoje) for x in datas) if d]
    return min(ok) if ok else None


def classificar_particular(fontes, com_valor):
    """fontes: [{id, nome, tipo, classe}]; com_valor: ids com valor de consulta por profissional.
    Devolve (ids particulares do cadastro, id estimado ou None)."""
    cadastro = [f["id"] for f in fontes if f["tipo"] == "particular"]
    if cadastro:
        return cadastro, None
    diz = [f["id"] for f in fontes if f["tipo"] == "outro" and f["id"] in com_valor
           and ("PARTICULAR" in ea.chave(f["nome"] or "") or "PARTICULAR" in ea.chave(f.get("classe") or ""))]
    return [], (diz[0] if len(diz) == 1 else None)


# ---------------------------------------------------------------- origem (só leitura)

ERROS = []


def _tenta(lt, sql):
    try:
        return lt.consultar(sql)
    except Exception as e:  # noqa: BLE001 - tabela ou coluna ausente nesta versão da origem: só o tipo sai
        ERROS.append(type(e).__name__ + ": " + sql.split(" FROM ")[-1][:40])
        return None


def _o(col, n=250):
    """Texto da origem em bytes crus (charset NONE, bytes CP1252), como o leitor da carga."""
    return "CAST(%s AS VARCHAR(%d) CHARACTER SET OCTETS)" % (col, n)


def _b(col):
    return "CAST(%s AS BLOB SUB_TYPE BINARY)" % col


def ler_origem(lt):
    """Linhas da origem que esta etapa usa (dicionário de listas simples)."""
    o = {"agendas": [], "valores": [], "marca_integral": [], "faltou": []}
    for tab in ("REAGENDA", "SIAGENDA"):
        r = _tenta(lt, "SELECT ID, %s, DT_CRIACAO FROM %s" % (_o("NOME"), tab))
        if r is None:
            o["faltou"].append(tab)
        o["agendas"] += [(tab, str(i), _txt(n), d) for i, n, d in (r or [])]
    cbo = {i: c for i, c in (_tenta(lt, "SELECT ID, COD FROM TBCBOPRO") or [])}
    r = _tenta(lt, "SELECT CON, ID_TBCBOPRO, CRM, VLR_CONSULTA FROM FCCODCON WHERE VLR_CONSULTA > 0")
    if r is None:
        o["faltou"].append("FCCODCON")
    o["valores"] = [(str(con), str(cbo.get(idc, crm)), v) for con, idc, crm, v in (r or []) if con is not None]
    r = _tenta(lt, "SELECT COD FROM TBCONVEN WHERE VLR_CONSULTA_MEDICO = 'T'")
    if r is None:
        o["faltou"].append("TBCONVEN.VLR_CONSULTA_MEDICO")
    o["marca_integral"] = [str(c) for c, in (r or [])]
    return o


# ---------------------------------------------------------------- banco do cliente

def _q(c, sql, args=()):
    c.execute(sql, args)
    return c.fetchall()


def _tem(c, tabelas):
    n = _q(c, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (%s)"
           % ",".join(["%s"] * len(tabelas)), tabelas)[0][0]
    return n == len(tabelas)


def executar(conn, origem=None, ctl=None, execucao_id=None, hoje=None, commit=True):
    """Toda a etapa; devolve só contagens. `origem` vem de `ler_origem` (None: só o que o destino tem)."""
    hoje = hoje or dt.date.today()
    origem = origem or {"agendas": [], "valores": [], "marca_integral": [], "faltou": ["origem"]}
    cont = {"origem_ausente": sorted(origem.get("faltou", [])), "pendencias": {}}
    with conn.cursor() as c:
        if not _tem(c, ("agenda_servico", "profissional", "pessoa_fisica", "horario_agenda")):
            return {"pulado": "banco sem as tabelas da agenda"}
        ligacao = _ligar_por_nome(c, origem, ctl, execucao_id, cont)
        vig, padrao = _vigencias(c, origem, hoje)
    cont["ligacao_nome"] = ligacao
    cont["vigencia"] = {"agendas_com_evidencia": sum(1 for v in vig.values() if v),
                        "padrao_registro_mais_antigo": padrao is not None}
    with conn.cursor() as c:   # antes do texto: a fonte particular classificada vale também para o preço do texto
        if _tem(c, ("preco_consulta_origem", "regra_preco_particular", "fonte_pagadora", "inscricao_conselho")):
            cont["preco_profissional"] = _precos(c, origem, vig, padrao, hoje, cont)
    cont["texto"] = estruturar.executar(conn, commit=False, vigencias=vig, vigencia_padrao=padrao)
    with conn.cursor() as c:
        if _tem(c, ("regra_repasse", "regra_repasse_item", "evento_repasse", "grupo_faturamento", "item_faturavel")):
            cont["repasse_integral"] = _repasse(c, origem, padrao, hoje, cont)
    if commit:
        conn.commit()
    return cont


def _pend(c, ctl, eid, tabela, chave, regra, gravidade, cont):
    k = "%s:%s" % (regra, gravidade)
    cont["pendencias"][k] = cont["pendencias"].get(k, 0) + 1
    if ctl and eid:
        c.execute("INSERT INTO `%s`.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade, criado_em)"
                  " VALUES (%%s,%%s,%%s,%%s,%%s,CURRENT_TIMESTAMP(3))" % ctl, (eid, tabela, chave, regra, gravidade))


def _ligar_por_nome(c, origem, ctl, eid, cont):
    r = dict(sem_profissional=0, ligadas=0, ambiguas=0, sem_correspondencia=0)
    agendas = _q(c, "SELECT id, nome, codigo_origem FROM agenda_servico WHERE origem = 'migracao'"
                    " AND excluido_em IS NULL AND profissional_id IS NULL ORDER BY id")
    if not agendas:
        return r
    profs = {}
    for pid, civil, exib in _q(c, "SELECT p.id, f.nome, p.nome_exibicao FROM profissional p JOIN pessoa_fisica f"
                                  " ON f.id = p.pessoa_fisica_id WHERE p.excluido_em IS NULL"):
        profs[pid] = [civil, exib]
    tab_de = {(k, ea.chave(n)): t for t, k, n, _ in origem.get("agendas", [])}
    for aid, nome, cod in agendas:
        r["sem_profissional"] += 1
        res, v = profissional_pelo_nome(nome, profs)
        if res == "ligada":
            c.execute("UPDATE agenda_servico SET profissional_id = %s, alterado_em = CURRENT_TIMESTAMP(3),"
                      " versao = versao + 1 WHERE id = %s AND profissional_id IS NULL", (v, aid))
            r["ligadas"] += 1
        elif res == "ambigua":
            r["ambiguas"] += 1
            _pend(c, ctl, eid, tab_de.get((cod, ea.chave(nome)), "REAGENDA"), cod or str(aid), REGRA_AMBIGUO, "media",
                  cont)
        else:
            r["sem_correspondencia"] += 1
    return r


def _vigencias(c, origem, hoje):
    criacao = {(k, ea.chave(n)): d for _, k, n, d in origem.get("agendas", [])}
    primeiro = dict(_q(c, "SELECT agenda_servico_id, MIN(inicio_em) FROM horario_agenda GROUP BY agenda_servico_id"))
    vig = {}
    for aid, nome, cod, ini in _q(c, "SELECT id, nome, codigo_origem, vigencia_inicio FROM agenda_servico"
                                     " WHERE origem = 'migracao' AND excluido_em IS NULL"):
        vig[aid] = data_evidencia([criacao.get((cod, ea.chave(nome))), ini, primeiro.get(aid)], hoje)
    todas = [v for v in vig.values() if v] + [_data(d, hoje) for d in primeiro.values()]
    return vig, data_evidencia(todas, hoje)


def _precos(c, origem, vig, padrao, hoje, cont):
    r = dict(linhas_origem=len(origem.get("valores", [])), sem_fonte=0, sem_profissional=0, profissional_ambiguo=0,
             novas=0, iguais=0, valor_mudou=0, fechadas=0, aplicadas=0, descartadas=0, pendentes=0,
             fonte_particular_estimada=0, profissionais_com_regra=0)
    fontes = {cod: fid for fid, cod in _q(c, "SELECT id, codigo FROM fonte_pagadora WHERE excluido_em IS NULL")}
    insc = {}
    for num, pid in _q(c, "SELECT numero_inscricao, profissional_id FROM inscricao_conselho WHERE excluido_em IS NULL"):
        insc.setdefault(str(num), set()).add(pid)
    por_prof = {}
    for aid, pid in _q(c, "SELECT id, profissional_id FROM agenda_servico WHERE origem = 'migracao'"
                          " AND excluido_em IS NULL AND profissional_id IS NOT NULL"):
        por_prof.setdefault(pid, []).append(vig.get(aid))
    estab = {(f, p): e for f, p, e in _q(c, "SELECT fonte_pagadora_id, profissional_id, MIN(estabelecimento_id)"
                                            " FROM codigo_prestador_fonte_pagadora WHERE profissional_id IS NOT NULL"
                                            " GROUP BY fonte_pagadora_id, profissional_id")} if _tem(
        c, ("codigo_prestador_fonte_pagadora",)) else {}
    vistos = {}
    for con, crm, valor in origem.get("valores", []):
        fid = fontes.get(con)
        ps = insc.get(crm, set())
        if fid is None:
            r["sem_fonte"] += 1
            continue
        if len(ps) != 1:
            r["sem_profissional" if not ps else "profissional_ambiguo"] += 1
            continue
        vistos[(fid, next(iter(ps)))] = valor
    abertas = {(f, p, e): (i, v, rg) for i, f, p, e, v, rg in _q(
        c, "SELECT id, fonte_pagadora_id, profissional_id, estabelecimento_id, valor, regra_preco_particular_id"
           " FROM preco_consulta_origem WHERE vigencia_fim IS NULL AND origem = 'migracao'")}
    ontem = hoje - dt.timedelta(days=1)

    def fechar(i, rg):
        c.execute("UPDATE preco_consulta_origem SET vigencia_fim = GREATEST(vigencia_inicio, %s), alterado_em ="
                  " CURRENT_TIMESTAMP(3), versao = versao + 1 WHERE id = %s", (ontem, i))
        if rg:
            c.execute("UPDATE regra_preco_particular SET vigencia_fim = GREATEST(vigencia_inicio, %s), alterado_em ="
                      " CURRENT_TIMESTAMP(3), versao = versao + 1 WHERE id = %s AND vigencia_fim IS NULL", (ontem, rg))
        r["fechadas"] += 1
    for (fid, pid), valor in sorted(vistos.items()):
        e = estab.get((fid, pid))
        a = abertas.pop((fid, pid, e), None)
        if a and float(a[1]) == float(valor):
            r["iguais"] += 1
            continue
        if a:
            fechar(a[0], a[2])
            r["valor_mudou"] += 1
            ini = hoje
        else:
            ini = data_evidencia(por_prof.get(pid, []), hoje) or padrao or hoje
            r["novas"] += 1
        c.execute("INSERT INTO preco_consulta_origem (estabelecimento_id, fonte_pagadora_id, profissional_id, valor,"
                  " vigencia_inicio, origem, criado_em) VALUES (%s,%s,%s,%s,%s,'migracao',CURRENT_TIMESTAMP(3))"
                  " ON DUPLICATE KEY UPDATE valor = VALUES(valor), vigencia_fim = NULL, situacao = 'pendente',"
                  " regra_preco_particular_id = NULL, decidido_em = NULL, versao = versao + 1",
                  (e, fid, pid, valor, ini))
    for i, _, rg in abertas.values():
        fechar(i, rg)
    # classificação da fonte particular e carga condicional
    fl = [{"id": i, "nome": n, "tipo": t, "classe": cl} for i, n, t, cl in _q(
        c, "SELECT f.id, f.nome, f.tipo, k.descricao FROM fonte_pagadora f LEFT JOIN classe_fonte_pagadora k"
           " ON k.id = f.classe_fonte_pagadora_id WHERE f.excluido_em IS NULL")] if _tem(
        c, ("classe_fonte_pagadora",)) else [{"id": i, "nome": n, "tipo": t} for i, n, t in _q(
            c, "SELECT id, nome, tipo FROM fonte_pagadora WHERE excluido_em IS NULL")]
    com_valor = {f for f, in _q(c, "SELECT DISTINCT fonte_pagadora_id FROM preco_consulta_origem")}
    particulares, estimada = classificar_particular(fl, com_valor)
    if estimada:
        c.execute("UPDATE fonte_pagadora SET tipo = 'particular', alterado_em = CURRENT_TIMESTAMP(3), versao ="
                  " versao + 1 WHERE id = %s AND tipo = 'outro'", (estimada,))
        r["fonte_particular_estimada"] = 1
        particulares = [estimada]
        _pend(c, None, None, "TBCONVEN", None, "fonte:particular_estimada", "baixa", cont)
    tipo = {f["id"]: f["tipo"] for f in fl}
    situ = "estimada"   # melhor estimativa do conector: o cliente confirma na revisão
    for i, fid, pid, e, valor, ini, fim in _q(
            c, "SELECT id, fonte_pagadora_id, profissional_id, estabelecimento_id, valor, vigencia_inicio,"
               " vigencia_fim FROM preco_consulta_origem WHERE situacao = 'pendente' ORDER BY id"):
        if fid in particulares:
            c.execute("INSERT INTO regra_preco_particular (estabelecimento_id, fonte_pagadora_id, profissional_id,"
                      " alvo, valor, vigencia_inicio, vigencia_fim, situacao_revisao, observacao, origem, criado_em)"
                      " VALUES (%s,%s,%s,'consulta',%s,%s,%s,%s,%s,'migracao',CURRENT_TIMESTAMP(3))",
                      (e, fid, pid, valor, ini, fim, situ, OBS_PRECO))
            c.execute("UPDATE preco_consulta_origem SET situacao = 'aplicada', regra_preco_particular_id = %s,"
                      " motivo_situacao = %s, decidido_em = CURRENT_TIMESTAMP(3), versao = versao + 1 WHERE id = %s",
                      (c.lastrowid, "fonte particular", i))
            r["aplicadas"] += 1
        elif tipo.get(fid, "outro") != "outro":
            c.execute("UPDATE preco_consulta_origem SET situacao = 'descartada', motivo_situacao = %s, decidido_em ="
                      " CURRENT_TIMESTAMP(3), versao = versao + 1 WHERE id = %s",
                      ("fonte não particular: sem preço por médico em convênio (decisão 24)", i))
            r["descartadas"] += 1
        else:
            r["pendentes"] += 1
    r["profissionais_com_regra"] = _q(c, "SELECT COUNT(DISTINCT profissional_id) FROM regra_preco_particular WHERE"
                                         " origem = 'migracao' AND profissional_id IS NOT NULL AND excluido_em IS NULL"
                                         " AND vigencia_fim IS NULL")[0][0]
    return r


def _repasse(c, origem, padrao, hoje, cont):
    r = dict(marcas=len(origem.get("marca_integral", [])), criadas=0, existentes=0, fechadas=0, sem_alvo=0,
             sem_evento=0, sem_fonte=0)
    fontes = {cod: fid for fid, cod in _q(c, "SELECT id, codigo FROM fonte_pagadora WHERE excluido_em IS NULL")}
    marcadas = {}
    for cod in origem.get("marca_integral", []):
        if cod in fontes:
            marcadas[(PREFIXO_REPASSE + cod)[:30]] = fontes[cod]
        else:
            r["sem_fonte"] += 1
    existentes = {(e, cod): (i, fim) for i, e, cod, fim in _q(
        c, "SELECT id, estabelecimento_id, codigo, vigencia_fim FROM regra_repasse WHERE codigo LIKE %s",
        (PREFIXO_REPASSE + "%",))}
    ontem = hoje - dt.timedelta(days=1)
    for (e, cod), (i, fim) in existentes.items():
        if cod not in marcadas and fim is None:
            c.execute("UPDATE regra_repasse SET vigencia_fim = GREATEST(vigencia_inicio, %s), alterado_em ="
                      " CURRENT_TIMESTAMP(3), versao = versao + 1 WHERE id = %s", (ontem, i))
            r["fechadas"] += 1
    if not marcadas:
        return r
    grupos = [g for g, d in _q(c, "SELECT id, descricao FROM grupo_faturamento WHERE ativo")
              if ea.chave(d or "") in ("CONSULTA", "CONSULTAS")]
    itens = [i for i, in _q(c, "SELECT id FROM item_faturavel WHERE codigo = %s AND excluido_em IS NULL",
                            (CODIGO_CONSULTA,))]
    alvo = ("grupo", grupos[0]) if len(grupos) == 1 else ("item", itens[0]) if len(itens) == 1 else None
    if alvo is None:
        r["sem_alvo"] = len(marcadas)
        _pend(c, None, None, "TBCONVEN", None, "repasse:integral_sem_grupo_ou_item_consulta", "media", cont)
        return r
    eventos = {}
    for eid, e, nome in _q(c, "SELECT id, estabelecimento_id, nome FROM evento_repasse WHERE ativo AND natureza ="
                              " 'rendimento' AND vigencia_fim IS NULL ORDER BY id"):
        eventos.setdefault(e, []).append((eid, ea.chave(nome or "")))
    if not eventos:
        r["sem_evento"] = len(marcadas)
        _pend(c, None, None, "TBCONVEN", None, "repasse:integral_sem_evento_rendimento", "media", cont)
        return r
    ini = padrao or hoje
    for e, evs in sorted(eventos.items()):
        prefer = [x for x, k in evs if any(p in k for p in ("CONSULTA", "PRODUC", "HONORARIO"))]
        ev = prefer[0] if prefer else evs[0][0]
        for cod, fid in sorted(marcadas.items()):
            if (e, cod) in existentes:
                r["existentes"] += 1
                continue
            c.execute("INSERT INTO regra_repasse (estabelecimento_id, codigo, descricao, evento_repasse_id,"
                      " base_calculo, vigencia_inicio, observacao, criado_em) VALUES (%s,%s,%s,%s,'cobrado',%s,%s,"
                      "CURRENT_TIMESTAMP(3))", (e, cod, DESCR_REPASSE[:150], ev, ini,
                                                "ADR 0009: marca da origem; confira o evento e o alvo"))
            rid = c.lastrowid
            c.execute("INSERT INTO regra_repasse_item (regra_repasse_id, sequencia, fonte_pagadora_id, %s, percentual,"
                      " origem, criado_em) VALUES (%%s,1,%%s,%%s,100,'migracao',CURRENT_TIMESTAMP(3))"
                      % ("grupo_faturamento_id" if alvo[0] == "grupo" else "item_faturavel_id"), (rid, fid, alvo[1]))
            r["criadas"] += 1
    return r


# ---------------------------------------------------------------- medição na imagem (só contagens)

def _txt(v):
    if isinstance(v, (bytes, bytearray)):
        return cp1252_para_texto(bytes(v), aparar=True)
    return (v or "").strip()


def medir(lt, hoje=None):
    """Mede, direto na imagem e só por contagens, o que esta etapa e o extrator fariam (nada é gravado)."""
    hoje = hoje or dt.date.today()
    o = ler_origem(lt)
    classe = {c: n for c, n in (_tenta(lt, "SELECT COD, %s FROM TBCLASSC" % _o("NOME")) or [])}
    conv = [{"id": str(c), "nome": _txt(n), "tipo": "outro", "classe": _txt(classe.get(k))}
            for c, n, k in (_tenta(lt, "SELECT COD, %s, CLASSE FROM TBCONVEN" % _o("NOME")) or [])]
    com_valor = {con for con, _, _ in o["valores"]}
    _, part = classificar_particular(conv, com_valor)
    m = {"origem_ausente": o["faltou"], "erros": ERROS, "fontes": len(conv),
         "fontes_com_nome_particular": sum("PARTICULAR" in ea.chave(f["nome"]) for f in conv),
         "fonte_particular_estimada": part is not None}
    regras = [x for x in o["valores"] if x[0] == part]
    m["valor_consulta"] = {"linhas_com_valor": len(o["valores"]), "fontes_com_valor": len(com_valor),
                           "profissionais_com_valor": len({x[1] for x in o["valores"]}),
                           "regras_por_medico_na_particular": len(regras),
                           "medicos_com_regra": len({x[1] for x in regras}),
                           "valores_distintos_na_particular": len({float(x[2]) for x in regras}),
                           "linhas_em_outra_fonte_sem_regra": len(o["valores"]) - len(regras)}
    m["repasse_integral"] = {"fontes_com_marca": len(o["marca_integral"])}
    profs = {i: [_txt(n), _txt(a)] for i, n, a in (_tenta(lt, "SELECT ID, %s, %s FROM TBPROFIS" % (_o("NOME"), _o("APELIDO"))) or [])}
    lig = {"agendas": 0, "sem_profissional": 0, "ligadas": 0, "ambiguas": 0, "sem_correspondencia": 0,
           "com_data_criacao": 0}
    ext = dict(textos=0, agendas_com_valor=0, precos_consulta=0, precos_exame=0, trechos_interpretados=0,
               trechos_nao_interpretados=0, coberturas=0, restricoes=0, preparos=0, textos_sem_regra=0)
    fontes = [{"id": f["id"], "nome": f["nome"], "tipo": "particular" if f["id"] == part else "outro"} for f in conv]
    for tab, txt_col in (("REAGENDA", "OBS"), ("SIAGENDA", "OBSERVACAO")):
        linhas = _tenta(lt, "SELECT %s, CRM, DT_CRIACAO, %s, %s FROM %s"
                       % (_o("NOME"), _b(txt_col), _b("OBS_PORTAL_PAC_AGEND_ONLINE"), tab))
        for nome, crm, criada, obs, portal in linhas or []:
            lig["agendas"] += 1
            lig["com_data_criacao"] += data_evidencia([criada], hoje) is not None
            if not crm:
                lig["sem_profissional"] += 1
                res, _ = profissional_pelo_nome(_txt(nome), profs)
                lig[{"ligada": "ligadas", "ambigua": "ambiguas", "sem": "sem_correspondencia"}[res]] += 1
            com_valor_ag = False
            for campo, texto in (("observacao", _txt(obs)), ("orientacao_marcacao", _txt(portal))):
                if not texto.strip():
                    continue
                ex = ea.extrair(texto, campo, None, fontes, part)
                ext["textos"] += 1
                for p in ex.precos:
                    ext["precos_" + p["alvo"]] += 1
                com_valor_ag = com_valor_ag or bool(ea.valores(texto))
                ni = sum(1 for t in ex.trechos if not t["interpretado"])
                ext["trechos_nao_interpretados"] += ni
                ext["trechos_interpretados"] += len(ex.trechos) - ni
                ext["coberturas"] += len(ex.coberturas)
                ext["restricoes"] += len(ex.restricoes)
                ext["preparos"] += len(ex.preparos)
                ext["textos_sem_regra"] += not ex.interpretados()
            ext["agendas_com_valor"] += com_valor_ag
    m["ligacao_nome"], m["extrator"] = lig, ext
    return m
