# F2.4, 3ª etapa: peças comuns (código compartilhado)

## O que mudou
- **Hora neutra no componente de hora.** `SanteHora` guarda e devolve `HH:MM` (auxiliares de `formatacao/hora.ts`):
  aceita `8:30`, `0830` e `830` na digitação e mostra o valor fora de `HH:MM` como veio, com alerta.
  - `hora-legada.ts` e o spec dele foram apagados.
  - As telas que montavam o instante a partir dos quatro dígitos passaram a usar `HH:MM` direto: registro do PEP,
    realizado do plantão, CAT, retificação de acidente, plantão agora e relógio de protocolos.
- **Relógio do estabelecimento só em `HH:MM`** (`apps/api/src/modulos/exames/relogio.ts`).
  - `relogioNoFuso` devolve `{ hoje, hora }` e `civil` devolve `{ data, hora }`. O campo de quatro dígitos saiu.
  - A troca foi feita de ponta a ponta nos 16 módulos que usavam o relógio, entre eles ADT, portaria, internação,
    preços, repasse, nutrição, SADT, digitalização, pessoas, especialidades, faturamento, qualidade e manutenção.
  - As horas de entrada, saída e previsão da ADT agora saem em `HH:MM`.
- **Lista das tabelas clínicas pelo gerador.** `tools/verificadores/src/imutabilidade.ts` passou a gerar
  `tabelas-clinicas.gerado.ts` a partir do DDL do modelo próprio (`TABELAS_CLINICAS_MODELO`, 158 tabelas, com a
  trilha), não mais da matriz da origem.
  - O arquivo foi regenerado.
  - O contrato `ehTabelaClinica` compara sem diferenciar maiúsculas de minúsculas.
  - O teste "está em dia" deixou de ser pulado.
- **Pacote comum da contabilidade `@sgh/persistencia-contabil`** (`tipo:infra`). Saíram da porta da API para ele:
  - as consultas e as conversões;
  - a regra do bloqueio do período;
  - o núcleo do gravador: situação do fato e lançamento com as partidas, com a conferência no fim da transação;
  - `gravarContabilizacao`, que grava o lote pelo Executor, com trilha.

  A API e o worker usam o mesmo código. A porta do worker agora lê e grava a contabilização automática de verdade, e
  as duas recusas `modelo-pendente` saíram. O teste de integração do worker prova que os pendentes sem regra viram
  "sem regra" numa transação, sem tocar outro estabelecimento.
- **Numerações no "criar cliente".** O novo `tools/db/configurar_numeracoes.py` inclui em `sequencia_negocio`, para
  cada estabelecimento ativo, as 25 numerações que as operações pedem sem criar.
  - Entre elas estão `ato_cirurgico`, `agendamento_cirurgico`, `internacao`, `prontuario`, `laudo_exame` e as guias e
    protocolos da operadora.
  - O script é idempotente e nunca altera a numeração que já existe.
  - `criar_cliente.py` chama o script e registra a contagem no evento.
- **Título a pagar composto.** `gravadorTituloPagar(tx)` e `TABELAS_TITULO_PAGAR` saem de `financeiro/public-api`.
  - O gravador valida pelo contrato e grava o título, as parcelas, as retenções e o rateio na transação de quem
    chama, com as mesmas recusas de `financeiro.criarTituloPagar`.
  - Ele devolve o evento que a operação chamadora deve publicar.
  - Um teste de integração prova que a recusa desfaz a transação inteira.

## Decisões pela melhor prática
- O processo automático grava a contabilização com usuário nulo. A chave idempotente do lote é o hash das ações
  lidas, então o mesmo lote repetido devolve o resultado gravado.
- As numerações começam em 1. Para uma base importada, quem cria a linha antes da carga é o conector, começando
  depois do maior número importado. A carga nunca sobrescreve.
- A lista clínica é a mesma que a guarda da imutabilidade usa: tabelas com paciente, atendimento ou internação nos
  módulos 06_PEP, 07_INT, 08_CC e 10_SADT, mais a trilha.

## Pedidos
Os pedidos estão em `pecas-comuns-3.json`.
