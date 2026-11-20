# Rodada 2: resumo do modelo físico

Data: 20/11/2026. Fonte dos números: `docs/analise/rodada2/final/` (`catalogo.tsv`, `mapa-mv.tsv`,
`mapa-spdata.tsv` e `cobertura.md`), gerados por `tools/obra/integrar_rodada2.py`.

## Situação do verificador

- O verificador fecha com **0 erros e 1 aviso** (a regra de paridade estrutural, abaixo).
- **MV:** as 8.867 tabelas de origem têm destino explícito.
- **SPDATA:** as 1.503 tabelas com dados têm destino explícito.
- **Nomes:** nenhuma tabela do catálogo ficou com nome antigo depois de um renome.
- **Verificação adversarial:** todas as linhas `ACEITA` dela estão aplicadas no catálogo final, conferidas por módulo, tipo e fase.

## Conferência independente do orquestrador (2026-11-20)

Feita depois do workflow, **com código separado** do script dos agentes, sobre os arquivos de `final/`.

| Conferência | Resultado |
|---|---|
| Script de integração alterado por um agente | Auditado: as 16 checagens originais e o critério de falha estão intactos; as mudanças só tratam renomes e correções |
| MV: 8.867 tabelas de origem | **OK**: 8.867 com destino, nenhuma duplicada |
| SPDATA: 1.503 tabelas com dados | **OK**: 1.503 com destino, nenhuma duplicada |
| Destino `TABELA` fora do catálogo | **OK**: 0 |
| Descrição copiada do descritivo do MV | **OK**: 0 |
| Descrição citando tabela de origem | 4 casos, todos falso positivo: códigos oficiais da EFD-REINF (R-1000, R-4020) |
| Nome próprio idêntico a nome de tabela do SPDATA | **OK**: 0 |
| Nome próprio idêntico a nome de tabela do MV | **87**: palavras comuns de negócio (`paciente`, `banco`, `caixa`, `usuario`) e termos oficiais (`apac`, `guia_tiss`, `cfop`, `plano_contas`, `motivo_glosa`). Nenhum usa abreviação própria do MV. Recomendação: manter. **Decisão do dono** |
| **Tabelas que recebem dado do SPDATA marcadas F7 ou F8** | **Falha corrigida.** Eram 150 tabelas, entre elas pedido de compra (mais de mil linhas), integração contábil, princípio ativo e bancos. Se o conector leva o dado no dia 0, a tabela tem de existir na virada. **Regra de paridade estrutural** incluída no script: toda tabela própria que recebe dado do SPDATA é F3. A tela pode continuar F7 ou F8 |
| Grupo 08: 132 erros em 147 linhas verificadas | Erro sistemático e mecânico (linhas de mecanismo sem fase), já corrigido; os destinos estavam certos |
| Amostra de 22 mapeamentos do MV com dados, conferidos à mão | Coerentes. Exemplos: atividade econômica (CNAE), telefone da pessoa, requisição de exame, retenção de título |
| Linhas de mecanismo ainda sem fase | 23 (informativo; mecanismo é transversal). Pendência menor |
| Tabelas F3 sem nenhuma origem | 147: estrutura nova para prática que já existe (conciliação bancária, recebimento do particular, fechamento do censo, pedidos do titular LGPD). Revisar na F1.3 |

## Números finais

### Tabelas próprias: 3.500

| Fase | Tabelas |
|---|---:|
| F3 (paridade: o que a Rede usa e toda tabela que recebe dado do SPDATA) | 1.658 |
| F7 (obrigação legal, operadora e o que a Rede não usa hoje) | 1.105 |
| F8 (evolução) | 737 |
| **Total** | **3.500** |

| Tipo | Tabelas |
|---|---:|
| principal | 863 |
| item | 740 |
| domínio | 670 |
| configuração | 531 |
| vínculo | 394 |
| histórico | 195 |
| catálogo público | 107 |
| **Total** | **3.500** |

### Por módulo

