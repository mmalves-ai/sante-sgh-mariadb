# Conferência de qualidade do modelo

Banco: `validacao`; tabelas do catálogo: 3500; FKs: 13503; tabelas com CHECK: 3098; com UNIQUE além da PK: 3025

| Regra | Ocorrências | Exemplos |
|---|---:|---|
| principal operacional sem estabelecimento_id | 72 | item_agendavel, turma_encontro, auditoria_profilaxia_cirurgica, bloqueio_sala_cirurgica, checklist_cirurgia_segura, consumo_cirurgia, descricao_cirurgica, ficha_anestesica |
| histórico sem coluna operacao | 18 | aceite_termo_uso, anonimizacao_registro, bloqueio_login, comunicado_ciencia, consulta_verificacao_documento, decisao_aprovacao, envio_email, envio_notificacao |
| catálogo público sem coluna codigo_* | 12 | alimento_referencia_nutriente, compatibilidade_sigtap, procedimento_sigtap_atributo, procedimento_sigtap_cbo, procedimento_sigtap_cid, procedimento_sigtap_habilitacao, procedimento_sigtap_incremento, procedimento_sigtap_leito |
| vínculo com menos de 2 FKs | 7 | permissao_campo_cadastro, item_faturavel_codigo_barras, regra_montagem_guia_tipo, agravo_notificavel_cid, regra_obrigatoriedade_cid, ensaio_analise_programa, equivalencia_cid_ciha |
| item sem FK obrigatória (NOT NULL) para o pai | 2 | email_pessoa, ajuste_titulo |
| tabela isolada (sem FK e sem ser referenciada) | 1 | pergunta_frequente |
