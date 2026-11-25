"""Carga das entidades do L3: estabelecimento, usuários, pacientes e atendimentos, com conciliação por entidade.

O mapa (MAPA, abaixo) é a única parte que conhece nomes da origem (regra 1: "no mapa do conector, como origem").
Para cada tabela: a entidade de destino, a chave original e SÓ as colunas lidas (credenciais e textos clínicos nunca
entram na leitura). O motor lê pelo usuário Firebird em transação READ ONLY; grava pelo usuário restrito da execução.

Regras (plano F4, seções 6, 6.1 e 7):
- toda linha lida fica em `conector_origem` (tabela, chave original, entidade, id de destino, hash dos bytes crus);
  linha recusada fica com id de destino NULL e uma pendência (tabela, chave, regra; nunca o valor);
- linha já carregada com o mesmo hash é pulada (a importação é idempotente); com hash diferente fica para o
  Sincronizar (L9), com pendência `alteracao_aguarda_sincronizar`, SEM trocar o hash guardado (o L9 a detecta);
  linha que sumiu da origem fica com `apagada_aguarda_sincronizar`; nenhuma das duas faz a execução falhar;
- a recusa é gravada com a linha (regra e gravidade em `conector_origem`) e a pendência vai na mesma transação do
  commit por lote: uma falha no meio não perde o motivo, e a reexecução reemite a regra de toda linha recusada;
- unicidade conferida no próprio banco de destino (mesma collation) antes de inserir; e cada linha nova é inserida
  sob SAVEPOINT: uma restrição violada recusa só aquela linha (`restricao_destino_<código>`), nunca a execução;
- sentinelas (datas 1899-12-30, 1900-01-01, ano < 1800), CPF/CNPJ com dígito errado, telefone fora do padrão viram
  NULL com pendência; conversão CP1252 -> Unicode determinística (texto.py);
- catálogos PRÓPRIOS do cliente que o mapa exige (sexo, tipos de documento, endereço e telefone, categoria de
  atendimento) são criados com o código do mapa quando faltam; catálogo OFICIAL (caráter do atendimento TISS,
  municípios IBGE) nunca é criado aqui: sem ele, a linha vira pendência;
- convênio e profissional do atendimento ainda não têm carga própria (L5): entram como cadastro provisório, por
  chave da origem, registrado em `conector_origem` (hash zero) para a onda que os completar, com pendência;
- conciliação por entidade: registros lidos na origem = gravados no destino (lidos de volta do banco) + recusados,
  e soma de controle (sha256 da lista ordenada de "chave|resumo dos campos") calculada da origem e relida do
  destino. Os campos de texto entram na soma como BYTES CP1252: do lado da origem, os bytes crus normalizados no
  próprio domínio de bytes (`bruto`); do lado do destino, o texto gravado reconvertido por `texto_para_cp1252`.
  Assim a soma prova a conversão de ida e volta, não só a persistência. O resumo de cada linha gravada fica em
  `conector_origem.hash_destino`; numa reexecução, a linha igual entra na soma da origem com esse resumo, e uma
  diferença no destino com rastro de edição (`versao`/`alterado_em`) vira pendência `edicao_no_destino` (conflito
  visível; a origem vence no L9), não falha. Só agregados saem daqui.
"""
import datetime
import decimal
import hashlib
import os
import re
import time

import pymysql

from .leitor import hash_linha
from .texto import cp1252_para_texto, texto_para_cp1252

VERSAO_MAPA = "l3-2026-11-21b"

MAPA = {
    "TBTPEMP": {"entidade": "tipo_empresa", "chave": "ID", "colunas": ["ID", "NOME"], "sem_destino": True},
    "TBHOSPIT": {"entidade": "estabelecimento", "chave": "COD",
                 "colunas": ["COD", "NOME", "NOME_HOT", "CGC", "CNES", "ENDERECO", "NUMERO", "COMPL", "BAI", "CEP",
                             "FONE", "EMAIL", "DTINI"]},
    "TBUSERS": {"entidade": "usuario", "chave": "NOME",
                "colunas": ["NOME", "ID_TBUSERS", "STATUS", "CPF", "E_MAIL", "BLOQUEADO", "DT_NASC", "NOMEC"]},
    "RICADPAC": {"entidade": "paciente", "chave": "ID",
                 "colunas": ["ID", "NOME", "NASC", "SEXO", "CPF", "CNS", "MAE", "PAI", "PRONT", "ENDERECO", "NUMERO",
                             "COMPL", "BAIRRO", "CEP", "IBGE", "FONE", "CELULAR", "IDENT", "ATIVO", "DTOBITO"]},
    "REALTA": {"entidade": "atendimento", "chave": "ID_RECADATE", "colunas": ["ID_RECADATE", "DATA_HORA"],
               "pre": True},
    "RECADATE": {"entidade": "atendimento", "chave": "REG", "colunas": ["REG", "ID_ATCABECATEND"], "pre": True},
    "ATCABECATEND": {"entidade": "atendimento", "chave": "ID",
                     "colunas": ["ID", "COD_ATENDIMENTO", "ID_RICADPAC", "DATA_HORA_ENTRADA", "DATA_HORA_SAIDA_EFETIVA",
                                 "DATA_HORA_ALTA_MEDICA", "TP_ATENDIMENTO", "CARATER_ATEND", "ID_TBCONVEN",
                                 "ID_TBCBOPRO_ATENDIMENTO", "ATIVO"]},
}
ORDEM = ["TBTPEMP", "TBHOSPIT", "TBUSERS", "RICADPAC", "REALTA", "RECADATE", "ATCABECATEND"]
# de-para de valores declarado no mapa (catálogos próprios do cliente)
SEXOS = {"M": ("masculino", "Masculino"), "F": ("feminino", "Feminino"), "I": ("indeterminado", "Indeterminado")}
CATEGORIAS = {"A": ("ambulatorio", "Ambulatório"), "I": ("internacao", "Internação"),
              "E": ("externo", "Externo"), "U": ("pronto_atendimento", "Pronto atendimento")}
CARATER = {1: "1", 2: "2"}  # domínio TISS 23 (caráter do atendimento): o catálogo oficial é que diz se existe
# C1 (2026-11-22): caráter vazio ou 0 (57% e 42,6% na amostra; "não informado" na origem) não recusa o atendimento
# (ADR 0006: continuidade; ADR 0007, 18: melhor estimativa com pendência). A evidência é a categoria do próprio
# atendimento: pronto atendimento é urgência/emergência (TISS 23, código 2); as demais, eletivo (código 1).
CARATER_ESTIMADO = {"U": "2"}
CARATER_ESTIMADO_PADRAO = "1"


def conciliacao_conferida(lidos, vistas, gravados, recusadas, soma_origem, soma_destino):
    """Conciliação de uma entidade: tudo o que foi lido foi visto e está gravado ou recusado, e as somas de controle
    batem. Tudo recusado (linhas lidas e nada gravado) nunca é conferido: as duas somas vazias empatam sem provar nada
    (C1, 2026-11-22: 209 mil atendimentos recusados apareciam como conferidos)."""
    return (lidos == vistas == gravados + recusadas and soma_origem == soma_destino
            and not (lidos and not gravados))

# Entidade principal com recusa acima do limite nunca fica conferida (2026-11-22: a carga real recusou 100% dos
# atendimentos e a execução saiu "concluída"). A recusa parcial continua registrada como pendência de cada linha; acima
# do limite a conciliação da entidade fica NÃO conferida, a execução falha (estado vermelho do painel) e o relatório L10
# destaca a decisão (`recusa_acima_do_limite`). Configurável por ambiente; os nomes valem também com o sufixo `#n`.
ENTIDADES_PRINCIPAIS = ("estabelecimento", "usuario", "profissional", "paciente", "atendimento", "conta_hospitalar",
                        "conta_hospitalar_item", "agenda", "agenda_servico", "marcacao_horario")
RECUSA_LIMITE_PERCENTUAL = 5.0
RECUSA_LIMITE_LINHAS = 1000
REGRA_RECUSA_LIMITE = "recusa_acima_do_limite"


def limites_recusa(ambiente=None):
    """(entidades principais, percentual, linhas) do ambiente (`CONECTOR_ENTIDADES_PRINCIPAIS` separadas por vírgula,
    `CONECTOR_RECUSA_LIMITE_PERCENTUAL`, `CONECTOR_RECUSA_LIMITE_LINHAS`); valor inválido fica no padrão."""
    amb = os.environ if ambiente is None else ambiente
    ents = tuple(x.strip() for x in (amb.get("CONECTOR_ENTIDADES_PRINCIPAIS") or "").split(",") if x.strip()) \
        or ENTIDADES_PRINCIPAIS
    try:
        pct = float(amb.get("CONECTOR_RECUSA_LIMITE_PERCENTUAL") or RECUSA_LIMITE_PERCENTUAL)
    except ValueError:
        pct = RECUSA_LIMITE_PERCENTUAL
    try:
        lin = int(amb.get("CONECTOR_RECUSA_LIMITE_LINHAS") or RECUSA_LIMITE_LINHAS)
    except ValueError:
        lin = RECUSA_LIMITE_LINHAS
    return ents, pct, lin


def recusa_acima_do_limite(entidade, lidos, recusados, limites=None):
    """Entidade principal (nome sem o sufixo `#n`) com recusa acima do percentual OU acima do número de linhas."""
    ents, pct, lin = limites or limites_recusa()
    lidos, recusados = int(lidos or 0), int(recusados or 0)
    if entidade.split("#", 1)[0] not in ents or recusados <= 0:
        return False
    return recusados > lin or recusados * 100.0 > pct * max(lidos, recusados)


def aplicar_limite_recusa(res, limites=None):
    """Marca na conciliação (`res`: {entidade: {registros_origem, recusados, conferido}}) as entidades principais com
    recusa acima do limite: `recusa_acima_do_limite` verdadeiro e `conferido` falso. Devolve as entidades marcadas."""
    limites = limites or limites_recusa()
    marcadas = []
    for ent, r in res.items():
        if recusa_acima_do_limite(ent, r.get("registros_origem"), r.get("recusados"), limites):
            r[REGRA_RECUSA_LIMITE] = True
            r["conciliacao_sem_limite"] = r.get("conferido")  # contagem e soma conferidas, antes do alerta de recusa
            r["conferido"] = False
            marcadas.append(ent)
    return marcadas


def reprocessar_recusadas(ambiente=None):
    """CONECTOR_REPROCESSAR_RECUSADAS=1 (passada de reprocesso, depois de corrigir a declaração): a linha já vista e
    RECUSADA (conector_origem com id_destino nulo e regra de recusa) é tratada como nova e tentada de novo. A linha
    gravada continua pulada como igual; sem a variável, nada muda (continuidade). Combina com CONECTOR_SO."""
    ambiente = os.environ if ambiente is None else ambiente
    return (ambiente.get("CONECTOR_REPROCESSAR_RECUSADAS") or "").strip().lower() in ("1", "s", "sim", "true")


def carater_do_atendimento(valor, categoria):
    """(código TISS 23, regra de pendência ou None). 1 e 2 valem como vieram; vazio ou 0 (não informado): estimado
    pela categoria (carater_estimado, baixa); outro número: estimado do mesmo modo, com carater_fora_do_dominio."""
    if valor in CARATER:
        return CARATER[valor], None
    est = CARATER_ESTIMADO.get(categoria, CARATER_ESTIMADO_PADRAO)
    return est, ("carater_estimado" if valor in (None, 0) else "carater_fora_do_dominio")
