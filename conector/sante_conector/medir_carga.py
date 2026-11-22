"""Medição da velocidade da carga dirigida pelo mapa num RECORTE da cópia real (só contagens, nunca valores).

`conector.sh medir-carga <relativo> --cliente <codigo> --tabelas T1,T2 [--limite N] [--limite-pais M] [--vezes 2]`

- O banco `cliente_<codigo>` tem de existir (tools/db/criar_cliente.py, cliente de teste próprio); a base de controle
  dele é garantida aqui e a "imagem" registrada com um número de execução de medição.
- O plano é o do motor (`carga_mapa.planejar`), restrito às tabelas medidas e aos pais delas (fecho de `depende_de`
  do mapa), na mesma ordem. Cada tabela lê no máximo `--limite` linhas (as medidas) ou `--limite-pais` (os pais), na
  ordem da chave; filho cujo pai ficou fora do recorte segue as regras de sempre (`pai_inexistente`).
- `--vezes 2`: a segunda passada prova a idempotência (nenhuma linha nova; tudo `puladas_iguais`).
- Saída: linhas por segundo por tabela e passada, pendências por regra e uma impressão digital do `conector_origem`
  (contagem por tabela e regra e soma dos `hash_destino`), para comparar o código antigo com o novo.
"""
import hashlib
import itertools
import time

from . import banco, carga_mapa, controle, mapa

EID_MEDICAO = 990000000


def fecho(mapa_exec, tabelas):
    tab = {r["tabela"]: r for r in mapa_exec["tabelas"]}
    vistos, pilha = set(), list(tabelas)
    while pilha:
        t = pilha.pop()
        if t in vistos:
            continue
        vistos.add(t)
        info = tab.get(t) or {}
        pilha += [d for d in (info.get("depende_de") or "").split(",") if d]
    return vistos


class _Recorte(carga_mapa.CargaMapa):
    limites = {}
    cortadas = frozenset()  # tabelas com mais linhas que o limite do recorte
    cortes = {}  # tabela -> (coluna da chave inteira, última chave do recorte): a tabela dividida por faixa corta pela chave

    def _linhas_mapa(self, p):
        lim = self.limites.get(p["tabela"])
        it = super()._linhas_mapa(p)
        corte = self.cortes.get(p["tabela"])
        if lim and corte and self._faixas_so is not None:  # parte de tabela dividida: as mesmas linhas do islice
            return itertools.takewhile(lambda x: x[0][corte[0]] <= corte[1], it)
        return itertools.islice(it, lim) if lim else it

    def _faixas_divisao(self, p):
        corte = self.cortes.get(p["tabela"])
        if p["tabela"] in self.cortadas and not corte:  # cortada sem a última chave: não divide (leria N vezes)
            return []
        fx = super()._faixas_divisao(p)
        return [f for f in fx if f[0] <= corte[1]] if corte else fx


def _cortes(lt, limites, totais):
    """Última chave do recorte (a N-ésima na ordem da chave) de cada tabela de chave inteira cortada."""
    saida = {}
    for t, lim in limites.items():
        ch = lt.chave_primaria(t)
        if not lim or len(ch) != 1 or totais[t] <= lim:
            continue
        r = lt.consultar('SELECT "%s" FROM "%s" ORDER BY 1 ROWS %d TO %d' % (ch[0], t, lim, lim))
        v = r[0][0] if r else None
        if v is not None and int(v) == v:  # inteiro ou NUMERIC(n,0) (Decimal)
            saida[t] = (ch[0], int(v))
    return saida


def impressao(cc, ctl, tabelas):
    with cc.cursor() as c:
        c.execute("SELECT tabela_origem, COALESCE(regra_recusa, '-'), COUNT(*), COUNT(id_destino),"
                  " SUM(CONV(LEFT(HEX(COALESCE(hash_destino, hash_linha)), 15), 16, 10) MOD 1000000007)"
                  " FROM `%s`.conector_origem GROUP BY 1, 2 ORDER BY 1, 2" % ctl)
        linhas = [(t, r, int(n), int(d), int(s or 0)) for t, r, n, d, s in c.fetchall() if t in tabelas]
        c.execute("SELECT regra, COUNT(*) FROM `%s`.pendencia GROUP BY 1 ORDER BY 1" % ctl)
        pend = {r: int(n) for r, n in c.fetchall()}
    return {"por_tabela_regra": ["%s|%s|%d|%d" % x[:4] for x in linhas],
            "digito": hashlib.sha256(repr(linhas).encode()).hexdigest()[:16], "pendencias": pend}


