"""Fatia L6-17 (prontuário, assinatura e assistência, módulo HOT): tabelas da origem e anomalias.

Dados 100% falsos (nomes e códigos inventados). Carregadas (CARREGADAS) e anomalias cobertas:
- CHCRITICIDADE: nome com espaços repetidos; classe sanitária presumida 'critica' (valor_presumido por linha);
- CHAREA: sigla nula e nome nulo (NOT NULL: restricao_destino_1048), criticidade inexistente (pai_inexistente e
  recusa pela NOT NULL), nome que só fica igual a outro depois de colapsar os espaços (uq nome: 1062), S/N inválido
  (valor_fora_do_dominio; ativo fica no padrão TRUE), ativo nulo (padrão TRUE);
- CHOCORRENCIA: nome nulo (1048), modalidade presumida;
- CHSITUACAO: autorreferência à etapa anterior (duas fases), anterior inexistente (pai_inexistente, coluna nula),
  anterior 0 (sem valor), ordem nula (1048), etapa presumida;
- CVTERMINALFAB / CVTPIDENTIFIC: nome nulo e nome só de espaços (1048);
- CVTPSITACESSO: permite_entrada presumida FALSE (lado restritivo: 'Bloqueado' e 'Restrito' nunca liberados);
- CVTPTERMINAL: fabricante recusado (pai_pendente), fabricante inexistente (pai_inexistente + 1048), tipo presumido;
- CVTPVISITADO / CVTPVISITANTE / GDPRONTCADOPER: alvo, categoria, tipo e sentido presumidos;
- PRCARACTDIE: descrição nula (1048), descrição com espaços nas pontas, categoria e tipo de resposta presumidos;
  unidade pela sigla da unidade de resposta (L6-08, REQUER) casada com o código de TBUNICON (pai externo 'mg'):
  'mg' casa e grava unidade_medida_id; 'ml' sem par fica NULL com pai_inexistente (linha gravada).
(valor_presumido conta uma por coluna presumida em cada linha lida, inclusive a recusada pela restrição do destino;
não conta a linha recusada antes por pai_pendente.)
Cobertura total (rodada de 2026-11-21):
- CHTPLIMPEZA: tempo previsto em TIMESTAMP 1899-12-30 HH:MM vira minutos (minutos_em_timestamp); 00:00 vira NULL e
  recusa (1048); outra data grava os minutos com hora_com_data; nome nulo (1048); tipo presumido 'concorrente';
- CHPROFISLIMP: vínculo presumido 'proprio' sem ponta (funcionário e terceirizada fora do mapa): o CHECK de vínculo
  recusa toda linha (restricao_destino_4025) até a proposta de modelo do L6-17.json; CPF inválido
  (documento_invalido), login desconhecido (pai_inexistente);
- CHAREA_CHPROFISLIMP e CHPROFLIMPTEL: filhas do profissional recusado (pai_pendente); vigência pela data da carga e
  sequência por profissional declaradas.
"""
import datetime

