# F4: decisões de destino e de modelo tomadas na rodada de cobertura total (para o dono revisar)

Rodada de cobertura total do conector (2026-11-21). Regra da rodada: nenhuma tabela carregável fica "bloqueada
esperando decisão". Onde faltava decisão de destino ou de modelo, decidimos pela melhor prática do produto (ADR 0002 e
0003) e registramos aqui. Cada decisão pode ser revista pelo dono; a revisão muda só a declaração do mapa, nunca o
motor. A ferramenta `tools/obra/cobertura_conector.py` lê a primeira coluna das tabelas abaixo: a tabela listada aqui
deixa de contar como "destino a rever" e passa a "destino decidido", e a fatia dela é refeita.

## 1. Decisões genéricas (valem para todas as fatias)

| Assunto | Decisão | Motivo |
|---|---|---|
| Vigência obrigatória sem fonte na origem | `@vigencia_carga`: a data da carga, com pendência baixa `vigencia_sem_fonte` por linha | O modelo exige início de vigência e a origem não tem data. Inventar data fixa no mapa seria valor falso. A data da carga é verdadeira ("vigente desde a migração") e fica visível ao cliente, que corrige no painel. |
| Data da carga em coluna obrigatória | `=@data_carga` (ou `=~@data_carga`, presumida) | É estável no diferencial: a linha igual é pulada e não é regravada. |
| Segredo da origem (senha de e-mail, token, certificado) | `#cofre:<COLUNA>`: o valor nunca é gravado no destino. A linha leva a pendência `segredo_aguarda_cofre` e o cliente cadastra a credencial no cofre do produto. | É a regra 8 do AGENTS.md. O conector não tem cofre e não deve ter. |
| Lista de domínio fixa (tipos, situações) com CHECK no modelo | Descarte da tabela com a causa `mecanismo_do_produto` (`declarado/sem_carga.tsv`). O código entra pelo de-para de valores (`depara=valores`) na coluna consumidora. | O domínio é do produto. Um cadastro paralelo duplicaria o CHECK. |
| De-para de valores sem evidência do significado | Par declarado só com evidência (nome, documentação de operação, DDL). Sem evidência, o valor vai como literal presumido (`=~`, pendência baixa `valor_presumido`) e o cliente revisa no painel. | Não há trava automática (ADR 0002): o sistema dá a ferramenta e o alerta. |
| Código único maior que o destino ou colidindo entre tabelas da origem | `#codigo_derivado:<COLUNA>:<n>[:<prefixo>]`: o prefixo de domínio separa códigos de tabelas diferentes, e o código maior que o destino ganha resumo estável (`~` + 8 hex), com pendência baixa `codigo_derivado` | Recusar o cadastro inteiro por tamanho de código derrubava as filhas em `pai_pendente`. |
| Mesma entidade criada por outra carga (sexo, tipo de telefone, pessoa pelo CPF) | `adotar:<colunas>` na via: a linha que já existe é adotada, sem sobrescrita, com pendência baixa `adotado_existente` | Melhor prática de cadastro único (pessoa única pelo CPF), sem duplicar e sem recusar com 1062. |
| Tabela que só acrescenta atributos ao registro de outra (título, vínculo 1:1, chave da NF-e) | `complementa` na via da coluna que referencia o pai com destino `<tabela>.id`: UPDATE da linha do pai, sem linha nova | Uma linha própria duplicaria a entidade. |
| Histórico da origem (`HT*`) com retrato | `#retrato` (JSON das colunas lidas, convertidas, sem segredo) na coluna de dados da versão | O histórico vira versão com retrato, igual à trilha do produto. |
| Pai que a origem não declara como FK, mas a carga exige antes | Aresta em `conector/mapa/declarado/dependencias.tsv`, lida pelo gerador do mapa (ordem topológica) | Na ordem antiga, o filho vinha antes do pai e era recusado em cadeia. |
| Catálogo trabalhista oficial (eSocial) | De-para `codigo_esocial:<tabela oficial>` (catálogo com parâmetro em `depara.py`), sem nunca gravar o catálogo | Regra 7: o catálogo vem do carregador oficial. |
| Catálogo licenciado (mat/med comercial, versão de tabela de preços) | Nunca entra (regra 7). O que for só da tabela licenciada é descarte com a causa `licenciado`. A referência a item licenciado fica como de-para do cliente com licença. | AGENTS.md regra 7. |
| Rascunho temporário de registro clínico (`*TMP`) | Descarte (`sem_valor`). Na virada, o rascunho é finalizado no sistema antigo e entra pelo registro final. | Rascunho não é registro do prontuário. Migrá-lo ressuscitaria texto não assinado. **Revisar com o dono.** |

