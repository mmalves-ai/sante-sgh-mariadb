# F2.4, lote 13-recepcao

## O que mudou
- **Fila por serviço:** a gravação e a leitura usam as colunas que já existem em `gerador_senha`
  (`intercalar_prioritarias`, `tempo_alvo_espera_minutos`, `rotulo_totem`, `exibe_no_totem`). Os padrões fixos saíram da
  leitura.
- **Dispositivos do painel e do totem** (`dispositivo_recepcao`, `_local` e `_gerador`):
  - operações: criar, renovar, alterar, revogar e conferir;
  - leitura por estabelecimento e por token;
  - marca de último uso.
- **Termos de consentimento da recepção:** cada versão do modelo é uma linha de `termo_consentimento_modelo` com
  `tipos_atendimento`. A assinatura fica em `termo_consentimento_recepcao`, e a revogação também. Os signatários vêm de
  `tipo_assinante`.
- **Senha suspensa:** a situação `suspensa` já existia, e a recusa saiu de `operacoes.ts`.
- **Classificação de risco:**
  - aviso de estouro do tempo-alvo em `aviso_estouro_classificacao` (`avisosGravados` lê);
  - metas, checklist e encerramento do protocolo gerenciado em `inclusao_protocolo_registro` (as inclusões leem os
    eventos);
  - licença do protocolo na versão publicada (`licenca_*`), gravada e lida, em `classificacao-operacoes.ts`.
- **Vocabulário:** `horaHhmmParaLocal` virou `horaDigitadaParaLocal` (web), que usa `lerHoraDigitada` e recusa a hora
  inválida. A tela `RelogioProtocolosTela.vue` e o spec acompanham.
- **Nomes de origem:** os comentários foram reescritos com o termo de negócio. O alvo da trilha da worklist passou a
  ser `senha_emitida`.
- **Testes de integração novos:**
  - fila;
  - dispositivo (inclui a troca de token e o login já substituído);
  - termos (versão, assinatura, 409 com assinatura, inativo, revogação única, exclusão);
  - senha suspensa;
  - aviso de estouro (uma vez por chave);
  - meta única e protocolo encerrado.

  A limpeza da massa cobre as tabelas novas.

## Decisões (melhor prática)
- **Token do dispositivo:** só o SHA-256 e o prefixo de 8 ficam guardados. O token sai uma vez só.
- **Ligações removidas:** recebem exclusão lógica e voltam reativadas pela UNIQUE, sem apagar.
- **Termo da recepção:** é o modelo com `tipos_atendimento` preenchido. Assim, os modelos do prontuário (procedimento)
  não se misturam.
- **Finalidade:** tem hífen no contrato e sublinhado no banco.
- **Versão nova do termo:** encerra a vigência da anterior no dia.
- **Exclusão do código do termo:** só sem assinatura. É física, porque a tabela não tem exclusão lógica e o código nunca
  foi usado. Com assinatura, a resposta é 409 com os dependentes.
- **Signatário:** é o id de `tipo_assinante`, nos papéis paciente e responsável legal.
- **Momento da assinatura:** é gravado ao segundo, para que o resumo canônico seja reproduzível na leitura.
- **Imagem do traço:** fica só o resumo (pedido de armazenamento).
- **Aviso de estouro:** `INSERT ... ON DUPLICATE KEY`, e a UNIQUE decide entre consumidores. A trilha só registra quando
  grava.

## Pedidos (13-recepcao.json)
1. DDL de `dispositivo_recepcao.painel_tv_id`. Até lá, a criação com `portalOrdem` recusa com `modelo-pendente`, a única
   dívida restante do lote.
2. `SanteHora.vue` (compartilhado) passa a emitir `HH:MM`.
3. A guarda da imagem da assinatura espera o armazenamento de arquivos (ADR 0004).

## Fora da .lista (no mesmo módulo, sem dono em outro lote)
- `classificacao-operacoes.ts`: a licença, porque é a única forma de tirar a importação de `modeloPendente`.
- `massa-recepcao.spec-util.ts`, `RelogioProtocolosTela.vue` e `formato.spec.ts`.

## Correção da revisão (finalidade e meio lidos do banco)
- `finalidadeDoBanco` não troca mais em silêncio uma finalidade fora do contrato por `atendimento`: recusa com
  `termo-finalidade-fora-do-contrato`, dizendo o código do termo e a finalidade lida. O CHECK do banco aceita também as
  finalidades do prontuário (`geral`, `protecao_dados`…); um termo da recepção só pode ter as do contrato.
- `meio` da assinatura: valor fora de `tela`/`portal` recusa com `termo-meio-desconhecido` (antes virava `tela`).
- Teste de integração: um modelo assinado com `protecao_dados` faz a lista de termos e os termos do paciente
  recusarem; restaurado, a leitura volta a `compartilhamento-rede`.
- Decisão para o dono: recusar a leitura em vez de alinhar contrato e CHECK. Se a recepção precisar de
  `protecao_dados`, a saída é levá-lo ao contrato (`FINALIDADES_CONSENTIMENTO`), código compartilhado.
