# Liberação para a carga real da ProntoCardio: conferência final (2026-11-22)

**Situação: não liberada.** O recorte da cadeia ainda tem entidades principais com zero gravados e recusas sem justificativa. Este documento traz só contagens.

## O que entrou
- O branch `velocidade-carga` foi juntado à `main` no commit `4947ab28`. A prova da faixa tinha passado. A mesclagem não teve conflito e nenhum push foi feito.
- A suíte completa `conector/conector.sh testes` rodou dentro do flock: 1.254 testes, OK (10 pulados e 2 falhas esperadas).
- O medir-carga do recorte da cadeia rodou dentro do flock, com `CONECTOR_GRAVADORES=2`, no cliente de teste `nucleo_f`. Levou 48 min, de 19:15 às 20:03, e terminou sem travar. O travamento do `nucleo_c2` não se repetiu, e a causa dele continua desconhecida.

## Tabela da cadeia (recorte `tools/obra/recorte-nucleo.tsv`)
A tabela traz as entidades do L3 e as do mapa com recusa ou com menos de 100 gravados. As entidades sem recusa e com 100 ou mais gravados foram omitidas.

| etapa | entidade | origem | gravados | recusados | conciliação conferida |
|---|---|---:|---:|---:|---|
| l3 | atendimento | 3986 | 3986 | 0 | sim |
| l3 | atendimento_alta | 17 | 17 | 0 | sim |
| l3 | atendimento_ficha | 3986 | 3986 | 0 | sim |
| l3 | documento_pessoa | 38075 | 38075 | 0 | sim |
| l3 | endereco_pessoa | 47024 | 46926 | 98 | sim |
| l3 | estabelecimento | 1 | 1 | 0 | sim |
| l3 | paciente | 47063 | 47063 | 0 | sim |
| l3 | telefone_pessoa | 87432 | 54271 | 33161 | sim |
| l3 | tipo_empresa | 2 | 2 | 0 | sim |
| l3 | usuario | 1087 | 1086 | 1 | sim |
| mapa | acomodacao | 0 | 6 | 3 | não |
| mapa | agenda_escala | 0 | 216 | 2 | não |
| mapa | agenda_fonte_pagadora | 0 | 4123 | 44 | não |
| mapa | agenda_servico | 0 | 137 | 1 | não |
| mapa | autoridade_notificacao | 0 | 3 | 0 | não |
| mapa | baixa_titulo | 0 | 0 | 0 | sim |
| mapa | bloco_internacao | 0 | 7 | 0 | não |
| mapa | canal_marcacao | 0 | 4 | 0 | não |
| mapa | capacidade_civil | 0 | 3 | 0 | não |
| mapa | categoria_acomodacao | 0 | 18 | 0 | não |
| mapa | categoria_agenda | 0 | 8 | 0 | não |
| mapa | centro_custo | 0 | 99 | 0 | não |
| mapa | classe_fonte_pagadora | 0 | 8 | 0 | não |
| mapa | clinica_assistencial | 0 | 7 | 0 | não |
| mapa | codigo_prestador_fonte_pagadora | 0 | 14 | 0 | não |
| mapa | complexidade_estabelecimento | 0 | 3 | 0 | não |
| mapa | conta_bancaria | 0 | 0 | 489 | não |
| mapa | conta_hospitalar | 0 | 618 | 3174 | não |
| mapa | conta_hospitalar_etapa | 0 | 618 | 3424 | não |
| mapa | conta_hospitalar_item | 0 | 0 | 0 | sim |
| mapa | cooperativa_medica | 0 | 240 | 2 | não |
| mapa | crenca_religiosa | 0 | 11 | 0 | não |
| mapa | criticidade_area | 0 | 3 | 0 | não |
| mapa | empresa_fornecedora | 0 | 2325 | 11 | não |
| mapa | estado_civil | 0 | 18 | 0 | não |
| mapa | evento_repasse | 0 | 93 | 0 | não |
| mapa | fonte_pagadora | 0 | 77 | 0 | não |
| mapa | fonte_pagadora_versao | 0 | 96 | 1 | não |
| mapa | funcao_equipe_cobranca | 0 | 4 | 0 | não |
| mapa | grupo_atendimento | 0 | 1 | 0 | não |
| mapa | grupo_ato | 0 | 29 | 0 | não |
| mapa | grupo_fonte_pagadora | 0 | 2 | 0 | não |
| mapa | grupo_natureza_financeira | 0 | 40 | 0 | não |
| mapa | horario_agenda | 0 | 175058 | 2839 | não |
| mapa | identidade_de_genero | 0 | 2 | 0 | não |
| mapa | inscricao_conselho | 0 | 0 | 1907 | não |
| mapa | item_faturavel | 0 | 265117 | 9941 | não |
| mapa | item_referencia_matmed | 0 | 0 | 20000 | não |
| mapa | lancamento_repasse | 0 | 8102 | 573 | não |
| mapa | leito_hospitalar | 0 | 0 | 109 | não |
| mapa | local_cobranca | 0 | 19 | 0 | não |
| mapa | lotacao_profissional | 0 | 0 | 637 | não |
| mapa | lotacao_tributaria | 0 | 0 | 1 | não |
| mapa | mantenedora | 0 | 1 | 0 | não |
| mapa | mapeamento_codigo_externo | 0 | 20 | 93 | não |
| mapa | marcacao_horario | 24030 | 0 | 24030 | não |
| mapa | marcacao_horario_item | 0 | 0 | 0 | sim |
| mapa | modo_agendamento_online | 0 | 4 | 0 | não |
| mapa | modulo_sistema | 19 | 19 | 0 | sim |
| mapa | motivo_saida_hospitalar | 0 | 55 | 0 | não |
| mapa | natureza_financeira | 0 | 526 | 7 | não |
| mapa | nivel_escolaridade | 0 | 12 | 0 | não |
| mapa | orgao_emissor_documento | 0 | 32 | 0 | não |
| mapa | parametro_definicao | 19 | 19 | 0 | sim |
| mapa | parametro_opcao | 0 | 19 | 0 | não |
| mapa | parcela_pagar | 0 | 0 | 71267 | não |
| mapa | perfil_acesso | 0 | 42 | 0 | não |
| mapa | perfil_prioridade_externa | 0 | 6 | 0 | não |
| mapa | perfil_unidade | 0 | 5 | 0 | não |
| mapa | pessoa_fisica | 1 | 1 | 0 | sim |
| mapa | pessoa_juridica | 1 | 1 | 0 | não |
| mapa | plano_fonte_pagadora | 0 | 0 | 2 | não |
| mapa | porte_estabelecimento | 0 | 4 | 0 | não |
| mapa | pre_cadastro | 0 | 0 | 0 | sim |
| mapa | preco_diaria_taxa_valor | 0 | 6056 | 6 | não |
| mapa | preco_procedimento | 0 | 265117 | 4537 | não |
| mapa | procedencia | 0 | 1 | 0 | não |
| mapa | producao_repasse | 0 | 0 | 0 | sim |
| mapa | profissional_especialidade | 0 | 0 | 1170 | não |
| mapa | profissional_fonte_pagadora | 0 | 0 | 90455 | não |
| mapa | profissional_versao | 0 | 1500 | 2 | não |
| mapa | regime_atendimento_internacao | 0 | 4 | 0 | não |
| mapa | regra_repasse | 0 | 105246 | 184 | não |
| mapa | regra_repasse_profissional | 0 | 98335 | 71 | não |
| mapa | rpa | 0 | 4812 | 431 | não |
| mapa | sala_cirurgica | 0 | 0 | 4 | não |
| mapa | sexo | 0 | 3 | 0 | não |
| mapa | sistema_externo | 20 | 20 | 0 | sim |
| mapa | situacao_marcacao | 0 | 13 | 1 | não |
| mapa | solicitante_externo | 0 | 2658 | 5002 | não |
| mapa | tabela_preco | 0 | 75 | 0 | não |
| mapa | tipo_conta_bancaria | 0 | 3 | 0 | não |
| mapa | tipo_credor | 0 | 40 | 0 | não |
| mapa | tipo_deducao_irrf | 0 | 7 | 0 | não |
| mapa | tipo_documento_financeiro | 0 | 0 | 0 | sim |
| mapa | tipo_encaminhamento | 0 | 1 | 0 | não |
| mapa | tipo_leito_observacao | 0 | 2 | 0 | não |
| mapa | tipo_mapeamento_codigo | 20 | 20 | 0 | sim |
| mapa | tipo_parentesco | 0 | 11 | 0 | não |
| mapa | tipo_prestador_repasse | 0 | 6 | 0 | não |
| mapa | tipo_rendimento_isento | 0 | 11 | 0 | não |
| mapa | tipo_valor_integracao | 0 | 7 | 0 | não |
| mapa | titulo_pagar | 0 | 0 | 0 | sim |
| mapa | unidade_assistencial | 0 | 6 | 0 | não |
| mapa | unidade_idade | 0 | 3 | 0 | não |
| mapa | unidade_internacao | 7 | 7 | 0 | sim |
| mapa | unidade_mensuracao_custo | 0 | 0 | 1 | não |

