# Lote tiss-financeiro-patrimonio-sus (ADR 0004: arquivos no disco local)

## O que mudou
- `tiss/armazem-xml.ts`: saiu a guarda S3. Entraram `guardaLocal` (auxiliar comum por chave sobre a porta de arquivos
  do núcleo: caminho preso na raiz e na pasta do banco do cliente, `gravarUmaVez` com fsync, 0444 e link atômico),
  `armazemXmlLocal` e `localizadorDoNucleo` (cria `criarArmazemLocal` no primeiro uso; sem núcleo ou sem
  `ARQUIVOS_RAIZ`, falha fechada). Saiu `retencaoXml` (modos do Object Lock).
- `financeiro/armazem.ts`, `sus/armazem.ts`, `patrimonio/armazem-laudo.ts`: `armazemFinanceiroLocal`,
  `armazemSusLocal`, `armazemLaudoLocal` no lugar das versões S3; `destino` do laudo: `'disco' | 'memoria'`.
- Os quatro `modulo.ts` e `public-api.ts`: sem `ClienteS3` nem `S3_*`; a guarda é a local do cliente padrão.
- Comentários que citavam S3/Object Lock em servico.ts, operacoes.ts, porta.ts e controladores das quatro pastas.
- Specs: `tiss/guarda-xml.int.spec.ts` reescrito sobre `criarPastaArquivosTeste` (XML, financeiro, SUS, laudo, caminho
  fora da raiz, falha fechada sem núcleo); `tiss/porta-propria.int.spec.ts` guarda o XML do lote no disco temporário e
  lê pela chave registrada em `arquivo` (ponta a ponta).

## Decisões pela melhor prática (para o dono ver)
1. A chave de cada módulo continua sendo o caminho relativo na pasta do cliente (`arquivo.chave_armazenamento`), então o
   registro que o TISS já grava em `arquivo` aponta direto para o arquivo no disco e o vigia do worker o confere.
2. Chave ocupada é recusada antes de gravar (TISS, financeiro, SUS), como antes; o laudo é endereçado pelo hash e
   reaproveita o mesmo PDF, e a leitura confere o hash (divergente: 500 `arquivo-divergente`). O laudo cujo PDF não
   confere com o resumo informado é recusado (400) antes de gravar.
3. SUS: `fixar` virou no-op (o arquivo nasce somente leitura; a guarda legal fica no registro); `remover` apaga só o
   arquivo recém-gravado da transação recusada.
4. O laudo não leva mais o prefixo do hospital no disco: a pasta já é por banco de cliente e o conteúdo é endereçado
   pelo hash.
5. A versão do objeto devolvida é `null`: a versão é o hash (porta.md).

## Correção pela revisão (3 achados)
1. **Registro em `arquivo` (ADR 0004, item 2):** novo auxiliar comum `registrarArquivoGuardado`/`ligarArquivo`/
   `retencaoAte` em `tiss/armazem-xml.ts`. Na mesma transação da tabela dona, o financeiro (extrato, remessa, NFS-e,
   DMED/EFD-REINF, lote contábil) e o laudo do patrimônio gravam em `arquivo` a chave, `hash_sha256`, `tamanho_bytes`,
   `tipo_mime`, `imutavel = true` e `retencao_ate` = hoje + 5 anos; `arquivo_id` vai a `extrato_bancario`,
   `remessa_bancaria` e `lote_exportacao_contabil` (as outras duas ligam por `entidade`/`entidade_id`). A porta do
   financeiro passa `arquivo: { chave, tamanhoBytes, tipoMime } | null` no lugar de `chaveObjeto`. Chave já registrada:
   reaproveita se o hash confere, 409 `arquivo-divergente` se não. O serviço do financeiro deixou de engolir toda falha
   da guarda: só a chave ocupada (mesmo conteúdo) segue; falta de raiz ou erro de disco sobe.
2. **SUS:** comentários corrigidos (a guarda legal depende do registro que a porta própria ainda não grava); o pedido
   do .json virou obrigatório, com `retencao_ate` explícito.
3. **`guardaLocal.remover`:** só na guarda criada com `removivel` (a do SUS) e só para a chave que esta guarda gravou e
   ainda não fixou; fixada, alheia ou de outra instância: 409 `arquivo-retido`, nada apagado. A memória do SUS recusa
   igual. Specs: remover a chave fixada e a alheia é recusado e o arquivo continua no disco.

## Pedidos
Em `tiss-financeiro-patrimonio-sus.json`: a gravação do arquivo do SUS na porta própria com o registro em `arquivo` e
`retencao_ate` (obrigatório); DDL opcional de `arquivo_id` em `laudo_bem` e `arquivo_fiscal_gerado`.

## Prova
grep client-s3/ClienteS3/S3_ENDPOINT/ErroS3 nas quatro pastas = 0; tsc da api 0 erros; vitest (unidade e integração,
inclusive guia-pdf e documentos-pdf) 23 arquivos e 142 testes verdes em SGH_CLIENTE_TESTE=arq_tissfinanceiropa
(criado e com o catálogo IBGE carregado para a massa do TISS).
