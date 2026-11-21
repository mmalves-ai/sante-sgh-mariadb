# Lote p-qualidade-ccih: porta própria da CCIH

A CCIH é a comissão de controle de infecção hospitalar. Este lote trata a porta `apps/api/src/modulos/qualidade/porta-ccih-propria.ts` e o
teste de integração `ccih.int.spec.ts`. O cliente de teste é `f24p_qualidadeccih`.

## O que mudou

- **Leituras construídas (36 de 45).** Todas ficam restritas ao estabelecimento da sessão.
  - Internados, internação, altas e leitos vizinhos (com ocupação).
  - Antimicrobianos prescritos, vigências e consumo dispensado no mês. Itens antimicrobianos e item do cadastro (insumo).
  - Fichas de antimicrobiano por item prescrito.
  - Culturas (exames com `cultura`), cirurgias (ato cirúrgico), temperatura (parâmetro vital `temperatura`, sem os
    valores retificados) e censo fechado por setor.
  - Tipos de surto.
  - Dispositivos (um, por internação, no período).
  - Higiene das mãos: sessões, observações e uma sessão.
  - Consumo de álcool, surtos, versões, competências, dependentes, bundles e busca de profissionais.
- **Gravações construídas (17 de 26).** Todas passam pelo Executor (`gravacaoDireta`), com trilha, idempotência,
  linha travada e versão conferida (`versao-desatualizada`).
  - Dispositivo invasivo: registrar, retirar, corrigir e cancelar, com o evento do dispositivo e a recusa
    `com-dependentes`.
  - Checklist do bundle: registrar, corrigir e estornar.
  - Observação de higiene das mãos: registrar, corrigir e estornar.
  - Consumo de preparação alcoólica (insere ou atualiza; calcula pacientes-dia pelo censo).
  - Surto: registrar, com o número pela sequência, e atualizar.
  - Competência da vigilância: fechar e reabrir.
- **Ficam falhando fechadas, com pedido de DDL em `p-qualidade-ccih.json`:**
  - IRAS (infecção relacionada à assistência): 3 leituras e 3 gravações;
  - liberação e revisões D3/D7 do antimicrobiano: 2 leituras e 2 gravações;
  - configuração do antimicrobiano por item: 1 leitura e 1 gravação;
  - precaução e isolamento: 3 leituras e 3 gravações.

  As leituras respondem 503 `modelo-pendente`. As gravações respondem 409 `modelo-pendente` sem gravar nada: o teste
  prova que a transação é desfeita.
- **Prova:**
  - `ccih.int.spec.ts`: 6 testes verdes contra o MariaDB;
  - os 17 arquivos de spec da qualidade: 153 testes verdes;
  - tsc de `apps/api`: 0 erros nos arquivos da qualidade.

## Decisões pela melhor prática (para o dono ver)

1. **`reg` é a internação do estabelecimento.**
   - O dispositivo grava o atendimento dela e o leito resolvido pela chave (bloco, acomodação e leito).
   - Sem acomodação e leito na chave, vale o leito atual da internação.
2. **Códigos do contrato são os códigos dos cadastros do cliente, em snake_case.**
   - Vale para tipo de dispositivo, item do bundle e categoria profissional observada.
   - O sítio de inserção (texto livre de até 40 caracteres) é resolvido no cadastro de local de acesso pelo código,
     pela sigla ou pela descrição.
   - O que não está cadastrado é recusado com `*-nao-cadastrado`, nunca gravado solto.
3. **Versão anterior vai à trilha de auditoria.**
   - Toda correção, estorno, cancelamento, fechamento e reabertura grava a versão anterior em
     `trilha_auditoria.dados_depois.dados.versaoAnterior`, com o motivo e, quando há, os itens.
   - A leitura `versoes` lê da trilha. Não foi criada tabela de histórico.
4. **Estorno é exclusão lógica.**
   - No bundle e na higiene das mãos, o estorno preenche `excluido_em` e `excluido_por`. O registro fica visível como
     inativo.
   - O motivo do estorno vem da trilha.
   - O turno estornado do bundle é lançado de novo na mesma linha (o índice único do modelo vale também para as
     excluídas): ela volta a valer e o lançamento estornado, com os itens, vai à trilha como versão anterior. O pedido
     de DDL da unicidade só entre os não excluídos continua, para quando se quiser guardar as duas linhas.
