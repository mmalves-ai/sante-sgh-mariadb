# Continuidade da rodada 5 (ADR 0006 e 0007): contagem do conferidor, tentativa 1 (2026-11-21)

Resultado: **não fechou**. Ainda há 92 tabelas bloqueadas e 42 de 57 fatias com erro na autoconferência. Detalhe abaixo.
Números da imagem de referência (só contagens).

## Contagem
- tabelas carregáveis 1185 {'CARREGA': 1052, 'DESCARTE': 41, 'BLOQUEADA': 92}
- registros da imagem de referência: total 166755176 {'CARREGA': 156485531, 'DESCARTE': 227895, 'BLOQUEADA': 10041750}
- cobertos (carrega + não copia com prova): 93.98%
- não copiam, por tipo de prova: {'prova_derivado': 29, 'sem_carga:catalogo_oficial': 11, 'sem_carga:licenciado': 1}
- tabelas com prova em provas.tsv (tipo): {'derivado': 31}

Tipo da prova das 41 tabelas que não são copiadas:
- 29 com **prova derivada** linha a linha (`declarado/provas.tsv`, tipo `derivado`).
- 11 por **catálogo oficial** ligado pelo código (carregador versionado).
- 1 pelo **espelho licenciado** da base.
- Nenhum descarte por julgamento. A única tabela com `descarte_sem_prova` está entre as bloqueadas.

## Bloqueadas por fatia (cobertura)
- L5-07 20 FPADMESOCIAL FPAFAST_COD FPAFAST_RAIS FPALIQRATCNAE FPASOEXAMEORD FPASOINDRESUL FPASOINTEXAME FPASORESULTADO FPASOTIPO FPBR_PDH FPCATTIPO FPCATTPEMIS FPCATTPLOCACD FPCATTPREG FPCAUSA_AFASTAMENTO FPCLASSIFTRIB FPCODALIQFPAS FPCOND_TRAB_IMIGRANTE FPCOR FPDOSE_VACINA
- L5-08 19 FPEPC FPESOCAUTORIA FPESOCCADRESEV FPESOCDESONER FPESOCINDAVISO FPESOCINDPROC FPESOCINDSUSP FPESOCORIRETIF FPESOCPARAMS1210 FPESOCPTOELET FPESOCTPAVISO FPESOCTPJORTRAB FPESOCTRABTEMP FPEXPAGNOCIVO FPGRAUEXPAGNOC FPINDICDECPRO FPINTAGRUP FPINTROTINA FPLOTACAOTRIB
- L5-09 19 FPMOTDESLIG FPMOTESTABILI FPMTCANCELAVI FPNIVELESTAG FPOCOR_SEFIP FPPROCESSOTEOR FPPROCTRAB_ESOCIAL_CR FPRESC_CAGED FPRESC_CAUSA FPRESC_RAIS FPRESC_SEFIP FPSAQUE FPTEMPO_RESID_TRAB_IMIGRANTE FPTIPOAVISO FPTIPO_CONTRATO FPTPACESSORIA FPTPACIDTRANS FPTPAVISORESC FPTPDEFICIEN
- L5-10 16 FPTPDEPENDENT FPTPDEPENDENTREINF FPTPEVENTOAUT FPTPFOLHAESOC FPTPONUS FPTPONUSREMUN FPTPPENSAOALI FPTPPROCESSO FPTPREGIMEPRE FPTPREGIMETRA FPTPREGJORNAD FPTPREINTEG FPTPRESCDIRET FPTPVALE FPTP_ARQ_EMPREGADORWEB FPTP_EVENTO_SIND
- L5-11 4 FPTP_SAL FPTP_TREINAMENTO_CAPACITACAO POTPJORNADA STEMITENTE
- L6-11 1 PRAGRUP_PRFILTROCLASSIF
- L6-14 1 TBTISSREGINT
- L7-05 1 GECOMPRA
- L7-06 1 GEULTDOCGER
- L7-07 1 GEUSERS_TBCLASSI
- L7-08 2 GEPARAM GEQTDELOTEVALLOTEDOCSAIDA
- L8-01 2 FCPROCUNIBHMED FCREFUND
- L8-03 4 TBMATMED TBPACTHM TBREFMEMTUSS TBREFUNI
- L8-05 1 TBVLRMEM

## Aplicado nesta conferência
- **Pedidos r5-1 e r5-2 das listas legais do RH** (L5-07 a L5-10): respondidos por decisão, registrada em
  `F4-decisoes-destino.md`. A lista entra como lista do hospital em `parametro_opcao`, sob `parametro_definicao`
  `rh.lista.<nome>`, que a própria carga cria. Nada é gravado em `codigo_esocial` antes do carregador oficial. As
  fatias L5-07 a L5-11 refazem as declarações.
