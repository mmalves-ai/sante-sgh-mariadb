# F2.4: DDL aplicado (etapa compartilhada)

Migrações só para frente, no padrão do ADR 0002 (PK `id`, auditoria, FK `ON DELETE RESTRICT`, `CHECK` em vez de
`ENUM`, nomes de negócio, sem gatilho). Arquivos novos: `db/migracoes/<módulo>/20_tabelas.sql` e `20_chaves.sql` em
02_ADM, 05_AGE, 06_PEP, 07_INT, 08_CC, 09_HOT, 10_SADT, 11_SUP, 12_FAT, 14_FIN, 15_RH, 17_INTG e 18_QUA.
Gerados por script; 42 tabelas novas também entraram em `docs/analise/rodada2/final/catalogo.tsv`.

- **Número 20:** escolhido para não colidir com a trilha F4, que usa 06_PEP/16, 10_SADT/08, 11_SUP/07 e 12_FAT/11.
  Nenhuma tabela daqui é tocada pela F4: `diaria_por_plano_local`, `exame_item_assinatura`,
  `grade_horario_unidade` e `regra_transicao_situacao_prescricao` ficam para o merge.
- **Prova:**
  - `python3 -I tools/db/validar_migracoes.py`: 0 erros, com 3648 tabelas e 13937 FKs;
  - aplicado aos 11 clientes registrados (`teste_catalogos`, `teste_nucleo`, `teste_login`, `demo`, `f22_o1` a
    `f22_o5`, `f22_o5_b` e `f24_prova`);
  - nas 80 tabelas criadas ou alteradas, as contagens de colunas, CHECKs e FKs são iguais às do banco de validação em
    todos os clientes;
  - `teste_catalogos`, `teste_login` e `teste_nucleo` já tinham, antes, uma diferença pequena fora dessas tabelas;
  - os bancos da F4 (`cliente_cfl6_*`, `conector_ctl_*` e `f4r4_*`) não foram tocados.
- **Dados existentes:** as colunas novas em tabelas que já têm dados são anuláveis ou têm DEFAULT. Os CHECKs
  alterados só aceitam mais valores. As linhas já gravadas continuam válidas.
- **Como os lotes leem os códigos:** são `snake_case`; os hífens dos contratos são traduzidos na porta, por exemplo
  `no-bloco` vira `no_bloco`.

## Já estava aplicado antes desta etapa

Conferido no banco de validação. Nada foi refeito:

- `fluxograma_classificacao_risco.codigo` VARCHAR(60);
- situação `suspensa` da senha, natureza `correcao` da bolsa, situação `no_bloco` do agendamento cirúrgico e ambiente
  `coletor` do eSocial;
- formas de remuneração do prestador da rede; `ck_estabelecimento_codigo_formato`;
- colunas do realizado do plantão, tarifa por tipo, prazo do acionamento, regime de jornada e dimensionamento;
- `evento_escala`, `cobertura_minima_*` da escala, `cadastro_empregador`, `conferencia_eventos_esocial(_item)`,
  `operacao_tabela` e `data_referencia` do eSocial;
- colunas de férias, rescisão, décimo terceiro e obrigação trabalhista, e `parametro_obrigacao`;
- `presenca_treinamento` e `turma_treinamento`; `contrato_fornecedor.critico` e `observacao`;
- município e alerta do crônico na teleconsulta; `mensagem_integracao_saida.recibo`; `troca_email_conta_portal`
  (paciente e médico);
- `liberacao_lote`, `liberacao_chave` e `recurso_prerequisito`; `requisicao_transfusao_versao` e
  `ato_transfusional_adendo`; `agendamento_cirurgico_versao`, `paciente_informado` e `nascimento_informado`;
- `pin_troca_rapida`; os índices de `criado_em`/`alterado_em` do índice de busca;
- `contrato_gestor_sus`, `meta_contratual_sus`, `afericao_meta_sus`, `centro_custo` (classificação) e
  `estatistica_centro_mes`;
- a unicidade de `contrato_servico_terceirizado` por fornecedor e número.

