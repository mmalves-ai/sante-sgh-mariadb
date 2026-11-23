"""Mapa declarativo do conector (F4 L4): origem -> modelo, chave, estratégia de diferencial, dependências e ordem.

Arquivos em `conector/mapa/` (o mapa é a única parte que conhece nomes da origem, AGENTS.md regra 1):
- `tabelas.tsv`       GERADO: uma linha por tabela da origem no mapa da análise (destino, descarte ou mecanismo),
                      com chave, estratégia (plano F4, seção 6), lote, ordem topológica e dependências;
- `dependencias.tsv`  GERADO: arestas filha -> pai (FKs da origem entre tabelas carregadas);
- `colunas.tsv`       GERADO pelo dicionário da origem (só nomes e tipos): regra de sentinela, referência e de-para;
- `declarado/*.tsv`   À MÃO (revisado): ciclos quebrados em duas fases, descartes fora do mapa da análise,
                      tabelas que são catálogo oficial, tabelas do modelo que são catálogo oficial além das que têm
                      `versao_fonte` (oficiais.tsv) e colunas com destino declarado (valem por cima das geradas).
- `declarado/colunas.d/<fatia>.tsv`  À MÃO, uma por fatia (lotes L5 a L8 em paralelo): mesmo formato de
                      `declarado/colunas.tsv`. Lidos junto com ele, em ordem de nome (`ler_colunas_declaradas`).
                      Conflito entre arquivos é erro do verificador: a mesma tabela declarada em dois arquivos (cada
                      tabela da origem pertence a uma fatia) ou a mesma (tabela, coluna, destino) declarada duas vezes.

Colunas declaradas especiais (a carga dirigida pelo mapa, `carga_mapa.py`): `=<texto>` grava o literal no destino
(ex.: `=migracao`), `@id` grava o id da linha gravada no destino principal (o primeiro destino declarado), para a
tabela secundária apontar para ela.

Catálogo oficial (AGENTS.md regra 7): uma tabela do modelo é oficial quando tem a coluna `versao_fonte` no DDL (só o
carregador versionado a preenche) ou quando `declarado/oficiais.tsv` diz que é (e `N` lá tira uma). Nenhuma tabela da
origem grava nelas: o destino oficial sai de `tabelas_destino` e vai para `destinos_oficiais` (a parte oficial vira
de-para pelo código); se nada sobra, a estratégia é `depara_catalogo_oficial`. O verificador recusa tabela carregável
com destino oficial e tabela com destino oficial sem declaração em `declarado/catalogos.tsv`.

Estratégia de diferencial e "vazia" dos descartes: saem do volume da imagem de referência (um cliente) e são PROPOSTA.
Em toda execução o motor revê pela contagem do cliente: tabela da origem com linhas que não está no mapa (nem em
descarte incondicional) vira pendência `tabela_sem_mapa` (`tabelas_sem_mapa`), nunca carga nem descarte silencioso.

`montar()` é determinístico e não precisa do dicionário: o verificador refaz tabelas e dependências e compara.
Sem banco e sem Firebird: roda na esteira (`python3 -I conector/verificar_mapa.py`).
"""
import csv
import heapq
import re
import sys
from pathlib import Path

from . import depara, sentinela

RAIZ = Path(__file__).resolve().parents[2]
MAPA_ANALISE = "docs/analise/rodada2/final/mapa-spdata.tsv"
VOLUME = "docs/analise/origem-fb/volume-pc-20261019.tsv"
DIR = "conector/mapa"
DIR_PACOTE = Path(__file__).resolve().parents[1] / "mapa"  # conector/mapa no repositório, /app/mapa no container
LIMITE_PEQUENA = 100_000
ESTRATEGIAS = {
    "hash_linha": "< 100 mil registros: hash de cada linha (bytes crus) contra o conector_origem",
    "hash_linha_sem_chave": "< 100 mil, sem PK: multiconjunto de hashes de linha (inclusão/exclusão por contagem)",
    "data_alteracao_hash_bloco": "coluna de alteração como atalho + hash por bloco periódico (a data não é prova)",
    "faixa_id_hash_bloco": "PK inteira crescente: faixa nova + margem de reabertura + hash por bloco de 10 mil IDs",
    "hash_bloco_chave": "PK composta ou não inteira: hash por bloco ordenado pela chave",
    "sem_chave_recarga": "sem PK e >= 100 mil: recarga inteira ou append-only conferido por contagem e hash de bloco",
    "depara_catalogo_oficial": "a tabela é catálogo oficial: nunca gravada; as linhas viram de-para para o catálogo",
    "sem_carga": "mecanismo do produto sem dado a migrar (controle de versão, motor de integração, data mart)",
}
# mecanismos do mapa da análise -> tabelas físicas do modelo (historico_entidade:<t> soma a própria entidade)
MECANISMOS = {"parametro": ["parametro_definicao", "parametro_valor"], "historico_entidade": ["trilha_auditoria"],
              "arquivo": ["arquivo"], "integracao": [], "framework": [], "datamart": []}
# catálogos oficiais (carregador próprio, AGENTS.md regra 7): o conector nunca grava neles. Gerado do DDL
# (`versao_fonte`) mais `declarado/oficiais.tsv`: ver `oficiais()`.
COLUNA_OFICIAL = "versao_fonte"
# lotes de domínio (plano F4, seção 8: L5 a L8) por módulo da análise; L3 já carregado
LOTES = [("L5", "cadastros e administração", ["SIS", "ADM", "CAD", "RH"]),
         ("L6", "prontuário, assinatura e assistência", ["REC", "AGE", "PEP", "INT", "CC", "HOT"]),
         ("L7", "SADT e suprimentos", ["SADT", "SUP"]),
         ("L8", "faturamento e restantes", ["FAT", "SUS", "FIN", "SGO", "INTG", "REL", "QUA", ""])]
FEITAS_L3 = {"TBTPEMP", "TBHOSPIT", "TBUSERS", "RICADPAC", "REALTA", "RECADATE", "ATCABECATEND"}
# ordem de carga (plano, seção 6): usuários, estabelecimento, catálogos, cadastros, movimento, auditoria
PRIORIDADE = {"TBUSERS": 0, "TBHOSPIT": 1, "TBTPEMP": 1}
_AUDITORIA = re.compile(r"TRILHA|AUDIT|^HT|LOG$|^LOG|HIST")
CAMPOS_TABELAS = ["tabela", "tipo", "destinos", "tabelas_destino", "destinos_oficiais", "modulo", "lote", "ordem", "registros", "chave", "pk_inteira",
                  "col_alteracao", "estrategia", "depende_de", "dep_fora_do_mapa", "motivo"]
CAMPOS_COLUNAS = ["tabela", "coluna", "forma", "obrigatoria", "regra", "referencia", "depara"]
CAMPOS_DECL = ["tabela", "coluna", "destino", "regra", "depara", "via", "motivo"]
# de-para de VALORES próprio (código da origem -> valor do domínio do destino), para coluna declarada com depara
# `valores`; `valor_origem` vazio casa o nulo. Valor sem par: NULL com pendência valor_fora_do_dominio.
CAMPOS_VALORES = ["tabela", "coluna", "destino", "valor_origem", "valor_destino", "motivo"]
DEPARA_VALORES = "valores"


_LISTA = r"[A-Z0-9_$]+(?:,[A-Z0-9_$]+)+"
# colunas desta linha na chave alternativa composta: coluna ou literal `=<valor>` (rodada 4: '=1' casa a constante)
_LISTA_V = r"(?:[A-Z0-9_$]+|=[^,()>;=]*)(?:,(?:[A-Z0-9_$]+|=[^,()>;=]*))+"
# rodada 5 (sobra da rodada 4, pedido 4 da L8-03): componente da chave composta com valor ENCADEADO `COL>T>X` (a
# coluna COL desta linha leva a T pela chave e o componente é a coluna X do pai), ex. `TBTABTHM(CON>TBCONVEN>THM,THM)`
_COMP = r"[A-Z0-9_$]+(?:>[A-Z0-9_$]+(?:\.[A-Z0-9_$]+)?)*"
_LISTA_C = r"%s(?:,%s)+" % (_COMP, _COMP)
_REF_TAB = re.compile(r"([A-Z0-9_$]+)(?:\.([A-Z0-9_$]+)|\((%s)\)|\.\((%s)\)=\((%s)\))?(?:/([a-z][a-z0-9_]*))?"
                      r"(?:@([a-z][a-z0-9_]*))?" % (_LISTA_C, _LISTA, _LISTA_V))


def _partes_ref(spec):
    """Passos separados por '>' fora dos parênteses (o componente encadeado da chave composta fica inteiro)."""
    out, nivel, atual = [], 0, ""
    for ch in spec:
        if ch == "(":
            nivel += 1
        elif ch == ")":
            nivel -= 1
        if ch == ">" and nivel == 0:
            out.append(atual)
            atual = ""
        else:
            atual += ch
    return out + [atual]
