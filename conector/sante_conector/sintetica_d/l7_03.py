"""Fatia L7-03 (SADT e suprimentos, módulo SADT): tabelas da origem com dados 100% falsos e as anomalias.

Carregadas (10): respostas padrão dos grupos, recipientes de coleta, situações da amostra (autorreferência em duas
fases), analitos (só o destino principal), exames (só o destino principal), modelos de comunicação, perfis do portal de
resultados com modalidades e usuários, e modelos de impressão de laudo. Bloqueadas (10, pedidos em
`docs/obra/fatias/f4/saida/L7-03.json`) entram na imagem para provar que não geram carga.
Anomalias: descrição vazia ou só espaços em destino NOT NULL, espaços repetidos, CP1252 acentuado, S/N e A/I fora do
domínio, referência zero (ausência), pai inexistente (nulo com pendência; em NOT NULL recusa), pai recusado
(pai_pendente; na autorreferência, na fase 2), código e sigla repetidos (chave única), CHECK do destino (casas
decimais, limites invertidos, imagens por linha), negativo em inteiro sem sinal e literais presumidos (valor_presumido
em toda linha avaliada, inclusive a recusada pela restrição do destino).
"""
import decimal

# (tabela, chave, colunas com o tipo da origem): mesmos nomes e tipos da fatia
TABELAS = [
    ('SIPOSRES', 'TAB,COD',
     'TAB SMALLINT, COD SMALLINT, NOME VARCHAR(40)'),
    ('SIRECIPI', 'COD',
     'COD SMALLINT, NOME VARCHAR(40), SITUACAO CHAR(1)'),
    ('SIRESPAD', 'EXAME,COD,TIPO,ATO',
     'EXAME VARCHAR(4), COD SMALLINT, TIPO VARCHAR(1), ATO SMALLINT, NOME VARCHAR(40), DESCR BLOB SUB_TYPE 1, NOMEXA VARCHAR(80), RESULTADO_HTML BLOB SUB_TYPE 1'),
    ('SISTATUS_AMOSTRA', 'ID',
     'ID INTEGER, ATO INTEGER, DESCRICAO VARCHAR(100), COR VARCHAR(20), ORDEM INTEGER, ATIVO VARCHAR(1), STATUS_ANTERIOR INTEGER, ID_SISTATUS_PEP INTEGER, REGISTRO_COLETA VARCHAR(1)'),
    ('SITABELE', 'CODPRC,CODELE',
     'CODPRC VARCHAR(4), CODELE SMALLINT, CODALFA VARCHAR(4), NOME VARCHAR(50), TITULO VARCHAR(1), UNIDADE VARCHAR(20), METODO SMALLINT, RES1 SMALLINT, VLRREF BLOB SUB_TYPE 1, REFINI NUMERIC(18,4), REFFIN NUMERIC(18,4), CASAS SMALLINT, REFIDADE CHAR(1), SITUACAO VARCHAR(1), MIN_ABE NUMERIC(18,4), MAX_ABE NUMERIC(18,4), NUMERICO CHAR(1), PULARELEMENTORESULT VARCHAR(1), RESULTADOFIXO VARCHAR(1), DIGOBRIRESULTFIXO VARCHAR(1), IMPBACTERIA VARCHAR(1), DESCELEEXAME VARCHAR(1), IMPRIMIR_ETIQUETA_TRIAGEM CHAR(1), ANTIBIOTICO CHAR(1), ID_DIGITAL_OBS_IDE_LOC_REL VARCHAR(36), ID_DIGITAL_OBS_IDE_LOC VARCHAR(36), ID_DIGITAL_OBS_IDE_REL VARCHAR(36), ID_DIGITAL_OBS_IDE VARCHAR(36), COD INTEGER'),
    ('SITABPRO', 'ATO,CODALF',
     'ID INTEGER, ATO SMALLINT, CODALF VARCHAR(4), NOME VARCHAR(80), CODAMB INTEGER, EQVAMB INTEGER, EQVAIH INTEGER, GRUPO SMALLINT, UNID VARCHAR(20), REFINI NUMERIC(18,4), REFFIN NUMERIC(18,4), TIPO VARCHAR(1), VARIAVEL VARCHAR(1), SEQ SMALLINT, ENTREGA SMALLINT, CASAS SMALLINT, COLETOR SMALLINT, METODO SMALLINT, ALFANUM VARCHAR(1), VLRREF BLOB SUB_TYPE 1, NCOMUM VARCHAR(80), PREPAR BLOB SUB_TYPE 1, INCID SMALLINT, MATERIAL SMALLINT, ULTRASON VARCHAR(1), RESSON VARCHAR(1), ENTHORS SMALLINT, REFIDADE CHAR(1), TPAIH CHAR(1), SITUACAO CHAR(1), TIPO_PROC VARCHAR(1), DUM VARCHAR(1), RECIPIENTE SMALLINT, IMP_ELE_MAPA CHAR(1), MIN_ABE NUMERIC(18,4), MAX_ABE NUMERIC(18,4), PROCESPECIAL VARCHAR(1), ID_TBPROSUSAIH INTEGER, ID_TBPROSUSAMB INTEGER, IMPCCIH VARCHAR(1), NOTIFICACAOCOMP VARCHAR(1), PERIODOVENC INTEGER, VLRREF2 BLOB SUB_TYPE 1, SEQPESQUISA INTEGER, INTEGRAR_VEPRO CHAR(1), IMPRIMIR_ETIQUETA_TRIAGEM CHAR(1), ID_SIPACSMODALID SMALLINT, TORNAR_INF_COMP_CLIN_OBRIG_PEP CHAR(1), EXAME_INTEGRADO_WEBSERVICE CHAR(1), ANTIBIOGRAMA CHAR(1), ID_TBSEXO INTEGER, ID_PRTIPONOTIFICACAO INTEGER, IDADEI DOUBLE PRECISION, IDADEF DOUBLE PRECISION, ID_PRTIPONOTIFICACAOIDADE INTEGER, ID_TBUNID_IDADE_MIN SMALLINT, ID_TBUNID_IDADE_MAX SMALLINT, ID_DIGITAL_OBS_IDE_LOC VARCHAR(36), ID_DIGITAL_OBS_IDE VARCHAR(36), SOMENTE_SOLICITACAO_PEP CHAR(1), EXIBIR_FICHA_ANEST CHAR(1), ORDEM_FICHA_ANEST SMALLINT'),
    ('SITBGRAN', 'COD,EXAME,ATO',
     'COD SMALLINT, EXAME VARCHAR(4), ATO SMALLINT, NOME VARCHAR(50), SIGLA CHAR(4)'),
    ('SITPEQV', 'CODIGO',
     'CODIGO SMALLINT, NOME VARCHAR(40), INTERFACE VARCHAR(1), COD_LABORATORIO INTEGER, NOME_LABORATORIO VARCHAR(45), CAMINHO_EXPORTACAO VARCHAR(150), CAMINHO_IMPORTACAO VARCHAR(60), SENHA_EXPORTACAO VARCHAR(32), ID_SITPEQV_SITPEQVMODELO SMALLINT, USUARIO_FTP VARCHAR(40), SENHA_FTP VARCHAR(100), IMPORTAR_EXAME_COMO_LIBERADO CHAR(1), CRIPTOGRAFIA_AES CHAR(1), HOST_ABBOTT VARCHAR(80), PORTA_ABBOTT INTEGER, BLOQUEARLAUDO CHAR(1)'),
    ('SITBEXHP', 'COD',
     'COD INTEGER, TIPO SMALLINT, COD_EXAME VARCHAR(20), EXAME_NOME VARCHAR(40), CODMATERIAL VARCHAR(8), MATERIALNOME VARCHAR(30), TEMPODIURESE VARCHAR(1), VOLUMEDIURESE VARCHAR(1), DESCMAT VARCHAR(1), NECESSITA_PESO CHAR(1), NECESSITA_ALTURA CHAR(1)'),
    ('SITPEQVMODELO', 'ID',
     'ID SMALLINT, NOME VARCHAR(10)'),
    ('SITPEQV_SITPEQVMODELO', 'ID',
     'ID SMALLINT, ID_SITPEQV SMALLINT, ID_SITPEQVMODELO SMALLINT'),
    ('SIVARFORMULA', 'CODIGO',
     'ATO INTEGER, CODIGO INTEGER, EXAME VARCHAR(4), IDENTIFICACAO VARCHAR(4), DESCRICAO VARCHAR(50)'),
    ('SIWEBCADPERFIL', 'ID',
     'ID SMALLINT, NOME VARCHAR(70)'),
    ('SIWEBCADPERFIL_SIPACSMODALID', 'ID_SIWEBCADPERFIL,ID_SIPACSMODALID',
     'ID_SIWEBCADPERFIL SMALLINT, ID_SIPACSMODALID SMALLINT'),
    ('SIWEBCADPERFIL_TBUSERS', 'ID_SIWEBCADPERFIL,USUARIO',
     'ID_SIWEBCADPERFIL SMALLINT, USUARIO VARCHAR(31)'),
    ('SIWEBPARDATA', 'ID',
     'ID SMALLINT, NOME VARCHAR(30)'),
    ('SIWEBPARLAUDO', 'ID',
     'ID INTEGER, ID_SIMODULO SMALLINT, ARQUIVO_LAUDO BLOB SUB_TYPE 0, NOME VARCHAR(70), EXIBIR_IMAGEM_LAUDO CHAR(1), QUANTIDADE_IMAGEM_POR_LINHA SMALLINT, ALTURA_ESPACAMENTO_LAUDO SMALLINT, LARGURA_ESPACAMENTO_LAUDO SMALLINT'),
    ('SIWEBPARPERFIL', 'ID_SIWEBCADPERFIL',
     'ID_SIWEBCADPERFIL SMALLINT, VISUALIZAR_IMG CHAR(1), DIGITAR_LAUDO CHAR(1), ENVIAR_IMG_EMAIL_RES_WEB CHAR(1), ENVIAR_LINK_IMG_EMAIL_RES_WEB CHAR(1)'),
    ('SIWEBPARTPATU', 'ID',
     'ID SMALLINT, NOME VARCHAR(30)'),
    ('SIWEBVISULIMG', 'ID',
     'ID SMALLINT, NOME VARCHAR(30)'),
]


