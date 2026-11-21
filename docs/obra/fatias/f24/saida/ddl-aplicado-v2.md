# F2.4, 2ª volta: DDL aplicado

Pedidos de DDL lidos em `docs/obra/fatias/f24/saida/*.json`, ignorando os que têm `substituido_por`. Migrações só para
frente, no padrão do ADR 0002 (PK `id`, auditoria, FK `ON DELETE RESTRICT`, `CHECK` em vez de `ENUM`, sem gatilho).

- **Arquivos novos:** `db/migracoes/<módulo>/21_tabelas.sql` em 00_NUCLEO, 04_REC, 06_PEP, 07_INT, 08_CC, 09_HOT,
  11_SUP, 12_FAT, 15_RH, 16_SGO e 17_INTG, mais `21_chaves.sql` em 04_REC, 06_PEP, 07_INT, 08_CC, 09_HOT, 11_SUP,
  12_FAT e 15_RH. As 11 tabelas novas entraram em `docs/analise/rodada2/final/catalogo.tsv`.
- **Número 21:** não colide com a trilha F4 (`git diff main...f4-conector`), que usa até 06_PEP/17, 12_FAT/12 e
  16_SGO/12. A F4 mexe em `ato_cirurgico` e `ato_cirurgico_procedimento` só com `dados_origem`, e em
  `movimento_prontuario` só com os setores de trâmite. Não há coluna duplicada.
- **Prova:**
  - `python3 -I tools/db/validar_migracoes.py` dá 0 erros, com 3659 tabelas e 13972 FKs;
  - as migrações foram aplicadas, sem erro, aos 35 clientes registrados na plataforma (`teste_*`, `demo`, `f22_o*` e
    `f24_*`). Os bancos da F4 (`cliente_cfl8_*` e `conector_ctl_*`) não foram tocados;
  - nas 34 tabelas criadas ou alteradas, colunas, tipos, nulidade, CHECKs e FKs (1204 itens) são idênticos aos do
    banco de validação em todos os 35 clientes.
- **Dados existentes:** as tabelas que ganharam colunas `NOT NULL` sem DEFAULT (`titulo_folha`) ou CHECKs novos
  (licitação, `notificacao_agravo`) estavam vazias em todos os clientes. Os CHECKs alterados só aceitam mais valores.

## Aplicado nesta volta

