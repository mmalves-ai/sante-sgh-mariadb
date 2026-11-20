# ADR 0001: Banco próprio em MariaDB e virada por conector diferencial

## Status

aceito (2026-11-20): direção aprovada pelo dono do projeto, que mandou concluir este ADR e gerar as
fases de construção. As pendências do fim continuam abertas e são decididas nas fases indicadas. Antes:
proposto (2026-11-20), revisado por três revisões independentes (virada, arquitetura, dados/LGPD), com
43 achados consolidados.

## Premissas do dono (2026-11-20)

1. **Analisar o modelo do MV** (Oracle) e **cruzar com o SPDATA** (Firebird) e com o `new-sgh`.
2. **Criar o modelo próprio em MariaDB:**
   - sem gatilho com regra de negócio;
   - sem nenhuma referência ao SPDATA ou ao MV em nomes e descritivos;
   - com o melhor dos dois, entendido como **funcionalidade**, não estrutura.
3. **Papel de cada fonte:**
   - o **SPDATA é a base de dados**: a Rede Santé migra dele;
   - o **MV é referência de recursos novos**.
4. **Migração simples, mas sem deformar o modelo.** O modelo é desenhado sabendo de onde vêm os dados, o
   que deixa a migração simples e direta. Isso não autoriza imitar o SPDATA: a diferença que sobrar é
   absorvida pelo conector, nunca pelo modelo.
5. **O `new-sgh` é a base do código.** Usa-se a maior parte do que já foi feito, **inclusive todas as
   telas**, e somam-se os recursos que a análise do MV indicar.
6. **Operação de produção:** dia 0, cópia do Firebird e carga pelo conector; dia 1, a equipe avalia os
   dados; dia 2+n, sincronismo diferencial, gravação liberada e produção no sistema novo (item 3.6).

## Contexto

- O `new-sgh` (pasta irmã) convive com o SPDATA **no mesmo banco Firebird** (ADR 0003 dele). Suas regras
  ("não existe banco novo", gravar como o SPDATA grava, teste de assinatura) valem lá e **não valem
  aqui**. Esta pasta, `sante-sgh`, é um projeto paralelo, com regras próprias.
- **Objetivo:** ligar a estrutura do `new-sgh` a um **banco próprio** e aproveitar as regras de negócio
  que ele já tem. O resultado é um sistema hospitalar que **qualquer hospital** pode começar do zero, com
  só dados públicos de referência pré-carregados (TUSS, SIGTAP, CID-10, CBO, especialidades, conselhos,
  municípios IBGE, CNES, terminologias TISS). Hospitais que hoje usam o SPDATA, como a Rede Santé, entram
  por um **conector diferencial**.
- **O que o `new-sgh` já tem** (medido em 2026-11-20):
  - **30 pacotes de domínio** que não importam o adaptador do legado, com cerca de 4.500 casos de teste
    sem banco;
  - **camada de portas** na API: 206 interfaces `Porta*` em 217 arquivos, com adaptadores "legado",
    "memória" e "indisponível" escolhidos no `app.module.ts`.
- **Limites dessa reutilização:**
  - **Núcleo preso ao legado.** 519 arquivos da API importam `@sgh/legado`. Só 92 são adaptadores de
    porta; os outros usam o núcleo de infraestrutura que mora lá (`ErroOperacao`, `ContextoOperacao`,
    `NucleoLegado`, trilha, executor).
  - **Tipos com formato do SPDATA.** Os tipos das portas usam S/N, HHMM e IDs do legado.
  - **Regras no PSQL do Firebird.** Parte das regras vive em 2.538 gatilhos e 181 procedures do SPDATA. O
    `new-sgh` só confere o efeito de parte delas, em cerca de 620 chamadas `exigirEfeito()` e 221
    gatilhos citados no catálogo.
- **O SPDATA da Rede Santé:**
  - Firebird 3.0.14, charset NONE com texto CP1252;
  - 3.756 tabelas, 1.503 com dados, 94 sem PK, 1.011 PKs compostas, 2.046 generators;
  - **dois bancos**: `pc` (ProntoCardio, cerca de 48 GB) e `hs` (Serrano), cada um com o seu cadastro.
