# F2.4, 3ª etapa, 4ª leva: DDL e sementes aplicados (pedidos dos lotes das portas, `p-*.json`)

Pedidos de tipo `ddl`, `semente`, `sementes`, `carga` e `dado` lidos em `docs/obra/fatias/f24/saida/p-*.json`, sem os
que têm `substituido_por`. Migrações só para frente, no padrão do ADR 0002: PK `id`, auditoria, FK
`ON DELETE RESTRICT`, `CHECK` em vez de `ENUM` e nenhum gatilho.

- **Arquivos novos:** `db/migracoes/<módulo>/23_tabelas.sql` (03_CAD, 06_PEP, 07_INT, 09_HOT, 11_SUP, 12_FAT, 15_RH,
  16_SGO, 17_INTG, 18_QUA) e `23_chaves.sql` (os mesmos, exceto 15_RH e 16_SGO, que não têm FK nova). As 8 tabelas
  novas entraram em `docs/analise/rodada2/final/catalogo.tsv`.
- **Número 23:** não colide com a trilha F4, que usa os números 40 em diante, além de 05, 06, 12, 13 e 14
  (`git diff main...f4-conector`). Nenhuma coluna da F4 foi duplicada. O pedido de `pedido_compra` ficou com ela (ver
  "Não aplicado").
- **Dados existentes:** as tabelas com coluna `NOT NULL` nova sem DEFAULT, CHECK mais restrito ou UNIQUE trocado
  estavam vazias nos 57 clientes de dev e teste. São elas: `isolamento_paciente`, `inventario_estoque_item`,
  `verificacao_bundle`, `comissao_membro`, `protocolo_quimioterapia_droga`, `cadastro_empregador`,
  `documento_qualidade_ciencia` e `exame_oftalmologico`.

## DDL aplicado