DDL = """
CREATE TABLE CHCRITICIDADE (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE CHAREA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50), ID_CHCRITICIDADE SMALLINT NOT NULL,
  SIGLA VARCHAR(5), ATIVO CHAR(1));
CREATE TABLE CHOCORRENCIA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50));
CREATE TABLE CHPROFISLIMP (ID SMALLINT NOT NULL PRIMARY KEY, USUARIO_SISTEMA VARCHAR(31), ID_CHTERCEIRO SMALLINT,
  ID_FPFUNC_COD_EMP SMALLINT, ID_FPFUNC_COD_FUNC INTEGER, ATIVO CHAR(1), NOME_PROFISSIONAL VARCHAR(70),
  CPF_PROFISSIONAL VARCHAR(11));
CREATE TABLE CHAREA_CHPROFISLIMP (ID_CHAREA SMALLINT NOT NULL, ID_CHPROFISLIMP SMALLINT NOT NULL,
  PRIMARY KEY (ID_CHAREA, ID_CHPROFISLIMP));
CREATE TABLE CHPROFLIMPTEL (ID_CHPROFISLIMP SMALLINT NOT NULL, ID_TBTIPOTELEFONE SMALLINT NOT NULL, ID_TBDDD SMALLINT,
  NUM_TELEFONE INTEGER, PRIMARY KEY (ID_CHPROFISLIMP, ID_TBTIPOTELEFONE));
CREATE TABLE CHSITUACAO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(60), ID_CHSITUACAO_ANTERIOR SMALLINT,
  ATIVO CHAR(1), COR VARCHAR(20) NOT NULL, ORDEM SMALLINT);
CREATE TABLE CHTPLIMPEZA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50), TEMPO_PREVISTO TIMESTAMP, ATIVO CHAR(1));
CREATE TABLE CVTERMINALFAB (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20));
CREATE TABLE CVTPIDENTIFIC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(10));
CREATE TABLE CVTPSITACESSO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(15) NOT NULL);
CREATE TABLE CVTPTERMINAL (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20), ID_CVTERMINALFAB SMALLINT NOT NULL,
  ATIVO CHAR(1));
CREATE TABLE CVTPVISITADO (ID SMALLINT NOT NULL PRIMARY KEY, COD_TP_VISITADO SMALLINT NOT NULL,
  NOME VARCHAR(80) NOT NULL);
CREATE TABLE CVTPVISITANTE (ID SMALLINT NOT NULL PRIMARY KEY, COD_TP_VISITANTE SMALLINT NOT NULL,
  NOME VARCHAR(45) NOT NULL, ATIVO CHAR(1));
CREATE TABLE GDPRONTCADOPER (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE PRCARACTDIE (ID_CARACTDIE INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50), TPRESP SMALLINT,
  OLD_UNIDRESP VARCHAR(10), TIPO VARCHAR(1), ATIVO CHAR(1), ID_PRUNIDRESPOSTA SMALLINT,
  POSSIVEIS_RESPOSTAS BLOB SUB_TYPE 1);
"""
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")
CARREGADAS = ("CHCRITICIDADE", "CHAREA", "CHOCORRENCIA", "CHSITUACAO", "CVTERMINALFAB", "CVTPIDENTIFIC",
              "CVTPSITACESSO", "CVTPTERMINAL", "CVTPVISITADO", "CVTPVISITANTE", "GDPRONTCADOPER", "PRCARACTDIE",
              "CHTPLIMPEZA", "CHPROFISLIMP", "CHAREA_CHPROFISLIMP", "CHPROFLIMPTEL")
NAO_CARREGADAS = ()
# pais de fora da fatia, já carregados: usuário (L3, chave = login) e tipo de telefone (L5)
# unidade de medida (L7-07, chave = código, caixa preservada): só "mg"; "ml" fica sem par de propósito
PAIS_EXTERNOS = {"TBUSERS": ["usuario.exemplo"], "TBTIPOTELEFONE": ["1", "2"], "TBUNICON": ["mg"]}
# a unidade de resposta (PRUNIDRESPOSTA, origem lida na referência encadeada) vem da imagem da L6-08
REQUER = ["L6-08"]
# rodada 6: o preparo da L6-08 (informação clínica da operadora, via de uso, cadastros de cod:) roda antes deste;
# sem ele as tabelas da L6-08 carregadas aqui caíam em codigo_inexistente_destino e filho -> pai divergente
PREPARO_DOS_REQUERIDOS = True


