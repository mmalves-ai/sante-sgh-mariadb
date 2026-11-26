# ADR 0002: Decisões do dono e princípios do modelo de dados

## Status

aceito (2026-11-20). São as respostas do dono às 24 decisões pendentes e as convenções que todo o DDL segue.
Onde este ADR muda o ADR 0001, vale este.

## Parte 1. Decisões do dono (2026-11-20)

### Produto e plataforma

1. **Produto, não projeto de um cliente.**
   - Nada é engessado "só para a Rede Santé". A única exceção é a identidade visual (logotipos e cores),
     que muda por configuração.
   - A Rede Santé é **um cliente**, não o limitador do que o sistema tem.
2. **Todo recurso disponível.**
   - As fases F3, F7 e F8 passam a significar só **ordem de construção**. Não significam disponibilidade.
   - Nada é bloqueado por cliente.
   - **O administrador da plataforma pode tudo:** liga e desliga recurso, entra em qualquer cliente,
     opera a virada.
3. **Virada operacional.** Quem decide a virada é o cliente. O sistema oferece **as ferramentas**
   (conector, conciliação, diferencial, numeração, retorno), sem bloqueios automáticos. Isso **substitui**
   as travas "não libera sem…" do ADR 0001, que viram **alertas e relatórios**.
4. **Escopo:**
   - a **operadora de plano de saúde** entra no produto;
   - a **gestão pública** entra no produto: compras públicas, empenho, orçamento público e filantrópico
     SUS. A base é o que o `new-sgh` já tem, transportado e ligado às tabelas novas.
5. **Melhor prática, não o SPDATA.**
   - **Critério do modelo:** uso real mais as melhores práticas do mercado.
   - O SPDATA é referência de **dados**, nunca de **comportamento**. O hospital reclama que ele é
     incompleto e inconsistente, e o modelo não repete isso.
   - Onde o MV traz mais, segue-se o MV, sempre em palavras e estrutura próprias.
   - **Chaves e obrigatoriedades garantidas pelo banco:** PK, FK, NOT NULL, UNIQUE e CHECK. Exemplo:
     agenda e profissional ligados por chave, nunca por nome e CRM.
6. **Licenças e questões legais fora do escopo técnico.** Implementa-se tudo o que estiver disponível. As
   licenças (Brasíndice, Simpro, CBHPM) são providenciadas pelo dono. **A base de CEP é aberta e entra.**
7. **Somos o braço de TI.** Contrato de tratamento de dados, RIPD e direito de guarda do SPDATA são
   providenciados pelo dono. O SPDATA já dá o direito de guarda.

### Banco por cliente e criação de cliente

8. **Um banco por cliente, ou hospital.** Cada hospital e cada base são independentes.
9. **Comando "criar novo cliente"** na administração da plataforma:
   - cria o banco vazio;
   - aplica as migrações;
   - carrega os catálogos públicos;
   - associa o banco ao cliente.
10. **A Rede Santé é um caso especial:**
    - o banco é criado vazio pelo mesmo comando;
    - o **conector** importa e **limpa** os dados do SPDATA.
    - Limpar quer dizer corrigir no caminho o que o SPDATA tem de inconsistente: chaves, duplicatas,
      obrigatoriedades. O que não puder ser corrigido vira pendência.

### Conector e modelo

11. **Sem vetorização no de-para.** O dado do SPDATA é conhecido. O de-para é determinístico: tabelas e
    colunas adequadas no banco novo e nas telas existentes. A busca vetorial do MariaDB continua
    disponível para recursos do produto, mas não para o conector.
12. **Histórico:** registros excluídos e mudanças viram histórico de cada entidade (`<tabela>_historico`),
    com marca de exclusão. Não se copia nenhum padrão do SPDATA.
13. **Fusões aprovadas:**
    - capacidade de leito SUS com leito de UTI habilitado;
    - motivo de exclusão genérico com os motivos específicos de cancelamento.
14. **Prontuário:**
    - o conteúdo estruturado fica no banco, pesquisável e exibido no prontuário;
    - o documento renderizado e assinado vai como arquivo;
    - não repetir os erros do SPDATA; onde o MV traz mais, segue-se o MV.
15. **Nomes:** mantêm-se os 87 nomes comuns ou oficiais que coincidem com nomes do MV. Nome comum e padrão
    de mercado não têm dono.

### Dump do MV

16. O dump veio do setor técnico do ProntoCardio, que tem licença e acesso. Os dados são só exemplo.
    O dono autorizou apagar os dados; fica só o metadado.

## Parte 2. Princípios do modelo (convenções do DDL)