| Tabela | Mudança | Pedido |
|---|---|---|
| profilaxia_tev_decisao | CHECK da decisão aceita `anulada`. A retificação continua exigindo justificativa | p-enfermagem |
| plano_refeicao_acompanhante_evento (nova) | Histórico (alterado ou cancelado, antes e depois em JSON, motivo, usuário), como o do preparo do lactário | p-especialidades-nutricao |
| exame_oftalmologico_item (nova) | Item do exame consolidado: tipo de exame, olho e resultado de até 500 caracteres. UNIQUE (exame, sequência) | idem |
| exame_oftalmologico | `alertas` (JSON validado). `tipo_exame_oftalmologico_id` passa a anulável: nulo no exame consolidado, cujos tipos estão nos itens | idem |
| exame_oftalmologico_valor | `acuidade_visual_id` (FK `acuidade_visual`) | idem |
| protocolo_quimioterapia_droga | `nome_generico`, `unidade_dose` (mg/m2, mg/kg, auc, mg) e `administracao`. Item prescritível e unidade de prescrição passam a anuláveis. CHECK: item ou nome genérico; com item, a unidade é obrigatória | idem |
| documento_estoque | O tipo aceita `balanco` | p-estoque |
| documento_estoque_item | `origem_documento_estoque_item_id` (FK para o próprio item) | idem |
| local_estoque_usuario | `pode_autorizar_requisicao` BOOLEAN NOT NULL DEFAULT FALSE | idem |
| inventario_estoque_item | `lote_insumo_id` (FK) e `lote_chave`, gerada com 0 para o item sem lote. O UNIQUE passa a ser (contagem, insumo, lote_chave) | idem |
| lote_folha_intercambio | COMMENT de `soma` com a unidade pelo sentido | p-folha |
| queixa_tecnica_produto | `natureza` (queixa_tecnica, evento_adverso, alerta_sanitario; DEFAULT queixa_tecnica) e `alerta_sanitario_id` (FK). CHECK: a de alerta sanitário exige o alerta | p-manutencao-sus |
| carga_tabela_preco_linha | `nome_item`, mais os componentes `valor_custo_operacional`, `valor_filme`, `valor_anestesista` e `valor_outros`. Também os cinco vigentes antes da carga (`anterior_*`), em colunas e não em JSON. O `valor` é o CH (comentário) | p-operadora-portal-precos |
| carga_tabela_preco | `arquivo_nome`, `arquivo_bytes`, `catalogo` e `lote_reajuste_id` (FK) | idem |
| fonte_pagadora | `nota_fiscal_pessoa_juridica_id` (FK `pessoa_juridica`) | idem |
| contato_fonte_pagadora (nova) | Contato por área (convênio, credenciamento, contas médicas, recurso de glosa, autorização), com nome, telefone e e-mail. UNIQUE (fonte, área) | idem |
| envio_ans | `numero_gru`, `valor_gru`, `gru_paga_em` e `valor_pago_gru`. CHECK: só na obrigação `tps`; pagamento com data e valor juntos | idem |
| cadastro_empregador | `indicador_cooperativa` e `construtora` anuláveis, sem DEFAULT (nulo = não informado) | p-pessoas-esocial |
| caso_infeccao | `implante` BOOLEAN NOT NULL DEFAULT FALSE, `exame_item_id` (FK) e `microrganismo_descricao` VARCHAR(80) | p-qualidade-ccih |
| isolamento_paciente | `motivo_precaucao` (CHECK com os 11 códigos), `motivo_outro` (exigido no `outro`), `origem_indicacao` (manual, microbiologia), `exame_item_id` (FK) e `multirresistente`. `motivo_encerramento` vira código | idem |
| decisao_antimicrobiano (nova) | Decisão da CCIH (comissão de controle de infecção hospitalar) por item prescrito (UNIQUE): liberado, liberado com ajuste ou não liberado. Dias autorizados obrigatórios quando libera; justificativa obrigatória fora do `liberado` | idem |
| revisao_decisao_antimicrobiano (nova) | Revisões d3 e d7, com UNIQUE (decisão, marco) e a conduta (6 códigos) | idem |
| configuracao_antimicrobiano_insumo (nova) | Por estabelecimento e insumo (UNIQUE): restrito, ATC (com CHECK do formato), DDD em gramas e gramas por unidade | idem |
| verificacao_bundle | `vigente_chave`, gerada como 1 enquanto não excluída. O UNIQUE (dispositivo, data, turno, vigente_chave) substitui o antigo | idem |
| consumo_preparacao_alcoolica | `pacientes_dia` anulável | idem |
| risco_institucional | `controles_descricao` TEXT | p-qualidade-gestao |
| nao_conformidade_qualidade | `cancelada_em`, `cancelada_por_usuario_id`, `motivo_cancelamento` e `duplicada_de_id` (FKs). A situação aceita `cancelada`. CHECK: cancelada ⇔ data, motivo e usuário | idem |
| documento_qualidade_versao | `resumo_sha256` (CHECK hex 64), `retirada_em`, `retirada_por_usuario_id` e `motivo_retirada` (os três juntos) | idem |
| documento_qualidade_ciencia | `colaborador_id` anulável. CHECK: colaborador ou usuário | idem |
| auditoria_interna | `auditores_descricao`, `cancelada_em` e `motivo_cancelamento`. CHECK: cancelada ⇔ data e motivo | idem |
| comissao_membro | `nome_externo` e `funcao`. CHECK da pessoa: colaborador, profissional ou nome externo | idem |
| reuniao_comissao | `ata_assinada_em` e `ata_assinada_por_usuario_id` (FK). CHECK: os dois juntos, e só com ata | idem |
| envio_regulatorio_qualidade (nova) | Tipo (`pm_qualiss`, `iras`, `notivisa`), competência, revisão, arquivo no armazenamento pela chave (ADR 0004), SHA-256, linhas, situação (gerado, transmitido, substituído), geração e transmissão. UNIQUE (estabelecimento, tipo, competência, revisão) | idem |
| protocolo_acesso_portal (nova) | Protocolo do atendimento para o portal de resultados: só o SHA-256 do código (UNIQUE), situação, tentativas, bloqueio, emissão e revogação | p-sadt |
| pedido_vinculo_profissional_externo, conta_portal_profissional_externo | `resumo_senha` e `segredo_segundo_fator_cifrado` | idem |
| orcamento_particular_item | `exame_id` (FK `exame`). Entra no CHECK do alvo | idem |

