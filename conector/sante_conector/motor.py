"""Uma execução do conector, de `abrindo` a `concluida` (ou `falhou`).

L2: pede a origem ao abridor separado (snapshot, nunca altera nem copia; o motor não tem privilégio), confere
tamanho e sha256 contra o vínculo, conta as tabelas na transação READ ONLY (progresso por tabela), roda o gstat no
mesmo snapshot (fonte independente), grava a imagem na base de controle do cliente pelo usuário restrito da execução
e concilia o que ficou gravado contra o gstat, tabela a tabela. L3: no mesmo snapshot, carrega as entidades do mapa
(carga.py: estabelecimento, usuários, pacientes, atendimentos) pelo mesmo usuário restrito e concilia cada entidade
(contagem e soma de controle relida do destino); divergência faz a execução falhar. L5 a L8: depois do L3, a carga
dirigida pelo mapa (carga_mapa.py) carrega toda tabela carregável com colunas declaradas, na ordem do mapa, com a
mesma conciliação por entidade. No fim, sha256, tamanho e mtime
do arquivo têm de ser iguais aos do início: a prova é obrigatória (não há como desligá-la).

Origem `firebird_servidor` (obra carga-painel, ADR 0010): leitura DIRETA do servidor do hospital (origem.py), sem
abridor, dm-snapshot, gstat nem exigência de `MON$READ_ONLY`. Uma conexão e UMA transação SNAPSHOT READ para a
contagem e a leitura (o paralelo continua com um único leitor no coordenador); a conciliação da leitura usa as
contagens da própria transação; a identidade técnica da base faz o papel do sha256 (continuação).

Tela "Carga e sincronismo" (obra carga-painel): `contadores.progresso` ao vivo a cada batimento (carga.Placar),
pausa no próximo ponto seguro (`pausando` -> `pausada`, continuável), log da execução em arquivo (registro_log.py) e
`contadores.conciliacao_carga` (recusadas; `conferido=false` quando há recusa). A conciliação da leitura (gstat ou
transação) chama-se `conciliacao_leitura`.
"""
import contextlib
import datetime
import json
import os
import traceback
import hashlib
import time

import pymysql

from . import (banco, caminho, carga, carga_mapa, continuar, controle, disco, imagem, mapa, origem, plataforma,
               preco_origem, registro_log, relatorio)
from .leitor import Leitor
from .servico_abridor import abrir_remoto


class FalhaExecucao(RuntimeError):
    pass


def soma_controle(contagens):
    """Resumo da contagem por tabela (ordem fixa), para comparar duas fontes de uma vez."""
    txt = "\n".join("%s=%d" % (t, int(n)) for t, n in sorted(contagens.items()))
    return hashlib.sha256(txt.encode()).hexdigest()


def motivo_conciliacao(entidades, ruins):
    """Motivo da falha da conciliação (só nomes de entidade e contagens): primeiro as entidades principais com recusa
    acima do limite, que pedem decisão (relatório L10, `recusa_acima_do_limite`), depois as que divergiram."""
    acima = [k for k in ruins if entidades[k].get(carga.REGRA_RECUSA_LIMITE)]
    outras = [k for k in ruins if k not in acima]
    partes = []
    if acima:
        partes.append("recusa acima do limite em entidade principal, decisão no relatório: %s" % ", ".join(
            "%s %d de %d" % (k, int(entidades[k].get("recusados") or 0), int(entidades[k].get("registros_origem") or 0))
            for k in acima))
    if outras:
        partes.append("conciliação por entidade divergiu: %s" % ", ".join(outras))
    return "; ".join(partes)


def _relatorio(eid, usuario, rel, cont, mapa_exec, resolver_pendencias=True):
    """L10: relatório curto da execução (ADR 0007, item 22) em `contadores.relatorio`: pendências abertas, críticas e
    resolvidas por entidade e regra, o que não carregou, a prova de não copiar e as decisões do cliente."""
    if not rel.get("senha"):
        return
    contagens = rel.get("contagens") or {}
    cr = banco.conectar(rel["ctl"], usuario=usuario, senha=rel["senha"], autocommit=False)
    try:
        cont["relatorio"] = relatorio.gerar(
            cr, rel["ctl"], eid, rel.get("entidades") or {}, contagens=contagens, plano=rel.get("plano") or (),
            carga_propria=[t for t in contagens if t in carga.MAPA], mapa_exec=mapa_exec,
            provas=rel.get("provas"), sem_mapa=cont.get("tabelas_sem_mapa"),
            resolver_pendencias=resolver_pendencias, cadeia=rel.get("cadeia"), pular=rel.get("pular"))
    finally:
        cr.close()