_COL_ORIGEM = re.compile(r"[A-Z0-9_$]+")
_COLS_PASSO = re.compile(r"\((%s)\)" % _LISTA)
_ESCOLHA = re.compile(r"(max|min):([A-Z0-9_$]+)")


def passos_ref(spec):
    """Referência declarada (`ref:<spec>` na via) em passos; None se mal formada. Formas (todas genéricas):
    - `T`          o valor da coluna é a chave de T (id do destino de T pelo conector_origem);
    - `T.K`        chave alternativa: o valor casa com a coluna K de T na origem (ex.: sigla, código, login);
    - `T(C1,C2)`   chave composta: a chave de T é montada pelas colunas C1, C2 DESTA linha (na ordem da chave de T);
    - encadeada    `T>X` troca o valor pela coluna X da linha de T na origem; `T>X>U` segue para U pela chave
                   (ou `U.K`). Terminada em coluna, o valor segue para a regra/de-para declarados (ex.: código de
                   catálogo oficial guardado no pai); terminada em tabela, grava o id do destino dela;
    - `T.(K1,K2)=(C1,C2)` chave alternativa COMPOSTA (só no primeiro passo): as colunas C1, C2 desta linha casam com
                   as colunas K1, K2 de T na origem (repetido: `pai_ambiguo`);
    - `.../<destino>` no último passo de tabela: grava o id da linha do DESTINO SECUNDÁRIO `<destino>` que o pai gravou
                   (chave `<chave do pai>/<destino>` no conector_origem), não o do principal;
    - `...@<coluna>` no último passo de tabela (também depois de `/<destino>`): em vez do id, grava o valor da
                   `<coluna>` da linha do DESTINO que o pai gravou (cópia de coluna de outra tabela, ex.: o item
                   faturável do lançamento: `ref:FCLANEXT@item_faturavel_id`).
    Rodada 4 (pedido 20 da L8-12, 3a da L8-11):
    - literal entre as colunas da chave alternativa composta: `T.(K1,K2)=(C1,=1)` (a 2ª casa a constante '1');
    - `max:<COL>` (ou `min:<COL>`) logo depois de um passo por chave alternativa: vários pais casam e vale o de MAIOR
      (menor) COL, empate pela menor chave, com a pendência baixa `escolha_pelo_maior` (nenhum: pai_inexistente);
    - chave composta num passo SEGUINTE: `...>(C1,C2,C3)>U` monta a chave de U pelas colunas da linha do passo
      anterior (ex.: a natureza do rateio pelo grupo, subgrupo e item)."""
    out = []
    partes = _partes_ref(spec or "")
    tabela_agora = True
    for i, p in enumerate(partes):
        ultimo = i == len(partes) - 1
        me = _ESCOLHA.fullmatch(p)
        if me:
            if tabela_agora or not out or out[-1].get("modo") not in ("alt", "alt_composta") or "escolha" in out[-1]:
                return None
            out[-1]["escolha"] = (me.group(1), me.group(2))
            continue
        if tabela_agora:
            tabela_agora = False
            m = _REF_TAB.fullmatch(p)
            if not m or ((m.group(3) or m.group(4)) and out) or ((m.group(6) or m.group(7)) and not ultimo):
                return None
            if m.group(4) and len(m.group(4).split(",")) != len(m.group(5).split(",")):
                return None
            modo = "alt" if m.group(2) else "composta" if m.group(3) else "alt_composta" if m.group(4) else "chave"
            x = {"tabela": m.group(1), "modo": modo,
                 "arg": m.group(2) if m.group(2) else m.group(3).split(",") if m.group(3) else
                 m.group(4).split(",") if m.group(4) else None}
            if m.group(4):
                x["cols"] = m.group(5).split(",")
            if m.group(3) and ">" in m.group(3):  # componentes encadeados: {posição: passos a partir da coluna}
                x["cadeias"] = {}
                for j, comp in enumerate(x["arg"]):
                    if ">" in comp:
                        base, resto = comp.split(">", 1)
                        sub = passos_ref(resto)
                        if not sub or "coluna" not in sub[-1] or any(s.get("cadeias") for s in sub):
                            return None
                        x["arg"][j] = base
                        x["cadeias"][j] = sub
            if m.group(6):
                x["destino"] = m.group(6)
            if m.group(7):
                x["coluna_destino"] = m.group(7)
            out.append(x)
        else:
            tabela_agora = True
            mc = _COLS_PASSO.fullmatch(p)
            if mc and not ultimo:
                out.append({"colunas": mc.group(1).split(",")})
                continue
            if not _COL_ORIGEM.fullmatch(p):
                return None
            out.append({"coluna": p})
    return out or None


def tabelas_dos_passos(passos):
    """Todas as tabelas da origem citadas nos passos (também nos componentes encadeados da chave composta)."""
    out = []
    for x in passos or []:
        if x.get("tabela"):
            out.append(x["tabela"])
        for sub in (x.get("cadeias") or {}).values():
            out += tabelas_dos_passos(sub)
    return out


def colunas_da_linha(passo):
    """Colunas DESTA linha lidas pelo primeiro passo composto (sem os literais `=x`)."""
    return [x for x in (passo.get("cols") or passo.get("arg") or []) if not x.startswith("=")] \
        if passo.get("modo") in ("composta", "alt_composta") else []


_COND = re.compile(r"([A-Z0-9_$]+)((?:>[^=!]+)?)(?:=([^!]*))?(?:!([a-z][a-z0-9_]*))?")


def condicao(spec):
    """Condição de linha (rodada 4, `se:`, `destino_se:` e `so_se:` na via): `COL[>T>X..][=v1,v2][!regra]`. A coluna
    desta linha (ou, pela encadeada terminada em coluna, a do pai) tem um dos valores (texto aparado; inteiro sem
    '.0'; valor vazio na lista casa o nulo) ou, sem lista, tem valor. `!regra` só no `so_se:` (padrão
    `fora_do_filtro_da_carga`). None se mal formada."""
    m = _COND.fullmatch(spec or "")
    if not m:
        return None
    passos = None
    if m.group(2):
        passos = passos_ref(m.group(2)[1:])
        if not passos or "coluna" not in passos[-1]:
            return None
    return {"coluna": m.group(1), "passos": passos,
            "valores": None if m.group(3) is None else m.group(3).split(","), "regra": m.group(4) or ""}


_COD_COMPOSTO = re.compile(r"([a-z][a-z0-9_]*)\.\(([a-z0-9_]+(?:,[a-z0-9_]+)+)\)=\(((?:valor|=[^,()]*)"
                           r"(?:,(?:valor|=[^,()]*))+)\)")


def cod_spec(x):
    """`cod:` da via: `tabela.coluna` -> (tabela, coluna); composto (rodada 4, pedido 13 da L5-12)
    `tabela.(c1,c2)=(v1,v2)` (cada v: `valor`, o da coluna depois da regra/de-para, ou literal `=x`) ->
    (tabela, [c1, c2], [v1, v2]). None se mal formado."""
    m = _COD_COMPOSTO.fullmatch(x)
    if m:
        cs, vs = m.group(2).split(","), m.group(3).split(",")
        return (m.group(1), cs, vs) if len(cs) == len(vs) else None
    tc = x.split(".")
    return (tc[0], tc[1]) if len(tc) == 2 and all(re.fullmatch(r"\w+", y) for y in tc) else None


def ref_simples(spec):
    """Referência só pela chave do pai (a forma original `ref:T`)."""
    p = passos_ref(spec)
    return bool(p) and len(p) == 1 and p[0]["modo"] == "chave" and not p[0].get("destino") \
        and not p[0].get("coluna_destino")


