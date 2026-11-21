# Fatia F2.4 19-misto-atendimento (assunto: atendimento+integracao+custos+consultas; cliente de teste próprio: f24_19mistoatendimento)

## apps/api/src/modulos/atendimento/atendimento.controller.ts
- nome-origem: linhas 294,437,515
    294: tabelaAlvo: 'REPACAGD',
    437: req.sghAlvo = { paciente: pac, tabelaAlvo: 'RICADPAC', idAlvo: String(pac) };
    515: tabelaAlvo: 'RECADATE',

## packages/contratos/src/atendimento/conta.ts  (só comentário)
- nome-origem: linhas 10,12
    10: /** FCCTAEXT.FECHADA: N aberta, S fechada, A apresentada; null: o atendimento não tem conta. */
    12: /** FCCTAEXT.IND_EMI: T emitida. */

## packages/contratos/src/atendimento/entradas.ts
- vocab-antigo: linhas 4
    4: // código. Data e hora vêm sempre do relógio do banco (nunca da tela): a ficha guarda data + HHMM e o cabeçalho o
- nome-origem: linhas 22,222,265
    22: /** Número do atendimento (RECADATE.REG). */
    222: * O que a ficha nova copia do atendimento anterior do paciente (configuração única da rede, REPARATE): marca por
    265: /** O ordinal do procedimento na ficha (REPROEXT.SEQ). */

## packages/contratos/src/atendimento/vocabulario.ts  (só comentário)
- nome-origem: linhas 2,3,62,96,104,109,168,190
    2: // (M20; ficha, seções 5 e 8). Os códigos são os do legado (TIPO_ATE do domínio TBITEATE tabela 1, CARACTERS,
    3: // TIPO_SADT, LAB/PEXT, TBMOTALT); o novo só grava valores já vistos no perfil passivo da cópia. Perfil da cópia pc
    62: /** TBITEATE (tabela 1): os tipos do legado lidos nas listas (0 só lido: "não informado"; 23 existe desde 07/2023). */
    96: /** Tipo de guia do SADT (RECADATE.TIPO_SADT): só os valores vistos, com a legenda "a confirmar" (DP-46.6). */
    104: /** Termo de consentimento do cabeçalho (ATCABECATEND.TCLE): 1 em 100% do perfil; constante 1 (DP-46.7). */
    109: * o desfecho do externo desde 04/2020 (REALTA parada): o motivo de alta do legado (TBMOTALT) que corresponde a cada um
    168: /** Situação da conta externa (FCCTAEXT.FECHADA, IND_EMI) e o que permite (regra 2). */
    190: /** Herança do atendimento anterior (REPARATE): o que cada marca copia (nomes de produto). */

## packages/dominio-atendimento/src/fila-consultorio.ts  (só comentário)
- nome-origem: linhas 4
    4: // A situação vem das letras do fluxo da senha no local (TBFLUXOATEND: C chamar, A atender, L liberar, X cancelar a

## packages/dominio-atendimento/src/heranca.ts  (só comentário)
- nome-origem: linhas 1
    1: // Herança do atendimento anterior (REPARATE; ficha do M20, seção 4 "Histórico do paciente"): as marcas da

## packages/dominio-atendimento/src/impressos.ts
- vocab-antigo: linhas 20
    20: readonly retorno: 'S' | 'N';

## packages/dominio-atendimento/src/teleconsulta/regras.ts
- vocab-antigo: linhas 29
    29: /** O relógio do estabelecimento (data AAAA-MM-DD e hora HHMM), como o do banco. */

## apps/api/src/modulos/integracao/porta-propria.ts
- modelo-pendente: linhas 1067
    1067: throw recusa('modelo-pendente', `O padrão de troca "${familia}" não está cadastrado neste cliente.`);

## packages/contratos/src/integracao/fachada.ts  (só comentário)
- nome-origem: linhas 33
    33: /** O usuário de integração que assina toda escrita da Hal-AI (TBUSERS.NOME, sensível a maiúsculas; sem login). */

## packages/contratos/src/integracao/segredos-legado.ts
- nome-origem: linhas 7,11,33,36,44,52,60,68,76,84,99,110
    7: // Exceções (regra 7): TBINFBANCO é lido por 4 gatilhos que escrevem em banco externo e fica como está enquanto eles
    11: // As senhas secundárias de TBUSUCPL (cancelamento de nota fiscal e a secundária) deixam de existir
    33: /** Os segredos de parceiro de TBCONVEN, TBTISSWEBSERV, TBCODATI, TBHOSPIT, GEUSERS, PREMAILCFG e SITPEQV. */
    36: tabela: 'TBCONVEN',
    44: tabela: 'TBTISSWEBSERV',
    52: tabela: 'TBCODATI',
    60: tabela: 'TBHOSPIT',
    68: tabela: 'GEUSERS',
    76: tabela: 'PREMAILCFG',
    84: tabela: 'SITPEQV',
    99: objeto: 'TBINFBANCO',
    110: /** Colunas de senha secundária de TBUSUCPL (chave EMPRESA + USUARIO). */

