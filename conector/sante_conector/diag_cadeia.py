"""Diagnóstico da cadeia principal num RECORTE da cópia real, na ordem da execução real (só contagens, nunca valores).

`conector.sh medir-carga <relativo> --cliente <codigo> --recorte /recorte/recorte-nucleo.tsv --tabelas -`

Ordem igual à do motor (motor.py): carga própria L3 (carga.Carga), depois a carga dirigida pelo mapa (CargaMapa, com
as entidades do L3), depois o preço particular e o repasse da agenda (preco_origem). O recorte (tools/obra/
recorte-nucleo.tsv) diz, por tabela, o limite de linhas, a amostra por módulo da chave e o filtro pai -> filho
(COL>PAI.COLPAI): o filho só entra se apontar para uma linha do pai que entrou. Tabelas puxadas pelo fecho de
dependências do mapa e fora do recorte: inteiras até 300 mil linhas, senão as 20 mil primeiras.
Saída: por tabela, linhas no recorte e `conector_origem` por regra; pendências por tabela e regra; conciliação por
entidade; contagens no destino; contagens do preco_origem; e agregados de diagnóstico (tipos e domínio dos códigos
do atendimento), nunca valores de pessoa.
Limite conhecido: com CONECTOR_GRAVADORES > 1 a carga do mapa lê as tabelas nos gravadores (fork, paralelo.py); o
filtro pai -> filho entre duas tabelas do MAPA não vê os valores guardados no gravador (o filho sai vazio) e
`recorte_linhas` traz só as do L3. Filtro com pai no L3 (lido no coordenador) vale sempre. Para filtrar filho de pai
do mapa, rode com CONECTOR_GRAVADORES=1.
"""
import os
import re
import time
import traceback

from . import banco, carga, carga_mapa, controle, mapa, preco_origem
from .medir_carga import EID_MEDICAO, fecho

TETO_PAI, LIMITE_PAI = 300000, 20000
DESTINO = ("estabelecimento", "empresa", "usuario", "pessoa_fisica", "profissional", "profissional_especialidade",
           "lotacao_profissional", "fonte_pagadora", "plano_fonte_pagadora", "paciente", "atendimento",
           "agenda_servico", "horario_agenda", "marcacao_horario", "conta_hospitalar", "conta_hospitalar_item",
           "preco_procedimento", "regra_repasse", "lancamento_repasse", "carater_atendimento_tiss",
           "categoria_atendimento")


def sem_valor(e):
    """Só o tipo, a mensagem sem os trechos entre aspas (a mensagem do banco pode citar valores) e onde falhou
    (arquivo:linha função dos últimos quadros, sem valores de variáveis)."""
    onde = ["%s:%d %s" % (os.path.basename(q.filename), q.lineno, q.name)
            for q in traceback.extract_tb(e.__traceback__)[-6:]]
    return {"falhou": type(e).__name__, "msg": re.sub(r"'[^']*'", "'?'", str(e))[:300], "onde": onde}


def ler_recorte(caminho):
    regras = {}
    for ln in open(caminho, encoding="utf-8"):
        if not ln.strip() or ln.startswith("#"):
            continue
        c = (ln.rstrip("\n").split("\t") + [""] * 5)[:5]
        filtro = None
        if c[3]:
            col, pai = c[3].split(">")
            tpai, cpai = pai.split(".")
            filtro = (col, tpai, cpai)
        regras[c[0]] = {"limite": int(c[1] or 0), "modulo": int(c[2] or 0), "filtro": filtro}
    return regras


def norm(v):
    if isinstance(v, (bytes, bytearray)):
        v = bytes(v).decode("latin-1")
    return v.strip() if isinstance(v, str) else v


