"""Fatia L8-06 (faturamento e restantes, módulo FAT): tabelas da origem com coluna declarada e anomalias.

Dados 100% falsos (endereços, logins e senhas inventados). Carregada (CARREGADAS) e anomalias cobertas:
- TBTISSWEBSERV -> endpoint_tiss_fonte_pagadora: endereço só de espaços (vira NULL: o CHECK de serviço web sem
  endereço recusa, restricao_destino_4025); fonte pagadora nunca vista (pai_inexistente, NULL e NOT NULL recusa:
  restricao_destino_1048); duas transações TISS nunca vistas para a mesma fonte (pai_inexistente: referência obrigatória, a linha é
  recusada; pedido 12); controle de autenticação booleano_sn em qualquer caixa ('s' basica, 'n' nenhuma), fora do
  domínio ('X': valor_fora_do_dominio, fica o padrão 'nenhuma') e nulo ('nenhuma' pelo par do nulo); login e
  senha preenchidos que nunca são lidos para o destino (credencial vai ao cofre, pedido 9).
Não carregadas (NAO_CARREGADAS: na imagem, sem coluna declarada; dependem dos pedidos do L8-06.json): FCTISSLOTEPROT
(versão do padrão TISS e tipo de guia) e TBHISTTABDTH (contrato da fonte pagadora sem alimentadora).
"""
import datetime

from .. import carga_mapa

# pedido 12 (L8-06.json): referência obrigatória declarada na via; recusa a linha cujo pai nunca foi visto
REFERENCIA_OBRIGATORIA = hasattr(carga_mapa, "VIA_OBRIGATORIA")

DDL = """
CREATE TABLE TBTISSWEBSERV (ID_TBCONVEN SMALLINT NOT NULL, ID_TBTISSSCHEMA SMALLINT NOT NULL,
  URL VARCHAR(150) NOT NULL, LOCAL_ARQ_XML_RETORNO VARCHAR(100) NOT NULL, LOGIN_PRESTADOR VARCHAR(30),
  SENHA_PRESTADOR VARCHAR(64), SENHA_PRESTADOR_PADRAO_HASH_MD5 CHAR(1), CTR_AUT_TP_BASIC CHAR(1),
  TIME_RESPOSTA_WEBSERV TIME, PRIMARY KEY (ID_TBCONVEN, ID_TBTISSSCHEMA));
CREATE TABLE FCTISSLOTEPROT (ID INTEGER NOT NULL PRIMARY KEY, ID_TBCONVEN INTEGER NOT NULL,
  ID_TBTISSTPGUIA SMALLINT NOT NULL, ID_TBTISSSCHEMA SMALLINT NOT NULL, NUM_LOTE VARCHAR(12) NOT NULL,
  SEQUENCIAL_LOTE VARCHAR(12) NOT NULL, NUM_PROTOCOLO VARCHAR(12), NUM_DEMONSTRATIVO_RECURSO_GLOSA VARCHAR(20),
  DATA_HORA_LOTE TIMESTAMP);
CREATE TABLE TBHISTTABDTH (ID_TBCONVEN SMALLINT NOT NULL, PERIODO_INICIAL DATE NOT NULL, PERIODO_FINAL DATE NOT NULL,
  ID_TBCTRDTH SMALLINT NOT NULL, PRIMARY KEY (ID_TBCONVEN, PERIODO_INICIAL, PERIODO_FINAL));
"""
# fonte pagadora (TBCONVEN, chave COD) e transação TISS (TBTISSSCHEMA, chave ID): pais de fora, já carregados
PAIS_EXTERNOS = {"TBCONVEN": ["1", "2", "3"], "TBTISSSCHEMA": ["1", "2"]}
# a conferência cria só as tabelas de destino da fatia: o estabelecimento único do cliente de exemplo vem daqui
PREPARO_DESTINO = ("CREATE TABLE IF NOT EXISTS estabelecimento (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,"
                   " nome VARCHAR(40) NOT NULL); INSERT INTO estabelecimento (nome) VALUES ('Unidade exemplo')")
CARREGADAS = ("TBTISSWEBSERV",)
NAO_CARREGADAS = ("FCTISSLOTEPROT", "TBHISTTABDTH")


def linhas(r, ins):
    h = None  # TIME_RESPOSTA_WEBSERV não declarado (pedido 9); o gerador comum não cita datetime.time
    for x in [(1, 1, "https://operadora-um.exemplo.invalid/tiss/lote", "S"),
              (1, 2, "https://operadora-um.exemplo.invalid/tiss/elegibilidade", None),  # nulo: nenhuma
              (2, 1, "  https://operadora-dois.exemplo.invalid/ws  ", "X"),            # fora do domínio
              (2, 2, "https://operadora-dois.exemplo.invalid/ws2", "s"),               # minúsculo: basica
              (3, 1, "   ", "S"),                                            # sem endereço: CHECK recusa
              (3, 9, "https://operadora-tres.exemplo.invalid/ws9", "n"),    # transação nunca vista
              (3, 8, "https://operadora-tres.exemplo.invalid/ws8", "N"),    # outra transação nunca vista, mesma fonte
              (88, 1, "https://operadora-sem-cadastro.exemplo.invalid/ws", "N")]:  # fonte nunca vista: recusa
        ins("TBTISSWEBSERV", [x[0], x[1], x[2], "C:\\retorno\\exemplo", "prestador%d" % r.randint(1, 9),
                              "senha-falsa-%d" % r.randint(100, 999), "N", x[3], h])
    d = datetime.datetime(2025, 5, 2, 10, 0)
    for i in range(1, 3):
        ins("FCTISSLOTEPROT", [i, 1, 1, 1, "L%04d" % i, "S%04d" % i, None, None, d + datetime.timedelta(days=i)])
    ins("TBHISTTABDTH", [1, datetime.date(2024, 1, 1), datetime.date(2024, 12, 31), 1])
    # transação nunca vista: com a referência obrigatória (pedido 12, carga_mapa.VIA_OBRIGATORIA) as linhas (3,9) e
    # (3,8) são recusadas com pai_inexistente; antes dele ainda gravam com transação NULL (ramo a remover depois)
    gravados = 4 if REFERENCIA_OBRIGATORIA else 6
    return {
        "TBTISSWEBSERV": {"gravados": gravados, "pendencias": {"restricao_destino_4025": 1,
                                                               "restricao_destino_1048": 1, "pai_inexistente": 3,
                                                               "valor_fora_do_dominio": 1}},
    }
