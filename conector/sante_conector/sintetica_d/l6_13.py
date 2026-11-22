"""Fatia L6-13 (prontuário, assinatura e assistência, módulo PEP): imagem SINTÉTICA, dados 100% falsos.

Rodada de cobertura total: 22 das 23 tabelas carregam pelo mapa (PRASSINAT_DOC_PRCHKGERAL e HTPARAMORIGEMCABIMP na
trilha de auditoria; rodada 5, ADR 0006: PRLANCREGISTROTEMPO também, na trilha do envio). Rodada 3: item prescritível pela linha de parâmetros do insumo
(faixa padronizada com dose > 0 grava), evento da situação atual do horário, evento derivado da situação, pressão em
mmHg na observação e histórico da configuração do cabeçalho de impressão na trilha. O DDL sai do dicionário (`mapa/colunas.tsv`: todas as
colunas, mesmos nomes e tipos; só a chave é NOT NULL). Pais de fora da fatia lidos pelas referências encadeadas
(inscrição -> profissional, histórico do atendimento -> atendimento -> paciente, item -> prescrição, detalhe do item ->
item, modo da origem -> modo ventilatório pelo nome, unidade pela sigla de integração, alta vigente pelo cabeçalho, campo autopreenchido pelo nome) entram na
imagem só com as colunas usadas e são PAIS_EXTERNOS (já carregados). Anomalias por tabela: pai inexistente na cadeia,
pai recusado (pai_pendente), CHECK e UNIQUE do destino (4025, 1062), NOT NULL (1048), valor fora da faixa e zero em
coluna positiva (valor_fora_do_dominio), valor presumido e campo sem par no de-para de valores.
"""
import csv
import datetime
from decimal import Decimal as D
from pathlib import Path

_MAPA = Path(__file__).resolve().parents[2] / "mapa"
FATIA = ["PRITENSGLICEMIA", "PRPRESCSOL", "PRITENSESQ", "PRPRESCVI", "PRPRESCVNI", "PRCHKGERAL", "PRASSINAT_DOC_PRCHKGERAL",
         "PREXTRATOITEM_PRCHKGERAL", "PRPRESC_AUTOPREENCHIDO", "PRPRESC_PRPROTGERAL", "PRRECEITA", "PRITEMRECEITA",
         "PRSENECESSARIO_PRPRESCMED", "PRSENECESSARIO_PRPRESCPROCED", "PRVELOCINFUSAO", "PRLANCAMENTOEXAME",
         "PRLANCEXAMEESTRUTURADO", "PRLANCREGISTROTEMPO", "HTATENDALTA", "HTCABECFORMULCOMP", "HTCHKGERAL",
         "HTFORMULCOMP", "HTPARAMORIGEMCABIMP"]
PAIS_ORIGEM = ["TBCBOPRO", "HTPACIENTE", "ATCABECATEND", "HTATENDIMENTO", "PRPRESC", "PRLANGERAL", "PRPRESCPROCED",
               "PRPRESCMED", "PRASSINATURA_DOC", "TBUNIDADEMEDIDA", "PRMODOVENT", "PRFA_CAD_MODO_RESPIR", "TBTABELA_CAMPO",
               "PRPARAMORIGEMCABIMP"]


