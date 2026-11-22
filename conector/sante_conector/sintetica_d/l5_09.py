"""Fatia L5-09 (cadastros do RH): as 21 tabelas carregam. Situações do colaborador e tipos de rescisão nos cadastros
próprios; as 19 listas (eSocial, SEFIP, RAIS, CAGED, FGTS, Receita e as próprias do hospital) entram inteiras como
LISTAS DO HOSPITAL, ativas (ADR 0006, itens 1 e 4; decisão do conferidor da rodada 5): uma definição
'rh.lista.<nome>' em parametro_definicao (tipo lista, módulo 'migracao' criado uma vez e adotado depois) e uma opção
por linha em parametro_opcao (valor = código, rótulo = descrição ou o próprio código, ordem = código, origem
migracao). O consumidor continua ligando ao oficial pelo código (de-para codigo_esocial ou domínio CHECK).
Anomalias das listas: descrição nula (rótulo = código), descrição longa (texto_resumido), código não numérico
('I1': a ordem pelo código fica NULL, recusa visível até o pedido r5-a, `#seq:*`, em saida/L5-09.json).
Dados 100% falsos. Anomalias: código de 1 caractere com colisão de caixa ('a' e 'A': a chave única do destino não
distingue caixa: as duas linhas recusadas com codigo_colisao_caixa), descrição nula e só de espaços (NOT NULL no
destino), texto com espaços internos e bytes CP1252, nome com espaços repetidos (colapsados), código CAGED fora da
faixa do destino (SMALLINT UNSIGNED), código RAIS fora da tabela legal (iniciativa sem par: valor_fora_do_dominio e
recusa pela NOT NULL), categoria e booleanos da situação PRESUMIDOS (valor_presumido em cada linha que chega ao
destino), iniciativa e consequências legais do tipo de rescisão pelo de-para de valores do código RAIS, motivo de
desligamento pelo de-para oficial da tabela 19 do eSocial (código ausente do catálogo: catalogo_codigo_inexistente, a
linha grava com NULL). REQUER a L5-07: a condição do colaborador grava no mesmo cadastro (código único). Enquanto a L5-07 gravar o número da
condição sem prefixo de domínio, a situação '1' choca com a condição 1 (restricao_destino_1062); com o prefixo, não
choca. O esperado lê a declaração da L5-07 para saber qual vale.
"""
import datetime
from pathlib import Path

REQUER = ["L5-07"]

DDL = """
CREATE TABLE FPSIT_FUNC (COD_SIT VARCHAR(1) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(40));
CREATE TABLE FPTIPORESC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80), ID_FPRESC_RAIS INTEGER NOT NULL,
  ID_FPSAQUE VARCHAR(3) NOT NULL, ID_FPRESC_SEFIP VARCHAR(2) NOT NULL, ID_FPRESC_CAGED INTEGER NOT NULL,
  ID_FPRESC_CAUSA INTEGER NOT NULL, ID_FPCAUSA_AFASTAMENTO VARCHAR(3) NOT NULL, ID_FPMOTDESLIG VARCHAR(2));
CREATE TABLE FPMOTDESLIG (ID VARCHAR(2) NOT NULL PRIMARY KEY, DESCRICAO BLOB SUB_TYPE 1, DATA_VIGENCIA_INICIAL DATE NOT NULL,
  DATA_VIGENCIA_FINAL DATE);
CREATE TABLE FPMOTESTABILI (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(70));
CREATE TABLE FPMTCANCELAVI (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(45));
CREATE TABLE FPNIVELESTAG (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(30));
CREATE TABLE FPOCOR_SEFIP (COD_OCOR_SEF INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(150));
CREATE TABLE FPPROCESSOTEOR (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(80));
CREATE TABLE FPPROCTRAB_ESOCIAL_CR (ID INTEGER NOT NULL PRIMARY KEY, COD_RECEITA VARCHAR(6) NOT NULL,
  DESCRICAO VARCHAR(150), ALIQUOTA NUMERIC(18,2), DESCRICAO_ALIQUOTA VARCHAR(80), APLICAVEL_VRBCCPMENSAL VARCHAR(1),
  APLICAVEL_VRBCCP13 VARCHAR(1), APLICAVEL_VRRENDIRRF VARCHAR(1), APLICAVEL_VRRENDIRRF13 VARCHAR(1));
CREATE TABLE FPRESC_CAGED (COD_RES_CAG INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
CREATE TABLE FPRESC_CAUSA (COD_CAUS_DEM INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(50));
CREATE TABLE FPRESC_RAIS (COD_RAIS INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(200));
CREATE TABLE FPRESC_SEFIP (COD_SEFIP VARCHAR(2) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(150));
CREATE TABLE FPSAQUE (COD_SAQ VARCHAR(3) NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(180));
CREATE TABLE FPTEMPO_RESID_TRAB_IMIGRANTE (ID SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(30));
CREATE TABLE FPTIPOAVISO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(45) NOT NULL);
CREATE TABLE FPTIPO_CONTRATO (COD_TP_CONT INTEGER NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(100));
CREATE TABLE FPTPACESSORIA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE FPTPACIDTRANS (COD_FPTPACIDTRANS SMALLINT NOT NULL PRIMARY KEY, DESCRICAO VARCHAR(13));
CREATE TABLE FPTPAVISORESC (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(210));
CREATE TABLE FPTPDEFICIEN (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(15) NOT NULL);
"""