| Tema | Convenção |
|---|---|
| Motor | MariaDB 12.3 LTS, InnoDB, `utf8mb4`, collation `utf8mb4_uca1400_ai_ci` |
| Banco | Um por cliente. Dentro dele, `estabelecimento_id` nas tabelas operacionais, porque um cliente pode ter várias unidades |
| Nome de tabela | Português, `snake_case`, singular, sem prefixo de sistema. Item: `<pai>_item`. Histórico: `<tabela>_historico`. Vínculo: `<a>_<b>` |
| Chave primária | `id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY` em toda tabela |
| Chave estrangeira | Coluna `<tabela>_id`, ou `<papel>_<tabela>_id` quando há mais de uma (ex.: `solicitante_profissional_id`). Sempre declarada, `ON DELETE RESTRICT`. Nome `fk_<tabela>_<coluna>` |
| Número de negócio | Coluna própria (`numero`, `numero_prontuario`, `numero_guia`…), `UNIQUE` por estabelecimento. Gerado pelo mecanismo `sequencia_negocio`. Nunca é o `id` |
| Código externo | Código oficial (TUSS, CID, CBO, IBGE, CNES) em coluna `codigo_<padrao>`, com `UNIQUE` no catálogo |
| Texto | `VARCHAR(n)` com tamanho de negócio (nome 150, e-mail 254, telefone 20, CPF `CHAR(11)`, CNPJ `CHAR(14)`, CEP `CHAR(8)`). `TEXT` só para texto livre longo |
| Dinheiro | `DECIMAL(15,2)` |
| Quantidade | `DECIMAL(15,4)` |
| Percentual | `DECIMAL(7,4)` |
| Data | `DATE` |
| Data e hora | `DATETIME(3)`, sempre em UTC; a aplicação converte pelo fuso do estabelecimento |
| Booleano | `BOOLEAN NOT NULL DEFAULT FALSE`. Nome no afirmativo: `ativo`, `exige_autorizacao` |
| Situação fixa do sistema | `VARCHAR(30)` com `CHECK (situacao IN (...))`. Sem `ENUM` |
| Lista mantida pelo hospital | Tabela de domínio com `id`, `codigo VARCHAR(30) UNIQUE`, `descricao VARCHAR(150)`, `ativo` |
| Auditoria em toda tabela | `criado_em DATETIME(3) NOT NULL`, `criado_por BIGINT UNSIGNED NULL`, `alterado_em DATETIME(3) NULL`, `alterado_por BIGINT UNSIGNED NULL`, `versao INT UNSIGNED NOT NULL DEFAULT 1` (trava otimista) |
| Exclusão lógica | `excluido_em DATETIME(3) NULL` e `excluido_por` em tabelas `principal`, `item` e `vinculo`. A exclusão física é proibida para dado clínico e financeiro |
| Origem da migração | `origem VARCHAR(20) NOT NULL DEFAULT 'sistema'` (`sistema`, `migracao`, `integracao`) em tabelas `principal` e `item`. O vínculo com o registro de origem fica fora do banco de produção (`conector_origem`, ADR 0001) |
| Histórico | Tabela `<tabela>_historico`: `id`, `<tabela>_id`, `operacao` (`inclusao`, `alteracao`, `exclusao`), `dados JSON`, `ocorrido_em`, `usuario_id` |
| Mecanismos comuns (módulo SIS) | `trilha_auditoria`, `parametro_definicao`, `parametro_valor`, `sequencia_negocio`, `arquivo`, `integracao_mensagem`, `pendencia` e `regra_alerta`, criados na migração do núcleo |
| Gatilho | **Nenhum** com regra de negócio |
| Índice | `ix_<tabela>_<colunas>`; único `uq_<tabela>_<colunas>`. Toda FK tem índice |
| Comentário | `COMMENT` em toda tabela (descrição própria do catálogo) e nas colunas cujo nome não basta |
| Migrações | `db/migracoes/<NN>_<modulo>/`: `tabelas.sql` (CREATE TABLE sem FK de outro módulo) e `chaves.sql` (FKs). O aplicador roda todos os `tabelas.sql` na ordem e depois todos os `chaves.sql`. Só para frente. Hoje o aplicador (`tools/db/criar_cliente.py`) **reaplica todos os arquivos a cada passada**: todo arquivo é idempotente e tem de valer **em qualquer ordem** em banco já existente. Exemplo: um CHECK recriado numa migração antiga precisa da mesma lista que a migração mais nova (`13_SUS/06` e `/94`, 26/11/2026). Quando o aplicador passar a gravar o hash em `migracao_aplicada` (lido pela conferência da implantação), vale a regra de **nunca alterar migração já aplicada**. A reescrita só entra **registrada** (motivo e hash novo), aceita pelo aplicador |

## Consequências

- **ADR 0001:**
  - o de-para de valores por similaridade vetorial (3.2) sai;
  - as "travas" e os "não sai sem" viram alertas e relatórios operados pelo cliente e pelo administrador
    da plataforma;
  - "banco por hospital" deixa de ser pendência.
- **Fases (`docs/fases/`):** F3, F7 e F8 são ordem de construção. A F7.2 ("instalação de hospital novo")
  vira o comando "criar novo cliente", feito cedo, porque é ele que cria o banco da própria Rede Santé.
- **Catálogo da rodada 2:** a "paridade estrutural" continua valendo para a ordem de construção, mas
  nenhuma tabela é cortada por fase. As 3.500 tabelas são construídas.
