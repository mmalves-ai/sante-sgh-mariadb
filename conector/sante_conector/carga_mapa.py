"""Carga dirigida pelo mapa (F4 L5 a L8): qualquer tabela carregável do mapa, sem código por tabela.

Entrada: o mapa da execução (`mapa.carregar_execucao`): `tabelas.tsv` (destinos, chave, ordem), `colunas.tsv` (regra,
referência e de-para gerados por nome e tipo), `declarado/colunas.tsv` + `declarado/colunas.d/*.tsv` (as colunas
APROVEITADAS, com o destino `tabela.coluna`; regra e de-para declarados valem por cima dos gerados) e
`dependencias.tsv` (arestas em duas fases). Só entra a tabela que tem ao menos uma coluna declarada com destino; as do
L3 (`carga.ORDEM`) seguem na carga própria (`carga.py`).

Mesmas garantias do L3 (herda `carga.Carga`):
- toda linha lida fica em `conector_origem` (hash dos bytes crus das colunas lidas); recusa com regra e gravidade,
  pendência no mesmo commit; SAVEPOINT por linha (restrição do destino recusa só a linha: `restricao_destino_<código>`);
- linha igual é pulada; alterada na origem fica com `alteracao_aguarda_sincronizar` (hash guardado intocado); apagada
  na origem, `apagada_aguarda_sincronizar`; diferente no destino com rastro de edição, `edicao_no_destino`;
- regra de coluna (`sentinela.aplicar`): a pendência da regra vai para a linha (data_sentinela, hora_sem_data,
  valor_fora_do_dominio...), o valor vira NULL; de-para oficial (`depara.Depara`): código ausente ou inválido vira
  pendência `catalogo_codigo_*` (catálogo oficial nunca é criado nem gravado);
- referência (`chave_origem` com `referencia`): id de destino do pai pelo `conector_origem`. Pai recusado ou pendente:
  a linha é recusada com `pai_pendente` (gravidade e raiz da cadeia pelo `pendencia.Propagador`); pai nunca visto:
  NULL com pendência `pai_inexistente` (coluna NOT NULL no destino recusa a linha pela restrição). Autorreferência e
  aresta declarada em duas fases (`declarado/ciclos.tsv`): a linha entra com NULL e a referência é gravada no fim
  (fase 2), por UPDATE;
- colunas especiais (L5): `=<texto>` literal convertido ao tipo do destino; `=~<texto>` literal PRESUMIDO (grava e
  deixa por linha a pendência baixa `valor_presumido`, para o cliente revisar); `@estabelecimento` id do único
  estabelecimento do cliente (nenhum ou vários: recusa com `estabelecimento_indefinido`; com coluna de unidade na
  origem, use a referência declarada); `#seq:<COLUNA>` 1..n dentro do mesmo valor da coluna, na ordem da chave
  (contada em toda leitura, estável no diferencial);
- referência declarada no campo `via` (`ref:<TABELA>`, ex.: login do usuário pela chave do pai), por cima da gerada;
- de-para de valores próprio (`depara=valores`, pares em `declarado/valores.tsv` por tabela, coluna e destino):
  aplicado depois da regra; valor sem par vira NULL com `valor_fora_do_dominio`;
- código `codigo_char` gravado em coluna de chave única do destino sem distinção de caixa: os grupos que só diferem
  pela caixa (`sentinela.colisoes_caixa`) são recusados TODOS com `codigo_colisao_caixa` antes de gravar (nenhum
  vence pela ordem de leitura);
- valor da origem convertido ao tipo do destino antes da soma de controle (inteiro gravado em texto entra como
  texto, literal numérico entra como número);
- vários destinos por tabela: o primeiro destino declarado (na ordem de `tabelas_destino`) é o principal; cada um
  dos outros é uma entidade com chave `<chave>/<tabela destino>` em `conector_origem`; `@id` liga ao principal;
- coluna `origem` do destino, se existir e não for declarada, recebe 'migracao'; `criado_em` vem do relógio do banco;
  valor nulo em coluna NOT NULL com padrão no destino fica com o padrão (contado em `padrao_do_destino`; o resumo usa
  o valor relido do banco);
- conciliação por entidade (tabela de destino): contagem lida = gravada (relida do banco) + recusada e soma de
  controle do resumo dos campos gravados (texto em bytes CP1252, decimal normalizado, data e hora na precisão do
  destino), calculada da origem convertida e relida do destino. A coluna em duas fases fica fora do resumo.
- mede linhas por segundo por tabela (`carga.por_tabela`). Só contagens e regras saem daqui, nunca valores.

Mecanismos genéricos da cobertura total (F4, rodada de cobertura; prova em `sintetica_d/exemplo_cob.py`):
- referência declarada por chave composta `ref:T(C1,C2)`, por chave alternativa `ref:T.K` e encadeada `ref:T>X>U`
  (`mapa.passos_ref`): a origem do pai é lida só nas colunas da chave e das usadas (cache por execução); valor
  repetido na chave alternativa vira `pai_ambiguo`;
- `=@data_carga` (data UTC da carga; `=~@data_carga`, presumida) e `@vigencia_carga` (vigência sem fonte = data da
  carga com a pendência baixa `vigencia_sem_fonte`); estáveis no diferencial (a linha igual é pulada);
- `#sha256:<COLUNA>` (SHA-256 hex do texto convertido), `#codigo_derivado:<COLUNA>:<n>[:<prefixo>]` (prefixo de domínio + valor se couber em n; senão
  prefixo + '~' + 8 hex do SHA-256, pendência baixa `codigo_derivado`) e `#cofre:<COLUNA>` (segredo NUNCA gravado em
  claro: o conector não tem cofre; o destino fica NULL e a linha com segredo leva `segredo_aguarda_cofre`, para o
  cliente cadastrar a credencial no cofre do produto);
- `#data:<ANO>,<MES>[,<DIA>]`: data composta de colunas numéricas (competência: dia 1 se não houver DIA); data
  inválida vira NULL com valor_fora_do_dominio;
- `#retrato`: JSON (chaves em ordem) das colunas lidas da linha, convertidas pela regra declarada ou gerada, sem as
  colunas de segredo (`#cofre`); data em ISO, decimal e número como texto, binário como SHA-256 (histórico da origem
  guardado como retrato da versão);
- opções do destino na `via` de uma coluna dele: `opcional` (destino secundário sem nenhum valor da origem não
  grava linha), `adotar:<c1>,<c2>` (linha que já existe no destino com as mesmas colunas, ex.: CPF ou código, é
  ADOTADA: o conector_origem aponta para ela, nada é sobrescrito, pendência baixa `adotado_existente`; o resumo é o
  relido do destino) e `desdobrar:<COL>=<rótulo>,...` (uma linha do destino por coluna da origem com valor: `#item`
  recebe o valor pela regra declarada nele e `#rotulo` o rótulo; falso ou vazio não gera linha) e `complementa`
  (a tabela COMPLETA a linha que o pai já gravou: a coluna com `ref:` e destino `<tabela>.id` acha a linha, e as
  outras colunas são gravadas nela por UPDATE, sem linha nova; pai não carregado recusa com `pai_inexistente`);
- dependências declaradas (`declarado/dependencias.tsv`) entram na ordem do gerador do mapa.

Mecanismos da rodada 2 de cobertura (prova em `sintetica_d/exemplo_r2.py`):
- `cod:<tabela>.<coluna>` na `via`: o valor da coluna (depois da regra e do de-para de valores) ou o literal (`=x`,
  `=~x`) é procurado em `<tabela>.<coluna>` do DESTINO (cadastro do produto ou já carregado) e grava o id; ausente:
  NULL com `codigo_inexistente_destino`; mais de uma linha: NULL com `pai_ambiguo` (coluna NOT NULL recusa a linha);
- `@unico:<tabela>`: id da única linha ativa (`ativo`, se houver; `excluido_em` nulo, se houver) da tabela do
  destino (cadastro sem fonte na origem); nenhuma ou várias: recusa com `cadastro_unico_indefinido` (alta);
- referência por chave alternativa COMPOSTA `ref:T.(K1,K2)=(C1,C2)` e ao destino SECUNDÁRIO do pai `ref:T/<destino>`
  (`mapa.passos_ref`);
- `#data_hora:<COLUNA_DATA>,<COLUNA_HORA>`: data e hora de duas colunas (data pela regra `data`; hora HHMM em inteiro
  ou texto, TIME ou TIMESTAMP de só hora); sem data: NULL (data sentinela: data_sentinela); sem hora: meia-noite; hora
  inválida: NULL com hora_invalida;
- opção de destino `antes` (secundário gravado ANTES do principal; com `adotar:` cria uma vez e adota depois) e
  especial `@id:<destino>` (o id da linha gravada ou adotada nesse secundário, ex.: a pessoa física do profissional
  criada pelo nome e CPF da própria linha);
- data da origem em coluna DATETIME do destino vira data e hora à meia-noite (e data e hora em coluna DATE, a data), e
  o literal em coluna TIME/DATE/DATETIME vira hora/data antes de gravar e da soma de controle (`tipar`; inválido: NULL
  com valor_fora_do_dominio); regras `minutos_hhmm` e `email`; `hora_hhmm` aceita o texto cru da origem.

O hash da linha cobre as colunas lidas (chave + declaradas): declarar uma coluna nova numa tabela já carregada faz as
linhas aparecerem como alteradas (ficam para o Sincronizar), nunca regravadas em silêncio.
"""
import datetime
import decimal
import hashlib
import json
import time

