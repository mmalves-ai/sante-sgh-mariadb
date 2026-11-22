# Conferência do armazenamento local (ADR 0004)

Data: 2026-11-21. Papel: conferidor (sozinho), sobre o trabalho dos lotes `porta`, `documento-infra`,
`digitalizacao-fotos-portal` e `tiss-financeiro-patrimonio-sus`.

## Provas colhidas

| Conferência | Resultado |
|---|---|
| `grep -rn "client-s3\|ClienteS3\|S3_ENDPOINT\|ErroS3\|sgh-s3"` em `apps packages tools` (`*.ts`, `*.json`) | **0** (e 0 também em `deploy/`) |
| Testes de PDF sem nenhum S3 configurado (`env -u S3_* -u AWS_*`): documento.int, prescricao-pdf, laudo-pdf, contingencia-pdf, licitacao-documento, documentos-pdf (pep, manutenção, patrimônio, repasse) | 9 arquivos, 19 testes verdes (cliente `arq_documentoinfra`) |
| tsc: api (`tsconfig`, `login`, `migrado`), worker (`tsconfig`, `migrado`), web, contratos, núcleo, `tools/instalacao` | 0 erros |
| vitest de unidade: api | 324 arquivos, 2146 testes verdes (19 pulados, como antes) |
| vitest de unidade: worker / núcleo / instalação | 158 / 86 / 63 testes verdes |
| Portaria e ponte dos módulos (unidade e integração) | 5 arquivos, 42 testes verdes (cliente `arq_digitalizacaofot`) |
| `validar_migracoes.py` | 3668 tabelas, 0 erros, 0 gatilhos |
| `contar-legado.sh` | 0 imports em 0 arquivos |
| `divida_f24.py` | 16 arquivos, todos modelo-pendente (igual à HEAD; as 2 entradas novas eram só texto de comentário no SUS e foram reescritas) |

## O que o conferidor corrigiu

- `tools/instalacao/src/variaveis.ts`: saíram as 16 chaves `S3_*` "em retirada". Nenhum código as lê mais.
- `deploy/ubuntu/ensaio/ensaiar.sh`: o ensaio deixou de preencher `S3_ENDPOINT`, `S3_ACESSO` e `S3_SEGREDO`.
  Agora cria `/srv/sante-sgh/arquivos` (0750, do usuário do serviço) e preenche `ARQUIVOS_RAIZ`, que a
  conferência do ambiente exige.
- Fecho dos tipos e da suíte: `arquivos-locais.ts` e os specs dele entraram no `tsconfig.migrado.json` da API.
  Assim o spec de unidade entra no `SUITE_BASE` (pedido do lote digitalização). O `vigia-arquivos` entrou no
  fecho do worker.
- **Portaria (pedido do lote digitalização):** a foto do visitante não gera mais um segundo registro em
  `arquivo`, cuja chave não existia no disco e seria acusada pelo vigia.
  - A porta liga o registro que a porta de arquivos já criou (id na chave do módulo, mesmo estabelecimento,
    finalidade `foto_visitante`, mesmo hash). Faz isso com `tx.alterar`, com trilha e versão.
  - As leituras montam a chave do módulo `visitante/arquivo-<id>.<ext>` a partir do id e do tipo.
  - Foto sem registro recusa com `foto-inexistente`.
  - O int spec cobre a ligação única e a recusa.
- Comentários do SUS sem o texto `modelo-pendente`. A recusa real continua na porta própria e é contada lá.
- Prettier nos dois arquivos do portal que estavam formatados na HEAD.

## Decisão pela melhor prática

- Na portaria, a foto é ligada ao cadastro só se o hash da foto enviada for igual ao do registro. Um id de
  outro estabelecimento, de outra finalidade ou excluído é recusado, nunca aceito em silêncio.

## Pedidos que ficam (não são pequenos; vão para a próxima rodada)

1. **Digitalização:** a captura ainda inclui o próprio registro em `arquivo` (`chaveNoBanco`). Trocar pela
   ligação ao registro da porta (`idNaChave`) exige refazer o int spec, que hoje testa a chave
   `estabelecimento-<id>/...`. Também é preciso decidir o caso "mesmo PDF em dois estabelecimentos", porque o
   reaproveitamento do armazém é por hash no cliente.
2. **SUS (obrigatório):** construir a gravação do arquivo exportado na porta própria, registrando em
   `arquivo` com `retencao_ate` de 5 anos (`registrarArquivoGuardado`).
3. **Documento:**
   - renomear `versaoS3`/`chaveS3` para `arquivoId`/`chave` (domínio, assinatura, `registro-propria`);
   - registro de emissões por requisição em produção (`RegistroEmissoesPropria`);
   - usuário da sessão na trilha do arquivo.
4. **Catálogos:** com destino `banco`, a falha ao guardar o original deve recusar a carga
   (`servico.ts`, `.catch(() => null)`).
5. **DDL opcional:**
   - `carga_catalogo.arquivo_id`, `laudo_bem.arquivo_id` e `arquivo_fiscal_gerado.arquivo_id`, com FK para
     `arquivo`.
   - O pedido de catálogos para usar `SGH_CLIENTE_TESTE` já estava atendido.

## Observação

Os containers `sgh-s3` e `eqx-s3` seguem rodando na VM. São de outros projetos ou do `new-sgh`, e não foram
parados (containers comuns). Os testes acima passaram sem nenhuma variável S3, então o produto não depende deles.