# colunas especiais da carga dirigida pelo mapa (carga_mapa.py); `=<texto>` é literal (e `=~<texto>`, presumido)
_ESPECIAIS = re.compile(r"@id|@id:[a-z][a-z0-9_]*|@estabelecimento|@unico:[a-z][a-z0-9_]*|@vigencia_carga|#item[2-9]?|#item@[A-Z0-9_$]+|#rotulo[2-9]?|#retrato|#seq:[A-Z0-9_$]+|#sha256:[A-Z0-9_$]+"
                        r"|#cofre:[A-Z0-9_$]+|#arquivo:[A-Z0-9_$]+(?::[a-z][a-z0-9_]{0,59})?|#data:[A-Z0-9_$]+,[A-Z0-9_$]+(?:,[A-Z0-9_$]+)?|#data_hora:[A-Z0-9_$]+,[A-Z0-9_$]+(?:,[A-Z0-9_$]+)?|#codigo_derivado:[A-Z0-9_$]+:[1-9][0-9]*(?::[^:\t]{1,80})?"
                        r"|#dias:[A-Z0-9_$]+,(?:[A-Z0-9_$]+|=[a-z]+)"
                        r"|(?:#sha256:)?#retrato:(?:\*(?:-[A-Z0-9_$]+(?:,[A-Z0-9_$]+)*)?|[A-Z0-9_$]+(?:,[A-Z0-9_$]+)*)"
                        r"|#sha256:#retrato|#grupo_contar|#grupo_seq|#grupo_(?:somar|min|max):[A-Z0-9_$]+"
                        # rodada 4
                        r"|#data_hora_mais:[A-Z0-9_$]+,[A-Z0-9_$]+,[A-Z0-9_$]+"
                        r"|#codigo_derivado:[A-Z0-9_$]+(?:\+[A-Z0-9_$]+)+:[1-9][0-9]*(?::[^:\t]{1,80})?"
                        r"|#grupo_json:[A-Z0-9_$]+(?:,[A-Z0-9_$]+)*"
                        r"|#grupo_seq@(?:\*|[A-Z0-9_$]+(?:,[A-Z0-9_$]+)*)|#grupo_razao:[A-Z0-9_$]+@[A-Z0-9_$]+(?:,[A-Z0-9_$]+)*"
                        r"|#filhos_(?:min|max|somar|contar):[A-Z0-9_$]+\.[A-Z0-9_$]+(?:\|[A-Z0-9_$]+\.[A-Z0-9_$]+)*"
                        r"@[A-Z0-9_$]+"
                        # rodada 4, resíduo do motor: aritmética entre colunas da linha
                        r"|#dif:[A-Z0-9_$]+,[A-Z0-9_$]+|#soma:[A-Z0-9_$]+(?:,[A-Z0-9_$]+)+"
                        # rodada 5 (ADR 0007): vigência pela evidência e senha de login
                        r"|#vigencia(?::[A-Z0-9_$]+(?:,[A-Z0-9_$]+)*)?|#senha:[A-Z0-9_$]+"
                        r"|#senha_hash:[A-Z0-9_$]+:(?:md5|sha1|sha256|sha512|bcrypt|scrypt|argon2id)")
# colunas que um retrato de TODAS as colunas (`#retrato:*`) nunca leva, mesmo sem `#cofre` declarado (segredo)
SEGREDO_NOME = re.compile(r"SENHA|PASSW|TOKEN|SECRET|SEGREDO|CHAVE_PRIVADA|PRIVATE_KEY")


def spec_retrato(nome):
    """`#retrato` -> {"todas": False, "exceto": [], "extras": []}; `#retrato:*-A,B` -> todas menos A e B (e sem
    segredo); `#retrato:A,B` -> as colunas lidas mais A e B. Também para `#sha256:#retrato...`. None se não for."""
    if nome.startswith("#sha256:"):
        nome = nome[8:]
    if nome == "#retrato":
        return {"todas": False, "exceto": [], "extras": []}
    if not nome.startswith("#retrato:"):
        return None
    arg = nome[9:]
    if arg.startswith("*"):
        return {"todas": True, "exceto": [x for x in arg[2:].split(",") if x], "extras": []}
    return {"todas": False, "exceto": [], "extras": [x for x in arg.split(",") if x]}
_ITEM = re.compile(r"#item([2-9]?)")
_ROTULO = re.compile(r"#rotulo([2-9]?)")


def posicao_item(nome):
    """Posição (0..8) de `#item`/`#item2`.. ou de `#rotulo`/`#rotulo2`..; None se não for marca de item."""
    m = _ITEM.fullmatch(nome or "") or _ROTULO.fullmatch(nome or "")
    return (int(m.group(1) or 1) - 1) if m else None


def eh_item(nome):
    return bool(_ITEM.fullmatch(nome or "") or _ROTULO.fullmatch(nome or ""))
OPCOES_DESTINO = ("opcional", "adotar:", "adotar_maior:", "adotar_ativo:", "identidade", "desdobrar:", "complementa", "antes", "agrupar:", "com_falso", "destino_se:",
                  "por_pai")
# opções de COLUNA na via (resíduo do motor da rodada 4): `exige_dominio` (fora do de-para de valores recusa a linha),
# `senao` (concorrente que, ao preencher, apaga a pendência valor_fora_do_dominio das anteriores), `marca` (num `=~x`
# concorrente: a pendência valor_presumido em TODA linha, mesmo quando outra declaração deu o valor)
OPCOES_COLUNA = ("exige_dominio", "senao", "marca", "autor")
# rodada 5 (ADR 0006, item 3): ligação ao ESPELHO PADRÃO DA BASE pelo código (e pela edição): `espelho:<catalogo>`
# ou `espelho:<catalogo>@<COLUNA>` / `espelho:<catalogo>@=<edição>` na via. Catálogo -> tabela que a ligação acha.
ESPELHO_CATALOGOS = {"brasindice": "item_referencia_matmed", "simpro": "item_referencia_matmed",
                     "cbhpm": "tabela_referencia_procedimento_item", "cep": "logradouro_cep"}
# tabelas do conteúdo licenciado: vivem no espelho; o conector nunca as grava (a cobertura bloqueia quem declarar)
LICENCIADAS_ESPELHO = {"fonte_referencia_matmed", "edicao_referencia_matmed", "item_referencia_matmed",
                       "preco_referencia_matmed", "tabela_referencia_procedimento",
                       "tabela_referencia_procedimento_item", "logradouro_cep"}
_ESPELHO = re.compile(r"espelho:([a-z]+)(?:@([A-Z0-9_$]+|=[A-Za-z0-9._/-]{1,30}))?")


def espelho_spec(x):
    """`espelho:<catalogo>[@<COLUNA>|@=<edição>]` -> {"catalogo", "edicao_coluna", "edicao"} ou None."""
    m = _ESPELHO.fullmatch(x or "")
    if not m or m.group(1) not in ESPELHO_CATALOGOS:
        return None
    e = m.group(2) or ""
    return {"catalogo": m.group(1), "edicao_coluna": "" if e.startswith("=") else e,
            "edicao": e[1:] if e.startswith("=") else ""}


def opcoes_destino(colunas):
    """{destino: {"opcional": bool, "adotar": [colunas do destino], "desdobrar": [(COLUNA, rótulo)]}} pela `via` das
    colunas declaradas de UMA tabela da origem (a opção vale para o destino inteiro da coluna que a declara)."""
    saida = {}
    for c in colunas:
        dt = (c.get("destino") or "").partition(".")[0]
        if not dt:
            continue
        o = saida.setdefault(dt, {"opcional": False, "adotar": [], "desdobrar": [], "complementa": False,
                                  "antes": False, "agrupar": [], "com_falso": False, "se": None,
                                  "por_pai": False, "adotar_maior": [], "adotar_ativo": [], "identidade": False})
        for x in (c.get("via") or "").split(";"):
            if x.startswith("destino_se:"):  # rodada 4: o destino (secundário) só grava quando a condição vale
                o["se"] = condicao(x[11:]) or {"invalida": x[11:]}
            elif x == "opcional":
                o["opcional"] = True
            elif x == "por_pai":       # uma linha do destino por pai da chave alternativa repetida (resíduo r4)
                o["por_pai"] = True
            elif x == "com_falso":     # desdobrar: o item FALSO também gera linha (ex.: herda = falso)
                o["com_falso"] = True
            elif x.startswith("agrupar:"):  # cabeçalho de várias linhas (título das parcelas): colunas da ORIGEM
                o["agrupar"] = [y for y in x[8:].split(",") if y]
            elif x == "antes":
                o["antes"] = True
            elif x == "complementa":
                o["complementa"] = True
            elif x.startswith("adotar:"):
                o["adotar"] = [y for y in x[7:].split(",") if y]
            elif x == "identidade":  # a chave de adoção identifica uma PESSOA: valor presumido nunca adota
                o["identidade"] = True
            elif x.startswith("adotar_ativo:"):  # adota antes o ATIVO de menor id com estas colunas (o do produto)
                o["adotar_ativo"] = [y for y in x[13:].split(",") if y]
            elif x.startswith("adotar_maior:"):  # rodada 6: na adoção, a coluna guarda o MAIOR (contador)
                o["adotar_maior"] = [y for y in x[13:].split(",") if y]
            elif x.startswith("desdobrar:"):
                # item: COLUNA ou COL1+COL2 (par: #item e #item2); rótulo com partes separadas por '|' (#rotulo,
                # #rotulo2; parte vazia = NULL)
                o["desdobrar"] = [tuple(y.split("=", 1)) if "=" in y else (y, y) for y in x[10:].split(",") if y]
    return saida


def principal_e_destinos(tabelas_destino, colunas):
    """Destinos declarados de uma tabela na ordem da carga: o primeiro é o principal (ordem de `tabelas_destino`)."""
    ordem = [x for x in (tabelas_destino or "").split(";") if x]
    dts = []
    for c in colunas:
        dt = (c.get("destino") or "").partition(".")[0]
        if dt and (c.get("destino") or "").count(".") == 1 and dt not in dts:
            dts.append(dt)
    pos = {x: i for i, x in enumerate(dts)}
    # rodada 4 (pedido 20 da L6-11): opção `principal` na via de uma coluna escolhe o destino principal
    esc = [(c.get("destino") or "").partition(".")[0] for c in colunas if "principal" in (c.get("via") or "").split(";")]
    return sorted(dts, key=lambda x: (0 if esc and x == esc[0] else 1,
                                      ordem.index(x) if x in ordem else len(ordem), pos[x]))


