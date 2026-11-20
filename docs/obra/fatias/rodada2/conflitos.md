### 2.2 Mesma entidade proposta por mais de um grupo

**49 nomes** aparecem em dois grupos ou mais. `solicitacao_opme` aparece em três: 04, 05 e 06. Isso não é erro
de nome, mas o DDL precisa de um só dono por entidade.

| Entidade | Grupos | Dono proposto | Motivo |
|---|---|---|---|
| `estabelecimento`, `logotipo_estabelecimento` | 01, 02 | 02 | cadastro-base; o 01 só lê pelo escopo de acesso |
| `alcada_aprovacao` | 01, 05 | 01 | mecanismo transversal (ver 2.3) |
| `assinatura_documento` | 01, 03 | 01 | serviço transversal; o 03 guarda a pendência |
| `declaracao_obito` | 03, 04 | 03 | D3 |
| `registro_obito` | 02, 04 | — (some) | fica como atributo do paciente, derivado da `declaracao_obito` |
| `alta_medica`, `pendencia_prontuario`, `solicitacao_copia_prontuario` | 03, 04 | `alta_medica`: 03; as duas outras: 04 (SAME) | o documento é do PEP; a guarda física e a cópia são do SAME |
| `terapia_nutricional` | 03, 04 | 03 | D5 |
| `avaliacao_farmaceutica`, `intervencao_farmaceutica`, `tipo_intervencao_farmaceutica`, `ficha_antimicrobiano`, `unidade_prescricao` | 03, 05 | 03 (prescrição); 05 só na liberação e na dispensação | D4 |
| `ciclo_esterilizacao`, `ciclo_esterilizacao_item`, `equipamento_esterilizacao`, `caixa_instrumental`, `caixa_instrumental_item`, `solicitacao_material_esteril` | 04, 05 | 04 (CME) | o 05 só fornece o insumo |
| `solicitacao_opme`, `solicitacao_opme_item`, `autorizacao_opme`, `consumo_opme`, `conciliacao_opme` | 04, 05 (06 só em `solicitacao_opme`) | 05 | D1 |
| `bem_patrimonial`, `baixa_bem`, `cota_depreciacao` | 04, 07 | 07 | patrimônio é contábil; o 04 usa o bem na manutenção |
| `apuracao_repasse`, `base_calculo_repasse`, `evento_repasse`, `lancamento_repasse`, `regra_repasse`, `versao_regra_repasse`, `cooperativa_medica`, `natureza_rendimento`, `recibo` | 06, 07 | 06 (repasse); 07 (`recibo`, `natureza_rendimento`) | o repasse nasce do faturado; o pagamento é do financeiro |
| `adiantamento_paciente` | 06, 07 | 07 | D6 |
| `avaliacao_fornecedor` | 05, 07 | 05 | cadastro de fornecedor; o 07 só referencia pelo contrato |
| `consulta_elegibilidade` | 02, 06 | 06 | D10 |
| `servico_regulacao` | 04, 08 | 04 | D9 |
| `interface_equipamento`, `laboratorio_apoio`, `modalidade_imagem`, `item_lista_trabalho_imagem`, `visualizador_imagem`, `perfil_portal_resultado`, `portal_cotacao` | 05, 08 | 05 (negócio); o 08 só no canal e no mapeamento | a regra do exame é do diagnóstico; a mensagem é da integração |

### 2.3 Mesmo conceito com nomes diferentes

Estes casos não aparecem como repetição exata, mas descrevem a mesma coisa. Para cada um proponho um nome só.

