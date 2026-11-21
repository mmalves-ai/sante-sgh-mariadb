"""Carga dirigida pelo mapa (F4 L5 a L8): qualquer tabela carregável do mapa, sem código por tabela.

Entrada: o mapa da execução (`mapa.carregar_execucao`): `tabelas.tsv` (destinos, chave, ordem), `colunas.tsv` (regra,
referência e de-para gerados por nome e tipo), `declarado/colunas.tsv` + `declarado/colunas.d/*.tsv` (as colunas
APROVEITADAS, com o destino `tabela.coluna`; regra e de-para declarados valem por cima dos gerados) e
`dependencias.tsv` (arestas em duas fases). Só entra a tabela que tem ao menos uma coluna declarada com destino; as do
L3 (`carga.ORDEM`) seguem na carga própria (`carga.py`).

Mesmas garantias do L3 (herda `carga.Carga`):
- toda linha lida fica em `conector_origem` (hash dos bytes crus das colunas lidas); recusa com regra e gravidade,
  pendência no mesmo commit; SAVEPOINT por linha (restrição do destino recusa só a linha: `restricao_destino_<código>`);
- linha igual é pulada; alterada na origem fica com `alteracao_aguarda_sincronizar` (hash guardado intocado); apagada
  na origem, `apagada_aguarda_sincronizar`; diferente no destino com rastro de edição, `edicao_no_destino`;
- regra de coluna (`sentinela.aplicar`): a pendência da regra vai para a linha (data_sentinela, hora_sem_data,
  valor_fora_do_dominio...), o valor vira NULL; de-para oficial (`depara.Depara`): código ausente ou inválido vira
  pendência `catalogo_codigo_*` (catálogo oficial nunca é criado nem gravado);
- referência (`chave_origem` com `referencia`): id de destino do pai pelo `conector_origem`. Pai recusado ou pendente:
  a linha é recusada com `pai_pendente` (gravidade e raiz da cadeia pelo `pendencia.Propagador`); pai nunca visto:
  NULL com pendência `pai_inexistente` (coluna NOT NULL no destino recusa a linha pela restrição). Autorreferência e
  aresta declarada em duas fases (`declarado/ciclos.tsv`): a linha entra com NULL e a referência é gravada no fim
  (fase 2), por UPDATE;
- vários destinos por tabela: o primeiro destino declarado (na ordem de `tabelas_destino`) é o principal; cada um
  dos outros é uma entidade com chave `<chave>/<tabela destino>` em `conector_origem`; `@id` liga ao principal;
- coluna `origem` do destino, se existir e não for declarada, recebe 'migracao'; `criado_em` vem do relógio do banco;
  valor nulo em coluna NOT NULL com padrão no destino fica com o padrão (contado em `padrao_do_destino`; o resumo usa
  o valor relido do banco);
- conciliação por entidade (tabela de destino): contagem lida = gravada (relida do banco) + recusada e soma de
  controle do resumo dos campos gravados (texto em bytes CP1252, decimal normalizado, data e hora na precisão do
  destino), calculada da origem convertida e relida do destino. A coluna em duas fases fica fora do resumo.
- mede linhas por segundo por tabela (`carga.por_tabela`). Só contagens e regras saem daqui, nunca valores.

O hash da linha cobre as colunas lidas (chave + declaradas): declarar uma coluna nova numa tabela já carregada faz as
linhas aparecerem como alteradas (ficam para o Sincronizar), nunca regravadas em silêncio.
"""
import datetime
import decimal
import hashlib
import time

from . import carga, depara, sentinela
from .carga import AGORA, ErroCarga, chave_txt, soma
from .leitor import hash_linha
from .pendencia import Propagador
from .texto import texto_para_cp1252

VERSAO = "mapa-2026-11-21"
LOTE_COMMIT = 2000
GRAVIDADE_REGRA = {"data_sentinela": "baixa", "hora_com_data": "baixa", "hora_sem_data": "media",
                   "valor_fora_do_dominio": "media", "hora_invalida": "media", "catalogo_codigo_inexistente": "media",
                   "catalogo_codigo_invalido": "media", "pai_inexistente": "media"}