- **O que fica fora da imagem do `.fdb`:**
  - o banco externo de digitalização (CPDIGITAL/CDDIGITAL), alimentado por gatilhos;
  - possíveis arquivos em disco.
- **O dump do ambiente de teste do MV** (Oracle, nesta pasta) serve **só como lista de conferência**
  funcional. O modelo de dados é próprio: nenhum nome, coluna ou descritivo é copiado de lá.

## Decisão

### 1. Banco próprio

- **MariaDB 12.3 LTS**, `utf8mb4`, InnoDB, imagem oficial `mariadb:12.3.x`, só em loopback no
  desenvolvimento.
- **Modelo de dados próprio**, normalizado, com nomes em português de negócio:
  - chave substituta (`id`) em toda tabela;
  - datas em `DATETIME`/`DATE` e booleanos em `BOOLEAN`, sem as sentinelas do SPDATA.
- **Números de negócio** (prontuário, atendimento, conta, guia e lote TISS, documentos fiscais,
  receituário de controlado) ficam em **colunas próprias, separadas do `id`**, com sequência por
  estabelecimento. Na migração, são preservados.
- **Migrações:**
  - só avançam (sem *down*);
  - como o DDL do MariaDB não é transacional, cada migração confere o próprio resultado.
- **Busca vetorial nativa** (`VECTOR` + índice HNSW) para catálogos e de-para de cadastros (item 3.2).
- **Catálogos públicos:**
  - vêm das **fontes oficiais**, por carregadores versionados (um por fonte, com a competência ou
    versão);
  - nada desses dados vem do dump do MV nem do SPDATA.
- **Catálogos licenciados** (Simpro, Brasíndice, **CBHPM**, base de CEP dos Correios):
  - nunca fazem parte da base pré-carregada do produto;
  - só entram na instância de um hospital que comprove licença vigente e válida para uso em outro
    software.
- **Isolamento entre hospitais: um banco por hospital,** como padrão recomendado. Cada hospital é um
  controlador diferente na LGPD, e o MariaDB não tem RLS. A decisão é tomada **antes da primeira
  migração** (ver Pendências). Se a escolha for coluna de estabelecimento, toda porta de persistência
  passa a ter teste automatizado de vazamento entre hospitais.

### 2. Código: a estrutura do `new-sgh` ligada ao banco próprio

O objetivo é **ligar a estrutura do `new-sgh` ao banco novo e aproveitar as regras que ele já tem**. Nada é
reescrito do zero.

- **O modelo base do `new-sgh` vem para esta pasta.** Decisão do dono (2026-11-20): trazer o código para
  cá e melhorar a definição para o banco novo. O commit de partida do `new-sgh` fica registrado. O
  `new-sgh` segue intocado, servindo à coexistência.
- **Ponto de encaixe: a camada de portas.**
  - Aqui as portas têm duas implementações: **"próprio"** (adaptadores sobre o MariaDB) e "memória", para
    testes.
  - **Não existe adaptador do legado nesta pasta:** quem fala com o SPDATA é só o conector (item 3).
  - O `packages/legado` não vem. Vem só o núcleo de infraestrutura que mora dentro dele.
- **Aproveitado como está:**
  - os 30 pacotes de domínio;
  - contratos (Zod) e telas;
  - E2E, mecanismos de TISS, PDF/A e S3.
- **Feito antes dos adaptadores "próprio", nesta ordem:**
  1. **Extrair o núcleo de infraestrutura** de dentro do `packages/legado` para um `packages/nucleo`
     neutro: executor de operações, trilha, idempotência, erros de operação, contexto da rede e do
     estabelecimento. Os cerca de 427 arquivos da API que importam o legado sem ser adaptador, e os do
     worker e da web, passam a importar só portas e núcleo. A primeira entrega mede quantos já foram
     migrados.
  2. **Tipos das portas e contratos em vocabulário neutro,** sem S/N, HHMM e IDs do legado. As telas se
     ajustam onde o contrato muda.
  3. **Os pontos que furam a porta:** 25 arquivos do worker e 59 da API, que acessam o banco direto.
