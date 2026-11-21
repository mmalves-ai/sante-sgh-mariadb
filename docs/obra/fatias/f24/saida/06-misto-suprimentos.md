# F2.4, 2ª volta: lote 06-misto-suprimentos (PARCIAL)

## O que mudou
- **Segredos de parceiros (contrato e tela):** `segredos-legado.ts` e `i18n-segredos.ts` deixaram de usar nomes de tabela
  e coluna da origem.
  - Os tipos agora têm nome de negócio: `convenio`, `servico_tiss_convenio`, `atividade_convenio`, `estabelecimento`,
    `usuario_estoque`, `servidor_email` e `equipamento_laboratorio`.
  - As chaves (`id`, `login`, `convenio_id;versao_tiss_id`) e as colunas (`senha_portal`, `senha_proxy`…) também.
  - As exceções viraram `integracao_bancaria_externa` e `contas_acesso_modulos`.
  - As senhas secundárias viraram `senha_liberacao` e `senha_cancelamento_nota`.
  - A referência do cofre e a coluna do pedido aceitam só minúsculas, porque passaram ao padrão `snake_case`.
  - A correspondência com a origem virou dado do conector, no arquivo novo `conector/mapa/segredos-origem.tsv`.
  - Specs ajustados na mesma troca:
    - `apps/web/src/modulos/acesso/segredos.spec.ts`, vizinho;
    - `packages/dominio-acesso/src/segredos/segredos.spec.ts`, 10 de 10 verdes;
    - `apps/web/e2e/m59-3.spec.ts`.
- **Conta sintética do supervisor do estoque** (`fonte-sintetica.ts`): as marcas do usuário saíram do código. Agora vêm
  do mapa do conector, pelas permissões que concedem: `suprimentos.pedido.aprovar`, `suprimentos.requisicao.autorizar`
  e `suprimentos.fechamento.reabrir`. O helper é `marcasDasPermissoes`, e a concessão resultante é a mesma.
- **`dist/` de `dominio-integracao` e `dominio-atendimento`:** as declarações estavam velhas. Reconstruídas com
  `tsc -p tsconfig.lib.json`, os nomes de origem e o vocabulário antigo sumiram, porque o `src` já estava limpo.

## Decisões pela melhor prática (para o dono ver)
1. **A retirada de segredos fala só em tipos de negócio.** Qual tabela da origem guarda cada senha é assunto do
   conector. O SPDATA nunca é alterado (regra 4) e as credenciais vão para o cofre na importação (ADR 0007, item 17).
2. **A conta sintética guarda a marca como a origem guardaria,** mas o código pede a permissão de negócio. Se o mapa
   mudar, a conta acompanha.

## Pedidos (detalhe em `06-misto-suprimentos.json`)
- **Rodada própria do estoque.** As 4 linhas de `porta-propria.ts` e `operacoes.ts` cobrem:
  - 30 leituras;
  - 14 gravações diretas;
  - 15 operações do executor.

  O DDL existe. O bloqueio é o contrato, que ainda usa a chave antiga do documento (ano, mês e número) e o item pelo
  código numérico. A troca para id é de ponta a ponta: contrato, controller, serviço, porta de memória, web e testes.
- **OPME e manipulação:** dependem da saída do estoque da rodada acima.
- **Farmácia hospitalar:** 8 linhas, com o mesmo pedido do 21-misto-farmacia. Cobre a dispensação por horário, o
  controlado, o livro (ADR 0004), a dispensação ambulatorial e o envio nacional.
- **Imutabilidade clínica:** `tabelas-clinicas.gerado.ts` lista tabelas da origem a partir de uma matriz que não veio.
  O redesenho para a lista do modelo (`tabelasClinicasDoModelo`) é compartilhado: contrato `imutabilidade.ts`,
  gerador, spec do gerador e domínio de acesso.
- **Licitação:** o DDL foi aplicado, mas a porta própria não está neste lote.

## Falta (dívida restante no lote)
- modelo-pendente:
  - `suprimentos/porta-propria.ts` (20, 884);
  - `suprimentos/operacoes.ts` (64, 89);
  - `suprimentos/opme-porta-propria.ts` (9);
  - `suprimentos/manipulacao-porta-propria.ts` (11);
  - `farmacia/porta-propria.ts` (17, 148, 170, 415, 465);
  - `farmacia/gravador-avaliacao.ts` (45, 51);
  - `farmacia/operacoes.ts` (2).
- nome-origem: `packages/contratos/src/acesso/tabelas-clinicas.gerado.ts` (a lista inteira).
