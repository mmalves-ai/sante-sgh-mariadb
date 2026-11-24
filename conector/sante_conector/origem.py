"""Origem do conector: arquivo .fdb vinculado ou servidor Firebird do hospital (db/plataforma/0093; ADR 0010).

Interface que o motor usa (fatia S1 da obra carga-painel); os corpos de leitura direta são completados pela fatia
B-origem. Regras que valem para toda implementação:

- `firebird_arquivo`: o caminho de sempre (abridor, imagem somente leitura, sha256 antes e depois). Os dados ficam em
  `OrigemArquivo` e o motor segue lendo pelo `Leitor` local, como antes.
- `firebird_servidor`: leitura DIRETA do servidor, sem abridor, dm-snapshot, gstat nem exigência de `MON$READ_ONLY`.
  Uma conexão e UMA transação SNAPSHOT + READ por execução: a contagem de cada tabela e a leitura das linhas saem da
  mesma fotografia. A continuação entre execuções exige a mesma `identidade_base` (no lugar de sha256/mtime).
- A senha nunca fica no banco: `senha_referencia` é `cofre:conector/<cliente>/firebird-senha` (decifrada com
  `PLATAFORMA_CHAVE_MESTRA`, envelope `v1.<iv>.<tag>.<corpo>` de continuidade.py) ou, só fora de produção, `env:NOME`
  (variável de ambiente). A senha nunca é impressa, logada nem devolvida (regra 8).
- Nada aqui devolve valores de linha: só versões, contagens e identidade técnica da base (regra 5).
"""
import contextlib
import hashlib
import os
import re
from dataclasses import dataclass, field

TIPO_ARQUIVO = "firebird_arquivo"
TIPO_SERVIDOR = "firebird_servidor"
PORTA_PADRAO = 3050
# Firebird 3 não tem role padrão (GRANT DEFAULT só no 4): o usuário de leitura só lê com a role explícita.
ROLE_PADRAO = "LEITURA"
TEMPO_CONEXAO_S = 15
REF_COFRE = re.compile(r"^cofre:conector/[A-Za-z0-9][A-Za-z0-9_.-]{0,63}/firebird-senha$")
REF_ENV = re.compile(r"^env:([A-Z][A-Z0-9_]{0,63})$")
ROLE = re.compile(r"^[A-Z][A-Z0-9_$]{0,62}$")


class OrigemErro(RuntimeError):
    """Origem inexistente, incompleta, senha indisponível ou servidor inacessível (mensagem sem segredo nem valor)."""


@dataclass(frozen=True)
class OrigemArquivo:
    """Arquivo .fdb na pasta autorizada do conector (tipo firebird_arquivo; colunas de 0003)."""
    id: int
    caminho_relativo: str
    tamanho_bytes: int
    sha256: str
    nome: str | None = None


@dataclass(frozen=True)
class OrigemServidor:
    """Servidor Firebird do hospital (tipo firebird_servidor; colunas de 0093). `senha_referencia` é a REFERÊNCIA no
    cofre (`cofre:...`) ou `env:NOME` fora de produção; nunca a senha. `repr` não mostra a referência."""
    host: str
    porta: int
    banco: str
    usuario: str
    senha_referencia: str = field(repr=False)
    nome: str | None = None
    id: int | None = None
    identidade_base: dict | None = None

    @property
    def dsn(self) -> str:
        """DSN do driver: `host/porta:banco` (banco = caminho ou alias no servidor)."""
        return "%s/%d:%s" % (self.host, self.porta, self.banco)