## 2. Destinos decididos por tabela

Legenda da coluna "Decisão":
- **refazer**: a fatia declara as colunas com o mecanismo indicado;
- **modelo**: a fatia propõe a coluna ou tabela do modelo à trilha F2.2 e, até lá, carrega o resto com o mecanismo
  indicado;
- **descarte**: em `declarado/sem_carga.tsv`.

| Tabela | Decisão | Motivo |
|---|---|---|
| TBORGAOEMIS | refazer: `orgao_emissor_documento`, sigla por `#codigo_derivado:NOME:10` | A sigla é NOT NULL e a origem só tem o nome. O código derivado é estável, com pendência baixa, e não recusa o órgão. |
| PRCADRESP | refazer: `modelo_campo_opcao` pela tabela de ligação campo x resposta, com `ref:` encadeada e `@id` | Resposta solta, sem campo, não é opção de nenhum modelo. Resposta sem ligação: pendência `pai_inexistente`. |
| TBHORMED_RIBLOCOS | modelo: associação grade de horário x bloco de internação; até lá, `complementa` da grade com o bloco quando houver um bloco por grade | A grade é a de TBHORMED, e a linha não é grade nova. |
| PRASSINATURA_CAB | refazer: `documento_prontuario`, com tipo, situação, profissional e paciente pela `ref:` encadeada ao evento assinado | O documento assinado é do prontuário, e as colunas obrigatórias vêm das linhas referenciadas. |
| PRFORMULCOMP | refazer: `modelo_layout` da versão 1 publicada do modelo migrado (`ref:` encadeada à versão); o componente vai como `#retrato` | O destino exige versão e conteúdo em JSON. O retrato dá JSON válido sem inventar estrutura. |
| PRPADEVOL | refazer: `modelo_campo` da versão 1 do modelo (`ref:` encadeada) | O mesmo caso de PRFORMULCOMP. |
| PRPAREVOLIMG | refazer: `imagem_anotacao_modelo` com o modelo pela `ref:` encadeada | Tem uma linha só. Destino mantido. |
| PRKITMED | refazer: `kit_prescricao`, com o item prescritível por `ref:GEITENS` mais `adotar` no destino secundário do insumo | A referência a destino secundário vira adoção pelo código. |
| TBKITPRO | refazer: `kit_cuidado_enfermagem` e o item, com a unidade de prescrição por `ref:` alternativa ao código | O mesmo caso de PRKITMED. |
| PRATESTREQIMP | refazer: `documento_emitido`, com tipo e profissional pela `ref:` encadeada | O atestado e a requisição impressos são documentos emitidos do prontuário. |
| HTCABECFORMULCOMP | refazer: `modelo_documento_versao` com `#retrato` em `dados` | O histórico do formulário vira versão com retrato. |
| HTFORMULCOMP | refazer: `modelo_layout` da versão histórica, com `#retrato` | O mesmo caso de HTCABECFORMULCOMP. |
| PRASSINAT_DOC_PRCHKGERAL | modelo: coluna `documento_assinado_id` no horário de administração checado; até lá, `complementa` do horário (PRCHKGERAL) | É uma ligação entre o documento assinado e o horário checado. Gravar em `documento_prontuario` criaria 4,6 milhões de documentos sem paciente. A rastreabilidade da assinatura é obrigatória. |
| RICONFIC | refazer: `regra_documento_internacao`, depois de RIMODFIC (dependência declarada) | A ordem foi corrigida no gerador do mapa. |
| RIESPFIC | refazer: o mesmo destino e a mesma ordem de RICONFIC | A ordem foi corrigida no gerador do mapa. |
| RIMODFIC | refazer: `modelo_documento_internacao`, depois de RITITFIC | A ordem foi corrigida no gerador do mapa. |
| RITITFIC | refazer: `titulo_documento_internacao` | É o pai de RIMODFIC. |
| PREXAMEASSINATURA | refazer: `complementa` da requisição de exame (assinatura do agrupamento) | O agrupamento de assinatura é atributo da requisição, não um documento novo. |
| SIWSETIQUETA | refazer: `modelo_etiqueta_amostra_biologica`, com largura e altura por `=~` (padrão de etiqueta, presumido) e o leiaute em `#retrato`/blob | O leiaute vem do apoio, e o tamanho é presumido com pendência. |
| TBIRREGCTRCTA | descarte como tabela, por domínio fixo: o modo global vai por literal presumido em `tipo_pendencia_conta.controle` de cada tipo migrado | No modelo, o efeito é por tipo. A origem guarda um valor global de 4 opções. |
| TBEDITREL_PRMODELOREL | refazer: `relatorio_modelo_documento` com o modelo pela `ref:` encadeada ao modelo clínico do tipo | A referência direta gravaria o id de outra entidade. |
| RETITFIC | refazer: `complementa` de `modelo_ficha_impressa.titulo` pela chave composta de REMODFIC | Uma linha própria duplicaria o modelo. |
| PRPARRECMED | refazer: `complementa` de `modelo_impressao_clinica.tipo_receita_id` | É vínculo, não modelo novo. |
| SITPEQV_SITPEQVMODELO | refazer: `complementa` de `interface_equipamento.modelo_comunicacao_id` | É atributo da interface. |
| SIWEBPARPERFIL | refazer: `complementa` de `perfil_portal_resultado` | É atributo do perfil. |
| SDGECADNFS | refazer: `complementa` de `escrituracao_entrada.chave_acesso` pela nota (GECADNFS) | É complemento 1:1 da nota. |
| TBTIPO_ATENDIMENTO | descarte (`sem_valor`) | É usado só por uma tabela vazia e fora do mapa. |
| HTPARAMORIGEMCABIMP | descarte (`duplicado`) | Espelha PRPARAMORIGEMCABIMP. |
| PRCABEVOLTMP | descarte (`sem_valor`) | É rascunho temporário (seção 1). |
| PREVOLPACTMP | descarte (`sem_valor`) | É rascunho temporário (seção 1). |
| PRALERGIAPACTMP | descarte (`sem_valor`) | É rascunho temporário (seção 1). |
| PRALERGIAPACTMP_TBPRINC | descarte (`sem_valor`) | É rascunho temporário (seção 1). |
| TBPROCBACKUP | descarte (`mecanismo_do_produto`) | É a cópia de segurança do sistema antigo. |
| TBSITBACKUP | descarte (`mecanismo_do_produto`) | É a cópia de segurança do sistema antigo. |
| TBSGHCONEXAO | descarte (`mecanismo_do_produto`) | É da obra anterior. |
| TBSGHINTEGRADOR_PARAM | descarte (`mecanismo_do_produto`) | É do integrador da obra anterior. |
| TBSGHINTEGRADOR_TABELA | descarte (`mecanismo_do_produto`) | É do integrador da obra anterior. |
| TBVERSAOBRASIN | descarte (`licenciado`) | É a versão da tabela licenciada de preços (regra 7). |
| POBANCOHRTP | descarte por domínio fixo, com de-para de valores em `regra_banco_horas.tipo_banco` | Pedido da fatia L5-11. |
| POTPINIBANCO | descarte por domínio fixo: `regra_banco_horas.criterio_inicio` | Pedido da fatia L5-11. |
| PODIA | descarte por domínio fixo: `horario_jornada.dia` | Pedido da fatia L5-11. |
| POPROGSIT | descarte por domínio fixo: `escala.situacao` | Pedido da fatia L5-11. |
| POPROSITUACAO | descarte por domínio fixo: `apuracao_ponto.situacao` | Pedido da fatia L5-11. |
| PETP_INTEGR_EVENTO | descarte por domínio fixo: `integracao_ponto_folha.forma` | Pedido da fatia L5-11. |
| POTPJORNADA | descarte por domínio fixo: `regime_jornada.tipo_jornada_esocial` | Pedido da fatia L5-11. |
| FPTP_SAL | descarte por domínio fixo (tipo de salário): o histórico salarial não é o destino | Pedido da fatia L5-11. |
| FPTP_TREINAMENTO_CAPACITACAO | descarte por domínio fixo (tipo de treinamento): o curso não é o destino | Pedido da fatia L5-11. |
| STEMITENTE | descarte por domínio fixo (emitente da comunicação de acidente) | Pedido da fatia L5-11. |
| FPVALE | descarte por domínio fixo (tipo de benefício) | Pedido da fatia L5-11. |
| PETPINTERVALO | descarte por domínio fixo (tipo de intervalo) | Pedido da fatia L5-11. |
| POREPHOMOLOGADO | descarte por domínio fixo (relógio homologado sim ou não) | Pedido da fatia L5-11. |
| POTPHORA | descarte por domínio fixo (tipo de hora) | Pedido da fatia L5-11. |

## 3. O que continua sem mecanismo (próxima rodada)

A ferramenta lista as causas `regra_faltante` restantes. São pedidos das fatias que ainda não têm regra genérica:
- de-para oficial de código fiscal (CFOP e afins: carregador oficial);
- agrupar parcelas num título (cabeçalho a partir de N linhas);
- idade com unidade em outra coluna;
- data mais hora HHMM;
- referência a destino secundário do pai;
- regra de recorrência de data (anual, dia do mês).

Cada uma tem a tabela e o pedido em `docs/obra/fatias/f4/saida/<fatia>.json`.
