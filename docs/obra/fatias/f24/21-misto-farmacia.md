# Fatia F2.4 21-misto-farmacia (assunto: farmacia+portal-medico+raiz-worker+telemedicina; cliente de teste próprio: f24_21mistofarmacia)

## apps/api/src/modulos/farmacia/farmacia.controller.ts
- nome-origem: linhas 222,243,284,319,555
    222: req.sghAlvo = { tabelaAlvo: 'PRCHKGERAL', idAlvo: `unidade ${unidade}` };
    243: req.sghAlvo = { tabelaAlvo: 'GEDISPHOR', idAlvo: `atendimento ${r}` };
    284: req.sghAlvo = { tabelaAlvo: 'GECTRLENTREGADOCSAIDA', idAlvo: `situação ${situacao}` };
    319: req.sghAlvo = { tabelaAlvo: 'PREXTRATOITEM_TBSITFARM', idAlvo: `unidade ${unidade}` };
    555: req.sghAlvo = { tabelaAlvo: 'GELANSAI', idAlvo: `controlado ${item} ${p.inicio}..${p.fim}` };

## apps/api/src/modulos/farmacia/gravador-avaliacao.ts
- modelo-pendente: linhas 14,45
    14: // tem aprovado, aprovado_com_ressalva, recusado e substituido); essa decisão recusa com 'modelo-pendente'.
    45: 'modelo-pendente',

## apps/api/src/modulos/farmacia/operacoes.ts
- modelo-pendente: linhas 2
    2: // A porta em memória aplica o mesmo Zod; a porta própria recusa com 'modelo-pendente' as que ainda esperam o modelo.

## apps/api/src/modulos/farmacia/porta-propria.ts
- modelo-pendente: linhas 15,146,168
    15: // CHECK). Até lá, essas leituras voltam vazias e essas gravações recusam com 'modelo-pendente' (409); nada é gravado
    146: codigo: 'modelo-pendente',
    168: * recusam com 'modelo-pendente', cada uma com o seu pedido no lote 02-06.

## apps/api/src/modulos/portal-medico/aplicacao/servico.ts
- modelo-pendente: linhas 112,1494
    112: (x as { problema?: { codigo?: unknown } }).problema?.codigo === 'modelo-pendente';
    1494: // A notificação é só um adorno de cada aviso: se o banco ainda não a tem (409 modelo-pendente), os avisos de crítico

## apps/api/src/modulos/portal-medico/porta-propria.ts
- modelo-pendente: linhas 17,93
    17: // Pendências (nada em silêncio; a tela recebe 409 modelo-pendente com o motivo; pedido de DDL na saída do lote 04-02):
    93: 'modelo-pendente',

## apps/web/src/modulos/portal-medico/i18n.ts
- vocab-antigo: linhas 213
    213: hora: 'Início (HHMM)',

## packages/contratos/src/portal-medico/portal-medico.ts
- vocab-antigo: linhas 145
    145: /** HHMM. */

## apps/worker/src/contabil/leitura-fatos.service.ts
- modelo-pendente: linhas 11,55
    11: // Melhoria: operação indisponível no banco (recusa `modelo-pendente`) vai ao log com o código, uma vez por
    55: /** Código da falha da contabilização (ex.: `modelo-pendente`); null: rodou ou não foi pedida. */

## apps/worker/src/contabil/porta-propria.ts
- modelo-pendente: linhas 10,64
    10: // Melhoria: operação sem modelo responde a recusa `modelo-pendente` com o nome da operação, nunca lista vazia: com zero
    64: 'modelo-pendente',

## apps/worker/src/integracao/porta-propria.ts
- modelo-pendente: linhas 332
    332: if (!padrao) throw recusa('modelo-pendente', `O padrão de troca "${familia}" não está cadastrado neste cliente.`);

## apps/worker/src/servico-worker.ts
- vocab-antigo: linhas 111
    111: /** Data civil (AAAA-MM-DD) e hora "HHMM" de um instante no fuso (a forma do contrato do movimento do censo). */

## apps/api/src/modulos/telemedicina/porta-propria.ts
- vocab-antigo: linhas 74,80
    74: /** O instante no fuso: data civil, hora em HHMM e o carimbo local (AAAA-MM-DDTHH:MM:SS). */
    80: /** A data civil e a hora (HHMM) no fuso do estabelecimento como instante. */

## apps/api/src/modulos/telemedicina/porta.ts
- vocab-antigo: linhas 43
    43: /** A teleconsulta (ou teleinterconsulta) lida. `hora` vai em HHMM, o formato do contrato da tela e do domínio. */

## packages/contratos/src/telemedicina/teleconsulta.ts
- vocab-antigo: linhas 181
    181: /** Data e hora marcadas (HHMM); na teleinterconsulta, quando foi pedida. */
- nome-origem: linhas 137,139
    137: /** O atendimento (RECADATE.REG) em que o médico assistente pede a opinião. */
    139: /** O vínculo profissional (TBCBOPRO.ID) do médico convidado. */
