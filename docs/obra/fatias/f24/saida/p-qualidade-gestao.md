# F2.4, 3ª etapa: lote qualidade-gestao (portas da gestão da qualidade e etapa 2 do incidente)

## O que foi construído
- **Gestão da qualidade (`qualidade/porta-gestao-propria.ts`)**, sobre o banco próprio:
  - **Matriz de riscos** (`risco_institucional`):
    - leitura paginada por situação e o risco;
    - registro novo e atualização, com a versão conferida e a linha travada;
    - número `RSC-AAAA-NNNNNN` pela sequência do ano.
  - **Não conformidades** (`nao_conformidade_qualidade`):
    - leitura paginada por situação, origem e registro de origem, e a não conformidade;
    - contagem por origem;
    - registro e atualização, com o evento de cada troca de situação e o plano de ação em `plano_acao_qualidade`.
  - **Ouvidoria** (`manifestacao_ouvidoria` e o evento de cada passo):
    - leitura paginada, com a busca pelo protocolo ou pelo texto e o mês do recebimento;
    - registro, encaminhamento à área, resposta com a procedência, correção e cancelamento;
    - a manifestação ligada à resposta da pesquisa de satisfação.
  - **Notificações de incidente**: as do período por tipo e classificação, e as do envio ao sistema nacional, com o
    instante e o número da transcrição.
  - **Apoio**: o nome do paciente e as dependências por origem (auditoria, manifestação e risco).
- **Etapa 2 do incidente (`qualidade/porta-propria.ts`)**:
  - a análise, com o método, o conteúdo, a causa raiz, as lições, os fatores e a conclusão;
  - as ações do plano da notificação ou da análise dela;
  - as ações abertas do responsável e o painel das ações.
  - Antes, essas leituras devolviam vazio por presunção. Agora leem o banco, o que vale também para o dado que chegar
    pelo conector.
- **Falha fechada**:
  - a queixa técnica e a sugestão resolvida passaram de vazio presumido para `modelo-pendente` (503);
  - toda gravação ainda não construída recusa com `modelo-pendente` (409) dentro da transação, sem gravar nada.
- **Testes**:
  - `gestao.int.spec.ts` foi reescrito: 8 testes no cliente `f24p_qualidadegestao`, criado com o comando
    "criar novo cliente";
  - `massa.spec-util.ts` passou a limpar riscos, não conformidades, planos, ações, análises e manifestações da massa;
  - os specs da pasta passam: 17 arquivos e 153 testes.

## Decisões pela melhor prática (para o dono ver)
1. **Área.** A área em texto do contrato é o **setor funcional** ativo do estabelecimento, achado pelo nome ou pelo
   código. Área sem setor recusa com `area-inexistente`, e a leitura devolve o nome do setor.
2. **Responsável.** O responsável em texto (risco e não conformidade) é a **conta**, achada pelo login ou pelo nome
   único. Sem conta, recusa com `responsavel-inexistente`; com mais de uma, com `responsavel-ambiguo`. A leitura
   devolve o nome da conta.
3. **Prioridade do risco.** Sai da pontuação GUT, que é gravidade × urgência × tendência:
   - crítica: 64 ou mais;
   - alta: 27 ou mais;
   - moderada: 8 ou mais;
   - baixa: abaixo disso.
4. **Controles do risco.** Os controles em texto não têm coluna (pedido de DDL):
   - a leitura mostra os controles ligados ao catálogo;
   - o registro **com** texto recusa com `modelo-pendente`, e sem texto grava.
5. **Plano de ação da não conformidade.**
   - O texto do plano vira um `plano_acao_qualidade`, com o responsável e o prazo da não conformidade.
   - Plano, ou situação fora de "aberta", sem responsável e prazo recusa com `responsavel-e-prazo`.
   - A conclusão encerra o plano junto.
6. **Situações da não conformidade.**
   - "Verificação" do contrato é `em_verificacao` no banco.
   - "Reaberta" do banco é lida como "aberta".
   - O encerramento grava quem verificou e quando.
7. **Prazo e contato da ouvidoria.**
   - O prazo da manifestação é uma data no modelo e é lido como vencendo às 23:59:59 do dia.
   - O contato com "@" vai para o e-mail, e o restante para o telefone.
