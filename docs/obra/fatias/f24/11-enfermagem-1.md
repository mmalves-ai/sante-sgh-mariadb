# Fatia F2.4 11-enfermagem-1 (assunto: enfermagem-1; cliente de teste próprio: f24_11enfermagem1)

## apps/api/src/modulos/enfermagem/balanco-porta-propria.ts
- modelo-pendente: linhas 15,97
    15: // checagem pendentes é recusado com 'modelo-pendente' e o reenvio do mesmo lançamento não é reconhecido.
    97: 'modelo-pendente',

## apps/api/src/modulos/enfermagem/balanco.controller.ts
- nome-origem: linhas 181
    181: req.sghAlvo = { tabelaAlvo: 'RICADINT' };

## apps/api/src/modulos/enfermagem/enfermagem.controller.ts
- nome-origem: linhas 295,340,376,422,501,858
    295: tabelaAlvo: 'PRCHKGERAL',
    340: tabelaAlvo: 'PRCHKGERAL',
    376: req.sghAlvo = { tabelaAlvo: 'PRCHKGERAL', chaveNaturalAlvo: `unidade:${u}:${r.horarios.length}` };
    422: tabelaAlvo: 'PRCHKGERAL',
    501: tabelaAlvo: 'PRCHKGERAL',
    858: req.sghAlvo = { tabelaAlvo: 'PRCHKGERAL', chaveNaturalAlvo: `aprazamento:${u}:${itens.length}` };

## apps/api/src/modulos/enfermagem/escores-porta-propria.ts
- modelo-pendente: linhas 22,101
    22: // gravações recusadas com 'modelo-pendente' até as tabelas existirem.
    101: 'modelo-pendente',

## apps/api/src/modulos/enfermagem/operacoes.ts
- modelo-pendente: linhas 183
    183: 'modelo-pendente',

## apps/api/src/modulos/enfermagem/porta-propria.ts
- modelo-pendente: linhas 19,173
    19: // com 'modelo-pendente' até as tabelas existirem.
    173: 'modelo-pendente',

## apps/api/src/modulos/enfermagem/prescricao-enfermeiro.controller.ts
- nome-origem: linhas 223
    223: req.sghAlvo = { tabelaAlvo: 'ATCABECATEND', chaveNaturalAlvo: `dia:${dia};n:${String(lista.length)}` };

## apps/api/src/modulos/enfermagem/sae-porta-propria.ts
- modelo-pendente: linhas 19,88
    19: // identificador) e a terminologia licenciada carregada por estabelecimento respondem 409 modelo-pendente; as leituras
    88: 'modelo-pendente',

## apps/api/src/modulos/enfermagem/sae-servico.ts  (só comentário)
- nome-origem: linhas 39
    39: /** O vínculo (TBCBOPRO) da categoria; nulo sem vínculo de enfermagem. */

## apps/api/src/modulos/enfermagem/sae.controller.ts
- nome-origem: linhas 199
    199: req.sghAlvo = { tabelaAlvo: 'RICADINT' };

## apps/api/src/modulos/enfermagem/transfusao-porta-propria.ts
- modelo-pendente: linhas 22,238
    22: // ato (alterar e adendo respondem 409 modelo-pendente; as leituras devolvem vazio); os alertas da dupla checagem vão à
    238: 'modelo-pendente',

## apps/api/src/modulos/enfermagem/transfusao.controller.ts
- nome-origem: linhas 275,287
    275: req.sghAlvo = { tabelaAlvo: 'PRPRESCHEMO', chaveNaturalAlvo: `itens:${String(r.itens.length)}` };
    287: req.sghAlvo = { paciente: i.paciente.id, tabelaAlvo: 'PRPRESCHEMO', idAlvo: String(i.item) };

## apps/api/src/modulos/enfermagem/vacina.controller.ts
- nome-origem: linhas 223,242
    223: req.sghAlvo = { tabelaAlvo: 'RICADINT' };
    242: req.sghAlvo = { tabelaAlvo: 'ATCABECATEND', chaveNaturalAlvo: `dia:${dia};n:${String(r.itens.length)}` };

## packages/contratos/src/enfermagem/balanco.ts
- vocab-antigo: linhas 261
    261: /** Hora de corte da unidade (HHMM; padrão 0700). */

## packages/dominio-enfermagem/src/balanco/janela.ts
- vocab-antigo: linhas 11
    11: /** HHMM (ou HH:mm) → HH:mm, recusando a hora fora do formato. */

## packages/dominio-enfermagem/src/sae/prescricao-enfermagem.ts
- vocab-antigo: linhas 29
    29: * A proposta dos horários da atividade: a grade de horários-padrão da unidade para o número de vezes ao dia (HHMM ou
