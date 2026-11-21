# Fatia F2.4 02-pacote-contratos-2 (assunto: pacote-contratos-2; cliente de teste próprio: f24_02pacotecontratos2)

## packages/contratos/dist/repasse/respostas.d.ts  (só comentário)
- nome-origem: linhas 45,164,187
    45: /** TBREPGER.ID depois da inclusão aprovada. */
    164: /** Título a pagar que nasceu com o RPA (MFCONPAG.ID). */
    187: /** Adiantamentos ao médico (MFADIFOR M; só consulta: regra 11). */

## packages/contratos/dist/repasse/vocabulario.d.ts  (só comentário)
- nome-origem: linhas 1,12,17,24,25,34
    1: /** Tipo de prestador do repasse (RPTIPOPRESTADOR.COD; 6 linhas no pc). */
    12: * Tipo de credor do título a pagar que nasce do repasse (MFCONPAG.TIPO com ONDE='R'; ref 01 §2.5): M (médico,
    17: /** Beneficiário da regra (TBREPGER.MED_PRS): médico ou prestador. */
    24: * Tipo de conta da regra (TBREPGER.TIPO_CTA): A 756, E 38.525, I 66.149 regras no pc. A conta só tem E e I
    25: * (FCCTAEXT); "A" é lido como "as duas" (vale para qualquer conta), a confirmar no teste dourado.
    34: * Valor do item que a apuração integrou (FCINTEGRPA.ID_TBTIPOLANCVLR → TBTIPOLANCVLR). No pc: 6.016 linhas de valor

## packages/contratos/dist/sadt/vocabulario.d.ts  (só comentário)
- nome-origem: linhas 21
    21: /** Atos do legado (SILANEXA.ATO; Anexo A §A.1) com o rótulo de produto e o setor. */

## packages/contratos/dist/suporte/suporte.d.ts  (só comentário)
- nome-origem: linhas 70,98,199,272
    70: * "em nome de quem gravar" (TBUSERS.NOME nas colunas de usuário, na trilha e nos gatilhos do legado); a
    98: /** Grupo ativo do TBGRUUSU com a contagem de logins não bloqueados. */
    199: /** Linha do relatório que cruza a TBCABTRILHA com a auditoria do "como" (R3). */
    272: /** TBUSERS.ID_TBUSERS do alvo. */

## packages/contratos/dist/suprimentos/onda3.d.ts
- nome-origem: linhas 12,29,33,37,41,45,49,53,58,278,284
    12: /** Grupos funcionais (TBGRUUSU.NOME, sem acento) de quem começa no setor (cap-15 §15.4.1). */
    29: * O catálogo de operações nunca as lista entre as gravadas pelo novo. GEARMLOC e FCLANEXT: o outro sistema as grava
    33: export declare const TABELAS_EFEITO_ESTOQUE: readonly ["GEARMLOC", "GESALDOS", "GEITENS", "GEKONCDC", "GECONITL", "FCLANEXT", "GEULTDOCGER"];
    37: readonly tabela: "GECADSAI";
    41: readonly tabela: "GECADDEV";
    45: readonly tabela: "GECADTRA";
    49: readonly tabela: "GECADNFS";
    53: readonly tabela: "GECADDISPENSACAO";
    58: /** Módulo de estoque nas conexões ao banco (TBSGHCONEXAO.MODULO = TBMODULO.ID "Gestão de estoque"). */
    278: readonly tabela: "GECADSAI";
    284: readonly tabela: "GECADSAI";

## packages/contratos/dist/suprimentos/opme-respostas.d.ts  (só comentário)
- nome-origem: linhas 205
    205: * Uma saída do estoque do lote (GERASVALSAIDLOTE → GELANSAI → GECADSAI), feita no consumo em sala ou por outro caminho

## packages/contratos/dist/suprimentos/opme-vocabulario.d.ts  (só comentário)
- nome-origem: linhas 1
    1: /** A classe dos itens de OPME no cadastro de itens do estoque (TBCLASSI 50). */

## packages/contratos/dist/suprimentos/regras/cotacao.d.ts  (só comentário)
- nome-origem: linhas 3
    3: /** `GELANPED.ID` da linha da proposta. */

## packages/contratos/dist/suprimentos/regras/escopo.d.ts  (só comentário)
- nome-origem: linhas 4
    4: /** Códigos de `GELOCUSU.TIPO_MOV` (uma linha por usuário, local e tipo; contagens na cópia pc). */

## packages/contratos/dist/suprimentos/regras/farmacia-avaliacao.d.ts  (só comentário)
- nome-origem: linhas 54
    54: * Regra 8: gravar a decisão no outro sistema (2, 3 ou 4 em `PREXTRATOITEM_TBSITFARM`) só com a decisão registrada

## packages/contratos/dist/suprimentos/regras/farmacia-controlado.d.ts  (só comentário)
- nome-origem: linhas 2,7
    2: /** As listas vistas no cadastro de itens da cópia (`GEITENS.PORTARIA`): A1 8, A2 3, B1 14, C1 32, C5 1. */
    7: /** O vínculo profissional (TBCBOPRO.ID). */

## packages/contratos/dist/suprimentos/regras/farmacia-entrega.d.ts  (só comentário)
- nome-origem: linhas 5,19,24
    5: /** A última situação do documento em GECTRLENTREGADOCSAIDA (7, 8 ou 9). */
    19: /** GEDISPHOR.ID. */
    24: /** A saída que levou a dose (GELANSAI). */

## packages/contratos/dist/suprimentos/regras/farmacia-fila.d.ts  (só comentário)
- nome-origem: linhas 10,23,62
    10: /** O horário prescrito (PRCHKGERAL.ID). */
    23: /** Já dispensada por qualquer dos dois sistemas (GEDISPHOR ou PRINTEGRACAOESTOQUE ligados ao horário). */
    62: /** Política "dispensar só depois de validar", por classe (parâmetro SGH_; nada em PRPARAM). */

## packages/contratos/dist/suprimentos/regras/farmacia-situacao.d.ts  (só comentário)
- nome-origem: linhas 64
    64: /** A situação de entrega do documento (GECTRLENTREGADOCSAIDA): só 7, 8 e 9 vistos (272.413, 2.607 e 3). */

## packages/contratos/dist/suprimentos/regras/onda3.d.ts  (só comentário)
- nome-origem: linhas 51,53,55,59
    51: /** Itens com linha no saldo mensal (GESALDOS) da competência do documento. */
    53: /** O documento tem consumo registrado (GEKONCDC); null quando não se aplica (centro técnico, sem centro). */
    55: /** Itens com saldo no local na competência (GEARMLOC); informativo (D-MOTOR-28). */
    59: * O efeito esperado num documento do novo. O consumo (GEKONCDC) é informativo por padrão: na cópia pc, 274 de 9.619

## packages/contratos/dist/suprimentos/regras/opme.d.ts  (só comentário)
- nome-origem: linhas 4
    4: /** A classe do item no cadastro (TBCLASSI): só a classe de OPME. */

## packages/contratos/dist/suprimentos/regras/saida.d.ts  (só comentário)
- nome-origem: linhas 9,12
    9: /** `GEITENS.ESTOQUE` e `GEITENS.TOTAL` (saldo e valor do item na empresa). */
    12: /** `GEITENS.VLRMED`: item de custo zero (abaixo de 0,01) sai sem valor, como o gatilho aceita. */

## packages/contratos/dist/suprimentos/respostas.d.ts  (só comentário)
- nome-origem: linhas 88,965,971
    88: /** A ficha do item (GEITENS com a classe e o grupo): as unidades por uso e os fatores de conversão. */
    965: /** Terceiro destinatário de saída (GECADTER): só o código e o nome (a data de nascimento não sai). */
    971: /** Colaborador ou prestador (GETABFUN): o CPF e a conta mascarados; retenções só como marca. */

## packages/contratos/dist/telemedicina/teleconsulta.d.ts
- vocab-antigo: linhas 186
    186: /** Data e hora marcadas (HHMM); na teleinterconsulta, quando foi pedida. */

## packages/contratos/dist/texto/fonetica.d.ts  (só comentário)
- nome-origem: linhas 1,5
    1: /** Tamanho de TBDICIONARIO_TBUSERS.PALAVRA e .FONETICA (VARCHAR(50)). */
    5: /** A fonética da palavra (TBDICIONARIO_TBUSERS.FONETICA). */
