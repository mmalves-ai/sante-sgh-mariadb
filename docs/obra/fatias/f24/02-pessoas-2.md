# Fatia F2.4 02-pessoas-2 (assunto: pessoas-2; cliente de teste próprio: f24_02pessoas2)

## apps/api/src/modulos/pessoas/ponto/porta-ponto-propria.ts
- modelo-pendente: linhas 17
    17: // e as gravações recusam com `modelo-pendente`.

## apps/api/src/modulos/pessoas/servico.ts
- nome-origem: linhas 1354
    1354: chave: `TBCBOPRO:${e.registro}`,

## apps/api/src/modulos/pessoas/sesmt/porta-sesmt-propria.ts
- modelo-pendente: linhas 25,239
    25: // sem modelo recusa com `modelo-pendente` (409), dizendo o que falta; nenhuma devolve vazio calado, salvo a leitura da
    239: 'modelo-pendente',
- vocab-antigo: linhas 222
    222: /** "HHMM" da tela → minutos guardados (e o caminho de volta). */

## apps/api/src/modulos/pessoas/treinamento/modelo-curso.ts
- modelo-pendente: linhas 5,10
    5: // obrigatório recusam com 409 `modelo-pendente` até sair o curso_publico_alvo e a extensão de ck_curso_tipo.
    10: export const MODELO_PENDENTE = 'modelo-pendente';

## apps/api/src/modulos/pessoas/treinamento/porta-treinamento-propria.ts
- modelo-pendente: linhas 28
    28: //   - curso não tem a categoria do contrato nem o público por unidade ou "todos": recusa com `modelo-pendente`, a mesma

## apps/web/src/modulos/pessoas/autoatendimento/solicitacao-comum.ts
- vocab-antigo: linhas 3,25,55
    3: // SanteHora chega em HHMM e vira HH:MM no instante da marcação que faltou.
    25: /** HHMM (SanteHora). */
    55: /** HHMM ou HH:MM → HH:MM; null se não for hora válida. */

## apps/web/src/modulos/pessoas/sesmt/i18n.ts
- vocab-antigo: linhas 171
    171: horasAntes: 'Horas trabalhadas antes (HHMM)',

## packages/contratos/src/pessoas/entradas.ts  (só comentário)
- nome-origem: linhas 23,51,53,88,197,217
    23: /** Lotação: centro de custo (TBCENCUS.COD) e, se houver, a unidade (TBUNIDAD.COD) e o setor de trabalho. */
    51: /** Profissional (TBPROFIS.ID) a reusar, da prévia; null: a pessoa não é profissional cadastrado. */
    53: /** Usuário (TBUSERS.ID_TBUSERS) a reusar, da prévia; null: sem login no estabelecimento. */
    88: * Desligamento (regra 2): data, motivo do domínio de tipos de rescisão do ramo (FPTIPORESC.ID, 8 linhas no pc) e o
    197: * cadastro de profissionais (TBCBOPRO): aqui só a validade e o documento conferido.
    217: /** A unidade do estabelecimento (TBUNIDAD.COD) da lotação. */

## packages/contratos/src/pessoas/escala-entradas.ts  (só comentário)
- nome-origem: linhas 49,51,53,113
    49: /** Tipo de jornada do domínio do ramo (POTPJORNADA.ID: 1 normal, 2 escalonada, 3 a 6 horista). */
    51: /** Contrato em tempo parcial (POTPCONTTEMP.ID: 0 não é; 1 a 3 com o limite semanal; regra 6). */
    53: /** Folga padrão do domínio de trabalho/folga do ramo (POTPTRABFOLGA.ID), se houver. */
    113: /** Unidade do estabelecimento (TBUNIDAD.COD). */

## packages/contratos/src/pessoas/escala-vocabulario.ts  (só comentário)
- nome-origem: linhas 73
    73: * Contrato em tempo parcial (domínio POTPCONTTEMP do ramo; ref 02): 0 = não é tempo parcial; 1 = 25 h; 2 = 30 h;

## packages/contratos/src/pessoas/folha-calculo.ts  (só comentário)
- nome-origem: linhas 23
    23: * O papel de cada linha do cálculo. Cada papel que gera valor aponta para uma rubrica da empresa (`FPEVENTO`) nos

