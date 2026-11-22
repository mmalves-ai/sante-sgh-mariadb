# Mecanismos da rodada 5 (motor do conector; ADR 0006 e 0007, continuidade)

Prova: `sintetica_d/exemplo_r5.py` e `testes/test_carga_mapa_r5.py` (imagem 100% falsa, tabelas `EX6_*`). Código:
`conector/sante_conector/continuidade.py` (cofre, senha, evidência, comparação), `carga_mapa.py`, `mapa.py`,
`semente_espelho.py`, `conferencia.py`, `tools/obra/cobertura_conector.py`. Modelo: `db/migracoes/02_ADM/40_tabelas.sql`
e `17_INTG/41_tabelas.sql`.

## (a) Rascunho da origem como rascunho do autor (ADR 0006, item 2)
Opção de coluna `autor` na via, junto de `cod:` (login) ou `ref:` (chave do usuário da origem). Achado: grava o id do
autor. Não achado: a linha ENTRA (sem autor; o destino aceita nulo só com `origem = 'migracao'`) e leva a pendência
ALTA `rascunho_sem_autor` (tabela, chave e regra; nunca o valor), no lugar de `codigo_inexistente_destino`.
A data original e a situação de rascunho são colunas comuns.

```
PRCABEVOLTMP  USUARIO    registro_assistencial_rascunho.autor_usuario_id  texto  cod:usuario.login;autor
PRCABEVOLTMP  DATA       registro_assistencial_rascunho.iniciado_em
PRCABEVOLTMP  =aberto    registro_assistencial_rascunho.situacao
```

## (b) Ligação ao espelho pelo código e pela edição (ADR 0006, item 3)
`espelho:<catalogo>` na via (catálogos `brasindice`, `simpro`, `cbhpm`, `cep`), com a edição opcional
`@<COLUNA>` (da linha) ou `@=<edição>` (literal). Grava o id da linha do espelho já levada ao cliente (mesmos ids);
nunca copia conteúdo licenciado. Pendências média: `espelho_codigo_inexistente`, `espelho_edicao_inexistente` (o
código existe, mas não naquela edição), `espelho_ambiguo`. Sem edição, CBHPM liga à edição mais recente.

```
TBPERMEM  COD  preco_negociado_matmed.item_referencia_matmed_id    espelho:brasindice@VERSAO
```

A cobertura BLOQUEIA (`licenciado_copiado:<tabela>`) a tabela que declara destino em tabela do conteúdo licenciado
(`mapa.LICENCIADAS_ESPELHO`): hoje FCREFUND (L8-01) e TBMATMED (L8-03), a refazer com `espelho:`.

## (c) Semente do espelho a partir da cópia da origem (ADR 0006, opção b do dono)
`conector.sh semear-espelho <origem> [--espelho BANCO]`: lê as edições guardadas na origem e grava SÓ no espelho
(recusa banco sem `edicao_espelho`/`tabela_espelho`), pela MESMA normalização e SQL do carregador por arquivo
(`catalogos/licenciados/carregar.py`, montado em `/app/licenciados`). Uma vez por edição (edição já registrada:
`ja_semeada`); conferência por contagem por edição (válidas da origem = linhas da edição no espelho); manifesto em
`tabela_espelho`. Declaração em `conector/mapa/declarado/semente_espelho.tsv` (catalogo, tabela, coluna, campo, motivo):
campos do FORMATO.md, `#edicao`, `#vigencia` (coluna de data: a mais antiga da edição; ou `=AAAA-MM-DD`), `#so_se`;
coluna do pai pela chave `COL>TABELA>COLUNA`. O arquivo está só com o cabeçalho: a declaração real (TBVLRMEM com
TBVERSAOBRASIN e o cadastro do item) é da fatia dona (L8-05).

```
simpro  EX6_BRA  COD     codigo
simpro  EX6_BRA  DESCR   descricao
simpro  EX6_BRA  EDICAO  #edicao
simpro  EX6_BRA  DTPUB   #vigencia
```

## (d) Prova de "não copiar" (ADR 0006, item 1)
`conector/mapa/declarado/provas.tsv` (tabela, tipo, chave, valores, motivo) + `provas.d/<TABELA>.sql` (um SELECT no
destino com as colunas da chave e dos valores, na mesma ordem; `{ctl}` = base de controle). `valores` aceita
`COL!regra` (ex.: `ULTIMO!inteiro_mais_um`). No fim da carga o motor lê a origem e compara:
- `derivado`: igual LINHA A LINHA (iguais, divergentes, faltando, sobrando);
- `mecanismo`: o estado carregado vale pelo menos o da origem (ex.: próximo número >= último + 1).

Resultado em `res["provas"]` e na `conciliacao` (entidade `prova:<TABELA>`); falha: pendência ALTA
`prova_nao_conferida` e erro na autoconferência. Na cobertura, descarte `sem_valor`, `duplicado`,
`mecanismo_do_produto` ou `derivado` (causa nova) SEM prova declarada fica BLOQUEADA `descarte_sem_prova:<causa>`.

