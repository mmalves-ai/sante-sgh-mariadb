# F4. Conector diferencial

**Objetivo:** o conector que copia o SPDATA para o banco próprio e o mantém em dia por diferencial, com
rastreio, pendências e conciliação. O desenho completo está no ADR 0001, item 3.

**Entra:** F0.5 (imagem de desenvolvimento); F1.5 (mapa de rastreio).
**Sai (portão):**
- carga completa de uma imagem real do `pc` num MariaDB vazio, conciliada por entidade;
- diferencial de um dia aplicado e medido;
- travas provadas.

Roda **em paralelo com a F3**.

---

### F4.1 Leitura de imagens

- **Entregas:**
  - **Restauração da imagem:** num container descartável, em somente leitura (`gfix -mode read_only`),
    sem rede de saída.
  - **Registro da imagem:** hash, horário de corte e contagem por tabela.
  - **Conversão:** leitura em bytes crus (charset NONE), com conversão CP1252 → utf8mb4 determinística e
    testada.
  - **Tabelas fora do mapa:** as de configuração de integração e as credenciais.
- **Aceite:** leitura completa de uma imagem com contagens iguais às do registro.

### F4.2 Mapa de-para de estrutura

- **Entregas:**
  - **Formato declarativo e versionado,** gerado a partir do F1.5. Por tabela, declara:
    - chave de identidade (PK, chave natural ou recarga inteira);
    - campos imutáveis;
    - dependências;
    - estratégia de diferença (hash completo, faixa nova, hash por bloco).
  - **Verificador do mapa:** toda tabela com dados tem regra, e as dependências formam uma ordem sem ciclo.
- **Aceite:** verificador verde.

### F4.3 De-para de valores

- **Entregas:**
  - casamento direto pela chave oficial (TUSS, SIGTAP, CID, CBO, IBGE);
  - sugestão por similaridade vetorial (MariaDB `VECTOR`, modelo local) **só para colunas de cadastro e
    de domínio**;
  - **tela de aprovação:** o par aprovado vira linha fixa do de-para.
- **Aceite:** nenhum texto clínico ou de identificação de paciente é vetorizado (teste), e o par aprovado
  não é sugerido de novo.

### F4.4 Gravação

- **Entregas:**
  - **Estado como está,** com os derivados (saldos, custo médio, totais, situação), direto nas tabelas.
  - **Invariantes de domínio** rodando como verificação, sem gravar.
  - **Estado em andamento** com `origem = migracao`.
  - **Prontuário assinado** em bytes originais, com hash, e versões que nunca são sobrescritas.
  - **Usuários primeiro:** toda coluna de usuário resolvida para o id do usuário próprio.
  - **Documentos e anexos** no armazenamento de objetos, com hash do conteúdo.
- **Aceite:** conciliação da carga completa por entidade (contagens e somas de controle) contra a origem.

### F4.5 Rastreio, pendências e travas

- **Entregas:**
  - **`conector_origem`** (N destinos por origem) numa base de controle separada.
  - **Fila de pendências** com propagação "pai pendente" e motivo sem valores de paciente.
  - **Lista de pendências críticas** por entidade.
  - **Trava de exclusão em massa** (N% ou M linhas).
  - **Execuções registradas:** versão do schema e do mapa em cada execução.
- **Aceite:**
  - uma imagem truncada de propósito é barrada pela trava antes de gravar;
  - um pai pendente segura os filhos.

### F4.6 Diferencial

- **Entregas:**
  - hash sobre os bytes de origem;
  - as três estratégias por tabela;
  - inclusão, atualização e exclusão lógica com reativação;
  - reaproveitamento de chave tratado como exclusão + inclusão + pendência crítica.
- **Aceite:**
  - diferencial entre duas imagens reais (`pc`), com o tempo medido por tabela;
  - meta de tempo do diferencial diário registrada.

### F4.7 Numeração e sequências

- **Entregas:**
  - leitura dos generators e dos maiores valores de cada número de negócio na imagem;
  - ajuste das sequências próprias, por estabelecimento;
  - conferência de que nenhum número novo existe na origem.
- **Aceite:** teste sobre a imagem de desenvolvimento.

### F4.8 Relatórios de conciliação

- **Entregas:** relatório por entidade com contagens, somas de controle, pendências (abertas, críticas,
  resolvidas) e saídas externas (tem de ser zero). Só agregados, sem dado pessoal.
- **Aceite:** relatório gerado em toda execução.