def _especial_decl(nome):
    return (nome or "")[:1] in ("=", "@", "#")


def erros_especiais_e_opcoes(colunas_decl, tabelas, ddl):
    """Coluna especial conhecida; opções de destino (opcional, adotar, desdobrar) nunca no destino principal, colunas
    de adoção existentes no DDL, `#item`/`#rotulo` só em destino desdobrado. Só nomes."""
    erros, por_t = [], {}
    por = {r["tabela"]: r for r in tabelas}
    for c in colunas_decl:
        n = c.get("coluna") or ""
        if n[:1] in ("@", "#") and not _ESPECIAIS.fullmatch(n):
            erros.append("coluna especial desconhecida: %s.%s" % (c["tabela"], n))
        if n.startswith("@unico:") and ddl and n[7:] not in ddl:
            erros.append("@unico a tabela inexistente no DDL: %s.%s" % (c["tabela"], n))
        for x in (c.get("via") or "").split(";"):
            if x.startswith("cod:"):
                cs = cod_spec(x[4:])
                cols = ([cs[1]] if isinstance(cs[1], str) else cs[1]) if cs else []
                if not cs or (ddl and (cs[0] not in ddl or any(y not in ddl[cs[0]]["colunas"] for y in cols))):
                    erros.append("cod: a tabela.coluna inexistente no DDL: %s.%s -> %s" % (c["tabela"], n, x[4:]))
            if x.startswith("espelho:") and espelho_spec(x) is None:
                erros.append("espelho: mal formado ou catálogo desconhecido: %s.%s -> %s" % (c["tabela"], n, x))
            for pre in ("se:", "so_se:", "destino_se:"):
                if x.startswith(pre):
                    cd = condicao(x[len(pre):])
                    if cd is None or (cd["regra"] and pre != "so_se:"):
                        erros.append("condição mal formada (%s): %s.%s" % (pre, c["tabela"], n))
        via = (c.get("via") or "").split(";")
        if "autor" in via and not (referencia_declarada(c) or any(x.startswith("cod:") for x in via)):
            erros.append("autor sem ref: nem cod: (o autor do rascunho é achado pelo login ou pela chave): %s.%s"
                         % (c["tabela"], n))
        if "exige_dominio" in via and (c.get("depara") or "") != DEPARA_VALORES:
            erros.append("exige_dominio sem depara=valores: %s.%s" % (c["tabela"], n))
        if "por_pai" in via:
            ps = passos_ref(referencia_declarada(c) or "")
            if not ps or len(ps) != 1 or ps[0].get("modo") not in ("alt", "alt_composta") or ps[0].get("escolha") \
                    or ps[0].get("coluna_destino") or _especial_decl(n):
                erros.append("por_pai sem referência por chave alternativa (ref:T.K ou ref:T.(K1,K2)=(C1,C2)): %s.%s"
                             % (c["tabela"], n))
        if (c.get("destino") or "").count(".") == 1:
            por_t.setdefault(c["tabela"], []).append(c)
    for t, cols in sorted(por_t.items()):
        if t not in por:
            continue
        dts = principal_e_destinos(por[t]["tabelas_destino"], cols)
        ops = opcoes_destino(cols)
        for c in cols:
            if c["coluna"].startswith("@id:"):
                alvo = c["coluna"][4:]
                if alvo not in dts or not ops.get(alvo, {}).get("antes") or alvo == c["destino"].split(".")[0]:
                    erros.append("@id:%s sem destino secundário gravado antes (via antes) em %s" % (alvo, t))
        for dt, o in opcoes_destino(cols).items():
            if o.get("por_pai") and (not dts or dt != dts[0] or o["desdobrar"] or o["agrupar"] or o["complementa"]):
                erros.append("por_pai só no destino principal, sem desdobrar, agrupar nem complementa: %s -> %s"
                             % (t, dt))
            if dts and dt == dts[0] and (o["opcional"] or o["antes"] or o["se"]):
                erros.append("destino principal não pode ser opcional, antes nem destino_se: %s -> %s" % (t, dt))
            if o["desdobrar"] and o["complementa"]:
                erros.append("destino desdobrado não pode ser complementa: %s -> %s" % (t, dt))
            if o["com_falso"] and not o["desdobrar"]:
                erros.append("com_falso só em destino desdobrado: %s -> %s" % (t, dt))
            if o["agrupar"]:
                # rodada 4: também no PRINCIPAL (uma linha do destino por grupo; pedidos L7-05 14 e L6-05 14)
                if not dts or (dt != dts[0] and not o["antes"]):
                    erros.append("agrupar só em destino secundário gravado antes (via antes;agrupar:) ou no "
                                 "principal: %s -> %s" % (t, dt))
                # rodada 6 (L7-06): no principal, agrupar combina com adotar quando a mescla guarda o maior
                # (adotar_maior: contador de numeração por tipo e competência)
                if (o["adotar"] and not (dt == dts[0] and o["adotar_maior"])) or o["desdobrar"] \
                        or o["complementa"] or o["opcional"]:
                    erros.append("agrupar não combina com adotar (só no principal com adotar_maior), desdobrar, "
                                 "complementa nem opcional: %s -> %s" % (t, dt))
                if not all(_COL_ORIGEM.fullmatch(x) for x in o["agrupar"]):
                    erros.append("agrupar com coluna da origem mal formada: %s -> %s" % (t, dt))
            if o["adotar_maior"] and not o["adotar"]:
                erros.append("adotar_maior sem adotar: %s -> %s" % (t, dt))
            if o["identidade"] and not o["adotar"]:
                erros.append("identidade sem adotar: %s -> %s" % (t, dt))
            if o["adotar_ativo"] and not o["adotar"]:
                erros.append("adotar_ativo sem adotar: %s -> %s" % (t, dt))
            if o["adotar_ativo"] and dt in ddl and "ativo" not in ddl[dt]["colunas"]:
                erros.append("adotar_ativo em destino sem coluna ativo: %s -> %s" % (t, dt))
            for a in o["adotar"] + o["adotar_maior"] + o["adotar_ativo"]:
                if dt in ddl and a not in ddl[dt]["colunas"]:
                    erros.append("coluna de adoção inexistente no DDL: %s -> %s.%s" % (t, dt, a))
            if o["complementa"] and not any(c["destino"] == dt + ".id" and referencia_declarada(c) for c in cols):
                erros.append("destino complementado sem coluna de referência ao pai em %s.id: %s" % (dt, t))
            itens = [c for c in cols if c["destino"].startswith(dt + ".") and eh_item(c["coluna"])]
            if itens and not o["desdobrar"]:
                erros.append("#item/#rotulo em destino não desdobrado: %s -> %s" % (t, dt))
            if o["desdobrar"] and not any(c["coluna"] == "#item" for c in itens):
                erros.append("destino desdobrado sem #item: %s -> %s" % (t, dt))
            if o["desdobrar"]:
                n_item = {posicao_item(c["coluna"]) for c in itens if c["coluna"].startswith("#item")}
                rots = [r for _, r in o["desdobrar"]]
                if len(set(rots)) != len(rots):
                    erros.append("desdobrar com rótulo repetido: %s -> %s" % (t, dt))
                for spec, _ in o["desdobrar"]:
                    if not set(range(len(spec.split("+")))) <= n_item or not all(
                            _COL_ORIGEM.fullmatch(x) for x in spec.split("+")):
                        erros.append("desdobrar com colunas sem #item correspondente (#item, #item2..): %s -> %s (%s)"
                                     % (t, dt, spec))
        if sum(1 for o in ops.values() if o["agrupar"]) > 1:
            erros.append("mais de um destino agrupado na mesma tabela: %s" % t)
        if any(c["coluna"].startswith("#grupo_") and "@" not in c["coluna"] for c in cols) and \
                not any(o["agrupar"] for o in ops.values()):
            erros.append("#grupo_* sem destino agrupado (via antes;agrupar:) em %s" % t)
        por_dc = {}
        for c in cols:
            if c["coluna"].startswith("#item@"):  # declaração do item por coluna do desdobrar (conferidor r4)
                o = ops.get(c["destino"].split(".")[0]) or {}
                specs = {x for spec, _ in (o.get("desdobrar") or []) for x in spec.split("+")[:1]}
                if c["coluna"][6:] not in specs:
                    erros.append("#item@<COLUNA> sem a coluna no desdobrar do destino: %s -> %s (%s)"
                                 % (t, c["destino"], c["coluna"]))
                continue
            por_dc.setdefault(c["destino"], []).append(c["coluna"])
        for dc, ns in sorted(por_dc.items()):
            if len(ns) > 1 and any(eh_item(n) or n.startswith("@id") for n in ns):
                erros.append("coluna do destino declarada várias vezes com item ou @id: %s -> %s" % (t, dc))
        for c in cols:
            rd = referencia_declarada(c)
            ps = passos_ref(rd) if rd else None
            if ps and ps[-1].get("coluna_destino") and ps[-1].get("destino") and ddl and ps[-1]["destino"] in ddl \
                    and ps[-1]["coluna_destino"] not in ddl[ps[-1]["destino"]]["colunas"]:
                erros.append("ref:...@coluna inexistente no destino do pai: %s.%s" % (t, c["coluna"]))
            if ps and ps[-1].get("coluna_destino") and "cod:" in (c.get("via") or ""):
                erros.append("ref:...@coluna não combina com cod: %s.%s" % (t, c["coluna"]))
            if c["coluna"].startswith("#dias:"):
                u = c["coluna"].split(",", 1)[1]
                rd = referencia_declarada(c)
                ps = passos_ref(rd) if rd else None
                if u.startswith("="):
                    if sentinela.unidade_periodo(u[1:]) is None:
                        erros.append("#dias com unidade literal desconhecida: %s.%s" % (t, c["coluna"]))
                    if rd:
                        erros.append("#dias com unidade literal não leva ref: %s.%s" % (t, c["coluna"]))
                elif rd and (not ps or "coluna" not in ps[-1]):
                    erros.append("#dias: a ref: da unidade tem de terminar em coluna (ref:T>COL): %s.%s"
                                 % (t, c["coluna"]))
            if c["coluna"].startswith("#data_hora:") and referencia_declarada(c):
                erros.append("#data_hora não leva ref: %s.%s" % (t, c["coluna"]))
    return sorted(set(erros))