## Aplicado nesta etapa

| Tabela | Colunas / mudança | Pedido de origem | Arquivos que destrava |
|---|---|---|---|
| politica_segundo_fator (nova) | alvo, perfil, onda, início, prazo de adesão, encerramento, substituída por | f22 02-03 | api/acesso/identidade/porta-identidade-propria.ts |
| segundo_fator_usuario | `segredo_cifrado` + CHECK do autenticador aceita o segredo próprio | f22 02-03 | idem |
| perfil_acesso | `acesso_amplo` | f22 02-04 | contratos/acesso/saneamento.ts, dominio-acesso/saneamento.ts (sai a lista fixa de códigos) |
| usuario_perfil | `revogado_motivo`; `ativo_chave` gerada + UNIQUE só entre as não excluídas | f22 02-02 | api/acesso/gestao-fonte-propria.ts, gestao.controller.ts |
| usuario_perfil_alteracao, politica_senha_versao, limite_sessao_perfil, excecao_conta_dormente, conferencia_registro_conselho, perfil_cargo_rh, resolucao_tarefa_rh (novas) | como no pedido | f22 02-02 | api/acesso/gestao-fonte-propria.ts, gestao.controller.ts |
| mensagem_interna, mensagem_interna_destinatario, comunicado_destinatario, notificacao_usuario | `exige_ciencia`; `via`, `ciente_em` (CHECK: ciência exige leitura); `via`; `tipo`, `evento` + índice | f22 02-01 | api/acesso (comunicação interna) |
| comunicado_versao (nova) | versão anterior do comunicado corrigido | f22 02-01 | api/acesso (comunicação interna) |
| marca_processamento (nova) | processo, chave, marca_em, marca_id | f22 05-15 | worker do índice de busca |
| trilha_auditoria_fecho (nova) | fecho diário com a cadeia de resumos | f22 05-05 | nucleo (fecharDia/verificarCadeia) e job do worker |
| pedido_titular | canal `outro`; `fundamento_decisao` (CHECK); `conta_portal_paciente_id`, `motivo_cancelamento`, `observacao_cancelamento`, `cancelado_em` | f22 02-05, 03-12 | api/portal-paciente, LGPD do acesso |
| consentimento_titular | `canal_registro`, `conta_portal_paciente_id`, `vinculo_responsavel_portal_id` | f22 03-12 | api/portal-paciente |
| vinculo_responsavel_portal, intencao_pagamento_portal, conciliacao_pagamento_portal (novas) | como no pedido | f22 03-12 | api/portal-paciente |
| pre_checkin + pre_checkin_documento (nova) | conta, dados propostos e gravados (JSON), versão dos termos, reserva da conferência, situação `cancelado` | f22 03-12 | api/portal-paciente, api/agenda |
| agenda_online_configuracao, agenda_online_convenio, agenda_online_servico (novas) | configuração do agendamento pelo portal por `agenda_servico` | f22 03-12 | api/portal-paciente, api/agenda |
| resposta_pesquisa_satisfacao | `marcacao_horario_id` (UNIQUE), `conta_portal_paciente_id` | f22 03-12 | api/portal-paciente |
| solicitacao_copia_prontuario + ato_copia_prontuario (nova) | `pedido_titular_id`; atos solicitação, legitimidade, geração e entrega | f22 03-12 | api/portal-paciente |
| agendamento_cirurgico | `conta_portal_profissional_externo_id` (CHECK: só no canal portal) | f22 03-01 | api/cirurgia/porta-propria.ts, operacoes.ts |
| agendamento_cirurgico_recurso (nova) | recurso da sala (12 códigos; a vaga de CTI segue em `reserva_uti`) | f22 03-01 | api/cirurgia/porta-propria.ts |
| registro_nascimento | `reanimacao_neonatal`, `observacao` | arq. 02-06 | api/especialidades/porta-propria.ts |
| protocolo_quimioterapia | `versao_protocolo`, `hash_conteudo`, `revogado_em`, `motivo_revogacao`; UNIQUE (codigo, versao_protocolo) e UNIQUE hash | arq. 02-06 | api/especialidades/porta-propria.ts |
| ciclo_quimioterapia | creatinina, redução de dose com motivo, justificativa do intervalo, validação farmacêutica | arq. 02-06 | idem |
| ciclo_quimioterapia_prescricao, evento_tratamento_oncologico (novas) | ligação ciclo × prescrição; eventos `EVENTOS_ONCO` em snake_case | arq. 02-06 | idem |
| exame_oftalmologico, exame_oftalmologico_valor; acuidade_visual, graduacao_oftalmologica (novas) | `classificacao_visual`, `conduta`, `internacao_id`; medida `gonioscopia`; cadastros | arq. 02-06 | idem |
| avaliacao_farmaceutica_item | parecer `revisao_medica` (exige justificativa) | arq. 02-06 | api/farmacia/gravador-avaliacao.ts, porta-propria.ts |
| livro_controlado | modo de fechamento, hash, arquivo do conteúdo, guarda legal | arq. 02-06 | api/farmacia/porta-propria.ts |
| conferencia_controlado (nova) | dupla conferência por documento de estoque e lote | arq. 02-06 | idem |
| dispensacao | tipo `ambulatorial` (atendimento, setor e centro de custo anuláveis só nele) + `receita_controlada_id` | arq. 02-06 | api/farmacia/porta-propria.ts, operacoes.ts |
| preparo_lactario + preparo_lactario_evento (nova) | conferência por outra pessoa, etiqueta; histórico | arq. 02-06 | lactário (farmácia/nutrição) |
| profilaxia_tev_decisao, contencao_paciente_avaliacao_adendo (novas) | padrão de evento (operação, dados, ocorrido_em, usuário) | arq. 02-04 | api/enfermagem/escores-porta-propria.ts |
| protocolo_receita_enfermagem(_item) (novas) + receita_medica.protocolo_receita_enfermagem_id | protocolo que autoriza a receita do enfermeiro | f22 05-03 | api/enfermagem/sae-porta-propria.ts |
| fechamento_censo | `versao_calculo`, `hora_fechamento` (1 a 24, como pedido) | f22 05-15 | api/adt (censo) |
| aviso_valor_critico_tentativa | `conta_portal_profissional_externo_id` (UNIQUE com o aviso), `envio` | f22 04-02 | api/portal-medico/aplicacao/servico.ts, porta-propria.ts, sadt/aplicacao/vigia-criticos.ts |
| contrato_servico_terceirizado | `contrato_fornecedor_id` | arq. 03-03 | api/manutencao/porta-propria.ts |
| vinculo_contrato_fornecedor, evento_processo_licitatorio (novas) | pedido/título com exceção usada; histórico da licitação | f22 03-13 | api/suprimentos, api/financeiro (contratos) |
| lote_tiss_conta | `guia_tiss_chave` gerada; UNIQUE com a guia nula contando como uma | f22 05-02 | regras-no-banco.int.spec.ts (faturamento/TISS) |
| versao_regra_contabil (nova); lancamento_contabil, fato_contabil | versão publicada da regra; `versao_regra_contabil_id` | f22 04-01, 05-12 | api/contabil/porta-propria.ts, worker/contabil/porta-propria.ts, leitura-fatos.service.ts |
| conciliacao_conta_contabil | UNIQUE por conta e período vira índice simples (várias conciliações no mês) | f22 04-01 | api/contabil/porta-propria.ts |
| quadro_vaga (nova); faixa_salarial | quadro aprovado; versão da faixa (vigência, anterior, situação), UNIQUE com a vigência | f22 03-03 | api/pessoas/cargos/porta-propria.ts |
| plantao | `inscricao_conselho_id` | f22 03-04 | api/pessoas/escala/porta-escala-propria.ts, porta-realizado-propria.ts |
| processamento_folha, processamento_folha_linha, parametro_folha, fechamento_periodo_folha, obrigacao_fechamento (novas); recibo_ferias, rescisao | `processamento_folha_id` | f22 03-06 | api/pessoas/folha/porta-calculo-propria.ts, porta-folha-propria.ts |
| evento_periodo_ponto (nova); regra_banco_horas; movimento_banco_horas; ajuste_ponto | regime, destino, início do ciclo, falta debita; vínculo, competência, fechamento, motivos novos; vínculo e tipo `justificativa` com abono e minutos | f22 03-09 | api/pessoas/ponto/porta-ponto-propria.ts |
| inscricao_conselho_unidade (nova) | unidade da inscrição, com vigência | f22 03-09 | api/pessoas (ficha: unidadesDosRegistros) |
| curso + curso_publico_alvo (nova) | tipos `procedimento_operacional` e `gestao`; público por estabelecimento, setor ou função, obrigatório | f22 03-11 | api/pessoas/treinamento/modelo-curso.ts, porta-treinamento-propria.ts |