def _ler(arq):
    with open(_MAPA / arq, encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t"))


_COLS, _CHAVE = {}, {}
for _r in _ler("colunas.tsv"):
    if _r["tabela"] in FATIA or _r["tabela"] in PAIS_ORIGEM:
        _COLS.setdefault(_r["tabela"], []).append((_r["coluna"], _r["forma"], _r["regra"]))
for _r in _ler("tabelas.tsv"):
    if _r["tabela"] in _COLS:
        _CHAVE[_r["tabela"]] = [x for x in _r["chave"].split(",") if x]
COLUNAS = {t: [c for c, _, _ in v] for t, v in _COLS.items()}


def _tipo(forma, regra):
    if forma == "BLOB":
        return "BLOB SUB_TYPE %d" % (1 if regra == "texto_longo" else 0)
    return "DOUBLE PRECISION" if forma == "DOUBLE" else forma


DDL = "".join('CREATE TABLE %s (%s, PRIMARY KEY (%s));\n' % (
    t, ", ".join('"%s" %s%s' % (c, _tipo(f, rg), " NOT NULL" if c in _CHAVE[t] else "") for c, f, rg in _COLS[t]),
    ", ".join('"%s"' % c for c in _CHAVE[t])) for t in FATIA + PAIS_ORIGEM)

PAIS_EXTERNOS = {
    "ATCABECATEND": ["1", "2", "3"], "GETABVIA": ["SC"], "HTATENDIMENTO": ["1", "2", "3", "4", "5"], "HTPACIENTE": ["1", "2"],
    "PREVOLUCAO": ["1"], "PRFA_CAD_MODO_RESPIR": ["1"], "PRITEMNAOPAD": ["1"], "PRLANGERAL": ["1", "2", "3"],
    "PRMODOVENT": ["1", "2"], "PRASSINATURA_CAB": ["1"], "PRPRESC": ["1"], "PRPRESCMED": ["1", "2"], "PRPRESCPROCED": ["1", "2"],
    "PRPROTGERAL": ["1"], "PRSENECESSARIO": ["1", "2"], "PRSITUACAOCHECAGEM": ["A", "N", "O", "P", "S"], "PRTPRECMED": ["1"],
    "PRITEM_GEITENS": ["5/item_prescritivel"], "PRPARAMORIGEMCABIMP": ["1"],
    "PRUNIDINFUSAO": ["1"], "PRVIAAEREA": ["1"], "RICADPAC": ["1", "2"], "TBCBOPRO": ["1", "2", "3"],
    "TBMOTALT": ["1"], "TBPROFIS": ["1", "2"], "TBTABELA_CAMPO": ["1", "2", "3"], "TBUNIDADEMEDIDA": ["1", "2", "3"],
    "TBUSERS": ["ADMIN"]}


def id_externo(tabela, chave):
    """Id que a conferência dá ao pai externo: sequencial na ordem das tabelas e das chaves."""
    i = 0
    for t, ks in sorted(PAIS_EXTERNOS.items()):
        for k in ks:
            i += 1
            if (t, k) == (tabela, chave):
                return i
    raise KeyError((tabela, chave))


# o complemento (PRPRESC_AUTOPREENCHIDO) atualiza o item já gravado: os itens externos existem no destino
PREPARO_DESTINO = (
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
    " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
    + "".join(" INSERT INTO prescricao_item (id, prescricao_id, sequencia, tipo_item_prescricao_id, inicio_em,"
              " lancamento_profissional_id, origem, criado_em) VALUES (%d, 1, %d, 1, '2026-01-02 08:00:00', 1,"
              " 'migracao', UTC_TIMESTAMP(3));" % (id_externo("PRLANGERAL", k), n)
              for n, k in enumerate(PAIS_EXTERNOS["PRLANGERAL"], 1)))


def __getattr__(nome):
    """`MAPA_TESTE`: o mapa REAL sem as declarações dos pais de PAIS_ORIGEM. Na carga real esses pais vêm antes, em
    outras fatias; aqui eles estão na imagem só para as referências encadeadas lerem a origem, e o pai externo
    (PAIS_EXTERNOS) já conta como carregado: planejá-lo de novo daria conciliação falsa. Pedido no L6-13.json: a
    conferência deixar fora do plano, por regra genérica, as tabelas de PAIS_EXTERNOS presentes na imagem."""
    if nome != "MAPA_TESTE":
        raise AttributeError(nome)
    from .. import mapa
    m = mapa.carregar_execucao()
    fora = set(PAIS_ORIGEM)
    return dict(m, colunas_decl=[c for c in m["colunas_decl"] if c["tabela"] not in fora])


def T(d, h=8, m=0):
    return datetime.datetime(2026, 1, d, h, m)


def linhas(r, ins):
    def q(t, **kw):
        fora = set(kw) - set(COLUNAS[t])
        assert not fora, (t, fora)
        ins(t, [kw.get(c) for c in COLUNAS[t]])

    # pais lidos pelas referências encadeadas (só as colunas usadas)
    for i, prof in ((1, 1), (2, 2), (3, 9)):
        q("TBCBOPRO", ID=i, ID_TBPROFIS=prof)
    for i in (1, 2):
        q("HTPACIENTE", ID=i, ID_RICADPAC=i)
    # estado vigente da alta no atendimento: 1 alta efetivada; 2 sem alta (só prevista); 3 alta sem motivo
    q("ATCABECATEND", ID=1, ID_RICADPAC=1, DATA_HORA_ALTA_MEDICA=T(5, 11), ID_TBMOTALT=1, DATA_HORA_SAIDA_LEITO=T(5, 13),
      ID_TBCBOPRO_ALTA_MEDICA=1, ID_TBCBOPRO_ATENDIMENTO=2)
    q("ATCABECATEND", ID=2, ID_RICADPAC=2, ID_TBCBOPRO_ATENDIMENTO=2)
    q("ATCABECATEND", ID=3, ID_RICADPAC=1, DATA_HORA_ALTA_MEDICA=T(6, 12), ID_TBCBOPRO_ALTA_MEDICA=2,
      ID_TBCBOPRO_ATENDIMENTO=1)
    q("PRPARAMORIGEMCABIMP", ID=1, ID_PRTPASSINATURA=1, ORIGEM_DADOS="E", GERENCIAVEL="S")
    for i, at, ass in ((1, 1, 1), (2, 2, 2), (3, 1, 3), (4, 2, 1), (5, 3, 1)):
        q("HTATENDIMENTO", ID=i, ID_ATCABECATEND=at, ID_TBCBOPRO_ASSISTENTE=ass, DATA_HORA_HISTORICO=T(1, 7))
    q("PRPRESC", ID=1, ID_HTATENDIMENTO=1, DATA_HORA_PRESCRICAO=T(2, 7, 30))
    for i in (1, 2, 3):
        q("PRLANGERAL", ID=i, ID_PRPRESC=1)
    q("PRPRESCPROCED", ID=1, ID_PRLANGERAL=1)
    q("PRPRESCPROCED", ID=2, ID_PRLANGERAL=2)
    q("PRPRESCMED", ID=1, ID_PRLANGERAL=3)
    q("PRPRESCMED", ID=2, ID_PRLANGERAL=8)
    q("PRASSINATURA_DOC", ID=1, ID_PRASSINATURA_CAB=1, DATA_HORA_EVENTO=T(2, 9))
    q("PRASSINATURA_DOC", ID=2, ID_PRASSINATURA_CAB=9, DATA_HORA_EVENTO=T(2, 12, 30))
    q("PRASSINATURA_DOC", ID=3, ID_PRASSINATURA_CAB=1)
    for i, nome, simb in ((1, "Unidade internacional", "UI"), (2, "Mililitro", "mL"), (3, "Miligrama", "mg")):
        q("TBUNIDADEMEDIDA", ID=i, NOME=nome, SIMBOLO=simb.lower(), SIGLA_API=simb, SITUACAO="A")
    q("PRMODOVENT", ID=1, NOME="Pressão controlada")
    q("PRMODOVENT", ID=2, NOME="Modo sem par")
    q("PRFA_CAD_MODO_RESPIR", ID=1, DESCRICAO="Pressão controlada", SIGLA="PCV", ATIVO="S")
    for i, nome in ((1, "QTDE_DOSE"), (2, "QTDE"), (3, "OUTRO_CAMPO")):
        q("TBTABELA_CAMPO", ID=i, NOME=nome)

    e = {}
    # glicemia: 1 e 2 na escala do controle 1; 3 faixa invertida (CHECK); 4 unidade sem par (pai_inexistente, 1048)
    t = "PRITENSGLICEMIA"
    q(t, ID=1, ID_PRPRESCPROCED=1, INTERVALO_INICIAL_DOSE=70, INTERVALO_FINAL_DOSE=150, QTDE_DOSE=D("0.000"),
      ID_TBUNICON_UNI_PRESC="UI", ID_GETABVIA="SC")
    q(t, ID=2, ID_PRPRESCPROCED=1, INTERVALO_INICIAL_DOSE=151, INTERVALO_FINAL_DOSE=250, QTDE_DOSE=D("2.000"),
      ID_PRITEMNAOPAD=1, JUSTIFICATIVA_NAO_PADRONIZ="Insulina sem padrão", ID_TBUNICON_UNI_PRESC="UI", ID_GETABVIA="SC")
    q(t, ID=3, ID_PRPRESCPROCED=2, INTERVALO_INICIAL_DOSE=100, INTERVALO_FINAL_DOSE=90, QTDE_DOSE=D("0.000"),
      ID_TBUNICON_UNI_PRESC="UI", ID_GETABVIA="SC")
    q(t, ID=4, ID_PRPRESCPROCED=2, INTERVALO_INICIAL_DOSE=80, INTERVALO_FINAL_DOSE=120, QTDE_DOSE=D("0.000"),
      ID_TBUNICON_UNI_PRESC="XX", ID_GETABVIA="SC")
    # 5 faixa PADRONIZADA com dose > 0 (insulina do insumo 5, item prescritível da L6-11): grava; 6 insumo sem item
    # prescritível (pai_inexistente) com dose: recusa pelo CHECK
    q(t, ID=5, ID_PRPRESCPROCED=1, INTERVALO_INICIAL_DOSE=251, INTERVALO_FINAL_DOSE=400, QTDE_DOSE=D("4.000"), ID_GEITENS=5,
      ID_TBUNICON_UNI_PRESC="UI", ID_GETABVIA="SC")
    q(t, ID=6, ID_PRPRESCPROCED=2, INTERVALO_INICIAL_DOSE=300, INTERVALO_FINAL_DOSE=400, QTDE_DOSE=D("3.000"), ID_GEITENS=6,
      ID_TBUNICON_UNI_PRESC="UI", ID_GETABVIA="SC")
    e[t] = {"gravados": 3, "pendencias": {"restricao_destino_4025": 2, "pai_inexistente": 2, "restricao_destino_1048": 1}}

    # solução: 3 volume total sem unidade (CHECK); 4 item nunca visto (pai_inexistente, 1048)
    t = "PRPRESCSOL"
    q(t, ID=1, ID_PRLANGERAL=1, VOLUME_TOTAL=D("500.000"), ID_TBUNICON_UNI_PRESC="mL", INICIAR_ADM_AGORA="S",
      NAO_AJUSTAR_ESQUEMA_ENF="N", PERMITIR_ENF_ALT_VEL_INFUSAO="S")
    q(t, ID=2, ID_PRLANGERAL=2, VOLUME_KG=D("10.000"))
    q(t, ID=3, ID_PRLANGERAL=3, VOLUME_TOTAL=D("250.000"))
    q(t, ID=4, ID_PRLANGERAL=9)
    e[t] = {"gravados": 2, "pendencias": {"restricao_destino_4025": 1, "pai_inexistente": 1, "restricao_destino_1048": 1}}

    # etapas: 2 item padronizado (item prescritível do insumo 5): grava; 3 solução recusada; 4 quantidade zero
    t = "PRITENSESQ"
    q(t, ID=1, ID_PRPRESCSOL=1, ID_PRITEMNAOPAD=1, JUSTIFICATIVA_NAO_PADRONIZ="Sem padrão", ITEM_PRINCIPAL=1, ETAPA=1,
      QTDE=D("10.000"), QTDE_DOSE=D("10.000"), ID_TBUNICON_UNI_PRESC="mL", DOSE_EXTRA_ANTIMICROBIANO="N")
    q(t, ID=2, ID_PRPRESCSOL=1, ID_GEITENS=5, ITEM_PRINCIPAL=0, ETAPA=1, QTDE_DOSE=D("1.000"),
      ID_TBUNICON_UNI_PRESC="mg", DOSE_EXTRA_ANTIMICROBIANO="N")
    q(t, ID=3, ID_PRPRESCSOL=4, ID_PRITEMNAOPAD=1, JUSTIFICATIVA_NAO_PADRONIZ="x", ITEM_PRINCIPAL=1, ETAPA=1,
      QTDE_DOSE=D("1.000"), ID_TBUNICON_UNI_PRESC="mL", DOSE_EXTRA_ANTIMICROBIANO="N")
    q(t, ID=4, ID_PRPRESCSOL=2, ID_PRITEMNAOPAD=1, JUSTIFICATIVA_NAO_PADRONIZ="Sem padrão", ITEM_PRINCIPAL=1, ETAPA=1,
      QTDE=D("0.000"), QTDE_DOSE=D("5.000"), ID_TBUNICON_UNI_PRESC="mL", DOSE_EXTRA_ANTIMICROBIANO="S")
    e[t] = {"gravados": 3, "pendencias": {"pai_pendente": 1, "valor_fora_do_dominio": 1}}

    # ventilação: invasiva 2 com modo sem par (CHECK do modo) e FiO2 fora da faixa; não invasiva 2 repete o item (1062)
    t = "PRPRESCVI"
    q(t, ID=1, ID_PRLANGERAL=1, ID_PRVIAAEREA=1, ID_PRMODOVENT=1, FREQUENCIA_RESPIRATORIA=14, PEEP=5,
      VOLUME_CORRENTE=D("450.00"), PRESSAO=20, FLUXO=40, TEMPO_INSPIRATORIO=D("1.0"), TEMPO_EXPIRATORIO=D("2.0"), FIO2=40)
    q(t, ID=2, ID_PRLANGERAL=2, ID_PRVIAAEREA=1, ID_PRMODOVENT=2, FIO2=15)
    e[t] = {"gravados": 1, "pendencias": {"pai_inexistente": 1, "valor_fora_do_dominio": 1, "restricao_destino_4025": 1}}
    t = "PRPRESCVNI"
    q(t, ID=1, ID_PRLANGERAL=3, ID_PRVIAAEREA=1, ID_PRMODOVENT=1, PRESSAO_INSPIRATORIA=12, PRESSAO_EXPIRATORIA=6, FIO2=30,
      TEMPO_TOTAL=datetime.datetime(1899, 12, 30, 2, 0))
    q(t, ID=2, ID_PRLANGERAL=1, ID_PRVIAAEREA=1, ID_PRMODOVENT=1, FIO2=21)
    e[t] = {"gravados": 1, "pendencias": {"restricao_destino_1062": 1}}

    # horário: 2 repete item e horário (1062); 3 situação sem par (1048); 4 aprazador sem profissional (pai_inexistente)
    t = "PRCHKGERAL"
    q(t, ID=1, ID_PRLANGERAL=1, DATA_HORA_CHECAR=T(2, 8), SITUACAO_CHECAGEM="A", DATA_HORA_SITUACAO_CHECAGEM=T(2, 8, 10),
      QTDE_ADMINISTRADA=D("1.000"), ID_TBCBOPRO_APZ=1, DATA_HORA_APZ=T(2, 7, 40), ETIQUETA_CHECAGEM_IMPRESSA="N",
      SINAIS_ALFA="98", ID_TBPROFIS_ACOMP_RESP_CHK=2, DATA_HORA_ACOMP_RESP_CHK=T(2, 8, 20), ID_TBCBOPRO_SITUACAO_CHECAGEM=1,
      DATA_HORA_GRAVACAO=T(2, 8, 11))
    q(t, ID=2, ID_PRLANGERAL=1, DATA_HORA_CHECAR=T(2, 8), SITUACAO_CHECAGEM="A", ETIQUETA_CHECAGEM_IMPRESSA="N")
    q(t, ID=3, ID_PRLANGERAL=2, DATA_HORA_CHECAR=T(2, 10), SITUACAO_CHECAGEM="Z", ETIQUETA_CHECAGEM_IMPRESSA="N")
    q(t, ID=4, ID_PRLANGERAL=3, DATA_HORA_CHECAR=T(2, 12), SITUACAO_CHECAGEM="P", ETIQUETA_CHECAGEM_IMPRESSA="N",
      JUSTIFICATIVA_LANC_RETROATIVO="Registro tardio", ID_TBCBOPRO_APZ=3, DATA_HORA_APZ=T(2, 11))
    # evento da situação atual: 1 checagem (administrado); 5 suspenso com suspensão retroativa (motivo e retroativo no
    # horário); 6 não administrado sem justificativa (motivo fixo verdadeiro); 4 prescrito: sem evento
    q(t, ID=5, ID_PRLANGERAL=2, DATA_HORA_CHECAR=T(2, 14), SITUACAO_CHECAGEM="S", DATA_HORA_SITUACAO_CHECAGEM=T(2, 15),
      ID_TBCBOPRO_SITUACAO_CHECAGEM=2, JUSTIFICATIVA_SUSP_RETROATIVA="Suspensão lançada depois", ETIQUETA_CHECAGEM_IMPRESSA="N")
    q(t, ID=6, ID_PRLANGERAL=3, DATA_HORA_CHECAR=T(2, 16), SITUACAO_CHECAGEM="N", DATA_HORA_SITUACAO_CHECAGEM=T(2, 16, 30),
      ID_TBCBOPRO_SITUACAO_CHECAGEM=1, ETIQUETA_CHECAGEM_IMPRESSA="N")
    e[t] = {"gravados": 4, "pendencias": {"restricao_destino_1062": 1, "pai_inexistente": 2, "restricao_destino_1048": 1,
                                          "valor_fora_do_dominio": 1}}

    # ligação documento assinado x horário, na trilha do horário: 1 grava (documento e horário); 2 documento sem cabeçalho
    # (correlação NULL, pai_inexistente); 3 evento sem momento (ocorrido_em NOT NULL, 1048); 4 horário nunca visto
    t = "PRASSINAT_DOC_PRCHKGERAL"
    q(t, ID=1, ID_PRASSINATURA_DOC=1, ID_PRCHKGERAL=1)
    q(t, ID=2, ID_PRASSINATURA_DOC=2, ID_PRCHKGERAL=4)
    q(t, ID=3, ID_PRASSINATURA_DOC=3, ID_PRCHKGERAL=1)
    q(t, ID=4, ID_PRASSINATURA_DOC=1, ID_PRCHKGERAL=7)
    e[t] = {"gravados": 3, "pendencias": {"pai_inexistente": 3, "restricao_destino_1048": 1}}

    # eventos do horário (evento pela situação; novo horário = reaprazamento): 2 reaprazamento com motivo; 3 sem motivo
    # (motivo fixo verdadeiro); 4 horário recusado; 5 não administrado sem motivo (motivo fixo); 6 prescrito = geração
    t = "PREXTRATOITEM_PRCHKGERAL"
    q(t, ID=1, ID_PRCHKGERAL=1, ID_PRSITUACAOCHECAGEM="A", ID_TBCBOPRO=1, DATA_HORA_HISTORICO=T(2, 8, 10),
      DATA_HORA_HISTORICO_UTC="2026-01-02T11:10:00Z")
    q(t, ID=2, ID_PRCHKGERAL=4, ID_PRSITUACAOCHECAGEM="S", ID_TBCBOPRO=2, DATA_HORA_APRAZADO=T(2, 13),
      JUSTIFICATIVA_REAPRAZAMENTO="Paciente em exame", DATA_HORA_HISTORICO=T(2, 11, 50))
    q(t, ID=3, ID_PRCHKGERAL=4, ID_PRSITUACAOCHECAGEM="A", ID_TBCBOPRO=1, DATA_HORA_APRAZADO=T(2, 14),
      DATA_HORA_HISTORICO=T(2, 12, 50))
    q(t, ID=4, ID_PRCHKGERAL=3, ID_PRSITUACAOCHECAGEM="A", ID_TBCBOPRO=1, DATA_HORA_HISTORICO=T(2, 10, 5))
    q(t, ID=5, ID_PRCHKGERAL=1, ID_PRSITUACAOCHECAGEM="N", ID_TBCBOPRO=1, DATA_HORA_HISTORICO=T(2, 8, 30))
    q(t, ID=6, ID_PRCHKGERAL=4, ID_PRSITUACAOCHECAGEM="P", ID_TBCBOPRO=2, DATA_HORA_HISTORICO=T(2, 7))
    e[t] = {"gravados": 5, "pendencias": {"pai_pendente": 1}}

    # campos autopreenchidos: marcam o item já gravado (uma marca por item: a conciliação do complemento relê a linha
    # inteira, e duas marcas no mesmo item divergem; pedido no L6-13.json); 2 campo sem par (2 destinos); 4 item
    # nunca visto
    t = "PRPRESC_AUTOPREENCHIDO"
    q(t, ID=1, ID_PRLANGERAL=1, ID_TBTABELA_CAMPO=1)
    q(t, ID=2, ID_PRLANGERAL=2, ID_TBTABELA_CAMPO=3)
    q(t, ID=3, ID_PRLANGERAL=3, ID_TBTABELA_CAMPO=2, SOLUCAO_ETAPA=1)
    q(t, ID=4, ID_PRLANGERAL=9, ID_TBTABELA_CAMPO=1)
    e[t] = {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 2, "pai_inexistente": 1}}

    t = "PRPRESC_PRPROTGERAL"
    q(t, ID_PRPRESC=1, ID_PROTGERAL=1)
    q(t, ID_PRPRESC=1, ID_PROTGERAL=5)
    e[t] = {"gravados": 1, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}}

    # receitas: 2 suspensa e derivada da 1; 3 suspensa sem motivo (CHECK); 4 tipo sem par (1048)
    t = "PRRECEITA"
    base = dict(ID_TBCBOPRO_LANCAMENTO=1, GRUPO_RECEITA=1, TP_RECEITA_PADRAO_PSICOTROPICO=1, PRE_IMPRESSO="N",
                DATA_HORA_GRAVACAO_UTC="2026-01-03T13:01:00Z")
    q(t, ID_RECEITA=1, ID_HTATENDIMENTO=1, ID_HTPACIENTE=1, DATA_HORA_LANCAMENTO=T(3, 10),
      DATA_HORA_GRAVACAO=T(3, 10, 1), RECEITA=b"Uso oral\r\nTomar  com  agua", **base)
    q(t, ID_RECEITA=2, ID_HTATENDIMENTO=2, ID_HTPACIENTE=2, DATA_HORA_LANCAMENTO=T(4, 10), DATA_HORA_GRAVACAO=T(4, 10),
      DATA_HORA_SUSPENSAO=T(5, 8), ID_TBCBOPRO_SUSPENSAO=2, JUSTIFICATIVA_SUSPENSAO="Troca de conduta",
      ID_PRRECEITA=1, **base)
    q(t, ID_RECEITA=3, ID_HTATENDIMENTO=1, ID_HTPACIENTE=1, DATA_HORA_LANCAMENTO=T(4, 11), DATA_HORA_GRAVACAO=T(4, 11),
      DATA_HORA_SUSPENSAO=T(5, 9), ID_TBCBOPRO_SUSPENSAO=1, **base)
    q(t, ID_RECEITA=4, ID_HTATENDIMENTO=1, ID_HTPACIENTE=1, DATA_HORA_LANCAMENTO=T(4, 12), DATA_HORA_GRAVACAO=T(4, 12),
      **dict(base, TP_RECEITA_PADRAO_PSICOTROPICO=7))
    e[t] = {"gravados": 2, "pendencias": {"restricao_destino_4025": 1, "pai_inexistente": 1, "restricao_destino_1048": 1}}

    t = "PRITEMRECEITA"
    q(t, ID=1, ID_RECEITA=1, NOME_MEDICAMENTO_SUBSTANCIA="Dipirona 500 mg", POSOLOGIA="1 comprimido de 6/6h",
      QUANTIDADE="20 comprimidos", USO_CONTINUO="N")
    q(t, ID=2, ID_RECEITA=2, NOME_MEDICAMENTO_SUBSTANCIA="Losartana", POSOLOGIA="1 ao dia", QUANTIDADE="30",
      USO_CONTINUO="S", INICIO_TRATAMENTO=datetime.date(2026, 1, 4))
    q(t, ID=3, ID_RECEITA=3, NOME_MEDICAMENTO_SUBSTANCIA="Item da receita recusada", POSOLOGIA="x", QUANTIDADE="1")
    q(t, ID=4, ID_RECEITA=1, POSOLOGIA="sem nome", QUANTIDADE="1")
    e[t] = {"gravados": 2, "pendencias": {"pai_pendente": 1, "restricao_destino_1048": 1}}

    t = "PRSENECESSARIO_PRPRESCMED"
    q(t, ID_PRSENECESSARIO=1, ID_PRPRESCMED=1)
    q(t, ID_PRSENECESSARIO=2, ID_PRPRESCMED=2)
    e[t] = {"gravados": 1, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}}
    t = "PRSENECESSARIO_PRPRESCPROCED"
    q(t, ID_PRSENECESSARIO=1, ID_PRPRESCPROCED=1)
    q(t, ID_PRSENECESSARIO=1, ID_PRPRESCPROCED=2)
    q(t, ID_PRSENECESSARIO=2, ID_PRPRESCPROCED=9)
    e[t] = {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}}

    # velocidade (ocorrido_em presumido = início: valor_presumido nas linhas avaliadas): 2 sem velocidade (1048);
    # 3 solução recusada; 4 volume zero
    t = "PRVELOCINFUSAO"
    q(t, ID_PRPRESCSOL=1, SEQ=1, ETAPA=1, VELOCIDADE=D("100.000"), ID_PRUNIDINFUSAO=1, ID_TBCBOPRO_LANCAMENTO=1,
      ARREDONDAR="N", DATA_HORA_INICIAL=T(2, 8), DATA_HORA_FINAL=T(2, 10), VOLUME=D("500.000"))
    q(t, ID_PRPRESCSOL=1, SEQ=2, ETAPA=1, ID_PRUNIDINFUSAO=1, ID_TBCBOPRO_LANCAMENTO=1, DATA_HORA_INICIAL=T(2, 10))
    q(t, ID_PRPRESCSOL=4, SEQ=1, ETAPA=1, VELOCIDADE=D("1.000"), ID_PRUNIDINFUSAO=1, ID_TBCBOPRO_LANCAMENTO=1,
      DATA_HORA_INICIAL=T(2, 8))
    q(t, ID_PRPRESCSOL=2, SEQ=1, ETAPA=1, VELOCIDADE=D("50.000"), ID_PRUNIDINFUSAO=1, ID_TBCBOPRO_LANCAMENTO=2,
      DATA_HORA_INICIAL=T(2, 9), VOLUME=D("0.000"))
    e[t] = {"gravados": 2, "pendencias": {"restricao_destino_1048": 1, "pai_pendente": 1, "valor_fora_do_dominio": 1,
                                          "valor_presumido": 3}}

    # exame lançado: 2 suspenso; 5 lançado antes da realização (CHECK)
    t = "PRLANCAMENTOEXAME"
    q(t, ID=1, NOME_EXAME="Hemograma  completo", NOME_METODO="Automatizado", DATA_HORA_REALIZACAO=T(2, 7),
      DATA_HORA_EVENTO=T(2, 7), ID_TBCBOPRO=1, DATA_HORA_GRAVACAO=T(2, 9), RESULTADO=b"Sem alteracoes\r\nfim",
      ID_RICADPAC=1)
    q(t, ID=2, NOME_EXAME="Glicemia", DATA_HORA_REALIZACAO=T(2, 7), DATA_HORA_EVENTO=T(2, 7), ID_TBCBOPRO=2,
      DATA_HORA_GRAVACAO=T(2, 9), ID_RICADPAC=2, DATA_HORA_SUSPENSAO=T(3, 8), ID_TBCBOPRO_SUSPENSAO=1,
      JUSTIFICATIVA_SUSPENSAO="Lançado em duplicidade")
    q(t, ID=5, NOME_EXAME="Ureia", DATA_HORA_REALIZACAO=T(3, 10), DATA_HORA_EVENTO=T(3, 10), ID_TBCBOPRO=1,
      DATA_HORA_GRAVACAO=T(3, 9), ID_RICADPAC=1)
    e[t] = {"gravados": 2, "pendencias": {"restricao_destino_4025": 1}}
    t = "PRLANCEXAMEESTRUTURADO"
    q(t, ID=1, ID_PRLANCAMENTOEXAME=1, ELEMENTO="Hemoglobina", RESULTADO="13,5", UNIDADE="g/dL", FAIXA_NORMALIDADE="12 a 16")
    q(t, ID=2, ID_PRLANCAMENTOEXAME=1, ELEMENTO="Leucócitos")
    q(t, ID=3, ID_PRLANCAMENTOEXAME=5, ELEMENTO="Ureia", RESULTADO="30")
    e[t] = {"gravados": 1, "pendencias": {"restricao_destino_4025": 1, "pai_pendente": 1}}

    # rodada 5 (ADR 0006): horário de situação do envio à plataforma na trilha do envio (retrato completo); o envio
    # (L8-17) não está na imagem: pai_inexistente, gravada com a chave original no retrato. 1 com horário; 2 sem
    # horário (a gravação, concorrente); 3 sem nenhum (NOT NULL)
    q("PRLANCREGISTROTEMPO", ID=1, ID_TBCBOPRO=1, ID_PRSITDOCUMENTO=1, ID_PRCABNEXODATA=1, DATA_HORA=T(2, 8))
    q("PRLANCREGISTROTEMPO", ID=2, ID_TBCBOPRO=2, ID_PRSITDOCUMENTO=1, ID_PRCABNEXODATA=1, DATA_HORA_GRAVACAO=T(2, 9),
      JUSTIFICATIVA_SUSPENSAO="Reenvio exemplo")
    q("PRLANCREGISTROTEMPO", ID=3, ID_TBCBOPRO=1, ID_PRSITDOCUMENTO=1, ID_PRCABNEXODATA=2)
    e["PRLANCREGISTROTEMPO"] = {"gravados": 2, "pendencias": {"pai_inexistente": 3, "restricao_destino_1048": 1}}

    # histórico da configuração do cabeçalho de impressão, na trilha da entidade: 2 tipo sem configuração vigente
    t = "HTPARAMORIGEMCABIMP"
    q(t, ID=1, DATA=T(1, 8), ID_PRTPASSINATURA=1, ORIGEM_DADOS="A", ID_TBUSERS="ADMIN")
    q(t, ID=2, DATA=T(1, 9), ID_PRTPASSINATURA=9, ORIGEM_DADOS="E")
    e[t] = {"gravados": 2, "pendencias": {"pai_inexistente": 1}}

    # alta: histórico por versão do atendimento; o estado vigente (data, motivo, saída do leito, quem deu a alta) vem
    # do cabeçalho. 1 grava (efetivada); 3 é outra versão do atendimento 1 (adotada, sem alta duplicada); 2 e 4 (a 4
    # é a exclusão) são do atendimento sem profissional da alta no cabeçalho: recusa (1048; o profissional do atendimento
    # como concorrente espera o pedido ao verificador); 5 alta sem motivo (CHECK)
    t = "HTATENDALTA"
    q(t, ID_HTATENDIMENTO=1, DATA_HORA_PREVISTA=T(5, 10), ID_TBMOTALT=1, DATA_HORA_ALTA_MEDICA=T(5, 11),
      DATA_HORA_SAIDA_LEITO=T(5, 13), OBSERVACAO=b"Alta  com\r\norientacoes", DIAGNOSTICO=b"Quadro resolvido",
      TIPO_ALTERACAO="I")
    q(t, ID_HTATENDIMENTO=3, DATA_HORA_PREVISTA=T(5, 10), ID_TBMOTALT=1, DATA_HORA_ALTA_MEDICA=T(5, 11),
      OBSERVACAO=b"Versao alterada", TIPO_ALTERACAO="A")
    q(t, ID_HTATENDIMENTO=2, DATA_HORA_PREVISTA=T(6, 10), TIPO_ALTERACAO="I")
    q(t, ID_HTATENDIMENTO=4, DATA_HORA_PREVISTA=T(6, 10), DATA_HORA_ALTA_MEDICA=T(6, 11), TIPO_ALTERACAO="E")
    q(t, ID_HTATENDIMENTO=5, DATA_HORA_PREVISTA=T(6, 11), TIPO_ALTERACAO="I")
    # rodada 5 (ADR 0007, 20): a alta adotada MESCLA; o conflito fica com o destino e guarda a origem no histórico
    e[t] = {"gravados": 2, "pendencias": {"adotado_existente": 1, "restricao_destino_1048": 2, "restricao_destino_4025": 1,
                                          "mescla_conflito_origem_guardada": 1}}

    # versão do formulário: 2 usuário sem par; 3 repete a versão (1062); componente da versão recusada
    t = "HTCABECFORMULCOMP"
    q(t, ID=1, ID_PREVOLUCAO=1, DATA_HORA_GRAVACAO=T(1, 9), ID_TBUSERS="ADMIN", VERSAO=1)
    q(t, ID=2, ID_PREVOLUCAO=1, DATA_HORA_GRAVACAO=T(2, 9), ID_TBUSERS="NINGUEM", VERSAO=2)
    q(t, ID=3, ID_PREVOLUCAO=1, DATA_HORA_GRAVACAO=T(3, 9), ID_TBUSERS="ADMIN", VERSAO=2)
    e[t] = {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1062": 1}}

    # histórico de checagem (evento pela situação): 1 checagem; 2 suspensão com quantidade negativa; 3 horário nunca
    # visto (1048); 4 prescrito = geração
    t = "HTCHKGERAL"
    q(t, ID=1, ID_PRCHKGERAL=1, DATA_HORA_HISTORICO=T(2, 8, 10), DATA_HORA_CHECAR=T(2, 8),
      ID_TBCBOPRO_SITUACAO_CHECAGEM=1, QTDE_ADMINISTRADA=D("1.000"), ID_PRSITUACAOCHECAGEM="A", DATA_HORA_GRAVACAO=T(2, 8, 10))
    q(t, ID=2, ID_PRCHKGERAL=4, DATA_HORA_HISTORICO=T(2, 12, 5), DATA_HORA_CHECAR=T(2, 12),
      ID_TBCBOPRO_SITUACAO_CHECAGEM=2, QTDE_ADMINISTRADA=D("-1.000"), JUSTIFICATIVA_LANC_RETROATIVO="Atraso",
      ID_PRSITUACAOCHECAGEM="S", DATA_HORA_GRAVACAO=T(2, 12, 5))
    q(t, ID=3, ID_PRCHKGERAL=7, DATA_HORA_HISTORICO=T(2, 9), DATA_HORA_CHECAR=T(2, 9), ID_TBCBOPRO_SITUACAO_CHECAGEM=1,
      ID_PRSITUACAOCHECAGEM="A", DATA_HORA_GRAVACAO=T(2, 9))
    q(t, ID=4, ID_PRCHKGERAL=1, DATA_HORA_HISTORICO=T(2, 7), DATA_HORA_CHECAR=T(2, 8), ID_TBCBOPRO_SITUACAO_CHECAGEM=2,
      ID_PRSITUACAOCHECAGEM="P", DATA_HORA_GRAVACAO=T(2, 7))
    e[t] = {"gravados": 3, "pendencias": {"valor_fora_do_dominio": 1, "pai_inexistente": 1, "restricao_destino_1048": 1}}

    t = "HTFORMULCOMP"
    q(t, ID=1, ID_HTCABECFORMULCOMP=1, ID_PRPADEVOL=1, NOME_CLASSE="CampoTexto", NOME_COMPONENTE_PAI="Painel",
      COMPONENTE=b"object Campo1: CampoTexto\r\n  Left = 8\r\nend", ORDEM_CRIACAO=1)
    q(t, ID=2, ID_HTCABECFORMULCOMP=3, ID_PRPADEVOL=1, NOME_CLASSE="CampoTexto", NOME_COMPONENTE_PAI="Painel")
    q(t, ID=3, ID_HTCABECFORMULCOMP=2, ID_PRPADEVOL=1, NOME_CLASSE="CampoData", NOME_COMPONENTE_PAI="Painel",
      ORDEM_CRIACAO=2)
    e[t] = {"gravados": 2, "pendencias": {"pai_pendente": 1}}
    return e
