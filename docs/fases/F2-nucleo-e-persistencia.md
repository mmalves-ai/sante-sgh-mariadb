# F2. Núcleo neutro e persistência própria

**Objetivo:** a aplicação do modelo base funcionando sobre o MariaDB, num fluxo vertical completo, sem
nenhuma dependência do legado.

**Entra:** F0; F1.2; F1.3 dos módulos de organização, pessoas, acesso, cadastros e atendimento.
**Sai (portão):** cadastro de paciente → atendimento ponta a ponta no MariaDB, pelas telas do `new-sgh`,
com a mesma bateria de testes passando em memória e no banco.

---

### F2.1 Extrair o núcleo de infraestrutura

- **Objetivo:** tirar de dentro do antigo `packages/legado` o que é infraestrutura genérica.
- **Entregas:**
  - **`packages/nucleo`:** executor de operações, trilha, idempotência, erros de operação (`ErroOperacao`),
    contexto da rede e do estabelecimento (`ContextoOperacao`), leitor e escritor genéricos;
  - **imports trocados:** os cerca de 427 arquivos da API, mais os do worker e da web, que importavam o
    legado por esses símbolos, passam a importar o núcleo.
- **Aceite:** zero import de `@sgh/legado` no repositório (verificador de fronteiras), e a esteira verde.
  A contagem de arquivos migrados é registrada.

### F2.2 Portas e contratos em vocabulário neutro

- **Objetivo:** tipos de porta e contratos sem a forma do SPDATA.
- **Entregas:**
  - tipos `*Lido`/`*Legado` substituídos por tipos de negócio: booleanos, datas, ids e números de
    negócio;
  - contratos (Zod) ajustados;
  - telas ajustadas onde o contrato mudou;
  - remoção do código que só existia para a convivência com o SPDATA.
- **Aceite:** verificador de nomes proibidos verde em portas, contratos e telas; E2E verdes com a fonte
  sintética.

### F2.3 `packages/persistencia` sobre o MariaDB

- **Objetivo:** infraestrutura dos adaptadores "próprio".
- **Entregas:**
  - pool por estabelecimento ou banco por hospital, conforme o ADR 0002;
  - transação, trava otimista ou pessimista por operação, outbox e trilha na mesma transação;
  - números de negócio por sequência;
  - **teste de vazamento entre hospitais** (obrigatório se o isolamento for por coluna).
- **Aceite:** testes de infraestrutura no MariaDB real.

### F2.4 Acesso próprio

- **Objetivo:** usuários, perfis e permissões sem as tabelas de permissão do legado.
- **Entregas:**
  - modelo de usuário, perfil, permissão e escopo;
  - CASL do `new-sgh` ligado a ele;
  - login, troca de senha, quebra de vidro e trilha de acesso ao prontuário.
- **Aceite:** testes de autorização do `new-sgh` verdes sobre o modelo próprio.

### F2.5 Fluxo vertical: paciente → atendimento

- **Objetivo:** provar a arquitetura de ponta a ponta.
- **Entregas:**
  - adaptadores "próprio" das portas de cadastro de paciente, agenda e atendimento;
  - as telas do `new-sgh` desses fluxos ligadas ao MariaDB;
  - a mesma bateria rodando em memória e no MariaDB.
- **Aceite:**
  - E2E do fluxo verde no MariaDB;
  - relatório com as portas cobertas e o que falta, que vira a fila da F3.
