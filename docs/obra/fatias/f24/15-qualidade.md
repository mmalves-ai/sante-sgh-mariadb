# Fatia F2.4 15-qualidade (assunto: qualidade; cliente de teste próprio: f24_15qualidade)

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
    4: // óbito aguardam o mapeamento (pedido em docs/obra/fatias/f22/saida/04-03.json): até lá as leituras falham fechadas (503 `modelo-pendente`, a tela mostra indisponível) e as
    5: // gravações recusam com `modelo-pendente` (nada é gravado pela metade; a tela fica em consulta).
    26: // ── Leituras que aguardam o mapeamento: falham fechadas (503 `modelo-pendente`), nunca vazio nem zero ──

## apps/api/src/modulos/qualidade/porta-ccih-propria.ts
- modelo-pendente: linhas 5,6,31
    5: // o mapeamento (pedido em docs/obra/fatias/f22/saida/04-03.json): até lá as leituras falham fechadas (503 `modelo-pendente`, a tela mostra indisponível) e as gravações
    6: // recusam com `modelo-pendente` (nada é gravado pela metade; a tela fica em consulta).
    31: // ── Leituras que aguardam o mapeamento: falham fechadas (503 `modelo-pendente`), nunca vazio nem zero ──

## apps/api/src/modulos/qualidade/porta-gestao-propria.ts
- modelo-pendente: linhas 6,7,45
    6: // aguardam o mapeamento (pedido em docs/obra/fatias/f22/saida/04-03.json): até lá as leituras falham fechadas (503 `modelo-pendente`, a tela mostra indisponível) e as
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

## apps/web/src/modulos/qualidade/ccih/regras-ccih.ts
- vocab-antigo: linhas 287
    287: * "HHMM" (o formato do cadastro); "HH:MM" também vale.

## apps/web/src/modulos/qualidade/regras-qualidade.ts
- vocab-antigo: linhas 25
    25: // O campo de hora devolve "HHMM" depois que o usuário edita (o formato do cadastro); "HH:MM" vem do relógio.

## packages/contratos/src/qualidade/notificacao.ts  (só comentário)
- nome-origem: linhas 181,330,335
    181: /** Login do outro sistema (TBUSERS.NOME). */
    330: * Contexto da tela de origem relido pelo servidor (ATCABECATEND pelo ID, com o cadastro do paciente, a unidade e o
    335: /** RICADPAC.ID. */