TIPOS_PROPRIOS = {
    "tipo_documento_identificacao": [("rg", "Registro geral (identidade)")],
    "tipo_endereco": [("residencial", "Residencial")],
    "tipo_telefone": [("residencial", "Residencial"), ("celular", "Celular")],
}
SENTINELAS = {datetime.date(1899, 12, 30), datetime.date(1900, 1, 1)}
AGORA = "UTC_TIMESTAMP(3)"
HASH_ZERO = b"\0" * 16
RECUSADO = "-"
# erros de restrição do banco que recusam só a linha (o resto, como conexão perdida, derruba a execução)
ERROS_LINHA = {1048, 1062, 1264, 1292, 1364, 1366, 1406, 1452, 3819, 4025}

# C7: de cada erro de linha só sai o METADADO (nome da coluna, da restrição ou da chave), nunca o valor: a mensagem do
# MariaDB traz o valor em 1062 ("Duplicate entry '<valor>' for key ...") e em 1292/1366; por isso a extração só aceita
# um identificador ([A-Za-z0-9_.]) nas posições de nome, nunca o trecho entre aspas do valor.
_DETALHE_ERRO = (
    re.compile(r"CONSTRAINT `([A-Za-z0-9_.]{1,64})` failed"),           # 4025/3819 CHECK
    re.compile(r"FOREIGN KEY \(`([A-Za-z0-9_]{1,64})`\)"),               # 1452 coluna da FK
    re.compile(r"for key '([A-Za-z0-9_.]{1,80})'\s*$"),                   # 1062 chave única
    re.compile(r"[Cc]olumn '([A-Za-z0-9_]{1,64})'"),                      # 1048, 1264, 1406, 1366, 1292
    re.compile(r"^Field '([A-Za-z0-9_]{1,64})' doesn't have a default"),  # 1364
)


def por_restricao(pend):
    """C7: recusas por restrição do destino com o metadado (tabela de origem:regra:coluna ou restrição) e a contagem."""
    r = {}
    for tab, _, regra, _, det in pend:
        if det:
            k = "%s:%s:%s" % (tab, regra, det)
            r[k] = r.get(k, 0) + 1
    return r


def resumo_pendencias(pend, repetidas, entidade):
    """Resumo das pendências da execução: as gravadas por esta (`pend`, tuplas) mais as repetidas de uma execução
    anterior (`repetidas`, já agregadas no servidor: (tabela, regra, gravidade, detalhe, n)). As repetidas nunca vêm
    linha a linha para a memória (46 milhões na execução 11 da ProntoCardio: dezenas de GB)."""
    linhas = [(tab, regra, grav, det, 1) for tab, _, regra, grav, det in pend] + list(repetidas)
    por_regra, restr, total, criticas = {}, {}, 0, 0
    for tab, regra, grav, det, n in linhas:
        k = "%s:%s:%s" % (entidade(tab), regra, grav)
        por_regra[k] = por_regra.get(k, 0) + n
        if det:
            k = "%s:%s:%s" % (tab, regra, det)
            restr[k] = restr.get(k, 0) + n
        total += n
        criticas += n if grav == "critica" else 0
    return {"total": total, "criticas": criticas, "por_regra": por_regra, "por_restricao": restr}


def detalhe_erro(e):
    """Nome da coluna, da restrição ou da chave do erro de linha (metadado sem valor), ou None."""
    msg = e.args[1] if len(getattr(e, "args", ())) > 1 and isinstance(e.args[1], str) else ""
    for rx in _DETALHE_ERRO:
        m = rx.search(msg)
        if m:
            return m.group(1).rsplit(".", 1)[-1][:80]
    return None
ENT_FILHA = {"RECADATE": "atendimento_ficha", "REALTA": "atendimento_alta"}
# entidade de destino de cada tabela (o resumo que sai para o painel nunca leva nome de tabela da origem)
ENTIDADE_DA_TABELA = dict({t: m["entidade"] for t, m in MAPA.items()}, RECADATE="atendimento_ficha",
                          REALTA="atendimento_alta", TBCONVEN="fonte_pagadora", TBCBOPRO="profissional")


class ErroCarga(RuntimeError):
    pass


# ---------------- conversões (determinísticas, sem valores nas mensagens) ----------------
def txt(b, limite=None):
    s = cp1252_para_texto(b) if isinstance(b, (bytes, bytearray)) else b
    if s is None:
        return None
    s = re.sub(r"\s+", " ", s).strip()
    if limite:
        s = s[:limite].rstrip(" ")
    return s or None


# espaços em branco que `str.isspace` vê nos 256 caracteres do CP1252 (teste exaustivo em test_l3)
_ESPACO_B = re.compile(rb"[\t\n\x0b\x0c\r\x1c-\x1f \xa0]+")


def bruto(b, limite=None):
    """Lado da ORIGEM da soma de controle: a mesma normalização de `txt`, feita nos bytes crus (sem decodificar).
    Comparada com `texto_para_cp1252(texto gravado)`, prova a conversão CP1252 -> utf8mb4 de ida e volta."""
    if b is None:
        return None
    if not isinstance(b, (bytes, bytearray)):
        b = texto_para_cp1252(str(b))
    b = _ESPACO_B.sub(b" ", bytes(b)).strip(b" ")
    if limite:
        b = b[:limite].rstrip(b" ")
    return b or None


def municipio_ibge(cod, por7, por6):
    """C8: id do município pelo código IBGE da origem: 7 dígitos (com verificador) direto; 6 dígitos (sem o
    verificador, como a origem grava) pelo prefixo único do catálogo oficial; vazio ou desconhecido: None."""
    if not cod or len(cod) > 7:
        return None
    if len(cod) == 7:
        return por7.get(cod)
    return por6.get(cod.zfill(6)) or por7.get(cod.zfill(7))


def digitos(v):
    if v is None:
        return ""
    if isinstance(v, float):
        v = int(round(v))
    if isinstance(v, decimal.Decimal):
        v = int(v)
    if isinstance(v, int):
        return str(v) if v > 0 else ""
    return re.sub(r"\D", "", txt(v) or "")


def _dv_ok(num, pesos_list):
    for pesos in pesos_list:
        n = len(pesos)
        s = sum(int(d) * p for d, p in zip(num[:n], pesos))
        r = s % 11
        dv = 0 if r < 2 else 11 - r
        if dv != int(num[n]):
            return False
    return True


def cpf(v):
    d = digitos(v)
    if not d:
        return None, False
    d = d.zfill(11)
    if len(d) != 11 or d == d[0] * 11:
        return None, True
    ok = _dv_ok(d, [range(10, 1, -1), range(11, 1, -1)])
    return (d, False) if ok else (None, True)


def cnpj(v):
    d = digitos(v)
    if not d:
        return None, False
    d = d.zfill(14)
    if len(d) != 14 or d == d[0] * 14:
        return None, True
    p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    ok = _dv_ok(d, [p1, [6] + p1])
    return (d, False) if ok else (None, True)


def data(v):
    """(data, era_sentinela)."""
    if v is None:
        return None, False
    d = v.date() if isinstance(v, datetime.datetime) else v
    if d in SENTINELAS or d.year < 1800:
        return None, True
    return d, False