def tabelas_da_passada(tabelas, env=None):
    """(adiar, so, carregar) da passada. Carga em duas passadas (dono, 22/11): CONECTOR_ADIAR lista tabelas da origem
    (separadas por vírgula) que ficam para uma passada seguinte (ex.: trilhas de auditoria); a leitura, a contagem e o
    confronto com o gstat continuam sobre TODAS, só a carga delas é adiada. CONECTOR_SO: passada só de algumas tabelas
    (reprocessa o que uma correção do mapa mudou; a carga é idempotente). `carregar` é o ÚNICO conjunto entregue ao
    plano, à carga L3 e à CargaMapa.executar (que refaz o plano: receber todas as tabelas carregava as adiadas)."""
    env = os.environ if env is None else env
    adiar = {t.strip() for t in (env.get("CONECTOR_ADIAR") or "").split(",") if t.strip()}
    so = {t.strip() for t in (env.get("CONECTOR_SO") or "").split(",") if t.strip()}
    fora = adiar | (set(tabelas) - so) if so else adiar
    return adiar, so, set(tabelas) - fora

class Painel:
    """Progresso da execução na plataforma (obra carga-painel): percentual, etapa e `contadores.progresso` (Placar) a
    cada chamada; lê o pedido de pausa (no máximo a cada LEITURA_PAUSA_S) e passa a execução a `pausando`; batimento
    no log a cada LOG_S. Toda mudança de estado do motor passa por `estado`, que para na pausa pedida (ponto seguro)."""
    LEITURA_PAUSA_S = 5.0
    LOG_S = 60.0

    def __init__(self, conn, eid, cont, log, estado=None):
        self.conn, self.eid, self.cont, self.log = conn, eid, cont, log
        self.placar = carga.Placar(ao_evento=self._evento)
        self.estado_atual, self.etapa, self.pct = estado, None, 0.0
        self._ult_pausa, self._ult_log = float("-inf"), time.monotonic()
        self.pausando = False

    def _evento(self, tipo, t):
        pl = self.placar
        if tipo == "inicio":
            self.log.tabela_inicio(t, pl.nomes.get(t), pl.contagens.get(t, 0))
        else:
            self.log.tabela_fim(t, pl.nomes.get(t), pl.contagens.get(t, 0), pl.tabela(t))

    def checar_pausa(self, forcar=False):
        if self.pausando or self.placar.pausa_pedida:
            self._entrar_pausando()
            return True
        agora = time.monotonic()
        if not forcar and agora - self._ult_pausa < self.LEITURA_PAUSA_S:
            return False
        self._ult_pausa = agora
        if plataforma.pausa_solicitada(self.conn, self.eid):
            self._entrar_pausando()
            return True
        return False

    def _entrar_pausando(self):
        if self.pausando:
            return
        self.pausando = True
        self.placar.pedir_pausa()
        self.log.linha("pausa pedida: a carga para no próximo ponto seguro (depois de um commit)")
        if self.estado_atual in plataforma.TRANSICOES and "pausando" in plataforma.TRANSICOES[self.estado_atual]:
            try:
                plataforma.mudar_estado(self.conn, self.eid, "pausando",
                                        etapa=("pausando: %s" % (self.etapa or ""))[:120])
                self.estado_atual = "pausando"
                self.log.etapa("pausando", self.etapa)
            except plataforma.PlataformaErro:
                pass

    def _contadores(self, extra=None):
        c = dict(self.cont, **(extra or {}))
        if self.placar.contagens:
            c["progresso"] = self.placar.json()
        return c

    def progresso(self, pct=None, etapa=None, extra=None):
        if pct is not None:
            self.pct = pct
        if etapa is not None:
            self.etapa = etapa
        self.checar_pausa()
        plataforma.progresso(self.conn, self.eid, self.pct, etapa, self._contadores(extra))
        if time.monotonic() - self._ult_log >= self.LOG_S:
            self._ult_log = time.monotonic()
            if self.placar.contagens:
                self.log.batimento(self.placar.json())
            else:
                self.log.linha("batimento: %s" % (self.etapa or "-"))

    def carga(self, frac, etapa):
        """Progresso da carga (carga.Batimento): percentual por LINHAS processadas (Placar), não por tabelas."""
        f = self.placar.fracao() if self.placar.linhas_total() else frac
        self.progresso(5 + 89 * max(0.0, min(1.0, f)), etapa)

    def estado(self, novo, **kw):
        """Mudança de estado do motor: com a pausa pedida, para aqui (ponto seguro) em vez de mudar."""
        if self.checar_pausa(forcar=True):
            raise carga.PausaPedida()
        if "contadores" in kw and kw["contadores"] is not None and self.placar.contagens:
            kw["contadores"] = dict(kw["contadores"], progresso=self.placar.json())
        plataforma.mudar_estado(self.conn, self.eid, novo, **kw)
        self.estado_atual = novo
        if kw.get("etapa"):
            self.etapa = kw["etapa"]
        if "percentual" in kw:
            self.pct = kw["percentual"]
        self.log.etapa(novo, kw.get("etapa"))


