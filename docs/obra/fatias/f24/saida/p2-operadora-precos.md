# F2.4, 3ª etapa: lote p2-operadora-precos (operadora e preços)

## O que mudou
- **Preços: importação de tabela** (`precos/fonte-propria.ts`), sobre o DDL da 4ª leva:
  - `gravarCarga`: carga (`carga_tabela_preco`: arquivo, tamanho, catálogo, SHA-256, totais) e as linhas
    (`carga_tabela_preco_linha`: os cinco componentes, os vigentes antes, o nome, a comparação e o motivo) num passo
    só pelo Executor, com a trilha. A tabela tem de ser do estabelecimento da sessão. O item faturável é ligado pelo
    item da tabela.
  - `cargas`, `carga` e `linhasDaCarga`: leitura restrita ao estabelecimento. As contagens (novo, alterado, igual,
    removido) saem das linhas.
  - `mudarSituacaoCarga`: publica (data, usuário e o lote de reajuste pelo identificador, da mesma tabela) ou rejeita
    (motivo obrigatório), pela versão lida. As recusas `conflito-concorrente` e `situacao-invalida` voltam como as da
    carga.
- **Preços: contrato do convênio.** Os 13 campos de contato por área passam a ser lidos e gravados em
  `contato_fonte_pagadora`: incluído na primeira vez, alterado pela leitura e excluído logicamente quando fica vazio. A
  inscrição estadual grava na pessoa jurídica do convênio. CNPJ, endereço e nota fiscal são lidos da pessoa jurídica
  (a tomadora da nota, quando informada, e a do convênio, quando não) e do endereço principal dela.
- **Operadora: GRU da TPS** (`ans-porta-propria.ts`). Fica no próprio envio da obrigação `tps` (número, valor, data e
  valor pagos) e é registrada uma vez só. A leitura do envio mostra a GRU da TPS ou a do ressarcimento.
- **Testes:** 46 de 46 de integração, no cliente `f24q_operadoraprecos`, em `precos/` e `operadora/`. Os specs novos
  cobrem a importação, os contatos, os campos do cadastro e a GRU da TPS. Mais 61 de 61 de unidade e tsc da api sem
  erro nos dois módulos.
- **Dívida:** `api/precos` chegou a 0. `api/operadora` continua com 2 arquivos, pelo motivo em "Falta".

## Decisões pela melhor prática (para o dono ver)
1. **CNPJ, endereço e nota fiscal não se editam pelo contrato do convênio.** São da pessoa jurídica, com o endereço
   estruturado (CEP, município do IBGE e base postal). A tela lê esses campos, e a gravação recusa com
   `campo-do-cadastro`, apontando o cadastro da pessoa jurídica. Assim se evita uma segunda cópia e a edição, pela tela
   do convênio, de outra empresa (a tomadora).
2. **Senha obrigatória: recusa 409 `decisao-pendente` (DP-33).** O motivo é a falta de decisão sobre o significado dos
   valores, não de modelo.
3. **Mesmo arquivo uma vez por tabela** (UNIQUE do modelo). O reenvio recusa com `carga-repetida` e informa a
   importação anterior.
4. **Linha de erro sem código legível:** o `codigo_item`, obrigatório no modelo, fica vazio, e o motivo vai em
   `divergencia`. A leitura devolve o código como nulo.
5. **Componente desconhecido na linha recusa** (`componente-desconhecido`), porque nada é descartado em silêncio.

## Falta (ok=false; pedidos em p2-operadora-precos.json)
- `operadora/apoio-porta-propria.ts:9,76`: o auxiliar das recusas que restam continua necessário para:
  - o arquivo do envio à ANS e os anexos do prestador, porque a porta de armazenamento do ADR 0004 não existe no
    código;
  - o portal do prestador, que depende da identidade no módulo de administração;
  - as pendências do SIB;
  - as bases do SIP, do DIOPS e do monitoramento TISS;
  - a identificação dos beneficiários do aviso.
- `operadora/autorizacao-porta-propria.ts:21`: os anexos da resposta do prestador também dependem da porta de
  armazenamento.
- A aprovação da importação ainda para em `preco.reajustar`, que não está liberado na fonte própria. É a etapa do
  reajuste, fora do modelo-pendente.
- O preço por médico não foi tocado (ADR 0009, etapa própria).
