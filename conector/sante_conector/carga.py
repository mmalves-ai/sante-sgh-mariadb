"""Carga das entidades do L3: estabelecimento, usuários, pacientes e atendimentos, com conciliação por entidade.

O mapa (MAPA, abaixo) é a única parte que conhece nomes da origem (regra 1: "no mapa do conector, como origem").
Para cada tabela: a entidade de destino, a chave original e SÓ as colunas lidas (credenciais e textos clínicos nunca
entram na leitura). O motor lê pelo usuário Firebird em transação READ ONLY; grava pelo usuário restrito da execução.

Regras (plano F4, seções 6, 6.1 e 7):
- toda linha lida fica em `conector_origem` (tabela, chave original, entidade, id de destino, hash dos bytes crus);
  linha recusada fica com id de destino NULL e uma pendência (tabela, chave, regra; nunca o valor);
- linha já carregada com o mesmo hash é pulada (a importação é idempotente); com hash diferente fica para o
  Sincronizar (L9), com pendência `alteracao_aguarda_sincronizar`;
- sentinelas (datas 1899-12-30, 1900-01-01, ano < 1800), CPF/CNPJ com dígito errado, telefone fora do padrão viram
  NULL com pendência; conversão CP1252 -> Unicode determinística (texto.py);
- catálogos PRÓPRIOS do cliente que o mapa exige (sexo, tipos de documento, endereço e telefone, categoria de
  atendimento) são criados com o código do mapa quando faltam; catálogo OFICIAL (caráter do atendimento TISS,
  municípios IBGE) nunca é criado aqui: sem ele, a linha vira pendência;
- convênio e profissional do atendimento ainda não têm carga própria (L5): entram como cadastro provisório, por
  chave da origem, registrado em `conector_origem` (hash zero) para a onda que os completar, com pendência;
- conciliação por entidade: registros lidos na origem = gravados no destino (lidos de volta do banco) + recusados,
  e soma de controle (sha256 da lista ordenada de chave e campos de negócio) calculada da origem e relida do
  destino. Só agregados saem daqui.
"""
import datetime
import decimal
import hashlib
import re

from .leitor import hash_linha
from .texto import cp1252_para_texto

VERSAO_MAPA = "l3-2026-11-21"

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
TIPOS_PROPRIOS = {
    "tipo_documento_identificacao": [("rg", "Registro geral (identidade)")],
    "tipo_endereco": [("residencial", "Residencial")],
    "tipo_telefone": [("residencial", "Residencial"), ("celular", "Celular")],
}
SENTINELAS = {datetime.date(1899, 12, 30), datetime.date(1900, 1, 1)}
AGORA = "UTC_TIMESTAMP(3)"
HASH_ZERO = b"\0" * 16
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
    if not s:
        return None
    return s[:limite] if limite else s


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


