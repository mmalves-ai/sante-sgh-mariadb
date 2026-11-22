# Lote digitalizacao-fotos-portal (ADR 0004: arquivos no disco local)

## O que mudou
- Novo `apps/api/src/modulos/arquivos-locais.ts`: a ponte dos módulos da API para a porta `ArmazemArquivos` do
  núcleo. Ela converte o código do estabelecimento da sessão no contexto do núcleo, registra pelo Executor com uma
  chave de idempotência derivada da entrada e isola a leitura por estabelecimento.
  - Sem núcleo: memória (sessão sintética).
  - Com núcleo e sem `ARQUIVOS_RAIZ`: 503, com falha fechada.
- Fotos da higienização (`adt/fotos.ts`), fotos do visitante (`portaria/fotos.ts`), PDF da digitalização
  (`digitalizacao/armazem.ts`) e provas do portal (`portal-paciente/aplicacao/provas.ts`) passam pela porta local.
  Não há mais cliente S3 nem bucket. A chave do módulo leva o id do arquivo:
  - `higienizacao/arquivo-<id>.<ext>`;
  - `visitante/arquivo-<id>.<ext>`;
  - `same/digitalizacao/arquivo-<id>.pdf`;
  - `portal/provas/<id 8 hex><sinal 24 hex>-<ext>`.
- Os módulos `digitalizacao/modulo.ts` e `portal-paciente/modulo.ts` montam o armazém pelo núcleo (`ctx.nucleo`).
- Specs:
  - `arquivos-locais.spec.ts` (unidade, 6 testes);
  - `arquivos-locais.int.spec.ts` (MariaDB real e pasta temporária, 5 testes, PDF incluído).

  Os specs dos 4 módulos estão verdes: 117 de unidade e 50 de integração, no cliente `arq_digitalizacaofot`.

## Decisões pela melhor prática (para o dono ver)
1. **Prova do portal:** a chave é um segredo de quem enviou. Ela leva o id do arquivo e um sinal aleatório de 96 bits,
   guardado no nome do arquivo, e a leitura confere o sinal em tempo constante. O id sozinho seria adivinhável. Antes
   eram 128 bits aleatórios.
2. **Guarda legal no registro:** a digitalização guarda por 20 anos e a prova por 5, em `retencao_ate` e já na gravação.
   O `fixar` pós-COMMIT virou nada a fazer. Em dev/ci não há guarda, como antes.
3. **Hash conferido:** o PDF da digitalização confere o SHA-256 informado contra o conteúdo antes de gravar.
4. **Memória mantida:** a memória continua para a sessão sintética. O formato da chave da portaria passou a ser o mesmo
   nos dois modos.

## Correção pelos achados da revisão (6)
1. **Foto do visitante com um só dono:** a porta do núcleo reaproveita o registro pelo conteúdo. Por isso a portaria
   recusa com 409 (`foto-repetida`) a foto que já é a foto ativa de outro cadastro. Assim a remoção de um cadastro nunca
   apaga a foto de outro. Teste: dois cadastros com os mesmos bytes, remover um e ler o outro; o reenvio depois da
   remoção reativa o registro.
2. **Idempotência por tentativa:** a chave do Executor deixou de vir só do conteúdo e agora é um id aleatório por
   chamada. A deduplicação continua pela chave de armazenamento. O reenvio depois da exclusão reativa o registro, e o
   mesmo conteúdo em outro mês vira outro registro sem erro de idempotência divergente (testes de integração dos dois
   casos).
3. **Falha fechada por estabelecimento:** o código da sessão fora do mapa do cliente recusa com 403
   (`estabelecimento-fora-do-mapa`) ao guardar, ler, excluir e fixar. A leitura exige o mesmo estabelecimento do
   registro, e um registro sem estabelecimento não é entregue. Não há atalho de administrador da plataforma nesta
   ponte: o administrador age por um estabelecimento mapeado.
4. **Foto da higienização com sinal:** a chave passou a ser `higienizacao/arquivo-<id>-<sinal 24 hex>.<ext>`. O sinal
   fica no nome do arquivo e é conferido em tempo constante, como na prova do portal. Ler só pelo id não funciona mais.
   Na portaria o achado não se aplica: a foto é lida pelo cadastro do visitante, e a chave nunca vem do usuário.
5. **Guarda legal só depois do COMMIT:** o PDF da digitalização é gravado sem `retencao_ate`. O `fixar` aplica os 20
   anos pela operação `arquivo.fixar_retencao`, que usa o Executor, deixa trilha, só estende o prazo e recusa um
   registro excluído. O controlador já refaz o `fixar` na conferência. A tentativa recusada fica excluível.
6. **Fiação:** os pedidos 1 e 2 foram aplicados nos `modulo.ts` da portaria e do ADT. O teste de fiação confirma que,
   com núcleo e raiz, o `destino` é `local` nos dois módulos.

## Pedidos (fora do lote)
Estão em `digitalizacao-fotos-portal.json`:
- ligar o núcleo nos `modulo.ts` da portaria e do ADT (internação, Admissão-Alta-Transferência);
- tirar das portas próprias da portaria e da digitalização a inclusão de uma segunda linha em `arquivo`, que o
  vigia-arquivos acusaria como falta, e usar o id da chave;
- passar o usuário da sessão para a trilha;
- incluir o spec de unidade no `SUITE_BASE`.