- **Regras do PSQL do SPDATA levadas para o domínio.**
  - **O que levar:** o inventário dos 2.538 gatilhos e 181 procedures, por módulo, marca quais o sistema
    novo precisa reproduzir. A regra é lida no PSQL; ela não está no código do `new-sgh`.
  - **Contrato de efeito:** cada operação ganha um, em teste automatizado. Ele diz o que a operação tem de
    deixar no banco.
  - **Oráculo independente:** o contrato de uma operação que existe no SPDATA **deriva da captura de
    assinatura** do `new-sgh` (`packages/legado/src/*/assinaturas/`), ou de uma captura nova numa imagem
    restaurada. Não sai só da leitura do gatilho. Divergência intencional fica registrada no contrato,
    com o motivo.
- **Usuários e permissões próprios,** no lugar das tabelas de permissão do legado (item 3.3).
- **O que vive nesta pasta:**
  - a aplicação (vinda do modelo base);
  - o modelo e as migrações do MariaDB;
  - os carregadores dos catálogos públicos;
  - o conector diferencial;
  - estas decisões.
- **Sincronia com o `new-sgh`:** um relatório mensal lista os commits do `new-sgh` em `dominio-*`,
  `contratos` e `apps/web` feitos depois do commit de partida e ainda não avaliados aqui. Cada um é trazido
  ou recusado, com registro.

### 3. Conector diferencial: do SPDATA para o banco próprio

O conector **só lê** o SPDATA e **só escreve** no MariaDB. Ele nunca grava no Firebird nem lê o banco de
produção: lê **imagens**. O SPDATA segue funcionando sem impacto até a janela de virada.

#### 3.1 Origens e imagens

**Origens:**
- os bancos `pc` e `hs`;
- o banco externo de digitalização (CPDIGITAL/CDDIGITAL);
- os repositórios de arquivos que o inventário da Fase A encontrar.

A virada não sai sem conciliação de todas as origens.

**Como a imagem é tirada:**
- **Sem parar a produção:** `nbackup -L` com cópia do arquivo travado, ou `gbak` online.
- **Cópia a frio,** que exige o SPDATA parado, **só na imagem final** da janela.

**Como a imagem é usada:**
- É restaurada **sem neutralização** e aberta em somente leitura (`gfix -mode read_only`), num container
  descartável **sem rede de saída**.
- Antes de ser usada, cada imagem tem registrados o hash do arquivo, o horário de corte e a contagem de
  linhas por tabela.
- As tabelas de configuração de integração e as credenciais (`TBTISSWEBSERV`, `PREMAILCFG`, `SITPEQV`,
  `TBINFBANCO` e afins) **ficam fora do mapa**. Elas são recadastradas no sistema novo, com as
  credenciais no cofre de segredos.

#### 3.2 Mapa de-para (versionado e revisado por gente)

**Estrutura** (tabela e coluna do SPDATA → entidade e campo do modelo próprio). Parte da matriz de
cobertura das 1.503 tabelas com dados. Por tabela, o mapa declara:

- **Chave de identidade:**
  - a PK;
  - ou uma chave natural (por exemplo, o paciente por prontuário+tipo+OTMU);
  - ou, na falta das duas, a **recarga inteira** da tabela a cada execução.
- **Campos imutáveis** (nascimento, nome da mãe, data de abertura). Se mudarem sob a mesma chave, é
  **reaproveitamento de chave**: o conector faz exclusão+inclusão e abre pendência crítica, e nunca
  atualiza. Isso evita trocar os dados de um paciente pelos de outro.
- **Dependências entre entidades,** inclusive as que não têm FK no SPDATA. A carga segue a ordem
  topológica, e as exclusões, a ordem inversa.
