# Fatia F2.4 01-pessoas-1 (assunto: pessoas-1; cliente de teste próprio: f24_01pessoas1)

## apps/api/src/modulos/pessoas/autoatendimento/porta-propria.ts
- modelo-pendente: linhas 13,16
    13: // não têm tabela: incluir e ler o atestado recusam com `modelo-pendente`; como nada pode ter sido gravado, a lista de
    16: // recusa com `modelo-pendente` e nada é gravado pela metade.

## apps/api/src/modulos/pessoas/avaliacao/porta-propria.ts
- modelo-pendente: linhas 21
    21: // modo e a observação da ciência, o motivo da situação do ciclo e o PDI. Essas gravações recusam com `modelo-pendente`.

## apps/api/src/modulos/pessoas/banco-apoio.ts
- modelo-pendente: linhas 95
    95: return new ErroOperacao(409, 'modelo-pendente', `${operacao} indisponível`, detalhe);
- vocab-antigo: linhas 57
    57: /** Deslocamento "±HHMM" ou "±HH:MM" → minutos. */

## apps/api/src/modulos/pessoas/cargos/porta-propria.ts
- modelo-pendente: linhas 21,87
    21: // 409 modelo-pendente, sem gravar nada.
    87: 'modelo-pendente',

## apps/api/src/modulos/pessoas/escala/porta-escala-propria.ts
- modelo-pendente: linhas 19,253
    19: // cobertura respondem 409 `modelo-pendente`; a publicação avisa que a conferência de furo não foi feita) e o prazo de
    253: new ErroOperacao(409, 'modelo-pendente', 'Cobertura mínima indisponível', MOTIVO_COBERTURA);

## apps/api/src/modulos/pessoas/escala/porta-realizado-propria.ts
- modelo-pendente: linhas 18,54,396
    18: //     estorno; `repasse.lancarEvento` e o estorno respondem 409 `modelo-pendente`;
    54: const pendente = (titulo: string, motivo: string) => new ErroOperacao(409, 'modelo-pendente', titulo, motivo);
    396: ? { pode: false, codigo: 'modelo-pendente', motivo: MOTIVO_LANCAMENTO }

## apps/api/src/modulos/pessoas/esocial/porta-esocial-propria.ts
- modelo-pendente: linhas 24,93,99
    24: // evento não periódico. Até lá, recusa com o código `modelo-pendente` (nunca vazio calado nem gravação pela metade):
    93: 'modelo-pendente',
    99: 'modelo-pendente',

## apps/api/src/modulos/pessoas/esocial/servico-esocial.ts
- vocab-antigo: linhas 254
    254: /** AAAAMMDDHHMMSS do relógio do banco (o identificador do evento). */

## apps/api/src/modulos/pessoas/folha/integracao.controller.ts
- nome-origem: linhas 104
    104: 'executor: financeiro.criarTituloPagar (incluir-folha: MFCONPAG, MFLANGSI; SGH_PES_FOLHA_LANCAMENTO, _TITULO, _FATO e SGH_OUTBOX com a SGH_TRILHA)',

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

## apps/api/src/modulos/pessoas/folha/tipos-folha.ts
- vocab-antigo: linhas 3
    3: // negócio). Substituem os tipos de leitura e gravação do sistema de origem; nada de S/N, HHMM ou sentinela.

## apps/api/src/modulos/pessoas/pessoas.controller.ts
- nome-origem: linhas 260
    260: 'executor: acesso.bloquearUsuario (TBCABTRILHA e SGH_TRILHA); SGH_PES_VINCULO, SGH_PES_HISTORICO e SGH_OUTBOX com a SGH_TRILHA',