def identidade_sha(ident):
    """Resumo estável da identidade técnica da base (origem servidor): faz o papel do sha256 do arquivo na imagem
    do controle e na continuação (mesma base = mesma identidade)."""
    return hashlib.sha256(json.dumps(ident, sort_keys=True, ensure_ascii=True).encode()).hexdigest()


def _contar(lt, painel, cont):
    tabelas = lt.tabelas()
    contagens, t_ult = {}, 0.0
    for i, t in enumerate(tabelas, 1):
        contagens[t] = lt.contar(t)
        if time.time() - t_ult > 2 or i == len(tabelas):
            t_ult = time.time()
            painel.progresso(1 + 4 * i / max(1, len(tabelas)), "contadas %d de %d tabelas" % (i, len(tabelas)),
                             extra=dict(tabelas_lidas=i, tabelas_total=len(tabelas),
                                        registros_lidos=sum(contagens.values())))
    painel.log.linha("contagem: %d tabelas, %d registros" % (len(tabelas), sum(contagens.values())))
    return tabelas, contagens


def _imagem(ctl, usuario, senha, eid, img, contagens, fonte, fonte_nome, mapa_exec, cont):
    """Grava a imagem (contagem por tabela) no controle e concilia o gravado, lido de volta, contra a fonte
    independente (gstat no arquivo; a própria transação no servidor). Devolve (id da imagem, conciliação)."""
    cr = banco.conectar(ctl, usuario=usuario, senha=senha, autocommit=False)
    try:
        with cr.cursor() as c:
            c.execute("INSERT INTO imagem (execucao_id, arquivo, tamanho_bytes, sha256, corte_em, ods_versao,"
                      " pagina_bytes, tabelas, registros_total, generators, somente_leitura, criado_em)"
                      " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,UTC_TIMESTAMP(3))",
                      (eid, img["arquivo"], img["tamanho"], img["sha256"], img["corte"], img["ods"], img["pagina"],
                       len(contagens), sum(contagens.values()), img["generators"], True))
            iid = c.lastrowid
            c.executemany("INSERT INTO imagem_tabela (imagem_id, tabela_origem, registros, criado_em)"
                          " VALUES (%s,%s,%s,UTC_TIMESTAMP(3))", [(iid, t, n) for t, n in contagens.items()])
            # o mapa e a estratégia saem da imagem de referência: a contagem DESTE cliente revê. Tabela com
            # linhas fora do mapa (descarte "vazia" que não está vazia) vira pendência, nunca é ignorada
            sem_mapa = mapa.tabelas_sem_mapa(contagens, mapa_exec["tabelas"], mapa_exec["descartes"])
            if sem_mapa:
                c.executemany("INSERT INTO pendencia (execucao_id, tabela_origem, chave_original, regra,"
                              " gravidade, criado_em) VALUES (%s,%s,NULL,'tabela_sem_mapa','alta',"
                              "UTC_TIMESTAMP(3))", [(eid, t) for t, _ in sem_mapa])
        cr.commit()
        cont["tabelas_sem_mapa"] = {"tabelas": len(sem_mapa), "registros": sum(n for _, n in sem_mapa)}
        with cr.cursor() as c:  # o gravado, lido de volta, contra a fonte (não contra o próprio dicionário)
            c.execute("SELECT tabela_origem, registros FROM imagem_tabela WHERE imagem_id=%s", (iid,))
            gravado = {t: int(n) for t, n in c.fetchall()}
            soma_dest, soma_orig = soma_controle(gravado), soma_controle(fonte["registros"])
            ok = soma_dest == soma_orig and fonte["divergentes"] == 0
            c.execute("INSERT INTO conciliacao (execucao_id, entidade, registros_origem, registros_destino,"
                      " pendencias, soma_controle, conferido, criado_em)"
                      " VALUES (%s,'imagem',%s,%s,%s,%s,%s,UTC_TIMESTAMP(3))",
                      (eid, sum(fonte["registros"].values()), sum(gravado.values()), fonte["divergentes"], soma_dest,
                       ok))
        cr.commit()
    finally:
        cr.close()
    conc = {"fonte_origem": fonte_nome, "tabelas_origem": len(fonte["registros"]),
            "registros_origem": sum(fonte["registros"].values()), "tabelas_gravadas": len(gravado),
            "registros_gravados": sum(gravado.values()), "divergentes": fonte["divergentes"], "conferido": ok}
    return iid, conc