from . import carga, depara, mapa, sentinela
from .carga import AGORA, ErroCarga, chave_txt, soma
from .leitor import hash_linha
from .pendencia import Propagador
from .texto import texto_para_cp1252

VERSAO = "mapa-2026-11-21"
LOTE_COMMIT = 2000
GRAVIDADE_REGRA = {"valor_presumido": "baixa", "codigo_colisao_caixa": "media", "estabelecimento_indefinido": "alta",
                   "data_sentinela": "baixa", "hora_com_data": "baixa", "hora_sem_data": "media",
                   "valor_fora_do_dominio": "media", "hora_invalida": "media", "catalogo_codigo_inexistente": "media",
                   "catalogo_codigo_invalido": "media", "pai_inexistente": "media"}
GRAVIDADE_REGRA.update({"valor_elevado_ao_minimo": "baixa", "texto_resumido": "baixa", "codigo_derivado": "baixa",
                        "segredo_aguarda_cofre": "media", "adotado_existente": "baixa", "vigencia_sem_fonte": "baixa",
                        "pai_ambiguo": "media", "documento_invalido": "media"})
GRAVIDADE_REGRA.update({"codigo_inexistente_destino": "media", "cadastro_unico_indefinido": "alta"})
TIPOS_INT = (7, 8, 16)
INT_DESTINO = {"tinyint", "smallint", "mediumint", "int", "bigint"}
DEC_DESTINO = {"decimal"}
TXT_DESTINO = {"char", "varchar", "text", "tinytext", "mediumtext", "longtext"}


_AMBIGUO = object()            # valor repetido na chave alternativa do pai (`ref:T.K`)
# texto não numérico em coluna numérica do destino (L6-06): o chamador grava NULL com valor_fora_do_dominio
NAO_NUMERICO = object()


def tipar(x, tipo):
    """Valor no tipo da coluna de destino (o que o banco devolve na releitura): literal numérico em coluna numérica
    vira número; inteiro ou decimal em coluna de texto vira texto. Sem tipo conhecido, fica como está."""
    if x is None or tipo is None or isinstance(x, bool):
        return x
    if isinstance(x, str) and tipo in ("time", "date", "datetime", "timestamp"):  # literal (`=~23:59:59`)
        try:
            if tipo == "time":
                return datetime.time.fromisoformat(x.strip())
            if tipo == "date":
                return datetime.date.fromisoformat(x.strip())
            return datetime.datetime.fromisoformat(x.strip())
        except ValueError:
            return NAO_NUMERICO
    if tipo in ("datetime", "timestamp") and type(x) is datetime.date:
        return datetime.datetime.combine(x, datetime.time())
    if tipo == "date" and isinstance(x, datetime.datetime):
        return x.date()
    if tipo in INT_DESTINO and isinstance(x, str):
        try:
            return int(x.strip())
        except ValueError:
            return NAO_NUMERICO
    if tipo in DEC_DESTINO and isinstance(x, (str, int, float)):
        try:
            return decimal.Decimal(str(x).strip())
        except decimal.InvalidOperation:
            return NAO_NUMERICO
    if tipo in TXT_DESTINO and isinstance(x, (int, decimal.Decimal)):
        return str(x)
    return x


def _especial(nome):
    return nome[:1] in ("=", "@", "#")


def fonte_especial(nome):
    """Coluna da origem lida por uma coluna especial (`#seq:X`, `#sha256:X`, `#cofre:X`, `#codigo_derivado:X:n`)."""
    for pre in ("#seq:", "#sha256:", "#cofre:", "#codigo_derivado:"):
        if nome.startswith(pre):
            return nome[len(pre):].split(":")[0]
    return None


def data_composta(ano, mes, dia=1):
    """(data, pendência) de colunas numéricas; vazio/zero: (None, None); inválida: (None, valor_fora_do_dominio)."""
    try:
        if ano in (None, 0, "") or mes in (None, 0, ""):
            return None, None
        return datetime.date(int(str(ano).strip()), int(str(mes).strip()), int(str(dia or 1).strip())), None
    except (TypeError, ValueError):
        return None, "valor_fora_do_dominio"