## packages/contratos/src/pessoas/folha-interface.ts  (só comentário)
- nome-origem: linhas 10,11,64,79,139,151,179,227
    10: // - regra 5: os eventos de ponto saem pelos 13 tipos de integração da folha (PETP_INTEGR_EVENTO.COD_INTEGR_EVENTO) e a
    11: //   origem de cada um pelos tipos de hora da apuração (POTPHORA.ID);
    64: * Tipos de integração de evento de ponto com a folha (PETP_INTEGR_EVENTO, 13 linhas no pc; ref 02). Os rótulos de 1 a
    79: /** Tipos de hora da apuração (POTPHORA, 9 linhas no pc; ref 02). Rótulos de 1 a 5 da referência; os demais, lidos. */
    139: /** Lotação: centro de custo (TBCENCUS.ID) e setor (TBUNIDAD.ID), na competência. */
    151: /** Afastamento na competência (motivo de FPMOTAFAST.ID, 21 linhas no pc). */
    179: * Minutos do período fechado por tipo de hora da apuração (POTPHORA; regra 5): a classificação de que os eventos de
    227: /** Empresa do outro sistema (TBEMPHOS.COD_EMP) e estabelecimento da Rede. */

## packages/contratos/src/pessoas/folha-obrigacoes.ts  (só comentário)
- nome-origem: linhas 124
    124: /** Código de pagamento da GPS na SEFIP (2100: empresas em geral, CNPJ; catálogo FPCOD_GPS). */