| Tabela | Colunas / mudança | Pedido de origem | Arquivos que destrava (linhas de modelo-pendente) |
|---|---|---|---|
| arquivo | `versao_objeto` VARCHAR(100) | 20-misto-preco | api/assinatura/porta-propria.ts:165 |
| dispositivo_recepcao | `painel_tv_id` (FK painel_tv) + CHECK: só no tipo `paineltv` | 13-recepcao | api/recepcao/porta-propria.ts:89 |
| horario_administracao_evento | CHECK do evento aceita `infusao_retomada` e `infusao_troca_bolsa` | 11-enfermagem-1 | api/enfermagem/porta-propria.ts:20,214 |
| inclusao_protocolo_evento | CHECK do evento aceita `meta` e `checklist` | 11-enfermagem-1 | api/enfermagem/porta-propria.ts:20,214 |
| lesao_pele_avaliacao | `dados` JSON; tipo `foto` (exige anexo ou arquivo); `inativada`, `motivo_inativacao` | 11-enfermagem-1 | api/enfermagem/porta-propria.ts:20,214 |
| lesao_pele_paciente | `inativada`, `motivo_inativacao` (CHECK: inativar exige motivo) | 11-enfermagem-1 | idem |
| registro_assistencial_extensao (nova) | registro, componente (`sinal_vital`, `mapa_corporal`, `anexo`), chave, valor, `referencia_id`; UNIQUE (registro, componente, chave) | 11-enfermagem-1 | idem (gravarRespostaExt) |
| acionamento_resposta_rapida_evento (nova) | acionamento, tipo (`chegada`, `desfecho`), ocorrido_em, desfecho, `anterior_evento_id` (FK própria, UNIQUE), motivo, inativado | 11-enfermagem-1 | idem (retificarEventoTrr, inativarTrr) |
| notificacao_agravo | `origem_gatilho`, `chave_gatilho` (UNIQUE por estabelecimento), `exame_id`, `periodicidade`, `gatilho_em`, `autoridade`, `canal`, `notificada_em`, `recebido_por`, `observacao_notificacao`, `motivo_descarte`, `justificativa_descarte`, `encerrado_em`, `encerrado_por_usuario_id`; `notificante_profissional_id` passa a nulo; CHECKs de descarte e de notificada | 15-qualidade | api/qualidade/porta-agravo-propria.ts:4,5,26 e porta-propria.ts:28,31,726 |
| gatilho_exame_agravo (nova) | estabelecimento, padrão, exceto, CID-10 (Classificação Internacional de Doenças), ativo; UNIQUE entre os não excluídos | 15-qualidade | idem |
| atributo_categoria_acomodacao (nova) | estabelecimento, categoria, sexo, criticidade, faixa etária em dias, andar, ramal, terapia intensiva; UNIQUE (estabelecimento, categoria) | 16-misto-financeiro | api/adt/porta-propria.ts:1173 (gravarAtributo e limparAtributos do tipo) |
| ocorrencia_arquivo_prontuario (nova) | estabelecimento, atendimento, movimento (nulo), tipo, motivo, protocolo, prazo de devolução, aval da comissão, registrado_em, usuário | 16-misto-financeiro | api/adt/porta-propria.ts:1173 (gravarSameExt) |
| ato_cirurgico | `classificacao_asa_id` (classificação ASA do estado físico, FK), `pressao_sistolica`, `pressao_diastolica`, `frequencia_cardiaca` (CHECKs de faixa) | 08-cirurgia | api/cirurgia/operacoes.ts:75 e porta-propria.ts:143,156 (registrarCirurgia) |
| ato_cirurgico_dispositivo (nova) | ato, dispositivo (`tubo`, `antimicrobiano`, `sonda`, `cateter`, `puncao`), descrição; UNIQUE (ato, dispositivo) | 08-cirurgia | idem |
| ato_cirurgico_procedimento | `especialidade_medica_id` (FK) | 08-cirurgia | idem |
| evento_processo_licitatorio | tipos `parecer`, `publicacao`, `esclarecimento`, `ata`, `pedido`; `resultado`, `veiculo_publicacao`, `empresa_fornecedora_id`, `pedido_compra_id` (UNIQUE por processo), `arquivo_id`; CHECKs por tipo | 10-suprimentos | api/suprimentos/porta-propria.ts:20,884 e operacoes.ts:64,89 (licitação) |
| processo_licitatorio | `metodo_estimativa`, `julgado_em`, `julgado_por_usuario_id`, `homologado_em`, `homologado_por_usuario_id`; CHECKs da homologação e do julgamento | 10-suprimentos | idem |
| processo_licitatorio_item | `valor_unitario_adjudicado` | 10-suprimentos | idem |
| pesquisa_preco_item | `motivo_desconsideracao` VARCHAR(1000); `desconsiderado_em`, `desconsiderado_por_usuario_id`; CHECK do descarte | 10-suprimentos | idem |
| proposta_licitacao_item | `nota_tecnica` (0 a 100) | 10-suprimentos | idem |
| carga_tabela_preco (nova) | estabelecimento, tabela de preço, fonte, arquivo e SHA-256, situação, vigência, totais, motivo, publicação | 23-misto-coexistencia | api/precos/fonte-propria.ts:976 (gravarCarga, mudarSituacaoCarga) |
| carga_tabela_preco_linha (nova) | carga, sequência, código, `item_faturavel_id` (nulo até casar), valor, situação, divergência | 23-misto-coexistencia | idem |
| ajuste_ponto | `data_referencia` (só na justificativa) | 02-pessoas-2 (prioridade baixa) | api/pessoas: nenhuma recusa; só clareza do modelo |
| rubrica | `papel_resumo_folha` (CHECK) | 01-pessoas-1 (f22 03-07) | api/pessoas/folha/servico-integracao.ts:74,78,159 (retorno) |
| lote_folha_externa_item | `vencimento` | 01-pessoas-1 (f22 03-07) | idem |
| integracao_folha_financeiro (nova) | estabelecimento, vigência; UNIQUE entre os não excluídos | 01-pessoas-1 (f22 03-07) | api/pessoas/folha/porta-integracao-propria.ts:5,74,101 e servico-integracao.ts:74,78,159 |
| integracao_folha_financeiro_destino (nova) | destino (valores do `titulo_folha`), credor (`empresa_fornecedora_id`), `natureza_financeira_id`, dia e mês do vencimento; UNIQUE (integração, destino) | 01-pessoas-1 (f22 03-07) | idem |
| lancamento_titulos_folha (nova) | estabelecimento, competência, `origem_lancamento` (`fechamento`, `interface`) e `origem_id`, apuração, resumo, totais, lançado em e por; UNIQUE (estabelecimento, origem_lancamento, origem_id) | 01-pessoas-1 (f22 03-07) | idem |
| titulo_folha | `lancamento_titulos_folha_id` NOT NULL (FK); `empresa_fornecedora_id` (FK; nulo só no líquido, por CHECK); sai `credor_pessoa_juridica_id` | 01-pessoas-1 (f22 03-07) | idem |
| recurso_glosa_recebido e _item | `justificativa_prestador` e `justificativa_operadora` em VARCHAR(1000) | 09-operadora | api/operadora (contas): trocar `LIMITE_TEXTO_RECURSO` para 1000 |
| envio_ans | CHECK: `cobranca_ressarcimento_sus_id` só na obrigação `ressarcimento_sus` (a coluna e a FK já existiam) | 09-operadora | api/operadora/ans-porta-propria.ts:23 |
| protocolo_beneficiario | `classe` (`assistencial`, `nao_assistencial`) | 09-operadora | api/operadora/atendimento-porta-propria.ts:17 |
| evento_acesso_portaria | índice (`terminal_acesso_id`, `ocorrido_em`) | 24-misto-especialidades | api/portaria/porta-propria.ts:136 |