| Módulo | Total | principal | item | domínio | vínculo | histórico | configuração | catálogo público | F3 | F7 | F8 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ADM | 155 | 35 | 18 | 28 | 24 | 25 | 25 | 0 | 128 | 14 | 13 |
| SIS | 17 | 3 | 5 | 1 | 1 | 3 | 4 | 0 | 9 | 8 | 0 |
| REL | 77 | 16 | 24 | 7 | 14 | 5 | 11 | 0 | 32 | 2 | 43 |
| CAD | 162 | 33 | 19 | 49 | 27 | 5 | 8 | 21 | 87 | 42 | 33 |
| REC | 52 | 10 | 1 | 17 | 7 | 4 | 11 | 2 | 44 | 6 | 2 |
| AGE | 75 | 17 | 9 | 13 | 21 | 3 | 12 | 0 | 34 | 3 | 38 |
| PEP | 521 | 94 | 99 | 155 | 67 | 25 | 76 | 5 | 297 | 117 | 107 |
| INT | 121 | 43 | 17 | 36 | 6 | 6 | 11 | 2 | 73 | 14 | 34 |
| CC | 109 | 28 | 30 | 27 | 8 | 1 | 15 | 0 | 53 | 40 | 16 |
| HOT | 154 | 63 | 24 | 40 | 10 | 2 | 12 | 3 | 50 | 36 | 68 |
| SADT | 217 | 44 | 41 | 44 | 27 | 15 | 46 | 0 | 113 | 57 | 47 |
| SUP | 235 | 70 | 60 | 40 | 25 | 14 | 23 | 3 | 128 | 73 | 34 |
| FAT | 296 | 51 | 59 | 41 | 31 | 19 | 91 | 4 | 200 | 57 | 39 |
| SUS | 100 | 24 | 27 | 5 | 6 | 3 | 17 | 18 | 28 | 69 | 3 |
| FIN | 428 | 116 | 109 | 55 | 49 | 23 | 56 | 20 | 174 | 158 | 96 |
| RH | 151 | 49 | 40 | 19 | 6 | 9 | 13 | 15 | 89 | 51 | 11 |
| SGO | 419 | 107 | 119 | 63 | 34 | 16 | 73 | 7 | 50 | 276 | 93 |
| INTG | 84 | 27 | 12 | 7 | 14 | 6 | 12 | 6 | 68 | 9 | 7 |
| QUA | 127 | 33 | 27 | 23 | 17 | 11 | 15 | 1 | 1 | 73 | 53 |
| **Total** | **3.500** | **863** | **740** | **670** | **394** | **195** | **531** | **107** | **1.658** | **1.105** | **737** |

### Destino das tabelas de origem

| Origem | Tabelas | TABELA (vira tabela nossa) | MECANISMO (absorvida por mecanismo comum) | NAO (não fazer, com motivo) |
|---|---:|---:|---:|---:|
| MV, todas | 8.867 | 6.430 | 2.010 | 427 |
| MV, esquema hospitalar principal (DBAMV) | 5.432 | 4.363 | 847 | 222 |
| MV, operadora (DBAPS) | 2.038 | 1.378 | 596 | 64 |
| MV, demais esquemas (portal, BI, integração, segurança, contabilidade, etc.) | 1.397 | 689 | 567 | 141 |
| SPDATA, tabelas com dados | 1.503 | 1.403 | 42 | 58 |

Os esquemas do MV somam 5.432 + 2.038 + 1.397 = 8.867.

O esquema DBAMV (5.432) não coincide exatamente com as 5.314 tabelas de "negócio hospitalar" da primeira rodada. A primeira rodada classificou cada tabela pelo assunto, e este quadro separa pelo esquema. O DBAMV também tem logs, telas e filas, que aqui caem em MECANISMO ou NAO.

Das 8.867 tabelas do MV, 1.924 têm dados. Elas se dividem assim:
- 1.417 em TABELA;
- 390 em MECANISMO;
- 117 em NAO.

### Mecanismos comuns