def carregar_origem(conexao_plataforma, cliente_origem_id):
    """Lê `cliente_origem` (id) no banco plataforma e devolve OrigemArquivo ou OrigemServidor conforme `tipo`.

    Levanta OrigemErro se a origem não existe ou se o tipo é desconhecido. Não decifra a senha (isso é de
    `abrir_leitor_servidor`, no momento da conexão)."""
    import json
    with conexao_plataforma.cursor() as cur:
        cur.execute("SELECT id, tipo, nome_exibicao, caminho_relativo, tamanho_bytes, sha256, servidor_host,"
                    " servidor_porta, servidor_banco, servidor_usuario, senha_referencia_cofre, identidade_base"
                    " FROM cliente_origem WHERE id=%s", (cliente_origem_id,))
        r = cur.fetchone()
    if not r:
        raise OrigemErro("origem inexistente")
    oid, tipo, nome = r[0], r[1], r[2]
    if tipo == TIPO_ARQUIVO:
        if not r[3]:
            raise OrigemErro("origem de arquivo sem caminho")
        return OrigemArquivo(id=oid, caminho_relativo=r[3], tamanho_bytes=r[4], sha256=r[5], nome=nome)
    if tipo == TIPO_SERVIDOR:
        if not (r[6] and r[7] and r[8] and r[9] and r[10]):
            raise OrigemErro("origem de servidor incompleta (host, porta, banco, usuário e senha no cofre)")
        ident = r[11]
        if isinstance(ident, (bytes, str)) and ident:
            try:
                ident = json.loads(ident)
            except ValueError:
                ident = None
        return OrigemServidor(host=r[6], porta=int(r[7]), banco=r[8], usuario=r[9], senha_referencia=r[10],
                              nome=nome, id=oid, identidade_base=ident or None)
    raise OrigemErro("tipo de origem desconhecido")


def _producao(env):
    return (env.get("AMBIENTE") or "dev").strip().lower() == "producao"


def senha(origem, env=None):
    """Resolve `origem.senha_referencia`: `cofre:<chave>` decifrado com PLATAFORMA_CHAVE_MESTRA (envelope v1 de
    continuidade.py; arquivo `<sha256 da referência>.seg` em COFRE_DIR, o mesmo formato do CofreArquivo da API);
    `env:NOME` só fora de produção. Levanta OrigemErro sem citar o valor."""
    env = os.environ if env is None else env
    ref = getattr(origem, "senha_referencia", origem) or ""
    m = REF_ENV.match(ref)
    if m:
        if _producao(env):
            raise OrigemErro("senha por variável de ambiente não vale em produção; use o cofre")
        v = env.get(m.group(1))
        if not v:
            raise OrigemErro("variável de ambiente da senha não definida")
        return v
    if not REF_COFRE.match(ref):
        raise OrigemErro("referência de senha inválida")
    from . import continuidade
    chave = continuidade.chave_mestra(env)
    dir_ = (env.get("COFRE_DIR") or "").strip()
    if chave is None or not dir_ or not os.path.isabs(dir_):
        raise OrigemErro("cofre indisponível (COFRE_DIR ou PLATAFORMA_CHAVE_MESTRA)")
    arq = os.path.join(dir_, hashlib.sha256(ref.encode("utf-8")).hexdigest() + ".seg")
    try:
        with open(arq, encoding="utf-8") as f:
            env_ = f.read().strip()
    except OSError:
        raise OrigemErro("senha não definida no cofre") from None
    v = continuidade.decifrar(chave, env_)
    if v is None:
        raise OrigemErro("senha do cofre não decifrada (chave mestra diferente ou envelope inválido)")
    return v


# códigos do Firebird (gds) -> mensagem curta, sem segredo
_ERROS = ((335544721, "servidor inacessível (rede, host ou porta)"),
          (335544472, "usuário ou senha recusados pelo servidor"),
          (335544344, "banco não encontrado no servidor (caminho ou alias)"),
          (335544734, "banco não encontrado no servidor (caminho ou alias)"),
          (335544352, "sem permissão de leitura (confira a role de leitura do usuário)"),
          (335544528, "servidor encerrando: tente mais tarde"),
          (335544726, "conexão perdida com o servidor"))


def mensagem_erro(exc):
    """Mensagem técnica curta de uma falha do driver, sem o texto do driver (que pode ecoar parâmetros)."""
    if isinstance(exc, OrigemErro):
        return str(exc)
    codigos = list(getattr(exc, "gds_codes", None) or ())
    for cod, msg in _ERROS:
        if cod in codigos:
            return msg
    txt = str(exc).lower()
    if "network" in txt or "unable to complete" in txt or "connection refused" in txt or "timed out" in txt:
        return "servidor inacessível (rede, host ou porta)"
    if "password" in txt or "login" in txt:
        return "usuário ou senha recusados pelo servidor"
    if "no permission" in txt or "no privilege" in txt:
        return "sem permissão de leitura (confira a role de leitura do usuário)"
    return "falha na conexão com o servidor Firebird (%s%s)" % (
        type(exc).__name__, (" gds %d" % codigos[0]) if codigos else "")


def _role(env):
    r = (env.get("CONECTOR_ORIGEM_ROLE") or ROLE_PADRAO).strip().upper()
    if not ROLE.match(r):
        raise OrigemErro("role de leitura fora do padrão")
    return r