class Filtro:
    """Estado comum do recorte: valores guardados dos pais e linhas que entraram por tabela."""

    def __init__(self, regras, chaves):
        self.regras, self.chaves = regras, chaves
        self.guardar = {}  # tabela pai -> colunas cujos valores os filhos pedem
        for r in regras.values():
            if r["filtro"]:
                self.guardar.setdefault(r["filtro"][1], set()).add(r["filtro"][2])
        self.valores = {}  # (tabela, coluna) -> set
        self.entrou = {}
        self.sem_coluna = set()

    def aplicar(self, tab, it, linha_de=lambda x: x):
        r = self.regras.get(tab, {"limite": 0, "modulo": 0, "filtro": None})
        guardar = self.guardar.get(tab, ())
        ch = self.chaves.get(tab)
        n = 0
        for x in it:
            linha = linha_de(x)
            if r["modulo"] and ch and isinstance(linha.get(ch), int) and linha[ch] % r["modulo"]:
                continue
            if r["filtro"]:
                col, tp, cp = r["filtro"]
                if col not in linha:
                    self.sem_coluna.add("%s.%s" % (tab, col))
                elif norm(linha[col]) not in self.valores.get((tp, cp), ()):
                    continue
            for cg in guardar:
                if cg in linha:
                    self.valores.setdefault((tab, cg), set()).add(norm(linha[cg]))
                else:
                    self.sem_coluna.add("%s.%s" % (tab, cg))
            n += 1
            self.entrou[tab] = n
            yield x
            if r["limite"] and n >= r["limite"]:
                break
        self.entrou.setdefault(tab, 0)


class Contagens(dict):
    """`contagens` que a conciliação lê depois da leitura: as linhas que entraram no recorte."""

    def __init__(self, filtro, nomes):
        super().__init__({t: 0 for t in nomes})
        self.f = filtro

    def get(self, k, d=None):
        return self.f.entrou.get(k, d if d is not None else 0)

    def __getitem__(self, k):
        return self.get(k)


def _consultas(cc, ctl):
    out = {}
    with cc.cursor() as c:
        c.execute("SELECT tabela_origem, COALESCE(regra_recusa,'-'), COUNT(*), COUNT(id_destino) FROM `%s`.conector_origem"
                  " GROUP BY 1,2 ORDER BY 1,2" % ctl)
        out["conector_origem"] = ["%s|%s|%d|%d" % (t, r, n, d) for t, r, n, d in c.fetchall()]
        c.execute("SELECT tabela_origem, regra, gravidade, COUNT(*) FROM `%s`.pendencia GROUP BY 1,2,3 ORDER BY 1,2"
                  % ctl)
        out["pendencias"] = ["%s|%s|%s|%d" % tuple(x) for x in c.fetchall()]
        dest = {}
        for t in DESTINO:
            try:
                c.execute("SELECT COUNT(*) FROM `%s`" % t)
                dest[t] = int(c.fetchone()[0])
            except Exception as e:  # noqa: BLE001 - tabela ausente no modelo: só o tipo do erro
                dest[t] = type(e).__name__
        out["destino"] = dest
        c.execute("SELECT codigo_tiss FROM carater_atendimento_tiss ORDER BY 1")
        out["carater_tiss_codigos"] = [r[0] for r in c.fetchall()]
        c.execute("SELECT TABLE_NAME, COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"
                  " AND (TABLE_NAME LIKE 'preco%%' OR TABLE_NAME LIKE '%%repasse%%') GROUP BY 1")
        nomes = [r[0] for r in c.fetchall()]
        for t in nomes:
            c.execute("SELECT COUNT(*) FROM `%s`" % t)
            out["destino"][t] = int(c.fetchone()[0])
    return out


