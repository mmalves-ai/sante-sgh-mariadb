# Velocidade da carga pelo mapa (orçamento `velocidade-carga`, 2026-11-22)

## Resultado em uma frase

A gravação em bloco deixou a carga **de 2 a 3 vezes mais rápida** nas tabelas típicas. A meta de 10 vezes **não foi
alcançada**: com o código novo, o teto de um processo só fica entre 5 e 7 mil linhas por segundo, porque a leitura da
origem e o preparo da linha em Python custam isso sozinhos. Passar de 10 vezes exige paralelismo entre processos
(próximo passo, abaixo).

## Como foi medido

- **Comando novo:** `conector/conector.sh medir-carga <relativo> --cliente C --tabelas T1,T2 --limite N --limite-pais M --vezes 2`.
  - O código está em `conector/sante_conector/medir_carga.py`.
  - Ele roda o plano do motor restrito às tabelas medidas e aos pais delas (fecho de `depende_de`, 187 entidades).
  - Cada tabela lê no máximo N linhas, na ordem da chave.
  - A 2ª passada prova a idempotência.
  - A saída traz só contagens, mais a contagem do `conector_origem` por tabela e regra e as pendências por regra.
- **Origem:** a cópia real `pc-20261019.fdb`, com 60.000 linhas por tabela medida e 5.000 por tabela-pai.
- **Bancos:** clientes de teste próprios `vel_a` (código antigo), `vel_b` (versão intermediária) e `vel_c` (código
  final), todos na plataforma de teste `plataforma_teste_vel`. Foram apagados no fim.
- **Limite do recorte:** os pais ficam cortados em 5.000 linhas, então muitas linhas filhas caem em `pai_inexistente`
  ou em `restricao_destino_1048`.
  - Na 1ª passada houve 67 mil recusas por restrição e 100 de 705 blocos refeitos.
  - Isso **desfavorece** o código novo, porque o bloco com recusa é dividido e refeito. Na carga real, com os pais
    presentes, a recusa por restrição é rara.

## Medidas (linhas por segundo)

| Tabela (60.000 linhas) | Área | Antes | Depois | Ganho | 2ª passada antes | 2ª passada depois |
|---|---|---:|---:|---:|---:|---:|
| PREVOLPAC (registro assistencial, evolução) | PEP | 2.038 | 5.354 | 2,6× | 5.817 | 11.065 |
| TBCABTRILHA (trilha de auditoria) | ADM | 947 | 1.076 | 1,1× | 3.046 | 5.622 |
| GELANSAI (movimento de estoque) | SUP | 2.353 | 6.803 | 2,9× | 6.500 | 13.939 |
| FCLANEXT (item da conta hospitalar, 2 destinos) | FAT | 1.546 | 3.140 | 2,0× | 4.464 | 6.354 |
| **Recorte inteiro** (348.245 linhas, 124 tabelas) | | **818** (425,6 s) | **1.567** (222,3 s) | **1,9×** | 2.097 (166,1 s) | 6.236 (55,8 s) |

Na trilha de auditoria (TBCABTRILHA), quase toda linha do recorte é recusada por pai ausente. O ganho ali é o da recusa
em lote, e não o da gravação.

**Previsão da carga completa (195 milhões de registros):**
- Com o ganho de 2 a 2,5 vezes sobre os 1.400 linhas/s medidos na carga real, o ritmo fica entre 3.000 e 3.500
  linhas/s, ou seja, **cerca de 15 a 18 horas** (antes, mais de 38 horas).
- O piso de um processo só, com a leitura e o preparo da linha, é de cerca de 9 a 11 horas.

> As medidas "depois" são da versão de `vel_c`, antes da proteção contra aviso no lote (que só age quando há aviso) e da mudança das pendências de `carga.py` para `carga_mapa.py` (mesmo SQL). Vale medir de novo na próxima volta.

## Equivalência (mesmo resultado, código antigo × novo, na cópia real)

- O `conector_origem` tem contagem **idêntica** por tabela e por regra: linhas, com id e recusadas, em todas as 124
  tabelas.
- As pendências por regra são **idênticas**: 449.071 na 1ª passada e 401.175 na 2ª.
- A conciliação dá 186 de 187 entidades conferidas nos dois. A entidade divergente é a mesma antes e depois, e vem do
  recorte cortado.