# catálogo oficial falso da tabela 19 do eSocial (motivo de desligamento): códigos 2, 4 e 6; o 8 fica ausente
PREPARO_DESTINO = (
    "INSERT INTO tabela_esocial (fonte, codigo_oficial, descricao, versao_fonte, criado_em)"
    " VALUES ('esocial', '19', 'Tabela oficial falsa', 'teste', UTC_TIMESTAMP(3));\n"
    "INSERT INTO codigo_esocial (tabela_esocial_id, codigo_esocial, descricao, criado_em)"
    " SELECT id, c, 'Motivo falso', UTC_TIMESTAMP(3) FROM tabela_esocial,"
    " (SELECT '02' AS c UNION ALL SELECT '04' UNION ALL SELECT '06') x WHERE codigo_oficial = '19';\n")

# rodada 5, conferidor (ADR 0006, itens 1 e 4; F4-decisoes-destino.md): as 19 listas entram inteiras como listas
# do hospital, ativas: uma definição 'rh.lista.<nome>' (parametro_definicao, tipo lista, módulo 'migracao') e uma
# opção por linha (parametro_opcao: valor = código, rótulo = descrição ou o código, ordem = código, origem migracao)
SEM_CARGA = {}
BLOQUEADAS = {}

SIT, TR = "FPSIT_FUNC", "FPTIPORESC"

# listas (tabela, nº de colunas, chave texto?)
LISTAS = [("FPMOTESTABILI", 2, False), ("FPMTCANCELAVI", 2, False), ("FPNIVELESTAG", 2, False),
          ("FPOCOR_SEFIP", 2, False), ("FPPROCESSOTEOR", 2, False), ("FPRESC_CAGED", 2, False),
          ("FPRESC_CAUSA", 2, False), ("FPRESC_RAIS", 2, False), ("FPRESC_SEFIP", 2, True),
          ("FPSAQUE", 2, True), ("FPTEMPO_RESID_TRAB_IMIGRANTE", 2, False), ("FPTIPOAVISO", 2, False),
          ("FPTIPO_CONTRATO", 2, False), ("FPTPACESSORIA", 2, False), ("FPTPACIDTRANS", 2, False),
          ("FPTPAVISORESC", 2, False), ("FPTPDEFICIEN", 2, False)]
DESCARTADAS = LISTAS          # nome antigo, mantido para quem importa
TODAS_LISTAS = [t for t, _, _ in LISTAS] + ["FPMOTDESLIG", "FPPROCTRAB_ESOCIAL_CR"]
# primeira lista na ordem da carga: cria o módulo 'migracao' (as outras o adotam), salvo se a L5-07 já o criar
PRIMEIRA_LISTA = "FPMOTDESLIG"


def _modulo_na_l507():
    arq = Path(__file__).resolve().parents[2] / "mapa" / "declarado" / "colunas.d" / "L5-07.tsv"
    try:
        return any(ln.split("\t")[2:3] == ["modulo_sistema.codigo"]
                   for ln in arq.read_text(encoding="utf-8").splitlines())
    except OSError:
        return False


def condicao_sem_prefixo():
    """True se a L5-07 grava o número da condição como código sem prefixo de domínio (choca com a situação '1')."""
    arq = Path(__file__).resolve().parents[2] / "mapa" / "declarado" / "colunas.d" / "L5-07.tsv"
    try:
        for ln in arq.read_text(encoding="utf-8").splitlines():
            c = ln.split("\t")
            if len(c) > 2 and c[0] == "FPCONDFUNC" and c[2] == "situacao_colaborador.codigo":
                return c[1] == "ID"
    except OSError:
        pass
    return False


ESPERADO_SEFIP_I1 = {"valor_fora_do_dominio": 1, "restricao_destino_1048": 1}   # código não numérico: ordem NULL, recusa visível