def data_hora_composta(data, hora):
    """(data e hora, pendência) de uma coluna de data e outra de hora (`#data_hora:D,H`)."""
    d, pr = sentinela.aplicar("data", data)
    if d is None:
        return None, pr
    if isinstance(d, datetime.datetime):
        d = d.date()
    if hora is None or (isinstance(hora, (str, bytes, bytearray)) and not sentinela.aplicar("texto", hora)[0]):
        return datetime.datetime.combine(d, datetime.time()), None
    if isinstance(hora, datetime.datetime):
        h, pr = hora.time(), None
    elif isinstance(hora, datetime.time):
        h, pr = hora, None
    else:
        h, pr = sentinela.aplicar("hora_hhmm", hora)
    return (None, pr) if h is None else (datetime.datetime.combine(d, h), None)


def codigo_derivado(texto, n, prefixo=""):
    """(código, mudou): `prefixo` + texto se couber em n (o prefixo de domínio separa códigos de tabelas da origem que
    vão para o mesmo cadastro, sem pendência); senão prefixo + início + '~' + 8 hex do SHA-256 do texto (estável),
    com mudou=True (pendência baixa codigo_derivado)."""
    if texto is None:
        return None, False
    if len(prefixo) + len(texto) <= n:
        return prefixo + texto, False
    h = hashlib.sha256(texto.encode("utf-8")).hexdigest()[:8]
    return (prefixo + texto)[:max(0, n - 9)].rstrip() + "~" + h, True


def planejar(mapa_exec, presentes, excluir=frozenset(carga.ORDEM)):
    """Plano de carga em ordem do mapa: uma entrada por tabela carregável PRESENTE na origem com coluna declarada.
    Sem banco e sem Firebird (teste de unidade)."""
    geradas = {}
    for c in mapa_exec.get("colunas", []):
        geradas.setdefault(c["tabela"], {})[c["coluna"]] = c
    valores = {}
    for v in mapa_exec.get("valores", []):
        valores.setdefault((v["tabela"], v["coluna"], v["destino"]), {})[v["valor_origem"]] = v["valor_destino"]
    decl = {}
    for c in mapa_exec.get("colunas_decl", []):
        if (c.get("destino") or "").count(".") == 1:
            decl.setdefault(c["tabela"], []).append(c)
    quebras = {(d["tabela"], d["depende_de"]) for d in mapa_exec.get("deps", []) if d.get("quebra")}
    plano = []
    for r in sorted(mapa_exec["tabelas"], key=lambda r: int(r["ordem"]) if (r.get("ordem") or "").isdigit() else 10**9):
        t = r["tabela"]
        if not r.get("tabelas_destino") or t in excluir or t not in presentes or t not in decl:
            continue
        dts = mapa.principal_e_destinos(r["tabelas_destino"], decl[t])
        opcoes = mapa.opcoes_destino(decl[t])
        cols = {dt: [] for dt in dts}
        for c in decl[t]:
            dt, dc = c["destino"].split(".")
            g = geradas.get(t, {}).get(c["coluna"], {})
            rd = mapa.referencia_declarada(c)
            passos = mapa.passos_ref(rd) if rd and not mapa.ref_simples(rd) else None
            dp = c.get("depara") or g.get("depara") or ""
            termina_em_coluna = bool(passos) and "coluna" in passos[-1]
            # terminada em coluna, o valor vem do pai: a regra gerada da coluna desta tabela não vale para ele
            regra = c.get("regra") or ("texto" if termina_em_coluna else "chave_origem" if rd else g.get("regra") or "")
            col = {"coluna": c["coluna"], "destino": dc, "regra": regra or ("texto" if passos else ""),
                   "depara": dp, "referencia": rd or g.get("referencia") or "",
                   "valores": valores.get((t, c["coluna"], c["destino"]), {}) if dp == "valores" else None}
            if passos:  # só a referência composta, alternativa ou encadeada leva os passos
                col["passos"] = passos
            cod = [x[4:] for x in (c.get("via") or "").split(";") if x.startswith("cod:")]
            if cod:
                col["cod"] = tuple(cod[0].split(".", 1))
            cols[dt].append(col)
        chave = [x for x in (r.get("chave") or "").split(",") if x]
        lidas = list(chave)

        def ler(nome):
            if nome and nome not in lidas:
                lidas.append(nome)
        for dt in dts:
            for c in cols[dt]:
                n = c["coluna"]
                if n.startswith("#data:") or n.startswith("#data_hora:"):
                    for x in n.split(":", 1)[1].split(","):
                        ler(x)
                ler(fonte_especial(n) if _especial(n) else n)
                if c.get("passos") and c["passos"][0]["modo"] in ("composta", "alt_composta"):
                    for x in c["passos"][0].get("cols") or c["passos"][0]["arg"]:
                        ler(x)
            for col, _ in opcoes.get(dt, {}).get("desdobrar", []):
                ler(col)
        regras = {n: (geradas.get(t, {}).get(n, {}).get("regra") or "texto") for n in lidas}
        for c in decl[t]:
            if c.get("regra") and not _especial(c["coluna"]) and c["coluna"] in regras \
                    and not mapa.referencia_declarada(c):
                regras[c["coluna"]] = c["regra"]
        segredos = {fonte_especial(c["coluna"]) for c in decl[t] if c["coluna"].startswith("#cofre:")}
        plano.append({"tabela": t, "chave": chave, "destinos": dts, "colunas": cols, "lidas": lidas,
                      "retrato": {n: r for n, r in regras.items() if n not in segredos},
                      "estrategia": r.get("estrategia", ""), "opcoes": {dt: opcoes.get(dt, {}) for dt in dts},
                      "duas_fases": {p for f, p in quebras if f == t} | {t}})
    return plano


def canon(v, precisao=None):
    """Forma canônica de um campo na soma (mesma dos dois lados): texto em bytes CP1252, decimal normalizado, hora
    como TIME, data e hora truncadas à precisão do destino."""
    if isinstance(v, datetime.timedelta):  # TIME relido do MariaDB
        s = int(v.total_seconds())
        v = datetime.time(s // 3600 % 24, s // 60 % 60, s % 60, v.microseconds)
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, decimal.Decimal)) and not isinstance(v, bool):
        d = decimal.Decimal(v).normalize()
        return format(d, "f") if d else "0"
    if isinstance(v, datetime.time):
        return v.isoformat()
    return carga.fmt(v)


class _PADRAO(str):
    """Marca, no resumo, a coluna que ficou com o padrão do destino (trocada pelo valor relido depois do INSERT)."""


