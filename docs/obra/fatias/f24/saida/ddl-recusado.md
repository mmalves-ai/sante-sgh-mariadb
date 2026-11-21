# F2.4: DDL não aplicado

| Pedido | O que pedia | Por quê |
|---|---|---|
| f22 03-09 (colaborador) | `colaborador.cpf_hmac` com UNIQUE | O modelo já guarda o CPF em `colaborador.cpf`, com UNIQUE. A porta deve buscar pelo CPF, como o próprio pedido admite. Uma segunda chave duplicaria o dado. |
| f22 03-09 (arquivo_ponto.conferencia) | VARCHAR(1000) → JSON | Não bloqueia nada. Converter exige migrar o texto já gravado, que pode não ser JSON. Fica para quando houver necessidade. |
| f22 03-09 (UF do estabelecimento) | expor a UF | Não precisa de DDL: `municipio_ibge.unidade_federativa_id` já existe. A porta lê pelo município do estabelecimento. |
| f22 05-03 (internacao_recem_nascido) | colunas de reanimação | Duplicaria a reanimação, que agora está em `registro_nascimento.reanimacao_neonatal`. A internação do recém-nascido lê pelo registro. |
| f22 05-03 (protocolo_quimioterapia_versao) | tabela de versões | É condicional e ficou dispensada: o protocolo passou a ser versionado na própria linha, com `versao_protocolo` e UNIQUE (codigo, versao_protocolo). |
| arq. 02-08 (parecer_auditoria_conta) | tabela opcional dos pareceres | O próprio pedido a marca como opcional. Os pareceres seguem no retrato de `auditoria_conta_versao`. |
| f22 02-05 (permissões complementares) | nenhuma tabela nova | O pedido diz que cabe em `usuario_acao_excecao`. Falta a operação, que é trabalho de lote. |
| f22 02-05 (LocaisComplementos.horarios/pesquisados) | "a definir" | Não diz o que medir. Decisão de produto pendente: sem definição não há tabela. |
| f22 02-05 (acomodacao.localConta/tiposTiss) | coluna ou domínio | Alinhar o contrato ao `categoria_acomodacao.codigo_tiss_acomodacao` (texto). É troca de contrato, de lote. |
| f22 03-05 (sequência do evento do eSocial) | nenhum DDL | A porta cria a sequência por `garantirSequencia`. |
| f22 03-13 (sequências do consignado; índices de reajuste; razão do consignado) | semente, carga e código | Não são DDL. Vão ao comando "criar novo cliente", ao carregador versionado dos índices públicos (regra 7) e à porta do estoque e do OPME. |
| arq. 02-06 (tipo de exame "avaliacao"; tratamento oncológico com diagnóstico e intenção) | carga e contrato | Não são DDL: carga do `criar_cliente` e mudança de contrato, de lote. |
| arq. 04-02 #10 (comentário de `conta_portal_profissional_externo.pessoa_fisica_id`) | só o comentário | Cosmético e sem efeito. Fica para a próxima mudança da tabela. |
| f22 05-15 (marca_processamento) | — | Aplicada aqui. O worker do índice ainda guarda a marca em memória: adotar a tabela é trabalho de lote. |

Pedidos da F4 ficam para o merge, sem duplicar: `diaria_por_plano_local`, `exame_item_assinatura`,
`grade_horario_unidade` e `regra_transicao_situacao_prescricao`.
