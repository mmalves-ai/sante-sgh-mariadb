"""Fatia L8-03 (faturamento e restantes, módulo FAT): imagem SINTÉTICA, dados 100% falsos.

Rodada 3: 16 tabelas carregam pelo mapa (TBPROCTO vira o item faturável com um grupo de migração por tabela de
honorários; TBPORMED o valor do porte com o porte agrupado pelo código); TBIRREGCTRCTA, TBCONVPERCTAPAC e TBCTRTAT são
descarte (domínio fixo do produto); TBMATMED, TBPACTHM e TBPERTHM aguardam regra genérica ou arquivo de outra fatia
(pedidos em docs/obra/fatias/f4/saida/L8-03.json) e não entram na imagem. TBCOOPER e TBINDPRO passaram à L8-02.
O DDL sai do dicionário (`mapa/colunas.tsv`: todas as colunas, mesmos nomes e tipos; só a chave é NOT NULL). Pais de
fora da fatia lidos pelas referências encadeadas ou por chave alternativa (inscrição -> profissional, prestador pelo
código, diária pela operação) entram na imagem só com as colunas usadas e são PAIS_EXTERNOS (já carregados); a
cooperativa (TBCOOPER, carregada pela L8-02) entra como pai externo. TBCBOPRO não é pai externo: ela é lida e carregada
(recusada por falta das colunas do conselho) e a referência encadeada usa só a linha da origem.
Anomalias: nome vazio (1048), descrição em BLOB vazia, nula e longa demais (1048, 1406), S/N e A/I fora do domínio,
presumidos (valor_presumido), vigência sem fonte, pai inexistente (nullable e NOT NULL), pai ambíguo pela chave
alternativa, pai recusado (pai_pendente), CHECK do destino (profissional ou prestador: 4025), código repetido entre
tabelas da origem (1062), índice adotado pelo código (adotado_existente), competência com mês inválido e código TISS
zero (valor_fora_do_dominio).
"""
import csv
import datetime
from decimal import Decimal as D
from pathlib import Path

_MAPA = Path(__file__).resolve().parents[2] / "mapa"
FATIA = ["TBCOSPPROF", "TBCRECOO", "TBCREMED", "TBCREPRS", "TBCTRDTH", "TBCTRMEM", "TBCTRTHM", "TBDTHCDC", "TBINDICE",
         "FCPARAM", "TBIRREGULARID", "TBIRREGULARID_TBMODULO", "TBITEATE", "TBLOCCON", "TBPORMED", "TBPROCTO",
         "TBTIPPRO"]
PAIS_ORIGEM = ["TBCBOPRO", "TBPRESER", "TBTABDTH"]


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


DDL = "".join('CREATE TABLE %s (%s%s);\n' % (
    t, ", ".join('"%s" %s%s' % (c, _tipo(f, rg), " NOT NULL" if c in _CHAVE[t] else "") for c, f, rg in _COLS[t]),
    (", PRIMARY KEY (%s)" % ", ".join('"%s"' % c for c in _CHAVE[t])) if _CHAVE[t] else "")
    for t in FATIA + PAIS_ORIGEM)

PAIS_EXTERNOS = {
    "TBCENCUS": ["5"], "TBCONVEN": ["1", "2"], "TBCOOPER": ["1"], "TBMODULO": ["1", "2"],
    "TBPROFIS": ["1", "2"], "TBTABATO": ["1"]}
# TBPRESER (L8-04) e TBTABDTH (L8-05) são carregadas pelas fatias delas DEPOIS desta na ordem do mapa (dependência
# pedida no L8-03.json): na imagem entram como origem (lidas pela chave alternativa) e são carregadas na mesma
# execução, depois; por isso aqui a referência a elas fica pai_inexistente (ou pai_ambiguo) e a linha é recusada.

# o credenciamento e a competência são do único estabelecimento do cliente (@estabelecimento)
PREPARO_DESTINO = (
    "CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY);"
    " INSERT INTO estabelecimento (id) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM estabelecimento);"
    # r3 (correção): semente do catálogo do produto tipo_conta (sem urgencia, de propósito: codigo_inexistente_destino)
    " CREATE TABLE IF NOT EXISTS tipo_conta (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(30) NOT NULL,"
    " descricao VARCHAR(150) NOT NULL, natureza VARCHAR(20) NOT NULL, ativo BOOLEAN NOT NULL DEFAULT TRUE,"
    " criado_em DATETIME(3) NOT NULL, UNIQUE KEY uq_tipo_conta_codigo (codigo));"
    " INSERT IGNORE INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES"
    " ('internacao', 'Internação', 'internacao', UTC_TIMESTAMP(3)),"
    " ('ambulatorial', 'Ambulatorial', 'ambulatorial', UTC_TIMESTAMP(3));")