- **Estratégia de diferença:**
  - cadastros e tabelas pequenas: hash completo;
  - movimento com chave crescente ou data confiável (verificada na Fase A): só a faixa nova, mais uma
    margem de reabertura, com hash completo periódico;
  - tabelas grandes: hash por bloco de chaves, descendo à linha só nos blocos que mudaram.

**Valores** (códigos e cadastros livres do SPDATA → catálogos oficiais e cadastros novos):

- **Com chave oficial** (TUSS, SIGTAP, CID, CBO, IBGE): casamento direto.
- **Sem chave oficial:**
  - o conector **sugere** o par por similaridade vetorial e uma pessoa **aprova**;
  - o par aprovado vira linha fixa do de-para.
- **Limite da vetorização:** só colunas de cadastro e de domínio. **Texto clínico e identificação de
  paciente nunca são vetorizados.**

#### 3.3 Como grava

- **Estado como está.** O conector grava o estado do SPDATA, inclusive os valores derivados (saldo de
  estoque por lote e validade, custo médio, totais de conta, situação). Grava direto nas tabelas, **sem
  passar pelas operações do domínio**, que não recalculam nada na carga.
- **Domínio só verifica.** As regras de domínio rodam como **verificação de invariantes**, sem gravar.
  Só bloqueiam o que impediria operar dali em diante (por exemplo, conta aberta sem paciente). O resto
  entra marcado como histórico migrado.
- **Estado em andamento.** Registros abertos (internados, contas abertas, prescrições vigentes, lotes
  TISS enviados) entram com `origem = migracao`. O domínio aceita esse estado inicial sem exigir o evento
  de abertura.
- **Prontuário migrado:**
  - documento assinado entra **em bytes originais**, com assinatura, cadeia e carimbo, e com hash
    conferido;
  - é exibido como documento do sistema anterior, sem ser reassinado nem re-renderizado;
  - profissional, conselho, data e hora originais são preservados, e a trilha registra
    `origem = migracao`;
  - no prontuário, o diferencial **nunca sobrescreve**: alteração vira nova versão e exclusão vira marca.
- **Usuários são a primeira entidade do mapa.**
  - Cada login do SPDATA vira um usuário próprio, inativo se não existir mais.
  - Toda coluna `USUARIO*` é resolvida para esse id, o que mantém a autoria histórica.
  - Senhas não migram.
- **Documentos e anexos** (BLOBs, CPDIGITAL, arquivos por caminho):
  - vão para o armazenamento de objetos com hash do conteúdo;
  - a diferença é detectada por hash;
  - a conciliação confere quantidade e bytes por tipo.

#### 3.4 Rastreio, pendências e travas

- **`conector_origem`:**
  - campos: sistema, estabelecimento, tabela, chave original, entidade de destino, id de destino, hash,
    última imagem em que a linha foi vista;
  - **N destinos por origem**, porque uma linha do SPDATA pode virar várias entidades;
  - fica numa **base de controle** separada do banco de produção.
- **Hash** calculado sobre os **bytes de origem**, antes da conversão de CP1252 para utf8mb4, com ordem de
  colunas fixa. Mudança de versão do mapa reprocessa as linhas afetadas de forma explícita, e não pelo
  diferencial.
- **Paciente presente em `pc` e em `hs`:** é unificado pelo vínculo do índice da Rede, quando houver. Os
  demais pares prováveis vão para pendência e **nunca são unidos automaticamente**.
- **Fila de pendências:**
  - **Conteúdo:** guarda tabela, chave original e regra violada, **sem valores de paciente**.
  - **Propagação:** os dependentes de uma linha pendente também ficam pendentes, com o motivo "pai
    pendente", e são reprocessados a cada execução.
  - **Pendência crítica:** é definida por entidade (paciente internado, conta aberta, saldo de estoque,
    alergia, prescrição vigente).
- **Trava contra exclusão em massa.** Se uma tabela perde mais de N% das linhas, ou mais de M linhas, de
  uma imagem para a seguinte, a execução **para antes de gravar** e pede confirmação humana. Isso protege
  contra imagem truncada ou restauração incompleta.
  - A exclusão é lógica.
  - A linha que reaparece com a mesma chave e os campos imutáveis iguais é reativada.
