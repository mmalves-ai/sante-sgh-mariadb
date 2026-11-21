# F2.4, lote 03-permissoes-1 (permissões, parte 1)

## O que mudou
- 46 dos 47 arquivos de `packages/contratos/src/permissoes/` ficaram sem dívida (nome de origem), só em comentário,
  exceto uma descrição de permissão no financeiro.
- A árvore de opções do sistema de origem passou a ser citada como "menu de origem"; a correspondência fica em
  `conector/mapa/permissoes.tsv` (padrões, seção 3).
- Nomes de tabela trocados pelo termo de negócio: convênios liberados ao usuário, conta bancária do usuário, trilha
  de auditoria, mensagens do sistema, agendamento e grupos/usuários liberados do relatório, módulo do menu de origem,
  tabela de médicos solicitantes do SUS, conta/acesso do portal e usuário do sistema.
- Uma menção ao nome do sistema de origem em `cadastro.ts` virou "sistema anterior".
- `financeiro.ts`: a descrição da permissão de parâmetros diz "escopo por conta bancária do usuário" (sem nome de
  tabela). Os códigos de permissão não mudaram.

## Decisões pela melhor prática
- Referência que era só proveniência (tabela de profissionais no repasse, nome da tabela entre parênteses no comentário dos médicos solicitantes do SUS, coluna
  da alçada de controlado na farmácia) foi apagada, não traduzida.
- Constantes com números de opção ficaram, como manda a seção 4 dos padrões.

## Pendente (fora do lote)
- `farmacia.ts` linha 39: `FlagLegado.tabela` traz o nome da tabela de origem como dado. Depende da etapa coordenada da
  seção 5 dos padrões (tirar `opcoesLegado`/`flagsLegado` de `DeclaracaoPermissao`), que já está pedida lá.
- tsc do `apps/web`: 2 erros em `apps/web/src/modulos/qualidade/*-telas.spec.ts` (`PedidoCorrecao` de `.vue`), sem
  relação com este lote.
