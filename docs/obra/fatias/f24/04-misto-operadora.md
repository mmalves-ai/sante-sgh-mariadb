# Fatia F2.4 04-misto-operadora (assunto: operadora+qualidade+raiz-worker; cliente de teste próprio: f24_04mistooperadora)

## apps/api/src/modulos/operadora/ans-porta-propria.ts
- modelo-pendente: linhas 23
    23: // contraprestações do DIOPS, do monitoramento e do ressarcimento respondem 501 `modelo-pendente`.

## apps/api/src/modulos/operadora/apoio-banco.ts
- modelo-pendente: linhas 78
    78: 'modelo-pendente',

## apps/api/src/modulos/operadora/apoio-porta-propria.ts
- modelo-pendente: linhas 9,76
    9: //   - o que o modelo ainda não tem responde 501 `modelo-pendente` (falha fechada, com o nome do recurso), nunca um
    76: 'modelo-pendente',

## apps/api/src/modulos/operadora/atendimento-porta-propria.ts
- modelo-pendente: linhas 17
    17: // portal (identidade no módulo de administração) e anexos da resposta do prestador respondem 501 `modelo-pendente`.

## apps/api/src/modulos/operadora/autorizacao-porta-propria.ts
- modelo-pendente: linhas 21
    21: // 501 `modelo-pendente`.

## apps/api/src/modulos/operadora/cobranca-porta-propria.ts
- modelo-pendente: linhas 16
    16: // (ocorrencia_inadimplencia) respondem 501 `modelo-pendente`;

## apps/api/src/modulos/operadora/porta-propria.ts
- modelo-pendente: linhas 32
    32: // produto (as outras: 501 modelo-pendente), para a leitura e a gravação dos preços não divergirem.

## apps/api/src/modulos/qualidade/apoio-propria.ts
- modelo-pendente: linhas 5,6,154,162,166,172,180
    5: // Melhoria: o que o modelo próprio ainda não cobre recusa com `modelo-pendente` (409), sem gravar nada pela metade; a
    6: // LEITURA do que ainda não tem mapeamento falha fechada (503 `modelo-pendente`), nunca vazio ou zero como se fosse dado.
    154: 'modelo-pendente',
    162: return { pode: false, codigo: 'modelo-pendente', motivo: modeloPendente(o).problema.detail ?? null };
    166: * A LEITURA do que ainda aguarda o mapeamento: falha fechada (503 `modelo-pendente`), para a tela mostrar "indisponível"
    172: 'modelo-pendente',
    180: return e instanceof ErroOperacao && e.problema.codigo === 'modelo-pendente';

## apps/api/src/modulos/qualidade/porta-agravo-propria.ts
- modelo-pendente: linhas 4,5,26
    4: // óbito aguardam o mapeamento (pedido em docs/obra/fatias/f22/arquivo-ondas-1a4/saida/04-03.json e docs/obra/fatias/f24/saida/15-qualidade.json): até lá as leituras falham fechadas (503 `modelo-pende
    5: // gravações recusam com `modelo-pendente` (nada é gravado pela metade; a tela fica em consulta).
    26: // ── Leituras que aguardam o mapeamento: falham fechadas (503 `modelo-pendente`), nunca vazio nem zero ──

## apps/api/src/modulos/qualidade/porta-ccih-propria.ts
- modelo-pendente: linhas 5,6,31
    5: // o mapeamento (pedido em docs/obra/fatias/f22/arquivo-ondas-1a4/saida/04-03.json e docs/obra/fatias/f24/saida/15-qualidade.json): até lá as leituras falham fechadas (503 `modelo-pendente`, a tela mo
    6: // recusam com `modelo-pendente` (nada é gravado pela metade; a tela fica em consulta).
    31: // ── Leituras que aguardam o mapeamento: falham fechadas (503 `modelo-pendente`), nunca vazio nem zero ──

## apps/api/src/modulos/qualidade/porta-gestao-propria.ts
- modelo-pendente: linhas 6,7,45
    6: // aguardam o mapeamento (pedido em docs/obra/fatias/f22/arquivo-ondas-1a4/saida/04-03.json e docs/obra/fatias/f24/saida/15-qualidade.json): até lá as leituras falham fechadas (503 `modelo-pendente`, 
    7: // gravações recusam com `modelo-pendente` (nada é gravado pela metade; a tela fica em consulta).
    45: // ── Leituras que aguardam o mapeamento: falham fechadas (503 `modelo-pendente`), nunca vazio nem zero ──

## apps/api/src/modulos/qualidade/porta-propria.ts
- modelo-pendente: linhas 28,31,726
    28: // (sugestao_notificacao_incidente, que pede o gatilho): as gravações recusam com `modelo-pendente`. Como nada disso pode
    31: // riscos, tecnovigilância por item) falham fechadas (503 `modelo-pendente`).
    726: // ── Etapa 2: nada dela pode ter sido gravado neste banco (as gravações recusam com `modelo-pendente`), então a

## apps/api/src/modulos/qualidade/seguranca.controller.ts
- modelo-pendente: linhas 684
    684: // O que ainda aguarda o mapeamento (503 `modelo-pendente`) não derruba o painel inteiro: a parte sai vazia e vai

## apps/worker/src/contabil/leitura-fatos.service.ts
- modelo-pendente: linhas 11,55
    11: // Melhoria: operação indisponível no banco (recusa `modelo-pendente`) vai ao log com o código, uma vez por
    55: /** Código da falha da contabilização (ex.: `modelo-pendente`); null: rodou ou não foi pedida. */

## apps/worker/src/contabil/porta-propria.ts
- modelo-pendente: linhas 10,64
    10: // Melhoria: operação sem modelo responde a recusa `modelo-pendente` com o nome da operação, nunca lista vazia: com zero
    64: 'modelo-pendente',