def linhas(r, ins):
    for cod, desc in [("A", "Situação exemplo um"), ("F", "Situação exemplo dois"), ("D", "Situação exemplo três"),
                      ("a", "Colide com A pela caixa"),          # chave única sem caixa: codigo_colisao_caixa (as duas)
                      ("X", None),                                # NOT NULL: restricao_destino_1048
                      ("Y", "   "),                             # só espaços vira NULL: restricao_destino_1048
                      ("P", "  Situação  com   espaços  "),      # pontas aparadas, internos preservados
                      ("Z", "Exemplo €“”"),        # bytes CP1252 0x80-0x9F
                      ("1", "Situação numérica"),                # choca com a condição 1 (L5-07) sem prefixo
                      ("4", "Situação numérica sem choque")]:
        ins(SIT, [cod, desc])
    # código RAIS legal por tipo (de-para de valores da iniciativa e das consequências); 99 fica fora da tabela legal
    rais_de = {1: 11, 2: 21, 3: 10, 4: 60, 5: 12, 6: 70, 7: 72, 8: 90, 9: 99}
    for i in range(1, 10):
        nome, caged = "Tipo exemplo %d" % i, 30 + i
        if i == 3:
            nome = "  Tipo   com  espaços  "                     # texto_nome colapsa
        if i == 5:
            nome = None                                           # NOT NULL: restricao_destino_1048
        if i == 7:
            caged = 70000                                         # fora de SMALLINT UNSIGNED: restricao_destino_1264
        # i == 9: RAIS 99 sem par: valor_fora_do_dominio nas 8 colunas derivadas; iniciativa NULL recusa a linha (restricao_destino_1048)
        # motivo eSocial: None nas ímpares; 02, 04, 06 no catálogo falso; 08 ausente (catalogo_codigo_inexistente)
        ins(TR, [i, nome, rais_de[i], "%02d" % (r.randint(1, 99)), "%d" % (i % 9), caged, i, "%02d" % i,
                 None if i % 2 else "0%d" % i])
    for i in range(1, 4):
        ins("FPMOTDESLIG", ["0%d" % i, ("Motivo falso %d\r\nlinha dois" % i).encode("cp1252"),
                            datetime.date(2020, 1, i), None])
        ins("FPPROCTRAB_ESOCIAL_CR", [i, "10%02d01" % i, "Receita falsa %d" % i, "%d.50" % i, None, "S", "N", None, "S"])
        for t, _, txt in LISTAS:
            ins(t, ["%02d" % i if txt else 10 + i, "Falso %d" % i])
    # anomalias das listas
    ins("FPMOTESTABILI", [14, None])                             # sem descrição: o rótulo é o código
    ins("FPTPAVISORESC", [14, "Forma de cumprimento " + "muito longa " * 15])   # rótulo resumido a 150
    ins("FPRESC_SEFIP", ["I1", "Código não numérico"])           # ordem pelo código: recusa visível até #seq:*
    ins("FPPROCTRAB_ESOCIAL_CR", [4, "109901", None, None, None, None, None, None, None])  # rótulo = código de receita
    sit_gravados, sit_pend = 5, {"codigo_colisao_caixa": 2, "restricao_destino_1048": 2}
    if condicao_sem_prefixo():
        sit_pend["restricao_destino_1062"] = 1
    else:
        sit_gravados += 1
    # toda linha fora da colisão de caixa passa pelas 3 presunções (categoria e 2 booleanos): uma pendência por coluna
    sit_pend["valor_presumido"] = 8 * 3
    esp = {}
    mod_previo = _modulo_na_l507()
    for t in TODAS_LISTAS:
        n = 4 if t in ("FPMOTESTABILI", "FPTPAVISORESC", "FPPROCTRAB_ESOCIAL_CR") else 3
        pend = {"adotado_existente": (n - 1) + n - (0 if mod_previo or t != PRIMEIRA_LISTA else 1)}
        esp[t] = {"gravados": n, "pendencias": pend}
    esp["FPRESC_SEFIP"]["pendencias"].update(ESPERADO_SEFIP_I1)
    esp["FPTPAVISORESC"]["pendencias"]["texto_resumido"] = 1
    return {
        **esp,
        SIT: {"gravados": sit_gravados, "pendencias": sit_pend},
        TR: {"gravados": 6, "pendencias": {"restricao_destino_1048": 2, "restricao_destino_1264": 1,
                                           "valor_fora_do_dominio": 8, "catalogo_codigo_inexistente": 1}},
    }