def _truncar(v, precisao):
    """Data e hora na precisão de fração do destino (o que volta do banco é igual ao que foi gravado)."""
    if precisao is None or not isinstance(v, (datetime.datetime, datetime.time)):
        return v
    q = 10 ** (6 - min(6, int(precisao)))
    return v.replace(microsecond=(v.microsecond // q) * q)


class CargaMapa(carga.Carga):
    def __init__(self, leitor, cr, ctl, eid, imagem_id, mapa_exec, progresso=None, entidades_usadas=()):
        super().__init__(leitor, cr, ctl, eid, imagem_id, progresso)
        self.mapa_exec = mapa_exec
        self.prop = Propagador()
        self.deparas = {}
        self.adiadas = []                   # (dt, coluna, id_linha, tabela_pai, chave_pai, tabela, chave)
        self.info = {}                      # dt -> {coluna: (nulo, tipo, precisao)}
        self.ent = {}                       # (tabela, dt) -> nome da entidade na conciliação
        self.usadas = set(entidades_usadas)
        self.plano = []
        self.cont.update(fase2_gravadas=0, fase2_pendentes=0)
        self.seq = {}                       # posição da linha no grupo de `#seq:<COLUNA>` (linha atual)
        self._estab = False
        self.por_tabela = {}
        self.data_carga = datetime.datetime.now(datetime.timezone.utc).date()
        self.chaves = {r["tabela"]: [x for x in (r.get("chave") or "").split(",") if x]
                       for r in mapa_exec.get("tabelas", [])}
        self._origem_pai = {}               # (tabela, coluna) -> {chave do pai: valor} (referência encadeada)
        self._alt = {}                      # (tabela, coluna) -> {valor canônico: chave do pai ou AMBIGUO}
        self._cod = {}                      # (tabela, coluna, valor) -> id do destino, None ou AMBIGUO (`cod:`)
        self._unico = {}                    # tabela -> id da única linha ativa ou None (`@unico:`)

    # ----- destino -----
    def _info(self, dt):
        if dt not in self.info:
            rs = self._todas("SELECT COLUMN_NAME, IS_NULLABLE, DATA_TYPE, DATETIME_PRECISION, COLUMN_DEFAULT FROM"
                             " information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s", (dt,))
            if not rs:
                raise ErroCarga("tabela de destino inexistente no banco do cliente: %s" % dt)
            self.info[dt] = {c: (n == "YES", t, p, n != "YES" and d is not None and d != "NULL")
                             for c, n, t, p, d in rs}
        return self.info[dt]

    def _estabelecimento(self):
        """Id do único estabelecimento do cliente (None: nenhum ou vários). Nunca fixo por cliente."""
        if self._estab is False:
            ids = [r[0] for r in self._todas("SELECT id FROM estabelecimento LIMIT 2")] if self._um(
                "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND"
                " TABLE_NAME='estabelecimento'") else []
            self._estab = ids[0] if len(ids) == 1 else None
        return self._estab

    def _id_por_codigo(self, tab, col, v):
        """Id da linha de `tab` do destino com `col` = v (`cod:`): None se ausente, _AMBIGUO se várias."""
        k = (tab, col, v)
        if k not in self._cod:
            ids = self._todas("SELECT id FROM `%s` WHERE `%s`=%%s LIMIT 2" % (tab, col), (v,))
            self._cod[k] = ids[0][0] if len(ids) == 1 else (_AMBIGUO if ids else None)
        return self._cod[k]

    def _unica(self, tab):
        """Id da única linha ativa de `tab` (`@unico:`); None se nenhuma ou várias. Nunca fixo por cliente."""
        if tab not in self._unico:
            info = self._info(tab)
            filtro = " AND ".join((["`ativo`"] if "ativo" in info else []) +
                                  (["`excluido_em` IS NULL"] if "excluido_em" in info else [])) or "1"
            ids = self._todas("SELECT id FROM `%s` WHERE %s LIMIT 2" % (tab, filtro))
            self._unico[tab] = ids[0][0] if len(ids) == 1 else None
        return self._unico[tab]

    def _unicos_sem_caixa(self, dt):
        """Colunas de `dt` com índice único de uma coluna só e colação que não distingue caixa."""
        rs = self._todas("SELECT s.INDEX_NAME, MIN(s.COLUMN_NAME), COUNT(*), MIN(c.COLLATION_NAME) FROM"
                         " information_schema.STATISTICS s JOIN information_schema.COLUMNS c ON"
                         " c.TABLE_SCHEMA=s.TABLE_SCHEMA AND c.TABLE_NAME=s.TABLE_NAME AND c.COLUMN_NAME=s.COLUMN_NAME"
                         " WHERE s.TABLE_SCHEMA=DATABASE() AND s.TABLE_NAME=%s AND s.NON_UNIQUE=0"
                         " GROUP BY s.INDEX_NAME", (dt,))
        return {col for _, col, n, coll in rs if n == 1 and coll and not coll.endswith("_bin")
                and "_cs" not in coll}

    def _colisoes(self, p):
        """Chaves das linhas cujo código `codigo_char` colide pela caixa num destino de chave única sem caixa."""
        alvo = [c["coluna"] for dt in p["destinos"] for c in p["colunas"][dt]
                if c["regra"] == "codigo_char" and not _especial(c["coluna"]) and c["destino"] in self._unicos_sem_caixa(dt)]
        if not alvo:
            return set()
        por_col = {c: {} for c in alvo}
        for linha, ch_sem in self._linhas_mapa(p):
            chave = ch_sem or "|".join(self._chave(linha[c]) for c in p["chave"])
            for c in alvo:
                x = sentinela.aplicar("codigo_char", linha[c])[0]
                if x is not None:
                    por_col[c].setdefault(x, []).append(chave)
        saida = set()
        for c, cods in por_col.items():
            for grupo in sentinela.colisoes_caixa(cods):
                for cod in grupo:
                    saida.update(cods[cod])
        return saida

    def _depara(self, cat):
        if cat not in self.deparas:
            existe = self._um("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND"
                              " TABLE_NAME=%s", (depara.catalogo(cat)["tabela"],))
            pares = self._todas(depara.consulta(cat)) if existe else []
            if not pares:
                self._pendencia("-", None, "catalogo_oficial_ausente_%s" % cat, "alta")
            self.deparas[cat] = depara.Depara(cat, pares)
        return self.deparas[cat]

    # ----- leitura -----
    def _linhas_mapa(self, p):
        t = p["tabela"]
        cols = {c["nome"]: c for c in self.lt.colunas(t)}
        faltam = [c for c in p["lidas"] if c not in cols]
        if faltam:
            raise ErroCarga("tabela %s sem as colunas do mapa: %s" % (t, ", ".join(faltam)))
        self.subtipo = {n: c.get("subtipo") or 0 for n, c in cols.items()}
        ch = p["chave"]
        if len(ch) == 1 and self.lt.chave_primaria(t) == ch and cols[ch[0]]["codigo_tipo"] in TIPOS_INT:
            for ini, fim in self.lt.faixas(t, ch[0]):
                nomes, it = self.lt.ler_faixa(t, ch[0], ini, fim, colunas=p["lidas"])
                for x in it:
                    yield dict(zip(nomes, x)), None
            return
        nomes, it = self.lt.ler_tudo(t, colunas=p["lidas"])
        if ch:  # ordem fixa pela chave: decisões de duplicidade estáveis
            ix = [nomes.index(c) for c in ch]
            for x in sorted(it, key=lambda x: tuple(self._chave(x[i]) for i in ix)):
                yield dict(zip(nomes, x)), None
            return
        # sem chave: a chave é o hash da linha mais a ocorrência (multiconjunto de hashes)
        vistos = {}
        for h, x in sorted(((hash_linha(list(x)), x) for x in it), key=lambda y: y[0]):
            vistos[h] = vistos.get(h, 0) + 1
            yield dict(zip(nomes, x)), "h:%s#%d" % (h, vistos[h])

    @staticmethod
    def _chave(v):
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        if isinstance(v, decimal.Decimal) and v == v.to_integral_value():
            v = int(v)
        return chave_txt(v) if v is not None else ""

    # ----- valores -----
    def _referencia(self, t, chave, coluna, ref, raw):
        """(id, regra, gravidade): id do pai já carregado; pai recusado/pendente: ('pai_pendente', gravidade)."""
        if raw is None or (isinstance(raw, (int, float, decimal.Decimal)) and raw == 0):
            return None, None, None
        return self._referencia_chave(t, chave, coluna, ref, self._chave(raw))

    # ----- referência composta, alternativa e encadeada (mapa.passos_ref) -----
    def _ler_pai(self, tab, colunas):
        """Linhas da origem de `tab` só com a chave e `colunas`: [(chave do pai, {coluna: valor})]."""
        ch = self.chaves.get(tab) or []
        if not ch:
            raise ErroCarga("referência declarada a tabela sem chave no mapa: %s" % tab)
        if tab not in set(self.lt.tabelas()):
            return []
        nomes, it = self.lt.ler_tudo(tab, colunas=list(dict.fromkeys(ch + list(colunas))))
        saida = []
        for x in it:
            d = dict(zip(nomes, x))
            saida.append(("|".join(self._chave(d[c]) for c in ch), d))
        return saida

    def _coluna_pai(self, tab, col):
        k = (tab, col)
        if k not in self._origem_pai:
            self._origem_pai[k] = {cp: d[col] for cp, d in self._ler_pai(tab, [col])}
        return self._origem_pai[k]

    def _chave_alternativa(self, tab, col):
        """{valor canônico da coluna (ou das colunas, tupla, unidas por '|'): chave do pai ou _AMBIGUO}."""
        k = (tab, col)
        cols = list(col) if isinstance(col, tuple) else [col]
        if k not in self._alt:
            m = {}
            for cp, d in self._ler_pai(tab, cols):
                if all(d[c] is None for c in cols):
                    continue
                v = "|".join(self._chave(d[c]).strip() for c in cols)
                m[v] = cp if v not in m else _AMBIGUO
            self._alt[k] = m
        return self._alt[k]

    def _seguir(self, linha, nome, passos):
        """Segue os passos de uma referência declarada. (valor, (tabela, chave do pai) ou None, regra ou None):
        terminada em tabela devolve a chave do pai a resolver; terminada em coluna, o valor da origem do pai."""
        v, atual = linha.get(nome), None
        for i, s in enumerate(passos):
            if "coluna" in s:
                if atual[1] not in self._coluna_pai(atual[0], s["coluna"]):
                    return None, None, "pai_inexistente"
                v, atual = self._coluna_pai(atual[0], s["coluna"])[atual[1]], None
                continue
            if i == 0 and s["modo"] in ("composta", "alt_composta"):
                partes = [linha[c] for c in (s.get("cols") or s["arg"])]
                if all(x is None for x in partes):
                    return None, None, None
                if s["modo"] == "composta":
                    cp = "|".join(self._chave(x) for x in partes)
                else:
                    cp = self._chave_alternativa(s["tabela"], tuple(s["arg"])).get(
                        "|".join(self._chave(x).strip() for x in partes))
                    if cp is None:
                        return None, None, "pai_inexistente"
                    if cp is _AMBIGUO:
                        return None, None, "pai_ambiguo"
            else:
                if v is None or (isinstance(v, (int, float, decimal.Decimal)) and v == 0) or \
                        (isinstance(v, (str, bytes)) and not self._chave(v).strip()):
                    return None, None, None
                if s["modo"] == "alt":
                    cp = self._chave_alternativa(s["tabela"], s["arg"]).get(self._chave(v).strip())
                    if cp is None:
                        return None, None, "pai_inexistente"
                    if cp is _AMBIGUO:
                        return None, None, "pai_ambiguo"
                else:
                    cp = self._chave(v)
            atual = (s["tabela"], cp)
        if atual is not None and passos[-1].get("destino"):  # id do destino secundário que o pai gravou
            atual = (atual[0], "%s/%s" % (atual[1], passos[-1]["destino"]))
        return v, atual, None

    def _referencia_chave(self, t, chave, coluna, ref, cpai):
        if ref not in self.existente:
            self._carregar_existente(ref)
        ant = self.existente[ref].get(cpai)
        if ant is None:
            return None, "pai_inexistente", "media"
        if ant[0] is None and ant[3]:
            if not self.prop.pendente(ref, cpai):
                self.prop.registrar(ref, cpai, ant[3], ant[4] or "alta")
            ps = self.prop.avaliar(t, chave, [(coluna, ref, cpai)])
            return None, "pai_pendente", (ps[0]["gravidade"] if ps else "alta")
        return ant[0], None, None

    def _converter(self, t, chave, p, linha, c, raw, pend):
        """Uma coluna da origem pela referência (simples, composta, alternativa ou encadeada), de-para oficial ou de
        valores e regra. (valor, recusa ou None, chave do pai adiada ou None)."""
        nome = c["coluna"]
        regra = sentinela.regra_efetiva(c["regra"] or "texto", self.subtipo.get(nome, 0))
        if c.get("passos"):
            raw, alvo, pr = self._seguir(linha, nome, c["passos"])
            if pr:
                pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
                return None, None, None
            if alvo is not None:
                x, pr, g = self._referencia_chave(t, chave, nome, alvo[0], alvo[1])
                if pr == "pai_pendente":
                    return None, (pr, g), None
                if pr:
                    pend.append((pr, g))
                return x, None, None
            if regra == "chave_origem":
                regra = "texto"
        pr = None
        if c["depara"] and depara.conhecido(c["depara"]):
            x, pr = self._depara(c["depara"]).resolver(raw)
            if pr:
                pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
        elif regra == "chave_origem" and c["referencia"] and not c.get("passos"):
            if c["referencia"] in p["duas_fases"]:
                if raw is not None and not (isinstance(raw, (int, float, decimal.Decimal)) and raw == 0):
                    return None, None, self._chave(raw)
                return None, None, ""  # sem pai: nada a adiar, mas a coluna segue fora do resumo
            x, pr, g = self._referencia(t, chave, nome, c["referencia"], raw)
            if pr == "pai_pendente":
                return None, (pr, g), None
            if pr:
                pend.append((pr, g))
        else:
            x, pr = sentinela.aplicar(regra, raw)
            if pr:
                pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
        if c.get("valores") is not None and not pr:
            k = "" if x is None else ("1" if x is True else "0" if x is False else str(x))
            if k in c["valores"]:
                x = c["valores"][k] or None
            elif x is not None:
                x = None
                pend.append(("valor_fora_do_dominio", "media"))
        return x, None, None

    def _texto_fonte(self, c, linha):
        """Valor convertido da coluna de origem de uma especial (`#sha256`, `#codigo_derivado`), pela regra declarada
        na própria linha especial (padrão: texto)."""
        col = fonte_especial(c["coluna"])
        regra = sentinela.regra_efetiva(c["regra"] or "texto", self.subtipo.get(col, 0))
        return sentinela.aplicar(regra, linha[col])[0]

    def _retrato(self, p, linha):
        """JSON estável das colunas lidas, convertidas (sem segredo)."""
        d = {}
        for n, r in sorted(p["retrato"].items()):
            r = "texto" if r == "chave_origem" else r
            x = sentinela.aplicar(sentinela.regra_efetiva(r, self.subtipo.get(n, 0)), linha[n])[0]
            if isinstance(x, (bytes, bytearray)):
                x = "sha256:" + hashlib.sha256(x).hexdigest()
            elif isinstance(x, (datetime.date, datetime.time)):
                x = x.isoformat()
            elif isinstance(x, (decimal.Decimal, float)):
                x = canon(decimal.Decimal(str(x)))
            d[n] = x
        return json.dumps(d, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    def _valores(self, p, linha, chave):
        """{dt: [(sufixo, {coluna destino: valor})]}, {dt: [(colunas, resumo)]}, pendências [(regra, grav)], recusa
        (regra, grav) ou None, adiadas [(dt, coluna, ref, chave_pai)]. Sufixo '' é a linha única do destino; o
        destino desdobrado tem um sufixo (rótulo) por item; o opcional sem valor da origem fica com lista vazia."""
        t = p["tabela"]
        vals, campos, pend, adiadas = {}, {}, [], []
        for dt in p["destinos"]:
            info = self._info(dt)
            op = (p.get("opcoes") or {}).get(dt) or {}
            modelo, algum = [], False          # [(coluna destino, valor ou marca)] na ordem declarada
            for c in p["colunas"][dt]:
                nome, dc = c["coluna"], c["destino"]
                if nome == "@id" or nome.startswith("@id:"):
                    continue  # preenchido na gravação (id do principal ou do secundário `antes`); fora do resumo
                if nome in ("#item", "#rotulo"):
                    modelo.append((dc, nome))
                    continue
                if nome.startswith("=~"):
                    x = nome[2:]
                    pend.append(("valor_presumido", "baixa"))
                elif nome.startswith("="):
                    x = nome[1:]
                elif nome == "@vigencia_carga":
                    x = self.data_carga
                    pend.append(("vigencia_sem_fonte", "baixa"))
                elif nome == "@estabelecimento":
                    x = self._estabelecimento()
                    if x is None:
                        return None, None, pend, ("estabelecimento_indefinido", "alta"), []
                elif nome.startswith("@unico:"):
                    x = self._unica(nome[7:])
                    if x is None:
                        return None, None, pend, ("cadastro_unico_indefinido", "alta"), []
                elif nome.startswith("#seq:"):
                    x = self.seq[nome[5:]]
                elif nome.startswith("#sha256:"):
                    y = self._texto_fonte(c, linha)
                    x = None if y is None else hashlib.sha256(
                        y if isinstance(y, (bytes, bytearray)) else str(y).encode("utf-8")).hexdigest()
                    algum = algum or x is not None
                elif nome.startswith("#codigo_derivado:"):
                    y = self._texto_fonte(c, linha)
                    _, _, n, pre = (nome.split(":") + [""])[:4]
                    x, mudou = codigo_derivado(None if y is None else str(y), int(n), pre)
                    if mudou:
                        pend.append(("codigo_derivado", "baixa"))
                    algum = algum or x is not None
                elif nome.startswith("#data:"):
                    x, pr = data_composta(*[linha[y] for y in nome[6:].split(",")])
                    if pr:
                        pend.append((pr, "media"))
                    algum = algum or x is not None
                elif nome.startswith("#data_hora:"):
                    x, pr = data_hora_composta(*[linha[y] for y in nome[11:].split(",")])
                    if pr:
                        pend.append((pr, GRAVIDADE_REGRA.get(pr, "media")))
                    algum = algum or x is not None
                elif nome == "#retrato":
                    x = self._retrato(p, linha)
                elif nome.startswith("#cofre:"):
                    # segredo nunca gravado em claro: o conector não tem cofre; a linha pede a credencial no cofre
                    x = None
                    if sentinela.aplicar("texto", linha[fonte_especial(nome)])[0] is not None:
                        pend.append(("segredo_aguarda_cofre", "media"))
                else:
                    x, recusa, adiada = self._converter(t, chave, p, linha, c, linha[nome], pend)
                    if recusa:
                        return None, None, pend, recusa, []
                    if adiada is not None:
                        if adiada:
                            adiadas.append((dt, dc, c["referencia"], adiada))
                        continue  # coluna em duas fases: NULL agora, fora do resumo
                    algum = algum or x is not None
                    if dc == "id" and op.get("complementa") and x is None:
                        return None, None, pend, ("pai_inexistente", "media"), []
                if x == "@data_carga":
                    x = self.data_carga
                if c.get("cod") and x is not None:  # id pelo código no cadastro do destino
                    x = self._id_por_codigo(c["cod"][0], c["cod"][1], x if not isinstance(x, bool) else int(x))
                    if x is None or x is _AMBIGUO:
                        pend.append(("pai_ambiguo" if x is _AMBIGUO else "codigo_inexistente_destino", "media"))
                        x = None
                modelo.append((dc, x))
            itens = [("", None)]
            if op.get("desdobrar"):
                itens = []
                ci = next(c for c in p["colunas"][dt] if c["coluna"] == "#item")
                for col, rot in op["desdobrar"]:
                    x, recusa, _ = self._converter(t, chave, p, linha, dict(ci, coluna=col, passos=None), linha[col],
                                                   pend)
                    if recusa:
                        return None, None, pend, recusa, []
                    if x is not None and x is not False:
                        itens.append((rot, x))
            elif op.get("opcional") and not algum:
                itens = []
            vals[dt], campos[dt] = [], []
            for rot, item in itens:
                v, cs, nomes = {}, [], []
                for dc, x in modelo:
                    if x == "#item":
                        x = item
                    elif x == "#rotulo":
                        x = rot
                    ic = info.get(dc) or (True, None, None, False)
                    x = tipar(x, ic[1])
                    if x is NAO_NUMERICO:
                        x = None
                        pend.append(("valor_fora_do_dominio", "media"))
                    nomes.append(dc)
                    if x is None and ic[3]:  # NOT NULL com padrão: o destino decide; o resumo usa o valor relido
                        cs.append(_PADRAO(dc))
                        continue
                    x = _truncar(x, ic[2])
                    v[dc] = x
                    cs.append(x)
                if "origem" in info and "origem" not in v and not op.get("complementa"):
                    v["origem"] = "migracao"
                vals[dt].append((rot, v))
                campos[dt].append((nomes, cs))
        return vals, campos, pend, None, adiadas

    def _gravar_ou_adotar(self, dt, v, adotar, complementa=False):
        """(id, adotado): com `adotar`, a linha do destino que já tem as mesmas colunas (uma só) é adotada; com
        `complementa`, a linha do pai (`id` resolvido pela referência) recebe as colunas por UPDATE."""
        if complementa:
            rid = v["id"]
            cols = [c for c in v if c != "id"]
            if cols:
                with self._c() as c:
                    c.execute("UPDATE `%s` SET %s WHERE id=%%s" % (dt, ", ".join("`%s`=%%s" % x for x in cols)),
                              [v[x] for x in cols] + [rid])
            return rid, False
        if adotar and all(v.get(a) is not None for a in adotar):
            ids = self._todas("SELECT id FROM `%s` WHERE %s LIMIT 2" % (dt, " AND ".join("`%s`=%%s" % a for a in adotar)),
                              tuple(v[a] for a in adotar))
            if len(ids) == 1:
                return ids[0][0], True
        return self._inserir(dt, v), False

    def _nome_ent(self, t, dt):
        k = (t, dt)
        if k not in self.ent:
            nome, i = dt, 2
            while nome in self.usadas:
                nome, i = "%s#%d" % (dt, i), i + 1
            self.usadas.add(nome)
            self.ent[k] = nome
        return self.ent[k]

    # ----- carga de uma tabela -----
    def _tabela(self, p):
        t, dts = p["tabela"], p["destinos"]
        ents = [self._nome_ent(t, dt) for dt in dts]
        colide = self._colisoes(p)
        seqs = [c["coluna"][5:] for dt in dts for c in p["colunas"][dt] if c["coluna"].startswith("#seq:")]
        cont_seq = {}
        inicio, n = time.monotonic(), 0
        for linha, ch_sem in self._linhas_mapa(p):
            n += 1
            chave = ch_sem or "|".join(self._chave(linha[c]) for c in p["chave"])
            for col in seqs:
                k = (col, self._chave(linha[col]))
                cont_seq[k] = cont_seq.get(k, 0) + 1
                self.seq[col] = cont_seq[k]
            h = bytes.fromhex(hash_linha([linha[c] for c in p["lidas"]]))
            sit, ant = self._situacao(t, chave, h)
            if sit != "nova":
                if ant[0] is not None:
                    self._secundarias_ja_carregadas(p, ents, chave, sit, ant)
                elif ant[3]:
                    self.prop.registrar(t, chave, ant[3], ant[4] or "alta")
                continue
            if chave in colide:
                vals, campos, pend, recusa, adiadas = None, None, [], ("codigo_colisao_caixa", "media"), []
            else:
                vals, campos, pend, recusa, adiadas = self._valores(p, linha, chave)
            if recusa:
                self._recusar(t, chave, ents[0], h, *recusa)
                self.prop.registrar(t, chave, *recusa)
                continue
            for regra, g in pend:
                self._pendencia(t, chave, regra, g)
            hds = []

            def gravar():
                ids = {}
                del hds[:]
                ops = p.get("opcoes") or {}
                ordem = [i for i, dt in enumerate(dts) if (ops.get(dt) or {}).get("antes")]
                ordem += [i for i in range(len(dts)) if i not in ordem]
                for i in ordem:
                    dt = dts[i]
                    primeiro = None
                    for (suf, v), (nomes, cs) in zip(vals[dt], campos[dt]):
                        for c in p["colunas"][dt]:
                            if c["coluna"] == "@id":
                                v[c["destino"]] = ids[dts[0]]
                            elif c["coluna"].startswith("@id:"):
                                v[c["destino"]] = ids.get(c["coluna"][4:])
                        op = (p.get("opcoes") or {}).get(dt) or {}
                        rid, adotado = self._gravar_ou_adotar(dt, v, op.get("adotar"), op.get("complementa"))
                        pad = [x for x in cs if isinstance(x, _PADRAO)]
                        if adotado:  # nada é sobrescrito: o resumo é o que está no destino
                            self._pendencia(t, chave, "adotado_existente", "baixa")
                            self.cont["adotadas"] = self.cont.get("adotadas", 0) + 1
                            if nomes:
                                cs = list(self._todas("SELECT %s FROM `%s` WHERE id=%%s" % (
                                    ", ".join("`%s`" % c for c in nomes), dt), (rid,))[0])
                        elif pad:
                            self.cont["padrao_do_destino"] = self.cont.get("padrao_do_destino", 0) + len(pad)
                            lido = dict(zip(pad, self._todas("SELECT %s FROM `%s` WHERE id=%%s" % (
                                ", ".join("`%s`" % c for c in pad), dt), (rid,))[0]))
                            cs = [lido[x] if isinstance(x, _PADRAO) else x for x in cs]
                        hd = hashlib.sha256("|".join(canon(x) for x in cs).encode()).digest()
                        k = chave if i == 0 else "%s/%s%s" % (chave, dt, "/" + suf if suf else "")
                        self._registrar(t, k, dts[i] if i else ents[0], rid, h, hd)
                        hds.append((ents[i], chave + ("/" + suf if suf else ""), hd))
                        primeiro = primeiro or rid
                    ids[dt] = primeiro
                return [ids.get(dt) for dt in dts]
            ids = self._linha_nova(t, chave, ents[0], h, gravar)
            if ids:
                for ent, k, hd in hds:
                    self.origem.setdefault(ent, {})[k] = hd.hex()
                for dt, dc, ref, cpai in adiadas:
                    if ids[dts.index(dt)] is not None:
                        self.adiadas.append((dt, dc, ids[dts.index(dt)], ref, cpai, t, chave))
            else:
                self.prop.registrar(t, chave, self.existente[t][chave][3] or "recusada", "critica")
            if n % LOTE_COMMIT == 0:
                self._commit()
        self._commit()
        seg = time.monotonic() - inicio
        self.por_tabela[t] = {"linhas": n, "segundos": round(seg, 3),
                              "linhas_por_segundo": round(n / seg, 1) if seg > 0 else None}

    def _secundarias_ja_carregadas(self, p, ents, chave, sit, ant):
        """Linha já carregada: principal e secundárias entram na soma da origem pelo que foi gravado. Opcional sem
        linha não entra; desdobrada entra um item por rótulo gravado."""
        t, ex = p["tabela"], self.existente.get(p["tabela"], {})
        for i, (ent, dt) in enumerate(zip(ents, p["destinos"])):
            if i == 0:
                self._ja_carregada(ent, chave, sit, ant)
                continue
            base, op = "%s/%s" % (chave, dt), (p.get("opcoes") or {}).get(dt) or {}
            if op.get("desdobrar"):
                for _, rot in op["desdobrar"]:
                    if base + "/" + rot in ex:
                        self._ja_carregada(ent, chave + "/" + rot, sit, ex[base + "/" + rot])
            elif op.get("opcional"):
                if base in ex:
                    self._ja_carregada(ent, chave, sit, ex[base])
            else:
                self._ja_carregada(ent, chave, sit, ex.get(base) or ant)

    def _fase2(self):
        """Referências adiadas (autorreferência e ciclo declarado em duas fases): gravadas por UPDATE no fim."""
        for dt, dc, rid, ref, cpai, t, chave in self.adiadas:
            if ref not in self.existente:
                self._carregar_existente(ref)
            ant = self.existente[ref].get(cpai)
            if ant is None or ant[0] is None:
                self.cont["fase2_pendentes"] += 1
                self._pendencia(t, chave, "pai_pendente" if ant else "pai_inexistente", "media")
                continue
            with self._c() as c:
                c.execute("UPDATE `%s` SET `%s`=%%s WHERE id=%%s" % (dt, dc), (ant[0], rid))
            self.cont["fase2_gravadas"] += 1
        self._commit()

    # ----- execução -----
    def executar(self, presentes, contagens):
        self.plano = planejar(self.mapa_exec, presentes)
        self.tabelas = [p["tabela"] for p in self.plano]
        if not self.plano:
            return {"versao_mapa": VERSAO, "entidades": {}, "pendencias": {"total": 0, "criticas": 0, "por_regra": {}},
                    "carga": dict(self.cont, por_tabela={})}
        for p in self.plano:
            self._carregar_existente(p["tabela"])
        for i, p in enumerate(self.plano):
            self.progresso(i / len(self.plano), "carregando %s" % p["destinos"][0])
            self._tabela(p)
        self._fase2()
        res = self.conciliar(contagens)
        self._commit()
        return res

    # ----- conciliação (destino relido do banco) -----
    def _destino(self, p, dt, ent, principal):
        info = self._info(dt)
        cols = [c for c in p["colunas"][dt] if not c["coluna"].startswith("@id") and not (
            not _especial(c["coluna"]) and (c["regra"] == "chave_origem" and c["referencia"] in p["duas_fases"]
                                            and not c.get("passos") and not depara.conhecido(c["depara"])))]
        ed = "(d.versao > 1 OR d.alterado_em IS NOT NULL)" if {"versao", "alterado_em"} <= set(info) else "0"
        sel = ", ".join(["co.chave_original"] + ["d.`%s`" % c["destino"] for c in cols] + [ed])
        rs = self._todas("SELECT %s FROM %s.conector_origem co JOIN `%s` d ON d.id=co.id_destino WHERE"
                         " co.tabela_origem=%%s AND co.entidade_destino=%%s" % (sel, self.ctl, dt),
                         (p["tabela"], ent if principal else dt))
        marca = "/" + dt
        saida = {}
        for r in rs:
            k = base = r[0]
            if not principal:
                if k.endswith(marca):
                    k = base = k[:-len(marca)]
                elif k.rfind(marca + "/") >= 0:  # item de destino desdobrado: <chave>/<dt>/<rótulo>
                    j = k.rfind(marca + "/")
                    base, k = k[:j], k[:j] + k[j + len(marca):]
            saida[k] = ("|".join(canon(x) for x in r[1:-1]), bool(r[-1]), base)
        return saida

    def conciliar(self, contagens):
        res = {}
        for p in self.plano:
            t = p["tabela"]
            vistas = self.vistas.get(t, set())
            for i, dt in enumerate(p["destinos"]):
                ent = self._nome_ent(t, dt)
                bruto = self._destino(p, dt, ent, i == 0)
                destino, apagadas = {}, 0
                for k, (txt, ed, base) in bruto.items():
                    if base not in vistas:
                        if i == 0:
                            apagadas += 1
                            self._pendencia(t, k, "apagada_aguarda_sincronizar", "media")
                        continue
                    destino[k] = (hashlib.sha256(txt.encode()).hexdigest(), ed)
                aguardam = self.aguardam.get(ent, set())
                so, sd, editados = self._conferir(ent, t, destino, vistas, aguardam)
                recusadas = sum(1 for k in vistas if self.existente.get(t, {}).get(k, (None,))[0] is None)
                lidos = int(contagens.get(t, 0))
                if i == 0:
                    ok = lidos == len(vistas) == len(destino) + recusadas and so == sd
                else:
                    ok = set(self.origem.get(ent, {})) | set(aguardam) == set(destino) and so == sd
                res[ent] = {"tabela_origem": t, "registros_origem": lidos if i == 0 else len(self.origem.get(ent, {})),
                            "registros_destino": len(destino), "recusados": recusadas if i == 0 else 0,
                            "aguardam_sincronizar": len(aguardam), "editados_no_destino": editados,
                            "apagados_na_origem": apagadas, "soma_origem": so, "soma_destino": sd, "conferido": ok}
        principal = {p["tabela"]: self._nome_ent(p["tabela"], p["destinos"][0]) for p in self.plano}
        por_regra = {}
        for tab, _, regra, grav in self.pend:
            k = "%s:%s:%s" % (principal.get(tab, "outra"), regra, grav)
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
        return {"versao_mapa": VERSAO, "entidades": res, "pendencias": {
            "total": len(self.pend), "criticas": sum(1 for x in self.pend if x[3] == "critica"),
            "por_regra": por_regra}, "carga": dict(self.cont, por_tabela=self.por_tabela)}
