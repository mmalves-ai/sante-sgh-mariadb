# F2.4: sementes do comando "criar novo cliente"

## O que mudou
- **`db/sementes/*.json`** (novo): 9 arquivos por área, **23 tabelas e 163 linhas** de vocabulário de domínio. Cada
  arquivo segue o formato `{"tabela": [linha, ...]}`, com a chave natural `codigo`.
- **`tools/db/carregar_sementes.py`** (novo):
  - inclui só o que falta (`INSERT ... ON DUPLICATE KEY UPDATE id = id`), numa transação;
  - confere antes as tabelas e colunas contra o banco;
  - devolve as contagens;
  - com `--conferir`, só lista o que falta, sem gravar.
- **`tools/db/criar_cliente.py`:**
  - carrega as sementes depois do catálogo de ações;
  - se a carga falhar, recusa com `sementes-falharam` e apaga o banco;
  - grava `sementes` no evento `criado` e na resposta.
- **`tools/db/sementes_teste.py`** (novo), em duas partes:
  1. **Cobertura sem banco.** Os códigos fixos saem do próprio código-fonte: `CORES_RISCO`, `URGENCIAS_TRANSFUSAO`,
     `TIPOS_REACAO_TRANSFUSIONAL`, `EVENTOS_SENHA` com `ACAO_DO_EVENTO`, `CODIGO_DO_GRUPO`, `PARAMETRO_DO_SINAL`,
     os literais da enfermagem e os CHECK do DDL. Todos têm de estar nas sementes.
  2. **Banco.**
     - Cria o cliente `f24_sementes` num banco de plataforma de teste próprio (`plataforma_teste_f24_sementes`).
     - Confere as contagens.
     - Recarrega duas vezes: inclui só a linha apagada e depois nada.
     - Confere que a edição e a inativação feitas pelo cliente continuam iguais.
     - Apaga o cliente e a plataforma de teste.
  - Medição: `ok (23 tabelas, 163 sementes)` em cerca de 4 minutos, quase tudo nas migrações.

## O que já era semeado antes
- `acao_sistema`, pelo `carregar_acoes.py`, a partir dos contratos.
- `tipo_documento_arquivo`, por `INSERT` na migração `09_HOT/06_chaves.sql`.
- Estabelecimento, perfis e usuários, pelo `semear-acesso.ts`, que é outro passo.

## O que passa a ser semeado (código que o produto consulta fixo e cadastro básico de pessoa)

| Área | Tabelas (linhas) |
|---|---|
| Acesso | tipo_escopo_acesso (2: setor e bloco de internação) |
| Cadastro | sexo (3), estado_civil (7), tipo_documento_identificacao (11), tipo_telefone (4), tipo_endereco (4), tipo_parentesco (18) |
| Recepção | acao_fluxo_senha (8), grupo_prioridade_legal (9) |
| Agenda | situacao_marcacao (8, uma por significado) |
| Assistência | nivel_prioridade (5 cores), parametro_vital (13), motivo_reclassificacao (5), situacao_checagem (8) |
| Internação | situacao_pedido_leito (7, uma por estado), motivo_saida_hospitalar (8) |
| Hemoterapia | tipo_transfusao (4), tipo_reacao_transfusional (18), motivo_cancelamento_requisicao_transfusao (5), hemocomponente (4) |
| Financeiro | tipo_documento_financeiro (5) |
| Operadora | motivo_ajuste_fatura (3), motivo_cancelamento_guia_plano (4) |

Essas tabelas cobrem as recusas "não cadastrado" ligadas a vocabulário:
- `nivel-nao-cadastrado`, `parametro-vital-nao-cadastrado`, `motivo-nao-cadastrado` (reclassificação e transfusão);
- `acao-fluxo-nao-cadastrada`, `grupo-prioridade-nao-cadastrado`, `situacao-marcacao-nao-cadastrada`;
- `tipo-transfusao-nao-cadastrado`, `tipo-reacao-nao-cadastrado`, `hemocomponente-nao-cadastrado`;
- `motivo-cancelamento-ausente`, além das buscas fixas: motivo de ajuste "cancelamento", documento "fatura", escopo
  "setor" e "bloco_internacao", checagem "administrado" e pedido de leito "internado".