| Conceito | Nomes propostos pelos grupos | Nome único proposto |
|---|---|---|
| Declaração de óbito | `registro_obito` (02, 04), `declaracao_obito` (03, 04), `cancelamento_declaracao_obito` (04) | `declaracao_obito` (com situação e cancelamento) |
| Unificação de cadastro duplicado | `unificacao_cadastro`, `unificacao_item` (01); `unificacao_prontuario`, `suspeita_duplicidade` (02) | `unificacao_cadastro`, `unificacao_cadastro_item`, `suspeita_duplicidade` (dono 02) |
| Feriado e dia não útil | `feriado` (01); `dia_nao_util` (02) | `dia_nao_util` com abrangência (dono 02) |
| Unidade do estabelecimento | `unidade_atendimento` (01); `unidade_assistencial` (02); `unidade_internacao` (04) | `unidade_assistencial` (02), com `unidade_internacao` como especialização no 04 |
| Grupo econômico acima do hospital | `rede`, `empresa` (01); `mantenedora` (02) | `mantenedora` e `rede`, sem `empresa` solta |
| Centro de custo | `centro_custo_gerencial` (02); os grupos 05, 06 e 07 referenciam `centro_custo`, mas nenhum propõe a entidade | `centro_custo` (dono 07), com `classificacao_centro_custo` |
| Fonte pagadora | `plano_fonte_pagadora`, `parametro_fonte_pagadora` (02); `contrato_pagador`, `guia_pagador`, `endpoint_tiss_pagador` (06); `credito_convenio`, `premissa_recebimento_convenio` (07); `consulta_elegibilidade_convenio`, `credencial_convenio` (08) | um termo só, `fonte_pagadora`, como no ADR (vocabulário neutro): `contrato_fonte_pagadora`, `credito_fonte_pagadora` etc. |
| Elegibilidade | `consulta_elegibilidade` (02, 06); `consulta_elegibilidade_convenio` (08); `consulta_elegibilidade_plano` (08, lado da operadora) | `consulta_elegibilidade` (hospital) e `consulta_elegibilidade_recebida` (operadora) |
| Autorização da operadora, lado do hospital | `autorizacao_operadora` (02); `solicitacao_autorizacao`, `resposta_autorizacao`, `item_solicitacao_autorizacao` (06); `autorizacao_internacao` (04); `etapa_autorizacao_cirurgia` (04) | `solicitacao_autorizacao` com tipo (consulta, SADT, internação, prorrogação, cirurgia, OPME) e `resposta_autorizacao` (dono 06) |
| Regulação | `pedido_regulacao`, `evento_regulacao` (02); `solicitacao_regulacao`, `evolucao_regulacao`, `central_reguladora` (04); `solicitacao_regulacao_externa`, `sistema_regulacao` (08) | `solicitacao_regulacao`, `evento_regulacao`, `central_reguladora` (dono 04) |
| Item da solicitação de OPME | `solicitacao_opme_item` (04, 05); `item_solicitacao_opme` (06) | `solicitacao_opme_item` |
| Aprovação de OPME | `autorizacao_opme` (04, 05: da operadora); `aprovacao_opme` (06); `alcada_aprovacao_opme` (04) | `autorizacao_opme` (operadora) e a alçada pelo mecanismo comum |
| Alçada de aprovação | `alcada_aprovacao` (01, 05); `alcada_aprovacao_opme` (04); `alcada_ajuste`, `alcada_faturamento` (06); `alcada_financeira`, `limite_alcada_usuario`, `pedido_aprovacao`, `decisao_aprovacao` (07) | um mecanismo só: `alcada_aprovacao` (regra por tipo de documento e valor), `pedido_aprovacao` e `decisao_aprovacao` (dono 01) |
| Caixa do particular | `caixa`, `movimento_caixa`, `recebimento_particular` (06); `sessao_caixa`, `recebimento_balcao`, `sangria_caixa` (07) | `caixa`, `sessao_caixa`, `movimento_caixa`, `recebimento_particular` (dono 07) |
| Caução e adiantamento do paciente | `caucao`, `adiantamento_paciente` (06); `adiantamento_paciente`, `contrato_adiantamento_paciente`, `aplicacao_adiantamento_paciente` (07) | sem `caucao` à parte: a caução é um `adiantamento_paciente` de tipo caução (dono 07) |
| Item da apuração de repasse | `item_repasse` (06); `item_apuracao_repasse` (07) | `item_apuracao_repasse` |
| Membro de cooperativa | `membro_cooperativa` (06); `cooperado` (07) | `membro_cooperativa` |
| Patrimônio | `movimento_bem`, `inventario_bem`, `plaqueta_bem` (04); `movimentacao_bem`, `inventario_patrimonial`, `plaqueta` (07) | `movimento_bem`, `inventario_bem`, `plaqueta_bem` (dono 07) |
| Rastreio do material esterilizado | `pacote_esteril`, `uso_pacote_esteril`, `metodo_esterilizacao` (04); `etiqueta_esteril`, `kit_rastreavel`, `kit_rastreavel_item`, `indicador_ciclo` (05) | `pacote_esteril` (o que é processado) e `uso_pacote_esteril` (o uso no paciente), dono 04. O `kit_rastreavel` do 05 serve só a kits de material não estéril |
| Protocolo de envio de documentos entre setores | `protocolo_tramite`, `protocolo_tramite_item` (04, SAME); `protocolo_documento`, `item_protocolo_documento` (06, conta) | `protocolo_tramite` com o tipo de conteúdo (prontuário, conta, documento) |
| Pendência de documento | `pendencia_prontuario`, `tipo_pendencia_prontuario` (03, 04); `pendencia_conta`, `tipo_pendencia_conta` (06); `pendencia_assinatura` (03) | uma `pendencia` com o tipo e o alvo, ou as três mantidas com tipo comum. É preciso decidir antes do DDL |
| Regras de alerta | `regra_alerta`, `alerta_gatilho` (01); `regra_alerta_clinico`, `regra_alerta_versao` (03, apoio à decisão); `regra_aviso_clinico`, `aviso_clinico` (03, avisos) | um motor de regra só: `regra_alerta` com versão (dono 01), e `aviso_clinico` como saída no 03 |
| Política de assinatura | `politica_assinatura` (01); `politica_assinatura_tipo` (03) | `politica_assinatura` por tipo de documento (dono 01) |
| Termo de uso e de consentimento | `aceite_termo_uso`, `termo_uso_versao`, `termo_consentimento` (01); `termo_uso_aceite`, `termo_consentimento_modelo`, `termo_consentimento_paciente` (03); `modelo_termo`, `aceite_termo` (02) | `termo_uso_versao` e `aceite_termo_uso` (01); `termo_consentimento_modelo` e `termo_consentimento_paciente` (03); sem `modelo_termo` genérico |
| Terminologias e tabelas de referência | `terminologia`, `termo_terminologia`, `tabela_referencia_preco` (08); `terminologia_tiss`, `termo_tiss` (06); `edicao_referencia_matmed`, `item_referencia_matmed` (06) | `terminologia` e `termo_terminologia` (dono 08), com a TISS como uma das terminologias; a referência de preço de mat/med fica no 06 |
| Comunicação com o equipamento e a imagem | `modelo_comunicacao`, `evento_status_imagem` (05); `modelo_comunicacao_interface`, `status_execucao_imagem` (08) | `modelo_comunicacao` e `evento_status_imagem` (dono 05) |
| Orçamento ao particular | `orcamento_exame`, `orcamento_exame_item` (05); `orcamento_particular`, `item_orcamento_particular`, `modelo_orcamento` (06) | `orcamento_particular` com item de qualquer tipo (dono 06) |
| Parâmetros | mecanismo genérico `parametro_definicao`, `parametro_valor`, `parametro_valor_historico` (01) e, ao mesmo tempo, tabelas por módulo: `parametro_estabelecimento` (02), `parametro_prontuario` (03), `parametro_internacao` (04), `parametro_estoque` (05), `parametro_faturamento` (06), `parametro_financeiro` (07), `parametro_operadora` (08) e outras | decidir no ADR: ou o mecanismo genérico do 01 com o catálogo de chaves por módulo (recomendado), ou uma tabela por módulo, sem os dois |

