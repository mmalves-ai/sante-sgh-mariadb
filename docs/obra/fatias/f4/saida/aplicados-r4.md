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