- A 2ª passada (idempotência) pula todas as 348.245 linhas como iguais, sem gravar nada, nos dois.
- A versão intermediária (`vel_b`) mostrou uma pendência `filho_pai_divergente` a mais.
  - Causa: a ligação filho → pai ficava registrada para uma linha desfeita no bloco.
  - Foi corrigida: só fica a ligação do que chegou ao banco, como na gravação linha a linha. A versão final bate.
- A soma do `hash_destino` difere, e isso é esperado. Os ids reservados no bloco não reaproveitam o número que o
  autoincremento queimava numa recusa, então o id do pai gravado na linha filha muda de valor, sem mudar de ligação.

## O que mudou (`conector/sante_conector/carga_mapa.py` e `carga.py`)

1. **Gravação adiada em bloco** para a linha nova simples, ou seja, sem cabeçalho agrupado, adoção, complemento,
   provisório, Sincronizar com alteração, padrão do destino nem autorreferência na tabela.
   - O id vem reservado em memória (MAX(id)+1 do destino).
   - O INSERT sai com várias linhas por destino, na ordem pai → filho da linha.
   - O `conector_origem` sai em INSERT … ON DUPLICATE KEY de várias linhas.
   - Tudo isso é gravado antes de qualquer outra conversa com o banco e de todo commit, que continua a cada 2.000
     linhas.
2. **SAVEPOINT por bloco.** Numa restrição do destino, o bloco é desfeito e dividido ao meio até pedaços de 16 linhas,
   que são refeitos linha a linha, cada uma sob o SAVEPOINT dela.
   - Só a linha que falhar é desfeita: banco, `existente`, pendências, contadores, soma da origem, referências da
     fase 2 e ligação filho → pai.
   - Ela fica recusada com `restricao_destino_<código>`, gravidade crítica, e propagada aos filhos, como antes.
3. **Recusa em lote.** O registro da linha recusada antes de gravar (regra, filtro, colisão de caixa) vai no lote do
   bloco.
4. **Pendências** em INSERT de várias linhas, de 1.000 em 1.000. O `executemany` antigo virava um comando por
   pendência, porque a função de data no VALUES impede a junção.
5. **Índices únicos sem caixa** lidos com duas consultas filtradas pela tabela. A junção das duas visões do
   `information_schema` levava cerca de 2,5 s por destino, ou seja, de 40 a 45 minutos na carga completa.
6. **Chave de segurança:** `CONECTOR_SEM_LOTE=1` volta à gravação linha a linha, sem mudar código.

Ficam iguais:
- a ordem do plano e as dependências;
- o Sincronizar (L9), porque a linha alterada segue linha a linha;
- a fase 2;
- a conciliação;
- as pendências por linha, só com tabela, chave e regra.

## Provas

- **(a) Medição antes e depois:** tabela acima. Os arquivos `antes.json` e `depois2.json` e os perfis `perfil_*.txt`
  estão em `/tmp/claude-1000/vel/`.
- **(b) `conector/conector.sh testes`:** 1.230 testes, OK, com 10 pulados e 2 falhas esperadas.
  - Uma versão intermediária mexia no `_commit` do L3 (`carga.py`) e quebrava `test_l3`.
  - Foi revertida: o INSERT de várias linhas das pendências ficou só na carga pelo mapa.
- **(c) `tools/obra/conferir-fatia-f4.sh`:**
  - Fatias que tocam as tabelas medidas: L5-03, L6-12, L7-05, L7-08, L8-06 e L8-08.
  - Mais cinco: L5-01, L6-01, L7-01, L8-01 e L8-19.
  - 9 dão ok.
  - **L7-08 e L8-01 falham também no HEAD sem esta mudança** (conferido com `git stash`, com o mesmo erro):
    - L7-08: GECADDISPENSACAO com `restricao_destino_1048` 0/1 e `restricao_destino_4025` 2/1;
    - L8-01: FCCODCON com `valor_fora_do_dominio` 0/1.
  - Também falham com o lote desligado. São pendências anteriores, não causadas por esta mudança.