- **Motor (verificador)**: o prefixo de `#codigo_derivado` aceita texto livre (L6-09, `TBNUMDOSE`).
- **Conferência (`conferencia.ddl_destino`)**: o banco descartável cria também as tabelas consultadas por `cod:` e as
  usadas pelo `PREPARO_DESTINO`, exceto as que o próprio preparo cria. Isso resolve o erro 1146 de L6-07 e L7-06 e
  mantém L8-04 e L6-01 verdes.
- **Correções de declaração**: SQL das provas `GETPSALDO` e `TBLOCSUS` sem `;`; par de valores de
  `TBDIGITAL_INTEG_TYPE.TABLE_NAME_SECONDARY` (L8-16).

## Validação
- `verificar_mapa` ok; `fatiar_conector --conferir` ok; `validar_migracoes` ok.
- `conector.sh testes`: Ran 1198 tests in 1329.859s FAILED (failures=22, errors=9, skipped=10, expected failures=2)  (antes das correções da conferência).
- Ponta a ponta do painel: 2 de 4 testes falharam (Importar: `FalhaExecucao: conciliação por entidade`; Sincronizar).
- `exemplo_r5`: `segredo_aguarda_cofre` 1/0, que depende da chave mestra do ambiente de conferência.
- Autoconferência das fatias: 15 ok (L6-01 L6-05 L6-13 L7-03 L8-04 L8-07 a L8-14 L8-18 L8-19); erro nas demais:
  - L5-03: ; prova de não copiar de TBTPPERM_RICADPAC não conferiu (0 divergentes, 2 faltando, 0 sobrando) 
  - L5-02: ; prova de não copiar de TBTIPOOID não conferiu (0 divergentes, 10 faltando, 0 sobrando); prova de não copiar de TBTIPOREPRE não conferiu (0 divergentes, 2 faltando, 0 sobrando)
  - L5-04: ; conciliação divergiu em profissional (origem 4, destino 2, recusados 2) 
  - L5-07: ; cobertura: FPASORESULTADO BLOQUEADA (mecanismo_pedido); cobertura: FPCAUSA_AFASTAMENTO BLOQUEADA (mecanismo_pedido)
  - L5-05: ; pendências de TBEMPHOS diferentes do esperado: adotado_existente=1/2, mescla_conflito_origem_guardada=1/0, re; TBEMPHOS gravou 2, esperado 3
  - L5-06: ; FAIL: test_tabelas_e_colunas_da_imagem_cobrem_o_plano (testes.test_l5_06.SinteticaL506) FAILED (failures=2); testes da fatia (test_l5_06.py): FAIL: test_carregadas_em_ordem_e_sem_carga_fora (testes.test_l5_06.PlanoL506)
  - L5-08: ; cobertura: FPESOCINDSUSP BLOQUEADA (mecanismo_pedido); cobertura: FPEXPAGNOCIVO BLOQUEADA (mecanismo_pedido)
  - L5-11: ; cobertura: FPTP_TREINAMENTO_CAPACITACAO BLOQUEADA (mecanismo_pedido); cobertura: STEMITENTE BLOQUEADA (mecanismo_pedido) 
  - L5-09: ; cobertura: FPPROCTRAB_ESOCIAL_CR BLOQUEADA (mecanismo_pedido); cobertura: FPTIPOAVISO BLOQUEADA (mecanismo_pedido)
  - L5-01: ; ERROR: test_recorte_com_a_aresta_de_ordem (testes.test_l5_01.ConferenciaL501); conciliação na imagem sintética não rodou: in _read_packet packet.raise_for_error() File "/usr/local/lib/p
  - L5-12: ; pendências de TBEMPHOS diferentes do esperado: adotado_existente=1/2, mescla_conflito_origem_guardada=1/0, re; TBEMPHOS gravou 5, esperado 6
  - L5-10: ; cobertura: FPTPFOLHAESOC BLOQUEADA (mecanismo_pedido); cobertura: FPTPREGJORNAD BLOQUEADA (mecanismo_pedido)
  - L6-04: ; conciliação na imagem sintética não rodou: in _read_packet packet.raise_for_error() File "/usr/local/lib/p; testes da fatia (test_l6_04.py): ERROR: test_r5_agenda_de_cadeiras_e_parametros (testes.test_l6_04.L604) FAILE
  - L6-02: ; pendências de TBREFCANCMODTP diferentes do esperado: adotado_existente=7/9, restricao_destino_1062=1/0 ; TBREFCANCMODTP gravou 4, esperado 5
  - L6-07: ; conciliação na imagem sintética não rodou: in _read_packet packet.raise_for_error() File "/usr/local/lib/p; testes da fatia (test_l6_07.py): FAIL: test_esperado_da_imagem_sintetica (testes.test_l6_07.L607) FAILED (fail
  - L6-08: ; PRPARRECMED gravou 2, esperado 1; conciliação divergiu em informacao_clinica_operadora (origem 7, destino 6, recusados 1) 
  - L6-03: ; conciliação divergiu em motivo_bloqueio_agenda (origem 3, destino 0, recusados 0); conciliação divergiu em agenda_escala#2 (origem 7, destino 0, recusados 3)
  - L6-06: ; FAIL: test_de_para_de_valores_declarado (testes.test_l6_06.L6_06) FAILED (failures=1, errors=1) ; testes da fatia (test_l6_06.py): ERROR: test_r5_semente_do_produto_cobre_as_chaves_com_o_tipo_certo (testes.te
  - L6-09: ; PRPARRECMED gravou 2, esperado 1; conciliação divergiu em informacao_clinica_operadora (origem 7, destino 6, recusados 1) 
  - L6-10: ; PRPARRECMED gravou 2, esperado 1; conciliação divergiu em informacao_clinica_operadora (origem 7, destino 6, recusados 1) 
  - L6-14: ; cobertura: TBTISSREGINT BLOQUEADA (mudanca_coordenada_L6-15) 
  - L6-12: ; PRALERGIAPACTMP gravou 0, esperado 2; pendências de PRALERGIAPACTMP_TBPRINC diferentes do esperado: codigo_inexistente_destino=0/1, pai_pendente=3/
  - L6-17: ; conciliação na imagem sintética não rodou: in _read_packet packet.raise_for_error() File "/usr/local/lib/p
  - L6-18: ; conciliação na imagem sintética não rodou: in _read_packet packet.raise_for_error() File "/usr/local/lib/p; testes da fatia (test_l6_18.py): ERROR: test_continuidade_r5 (testes.test_l6_18.Plano) FAILED (errors=1)
  - L7-01: ; conciliação na imagem sintética não rodou: in _read_packet packet.raise_for_error() File "/usr/local/lib/p; testes da fatia (test_l7_01.py): ERROR: test_cobertura_total_carrega_ou_descarta (testes.test_l7_01.L701) FAIL
  - L6-16: ; pendências de CCAGENDA diferentes do esperado: pai_inexistente=14/3, restricao_destino_4025=10/6, valor_presu; pendências de CCLANCIR diferentes do esperado: adotado_existente=0/1
  - L7-02: ; SIPARLAB gravou 2, esperado 1; testes da fatia (test_l7_02.py): FAIL: test_responsavel_do_laboratorio (testes.test_l7_02.Plano) FAILED (failu
  - L7-04: ; conciliação na imagem sintética não rodou: _read_packet packet.raise_for_error() File "/usr/local/lib/pyth
  - L6-15: ; conciliação divergiu em trilha_auditoria (origem 2, destino 0, recusados 0); reexecução não foi idempotente (puladas 117 de 119, 0 linhas novas) 
  - L7-06: ; FAIL: test_ddl_so_das_tabelas_da_fatia (testes.test_l7_06.Sintetica); conciliação na imagem sintética não rodou: in _read_packet packet.raise_for_error() File "/usr/local/lib/p
  - L7-08: ; cobertura: GEPARAM BLOQUEADA (mecanismo_pedido); testes da fatia (test_l7_08.py): FAIL: test_rodada3_movimentos_requisicao_dispensacao (testes.test_l7_08.Fatia
  - L7-05: ; cobertura: GECOMPRA BLOQUEADA (mecanismo_pedido) ; testes da fatia (test_l7_05.py): ERROR: test_consumo_somado_por_grupo (testes.test_l7_05.Conferencia) FAILED (
  - L6-11: ; PRITEMNAOPAD_TBPRINC gravou 0, esperado 2; PRITENSKITMED gravou 2
  - L7-07: ; FAIL: test_bloqueadas_visiveis_com_o_pedido (testes.test_l7_07.PlanoL707) FAILED (failures=2); testes da fatia (test_l7_07.py): FAIL: test_bloqueadas_so_as_que_esperam_pedido (testes.test_l7_07.PlanoL707)
  - L8-02: ; prova de não copiar de RPRPA_TBCBOPRO não conferiu (0 divergentes, 3 faltando, 0 sobrando) 
  - L8-01: ; conciliação divergiu em guia_fonte_pagadora (origem 10, destino 6, recusados 4); cobertura: FCREFUND BLOQUEADA (licenciado_copiado:edicao_referencia_matmed,fonte_referencia_matmed,preco_refer
  - L8-06: ; pendências de TBTISSWEBSERV diferentes do esperado: mescla_conflito_origem_guardada=3/0 ; testes da fatia (test_l8_06.py): FAIL: test_conta_e_guia_da_internacao (testes.test_l8_06.Plano) FAILED (failu
  - L8-03: ; cobertura: TBMATMED BLOQUEADA (licenciado_copiado:item_referencia_matmed); cobertura: TBREFUNI BLOQUEADA (pai_nao_carregado:TBMATMED) 
  - L8-05: ; pendências de TBVLRMEM diferentes do esperado: adotado_existente=1/0; testes da fatia (test_l8_05.py): FAIL: test_esperado_coerente_com_as_linhas (testes.test_l8_05.Sintetica) FAIL
  - L8-16: ; pendências de TBDIGITAL_INTEG_TYPE diferentes do esperado: valor_fora_do_dominio=2/0, valor_presumido=1/0 ; testes da fatia (test_l8_16.py): ERROR: test_obrigatorias_do_destino_cobertas (testes.test_l8_16.Plano) FAILED
  - L8-15: ; FAIL: test_descartadas_com_causa_de_produto (testes.test_l8_15.Plano); PSTPSVIGENCIA gravou 1, esperado 2
  - L8-17: ; conciliação divergiu em trilha_auditoria (origem 2, destino 0, recusados 0); reexecução não foi idempotente (puladas 50 de 52, 0 linhas novas) 

## Conferidor, tentativa 2 (2026-11-21)
### Contagens (cobertura_conector.py, 1185 tabelas carregáveis)
- **Carregam: 1136** (eram 1126 na largada desta tentativa e 836 na largada da rodada).
- **Não copiam, com prova: 41**:
  - 29 com prova de conciliação do tipo `derivado` (`declarado/provas.tsv` + `provas.d/`):
    - 24 `mecanismo_do_produto`;
    - 3 `duplicado`;
    - 2 `catalogo_oficial`.
  - 11 `catalogo_oficial` ligados pelo código (ADR 0006, 4).
  - 1 `licenciado` no espelho padrão (ADR 0006, 3).
- **Bloqueadas: 8** (eram 18):
  - L6-11 PRAGRUP_PRFILTROCLASSIF (DDL do vínculo do filtro por classificação);
  - L7-05 GECOMPRA (DDL `historico_compra_insumo`);
  - L7-06 GEULTDOCGER (regras de competência e `adotar_maior`);
  - L7-07 GEUSERS_TBCLASSI (DDL de `usuario_estoque_classificacao`);
  - L7-08 GEPARAM (semente de `parametro_definicao` do estoque);
  - L7-08 GEQTDELOTEVALLOTEDOCSAIDA (DDL `movimento_lote.quantidade_liquida`);
  - L8-01 FCPROCUNIBHMED (`#grupo_seq@*`);
  - L8-03 TBPACTHM (domínio do TIPO na referência).
- **Registros da imagem de referência:**

  | Situação | Registros | % do total (166.297.677) |
  |---|---:|---:|
  | Carregam | 164.216.433 | 98,75% |
  | Não copiam, com prova | 227.895 | 0,14% |
  | **Cobertos (soma das duas linhas)** | **164.444.328** | **98,89%** |
  | Bloqueados | 1.853.349 | 1,11% |

  Sete tabelas não têm contagem na ficha.

### Aplicado
- **Cobertura:** `licenciado_copiado` não bloqueia mais a linha do hospital gravada no espelho (pedidos R5-1 e R5-4).
  - Vale quando a tabela filtra a licença por linha e não tem fonte licenciada literal.
  - Com isso carregam TBMATMED, FCREFUND, TBVLRMEM, TBREFMEMTUSS e TBREFUNI.
  - As marcas T/F foram aceitas no filtro de TBMATMED e TBREFMEMTUSS.
- **L5-11:** FPTP_SAL, FPTP_TREINAMENTO_CAPACITACAO, POTPJORNADA e STEMITENTE carregam como listas do hospital.
- **L6-15:** TBTISSREGINT carrega em `regime_atendimento_internacao` (mudança coordenada da L6-14).
  - O preparo da fatia passou a gravar as colunas obrigatórias dos catálogos reais.
- **Conferência (`conferencia.py`):**
  - O pai externo lido na origem fica fora da conciliação e da conta de idempotência.
  - O preparo roda sem modo estrito, só na sessão. O CHECK e a FK continuam valendo.

### Validação
- `verificar_mapa`, `fatiar_conector --conferir` e `validar_migracoes`: ok.
- `cobertura_conector.py --falhar-se-bloqueada`: **vermelho** (8 bloqueadas).
- `conector.sh testes`: Ran 1197 tests, FAILED (failures=22, errors=8).
- Ponta a ponta do painel: **não rodado** nesta tentativa (orçamento de turnos).
- Autoconferência: **22 de 57 fatias ok**.
  - Fatias ok: L5-07 a L5-11, L6-01, L6-03, L6-05, L6-13, L6-15, L7-03, L8-04, L8-07 a L8-09, L8-11 a L8-14 e
    L8-17 a L8-19.
  - As causas das 35 vermelhas estão nos avisos devolvidos ao orquestrador.