TIPOS_INT = (7, 8, 16)


def planejar(mapa_exec, presentes, excluir=frozenset(carga.ORDEM)):
    """Plano de carga em ordem do mapa: uma entrada por tabela carregável PRESENTE na origem com coluna declarada.
    Sem banco e sem Firebird (teste de unidade)."""
    geradas = {}
    for c in mapa_exec.get("colunas", []):
        geradas.setdefault(c["tabela"], {})[c["coluna"]] = c
    decl = {}
    for c in mapa_exec.get("colunas_decl", []):
        if (c.get("destino") or "").count(".") == 1:
            decl.setdefault(c["tabela"], []).append(c)
    quebras = {(d["tabela"], d["depende_de"]) for d in mapa_exec.get("deps", []) if d.get("quebra")}
    plano = []
    for r in sorted(mapa_exec["tabelas"], key=lambda r: int(r["ordem"]) if (r.get("ordem") or "").isdigit() else 10**9):
        t = r["tabela"]
        if not r.get("tabelas_destino") or t in excluir or t not in presentes or t not in decl:
            continue
        ordem_dest = [x for x in r["tabelas_destino"].split(";") if x]
        dts = []
        for c in decl[t]:
            dt = c["destino"].split(".")[0]
            if dt not in dts:
                dts.append(dt)
        pos = {x: i for i, x in enumerate(dts)}
        dts.sort(key=lambda x: (ordem_dest.index(x) if x in ordem_dest else len(ordem_dest), pos[x]))
        cols = {dt: [] for dt in dts}
        for c in decl[t]:
            dt, dc = c["destino"].split(".")
            g = geradas.get(t, {}).get(c["coluna"], {})
            cols[dt].append({"coluna": c["coluna"], "destino": dc, "regra": c.get("regra") or g.get("regra") or "",
                             "depara": c.get("depara") or g.get("depara") or "",
                             "referencia": g.get("referencia") or ""})
        chave = [x for x in (r.get("chave") or "").split(",") if x]
        lidas = list(chave)
        for dt in dts:
            for c in cols[dt]:
                if c["coluna"][:1] not in ("=", "@") and c["coluna"] not in lidas:
                    lidas.append(c["coluna"])
        plano.append({"tabela": t, "chave": chave, "destinos": dts, "colunas": cols, "lidas": lidas,
                      "estrategia": r.get("estrategia", ""),
                      "duas_fases": {p for f, p in quebras if f == t} | {t}})
    return plano


def canon(v, precisao=None):
    """Forma canônica de um campo na soma (mesma dos dois lados): texto em bytes CP1252, decimal normalizado, hora
    como TIME, data e hora truncadas à precisão do destino."""
    if isinstance(v, datetime.timedelta):  # TIME relido do MariaDB
        s = int(v.total_seconds())
        v = datetime.time(s // 3600 % 24, s // 60 % 60, s % 60, v.microseconds)
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, decimal.Decimal)) and not isinstance(v, bool):
        d = decimal.Decimal(v).normalize()
        return format(d, "f") if d else "0"
    if isinstance(v, datetime.time):
        return v.isoformat()
    return carga.fmt(v)


class _PADRAO(str):
    """Marca, no resumo, a coluna que ficou com o padrão do destino (trocada pelo valor relido depois do INSERT)."""