- Cada execução registra a **versão do schema e a versão do mapa**.

#### 3.5 Fase A: carga completa e homologação (o hospital continua no SPDATA)

1. O conector carrega as imagens num **MariaDB de homologação descartável**, refeito do zero quantas vezes
   for preciso. Mudança de schema obriga nova carga completa.
2. **Neutralização a cada carga:**
   - SMTP aponta para captura local;
   - WhatsApp e SMS ficam desligados;
   - TISS e laboratório apontam para destinos falsos;
   - o container fica sem rede de saída;
   - o envio para fora só funciona com a chave de ambiente de produção, ligada na virada;
   - o relatório de cada rodada confere **zero saídas externas**.
3. **Armazenamento de objetos da homologação:** bucket próprio, **sem Object Lock COMPLIANCE**, apagado
   junto com o banco. O lock de 20 anos vale só para o bucket de produção.
4. A equipe do hospital testa com os próprios dados e aprova por setor.
5. **Conciliação por entidade** a cada rodada, com contagens, somas de controle (contas, saldos) e
   pendências.
6. **Antes da Fase B:**
   - usuários e perfis migrados, com o mapeamento de perfis aprovado por setor;
   - **pelo menos dois ensaios gerais da virada, cronometrados**, que medem cada etapa e fixam a
     duração da janela.

#### 3.6 Fase B: operação de produção (dia 0, dia 1, dia 2+n)

**Dia 0: cópia e carga.**

1. **Cópia sem parar a produção:** `nbackup -L` ou `gbak` online, de todas as origens (`pc`, acervo
   externo).
2. **Carga completa pelo conector num MariaDB de produção vazio.** Nada da homologação vai para a
   produção.
3. **Sistema novo aberto só para consulta.** Só o conector escreve nele.
4. **Congelamento:** a partir daqui, o schema e o mapa ficam congelados até a virada.

**Dia 1 até 1+n: a equipe avalia os dados.**

1. **Avaliação.** Os responsáveis de cada setor conferem os dados no sistema novo, em modo consulta, com
   o relatório de conciliação por entidade ao lado.
2. **O hospital continua operando no SPDATA.** **n** é o tempo que a equipe levar para aprovar a qualidade
   dos dados. Não tem prazo fixo.
3. **Correções** viram regra do mapa, linha de de-para ou correção registrada no conector, reaplicada a
   cada execução. Nunca edição manual no destino. Correção de mapa aprovada nesse período reprocessa as
   linhas afetadas de forma explícita.
4. **Diferenciais diários (recomendado).** O sincronismo diferencial roda **todo dia**, sobre uma cópia
   nova. Isso mantém o banco novo perto do atual, encurta o diferencial final e testa o mecanismo antes
   da hora. A detecção não depende de gatilho nem de coluna de data no SPDATA, porque o legado não é
   alterado.
5. **Valor livre sem de-para aprovado** entra ligado a um item "a classificar" do mesmo tipo. A pendência
   não é crítica e é resolvida depois.
6. **Recomendação:** congelar a criação de cadastros no SPDATA nos últimos dias.

**Dia 2+n: virada.** A equipe aprovou os dados; seguem os passos de 3.7.

#### 3.7 Janela de virada (dia 2+n)

1. **Contingência:** o hospital passa para contingência em papel, com formulários definidos.
2. **SPDATA parado e cópia a frio final** das origens. No Firebird, "somente leitura" exige acesso
   exclusivo, o que na prática é parar o banco.
3. **Sincronismo diferencial final e conciliação final.** O diferencial cobre o que mudou desde o último
   diferencial (ou desde o dia 0, se não houve diferenciais diários). A conciliação final tem de sair com
   zero pendência crítica.
4. **Numeração:**
   - ler da imagem final os generators e o maior valor de cada número de negócio;
   - iniciar as sequências do sistema novo em máximo+1, por estabelecimento, ou na faixa combinada com a
     prefeitura (NFS-e) e com as operadoras;
   - conferência automática: nenhum número emitido no sistema novo existe na origem.
