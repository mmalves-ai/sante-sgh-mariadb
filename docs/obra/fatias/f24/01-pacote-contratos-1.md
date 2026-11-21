# Fatia F2.4 01-pacote-contratos-1 (assunto: pacote-contratos-1; cliente de teste próprio: f24_01pacotecontratos1)

## packages/contratos/dist/administracao/permissoes.d.ts  (só comentário)
- nome-origem: linhas 162
    162: * mudar o texto, a data e o autor de PRTERMOCAD): a nova entra ativa e a anterior sai de vigência, com os aceites

## packages/contratos/dist/administracao/usuarios.d.ts  (só comentário)
- nome-origem: linhas 276,285,297
    276: /** acesso.criarUsuario: TBUSERS (login exato; grupo ativo; CPF opcional, nunca repetido). */
    285: * acesso.alterarUsuario: TBUSERS.NOMEC e, W1-01, TBUSERS.CPF (o grupo troca pela receita própria; nunca NOME nem
    297: /** acesso.bloquearUsuario / acesso.desbloquearUsuario: TBUSERS.BLOQUEADO. */

## packages/contratos/dist/agenda/exame.d.ts  (só comentário)
- nome-origem: linhas 2
    2: /** SICANAGE.MOTIVO tem 30 posições (o texto livre do legado tem de 1 a 24 caracteres em 2026). */

## packages/contratos/dist/agenda/sessoes.d.ts  (só comentário)
- nome-origem: linhas 19,66
    19: /** A duração da sessão em minutos (a categoria curta, média ou longa vem do domínio AGDURACAO). */
    66: /** Uma cadeira ou sala (AGCADEIRA) com a agenda (AGCADAGENDA) a que pertence. */

## packages/contratos/dist/agenda/vocabulario.d.ts  (só comentário)
- nome-origem: linhas 3,10,15,35
    3: /** Texto gravado em RECANAGE.MOTIVO (até 300 caracteres, CP1252). */
    10: /** Texto do motivo para RECANAGE.MOTIVO: o do código, com o complemento (até 300 caracteres). */
    15: /** REPACAGD.TP_AGE (RETIPAGE.COD); null = o canal não existe no legado (fica só em SGH_AGE_MARCACAO_EXT). */
    35: /** TBESTADOCONFIRMACAO: o resultado da tentativa de confirmação. */

## packages/contratos/dist/assinatura/assinatura.d.ts
- vocab-antigo: linhas 14,23,47,125
    14: export declare const FORMATOS: readonly ["HHMM", "HH:MM", "letra:T/F", "letra:S/N", "data", "timestamp", "hora", "numero", "texto", "blob"];
    23: HHMM: "HHMM";
    47: HHMM: "HHMM";
    125: HHMM: "HHMM";

## packages/contratos/dist/atendimento/conta.d.ts  (só comentário)
- nome-origem: linhas 3,5
    3: /** FCCTAEXT.FECHADA: N aberta, S fechada, A apresentada; null: o atendimento não tem conta. */
    5: /** FCCTAEXT.IND_EMI: T emitida. */

## packages/contratos/dist/atendimento/entradas.d.ts  (só comentário)
- nome-origem: linhas 2,108
    2: /** Número do atendimento (RECADATE.REG). */
    108: * O que a ficha nova copia do atendimento anterior do paciente (configuração única da rede, REPARATE): marca por

## packages/contratos/dist/atendimento/vocabulario.d.ts  (só comentário)
- nome-origem: linhas 38,57,69,73,189,228
    38: /** TBITEATE (tabela 1): os tipos do legado lidos nas listas (0 só lido: "não informado"; 23 existe desde 07/2023). */
    57: /** Tipo de guia do SADT (RECADATE.TIPO_SADT): só os valores vistos, com a legenda "a confirmar" (DP-46.6). */
    69: /** Termo de consentimento do cabeçalho (ATCABECATEND.TCLE): 1 em 100% do perfil; constante 1 (DP-46.7). */
    73: * o desfecho do externo desde 04/2020 (REALTA parada): o motivo de alta do legado (TBMOTALT) que corresponde a cada um
    189: /** Situação da conta externa (FCCTAEXT.FECHADA, IND_EMI) e o que permite (regra 2). */
    228: /** Herança do atendimento anterior (REPARATE): o que cada marca copia (nomes de produto). */

## packages/contratos/dist/auditoria/eventos.d.ts
- nome-origem: linhas 2,5,11,21,470,5716,5717,5728,5729,5730,5731,5732,5733,5734,5735,5736,5737,5738,5739,5740
    2: /** Tipos de TBTPACAOAUDIT que o novo grava no legado (ficha do M06, seção 5). */
    5: /** Criticidades de TBNVLCRITICID usadas pelo legado na trilha (informativo, erro, alerta). */
    11: /** TBOPCOES.ID que o Delphi registra para o evento (a mais frequente na janela do perfil). */
    21: * Opções do perfil passivo (TBCABTRILHA, 2026-06-01 a 2026-07-05): login e fim de sessão pelo módulo de
    470: readonly descricao: "Convênio suspenso ou reativado (TBCONVEN.SITUACAO), com justificativa";
    5716: /** Tabela.coluna do registro afetado em TBLANTRILHASGH (só identificadores; valores vistos no perfil). */
    5717: export declare const ALVOS_TRILHA_LEGADO: readonly ["RICADPAC.ID", "RECADATE.REG", "RICADINT.REG", "RITRANSF.REGISTRO", "RICONTAS.REG", "PRCABEVOL.ID_CABEVOL", "PRPRESC.ID", "TBUSERS.ID_TBUSERS", "TBA
    5728: "RICADPAC.ID": "RICADPAC.ID";
    5729: "RECADATE.REG": "RECADATE.REG";
    5730: "RICADINT.REG": "RICADINT.REG";
    5731: "RITRANSF.REGISTRO": "RITRANSF.REGISTRO";
    5732: "RICONTAS.REG": "RICONTAS.REG";

## packages/contratos/dist/cadastro/paciente.d.ts  (só comentário)
- nome-origem: linhas 31
    31: * Campos que a ficha altera: só os que o perfil das alterações recentes confirma (RICADPAC × HTPACIENTE,

## packages/contratos/dist/coexistencia/fim.d.ts  (só comentário)
- nome-origem: linhas 252
    252: /** Grupos especiais da tabela de grupos (TBGRUUSU.NOME): usuário sem grupo e logins de TV (regras 4 e 5). */

## packages/contratos/dist/contabil/vocabulario.d.ts  (só comentário)
- nome-origem: linhas 1,154
    1: /** Origem do lançamento (COTP_ORIGEM_LANCAMENTO.ID → rótulo de produto). */
    154: * Tipo de plano referencial (COTIPOPLANOCONTAREFERENCIAL: 14 linhas no pc; CODIGO e PLANOECF). O código "10" aparece

## packages/contratos/dist/custos/apuracao.d.ts  (só comentário)
- nome-origem: linhas 34,39,172,174
    34: /** TBCENCUS.ID de quem repartiu. */
    39: /** TBCENCUS.ID. */
    172: /** FCCTAEXT.ID. */
    174: /** FCCTAEXT.COD (o número da conta). */

## packages/contratos/dist/custos/estrutura.d.ts  (só comentário)
- nome-origem: linhas 12,139,141
    12: * Tipo de dado da estatística, pelos códigos do domínio de custos do banco (CTTIPODADO): 1 Lançamento (vale só na
    139: /** TBCENCUS.ID (a chave que o SGH_ guarda). */
    141: /** TBCENCUS.COD (o código que os movimentos usam). */

## packages/contratos/dist/documento-assinatura/vocabulario.d.ts  (só comentário)
- nome-origem: linhas 37,39
    37: * Ponte de cada tipo da política com o tipo de ato da trilha documental do legado (PRTPASSINATURA.ID, lido na cópia do
    39: * PRASSINATURA_DOC → PRASSINATURA_CAB.ID_PRTPASSINATURA → tipo da política). O primeiro ID de cada lista é o que o

## packages/contratos/dist/dominios/tipos.d.ts
- vocab-antigo: linhas 549,552,671
    549: * M23: texto com formato fixo do legado (ex.: hora em `HHMM`, sem os dois-pontos). M54.1: `digitos`, texto só com
    552: readonly formatoTexto?: 'HHMM' | 'digitos';
    671: * M54.4: `formato` troca o formato que o perfil mediu (ex.: ordem 0001 a 0004 parece hora HHMM e não é).
- nome-origem: linhas 139,157,537,550,584,685,728,729,764,770,771
    139: * De onde vêm as opções de menu do legado: lidas na árvore TBOPCOES (a tela do SPDATA que edita a tabela)
    157: /** TBOPCOES.ID que concedem cada ação (cap-08 §8.6). */
    537: /** TBUSERS.NOME de quem inclui. */
    550: * algarismos (a ordem de 4 dígitos da conta de receita da apuração de custos, CTCTARECEITANCI.ORDEM).
    584: * final "sem fim"; ou o 0 do número não informado, como o CNS e o CRM do FAMEDSOL): a tela mostra vazio e o vazio
    685: * M11: itens de sistema que o novo não altera (o trigger *_BU do legado os protege, ex.: TBCONSPROF 1 a 12
    728: * M14: trilha do legado que o Delphi grava para a tabela (perfil de TBCABTRILHA × TBLANTRILHASGH): tipo
    729: * (TBTPACAOAUDIT 2 inclusão, 3 alteração), criticidade e opção por verbo, e a coluna do alvo.
    764: * W1-04: obrigatório na inclusão (o perfil mediu a coluna sempre preenchida, ex.: TBRECEPCAO.TEXTOIMP, o texto
    770: * o cria: o arquivo de configuração que o executável do painel lê (PNCONFIG.CONFIGURACAO copiada do painel de
    771: * atendimento modelo; PNCONFIGPORTAL.CONFIGURACAO do modelo vazio capturado). `gerar` devolve os bytes do BLOB

## packages/contratos/dist/enfermagem/balanco.d.ts
- vocab-antigo: linhas 233
    233: /** Hora de corte da unidade (HHMM; padrão 0700). */

## packages/contratos/dist/financeiro/entradas.d.ts  (só comentário)
- nome-origem: linhas 24
    24: * hoje (perfil de MFCONPAG: 111 títulos de folha e encargos em 2025 e 2026, todos de parcela 1, TIPO F ou X, NF 0). O

## packages/contratos/dist/financeiro/regras/alcada.d.ts  (só comentário)
- nome-origem: linhas 6,8
    6: /** Centro de custo (TBCENCUS.COD) ou nulo (todos). */
    8: /** Tipo de credor (MFCONPAG.TIPO) ou nulo (todos). */

## packages/contratos/dist/financeiro/regras/classificacao.d.ts  (só comentário)
- nome-origem: linhas 8,10
    8: /** O CDC gravado em MFLANGSI pelo novo (0 em 100% do perfil). */
    10: /** TP_LAN de MFLANGSI: 0 = despesa do título a pagar, 1 = receita do título a receber, 4 = movimento (visto). */

## packages/contratos/dist/financeiro/regras/credor.d.ts  (só comentário)
- nome-origem: linhas 11,13,23,25
    11: /** M: o título exige o vínculo com o profissional (MFCONPAG_TBCBOPRO). */
    13: /** Retenções na fonte (MFDESACR) permitidas no lançamento manual. */
    23: /** O fornecedor (TBFORNEC.COD) existe e está ativo? */
    25: /** Profissional (TBCBOPRO.ID) informado e válido, quando o tipo é M. */

## packages/contratos/dist/financeiro/regras/glosa-titulo.d.ts  (só comentário)
- nome-origem: linhas 4
    4: /** FCLANEXT.GLOSADO: 'T' = baixado (conciliado); 'F' ou vazio = ainda sem retorno. */

## packages/contratos/dist/financeiro/regras/recusa.d.ts  (só comentário)
- nome-origem: linhas 24
    24: /** Login comparável (TBUSERS.NOME é sensível a maiúsculas no banco; para a segregação, pessoa é pessoa). */

## packages/contratos/dist/financeiro/regras/segregacao.d.ts  (só comentário)
- nome-origem: linhas 4
    4: /** Quem lançou (MFCONPAG.USUARIO). */

## packages/contratos/dist/financeiro/regras/situacao-titulo.d.ts  (só comentário)
- nome-origem: linhas 19
    19: /** Formas de pagamento vistas (MFCONPAG.TP_PGTO e MFCTAREC.TP_PGTO): legenda candidata em TBTIPOPAGFOR (DP-46.3). */

## packages/contratos/dist/financeiro/regras/tipo-movimento.d.ts  (só comentário)
- nome-origem: linhas 9,11,23
    9: /** Conta que recebe (crédito: o dinheiro entra), TBCTABAN.ID. */
    11: /** Conta que paga (débito: o dinheiro sai), TBCTABAN.ID. */
    23: /** As contas do movimento estão no escopo do usuário (MFCTAUSU; regra 15)? */

## packages/contratos/dist/financeiro/regras/titulo-pagar.d.ts  (só comentário)
- nome-origem: linhas 12,24
    12: /** A série gravada: sem série, a letra F do DEFAULT da coluna (MFCONPAG.SERIE e MFCTAREC.SERIE; D-SERIE-32). */
    24: /** Regra 7: o MFLANGSI só nasce com a parcela 1 (o outro sistema grava assim; o rateio vale para o documento). */

## packages/contratos/dist/financeiro/regras/titulo-receber.d.ts  (só comentário)
- nome-origem: linhas 22,24
    22: /** FCCTAEXT.FECHADA: S fechada, A apresentada (as que geram título), N aberta. */
    24: /** FCCTAEXT.ID_MFCTAREC: o título já ligado (0 ou nulo: sem título). */

## packages/contratos/dist/financeiro/respostas.d.ts  (só comentário)
- nome-origem: linhas 289
    289: /** A apropriação gerencial do documento a pagar (MFLANGSI, a parcela 1) com o rateio por centro de custo do novo. */

## packages/contratos/dist/formatacao/hora-legada.d.ts
- vocab-antigo: linhas 3,7,9,25
    3: export declare const FORMATO_HHMM: RegExp;
    7: /** Aceita "HH:MM", "HHMM", "H:MM" e "HMM"; devolve sempre "HHMM" (quatro dígitos) ou lança. */
    9: /** "HHMM" do legado → "HH:MM" para a tela. Vazio ou nulo → null; já formatado passa como está. */
    25: /** Contrato: hora trafega como "HHMM"; a entrada aceita os formatos da tela e é convertida. */

## packages/contratos/dist/inicio/comunicacao.d.ts  (só comentário)
- nome-origem: linhas 149
    149: /** Mensagem do sistema anterior (TBMENSAG; só consulta; 98 linhas de 2020 a 2024 na cópia `pc`). */

## packages/contratos/dist/inicio/worklist.d.ts  (só comentário)
- nome-origem: linhas 95
    95: /** Grupo legal (TBGRUPOPRIORIDADE), quando o novo o registrou; null nas que o outro sistema emitiu. */

## packages/contratos/dist/integracao/fachada.d.ts  (só comentário)
- nome-origem: linhas 10
    10: /** O usuário de integração que assina toda escrita da Hal-AI (TBUSERS.NOME, sensível a maiúsculas; sem login). */

## packages/contratos/dist/integracao/segredos-legado.d.ts  (só comentário)
- nome-origem: linhas 18,27
    18: /** Os segredos de parceiro de TBCONVEN, TBTISSWEBSERV, TBCODATI, TBHOSPIT, GEUSERS, PREMAILCFG e SITPEQV. */
    27: /** Colunas de senha secundária de TBUSUCPL (chave EMPRESA + USUARIO). */

## packages/contratos/dist/internacao/adt.d.ts  (só comentário)
- nome-origem: linhas 173
    173: * Situação da execução no legado (CHSITUACAO: 1 Alta hospitalar, 2, 3 Em higienização, 4 Liberado). Só 1 e 2 foram

## packages/contratos/dist/liberacao/onda4.d.ts  (só comentário)
- nome-origem: linhas 19
    19: /** Grupos funcionais (TBGRUUSU.NOME) acompanhados em "quem ainda usa o outro sistema". */

## packages/contratos/dist/orcamento/orcamento.d.ts  (só comentário)
- nome-origem: linhas 149
    149: /** R receita, D despesa (TBGRUDES.CLASSIF); a natureza da linha segue a do grupo. */

## packages/contratos/dist/parametros/definicoes.d.ts  (só comentário)
- nome-origem: linhas 40
    40: /** Alvo do nível: código da rede, empresa (TBEMPHOS.COD), estabelecimento, unidade, perfil ou login. */

## packages/contratos/dist/patrimonio/patrimonio.d.ts  (só comentário)
- nome-origem: linhas 58,446,448,450
    58: /** Origem "Doação" no domínio de origens do patrimônio do banco (GPORIGEM; 5 linhas no pc em 24/10/2026). */
    446: /** GPPARAMG.DEPRECIAR: a empresa deprecia os bens. */
    448: /** GPPARAMG.APLICAR_COEFICIENTE: aplica o coeficiente por turno. */
    450: /** GPPARAMG.CONSIDERA_VALOR_RESIDUAL: desconta o valor residual da base. */

## packages/contratos/dist/permissoes/tipos.d.ts
- nome-origem: linhas 10,17,19
    10: readonly tabela: 'TBUSUCPL' | 'GEUSERS' | 'FCPARUSU';
    17: /** Opções de TBOPCOES que concedem a permissão (cap-08 §8.6). Vazio = recurso só do novo. */
    19: /** Flags de TBUSUCPL, GEUSERS ou FCPARUSU que também concedem. */

## packages/contratos/dist/portal-medico/portal-medico.d.ts
- vocab-antigo: linhas 119
    119: /** HHMM. */

## packages/contratos/dist/portal/agenda-online.d.ts
- vocab-antigo: linhas 123
    123: /** HHMM. */
- nome-origem: linhas 7,184
    7: /** Convênio particular (TBCONVEN 10): o único cobrado pelo portal. */
    184: /** ID da marcação (REPACAGD ou SIPACAGD) como texto. */

## packages/contratos/dist/portal/vocabulario.d.ts  (só comentário)
- nome-origem: linhas 64
    64: * Signatário do consentimento no domínio do cadastro (TBTIPOREPRE, lido ao vivo pela descrição: na cópia do pc, 1

## packages/contratos/dist/preco/constantes.d.ts  (só comentário)
- nome-origem: linhas 3,5,15,21
    3: /** Tabelas cujo preço final passa por percentual em TBPERTHM (alerta com confirmação; ref 05 §1.3). */
    5: /** Percentual da tabela 625 em TBPERTHM: significado não confirmado (DP-33, regra 7). */
    15: /** Maior valor aceito nas colunas NUMERIC(10,2) de TBVLRTHM (VALOR_ANES, VALOR_FILME). */
    21: /** Situações de convênio que o legado usa (TBCONVEN.SITUACAO, 44 A e 33 I na cópia). */

## packages/contratos/dist/preco/credenciais.d.ts  (só comentário)
- nome-origem: linhas 1
    1: /** Colunas de credencial (TBTISS, TBTISSWEBSERV, TBCONVEN e TBCODATI), só os nomes das colunas. */

## packages/contratos/dist/preco/respostas.d.ts  (só comentário)
- nome-origem: linhas 496
    496: /** Vigências de diária/taxa (TBVLRDTH) ou de mat/med (TBVLRMEM): o valor de cada data, sem autoria do novo. */

## packages/contratos/dist/prontidao/catalogo.d.ts  (só comentário)
- nome-origem: linhas 7
    7: /** Grupos funcionais (TBGRUUSU.NOME, chave sem acento) que compõem o papel. */

## packages/contratos/dist/qualidade/notificacao.d.ts  (só comentário)
- nome-origem: linhas 349,354
    349: * Contexto da tela de origem relido pelo servidor (ATCABECATEND pelo ID, com o cadastro do paciente, a unidade e o
    354: /** RICADPAC.ID. */

## packages/contratos/dist/recepcao/classificacao.d.ts  (só comentário)
- nome-origem: linhas 79
    79: /** Código do modelo do formulário de classificação do prontuário (PREVOLUCAO.COD). */

## packages/contratos/dist/recepcao/estados.d.ts  (só comentário)
- nome-origem: linhas 3,9
    3: /** TBSENHAATEND.SITUACAO ('' tratado como G). */
    9: /** TBGERASENHA.TIPO ('0' recepção, '5' diversos). */

## packages/contratos/dist/recepcao/vocabulario.d.ts  (só comentário)
- nome-origem: linhas 1,19,133,148,191,221,248
    1: /** Situação da senha (TBSENHAATEND.SITUACAO), com o rótulo de produto. */
    19: /** Letras de evento do fluxo (TBACAOFLUXOSENHA) e se o perfil da cópia as mostra (só as vistas gravam). */
    133: * Prioridade gravada (TBSENHAATEND.PRIORIDADE, CHAR(1)): o domínio do legado 0/1/2 (TBGRUPOPRIORIDADE 0 acima de 80
    148: /** Grupos legais (TBGRUPOPRIORIDADE, 10 linhas) e a prioridade 0/1/2 que cada um grava hoje. */
    191: /** Tipos de gerador (TBGERASENHA.TIPO, Anexo A §A.3): só 0 e 5 têm uso; 1 a 4 existem como colunas vazias. */
    221: * Motivos padronizados da suspensão (o legado guarda texto livre de até 50 caracteres em TBSENHAATEND.MOTIVO: 6.137
    248: /** Texto gravado em TBSENHAATEND.MOTIVO (VARCHAR(50)): o motivo padronizado e, no "outro", o complemento. */

## packages/contratos/dist/repasse/entradas.d.ts  (só comentário)
- nome-origem: linhas 79,110,139
    79: * repasse.lancarEvento: o lançamento do repasse em RPLANEVE (+ o vínculo do médico em RPLANEVE_TBCBOPRO). Origem:
    110: /** repasse.incluirRegra: a versão aprovada incluída em TBREPGER (+ TBREPGER_TBCBOPRO), só pelo servidor. */
    139: /** repasse.integrarItens: os itens do período com o valor do motor (FCINTEGRPA), ligados ao lançamento da apuração. */

## packages/contratos/dist/repasse/modelo.d.ts
- vocab-antigo: linhas 28,45
    28: /** Janela de horário HHMM (TBREPGER.HORA_INI/HORA_FIN; no pc todas 0000–2359). */
    45: /** Data e hora da realização (AAAA-MM-DD e HHMM). */
- nome-origem: linhas 3,5,8,11,28,38,41,43,67,69,71
    3: /** TBREPGER.ID (ou o ID da versão em rascunho, negativo, no simulador). */
    5: /** Início da vigência (TBREPGER.DATA), AAAA-MM-DD. */
    8: /** Profissional do vínculo (TBREPGER_TBCBOPRO.ID_TBCBOPRO), casado com o executante do item; null: qualquer. */
    11: * Código do prestador (TBREPGER.COD; 103.957 regras com COD e 98.406 com vínculo no pc). Só informativo: o motor casa
    28: /** Janela de horário HHMM (TBREPGER.HORA_INI/HORA_FIN; no pc todas 0000–2359). */
    38: /** Evento de RPA (TBREPGER.ID_RPEVENTOS). */
    41: /** Item faturado com o executante (FCLANEXT + FCCTAEXT; regra 5). */
    43: /** FCLANEXT.ID. */
    67: /** Linha da apuração gravada pelo outro sistema (FCINTEGRPA, valor faturado com valor), para o teste dourado. */
    69: /** FCLANEXT.ID. */
    71: /** TBREPGER.ID; null quando a linha não guarda a regra. */