def _truncar(v, precisao):
    """Data e hora na precisão de fração do destino (o que volta do banco é igual ao que foi gravado)."""
    if precisao is None or not isinstance(v, (datetime.datetime, datetime.time)):
        return v
    q = 10 ** (6 - min(6, int(precisao)))
    return v.replace(microsecond=(v.microsecond // q) * q)


class CargaMapa(carga.Carga):
    def __init__(self, leitor, cr, ctl, eid, imagem_id, mapa_exec, progresso=None, entidades_usadas=()):
        super().__init__(leitor, cr, ctl, eid, imagem_id, progresso)
        self.mapa_exec = mapa_exec
        self.prop = Propagador()
        self.deparas = {}
        self.adiadas = []                   # (dt, coluna, id_linha, tabela_pai, chave_pai, tabela, chave)
        self.info = {}                      # dt -> {coluna: (nulo, tipo, precisao)}
        self.ent = {}                       # (tabela, dt) -> nome da entidade na conciliação
        self.usadas = set(entidades_usadas)
        self.plano = []
        self.cont.update(fase2_gravadas=0, fase2_pendentes=0)
        self.por_tabela = {}

    # ----- destino -----
    def _info(self, dt):
        if dt not in self.info:
            rs = self._todas("SELECT COLUMN_NAME, IS_NULLABLE, DATA_TYPE, DATETIME_PRECISION, COLUMN_DEFAULT FROM"
                             " information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s", (dt,))
            if not rs:
                raise ErroCarga("tabela de destino inexistente no banco do cliente: %s" % dt)
            self.info[dt] = {c: (n == "YES", t, p, n != "YES" and d is not None and d != "NULL")
                             for c, n, t, p, d in rs}
        return self.info[dt]

    def _depara(self, cat):
        if cat not in self.deparas:
            existe = self._um("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND"
                              " TABLE_NAME=%s", (depara.CATALOGOS[cat]["tabela"],))
            pares = self._todas(depara.consulta(cat)) if existe else []
            if not pares:
                self._pendencia("-", None, "catalogo_oficial_ausente_%s" % cat, "alta")
            self.deparas[cat] = depara.Depara(cat, pares)
        return self.deparas[cat]

    # ----- leitura -----
    def _linhas_mapa(self, p):
        t = p["tabela"]
        cols = {c["nome"]: c for c in self.lt.colunas(t)}
        faltam = [c for c in p["lidas"] if c not in cols]
        if faltam:
            raise ErroCarga("tabela %s sem as colunas do mapa: %s" % (t, ", ".join(faltam)))
        self.subtipo = {n: c.get("subtipo") or 0 for n, c in cols.items()}
        ch = p["chave"]
        if len(ch) == 1 and self.lt.chave_primaria(t) == ch and cols[ch[0]]["codigo_tipo"] in TIPOS_INT:
            for ini, fim in self.lt.faixas(t, ch[0]):
                nomes, it = self.lt.ler_faixa(t, ch[0], ini, fim, colunas=p["lidas"])
                for x in it:
                    yield dict(zip(nomes, x)), None
            return
        nomes, it = self.lt.ler_tudo(t, colunas=p["lidas"])
        if ch:  # ordem fixa pela chave: decisões de duplicidade estáveis
            ix = [nomes.index(c) for c in ch]
            for x in sorted(it, key=lambda x: tuple(self._chave(x[i]) for i in ix)):
                yield dict(zip(nomes, x)), None
            return
        # sem chave: a chave é o hash da linha mais a ocorrência (multiconjunto de hashes)
        vistos = {}
        for h, x in sorted(((hash_linha(list(x)), x) for x in it), key=lambda y: y[0]):
            vistos[h] = vistos.get(h, 0) + 1
            yield dict(zip(nomes, x)), "h:%s#%d" % (h, vistos[h])

    @staticmethod
    def _chave(v):
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        if isinstance(v, decimal.Decimal) and v == v.to_integral_value():
            v = int(v)
        return chave_txt(v) if v is not None else ""

    # ----- valores -----
    def _referencia(self, t, chave, coluna, ref, raw):
        """(id, regra, gravidade): id do pai já carregado; pai recusado/pendente: ('pai_pendente', gravidade)."""
        if raw is None or (isinstance(raw, (int, float, decimal.Decimal)) and raw == 0):
            return None, None, None
        cpai = self._chave(raw)
        if ref not in self.existente:
            self._carregar_existente(ref)
        ant = self.existente[ref].get(cpai)
        if ant is None:
            return None, "pai_inexistente", "media"
        if ant[0] is None and ant[3]:
            if not self.prop.pendente(ref, cpai):
                self.prop.registrar(ref, cpai, ant[3], ant[4] or "alta")
            ps = self.prop.avaliar(t, chave, [(coluna, ref, cpai)])
            return None, "pai_pendente", (ps[0]["gravidade"] if ps else "alta")
        return ant[0], None, None

    def _valores(self, p, linha, chave):
        """{dt: {coluna destino: valor}}, resumo por dt, pendências [(regra, grav)], recusa (regra, grav) ou None,
        adiadas [(dt, coluna, ref, chave_pai)]."""
        t = p["tabela"]
        vals, campos, pend, adiadas = {}, {}, [], []
        for dt in p["destinos"]:
            info = self._info(dt)
            v, cs = {}, []
            for c in p["colunas"][dt]:
                nome, dc = c["coluna"], c["destino"]
                if nome.startswith("="):
                    x = nome[1:]
                elif nome == "@id":
                    v[dc] = None  # preenchido na gravação (id do principal); fora do resumo
                    continue
                else:
                    raw = linha[nome]
                    regra = sentinela.regra_efetiva(c["regra"] or "texto", self.subtipo.get(nome, 0))
                    if c["depara"] in depara.CATALOGOS:
                        x, pr = self._depara(c["depara"]).resolver(raw)
                        if pr:
                            pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
                    elif regra == "chave_origem" and c["referencia"]:
                        if c["referencia"] in p["duas_fases"]:
                            if raw is not None and not (isinstance(raw, (int, float, decimal.Decimal)) and raw == 0):
                                adiadas.append((dt, dc, c["referencia"], self._chave(raw)))
                            v[dc] = None
                            continue
                        x, pr, g = self._referencia(t, chave, nome, c["referencia"], raw)
                        if pr == "pai_pendente":
                            return None, None, pend, (pr, g), []
                        if pr:
                            pend.append((pr, g))
                    else:
                        x, pr = sentinela.aplicar(regra, raw)
                        if pr:
                            pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
                ic = info.get(dc) or (True, None, None, False)
                if x is None and ic[3]:  # NOT NULL com padrão: o destino decide; o resumo usa o valor relido
                    cs.append(_PADRAO(dc))
                    continue
                x = _truncar(x, ic[2])
                v[dc] = x
                cs.append(x)
            if "origem" in info and "origem" not in v:
                v["origem"] = "migracao"
            vals[dt], campos[dt] = v, cs
        return vals, campos, pend, None, adiadas

    def _nome_ent(self, t, dt):
        k = (t, dt)
        if k not in self.ent:
            nome, i = dt, 2
            while nome in self.usadas:
                nome, i = "%s#%d" % (dt, i), i + 1
            self.usadas.add(nome)
            self.ent[k] = nome
        return self.ent[k]

    # ----- carga de uma tabela -----
    def _tabela(self, p):
        t, dts = p["tabela"], p["destinos"]
        ents = [self._nome_ent(t, dt) for dt in dts]
        chaves_sec = lambda k: [k] + ["%s/%s" % (k, dt) for dt in dts[1:]]  # noqa: E731
        inicio, n = time.monotonic(), 0
        for linha, ch_sem in self._linhas_mapa(p):
            n += 1
            chave = ch_sem or "|".join(self._chave(linha[c]) for c in p["chave"])
            h = bytes.fromhex(hash_linha([linha[c] for c in p["lidas"]]))
            sit, ant = self._situacao(t, chave, h)
            if sit != "nova":
                if ant[0] is not None:
                    for ent, k in zip(ents, chaves_sec(chave)):
                        a = self.existente.get(t, {}).get(k) or ant
                        self._ja_carregada(ent, chave, sit, a)
                elif ant[3]:
                    self.prop.registrar(t, chave, ant[3], ant[4] or "alta")
                continue
            vals, campos, pend, recusa, adiadas = self._valores(p, linha, chave)
            if recusa:
                self._recusar(t, chave, ents[0], h, *recusa)
                self.prop.registrar(t, chave, *recusa)
                continue
            for regra, g in pend:
                self._pendencia(t, chave, regra, g)
            hds = []

            def gravar():
                ids = []
                del hds[:]
                for i, dt in enumerate(dts):
                    v = vals[dt]
                    for c in p["colunas"][dt]:
                        if c["coluna"] == "@id":
                            v[c["destino"]] = ids[0]
                    ids.append(self._inserir(dt, v))
                    cs = campos[dt]
                    pad = [x for x in cs if isinstance(x, _PADRAO)]
                    if pad:
                        self.cont["padrao_do_destino"] = self.cont.get("padrao_do_destino", 0) + len(pad)
                        lido = dict(zip(pad, self._todas("SELECT %s FROM `%s` WHERE id=%%s" % (
                            ", ".join("`%s`" % c for c in pad), dt), (ids[-1],))[0]))
                        cs = [lido[x] if isinstance(x, _PADRAO) else x for x in cs]
                    hds.append(hashlib.sha256("|".join(canon(x) for x in cs).encode()).digest())
                    self._registrar(t, chaves_sec(chave)[i], dts[i] if i else ents[0], ids[-1], h, hds[i])
                return ids
            ids = self._linha_nova(t, chave, ents[0], h, gravar)
            if ids:
                for ent, hd in zip(ents, hds):
                    self.origem.setdefault(ent, {})[chave] = hd.hex()
                for dt, dc, ref, cpai in adiadas:
                    self.adiadas.append((dt, dc, ids[dts.index(dt)], ref, cpai, t, chave))
            else:
                self.prop.registrar(t, chave, self.existente[t][chave][3] or "recusada", "critica")
            if n % LOTE_COMMIT == 0:
                self._commit()
        self._commit()
        seg = time.monotonic() - inicio
        self.por_tabela[t] = {"linhas": n, "segundos": round(seg, 3),
                              "linhas_por_segundo": round(n / seg, 1) if seg > 0 else None}

    def _fase2(self):
        """Referências adiadas (autorreferência e ciclo declarado em duas fases): gravadas por UPDATE no fim."""
        for dt, dc, rid, ref, cpai, t, chave in self.adiadas:
            if ref not in self.existente:
                self._carregar_existente(ref)
            ant = self.existente[ref].get(cpai)
            if ant is None or ant[0] is None:
                self.cont["fase2_pendentes"] += 1
                self._pendencia(t, chave, "pai_pendente" if ant else "pai_inexistente", "media")
                continue
            with self._c() as c:
                c.execute("UPDATE `%s` SET `%s`=%%s WHERE id=%%s" % (dt, dc), (ant[0], rid))
            self.cont["fase2_gravadas"] += 1
        self._commit()

    # ----- execução -----
    def executar(self, presentes, contagens):
        self.plano = planejar(self.mapa_exec, presentes)
        self.tabelas = [p["tabela"] for p in self.plano]
        if not self.plano:
            return {"versao_mapa": VERSAO, "entidades": {}, "pendencias": {"total": 0, "criticas": 0, "por_regra": {}},
                    "carga": dict(self.cont, por_tabela={})}
        for p in self.plano:
            self._carregar_existente(p["tabela"])
        for i, p in enumerate(self.plano):
            self.progresso(i / len(self.plano), "carregando %s" % p["destinos"][0])
            self._tabela(p)
        self._fase2()
        res = self.conciliar(contagens)
        self._commit()
        return res

    # ----- conciliação (destino relido do banco) -----
    def _destino(self, p, dt, ent, principal):
        info = self._info(dt)
        cols = [c for c in p["colunas"][dt] if c["coluna"] != "@id" and not (
            c["coluna"][:1] != "=" and (c["regra"] == "chave_origem" and c["referencia"] in p["duas_fases"]
                                        and c["depara"] not in depara.CATALOGOS))]
        ed = "(d.versao > 1 OR d.alterado_em IS NOT NULL)" if {"versao", "alterado_em"} <= set(info) else "0"
        sel = ", ".join(["co.chave_original"] + ["d.`%s`" % c["destino"] for c in cols] + [ed])
        rs = self._todas("SELECT %s FROM %s.conector_origem co JOIN `%s` d ON d.id=co.id_destino WHERE"
                         " co.tabela_origem=%%s AND co.entidade_destino=%%s" % (sel, self.ctl, dt),
                         (p["tabela"], ent if principal else dt))
        suf = "" if principal else "/" + dt
        saida = {}
        for r in rs:
            k = r[0][:-len(suf)] if suf and r[0].endswith(suf) else r[0]
            saida[k] = ("|".join(canon(x) for x in r[1:-1]), bool(r[-1]))
        return saida

    def conciliar(self, contagens):
        res = {}
        for p in self.plano:
            t = p["tabela"]
            vistas = self.vistas.get(t, set())
            for i, dt in enumerate(p["destinos"]):
                ent = self._nome_ent(t, dt)
                bruto = self._destino(p, dt, ent, i == 0)
                destino, apagadas = {}, 0
                for k, (txt, ed) in bruto.items():
                    if k not in vistas:
                        if i == 0:
                            apagadas += 1
                            self._pendencia(t, k, "apagada_aguarda_sincronizar", "media")
                        continue
                    destino[k] = (hashlib.sha256(txt.encode()).hexdigest(), ed)
                aguardam = self.aguardam.get(ent, set())
                so, sd, editados = self._conferir(ent, t, destino, vistas, aguardam)
                recusadas = sum(1 for k in vistas if self.existente.get(t, {}).get(k, (None,))[0] is None)
                lidos = int(contagens.get(t, 0))
                if i == 0:
                    ok = lidos == len(vistas) == len(destino) + recusadas and so == sd
                else:
                    ok = set(self.origem.get(ent, {})) | set(aguardam) == set(destino) and so == sd
                res[ent] = {"tabela_origem": t, "registros_origem": lidos if i == 0 else len(self.origem.get(ent, {})),
                            "registros_destino": len(destino), "recusados": recusadas if i == 0 else 0,
                            "aguardam_sincronizar": len(aguardam), "editados_no_destino": editados,
                            "apagados_na_origem": apagadas, "soma_origem": so, "soma_destino": sd, "conferido": ok}
        principal = {p["tabela"]: self._nome_ent(p["tabela"], p["destinos"][0]) for p in self.plano}
        por_regra = {}
        for tab, _, regra, grav in self.pend:
            k = "%s:%s:%s" % (principal.get(tab, "outra"), regra, grav)
            por_regra[k] = por_regra.get(k, 0) + 1
        with self._c() as c:
            for ent, r in res.items():
                c.execute("INSERT INTO %s.conciliacao (execucao_id, entidade, registros_origem, registros_destino,"
                          " pendencias, soma_controle, conferido, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%%s,%s)"
                          " ON DUPLICATE KEY UPDATE registros_origem=VALUES(registros_origem),"
                          " registros_destino=VALUES(registros_destino), pendencias=VALUES(pendencias),"
                          " soma_controle=VALUES(soma_controle), conferido=VALUES(conferido), versao=versao+1"
                          % (self.ctl, AGORA),
                          (self.eid, ent, r["registros_origem"], r["registros_destino"], r["recusados"],
                           r["soma_destino"], r["conferido"]))
        return {"versao_mapa": VERSAO, "entidades": res, "pendencias": {
            "total": len(self.pend), "criticas": sum(1 for x in self.pend if x[3] == "critica"),
            "por_regra": por_regra}, "carga": dict(self.cont, por_tabela=self.por_tabela)}