## Já estava aplicado, nada refeito

Esses pedidos foram escritos contra uma leitura antiga do modelo. A porta pode ser ligada já:

- **`fatura_plano.acordo_inadimplencia_id`** (FK e índice): em 16_SGO/11. Pedido 09-operadora. Destrava
  api/operadora/cobranca-porta-propria.ts:16.
- **`envio_ans.cobranca_ressarcimento_sus_id`** (FK): em 16_SGO/11. Nesta volta só entrou o CHECK.
- **`produto_plano.operadora_saude_id`** (FK) e **`natureza`** (`plano`, `cartao_desconto`): em 16_SGO/11. O pedido
  queria `NOT NULL`, mas os clientes `f22_o2` e `f24_09operadora` já têm produto sem operadora. A coluna fica
  anulável, e a porta passa a gravar a operadora. O `NOT NULL` vem depois de sanear os dados. Destrava
  api/operadora/porta-propria.ts:32.
- **`protocolo_beneficiario`**: `instancia`, `natureza`, `canal`, `assunto`, `numero_nip`, `prorrogado_ate` e
  `motivo_prorrogacao`, `escrita_pedida_em`, `escrita_prazo_em`, `escrita_enviada_em`, `escrita_meio` e
  `reanalise_de_protocolo_beneficiario_id` já existiam em 16_SGO/11. A reanálise é um protocolo novo que aponta o
  anterior: o quando é o `aberto_em` dele, e o motivo é o `detalhe`. Faltava só `classe`.
- **`cota_depreciacao.calculo_depreciacao_id`** e **UNIQUE (`calculo_depreciacao_id`, `bem_patrimonial_id`)** no
  lugar de `uq_cota_depreciacao_bem_competencia_base`: em 14_FIN/11. O recálculo depois do estorno abre uma rodada
  nova (`calculo_depreciacao.vigente_chave`), e a cota da rodada nova não colide. Pedido 22-misto-sadt. Destrava
  api/patrimonio/porta-propria.ts:21,145.
- **`conta_portal_profissional_externo.profissional_vigente_id`** gerada e **UNIQUE
  `uq_conta_portal_profissional_externo_profissional_vigente`**: em 17_INTG/04. A UNIQUE antiga já saiu, e o nome
  contém "vigente", como a porta espera. A diferença para o pedido é só a situação `pendente`, que sem
  `autorizada_em` já fica fora da chave. Pedido 21-misto-farmacia. Destrava api/portal-medico/porta-propria.ts:99
  (religar).