"arq." é o lote em `docs/obra/fatias/f22/arquivo-ondas-1a4/saida/`; "f22" é o lote em `docs/obra/fatias/f22/saida/`.

## Decisões pela melhor prática (para o dono ver)

1. **Nomes trocados para o nome de negócio do modelo:**
   - `registro_conselho_id` do plantão virou `inscricao_conselho_id`, porque a tabela é `inscricao_conselho`;
   - `portal_acesso_id` do agendamento cirúrgico virou `conta_portal_profissional_externo_id`;
   - `versao` virou `numero_versao` em `politica_senha_versao` e `comunicado_versao`, porque `versao` é a coluna da
     trava otimista;
   - `documento_id` da conferência do controlado virou `documento_estoque_id`, com FK;
   - `preparo_lactario_item_evento` virou `preparo_lactario_evento`, porque o histórico é do preparo.
2. **O agendamento pelo portal liga-se a `agenda_servico`.** O modelo não tem tabela `agenda`.
3. **O pagamento do portal dá baixa em `recebimento_particular`.**
4. **A folha ganhou tabelas próprias para o processamento e as linhas por papel.** Não se reaproveitou
   `calculo_folha_item`, que exige rubrica.
   - O papel é texto validado no domínio.
   - O de-para do papel para a rubrica fica em `parametro_folha`.
   - O período do fechamento é `periodo_inicio DATE` (vocabulário neutro), e não o texto `AAAA-MM`.
