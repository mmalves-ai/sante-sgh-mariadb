"""Fatia L7-03 (SADT e suprimentos, módulo SADT): tabelas da origem com dados 100% falsos e as anomalias.

Carregadas (15): respostas padrão dos grupos, recipientes de coleta, situações da amostra (autorreferência em duas
fases), analitos (com o analito no exame pela chave alternativa CODALF e a unidade do cliente adotada pelo código),
exames (inativo com desativação na data da carga), resultados padrão (exame pela chave composta ATO,EXAME, depois do
exame pela aresta de ordem), grandezas do laudo, modelos de comunicação, perfis do portal de resultados com
modalidades, usuários e parâmetros (complementa o perfil), modelos de impressão de laudo e visualizadores de imagem
(endereço e ativo presumidos) e variáveis de fórmula (fórmula do exame pela chave alternativa composta ATO,EXAME
da SIFORMUL, pai externo: a SIFORMUL é da L7-02 e entra aqui só como forma, com as MESMAS linhas da imagem da L7-02).
A unidade do cliente é gravada antes do analito e ligada a ele; o resultado padrão sem HTML leva o texto antigo
(colunas concorrentes). Rodada 4 (DDL 10_SADT/09): interfaces de equipamento (inativas, sem alvo ou com o
laboratório de apoio gravado antes e adotado pelo código) e a configuração do apoio por exame (o exame próprio vem da
equivalência SITBEXEQ, da L8-16, que entra NESTA imagem com as mesmas linhas de lá e carrega pela declaração
de lá: prova positiva do apoio, do exame copiado e do exige peso; equivalência ambígua e ausente visíveis). Rodada 5 (ADR
0006): os antigos descartes carregam: SIWEBPARDATA e SIWEBPARTPATU como opções das listas do portal
(parametro_opcao) e SITPEQV_SITPEQVMODELO na trilha da interface (retrato; interface nunca vista: pai_inexistente).
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
    # equivalência exame próprio x interface (L8-16): só para provar SITBEXHP; as MESMAS linhas da imagem da L8-16
    ('SITBEXEQ', 'TIPO,ATO,CODALF,CODMATERIAL',
     'TIPO SMALLINT, ATO SMALLINT, CODALF VARCHAR(4), COD_EXAME VARCHAR(20), CODMATERIAL VARCHAR(8), ENVIAR_ELEMENTO_ARQ_EXP CHAR(1)'),
    ('SITPEQVMODELO', 'ID',
     'ID SMALLINT, NOME VARCHAR(10)'),
    ('SITPEQV_SITPEQVMODELO', 'ID',
     'ID SMALLINT, ID_SITPEQV SMALLINT, ID_SITPEQVMODELO SMALLINT'),
    ('SIFORMUL', 'ATO,CODELE,EXAME',
     'ATO INTEGER, CODELE INTEGER, EXAME VARCHAR(4), FORMULA BLOB SUB_TYPE 1'),
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
CARREGADAS = ("SIPOSRES", "SIRECIPI", "SISTATUS_AMOSTRA", "SITABELE", "SITABPRO", "SIRESPAD", "SITBGRAN",
              "SITPEQVMODELO", "SIWEBCADPERFIL", "SIWEBCADPERFIL_SIPACSMODALID", "SIWEBCADPERFIL_TBUSERS",
              "SIWEBPARLAUDO", "SIWEBPARPERFIL", "SIWEBVISULIMG", "SIVARFORMULA", "SITPEQV", "SITBEXHP", "SIFORMUL",
              "SITPEQV_SITPEQVMODELO", "SIWEBPARDATA", "SIWEBPARTPATU")
DESCARTADAS = ()
# pai de outra fatia (L8-16) carregado AQUI pela declaração de lá, só para a prova positiva de SITBEXHP (o exame
# próprio copiado da equivalência): conferido só pela conciliação, sem esperado próprio
PAIS_NA_IMAGEM = ("SITBEXEQ",)
FORMA_SO = ()  # r4: SIFORMUL passou da L7-02 para cá e carrega (fórmula do analito no exame)
BLOQUEADAS = DESCARTADAS
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
    # analitos (ordem da chave CODPRC,CODELE), com o analito no exame (exame pela chave alternativa CODALF) e a unidade:
    # URI/4 sem nome (1048); HMG/1 método inexistente e URI/3 grupo de respostas inexistente (nulos com pendência);
    # URI/5 NUMERICO fora do domínio; URI/6 casas > 6 e HMG/2 limites invertidos (CHECK); ZZZ/1 repete o código 101
    # (único) e não tem exame; GLI/1: mnemônico em dois atos (pai_ambiguo, recusa pelo NOT NULL); URI/2 adota a
    # unidade criada por URI/1; URI/7 linha-título (titulo, não obrigatória); limites 0 = não informado (nulos)
    for prc, ele, cod, nome, extra in [
            ("GLI", 1, 113, "Glicose capilar", dict(NUMERICO="S")),
            ("HMG", 1, 105, "Leucócitos", dict(METODO=7, NUMERICO="S", IMPRIMIR_ETIQUETA_TRIAGEM="S")),
            ("HMG", 2, 109, "Faixa", dict(MIN_ABE=D("100.0000"), MAX_ABE=D("10.0000"), METODO=2)),
            ("HMG", 3, 111, "Plaquetas", dict(MIN_ABE=D("0.0000"), MAX_ABE=D("0.0000"), NUMERICO="S", TITULO="N")),
            ("HMG", 4, 112, "Hematócrito", dict(MIN_ABE=D("5.0000"), MAX_ABE=D("0.0000"), NUMERICO="S")),
            ("URI", 1, 101, "Glicose", dict(METODO=1, CASAS=0, MIN_ABE=D("10.0000"), MAX_ABE=D("900.0000"),
                                            NUMERICO="S", SITUACAO="A", UNIDADE="mg/dL", RES1=1)),
            ("URI", 2, 102, "  Hemoglobina   glicada ", dict(CASAS=1, NUMERICO="S", SITUACAO="A",
                                                            PULARELEMENTORESULT="S", UNIDADE="mg/dL")),
            ("URI", 3, 103, "Aspecto", dict(NUMERICO="N", RESULTADOFIXO="S", SITUACAO="I", RES1=9,
                                            VLRREF="Límpido\r\n  ou levemente turvo".encode("cp1252"))),
            ("URI", 4, 104, None, dict(NUMERICO="N")),
            ("URI", 5, 106, "Cor", dict(NUMERICO="X", METODO=0)),
            ("URI", 6, 108, "Volume", dict(CASAS=9, NUMERICO="S")),
            ("URI", 7, 110, "Exame físico", dict(TITULO="S", NUMERICO="N")),
            ("ZZZ", 1, 101, "Glicose jejum", dict(NUMERICO="S"))]:
        linha("SITABELE", CODPRC=prc, CODELE=ele, COD=cod, NOME=nome, **extra)
    # exames (ordem da chave ATO,CODALF): 2/GLI repete a sigla de 1/GLI (único); BHC sem nome; PSA sexo inexistente;
    # TSH S/N fora do domínio; US1 prazo negativo e modalidade zero; sexo não aproveitado (PSA aponta sexo inexistente
    # sem efeito); FER inativo (entra inativo, desativado na data da carga); VDR e Vdr só diferem pela caixa (os dois
    # recusados); URI é o exame dos analitos
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
            (11, 1, "Vdr", "VDRL quantitativo", dict()),
            (12, 1, "URI", "Urina tipo 1", dict(SITUACAO="A")),
            # exames das equivalências da L8-16 (HB e GL no ato 1): o exame próprio de SITBEXHP
            (13, 1, "HB", "Hemoglobina", dict(SITUACAO="A")),
            (14, 1, "GL", "Glicose sérica", dict(SITUACAO="A"))]:
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
    # grandezas (exame pela chave composta ATO,EXAME): 2|GLI é exame recusado (pai_pendente); ZZZ não existe
    # (pai_inexistente e NOT NULL); sem nome (NOT NULL); nome com espaços repetidos e sigla com preenchimento
    for cod, exa, ato, nome, sigla in [(1, "GLI", 1, "Diâmetro", "DIA"), (2, "GLI", 1, "  Fração   de ejeção ", "FE  "),
                                       (1, "RX1", 2, "Área", "AR"), (1, "GLI", 2, "Sem exame", "X"),
                                       (1, "ZZZ", 1, "Inexistente", None), (3, "GLI", 1, None, "S")]:
        linha("SITBGRAN", COD=cod, EXAME=exa, ATO=ato, NOME=nome, SIGLA=sigla)
    # resultados padrão (ordem da chave EXAME,COD,TIPO,ATO; exame pela chave composta ATO,EXAME): HMG sem nome (1048);
    # 2|GLI é exame recusado (pai_pendente); ZZZ não existe (pai_inexistente e 1048); RX1 só com o texto antigo (HTML
    # nulo); a variante (#seq:EXAME) conta todas as linhas do mesmo EXAME
    for exa, cod, tipo, ato, nome, html, descr in [
            ("GLI", 1, "N", 1, "Normal", "<p>Dentro da  normalidade</p>", "Normal"),
            ("GLI", 1, "N", 2, "Capilar", "<p>Capilar</p>", None),
            ("GLI", 2, "A", 1, "Alterado", "<p>Alterado:\r\n ver</p>", None),
            ("HMG", 1, "N", 1, None, "<p>Sem nome</p>", None),
            ("RX1", 1, "N", 2, "Tórax normal", None, "Texto  antigo"),
            ("ZZZ", 1, "N", 1, "Inexistente", "<p>x</p>", None)]:
        linha("SIRESPAD", EXAME=exa, COD=cod, TIPO=tipo, ATO=ato, NOME=nome,
              RESULTADO_HTML=None if html is None else html.encode("cp1252"),
              DESCR=None if descr is None else descr.encode("cp1252"), NOMEXA="Exame %s" % exa)
    # parâmetros do perfil (complementa): 1 e 2 completam o perfil; 3 é perfil recusado (pai_pendente); 9 não existe
    for p, vis, dig, img, lnk in [(1, "S", "S", "N", "N"), (2, "N", "S", "S", "S"), (3, "S", "N", "N", "N"),
                                  (9, "S", "S", "S", "S")]:
        linha("SIWEBPARPERFIL", ID_SIWEBCADPERFIL=p, VISUALIZAR_IMG=vis, DIGITAR_LAUDO=dig, ENVIAR_IMG_EMAIL_RES_WEB=img,
              ENVIAR_LINK_IMG_EMAIL_RES_WEB=lnk)
    # visualizadores: endereço e ativo presumidos (2 valor_presumido por linha avaliada); sem nome (NOT NULL)
    for i, nome in [(1, "Visualizador web"), (2, "  Estação   local "), (3, None)]:
        linha("SIWEBVISULIMG", ID=i, NOME=nome)
    # interfaces: 1 completa com o apoio 7 (criado antes, inativo presumido; senhas aguardam o cofre); 2 sem apoio
    # (opcional: interface inativa sem alvo); 3 mesmo apoio 7 (adotado pelo código); 4 sem nome (1048); 5 porta fora
    # da faixa e S/N fora do domínio
    linha("SITPEQV", CODIGO=1, NOME="Analisador exemplo", INTERFACE="S", SENHA_EXPORTACAO="falsa", SENHA_FTP="falsa",
          ID_SITPEQV_SITPEQVMODELO=1, PORTA_ABBOTT=4000, COD_LABORATORIO=7, NOME_LABORATORIO="Apoio exemplo",
          USUARIO_FTP="usuario.falso", CRIPTOGRAFIA_AES="S")
    linha("SITPEQV", CODIGO=2, NOME="  Interface   local ", ID_SITPEQV_SITPEQVMODELO=4, IMPORTAR_EXAME_COMO_LIBERADO="N")
    linha("SITPEQV", CODIGO=3, NOME="Analisador dois", ID_SITPEQV_SITPEQVMODELO=5, COD_LABORATORIO=7, NOME_LABORATORIO="Apoio exemplo")
    linha("SITPEQV", CODIGO=4, NOME="   ", ID_SITPEQV_SITPEQVMODELO=1, COD_LABORATORIO=8, NOME_LABORATORIO="Apoio sem interface")
    linha("SITPEQV", CODIGO=5, NOME="Porta errada", ID_SITPEQV_SITPEQVMODELO=6, PORTA_ABBOTT=70000, CRIPTOGRAFIA_AES="X")
    # r5 (achado): cada interface escolhe uma ligação SUA (o modelo escolhido pertence ao conjunto das ligações dela;
    # a 1 tem duas: a escolhida e uma alternativa); a 3 aponta interface nunca vista (pai_inexistente)
    for i, eqv, mod in [(1, 1, 1), (2, 1, 2), (3, 9, 1), (4, 2, 2), (5, 3, 1), (6, 5, 2)]:
        linha("SITPEQV_SITPEQVMODELO", ID=i, ID_SITPEQV=eqv, ID_SITPEQVMODELO=mod)
    # equivalências (as mesmas linhas da imagem da L8-16; aqui carregam pela declaração de lá)
    for x in [[1, 1, "HB", "HGB", "SG", "S"], [1, 1, "GL", "GLU", "SR", "N"], [1, 1, "HB", None, "PL", "N"],
              [2, 1, "GL", "GLU2", "SR", "S"], [1, 2, "XX", "ZZZ", "SG", None], [1, 1, "HB", "GLU", "SR", "N"]]:
        linha("SITBEXEQ", **dict(zip(COLUNAS["SITBEXEQ"], x)))
    # configuração do apoio por exame: 1 grava (apoio 7 da interface 1; exame HB pela equivalência 1/HGB; exige peso);
    # 2 interface sem apoio e exame sem equivalência (pai_inexistente nas duas, 1048); 3 código 1/GLU em duas
    # equivalências (pai_ambiguo, 1048)
    linha("SITBEXHP", COD=1, TIPO=1, COD_EXAME="HGB", EXAME_NOME="Exame do apoio", NECESSITA_PESO="S")
    linha("SITBEXHP", COD=2, TIPO=2, COD_EXAME="APX2", EXAME_NOME="Exame sem apoio")
    linha("SITBEXHP", COD=3, TIPO=1, COD_EXAME="GLU", EXAME_NOME="Exame ambíguo")
    # fórmulas (r4): URI/1 e HMG/4 gravam (analito no exame gravado pela SITABELE); URI/9 sem analito no exame
    # (pai_inexistente) e sem expressão: recusada
    for x in [(1, 1, "URI", "(A+B)/2"), (1, 4, "HMG", "A*2"), (2, 9, "URI", None)]:
        linha("SIFORMUL", ATO=x[0], CODELE=x[1], EXAME=x[2], FORMULA=None if x[3] is None else x[3].encode("cp1252"))
    # variáveis: 1 e 4 completas; 2 sem descrição (o identificador vira a descrição); 3 sem identificador (1048);
    # 5 exame sem fórmula no ato 2 (pai_inexistente e 1048); fonte 'digitado' presumida em toda linha avaliada
    for cod, ato, exa, ide, desc in [(1, 1, "URI", "A", "Glicemia  basal"), (2, 1, "URI", "B", None),
                                     (3, 1, "URI", None, "Sem identificador"), (4, 1, "HMG", "CR", "Creatinina"),
                                     (5, 2, "GLI", "Z", "Outro ato")]:
        linha("SIVARFORMULA", ATO=ato, CODIGO=cod, EXAME=exa, IDENTIFICACAO=ide, DESCRICAO=desc)
    for i, nome in [(1, "Hoje"), (2, "Últimos 7 dias")]:
        linha("SIWEBPARDATA", ID=i, NOME=nome)
        linha("SIWEBPARTPATU", ID=i, NOME="Atualização %d" % i)
    return {
        "SIPOSRES": {"gravados": 3, "pendencias": {"restricao_destino_1048": 3, "pai_inexistente": 1}},
        "SIRECIPI": {"gravados": 4, "pendencias": {"valor_presumido": 5, "valor_fora_do_dominio": 1,
                                                   "restricao_destino_1048": 1}},
        "SISTATUS_AMOSTRA": {"gravados": 6, "pendencias": {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1,
                                                           "pai_pendente": 1}},
        "SITABELE": {"gravados": 8, "pendencias": {"restricao_destino_1048": 2, "restricao_destino_1062": 1,
                                                   "restricao_destino_4025": 2, "pai_inexistente": 3,
                                                   "pai_ambiguo": 1, "valor_fora_do_dominio": 1,
                                                   "adotado_existente": 1}},
        "SITABPRO": {"gravados": 10, "pendencias": {"valor_presumido": 24, "restricao_destino_1062": 1,
                                                   "restricao_destino_1048": 1, "codigo_colisao_caixa": 2,
                                                   "valor_fora_do_dominio": 2}},
        "SIRESPAD": {"gravados": 3, "pendencias": {"vigencia_sem_fonte": 5, "restricao_destino_1048": 2,
                                                   "pai_pendente": 1, "pai_inexistente": 1}},
        "SITPEQVMODELO": {"gravados": 3, "pendencias": {"valor_presumido": 4, "restricao_destino_1048": 1}},
        "SIWEBCADPERFIL": {"gravados": 2, "pendencias": {"valor_presumido": 3, "restricao_destino_1048": 1}},
        "SIWEBCADPERFIL_SIPACSMODALID": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                                       "restricao_destino_1048": 1}},
        "SIWEBCADPERFIL_TBUSERS": {"gravados": 2, "pendencias": {"pai_inexistente": 1, "restricao_destino_1048": 1}},
        # r5 (ADR 0006): opções das listas do portal; ligação interface x modelo na trilha (interface 9 nunca
        # vista: pai_inexistente, a linha grava sem a interface)
        # módulo 'migracao' e definição criados pela 1ª linha e adotados pelas seguintes (padrão L8-14)
        "SIWEBPARDATA": {"gravados": 2, "pendencias": {"adotado_existente": 2}},
        "SIWEBPARTPATU": {"gravados": 2, "pendencias": {"adotado_existente": 3}},
        "SITPEQV_SITPEQVMODELO": {"gravados": 6, "pendencias": {"pai_inexistente": 1, "vigencia_sem_fonte": 6}},
        "SIWEBPARLAUDO": {"gravados": 3, "pendencias": {"restricao_destino_4025": 1, "pai_inexistente": 1,
                                                        "restricao_destino_1048": 1}},
        "SITBGRAN": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                   "restricao_destino_1048": 2}},
        "SIWEBPARPERFIL": {"gravados": 2, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1}},
        "SIWEBVISULIMG": {"gravados": 2, "pendencias": {"valor_presumido": 6, "restricao_destino_1048": 1}},
        # interface: protocolo e ativo presumidos em cada linha e o ativo do apoio (3 por linha); apoio 7 adotado
        # pela interface 3; 4 sem nome (1048, o apoio 8 desfeito com ela); 5 porta e S/N fora do domínio
        "SITPEQV": {"gravados": 4, "pendencias": {"valor_presumido": 15, "segredo_aguarda_cofre": 2,
                                                  "adotado_existente": 1, "valor_fora_do_dominio": 2,
                                                  "restricao_destino_1048": 1}},
        # 1 grava (apoio e exame pela equivalência); 2 sem apoio e sem equivalência; 3 equivalência ambígua
        "SITBEXHP": {"gravados": 1, "pendencias": {"pai_inexistente": 2, "pai_ambiguo": 1,
                                                   "restricao_destino_1048": 2}},
        "SIFORMUL": {"gravados": 2, "pendencias": {"pai_inexistente": 2, "restricao_destino_1048": 1,
                                                   "vigencia_sem_fonte": 3}},
        "SIVARFORMULA": {"gravados": 3, "pendencias": {"valor_presumido": 5, "restricao_destino_1048": 2,
                                                       "pai_inexistente": 1}},
    }