## Recusas por tabela de origem e regra (400 ou mais)

| tabela de origem | regra | linhas |
|---|---|---:|
| TBCBOPRO_TBCONVEN | pai_pendente | 81451 |
| MFCONPAG | pai_pendente | 69785 |
| RICADPAC | telefone_invalido | 33161 |
| REPACAGD | restricao_destino_1048 | 23881 |
| TBMATMED | licenca_nao_comprovada | 20000 |
| TBPROCTO | restricao_destino_1048 | 9941 |
| TBCBOPRO_TBCONVEN | restricao_destino_1452 | 9004 |
| TBTABTHM | pai_pendente | 4537 |
| TBMEDSOL | restricao_destino_1048 | 3752 |
| FCCTAEXT | pai_pendente | 3174 |
| RECONTAS | pai_pendente | 3172 |
| REPACAGI | pai_pendente | 2839 |
| TBCBOPRO | restricao_destino_1048 | 1907 |
| MFCONPAG | restricao_destino_1048 | 1482 |
| TBMEDSOL | restricao_destino_1062 | 1250 |
| TBMEDESP | pai_pendente | 990 |
| RPLANEVE | restricao_destino_4025 | 573 |
| TBCBOPRO_TBUNIDAD | pai_pendente | 558 |
| TBCTABAN | restricao_destino_4025 | 488 |
| RPRPA | restricao_destino_1048 | 431 |