```
provas.tsv:     EX6_SAL  derivado   PROD  SALDO               saldo = soma dos movimentos
provas.d/EX6_SAL.sql:  SELECT produto, SUM(quantidade) FROM ex6_movimento GROUP BY produto
provas.tsv:     EX6_CTR  mecanismo  NOME  ULTIMO!inteiro_mais_um
provas.d/EX6_CTR.sql:  SELECT 'MOV', MAX(numero) + 1 FROM ex6_movimento
```

## (e) ADR 0007 no motor
- **Vigência pela evidência (16).** `@vigencia_carga` e `=@data_carga` em coluna de vigência (`vigencia`/`vigente` no
  nome) não usam mais a data da carga: (1) a data mais antiga da LINHA nas colunas de criação, início ou primeiro uso
  do dicionário vivo (`continuidade.colunas_de_evidencia`: CAD, INCL, CRIA, INIC, VIGEN, ABERT, REGIST, LANC, GRAV,
  EMIS...; nunca nascimento, validade, fim, alteração), sem pendência; (2) senão a mais antiga da TABELA; (3) senão a do
  registro mais antigo da ORIGEM (`declarado/evidencia_origem.tsv`: RECADATE.DT_ATE e DTGRAV; numa imagem parcial sem
  elas, as colunas de evidência e depois as de data de todas as tabelas da imagem; por último, a data de criação do
  arquivo da origem, MON$DATABASE); (2) e (3) com a pendência baixa
  `vigencia_sem_fonte` (estimada, sem data própria na linha); (4) sem evidência: NULL
  com `vigencia_sem_evidencia` (média). `#vigencia:A,B` declara as colunas de evidência. As colunas de evidência são
  lidas à parte (não entram no hash da linha).
- **Credenciais copiadas (17).** `#senha_hash:<COL>:<algoritmo>` (md5, sha1, sha256, sha512, bcrypt, scrypt,
  argon2id) importa o resumo como está (hex em minúsculas; base64 vira hex), conferido pelo formato (inválido: NULL
  com `senha_hash_invalido`); o algoritmo e `regravar_no_login` são literais declarados (`=md5`, `=1`, com `se:`).
  `#senha:<COL>` (senha legível ou reversível) grava argon2id já na carga. `#cofre:<COL>` GRAVA o segredo cifrado
  (AES-256-GCM, envelope `v1` da API) em `segredo_cofre` do banco do cliente e a coluna recebe a referência
  `cofre:migracao/<tabela>/<coluna>/<resumo>`; sem `PLATAFORMA_CHAVE_MESTRA` (32 bytes base64) a falha é fechada
  (NULL e `segredo_aguarda_cofre`). Colunas de `#senha*` e `#cofre` nunca entram em retrato. Modelo: `credencial_usuario`
  aceita md5/sha1/sha256/sha512 com `regravar_no_login` (CHECK: algoritmo fraco exige a marca).
- **Código derivado sem perder ligação (19).** Toda coluna que referencia um pai com `#codigo_derivado` (ligação pelo
  id via conector_origem) é conferida no fim: cada filha relida aponta para o id do pai esperado (`res["filho_pai"]`,
  entidade `filho_pai:<destino.coluna>`; divergência: `filho_pai_divergente`, alta). O código original fica numa coluna
  declarada (ex.: `ex6_grupo.codigo_origem`).
- **Mescla não destrutiva (20).** `adotar:` agora MESCLA: coluna vazia no destino recebe a da origem; conflito mantém o
  destino e guarda o valor da origem em `historico_mescla_migracao` (banco do cliente; pendência baixa
  `mescla_conflito_origem_guardada`, sem valor). Contadores `mescla_preenchidas`, `mescla_conflitos`.

## (f) Sobra da rodada 4: chave composta com componente encadeado
`ref:T(COL>U>X,C2)`: o componente `COL>U>X` toma a coluna COL desta linha, vai a U pela chave e usa a coluna X do pai
(pode haver vários; cada um termina em coluna). Pai ausente no caminho: `pai_inexistente`. Para TBPACTHM (L8-03):

```
TBPACTHM  CON  pacote_item_incluso.item_faturavel_id  ref:TBTABTHM(CON>TBCONVEN>THM,THM)@item_faturavel_id
```

## Imagem do container
`conector/Dockerfile` instala `argon2-cffi==23.1.0` e `cryptography==43.0.3`; a etiqueta da imagem passou a levar o
resumo do Dockerfile (`sante-sgh-conector:dev-<resumo>`), para worktrees com Dockerfiles diferentes não se
reconstruírem uma à outra. `conector.sh` monta `catalogos/licenciados` e `db/espelho` e repassa
`PLATAFORMA_CHAVE_MESTRA`.
