# Lote 18-misto-dominios (domínios, cadastro, administração)

## O que mudou
- 35 arquivos da lista: dívida 0 (`divida_f24.py`). Quase tudo comentário: nomes de tabela de origem trocados pelo
  termo de negócio ou removidos quando eram só proveniência; "(TBOPCOES, retrato …acesso-legado.pc.json)" virou
  "(menu de origem, ver conector/mapa/permissoes.tsv)". Números de opção de menu ficaram (padrões, seção 4).
- Código:
  - `tabelaAlvo` da trilha em pacientes, profissionais e usuários passa ao nome do modelo próprio: `paciente`,
    `paciente_versao`, `profissional`, `profissional_versao`, `pessoa_fisica`, `usuario` (spec vizinho
    `usuarios-cpf.spec.ts` ajustado).
  - `profissionais-memoria.ts`: retratos com `profissional` e `profissional_ocupacao`.
  - Textos de `@AuditadoNoHandler`: "executor: trilha de auditoria … na mesma transação da receita".
  - `tipos.ts`: `formatoTexto` passa de `'HHMM' | 'digitos'` para `'hora' | 'digitos'` (`hora` = `HH:MM`,
    `esquemaHora`). Nenhum produtor ou leitor do valor antigo no produto (só em `referencias/`).

## Decisões pela melhor prática
- O alvo da trilha é o nome da tabela do modelo próprio que guarda o registro (consulta de pessoa por documento →
  `pessoa_fisica`; histórico → tabelas `*_versao`).
- Coluna de origem citada em comentário virou descrição em português (ex.: "ocupação do profissional ativa",
  "número do prontuário").

## Pedidos
- `18-misto-dominios.json`: a lista de unificação do paciente (`dominio-cadastro/unificacao/referencias-paciente.ts`)
  não cobre `intencao_pagamento_portal` e `vinculo_responsavel_portal`, criadas na etapa de DDL; o teste de integração
  da unificação em `cadastro/porta-propria.int.spec.ts` falha por isso (fora do lote).
- tsc (reconferido): o erro de `apps/api/src/modulos/adt/servico.ts` já não aparece; seguem 2 erros em specs da
  qualidade web (`correcao-telas.spec.ts`, `revisao-corretor-telas.spec.ts`: `PedidoCorrecao`), fora deste lote.
- Reconferido: `porta-propria.int.spec.ts` (cadastro) passa 9 de 10; o único que falha recusa com
  `unificacao-tabela-nao-coberta (intencao_pagamento_portal.paciente_id, vinculo_responsavel_portal.paciente_id)`.
  Sugestão para quem aplicar o pedido: as duas com destino `transferir` (intenção de pagamento e vínculo de
  responsável seguem o paciente que fica), em ordem alfabética na lista.