| Mecanismo | MV | SPDATA | O que ele absorve |
|---|---:|---:|---|
| integração | 728 | 5 | Filas, lotes de importação e exportação, trocas TISS/ANS da operadora (359 só do DBAPS) e o barramento de integração do MV (141). Vira um motor único de integração, com mensagem, situação e retorno. |
| histórico da entidade | 355 | 12 | Tabelas de log, `_HIST`, `_LOG` e cópias de exclusão. Cada uma vira o histórico da entidade que ela registra, em vez de uma tabela paralela por assunto. |
| data mart | 308 | 1 | O data warehouse do MV (227 tabelas do DBADW) e os agregados de BI. Vira data mart próprio, gerado a partir do modelo. |
| framework | 236 | 3 | Telas, menus, tradução, jobs, sessão e editor de documentos. Isso é do produto do fornecedor, e nós temos o nosso. |
| parâmetro | 148 | 20 | Tabelas de configuração e parâmetros soltos. Viram um mecanismo único de parâmetros, com escopo por estabelecimento. |
| catálogo público | 105 | 0 | Tabelas oficiais (CID, TUSS, SIGTAP, IBGE, ANS, etc.), que são carregadas da fonte pública e não migradas. 70 delas são do DBAPS. |
| arquivo | 80 | 1 | Anexos, imagens e conteúdo binário. Vão para o armazenamento de arquivos, ligados à entidade dona. |
| trilha de auditoria | 50 | 0 | Auditoria técnica de alteração. Vira uma trilha única do sistema. |
| **Total** | **2.010** | **42** | |

As 2.010 tabelas do MV absorvidas por mecanismo representam 23% do MV, sem que nenhuma tabela nossa seja criada para elas.

## Comparação

| Sistema | Tabelas | Observação |
|---|---:|---|
| SPDATA | 3.756 | Só 1.503 têm dados. As outras 2.253 estão vazias e ficaram fora do escopo. |
| MV | 8.867 | 5.314 de negócio hospitalar e 2.038 de operadora. O resto é técnico, log, BI, integração e configuração. |
| **Nosso modelo** | **3.500** | 1.658 em F3, 1.105 em F7 e 737 em F8 (depois da paridade estrutural). |

### Por que o total é 3.500, e não 8.867 nem 3.756

1. **Muitas origens caem na mesma tabela nossa.**
   - As 6.430 linhas `TABELA` do MV fazem 7.193 ligações, mas apontam para só **2.588 tabelas nossas**.
   - 1.084 dessas tabelas recebem uma única origem. As outras 1.504 recebem duas ou mais.
   - O MV repete a mesma coisa em vários lugares: cópia por estabelecimento, versão `_HIST`, tabela do portal espelhando a do núcleo e a mesma estrutura na operadora e no hospital.
   - Os maiores pontos de convergência são `mapeamento_codigo_externo` (52 origens), `termo_terminologia` (50), `usuario_acao_excecao` (41) e `pedido_autorizacao_plano_item` (34).
2. **Um quarto do MV vira mecanismo.** As 2.010 tabelas do quadro acima não viram tabela de negócio.
3. **Uma parte vira NAO, com motivo registrado.** São 427 tabelas do MV e 58 do SPDATA, entre elas:
   - localização de outro país (México e Chile);
   - customização de outro cliente;
   - tabela temporária ou cópia;
   - tabela anterior à tabela unificada do SUS (21 no SPDATA).
4. **O SPDATA cabe quase todo no mesmo conjunto.**
   - As 1.403 linhas `TABELA` do SPDATA apontam para 1.062 tabelas nossas.
   - 591 dessas tabelas também recebem origem do MV. Isso confirma o mesmo conceito de negócio nos dois sistemas.
   - Quanto à fase, 1.269 dessas linhas caem em tabela F3, 116 em F7 e 18 em F8.