## Tabela por área (pré-carga)
Não rodou. O critério da cadeia já falhou, então a pré-carga completa ficou para depois da correção da causa.

## O que fica pendente (causa antes de liberar)
1. **C3, a inscrição no conselho:** nenhuma linha de `TBCBOPRO` grava pelo mapa. As 1.907 linhas que o L3 não criou recebem `pai_inexistente` na referência encadeada `ref:TBCBOPRO>ID_TBPROFIS>TBPROFIS` e, depois, `restricao_destino_1048`. As outras 188 são provisórias do L3 e ficam em `alteracao_aguarda_sincronizar`. O profissional gravou as 871 linhas, com a chave numérica simples no `conector_origem`.
   - A falha é de 100%, então é sistemática, e não de dado.
   - Próximo passo: reproduzir `_seguir`/`_coluna_pai` com a autorreferência (a própria tabela, lida pelo `LeitorRemoto` e pelo recorte durante a sua carga).
   - Em cascata: `TBCBOPRO_TBCONVEN` (81.451 `pai_pendente` e 9.004 com 1452), `TBMEDESP`, `TBCBOPRO_TBUNIDAD`, a lotação, a especialidade do profissional e o preço particular.
2. **marcacao_horario:** 0 de 24.030 gravados. `REPACAGD` recebe `restricao_destino_1048` em 23.881 linhas.
3. **parcela_pagar:** 0 de 71.267 gravados. `MFCONPAG` tem 69.785 em `pai_pendente` e 1.482 com 1048.
4. **Recusas por 1048 e 4025:** `TBPROCTO` 9.941, `TBMEDSOL` 3.752 (mais 1.250 com 1062), `RPRPA` 431, `TBCTABAN` 488 (4025, conta bancária com 0 gravados) e `RPLANEVE` 573 (4025, C6, decisão do dono pedida).
5. **Sem gravação:** `TBMATMED` (20.000 em `licenca_nao_comprovada`) e o leito hospitalar (0 gravados).
6. **Outros pendentes:** `FCCTAEXT` e `RECONTAS` têm cerca de 3.170 em `pai_pendente` cada. C6 e C8 seguem como no relato anterior: C8 tem 98 endereços sem IBGE ou sem CEP e 33.161 telefones inválidos.
7. **Ainda não rodaram:** a pré-carga completa sem área e a nova rodada desta conferência depois das correções.