- **Aviso no lote:** no INSERT de várias linhas, o MariaDB troca NULL em coluna NOT NULL pelo padrão implícito, só
  com um aviso (linha a linha, é o erro 1048).
  - Proteção: todo aviso num lote de mais de uma linha desfaz o lote, que é refeito em pedaços até a linha sozinha.
  - A linha sozinha volta ao comportamento antigo.

## Riscos

- **Id reservado por MAX(id)+1.** A reserva vale porque a carga é a única a gravar no banco do cliente durante a
  execução.
  - Toda inserção fora do lote invalida a reserva daquele destino, e uma recusa no bloco zera todas.
  - Se outro processo gravasse no mesmo destino ao mesmo tempo, o id colidiria e a linha seria recusada como
    `restricao_destino_1062`.
- **Tamanho do comando.** O lote é cortado em 500 linhas ou cerca de 4 MB, abaixo do `max_allowed_packet` padrão.
- **Recusa em massa.** Um bloco com muitas recusas por restrição fica mais lento que a gravação linha a linha, por
  causa das divisões ao meio. É o caso do TBCABTRILHA no recorte.
- **Ordem das pendências.** A pendência `restricao_destino_*` da linha refeita entra no fim do bloco, e não na posição
  da linha. As contagens são as mesmas; só o id da pendência muda.

## Próximo passo para chegar a 10×

O perfil final mostra onde vai o tempo por linha:
- leitura do Firebird: cerca de 40 µs;
- preparo dos valores: cerca de 120 µs;
- hash da linha: cerca de 28 µs;
- o resto do banco já está em lote.

Para chegar a 10 vezes é preciso **paralelismo entre processos**:
- tabelas independentes da mesma onda do plano, cada uma com o seu leitor e a sua conexão;
- ou faixas de chave da mesma tabela grande.

Isso exige separar o estado em memória (`existente`, `prop`, `origem`) por processo e juntar os resultados na
conciliação. É mudança de arquitetura do motor e precisa de orçamento próprio.

## Etapa 2: um leitor e N gravadores (orçamento `paralelismo-carga`, 2026-11-22)

**Desenho** (`conector/sante_conector/paralelo.py`, chamado por `CargaMapa.executar`):
- o processo principal é o **único leitor** do Firebird e serve as leituras dos gravadores por canal, em lotes de 1.000
  linhas com um lote adiantado por fluxo;
- **N gravadores** (`CONECTOR_GRAVADORES`, padrão 6) são processos filhos (fork), cada um com a própria conexão ao
  MariaDB (READ COMMITTED) e o mesmo `_tabela` de antes;
- **ondas**: B vai para uma onda depois de A (anterior no plano) quando:
  - uma menciona a outra: dependencias.tsv ou qualquer nome de tabela da origem ou de destino do plano no texto da
    especificação (`ref:`, `cod:`, `@id:`, encadeadas, filtros, opções);
  - ou as duas gravam o mesmo destino.

  Assim um destino nunca tem dois gravadores ao mesmo tempo, e o id reservado MAX+1 continua seguro. As tabelas
  relacionadas seguem a ordem do plano;
- a onda só começa depois de a anterior terminar, ser commitada e ter o estado juntado. A onda de uma tabela só roda no
  próprio processo principal. **Nenhuma tabela é dividida por faixa** (na dúvida, um gravador só);
- o gravador devolve só a diferença do estado em memória: chaves tocadas, cauda das listas e soma dos contadores. A fase
  2, o Sincronizar, a conciliação, as provas, o relatório e o preço da origem seguem no processo principal, como antes;
- o código antigo, com a ordem do plano num processo só, vale em três casos:
  - `CONECTOR_GRAVADORES=1`;
  - leitor que não seja o Firebird real;
  - conexão que não seja pymysql.
- **Correções pedidas pela prova:**
  - as marcas `_AMBIGUO` e `NAO_NUMERICO` voltam idênticas depois do pickle. Sem isso, `pai_ambiguo` virava
    `pai_inexistente` no teste L6-12;
  - os contadores (`cont`) refeitos por atribuição ou criados no gravador são somados, e não substituídos.

