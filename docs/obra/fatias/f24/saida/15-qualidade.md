# F2.4 lote 15-qualidade

## O que mudou
- **Hora na tela (web):** `instanteDosCampos` (notificação de incidente e agravo) e `instanteLocal` (CCIH) passam a ler a hora pelo auxiliar neutro `lerHoraDigitada` do contrato, por meio de `horaDoCampo` em `regras-qualidade.ts`. Hora fora do intervalo (25:00, 08:75) agora é recusada (vira null e o formulário aponta o campo); antes passava.
- **Contrato da notificação:** comentários sem nome de tabela ou coluna de origem (login da conta, id do paciente, atendimento pelo id, número do atendimento).
- **Portas próprias:** o caminho do pedido citado nos comentários foi corrigido (o 04-03 foi arquivado em `f22/arquivo-ondas-1a4/`).
- Dívida do lote: web 0; contrato 0; api/qualidade continua com 6 arquivos de `modelo-pendente`.

## Decisões pela melhor prática
- A recusa `modelo-pendente` **não** foi trocada por vazio nem apagada só do comentário: as leituras e gravações continuam falhando fechadas até a porta existir de fato.
- A notificação compulsória (agravo) não pode ser ligada às tabelas atuais: `notificacao_agravo` não tem origem do gatilho, chave idempotente, exame, periodicidade, registro da notificação à autoridade nem descarte justificado, e exige um profissional notificante que o caso automático não tem. Há também a falta de uma tabela de gatilhos por exame. Por isso o pedido é de DDL.

## Pedidos (detalhe em `15-qualidade.json`)
1. DDL de `notificacao_agravo` (colunas do caso) e da nova `gatilho_exame_agravo`; e a carga versionada do cadastro de agravos notificáveis.
2. Três lotes de construção dedicados, porque passam do tamanho de um lote de dívida: a porta da CCIH (45 métodos), a da gestão da qualidade (46 métodos) e a etapa 2 da notificação, com as 7 leituras de outros módulos. As tabelas já existem.
3. O apoio `modeloPendente` e o `indisponiveis` do painel saem depois dos itens 1 e 2.

## Segunda passada (correção)
- **tsc da web:** `correcao-telas.spec.ts` e `revisao-corretor-telas.spec.ts` importavam o tipo `PedidoCorrecao` de um `.vue`,
  que o tsc puro não enxerga (só o componente padrão). O tipo agora é declarado no próprio spec, espelhando a interface
  de `DialogoCorrecao.vue`. Web: 0 erros de tsc.
- **Bloqueio de fora resolvido:** `esquemaHhmm` voltou a ser exportado por `agenda/entradas.ts`; o cliente de teste
  `f24_15qualidade` existe e os specs vizinhos (inclusive os `.int.spec`) passam na conferência.
- **Continua pendente** (mesmos pedidos de `15-qualidade.json`): a DDL do agravo, as portas da CCIH (45 métodos) e da
  gestão (46 métodos), a etapa 2 da notificação com as 7 leituras de outros módulos, e por último o apoio
  `modeloPendente`/`leituraPendente` e o `indisponiveis` do painel. Nada disso foi trocado por vazio.

## Ponto para o dono ver
- As leituras da etapa 2 da notificação (`analise`, `acoes`, `acoesDoResponsavel`, `queixas`, `queixa`, `eventosQueixa`,
  `resolvidas`) devolvem vazio partindo de "nada pode ter sido gravado neste banco". Isso deixa de valer quando o
  conector importar análises, planos de ação ou queixas técnicas da origem: aí a tela diria "nenhum" com dado no banco.
  A porta da etapa 2 tem de entrar antes (ou junto) da carga dessas tabelas pelo conector.
