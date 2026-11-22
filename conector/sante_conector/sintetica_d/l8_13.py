"""Fatia L8-13 (operadora de planos: domínios de faturamento, cadastro e cartão): imagem sintética.

Dados 100% falsos (nomes inventados). 17 tabelas carregadas (CDSTATUSCAD em situacao_cadastral_beneficiario); 6
ficam na imagem e são DESCARTE de produto (`declarado/sem_carga.tsv`, causa mecanismo_do_produto: listas fixas do
sistema de origem que nenhuma tabela carregada consome): CDFAIXAETATP, CDMSGLINHA, CDPARDIGOBG, CDPGTOCOOPART,
CDTPCOPART e CDTPCTRCONTRAT.
Anomalias cobertas:
- nome nulo em coluna obrigatória do destino (restricao_destino_1048, recusa só a linha);
- dia de vencimento fora da faixa 1..31 (CHECK do destino: restricao_destino_4025);
- indicador S/N fora do domínio (valor_fora_do_dominio; fica o padrão do destino) e nulo (padrão, sem pendência);
- nome com espaços repetidos (texto_nome colapsa);
- classificação obrigatória sem origem (literal presumido: valor_presumido por linha);
- domínio fixo do sistema com código 'sistema-<n>' (de-para de valores 0..99): chave 120 fora da faixa
  (valor_fora_do_dominio, recusada pelo NOT NULL do código);
- tipo do movimento sem evidência na origem (literal presumido =~alteracao: valor_presumido por linha, inclusive no
  motivo ligado a uma situação inexistente, que o destino não guarda);
- situação cadastral com nome nulo (restricao_destino_1048) e com espaços repetidos;
- mensagem de cobrança sem vigência (@vigencia_carga: vigencia_sem_fonte por linha), posição presumida
  (valor_presumido), prioridade 0 e nula (inteiro_zero_nulo: padrão 1 do destino, sem pendência).
"""

DDL = """
CREATE TABLE CDACOMODTIPO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE CDDIAVENCCOB (ID SMALLINT NOT NULL PRIMARY KEY, DIA_PERMITIDO_VENC_COBRANCA CHAR(1));
CREATE TABLE CDFAIXAETATP (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE CDGUIASTATUS (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(15));
CREATE TABLE CDINCIDECOMIS (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE CDMOTIVOBAIXA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
CREATE TABLE CDMOTIVOSOLCART (CODIGO SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50));
CREATE TABLE CDMSGCOBRANCA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL,
  ORDEM_PRIORIDADE_EMISSAO_BOLETO SMALLINT);
CREATE TABLE CDMSGLINHA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(25));
CREATE TABLE CDORIGEMCOBR (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE CDORIGEMGUIA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE CDPARDIGOBG (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(40));
CREATE TABLE CDPGTOBALCAOCP (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE CDPGTOCOOPART (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE CDPLANOCLASSIF (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE CDSTATUSCAD (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(10));
CREATE TABLE CDMOTMOVIMCAD (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(70), ID_CDSTATUSCAD SMALLINT NOT NULL);
CREATE TABLE CDSTATUSSOLCART (CODIGO SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30));
CREATE TABLE CDTPACUMULPOR (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE CDTPCOBRANCA (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(30) NOT NULL);
CREATE TABLE CDTPCONTRATO (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(25));
CREATE TABLE CDTPCOPART (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(20) NOT NULL);
CREATE TABLE CDTPCTRCONTRAT (ID SMALLINT NOT NULL PRIMARY KEY, NOME VARCHAR(50) NOT NULL);
"""
CARREGADAS = ("CDSTATUSCAD", "CDACOMODTIPO", "CDDIAVENCCOB", "CDGUIASTATUS", "CDINCIDECOMIS", "CDMOTIVOBAIXA", "CDMOTIVOSOLCART",
              "CDORIGEMCOBR", "CDORIGEMGUIA", "CDPGTOBALCAOCP", "CDPLANOCLASSIF", "CDMSGCOBRANCA",
              "CDMOTMOVIMCAD", "CDSTATUSSOLCART", "CDTPACUMULPOR", "CDTPCOBRANCA", "CDTPCONTRATO")
NAO_CARREGADAS = ("CDFAIXAETATP", "CDMSGLINHA", "CDPARDIGOBG", "CDPGTOCOOPART", "CDTPCOPART", "CDTPCTRCONTRAT")

