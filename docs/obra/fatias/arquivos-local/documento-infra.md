# Lote documento-infra (ADR 0004, arquivos no disco local)

## O que mudou
- `documento/infra/s3.ts` saiu. Novo `documento/infra/arquivos.ts`:
  - `armazemArquivosDoAmbiente`: com o núcleo e o cliente, o disco local (`criarArmazemLocal`, criado no primeiro uso,
    um por núcleo); sem núcleo, a memória só na sessão sintética; fora disso, indisponível, com falha fechada por
    operação;
  - `ArmazemArquivosMemoria` (porta em memória com leitura conferida e guarda legal), `armazemSobDemanda` e
    `idDoArquivo`.
- `EmissaoService`: PDF/A pela porta.
  - Ordem: reserva, `guardar` (finalidade `documento_emitido`, `retencaoAte` e `imutavel` pela política) e confirmação
    com o id do arquivo.
  - `lerPdf` confere o hash do arquivo contra o da emissão.
  - O PDF assinado é guardado com a finalidade `documento_assinado`, e `lerObjeto` lê pelo id.
  - O original, a 2ª via e a validação pública pelo QR continuam iguais.
  - `PoliticaRetencao` = `{ imutavel, duracaoMs }`, mais o novo `retencaoAte()`.
- `fonte.ts` e `modulo.ts`: a porta vem do ambiente. `criarFonteDocumento(cfg, env)` continua valendo (memória na
  sessão sintética).
- `catalogos/guardar-arquivo.ts`: arquivo original pela porta (`carga_catalogo`), devolvendo o id. Ganhou o 3º
  parâmetro, o núcleo (ver pedido).
- Integração: `ArmazemConteudoS3` deu lugar a `ArmazemConteudoArquivos`, com origem `integracao` e o id como
  referência. Foi criado `armazemConteudoIndisponivel`. `modulo.ts` e `public-api.ts` ajustados.
- `gotenberg.ts`: uma nova tentativa quando a conexão reaproveitada já estava fechada (EPIPE/ECONNRESET). O teste de
  snapshot do PEP falhava sempre sem ela.
- Specs:
  - `documento.int.spec` foi refeito: somente leitura (0444), reaproveitamento do mesmo conteúdo, exclusão recusada
    sob guarda legal e hash conferido;
  - o spec de unidade usa a porta em memória;
  - os specs de PDF (prescrição, documentos do PEP, laudo, contingência, licitação, prévia da assinatura) usam
    `arquivosDeTeste()` (em `integracao.spec-util.ts`, pasta temporária e `SGH_CLIENTE_TESTE`);
  - saíram as limpezas de bucket por `docker exec sgh-s3`.
- `tsconfig.migrado.json`: `infra/s3.ts` foi trocado por `infra/arquivos.ts`.
- O worker (`vigia-banco.service.ts`) já estava sem S3 desde a etapa compartilhada. Não existe `@aws-sdk/client-s3` em
  nenhum package.json do produto.

## Decisões pela melhor prática
- O registro da emissão guarda o **id do arquivo**, e não a chave. A leitura parte do registro e confere o hash. O
  campo do domínio ainda se chama `versaoS3`, e a troca está pedida.
- Chave de idempotência nova por gravação. O mesmo conteúdo no mesmo mês cai no mesmo arquivo pela própria porta
  (`reaproveitado`). Uma chave derivada do hash daria `idempotencia-divergente` na virada do mês.
- Dev e CI sem banco próprio usam a porta em memória, como as outras portas sintéticas. Em produção, sem núcleo, a
  porta fica indisponível e nunca grava em outro lugar.
- O nome `garantirBucket()` ficou só por compatibilidade com a assinatura (outro módulo). Agora ele apenas confere se a
  porta responde.

## Pedidos
Estão em `documento-infra.json`: passar o núcleo em `catalogos/modulo.ts`, renomear `versaoS3`/`chaveS3`, FK
`carga_catalogo.arquivo_id` e cliente de teste do `catalogos/porta-propria.int.spec`.

## Correção pela revisão (2 achados)
- **Catálogos (alta):** `catalogos/modulo.ts` passa o núcleo a `guardarArquivoCatalogo`. Com destino `banco` e sem a
  porta, a montagem recusa (falha fechada), em vez de seguir sem o original. O arquivo leva o estabelecimento da
  carga e a tabela dona `carga_catalogo`.
- **Vínculo do arquivo (média):**
  - novo `estabelecimentoDoCliente(cliente, núcleo)` em `documento/infra/arquivos.ts`, exportado pela public-api:
    código → `estabelecimento.id` pelo mapa do cliente; relê o mapa uma vez e, fora dele, recusa;
  - `EmissaoService` ganhou a dependência `idEstabelecimento`, ligada em `modulo.ts` com o núcleo, e
    `PedidoEmissao.usuario`, que é o `usuario.id`;
  - o PDF emitido vai com o estabelecimento e o usuário no contexto, mais entidade `emissao_documento`;
    - `entidadeId` = id da linha, que `RegistroEmissoes.reservar` agora devolve quando o registro é do banco;
  - o PDF assinado vai com entidade `assinatura_icp` e `entidadeId` = id da assinatura;
    - `gravarAssinado` ganhou o 5º parâmetro opcional, `usuario`;
  - a integração (`ArmazemConteudoArquivos`) passa a usar o estabelecimento pelo 1º segmento da chave.
- Specs: o de unidade confere estabelecimento 42, a entidade e o `entidadeId` da emissão e da assinatura, e a recusa
  fora do mapa. Saiu a trava `sistema/0`.

### Decisões
- A entidade vai sempre. O `entidadeId` vai quando existe: no registro em memória da sessão sintética, ele não existe.
- Na carga de catálogo, o arquivo é guardado antes de a linha existir. O vínculo fica em
  `carga_catalogo.arquivo_guardado`, e o arquivo leva só a entidade.

### Pedidos novos (fora do lote)
- `catalogos/servico.ts:231`: o `.catch(() => null)` engole a falha de guardar, e a carga segue como "arquivo não
  guardado". Proposta: com destino `banco`, recusar a carga.
- Ligar `RegistroEmissoesPropria` por requisição em produção. Hoje o registro é em memória e o `entidadeId` da emissão
  fica null.
- Os chamadores de `emitir` e de `gravarAssinado` devem passar o `usuario.id` da sessão: PEP, SADT, enfermagem,
  suprimentos e `assinatura/aplicacao/documentos.ts:994`.