def _ddl():
    out = []
    for i, (t, ch, cols) in enumerate(TABELAS, 1):
        chs = ch.split(",")
        cs = ", ".join('"%s" %s%s' % (c.split(" ", 1)[0], c.split(" ", 1)[1], " NOT NULL" if c.split(" ", 1)[0] in chs
                                      else "") for c in cols.split(", "))
        out.append('CREATE TABLE "%s" (%s, CONSTRAINT PK_L703_%02d PRIMARY KEY (%s));' % (
            t, cs, i, ", ".join('"%s"' % k for k in ch.split(","))))
    return "\n".join(out) + "\n"


DDL = _ddl()
COLUNAS = {t: [c.split(" ", 1)[0] for c in cols.split(", ")] for t, _, cols in TABELAS}
PAIS_EXTERNOS = {"SICTRPSR": ["1", "2"], "SIMETODO": ["1", "2"], "SIESPEC": ["1", "2"], "SIPACSMODALID": ["1", "2"],
                 "SIMODULO": ["1", "2"], "TBUSERS": ["usuario.exemplo1", "usuario.exemplo2"]}
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")
CARREGADAS = ("SIPOSRES", "SIRECIPI", "SISTATUS_AMOSTRA", "SITABELE", "SITABPRO", "SITPEQVMODELO", "SIWEBCADPERFIL",
              "SIWEBCADPERFIL_SIPACSMODALID", "SIWEBCADPERFIL_TBUSERS", "SIWEBPARLAUDO")