## Sementes (criar novo cliente: `db/sementes`, por `tools/db/carregar_sementes.py`)

- **`06_especialidades.json`:**
  - `tipo_barreira_alta`: `social`;
  - `acuidade_visual`: Snellen de 20/20 a 20/400 e 4 qualitativas;
  - `graduacao_oftalmologica`: OD, OE, AO, ESF, CIL, EIXO, ADD;
  - `via_de_uso`: iv, vo, sc, im, it (uso em quimioterapia).
- **`11_suprimentos.json`:**
  - `tipo_movimento_estoque` nativos (`sistema` = TRUE): `consumo_paciente` (consumo_paciente/saída),
    `devolucao_paciente` (devolução/entrada) e `perda` (perda/saída);
  - `motivo_devolucao_estoque`: `nao-administrado`, `suspenso`, `sobra`, `outro`. São os códigos do contrato
    `farmacia/entradas.ts`, que a porta procura como vêm.
- **`17_operadora_cobranca.json`:** `fase_cobranca_inadimplencia` com aviso, notificação, suspensão, rescisão e acordo.
- **`18_qualidade.json`:**
  - CCIH: `tipo_dispositivo_invasivo` (cvc, sonda_vesical, ventilacao_mecanica), `categoria_profissional` (medico,
    enfermeiro, tecnico_enfermagem, fisioterapeuta, outro), `tipo_precaucao` (contato, goticulas, aerossois) e
    `motivo_bloqueio_leito` (`isolamento`);
  - gestão: `categoria_risco_institucional` (as 7 do contrato), `canal_ouvidoria` (os 9 do contrato, em snake_case),
    `tipo_manifestacao_ouvidoria` (6), `motivo_encerramento_manifestacao` (5), `fator_contribuinte` (um por
    categoria, 7) e `categoria_auditoria_interna` (ona, rdc, interno, outro).
- **Carregador:** `carregar_sementes.py` ganhou a chave natural por tabela (`CHAVE`). A `graduacao_oftalmologica` usa
  `sigla`; as outras seguem com `codigo`.
- **Numerações da farmácia** (`dispensacao`, `documento_estoque`, `devolucao_dispensacao`): já estavam em
  `configurar_numeracoes.py`, sem mudança.
- **Massa sintética de teste** (`tipo_vinculo_trabalho` e `categoria_trabalhador`, pedido tipo `teste` de 03-pessoas e
  p-folha): `apps/api/src/modulos/pessoas/avaliacao/massa.spec-util.ts` já garante a linha sintética
  (`SINTETICO` + `primeiro`), sem mudança.

## Decisões pela melhor prática (para o dono ver)

1. **Antimicrobiano: tabelas novas, sem afrouxar o histórico.** Foram criadas `decisao_antimicrobiano` e
   `revisao_decisao_antimicrobiano`, e `liberacao_antimicrobiano` não foi afrouxada. Ela segue como o histórico da
   ficha completa.
2. **Componentes da carga de honorários em colunas, não em JSON.** São cinco e fixos, e assim dá para somar e
   conferir.
3. **Contagens da carga (novo, alterado, igual, removido): derivadas das linhas**, sem coluna redundante.
4. **Nota fiscal do convênio pela pessoa jurídica tomadora:** uma FK em vez de 9 colunas copiadas. O endereço da fonte
   pagadora já é o da pessoa jurídica dela, por isso não houve DDL de endereço.
5. **Referencial da auditoria: é a categoria.** `categoria_auditoria_interna` foi semeada com os códigos do contrato, e
   não entrou coluna `referencial`.
