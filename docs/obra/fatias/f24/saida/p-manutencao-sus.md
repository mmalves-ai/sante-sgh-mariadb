# Lote manutencao-sus (F2.4, 3ª etapa): portas sobre o banco próprio

## Manutenção (`api/manutencao/porta-propria.ts`): pronta, dívida 0
As 9 recusas `modelo-pendente` saíram. As leituras que voltavam vazias agora leem o banco. Tudo é gravado pela gravação direta do Executor (trilha, outbox e idempotência na mesma transação), e toda leitura filtra o estabelecimento.
- **Tecnovigilância** (alerta de equipamento e recall):
  - o alerta é o `alerta_sanitario` da área `equipamento`, com fabricante, modelo, faixa de série, registro e ação;
  - as OS de ação de campo ficam em `alerta_sanitario_equipamento`, e gerar a ação marca o alerta `em_verificacao`;
  - a queixa técnica do equipamento é a `queixa_tecnica_produto` ligada à OS, com o andamento em `_evento`;
  - foram escritos `incluirAlerta`, `alterarAlerta` (motivo e "antes" na trilha), `encerrarAlerta`, `excluirAlerta`, `gerarAcaoDeCampo` e `abrirQueixaDaOs`, mais as leituras `alertas`, `alerta`, `acoesDoAlerta`, `parqueDoAlerta` e `vinculosTecnovigDaOs`.
- **Curso exigido por modelo** (`modelo_equipamento_curso`): `vincularCursoModelo`, `desvincularCursoModelo` (com motivo), `cursoDoModelo` e `cursosDosModelos`.
- **Ciclo de vida** (`evento_ciclo_equipamento`): `registrarEventoCiclo` e `eventosCiclo`. A desativação grava `situacao` e `desativado_em` no equipamento.
- **O que já existia e agora fica gravado:**
  - o laudo da OS (`laudo_arquivo_id`), conferido como arquivo do estabelecimento;
  - o modelo pronto do plano (`modelo_plano_codigo` e `modelo_plano_versao`);
  - a data de desativação lida de `desativado_em`, e não mais da data da última alteração.
- **Testes:** `tecnovigilancia.int.spec.ts` e `ciclo-vida.int.spec.ts` foram reescritos para o efeito real. `porta-propria.int.spec.ts` passou a cobrir o laudo inválido, o plano com modelo e uma recusa atômica de verdade. A limpeza da massa apaga as tabelas novas. Resultado: 9 arquivos e 54 testes verdes no cliente `f24p_manutencaosus`.

## SUS (`api/sus/porta-propria.ts`): parcial, dívida 1 arquivo (linhas 20 e 90)
- **Feito: crítica prévia.**
  - `gravarCriticas` usa a chave estável (UNIQUE por competência), reabre a crítica que já estava corrigida e corrige a que sumiu. Na competência, grava `criticada_em`, a quantidade de registros e o CNES.
  - `justificar` só aceita o aviso aberto, na versão que a tela leu.
  - Leituras `criticas` (com o filtro de convênio, as regras e a página) e `critica`.
  - A competência passa a ler `registros` e `criticada_em` das colunas próprias.
- **Feito: faixa de AIH.** `inserirFaixaAih`, `mudarFaixaAih`, `faixasAih`, `faixaAih` e `maiorNumeroDaFaixa`, que lê o maior número nas autorizações.
- **Testes:** o teste "modelo-pendente" virou dois testes de efeito real, crítica e faixa, com recusa atômica e isolamento por estabelecimento. Resultado: 5 arquivos e 34 testes verdes.
- **Falta, com a estrutura já existente no banco (ddl-aplicado-v3, sem DDL a pedir):**
  - **arquivo gerado:** `proximoArquivo`, `gravarArquivo` (CIHA), `gravarArquivoBpa`, `gravarArquivoApac`, `gravarArquivoSisaih`, `arquivos`, `arquivo`, `linhasBpa`, `linhasApac` e `linhaBpaDaCompetencia`;
  - **APAC:** `incluirApac`, `mudarApac`, `apac`, `paginaApacs`, `apacsDaCompetencia` e `atendimentoLaudoApac`;
  - **AIH:** `inserirAih`, `autorizarAih`, `negarAih`, `reabrirAih`, `cancelarAih`, `fecharAih`, `aih`, `aihPorNumero`, `aihsDasInternacoes`, `aihsParaApresentar`, `paginaAihs` e `itensAih`;
  - **retorno do gestor:** `inserirRetornoSus`, `aplicarRetornoNaAih`, `tratarRetornoSus`, `paginaRetornos`, `retornoSus` e `ultimoRetornoDaAih`.

## Decisões pela melhor prática (para o dono ver)
1. **Número do alerta:** o número digitado é a identificação do emissor (`identificacao_externa`), e é ele que a tela mostra. É único entre os alertas de equipamento ativos. O número interno sai da `sequencia_negocio` (`ALE-n`).
2. **Tipo e emissor do alerta:** recall é gravado como `recolhimento` e o alerta, como `alerta_risco`. O emissor é o fabricante no recall e a vigilância nacional no alerta. A origem `integracao` aparece como `anvisa`.
3. **Situação do alerta:** encerrar grava `concluido`, com data e motivo em `conclusao`. Excluir é exclusão lógica, só sem OS ou queixa ligada; com vínculo, a recusa oferece o encerramento.
4. **Queixa da OS:**
   - o desvio é gravado como `falha_funcionamento`;
   - a conduta diferente de "nenhuma" marca a queixa como segregada (`lote_segregado`);
   - o tipo da tela (queixa, evento adverso, alerta) e a conduta vão no andamento (`dados`);
   - o número sai da sequência `QT-n`;
   - a queixa é única por OS.
5. **Curso por modelo:** desvincular é exclusão lógica com motivo. Como a UNIQUE conta a linha excluída, vincular de novo reativa a mesma linha.
6. **Valor contábil no evento do ciclo:** é a última cota de depreciação até a data ou, sem cota, o valor de aquisição. Sem bem patrimonial ligado, fica nulo.
7. **Equipamento desativado:** guarda a data que já tinha quando é alterado de novo. Ao reativar, a data é limpa (CHECK do banco).
8. **Faixa de AIH:** o banco guarda o número de 13 dígitos, com o dígito verificador do domínio, e a tela continua com a base de 12. A faixa nova não pode cruzar nenhuma outra faixa do estabelecimento: antes, a recusa era só para a que começava no mesmo número.
9. **Crítica:** o texto da regra vai em `descricao`, e o detalhe em JSON (o texto curto é embrulhado quando não é JSON). A crítica `ignorada`, da carga antiga, aparece como corrigida.

## Pedidos
Nenhum pedido de DDL nem de arquivo de fora do lote. O que falta é escrever a porta (lista acima), sobre a estrutura que já existe.

## Correção pela revisão
- **Queixa da OS:** só o tipo `queixaTecnica` grava (`falha_funcionamento`). Evento adverso e alerta sanitário recusam com `modelo-pendente` (409), em vez de virarem queixa de falha. Pedido de DDL (coluna `natureza` e `alerta_sanitario_id` em `queixa_tecnica_produto`) no `.json`. A porta em memória ainda aceita os três (fora da lista do lote).
- **Valor contábil no ciclo de vida:** só a cota da base `societaria` (a contábil) entra; a fiscal e a gerencial não.
- **Faixa de AIH (achado recusado):** `faixa_numeracao_aih` não tem `excluido_em` (13_SUS/01_tabelas.sql e 05_tabelas.sql); a faixa sai de uso por `situacao` (`cancelada`/`esgotada`). As consultas ficam como estavam.