**Medida:**
- **Origem:** cópia real `pc-20261019.fdb`.
- **Recorte:** PREVOLPAC, GELANSAI, FCLANEXT e TBCABTRILHA com 150.000 linhas cada, e os pais com 20.000. São 124
  tabelas, 888.330 linhas e 30 ondas, a maior com 50 tabelas.
- **Bancos:** clientes `vel_p1` e `vel_p6c` na plataforma `plataforma_teste_par`, apagados no fim.

| Passada | 1 gravador | 6 gravadores |
|---|---:|---:|
| 1ª (carga) | 196,9 s, **4.511 linhas/s** | 162,7 s, **5.461 linhas/s** (1,2×) |
| 2ª (idempotência) | 87,9 s, 10.106 linhas/s | 95,4 s, 9.308 linhas/s |

- **Equivalência entre os dois modos:**
  - o `conector_origem` por tabela e por regra é idêntico nas 124 tabelas;
  - as pendências por regra são idênticas: 923.948 na 1ª passada e 900.589 na 2ª;
  - os contadores da carga são idênticos;
  - 186 de 187 entidades são conferidas nos dois, e a divergente é a mesma, vinda do recorte;
  - a 2ª passada pula tudo como igual nos dois.
- **Ganho pequeno no recorte:** o recorte é dominado por cadeias de ondas de uma tabela só e pelas quatro tabelas
  medidas, cada uma num gravador.

**Previsão da carga completa:**
- **Comando:** `conector.sh medir-carga <img> --cliente C --tabelas X --prever 6000,25000,6`.
- **Base:** contagem real de cada tabela do plano, as ondas, 6 gravadores a 6.000 linhas/s cada e o leitor a 25.000
  linhas/s.
- **Resultado:** 1.137 tabelas, 166 milhões de linhas no plano e 208 ondas, ou seja, **cerca de 5,3 horas**. Com 4.500
  linhas/s por gravador, cerca de 7 horas. Antes, de 15 a 18 horas.
- **A meta de 4 horas não é alcançada sem dividir tabela grande.**
  - A onda mais longa tem 31 tabelas e 34 milhões de linhas, e leva cerca de 1,5 hora.
  - Ela é limitada pela TBCABTRILHA (trilha de auditoria), com 32,9 milhões de linhas num gravador só.
  - Depois vêm TBLANTRILHASGH (17,1 M), PREVOLPAC (14,2 M), PREVOLPACTMP (7,5 M) e PRCHKGERAL (6,3 M).
- **Próximo passo:** dividir por faixa de chave as tabelas grandes sem autorreferência, adoção nem agrupamento, com
  reserva de id por faixa para cada gravador. A trilha de auditoria é a primeira candidata.

**Provas:**
- **(b) `conector/conector.sh testes`:** 1.230 testes OK, com 10 pulados e 2 falhas esperadas, tanto com 6 gravadores
  (padrão) quanto com `CONECTOR_GRAVADORES=1`.
- **(c) `tools/obra/conferir-fatia-f4.sh`:**
  - Fatias: L5-01, L5-03, L6-01, L6-12, L7-01, L7-05, L7-08, L8-01, L8-06 e L8-08.
  - 8 dão ok.
  - L7-08 e L8-01 falham com o mesmo erro do HEAD, sem mudança.

**Riscos:**
- **Memória.** Cada gravador nasce do fork com todo o estado.
  - O coletor fica congelado no fork, para reduzir a cópia de página.
  - O estado da tabela grande (`existente`, `origem`) volta por pickle ao processo principal.
  - Na carga completa, é preciso vigiar a memória (45 GB).
- **Dependência pelo texto.** Um nome de tabela que não aparece na especificação nem no dependencias.tsv não cria
  ordem. O critério é conservador (qualquer menção vale), e a prova de equivalência cobre o recorte.
- **Junção do estado.** Ela é genérica por atributo. Um dicionário grande alterado no lugar, fora das chaves da tabela
  em gravação, não volta. Os testes e o recorte não mostraram nenhum caso.
- **Fork com o Firebird carregado.** O filho nunca usa a conexão herdada e sai por `os._exit`.
- **Trava entre gravadores** no `conector_origem`. A chave única é por tabela da origem, e a sessão usa READ COMMITTED.
  Não houve deadlock no recorte.
