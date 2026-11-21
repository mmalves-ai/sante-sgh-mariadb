# Fatia F2.4 13-recepcao (assunto: recepcao; cliente de teste próprio: f24_13recepcao)

## apps/api/src/modulos/recepcao/aplicacao/worklist-recepcao.ts  (só comentário)
- nome-origem: linhas 2
    2: // pela prioridade legal (TBGRUPOPRIORIDADE; Lei 13.466/2017) com a espera, as chegadas do dia (as marcações da agenda e

## apps/api/src/modulos/recepcao/classificacao-porta-propria.ts
- modelo-pendente: linhas 16
    16: // as metas e o checklist do protocolo gerenciado não têm coluna ou tabela: as gravações respondem "modelo-pendente" e

## apps/api/src/modulos/recepcao/operacoes.ts
- modelo-pendente: linhas 466
    466: 'modelo-pendente',

## apps/api/src/modulos/recepcao/porta-propria.ts
- modelo-pendente: linhas 13,73
    13: // "modelo-pendente" e as leituras devolvem vazio, sem contorno.
    73: 'modelo-pendente',

## apps/api/src/modulos/recepcao/worklist.controller.ts
- nome-origem: linhas 87
    87: tabelaAlvo: 'TBSENHAATEND',

## apps/web/src/modulos/recepcao/formato.ts
- vocab-antigo: linhas 37
    37: * M44 (etapa 3): a hora digitada (HHMM do campo de hora) no dia do relógio do banco (AAAA-MM-DDTHH:MM). Hora depois da

## apps/web/src/modulos/recepcao/i18n-classificacao.ts  (só comentário)
- nome-origem: linhas 2
    2: // (ADR 0023): o formulário E08 é "o formulário de classificação do prontuário"; a tabela PRMANCHESTER é "a tabela de

## packages/contratos/src/recepcao/classificacao.ts  (só comentário)
- nome-origem: linhas 5,64,139,216
    5: // a tabela de cores do sistema anterior (PRMANCHESTER, 7 linhas) é só consulta e referência opcional.
    64: /** Código do modelo do formulário de classificação do prontuário (PREVOLUCAO.COD). */
    139: /** Referência opcional à cor equivalente da tabela de cores antiga (PRMANCHESTER.ID). */
    216: /** Número do atendimento do PA (RECADATE.REG). */

## packages/contratos/src/recepcao/entradas.ts  (só comentário)
- nome-origem: linhas 2,3,121
    2: // executor (o mesmo Zod). Vocabulário do novo: o gerador é o ID de TBGERASENHA, a recepção o de TBRECEPCAO, o local
    3: // o de TBLOCAL, a senha o ID de TBSENHAATEND; o guichê é o número (1 a 99, NUMERIC(2,0)). A data e a hora vêm sempre
    121: /** ID da marcação (REPACAGD para consulta; SIPACAGD para exame). */

## packages/contratos/src/recepcao/estados.ts  (só comentário)
- nome-origem: linhas 2,15,21
    2: // (TBSENHAATEND.SITUACAO) e o que cada evento grava, medidos no perfil passivo da cópia pc (só agregados; sequências
    15: /** TBSENHAATEND.SITUACAO ('' tratado como G). */
    21: /** TBGERASENHA.TIPO ('0' recepção, '5' diversos). */

## packages/contratos/src/recepcao/protocolo-gerenciado.ts  (só comentário)
- nome-origem: linhas 133
    133: /** Número do atendimento do PA (RECADATE.REG). */

## packages/contratos/src/recepcao/respostas.ts  (só comentário)
- nome-origem: linhas 50
    50: /** Locais para onde este local encaminha (TBLOCALENCATE). */

## packages/contratos/src/recepcao/vocabulario.ts  (só comentário)
- nome-origem: linhas 2,4,6,11,21,64,75,90,105,123
    2: // TBACAOFLUXOSENHA (domínio do legado, M14) e as situações de TBSENHAATEND.SITUACAO; o novo só grava as letras já
    4: //   - TBSENHAATEND (301.109; 40.120 em 2026): SITUACAO A 126.709, L 100.557, S 73.417, G 399, C 27; PRIORIDADE
    6: //   - TBFLUXOATEND (555.695): A 231.735, L 154.306, C 93.549, S 73.813, X 1.773, N 458, E 61; nenhum G;
    11: /** Situação da senha (TBSENHAATEND.SITUACAO), com o rótulo de produto. */
    21: /** Letras de evento do fluxo (TBACAOFLUXOSENHA) e se o perfil da cópia as mostra (só as vistas gravam). */
    64: * Prioridade gravada (TBSENHAATEND.PRIORIDADE, CHAR(1)): o domínio do legado 0/1/2 (TBGRUPOPRIORIDADE 0 acima de 80
    75: /** Grupos legais (TBGRUPOPRIORIDADE, 10 linhas) e a prioridade 0/1/2 que cada um grava hoje. */
    90: /** Tipos de gerador (TBGERASENHA.TIPO, Anexo A §A.3): só 0 e 5 têm uso; 1 a 4 existem como colunas vazias. */
    105: * Motivos padronizados da suspensão (o legado guarda texto livre de até 50 caracteres em TBSENHAATEND.MOTIVO: 6.137
    123: /** Texto gravado em TBSENHAATEND.MOTIVO (VARCHAR(50)): o motivo padronizado e, no "outro", o complemento. */

## packages/dominio-recepcao/src/fluxo.ts  (só comentário)
- nome-origem: linhas 2
    2: // permite (TBLOCALENCATE: 12 ↔ 13 e 23 → 13 no pc); o gerador tipo 0 (recepção) segue para a abertura do atendimento e

## packages/dominio-recepcao/src/prioridade.ts  (só comentário)
- nome-origem: linhas 4
    4: // sistema chama na ordem certa as senhas dos 7 grupos nunca usados (TBGRUPOPRIORIDADE 3 a 9).

## packages/dominio-recepcao/src/worklist/ordenacao.ts  (só comentário)
- nome-origem: linhas 2
    2: // pela prioridade legal (TBGRUPOPRIORIDADE: acima de 80 anos antes das demais prioridades, que vêm antes da normal; a