5. **Integrações,** pelo inventário de saídas e entradas:
   - para cada uma, quem desliga no SPDATA, quem liga no sistema novo e em que ordem;
   - lotes TISS pendentes seguem acompanhados até fechar, ou migram com o seu status;
   - pedidos de laboratório abertos são reenviados ou casados por número;
   - repontar a `sante-api` da Hal-AI é um item do roteiro.
6. **Aceite e liberação:**
   - aceite dos responsáveis de cada setor;
   - **gravação liberada:** a produção passa para o sistema novo;
   - redigitação do que foi feito em papel, conferida na conciliação.
7. **Horário-limite (hora H),** medido nos ensaios: se a conciliação não fechar até lá, a virada é
   abortada e o SPDATA volta a operar.

#### 3.8 Retorno

- **Gatilhos de retorno definidos antes:** indisponibilidade acima de X horas, erro em prescrição ou
  dispensação, faturamento travado.
- **Se houver retorno:**
  - sai um relatório automático do que foi lançado no sistema novo desde a virada, por setor, para
    redigitação no SPDATA, porque não há conector reverso;
  - as numerações emitidas no sistema novo ficam reservadas.
- **Fim da opção de retorno.** O retorno **deixa de ser opção depois da primeira emissão fiscal ou do
  primeiro lote TISS**, salvo decisão expressa do hospital.

### 4. Dados reais e LGPD

**Antes da primeira carga com dados reais** (a Fase A não começa sem estes quatro itens):

1. contrato de tratamento de dados entre o hospital (**controlador**) e a equipe do sistema
   (**operadora**);
2. **RIPD** aprovado pelo encarregado (DPO) do hospital;
3. lista nominal de quem acessa a homologação, as pendências e o de-para;
4. registro de acesso por pessoa.

**Durante as Fases A e B:**

- Ambientes só em loopback ou rede interna.
- Pendências, de-para e logs do conector **vivem só dentro do ambiente controlado**:
  - logs não trazem conteúdo de linha;
  - o que sai do ambiente traz só contagens e somas.
- **Modelo de vetorização local.** Se um dia for externo, exige:
  - contrato com o hospital;
  - processamento no Brasil ou base do art. 33 da LGPD;
  - cláusula de não retenção e não treino.

  Os vetores seguem a retenção do dado de origem.

**Retenção:**

- **Imagens intermediárias e homologação:** cifradas em repouso, mantidas só as duas últimas e
  destruídas, com registro, até N dias depois do fim do prazo de retorno.
- **Imagem final da virada** (com hash) e acervo externo: arquivados como **guarda legal do prontuário
  por 20 anos** (Lei 13.787/2018, Res. CFM 1.821/2007), cifrados, em somente leitura, com procedimento de
  consulta para auditoria. O que a matriz marca como "descartar" é descarte de migração, não de guarda.
- **Contrato do SPDATA:** antes da virada, verificar o direito de manter e consultar essa cópia depois do
  fim da licença.

## Alternativas

- **Coexistência no mesmo Firebird, como o `new-sgh`:** serve à Rede Santé, mas não a um hospital que
  começa do zero, e prende o modelo ao SPDATA. Fica para o `new-sgh`.
- **Modo "próprio" dentro do `new-sgh`, com uma aplicação só para os dois bancos:** cada correção valeria
  nos dois. Mas obrigaria o `new-sgh` a carregar o banco novo e a mudar as regras dele (ADR 0003 de lá).
  Recusado pelo dono: o modelo base vem para cá, e a sincronia é pelo relatório mensal.
- **Copiar o modelo do MV:** risco de propriedade intelectual e de confidencialidade da proposta
  comercial. Recusado: o MV é só lista de conferência funcional.
- **Carga passando pelas operações do domínio:** recalcularia saldos e totais, que divergiriam do SPDATA,
  e o histórico aceito pelo legado viraria pendência em massa. Recusado (item 3.3).