def executar(lt, origem, codigo, caminho_recorte):
    regras = ler_recorte(caminho_recorte)
    mapa_exec = mapa.carregar_execucao()
    presentes = set(lt.tabelas())
    pedidas = set(regras) & presentes
    alvo = (fecho(mapa_exec, pedidas) | pedidas) & presentes
    plano_todo = carga_mapa.planejar(mapa_exec, presentes)
    plano_nomes = [p["tabela"] for p in plano_todo if p["tabela"] in alvo]
    l3 = [t for t in carga.ORDEM if t in alvo]
    nomes = l3 + plano_nomes
    chaves = {t: carga.MAPA[t]["chave"] for t in l3}
    chaves.update({p["tabela"]: p["chave"][0] for p in plano_todo if len(p["chave"]) == 1})
    regs = {r["tabela"]: int(r["registros"] or 0) for r in mapa_exec["tabelas"] if (r.get("registros") or "").isdigit()}
    fora = {}
    for t in nomes:
        if t not in regras:
            lim = 0 if regs.get(t, 0) <= TETO_PAI else LIMITE_PAI
            regras[t] = {"limite": lim, "modulo": 0, "filtro": None}
            fora[t] = lim
    f = Filtro(regras, chaves)
    dominio = {}

    class L3(carga.Carga):
        def _linhas(self, tab):
            it = f.aplicar(tab, super()._linhas(tab))
            if tab != "ATCABECATEND":
                return it

            def contar(it):
                for l in it:
                    for col in ("CARATER_ATEND", "TP_ATENDIMENTO"):
                        v = l.get(col)
                        k = "%s|%s|%s" % (col, type(v).__name__, norm(v) if v is None or len(str(norm(v))) <= 3 else "longo")
                        dominio[k] = dominio.get(k, 0) + 1
                    yield l
            return contar(it)

    class Mapa(carga_mapa.CargaMapa):
        def _linhas_mapa(self, p):
            return f.aplicar(p["tabela"], super()._linhas_mapa(p), linha_de=lambda x: x[0])

    root = banco.conectar()
    try:
        ctl = controle.preparar(root, codigo, "cliente_" + codigo)
    finally:
        root.close()
    cc = banco.conectar("cliente_" + codigo, autocommit=False)
    saida = {"tabelas_pedidas": len(pedidas), "pedidas_ausentes_na_origem": sorted(set(regras) - presentes - set(fora)),
             "fora_do_recorte_puxadas_pelo_fecho": fora, "l3": l3, "plano": plano_nomes, "etapas": {}}
    try:
        eid = EID_MEDICAO + int(time.time()) % 1000000
        with cc.cursor() as c:
            c.execute("INSERT INTO `%s`.imagem (execucao_id, arquivo, tamanho_bytes, sha256, corte_em, ods_versao,"
                      " pagina_bytes, tabelas, registros_total, generators, somente_leitura, criado_em)"
                      " VALUES (%%s,%%s,%%s,NULL,UTC_TIMESTAMP(),0,0,%%s,0,0,1,UTC_TIMESTAMP(3))" % ctl,
                      (eid, origem["relativo"], origem["tamanho"], len(nomes)))
            iid = c.lastrowid
        cc.commit()
        cont = Contagens(f, nomes)
        t0 = time.monotonic()
        try:
            res = L3(lt, cc, ctl, eid, iid).executar(set(l3), cont) or {"entidades": {}, "carga": {}}
            saida["etapas"]["l3"] = {"segundos": round(time.monotonic() - t0, 1), "entidades": res.get("entidades"),
                                     "carga": res.get("carga")}
        except Exception as e:  # noqa: BLE001
            cc.rollback()
            saida["etapas"]["l3"] = sem_valor(e)
            res = {"entidades": {}}
        if os.environ.get("DIAG_SO_L3"):  # depuração: só a carga própria (minutos em vez de ~50)
            saida.update(_consultas(cc, ctl))
            return saida
        t0 = time.monotonic()
        try:
            rm = Mapa(lt, cc, ctl, eid, iid, mapa_exec, entidades_usadas=set(res.get("entidades") or {})).executar(
                set(nomes), cont)
            saida["etapas"]["mapa"] = {"segundos": round(time.monotonic() - t0, 1),
                                       "entidades": {k: {x: v.get(x) for x in ("registros_origem", "registros_destino",
                                                                               "recusados", "conferido")}
                                                     for k, v in (rm.get("entidades") or {}).items()},
                                       "carga": {k: v for k, v in (rm.get("carga") or {}).items()
                                                 if isinstance(v, (int, float, str))}}
        except Exception as e:  # noqa: BLE001
            cc.rollback()
            saida["etapas"]["mapa"] = sem_valor(e)
        t0 = time.monotonic()
        try:
            saida["etapas"]["preco_origem"] = preco_origem.executar(cc, preco_origem.ler_origem(lt), ctl=ctl,
                                                                    execucao_id=eid)
        except Exception as e:  # noqa: BLE001
            cc.rollback()
            saida["etapas"]["preco_origem"] = sem_valor(e)
        saida["recorte_linhas"] = dict(sorted(f.entrou.items()))
        saida["filtro_sem_coluna"] = sorted(f.sem_coluna)
        saida["dominio_atendimento"] = dict(sorted(dominio.items()))
        saida.update(_consultas(cc, ctl))
    finally:
        cc.close()
    return saida