def momento(v):
    """DATETIME(3): truncado ao milissegundo (o que volta do banco é igual ao que foi gravado)."""
    if v is None:
        return None, False
    d, sent = data(v)
    if sent:
        return None, True
    return v.replace(microsecond=(v.microsecond // 1000) * 1000), False


def telefone(v):
    d = digitos(v)
    if not d:
        return None, False
    if d.startswith("55") and len(d) in (12, 13):
        d = d[2:]
    if d.startswith("0"):
        d = d.lstrip("0")
    if len(d) in (10, 11) and re.fullmatch(r"[1-9][0-9]", d[:2]):
        return (d[:2], d[2:]), False
    return None, True


ADIAR_ENDERECO = "#adiar_endereco"


def cep_origem(v):
    cep = digitos(v)
    return cep.zfill(8) if cep and len(cep) <= 8 else None


def local_com_ddd(v, ddd):
    """C8: número local (8 dígitos fixo, 9 celular começando por 9) sem DDD recebe o DDD dado; senão None."""
    d = digitos(v).lstrip("0")
    if len(d) == 8 or (len(d) == 9 and d[0] == "9"):
        return ddd, d
    return None


def nota_endereco(l):
    """NUMERO é numérico na origem real (como em `_gravar_endereco`): vai por `digitos`, nunca por `txt`."""
    return "Endereço da origem sem município identificado: %s" % ", ".join(
        x for x in (txt(l["ENDERECO"], 150), digitos(l["NUMERO"])[:20] or None, txt(l["COMPL"], 100), txt(l["BAIRRO"], 100),
                    "CEP " + digitos(l["CEP"]) if digitos(l["CEP"]) else None,
                    "IBGE " + digitos(l["IBGE"]) if digitos(l["IBGE"]) else None) if x)


def fmt(v):
    """Forma canônica de um campo na soma de controle. Texto vira os bytes CP1252 (hex): o texto gravado no destino e
    os bytes crus normalizados da origem têm de dar o mesmo resultado."""
    if v is None:
        return ""
    if isinstance(v, (bytes, bytearray)):
        return "b" + bytes(v).hex()
    if isinstance(v, str):
        try:
            return "b" + texto_para_cp1252(v).hex()
        except KeyError:  # fora do CP1252: só pode vir do destino; nunca casa com a origem
            return "u" + v.encode("utf-8").hex()
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S.") + "%03d" % (v.microsecond // 1000)
    if isinstance(v, datetime.date):
        return v.isoformat()
    return str(v)


def resumo(campos):
    return hashlib.sha256("|".join(fmt(c) for c in campos).encode()).digest()


def login_de(nome):
    return re.sub(r"[\s:]+", ".", (txt(nome) or "").lower()).strip(".")[:60]


def soma(linhas):
    return hashlib.sha256("\n".join(sorted(linhas)).encode()).hexdigest()


def chave_txt(v):
    if isinstance(v, (bytes, bytearray)):
        return cp1252_para_texto(v).rstrip(" ")
    return str(v)


def codigo_estabelecimento(chave):
    """Código do estabelecimento no formato do modelo (ck_estabelecimento_codigo_formato: letra minúscula seguida de 1
    a 9 letras ou dígitos). A chave da origem que já cabe fica igual; senão: minúsculas, só [a-z0-9], prefixo 'e'
    quando não começa por letra, no máximo 10 caracteres (colisão: recusa codigo_duplicado, como antes)."""
    c = re.sub(r"[^a-z0-9]", "", chave.lower())
    if not c[:1].isalpha():
        c = "e" + c
    c = c[:10]
    return c if len(c) >= 2 else (c + "0")


# ---------------- batimento ----------------
class Batimento:
    """Progresso com batimento dentro da tabela (rodada pendencia-quadratica, 2026-11-23): a plataforma só via o
    batimento no início de cada tabela, e a tabela longa ficava dezenas de minutos sem ele (o vigia acusava parada
    falsa). `pulsar` repete a última etapa, com a contagem de linhas processadas da tabela, no máximo a cada
    INTERVALO segundos: custo de uma comparação de relógio por lote e um UPDATE por minuto."""
    INTERVALO = float(os.environ.get("CONECTOR_BATIMENTO_S", "15"))  # tela de carga: batimento de no máximo 15 s

    def __init__(self, progresso):
        self.fn, self.frac, self.etapa, self.ultimo = progresso, 0.0, None, time.monotonic()

    def __call__(self, frac, etapa=None):
        self.frac, self.etapa, self.ultimo = frac, etapa, time.monotonic()
        return self.fn(frac, etapa)

    def pulsar(self, linhas=None):
        if self.etapa is None or time.monotonic() - self.ultimo < self.INTERVALO:
            return False
        self.ultimo = time.monotonic()
        self.fn(self.frac, self.etapa if linhas is None else "%s: %d linhas processadas" % (self.etapa, linhas))
        return True


class PausaPedida(BaseException):
    """Pausa pedida pela plataforma (obra carga-painel): levantada SÓ num ponto seguro, depois de um commit (nenhuma
    linha pela metade) ou antes de uma mudança de estado. BaseException: nenhum `except Exception` da carga a engole."""


class Placar:
    """Contadores ao vivo da carga (`contadores.progresso`, obra carga-painel). Um por execução, no coordenador.

    - Cada commit da carga (Carga._commit) mede a diferença desde o commit anterior: linhas processadas da tabela
      (chaves vistas), gravadas e recusadas (os registros do conector_origem desse commit, só chave principal),
      puladas iguais e pendências de aviso, e as recusas por regra. Só entra o que foi commitado.
    - O gravador (fork, paralelo.py) manda a diferença ao coordenador pelo canal (`_placar_envio`); o coordenador soma.
    - O pedido de pausa fica em memória compartilhada (`multiprocessing.Value`, criada antes do fork): todo gravador
      vê o pedido e para no próximo commit.
    Só contagens e nomes de tabela e de regra (regra 5)."""
    CAMPOS = ("processadas", "gravadas", "puladas_iguais", "recusadas", "pendencias_aviso")

    def __init__(self, ao_evento=None):
        import multiprocessing
        self._pausa = multiprocessing.Value("b", 0, lock=False)
        self.ao_evento = ao_evento
        self.contagens, self.nomes, self.por_tabela, self.regras = {}, {}, {}, {}
        self.feitas, self.em_curso, self._seq = set(), {}, 0
        self.onda = self.ondas = None
        self.recusadas_conciliacao = None

    # ----- plano e pausa -----
    def planejar(self, contagens, nomes):
        """`contagens`: {tabela da origem: linhas} das tabelas que esta execução carrega; `nomes`: destino de cada."""
        self.contagens.update({t: int(n or 0) for t, n in contagens.items()})
        self.nomes.update(nomes)

    def pedir_pausa(self):
        self._pausa.value = 1

    @property
    def pausa_pedida(self):
        return bool(self._pausa.value)

    def _evento(self, tipo, t):
        if self.ao_evento is not None:
            try:
                self.ao_evento(tipo, t)
            except Exception:  # noqa: BLE001 - o log nunca derruba a carga
                pass

    def inicio(self, t):
        if t in self.feitas or t in self.em_curso:
            return
        self._seq += 1
        self.em_curso[t] = self._seq
        self._evento("inicio", t)

    def fim(self, t, evento=True):
        if t in self.feitas:
            return
        self.em_curso.pop(t, None)
        self.feitas.add(t)
        if evento:
            self._evento("fim", t)

    def somar(self, delta):
        """Soma a diferença de um commit: {"t": {tabela: [processadas, gravadas, puladas, recusadas, avisos]},
        "r": {regra: n}}."""
        for t, v in (delta.get("t") or {}).items():
            a = self.por_tabela.setdefault(t, [0] * len(self.CAMPOS))
            for i, x in enumerate(v):
                a[i] += int(x)
        for r, n in (delta.get("r") or {}).items():
            self.regras[r] = self.regras.get(r, 0) + int(n)

    # ----- leitura -----
    def tabela(self, t):
        return dict(zip(self.CAMPOS, self.por_tabela.get(t) or [0] * len(self.CAMPOS)))

    def linhas_total(self):
        return sum(self.contagens.values())

    def linhas_processadas(self):
        n = 0
        for t, total in self.contagens.items():
            n += total if t in self.feitas else min(total, (self.por_tabela.get(t) or [0])[0])
        return n

    def fracao(self):
        tot = self.linhas_total()
        return self.linhas_processadas() / tot if tot else 0.0

    def json(self):
        tot = [0] * len(self.CAMPOS)
        for v in self.por_tabela.values():
            for i, x in enumerate(v):
                tot[i] += x
        atual = None
        if self.em_curso:  # a tabela em curso com mais linhas por processar (em paralelo, a que mais demora)
            atual = max(self.em_curso, key=lambda t: (self.contagens.get(t, 0) - self.tabela(t)["processadas"],
                                                      -self.em_curso[t]))
        rec_tab = sorted(((self.nomes.get(t, t), v[3]) for t, v in self.por_tabela.items() if v[3]),
                         key=lambda x: (-x[1], x[0]))[:20]
        recusadas = tot[3] if self.recusadas_conciliacao is None else max(tot[3], self.recusadas_conciliacao)
        return {
            "tabela_atual": self.nomes.get(atual, atual) if atual else None,
            "tabela_origem_linhas": self.contagens.get(atual, 0) if atual else 0,
            "tabela_processadas": min(self.contagens.get(atual, 0), self.tabela(atual)["processadas"]) if atual else 0,
            "onda": self.onda, "ondas": self.ondas,
            "tabelas_feitas": len(self.feitas & set(self.contagens)), "tabelas_total": len(self.contagens),
            "linhas_total": self.linhas_total(), "linhas_processadas": self.linhas_processadas(),
            "gravadas": tot[1], "puladas_iguais": tot[2], "recusadas": recusadas, "pendencias_aviso": tot[4],
            "recusas_por_regra": dict(sorted(self.regras.items())),
            "recusas_por_tabela": [{"tabela": t, "recusadas": n} for t, n in rec_tab],
            "atualizado_em": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        }


# ---------------- carga ----------------
class Carga:
    reprocessar = False  # padrão (continuidade) também para a instância montada sem __init__ (testes)

    def __init__(self, leitor, cr, ctl, eid, imagem_id, progresso=None, pular=None, placar=None):
        self.placar = placar                # contadores ao vivo e pedido de pausa (Placar; None = sem tela)
        self.lt, self.cr, self.ctl, self.eid, self.img = leitor, cr, "`%s`" % ctl, eid, imagem_id
        self.pular = dict(pular or {})      # continuação: {tabela: execução que a concluiu} (continuar.concluidas_propria)
        self.progresso = Batimento(progresso or (lambda pct, etapa: None))
        self.pend = []                      # (tabela, chave, regra, gravidade): todas, para o resumo
        self.pend_repetidas = []            # (tabela, regra, gravidade, detalhe, n): herdadas da cadeia (sem cópia)
        self._buf = []                      # pendências ainda não gravadas (vão no próximo commit)
        self._diario = []                   # registros em memória desde o último SAVEPOINT (para desfazer)
        self.origem = {}                    # entidade -> {chave: resumo hex da linha, calculado da origem}
        self.aguardam = {}                  # entidade -> chaves alteradas na origem (ficam para o L9)
        self.vistas = {}                    # tabela -> chaves lidas nesta execução
        self.cont = {"catalogos_criados": 0, "provisorios": 0, "puladas_iguais": 0, "alteradas_aguardam": 0,
                     "recusas_por_restricao": 0}
        self.existente = {}                 # tabela -> {chave: (id_destino, hash, hash_destino, regra, gravidade)}
        self.reprocessar = reprocessar_recusadas()  # recusada já vista volta a ser tentada (CONECTOR_REPROCESSAR_...)
        self._avisos_ant = {}               # tabela -> {chave: {(regra, gravidade)}}: abertas de execuções anteriores
        self._reemitidas = {}               # (tabela, chave, regra) -> vezes: reemitidas, ainda não recalculadas
        self.pre = {}                       # REALTA/RECADATE lidos antes do atendimento
        self.atend_novos = set()            # atendimentos gravados nesta execução
        self.tabelas = []

    # ----- utilidades -----
    def _c(self):
        return self.cr.cursor()

    def _pendencia(self, tab, chave, regra, grav, detalhe=None):
        p = (tab, None if chave is None else str(chave)[:500], regra, grav, detalhe)
        k = (tab, p[1], regra)
        if self._reemitidas.get(k):  # a linha recalculou a mesma pendência que já foi reemitida: conta uma vez só
            self._reemitidas[k] -= 1
            return
        self.pend.append(p)
        self._buf.append(p)

    def _commit(self):
        """Pendências e linhas na MESMA transação: uma falha depois deste ponto não perde nenhum motivo."""
        if self._buf:
            with self._c() as c:
                c.executemany("INSERT INTO %s.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                              " detalhe, criado_em) VALUES (%s, %%s, %%s, %%s, %%s, %%s, %s)" % (self.ctl, int(self.eid), AGORA),
                              self._buf)
            self._buf = []
        self.cr.commit()
        self._placar_commit()
        self._diario = []
        self._pulsar()
        pl = getattr(self, "placar", None)
        if pl is not None and pl.pausa_pedida and not getattr(self, "_parando", False):
            self._parando = True  # depois do commit: nada pela metade; os commits seguintes (marca) não levantam
            raise PausaPedida()

    def _placar_rebase(self):
        """Base do placar no estado atual, sem contar: depois de juntar o estado dos gravadores (paralelo._juntar), que
        já mandaram a diferença deles pelo canal, o próximo commit do coordenador não a conta de novo."""
        vistas = self.vistas if isinstance(getattr(self, "vistas", None), dict) else {}
        self._pl_base = {"pend": len(self.pend), "pul": int(self.cont.get("puladas_iguais", 0)),
                         "vistas": {t: len(v) for t, v in vistas.items() if hasattr(v, "__len__")}}

    def _placar_commit(self):
        """Diferença do que este commit gravou (Placar): só chave principal (a vista nesta execução), cada chave
        uma vez pelo estado final; puladas e pendências pela diferença dos contadores desde o commit anterior."""
        pl = getattr(self, "placar", None)
        if pl is None:
            return
        b = self.__dict__.get("_pl_base") or {"pend": 0, "pul": 0, "vistas": {}}
        vistas = self.vistas if isinstance(getattr(self, "vistas", None), dict) else {}
        finais, rec_todas = {}, 0
        for tab, chave, _ in self._diario:
            if (tab, chave) in finais:
                continue
            r = (self.existente.get(tab) or {}).get(chave) if isinstance(self.existente.get(tab), dict) else None
            finais[(tab, chave)] = r
        d, regras = {}, {}
        for (tab, chave), r in finais.items():
            if r is None:
                continue
            if r[0] is None and r[3]:
                rec_todas += 1
            vs = vistas.get(tab)
            if not isinstance(vs, (set, dict)) or chave not in vs:
                continue
            a = d.setdefault(tab, [0, 0, 0, 0, 0])
            if r[0] is None:
                a[3] += 1
                regras[r[3] or "recusada"] = regras.get(r[3] or "recusada", 0) + 1
            else:
                a[1] += 1
        t = getattr(self, "_tab_atual", None)
        pend, pul = len(self.pend), int(self.cont.get("puladas_iguais", 0))
        bv = dict(b["vistas"])
        if t is not None:
            a = d.setdefault(t, [0, 0, 0, 0, 0])
            vs = vistas.get(t)
            n = len(vs) if isinstance(vs, (set, dict)) else bv.get(t, 0)
            a[0] += max(0, n - bv.get(t, 0))
            bv[t] = n
            a[2] += max(0, pul - b["pul"])
            a[4] += max(0, pend - b["pend"] - rec_todas)
        self._pl_base = {"pend": pend, "pul": pul, "vistas": bv}
        d = {k: v for k, v in d.items() if any(v)}
        if not d and not regras:
            return
        delta = {"t": d, "r": regras}
        envio = getattr(self, "_placar_envio", None)
        if envio is not None:
            envio(delta)
        else:
            pl.somar(delta)

    def _entre_tabelas_pausa(self):
        """Entre as tabelas da contagem das pendências herdadas (continuar.repetir_pendencias): com a pausa pedida
        (lida pelo batimento `progresso`), para; nada foi gravado e a próxima continuação refaz a contagem."""
        pl = getattr(self, "placar", None)
        if pl is not None and pl.pausa_pedida:
            raise PausaPedida()

    def _pulsar(self):
        """Batimento dentro da tabela (a cada lote commitado, limitado pelo Batimento.INTERVALO)."""
        pulsar = getattr(getattr(self, "progresso", None), "pulsar", None)
        if pulsar is not None:
            t = getattr(self, "_tab_atual", None)
            pulsar(len(self.vistas.get(t) or ()) if t and isinstance(getattr(self, "vistas", None), dict) else None)

    def _um(self, sql, args=()):
        with self._c() as c:
            c.execute(sql, args)
            r = c.fetchone()
            return r[0] if r else None

    def _todas(self, sql, args=()):
        with self._c() as c:
            c.execute(sql, args)
            return c.fetchall()

    def _existe(self, tabela, coluna, valor):
        """Unicidade conferida pelo próprio banco (mesma collation do índice único: sem acento e sem caixa)."""
        return valor is not None and bool(self._um("SELECT COUNT(*) FROM `%s` WHERE `%s`=%%s" % (tabela, coluna),
                                                   (valor,)))

    def _inserir(self, tabela, valores):
        # `criado_em` declarado (data de gravação da origem, rodada 6) vale; sem valor, o relógio do banco
        cols = [c for c in valores if c != "criado_em"]
        marcas = ["%s"] * len(cols)
        args = [valores[k] for k in cols]
        cols.append("criado_em")
        if valores.get("criado_em") is not None:
            marcas.append("%s")
            args.append(valores["criado_em"])
        else:
            marcas.append(AGORA)
        sql = "INSERT INTO `%s` (%s) VALUES (%s)" % (tabela, ", ".join("`%s`" % c for c in cols), ", ".join(marcas))
        with self._c() as c:
            c.execute(sql, args)
            return c.lastrowid

    def _carregar_existente(self, tab):
        with self._c() as c:
            c.execute("SELECT chave_original, id_destino, hash_linha, hash_destino, regra_recusa, gravidade_recusa"
                      " FROM %s.conector_origem WHERE tabela_origem=%%s" % self.ctl, (tab,))
            self.existente[tab] = {k: (i, bytes(h), bytes(hd) if hd is not None else None, r, g)
                                   for k, i, h, hd, r, g in c.fetchall()}

    def _registrar(self, tab, chave, entidade, id_destino, h, hd=None, recusa=None):
        regra, grav = recusa or (None, None)
        with self._c() as c:
            c.execute("INSERT INTO %s.conector_origem (tabela_origem, chave_original, entidade_destino, id_destino,"
                      " hash_linha, hash_destino, regra_recusa, gravidade_recusa, imagem_id, criado_em)"
                      " VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%%s,%%s,%%s,%s)"
                      " ON DUPLICATE KEY UPDATE id_destino=VALUES(id_destino), hash_linha=VALUES(hash_linha),"
                      " hash_destino=VALUES(hash_destino), regra_recusa=VALUES(regra_recusa),"
                      " gravidade_recusa=VALUES(gravidade_recusa), imagem_id=VALUES(imagem_id), alterado_em=%s,"
                      " versao=versao+1" % (self.ctl, AGORA, AGORA),
                      (tab, chave, entidade, id_destino, h, hd, regra, grav, self.img))
        t = self.existente.setdefault(tab, {})
        self._diario.append((tab, chave, t.get(chave)))
        t[chave] = (id_destino, h, hd, regra, grav)

    def _recusar(self, tab, chave, entidade, h, regra, grav, detalhe=None):
        self._pendencia(tab, chave, regra, grav, detalhe)
        self._registrar(tab, chave, entidade, None, h, recusa=(regra, grav))

    def _linha_nova(self, tab, chave, entidade, h, fazer):
        """Grava uma linha nova (todas as inserções dela) sob SAVEPOINT. Restrição violada no destino: desfaz só esta
        linha (banco, memória e pendências) e a recusa com o código do erro, sem valor. Devolve o retorno de `fazer`
        ou None."""
        marca = (len(self._diario), len(self.pend), len(self._buf), dict(self.cont))
        with self._c() as c:
            c.execute("SAVEPOINT linha_conector")
        try:
            return fazer()
        except pymysql.err.MySQLError as e:
            cod = e.args[0] if e.args and isinstance(e.args[0], int) else None
            if cod not in ERROS_LINHA:
                raise
            with self._c() as c:
                c.execute("ROLLBACK TO SAVEPOINT linha_conector")
            for t, k, ant in reversed(self._diario[marca[0]:]):
                if ant is None:
                    self.existente[t].pop(k, None)
                else:
                    self.existente[t][k] = ant
            del self._diario[marca[0]:]
            del self.pend[marca[1]:]
            del self._buf[marca[2]:]
            self.cont = marca[3]
            self.cont["recusas_por_restricao"] += 1
            self._recusar(tab, chave, entidade, h, "restricao_destino_%d" % cod, "critica", detalhe_erro(e))
            return None

    def _de_para(self, tab, chave):
        """id de destino da linha `chave` de `tab` já carregada: (id ou None, existe_registro)."""
        r = self.existente.get(tab, {}).get(str(chave))
        return (r[0], True) if r else (None, False)

    def _linhas(self, tab):
        m = MAPA[tab]
        disponiveis = {c["nome"] for c in self.lt.colunas(tab)}
        faltam = [c for c in m["colunas"] if c not in disponiveis]
        if faltam:
            raise ErroCarga("tabela %s sem as colunas do mapa: %s" % (tab, ", ".join(faltam)))
        pk = self.lt.chave_primaria(tab)
        inteira = pk == [m["chave"]] and next(c for c in self.lt.colunas(tab) if c["nome"] == m["chave"])[
            "codigo_tipo"] in (7, 8, 16)
        if inteira:
            for ini, fim in self.lt.faixas(tab, m["chave"]):
                nomes, it = self.lt.ler_faixa(tab, m["chave"], ini, fim, colunas=m["colunas"])
                for t in it:
                    yield dict(zip(nomes, t))
        else:
            nomes, it = self.lt.ler_tudo(tab, colunas=m["colunas"])
            i = nomes.index(m["chave"])  # sem chave inteira: ordem fixa pela chave (decisões de duplicidade estáveis)
            for t in sorted(it, key=lambda t: bytes(t[i]) if isinstance(t[i], (bytes, bytearray)) else str(t[i]).encode()):
                yield dict(zip(nomes, t))

    # Pendências que só existem enquanto o estado vale (recalculadas a cada execução) ou que registram um fato da
    # execução que as gerou: nunca reemitidas para a linha que não foi reprocessada.
    NAO_REEMITIR = frozenset(("alteracao_aguarda_sincronizar", "conflito_origem_venceu",
                              "mescla_conflito_origem_guardada"))

    def _reemitir_avisos(self, tab, chave, ja=None):
        """L10: linha da origem que esta execução NÃO reprocessa (igual; ou alterada no Importar, que não regrava)
        mantém as pendências abertas da execução anterior (ex.: segredo_aguarda_cofre, vigencia_sem_fonte): são
        copiadas para esta execução, para o relatório não as dar como resolvidas só porque a linha foi pulada.
        `ja`: regra já reemitida pela recusa."""
        if tab not in self._avisos_ant:
            av = {}
            with self._c() as c:
                c.execute("SELECT chave_original, regra, gravidade FROM %s.pendencia WHERE tabela_origem=%%s"
                          " AND situacao='aberta' AND execucao_id<%%s AND chave_original IS NOT NULL"
                          " AND chave_original<>'*' GROUP BY BINARY chave_original, regra, gravidade"
                          % self.ctl, (tab, int(self.eid)))
                for k, r, g in c.fetchall():
                    av.setdefault(k, set()).add((r, g))
            self._avisos_ant[tab] = av
        ck = str(chave)[:500]
        for r, g in sorted(self._avisos_ant[tab].get(ck, ())):
            if r in self.NAO_REEMITIR or r == ja:
                continue
            p = (tab, ck, r, g, None)
            self.pend.append(p)
            self._buf.append(p)
            self._reemitidas[(tab, ck, r)] = self._reemitidas.get((tab, ck, r), 0) + 1

    def _situacao(self, tab, chave, h):
        """'nova', 'igual' ou 'alterada', contra o estado guardado. Linha já vista e recusada: reemite a regra da
        recusa (todo recusado tem regra no resumo de toda execução). Alterada: pendência, e nada é regravado."""
        self.vistas.setdefault(tab, set()).add(chave)
        ant = self.existente.get(tab, {}).get(chave)
        if ant is None:
            return "nova", None
        if self._retentar(tab, ant):
            return "nova", None
        ja = None
        if ant[0] is None and not MAPA.get(tab, {}).get("sem_destino"):
            ja = ant[3] or "recusa_sem_regra_registrada"
            self._pendencia(tab, chave, ja, ant[4] or "alta")
        self._reemitir_avisos(tab, chave, ja)  # no Importar a linha já vista nunca é regravada
        if ant[1] == h:
            self.cont["puladas_iguais"] += 1
            return "igual", ant
        self.cont["alteradas_aguardam"] += 1
        self._pendencia(tab, chave, "alteracao_aguarda_sincronizar", "baixa")
        return "alterada", ant

    def _retentar(self, tab, ant):
        """Recusada já vista que esta passada tenta de novo (reprocessar_recusadas): id_destino nulo COM regra de recusa
        (a linha sem destino por natureza nunca é recusa). Gravando, nenhuma pendência dela se repete nesta execução, e
        a antiga fica resolvida (relatorio.resolver); recusada de novo, a pendência é a recalculada agora."""
        if not (self.reprocessar and ant[0] is None and ant[3]) or MAPA.get(tab, {}).get("sem_destino"):
            return False
        self.cont["recusadas_reprocessadas"] = self.cont.get("recusadas_reprocessadas", 0) + 1
        return True

    def _ciclo(self, tab, linha):
        m = MAPA[tab]
        chave = chave_txt(linha[m["chave"]])
        h = bytes.fromhex(hash_linha([linha[c] for c in m["colunas"]]))
        sit, ant = self._situacao(tab, chave, h)
        return chave, h, sit, ant

    def _ja_carregada(self, ent, chave, sit, ant):
        """Linha aceita numa execução anterior: entra na soma da origem com o resumo do que foi gravado (a conversão
        já foi provada quando a linha entrou); alterada na origem fica fora da soma, à espera do L9."""
        if sit == "alterada":
            self.aguardam.setdefault(ent, set()).add(chave)
        else:
            self.origem.setdefault(ent, {})[chave] = ant[2].hex() if ant[2] is not None else "sem_resumo_gravado"

    def _resumir(self, ent, chave, *campos):
        hd = resumo(campos)
        self.origem.setdefault(ent, {})[chave] = hd.hex()
        return hd

    # ----- catálogos -----
    def _catalogo(self, tabela, codigo, valores):
        cid = self._um("SELECT id FROM `%s` WHERE codigo=%%s" % tabela, (codigo,))
        if cid:
            return cid
        self.cont["catalogos_criados"] += 1
        return self._inserir(tabela, dict(codigo=codigo, **valores))

    def _preparar_catalogos(self):
        self.sexo = {}
        for sig, (cod, desc) in SEXOS.items():
            sid = self._um("SELECT id FROM sexo WHERE sigla=%s", (sig,))
            self.sexo[sig] = sid or self._catalogo("sexo", cod, {"descricao": desc, "sigla": sig})
        self.tipo = {}
        for tabela, itens in TIPOS_PROPRIOS.items():
            for cod, desc in itens:
                self.tipo[(tabela, cod)] = self._catalogo(tabela, cod, {"descricao": desc})
        with self._c() as c:
            c.execute("SELECT codigo_tiss, id FROM carater_atendimento_tiss")
            self.carater = {k: i for k, i in c.fetchall()}
            c.execute("SELECT codigo_ibge, id FROM municipio_ibge")
            self.municipio = {k: i for k, i in c.fetchall()}
        # C8: o código do município na origem vem com 6 dígitos (sem o dígito verificador do IBGE; agregado na cópia
        # real: 46.931 de 47.024 endereços com 6 dígitos, nenhum com 7). Os 6 primeiros dígitos identificam o
        # município no catálogo oficial (o 7º é verificador); só entra o prefixo que aponta para um município só.
        seis = {}
        for k, i in self.municipio.items():
            if k and len(k) == 7:
                seis.setdefault(k[:6], set()).add(i)
        self.municipio6 = {k: next(iter(v)) for k, v in seis.items() if len(v) == 1}
        self.municipio_cod = {i: k for k, i in self.municipio.items()}
        if not self.carater:
            self._pendencia("ATCABECATEND", None, "catalogo_oficial_ausente_carater_tiss", "critica")
        if not self.municipio:
            self._pendencia("RICADPAC", None, "catalogo_oficial_ausente_municipio_ibge", "alta")
        self._commit()

    # ----- entidades -----
    def _tipo_empresa(self, linhas):
        for l in linhas:
            chave, h, sit, ant = self._ciclo("TBTPEMP", l)
            if sit == "nova":
                self._registrar("TBTPEMP", chave, "tipo_empresa", None, h)
            self.origem.setdefault("tipo_empresa", {})[chave] = ""
        self._commit()

    def _estabelecimentos(self, linhas):
        for l in linhas:
            chave, h, sit, ant = self._ciclo("TBHOSPIT", l)
            if sit != "nova":
                if ant[0] is not None:
                    self._ja_carregada("estabelecimento", chave, sit, ant)
                continue
            razao = txt(l["NOME"], 150) or txt(l["NOME_HOT"], 150)
            if not razao:
                self._recusar("TBHOSPIT", chave, "estabelecimento", h, "nome_ausente", "critica"); continue
            codigo = codigo_estabelecimento(chave)
            if codigo != chave:
                self._pendencia("TBHOSPIT", chave, "codigo_derivado", "baixa")
            if self._existe("estabelecimento", "codigo", codigo):
                self._recusar("TBHOSPIT", chave, "estabelecimento", h, "codigo_duplicado", "critica"); continue
            doc, ruim = cnpj(l["CGC"])
            if ruim:
                self._pendencia("TBHOSPIT", chave, "cnpj_invalido", "media")
            if self._existe("estabelecimento", "cnpj", doc):
                self._pendencia("TBHOSPIT", chave, "cnpj_duplicado", "alta"); doc = None
            cnes = digitos(l["CNES"]); cnes = cnes.zfill(7) if cnes and len(cnes) <= 7 else None
            if self._existe("estabelecimento", "codigo_cnes", cnes):
                self._pendencia("TBHOSPIT", chave, "cnes_duplicado", "alta"); cnes = None
            cep = digitos(l["CEP"]); cep = cep.zfill(8) if cep and len(cep) <= 8 else None
            inicio, sent = data(l["DTINI"])
            if sent:
                self._pendencia("TBHOSPIT", chave, "data_sentinela", "baixa")
            num = digitos(l["NUMERO"])[:10] or None
            v = dict(codigo=codigo, nome_fantasia=txt(l["NOME_HOT"], 150) or razao, razao_social=razao,
                     cnpj=doc, codigo_cnes=cnes, cep=cep, logradouro=txt(l["ENDERECO"], 150),
                     numero=num, complemento=txt(l["COMPL"], 100), bairro_nome=txt(l["BAI"], 100),
                     telefone=txt(l["FONE"], 20), email=txt(l["EMAIL"], 254), inicio_atividade=inicio,
                     origem="migracao")
            razao_b = bruto(l["NOME"], 150) or bruto(l["NOME_HOT"], 150)
            hd = resumo((codigo, doc, cnes, cep, razao_b, bruto(l["NOME_HOT"], 150) or razao_b,
                         bruto(l["ENDERECO"], 150), bruto(l["BAI"], 100), num, inicio))

            def gravar():
                self._registrar("TBHOSPIT", chave, "estabelecimento", self._inserir("estabelecimento", v), h, hd)
                return True
            if self._linha_nova("TBHOSPIT", chave, "estabelecimento", h, gravar):
                self.origem.setdefault("estabelecimento", {})[chave] = hd.hex()
        self._commit()

    def _usuarios(self, linhas):
        agora = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None, microsecond=0)
        for l in linhas:
            chave, h, sit, ant = self._ciclo("TBUSERS", l)
            if sit != "nova":
                if ant[0] is not None:
                    self._ja_carregada("usuario", chave, sit, ant)
                continue  # recusada antes: segue recusada (a regra foi reemitida; o Sincronizar reavalia)
            login = login_de(l["NOME"])
            nome = txt(l["NOMEC"], 150) or txt(l["NOME"], 150)
            if not login or not nome:
                self._recusar("TBUSERS", chave, "usuario", h, "login_ausente", "alta"); continue
            if self._existe("usuario", "login", login):  # 'JOÃO' = 'joao' na collation do índice único
                self._recusar("TBUSERS", chave, "usuario", h, "login_duplicado", "alta"); continue
            doc, ruim = cpf(l["CPF"])
            if ruim:
                self._pendencia("TBUSERS", chave, "cpf_invalido", "media")
            if self._existe("usuario", "cpf", doc):
                self._pendencia("TBUSERS", chave, "cpf_duplicado", "alta"); doc = None
            if not doc:
                self._pendencia("TBUSERS", chave, "usuario_sem_cpf", "media")
            bloq = (txt(l["BLOQUEADO"]) or "").upper() == "S"
            situacao = "bloqueado" if bloq else ("inativo" if (txt(l["STATUS"]) or "").upper() == "I" else "ativo")
            nasc, sent = data(l["DT_NASC"])
            if sent:
                self._pendencia("TBUSERS", chave, "data_sentinela", "baixa")
            email = txt(l["E_MAIL"], 254)
            v = dict(login=login, nome=nome, cpf=doc, dispensa_cpf=doc is None, tipo_conta="pessoa",
                     situacao=situacao, bloqueado_em=agora if bloq else None, data_nascimento=nasc,
                     email=email if email and "@" in email else None, exige_troca_senha=True, origem="migracao")
            hd = resumo((login, doc, situacao, bruto(l["NOMEC"], 150) or bruto(l["NOME"], 150), nasc))
            if self._linha_nova("TBUSERS", chave, "usuario", h, lambda: self._registrar(
                    "TBUSERS", chave, "usuario", self._inserir("usuario", v), h, hd) or True):
                self.origem.setdefault("usuario", {})[chave] = hd.hex()
        self._commit()

    def _pacientes(self, linhas):
        self._enderecos_adiados = []
        pronts = {r[0] for r in self._todas("SELECT numero_prontuario FROM paciente")}
        cpfs = {r[0] for r in self._todas("SELECT cpf FROM pessoa_fisica WHERE cpf IS NOT NULL")}
        estab = self._estab_principal()
        n = 0
        for l in linhas:
            n += 1
            if n % 1000 == 0:
                self._commit()
            chave, h, sit, ant = self._ciclo("RICADPAC", l)
            if sit != "nova":
                if ant[0] is not None:
                    self._ja_carregada("paciente", chave, sit, ant)
                    self._subs_ja_carregadas(chave, l, somar=sit == "igual", h=h)
                continue
            nome = txt(l["NOME"], 150)
            pront = l["PRONT"] if isinstance(l["PRONT"], int) and l["PRONT"] > 0 else None
            regra = None if nome else "nome_ausente"
            regra = regra or (None if pront else "prontuario_ausente")
            regra = regra or ("prontuario_duplicado" if pront in pronts else None)
            if regra:
                self._recusar("RICADPAC", chave, "paciente", h, regra, "critica"); continue
            doc, ruim = cpf(l["CPF"])
            if ruim:
                self._pendencia("RICADPAC", chave, "cpf_invalido", "media")
            if doc and doc in cpfs:
                self._pendencia("RICADPAC", chave, "cpf_duplicado", "alta"); doc = None
            nasc, sent = data(l["NASC"])
            if sent:
                self._pendencia("RICADPAC", chave, "data_sentinela", "baixa")
            obito, s2 = data(l["DTOBITO"])
            if s2:
                self._pendencia("RICADPAC", chave, "data_sentinela", "baixa")
            if obito and nasc and obito < nasc:
                self._pendencia("RICADPAC", chave, "obito_antes_nascimento", "alta"); obito = None
            situacao = "obito" if obito else ("inativo" if (txt(l["ATIVO"]) or "S").upper() == "N" else "ativo")
            cns = digitos(l["CNS"])
            if cns and len(cns) != 15:
                self._pendencia("RICADPAC", chave, "cns_invalido", "baixa"); cns = ""
            sexo = (txt(l["SEXO"]) or "").upper()
            pf = dict(nome=nome, cpf=doc, cns=cns or None, data_nascimento=nasc, sexo_id=self.sexo.get(sexo),
                      nome_mae=txt(l["MAE"], 150), nome_pai=txt(l["PAI"], 150), falecida=bool(obito),
                      data_obito=obito, origem="migracao")
            hd = resumo((pront, nasc, doc, situacao, bruto(l["NOME"], 150), bruto(l["MAE"], 150), cns or None, obito))
            subs = []

            def gravar():
                pfid = self._inserir("pessoa_fisica", pf)
                pid = self._inserir("paciente", dict(pessoa_fisica_id=pfid, numero_prontuario=pront, situacao=situacao,
                                                     falecido=bool(obito), nome_mae=pf["nome_mae"],
                                                     cadastro_estabelecimento_id=estab, origem="migracao"))
                self._registrar("RICADPAC", chave, "paciente", pid, h, hd)
                subs.extend(self._sub_paciente(chave, l, pfid, h))
                return True
            if self._linha_nova("RICADPAC", chave, "paciente", h, gravar):
                self.origem.setdefault("paciente", {})[chave] = hd.hex()
                for ent, k, v in subs:
                    if ent == ADIAR_ENDERECO:
                        self._enderecos_adiados.append(v)
                        continue
                    self.origem.setdefault(ent, {})[k] = v
                pronts.add(pront)
                if doc:
                    cpfs.add(doc)
        self._commit()
        self._resolver_enderecos()

    SUBS = (("IDENT", "documento", "documento_pessoa"), ("ENDERECO", "endereco", "endereco_pessoa"),
            ("FONE", "telefone_residencial", "telefone_pessoa"), ("CELULAR", "telefone_celular", "telefone_pessoa"))

    @staticmethod
    def _presente(col, v):
        """C8: a subentidade existe na origem. Telefone só com dígitos: a máscara vazia da origem (só pontuação e
        espaço; 33.158 de 33.161 telefones "inválidos" na cópia real, agregado) não é telefone, e não gera recusa."""
        return bool(digitos(v)) if col in ("FONE", "CELULAR") else bool(txt(v))

    AGUARDA_EVIDENCIA = "endereco_aguarda_evidencia"

    def _refazer_sub(self, chave, l, h, col, sub, ant):
        """Subentidade do paciente já gravado que esta passada refaz pelas regras atuais: a recusada, com
        CONECTOR_REPROCESSAR_RECUSADAS (ex.: as correções do C8 chegam ao cliente já carregado), e o endereço que ficou
        à espera da evidência do CEP numa execução interrompida antes de resolvê-lo (registro provisório
        `endereco_aguarda_evidencia`, ou sem registro nenhum)."""
        if sub == "endereco" and (ant is None or ant[0] is None and ant[3] == self.AGUARDA_EVIDENCIA):
            return True
        return bool(self.reprocessar and ant is not None and ant[0] is None and ant[3])

    def _subs_ja_carregadas(self, chave, l, somar=True, h=None):
        """Paciente já carregado: reemite a regra das subentidades recusadas e os avisos abertos das gravadas (L10:
        município estimado, DDD do outro telefone continuam pendentes) e, se igual, põe as subentidades que a linha
        da origem produz na soma, com o resumo gravado; a recusada (com reprocessar) e o endereço que aguardava a
        evidência são refeitos pelas regras atuais. Alterado (fora da soma): só a reemissão."""
        for col, sub, ent in self.SUBS:
            k = "%s/%s" % (chave, sub)
            ant = self.existente.get("RICADPAC", {}).get(k)
            if ant is not None and ant[0] is not None:
                self._reemitir_avisos("RICADPAC", k)
            if not somar:
                if ant is not None and ant[0] is None:
                    self._pendencia("RICADPAC", k, ant[3] or "recusa_sem_regra_registrada", ant[4] or "baixa")
                continue
            if not self._presente(col, l[col]):
                continue
            if h is not None and self._refazer_sub(chave, l, h, col, sub, ant):
                self._refazer(chave, l, h, sub, ent, k)
                continue
            if ant is None:
                v = "sem_registro"
            elif ant[0] is None:
                v = RECUSADO
                self._pendencia("RICADPAC", k, ant[3] or "recusa_sem_regra_registrada", ant[4] or "baixa")
            else:
                v = ant[2].hex() if ant[2] is not None else "sem_resumo_gravado"
            self.origem.setdefault(ent, {})[k] = v

    def _refazer(self, chave, l, h, sub, ent, k):
        """Refaz uma subentidade do paciente já gravado, sob o SAVEPOINT dela, ligada à pessoa do paciente e na
        sequência seguinte; restrição do destino recusa só ela."""
        pid = self.existente["RICADPAC"][chave][0]
        pfid = self._todas("SELECT pessoa_fisica_id FROM paciente WHERE id=%s", (pid,))[0][0]
        seq = 0
        if sub.startswith("telefone_"):
            seq = self._todas("SELECT COALESCE(MAX(sequencia), 0) FROM telefone_pessoa WHERE pessoa_fisica_id=%s",
                              (pfid,))[0][0] or 0
        self.cont["recusadas_reprocessadas"] = self.cont.get("recusadas_reprocessadas", 0) + 1
        out = []

        def fazer():
            out[:] = self._sub_paciente(chave, l, pfid, h, so={sub}, seq=int(seq))
            return True
        if not self._linha_nova("RICADPAC", k, ent, h, fazer):
            self.origem.setdefault(ent, {})[k] = RECUSADO
            return
        for e, kk, v in out:
            if e == ADIAR_ENDERECO:
                self._enderecos_adiados = getattr(self, "_enderecos_adiados", [])
                self._enderecos_adiados.append(v)
            else:
                self.origem.setdefault(e, {})[kk] = v

    def _sub_paciente(self, chave, l, pfid, h, so=None, seq=0):
        """Documento, endereço e telefones da pessoa (dentro do SAVEPOINT do paciente). Devolve as linhas da soma da
        origem: (entidade, chave, resumo ou RECUSADO). `so`: só essas subentidades (refeitas), telefones a partir
        da sequência `seq`."""
        out = []

        def sub(nome, ent, idd, campos, recusa=None):
            k = "%s/%s" % (chave, nome)
            if recusa:
                self._recusar("RICADPAC", k, ent, h, *recusa)
                out.append((ent, k, RECUSADO))
            else:
                hd = resumo(campos)
                self._registrar("RICADPAC", k, ent, idd, h, hd)
                out.append((ent, k, hd.hex()))
        ident = txt(l["IDENT"], 40)
        if ident and (so is None or "documento" in so):
            did = self._inserir("documento_pessoa", dict(
                pessoa_fisica_id=pfid, sequencia=1, numero=ident,
                tipo_documento_identificacao_id=self.tipo[("tipo_documento_identificacao", "rg")], principal=True,
                origem="migracao"))
            sub("documento", "documento_pessoa", did, (bruto(l["IDENT"], 40),))
        notas = []
        if txt(l["ENDERECO"]) and (so is None or "endereco" in so):
            cep = cep_origem(l["CEP"])
            ibge = digitos(l["IBGE"])
            mun = municipio_ibge(ibge, self.municipio, getattr(self, "municipio6", {}))
            if cep and not mun:
                # C8 (ADR 0007, 18): município estimado pelo CEP com a evidência dos endereços já gravados no cliente;
                # a evidência depende dos outros pacientes, então o endereço é resolvido no fim (_resolver_enderecos)
                # registro provisório: interrompida a execução antes do fim, a próxima passada resolve o endereço
                # (_subs_ja_carregadas), em vez de perdê-lo em silêncio
                self._registrar("RICADPAC", "%s/endereco" % chave, "endereco_pessoa", None, h,
                                recusa=(self.AGUARDA_EVIDENCIA, "baixa"))
                out.append((ADIAR_ENDERECO, "%s/endereco" % chave, (chave, l, pfid, h)))
            elif not cep:
                sub("endereco", "endereco_pessoa", None, None, ("endereco_sem_cep_ou_municipio", "media"))
                notas.append(nota_endereco(l))
            else:
                self._gravar_endereco(chave, l, pfid, h, cep, mun, ibge, sub)
        lidos = {}
        for col, nome, _ in self.SUBS[2:]:
            if self._presente(col, l[col]):
                lidos[col] = telefone(l[col])
        # C8 (ADR 0007, 18): número local de 8 ou 9 dígitos sem DDD: o DDD do outro telefone válido da mesma linha
        ddd_linha = next((t[0] for t, ruim in lidos.values() if t and not ruim), None)
        for col, nome, _ in self.SUBS[2:]:
            if col not in lidos or so is not None and nome not in so:
                continue
            tel, ruim = lidos[col]
            estimado = False
            if (ruim or not tel) and ddd_linha:
                tel = local_com_ddd(l[col], ddd_linha)
                estimado = tel is not None
            if ruim and not estimado or not tel:
                sub(nome, "telefone_pessoa", None, None, ("telefone_invalido", "baixa"))
                notas.append("Telefone da origem não reconhecido (%s): %s" % (col, txt(l[col], 40)))
                continue
            if estimado:
                self._pendencia("RICADPAC", "%s/%s" % (chave, nome), "telefone_ddd_do_outro_telefone", "baixa")
            seq += 1
            tipo = nome.split("_", 1)[1]
            tid = self._inserir("telefone_pessoa", dict(
                pessoa_fisica_id=pfid, sequencia=seq, ddi="55", ddd=tel[0], numero=tel[1],
                tipo_telefone_id=self.tipo[("tipo_telefone", tipo)], principal=seq == 1, origem="migracao"))
            sub(nome, "telefone_pessoa", tid, (tel[0], tel[1]))
        if notas:
            self._anotar_pessoa(pfid, notas)
        return out

    def _gravar_endereco(self, chave, l, pfid, h, cep, mun, ibge, sub):
        num = digitos(l["NUMERO"])[:10] or None
        eid = self._inserir("endereco_pessoa", dict(
            pessoa_fisica_id=pfid, sequencia=1, tipo_endereco_id=self.tipo[("tipo_endereco", "residencial")],
            logradouro=txt(l["ENDERECO"], 150), cep=cep, municipio_ibge_id=mun, numero=num,
            sem_numero=not num, complemento=txt(l["COMPL"], 100), bairro_nome=txt(l["BAIRRO"], 100),
            principal=True, origem="migracao"))
        # o resumo leva o código do catálogo (7 dígitos), o mesmo que a conferência lê do destino
        ibge = getattr(self, "municipio_cod", {}).get(mun, ibge)
        sub("endereco", "endereco_pessoa", eid, (bruto(l["ENDERECO"], 150), cep, ibge, num,
                                                 bruto(l["COMPL"], 100), bruto(l["BAIRRO"], 100)))

    def _anotar_pessoa(self, pfid, notas):
        """ADR 0006 (nada perdido): o que a origem tinha e não virou subentidade fica na observação da pessoa."""
        with self._c() as c:  # idempotente: a nota já anotada (passada de reprocesso) não se repete
            for n in notas:
                c.execute("UPDATE pessoa_fisica SET observacao=CONCAT_WS('\\n', observacao, %s) WHERE id=%s"
                          " AND (observacao IS NULL OR LOCATE(%s, observacao)=0)", (n, pfid, n))

    MIN_EVIDENCIA_FAIXA = 3  # endereços (não estimados) da faixa de 5 dígitos, todos do mesmo município

    def _evidencia_cep(self):
        """(CEP -> município, faixa de 5 dígitos -> município) dos endereços do cliente, só onde a evidência aponta
        para um município só. Calculada UMA vez, no fim da carga dos pacientes, e nunca com os endereços que o próprio
        conector estimou (pendência municipio_estimado_* em qualquer execução): estimativa não é evidência, e o
        resultado não depende da ordem dos lotes. A faixa exige MIN_EVIDENCIA_FAIXA endereços."""
        por_cep, por_faixa = {}, {}
        for cep, mun, n in self._todas(
                "SELECT e.cep, e.municipio_ibge_id, COUNT(*) FROM endereco_pessoa e"
                " WHERE e.cep IS NOT NULL AND e.municipio_ibge_id IS NOT NULL AND e.id NOT IN ("
                "SELECT o.id_destino FROM {0}.conector_origem o JOIN {0}.pendencia p"
                " ON p.tabela_origem=o.tabela_origem AND p.chave_original=o.chave_original"
                " WHERE o.tabela_origem='RICADPAC' AND o.id_destino IS NOT NULL AND p.regra IN"
                " ('municipio_estimado_pelo_cep', 'municipio_estimado_pela_faixa_do_cep'))"
                " GROUP BY e.cep, e.municipio_ibge_id".format(self.ctl)):
            por_cep.setdefault(cep, set()).add(mun)
            f = por_faixa.setdefault(cep[:5], {})
            f[mun] = f.get(mun, 0) + int(n)
        return ({k: next(iter(v)) for k, v in por_cep.items() if len(v) == 1},
                {k: next(iter(v)) for k, v in por_faixa.items()
                 if len(v) == 1 and sum(v.values()) >= self.MIN_EVIDENCIA_FAIXA})

    def _resolver_enderecos(self):
        """C8 (ADR 0007, 18): endereço com CEP e sem município do catálogo. Município pela evidência do cliente: o
        único do mesmo CEP (pendência baixa `municipio_estimado_pelo_cep`) ou o único da faixa de 5 dígitos
        (`municipio_estimado_pela_faixa_do_cep`). Sem evidência: recusa `endereco_sem_cep_ou_municipio` e o endereço
        como veio fica na observação da pessoa (ADR 0006)."""
        adiados, self._enderecos_adiados = getattr(self, "_enderecos_adiados", []), []
        if not adiados:
            return
        por_cep, por_faixa = self._evidencia_cep()
        for chave, l, pfid, h in adiados:
            cep = cep_origem(l["CEP"])
            k = "%s/endereco" % chave
            mun, regra = por_cep.get(cep), "municipio_estimado_pelo_cep"
            if mun is None:
                mun, regra = por_faixa.get(cep[:5]), "municipio_estimado_pela_faixa_do_cep"
            feitos = []

            def sub(nome, ent, idd, campos, recusa=None):
                if recusa:
                    self._recusar("RICADPAC", k, ent, h, *recusa)
                    feitos.append(RECUSADO)
                else:
                    hd = resumo(campos)
                    self._registrar("RICADPAC", k, ent, idd, h, hd)
                    feitos.append(hd.hex())
            if mun is None:
                sub("endereco", "endereco_pessoa", None, None, ("endereco_sem_cep_ou_municipio", "media"))
                self._anotar_pessoa(pfid, [nota_endereco(l)])
            else:
                def fazer():
                    self._gravar_endereco(chave, l, pfid, h, cep, mun, digitos(l["IBGE"]), sub)
                    self._pendencia("RICADPAC", k, regra, "baixa")
                    return True
                if not self._linha_nova("RICADPAC", k, "endereco_pessoa", h, fazer):
                    feitos[:] = [RECUSADO]
            self.origem.setdefault("endereco_pessoa", {})[k] = feitos[-1] if feitos else RECUSADO
        self._commit()

    def _estab_principal(self):
        """O estabelecimento do atendimento: o de menor código entre os carregados da origem (a origem medida tem
        um só; com mais de um, pendência para o de-para por unidade, que entra no L5)."""
        ids = [(k, v[0]) for k, v in self.existente.get("TBHOSPIT", {}).items() if v[0]]
        if len(ids) > 1 and not getattr(self, "_avisou_estab", False):
            self._avisou_estab = True
            self._pendencia("TBHOSPIT", None, "varios_estabelecimentos_atendimento_no_principal", "baixa")
        if not ids:
            return None
        return sorted(ids, key=lambda kv: (len(kv[0]), kv[0]))[0][1]

    def _pre(self, tab, linhas):
        """REALTA e RECADATE: lidos antes do atendimento (o desfecho entra junto com o atendimento)."""
        self.pre[tab] = [(chave_txt(l[MAPA[tab]["chave"]]), l, bytes.fromhex(
            hash_linha([l[c] for c in MAPA[tab]["colunas"]]))) for l in linhas]

    def _provisorio(self, tab, chave, criar):
        idd, existe = self._de_para(tab, chave)
        if existe:
            return idd
        idd = criar()
        self.cont["provisorios"] += 1
        self._pendencia(tab, chave, "cadastro_provisorio_a_completar", "baixa")
        self._registrar(tab, chave, tab == "TBCONVEN" and "fonte_pagadora" or "profissional", idd, HASH_ZERO)
        return idd

    def _fonte(self, conv):
        chave = str(conv)
        return self._provisorio("TBCONVEN", chave, lambda: self._inserir("fonte_pagadora", dict(
            codigo=("origem-%s" % chave)[:30], nome="Fonte pagadora %s da origem (a completar)" % chave, tipo="outro",
            origem="migracao")))

    def _profissional(self, cbo):
        chave = str(cbo) if cbo else "nao_informado"

        def criar():
            pf = self._inserir("pessoa_fisica", dict(nome="Profissional %s da origem (a completar)" % chave,
                                                     origem="migracao"))
            return self._inserir("profissional", dict(pessoa_fisica_id=pf, tipo="assistencial", origem="migracao"))
        return self._provisorio("TBCBOPRO", chave, criar)

    def _atendimentos(self, linhas):
        # alta: REALTA -> RECADATE -> atendimento
        ficha_atend = {k: l["ID_ATCABECATEND"] for k, l, _ in self.pre.get("RECADATE", [])}
        altas = {}
        for k, l, _ in self.pre.get("REALTA", []):
            at = ficha_atend.get(k)
            if at is not None and l["DATA_HORA"] is not None:
                altas[str(at)] = max(altas.get(str(at), l["DATA_HORA"]), l["DATA_HORA"])
        estab = self._estab_principal()
        numeros = {r[0] for r in self._todas("SELECT numero FROM atendimento WHERE estabelecimento_id=%s", (estab,))} \
            if estab else set()
        categoria = {}
        n = 0
        for l in linhas:
            n += 1
            if n % 1000 == 0:
                self._commit()
            chave, h, sit, ant = self._ciclo("ATCABECATEND", l)
            if sit != "nova":
                if ant[0] is not None:
                    self._ja_carregada("atendimento", chave, sit, ant)
                continue
            numero = str(l["COD_ATENDIMENTO"])[:20] if l["COD_ATENDIMENTO"] is not None else None
            pac_chave = str(l["ID_RICADPAC"])
            pac, pac_existe = self._de_para("RICADPAC", pac_chave)
            tp = (txt(l["TP_ATENDIMENTO"]) or "").upper()
            car, car_pend = carater_do_atendimento(l["CARATER_ATEND"], tp)
            entrada, s0 = momento(l["DATA_HORA_ENTRADA"])
            regra = None
            if not estab:
                regra = ("estabelecimento_ausente", "critica")
            elif not pac:
                regra = ("pai_pendente" if pac_existe else "paciente_inexistente", "critica")
            elif not numero or numero in numeros:
                regra = ("numero_duplicado" if numero else "numero_ausente", "critica")
            elif tp not in CATEGORIAS:
                regra = ("categoria_desconhecida", "alta")
            elif car not in self.carater:
                regra = ("catalogo_oficial_ausente_carater_tiss", "critica")
            elif entrada is None:  # depois de momento(): sentinela (1899-12-30, ano < 1800) também não serve
                regra = ("entrada_sentinela" if s0 else "entrada_ausente", "critica")
            if regra:
                self._recusar("ATCABECATEND", chave, "atendimento", h, *regra); continue
            if car_pend:
                self._pendencia("ATCABECATEND", chave, car_pend,
                                "baixa" if car_pend == "carater_estimado" else "media")
            saida, s1 = momento(l["DATA_HORA_SAIDA_EFETIVA"])
            if saida and saida < entrada:
                self._pendencia("ATCABECATEND", chave, "saida_antes_entrada", "media"); saida = None
            alta, s2 = momento(l["DATA_HORA_ALTA_MEDICA"] or altas.get(chave))
            if alta and alta < entrada:
                self._pendencia("ATCABECATEND", chave, "alta_antes_entrada", "media"); alta = None
            if s1 or s2:
                self._pendencia("ATCABECATEND", chave, "data_sentinela", "baixa")
            desfecho = None
            if (txt(l["ATIVO"]) or "S").upper() == "N":
                situacao = "cancelado"
            elif saida:
                situacao = "encerrado"
                desfecho = "alta" if (chave in altas or alta) else "administrativo"
                if desfecho == "administrativo":
                    self._pendencia("ATCABECATEND", chave, "desfecho_nao_informado", "baixa")
            else:
                situacao = "aberto"
            hd = resumo((numero, pac_chave, entrada, saida, alta, situacao, desfecho))

            def gravar():
                if tp not in categoria:
                    cod, desc = CATEGORIAS[tp]
                    categoria[tp] = self._catalogo("categoria_atendimento", cod, {"descricao": desc, "tipo_base": cod})
                v = dict(estabelecimento_id=estab, numero=numero, paciente_id=pac,
                         categoria_atendimento_id=categoria[tp], carater_atendimento_tiss_id=self.carater[car],
                         fonte_pagadora_id=self._fonte(l["ID_TBCONVEN"]),
                         profissional_id=self._profissional(l["ID_TBCBOPRO_ATENDIMENTO"]), entrada_em=entrada,
                         saida_em=saida, alta_medica_em=alta, situacao=situacao, desfecho=desfecho, origem="migracao")
                self._registrar("ATCABECATEND", chave, "atendimento", self._inserir("atendimento", v), h, hd)
                return True
            cat_antes = dict(categoria)
            if self._linha_nova("ATCABECATEND", chave, "atendimento", h, gravar):
                self.origem.setdefault("atendimento", {})[chave] = hd.hex()
                numeros.add(numero)
                self.atend_novos.add(chave)
            else:
                categoria.clear(); categoria.update(cat_antes)
        self._commit()
        # fichas (RECADATE) e altas (REALTA) ligadas ao atendimento de destino
        for tab, pai_de in (("RECADATE", lambda k, l: str(l["ID_ATCABECATEND"])),
                            ("REALTA", lambda k, l: str(ficha_atend.get(k)) if k in ficha_atend else None)):
            ent = ENT_FILHA[tab]
            for k, l, h in self.pre.get(tab, []):
                sit, ant = self._situacao(tab, k, h)
                if sit != "nova":
                    if ant[0] is not None:
                        self._ja_carregada(ent, k, sit, ant)
                    continue
                pai = pai_de(k, l)
                aid, existe = self._de_para("ATCABECATEND", pai) if pai else (None, False)
                if aid is None:
                    self._recusar(tab, k, "atendimento", h, "pai_pendente" if existe else "atendimento_inexistente",
                                  "alta")
                    continue
                if tab == "REALTA" and pai not in self.atend_novos:
                    # a alta muda o atendimento já carregado (alta_medica_em, desfecho): só o Sincronizar (L9) aplica
                    self._recusar(tab, k, "atendimento", h, "alta_de_atendimento_ja_carregado_aguarda_sincronizar",
                                  "baixa")
                    continue
                hd = resumo((pai,))
                self._registrar(tab, k, "atendimento", aid, h, hd)
                self.origem.setdefault(ent, {})[k] = hd.hex()
        self._commit()

    # ----- execução -----
    def executar(self, presentes, contagens):
        """`presentes`: tabelas da origem; carrega só as do mapa que existem. Devolve o resumo por entidade."""
        self.tabelas = [t for t in ORDEM if t in presentes]
        if not self.tabelas:
            return {}
        for t in self.tabelas:
            self._carregar_existente(t)
        for t in ("TBCONVEN", "TBCBOPRO"):
            self._carregar_existente(t)
        self._preparar_catalogos()
        fn = {"TBTPEMP": self._tipo_empresa, "TBHOSPIT": self._estabelecimentos, "TBUSERS": self._usuarios,
              "RICADPAC": self._pacientes, "ATCABECATEND": self._atendimentos,
              "REALTA": lambda ls: self._pre("REALTA", ls), "RECADATE": lambda ls: self._pre("RECADATE", ls)}
        if "ATCABECATEND" in self.tabelas and "RICADPAC" not in self.tabelas:
            raise ErroCarga("atendimento sem a tabela de pacientes na origem")
        from . import continuar
        grupo = {t for t in continuar.GRUPO_PROPRIA if t in self.tabelas}
        pulados = grupo if grupo and grupo <= set(getattr(self, "pular", None) or {}) and not self.reprocessar else set()
        if pulados:  # continuação: pendências antes da marca (sem a marca, a próxima herda da anterior pela cadeia)
            self.cont["pendencias_repetidas"] = continuar.repetir_pendencias(
                self, {t: self.pular[t] for t in pulados},
                lambda n: self.progresso(0, "pendências herdadas do atendimento já concluído (%d)" % n),
                excluir_regras=continuar.CONCILIACAO_PROPRIA, entre_tabelas=self._entre_tabelas_pausa)
            continuar.marcar(self, pulados, None, "continuada")
        pl = getattr(self, "placar", None)
        for i, t in enumerate(self.tabelas):
            self._tab_atual = t
            self.progresso(i / len(self.tabelas), "carregando %s" % MAPA[t]["entidade"])
            if t in pulados:
                self._reconstruir(t)
                if pl is not None:
                    self._placar_rebase()  # o refeito do controle não é linha processada nesta execução
                    pl.fim(t, evento=False)
                continue
            if pl is not None:
                pl.inicio(t)
            fn[t](self._linhas(t))
            self._commit()
            if pl is not None:
                pl.fim(t)
            # marca de concluída depois do commit (base da continuação); o grupo do atendimento só junto, quando o
            # atendimento gravou as fichas e as altas lidas antes dele
            if t not in grupo:
                continuar.marcar(self, [t])
            elif t == "ATCABECATEND":
                continuar.marcar(self, grupo)
        self._commit()
        res = self.conciliar(contagens)
        self._commit()
        return res

    def _reconstruir(self, t):
        """Tabela do grupo do atendimento pulada na continuação: chaves vistas e soma da origem refeitas do
        conector_origem pelo mesmo caminho da linha "igual" de uma reexecução (concluidas_propria garante o mesmo
        arquivo, a contagem exata de chaves e nenhuma alterada); a origem não é lida."""
        ent = "atendimento" if t == "ATCABECATEND" else ENT_FILHA[t]
        vistas = self.vistas.setdefault(t, set())
        for k, ant in self.existente.get(t, {}).items():
            vistas.add(k)
            if ant[0] is not None:
                self._ja_carregada(ent, k, "igual", ant)
        self.cont["puladas_continuacao"] = self.cont.get("puladas_continuacao", 0) + len(vistas)

    # ----- conciliação (destino relido do banco) -----
    # (entidade, tabela de origem, SELECT chave, campos do resumo (mesma ordem do lado da origem), editado)
    EDITADO = "(d.versao > 1 OR d.alterado_em IS NOT NULL)"
    DESTINO = {
        "estabelecimento": ("TBHOSPIT",
                            "SELECT co.chave_original, d.codigo, d.cnpj, d.codigo_cnes, d.cep, d.razao_social,"
                            " d.nome_fantasia, d.logradouro, d.bairro_nome, d.numero, d.inicio_atividade, {ed}"
                            " FROM {ctl}.conector_origem co JOIN estabelecimento d ON d.id=co.id_destino"
                            " AND d.origem='migracao' WHERE co.tabela_origem='TBHOSPIT'"),
        "usuario": ("TBUSERS",
                    "SELECT co.chave_original, d.login, d.cpf, d.situacao, d.nome, d.data_nascimento, {ed}"
                    " FROM {ctl}.conector_origem co JOIN usuario d ON d.id=co.id_destino AND d.origem='migracao'"
                    " WHERE co.tabela_origem='TBUSERS'"),
        "paciente": ("RICADPAC",
                     "SELECT co.chave_original, d.numero_prontuario, pf.data_nascimento, pf.cpf, d.situacao, pf.nome,"
                     " pf.nome_mae, pf.cns, pf.data_obito,"
                     " ({ed} OR pf.versao > 1 OR pf.alterado_em IS NOT NULL)"
                     " FROM {ctl}.conector_origem co JOIN paciente d ON d.id=co.id_destino AND d.origem='migracao'"
                     " JOIN pessoa_fisica pf ON pf.id=d.pessoa_fisica_id"
                     " WHERE co.tabela_origem='RICADPAC' AND co.entidade_destino='paciente'"),
        "atendimento": ("ATCABECATEND",
                        "SELECT co.chave_original, d.numero, cp.chave_original, d.entrada_em, d.saida_em,"
                        " d.alta_medica_em, d.situacao, d.desfecho, {ed}"
                        " FROM {ctl}.conector_origem co JOIN atendimento d ON d.id=co.id_destino"
                        " AND d.origem='migracao' LEFT JOIN {ctl}.conector_origem cp ON cp.entidade_destino='paciente'"
                        " AND cp.id_destino=d.paciente_id AND cp.tabela_origem='RICADPAC'"
                        " WHERE co.tabela_origem='ATCABECATEND'"),
        "atendimento_ficha": ("RECADATE",
                              "SELECT co.chave_original, ca.chave_original, {ed} FROM {ctl}.conector_origem co"
                              " JOIN atendimento d ON d.id=co.id_destino LEFT JOIN {ctl}.conector_origem ca"
                              " ON ca.entidade_destino='atendimento' AND ca.id_destino=d.id"
                              " AND ca.tabela_origem='ATCABECATEND' WHERE co.tabela_origem='RECADATE'"),
        "atendimento_alta": ("REALTA",
                             "SELECT co.chave_original, ca.chave_original, {ed} FROM {ctl}.conector_origem co"
                             " JOIN atendimento d ON d.id=co.id_destino LEFT JOIN {ctl}.conector_origem ca"
                             " ON ca.entidade_destino='atendimento' AND ca.id_destino=d.id"
                             " AND ca.tabela_origem='ATCABECATEND' WHERE co.tabela_origem='REALTA'"),
    }
    SUB = {"documento_pessoa": "SELECT co.chave_original, co.id_destino, d.id, d.numero, {ed}",
           "endereco_pessoa": "SELECT co.chave_original, co.id_destino, d.id, d.logradouro, d.cep, m.codigo_ibge,"
                              " d.numero, d.complemento, d.bairro_nome, {ed}",
           "telefone_pessoa": "SELECT co.chave_original, co.id_destino, d.id, d.ddd, d.numero, {ed}"}

    def _conferir(self, ent, tab, destino, vistas, excluir):
        """destino: {chave: (resumo hex, editado)} só das chaves vistas na origem. Linha diferente com rastro de
        edição no destino vira pendência (conflito visível), fora da soma; o resto tem de bater linha a linha."""
        origem = self.origem.get(ent, {})
        fora = set(excluir)
        editados = 0
        for k, (hx, ed) in destino.items():
            if k not in fora and ed and origem.get(k) != hx:
                self._pendencia(tab, k, "edicao_no_destino", "media")
                editados += 1
                fora.add(k)
        so = soma("%s|%s" % (k, v) for k, v in origem.items() if k not in fora)
        sd = soma("%s|%s" % (k, v[0]) for k, v in destino.items() if k not in fora)
        return so, sd, editados

    def conciliar(self, contagens):
        res = {}
        for ent, (tab, sql) in self.DESTINO.items():
            if tab not in self.tabelas:
                continue
            vistas = self.vistas.get(tab, set())
            destino, apagadas = {}, 0
            for r in self._todas(sql.format(ctl=self.ctl, ed=self.EDITADO)):
                if r[0] not in vistas:
                    apagadas += 1
                    self._pendencia(tab, r[0], "apagada_aguarda_sincronizar", "media")
                    continue
                destino[r[0]] = (resumo(r[1:-1]).hex(), bool(r[-1]))
            aguardam = self.aguardam.get(ent, set())
            so, sd, editados = self._conferir(ent, tab, destino, vistas, aguardam)
            recusadas = sum(1 for k in vistas if self.existente.get(tab, {}).get(k, (None,))[0] is None)
            lidos = int(contagens.get(tab, 0))
            ok = conciliacao_conferida(lidos, len(vistas), len(destino), recusadas, so, sd)
            res[ent] = {"tabela_origem": tab, "registros_origem": lidos, "registros_destino": len(destino),
                        "recusados": recusadas, "aguardam_sincronizar": len(aguardam),
                        "editados_no_destino": editados, "apagados_na_origem": apagadas,
                        "soma_origem": so, "soma_destino": sd, "conferido": ok}
        if "RICADPAC" in self.tabelas:
            pais_fora = self.aguardam.get("paciente", set())
            vistos = self.vistas.get("RICADPAC", set())
            for ent, sel in self.SUB.items():
                juncao = " LEFT JOIN `%s` d ON d.id=co.id_destino" % ent
                if ent == "endereco_pessoa":
                    juncao += " LEFT JOIN municipio_ibge m ON m.id=d.municipio_ibge_id"
                destino = {}
                for r in self._todas(sel.format(ed=self.EDITADO) + " FROM %s.conector_origem co%s WHERE"
                                     " co.tabela_origem='RICADPAC' AND co.entidade_destino=%%s" % (self.ctl, juncao),
                                     (ent,)):
                    pai = r[0].split("/", 1)[0]
                    if pai not in vistos or pai in pais_fora:
                        continue
                    if r[1] is None:
                        destino[r[0]] = (RECUSADO, False)
                    elif r[2] is None:
                        destino[r[0]] = ("destino_ausente", False)
                    else:
                        destino[r[0]] = (resumo(r[3:-1]).hex(), bool(r[-1]))
                so, sd, editados = self._conferir(ent, "RICADPAC", destino, None, ())
                origem = self.origem.get(ent, {})
                gravados = sum(1 for v in destino.values() if v[0] != RECUSADO)
                res[ent] = {"tabela_origem": "RICADPAC", "registros_origem": len(origem), "registros_destino": gravados,
                            "recusados": len(destino) - gravados, "editados_no_destino": editados,
                            "soma_origem": so, "soma_destino": sd,
                            "conferido": set(origem) == set(destino) and so == sd and not (destino and not gravados)}
        if "TBTPEMP" in self.tabelas:
            ks = [r[0] for r in self._todas("SELECT chave_original FROM %s.conector_origem WHERE tabela_origem="
                                            "'TBTPEMP'" % self.ctl)]
            vistas = self.vistas.get("TBTPEMP", set())
            ks = [k for k in ks if k in vistas]
            so, sd = soma(self.origem.get("tipo_empresa", {})), soma(ks)
            lidos = int(contagens.get("TBTPEMP", 0))
            res["tipo_empresa"] = {"tabela_origem": "TBTPEMP", "registros_origem": lidos,
                                   "registros_destino": len(ks), "recusados": 0, "soma_origem": so, "soma_destino": sd,
                                   "conferido": len(ks) == lidos and so == sd,
                                   "observacao": "de-para guardado; vira campo do estabelecimento"}
        aplicar_limite_recusa(res)
        pend = resumo_pendencias(self.pend, self.pend_repetidas, lambda t: ENTIDADE_DA_TABELA.get(t, "outra"))
        with self._c() as c:
            for ent, r in res.items():
                c.execute("INSERT INTO %s.conciliacao (execucao_id, entidade, registros_origem, registros_destino,"
                          " pendencias, soma_controle, conferido, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%%s,%s)"
                          " ON DUPLICATE KEY UPDATE registros_origem=VALUES(registros_origem),"
                          " registros_destino=VALUES(registros_destino), pendencias=VALUES(pendencias),"
                          " soma_controle=VALUES(soma_controle), conferido=VALUES(conferido), versao=versao+1"
                          % (self.ctl, AGORA),
                          (self.eid, ent, r["registros_origem"], r["registros_destino"], r["recusados"],
                           r["soma_destino"], r["conferido"]))
        return {"versao_mapa": VERSAO_MAPA, "entidades": res, "pendencias": pend, "carga": dict(self.cont)}
