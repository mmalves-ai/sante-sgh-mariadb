# Instruções para agentes de IA (qualquer ferramenta)

Projeto `sante-sgh`: sistema hospitalar sobre **banco próprio em MariaDB 12.3**, construído a partir de um
**modelo base trazido do `new-sgh`** (pasta irmã) e melhorado para o banco novo. Os hospitais que vêm do
SPDATA entram por um **conector diferencial**. A decisão de fundo é o
[ADR 0001](docs/adr/0001-banco-proprio-e-virada-por-conector-diferencial.md).

## Comece por aqui

1. `docs/ESTADO.md`: em que pé está a obra, o marco atual, os bloqueios e as decisões pendentes.
2. A ficha do marco em `docs/fases/` e o ADR 0001. Leia só o necessário para o marco.
3. **Tarefa longa: siga o [protocolo de tokens](docs/obra/protocolo-tokens.md).** É regra obrigatória
   (2026-11-20), replicada do `new-sgh`.
   - Ao começar, avise: **"Rodando sob o protocolo de otimização de tokens e reports periódicos"**.
   - **Todo relatório no chat** durante orquestração com subagentes tem o cabeçalho **"Orquestrando com
     otimização do uso de tokens"**.
   - **Subagentes sem leitura de contexto em duplicidade:**
     - fatias pequenas por agente, geradas por script;
     - brief comum num arquivo, citado e não repetido;
     - saídas longas em arquivo, com só o resumo devolvido;
     - referência comum em versão compacta;
     - conferência determinística antes de qualquer agente verificador.
   - Relatório ao dono a cada 50 minutos: tarefas em termos da área hospitalar, % e tempo de cada uma,
     completude e previsão geral.

## O projeto é independente do `new-sgh`

- As regras do `new-sgh` (coexistência no Firebird, "não existe banco novo", teste de assinatura, tabelas
  `SGH_` no legado) **não valem aqui**.
- O `new-sgh` é **fonte de código**, só para leitura: nunca edite, faça commit nem rode a obra dele a
  partir desta pasta.
- **O que vem do `new-sgh`:** domínios, contratos, UI, API, web, worker, testes e verificadores, a partir
  de um commit de partida registrado no `ESTADO.md`.
- **O que não vem:** o `packages/legado`. Vem só o núcleo de infraestrutura que mora nele, extraído para
  `packages/nucleo` (F2.1).
- **Correções feitas lá** depois do commit de partida são avaliadas pelo relatório mensal e trazidas ou
  recusadas, com registro.

## Regras de ouro

### 1. Modelo próprio: nada do SPDATA nem do MV no nome

- Tabelas, colunas, descritivos, código e telas usam **nomes de negócio em português**, `snake_case` no
  banco.
- **Proibido** usar nome de tabela, coluna ou descritivo do SPDATA ou do MV, e qualquer menção a "MV",
  "Soul", "MV2000", "SPDATA" no modelo, no código ou nas telas. O verificador de nomes proibidos roda na
  esteira.
- **Uso permitido das duas origens:** o MV serve **só como referência de recursos** (o que um hospital
  precisa). O SPDATA é **a base de dados** de onde a Rede Santé migra. A estrutura dos dois nunca é
  molde.
- Onde os nomes do MV e do SPDATA podem aparecer:
  - em `docs/analise/` e `referencias/`, como evidência interna;
  - no mapa do conector, como origem.
- O modelo **não se deforma para facilitar a migração.** A diferença que sobrar é do conector.

### 2. Regra de negócio no domínio, nunca no banco

- **Nenhum gatilho com regra de negócio** no MariaDB (verificador na esteira).
- As regras que o SPDATA tinha em gatilhos e procedures são **lidas no PSQL** e escritas no domínio, com
  teste.
- Cada operação de gravação tem **contrato de efeito**: o que deixa no banco, em teste automatizado.
- O contrato de uma operação que existe no SPDATA **deriva da captura de assinatura** (do `new-sgh` ou
  nova). Divergência intencional fica registrada, com o motivo.

### 3. Fronteiras

- `packages/dominio-*` não importam banco nem infraestrutura de I/O.
- **Só o `packages/persistencia`** fala com o MariaDB.
- **Só o `conector/`** fala com o Firebird, e só lê.
- Portas e contratos usam **vocabulário neutro:** booleano, data, id, número de negócio. Nada de S/N, HHMM
  ou sentinelas.

### 4. O SPDATA nunca é alterado

- O conector **só lê imagens** (cópias restauradas em container sem rede de saída e em somente leitura).
  Nunca lê o banco de produção nem grava no Firebird.
- As cópias compartilhadas do `banco-dev` (`redesante-fb-pc`, `redesante-fb-pc2`) e o `sante-firebird`
  não são alterados nem parados por este projeto.

### 5. Dados reais

- Imagens do SPDATA e o dump do MV têm **dados reais de pessoas**.
- Nada sai das cópias para código, testes, logs, commits, documentos ou chat, a não ser **contagens e
  agregados**.
- Do dump do MV, use **só metadados** (dicionário: tabelas, colunas, comentários). Nunca leia conteúdo de
  linhas.
- Pendências e logs do conector registram tabela, chave original e regra violada, **nunca valores**.
- **Vetorização:** só colunas de cadastro e de domínio, com modelo local. Texto clínico e identificação de
  paciente nunca são vetorizados.
- **Homologação com dados reais** só depois dos quatro pré-requisitos de LGPD da F5.1.

### 6. Nenhuma mensagem externa fora de produção

- Desenvolvimento e homologação ficam **neutralizados:**
  - e-mail para captura local;
  - WhatsApp e SMS desligados;
  - TISS e laboratório para destinos falsos;
  - sem rede de saída.