5. **"Setor" é o código do bloco de internação.**
   - Vale para o censo, para o leito e, pela unidade de internação ligada ao setor funcional, para o consumo, a
     observação e o surto.
   - O `setor` que a tela manda no consumo e na observação é derivado da unidade e não é gravado em separado.
6. **Mapeamentos entre contrato e modelo.**
   - Motivo da retirada: eletiva vira `fim_indicacao`, acidental vira `retirada_acidental`, troca vira
     `troca_programada`.
   - Os cinco momentos de higiene da OMS seguem os códigos do modelo.
   - No surto encerrado, o resumo de encerramento (obrigatório no modelo) é preenchido com as medidas de controle.
   - Na reabertura da competência, "reaberta por" é quem fez a última alteração da linha. O modelo não tem coluna
     própria.
7. **Censo:**
   - os pacientes-dia são os do `fechamento_censo` com a situação `fechado`;
   - os dias fechados são as datas distintas com censo fechado;
   - o consumo de álcool guarda pacientes-dia e mL por paciente-dia da competência.
8. **Profissional:** o `cod` é o próprio id do profissional, porque o modelo não tem matrícula separada. A busca usa
   nome ou id, só entre os ativos.

## Pedidos (detalhe em `p-qualidade-ccih.json`)

- **DDL:**
  - `caso_infeccao`: implante, cultura do caso e microrganismo em texto livre;
  - `isolamento_paciente`: motivo, motivo "outro", origem, cultura, multirresistente e motivo de encerramento
    codificado;
  - tabelas novas da decisão de antimicrobiano e das revisões D3/D7;
  - configuração do antimicrobiano por insumo;
  - unicidade do `verificacao_bundle` só entre os não excluídos.
- **Código compartilhado:** numerações `surto_infeccao` e `caso_infeccao` no `configurar_numeracoes.py`.
- **Sementes:**
  - tipos de dispositivo;
  - categorias profissionais observadas;
  - tipos de precaução;
  - motivo de bloqueio de leito "isolamento".
- **Observação:** `apoio-propria.ts` e `seguranca.controller.ts` (o painel `indisponiveis`) mantêm o mecanismo de
  pendência até as partes acima saírem.

## Correção pelos achados da revisão (3ª etapa)

- **Antimicrobiano em curso:** o fim efetivo é o primeiro entre o fim (item ou prescrição) e a suspensão (item ou
  prescrição); sem fim, o tratamento segue vigente (`IS NULL OR >= ?`) em `antimicrobianos` e `vigencias`. Observação: o
  fim nulo não ocorre hoje, porque `prescricao.vigencia_fim_em` é NOT NULL; o defeito real era a suspensão ignorada. Teste
  de integração novo com item começado antes de `desde`, um em curso e um suspenso.
- **Bundle estornado:** `registrarBundle` relança o turno estornado na mesma linha (limpa a exclusão, regrava os itens,
  versão anterior na trilha); a mensagem de duplicidade foi corrigida. Teste cobre o relançamento e a trilha.
- **Correção do dispositivo:** em uso, a retirada não entra pela correção (`retirada-pela-correcao`); retirado, a
  correção só acerta a data e recusa retirada anterior à inserção (`antes-da-insercao`). Situação e motivo ficam com a
  retirada. Desfazer retirada: pedido de contrato.
- **Decisão de manter o dispositivo:** a porta não grava mais `manter_dispositivo = true` inventado. Pelo CHECK do
  modelo, grava `indicacao_revisada = FALSE` e `manter_dispositivo = NULL`; a revisão da indicação é lida pelo item
  `indicacao` do checklist. Pedido de contrato para a decisão explícita.
- **Consumo de álcool:** a substituição trava a linha e manda o valor anterior à trilha. Sem censo fechado, a taxa fica
  nula e o cálculo diz "sem denominador"; `pacientes_dia` ainda grava 0 por ser NOT NULL (pedido de DDL). Versão vista:
  pedido de contrato.
- Prova: `ccih.int.spec.ts` 7 testes verdes no cliente `f24p_qualidadeccih`; tsc sem erro nos arquivos do lote.
