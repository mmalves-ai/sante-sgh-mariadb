# F1. Análise cruzada e modelo próprio

**Objetivo:** saber exatamente o que o sistema precisa cobrir e desenhar o modelo de dados próprio que
cobre isso. A base são o SPDATA (dados e uso real), o `new-sgh` (o que já existe) e o MV (recursos que
faltam).

**Entra:** F0.
**Sai (portão):**
- toda tabela do SPDATA com dados tem destino no modelo ou o motivo de descarte;
- o DDL do modelo aplica num MariaDB vazio, com os verificadores verdes;
- os catálogos públicos carregam do zero.

---

### F1.1 Matriz funcional MV × SPDATA × `new-sgh`

- **Objetivo:** matriz por funcionalidade de negócio, organizada nos 18 módulos da matriz do SPDATA.
- **Entregas:**
  - `docs/analise/01..08-<grupo>.md`. Para cada funcionalidade:
    - evidência no MV;
    - evidência e uso no SPDATA (volume de linhas);
    - estado no `new-sgh`;
    - decisão de fase (F3, F7, F8 ou não fazer);
    - entidades próprias propostas.
  - `docs/analise/09-completude.md`: áreas do MV não cobertas e contradições entre grupos.
- **Aceite:** o crítico de completude não aponta área sem decisão, e o dono revisa as decisões F7 e F8.
- **Situação:** primeira rodada rodando em 2026-11-20.

### F1.2 Princípios do modelo (ADR 0002)

- **Objetivo:** convenções que todo o DDL segue.
- **Entregas:** ADR com:
  - **Nomes:** português, `snake_case`, singular.
  - **Chaves:** `id` `BIGINT` em toda tabela.
  - **Números de negócio** (prontuário, atendimento, conta, guia, lote, documentos fiscais): colunas
    próprias, com sequência por estabelecimento.
  - **Tipos:** dinheiro em `DECIMAL`; datas em `DATE`/`DATETIME` com fuso definido; booleanos em
    `BOOLEAN`; domínios fechados em tabela de domínio ou `ENUM` (critério de escolha).
  - **Auditoria:** criado e alterado por quem e quando; trilha.
  - **Exclusão lógica:** onde se aplica.
  - **Isolamento entre hospitais:** banco por hospital, ou o critério da coluna de estabelecimento.
  - **Prontuário:** versões imutáveis e documento assinado em bytes.
  - **Origem da migração:** `origem`, e o vínculo com `conector_origem` fora do banco de produção.
  - **Vetores:** onde se usa `VECTOR`.
- **Aceite:** ADR aceito pelo dono.

### F1.3 Modelo por módulo

- **Objetivo:** DDL próprio, em migrações versionadas.
- **Depende de:** F1.1 (decisões F3 e F7) e F1.2.
- **Ordem:**
  1. organização, pessoas e acesso;
  2. cadastros-base e catálogos;
  3. recepção, agenda e atendimento;
  4. prontuário, prescrição e enfermagem;
  5. internação, leitos e centro cirúrgico;
  6. diagnóstico;
  7. farmácia e suprimentos;
  8. faturamento (convênio, TISS, SUS);
  9. financeiro, fiscal e contábil;
  10. hotelaria, SAME e manutenção;
  11. pessoas;
  12. relatórios.
- **Entregas por módulo:**
  - migrações;
  - diagrama do módulo;
  - de-para das portas do `new-sgh` para as entidades;
  - lista do que o MV inspirou, em palavras próprias.
- **Aceite por módulo:** migrações aplicam e verificadores verdes. As portas do `new-sgh` daquele módulo
  têm onde gravar, sem coluna "só para o SPDATA".

### F1.4 Catálogos públicos

- **Objetivo:** base pré-carregada para qualquer hospital.
- **Entregas:**
  - **Carregadores versionados, um por fonte:**
    - TUSS, Rol e terminologias TISS (ANS);
    - SIGTAP e as tabelas de relacionamento;
    - CID-10 (DATASUS);
    - CBO (MTE);
    - municípios e UF (IBGE);
    - CNES (dados abertos);
    - países, conselhos profissionais e especialidades e áreas de atuação, a partir das fontes oficiais
      e das terminologias TISS.
  - Cada carga registra fonte, versão ou competência, data e hash do arquivo de origem.
  - **Conferência por amostragem** contra a cópia do MV no Oracle Free. Só contagens e chaves, sem
    copiar nada.
- **Aceite:** banco vazio → catálogos carregados → contagens conferidas, em um comando.
- **Fora:** Simpro, Brasíndice, CBHPM e base de CEP dos Correios. São licenciados e só entram por hospital
  que comprovar licença.

### F1.5 Mapa de rastreio SPDATA → modelo

- **Objetivo:** base do mapa do conector (F4.2).
- **Depende de:** F1.3.
- **Entregas:** para cada uma das 1.503 tabelas do SPDATA com dados:
  - entidade e campos de destino, ou descarte com o motivo (descarte de migração, não de guarda);
  - chave de identidade, campos imutáveis e dependências.
- **Aceite:** verificador com 100% das tabelas com destino ou motivo. Roda na esteira.