def erros_referencia_e_valores(colunas_decl, valores, origem):
    """Referência declarada (`ref:<spec>` na via, `passos_ref`) bem formada e só com tabelas da origem; coluna com
    depara `valores` tem pares em declarado/valores.tsv e todo par tem coluna declarada; valor de origem sem
    repetição. Só nomes."""
    erros = []
    dv = {(c["tabela"], c["coluna"], c.get("destino")) for c in colunas_decl if c.get("depara") == DEPARA_VALORES}
    com_par = {(v["tabela"], v["coluna"], v["destino"]) for v in valores}
    for c in colunas_decl:
        rd = referencia_declarada(c)
        if not rd:
            continue
        passos = passos_ref(rd)
        if passos is None:
            erros.append("referência declarada mal formada: %s.%s" % (c["tabela"], c["coluna"]))
        elif any(x not in origem for x in tabelas_dos_passos(passos)):
            erros.append("referência declarada a tabela inexistente na origem: %s.%s" % (c["tabela"], c["coluna"]))
    for k in sorted(dv - com_par):
        erros.append("de-para de valores sem par em declarado/valores.tsv: %s.%s -> %s" % k)
    vistos = set()
    for v in valores:
        k = (v["tabela"], v["coluna"], v["destino"])
        if k not in dv:
            erros.append("declarado/valores.tsv sem coluna declarada com depara valores: %s.%s -> %s" % k)
        if (k, v["valor_origem"]) in vistos:
            erros.append("declarado/valores.tsv com valor de origem repetido: %s.%s -> %s" % k)
        vistos.add((k, v["valor_origem"]))
    return erros


def referencia_declarada(c):
    """Tabela da origem declarada no campo `via` como `ref:<TABELA>` (vale por cima da referência gerada)."""
    for x in (c.get("via") or "").split(";"):
        if x.startswith("ref:"):
            return x[4:]
    return ""
COLUNAS_D = "declarado/colunas.d"
VALORES_D = "declarado/valores.d"


def ler_valores(d):
    """declarado/valores.tsv + declarado/valores.d/<fatia>.tsv (ordem de nome): pares de valores por fatia, como
    colunas.d, para lotes em paralelo (L6-08, L6-11)."""
    d = Path(d)
    arqs = ([d / "declarado/valores.tsv"] if (d / "declarado/valores.tsv").exists() else []) + \
        sorted((d / VALORES_D).glob("*.tsv"))
    return [{k: (v or "") for k, v in r.items() if k is not None} for a in arqs for r in ler_tsv(a)]


def ler_colunas_declaradas(d):
    """declarado/colunas.tsv + declarado/colunas.d/*.tsv (ordem de nome). Cada linha leva `_arquivo` (relativo a
    `d`), para o verificador apontar conflito entre arquivos."""
    d = Path(d)
    arqs = ([d / "declarado/colunas.tsv"] if (d / "declarado/colunas.tsv").exists() else []) + \
        sorted((d / COLUNAS_D).glob("*.tsv"))
    saida = []
    for a in arqs:
        for r in ler_tsv(a):
            r = {k: (v or "") for k, v in r.items() if k is not None}
            r["_arquivo"] = str(a.relative_to(d))
            saida.append(r)
    return saida


def conflitos_declarados(colunas_decl):
    """Erros de conflito entre arquivos de colunas declaradas (só nomes)."""
    erros, dono, vistos = [], {}, {}
    for c in colunas_decl:
        arq = c.get("_arquivo", "declarado/colunas.tsv")
        t = c.get("tabela", "")
        if t in dono and dono[t] != arq:
            erros.append("tabela declarada em mais de um arquivo: %s (%s e %s)" % (t, dono[t], arq))
        dono.setdefault(t, arq)
        k = (t, c.get("coluna", ""), c.get("destino", ""))
        if k in vistos:
            erros.append("coluna declarada duas vezes: %s.%s -> %s (%s e %s)" % (k[0], k[1], k[2], vistos[k], arq))
        vistos.setdefault(k, arq)
    return sorted(set(erros))


def ler_tsv(p):
    with open(p, encoding="utf-8", newline="") as f:
        return [r for r in csv.DictReader(f, delimiter="\t") if not (next(iter(r.values()), "") or "").startswith("#")]


def escrever_tsv(p, campos, linhas):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write("\t".join(campos) + "\n")
        for r in linhas:
            f.write("\t".join(str(r.get(c, "")) for c in campos) + "\n")


# ---------------- DDL do destino ----------------
_RESERV = {"CONSTRAINT", "UNIQUE", "KEY", "PRIMARY", "INDEX", "FULLTEXT", "CHECK", "FOREIGN", "SPATIAL"}


def _arquivos_ddl(raiz):
    return sorted(Path(raiz, "db/migracoes").glob("*/*.sql"))


def ler_ddl(raiz=RAIZ):
    """{tabela: {"colunas": [..], "arquivo": rel, "create": texto, "alter": [textos], "fks": [textos]}}."""
    ddl = {}
    for arq in _arquivos_ddl(raiz):
        txt = arq.read_text(encoding="utf-8")
        rel = str(arq.relative_to(raiz))
        for m in re.finditer(r"^CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`? \((.*?)^\)(?:[^;']|'[^']*')*;", txt, re.M | re.S):
            cols = []
            for linha in m.group(2).splitlines():
                p = linha.strip().split()
                if p and p[0].strip("`").upper() not in _RESERV and re.fullmatch(r"`?\w+`?", p[0]):
                    cols.append(p[0].strip("`"))
            ddl[m.group(1)] = {"colunas": cols, "arquivo": rel, "create": m.group(0), "alter": [], "fks": []}
        for m in re.finditer(r"^ALTER TABLE `?(\w+)`?\s((?:[^;']|'[^']*')*?);", txt, re.M | re.S):
            t = ddl.get(m.group(1))
            if t is None:
                continue
            corpo = m.group(2)
            if "FOREIGN KEY" in corpo:
                t["fks"].append(m.group(0))
            # ALTER de coluna (inclusive MODIFY: NOT NULL afrouxado, largura), de índice único (chave trocada) ou de
            # restrição sem FK (CHECK redefinido em lote posterior): entra no DDL da conferência
            if re.search(r"\b((ADD|DROP|MODIFY) COLUMN|DROP INDEX|ADD UNIQUE KEY)\b", corpo) or (
                    re.search(r"\b(ADD|DROP) CONSTRAINT\b", corpo) and "FOREIGN KEY" not in corpo):
                t["alter"].append(m.group(0))
            for c in re.findall(r"\bADD COLUMN (?:IF NOT EXISTS )?`?(\w+)`?", corpo):
                if c not in t["colunas"]:
                    t["colunas"].append(c)
            for c in re.findall(r"\bDROP COLUMN (?:IF EXISTS )?`?(\w+)`?", corpo):
                if c in t["colunas"]:
                    t["colunas"].remove(c)
    return ddl


def oficiais(ddl, declarados=()):
    """Tabelas do modelo que são catálogo oficial: as que têm `versao_fonte` no DDL, mais as declaradas com `S` e
    menos as declaradas com `N` em declarado/oficiais.tsv."""
    sim = {d["tabela"] for d in declarados if d.get("oficial") == "S"}
    nao = {d["tabela"] for d in declarados if d.get("oficial") == "N"}
    return frozenset(({t for t, x in ddl.items() if COLUNA_OFICIAL in x["colunas"]} | sim) - nao)


