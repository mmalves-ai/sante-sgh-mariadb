# Rodada 4 do F4: pedidos de motor e de regra aplicados pelo integrador

Código compartilhado: `conector/sante_conector/{sentinela,mapa,carga_mapa}.py`, o verificador (`mapa.verificar_dados`),
a cobertura (`tools/obra/cobertura_conector.py`) e `conector/mapa/declarado/{dependencias,ciclos}.tsv`, com o mapa
regenerado. A prova está em `sintetica_d/exemplo_r4.py` e `testes/test_carga_mapa_r4.py`, que fazem a carga, a
conciliação e a reexecução idempotente na imagem sintética. Cada pedido atendido tem o campo `atendido` em
`saida/<fatia>.json`. O atendimento parcial tem o campo `aplicado_r4`.

## Regras de sentinela (`sentinela.py`)
| Pedido | Fatia | O que entrou |
|---|---|---|
| `_digitos` de DOUBLE inteiro | L5-04 #1, L8-02 #15, L8-03 #5, L8-04 #0 | float `52998224725.0` e o texto `'52998224725.0'` viram os dígitos do inteiro (CPF, CNPJ, `cpf_cnpj`, `inteiro_zeros_esquerda`) |
| documento num campo só | L8-04 #0 | `tipo_pessoa_documento` (`fisica` até 11 dígitos, `juridica` de 12 a 14), `cpf_de_documento` e `cnpj_de_documento` (o do outro tamanho fica NULL sem pendência) |
| contador do último número usado | L8-05 #5 | `inteiro_mais_um` |
| fim de vigência em aberto | L8-11 #14 (c) | `data_fim_aberta:<ano>`: ano >= `<ano>` vira NULL sem pendência |

## Mecanismos da carga (`mapa.py` e `carga_mapa.py`)
| Pedido | Fatia | O que entrou |
|---|---|---|
| fim = início + duração | L6-03 #17, L6-04 #0 | `#data_hora_mais:DATA,HORA,MIN`: a duração vem da linha, pela regra declarada (ex. `minutos_hhmm`), ou da `ref:` da via (encadeada terminada em coluna, ou `@coluna` do destino do pai). Sem duração, `duracao_ausente`; quando passa da meia-noite, `virada_de_dia` |
| condição de coluna | L5-12 #15, L6-03 #18, L7-06 #2, L8-05 #20, L8-10 #0 (A2), L8-11 #1, L8-12 #8 | `se:COL[>T>X][=v1,v2]`: fora da condição, a coluna fica NULL sem pendência, e a próxima concorrente é tentada |
| condição de destino secundário | L6-03 #25, L8-12 #8 | `destino_se:COND`: fora da condição, o secundário não grava (como `opcional`) |
| filtro de linha | L8-03 #1 | `so_se:COND[!regra]`: a linha fora do filtro é recusada com pendência BAIXA e nunca gravada (ex.: `!licenca_nao_comprovada`) |
| `cod:` composto | L5-12 #13 | `cod:<tabela>.(c1,c2)=(=literal,valor)` |
| item desdobrado com referência | L5-01 #10, L6-10 #16, L6-16 #3 (parcial) | o `#item` segue a `ref:` encadeada ou composta da via e aceita `cod:` |
| rótulo com `cod:` | L5-11 #0, L6-16 #3, L8-11 #14 (a) | o rótulo do desdobrado acha o id no destino |
| agrupar no destino principal | L6-05 #14, L7-05 #14, L7-07 #23, L8-11 #2 (c) | `agrupar:C1,..` também no PRINCIPAL: uma linha do destino por grupo, apontada por todos os membros |
| lista do grupo | L6-05 #14 (b) | `#grupo_json:C1,C2` (sem segredo) |
| grupos de leitura sem cabeçalho | L8-10 #0 (A3) | `#grupo_seq@C1,C2` e `#grupo_razao:V@C1,C2`, este na escala do destino; soma zero vira `valor_fora_do_dominio` |
| vários pais na mesma linha do destino | L8-10 #0 (A1) | a chave alternativa repetida não é `pai_ambiguo` quando todos os pais apontam para a MESMA linha do destino (parcelas de um título agrupado) |
| agregado das tabelas filhas | L8-10 #1 | `#filhos_min/max/somar/contar:T1.C1\|T2.C2@FK`; sem valor, `sem_filho_com_valor` |
| natureza pelo maior rateio | L8-12 #7, L8-11 #2 (a), L8-11 #12 | literal `=v` na chave alternativa composta, `max:COL`/`min:COL` com `escolha_pelo_maior` (baixa) e a chave composta num passo seguinte `>(C1,C2,C3)>T` |
| código de várias colunas | L8-03 #2 | `#codigo_derivado:C1+C2+C3:n[:prefixo]` |
| destino principal à escolha | L6-11 #20 | opção `principal` na via |
| `adotar:` no principal | L6-11 #5 | já era aceito pelo verificador e pela carga (sem mudança) |
| secundário fora de `tabelas_destino` | L5-12 #16 | o verificador aceita o secundário nomeado na via de qualquer coluna da tabela, ou com opção de destino numa coluna dele (`antes`, `adotar:`...) |
| cobertura com `MODIFY COLUMN` | L8-05 #13 | `_colunas_ddl` lê `MODIFY COLUMN`. TBTIPPLCONV passou a CARREGA |
| referência por passos em duas fases | conferência da rodada 4 (TBUNIDAD) | a chave alternativa, composta ou encadeada que termina numa tabela de aresta em duas fases (`ciclos.tsv`) e grava em coluna anulável fica para a fase 2, por UPDATE, fora da soma, como a referência simples. Entre colunas concorrentes vale a primeira resolvida |