5. **441 tabelas são só do desenho.** Elas não têm nenhuma origem e vêm de três fontes:
   - exigência legal (RDC 36/2013, eSocial/REINF, RAAS, Lei 13.146/2015);
   - itens e domínios que faltavam nas estruturas existentes, apontados pela verificação;
   - funcionalidades novas de F8.

   Por fase: 147 em F3, 205 em F7 e 89 em F8.

**Em resumo:** o modelo cobre a soma do SPDATA em uso com todo o negócio do MV e acrescenta as obrigações legais. Mesmo assim, fica com menos da metade das tabelas do MV, porque não carrega as duplicatas, as cópias e as tabelas técnicas dele. A estimativa anterior era de 3.500 a 4.500 tabelas, e o resultado ficou no limite de baixo.

**Ressalva:** as entidades por tabela ainda não têm colunas, e o número final pode subir quando o desenho de colunas separar alguma estrutura.

## O que a verificação adversarial corrigiu

Foram 9 verificações, uma por grupo: 01 a 08 e 10. Cada uma conferiu, coluna por coluna, uma amostra do mapa, todas as linhas NAO e MECANISMO com dados e o catálogo do grupo.

| Grupo | Linhas de mapa corrigidas | Erros de catálogo | Tabelas que faltavam |
|---|---:|---:|---:|
| 01 ADM, SIS e REL | 15 | 4 (3 aplicados e 1 só registrado) | 3 |
| 02 CAD, REC e AGE | 7 | 1 | 4 |
| 03 PEP | 23 (9 origens) | 14 | 1 |
| 04 INT, CC e HOT | 37 | 10 | 3 |
| 05 SADT e SUP | 44 (11 próprias; 33 seguem renome) | 20 | 1 |
| 06 FAT e SUS | 45 | 9 | 0 |
| 07 FIN e RH | 13 | 7 | 1 |
| 08 SGO e INTG | 132 | 23 | 2 |
| 10 QUA | 11 | 26 | 3 |
| **Total** | **327** | **114** | **18** |

### Tipos de correção

- **Paridade de fase com o SPDATA.** Tabelas com dados vivos no SPDATA estavam em F7 ou F8 e passaram para F3:
  - ficha de antimicrobiano;
  - alergia (manifestação e gravidade);
  - nascimento;
  - regulação de leitos;
  - plano da fonte pagadora;
  - cadastro do empregador para o REINF;
  - escopo de acesso do usuário.
- **Fase pelo caminho inverso.** Algumas tabelas passaram para F7:
  - o que a lei exige: RAAS, notificação de doador, DNV, partograma, ouvidoria (RN 323) e área do beneficiário no portal;
  - o que a Rede não usa: cheques, contratualização SUS e repasse sem origem.
- **Nomes iguais a tabelas do MV.** 45 tabelas foram renomeadas nos grupos 03, 05, 08 e 10, por exemplo:
  - `declaracao_importacao` → `registro_importacao`;
  - `capitulo_cid` → `capitulo_cid10`;
  - `fator_afericao` → `fator_interferencia_sinal_vital`.
- **Destino errado no mapa.** Alguns exemplos:
  - um log de CEP tratado como catálogo do IBGE;
  - uma configuração viva tratada como histórico;
  - modos de ventilação da prescrição fundidos com os da anestesia;
  - 123 linhas MECANISMO de importação da operadora sem fase.
- **Classificação de risco.** As 14 tabelas que tinham ficado em QUA foram para o PEP, onde está o núcleo.
- **Fusão.** `solicitante_sus` foi fundida em `solicitante_externo`.

### Defeitos do integrador corrigidos nesta passada

Os erros eram mecânicos, e o conteúdo das verificações não foi alterado.