def _carregar(conn, eid, ex, ctl, usuario, senha, iid, tabelas, contagens, sha_antes, mapa_exec, rel, cont, painel,
              abrir_leitor):
    """L3 e L5 a L8: carga das entidades e carga pelo mapa, pelo usuário restrito, no mesmo snapshot da contagem.
    `abrir_leitor()`: gerenciador de contexto do leitor (arquivo: reaberto depois do gstat; servidor: o mesmo)."""
    # Carga em duas passadas (dono, 22/11): CONECTOR_ADIAR lista tabelas da origem (separadas por vírgula) que
    # ficam para uma passada seguinte (ex.: trilhas de auditoria). A leitura, a contagem e o confronto com o
    # gstat continuam sobre TODAS; só a carga delas é adiada, e o relatório diz quais ficaram.
    adiar, so, carregar = tabelas_da_passada(tabelas)
    if adiar:
        rel["adiadas"] = cont["adiadas"] = sorted(adiar & set(tabelas))
    if so:
        rel["so"] = cont["so"] = sorted(so & set(tabelas))
    if carga.reprocessar_recusadas():  # CONECTOR_REPROCESSAR_RECUSADAS: recusadas já vistas tentadas de novo
        rel["reprocessar_recusadas"] = cont["reprocessar_recusadas"] = True
    plano = carga_mapa.planejar(mapa_exec, carregar)
    rel["plano"] = [p["tabela"] for p in plano]
    # tela de carga: o total de linhas (as contagens da origem das tabelas que esta execução carrega)
    proprias = [t for t in carga.ORDEM if t in carregar]
    painel.placar.planejar({t: contagens.get(t, 0) for t in proprias + rel["plano"]},
                           dict({t: carga.MAPA.get(t, {}).get("entidade", t) for t in proprias},
                                **{p["tabela"]: p["destinos"][0] for p in plano}))
    painel.log.linha("plano: %d tabelas da carga própria, %d pelo mapa, %d linhas da origem"
                     % (len(proprias), len(plano), painel.placar.linhas_total()))
    # continuação de uma importação interrompida (continuar.py): as tabelas que ela concluiu são puladas
    pular, de = frozenset(), (ex["contadores"] or {}).get("continuar_de")
    if de:
        try:
            cc0 = continuar.concluidas(conn, ctl, int(de), plano, contagens, sha_antes,
                                       lambda e: (plataforma.consultar(conn, e) or {}).get("contadores"))
        except continuar.SemImagem:  # pausada (ou caída) antes da imagem: nada concluído, roda tudo (hash pula)
            cc0 = {"origem": {}, "regra": "sem_imagem", "duas_fases": []}
        pular = dict(cc0["origem"])  # {tabela: execução que a concluiu (pendências repetidas dela)}
        rel["pular"] = dict(pular)  # L10: as pendências vigentes das tabelas puladas
        rel["continuacao"] = cont["continuacao"] = {
            "de": int(de), "regra": cc0["regra"], "tabelas_plano": len(plano), "tabelas_puladas": len(pular),
            "linhas_puladas": sum(int(contagens.get(t, 0)) for t in pular),
            "refeitas_duas_fases": len(cc0["duas_fases"])}
        for t in pular:
            painel.placar.fim(t, evento=False)
        painel.log.linha("continuação da execução %d: %d de %d tabelas já concluídas" % (int(de), len(pular),
                                                                                        len(plano)))
        painel.progresso(5, "continuando a execução %d: %d de %d tabelas já concluídas"
                         % (int(de), len(pular), len(plano)))
    if not (any(t in carga.MAPA for t in tabelas) or plano):
        return
    cc = banco.conectar(ex["banco_nome"], usuario=usuario, senha=senha, autocommit=False)
    try:
        with abrir_leitor() as lt:
            # continuação: o grupo do atendimento da carga própria concluído na cadeia é pulado
            pular_p = continuar.concluidas_propria(
                conn, ctl, int(de), carregar, contagens, sha_antes,
                lambda e: (plataforma.consultar(conn, e) or {}).get("contadores")) if de else {}
            if de:
                rel["continuacao"]["carga_propria_pulada"] = sorted(pular_p)
                rel.setdefault("pular", {}).update(pular_p)
            resumo = carga.Carga(lt, cc, ctl, eid, iid, painel.carga, pular=pular_p,
                                 placar=painel.placar).executar(carregar, contagens) or {
                "versao_mapa": carga.VERSAO_MAPA, "entidades": {},
                "pendencias": {"total": 0, "criticas": 0, "por_regra": {}}, "carga": {}}
            if plano:
                rm = carga_mapa.CargaMapa(lt, cc, ctl, eid, iid, mapa_exec, painel.carga,
                                          entidades_usadas=set(resumo["entidades"]),
                                          sincronizar=ex["tipo"] == "sincronizar",
                                          confirmar_exclusao_em_massa=bool(ex.get("confirmar_exclusao_em_massa")),
                                          pular=pular, continuar_de=int(de) if de else None,
                                          placar=painel.placar).executar(
                    carregar, contagens)  # ADIAR/SO valem também aqui: executar() refaz o plano
                resumo["entidades"].update(rm["entidades"])
                resumo["versao_mapa"] += "+" + rm["versao_mapa"]
                pr, pm = resumo["pendencias"], rm["pendencias"]
                pr["total"] += pm["total"]
                pr["criticas"] += pm["criticas"]
                for k, n in pm["por_regra"].items():
                    pr["por_regra"][k] = pr["por_regra"].get(k, 0) + n
                resumo["carga"]["mapa"] = rm["carga"]
                cont["sincronizar"] = rm["sincronizar"]  # L9: contagens, conflitos (sem valores), alertas
                rel["provas"] = rm.get("provas") or {}
            rel["entidades"] = resumo["entidades"]
            # ADR 0009 (decisão 27): texto livre das agendas migradas -> regras estimadas, texto inteiro ao
            # lado; no Sincronizar, só o texto que mudou é extraído de novo. A falha não derruba a carga.
            # Mesma etapa: agenda -> profissional pelo nome, vigência por evidência (decisão 16), preço
            # particular por médico da origem com a fonte particular classificada (decisão 24) e o repasse
            # integral da consulta particular (preco_origem).
            try:
                cont["agenda_estruturada"] = preco_origem.executar(
                    cc, preco_origem.ler_origem(lt), ctl=ctl, execucao_id=eid)
                pend = resumo["pendencias"]
                for k, n in cont["agenda_estruturada"].get("pendencias", {}).items():
                    pend["total"] += n
                    pend["por_regra"][k] = pend["por_regra"].get(k, 0) + n
            except Exception as e:  # noqa: BLE001 - só o tipo do erro (a mensagem pode citar valores)
                cc.rollback()
                cont["agenda_estruturada"] = {"falhou": type(e).__name__}
                pend = resumo["pendencias"]
                pend["total"] += 1
                pend["por_regra"]["agenda:estruturar_texto_falhou:alta"] = 1
    finally:
        cc.close()
    cont["entidades"] = {k: {x: v[x] for x in ("tabela_origem", "registros_origem", "registros_destino",
                                              "recusados", "conferido", "soma_destino",
                                              "aguardam_sincronizar", "editados_no_destino",
                                              "apagados_na_origem", carga.REGRA_RECUSA_LIMITE)
                             if x in v}
                         for k, v in resumo["entidades"].items()}
    # L9: na carga dirigida pelo mapa, o Sincronizar reaplica a origem (vence), guarda a edição do destino
    # em conflito, exclui logicamente o que sumiu e reativa o que voltou. As 7 tabelas da carga própria
    # do L3 ainda deixam a alteração como pendência (nunca sobrescrita silenciosa).
    resumo["carga"]["modo"] = "sincronizar" if ex["tipo"] == "sincronizar" else "importar"
    cont.update(versao_mapa=resumo["versao_mapa"], pendencias=resumo["pendencias"], carga=resumo["carga"])
    ruins = sorted(k for k, v in resumo["entidades"].items() if not v["conferido"])
    # conciliação da CARGA (tela): as recusadas da etapa final por entidade; com recusa, nunca "conferido"
    recusadas = sum(int(v.get("recusados") or 0) for v in resumo["entidades"].values())
    painel.placar.recusadas_conciliacao = recusadas
    cont["conciliacao_carga"] = {"entidades": len(resumo["entidades"]), "entidades_divergentes": len(ruins),
                                 "recusadas": recusadas, "conferido": recusadas == 0 and not ruins}
    painel.log.linha("conciliação da carga: %d entidades, %d divergentes, %d recusadas"
                     % (len(resumo["entidades"]), len(ruins), recusadas))
    painel.log.recusas(painel.placar.regras)
    if ruins:
        raise FalhaExecucao(motivo_conciliacao(resumo["entidades"], ruins))


