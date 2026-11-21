"""Fatia L5-09 (cadastros do RH): situações do colaborador e tipos de rescisão carregam; das outras 19 tabelas da
fatia, 18 são descarte de produto e 1 fica BLOQUEADA (pedidos em docs/obra/fatias/f4/saida/L5-09.json):
- `mecanismo_do_produto`, domínio fixo por CHECK (11): o consumidor do produto guarda o valor do CHECK; o de-para
  'id da origem -> valor do CHECK' é declarado no lote do consumidor quando ele tiver linhas (nesta origem todos estão
  vazios e fora do mapa), lendo a descrição pela referência encadeada (a lista continua legível na origem);
- `mecanismo_do_produto`, código simples (6): o modelo guarda o código oficial como texto ou número no consumidor
  (RAIS, CAGED, SEFIP, saque do FGTS, ocorrência SEFIP, código de receita), sem tabela de catálogo;
- `duplicado` (1): a causa de demissão repete o que o código RAIS já diz (iniciativa e justa causa);
- BLOQUEADA (1): a tabela 19 do eSocial espera o carregador oficial de codigo_esocial (regra 7), que não existe.

Dados 100% falsos. Anomalias: código de 1 caractere com colisão de caixa ('a' e 'A': a chave única do destino não
distingue caixa: as duas linhas recusadas com codigo_colisao_caixa), descrição nula e só de espaços (NOT NULL no
destino), texto com espaços internos e bytes CP1252, nome com espaços repetidos (colapsados), código CAGED fora da
faixa do destino (SMALLINT UNSIGNED), código RAIS fora da tabela legal (iniciativa sem par: valor_fora_do_dominio e
recusa pela NOT NULL), categoria e booleanos da situação PRESUMIDOS (valor_presumido em cada linha que chega ao
destino), iniciativa e consequências legais do tipo de rescisão pelo de-para de valores do código RAIS, motivo de
desligamento pelo de-para oficial da tabela 19 do eSocial (código ausente do catálogo: catalogo_codigo_inexistente, a
linha grava com NULL). As tabelas descartadas entram na imagem para provar que nada delas é gravado.
REQUER a L5-07: a condição do colaborador grava no mesmo cadastro (código único). Enquanto a L5-07 gravar o número da
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

# descarte de produto pedido ao integrador (declarado/sem_carga.tsv, situacao=descarte): {tabela: (causa, motivo)}
_CHK = "lista de domínio fixa do produto (CHECK de %s): a linha não é registro do cliente; o consumidor na origem (%s) está vazio e fora do mapa; quando um cliente o trouxer com linhas, o lote dele declara o de-para de valores 'id -> valor do CHECK' pela descrição (ref encadeada à lista, que continua legível na origem), com par só por evidência e o resto presumido (=~, valor_presumido) (F4-decisoes-destino.md, L5-09)"
_COD = 'código oficial guardado como código simples no consumidor (%s), sem tabela de catálogo no modelo: a lista é a pública da fonte legal, não registro do cliente (F4-decisoes-destino.md, L5-09)'
SEM_CARGA = {
    "FPMOTESTABILI": ("mecanismo_do_produto", _CHK % ("estabilidade_colaborador.motivo", "FPESTABIFUNC")),
    "FPMTCANCELAVI": ("mecanismo_do_produto", _CHK % ("aviso_previo.motivo_cancelamento", "FPRESCISAO_FPMTCANCELAVI")),
    "FPNIVELESTAG": ("mecanismo_do_produto", _CHK % ("estagio_colaborador.nivel", "FPFUNC e FPFUNCVIG")),
    "FPPROCESSOTEOR": ("mecanismo_do_produto", _CHK % ("processo_trabalhista.teor_decisao", "FPFUNC_FPROCESSO")),
    "FPTEMPO_RESID_TRAB_IMIGRANTE": ("mecanismo_do_produto",
                                     _CHK % ("estrangeiro_colaborador.prazo_residencia", "FPTRABALHADOR_IMIGRANTE")),
    "FPTIPOAVISO": ("mecanismo_do_produto", _CHK % ("aviso_previo.iniciativa e reducao_jornada", "nenhum")),
    "FPTIPO_CONTRATO": ("mecanismo_do_produto", _CHK % ("vinculo_trabalho.tipo_contrato", "FPFUNC e FPFUNCPREREG")),
    "FPTPACIDTRANS": ("mecanismo_do_produto", _CHK % ("comunicacao_acidente.tipo_acidente_transito", "FPAFAST")),
    "FPTPAVISORESC": ("mecanismo_do_produto", _CHK % ("aviso_previo.cumprimento", "nenhum")),
    "FPTPDEFICIEN": ("mecanismo_do_produto", _CHK % ("deficiencia_colaborador.tipo", "FPTPDEFICIEN_FPFUNC")),
    "FPTPACESSORIA": ("mecanismo_do_produto", _CHK % ("assessoria_externa.tipo",
                                                       "FPRESPCADREG_FPTPACESSORIA e FPPROCESSO; FPESOCEVENTO e FPEMPSOFTWARE são de outras fatias")),
    "FPRESC_RAIS": ("mecanismo_do_produto", _COD % "tipo_rescisao.codigo_rais, declarado nesta fatia; a iniciativa e as consequências legais saem dele por de-para de valores"),
    "FPRESC_CAGED": ("mecanismo_do_produto", _COD % "tipo_rescisao.codigo_caged, declarado nesta fatia"),
    "FPRESC_SEFIP": ("mecanismo_do_produto", _COD % "tipo_rescisao.codigo_sefip, declarado nesta fatia"),
    "FPSAQUE": ("mecanismo_do_produto", _COD % "tipo_rescisao.codigo_saque_fgts e rescisao.codigo_saque_fgts"),
    "FPOCOR_SEFIP": ("mecanismo_do_produto", _COD % "risco_funcao.codigo_ocorrencia_sefip, VARCHAR(2); o consumidor com linhas é TBPROFIS.ID_FPOCOR_SEFIP, do lote do profissional"),
    "FPPROCTRAB_ESOCIAL_CR": ("mecanismo_do_produto", _COD % "processo_trabalhista.codigo_receita, VARCHAR(6); alíquota e aplicabilidade são as da tabela pública da Receita, não do cliente; consumidores FPPROCTRAB_ESOCIAL_PCR e _DCR vazios e fora do mapa"),
    "FPRESC_CAUSA": ("duplicado", "lista local de causas de demissão que repete o que o código RAIS do tipo de rescisão já diz de forma legal (iniciativa e justa causa, RAIS 10); o modelo não tem coluna para ela (F4-decisoes-destino.md, L5-09)"),
}

# rodada 5 (ADR 0006, item 4; F4-decisoes-destino.md): as listas legais (eSocial, SEFIP, RAIS, CAGED, FGTS,
# Receita) passam a catálogo oficial ligado pelo código no consumidor; o motivo é o mesmo de sem_carga.tsv
_R5 = {
    'FPMOTESTABILI': "catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de eSocial (leiaute), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: lista de domínio fixa do produto (CHECK de estabilidade_colaborador.motivo): a linha não é registro do cliente; o consumidor na origem (FPESTABIFUNC) está vazio e fora do mapa; quando um cliente o trouxer com linhas, o lote dele declara o de-para de valores 'id -> valor do CHECK' pela descrição (ref encadeada à lista, que continua legível na origem), com par só por evidência e o resto presumido (=~, valor_presumido) (F4-decisoes-destino.md, L5-09)",
    'FPMTCANCELAVI': "catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de eSocial (leiaute), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: lista de domínio fixa do produto (CHECK de aviso_previo.motivo_cancelamento): a linha não é registro do cliente; o consumidor na origem (FPRESCISAO_FPMTCANCELAVI) está vazio e fora do mapa; quando um cliente o trouxer com linhas, o lote dele declara o de-para de valores 'id -> valor do CHECK' pela descrição (ref encadeada à lista, que continua legível na origem), com par só por evidência e o resto presumido (=~, valor_presumido) (F4-decisoes-destino.md, L5-09)",
    'FPNIVELESTAG': "catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de eSocial (leiaute), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: lista de domínio fixa do produto (CHECK de estagio_colaborador.nivel): a linha não é registro do cliente; o consumidor na origem (FPFUNC e FPFUNCVIG) está vazio e fora do mapa; quando um cliente o trouxer com linhas, o lote dele declara o de-para de valores 'id -> valor do CHECK' pela descrição (ref encadeada à lista, que continua legível na origem), com par só por evidência e o resto presumido (=~, valor_presumido) (F4-decisoes-destino.md, L5-09)",
    'FPOCOR_SEFIP': 'catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de SEFIP, sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: código oficial guardado como código simples no consumidor (risco_funcao.codigo_ocorrencia_sefip, VARCHAR(2); o consumidor com linhas é TBPROFIS.ID_FPOCOR_SEFIP, do lote do profissional), sem tabela de catálogo no modelo: a lista é a pública da fonte legal, não registro do cliente (F4-decisoes-destino.md, L5-09)',
    'FPPROCESSOTEOR': "catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de eSocial (leiaute), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: lista de domínio fixa do produto (CHECK de processo_trabalhista.teor_decisao): a linha não é registro do cliente; o consumidor na origem (FPFUNC_FPROCESSO) está vazio e fora do mapa; quando um cliente o trouxer com linhas, o lote dele declara o de-para de valores 'id -> valor do CHECK' pela descrição (ref encadeada à lista, que continua legível na origem), com par só por evidência e o resto presumido (=~, valor_presumido) (F4-decisoes-destino.md, L5-09)",
    'FPPROCTRAB_ESOCIAL_CR': 'catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de Receita Federal (códigos de receita), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: código oficial guardado como código simples no consumidor (processo_trabalhista.codigo_receita, VARCHAR(6); alíquota e aplicabilidade são as da tabela pública da Receita, não do cliente; consumidores FPPROCTRAB_ESOCIAL_PCR e _DCR vazios e fora do mapa), sem tabela de catálogo no modelo: a lista é a pública da fonte legal, não registro do cliente (F4-decisoes-destino.md, L5-09)',
    'FPRESC_CAGED': 'catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de CAGED, sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: código oficial guardado como código simples no consumidor (tipo_rescisao.codigo_caged, declarado nesta fatia), sem tabela de catálogo no modelo: a lista é a pública da fonte legal, não registro do cliente (F4-decisoes-destino.md, L5-09)',
    'FPRESC_RAIS': 'catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de RAIS, sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: código oficial guardado como código simples no consumidor (tipo_rescisao.codigo_rais, declarado nesta fatia; a iniciativa e as consequências legais saem dele por de-para de valores), sem tabela de catálogo no modelo: a lista é a pública da fonte legal, não registro do cliente (F4-decisoes-destino.md, L5-09)',
    'FPRESC_SEFIP': 'catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de SEFIP, sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: código oficial guardado como código simples no consumidor (tipo_rescisao.codigo_sefip, declarado nesta fatia), sem tabela de catálogo no modelo: a lista é a pública da fonte legal, não registro do cliente (F4-decisoes-destino.md, L5-09)',
    'FPSAQUE': 'catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de FGTS (Lei 8.036/90, art. 20), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: código oficial guardado como código simples no consumidor (tipo_rescisao.codigo_saque_fgts e rescisao.codigo_saque_fgts), sem tabela de catálogo no modelo: a lista é a pública da fonte legal, não registro do cliente (F4-decisoes-destino.md, L5-09)',
    'FPTEMPO_RESID_TRAB_IMIGRANTE': "catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de eSocial (leiaute), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: lista de domínio fixa do produto (CHECK de estrangeiro_colaborador.prazo_residencia): a linha não é registro do cliente; o consumidor na origem (FPTRABALHADOR_IMIGRANTE) está vazio e fora do mapa; quando um cliente o trouxer com linhas, o lote dele declara o de-para de valores 'id -> valor do CHECK' pela descrição (ref encadeada à lista, que continua legível na origem), com par só por evidência e o resto presumido (=~, valor_presumido) (F4-decisoes-destino.md, L5-09)",
    'FPTIPOAVISO': "catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de eSocial (leiaute), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: lista de domínio fixa do produto (CHECK de aviso_previo.iniciativa e reducao_jornada): a linha não é registro do cliente; o consumidor na origem (nenhum) está vazio e fora do mapa; quando um cliente o trouxer com linhas, o lote dele declara o de-para de valores 'id -> valor do CHECK' pela descrição (ref encadeada à lista, que continua legível na origem), com par só por evidência e o resto presumido (=~, valor_presumido) (F4-decisoes-destino.md, L5-09)",
    'FPTIPO_CONTRATO': "catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de eSocial (leiaute), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: lista de domínio fixa do produto (CHECK de vinculo_trabalho.tipo_contrato): a linha não é registro do cliente; o consumidor na origem (FPFUNC e FPFUNCPREREG) está vazio e fora do mapa; quando um cliente o trouxer com linhas, o lote dele declara o de-para de valores 'id -> valor do CHECK' pela descrição (ref encadeada à lista, que continua legível na origem), com par só por evidência e o resto presumido (=~, valor_presumido) (F4-decisoes-destino.md, L5-09)",
    'FPTPACIDTRANS': "catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de eSocial (leiaute), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: lista de domínio fixa do produto (CHECK de comunicacao_acidente.tipo_acidente_transito): a linha não é registro do cliente; o consumidor na origem (FPAFAST) está vazio e fora do mapa; quando um cliente o trouxer com linhas, o lote dele declara o de-para de valores 'id -> valor do CHECK' pela descrição (ref encadeada à lista, que continua legível na origem), com par só por evidência e o resto presumido (=~, valor_presumido) (F4-decisoes-destino.md, L5-09)",
    'FPTPAVISORESC': "catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de eSocial (leiaute), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: lista de domínio fixa do produto (CHECK de aviso_previo.cumprimento): a linha não é registro do cliente; o consumidor na origem (nenhum) está vazio e fora do mapa; quando um cliente o trouxer com linhas, o lote dele declara o de-para de valores 'id -> valor do CHECK' pela descrição (ref encadeada à lista, que continua legível na origem), com par só por evidência e o resto presumido (=~, valor_presumido) (F4-decisoes-destino.md, L5-09)",
    'FPTPDEFICIEN': "catálogo oficial da origem (ADR 0006, item 4; decisão da rodada 5 em F4-decisoes-destino.md): lista legal de eSocial (leiaute), sem dado do hospital; o produto a guarda como domínio próprio (CHECK ou código simples na coluna do consumidor) e o consumidor liga pelo código ou pela descrição oficial (de-para de valores); código sem par fica visível como valor_fora_do_dominio; código local ou versão antiga em uso entra como item do hospital (pedido r5-1 em saida/L5-09.json). Destino do código: lista de domínio fixa do produto (CHECK de deficiencia_colaborador.tipo): a linha não é registro do cliente; o consumidor na origem (FPTPDEFICIEN_FPFUNC) está vazio e fora do mapa; quando um cliente o trouxer com linhas, o lote dele declara o de-para de valores 'id -> valor do CHECK' pela descrição (ref encadeada à lista, que continua legível na origem), com par só por evidência e o resto presumido (=~, valor_presumido) (F4-decisoes-destino.md, L5-09)",
}
for _t, _m in _R5.items():
    SEM_CARGA[_t] = ("catalogo_oficial", _m)

# rodada 5, revisão (ADR 0006, itens 1 e 4): nenhuma destas listas é descarte. As legais aguardam r5-1 (código local
# ou de versão antiga como item do hospital ativo no catálogo oficial, com conciliação código a código); as próprias
# do hospital (FPTPACESSORIA, FPRESC_CAUSA) aguardam r5-2 (lista do hospital). O texto está em sem_carga.tsv.
_R52 = {"FPTPACESSORIA", "FPRESC_CAUSA"}

# BLOQUEADA com causa (declarado/sem_carga.tsv, situacao=bloqueada): depende de algo que ainda não existe
BLOQUEADAS = {
    "FPMOTDESLIG": ("mecanismo_pedido", "tabela 19 do eSocial (motivo de desligamento, com vigências): pela regra 7 só o carregador oficial versionado grava codigo_esocial, e ele não existe em catalogos/carregadores (pedido em saida/L5-09.json); até lá o de-para codigo_esocial:19 de tipo_rescisao deixa o motivo NULL com pendência. Nunca carregar da origem"),
}
BLOQUEADAS["FPMOTDESLIG"] = ("mecanismo_pedido", "r5-1")
for _t in list(SEM_CARGA):
    BLOQUEADAS[_t] = ("mecanismo_pedido", "r5-2" if _t in _R52 else "r5-1")
    del SEM_CARGA[_t]

SIT, TR = "FPSIT_FUNC", "FPTIPORESC"

# listas de códigos oficiais e de domínio (descarte de produto): (tabela, nº de colunas, chave texto?)
DESCARTADAS = [("FPMOTESTABILI", 2, False), ("FPMTCANCELAVI", 2, False), ("FPNIVELESTAG", 2, False),
               ("FPOCOR_SEFIP", 2, False), ("FPPROCESSOTEOR", 2, False), ("FPRESC_CAGED", 2, False),
               ("FPRESC_CAUSA", 2, False), ("FPRESC_RAIS", 2, False), ("FPRESC_SEFIP", 2, True),
               ("FPSAQUE", 2, True), ("FPTEMPO_RESID_TRAB_IMIGRANTE", 2, False), ("FPTIPOAVISO", 2, False),
               ("FPTIPO_CONTRATO", 2, False), ("FPTPACESSORIA", 2, False), ("FPTPACIDTRANS", 2, False),
               ("FPTPAVISORESC", 2, False), ("FPTPDEFICIEN", 2, False)]


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
        for t, _, txt in DESCARTADAS:
            ins(t, ["%02d" % i if txt else 10 + i, "Falso %d" % i])
    sit_gravados, sit_pend = 5, {"codigo_colisao_caixa": 2, "restricao_destino_1048": 2}
    if condicao_sem_prefixo():
        sit_pend["restricao_destino_1062"] = 1
    else:
        sit_gravados += 1
    # toda linha fora da colisão de caixa passa pelas 3 presunções (categoria e 2 booleanos): uma pendência por coluna
    sit_pend["valor_presumido"] = 8 * 3
    return {
        SIT: {"gravados": sit_gravados, "pendencias": sit_pend},
        TR: {"gravados": 6, "pendencias": {"restricao_destino_1048": 2, "restricao_destino_1264": 1,
                                           "valor_fora_do_dominio": 8, "catalogo_codigo_inexistente": 1}},
    }
