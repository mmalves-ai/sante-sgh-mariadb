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
from dataclasses import dataclass, field

TIPO_ARQUIVO = "firebird_arquivo"
TIPO_SERVIDOR = "firebird_servidor"
PORTA_PADRAO = 3050


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
    raise NotImplementedError("fatia B-origem: carregar_origem")


def senha(origem):
    """Resolve `origem.senha_referencia`: `cofre:<chave>` decifrado com PLATAFORMA_CHAVE_MESTRA (envelope v1 de
    continuidade.py); `env:NOME` só fora de produção. Levanta OrigemErro sem citar o valor."""
    raise NotImplementedError("fatia B-origem: senha")


def abrir_leitor_servidor(origem):
    """Abre o leitor do servidor: gerenciador de contexto com UMA conexão (DSN `origem.dsn`, usuário de leitura,
    senha do cofre, charset UTF8) e UMA transação SNAPSHOT + READ, aberta na entrada e desfeita (rollback) na saída.
    Devolve um objeto com a mesma interface de `leitor.Leitor` (consultar, contagens, leitura por tabela), para o
    motor ler a contagem e as linhas na mesma fotografia."""
    raise NotImplementedError("fatia B-origem: abrir_leitor_servidor")


def identidade_base(leitor):
    """Identidade técnica da base lida, na transação aberta do leitor (MON$DATABASE e afins): por exemplo
    {"ods": "13.0", "pagina_bytes": 8192, "criada_em": "ISO", "nome_base": "<alias ou arquivo>", "versao_servidor":
    "3.0.14"}. Sem dado de pessoa. Gravada em `cliente_origem.identidade_base` e no controle da execução; a
    continuação recusa (continuar.NaoContinuavel) quando difere."""
    raise NotImplementedError("fatia B-origem: identidade_base")


def testar(origem):
    """Teste de conexão (CLI `testar-origem`): conecta, abre a transação SNAPSHOT READ, lê a identidade e conta as
    tabelas do usuário. Devolve só agregados: {"ok": bool, "versaoServidor": str|None, "ods": str|None,
    "tabelas": int|None, "mensagem": str} (contrato TesteOrigem de @sgh/contratos). Falha vira ok=false com mensagem
    técnica curta, sem senha nem valores."""
    raise NotImplementedError("fatia B-origem: testar")
