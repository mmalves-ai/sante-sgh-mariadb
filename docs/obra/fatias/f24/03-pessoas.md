# Fatia F2.4 03-pessoas (assunto: pessoas; cliente de teste próprio: f24_03pessoas)

## apps/api/src/modulos/pessoas/autoatendimento/porta-propria.ts
- modelo-pendente: linhas 17
    17: // que tem efeito recusa com `modelo-pendente` e nada é gravado pela metade.

## apps/api/src/modulos/pessoas/avaliacao/porta-propria.ts
- modelo-pendente: linhas 21
    21: // modo e a observação da ciência, o motivo da situação do ciclo e o PDI. Essas gravações recusam com `modelo-pendente`.

## apps/api/src/modulos/pessoas/banco-apoio.ts
- modelo-pendente: linhas 95
    95: return new ErroOperacao(409, 'modelo-pendente', `${operacao} indisponível`, detalhe);

## apps/api/src/modulos/pessoas/escala/porta-realizado-propria.ts
- modelo-pendente: linhas 18,53,420
    18: //     estorno; `repasse.lancarEvento` e o estorno respondem 409 `modelo-pendente`;
    53: const pendente = (titulo: string, motivo: string) => new ErroOperacao(409, 'modelo-pendente', titulo, motivo);
    420: ? { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_LANCAMENTO }

## apps/api/src/modulos/pessoas/esocial/porta-esocial-propria.ts
- modelo-pendente: linhas 24,93,99
    24: // evento não periódico. Até lá, recusa com o código `modelo-pendente` (nunca vazio calado nem gravação pela metade):
    93: 'modelo-pendente',
    99: 'modelo-pendente',

## apps/api/src/modulos/pessoas/folha/porta-calculo-propria.ts
- modelo-pendente: linhas 8,73,128
    8: // fechamento do período), recusam com `modelo-pendente`, e a gravação fica desligada (`podeGravar` diz o motivo) até o
    73: 'modelo-pendente',
    128: codigo: 'modelo-pendente',

## apps/api/src/modulos/pessoas/folha/porta-folha-propria.ts
- modelo-pendente: linhas 8,112
    8: // `modelo-pendente` até o DDL pedido em docs/obra/fatias/f22/saida/03-06.json.
    112: 'modelo-pendente',

## apps/api/src/modulos/pessoas/folha/porta-integracao-propria.ts
- modelo-pendente: linhas 5,74,101
    5: // O que ainda não tem tabela no modelo NÃO devolve vazio: recusa com 503 `modelo-pendente`, dizendo a operação, e a
    74: 'modelo-pendente',
    101: return { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_SEM_GRAVACAO };

## apps/api/src/modulos/pessoas/folha/servico-integracao.ts
- modelo-pendente: linhas 74,78,159
    74: /** A recusa 503 `modelo-pendente` da porta (operação sem tabela no modelo). */
    78: (e as { problema?: { codigo?: unknown } }).problema?.codigo === 'modelo-pendente';
    159: // Sem a tabela do de-para no modelo (503 modelo-pendente), o apoio segue como "sem de-para vigente": a tela consulta

## apps/api/src/modulos/pessoas/sesmt/porta-sesmt-propria.ts
- modelo-pendente: linhas 239
    239: 'modelo-pendente',