def _b(s):
    return None if s is None else s.encode("cp1252")


def linhas(r, ins):
    def q(t, **kw):
        fora = set(kw) - set(COLUNAS[t])
        assert not fora, (t, fora)
        ins(t, [kw.get(c) for c in COLUNAS[t]])

    # pais lidos da origem (só as colunas usadas): inscrição 3 aponta profissional não carregado; prestador 20 e
    # operação 200 repetem (pai_ambiguo pela chave alternativa)
    for i, prof in ((1, 1), (2, 2), (3, 9)):
        q("TBCBOPRO", ID=i, ID_TBPROFIS=prof)
    # r3 (correção): o par (ato, código) é a chave alternativa composta; (2, 20) repete (pai_ambiguo)
    for i, ato, cod in ((1, 1, 10), (2, 2, 20), (3, 3, 20), (4, 2, 20)):
        q("TBPRESER", ID=i, ATO=ato, COD=cod)
    # r3 (correção): o par (tabela, operação) é a chave alternativa composta; (1, 200) repete (pai_ambiguo)
    for i, tab, ope in ((1, 1, 100), (2, 1, 200), (3, 2, 200), (4, 1, 200)):
        q("TBTABDTH", ID=i, TAB=tab, OPE=ope)

    # função da equipe: nome só de espaços (1048); tipo presumido em toda linha lida
    for i, n in ((1, "Função exemplo um"), (2, "Função  exemplo   ação"), (3, "Anestesia exemplo"), (4, "   ")):
        q("TBCOSPPROF", ID=i, NOME=n)
    # membro da cooperativa: 1 completo; 2 inscrição com profissional não carregado; 3 cooperativa inexistente
    q("TBCRECOO", COO=1, ID_TBCBOPRO=1, CRM=111.0)
    q("TBCRECOO", COO=1, ID_TBCBOPRO=3, CRM=222.0)
    q("TBCRECOO", COO=9, ID_TBCBOPRO=2, CRM=333.0)
    # credenciamento do médico (só credenciamento_cobranca; o profissional x fonte vem de TBCBOPRO_TBCONVEN, L5-06):
    # 1 completo; 2 fonte inexistente (1048); 3 sem profissional (CHECK)
    q("TBCREMED", ID_TBCBOPRO=1, CRM=111, CON=1, CONTAS="A")
    q("TBCREMED", ID_TBCBOPRO=2, CRM=222, CON=9, CONTAS="I")
    q("TBCREMED", ID_TBCBOPRO=3, CRM=333, CON=2, CONTAS="U")
    # credenciamento do prestador: 1 e 3 prestador ainda não carregado (ordem), 2 prestador ambíguo e ato inexistente;
    # sem profissional nem prestador o CHECK do destino recusa (4025)
    q("TBCREPRS", ATO=1, PS=10, CON=1, CONTAS="A")
    q("TBCREPRS", ATO=2, PS=20, CON=1)
    q("TBCREPRS", ATO=1, PS=10, CON=2)
    # cabeçalhos de tabela de preço: o mesmo COD nas três origens (prefixo de domínio evita a colisão)
    q("TBCTRDTH", COD=1, NOME="Tabela exemplo diárias", IV="S", EQUIV_TISS=18, SITUACAO="A",
      OBSERVACAO=_b("Observação exemplo\r\n  segunda linha"))
    q("TBCTRDTH", COD=2, NOME="Tabela  exemplo   taxas", EQUIV_TISS=0, SITUACAO="I")
    q("TBCTRDTH", COD=3, SITUACAO="X")
    q("TBCTRMEM", COD=1, NOME="Tabela exemplo mat/med", REF_BRA="S", ALT_EST="N", REF_SIMP="N", GPC="S", SITUACAO="A",
      GRAVAR_REFERENCIA_ABC_FARMA="N")
    q("TBCTRMEM", COD=2, NOME="Tabela exemplo própria")
    q("TBCTRTHM", COD=1, NOME="Tabela exemplo honorários", VLR_CIR="S", COD_CONS=10101, IV="N", SITUACAO="A")
    q("TBCTRTHM", COD=2, NOME="Tabela exemplo inativa", SITUACAO="I")
    # diária x centro de custo: 1 diária recusada (pai_pendente); 2 par (tabela, operação) ambíguo; 3 par e centro de
    # custo inexistentes: todas recusadas
    q("TBDTHCDC", TAB=1, DTH=100, CDC=5)
    q("TBDTHCDC", TAB=1, DTH=200, CDC=5)
    q("TBDTHCDC", TAB=2, DTH=100, CDC=6)
    # índice: o tipo 0 é criado e depois adotado; o tipo 2 sem valor (1048 no valor, linha inteira recusada)
    d = datetime.date
    q("TBINDICE", CON=1, IND=0, DATA=d(2025, 1, 1), VALOR=D("0.50000"))
    q("TBINDICE", CON=1, IND=0, DATA=d(2026, 1, 1), VALOR=D("0.60000"))
    q("TBINDICE", CON=1, IND=1, DATA=d(2025, 1, 1), VALOR=D("1.25000"))
    q("TBINDICE", CON=1, IND=2, DATA=d(2025, 1, 1))
    # competência: mês válido; mês 13 (valor_fora_do_dominio e 1048)
    # r3 (correção): a numeração fiscal corrente vira uma sequência de negócio por contador com valor (4 aqui:
    # ULTNOTA_C e NUMEROLOTENFS vazios não geram linha); a linha recusada (mês 13) não grava sequência
    q("FCPARAM", MESPRO=11, ANOPRO=2026, FONE="0000", IMPRES="N", IMPDEPO="N", ULTNOTA_LOJA=0, ID_TBIRREGCTRCTA=1,
      ULTNOTA_H=150, NUMERONOTANFS="321", NUMEROLOTERPS=12.0)
    q("FCPARAM", MESPRO=13, ANOPRO=2026, FONE="0001", IMPRES="N", IMPDEPO="N", ULTNOTA_LOJA=0, ID_TBIRREGCTRCTA=1)
    # tipo de pendência: 3 nula e 6 vazia (1048), 4 longa demais (1406); 2 com quebra de linha preservada
    for i, n in ((1, "Pendência exemplo de diagnóstico"), (2, "Pendência exemplo\r\n  de assinatura"), (3, None),
                 (4, "Descrição exemplo longa " * 8), (5, "Guia exemplo não autorizada"), (6, "")):
        q("TBIRREGULARID", ID=i, NOME=_b(n))
    # módulos do tipo: 1 e 2 completos; 3 tipo recusado (pai_pendente); 5 módulo inexistente (1048)
    for ti, mo in ((1, 1), (2, 2), (3, 1), (5, 9)):
        q("TBIRREGULARID_TBMODULO", ID_TBIRREGULARID=ti, ID_TBMODULO=mo)
    # tipo de atendimento: o COD 1 repete na tabela 2 (1062); 2|3 sem nome (1048)
    for tab, cod, n in ((1, 1, "Consulta exemplo"), (1, 2, "Exame  exemplo"), (2, 1, "Consulta exemplo SUS"),
                        (2, 3, None)):
        q("TBITEATE", TAB=tab, COD=cod, NOME=n)
    # local: CDC 5 carregado, 7 inexistente (pai_inexistente, coluna anulável)
    for v in ((1, "Local exemplo internação", 10, 5, 11, "S", 1, "N", 2, "S"),
              (2, "Local  exemplo   ação", None, None, None, None, None, None, None, "N"),
              (3, None, None, None, None, None, None, None, None, "S"),
              (4, "Local exemplo fora", None, 7, None, "N", None, "S", None, "X"),
              (5, "Local exemplo sem ativo", None, None, None, None, None, None, None, None)):
        q("TBLOCCON", **dict(zip(("COD", "NOME", "CODMEM", "CDC", "CODMAT", "CPP", "REFUNI", "DESPAC", "REFGEAP",
                                   "ATIVO"), v)))
    # rodada 3: porte por fonte e data; o porte é agrupado pelo código (1A criado uma vez e usado de novo); 3C sem valor
    # (1048: o porte criado pela linha é desfeito); fonte 9 inexistente (CHECK de escopo, 4025); código vazio (1048)
    for conv, data, porte, valor in ((1, d(2025, 1, 1), "1A", D("100.00")), (1, d(2026, 1, 1), "1A", D("110.00")),
                                     (2, d(2025, 1, 1), "2B", D("200.00")), (1, d(2025, 1, 1), "3C", None),
                                     (9, d(2025, 1, 1), "4A", D("50.00")), (1, d(2025, 1, 1), "   ", D("10.00"))):
        q("TBPORMED", CONV=conv, DATA=data, PORTE=porte, VALOR=valor)
    # rodada 3: procedimento de cada tabela de honorários -> item faturável; um grupo de migração por tabela (1 e 2);
    # 4 sem nome (1048, o grupo 1 já existe e fica); 5 tabela 9 inexistente (grupo sem descrição: 1048)
    for i, tab, cod, n, mod in ((1, 1, 10101012, "Consulta exemplo em consultório", "A"),
                                (2, 1, 30602076, "Procedimento  exemplo   cirúrgico", "I"), (3, 2, 10101012, "Consulta exemplo", None),
                                (4, 1, 40301010, None, None), (5, 9, 10101039, "Procedimento exemplo sem tabela", None)):
        q("TBPROCTO", ID=i, ID_TBCTRTHM=tab, COD_PROCEDIMENTO=cod, NOME=n, TP_MODULO=mod)
    # r3 (correção): tipo de serviço por TIPO, criado pela primeira linha e adotado pelas outras do mesmo tipo
    for procto, tipo in ((10101012, 1), (30602076, 1), (10101012, 2)):
        q("TBTIPPRO", PROCTO=procto, TIPO=tipo)
    return {
        "TBTIPPRO": {"gravados": 3, "pendencias": {"valor_presumido": 3, "adotado_existente": 1}},
        "TBPORMED": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 2,
                                                   "restricao_destino_4025": 1}},
        "TBPROCTO": {"gravados": 3, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 2}},
        "TBCOSPPROF": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 4}},
        "TBCRECOO": {"gravados": 1, "pendencias": {"vigencia_sem_fonte": 3, "pai_inexistente": 2,
                                                   "restricao_destino_1048": 2}},
        # r3 (correção): U (urgencia) sem linha no catálogo semeado: codigo_inexistente_destino
        "TBCREMED": {"gravados": 1, "pendencias": {"vigencia_sem_fonte": 3, "pai_inexistente": 2,
                                                   "codigo_inexistente_destino": 1,
                                                   "restricao_destino_1048": 1, "restricao_destino_4025": 1}},
        # rodada 2: com as arestas pedidas (TBCREPRS -> TBPRESER/TBTABATO, TBDTHCDC -> TBCENCUS) os pais carregam antes;
        # pai recusado agora recusa a linha com pai_pendente antes das outras regras
        "TBCREPRS": {"gravados": 0, "pendencias": {"vigencia_sem_fonte": 1, "pai_ambiguo": 1, "pai_inexistente": 1,
                                                   "pai_pendente": 2, "restricao_destino_4025": 1}},
        "TBCTRDTH": {"gravados": 2, "pendencias": {"valor_presumido": 3, "valor_fora_do_dominio": 2,
                                                   "restricao_destino_1048": 1}},
        "TBCTRMEM": {"gravados": 2, "pendencias": {"valor_presumido": 4}},
        "TBCTRTHM": {"gravados": 2, "pendencias": {"valor_presumido": 4}},
        # r3 (correção): pela chave composta (TAB, DTH), (1, 200) é ambíguo e (2, 100) não existe (pai_inexistente,
        # com o centro de custo 6 também inexistente)
        "TBDTHCDC": {"gravados": 0, "pendencias": {"vigencia_sem_fonte": 2, "pai_ambiguo": 1, "pai_pendente": 1,
                                                   "pai_inexistente": 2, "restricao_destino_1048": 2}},
        "TBINDICE": {"gravados": 3, "pendencias": {"valor_presumido": 8, "adotado_existente": 1,
                                                   "restricao_destino_1048": 1}},
        "FCPARAM": {"gravados": 1, "pendencias": {"valor_presumido": 6, "valor_fora_do_dominio": 1,
                                                  "restricao_destino_1048": 1}},
        "TBIRREGULARID": {"gravados": 3, "pendencias": {"restricao_destino_1048": 2, "restricao_destino_1406": 1,
                                                        "valor_presumido": 12}},
        "TBIRREGULARID_TBMODULO": {"gravados": 2, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                                 "restricao_destino_1048": 1}},
        "TBITEATE": {"gravados": 2, "pendencias": {"valor_presumido": 4, "restricao_destino_1062": 1,
                                                   "restricao_destino_1048": 1}},
        "TBLOCCON": {"gravados": 4, "pendencias": {"restricao_destino_1048": 1, "valor_fora_do_dominio": 1,
                                                   "valor_presumido": 5, "pai_inexistente": 1}},
    }