## packages/dominio-integracao/src/apoio.ts  (só comentário)
- nome-origem: linhas 3,18,20
    3: // em SITBEXHP, os elementos em SITBELHP pelo código do laboratório, ligados pelo nome ao elemento do exame do
    18: /** Código do elemento no laboratório (SITBELHP.COD). */
    20: /** Nome do elemento no de-para (SITBELHP.ELEMENTO_NOME). */

## packages/dominio-integracao/src/fachada/convenio-situacao.ts
- nome-origem: linhas 68,184,235
    68: /** A pré-checagem do gatilho de TBCONVEN: diária apontada que não é TIPO 1/SUBTIPO 5 recusa qualquer alteração. */
    184: tabela: 'TBCONVEN',
    235: efeito: { tabela: 'TBCONVEN', coluna: 'SITUACAO' },

## packages/dominio-integracao/src/fachada/convenios.ts  (só comentário)
- nome-origem: linhas 8
    8: /** A linha lida de TBCONVEN (COD, NOME aparado, SITUACAO aparada, PERMITE_ATEND). */

## packages/dominio-integracao/src/hl7/mensagem.ts
- vocab-antigo: linhas 33
    33: /** Data e hora HL7 (AAAAMMDDHHMMSS) do relógio de parede (o Date carrega a hora local nos campos UTC). */
- nome-origem: linhas 107
    107: /** O exame do pedido (SILANEXA.ID: o identificador do pedido no Sante SGH e no outro sistema). */

## apps/api/src/modulos/custos/porta-propria.ts
- modelo-pendente: linhas 19,80
    19: // fontes e a gravação da apuração respondem "modelo-pendente"; as leituras da apuração devolvem vazio, sem contorno.
    80: 'modelo-pendente',

## packages/contratos/src/custos/apuracao.ts  (só comentário)
- nome-origem: linhas 68,74,232,234,329
    68: /** TBCENCUS.ID de quem repartiu. */
    74: /** TBCENCUS.ID. */
    232: /** FCCTAEXT.ID. */
    234: /** FCCTAEXT.COD (o número da conta). */
    329: /** O número da conta (FCCTAEXT.COD). */

## packages/contratos/src/custos/estrutura.ts  (só comentário)
- nome-origem: linhas 2,53,208,210,357
    2: // regra 7 em preparação): cada centro de custo (TBCENCUS, lido onde está) classificado em produtivo, auxiliar ou
    53: * Tipo de dado da estatística, pelos códigos do domínio de custos do banco (CTTIPODADO): 1 Lançamento (vale só na
    208: /** TBCENCUS.ID (a chave que o SGH_ guarda). */
    210: /** TBCENCUS.COD (o código que os movimentos usam). */
    357: /** TBCENCUS.ID. */

## packages/dominio-custos/src/absorcao.ts  (só comentário)
- nome-origem: linhas 35
    35: /** Um valor de custo direto já pelo TBCENCUS.ID (null: sem centro de custo no movimento). */

## packages/dominio-custos/src/apuracao.ts  (só comentário)
- nome-origem: linhas 19,39
    19: /** Um grupo agregado no banco pelo código do centro de custo do movimento (TBCENCUS.COD). */
    39: /** Proventos da folha da competência pela lotação (já pelo TBCENCUS.ID; null: sem lotação). */

## packages/dominio-custos/src/custo-conta.ts  (só comentário)
- nome-origem: linhas 17,23
    17: /** FCCTAEXT.ID. */
    23: /** TBCENCUS.ID do item (null: o código do item não está no cadastro). */

## packages/dominio-custos/src/estatistica.ts
- vocab-antigo: linhas 53,75
    53: /** Duração HHMM (como a cirurgia grava) em minutos; null quando o texto não é uma duração. */
    75: /** Cirurgias do mês pelo centro da sala, agrupadas pela duração gravada (HHMM). */
- nome-origem: linhas 3,64,83
    3: // competência, em que o lançamento manual prevalece sobre o coletado e a estatística de referência (CTTIPODADO 2: por
    64: /** Um grupo agregado no banco: o código do centro de custo do movimento (TBCENCUS.COD) e a quantidade. */
    83: /** Colaboradores com vínculo no mês, já pelo TBCENCUS.ID da lotação (o cadastro de pessoas guarda o ID). */

## packages/dominio-custos/src/estrutura.ts  (só comentário)
- nome-origem: linhas 3
    3: // (F5). Puro: recebe os centros lidos (TBCENCUS com a classificação de SGH_CUS_CENTRO) e devolve o diagnóstico.

## packages/dominio-custos/src/exportacao.ts  (só comentário)
- nome-origem: linhas 15,17
    15: /** TBCENCUS.COD_APURASUS. */
    17: /** TBUNIMEN.COD_APURASUS da unidade de mensuração do centro. */

## packages/contratos/src/consultas/tipos.ts  (só comentário)
- nome-origem: linhas 143
    143: /** Código de PRTIPO_JUSTIF_EXPORTACAO (dado de pessoa ou clínico). */