## Arestas de ordem (`declarado/dependencias.tsv` e `declarado/ciclos.tsv`, mapa regenerado)
- Pedidas pelas fatias:
  - TBUNIDADEMEDIDA -> TBUNICON (L6-10 #19);
  - TBPERTHM -> TBCONVEN (L8-03 #8);
  - TBLOCCON -> TBCENCUS, em duas fases em `ciclos.tsv` (L8-03 #8, L8-11 #4);
  - MFLANCTO -> TBCENCUS (L8-11 #10).
- Achadas pela conferência determinística: a referência declarada cujo ÚLTIMO passo de tabela vinha depois da filha
  na ordem e não tinha aresta. As tabelas do L3, que carregam antes de todas, ficaram de fora. São elas:
  - TBUNIUSE -> TBUNIDAD;
  - TBUSERCON -> TBCONVEN;
  - TBUSUCPL -> TBPROFIS;
  - REPACAGN -> TBCONVEN;
  - RESEGUR -> RICADPAC_TBCONVEN;
  - SIPACAGN -> TBCONVEN;
  - TBUNIDAD -> TBPROFIS, em duas fases em `ciclos.tsv`, porque TBPROFIS -> TBUNIDAD já era duas fases e a unidade
    precisa entrar cedo para as suas filhas;
  - SIAGENDA -> TBPROFIS;
  - SIPARGER -> TBPROFIS;
  - GECADDISPENSACAO -> PRPRESC;
  - FCCRECUN -> TBPROFIS.
- Os outros pedidos de aresta já estavam no mapa e ficaram marcados como atendidos.
- Testes de ordem ajustados: `sintetica_d/l6_03.py` (CARREGADAS). SICTRAGE passa a vir depois de REAGENDA, porque
  SIAGENDA agora espera TBPROFIS.

## O que NÃO foi feito (fica aberto)
- `#arquivo:<COLUNA>` (L6-11 #8, L6-12 #10: PRPAREVOLIMG, PRGEDIMP e o documento assinado). Exige o
  armazenamento de arquivos do produto, que é decisão de modelo e de infraestrutura e não regra do conector.
- Resposta replicada por pai da chave alternativa repetida (L6-11 #18, PRRESPOSTA).
- Referência ao primeiro ou último filho (L6-11 #4). A alternativa sem motor novo existe: PRASSINATURA_DOC com
  `antes;agrupar:` (L6-11 #19).
- Chave composta com valor encadeado `ref:T(ref:U>X,C)` (L8-03 #3, parcial). A condição `se:` da coluna
  concorrente já existe.
- Sequência pela posição do item desdobrado (L6-16 #3, parcial).
- `#seq` estável no diferencial (L7-07 #9).
- DDL e sementes do modelo, que ficam com a trilha F2.2.

## Efeito na cobertura
Antes eram 835 CARREGA, 285 DESCARTE e 65 BLOQUEADA. Depois são 836 CARREGA, 285 DESCARTE e 64 BLOQUEADA
(TBTIPPLCONV). O resto depende de as fatias refazerem as declarações comentadas com os mecanismos novos.

## Validação global
- `python3 -I conector/verificar_mapa.py`: ok.
- `conector/conector.sh testes`: os testes da rodada 4 passam.
- Cinco testes falham, mas já falhavam no commit de partida (`ac0f0b2`), porque a declaração e o teste da própria
  fatia não batem. Todos são do código da fatia:
  - `test_l6_10.test_referencias_no_dominio_certo`;
  - `test_l7_05.Plano.test_consumo_e_lote_nao_sao_descartados`;
  - `test_l7_05.Sintetica.test_esperado_coerente_com_as_linhas`;
  - `test_l8_16.Plano.test_so_as_carregaveis_entram`;
  - `test_l8_16.Plano.test_obrigatorias_do_destino_cobertas`.

## Pedidos de MODELO aplicados (DDL, rodada 4, etapa de modelo)

Lotes novos em `db/migracoes` (convenções do ADR 0002: PK, auditoria, FK RESTRICT em `*_chaves.sql`, CHECK em vez de ENUM,
sem gatilho; só para frente). `python3 -I tools/db/validar_migracoes.py`: 0 erros (3608 tabelas, 13850 FKs). Tabelas novas no
catálogo (`docs/analise/rodada2/final/catalogo.tsv`): `principio_ativo_cliente`, `item_faturavel_tipo_servico`,
`tabela_preco_item_padrao`. Detalhe para a trilha da API: `docs/obra/passagens/F4-pedidos-f22.md`.

Motor: `mapa.ler_ddl` passa a levar ao DDL da conferência o ALTER com `MODIFY COLUMN`, `DROP INDEX` ou `ADD UNIQUE KEY`
(antes só ADD/DROP COLUMN e CHECK: o NOT NULL afrouxado não chegava ao banco descartável nem à cobertura).

| Pedido | Fatia | Arquivo | Falta (fatia ou parte não aplicada) |
|---|---|---|---|
| 1 | L5-01 | `db/migracoes/02_ADM/09` | — |
| 8 | L5-01 | `db/migracoes/02_ADM/09` | não aplicado: periodicidade_aceite_dias mantida para a API (a F2.2 migra e remove) |
| 14 | L5-01 | `db/migracoes/02_ADM/09` | — |
| 3 | L5-03 | `db/migracoes/03_CAD/08` | não aplicado: só (b) registro_excluido.entidade_id; (a), (c) e (d) ficam para a F2.2 |
| 6 | L5-04 | `db/migracoes/03_CAD/08` | — |
| 14 | L5-04 | `db/migracoes/11_SUP/08` | declarar GECADPED/GECADNFS.FONTE_PAG (pedido_compra já tinha a coluna) |
| 5 | L5-05 | `db/migracoes/03_CAD/08` | — |
| 6 | L5-05 | `db/migracoes/03_CAD/08` | — |
| 5 | L5-07 | `db/migracoes/15_RH/06` | — |
| 4 | L5-08 | `db/migracoes/15_RH/06` | L5-12 declara FPPARAM.GERAR_S1210_BAIXA_FINANCEIRO (pagamento_folha, baixa_financeira, manual) |
| 7 | L5-12 | `db/migracoes/15_RH/06` | — |
| 8 | L5-12 | `db/migracoes/15_RH/06` | não aplicado: tributo anulável (a API grava sem ele) e o código oficial anulável; CHECK exige um dos dois |
| 9 | L5-12 | `db/migracoes/15_RH/06` | — |
| 6 | L6-01 | `db/migracoes/04_REC/04` | desdobrar REMODFIC.CLINICA |
| 9 | L6-03 | `db/migracoes/05_AGE/06` | — |
| 20 | L6-03 | `db/migracoes/05_AGE/06` | — |
| 1 | L6-04 | `db/migracoes/05_AGE/06` | — |
| 9 | L6-04 | `db/migracoes/05_AGE/06` | declarar RECANAGE/SICANAGE pela opção (a) |
| 7 | L6-06 | `db/migracoes/06_PEP/17` | — |
| 9 | L6-09 | `db/migracoes/06_PEP/17` | — |
| 20 | L6-10 | `db/migracoes/06_PEP/17` | — |
| 7 | L6-11 | `db/migracoes/06_PEP/17` | — |
| 15 | L6-13 | `db/migracoes/06_PEP/17` | — |
| 16 | L6-13 | `db/migracoes/06_PEP/17` | — |
| 12 | L6-14 | `db/migracoes/07_INT/07` | declarar RIACOMOD.LCONS |
| 15 | L6-14 | `db/migracoes/07_INT/07` | declarar RICTRLOC.ID_TBTIPOACOMOD |
| 17 | L6-14 | `db/migracoes/07_INT/07` | — |
| M5 | L6-15 | `db/migracoes/07_INT/07` | — |
| LEITO_CRITICIDADE_AREA | L6-15 | `db/migracoes/07_INT/07` | TBLEITO.ID_CHCRITICIDADE por complementa |
| INTERNACAO_AUTORIZACAO | L6-15 | `db/migracoes/07_INT/07` | — |
| REGIME_SEMENTE | L6-15 | `db/migracoes/07_INT/07` | — |
| 21 | L6-16 | `db/migracoes/08_CC/05` | declarar os #retrato prontos; não aplicado: só (1) dados_origem; (2) já existia; (3) é da cobertura |
| 1 | L6-18 | `db/migracoes/09_HOT/07` | — |
| 3 | L7-01 | `db/migracoes/10_SADT/09` | declarar SHDOACAO.CODINTER |
| 1 | L7-03 | `db/migracoes/10_SADT/09` | descomentar #SITPEQV e #SITBEXHP; não aplicado: (3) laboratorio_apoio nos destinos de SITPEQV é do gerador do mapa |
| 5 | L7-04 | `db/migracoes/10_SADT/09` | — |
| 11 | L7-04 | `db/migracoes/10_SADT/09` | — |
| 19 | L7-04 | `db/migracoes/10_SADT/09` | — |
| 18 | L7-05 | `db/migracoes/11_SUP/08` | — |
| numero_origem | L7-07 | `db/migracoes/11_SUP/08` | — |
| fornecedor_opcional | L7-07 | `db/migracoes/11_SUP/08` | — |
| principio_ativo_cliente | L7-07 | `db/migracoes/11_SUP/08 e 06_PEP/17` | descomentar #TBPRINC, tirar TBPRINC de catalogos.tsv e sem_carga.tsv, ligações por ref:TBPRINC/principio_ativo_cliente |
| 8 | L7-08 | `db/migracoes/11_SUP/08` | — |
| 9 | L7-08 | `db/migracoes/11_SUP/08` | não aplicado: a especial #texto é do motor |
| 21 | L8-01 | `db/migracoes/12_FAT/12` | — |
| 22 | L8-01 | `db/migracoes/12_FAT/12` | — |
| 2 | L8-02 | `db/migracoes/12_FAT/12` | — |
| 8 | L8-02 | `db/migracoes/12_FAT/12` | — |
| 16 | L8-02 | `db/migracoes/03_CAD/08` | — |
| 20 | L8-02 | `db/migracoes/12_FAT/12` | — |
| 21 | L8-02 | `db/migracoes/12_FAT/12` | declarar TBCOOPER P_R_CO/P_R_PR/P_R_EX/P_R_IN |
| 10 | L8-03 | `db/migracoes/12_FAT/12` | TBTIPPRO pela tabela nova |
| 12 | L8-03 | `db/migracoes/12_FAT/12` | TBCTRTHM pela declaração pronta |
| 13 | L8-03 | `db/migracoes/12_FAT/12` | — |
| 11 | L8-04 | `db/migracoes/12_FAT/12` | TBTIPPRO pela tabela nova |
| 7 | L8-05 | `db/migracoes/12_FAT/12` | — |
| 9 | L8-05 | `db/migracoes/14_FIN/14` | não aplicado: tipo de ato e subtipo da diária sem tabela definida |
| 15 | L8-05 | `db/migracoes/12_FAT/12` | — |
| 16 | L8-05 | `db/migracoes/12_FAT/12` | — |
| 19 | L8-05 | `db/migracoes/12_FAT/12` | — |
| 13 | L8-06 | `db/migracoes/12_FAT/12` | REPROEXT/RIPROEXT pela declaração comentada |
| 20 | L8-06 | `db/migracoes/12_FAT/12` | FCLANEXT e FCLANEXTSEQITEM |
| 0 | L8-07 | `db/migracoes/13_SUS/06` | — |
| 1 | L8-08 | `db/migracoes/13_SUS/06` | LOCALIZACAO_NO_CHECK = True na sintetica_d/l8_08.py |
| 11 | L8-08 | `db/migracoes/12_FAT/12` | FCCTRLANCIHA por complementa |
| 2 | L8-10 | `db/migracoes/14_FIN/14` | L8-11 e L8-12 trocam ID_MFCABECLANC por ref:MFCABECLANC |
| 6 | L8-11 | `db/migracoes/14_FIN/14` | — |
| 15 | L8-11 | `db/migracoes/14_FIN/14` | L8-11 declara MFPARAM em parametro_valor (chaves financeiro.*) |
| 5 | L8-12 | `db/migracoes/14_FIN/14` | — |
| 4 | L8-13 | `db/migracoes/16_SGO/12` | — |
| 20 | L8-15 | `db/migracoes/03_CAD/08` | PSBENEFI NUM_DECLARACAO_OBITO e ID_TBCID10_OBITO |
| 6 | L8-16 | `db/migracoes/17_INTG/05` | — |
| 1 | L8-17 | `db/migracoes/03_CAD/08` | — |
| 6 | L8-18 | `db/migracoes/19_REL/04` | TBEDITPARAM.VISIVEL |
| 11 | L8-18 | `db/migracoes/19_REL/04` | — |

Não aplicados (não são DDL mínimo ou dependem de fonte oficial ou decisão), registrados no F4-pedidos-f22.md:

- L5-01 (9): permissões de prontuário por usuário: estrutura do produto (acao_sistema/parametro_definicao) a definir pela F2.2
- L5-05 (12): ISS por município do cliente: desenho de retenção maior (F2.2)
- L5-05 (13): configuração fiscal da mantenedora (NFS-e, ECD): desenho amplo (F2.2)
- L5-07 (3): carregadores oficiais do eSocial: precisam da fonte oficial (trilha de catálogos)
- L5-09 (2): idem: carregador oficial do eSocial
- L5-12 (4): carregador oficial das tabelas legais da folha (trilha de catálogos)
- L8-09 (8): carregadores oficiais da ECD e NIRE (trilha de catálogos)
- L8-11 (16): carregador oficial de codigo_receita_federal: fonte da Receita Federal (TBFINCODRECOL segue BLOQUEADA, catalogo_oficial_faltante)
- L8-15 (12): carregador da taxa de saúde suplementar (fonte da ANS)
- L6-09 (2): conferência de redundância no modelo (decisão)
- L6-09 (6): decisão do dono sobre PRSINAIS
- L6-09 (10): decisão grade x unidade
- L6-09 (11): significado da letra A/E/M a confirmar
- L6-10 (17): decisão grade x bloco
- L6-12 (13): lista de colunas sem destino a detalhar por tabela
- L6-13 (10): documento_emitido tipo receita: depende do gerador do mapa
- L6-15 (M2b): sementes de catálogos-base da internação (carater_admissao, modalidade, situacao_leito...): carga inicial do 'criar novo cliente' com domínio de produto a fechar
- L6-15 (LEITO_DIARIA): diária por leito: decisão de modelo de cobrança
- L6-16 (16): ficha anestésica do ato migrado: desenho do PEP cirúrgico
- L7-02 (4): laboratório de apoio por coluna: mecanismo do motor
- L7-06 (7): numeração na virada: regra do produto
- L7-06 (14): retenção por credor: desenho fiscal (F2.2)
- L8-06 (17): glosa agrupada opcional: mecanismo do motor
- L8-08 (12): domínio do tipo de prestador SUS: decisão de catálogo
- L8-08 (15): autorizador e órgão gestor SUS: desenho (F2.2)
- L8-15 (10): foto da pessoa: armazenamento de arquivos do produto

Efeito na cobertura: 836 -> 841 CARREGA, 64 -> 59 BLOQUEADA (FPRUBRICA{FGTS,INSS,IRRF,SIND}_FPEVENTO e
FPTPEVENTOAUT_TBEMPHOS). TBPRINC (aguarda_modelo) e MFPARAM (parametro_definicao_faltante) têm o modelo pronto e saem da
lista quando L7-07 e L8-11 declararem; ATCONTA (aguarda_fonte_atendimento_conta) depende só das declarações de L8-05/L8-06;
TBFINCODRECOL depende do carregador oficial (pedido 17 do L8-11).
Ajustes de fatia exigidos pela própria aplicação: `colunas.d/L6-18.tsv` (ID_RISETOR_ORIGEM/DESTINO com destino, a guarda do
test_l6_18 exige) e `sintetica_d/l6_12.py` (alergia sem princípio: CHECK 4025 no lugar do NOT NULL 1048).

## Resíduo do motor da rodada 4 (integrador, etapa sozinho no código compartilhado)
Prova: `sintetica_d/exemplo_r4b.py` e `testes/test_carga_mapa_r4b.py` (carga, conciliação e reexecução idempotente
na imagem sintética, banco descartável `cliente_cfexemplo_r4b`). Os pedidos atendidos têm o campo `atendido`.

| Pedido | Fatia | Mecanismo | Exemplo de uso (`colunas.d`) |
|---|---|---|---|
| competencia_carga | L7-07 #11 | regra declarada vale para `=@data_carga` (e `=~@data_carga`) | `GEVALMEM	=@data_carga	saldo_lote.competencia	data_primeiro_dia_mes` |
| Pedido 22 | L8-12 #9 | `#dif:A,B` (A - B) e `#soma:A,B,..`; nulo = 0, todas nulas = NULL, texto não numérico = NULL com `valor_fora_do_dominio`; a regra da linha vale para o RESULTADO | `MFCONPAG	#dif:VALOR,PAGO	parcela_pagar.saldo	piso:0` |
| exige_dominio | L8-12 #6 | opção de coluna (com `depara=valores`): valor sem par RECUSA a linha (`valor_fora_do_dominio`, média) em vez de cair no padrão do destino; o verificador exige `depara=valores` | `MFCCCONV	DEV	...situacao		valores	exige_dominio` |
| senao | L6-05 #9 | opção de coluna concorrente: quando ela preenche o destino, a pendência `valor_fora_do_dominio` das declarações ANTERIORES da mesma coluna sai | `PRFREQUENCIA	NOME	frequencia.tipo		valores	senao` (depois de `NUM`) |
| Pedido 25 | L8-12 #12 | `=~x` em coluna concorrente: `valor_presumido` só quando o literal é o valor gravado | `TBTPCONTA	=~corrente	conta.natureza` depois da descrição |
| resposta replicada por campo | L6-11 #18 | opção `por_pai` na via de uma coluna do destino PRINCIPAL com `ref:T.K` ou `ref:T.(K1,K2)=(C1,C2)` (sem `max:`/`@coluna`): uma linha do destino POR PAI da chave alternativa (item `<chave>/<dt>/<chave do pai>`, conciliado como o desdobrado); sem valor: `sem_item_a_gravar`; sem pai: `pai_inexistente`; pai pendente recusa a linha. Não combina com `desdobrar`, `agrupar` nem `complementa` (erro do verificador) | `PRRESPOSTA	ID_PRPERGUNTA	modelo_campo_opcao.modelo_campo_id			ref:PRPADEVOL.ID_PRPERGUNTA;por_pai` |

Já tinham mecanismo (rodada 4, seção acima) e só pedem a fatia REFEITA (a causa `regra_faltante` vem do comentário
antigo da declaração): REPACAGI, REPACAGD, SIPACAGI, SIPACAGD (`#data_hora_mais`, L6-03/L6-04), GEKONCDC (`agrupar:` no
principal, L7-05), TBSEGUIA (`inteiro_mais_um`, L8-05), TBKITPRO (opção `principal` + `agrupar:`, L6-11),
PRASSINATURA_CAB (documento pelo grupo de PRASSINATURA_DOC e `ref:T.K/<destino>` com vários pais da mesma linha,
L6-11/L6-12), MFDESACR (`se:` e agora `#dif`, L8-12), GERASVALFINAL/GERASVALINICIAL (agora `=@data_carga` com regra,
L7-07), TBREFUNI/TBREFMEMTUSS (`so_se:...!licenca_nao_comprovada`, L8-03), PRRESPOSTA (agora `por_pai`, L6-11).

Não aplicados nesta etapa (seguem pedidos abertos):
- `#arquivo:<COLUNA>` (M4; PRPAREVOLIMG, PRGEDIMP, documento assinado): exige gravar o binário no armazenamento de
  objetos do produto (S3 compatível, `arquivo.chave_armazenamento`), que o conector ainda não alcança (sem rede de
  saída); depende da decisão de armazenamento local (ADR 0004, em elaboração na trilha principal).
- componente encadeado na chave composta `ref:TBTABTHM(ref:TBCONVEN>THM,THM)` (TBPACTHM, L8-03 #3).
- tributo nativo semeado pelo produto (TBINTIMP, L8-11 #15b): é semente do modelo (trilha F2.2), não motor.
- MFCTAREC: aguarda a medição na imagem de referência (L8-11 #13), não motor.

## Conferidor da rodada 4, tentativa 2 (sozinho no código compartilhado)
Prova: `testes/test_carga_mapa_r4c.py` (forma e armazenamento) e a conciliação das fatias L6-11, L6-12 (#arquivo), L5-06
(#item@) e L8-03/L8-04/L8-05 (modelo 12_FAT/13). Decisões em `F4-decisoes-destino.md` (seção do conferidor).

| Pedido | Fatia | Mecanismo ou modelo | Exemplo de uso (`colunas.d`) |
|---|---|---|---|
| #arquivo (M4) | L6-11, L6-12 | `#arquivo:<COLUNA>[:<finalidade>]`: binário no armazenamento local (`ARQUIVOS_RAIZ/<banco>/migracao/<sha2>/<sha256>`, gravado uma vez, só leitura) e id do registro em `arquivo`; sem raiz: `armazenamento_indefinido` (alta); a conferência usa uma pasta descartável | `PRGEDIMP	#arquivo:DOCUMENTO:anexo	anexo_prontuario.arquivo_id` |
| 14 | L5-06 | `#item@<COLUNA>`: item daquela coluna do `desdobrar` com regra, de-para e referência próprios (o verificador exige a coluna no desdobrar) | `TBCONVEN	#item@ID_TBCONVCONSMAT	regra_consistencia_lancamento.opcao	texto_resumo:40		ref:TBCONVCONSMAT>NOME` |
| 16 / 25 / 22 | L8-03, L8-04, L8-05 | modelo `12_FAT/13`: equivalência sem fonte (referência unificada), `item_referencia_matmed_id` na exceção de emissão e no preço negociado | `TBPERMEM	ID_TBMATMED	preco_negociado_matmed.item_referencia_matmed_id	chave_origem		ref:TBMATMED` |

Não aplicado: componente encadeado na chave composta (TBPACTHM, L8-03 pedido 4), única tabela ainda BLOQUEADA.