- O envio para fora só existe com a chave de ambiente de produção.

### 7. Catálogos

- Dados públicos (TUSS, SIGTAP, CID-10, CBO, IBGE, CNES, terminologias TISS) vêm **das fontes oficiais**,
  por carregador versionado. Nunca do dump do MV nem do SPDATA.
- **Licenciados** (Simpro, Brasíndice, CBHPM, CEP dos Correios) nunca entram na base do produto. Entram só
  por hospital que comprove licença.

### 8. Segredos e ambiente

- O `.env` desta pasta tem segredos (Oracle, AWS). **Nunca imprima valores**, nunca copie para outro
  arquivo e nunca faça commit dele.
- O `.env` também guarda uma cópia do token do GitHub (variável `GITHUB`). Regras na seção
  [Git deste projeto](#git-deste-projeto).
- Credenciais de integração vão para o cofre de segredos, nunca para o banco nem para o código.
- Só loopback para bancos e serviços de desenvolvimento. Nada é instalado globalmente na VM: use
  containers e ferramentas do repositório.

### 9. Git e ações irreversíveis

- Commit, push e qualquer ação irreversível ou externa (enviar e-mail, publicar, apagar volume ou
  imagem) **só com autorização do dono**.
- Antes de apagar ou sobrescrever, olhe o alvo.

### 10. Provar antes de dizer pronto

- Um marco só fecha com a prova pedida na ficha: teste, relatório, medição.
- Use os números medidos e registrados. Não invente números.
- Relate falhas como são.

## Mapa da pasta

| Caminho | O que é |
|---|---|
| `AGENTS.md` | Estas instruções |
| `docs/ESTADO.md` | Estado da obra |
| `docs/adr/` | Decisões de arquitetura (0001 em diante) |
| `docs/fases/` | Roteiro de construção, F0 a F8 |
| `docs/analise/` | Matriz funcional MV × SPDATA × `new-sgh` (uso interno) |
| `referencias/` | Metadados de referência, como `mv-tabelas.tsv` (uso interno) |
| `docker-compose.yml`, `dump/`, `scripts/` | Oracle de referência com o dump do MV (só metadados interessam) |
| A criar na F0 | `apps/`, `packages/`, `db/migracoes/`, `catalogos/`, `conector/`, `tools/` |

## Ambiente nesta VM

- **Oracle de referência:** container `sante-sgh-oracle`, `127.0.0.1:1521/FREEPDB1`, senha em
  `.env` (`ORACLE_SENHA`). Detalhes no `README.md`.
- **Cópias do SPDATA para desenvolvimento:** a matriz fica em `../banco-dev/backups/` e não pode ser
  aberta direto. O conector usa um container próprio restaurado dela (F0.5).
- **Containers comuns da VM** (Gotenberg, Mailpit e outros de outros projetos): não pare, não altere.

## Git deste projeto

Decidido em 2026-11-20.

### Repositórios e pastas

| Pasta local | Repositório no GitHub | Papel |
|---|---|---|
| `sante-sgh` (esta) | `mmalves-ai/sante-sgh-mariadb` | Produto atual, banco próprio. **É o foco.** |
| `new-sgh` (+ worktrees em `new-sgh-wt/`) | `mmalves-ai/sante-sgh` | Legado. Só fonte de código, para leitura. |

- O repositório `mmalves-ai/sante-sgh` **não** é deste projeto, apesar do nome. Ele ficou com o
  `new-sgh` por histórico.
- O nome `sante-sgh-mariadb` foi escolhido de propósito, para lembrar que o foco agora é o banco
  próprio.
- **As pastas locais não são renomeadas.** As cerca de 150 worktrees do `new-sgh` guardam caminho
  absoluto, e os `.md` dos dois lados citam "new-sgh" como pasta e "sante-sgh" como produto.

### Configuração desta pasta

- Remote `origin`: `https://github.com/mmalves-ai/sante-sgh-mariadb.git`. Branch principal: `main`.
- **Autenticação:** igual aos outros repositórios da VM. É HTTPS com o `credential.helper store`
  global do `~/.gitconfig`, que guarda o token fine-grained do dono.
  - Não há helper local nesta pasta; `git push` e `git pull` funcionam direto.
  - Não use chave SSH: o dono não usa mais.
  - O `.env` tem uma cópia do token (variável `GITHUB`), só para o caso de o `store` pedir senha
    de novo. Nunca a leia, imprima nem copie para a URL do remote, o `.git/config` ou o chat.
- **Fora do git, pelo `.gitignore`:**
  - `.env` e `.env.*`;
  - `dump/` e `*.dmp`, por ter dados reais e arquivos de GB;
  - `node_modules/`, `__pycache__/`, `.venv/` e `*.log`.
- O repositório é **privado**. `docs/analise/` e `referencias/` têm nomes do MV e do SPDATA como
  evidência interna (regra 1).
- Antes de qualquer `git add`, confira que nada de `.env`, `dump/` ou dado de pessoa está sendo
  versionado (regra 5).
- Primeiro commit: `6976210` (2026-11-20).

### Relação com o `new-sgh`

- Daqui, o git do `new-sgh` é **só consultado**: `git log`, `git ls-remote`, `git cherry`. Nada de
  fetch, commit, push ou mudança de branch. Qualquer ação lá é feita numa sessão aberta na própria
  pasta.
- Situação conferida em 2026-11-20:
  - `fase0` e `main` do GitHub estão no mesmo commit, `d3f8b5d`;
  - 17 branches locais `dev/crud-W*` e `marco/M21` têm commits fora da `fase0` e só existem na VM;
  - o backup ou o descarte delas é decisão do dono.