## O que fica de fora (para o dono ver)
- **Fica de fora, de propósito, o cadastro que é do hospital e não tem código fixo no produto.** São 670 tabelas de
  domínio no CRUD genérico (`config/dominios-tabelas.ts`). O código usa 122 delas sem semente, e a escolha vem do usuário,
  por id. O cliente cadastra as dele, ou o conector importa.
  - Se a tabela estiver vazia, a recusa explica o que falta. Ela nunca vira vazio.
- **Faltam decisões em 18 tabelas que o código filtra por atributo fixo, sem buscar um código.**
  - As tabelas: categoria_acomodacao (`terapia_intensiva`), categoria_agenda, categoria_atendimento,
    forma_recebimento, grupo_balanco_hidrico, modalidade_dieta, modalidade_imagem, motivo_glosa,
    motivo_movimento_cadastral, motivo_troca_leito, natureza_financeira, tipo_barreira_alta, tipo_certificado,
    tipo_documento_qualidade, tipo_evento_esocial, tipo_marcacao, tipo_prestador_rede e via_dieta.
  - Sem cadastro, a tela só vem sem opções, sem recusa. São vocabulários do hospital (plano de contas, dietas,
    acomodações) e não foram semeados.
  - Se o dono quiser um "kit inicial" delas, é um arquivo a mais em `db/sementes/`.
- **Catálogos oficiais e licenciados não entram aqui.** Os oficiais vêm por `catalogos/carregar.py`, e os
  licenciados entram só por hospital com licença. Por isso `carater_atendimento_tiss` (catálogo TISS) não foi semeado.

## Decisões pela melhor prática
- **A semente nunca sobrescreve.** O que existe com o mesmo código fica como está, seja edição, inativação ou importação
  do conector. A recarga só repõe o que falta, e repõe também o que o cliente apagou.
  - O conector deve gravar por `codigo`, com upsert, para não bater nas sementes.
- **Os códigos seguem os contratos e os mapas da API** (`codigoDoBanco` em snake_case para transfusão e reação). O
  teste extrai esses códigos do código-fonte, para não divergir.
- **Hemocomponentes** CH, CP, PFC e CRIO vão com validade e temperatura de conservação padrão e `faturavel = FALSE`.
  O CHECK exige o item faturável, que é do cadastro do hospital, e o hospital liga depois.
- **Faixas e alertas clínicos ficam vazios.** `parametro_vital` sai sem faixa de alerta, só com os limites de digitação
  (por exemplo, dor de 0 a 10 e Glasgow de 3 a 15). Os alertas são decisão clínica do hospital.
- **`codigo_tiss`, `codigo_sus` e outros códigos de interoperabilidade ficam nulos.** Eles vêm das tabelas oficiais,
  não das sementes.
- **Grupos de prioridade levam a base legal** (Leis 10.048/2000, 10.741/2003, 13.146/2015, 13.466/2017 e
  12.764/2012). O idoso com 80 anos ou mais tem peso 1, que chama antes; os demais têm peso 2.

## Pedidos (fora de tools/db e db/sementes)
1. **Unificar o código da glicemia capilar.**
   - A classificação de risco usa `glicemia_capilar` (`recepcao/classificacao-operacoes.ts`, `PARAMETRO_DO_SINAL`), e a
     enfermagem usa `glicemia` (`enfermagem/operacoes.ts:275`).
   - Por ora, os dois códigos foram semeados. Quando os lotes de recepção e enfermagem unificarem, sai o duplicado.
2. **Ligar `tools/db/sementes_teste.py` à esteira.**
   - A parte `--sem-banco` leva cerca de 1 s e é a candidata.
   - A parte de banco leva cerca de 4 minutos.