8. **Procedência e encaminhamento.**
   - A procedência da resposta fica no motivo do evento de resposta (`procedente` ou `improcedente`), porque o motivo
     de encerramento só existe no encerramento formal.
   - O encaminhamento usa o relógio do estabelecimento e a conta da sessão, porque o contrato não os traz.
9. **Situação da manifestação cancelada.** Volta como "respondida" se teve resposta, "encaminhada" se teve
   transferência e "aberta" nos outros casos, com o instante e o motivo do cancelamento.
10. **Fatores da análise.** Os fatores do contrato são a **categoria** do fator contribuinte, com "profissional" lido
    como "indivíduo" e "externo" como "institucional". A análise concluída tem como "concluída por" a última conta
    que a alterou.

## Pedidos (detalhe em `p-qualidade-gestao.json`)
- **DDL:**
  - controles do risco em texto;
  - cancelamento e duplicada da não conformidade;
  - resumo SHA-256 e retirada do documento, mais a regra da ciência pela conta;
  - auditoria: referencial, auditores em texto e cancelamento;
  - membros e assinatura da ata das comissões;
  - análise de indicador sem apuração;
  - tabela de envios regulatórios da gestão.
- **Sementes do "criar novo cliente":**
  - categorias de risco;
  - canais e tipos da ouvidoria;
  - motivos de encerramento;
  - fatores contribuintes.
- **Construção que falta, depois do DDL:**
  - documentos, indicadores, auditorias, comissões, envios, versões, contagem, pesquisa, protocolos gerenciados e
    revisão de prontuários;
  - na etapa 2: as gravações, a queixa técnica e a sugestão;
  - as 7 leituras de outros módulos.
- **Fica como está:** `apoio-propria.ts` e o `indisponiveis` de `seguranca.controller.ts` continuam enquanto houver
  leitura pendente. Tirá-los agora trocaria a recusa por vazio.

## Fora do lote
- O tsc de `apps/api` acusa `qualidade/ccih.int.spec.ts(34)` (lote da CCIH) e `farmacia/porta-propria.int.spec.ts`.
  Não são arquivos deste lote.

## Correção pelos achados da revisão (2ª volta)

- **Ligação da resposta da pesquisa com a manifestação** passa por `tx.alterar` (versão lida na mesma consulta
  `FOR UPDATE`): a versão sobe e a alteração leva autoria e trilha. O UPDATE cru saiu.
- **Sequência de negócio:** um auxiliar só (`proximoDoAno`), usado pelo `numeroDoAno` e pelo protocolo da
  ouvidoria; a sequência nasce com `criado_por` da sessão (antes, NULL).
- **Setor e responsável na ida e volta (decisão pela melhor prática):** na alteração do risco, da não conformidade
  e na correção da manifestação, a linha é travada antes; se o texto recebido ainda é o nome/código do setor ou o
  login/nome do responsável gravados, os ids ficam. Salvar sem mudar nada não recusa por homônimo nem troca de setor.
- **Setor homônimo:** dois setores ativos com o mesmo nome recusam com `area-ambigua` (pede o código), em vez de
  escolher o de menor id. O nome vale antes do código.
- Teste novo em `gestao.int.spec.ts` (homônimos de setor e de conta): 9 testes verdes no cliente `f24p_qualidadegestao`.

## Correção pelos achados da revisão (2ª volta)
- **Ouvidoria a partir da pesquisa:** a resposta da pesquisa é travada por `consultarParaAtualizar`. O `FOR UPDATE`
  dentro de `tx.uma` era recusado pelo Executor, e por isso toda manifestação vinda da pesquisa falhava com
  `erro-interno`. A ligação passa por `tx.alterar`, que sobe a versão e grava `alterado_em`/`alterado_por`. A
  sequência do ano vem de um auxiliar só (`proximoDoAno`), com `criado_por` da sessão.
- **Ida e volta do responsável e da área:** se o texto ainda é o nome, o login ou o código do que está gravado na
  linha travada, o id fica. Um nome repetido entre setores ativos recusa com `area-ambigua`, sem escolher pelo id.
- **Testes:** um teste novo cobre a ligação da pesquisa (versão 2, autoria, `criado_por` da sequência e
  `pesquisa-ja-convertida`). A limpeza da massa passou a apagar também a sequência `manifestacao_ouvidoria_*`. Os
  specs da pasta passam: 17 arquivos e 156 testes. O tsc da api fica em 0 erros.
