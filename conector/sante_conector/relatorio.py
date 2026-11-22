"""Relatório de conciliação de cada execução do conector (F4 L10; ADR 0007, item 22): CURTO, por entidade de destino,
gravado em toda execução (Importar e Sincronizar, também na que falha) em `contadores.relatorio` da plataforma, que o
painel mostra e exporta. Só contagens, entidades de DESTINO e regras: nunca valores de linha nem nome da origem
(regra 1); a base de controle do cliente guarda a tabela e a chave original de cada pendência para o diagnóstico.

O que traz:
- pendências ABERTAS (as desta execução) e RESOLVIDAS (abertas numa execução anterior do cliente que esta não repetiu:
  a origem foi corrigida ou o destino decidido), por entidade, regra e gravidade, com a classe da decisão
  (`cliente`, `plataforma`, `informativa`) e a ação sugerida; o resumo "o que precisa de decisão do cliente";
- o que não carregou: linhas recusadas por entidade, tabelas fora do mapa, tabelas com linhas sem carga declarada
  (BLOQUEADAS) e tabelas não copiadas por decisão de produto (`declarado/sem_carga.tsv`), por causa;
- a PROVA de não copiar de cada tabela (ADR 0006, item 1), identificada pelo destino onde a informação continua;
- saídas externas: o motor não tem cliente de rede externa (zero por construção) e a execução confere que o
  container não tem rota para fora (`rede_sem_rota_externa`).
"""
import re

VERSAO = 1
GRAVIDADES = ("critica", "alta", "media", "baixa")

# ---------------- classe da decisão de cada regra (a quem cabe resolver) ----------------
# plataforma: a equipe da plataforma corrige o mapa, o catálogo, o espelho ou a infraestrutura (nunca o hospital)
PLATAFORMA = {
    "tabela_sem_mapa": "mapear a tabela no conector (a origem deste cliente tem linhas que a referência não tinha)",
    "prova_nao_conferida": "rever a prova de não copiar: a informação não bateu linha a linha no destino",
    "filho_pai_divergente": "rever a referência do mapa: filho ligado a pai diferente do da origem",
    "recusa_sem_regra_registrada": "rever a recusa no mapa do conector",
    "sequencia_sem_tabela": "declarar a sequência do produto que continua a numeração da origem",
    "espelho_codigo_inexistente": "atualizar a edição do espelho padrão do catálogo licenciado",
    "segredo_aguarda_cofre": "configurar a chave mestra do cofre de segredos e Sincronizar",
    "armazenamento_indefinido": "configurar a porta de armazenamento de arquivos do cliente",
    "arquivo_divergente_no_armazenamento": "conferir o arquivo no armazenamento do cliente",
    "sem_prova_de_nao_copiar": "declarar a prova de não copiar ou passar a carregar a tabela",
    "tabela_bloqueada": "declarar a carga da tabela no mapa do conector",
}
PLATAFORMA_PREFIXOS = ("catalogo_oficial_ausente",)
# cliente: o hospital decide (corrige na origem e Sincroniza, confirma, completa ou aceita no destino)
CLIENTE = {
    "exclusao_em_massa_aguarda_confirmacao": "confirmar a exclusão em massa no Sincronizar ou corrigir a origem",
    "conflito_origem_venceu": "rever a edição do destino guardada (a origem venceu) e decidir se a reaplica",
    "edicao_no_destino": "rever a edição feita no destino (mantida) e decidir se fica",
    "mescla_conflito_origem_guardada": "rever o valor da origem guardado no histórico da mescla",
    "apagada_aguarda_sincronizar": "Sincronizar para inativar o que sumiu da origem, ou manter",
    "alteracao_aguarda_sincronizar": "Sincronizar para aplicar a alteração da origem",
    "grupo_divergente_aguarda_sincronizar": "Sincronizar para recalcular o cabeçalho do grupo",
    "exclusao_sem_suporte_no_destino": "inativar no destino, se for o caso (o registro sumiu da origem)",
    "alteracao_recusada_aguarda_correcao": "corrigir o registro na origem e Sincronizar",
    "rascunho_sem_autor": "atribuir o autor do rascunho clínico, que o finaliza ou apaga",
    "cadastro_provisorio_a_completar": "completar o cadastro provisório",
    "vigencia_sem_evidencia": "informar o início da vigência",
}
# informativa: registrada para a trilha; não pede decisão (gravidade baixa, salvo as do cliente acima)
INFORMATIVA = {"pai_pendente": "resolve-se com a pendência do registro pai (raiz da cadeia)"}
ACAO_PADRAO = "corrigir o registro na origem e Sincronizar, ou corrigir no destino"