def medir(lt, origem, codigo, tabelas, limite, limite_pais, vezes, perfil=None):
    mapa_exec = mapa.carregar_execucao()
    presentes = set(lt.tabelas())
    alvo = fecho(mapa_exec, tabelas) & presentes
    plano_todo = carga_mapa.planejar(mapa_exec, presentes)
    nomes = [p["tabela"] for p in plano_todo if p["tabela"] in alvo]
    _Recorte.limites = {t: (limite if t in tabelas else limite_pais) for t in nomes}
    totais = {t: lt.contar(t) for t in nomes}
    contagens = {t: min(totais[t], _Recorte.limites[t] or 10 ** 12) for t in nomes}
    _Recorte.cortadas = frozenset(t for t in nomes if _Recorte.limites[t] and totais[t] > _Recorte.limites[t])
    _Recorte.cortes = _cortes(lt, {t: _Recorte.limites[t] for t in nomes if contagens[t] >= 100000}, totais)
    root = banco.conectar()
    try:
        ctl = controle.preparar(root, codigo, "cliente_" + codigo)
    finally:
        root.close()
    cc = banco.conectar("cliente_" + codigo, autocommit=False)
    saida = {"tabelas_no_recorte": len(nomes), "medidas": sorted(tabelas), "passadas": [],
             "gravadores": carga_mapa.paralelo.gravadores(),
             "ondas": [len(o) for o in carga_mapa.paralelo.ondas([p for p in plano_todo if p["tabela"] in alvo], mapa_exec)]}
    try:
        for vez in range(vezes):
            eid = EID_MEDICAO + int(time.time()) % 1000000
            with cc.cursor() as c:
                c.execute("INSERT INTO `%s`.imagem (execucao_id, arquivo, tamanho_bytes, sha256, corte_em, ods_versao,"
                          " pagina_bytes, tabelas, registros_total, generators, somente_leitura, criado_em)"
                          " VALUES (%%s,%%s,%%s,NULL,UTC_TIMESTAMP(),0,0,%%s,%%s,0,1,UTC_TIMESTAMP(3))" % ctl,
                          (eid, origem["relativo"], origem["tamanho"], len(nomes), sum(contagens.values())))
                iid = c.lastrowid
            cc.commit()
            t0 = time.monotonic()
            cm = _Recorte(lt, cc, ctl, eid, iid, mapa_exec)
            if perfil and vez == 0:  # cProfile da 1ª passada: só nomes de função e tempos
                import cProfile
                import pstats
                pr = cProfile.Profile()
                res = pr.runcall(cm.executar, set(nomes), contagens)
                with open(perfil, "w") as f:
                    pstats.Stats(pr, stream=f).sort_stats("cumulative").print_stats(45)
                    pstats.Stats(pr, stream=f).sort_stats("tottime").print_stats(30)
            else:
                res = cm.executar(set(nomes), contagens)
            seg = time.monotonic() - t0
            pt = res["carga"].get("por_tabela") or cm.por_tabela
            total = sum(x["linhas"] for x in pt.values())
            saida["passadas"].append({
                "vez": vez + 1, "segundos": round(seg, 1), "linhas": total,
                "linhas_por_segundo_total": round(total / seg, 1) if seg else None,
                "medidas": {t: pt.get(t) for t in tabelas},
                "carga": {k: v for k, v in res["carga"].items() if isinstance(v, int)},
                "entidades_conferidas": sum(1 for e in res["entidades"].values() if e.get("conferido")),
                "entidades": len(res["entidades"]),
                "pendencias": res["pendencias"]["total"],
                "divididas": dict(getattr(cm, "divididas", {})),
                "impressao": impressao(cc, ctl, set(nomes))})
            time.sleep(1)
    finally:
        cc.close()
    return saida


def prever(lt, ritmo_gravador, ritmo_leitor, gravadores):
    """Previsão da carga completa: contagem de cada tabela do plano inteiro, ondas e gravadores livres (a maior
    tabela primeiro), com o teto de um gravador e o teto do leitor único. Só contagens."""
    import os
    mapa_exec = mapa.carregar_execucao()
    # CONECTOR_ADIAR (carga em duas passadas, motor.py): a previsão é a da passada sem as tabelas adiadas
    adiar = {t.strip() for t in (os.environ.get("CONECTOR_ADIAR") or "").split(",") if t.strip()}
    plano = carga_mapa.planejar(mapa_exec, set(lt.tabelas()) - adiar)
    cont = {p["tabela"]: lt.contar(p["tabela"]) for p in plano}
    ws = carga_mapa.paralelo.ondas(plano, mapa_exec)
    total_s, por_onda = 0.0, []
    divididas = set()
    for onda in ws:
        tarefas = []  # tabela grande e segura (paralelo.divisivel_spec): uma parte por gravador
        for i in onda:
            t = plano[i]["tabela"]
            q = gravadores if gravadores > 1 and carga_mapa.paralelo.divisivel_spec(plano[i], cont[t]) else 1
            divididas.update([t] if q > 1 else [])
            tarefas += [cont[t] / q] * q
        livres = [0.0] * min(gravadores, len(tarefas))
        for x in sorted(tarefas, reverse=True):
            j = livres.index(min(livres))
            livres[j] += x / ritmo_gravador
        linhas = sum(cont[plano[i]["tabela"]] for i in onda)
        s = max(max(livres), linhas / ritmo_leitor)
        total_s += s
        por_onda.append((len(onda), linhas, round(s)))
    maiores = sorted(cont.items(), key=lambda x: -x[1])[:8]
    return {"adiadas": sorted(adiar), "tabelas": len(plano), "linhas": sum(cont.values()), "ondas": len(ws), "horas": round(total_s / 3600, 2),
            "divididas": sorted(divididas, key=lambda t: -cont[t])[:15], "linhas_divididas": sum(cont[t] for t in divididas),
            "ondas_mais_longas": sorted(por_onda, key=lambda x: -x[2])[:8],
            "maiores_tabelas": [(t, n, ws_i) for t, n in maiores
                                for ws_i in [next(k for k, o in enumerate(ws) if any(plano[i]["tabela"] == t for i in o))]]}