def fmt(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S.") + "%03d" % (v.microsecond // 1000)
    if isinstance(v, datetime.date):
        return v.isoformat()
    return str(v)


def soma(linhas):
    return hashlib.sha256("\n".join(sorted(linhas)).encode()).hexdigest()


def chave_txt(v):
    if isinstance(v, (bytes, bytearray)):
        return cp1252_para_texto(v).rstrip(" ")
    return str(v)


# ---------------- carga ----------------
class Carga:
    def __init__(self, leitor, cr, ctl, eid, imagem_id, progresso=None):
        self.lt, self.cr, self.ctl, self.eid, self.img = leitor, cr, "`%s`" % ctl, eid, imagem_id
        self.progresso = progresso or (lambda pct, etapa: None)
        self.pend = []                      # (tabela, chave, regra, gravidade)
        self.origem_soma = {}               # entidade-chave -> linhas "chave|campos"
        self.cont = {"catalogos_criados": 0, "provisorios": 0, "puladas_iguais": 0, "alteradas_aguardam": 0}
        self.existente = {}                 # tabela -> {chave: (id_destino, hash)}
        self.pre = {}                       # REALTA/RECADATE lidos antes do atendimento
        self.tabelas = []

    # ----- utilidades -----
    def _c(self):
        return self.cr.cursor()

    def _pendencia(self, tab, chave, regra, grav):
        self.pend.append((tab, None if chave is None else str(chave)[:500], regra, grav))

    def _um(self, sql, args=()):
        with self._c() as c:
            c.execute(sql, args)
            r = c.fetchone()
            return r[0] if r else None

    def _inserir(self, tabela, valores):
        cols = list(valores)
        sql = "INSERT INTO `%s` (%s, criado_em) VALUES (%s, %s)" % (
            tabela, ", ".join("`%s`" % c for c in cols), ", ".join(["%s"] * len(cols)), AGORA)
        with self._c() as c:
            c.execute(sql, [valores[k] for k in cols])
            return c.lastrowid

    def _carregar_existente(self, tab):
        with self._c() as c:
            c.execute("SELECT chave_original, id_destino, hash_linha FROM %s.conector_origem WHERE tabela_origem=%%s"
                      % self.ctl, (tab,))
            self.existente[tab] = {k: (i, bytes(h)) for k, i, h in c.fetchall()}

    def _registrar(self, tab, chave, entidade, id_destino, h):
        with self._c() as c:
            c.execute("INSERT INTO %s.conector_origem (tabela_origem, chave_original, entidade_destino, id_destino,"
                      " hash_linha, imagem_id, criado_em) VALUES (%%s,%%s,%%s,%%s,%%s,%%s,%s)"
                      " ON DUPLICATE KEY UPDATE id_destino=VALUES(id_destino), hash_linha=VALUES(hash_linha),"
                      " imagem_id=VALUES(imagem_id), alterado_em=%s, versao=versao+1" % (self.ctl, AGORA, AGORA),
                      (tab, chave, entidade, id_destino, h, self.img))
        self.existente.setdefault(tab, {})[chave] = (id_destino, h)

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

    def _ciclo(self, tab, linha):
        """(chave, hash, situação): 'nova', 'igual' ou 'alterada'."""
        m = MAPA[tab]
        chave = chave_txt(linha[m["chave"]])
        h = bytes.fromhex(hash_linha([linha[c] for c in m["colunas"]]))
        ant = self.existente.get(tab, {}).get(chave)
        if ant is None:
            return chave, h, "nova"
        if ant[1] == h:
            self.cont["puladas_iguais"] += 1
            return chave, h, "igual"
        self.cont["alteradas_aguardam"] += 1
        self._pendencia(tab, chave, "alteracao_aguarda_sincronizar", "baixa")
        return chave, h, "alterada"

    def _somar(self, entidade, *campos):
        self.origem_soma.setdefault(entidade, []).append("|".join(fmt(c) for c in campos))

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
        if not self.carater:
            self._pendencia("ATCABECATEND", None, "catalogo_oficial_ausente_carater_tiss", "critica")
        if not self.municipio:
            self._pendencia("RICADPAC", None, "catalogo_oficial_ausente_municipio_ibge", "alta")
        self.cr.commit()

    # ----- entidades -----
    def _tipo_empresa(self, linhas):
        for l in linhas:
            chave, h, sit = self._ciclo("TBTPEMP", l)
            if sit == "nova":
                self._registrar("TBTPEMP", chave, "tipo_empresa", None, h)
            self._somar("tipo_empresa", chave)

    def _estabelecimentos(self, linhas):
        cnpjs = set(r[0] for r in self._todas("SELECT cnpj FROM estabelecimento WHERE cnpj IS NOT NULL"))
        for l in linhas:
            chave, h, sit = self._ciclo("TBHOSPIT", l)
            if sit != "nova" and self._de_para("TBHOSPIT", chave)[0] is None:
                continue
            razao = txt(l["NOME"], 150) or txt(l["NOME_HOT"], 150)
            if not razao:
                self._pendencia("TBHOSPIT", chave, "nome_ausente", "critica")
                if sit == "nova":
                    self._registrar("TBHOSPIT", chave, "estabelecimento", None, h)
                continue
            doc, ruim = cnpj(l["CGC"])
            if ruim:
                self._pendencia("TBHOSPIT", chave, "cnpj_invalido", "media")
            if doc and doc in cnpjs and sit == "nova":
                self._pendencia("TBHOSPIT", chave, "cnpj_duplicado", "alta"); doc = None
            cnes = digitos(l["CNES"]); cnes = cnes.zfill(7) if cnes and len(cnes) <= 7 else None
            cep = digitos(l["CEP"]); cep = cep.zfill(8) if cep and len(cep) <= 8 else None
            inicio, sent = data(l["DTINI"])
            if sent:
                self._pendencia("TBHOSPIT", chave, "data_sentinela", "baixa")
            num = digitos(l["NUMERO"])
            self._somar("estabelecimento", chave, doc, cnes, cep)
            if sit != "nova":
                continue
            v = dict(codigo=chave[:30], nome_fantasia=txt(l["NOME_HOT"], 150) or razao, razao_social=razao,
                     cnpj=doc, codigo_cnes=cnes, cep=cep, logradouro=txt(l["ENDERECO"], 150),
                     numero=num[:10] or None, complemento=txt(l["COMPL"], 100), bairro_nome=txt(l["BAI"], 100),
                     telefone=txt(l["FONE"], 20), email=txt(l["EMAIL"], 254), inicio_atividade=inicio,
                     origem="migracao")
            if doc:
                cnpjs.add(doc)
            self._registrar("TBHOSPIT", chave, "estabelecimento", self._inserir("estabelecimento", v), h)
        self.cr.commit()

    def _todas(self, sql, args=()):
        with self._c() as c:
            c.execute(sql, args)
            return c.fetchall()

    def _usuarios(self, linhas):
        logins = {r[0].lower() for r in self._todas("SELECT login FROM usuario")}
        cpfs = {r[0] for r in self._todas("SELECT cpf FROM usuario WHERE cpf IS NOT NULL AND origem<>'migracao'")}
        vistos = set()  # duplicidade decidida na ordem da origem: igual em toda execução
        agora = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None, microsecond=0)
        for l in linhas:
            chave, h, sit = self._ciclo("TBUSERS", l)
            login = re.sub(r"[\s:]+", ".", (txt(l["NOME"]) or "").lower()).strip(".")[:60]
            nome = txt(l["NOMEC"], 150) or txt(l["NOME"], 150)
            if sit != "nova" and self._de_para("TBUSERS", chave)[0] is None:
                continue  # recusada antes: segue recusada (o Sincronizar reavalia)
            if sit == "nova" and (not login or not nome):
                self._pendencia("TBUSERS", chave, "login_ausente", "alta")
                self._registrar("TBUSERS", chave, "usuario", None, h); continue
            if sit == "nova" and login in logins:
                self._pendencia("TBUSERS", chave, "login_duplicado", "alta")
                self._registrar("TBUSERS", chave, "usuario", None, h); continue
            doc, ruim = cpf(l["CPF"])
            if ruim:
                self._pendencia("TBUSERS", chave, "cpf_invalido", "media")
            if doc and (doc in vistos or doc in cpfs):
                if sit == "nova":
                    self._pendencia("TBUSERS", chave, "cpf_duplicado", "alta")
                doc = None
            if doc:
                vistos.add(doc)
            if not doc and sit == "nova":
                self._pendencia("TBUSERS", chave, "usuario_sem_cpf", "media")
            bloq = (txt(l["BLOQUEADO"]) or "").upper() == "S"
            situacao = "bloqueado" if bloq else ("inativo" if (txt(l["STATUS"]) or "").upper() == "I" else "ativo")
            self._somar("usuario", chave, login, doc, situacao)
            if sit != "nova":
                continue
            nasc, sent = data(l["DT_NASC"])
            if sent:
                self._pendencia("TBUSERS", chave, "data_sentinela", "baixa")
            email = txt(l["E_MAIL"], 254)
            v = dict(login=login, nome=nome, cpf=doc, dispensa_cpf=doc is None, tipo_conta="pessoa",
                     situacao=situacao, bloqueado_em=agora if bloq else None, data_nascimento=nasc,
                     email=email if email and "@" in email else None, exige_troca_senha=True, origem="migracao")
            logins.add(login)
            self._registrar("TBUSERS", chave, "usuario", self._inserir("usuario", v), h)
        self.cr.commit()

    def _pacientes(self, linhas):
        pronts = {r[0] for r in self._todas("SELECT numero_prontuario FROM paciente")}
        cpfs = {r[0] for r in self._todas("SELECT cpf FROM pessoa_fisica WHERE cpf IS NOT NULL AND origem<>'migracao'")}
        vistos = set()
        self.pront_origem = {}
        estab = self._estab_principal()
        n = 0
        for l in linhas:
            n += 1
            if n % 1000 == 0:
                self.cr.commit()
            chave, h, sit = self._ciclo("RICADPAC", l)
            nome = txt(l["NOME"], 150)
            pront = l["PRONT"] if isinstance(l["PRONT"], int) and l["PRONT"] > 0 else None
            if sit == "nova":
                regra = None if nome else "nome_ausente"
                regra = regra or (None if pront else "prontuario_ausente")
                regra = regra or ("prontuario_duplicado" if pront in pronts else None)
                if regra:
                    self._pendencia("RICADPAC", chave, regra, "critica")
                    self._registrar("RICADPAC", chave, "paciente", None, h); continue
            elif self._de_para("RICADPAC", chave)[0] is None:
                continue  # recusada antes: segue recusada (o Sincronizar reavalia)
            self.pront_origem[chave] = pront
            doc, ruim = cpf(l["CPF"])
            if ruim:
                self._pendencia("RICADPAC", chave, "cpf_invalido", "media")
            if doc and (doc in vistos or doc in cpfs):
                if sit == "nova":
                    self._pendencia("RICADPAC", chave, "cpf_duplicado", "alta")
                doc = None
            if doc:
                vistos.add(doc)
            nasc, sent = data(l["NASC"])
            if sent:
                self._pendencia("RICADPAC", chave, "data_sentinela", "baixa")
            obito, s2 = data(l["DTOBITO"])
            if obito and nasc and obito < nasc:
                self._pendencia("RICADPAC", chave, "obito_antes_nascimento", "alta"); obito = None
            situacao = "obito" if obito else ("inativo" if (txt(l["ATIVO"]) or "S").upper() == "N" else "ativo")
            self._somar("paciente", chave, pront, nasc, doc, situacao)
            if sit != "nova":
                self._sub_paciente(chave, l, None, h, gravar=False)
                continue
            cns = digitos(l["CNS"])
            if cns and len(cns) != 15:
                self._pendencia("RICADPAC", chave, "cns_invalido", "baixa"); cns = ""
            sexo = (txt(l["SEXO"]) or "").upper()
            pf = dict(nome=nome, cpf=doc, cns=cns or None, data_nascimento=nasc, sexo_id=self.sexo.get(sexo),
                      nome_mae=txt(l["MAE"], 150), nome_pai=txt(l["PAI"], 150), falecida=bool(obito),
                      data_obito=obito, origem="migracao")
            pfid = self._inserir("pessoa_fisica", pf)
            pid = self._inserir("paciente", dict(pessoa_fisica_id=pfid, numero_prontuario=pront, situacao=situacao,
                                                 falecido=bool(obito), nome_mae=pf["nome_mae"],
                                                 cadastro_estabelecimento_id=estab, origem="migracao"))
            pronts.add(pront)
            self._registrar("RICADPAC", chave, "paciente", pid, h)
            self._sub_paciente(chave, l, pfid, h)

    def _sub(self, chave, sub, entidade, id_destino, h, gravar=True):
        if gravar:
            self._registrar("RICADPAC", "%s/%s" % (chave, sub), entidade, id_destino, h)
        self._somar(entidade, "%s/%s" % (chave, sub), id_destino is not None)

    def _sub_paciente(self, chave, l, pfid, h, gravar=True):
        """Documento, endereço e telefones da pessoa. Com gravar=False (linha já carregada), só a soma de controle
        da origem: a decisão (grava ou pendência) é a mesma, tirada só da linha e dos catálogos."""
        sim = True  # marcador de "seria gravado" quando gravar=False
        ident = txt(l["IDENT"], 40)
        if ident:
            did = sim if not gravar else self._inserir("documento_pessoa", dict(pessoa_fisica_id=pfid, sequencia=1, numero=ident,
                                tipo_documento_identificacao_id=self.tipo[("tipo_documento_identificacao", "rg")],
                                principal=True, origem="migracao"))
            self._sub(chave, "documento", "documento_pessoa", did, h, gravar)
        if txt(l["ENDERECO"]):
            cep = digitos(l["CEP"]); cep = cep.zfill(8) if cep and len(cep) <= 8 else None
            ibge = digitos(l["IBGE"])
            mun = self.municipio.get(ibge.zfill(7)) if ibge else None
            if not cep or not mun:
                if gravar:
                    self._pendencia("RICADPAC", chave, "endereco_sem_cep_ou_municipio", "media")
                self._sub(chave, "endereco", "endereco_pessoa", None, h, gravar)
            else:
                num = digitos(l["NUMERO"])[:10]
                eid = sim if not gravar else self._inserir("endereco_pessoa", dict(
                    pessoa_fisica_id=pfid, sequencia=1, tipo_endereco_id=self.tipo[("tipo_endereco", "residencial")],
                    logradouro=txt(l["ENDERECO"], 150), cep=cep, municipio_ibge_id=mun, numero=num or None,
                    sem_numero=not num, complemento=txt(l["COMPL"], 100), bairro_nome=txt(l["BAIRRO"], 100),
                    principal=True, origem="migracao"))
                self._sub(chave, "endereco", "endereco_pessoa", eid, h, gravar)
        seq = 0
        for col, tipo in (("FONE", "residencial"), ("CELULAR", "celular")):
            if not txt(l[col]):
                continue
            tel, ruim = telefone(l[col])
            if ruim or not tel:
                if gravar:
                    self._pendencia("RICADPAC", chave, "telefone_invalido", "baixa")
                self._sub(chave, "telefone_" + tipo, "telefone_pessoa", None, h, gravar)
                continue
            seq += 1
            tid = sim if not gravar else self._inserir("telefone_pessoa", dict(pessoa_fisica_id=pfid, sequencia=seq, ddi="55", ddd=tel[0],
                                numero=tel[1], tipo_telefone_id=self.tipo[("tipo_telefone", tipo)],
                                principal=seq == 1, origem="migracao"))
            self._sub(chave, "telefone_" + tipo, "telefone_pessoa", tid, h, gravar)

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
        self.num_origem = {}
        n = 0
        for l in linhas:
            n += 1
            if n % 1000 == 0:
                self.cr.commit()
            chave, h, sit = self._ciclo("ATCABECATEND", l)
            numero = str(l["COD_ATENDIMENTO"]) if l["COD_ATENDIMENTO"] is not None else None
            pac_chave = str(l["ID_RICADPAC"])
            pac, pac_existe = self._de_para("RICADPAC", pac_chave)
            tp = (txt(l["TP_ATENDIMENTO"]) or "").upper()
            car = CARATER.get(l["CARATER_ATEND"])
            if sit == "nova":
                regra = None
                if not estab:
                    regra = ("estabelecimento_ausente", "critica")
                elif not pac:
                    regra = ("pai_pendente" if pac_existe else "paciente_inexistente", "critica")
                elif not numero or numero in numeros:
                    regra = ("numero_duplicado" if numero else "numero_ausente", "critica")
                elif tp not in CATEGORIAS:
                    regra = ("categoria_desconhecida", "alta")
                elif not car:
                    regra = ("carater_ausente", "alta")
                elif car not in self.carater:
                    regra = ("catalogo_oficial_ausente_carater_tiss", "critica")
                elif l["DATA_HORA_ENTRADA"] is None:
                    regra = ("entrada_ausente", "critica")
                if regra:
                    self._pendencia("ATCABECATEND", chave, *regra)
                    self._registrar("ATCABECATEND", chave, "atendimento", None, h); continue
            elif self._de_para("ATCABECATEND", chave)[0] is None:
                continue
            self.num_origem[chave] = numero
            entrada, _ = momento(l["DATA_HORA_ENTRADA"])
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
                if desfecho == "administrativo" and sit == "nova":
                    self._pendencia("ATCABECATEND", chave, "desfecho_nao_informado", "baixa")
            else:
                situacao = "aberto"
            self._somar("atendimento", chave, numero, self.pront_origem.get(pac_chave), entrada, situacao)
            if sit != "nova":
                continue
            if tp not in categoria:
                cod, desc = CATEGORIAS[tp]
                categoria[tp] = self._catalogo("categoria_atendimento", cod, {"descricao": desc, "tipo_base": cod})
            v = dict(estabelecimento_id=estab, numero=numero[:20], paciente_id=pac,
                     categoria_atendimento_id=categoria[tp], carater_atendimento_tiss_id=self.carater[car],
                     fonte_pagadora_id=self._fonte(l["ID_TBCONVEN"]),
                     profissional_id=self._profissional(l["ID_TBCBOPRO_ATENDIMENTO"]), entrada_em=entrada,
                     saida_em=saida, alta_medica_em=alta, situacao=situacao, desfecho=desfecho, origem="migracao")
            numeros.add(numero)
            self._registrar("ATCABECATEND", chave, "atendimento", self._inserir("atendimento", v), h)
        self.cr.commit()
        # fichas (RECADATE) e altas (REALTA) ligadas ao atendimento de destino
        for tab, pai_de in (("RECADATE", lambda k, l: str(l["ID_ATCABECATEND"])),
                            ("REALTA", lambda k, l: str(ficha_atend.get(k)) if k in ficha_atend else None)):
            for k, l, h in self.pre.get(tab, []):
                pai = pai_de(k, l)
                ant = self.existente.get(tab, {}).get(k)
                if ant and ant[1] == h:
                    self.cont["puladas_iguais"] += 1
                    if ant[0]:
                        self._somar(ENT_FILHA[tab], k, self.num_origem.get(pai))
                    continue
                aid, existe = self._de_para("ATCABECATEND", pai) if pai else (None, False)
                if aid is None:
                    if not ant:
                        self._pendencia(tab, k, "pai_pendente" if existe else "atendimento_inexistente", "alta")
                        self._registrar(tab, k, "atendimento", None, h)
                    continue
                self._somar(ENT_FILHA[tab], k, self.num_origem.get(pai))
                self._registrar(tab, k, "atendimento", aid, h)
        self.cr.commit()

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
        self.pront_origem, self.num_origem = getattr(self, "pront_origem", {}), {}
        for i, t in enumerate(self.tabelas):
            self.progresso(i / len(self.tabelas), "carregando %s" % MAPA[t]["entidade"])
            fn[t](self._linhas(t))
        self._gravar_pendencias()
        return self.conciliar(contagens)

    def _gravar_pendencias(self):
        with self._c() as c:
            c.executemany("INSERT INTO %s.pendencia (execucao_id, tabela_origem, chave_original, regra, gravidade,"
                          " criado_em) VALUES (%s, %%s, %%s, %%s, %%s, %s)" % (self.ctl, int(self.eid), AGORA),
                          self.pend)
        self.cr.commit()

    # ----- conciliação (destino relido do banco) -----
    DESTINO = {
        "estabelecimento": ("TBHOSPIT", "estabelecimento",
                            "SELECT co.chave_original, d.cnpj, d.codigo_cnes, d.cep FROM {ctl}.conector_origem co"
                            " JOIN estabelecimento d ON d.id=co.id_destino AND d.origem='migracao'"
                            " WHERE co.tabela_origem='TBHOSPIT' AND co.excluido_em IS NULL"),
        "usuario": ("TBUSERS", "usuario",
                    "SELECT co.chave_original, d.login, d.cpf, d.situacao FROM {ctl}.conector_origem co"
                    " JOIN usuario d ON d.id=co.id_destino AND d.origem='migracao'"
                    " WHERE co.tabela_origem='TBUSERS' AND co.excluido_em IS NULL"),
        "paciente": ("RICADPAC", "paciente",
                     "SELECT co.chave_original, d.numero_prontuario, pf.data_nascimento, pf.cpf, d.situacao"
                     " FROM {ctl}.conector_origem co JOIN paciente d ON d.id=co.id_destino AND d.origem='migracao'"
                     " JOIN pessoa_fisica pf ON pf.id=d.pessoa_fisica_id"
                     " WHERE co.tabela_origem='RICADPAC' AND co.entidade_destino='paciente' AND co.excluido_em IS NULL"),
        "atendimento": ("ATCABECATEND", "atendimento",
                        "SELECT co.chave_original, d.numero, p.numero_prontuario, d.entrada_em, d.situacao"
                        " FROM {ctl}.conector_origem co JOIN atendimento d ON d.id=co.id_destino"
                        " AND d.origem='migracao' JOIN paciente p ON p.id=d.paciente_id"
                        " WHERE co.tabela_origem='ATCABECATEND' AND co.excluido_em IS NULL"),
        "atendimento_ficha": ("RECADATE", "atendimento",
                                 "SELECT co.chave_original, d.numero FROM {ctl}.conector_origem co"
                                 " JOIN atendimento d ON d.id=co.id_destino WHERE co.tabela_origem='RECADATE'"
                                 " AND co.excluido_em IS NULL"),
        "atendimento_alta": ("REALTA", "atendimento",
                               "SELECT co.chave_original, d.numero FROM {ctl}.conector_origem co"
                               " JOIN atendimento d ON d.id=co.id_destino WHERE co.tabela_origem='REALTA'"
                               " AND co.excluido_em IS NULL"),
    }
    SUB = {"documento_pessoa": "documento_pessoa", "endereco_pessoa": "endereco_pessoa",
           "telefone_pessoa": "telefone_pessoa"}

    def conciliar(self, contagens):
        res = {}
        for ent, (tab, _, sql) in self.DESTINO.items():
            if tab not in self.tabelas:
                continue
            linhas = self._todas(sql.format(ctl=self.ctl))
            destino = ["|".join(fmt(v) for v in r) for r in linhas]
            recusadas = self._um("SELECT COUNT(*) FROM %s.conector_origem WHERE tabela_origem=%%s AND id_destino IS NULL"
                                 " AND chave_original NOT LIKE '%%%%/%%%%'" % self.ctl, (tab,))
            lidos = int(contagens.get(tab, 0))
            so, sd = soma(self.origem_soma.get(ent, [])), soma(destino)
            ok = lidos == len(destino) + int(recusadas) and so == sd
            res[ent] = {"tabela_origem": tab, "registros_origem": lidos, "registros_destino": len(destino),
                        "recusados": int(recusadas), "soma_origem": so, "soma_destino": sd, "conferido": ok}
        if "RICADPAC" in self.tabelas:
            for ent, tabela in self.SUB.items():
                linhas = self._todas("SELECT co.chave_original, d.id IS NOT NULL FROM %s.conector_origem co"
                                     " LEFT JOIN `%s` d ON d.id=co.id_destino WHERE co.tabela_origem='RICADPAC'"
                                     " AND co.entidade_destino=%%s" % (self.ctl, tabela), (ent,))
                destino = ["%s|%s" % (k, fmt(bool(v))) for k, v in linhas]
                gravados = sum(1 for _, v in linhas if v)
                so, sd = soma(self.origem_soma.get(ent, [])), soma(destino)
                res[ent] = {"tabela_origem": "RICADPAC", "registros_origem": len(linhas), "registros_destino": gravados,
                            "recusados": len(linhas) - gravados, "soma_origem": so, "soma_destino": sd,
                            "conferido": so == sd}
        if "TBTPEMP" in self.tabelas:
            n = self._um("SELECT COUNT(*) FROM %s.conector_origem WHERE tabela_origem='TBTPEMP'" % self.ctl)
            ks = [r[0] for r in self._todas("SELECT chave_original FROM %s.conector_origem WHERE tabela_origem="
                                            "'TBTPEMP'" % self.ctl)]
            so, sd = soma(self.origem_soma.get("tipo_empresa", [])), soma(ks)
            res["tipo_empresa"] = {"tabela_origem": "TBTPEMP", "registros_origem": int(contagens.get("TBTPEMP", 0)),
                                   "registros_destino": int(n), "recusados": 0, "soma_origem": so, "soma_destino": sd,
                                   "conferido": int(n) == int(contagens.get("TBTPEMP", 0)) and so == sd,
                                   "observacao": "de-para guardado; vira campo do estabelecimento"}
        por_regra = {}
        for tab, _, regra, grav in self.pend:
            k = "%s:%s:%s" % (ENTIDADE_DA_TABELA.get(tab, "outra"), regra, grav)
            por_regra[k] = por_regra.get(k, 0) + 1
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
        self.cr.commit()
        return {"versao_mapa": VERSAO_MAPA, "entidades": res, "pendencias": {
            "total": len(self.pend), "criticas": sum(1 for p in self.pend if p[3] == "critica"),
            "por_regra": por_regra}, "carga": dict(self.cont)}
