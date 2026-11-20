# F0. Fundação

**Objetivo:** ter o repositório do projeto com o modelo base do `new-sgh` trazido para cá, sem o
adaptador do legado, sobre um MariaDB 12.3 local, com a esteira de qualidade verde.

**Entra:** ADR 0001 aceito; `new-sgh` no commit de partida escolhido.
**Sai (portão):** `pnpm verificar` verde no modelo base, com o `packages/legado` fora e o MariaDB de
desenvolvimento no ar.

---

### F0.1 Repositório e regras do projeto

- **Objetivo:** estrutura do projeto e regras para pessoas e sessões de IA.
- **Entregas:**
  - `git init`, com o dump e as imagens fora do git;
  - `AGENTS.md`, `docs/ESTADO.md`, `docs/adr/`, `docs/fases/`;
  - `.gitignore` cobrindo `.env`, `dump/`, imagens e cópias.
- **Aceite:** o git não rastreia `.env`, dump nem imagem; o `AGENTS.md` está revisado pelo dono.

### F0.2 Trazer o modelo base do `new-sgh`

- **Objetivo:** copiar o código do `new-sgh` que vai ser aproveitado.
- **Depende de:** F0.1.
- **Entregas:**
  - **Commit de partida registrado** no `ESTADO.md`.
  - **Cópia do que é aproveitado:**
    - `packages/dominio-*`, `contratos`, `ui`, `testes`;
    - `apps/api`, `apps/web`, `apps/worker`;
    - `tools/` (verificadores) e a configuração do monorepo (Nx, pnpm, lint, tsconfig).
  - **O que não vem:**
    - `packages/legado`, exceto o núcleo, que é extraído na F2.1;
    - a documentação de coexistência e os verificadores que só fazem sentido sobre o Firebird.
  - **Inventário do que foi trazido:** pacotes, linhas, testes e o que ficou de fora com o motivo.
- **Aceite:** o inventário bate com o commit de partida, e não há dado pessoal nem segredo na cópia
  (verificador de segredos verde).

### F0.3 MariaDB de desenvolvimento

- **Objetivo:** banco local para desenvolvimento e testes.
- **Depende de:** F0.1.
- **Entregas:**
  - `docker-compose` com `mariadb:12.3.x`, só em loopback, com volume próprio;
  - um banco de desenvolvimento e um de teste, descartável a cada execução;
  - ferramenta de migrações só para frente, em que cada migração confere o próprio resultado (escolha
    registrada em ADR 0002);
  - driver do Node escolhido e com versão fixada.
- **Aceite:** subir do zero, aplicar as migrações e derrubar, em um comando.

### F0.4 Esteira de qualidade

- **Objetivo:** a esteira do `new-sgh` (lint, tipos, testes, formato, segredos, Semgrep, OSV, Trivy)
  rodando aqui, mais verificadores próprios.
- **Depende de:** F0.2 e F0.3.
- **Entregas:**
  - **Verificador de nomes proibidos:** nenhum nome de tabela, coluna ou descritivo do SPDATA ou do MV
    em migrações, código e telas. Uma lista de padrões, mais a lista de tabelas das duas origens.
  - **Verificador de gatilhos:** nenhum `CREATE TRIGGER` com regra de negócio nas migrações.
  - **Verificador de fronteiras:** o domínio não importa banco, e só o `packages/persistencia` fala com o
    MariaDB.
- **Aceite:** um nome proibido, um gatilho ou uma importação proibida fazem a esteira falhar. Isso é
  provado com um caso de teste de cada.

### F0.5 Cópia do SPDATA para desenvolvimento do conector

- **Objetivo:** imagem do Firebird para o conector ler durante a construção.
- **Depende de:** F0.1.
- **Entregas:**
  - container Firebird 3.0.14 próprio do projeto, só leitura e sem rede de saída;
  - a imagem é restaurada da matriz do `banco-dev` (`backups/pc-20261019.fdb`), conferindo o hash;
  - registro da imagem: hash, horário de corte e contagem por tabela.
- **Aceite:** consulta somente leitura funcionando, e o container não alcança a rede externa.
- **Regra:** as cópias compartilhadas do `banco-dev` e o `sante-firebird` não são alteradas.