5. **Os vínculos novos de RH nascem anuláveis.** É o caso de `vinculo_trabalho_id` em `ajuste_ponto` e
   `movimento_banco_horas`.
   - O pedido queria NOT NULL, com carga do que já existe.
   - Ficam anuláveis porque a migração é só para frente e há linhas antigas.
   - A gravação nova grava sempre o vínculo, no domínio e na porta.
   - O NOT NULL entra depois da carga do conector.
6. **Unicidade com coluna nula:** usa-se coluna gerada `PERSISTENT` e UNIQUE, sem sentinela gravado. Vale para
   `usuario_perfil`, `lote_tiss_conta`, `faixa_salarial`, `trilha_auditoria_fecho`, `agenda_online_servico`,
   `conferencia_controlado`, `curso_publico_alvo`, `ato_copia_prontuario` e `conciliacao_pagamento_portal`.
7. **CHECK que dependeria de dado antigo foi escrito no sentido seguro.** Em `pedido_titular`, o CHECK é
   `cancelado_em` ⇒ situação `cancelado`. As linhas antigas canceladas não têm a data.
8. **`protocolo_quimioterapia.hash_conteudo` é anulável** só para os protocolos anteriores à versão. Cada versão
   publicada nova grava o hash, que tem UNIQUE.
9. **Recursos da sala do agendamento cirúrgico:** a lista vai num CHECK. A vaga de CTI continua em `reserva_uti`.
10. **Envio da notificação do crítico ao médico:** a coluna `envio` aceita `simulador`, `plataforma` e `desligado`,
    sem nome de fornecedor. O CHECK de `resultado` não muda.
11. **Valores com hífen nos contratos viram `snake_case` no banco,** e a porta traduz. Exemplos: `nao-localizado`,
    `portal-conselho`, `cartao-credito` e os eventos de oncologia.