### 2.4 Tabelas do MV contadas mais de uma vez

A soma das tabelas que os grupos declararam é **8.682**:

| Grupo | Tabelas declaradas |
|---|---:|
| 01 | 1.636 |
| 02 | 470 |
| 03 | 771 |
| 04 | 567 |
| 05 | 1.018 |
| 06 | 859 |
| 07 | 993 |
| 08 | 2.368 |
| **Total** | **8.682** |

O número parece perto do total do MV (8.867), mas inclui contagens duplas. Por isso a seção 1 ainda encontra
630 tabelas sem dono. As duplas conhecidas:

| Recorte | Contado em | Observação |
|---|---|---|
| Data mart (dimensões e fatos) | 01 (210, esquema inteiro), 02 (paciente, atendimento, convênio), 05 (20: exame, estoque, compras) | contar só no 01 |
| Cópias espelho da troca de paciente | 01 (35, unificação) e 02 (23, NAO) | contar só no 02; a decisão do 01 (unificação F3) não muda |
| OPME e integrações de portal de OPME | 04, 05 e 08 | contar no 05 |
| CME | 04 e 05 | contar no 04 |
| Repasse médico | 06 e 07 | contar no 06 |
| Patrimônio | 04 e 07 | contar no 07 |
| Caução e recibo | 06 e 07 | contar no 07 |
| Contratos com fornecedores | 05 e 07 | contar no 07 |
| Painel de chamada e painéis de TV | 01 e 02 | contar no 02 (chamada) e no 01 (TV) |
| Antimicrobianos | 03, 04 e 05 | contar no 03 |