def classe(regra, gravidade):
    """(classe, ação) da regra: `plataforma`, `cliente` ou `informativa`."""
    if regra in PLATAFORMA:
        return "plataforma", PLATAFORMA[regra]
    if regra.startswith(PLATAFORMA_PREFIXOS):
        return "plataforma", "carregar o catálogo oficial da edição usada pelo cliente"
    if regra in CLIENTE:
        return "cliente", CLIENTE[regra]
    if regra in INFORMATIVA:
        return "informativa", INFORMATIVA[regra]
    if gravidade == "baixa":
        return "informativa", "registro da carga, sem decisão"
    return "cliente", ACAO_PADRAO


# ---------------- prova de não copiar: identificada pelo destino ----------------
_TABELA_SQL = re.compile(r"\b(?:FROM|JOIN)\s+`?([a-z][a-z0-9_]*)(?![a-z0-9_])`?(?!\s*\.)", re.I)


def destino_da_prova(sql):
    """Tabelas do DESTINO que a prova lê (as da base de controle, `{ctl}.`, não contam), na ordem: o rótulo neutro
    da prova no painel (onde a informação continua)."""
    vistos = []
    for m in _TABELA_SQL.finditer(sql or ""):
        t = m.group(1).lower()
        if t not in vistos and t not in ("select", "lateral"):
            vistos.append(t)
    return "+".join(vistos[:3]) or "destino"


def rotulos_das_provas(provas_decl):
    """{tabela da origem: rótulo neutro único} das provas declaradas."""
    saida, usados = {}, set()
    for pv in provas_decl or []:
        base = rot = destino_da_prova(pv.get("sql"))
        i = 2
        while rot in usados:
            rot, i = "%s#%d" % (base, i), i + 1
        usados.add(rot)
        saida[pv["tabela"]] = rot
    return saida


# Causas de descarte sem prova linha a linha: o licenciado vive no espelho padrão da base e o catálogo oficial é
# ligado pelo código (ADR 0006, itens 3 e 4); a conferência delas é a ligação, não a cópia.
SEM_PROVA_LINHA = frozenset(("licenciado", "catalogo_oficial"))


# ---------------- pendências resolvidas ----------------
def garantir_ctl(cr, ctl):
    """Coluna e índices da resolução (base de controle de clientes anteriores ao L10). O motor não chama isto a cada
    execução: o `controle.preparar` já garante o mesmo no começo (DDL da base de controle); fica para testes."""
    with cr.cursor() as c:
        c.execute("ALTER TABLE `%s`.pendencia ADD COLUMN IF NOT EXISTS resolvida_execucao_id BIGINT UNSIGNED NULL"
                  " COMMENT 'Execução que não repetiu a pendência (origem corrigida ou destino decidido)'" % ctl)
        c.execute("ALTER TABLE `%s`.pendencia ADD INDEX IF NOT EXISTS ix_pendencia_regra"
                  " (tabela_origem, regra, chave_original(190))" % ctl)
        c.execute("ALTER TABLE `%s`.pendencia ADD INDEX IF NOT EXISTS ix_pendencia_resolvida"
                  " (resolvida_execucao_id)" % ctl)


def resolver(cr, ctl, eid):
    """Marca `resolvida` toda pendência aberta de execução ANTERIOR do cliente que esta execução não repetiu (mesma
    tabela, chave e regra). Devolve o número de linhas marcadas."""
    with cr.cursor() as c:
        c.execute("UPDATE `{b}`.pendencia p SET p.situacao='resolvida', p.resolvida_execucao_id=%s,"
                  " p.alterado_em=UTC_TIMESTAMP(3), p.versao=p.versao+1"
                  " WHERE p.execucao_id < %s AND p.situacao='aberta' AND NOT EXISTS (SELECT 1 FROM `{b}`.pendencia n"
                  " WHERE n.execucao_id=%s AND n.tabela_origem=p.tabela_origem AND n.regra=p.regra"
                  " AND n.chave_original <=> p.chave_original)".format(b=ctl), (eid, eid, eid))
        return c.rowcount