def tipo_coluna_ddl(ddl, tabela, coluna):
    """Tipo SQL (maiúsculo, sem tamanho) da coluna no CREATE ou num ADD COLUMN; '' se não achar."""
    x = ddl.get(tabela)
    if not x:
        return ""
    for txt in [x["create"]] + x["alter"]:
        m = re.search(r"(?:^|\bADD COLUMN (?:IF NOT EXISTS )?)\s*`?%s`?\s+(\w+)" % re.escape(coluna), txt, re.M)
        if m:
            return m.group(1).upper()
    return ""


# ---------------- montagem (determinística) ----------------
def lote_de(tabela, modulo, destinos, estrategia):
    if tabela in FEITAS_L3:
        return "L3"
    if estrategia == "depara_catalogo_oficial":
        return "L4"
    for lote, _, mods in LOTES:
        if modulo in mods:
            return lote
    return "L8"


def fisicos(tipo, destinos, oficiais_=frozenset()):
    """(a gravar, oficiais): tabelas do modelo que recebem a tabela da origem (mecanismo resolvido) e as que são
    catálogo oficial (nunca gravadas: viram de-para). O histórico de uma entidade oficial também não é gravado (a
    versão vem do carregador). ([], []) = nada a gravar."""
    saida, ofi = [], []
    for d in destinos:
        if tipo != "MECANISMO":
            (ofi if d in oficiais_ else saida).append(d)
            continue
        nome, _, alvo = d.partition(":")
        if alvo and alvo in oficiais_:
            ofi.append(alvo)
            continue
        saida += MECANISMOS.get(nome, ["?" + nome]) + ([alvo] if alvo else [])
    return [d for d in saida if d not in oficiais_], ofi + [d for d in saida if d in oficiais_]


def estrategia_de(v, destinos, tipo, destinos_oficiais=()):
    """Proposta pelo volume da imagem de referência; o motor revê pela contagem de cada cliente na execução."""
    if tipo != "NAO" and not destinos and destinos_oficiais:
        return "depara_catalogo_oficial"
    if tipo == "MECANISMO" and not destinos:
        return "sem_carga"
    n = int(v.get("registros") or 0)
    pk = v.get("pk") or ""
    if n < LIMITE_PEQUENA:
        return "hash_linha" if pk else "hash_linha_sem_chave"
    if not pk:
        return "sem_chave_recarga"
    if v.get("col_alteracao"):
        return "data_alteracao_hash_bloco"
    if v.get("pk_inteira_unica") == "S":
        return "faixa_id_hash_bloco"
    return "hash_bloco_chave"


def _prioridade(t, lote, modulo, estrategia):
    if t in PRIORIDADE:
        p = PRIORIDADE[t]
    elif estrategia == "depara_catalogo_oficial":
        p = 2
    elif _AUDITORIA.search(t):
        p = 5
    else:
        p = 3
    ordem_lote = ["L3", "L4", "L5", "L6", "L7", "L8"].index(lote)
    mods = [m for _, _, ms in LOTES for m in ms]
    return (p, ordem_lote, mods.index(modulo) if modulo in mods else len(mods), t)


def ordenar(nos, arestas, quebras, chave):
    """Kahn com fila de prioridade. `arestas`: {(filha, pai)}; `quebras`: arestas declaradas como duas fases.
    Devolve (ordem, ciclos): ciclos = listas de nós que sobraram (ciclo não declarado)."""
    pais = {n: set() for n in nos}
    filhos = {n: set() for n in nos}
    for f, p in arestas:
        if (f, p) in quebras or f not in pais or p not in pais:
            continue
        pais[f].add(p)
        filhos[p].add(f)
    grau = {n: len(pais[n]) for n in nos}
    fila = [(chave(n), n) for n in nos if grau[n] == 0]
    heapq.heapify(fila)
    ordem = []
    while fila:
        _, n = heapq.heappop(fila)
        ordem.append(n)
        for f in filhos[n]:
            grau[f] -= 1
            if grau[f] == 0:
                heapq.heappush(fila, (chave(f), f))
    resto = {n for n in nos if n not in set(ordem)}
    return ordem, componentes_ciclicas(resto, {(f, p) for f, p in arestas if (f, p) not in quebras})


def componentes_ciclicas(nos, arestas):
    """Componentes fortemente conexas com ciclo (tamanho > 1 ou autorreferência), em ordem determinística."""
    adj = {n: sorted({p for f, p in arestas if f == n and p in nos}) for n in sorted(nos)}
    idx, low, pilha, na_pilha, comps = {}, {}, [], set(), []

    def visitar(n):  # Tarjan (no máximo ~1.500 nós: a recursão cabe)
        idx[n] = low[n] = len(idx)
        pilha.append(n)
        na_pilha.add(n)
        for w in adj[n]:
            if w not in idx:
                visitar(w)
                low[n] = min(low[n], low[w])
            elif w in na_pilha:
                low[n] = min(low[n], idx[w])
        if low[n] == idx[n]:
            c = []
            while True:
                w = pilha.pop()
                na_pilha.discard(w)
                c.append(w)
                if w == n:
                    break
            if len(c) > 1 or n in adj[n]:
                comps.append(sorted(c))

    sys.setrecursionlimit(max(sys.getrecursionlimit(), 10000))
    for n in sorted(nos):
        if n not in idx:
            visitar(n)
    return sorted(comps)


def montar(analise, volume, ciclos_declarados, oficiais_=frozenset(), deps_declaradas=()):
    """Linhas de tabelas.tsv e dependencias.tsv a partir do mapa da análise, do volume, dos ciclos declarados, do
    conjunto de tabelas oficiais (`oficiais()`) e das dependências declaradas (`declarado/dependencias.tsv`: pai que a
    origem não declara como FK, mas que a carga exige antes, ex.: referência declarada na fatia)."""
    vol = {r["tabela"]: r for r in volume}
    linhas, carregaveis = {}, set()
    for r in analise:
        t = r["tabela"]
        v = vol.get(t, {})
        destinos = [d for d in (r["destino"] or "").split(";") if d]
        fis, ofi = fisicos(r["destino_tipo"], destinos, oficiais_) if r["destino_tipo"] != "NAO" else ([], [])
        est = estrategia_de(v, fis, r["destino_tipo"], ofi) if r["destino_tipo"] != "NAO" else "descartada"
        linhas[t] = {"tabela": t, "tipo": r["destino_tipo"], "destinos": ";".join(destinos),
                     "tabelas_destino": ";".join(fis), "destinos_oficiais": ";".join(ofi),
                     "modulo": r["modulo"], "registros": v.get("registros", "0"), "chave": v.get("pk", ""),
                     "pk_inteira": v.get("pk_inteira_unica", ""), "col_alteracao": v.get("col_alteracao", ""),
                     "estrategia": est, "motivo": (r.get("motivo") or "").replace("\t", " ").strip()}
        linhas[t]["lote"] = lote_de(t, r["modulo"], destinos, est) if est not in ("descartada", "sem_carga") else "-"
        if fis:
            carregaveis.add(t)
    arestas = set()
    for t in sorted(carregaveis):
        deps = [d for d in (vol.get(t, {}).get("depende_de") or "").split(",") if d]
        deps += [d["depende_de"] for d in deps_declaradas if d["tabela"] == t and d["depende_de"] not in deps]
        dentro = sorted(d for d in deps if d in carregaveis)
        fora = sorted(d for d in deps if d not in carregaveis)
        linhas[t]["depende_de"] = ",".join(dentro)
        linhas[t]["dep_fora_do_mapa"] = ",".join(fora)
        arestas.update((t, d) for d in dentro)
    quebras = {(c["tabela"], c["depende_de"]) for c in ciclos_declarados}
    base = {n: _prioridade(n, linhas[n]["lote"], linhas[n]["modulo"], linhas[n]["estrategia"]) for n in carregaveis}
    # o pai herda a prioridade do filho mais urgente (ex.: o perfil que o usuário exige vem logo antes dele)
    efetiva = {n: base[n][0] for n in carregaveis}
    mudou = True
    while mudou:
        mudou = False
        for f, p in sorted(arestas):
            if (f, p) not in quebras and efetiva[f] < efetiva[p]:
                efetiva[p] = efetiva[f]
                mudou = True
    chave = lambda n: (efetiva[n],) + base[n]  # noqa: E731
    ordem, ciclos = ordenar(sorted(carregaveis), arestas, quebras, chave)
    for i, t in enumerate(ordem, 1):
        linhas[t]["ordem"] = str(i)
    for t in linhas:
        linhas[t].setdefault("ordem", "-" if t not in carregaveis else "?")
    tab = sorted(linhas.values(), key=lambda r: (r["ordem"] in ("-", "?"), int(r["ordem"]) if r["ordem"].isdigit()
                                                else 0, r["tabela"]))
    deps = [{"tabela": f, "depende_de": p, "quebra": "duas_fases" if (f, p) in quebras else ""}
            for f, p in sorted(arestas)]
    return tab, deps, ciclos, arestas


