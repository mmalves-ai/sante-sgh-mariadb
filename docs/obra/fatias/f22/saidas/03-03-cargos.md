# Lote 03-03 (onda 3 das ondas finais): cargos e salários de pessoas

(O `03-03.md` desta pasta é o registro do lote 03-03 da numeração anterior, manutenção; não foi sobrescrito.)

- **Criados:** `pessoas/cargos/porta-propria.ts` (PortaCargosPropria), `pessoas/cargos/porta-propria.int.spec.ts` (f22_o3).
- **Reescritos:** `porta-cargos.ts` (tipos de negócio próprios, `portaCargosIndisponivel`), `porta-cargos-memoria.ts`,
  `servico-cargos.ts`, `cargos.controller.ts` (nomes de tabela do modelo), `cargos.spec.ts` (app migrada com módulo de
  teste), `servico-cargos.spec.ts`, `crud-colaborador.spec.ts` e `crud-colaborador-esocial.spec.ts` (tipos da config e
  ContextoPorta completo).
- **Apagados:** `cargos/porta-cargos-legado.ts`; os specs sobre a cópia do sistema de origem `aplicacao/calculo-folha*.int`,
  `crud-w006*.int` (3) e `desligar.int` (cobertura pedida aos lotes donos das portas; a parte de cargos foi para o novo spec).
- **Tabelas:** `cargo`, `ocupacao_cbo`, `conselho_classe`, `faixa_salarial` + `tabela_salarial` (leitura),
  `vinculo_trabalho`, `vaga`, `historico_cargo` (dependências e ocupação), `sequencia_negocio`, `trilha_auditoria`
  (histórico das correções e retrato da exclusão).
- **Melhorias:** código do cargo por sequência do cliente (CG-n); exclusão lógica com retrato na trilha; recontagem das
  dependências dentro da transação; "profissional de saúde" pela área do CBO; "exige registro" pelo conselho; gravação
  pelo Executor (idempotência, trilha e outbox na mesma transação); versão otimista pelo `tx.alterar`.
- **Pendências de modelo (pedido DDL em `saida/03-03.json`):** quadro de vagas aprovado (`quadro_vaga`, tabela nova) e
  faixa salarial versionada por linha (colunas em `faixa_salarial`). Até lá, inclusão/versão/situação/exclusão de faixa e
  de vaga do quadro respondem 409 `modelo-pendente`; a lista de vagas do quadro sai vazia.
- **Pedidos:** fecho do tsconfig (12 arquivos); 03-11 liga PORTA_CARGOS no `pessoas/modulo.ts`; cobertura dos specs
  apagados pelos lotes 03-02/04/06/08/09/10.
- **Correção da revisão (2026-11-21):** dependências do cargo cobrem as 12 tabelas com FK para `cargo(id)`
  (`DEPENDENCIAS_CARGO` exportada, `excluido_em` onde existe, conferida contra o information_schema no teste);
  `alterarCargo` só resolve CBO/conselho que mudaram (CBO ou conselho desativado depois não trava a renomeação e
  `profissional_saude`/`exige_registro_conselho` não são recalculados à toa); faixa vigente só com tabela `vigente` já
  começada no fuso do estabelecimento (rascunho e futura não contam; `hoje()` também pelo fuso do estabelecimento);
  versão antiga devolve `desatualizado` como a tela e a memória; memória com o cargo por cliente (faixas, quadro e
  ocupação por estabelecimento), `ligarColaborador(ctx, …)` e `exclusoes(cliente)`.
- **Testes:** porta-propria.int.spec 15 (bateria memória × banco com dois estabelecimentos e o conflito de versão com
  código e releitura; faixa de outro estabelecimento, rascunho e futura; ocupação com ativo/afastado/desligado/
  transferido/excluído/outro estabelecimento; função, trabalhador sem vínculo, vínculo e histórico barram a exclusão;
  renomeação com CBO/conselho inativos); cargos, servico-cargos, cifra-cpf, crud-colaborador(-esocial) e avaliação verdes.
  tsc do fecho migrado + 12 arquivos do lote: 0 erros.
- **Conferidor:** sem legado e sem erro de fecho; acusa "fora do tsconfig" (integrador aplica) e vitest vermelho só em
  `esocial/porta-esocial-propria.int.spec.ts` (outro lote da onda 3); última linha: "Tests  4 failed | 106 passed (110)".