# tabela com literal presumido: uma pendência valor_presumido por linha
_NOMES = {
    "CDACOMODTIPO": ["Quarto exemplo A", "  Quarto   exemplo  B ", "Leito exemplo C", "Acomodação exemplo D"],
    "CDINCIDECOMIS": ["Base exemplo um", "Base exemplo dois", "Base exemplo três"],
    "CDMOTIVOBAIXA": ["Motivo de baixa exemplo"],
    "CDORIGEMCOBR": ["Origem cobrança A", "Origem  cobrança  B", "Origem cobrança C"],
    "CDORIGEMGUIA": ["Origem guia A", "Origem guia B", "Origem guia C"],
    "CDPGTOBALCAOCP": ["Pagamento exemplo A", "Pagamento exemplo B", "Pagamento exemplo C"],
    "CDPLANOCLASSIF": ["Classe exemplo A", "Classe exemplo B", "Classe exemplo C"],
    "CDTPACUMULPOR": ["Acúmulo exemplo A", "Acúmulo exemplo B"],
    "CDTPCOBRANCA": ["Cobrança exemplo A", "  Cobrança   exemplo B", "Cobrança exemplo C"],
    "CDTPCONTRATO": ["Contrato exemplo A", "Contrato exemplo B"],
}
# tabela sem presumido, com um nome nulo (NOT NULL no destino: restricao_destino_1048)
_COM_NULO = {
    "CDGUIASTATUS": ["Situação A", "Situação B", None, "Situação  D", "Situação E"],
    "CDMOTIVOSOLCART": ["Motivo cartão A", None, "Motivo cartão C"],
    "CDSTATUSCAD": ["Situação A", "  Sit   B ", None, "Situação D"],
}
_FORA = {"CDFAIXAETATP": 3, "CDMSGLINHA": 7, "CDPARDIGOBG": 4, "CDPGTOCOOPART": 2, "CDTPCOPART": 3,
         "CDTPCTRCONTRAT": 2}

_ROTULOS_R5 = {'CDFAIXAETATP': [(1, 'Dez faixas'), (2, 'Sete faixas'), (3, 'Anterior à lei')], 'CDMSGLINHA': [(1, 'Linha 1'), (2, 'Linha 2'), (3, 'Linha 3'), (4, 'Linha 4'), (5, 'Linha 5'), (6, 'Linha 6'), (7, 'Linha 7')], 'CDPARDIGOBG': [(1, 'Todos'), (2, 'Nenhum'), (3, 'Só titular'), (4, 'Só dependente')], 'CDPGTOCOOPART': [(1, 'Na fatura'), (2, 'No balcão')], 'CDTPCOPART': [(1, 'Percentual'), (2, 'Valor fixo'), (3, 'Nenhuma')], 'CDTPCTRCONTRAT': [(1, 'Com patrocínio'), (2, 'Sem patrocínio')]}


def linhas(r, ins):
    esperado = {}
    for t, nomes in _NOMES.items():
        for i, n in enumerate(nomes, 1):
            ins(t, [i, n])
        esperado[t] = {"gravados": len(nomes), "pendencias": {"valor_presumido": len(nomes)}}
    for t, nomes in _COM_NULO.items():
        for i, n in enumerate(nomes, 1):
            ins(t, [i, n])
        esperado[t] = {"gravados": len(nomes) - 1, "pendencias": {"restricao_destino_1048": 1}}
    # dias 1..31 (5 fora do domínio S/N, 6 nulo) e 32 (CHECK 1..31 recusa a linha)
    for dia in range(1, 33):
        ins("CDDIAVENCCOB", [dia, {5: "X", 6: None}.get(dia, "SN"[dia % 7 == 0])])
    esperado["CDDIAVENCCOB"] = {"gravados": 31,
                                "pendencias": {"restricao_destino_4025": 1, "valor_fora_do_dominio": 1}}
    # mensagens: vigência da carga e posição presumida em toda linha; prioridade 0 e nula: padrão 1 do destino
    for m in [(1, "Mensagem exemplo um", 1), (2, "Mensagem  exemplo dois", 2), (3, "Mensagem exemplo três", 0),
              (4, "Mensagem exemplo quatro", None)]:
        ins("CDMSGCOBRANCA", list(m))
    esperado["CDMSGCOBRANCA"] = {"gravados": 4, "pendencias": {"valor_presumido": 4, "vigencia_sem_fonte": 4}}
    # motivo de movimento: tipo presumido em toda linha (a situação ligada não decide o tipo); 99 sem situação
    for i, st in enumerate([1, 2, 3, 3, 4, 99], 1):
        ins("CDMOTMOVIMCAD", [i, "Motivo movimento exemplo %d" % i, st])
    esperado["CDMOTMOVIMCAD"] = {"gravados": 6, "pendencias": {"valor_presumido": 6}}
    # chave fora da faixa do prefixo 'sistema-<n>' (0..99): código nulo, recusa pelo NOT NULL
    ins("CDORIGEMGUIA", [120, "Origem guia fora da faixa"])
    esperado["CDORIGEMGUIA"] = {"gravados": 3, "pendencias": {"valor_presumido": 4, "valor_fora_do_dominio": 1,
                                                             "restricao_destino_1048": 1}}
    for i, n in enumerate(["Situação cartão A", "Situação  cartão B", "Situação cartão C"], 1):
        ins("CDSTATUSSOLCART", [i, n])
    esperado["CDSTATUSSOLCART"] = {"gravados": 3, "pendencias": {}}
    for t, n in _FORA.items():  # rodada 5 (revisão): código E rótulo da prova (provas.d/<T>.sql)
        for i, rot in _ROTULOS_R5[t]:
            ins(t, [i, rot])
    return esperado