## packages/contratos/src/pessoas/folha-titulos.ts  (só comentário)
- nome-origem: linhas 7,34,56,72,79,283
    7: // Destinos e rotinas: cada destino é uma rotina de integração do cadastro de rotinas da folha (`FPINTROTINA`: 4 folha
    34: /** A rotina de integração (`FPINTROTINA.ID`) de cada destino. */
    56: /** `FPINTROTINA.PERMITE_INTEGRAR_*`: 2 = sim, 1 = não (as provisões integram só à contabilidade). */
    72: /** Classificação gerencial do título (`TBITEDES`), como o contas a pagar usa. */
    79: * O de-para de um destino: credor (`TBFORNEC.COD`), classificação gerencial e o vencimento (dia do mês, no mês do
    283: /** Uma rotina do cadastro de rotinas da folha (`FPINTROTINA`) com o agrupamento (`FPINTAGRUP`). */

## packages/contratos/src/pessoas/ponto-vocabulario.ts  (só comentário)
- nome-origem: linhas 62,80,101,110
    62: * Classificação das horas da apuração (domínio POTPHORA do ramo, 9; ref 02). O rótulo lido no domínio vale; este é o
    80: * Tipos de integração com a folha (domínio PETP_INTEGR_EVENTO do ramo, 13; ref 02; regra 13). A exportação leva os
    101: /** Destino das horas no banco (domínio POBANCOHRTP do ramo, 4; regra 14). */
    110: /** Como o banco começa cada ciclo (domínio POTPINIBANCO do ramo, 4; regra 14). */

## packages/contratos/src/pessoas/respostas.ts  (só comentário)
- nome-origem: linhas 19,50,58,63,73
    19: /** Lotação lida: centro de custo e unidade com o nome (TBCENCUS e TBUNIDAD). */
    50: /** Registro no conselho do lado assistencial (TBCBOPRO) com a validade acompanhada pelo RH. */
    58: /** TBCBOPRO.ATIVO: a atividade real do registro (regra 4). */
    63: /** Onde o profissional atende por este registro (TBCBOPRO_TBUNIDAD × TBUNIDAD). */
    73: /** Usuário de acesso ligado à pessoa, por hospital da Rede (o mesmo TBUSERS dos dois sistemas). */

## packages/contratos/src/pessoas/sesmt-entradas.ts
- vocab-antigo: linhas 180,190
    180: const hhmm = z.string().regex(/^([01]\d|2[0-3])[0-5]\d$/, 'Hora no formato HHMM.');
    190: .regex(/^\d{2}[0-5]\d$/, 'Horas trabalhadas no formato HHMM.')

## packages/contratos/src/pessoas/sesmt-vocabulario.ts  (só comentário)
- nome-origem: linhas 2
    2: // códigos dos domínios do outro sistema (FPASOTIPO, FPASORESULTADO, FPVACINA, FPDOSE_VACINA, FPCAT*, FPGRUPORISCO,

## packages/contratos/src/pessoas/treinamento-entradas.ts  (só comentário)
- nome-origem: linhas 49,200,297
    49: /** Código da unidade (TBUNIDAD.COD) ou o nome da função (a chave é calculada no servidor). */
    200: /** Unidade do POP (TBUNIDAD.COD); sem unidade, o estabelecimento inteiro. */
    297: /** O registro do profissional (TBCBOPRO.ID): o mesmo prestador com dois registros tem dois grupos. */

## packages/contratos/src/pessoas/vocabulario.ts  (só comentário)
- nome-origem: linhas 30,41
    30: * `TBPROFIS.SITUACAO` (DP-46.1; ref 02; Anexo A): na cópia do pc, O 758, F 109 e E 4 profissionais. Baixa confiança:
    41: * Conselhos de classe vistos em `TBCBOPRO.CONS_PROF` na cópia do pc (2.095 registros: CRM 1.211, COREN 694,

## packages/dominio-pessoas/src/colaborador/cpf.ts  (só comentário)
- nome-origem: linhas 2,3
    2: // No outro sistema o CPF do profissional está em TBPROFIS.CNPJ_CPF (869 de 871 no pc; TBPROFIS.CPF está vazio) e o
    3: // do usuário em TBUSERS.CPF (1.080 de 1.087), ambos numéricos: 0 e nulo são "sem CPF".

## packages/dominio-pessoas/src/colaborador/desligamento.ts  (só comentário)
- nome-origem: linhas 2,3,25
    2: // desligamento bloqueia o acesso no mesmo dia, nos dois sistemas (é o mesmo TBUSERS), sem apagar o usuário. Quem
    3: // trabalha nos dois hospitais tem um TBUSERS em cada banco: cada banco grava em transação própria, só para os
    25: /** Os usuários da pessoa em cada hospital da Rede, relidos (TBUSERS.BLOQUEADO). */

## packages/dominio-pessoas/src/colaborador/situacao-legada.ts  (só comentário)
- nome-origem: linhas 1,3,25
    1: // Regra 4 do M52 (Anexo A; ref 02; DP-46.1): `TBPROFIS.SITUACAO` NÃO define vínculo trabalhista. Os valores O, F e E
    3: // de `TBCBOPRO.ATIVO` (T 1.949, F 144, nulo <5 no pc); o vínculo de trabalho vem só de SGH_PES_VINCULO.
    25: /** `TBCBOPRO.ATIVO`: T ativo, F inativo, nulo ou outro valor "não informado". */

## packages/dominio-pessoas/src/colaborador/vinculo.ts  (só comentário)
- nome-origem: linhas 1,5,18,51
    1: // Regra 1 do M52 (cap-07 §7.1.1): uma pessoa, vários vínculos. Colaborador, profissional (TBPROFIS) e usuário (TBUSERS)
    5: // dentro de TBPROFIS nem de TBUSERS.
    18: /** O que existe com o CPF no estabelecimento (lido pela API: TBPROFIS, TBUSERS e SGH_PES_VINCULO). */
    51: * contratada pelo hospital e ficam no teto do formulário. O tempo parcial (`POTPCONTTEMP`) é a regra 6, na F2.

## packages/dominio-pessoas/src/escala/conselho-vencido.ts  (só comentário)
- nome-origem: linhas 13
    13: /** Sigla do conselho (TBCBOPRO.CONS_PROF): CRM, COREN… */

## packages/dominio-pessoas/src/escala/limite-contrato.ts  (só comentário)
- nome-origem: linhas 1,11
    1: // Regra 6 do M52 (ref 02; cap-07 §7.1.2): limite de horas do contrato. No tempo parcial (domínio POTPCONTTEMP: 1 = 25 h,
    11: /** POTPCONTTEMP.ID do regime (0: não é tempo parcial). */

## packages/dominio-pessoas/src/esocial/comum.ts
- vocab-antigo: linhas 43
    43: * completada com zeros à direita, como no S-1000) + AAAAMMDDHHMMSS + sequência de 5 dígitos (36 posições).

## packages/dominio-pessoas/src/esocial/eventos-sst.ts
- vocab-antigo: linhas 37,73
    37: /** HHMM. */
    73: /** HHMM; exigido no típico e no trajeto. */

## packages/dominio-pessoas/src/esocial/xsd.ts  (só comentário)
- nome-origem: linhas 5
    5: // D-XSD-536 (POL-5): o catálogo de esquemas do banco (FPESOCARQXSD, 373) traz o XSD de cada evento, mas não o

## packages/dominio-pessoas/src/folha/afastamento.ts  (só comentário)
- nome-origem: linhas 2
    2: // vem do domínio de motivos de afastamento do ramo (FPMOTAFAST, lido na hora), o período fica dentro do vínculo e não se

## packages/dominio-pessoas/src/folha/exportacao.ts  (só comentário)
- nome-origem: linhas 72
    72: /** Os minutos por tipo de hora (POTPHORA) do mesmo fechamento, por vínculo (regra 5; informativo). */

## packages/dominio-pessoas/src/habilitacao/validade.ts  (só comentário)
- nome-origem: linhas 2,39
    2: // profissionais do outro sistema não tem data de validade (TBCBOPRO: COD, UF, CONS_PROF, ATIVO): a validade é
    39: /** TBCBOPRO.ATIVO: o registro inativo não gera alerta. */

## packages/dominio-pessoas/src/obrigacoes/correspondencias.ts  (só comentário)
- nome-origem: linhas 3,12,24,38,52,69,76,80
    3: // tem (FPCAT_SEFIP, FPRESC_SEFIP, FPRESC_CAGED, FPTP_ADM_CAG, FPVINC_RAIS, FPRESC_RAIS, FPTP_ADM_RAIS, lidos onde
    12: /** Categoria do eSocial (tabela 1) → categoria da SEFIP (FPCAT_SEFIP). */
    24: /** Modalidade da rescisão → código de movimentação da SEFIP (FPRESC_SEFIP). */
    38: /** Modalidade da rescisão → tipo de movimento de desligamento do CAGED (FPRESC_CAGED). */
    52: /** Modalidade da rescisão → causa do desligamento da RAIS (FPRESC_RAIS). */
    69: /** Tipo de movimento de admissão do CAGED (FPTP_ADM_CAG). */
    76: /** Tipo de admissão da RAIS (FPTP_ADM_RAIS). */
    80: /** Vínculo empregatício da RAIS (FPVINC_RAIS) pela categoria e pelo tipo de contrato. */

## packages/dominio-pessoas/src/ponto/aej.ts
- vocab-antigo: linhas 13
    13: /** `HHMM`. */

## packages/dominio-pessoas/src/ponto/ajuste.ts  (só comentário)
- nome-origem: linhas 48
    48: /** Códigos do tipo de movimento do ramo (PETP_MOVIM) aceitos. */

## packages/dominio-pessoas/src/ponto/apuracao.ts  (só comentário)
- nome-origem: linhas 3,4
    3: // ajustes aprovados (regra 11), e as horas são classificadas pelos tipos do domínio de horas do ramo (POTPHORA) e
    4: // somadas pelos 13 tipos de integração com a folha (PETP_INTEGR_EVENTO). Tudo em minutos de relógio local de Brasília.

## packages/dominio-pessoas/src/ponto/banco-horas.ts  (só comentário)
- nome-origem: linhas 1,2,50
    1: // Banco de horas, regra 14 do M52 (cap-07 §7.1.3): por regra do regime (destino das horas pelo domínio POBANCOHRTP e o
    2: // início de cada ciclo pelo POTPINIBANCO); o saldo é a SOMA dos movimentos, nunca um campo editável (os movimentos são
    50: /** A virada do ciclo pelo início escolhido (POTPINIBANCO): o que vai à folha e o que expira. */

## packages/dominio-pessoas/src/ponto/exportacao.ts  (só comentário)
- nome-origem: linhas 2,3,21,32,70,132
    2: // M52 (regra 13) já classifica o tempo pelos tipos de hora (POTPHORA) e o reparte pelos 13 tipos de integração com a
    3: // folha (PETP_INTEGR_EVENTO), com as faixas de hora extra no parâmetro da apuração; o fechamento do período grava esses
    21: /** Os minutos por tipo de hora da apuração (POTPHORA) gravados no mesmo fechamento (`classes`); ausente: nenhum. */
    32: /** Regra 5: os minutos fechados por vínculo e tipo de hora (POTPHORA), em ordem, sem os zerados. */
    70: // A classificação da apuração usa sempre os códigos de POTPHORA: outro código é erro de programação.
    132: /** Os minutos por tipo de hora (POTPHORA) gravados no fechamento (`{"classes": {...}}`); ilegível ou ausente: null. */

## packages/dominio-pessoas/src/treinamento/validade.ts  (só comentário)
- nome-origem: linhas 21
    21: /** Código da unidade (TBUNIDAD.COD) ou a chave da função (`chaveFuncao`). */