def _motivo(e):
    """Motivo técnico da falha, sem valores de linha."""
    msg = str(e)
    motivo = "%s: %s" % (type(e).__name__, msg if len(msg) <= 380 else "..." + msg[-377:])
    tb = traceback.extract_tb(e.__traceback__)
    if tb:  # onde falhou (arquivo e linha do motor; nunca valores), para o diagnóstico
        motivo += " (em %s:%d)" % (os.path.basename(tb[-1].filename), tb[-1].lineno)
    if isinstance(e, pymysql.err.MySQLError):  # a mensagem do servidor pode citar valores ("Duplicate entry ...")
        motivo = "%s: erro %s do banco de destino" % (type(e).__name__, e.args[0] if e.args else "?")
    return motivo


def _pausar(conn, eid, cont, painel, log):
    """Fim pela pausa: tudo o que foi gravado está commitado; `pausando` -> `pausada` (final, continuável)."""
    ex = plataforma.consultar(conn, eid)
    cont["continuavel"] = True
    cont["pausa"] = {"etapa": ex["etapa"], "percentual": ex["percentual"]}
    if painel is not None and painel.placar.contagens:
        cont["progresso"] = painel.placar.json()
    if ex["estado"] != "pausando":
        plataforma.mudar_estado(conn, eid, "pausando", etapa=("pausando: %s" % (ex["etapa"] or ""))[:120])
    plataforma.mudar_estado(conn, eid, "pausada", etapa=("pausada: %s" % (ex["etapa"] or "").replace(
        "pausando: ", ""))[:120], contadores=cont)
    log.etapa("pausada", "continuável: retomar pela tela (importação com continuação)")