6. **Análise crítica do indicador: sem DDL.** A análise cria a apuração digitada (`apuracao_indicador` com
   `forma_insercao = 'digitacao'`, que já existe), com numerador, denominador e meta, e aponta para ela. Assim
   `apuracao_indicador_id` continua obrigatório.
7. **Soma do lote da folha:** a unidade ficou no COMMENT, sem trocar a coluna que a porta já grava. A alternativa era
   separar em `soma_valor` e `soma_minutos`.
8. **Credencial do médico externo em colunas próprias,** no pedido e na conta. A aprovação copia os dois. O segredo do
   segundo fator fica cifrado com a chave mestra do ambiente. A alternativa era o provedor de identidade
   (`credencial_usuario` pela conta), e a decisão final é do dono.
9. **Microrganismo da IRAS:**
   - o texto como informado fica em `caso_infeccao.microrganismo_descricao`;
   - o código do cadastro, quando resolvido, vai em `caso_infeccao_microrganismo`, que já existia.
10. **Exame oftalmológico consolidado:** o tipo do exame passa a anulável, e não foi criado um tipo de exame
    "avaliação". A alternativa exigiria semear também o grupo de exame.
11. **Unicidade com exclusão lógica:** coluna gerada (`vigente_chave` em `verificacao_bundle`, `lote_chave` no
    inventário), como `marco_experiencia_chave` na etapa anterior.

## Não aplicado (com motivo)

- **`pedido_compra` (fornecedor nulo em rascunho e em cotação), p-estoque:** a trilha F4 já faz exatamente isto
  (`ck_pedido_compra_fornecedor`, na branch `f4-conector`). Aplicar aqui duplicaria a constraint, e a migração da F4
  falharia na fusão. A porta deve esperar a fusão da F4.
- **Modelo `ANOTACAO_ENFERMAGEM` publicado, semente de p-enfermagem:**
  - a versão publicada exige `publicacao_usuario_id` (CHECK `ck_modelo_documento_versao_publicacao`), e o "criar
    novo cliente" não tem usuário na hora das sementes;
  - falta decidir entre um usuário técnico do sistema para publicar modelos padrão e o cadastro pelo painel do
    administrador;
  - até lá, a anotação offline recusa com `cadastro-incompleto` (nada gravado).
- **Catálogos oficiais do eSocial (tabela 8, classificação tributária) e do FPAS, pedido de p-pessoas-esocial:**
  - a regra 7 exige carregador versionado a partir da fonte oficial, e este ambiente não tem rede de saída;
  - não foram digitados de memória;
  - pedido: carregador em `catalogos/carregadores/` com o arquivo oficial baixado e versionado.

## Prova

- `python3 -I tools/db/validar_migracoes.py`:
  - 0 erros;
  - 3668 tabelas, 8 a mais que na etapa anterior;
  - 14022 FKs e nenhum gatilho.
- **Aplicação das migrações 23:**
  - 57 clientes de dev e teste (`teste_*`, `demo`, `f22_o*`, `f24_*` e `f24p_*`);
  - sem erro, e duas vezes (a segunda prova a idempotência);
  - os bancos da F4 (`cliente_cfl*`, `cliente_cfexemplo*` e `conector_ctl_*`) não foram tocados.
- **Paridade:** nas 37 tabelas criadas ou alteradas, colunas, tipos, nulidade, DEFAULT e CHECKs são idênticos nos 57
  clientes (963 colunas e 198 CHECKs).
- **Sementes nos 57 clientes:**
  - `cliente_f22_o2` e `cliente_f22_o3` já tinham, antes desta etapa, códigos de `sexo` (e de `hemocomponente` no o2)
    que colidem com outra chave única. O carregador avisa, e as demais sementes entram;
  - o `cliente_demo` não tinha nenhuma semente e recebeu as 253.
- `python3 -I tools/db/sementes_teste.py`: ok, com 40 tabelas e 253 sementes. A cobertura e o cliente novo pelo
  "criar novo cliente" mostram que a carga é idempotente e não sobrescreve o que o cliente editou.