- **`evento_acesso_portaria.terminal_acesso_id`** (FK), `dispositivo_acesso_id` anulável e CHECK de um dos dois: em
  17_INTG/03. Nesta volta só entrou o índice com `ocorrido_em`.

## Decisões pela melhor prática (para o dono ver)

1. **`notificacao_agravo.gatilho_em` ficou anulável**, com o CHECK "gatilho automático exige chave e instante". O
   pedido pedia `NOT NULL`, mas o caso manual não tem gatilho. `origem_gatilho` tem DEFAULT `manual` e
   `periodicidade` tem DEFAULT `imediata`, a mais segura, para as linhas importadas.
2. **`encerrado_por` virou `encerrado_por_usuario_id`**, com FK para usuário, pela convenção de nomes.
3. **`modelo_ficha_agravo_id` não entrou.** Não existe tabela de modelo de ficha, e o agravo da ficha já é
   `notificacao_agravo.agravo_notificavel_id`.
4. **`exame_id` aponta o exame do catálogo, como pedido.** A idempotência do resultado que disparou o caso fica na
   `chave_gatilho`.
5. **Ato cirúrgico:** o pedido só dava a faixa da frequência cardíaca (20 a 250). Para a pressão, ficaram faixas
   largas: sistólica de 20 a 300, diastólica de 10 a 250 e sistólica maior que a diastólica.
6. **Ocorrência do arquivo de prontuários:** exclusão, descarte e ocorrência exigem motivo. O descarte exige o aval
   da comissão de revisão de prontuários.
7. **Carga de tabela de preço:**
   - tem tabela própria, e não reusa `carga_catalogo`, que é a carga dos catálogos públicos e não tem tabela de preço;
   - as situações seguem as do contrato (`SITUACOES_CARGA`: `preparada`, `validada`, `comparada`, `publicada`,
     `rejeitada`), e não as do pedido;
   - a situação da linha usa a mesma contagem da carga de catálogo (`novo`, `alterado`, `igual`, `removido`, `erro`);
   - a rejeição exige motivo, e a publicação exige quem publicou e quando;
   - a mesma tabela de preço não recebe duas vezes o mesmo arquivo (UNIQUE por SHA-256).
8. **Folha × financeiro (f22 03-07):**
   - a integração por destino é tabela própria. O `depara_folha_financeiro` é de rubrica para conta e não tem
     vencimento por destino;
   - o credor do `titulo_folha` passou a ser a `empresa_fornecedora`, o mesmo do título a pagar, e
     `credor_pessoa_juridica_id` saiu. Estava vazio em todos os clientes, e nenhum código o usava;
   - **os fatos contábeis da folha reusam `fato_contabil`**, com `entidade_origem = 'lancamento_titulos_folha'`,
     `centro_custo_id` e `valor`, e o provento ou encargo vai no evento contábil. Por isso não existe
     `fato_contabil_folha`;
   - a origem do lançamento chama `origem_lancamento`, para não colidir com a coluna padrão `origem`.
9. **`ajuste_ponto.data_referencia`** entrou, apesar da prioridade baixa: é anulável e só vale na justificativa.

## Não aplicado

| Pedido | O que pedia | Por quê |
|---|---|---|
| 23-misto-coexistencia (faturamento SUS, 13_SUS) | crítica prévia, arquivo gerado com as linhas de BPA, APAC e CIHA, ciclo da AIH e da APAC, faixa de AIH, retorno do gestor | O pedido não traz colunas: remete ao `f22/saida/03-05.json`, que é o pedido do eSocial (já aplicado), e não o do SUS. São 18 operações. Um DDL desse tamanho, sem colunas, seria inventado. **Pedido ao lote:** listar, a partir da porta `sus/porta-propria.ts:17,81`, tabela, colunas e CHECKs de cada operação. |
| 15-qualidade (`agravo_notificavel_cid`) | carga da periodicidade por CID | Não é DDL: `agravo_notificavel.periodicidade_notificacao_id` já existe. É carga do catálogo oficial do Ministério da Saúde, por carregador versionado (regra 7). |
| 21-misto-farmacia (`canal_notificacao`) | linha `portal_medico_externo` | É semente, não DDL. Vai ao comando "criar novo cliente". |
| 09-operadora (`produto_plano` NOT NULL) | operadora obrigatória | Há linhas sem operadora em dois clientes. Ver "Já estava aplicado". |
