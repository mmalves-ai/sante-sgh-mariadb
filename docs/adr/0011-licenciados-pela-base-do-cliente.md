# ADR 0011: licenciados pela base do próprio cliente

- **Data:** 2026-11-26 (decisão do dono de 25/11/2026)
- **Situação:** aceita
- **Emenda:** o item 3 do ADR 0006 e a regra 7 do `AGENTS.md` (item "Licenciados").
- **Fontes:** `sante-sgh-dados/obra/recusas/plano-fase2-final.md` §2.2 (fora do git; só contagens).

## Contexto

O ADR 0006 (item 3) e a regra 7 diziam:
- o licenciado padrão (Brasíndice, Simpro) vem só do **espelho padrão da base**, mantido pela plataforma;
- o conector **nunca** traz o conteúdo licenciado: só liga as referências do hospital pelo código e pela edição;
- a semente inicial do espelho sai uma única vez da cópia da origem e é gravada na plataforma, não no cliente.

Na carga da ProntoCardio o espelho do cliente ficou vazio (`item_catalogo_licenciado` com 0 linhas). Com isso:
- 155.766 itens de material e medicamento ficariam como item próprio, com a pendência `espelho_nao_carregado`;
- a recusa dos lançamentos que dependem desses itens trava cerca de 3,07 M linhas em cascata.

## Decisão

O cliente que tem a licença por condição comercial traz os itens e os preços licenciados **da sua própria base**, pelo
conector, para o **espelho do cliente**. O dono garante a condição comercial: todo cliente que entra com a base do
negócio original já presume a licença.

- **Tabelas:** as mesmas do espelho (`fonte_referencia_matmed`, `edicao_referencia_matmed`, `item_referencia_matmed`,
  `preco_referencia_matmed`), com o catálogo (`brasindice`, `simpro`) e a edição de cada publicação da origem.
- **Registro da edição:** origem do conteúdo (base do cliente), data da carga e contagem por edição.
- **Ligação:** o item do hospital continua ligado pelo **código e pela edição**, como antes.
- **Sem duplicar:** a edição que já existe no espelho padrão da base é adotada pelo par (catálogo, edição).
- **Edições seguintes:** pelo arquivo do fornecedor (`catalogos/licenciados/carregar.py`) ou por nova execução
  diferencial do conector, à escolha do cliente.
- **Garantias da carga:** uma vez por edição, a mesma normalização do carregador do fornecedor, contagem por edição igual
  à da origem e só contagens na saída.
- **Regra 1 intacta:** "Brasíndice" e "Simpro" são nomes de catálogo comercial, já usados no modelo. Nenhum nome do
  sistema de origem entra em código ou tela.

## Consequências

- A pendência `espelho_nao_carregado` deixa de valer para o cliente que carregou o espelho pela origem.
- A tabela de versões do Brasíndice da origem deixa de ser descarte licenciado e passa a ser a edição do espelho do
  cliente.
- As colunas do item do hospital que guardam o código licenciado passam a ligar ao espelho do cliente.
- O cliente sem a licença na própria base continua com a regra anterior: espelho padrão da base e só a ligação.
- Mudanças no mapa e no conector: lotes P0, P5 e C1 da fase 2 das recusas.