def propor_quebras(ciclos, arestas, linhas):
    """Proposta inicial de quebra (o dono/agente revisa): em cada ciclo, a aresta para o pai que vem DEPOIS na
    ordem de prioridade é carregada em duas fases (insere sem a FK e atualiza no fim do domínio)."""
    por = {r["tabela"]: r for r in linhas}
    chave = lambda n: _prioridade(n, por[n]["lote"], por[n]["modulo"], por[n]["estrategia"])  # noqa: E731
    saida = []
    for comp in ciclos:
        pos = {n: i for i, n in enumerate(sorted(comp, key=chave))}
        for f, p in sorted(arestas):
            if f in pos and p in pos and pos[p] >= pos[f]:
                motivo = ("autorreferência (hierarquia na própria tabela)" if f == p else
                          "ciclo entre %d tabelas (%s): o pai vem depois na ordem de carga" % (
                              len(comp), ",".join(comp) if len(comp) <= 6 else ",".join(comp[:6]) + ",..."))
                saida.append({"tabela": f, "depende_de": p, "tratamento": "duas_fases", "motivo": motivo})
    return saida


# ---------------- verificador ----------------
def verificar_dados(analise, volume, ddl, tabelas, deps, ciclos_decl, descartes, colunas, colunas_decl,
                    catalogos_decl, oficiais_decl=(), valores=(), deps_decl=(), sem_carga=(), provas=()):
    """Lista de erros (vazia = mapa válido). Só nomes de tabela/coluna e regras; nunca valores."""
    erros = []
    ofi = oficiais(ddl, oficiais_decl)
    for d in oficiais_decl:
        if d.get("tabela") not in ddl:
            erros.append("oficiais.tsv cita tabela inexistente no DDL: %s" % d.get("tabela"))
        if d.get("oficial") not in ("S", "N") or not (d.get("motivo") or "").strip():
            erros.append("oficiais.tsv sem oficial S/N ou sem motivo: %s" % d.get("tabela"))
    esperado_tab, esperado_deps, ciclos, arestas = montar(analise, volume, ciclos_decl, ofi, deps_decl)
    nomes_mapa = {r["tabela"] for r in tabelas if r["tabelas_destino"]}
    for d in deps_decl:
        if d["tabela"] not in nomes_mapa or d["depende_de"] not in nomes_mapa or not (d.get("motivo") or "").strip():
            erros.append("dependência declarada fora das carregáveis ou sem motivo: %s -> %s" % (d["tabela"],
                                                                                              d["depende_de"]))
    for d in sem_carga:
        if d["tabela"] not in nomes_mapa or d.get("situacao") not in ("descarte", "bloqueada") or \
                not (d.get("causa") or "").strip() or not (d.get("motivo") or "").strip():
            erros.append("declarado/sem_carga.tsv: tabela fora das carregáveis, situação, causa ou motivo: %s"
                         % d.get("tabela"))
    if ciclos:
        for c in ciclos:
            erros.append("ciclo não declarado em declarado/ciclos.tsv: %s" % ",".join(c))
    if [dict((k, r.get(k, "")) for k in CAMPOS_TABELAS) for r in esperado_tab] != \
            [dict((k, r.get(k, "")) for k in CAMPOS_TABELAS) for r in tabelas]:
        erros.append("tabelas.tsv desatualizado: rode python3 -I tools/obra/gerar_mapa_conector.py")
    if [(d["tabela"], d["depende_de"], d["quebra"]) for d in esperado_deps] != \
            [(d["tabela"], d["depende_de"], d.get("quebra", "")) for d in deps]:
        erros.append("dependencias.tsv desatualizado: rode python3 -I tools/obra/gerar_mapa_conector.py")
    for c in ciclos_decl:
        if (c["tabela"], c["depende_de"]) not in arestas:
            erros.append("ciclo declarado sem a dependência correspondente: %s -> %s" % (c["tabela"], c["depende_de"]))
        if c.get("tratamento") != "duas_fases" or not (c.get("motivo") or "").strip():
            erros.append("ciclo declarado sem tratamento duas_fases ou sem motivo: %s" % c["tabela"])
    por = {r["tabela"]: r for r in tabelas}
    # tabela sem destino nem descarte justificado
    for r in tabelas:
        t = r["tabela"]
        if r["tipo"] not in ("TABELA", "MECANISMO", "NAO"):
            erros.append("tipo de destino desconhecido: %s" % t)
        elif r["tipo"] == "NAO":
            if not r["motivo"]:
                erros.append("descarte sem justificativa: %s" % t)
        elif not r["destinos"]:
            erros.append("tabela sem destino: %s" % t)
        elif r["estrategia"] == "sem_carga" and not r["motivo"]:
            erros.append("mecanismo sem carga e sem justificativa: %s" % t)
        else:
            for d in r["destinos"].split(";"):
                if r["tipo"] == "MECANISMO" and d.partition(":")[0] not in MECANISMOS:
                    erros.append("mecanismo desconhecido: %s -> %s" % (t, d))
            for d in [x for x in r["tabelas_destino"].split(";") if x]:
                if d not in ddl:
                    erros.append("destino inexistente no DDL: %s -> %s" % (t, d))
                elif d in ofi:  # regra 7: catálogo oficial só pelo carregador versionado
                    erros.append("tabela carregável grava em catálogo oficial: %s -> %s" % (t, d))
            if r["estrategia"] not in ESTRATEGIAS:
                erros.append("estratégia desconhecida: %s" % t)
    regs = [(re.compile(d["padrao"]), d) for d in descartes]
    for d in descartes:
        if not (d.get("motivo") or "").strip() or d.get("condicao") not in ("vazia", "qualquer"):
            erros.append("descarte declarado sem motivo ou condição: %s" % d.get("padrao"))
    for v in volume:
        t = v["tabela"]
        if t in por:
            continue
        ok = any(rx.fullmatch(t) and (d["condicao"] == "qualquer" or int(v["registros"] or 0) == 0)
                 for rx, d in regs)
        if not ok:
            erros.append("tabela da origem sem destino nem descarte justificado: %s" % t)
    # colunas: regra conhecida, de-para conhecido, referência a tabela da origem
    vol = {v["tabela"] for v in volume}
    for c in colunas:
        if c["tabela"] not in por or not por[c["tabela"]]["tabelas_destino"]:
            erros.append("coluna de tabela fora do mapa carregável: %s.%s" % (c["tabela"], c["coluna"]))
        if not sentinela.regra_conhecida(c["regra"]):
            erros.append("regra de coluna desconhecida: %s.%s" % (c["tabela"], c["coluna"]))
        if c.get("depara") and not depara.conhecido(c["depara"]):
            erros.append("de-para desconhecido: %s.%s" % (c["tabela"], c["coluna"]))
        if c.get("referencia") and c["referencia"] not in vol:
            erros.append("referência a tabela inexistente na origem: %s.%s" % (c["tabela"], c["coluna"]))
    # colunas declaradas: sem conflito entre arquivos; destino existe no DDL, pertence aos destinos da tabela e o tipo
    # casa com a regra
    erros += conflitos_declarados(colunas_decl)
    gerada = {(c["tabela"], c["coluna"]): c["regra"] for c in colunas}
    # destino secundário fora de tabelas_destino: nomeado na via de QUALQUER coluna da tabela, ou com opção de destino
    # (antes, opcional, adotar:...) numa coluna dele (rodada 4: a declaração explícita do secundário)
    via_t = {}
    for c in colunas_decl:
        via = (c.get("via") or "").split(";")
        via_t.setdefault(c["tabela"], set()).update(via)
        if any(x == o or (o.endswith(":") and x.startswith(o)) for x in via for o in OPCOES_DESTINO):
            via_t[c["tabela"]].add((c.get("destino") or "").partition(".")[0])
    for c in colunas_decl:
        t = c["tabela"]
        if t not in por or not por[t]["tabelas_destino"]:
            erros.append("coluna declarada de tabela fora do mapa carregável: %s.%s" % (t, c["coluna"]))
            continue
        if c.get("regra") and not sentinela.regra_conhecida(c["regra"]):
            erros.append("regra declarada desconhecida: %s.%s" % (t, c["coluna"]))
        if c.get("depara") and not depara.conhecido(c["depara"]) and c["depara"] != DEPARA_VALORES:
            erros.append("de-para declarado desconhecido: %s.%s" % (t, c["coluna"]))
        dest = c.get("destino") or ""
        if dest:
            dt, _, dc = dest.partition(".")
            if dt not in ddl:
                erros.append("coluna de destino em tabela inexistente no DDL: %s.%s -> %s" % (t, c["coluna"], dest))
            elif dc not in ddl[dt]["colunas"]:
                erros.append("coluna de destino inexistente no DDL: %s.%s -> %s" % (t, c["coluna"], dest))
            elif dt not in por[t]["tabelas_destino"].split(";") and dt not in via_t.get(t, ()):
                erros.append("coluna de destino fora dos destinos da tabela: %s.%s -> %s" % (t, c["coluna"], dest))
            elif dt in ofi:
                erros.append("coluna declarada grava em catálogo oficial: %s.%s -> %s" % (t, c["coluna"], dest))
            else:
                regra = c.get("regra") or gerada.get((t, c["coluna"]), "")
                tipo = tipo_coluna_ddl(ddl, dt, dc)
                if tipo == "TIME" and regra and regra not in sentinela.REGRAS_TIME:
                    erros.append("destino TIME com regra %s (use hora_em_timestamp, hora_hhmm ou hora): %s.%s -> %s"
                                 % (regra, t, c["coluna"], dest))
                elif regra in sentinela.REGRAS_TIME and tipo and tipo != "TIME":
                    erros.append("regra %s com destino %s (esperado TIME): %s.%s -> %s" % (regra, tipo, t, c["coluna"],
                                                                                         dest))
    erros += erros_referencia_e_valores(colunas_decl, valores, vol)
    oc = {}
    for c in colunas:
        oc.setdefault(c["tabela"], set()).add(c["coluna"])
    erros += erros_provas(provas, oc)
    erros += erros_especiais_e_opcoes(colunas_decl, tabelas, ddl)
    sc = {d["tabela"] for d in sem_carga if d.get("situacao") == "descarte"}
    for t in sorted({c["tabela"] for c in colunas_decl if c.get("destino")} & sc):
        erros.append("tabela com colunas declaradas e também descartada em declarado/sem_carga.tsv: %s" % t)
    # catálogos oficiais: alvo existe no DDL; tabelas declaradas existem e são carregáveis
    usados = {c.get("depara") for c in colunas + colunas_decl} | {c["catalogo"] for c in catalogos_decl}
    for nome in sorted(x for x in usados if x and depara.conhecido(x)):
        cat = depara.catalogo(nome)
        if cat["tabela"] not in ddl or cat["coluna"] not in ddl[cat["tabela"]]["colunas"]:
            erros.append("catálogo %s aponta coluna inexistente no DDL: %s.%s" % (nome, cat["tabela"], cat["coluna"]))
    for c in catalogos_decl:
        t = c["tabela"]
        if t not in por or por[t]["tipo"] == "NAO":
            erros.append("catálogo declarado fora do mapa: %s" % t)
            continue
        if not depara.conhecido(c["catalogo"]) and not (c.get("motivo") or "").strip():
            erros.append("catálogo declarado desconhecido e sem motivo: %s" % t)
        # declarada como catálogo: a parte oficial é de-para (nunca gravada); só o resto pode ser carregado
        if not por[t].get("destinos_oficiais"):
            erros.append("tabela declarada como catálogo sem destino oficial (seria gravada inteira): %s (%s)"
                         % (t, por[t]["estrategia"]))
        elif por[t]["tabelas_destino"] and por[t]["estrategia"] == "depara_catalogo_oficial":
            erros.append("estratégia depara_catalogo_oficial com destino gravável: %s" % t)
        elif not por[t]["tabelas_destino"] and por[t]["estrategia"] != "depara_catalogo_oficial":
            erros.append("tabela declarada como catálogo com estratégia %s (esperado depara_catalogo_oficial): %s"
                         % (por[t]["estrategia"], t))
    declaradas = {c["tabela"] for c in catalogos_decl}
    for r in tabelas:
        if (r["estrategia"] == "depara_catalogo_oficial" or r.get("destinos_oficiais")) and r["tabela"] not in declaradas:
            erros.append("tabela com destino em catálogo oficial sem declaração em declarado/catalogos.tsv: %s"
                         % r["tabela"])
    return erros