def _contar(cr, ctl, eid):
    with cr.cursor() as c:
        c.execute("SELECT tabela_origem, regra, gravidade, COUNT(*) FROM `%s`.pendencia WHERE execucao_id=%%s"
                  " GROUP BY tabela_origem, regra, gravidade" % ctl, (eid,))
        abertas = c.fetchall()
        c.execute("SELECT tabela_origem, regra, gravidade,"
                  " COUNT(DISTINCT tabela_origem, regra, COALESCE(chave_original, ''))"
                  " FROM `%s`.pendencia WHERE resolvida_execucao_id=%%s GROUP BY tabela_origem, regra, gravidade"
                  % ctl, (eid,))
        resolvidas = c.fetchall()
    return abertas, resolvidas


def rede_sem_rota_externa(arquivo="/proc/net/route"):
    """True quando o processo não tem rota padrão (rede interna do Docker, `--internal`, ou `--network none`)."""
    try:
        with open(arquivo) as f:
            linhas = f.read().splitlines()[1:]
    except OSError:
        return None
    return not any(len(x.split()) > 2 and x.split()[1] == "00000000" for x in linhas)


# ---------------- montagem ----------------
def montar(abertas, resolvidas, entidades, contagens=None, plano=(), carga_propria=(), mapa_exec=None,
           provas=None, sem_mapa=None, rede=None):
    """Relatório curto (dict JSON) a partir das contagens. `abertas`/`resolvidas`: [(tabela, regra, gravidade, n)];
    `entidades`: {entidade: {tabela_origem, registros_origem, registros_destino, recusados, conferido}} na ordem da
    conciliação (o primeiro de cada tabela é o principal); `contagens`: {tabela: linhas} da origem; `plano`: tabelas
    carregadas pelo mapa; `carga_propria`: as da carga própria do L3; `provas`: {tabela: resultado de
    continuidade.comparar + tipo}."""
    mapa_exec = mapa_exec or {}
    contagens = contagens or {}
    provas = provas or {}
    principal = {}
    for ent, e in (entidades or {}).items():
        principal.setdefault(e.get("tabela_origem"), ent)
    rot_prova = rotulos_das_provas(mapa_exec.get("provas"))
    sem_carga = {x["tabela"]: x.get("causa") or "sem_causa" for x in mapa_exec.get("sem_carga") or []
                 if x.get("situacao", "descarte") == "descarte"}

    def entidade_de(tab, regra):
        if tab in principal:
            return principal[tab]
        if regra == "tabela_sem_mapa":
            return "imagem"
        if tab in rot_prova:
            return "prova:" + rot_prova[tab]
        return "outra"

    grupos = {}
    for lista, campo in ((abertas, "abertas"), (resolvidas, "resolvidas")):
        for tab, regra, grav, n in lista:
            grav = grav if grav in GRAVIDADES else "alta"
            k = (entidade_de(tab, regra), regra, grav)
            g = grupos.setdefault(k, {"entidade": k[0], "regra": regra, "gravidade": grav, "abertas": 0,
                                      "resolvidas": 0})
            g[campo] += int(n)

    # o que não carregou: tabelas da origem com linhas, por destino da linha
    carregadas = set(plano) | set(carga_propria)
    com_linhas = {t: int(n) for t, n in contagens.items() if int(n or 0) > 0}
    no_mapa = {x["tabela"] for x in mapa_exec.get("tabelas") or []}
    por_causa, bloqueadas = {}, {"tabelas": 0, "registros": 0}
    sem_prova = {"tabelas": 0, "registros": 0}
    for t, n in sorted(com_linhas.items()):
        if t in carregadas:
            continue
        if t in sem_carga:
            pc = por_causa.setdefault(sem_carga[t], {"causa": sem_carga[t], "tabelas": 0, "registros": 0,
                                                     "provasConferidas": 0, "provasFalhas": 0, "semProva": 0})
            pc["tabelas"] += 1
            pc["registros"] += n
            if sem_carga[t] in SEM_PROVA_LINHA:  # espelho padrão ou catálogo oficial: ligação pelo código
                continue
            if t not in provas:
                pc["semProva"] += 1
                sem_prova["tabelas"] += 1
                sem_prova["registros"] += n
            elif provas[t].get("conferido"):
                pc["provasConferidas"] += 1
            else:
                pc["provasFalhas"] += 1
        elif t in no_mapa and t not in provas:
            bloqueadas["tabelas"] += 1
            bloqueadas["registros"] += n
    for nome, q in (("sem_prova_de_nao_copiar", sem_prova), ("tabela_bloqueada", bloqueadas)):
        if q["tabelas"]:
            grupos[("imagem", nome, "alta")] = {"entidade": "imagem", "regra": nome, "gravidade": "alta",
                                               "abertas": q["tabelas"], "resolvidas": 0, "unidade": "tabela"}

    por_regra = []
    for g in grupos.values():
        g.setdefault("unidade", "linha")
        g["decisao"], g["acao"] = classe(g["regra"], g["gravidade"])
        por_regra.append(g)
    por_regra.sort(key=lambda g: (GRAVIDADES.index(g["gravidade"]), -g["abertas"], g["entidade"], g["regra"]))

    decisoes = {}
    for g in por_regra:
        if g["decisao"] != "cliente" or not g["abertas"]:
            continue
        d = decisoes.setdefault(g["regra"], {"regra": g["regra"], "gravidade": g["gravidade"], "quantidade": 0,
                                             "entidades": 0, "acao": g["acao"]})
        d["quantidade"] += g["abertas"]
        d["entidades"] += 1
        if GRAVIDADES.index(g["gravidade"]) < GRAVIDADES.index(d["gravidade"]):
            d["gravidade"] = g["gravidade"]

    lista_provas = []
    for t, r in provas.items():
        lista_provas.append({"destino": rot_prova.get(t, "destino"), "causa": sem_carga.get(t, "derivado"),
                             "tipo": r.get("tipo", "derivado"), "linhasOrigem": int(r.get("linhas_origem", 0)),
                             "iguais": int(r.get("iguais", 0)), "divergentes": int(r.get("divergentes", 0)),
                             "faltandoNoDestino": int(r.get("faltando_no_destino", 0)),
                             "sobrandoNoDestino": int(r.get("sobrando_no_destino", 0)),
                             "conferido": bool(r.get("conferido"))})
    lista_provas.sort(key=lambda p: (p["conferido"], p["destino"]))

    ents = entidades or {}
    recusados = sorted(({"entidade": k, "recusados": int(v.get("recusados") or 0)} for k, v in ents.items()
                        if int(v.get("recusados") or 0) > 0), key=lambda x: (-x["recusados"], x["entidade"]))
    sm = sem_mapa or {"tabelas": 0, "registros": 0}
    return {
        "versao": VERSAO,
        "totais": {
            "entidades": len(ents),
            "conferidas": sum(1 for v in ents.values() if v.get("conferido")),
            "registrosOrigem": sum(int(v.get("registros_origem") or 0) for v in ents.values()),
            "registrosDestino": sum(int(v.get("registros_destino") or 0) for v in ents.values()),
            "recusados": sum(x["recusados"] for x in recusados),
            # pendências por LINHA; os itens contados por tabela (sem prova, bloqueada) ficam à parte
            "abertas": sum(g["abertas"] for g in por_regra if g["unidade"] == "linha"),
            "tabelasAbertas": sum(g["abertas"] for g in por_regra if g["unidade"] == "tabela"),
            "criticas": sum(g["abertas"] for g in por_regra if g["gravidade"] == "critica" and g["unidade"] == "linha"),
            "resolvidas": sum(g["resolvidas"] for g in por_regra),
            "decisoesCliente": sum(d["quantidade"] for d in decisoes.values()),
        },
        "porRegra": por_regra,
        "decisoesCliente": sorted(decisoes.values(),
                                  key=lambda d: (GRAVIDADES.index(d["gravidade"]), -d["quantidade"], d["regra"])),
        "naoCarregado": {
            "recusados": recusados,
            "semMapa": {"tabelas": int(sm.get("tabelas", 0)), "registros": int(sm.get("registros", 0))},
            "bloqueadas": bloqueadas,
            "semCarga": sorted(por_causa.values(), key=lambda x: x["causa"]),
        },
        "provas": lista_provas,
        "saidasExternas": 0,
        "redeSemRotaExterna": rede,
    }


def gerar(cr, ctl, eid, entidades, resolver_pendencias=True, **kw):
    """Resolve as pendências que esta execução não repetiu (só na execução que conclui: `resolver_pendencias`),
    conta e monta o relatório (commit incluído). A execução que falha só lê: nunca mexe nas anteriores."""
    if resolver_pendencias:
        resolver(cr, ctl, eid)
        cr.commit()
    abertas, resolvidas = _contar(cr, ctl, eid)
    return montar(abertas, resolvidas, entidades, rede=rede_sem_rota_externa(), **kw)