1. Um renome por `ajustes` deixava o nome antigo no catálogo, com 0 origens. Agora a entrada é movida. O defeito afetava 27 tabelas, e por isso o total caiu de 3.527 para 3.500.
2. Um `ACEITA` sobre uma tabela já existente não mudava a fase nem a descrição. Agora, nas linhas `verif-*`, a verificação prevalece.
3. Um `FUNDIR` numa tabela existente deixava a tabela antiga no catálogo.
4. As linhas de `correcoes/` perdiam a coluna `nova`. Agora elas a herdam da linha original do mapa.
5. O destino `historico_entidade:<tabela>` e as evidências em minúsculas (por exemplo, `dep: x`) passaram a seguir os renomes.
6. O arquivo `ajustes/verif-05.tsv` tinha sido sobrescrito com as linhas do grupo 08. Os 18 renomes de SADT e SUP descritos em `verificacao/05.md` foram restaurados, e os 35 erros de "tabela fora do catálogo" vinham daí.
7. Os 26 erros de catálogo do grupo 10 estavam só no relatório. Eles foram aplicados em `ajustes/verif-10.tsv`: 8 tabelas de ouvidoria para F7, tipo de surto para F3, a classificação de risco para o PEP e o renome de `fator_afericao`. A evidência de `notificacao_incidente_envio` foi trocada no `catalogo-unico.tsv`.

## Pendências que dependem do dono

1. **Escopo da operadora.**
   - O módulo SGO tem 419 tabelas: 50 em F3 (recebem dado do SPDATA, mesmo que de uso mínimo), 276 em F7 e 93 em F8.
   - A Rede não opera plano hoje: o SPDATA de beneficiários tem 1 linha.
   - É preciso confirmar se a operadora entra no produto e quando.
2. **Regra de nome.**
   - 87 tabelas nossas ainda têm nome igual a uma tabela do MV, quase todos termos comuns do negócio ou do SUS: `conta_hospitalar`, `guia_tiss`, `apac`, `banco`, `centro_custo`, etc.
   - Há duas saídas: aceitar o termo de negócio ou renomear todas.
3. **Critério para F3.**
   - Hoje, domínios de ponto e de folha estão em F3 porque têm dados no SPDATA, embora o processo seja F7.
   - É preciso decidir se F3 exige uso real ou basta haver dado configurado.
4. **Regulação de leitos.** A cascata foi para F3, mas o próprio SPDATA marca a situação como "recurso a construir". As opções são:
   - manter tudo em F3;
   - deixar em F3 só o serviço e a central.
5. **TISS por webservice.** Se a Rede usa as transações de cancelamento e de elegibilidade (há URLs configuradas no SPDATA), `cancelamento_guia` e `consulta_elegibilidade` vão para F3.
6. **Portaria e visitantes.** `visita`, `terminal_acesso` e `ponto_acesso` estão em F8. Se o controle de visitantes for usado, eles vão para F3.
7. **Sobreposições a fundir:**
   - `capacidade_leito_sus` × `leito_uti_habilitado`;
   - `motivo_exclusao_registro` (genérico) × os motivos de cancelamento específicos.
8. **Exclusões do SPDATA.** `SICADATE_EXCLUSAO` e `SIRES01_DELETE` vão para o histórico da entidade, e as demais vão para `registro_excluido`. É preciso escolher um único padrão.
9. **Confirmações com a Rede:**
   - se os planos são restritos por hospital (`plano_fonte_pagadora_estabelecimento`);
   - se o tipo de retorno é escolhido na marcação (`regra_retorno_consulta`);
   - se `antimicrobiano` sobe para F3 junto com a ficha.
10. **Conteúdo do prontuário em arquivo.** O texto de cada registro clínico vai para o mecanismo de arquivo. A migração precisa garantir a leitura dentro do prontuário, porque esse conteúdo é registro legal.

### Nota técnica, sem decisão do dono

47 linhas do mapa do MV estão numa fase posterior à da tabela de destino. Na maioria, são origens que ficaram na fase antiga depois que a tabela subiu de fase: 29 apontam para `usuario_escopo` e 2 para `canal_notificacao` (ambas foram para F3 na verificação 01), 12 são de QUA (ouvidoria) e 4 de SUP e CAD. Isso não quebra nada, porque a tabela já existe antes, mas convém alinhar quando for planejada a migração de dados.