def carregar(raiz=RAIZ):
    raiz = Path(raiz)
    d = raiz / DIR
    ler = lambda n: ler_tsv(d / n) if (d / n).exists() else []  # noqa: E731
    return dict(analise=ler_tsv(raiz / MAPA_ANALISE), volume=ler_tsv(raiz / VOLUME), ddl=ler_ddl(raiz),
                tabelas=ler("tabelas.tsv"), deps=ler("dependencias.tsv"), ciclos_decl=ler("declarado/ciclos.tsv"),
                descartes=ler("declarado/descartes.tsv"), colunas=ler("colunas.tsv"),
                colunas_decl=ler_colunas_declaradas(d), catalogos_decl=ler("declarado/catalogos.tsv"),
                oficiais_decl=ler("declarado/oficiais.tsv"), valores=ler_valores(d),
                deps_decl=ler("declarado/dependencias.tsv"), sem_carga=ler("declarado/sem_carga.tsv"),
                provas=ler_provas(d))


def verificar(raiz=RAIZ):
    return verificar_dados(**carregar(raiz))


# ---------------- revisão por execução (motor) ----------------
def carregar_execucao(d=None):
    """O que o motor precisa do mapa em toda execução: tabelas do mapa (com tipo), descartes declarados e, para a
    carga dirigida pelo mapa (`carga_mapa.py`), colunas geradas, declaradas (com colunas.d) e dependências. Lê de
    `CONECTOR_MAPA_DIR`, ou de conector/mapa (repositório) / /app/mapa (container)."""
    import os
    d = Path(d or os.environ.get("CONECTOR_MAPA_DIR") or DIR_PACOTE)
    if not (d / "tabelas.tsv").exists():
        raise FileNotFoundError("mapa do conector ausente: %s" % (d / "tabelas.tsv"))
    ler = lambda n: ler_tsv(d / n) if (d / n).exists() else []  # noqa: E731
    return {"tabelas": ler_tsv(d / "tabelas.tsv"), "descartes": ler_tsv(d / "declarado/descartes.tsv"),
            "colunas": ler("colunas.tsv"), "colunas_decl": ler_colunas_declaradas(d), "deps": ler("dependencias.tsv"),
            "valores": ler_valores(d), "provas": ler_provas(d), "evidencia_origem": ler(EVIDENCIA_ORIGEM),
            "sequencias": ler(SEQUENCIAS), "sem_carga": ler("declarado/sem_carga.tsv")}


# L9 (F4.7): generator da origem -> `sequencia_negocio.tipo` (o Sincronizar avança a sequência própria, nunca recua)
SEQUENCIAS = "declarado/sequencias.tsv"


# rodada 5 (ADR 0006, item 1; ADR 0007, item 16)
PROVAS = "declarado/provas.tsv"
PROVAS_D = "declarado/provas.d"
CAMPOS_PROVAS = ["tabela", "tipo", "chave", "valores", "motivo"]
EVIDENCIA_ORIGEM = "declarado/evidencia_origem.tsv"


def ler_provas(d):
    """Provas de "não copiar": [{tabela, tipo (derivado|mecanismo), chave [COL], valores [(COL, regra)], sql}]. O SQL
    (`provas.d/<TABELA>.sql`) devolve, no destino, as colunas da chave e dos valores na mesma ordem."""
    d = Path(d)
    out = []
    for r in (ler_tsv(d / PROVAS) if (d / PROVAS).exists() else []):
        f = d / PROVAS_D / ("%s.sql" % r["tabela"])
        vs = [tuple((x.split("!", 1) + [""])[:2]) for x in (r.get("valores") or "").split(",") if x]
        out.append({"tabela": r["tabela"], "tipo": r.get("tipo") or "", "motivo": r.get("motivo") or "",
                    "chave": [x for x in (r.get("chave") or "").split(",") if x], "valores": vs,
                    "sql": f.read_text(encoding="utf-8").strip().rstrip(";") if f.exists() else ""})
    return out


def erros_provas(provas, origem_cols):
    """Prova bem formada: tipo conhecido, chave e valores com colunas da origem, SQL presente e só de leitura."""
    erros = []
    for pv in provas:
        t = pv["tabela"]
        cols = origem_cols.get(t)
        if pv["tipo"] not in ("derivado", "mecanismo"):
            erros.append("prova com tipo desconhecido (derivado|mecanismo): %s" % t)
        if not pv["chave"] or not pv["valores"]:
            erros.append("prova sem chave ou sem valores: %s" % t)
        if cols is not None and any(c not in cols for c in pv["chave"] + [v[0] for v in pv["valores"]]):
            erros.append("prova com coluna inexistente na origem: %s" % t)
        if not re.match(r"(?is)^\s*(select|with)\b", pv["sql"] or "") or ";" in pv["sql"]:
            erros.append("prova sem SQL de leitura (um SELECT em %s/%s.sql): %s" % (PROVAS_D, t, t))
    return erros


def tabelas_sem_mapa(contagens, tabelas, descartes):
    """Tabelas da origem COM linhas nesta imagem que não estão no mapa nem em descarte incondicional (`qualquer`).
    O descarte `vazia` vale só para tabela vazia: com linhas, vira pendência `tabela_sem_mapa` (nunca carga nem
    descarte silencioso). Devolve [(tabela, registros)] em ordem; só nomes e contagens."""
    no_mapa = {r["tabela"] for r in tabelas}
    incond = [re.compile(d["padrao"]) for d in descartes if d.get("condicao") == "qualquer"]
    return sorted((t, int(n)) for t, n in contagens.items()
                  if int(n or 0) > 0 and t not in no_mapa and not any(rx.fullmatch(t) for rx in incond))
