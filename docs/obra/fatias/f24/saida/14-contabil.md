# F2.4 lote 14-contabil

## O que mudou
- **Regras de contabilização no banco** (`porta-propria.ts`): `regras()` lê `versao_regra_contabil` (filtro por tipo e
  origem); `publicarRegra` inclui a versão (só inclusão; a anterior fica), recusa a mesma versão com
  `versao-concorrente` e outro estabelecimento com `outro-estabelecimento`. A versão aplicada vai ao fato e ao
  lançamento automático (`versao_regra_contabil_id`), e `regraId`/`regra` deixam de vir nulos.
- **Arquivo SPED no banco**: `gravarArquivoSped` grava `arquivo_sped_contabil` (leiaute, linhas, parâmetros, número do
  envio, substituição) e o conteúdo cifrado no armazém, ligado pela tabela `arquivo`; `conteudoSped` lê do armazém.
  A listagem passa a trazer leiaute, linhas e parâmetros gravados.
- **Fontes de fato com nome de negócio**: os códigos das fontes viraram as tabelas próprias que publicam o fato
  (`conta_hospitalar`, `conta_hospitalar_item`, `titulo_pagar`, `titulo_receber`, `movimento_bancario`,
  `movimento_estoque`, `nota_entrada`, `recibo_autonomo`), com `chave: 'id'` e `carimbo: 'alterado_em'`, em
  `FONTES_FATO`, `ROTULOS_FONTE_FATO`, `DERIVADORES` e na porta de memória.
- Comentários com nome de tabela ou coluna de origem reescritos em termos de negócio (contratos e domínio).
- Testes: `porta-propria.int.spec.ts` ganhou os casos de regra e de SPED (com armazém de memória e sem armazém);
  specs do domínio com os novos códigos. Fora do lote, só ajuste de teste: `apps/web/.../contabil-telas.spec.ts`
  (fixture `titulo_pagar`) e `tools/contabil/src/reprocessar.int.spec.ts` (as regras agora leem: sem fatos sai 3).

## Decisões pela melhor prática
- Sem armazém configurado, gravar e ler o SPED recusam com **503 `armazem-indisponivel`**. Não existe gravação sem
  guarda nem conteúdo vazio.
- O evento contábil do tipo de fato é criado como **nativo** na primeira publicação, se o catálogo não o tiver.
- A substituta aponta o último envio válido do exercício. A nova geração original substitui o último gerado ainda não
  substituído. Substituta sem envio anterior é recusada (`sem-arquivo-substituido`). Essa regra (número do envio e
  substituição) é a função pura `planejarEnvioSped` do `dominio-contabil`, usada pela porta do banco e pela de memória
  (`memoria-demonstracoes.ts`, fora da `.lista` e sem dono, ajustada para não divergir), com teste no domínio e no
  spec das demonstrações.
- O período do SPED é o exercício inteiro (1/1 a 31/12). O arquivo guardado é imutável, e `arquivo.hash_sha256` é o
  hash do conteúdo cifrado guardado. O `tamanho` listado é o do objeto guardado.

## Situação real (não contar como dívida quitada)
- **O SPED segue indisponível no banco.** `modulo.ts` (fora da `.lista`) ainda cria `new PortaContabilPropria(ctx.nucleo)`
  sem o armazém: gerar e baixar a ECD/ECF no banco recusa com 503 `armazem-indisponivel`. O verificador deixa de contar
  o `modelo-pendente`, mas a funcionalidade só fica entregue quando o orquestrador aplicar o 1º pedido abaixo.
- **Fontes de fato:** os códigos já são as tabelas próprias, mas os derivadores ainda leem o leiaute da origem (decisão
  pedida). `linhasPc`/`semCarimboPc` ficaram marcados como medida histórica da cópia da origem, e o comentário de
  `FonteFato` não afirma mais nada sobre índice ou carimbo das tabelas próprias. Hoje o worker recusa a leitura.

## Pedidos (saida/14-contabil.json)
- Ligar o armazém de disco (ADR 0004) em `modulo.ts`.
- Semente de `evento_contabil`.
- Leitura das regras no worker.
- Derivadores ainda no leiaute de origem (conector ou reescrita).
- Fontes `SGH_*` de folha e patrimônio.