BLOQUEADAS = ("SIRESPAD", "SITBGRAN", "SITPEQV", "SITBEXHP", "SITPEQV_SITPEQVMODELO", "SIVARFORMULA", "SIWEBPARDATA",
              "SIWEBPARPERFIL", "SIWEBPARTPATU", "SIWEBVISULIMG")
D = decimal.Decimal


def linhas(r, ins):
    def linha(t, **v):
        ins(t, [v.get(c) for c in COLUNAS[t]])

    # respostas: sem nome (1048), grupo zero (ausência em NOT NULL: 1048), grupo inexistente (pendência + 1048)
    for tab, cod, nome in [(1, 1, "Positivo"), (1, 2, "  Negativo   fraco "), (1, 3, None), (2, 1, "Reagente"),
                           (9, 1, "Sem grupo"), (0, 5, "Grupo zero")]:
        linha("SIPOSRES", TAB=tab, COD=cod, NOME=nome)
    for cod, nome, sit in [(1, "Tubo  roxo", "A"), (2, "Frasco estéril", "I"), (3, "Tubo seco", "X"),
                           (4, None, "A"), (5, "Swab", None)]:
        linha("SIRECIPI", COD=cod, NOME=nome, SITUACAO=sit)
    # situações: 4 aponta 5 (vem depois: fase 2); 6 sem descrição (recusada); 7 aponta 6 (pai_pendente na fase 2)
    for i, desc, cor, ordem, ativo, ant, reg in [
            (1, "Aguardando coleta", "#FFFF00", 1, "S", None, "N"), (2, "Coletada", "verde", 2, "S", 1, "S"),
            (3, "Em análise", None, 3, "S", 2, "N"), (4, "Recoleta", None, None, "N", 5, "N"),
            (5, "Descartada", None, 5, "X", 3, "N"), (6, "   ", None, 6, "S", None, "S"),
            (7, "Cancelada", None, 7, "S", 6, "N")]:
        linha("SISTATUS_AMOSTRA", ID=i, ATO=1, DESCRICAO=desc, COR=cor, ORDEM=ordem, ATIVO=ativo,
              STATUS_ANTERIOR=ant, REGISTRO_COLETA=reg)
    # analitos (ordem da chave CODPRC,CODELE): 104 sem nome; 105 método inexistente; 106 NUMERICO fora do domínio;
    # 108 casas > 6 (CHECK); 109 limites invertidos (CHECK); ZZZ/1 repete o código 101 (único)
    for prc, ele, cod, nome, extra in [
            ("GLI", 1, 101, "Glicose", dict(METODO=1, CASAS=0, MIN_ABE=D("10.0000"), MAX_ABE=D("900.0000"),
                                            NUMERICO="S", SITUACAO="A", UNIDADE="mg/dL")),
            ("GLI", 2, 102, "  Hemoglobina   glicada ", dict(CASAS=1, NUMERICO="S", SITUACAO="A",
                                                            PULARELEMENTORESULT="S")),
            ("URI", 1, 103, "Aspecto", dict(NUMERICO="N", RESULTADOFIXO="S", SITUACAO="I",
                                            VLRREF="Límpido\r\n  ou levemente turvo".encode("cp1252"))),
            ("URI", 2, 104, None, dict(NUMERICO="N")),
            ("HMG", 1, 105, "Leucócitos", dict(METODO=7, NUMERICO="S", IMPRIMIR_ETIQUETA_TRIAGEM="S")),
            ("URI", 3, 106, "Cor", dict(NUMERICO="X", METODO=0)),
            ("URI", 4, 108, "Volume", dict(CASAS=9, NUMERICO="S")),
            ("HMG", 2, 109, "Faixa", dict(MIN_ABE=D("100.0000"), MAX_ABE=D("10.0000"), METODO=2)),
            ("ZZZ", 1, 101, "Glicose jejum", dict(NUMERICO="S")),
            # linha-título (sem par no de-para: pendência por linha); limites 0 = não informado (viram nulos: sem
            # CHECK nem limite que recuse todo resultado)
            ("URI", 5, 110, "Exame físico", dict(TITULO="S", NUMERICO="N")),
            ("HMG", 3, 111, "Plaquetas", dict(MIN_ABE=D("0.0000"), MAX_ABE=D("0.0000"), NUMERICO="S", TITULO="N")),
            ("HMG", 4, 112, "Hematócrito", dict(MIN_ABE=D("5.0000"), MAX_ABE=D("0.0000"), NUMERICO="S"))]:
        linha("SITABELE", CODPRC=prc, CODELE=ele, COD=cod, NOME=nome, **extra)
    # exames (ordem da chave ATO,CODALF): 2/GLI repete a sigla de 1/GLI (único); BHC sem nome; PSA sexo inexistente;
    # TSH S/N fora do domínio; US1 prazo negativo e modalidade zero; sexo não aproveitado (PSA aponta sexo inexistente
    # sem efeito); FER inativo (CHECK de desativação: recusado); VDR e Vdr só diferem pela caixa (os dois recusados)
    base = dict(ID_TBPROSUSAIH=0, ID_TBPROSUSAMB=0, SOMENTE_SOLICITACAO_PEP="N", EXIBIR_FICHA_ANEST="N",
                ORDEM_FICHA_ANEST=0)
    for i, ato, alf, nome, extra in [
            (1, 1, "GLI", "Glicose", dict(GRUPO=1, ID_TBSEXO=None, SITUACAO="A")),
            (2, 1, "HMG", "Hemograma  completo", dict(GRUPO=2, ENTHORS=24, DUM="S", IMPCCIH="S", MATERIAL=1,
                                                      PREPAR="Jejum de 4 horas.\r\nTrazer pedido.".encode("cp1252"))),
            (3, 2, "RX1", "Raio X tórax", dict(ID_SIPACSMODALID=1, NCOMUM="Radiografia do tórax")),
            (4, 2, "GLI", "Glicemia capilar", dict(GRUPO=1)),
            (5, 1, "BHC", None, dict()),
            (6, 1, "PSA", "PSA", dict(ID_TBSEXO=9, ANTIBIOGRAMA="N")),
            (7, 1, "TSH", "TSH", dict(EXIBIR_FICHA_ANEST="X", ORDEM_FICHA_ANEST=3)),
            (8, 2, "US1", "Ultrassom", dict(ID_SIPACSMODALID=0, ENTHORS=-5, ID_TBSEXO=2)),
            (9, 1, "FER", "Ferritina", dict(SITUACAO="I")),
            (10, 1, "VDR", "VDRL", dict(SITUACAO="A")),
            (11, 1, "Vdr", "VDRL quantitativo", dict())]:
        v = dict(base, **extra)
        linha("SITABPRO", ID=i, ATO=ato, CODALF=alf, NOME=nome, **v)
    for i, nome in [(1, "ASTM"), (2, "HL7"), (3, None), (4, "Arquivo")]:
        linha("SITPEQVMODELO", ID=i, NOME=nome)
    for i, nome in [(1, "Médicos  parceiros"), (2, "Clínica exemplo"), (3, "  ")]:
        linha("SIWEBCADPERFIL", ID=i, NOME=nome)
    for p, m in [(1, 1), (1, 2), (2, 1), (3, 1), (2, 7)]:
        linha("SIWEBCADPERFIL_SIPACSMODALID", ID_SIWEBCADPERFIL=p, ID_SIPACSMODALID=m)
    for p, u in [(1, "usuario.exemplo1"), (2, "usuario.exemplo2"), (1, "usuario.semcadastro")]:
        linha("SIWEBCADPERFIL_TBUSERS", ID_SIWEBCADPERFIL=p, USUARIO=u)
    for i, mod, nome, exibe, qtd, alt, larg in [
            (1, 1, "Laudo padrão", "S", 2, 10, 10), (2, 2, "Laudo  imagem ", "N", None, None, None),
            (3, 1, "Laudo sem quantidade", "S", 0, None, None), (4, 5, "Laudo setor inexistente", "N", None, 4, 4),
            (5, 1, None, "N", None, None, None)]:
        linha("SIWEBPARLAUDO", ID=i, ID_SIMODULO=mod, ARQUIVO_LAUDO=bytes(r.getrandbits(8) for _ in range(64)),
              NOME=nome, EXIBIR_IMAGEM_LAUDO=exibe, QUANTIDADE_IMAGEM_POR_LINHA=qtd, ALTURA_ESPACAMENTO_LAUDO=alt,
              LARGURA_ESPACAMENTO_LAUDO=larg)
    # bloqueadas: linhas que não podem gerar carga
    linha("SIRESPAD", EXAME="GLI", COD=1, TIPO="N", ATO=1, NOME="Normal", DESCR="Texto  padrão".encode("cp1252"))
    linha("SITBGRAN", COD=1, EXAME="ECO", ATO=2, NOME="Diâmetro", SIGLA="DIA")
    linha("SITPEQV", CODIGO=1, NOME="Analisador exemplo", INTERFACE="S", SENHA_EXPORTACAO="falsa", SENHA_FTP="falsa",
          ID_SITPEQV_SITPEQVMODELO=1, PORTA_ABBOTT=4000)
    linha("SITBEXHP", COD=1, TIPO=1, COD_EXAME="APX1", EXAME_NOME="Exame do apoio")
    linha("SITPEQV_SITPEQVMODELO", ID=1, ID_SITPEQV=1, ID_SITPEQVMODELO=1)
    linha("SIVARFORMULA", ATO=1, CODIGO=1, EXAME="GLI", IDENTIFICACAO="A", DESCRICAO="Variável exemplo")
    for i, nome in [(1, "Hoje"), (2, "Últimos 7 dias")]:
        linha("SIWEBPARDATA", ID=i, NOME=nome)
        linha("SIWEBPARTPATU", ID=i, NOME="Atualização %d" % i)
        linha("SIWEBVISULIMG", ID=i, NOME="Visualizador %d" % i)
    linha("SIWEBPARPERFIL", ID_SIWEBCADPERFIL=1, VISUALIZAR_IMG="S", DIGITAR_LAUDO="S", ENVIAR_IMG_EMAIL_RES_WEB="N",
          ENVIAR_LINK_IMG_EMAIL_RES_WEB="N")
    return {
        "SIPOSRES": {"gravados": 3, "pendencias": {"restricao_destino_1048": 3, "pai_inexistente": 1}},
        "SIRECIPI": {"gravados": 4, "pendencias": {"valor_presumido": 5, "valor_fora_do_dominio": 1,
                                                   "restricao_destino_1048": 1}},
        "SISTATUS_AMOSTRA": {"gravados": 6, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1,
                                                           "pai_pendente": 1}},
        "SITABELE": {"gravados": 8, "pendencias": {"restricao_destino_1048": 1, "restricao_destino_1062": 1,
                                                   "restricao_destino_4025": 2, "pai_inexistente": 1,
                                                   "valor_fora_do_dominio": 2}},
        "SITABPRO": {"gravados": 6, "pendencias": {"valor_presumido": 18, "restricao_destino_1062": 1,
                                                   "restricao_destino_1048": 1, "restricao_destino_4025": 1,
                                                   "codigo_colisao_caixa": 2, "valor_fora_do_dominio": 2}},
        "SITPEQVMODELO": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
        "SIWEBCADPERFIL": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "SIWEBCADPERFIL_SIPACSMODALID": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                                       "restricao_destino_1048": 1}},
        "SIWEBCADPERFIL_TBUSERS": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
        "SIWEBPARLAUDO": {"gravados": 3, "pendencias": {"restricao_destino_4025": 1, "pai_inexistente": 1,
                                                        "restricao_destino_1048": 1}},
    }