def linhas(r, ins):
    for x in [(1, "Área  crítica"), (2, "Semicrítica"), (3, "Não crítica")]:
        ins("CHCRITICIDADE", list(x))
    for x in [(1, "Quarto  101", 1, "Q101", "S"), (2, "Posto de enfermagem", 2, "PE", None),
              (3, "Recepção", 3, None, "S"), (4, "Expurgo", 99, "EXP", "S"), (5, None, 2, "X5", "N"),
              (6, "Quarto 101", 1, "Q101B", "S"), (7, "Copa", 3, "CP", "X")]:
        ins("CHAREA", list(x))
    for x in [(1, "Sangue"), (2, "Urina"), (3, None), (4, "Vômito")]:
        ins("CHOCORRENCIA", list(x))
    for x in [(1, "Alta", None, "S", "#FF0000", 1), (2, "Aguardando", 1, "S", "amarelo", 2),
              (3, "Em  higienização", 2, None, "azul", 3), (4, "Liberado", 3, "S", "verde", 4),
              (5, "Rouparia", 99, "S", "cinza", 5), (6, "Cancelada", 0, "N", "preto", None)]:
        ins("CHSITUACAO", list(x))
    for x in [(1, "Fab  Alfa"), (2, "Fab Beta"), (3, None)]:
        ins("CVTERMINALFAB", list(x))
    for x in [(1, "Crachá"), (2, "Digital"), (3, "Face"), (4, "   ")]:
        ins("CVTPIDENTIFIC", list(x))
    for x in [(1, "Liberado"), (2, "Bloqueado"), (3, "Restrito")]:
        ins("CVTPSITACESSO", list(x))
    for x in [(1, "Catraca X", 1, "S"), (2, "Totem Y", 2, None), (3, "Leitor Z", 3, "S"), (4, "Terminal W", 99, "N"),
              (5, "Modelo  V", 1, "S")]:
        ins("CVTPTERMINAL", list(x))
    for x in [(1, 1, "Paciente"), (2, 2, "Setor"), (3, 3, "Funcionário")]:
        ins("CVTPVISITADO", list(x))
    for x in [(1, 1, "Visitante", "S"), (2, 2, "Acompanhante", None), (3, 3, "Fornecedor", "N"),
              (4, 4, "Representante", "S")]:
        ins("CVTPVISITANTE", list(x))
    for x in [(1, "Registro"), (2, "Saída"), (3, "Devolução"), (4, "Descarte")]:
        ins("GDPRONTCADOPER", list(x))
    for x in [(1, "Hipossódica", 0, None, "R", "S", None, None),
              (2, "Sem lactose", 1, "ml", "r", "S", 1, "sim\r\nnão".encode("cp1252")),
              (3, None, 0, None, "C", "S", None, None), (4, "  Diabética  ", 2, None, "R", "N", 2, None)]:
        ins("PRCARACTDIE", list(x))
    # profissional sem ponta de vínculo (recusado pelo CHECK), escala e telefone (filhas: pai_pendente)
    for x in [(1, "usuario.exemplo", None, None, None, "S", "Profissional  Exemplo Um", "12345678909"),
              (2, None, None, None, None, None, "Profissional Exemplo Dois", None),
              (3, "login.inexistente", None, None, None, "N", "Profissional Exemplo Tres", "11111111111")]:
        ins("CHPROFISLIMP", list(x))
    for x in [(1, 1), (2, 1), (2, 2), (7, 3)]:
        ins("CHAREA_CHPROFISLIMP", list(x))
    ins("CHPROFLIMPTEL", [1, 1, 11, 900000000 + r.randint(0, 99999)])
    ins("CHPROFLIMPTEL", [2, 2, None, 1100000000 + r.randint(0, 99999)])
    # modalidade: tempo como hora do dia-zero; 00:00 (sem tempo), outra data, nome nulo
    for i, nome, d, m, at in [(1, "Limpeza concorrente", (1899, 12, 30), 30, "S"),
                              (2, "Limpeza  terminal", (1899, 12, 30), 90, "S"),
                              (3, "Desinfecção", (1899, 12, 30), 0, "N"),
                              (4, "Imediata", (2020, 1, 1), 45, None),
                              (5, None, (1899, 12, 30), 20, "S")]:
        ins("CHTPLIMPEZA", [i, nome, datetime.datetime(*d, m // 60, m % 60), at])
    return {
        "CHCRITICIDADE": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
        "CHAREA": {"gravados": 3, "pendencias": {"restricao_destino_1048": 3, "pai_inexistente": 1,
                                                 "restricao_destino_1062": 1, "valor_fora_do_dominio": 1}},
        "CHOCORRENCIA": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 4}},
        "CHSITUACAO": {"gravados": 5, "pendencias": {"restricao_destino_1048": 1, "pai_inexistente": 1,
                                                     "valor_presumido": 6}},
        "CVTERMINALFAB": {"gravados": 2, "pendencias": {"restricao_destino_1048": 1}},
        "CVTPIDENTIFIC": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1}},
        "CVTPSITACESSO": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
        "CVTPTERMINAL": {"gravados": 3, "pendencias": {"pai_pendente": 1, "pai_inexistente": 1,
                                                       "restricao_destino_1048": 1, "valor_presumido": 4}},
        "CVTPVISITADO": {"gravados": 3, "pendencias": {"valor_presumido": 3}},
        "CVTPVISITANTE": {"gravados": 4, "pendencias": {"valor_presumido": 4}},
        "GDPRONTCADOPER": {"gravados": 4, "pendencias": {"valor_presumido": 8}},
        "PRCARACTDIE": {"gravados": 3, "pendencias": {"restricao_destino_1048": 1, "valor_presumido": 8,
                                                       "pai_inexistente": 1}},
        "CHTPLIMPEZA": {"gravados": 3, "pendencias": {"restricao_destino_1048": 2, "hora_com_data": 1,
                                                      "valor_presumido": 5}},
        "CHPROFISLIMP": {"gravados": 0, "pendencias": {"restricao_destino_4025": 3, "valor_presumido": 3,
                                                       "documento_invalido": 1, "pai_inexistente": 1}},
        "CHAREA_CHPROFISLIMP": {"gravados": 0, "pendencias": {"pai_pendente": 4}},
        "CHPROFLIMPTEL": {"gravados": 0, "pendencias": {"pai_pendente": 2}},
    }