- **Virada sem homologação com dados reais nem ensaio geral:** risco alto ao hospital. Recusado.
- **CDC no banco de produção (gatilho ou log):** exigiria alterar o legado ou pesar sobre a produção.
  Recusado: o conector lê imagens.
- **Sincronismo bidirecional:** conflitos e dupla verdade. Recusado: a direção é só SPDATA → MariaDB, e a
  virada é um momento único.
- **PostgreSQL:** tem RLS, e o plano antigo do `new-sgh` era nele. Ficou o MariaDB, pela busca vetorial
  nativa na edição comunitária e por decisão do dono. Sem RLS, o isolamento padrão é um banco por
  hospital.

## Consequências

- Esta pasta tem regras próprias. As regras de obra do `new-sgh` não se aplicam aqui.
- **O maior trabalho de código** é extrair o núcleo do `packages/legado` e levar as regras do PSQL do
  SPDATA para o domínio, módulo a módulo, com contrato de efeito.
- **O conector é um produto em si:**
  - mapa versionado;
  - travas;
  - pendências;
  - conciliação;
  - ensaios;
  - execução repetível e idempotente.

  Ele serve à Rede Santé e a qualquer hospital que venha do SPDATA. Um conector para outro sistema de
  origem troca só a leitura e o mapa.
- **O tempo de cada diferencial** precisa caber entre duas imagens, e o da janela, na meta fixada pelos
  ensaios. Os dois são medidos na Fase A e definem a frequência das imagens na Fase B.
- **O retorno é curto, caro e acaba no primeiro ato externo irreversível.** Por isso a conciliação e os
  ensaios são obrigatórios.

## Pendências

- **"Vetorização de-para":** este ADR entende que é sugestão de pares por similaridade vetorial, com
  aprovação humana. Confirmar com o dono.
- **Isolamento entre hospitais:** banco por hospital (recomendado) ou coluna de estabelecimento.
  **Decidir antes da primeira migração.**
- **Inventários da Fase A:**
  - origens externas do SPDATA (CPDIGITAL/CDDIGITAL, GED, arquivos);
  - integrações de entrada e saída;
  - gatilhos e procedures por módulo, com o que o sistema novo reproduz.
- **Cópias na Fase B:** forma de obtenção (nbackup ou gbak online) e hora da cópia diária. Depende do
  hospital.
- **Valores a fixar na Fase A:**
  - N e M da trava de exclusão;
  - X horas do gatilho de retorno;
  - duração-alvo da janela e hora H;
  - lista de pendências críticas;
  - prazo de destruição das imagens.
- **Licenças** de Brasíndice, Simpro, CBHPM e da base de CEP para a Rede Santé no sistema novo:
  pré-requisito da Fase A para faturamento.
- **Dump do MV:**
  - registrar a origem e a autorização de posse;
  - manter só o metadado, apagando os dados do volume Oracle ou reimportando com
    `CONTENT=METADATA_ONLY`.
- **Primeira entrega:** extração do núcleo e um fluxo vertical (cadastro de paciente → atendimento) no
  modo "próprio", com a mesma bateria de testes passando em memória e no MariaDB.

## Fontes

- Avaliação do `new-sgh` (2026-11-20): cinco leituras (ADRs, legado, API, domínios, testes) e parecer.
  Revisão deste ADR (2026-11-20): três lentes, 43 achados.
- `new-sgh/docs/adr/0003`, `0004`, `0005`, `0007`, `0011`, `0015`, `0024`, `0029`, `0033`;
  `new-sgh/planejamento/referencias/matriz-cobertura-1503-tabelas.tsv`.
- `banco-dev/README.md`: cópia a frio, nbackup no `fb-pc2`, restauração e neutralização do Firebird.
- `sante-sgh/README.md`: banco Oracle do dump TSTMV, usado só como lista de conferência.
- Lei 13.709/2018 (LGPD), arts. 6º, 11, 16, 33, 38 e 48; Lei 13.787/2018; Res. CFM 1.821/2007.
