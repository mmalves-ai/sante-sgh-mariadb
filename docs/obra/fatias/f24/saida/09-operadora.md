# F2.4, lote 09-operadora (operadora própria: contratos, ANS, atendimento, autorização, cobrança, contas)

## O que mudou
- **Nome de origem (13 arquivos zerados):**
  - comentários de `contratos/operadora` (`ans`, `atendimento`, `autorizacao`, `cobranca`, `rede`, `vocabulario`), de
    `dominio-operadora` (`ans/sib`, `ans/sip`, `ans/tps`, `autorizacao`) e de `portal-prestador-servico.ts`: sai o nome
    de tabela de origem, fica o termo de negócio;
  - `contratos/operadora/inventario.ts`: o inventário das 80 tabelas de origem (com linhas e gatilhos da cópia), os
    registros fictícios e as tabelas `SGH_OPE_*` da coexistência saíram do produto. Fica só `TELAS_OPERADORA` (itens
    do menu). `dominio-operadora/src/inventario.ts` (e o spec), que conferia essa premissa, foi apagado;
    `operadora.spec.ts` confere só as telas no menu.
    Os textos desses achados na web (`apps/web/src/modulos/operadora/i18n.ts` e o spec) saíram junto.
- **Recurso de glosa das contas médicas (`contas-porta-propria.ts`), antes 501:**
  - por guia e por item, em `recurso_glosa_recebido` e `recurso_glosa_recebido_item`, com protocolo pela numeração
    `recurso_glosa` do estabelecimento;
  - a decisão grava a situação e a decisão de cada linha, o acatado na guia (`valor_acatado_recurso`) e a situação da
    conta, com trava otimista;
  - leitura: o recurso de cada guia, `recursosPendentes` e `acatado` da conta e dos totais, e o filtro "com recurso"
    (antes `FALSE` e zeros fixos).
- **Alteração do auditor (`autorizacao-porta-propria.ts`), antes 501:** troca a categoria e o profissional (pela
  inscrição no conselho), na designação ativa e na versão vista.
- **Testes:** um caso novo de recurso (guia e item) em `contas-porta-propria.int.spec.ts` e a alteração do auditor em
  `autorizacao-porta-propria.int.spec.ts`. Resultado: 8 de 8 no cliente `f24_09operadora`; contratos da operadora 10 de 10, `dominio-operadora` 180 de 180,
  textos da web 2 de 2. A autoconferência não mostrou falha de vitest nos specs vizinhos.
- **Massa de teste** (`infra/massa-operadora.spec-util.ts`): semeia a sequência `recurso_glosa` e, se faltar, o
  caráter de atendimento "1" e um conselho de classe. O cliente de teste novo não tem a terminologia TISS, que não tem
  carregador em `catalogos/`. O cliente recebeu a carga `ibge`.

- **Rodada 2 (correção dos achados e mais ligações):**
  - recurso de glosa: a porta não corta mais o texto. Acima de 500 caracteres (tamanho da coluna hoje) recusa
    `texto-longo` com o campo; o DDL para 1000 foi pedido. O número do lote e o protocolo deixaram de ser cortados,
    porque as colunas de origem têm o mesmo tamanho;
  - o rateio do acatado em parte e a regra do parecer saíram do adaptador para o domínio (`rateioDoAcatado`,
    `problemasDoParecerDoRecurso` em `dominio-operadora/src/conta.ts`, com teste). As portas própria e de memória
    chamam as mesmas funções;
  - alteração do auditor, de ponta a ponta: o `nome` saiu do contrato, da tela, da porta de memória e dos testes. A
    porta devolve o nome do cadastro do profissional, a mensagem usa esse nome, e o motivo vai para a trilha da
    operação, com teste de integração que confere a linha da trilha;
  - ANS: o complemento do SIB (leitura e gravação) e a base do DIOPS (eventos, das contas médicas recebidas) foram
    ligados. O retorno aceito do SIB marca o envio aceito no complemento;
  - cobrança: a base das mensalidades foi ligada (contratos da competência, preço por faixa, beneficiários, reajustes
    aplicados e mensalidade já gerada). A ficha do contrato passou a trazer o preço por faixa, que antes vinha nulo.

## Decisões pela melhor prática (para o dono ver)
1. **Inventário das tabelas de origem é do conector, não do produto.** O levantamento das tabelas (linhas, gatilhos,
   destino) vive em `conector/mapa/tabelas.tsv`. A conferência "o sistema de origem nunca teve beneficiário" era
   premissa de coexistência do `new-sgh`.
2. **Um recurso de glosa por guia.** O cancelado não conta.
3. **Quem registrou o recurso não o decide.** O parecer é obrigatório no mantido e no acatado em parte, como já exige
   o CHECK da linha.
4. **Recurso pela guia com várias linhas: o acatado parcial é repartido pelo peso de cada linha.** A última linha
   fica com o resto dos centavos.
5. **O nome do auditor não muda na designação.** É o do cadastro do profissional, que muda lá, com a trilha dele.

6. **Endereço do SIB vem do cadastro da pessoa** (`endereco_pessoa`, o principal), que é uma fonte só. O complemento
   não regrava o endereço e recusa `endereco-do-cadastro` quando ele difere do cadastro.
7. **O retrato aceito pela ANS é o registro do beneficiário no último envio SIB aceito.** Ele não é copiado para outra
   coluna.
8. **Rateio do acatado em parte pelo maior resto em centavos.** Substitui a regra "a última linha fica com o resto": a
   soma fecha exata e nenhuma linha passa do próprio recorrido.
9. **Preço da mensalidade:** vale a tabela exclusiva vigente do contrato; sem ela, a tabela vigente do produto.

## O que falta (rodada 2: 7 arquivos, 32 recusas)
Ver `09-operadora.json`. `ans-porta-propria.ts` tem 9 recusas: arquivo do envio, pendências do SIB, SIP (2),
contraprestações do DIOPS, monitoramento, identificação, GRU e decisão do ressarcimento. As duas últimas dependem da
ligação do envio com a cobrança, pedida em DDL. `atendimento-porta-propria.ts` tem 15, `cobranca-porta-propria.ts` 4
(acordo e notificação), `autorizacao-porta-propria.ts` 2 e `porta-propria.ts` 2. Os auxiliares ficam em `apoio-*`.

### Rodada 1 (histórico)
Os pedidos estão em `09-operadora.json`.

| Arquivo | Recusas | Por quê |
|---|---|---|
| `ans-porta-propria.ts` | 11 | A maioria tem tabela: complemento do SIB, GRU, ressarcimento ao SUS, DIOPS (eventos). Falta ligar a porta. SIP, DIOPS (contraprestações) e monitoramento: decidir a origem. O arquivo do envio espera o armazenamento (ADR 0004). |
| `atendimento-porta-propria.ts` | 14 | Faltam colunas do protocolo (RN 395). A credencial do portal fica na identidade da administração. Os anexos esperam o armazenamento. |
| `cobranca-porta-propria.ts` | 5 | O acordo precisa de outra forma de gravador, fora da lista, e de `fatura_plano.acordo_inadimplencia_id` (DDL). A notificação precisa da semente da fase. A base de mensalidades: falta ligar a tabela de preço. |
| `autorizacao-porta-propria.ts` | 2 | Anexos (armazenamento). |
| `porta-propria.ts` | 2 | `produto_plano.operadora_saude_id` e o tipo "cartão de desconto" (DDL). |
| `apoio-banco.ts` / `apoio-porta-propria.ts` | auxiliares | Só zeram quando não houver chamador. `modulo.ts`, fora da lista, também chama. |
