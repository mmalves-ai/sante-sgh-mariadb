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