@contextlib.contextmanager
def abrir_leitor_servidor(origem, env=None):
    """Abre o leitor do servidor: gerenciador de contexto com UMA conexão (DSN `origem.dsn`, usuário de leitura,
    senha do cofre, role de leitura, charset UTF8) e UMA transação SNAPSHOT + READ, aberta na entrada e desfeita
    (rollback) na saída. Devolve um `leitor.Leitor`, para o motor ler a contagem e as linhas na mesma fotografia.
    Falha de rede ou de credencial vira OrigemErro com mensagem clara (sem segredo)."""
    env = os.environ if env is None else env
    if not isinstance(origem, OrigemServidor):
        raise OrigemErro("leitura direta só vale para origem de servidor")
    from . import leitor as _leitor
    try:
        lt = _leitor.Leitor(origem.dsn, usuario=origem.usuario, senha=senha(origem, env), role=_role(env),
                            tempo_conexao=TEMPO_CONEXAO_S)
    except OrigemErro:
        raise
    except Exception as e:  # noqa: BLE001 (driver: só a classe do erro sobe, nunca o texto)
        raise OrigemErro(mensagem_erro(e)) from None
    try:
        yield lt
    finally:
        lt.fechar()


def identidade_base(leitor):
    """Identidade técnica da base lida, na transação aberta do leitor (MON$DATABASE): {"ods": "12.0",
    "pagina_bytes": 8192, "criada_em": "ISO", "nome_base": "<arquivo, sem pasta>", "versao_servidor": "3.0.14"}.
    Sem dado de pessoa. Gravada em `cliente_origem.identidade_base` e no controle da execução; a continuação recusa
    (continuar.NaoContinuavel) quando difere."""
    r = leitor.consultar(
        "SELECT MON$ODS_MAJOR, MON$ODS_MINOR, MON$PAGE_SIZE, MON$CREATION_DATE, MON$DATABASE_NAME,"
        " RDB$GET_CONTEXT('SYSTEM', 'ENGINE_VERSION') FROM MON$DATABASE")[0]
    nome = (r[4] or "").strip().replace("\\", "/").rsplit("/", 1)[-1]
    criada = r[3].isoformat() if hasattr(r[3], "isoformat") else (str(r[3]) if r[3] is not None else None)
    return {"ods": "%d.%d" % (r[0], r[1]), "pagina_bytes": int(r[2]), "criada_em": criada,
            "nome_base": nome or None, "versao_servidor": (r[5] or "").strip() or None}


def contar_tabelas(leitor):
    """Tabelas de usuário (mesmo critério de `Leitor.tabelas`)."""
    return int(leitor.consultar(
        "SELECT COUNT(*) FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG,0)=0 AND RDB$VIEW_BLR IS NULL"
        " AND RDB$RELATION_TYPE IN (0)")[0][0])


def testar(origem, env=None):
    """Teste de conexão (CLI `testar-origem`): conecta, abre a transação SNAPSHOT READ, lê a identidade e conta as
    tabelas do usuário. Devolve só agregados: {"ok": bool, "versaoServidor": str|None, "ods": str|None,
    "tabelas": int|None, "mensagem": str} (contrato TesteOrigem de @sgh/contratos). Falha vira ok=false com mensagem
    técnica curta, sem senha nem valores."""
    if not isinstance(origem, OrigemServidor):
        return {"ok": False, "versaoServidor": None, "ods": None, "tabelas": None,
                "mensagem": "a origem do cliente não é um servidor Firebird"}
    try:
        with abrir_leitor_servidor(origem, env) as lt:
            ident = identidade_base(lt)
            n = contar_tabelas(lt)
            if n > 0:  # a role dá SELECT: confere numa tabela de usuário, sem trazer linha
                t = lt.tabelas()[0]
                lt.consultar("SELECT FIRST 0 1 FROM %s" % _q_tab(t))
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "versaoServidor": None, "ods": None, "tabelas": None, "mensagem": mensagem_erro(e)}
    return {"ok": True, "versaoServidor": ident["versao_servidor"], "ods": ident["ods"], "tabelas": n,
            "mensagem": "conexão de leitura aberta (SNAPSHOT, somente leitura); %d tabelas" % n}


def _q_tab(nome):
    from .leitor import _q
    return _q(nome)