def executar(trab, eid):
    """Roda a execução `eid` já reivindicada (estado `abrindo`) por `trab`. Nunca levanta: termina em estado final."""
    conn = trab.conn
    usuario = host = mapa_exec = None
    cont = {}
    rel = {}  # o que o relatório de conciliação (L10) precisa, preenchido ao longo da execução
    log = registro_log.RegistroLog(None, eid, raiz="")  # desligado até saber o cliente
    painel = None
    rep_env = os.environ.get("CONECTOR_REPROCESSAR_RECUSADAS")
    try:
        ex = plataforma.consultar(conn, eid)
        log = registro_log.RegistroLog(ex["codigo"], eid)
        if log.relativo:
            plataforma.gravar_arquivo_log(conn, eid, log.relativo)
        painel = Painel(conn, eid, cont, log, ex["estado"])
        c0 = ex["contadores"] or {}
        for k in ("continuar_de", "reprocessar_recusadas"):  # a cadeia e o pedido ficam nos contadores
            if c0.get(k):
                cont[k] = c0[k]
        if c0.get("reprocessar_recusadas"):  # diferencial da tela: as recusadas são tentadas de novo
            os.environ["CONECTOR_REPROCESSAR_RECUSADAS"] = "1"
        servidor = ex.get("origem_tipo") == origem.TIPO_SERVIDOR
        log.linha("execução %d: tipo %s, modo %s, origem %s%s" % (
            eid, ex["tipo"], ex.get("modo") or "-", "servidor" if servidor else "arquivo",
            (", continuação de %s" % c0["continuar_de"]) if c0.get("continuar_de") else ""))
        cont["disco"] = disco.verificar(ex["tipo"], 0 if servidor else ex["origem_tamanho"])
        mapa_exec = mapa.carregar_execucao()  # sem o mapa não há como rever o que a origem traz: falha antes de abrir
        if servidor:
            org = origem.carregar_origem(conn, ex["origem_id"])
            painel.progresso(1, "conectando ao servidor de origem")
        else:
            painel.progresso(1, "validando o arquivo de origem")
            org = caminho.validar_origem(ex["origem_caminho"])
            if org["tamanho"] != ex["origem_tamanho"]:
                raise FalhaExecucao("o arquivo mudou de tamanho desde o vínculo; vincule de novo")
            painel.progresso(2, "conferindo o resumo sha256 do arquivo")
            sha_antes = caminho.sha256_arquivo(org["absoluto"])
            if not ex["origem_sha256"] or sha_antes != ex["origem_sha256"]:
                raise FalhaExecucao("o arquivo mudou desde o vínculo (sha256 diferente); vincule de novo")
        ctl = controle.preparar(conn, ex["codigo"], ex["banco_nome"])
        # continuação: o elo vai para o controle antes de tudo (as pendências não são copiadas; todo leitor segue a
        # cadeia, controle.cadeia)
        de0 = c0.get("continuar_de")
        if de0:
            controle.gravar_cadeia(conn, ctl, eid, int(de0))
        rel["cadeia"] = controle.cadeia(conn, ctl, eid,
                                        lambda e: (plataforma.consultar(conn, e) or {}).get("contadores"))
        host = controle.host_do_motor(conn)
        usuario = "sscon_e%d_%s" % (eid, banco.ficha_plataforma())
        senha = controle.criar_usuario(conn, usuario, ex["banco_nome"], ctl, host)
        rel.update(ctl=ctl, senha=senha)
        if servidor:
            # UMA conexão e UMA transação SNAPSHOT READ: contagem, identidade e leitura na mesma fotografia
            with origem.abrir_leitor_servidor(org) as lt:
                painel.estado("lendo", etapa="contando as tabelas da origem", percentual=1,
                              versao_schema=ex["versao_migracao"])
                ident = origem.identidade_base(lt)
                sha_antes = identidade_sha(ident)
                plataforma.gravar_identidade(conn, ex["origem_id"], ident)
                tabelas, contagens = _contar(lt, painel, cont)
                rel["contagens"] = contagens
                generators = len(lt.generators())
                cont.update(leitura_direta=True, identidade_base=ident, tabelas=len(tabelas),
                            registros_lidos=sum(contagens.values()), generators=generators)
                painel.estado("gravando", etapa="gravando a imagem na base de controle", percentual=5,
                              contadores=cont)
                try:
                    ods = int(str(ident.get("ods") or "0").split(".")[0])
                except ValueError:
                    ods = 0
                img = {"arquivo": ("servidor:%s" % (ident.get("nome_base") or org.banco))[:255], "tamanho": 0,
                       "sha256": sha_antes, "ods": ods, "pagina": int(ident.get("pagina_bytes") or 0),
                       "corte": datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
                       "generators": generators}
                # sem gstat: a fonte da conciliação da leitura são as contagens da própria transação
                iid, conc = _imagem(ctl, usuario, senha, eid, img, contagens,
                                    {"registros": contagens, "divergentes": 0}, "transacao", mapa_exec, cont)
                cont["conciliacao_leitura"] = conc
                if not conc["conferido"]:
                    raise FalhaExecucao("conciliação da imagem divergiu das contagens da transação")
                _carregar(conn, eid, ex, ctl, usuario, senha, iid, tabelas, contagens, sha_antes, mapa_exec, rel,
                          cont, painel, lambda: contextlib.nullcontext(lt))
        else:
            nome_ab = "e%d-%s" % (eid, banco.ficha_plataforma())
            with abrir_remoto(org["relativo"], nome_ab) as ab:
                painel.estado("lendo", etapa="contando as tabelas da origem", percentual=1,
                              versao_schema=ex["versao_migracao"])
                with Leitor(ab.dispositivo) as lt:
                    tabelas, contagens = _contar(lt, painel, cont)
                    somente_leitura = lt.somente_leitura()
                    rel["contagens"] = contagens
                    generators = len(lt.generators())
                # fonte independente, no mesmo snapshot, com o leitor fechado (o embarcado não divide o arquivo)
                painel.progresso(5, "confrontando com o gstat")
                gs = imagem.gstat_registros(ab.dispositivo)
                conf = imagem.confrontar_gstat({"contagens": contagens}, None, gs)["gstat"]
                cont.update(abertura=ab.resumo(), tabelas=len(tabelas), registros_lidos=sum(contagens.values()),
                            generators=generators, somente_leitura=bool(somente_leitura),
                            gstat={"tabelas": conf["tabelas"], "registros_total": conf["registros_total"],
                                   "divergentes": conf["divergentes"]})
                if not somente_leitura:
                    raise FalhaExecucao("o banco não estava em modo somente leitura na abertura")
                painel.estado("gravando", etapa="gravando a imagem na base de controle", percentual=5,
                              contadores=cont)
                corte = datetime.datetime.fromtimestamp(org["mtime"], datetime.timezone.utc).replace(tzinfo=None)
                img = {"arquivo": org["relativo"], "tamanho": org["tamanho"], "sha256": sha_antes, "corte": corte,
                       "ods": org["ods"], "pagina": org["pagina"], "generators": generators}
                iid, conc = _imagem(ctl, usuario, senha, eid, img, contagens,
                                    {"registros": gs, "divergentes": conf["divergentes"]}, "gstat", mapa_exec, cont)
                cont["conciliacao_leitura"] = conc
                if not conc["conferido"]:
                    raise FalhaExecucao("conciliação da imagem divergiu do gstat (%d tabelas divergentes)"
                                        % max(1, conf["divergentes"]))
                # L3 e L5 a L8 no mesmo snapshot; leitor reaberto depois do gstat
                _carregar(conn, eid, ex, ctl, usuario, senha, iid, tabelas, contagens, sha_antes, mapa_exec, rel,
                          cont, painel, lambda: Leitor(ab.dispositivo))
        # a pendência tabela_sem_mapa entra no resumo do painel (por regra), com as da carga
        if cont.get("tabelas_sem_mapa", {}).get("tabelas"):
            pend = cont.setdefault("pendencias", {"total": 0, "criticas": 0, "por_regra": {}})
            n = cont["tabelas_sem_mapa"]["tabelas"]
            pend["total"] = pend.get("total", 0) + n
            pend.setdefault("por_regra", {})["imagem:tabela_sem_mapa:alta"] = n
        if servidor:
            painel.estado("conciliando", etapa="conferindo contagens", percentual=95, contadores=cont)
        else:
            painel.estado("conciliando", etapa="conferindo contagens e o arquivo", percentual=95, contadores=cont)
            painel.progresso(97, "conferindo o arquivo de origem (sha256, tamanho e mtime)")
            depois = caminho.validar_origem(ex["origem_caminho"])
            sha_depois = caminho.sha256_arquivo(depois["absoluto"])
            if (sha_depois, depois["tamanho"], depois["mtime"]) != (sha_antes, org["tamanho"], org["mtime"]):
                raise FalhaExecucao("o arquivo de origem mudou durante a execução")
            cont["arquivo_inalterado"] = True
        # o relatório (e a resolução das pendências anteriores) só depois de a carga e o arquivo conferirem; a falha
        # só do relatório não derruba a carga gravada: vira pendência da plataforma
        try:
            _relatorio(eid, usuario, rel, cont, mapa_exec)
        except Exception as e:  # noqa: BLE001
            cont["relatorio_falhou"] = type(e).__name__
            pend = cont.setdefault("pendencias", {"total": 0, "criticas": 0, "por_regra": {}})
            pend["total"] = pend.get("total", 0) + 1
            pend.setdefault("por_regra", {})["imagem:relatorio_falhou:alta"] = 1
        if painel.placar.contagens:
            cont["progresso"] = painel.placar.json()
        plataforma.mudar_estado(conn, eid, "concluida", etapa="concluída", percentual=100, contadores=cont,
                                imagem_sha256=sha_antes)
        log.etapa("concluida")
    except carga.PausaPedida:  # parou num ponto seguro: tudo commitado
        try:
            _pausar(conn, eid, cont, painel, log)
        except Exception as e:  # noqa: BLE001 - a pausa que não fecha vira falha continuável
            log.excecao(e, _motivo(e))
            try:
                plataforma.mudar_estado(conn, eid, "falhou", etapa="falhou ao pausar", motivo=_motivo(e),
                                        contadores=dict(cont, continuavel=True))
            except plataforma.PlataformaErro:
                pass
    except Exception as e:  # o motivo é técnico e não traz valores de linha
        motivo = _motivo(e)
        log.excecao(e, motivo, getattr(e, "detalhe", None))
        if painel is not None and painel.placar.contagens:
            cont["progresso"] = painel.placar.json()
            log.recusas(painel.placar.regras)
        if "relatorio" not in cont:  # a execução que falha também deixa o relatório do que chegou a fazer
            try:
                _relatorio(eid, usuario, rel, cont, mapa_exec, resolver_pendencias=False)
            except Exception:  # noqa: BLE001 - o motivo da falha original é o que importa
                pass
        try:
            plataforma.mudar_estado(conn, eid, "falhou", etapa="falhou", motivo=motivo, contadores=cont or None)
        except plataforma.PlataformaErro:
            pass
    finally:
        if rep_env is None:
            os.environ.pop("CONECTOR_REPROCESSAR_RECUSADAS", None)
        else:
            os.environ["CONECTOR_REPROCESSAR_RECUSADAS"] = rep_env
        if usuario and host:
            controle.remover_usuario(conn, usuario, host)
        log.fechar()
    return plataforma.consultar(conn, eid)
