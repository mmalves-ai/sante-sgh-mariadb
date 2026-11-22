# Relatório da conversão DFM → representação (M09)

Gerado por `./pnpm formularios:converter -- --hospital=pc` em 2026-10-21, sobre a cópia de dev
do estabelecimento (leitura somente leitura, uma transação curta por modelo). Só estrutura do formulário e
contagens: nenhuma resposta de paciente (`PREVOLPAC`, `PRCONTEVOL`) é lida. O legado continua dono da
definição (o layout muda no Delphi); a impressão digital de cada modelo detecta a mudança.

## Totais

| Medida | Valor |
|---|---|
| Modelos convertidos | 67 (com componente DFM: 64) |
| Vínculos (PRPADEVOL) | 2.832 (ativos 1.592, inativos preservados 1.240) |
| Componentes mapeados | 2.368 de 2.368 |
| Classes desconhecidas | 0 |
| Caracteres U+FFFD ou de byte CP1252 indefinido (0x81, 0x8D, 0x8F, 0x90, 0x9D) no DFM decodificado | 0 |
| Opções de escolha resolvidas por índice | 3.814 |
| Pendências de escolha | 218 |
| Expressões (habilitar + calcular) | 270 (146 + 124) |

## Componentes por classe

| Classe | Componentes |
|---|---|
| `TGroupBoxPep` | 253 |
| `TfRespTexto` | 313 |
| `TfRespData` | 283 |
| `TfRespHora` | 16 |
| `TfRespComboBox` | 369 |
| `TfRespComboTexto` | 100 |
| `TfRespCheckListBox` | 394 |
| `TfRespEdit` | 108 |
| `TfRespEditUnidade` | 503 |
| `TfRespColunas` | 10 |
| `TfRespCid` | 12 |
| `TfRespMultiploCid` | 1 |
| `TfRespAlergia` | 6 |

## Expressões por padrão (ref 04 §3.3; tradução no M22)

| Padrão | Expressões |
|---|---|
| habilitar-por-resposta | 146 |
| dias-desde-data | 95 |
| dose-vasoativa | 14 |
| escore-soma | 4 |
| classificacao-faixa | 3 |
| antropometria | 4 |
| vazia | 4 |
| outro | 0 |

## Pendências por tipo

| Tipo | Quantidade |
|---|---|
| escolha | 218 |
| pai-ausente | 3 |

## Modelos

| ID | Código | Arquivo | Vínculos (inativos) | Componentes | Escolhas pendentes | Expressões | Versões do layout | Impressão do layout |
|---|---|---|---|---|---|---|---|---|
| 1 | MED01 | `med01.json` | 2 (0) | 2/2 | 0 | 0 | 0 | `8e1544f9138df0e5` |
| 2 | MED02 | `med02.json` | 3 (0) | 3/3 | 0 | 0 | 0 | `9326bfa58ebfd430` |
| 3 | MED03 | `med03.json` | 163 (57) | 147/147 | 0 | 80 | 0 | `5847bf5e423e8e78` |
| 4 | MED04 | `med04.json` | 149 (43) | 147/147 | 0 | 78 | 0 | `3c4599bd9f794bd8` |
| 5 | MED05 | `med05.json` | 21 (1) | 20/20 | 0 | 1 | 0 | `7443451e9453be28` |
| 6 | MED06 | `med06.json` | 64 (21) | 63/63 | 0 | 29 | 0 | `7c9a995b3ec16713` |
| 7 | ENF01 | `enf01.json` | 6 (2) | 5/5 | 0 | 0 | 0 | `d388ae14eb54ceb0` |
| 8 | ENF03 | `enf03.json` | 12 (2) | 12/12 | 0 | 0 | 0 | `92fae5d2e8606223` |
| 9 | ENF02 | `enf02.json` | 77 (13) | 64/64 | 0 | 2 | 0 | `7bb58d05278ec678` |
| 10 | ENF04 | `enf04.json` | 111 (51) | 87/87 | 0 | 12 | 0 | `e1d3ff3f1d4ca686` |
| 11 | ENF05 | `enf05.json` | 18 (2) | 16/16 | 0 | 2 | 0 | `8211d07ec5d17789` |
| 12 | ENF06 | `enf06.json` | 89 (6) | 86/86 | 0 | 0 | 0 | `898218d6f78d1691` |
| 13 | ENF07 | `enf07.json` | 92 (37) | 55/55 | 0 | 0 | 0 | `4b23e300c7b070a9` |
| 14 | ENF08 | `enf08.json` | 20 (1) | 20/20 | 0 | 0 | 0 | `5b2931e8b7f235c5` |
| 15 | ENF09 | `enf09.json` | 23 (4) | 21/21 | 0 | 0 | 0 | `e0a07274c284779a` |
| 16 | MED07 | `med07.json` | 88 (30) | 84/84 | 0 | 34 | 0 | `ef06011ade0080fb` |
| 17 | NUT01 | `nut01.json` | 68 (36) | 57/57 | 0 | 4 | 0 | `b93229c9702e95b9` |
| 18 | MED08 | `med08.json` | 18 (10) | 18/18 | 0 | 0 | 0 | `17e985ee7ca064a5` |
| 19 | MED09 | `med09.json` | 9 (4) | 9/9 | 17 | 0 | 0 | `29c6cfb0e98e138a` |
| 20 | MED10 | `med10.json` | 4 (0) | 4/4 | 0 | 0 | 0 | `550bd0c81bff460c` |
| 21 | MED11 | `med11.json` | 12 (9) | 8/8 | 17 | 0 | 0 | `4ea3621a68548217` |
| 22 | FISIO02 | `fisio02.json` | 57 (32) | 34/34 | 23 | 0 | 0 | `a1cadd798aa97c7c` |
| 23 | FISIO01 | `fisio01.json` | 128 (54) | 79/79 | 11 | 1 | 0 | `a64dfaf433c6fd91` |
| 24 | MED12 | `med12.json` | 15 (5) | 14/14 | 0 | 0 | 0 | `35885702a45e7303` |
| 25 | MED13 | `med13.json` | 36 (28) | 36/36 | 2 | 0 | 0 | `0a6c67dbe682e10e` |
| 26 | MED14 | `med14.json` | 8 (0) | 0/0 | 0 | 0 | 0 | `e3b0c44298fc1c14` |
| 27 | MED15 | `med15.json` | 8 (2) | 7/7 | 0 | 0 | 0 | `cb58cd5871c75a96` |
| 28 | SEPSE | `sepse.json` | 2 (2) | 0/0 | 0 | 0 | 0 | `e3b0c44298fc1c14` |
| 29 | ENF10 | `enf10.json` | 18 (0) | 18/18 | 0 | 0 | 0 | `d9cf88da4d10392d` |
| 30 | MED16 | `med16.json` | 11 (0) | 11/11 | 0 | 0 | 0 | `c4256c3120ac62c1` |
| 31 | MED17 | `med17.json` | 16 (3) | 13/13 | 0 | 0 | 0 | `698131b19b8e6006` |
| 32 | MED18 | `med18.json` | 17 (1) | 16/16 | 0 | 0 | 0 | `6797c40dcd50d3f8` |
| 33 | MED19 | `med19.json` | 16 (1) | 15/15 | 0 | 1 | 0 | `40c2c23d3cb50605` |
| 34 | ENF021 | `enf021.json` | 77 (67) | 64/64 | 30 | 2 | 0 | `5c081adbc60c9956` |
| 35 | ENF041 | `enf041.json` | 206 (94) | 179/179 | 22 | 12 | 0 | `f1a29191aa6ba442` |
| 36 | ENF091 | `enf091.json` | 28 (16) | 25/25 | 22 | 0 | 0 | `12b155511eaa681c` |
| 37 | MORSE | `morse.json` | 8 (0) | 8/8 | 0 | 0 | 0 | `7a74bf6435c40aba` |
| 38 | EVAM | `evam.json` | 7 (0) | 7/7 | 0 | 0 | 0 | `9b38ad1a6397437d` |
| 39 | ACOL | `acol.json` | 11 (0) | 11/11 | 0 | 0 | 0 | `6dd8616ee2757cdf` |
| 40 | EVOFON | `evofon.json` | 2 (0) | 2/2 | 0 | 0 | 0 | `1606bc497caa6b25` |
| 41 | FISIUTI | `fisiuti.json` | 106 (60) | 48/48 | 0 | 0 | 0 | `d65be5b05cc953d7` |
| 42 | AVALFISI | `avalfisi.json` | 7 (1) | 7/7 | 0 | 0 | 1 | `4a0eae32534c3bfd` |
| 43 | INTEFISI | `intefisi.json` | 2 (0) | 2/2 | 0 | 0 | 0 | `86a52e9a6523cb07` |
| 44 | M5 | `m5.json` | 105 (80) | 88/88 | 0 | 0 | 1 | `aea4a220a4aad615` |
| 45 | M8 | `m8.json` | 16 (1) | 13/13 | 0 | 0 | 0 | `3462afc3ae672d73` |
| 46 | M9 | `m9.json` | 28 (21) | 7/7 | 0 | 0 | 0 | `988fe4967f7b1172` |
| 47 | M11 | `m11.json` | 3 (1) | 2/2 | 0 | 0 | 0 | `06f40a711cdbd782` |
| 48 | M10 | `m10.json` | 8 (0) | 8/8 | 0 | 0 | 0 | `f4894da66dbeb5e4` |
| 49 | M101 | `m101.json` | 32 (1) | 31/31 | 0 | 0 | 0 | `b77d7850301b98a4` |
| 50 | E08 | `e08.json` | 25 (11) | 14/14 | 0 | 0 | 0 | `e76e73d936e53287` |
| 51 | M12 | `m12.json` | 96 (48) | 92/92 | 16 | 0 | 0 | `9e47850b65b12147` |
| 52 | AMBRIS | `ambris.json` | 2 (0) | 2/2 | 0 | 0 | 0 | `870ebccb57426287` |
| 53 | ENF0411 | `enf0411.json` | 209 (196) | 183/183 | 22 | 12 | 0 | `79c037538a60d4fd` |
| 54 | FISAND | `fisand.json` | 122 (99) | 62/62 | 4 | 0 | 0 | `4328f2a7eee84721` |
| 55 | REME | `reme.json` | 2 (0) | 2/2 | 0 | 0 | 1 | `a84c4949cc3f6bfd` |
| 56 | PRDM | `prdm.json` | 5 (0) | 5/5 | 0 | 0 | 1 | `c9edc8a2759db99e` |
| 57 | LAHI | `lahi.json` | 10 (1) | 9/9 | 0 | 0 | 1 | `446f2dacdfe7539c` |
| 58 | SUMALTA999 | `sumalta999.json` | 0 (0) | 0/0 | 0 | 0 | 0 | `e3b0c44298fc1c14` |
| 59 | ENF061 | `enf061.json` | 89 (6) | 89/89 | 7 | 0 | 1 | `4b560abeaad0a108` |
| 60 | ENF29 | `enf29.json` | 89 (2) | 89/89 | 25 | 0 | 0 | `19ab125a55ee84e5` |
| 61 | PRIN | `prin.json` | 14 (2) | 14/14 | 0 | 0 | 3 | `9e6ab01c7d45096a` |
| 62 | ENF33 | `enf33.json` | 2 (0) | 2/2 | 0 | 0 | 1 | `523e10ba20cc1c4f` |
| 63 | PSIC01 | `psic01.json` | 26 (1) | 26/26 | 0 | 0 | 2 | `c4e46620e84ce982` |
| 64 | PSIC02 | `psic02.json` | 2 (0) | 2/2 | 0 | 0 | 1 | `5f163ec5e928c753` |
| 65 | PBRAD | `pbrad.json` | 3 (1) | 2/2 | 0 | 0 | 0 | `1cbf4ec49cb8734e` |
| 66 | EMCTI | `emcti.json` | 7 (3) | 4/4 | 0 | 0 | 1 | `f7634f74ab9938ba` |
| 67 | M51 | `m51.json` | 102 (71) | 98/98 | 0 | 0 | 1 | `f6edc81d11e95539` |

## Pendências de escolha (para o M22 e a conferência das áreas donas)

Cada linha é um índice que o parser não resolveu com segurança pela lista `Items` do DFM, pelo
`ID_RESPOSTA` do combo oculto ou por `PRRESPOSTA.ORDEM`. Nada foi adivinhado: a opção fica fora da
representação até a conferência.

| Modelo | Código | linkId | Índice | Rótulo | Motivo | Resposta com o mesmo rótulo (sugestão) |
|---|---|---|---|---|---|---|
| 19 | MED09 | 01.00 | 1 | Cardiologia | ID_RESPOSTA do DFM não pertence à pergunta | 1037 |
| 19 | MED09 | 01.00 | 2 | Cirurgia Bucomaxilofacial | ID_RESPOSTA do DFM não pertence à pergunta | 1038 |
| 19 | MED09 | 01.00 | 3 | Cirurgia Cardíaca | ID_RESPOSTA do DFM não pertence à pergunta | 1039 |
| 19 | MED09 | 01.00 | 4 | Cirurgia Geral | ID_RESPOSTA do DFM não pertence à pergunta | 1040 |
| 19 | MED09 | 01.00 | 5 | Cirurgia Plástica | ID_RESPOSTA do DFM não pertence à pergunta | 1041 |
| 19 | MED09 | 01.00 | 6 | Cirurgia Torácica | ID_RESPOSTA do DFM não pertence à pergunta | 1042 |
| 19 | MED09 | 01.00 | 7 | Cirurgia Vascular | ID_RESPOSTA do DFM não pertence à pergunta | 1043 |
| 19 | MED09 | 01.00 | 8 | Dermatologia | ID_RESPOSTA do DFM não pertence à pergunta | 1044 |
| 19 | MED09 | 01.00 | 9 | Endocrinologia | ID_RESPOSTA do DFM não pertence à pergunta | 1045 |
| 19 | MED09 | 01.00 | 10 | Hematologia | ID_RESPOSTA do DFM não pertence à pergunta | 1046 |
| 19 | MED09 | 01.00 | 11 | Neurologia | ID_RESPOSTA do DFM não pertence à pergunta | 1047 |
| 19 | MED09 | 01.00 | 12 | Ortopedia | ID_RESPOSTA do DFM não pertence à pergunta | 1048 |
| 19 | MED09 | 01.00 | 13 | Pneumologia | ID_RESPOSTA do DFM não pertence à pergunta | 1049 |
| 19 | MED09 | 01.00 | 14 | Reumatologia | ID_RESPOSTA do DFM não pertence à pergunta | 1050 |
| 19 | MED09 | 01.00 | 15 | Urologia | ID_RESPOSTA do DFM não pertence à pergunta | 1051 |
| 19 | MED09 | 01.00 | 16 | Infectologia | ID_RESPOSTA do DFM não pertence à pergunta | 1052 |
| 19 | MED09 | 01.00 | 17 | Nefrologia | ID_RESPOSTA do DFM não pertence à pergunta | 1053 |
| 21 | MED11 | 01.00 | 1 | Cardiologia | ID_RESPOSTA do DFM não pertence à pergunta | 1072 |
| 21 | MED11 | 01.00 | 2 | Cirurgia Bucomaxilofacial | ID_RESPOSTA do DFM não pertence à pergunta | 1073 |
| 21 | MED11 | 01.00 | 3 | Cirurgia Cardíaca | ID_RESPOSTA do DFM não pertence à pergunta | 1074 |
| 21 | MED11 | 01.00 | 4 | Cirurgia Geral | ID_RESPOSTA do DFM não pertence à pergunta | 1075 |
| 21 | MED11 | 01.00 | 5 | Cirurgia Plástica | ID_RESPOSTA do DFM não pertence à pergunta | 1076 |
| 21 | MED11 | 01.00 | 6 | Cirurgia Torácica | ID_RESPOSTA do DFM não pertence à pergunta | 1077 |
| 21 | MED11 | 01.00 | 7 | Cirurgia Vascular | ID_RESPOSTA do DFM não pertence à pergunta | 1078 |
| 21 | MED11 | 01.00 | 8 | Dermatologia | ID_RESPOSTA do DFM não pertence à pergunta | 1079 |
| 21 | MED11 | 01.00 | 9 | Endocrinologia | ID_RESPOSTA do DFM não pertence à pergunta | 1080 |
| 21 | MED11 | 01.00 | 10 | Hematologia | ID_RESPOSTA do DFM não pertence à pergunta | 1081 |
| 21 | MED11 | 01.00 | 11 | Neurologia | ID_RESPOSTA do DFM não pertence à pergunta | 1082 |
| 21 | MED11 | 01.00 | 12 | Ortopedia | ID_RESPOSTA do DFM não pertence à pergunta | 1083 |
| 21 | MED11 | 01.00 | 13 | Pneumologia | ID_RESPOSTA do DFM não pertence à pergunta | 1084 |
| 21 | MED11 | 01.00 | 14 | Reumatologia | ID_RESPOSTA do DFM não pertence à pergunta | 1085 |
| 21 | MED11 | 01.00 | 15 | Urologia | ID_RESPOSTA do DFM não pertence à pergunta | 1086 |
| 21 | MED11 | 01.00 | 16 | Infectologia | ID_RESPOSTA do DFM não pertence à pergunta | 1087 |
| 21 | MED11 | 01.00 | 17 | Nefrologia | ID_RESPOSTA do DFM não pertence à pergunta | 1088 |
| 22 | FISIO02 | 01.07 | 1 | Seca | ID_RESPOSTA do DFM não pertence à pergunta | 1181 |
| 22 | FISIO02 | 01.07 | 2 | Produtiva | ID_RESPOSTA do DFM não pertence à pergunta | 1182 |
| 22 | FISIO02 | 01.07 | 3 | Eficaz | ID_RESPOSTA do DFM não pertence à pergunta | 1183 |
| 22 | FISIO02 | 01.07 | 4 | Ineficaz | ID_RESPOSTA do DFM não pertence à pergunta | 1184 |
| 22 | FISIO02 | 01.07 | 5 | Deglutinação | ID_RESPOSTA do DFM não pertence à pergunta | 1185 |
| 22 | FISIO02 | 01.07 | 6 | Expectoração | ID_RESPOSTA do DFM não pertence à pergunta | 1186 |
| 22 | FISIO02 | 01.07 | 7 | Aspiração | ID_RESPOSTA do DFM não pertence à pergunta | 1180 |
| 22 | FISIO02 | 01.13 | 0 | Manobras Desebstrutivas | ID_RESPOSTA do DFM não pertence à pergunta | 1222 |
| 22 | FISIO02 | 01.13 | 1 | CNT motora passiva | ID_RESPOSTA do DFM não pertence à pergunta | 1223 |
| 22 | FISIO02 | 01.13 | 2 | CNT motora ativa-assistida | ID_RESPOSTA do DFM não pertence à pergunta | 1224 |
| 22 | FISIO02 | 01.13 | 3 | Estímulo á tosse | ID_RESPOSTA do DFM não pertence à pergunta | — |
| 22 | FISIO02 | 01.13 | 4 | CNT motora ativa livre | ID_RESPOSTA do DFM não pertence à pergunta | 1226 |
| 22 | FISIO02 | 01.13 | 5 | Fortalecimento muscular | ID_RESPOSTA do DFM não pertence à pergunta | 1227 |
| 22 | FISIO02 | 01.13 | 6 | Manobras reexpansivas | ID_RESPOSTA do DFM não pertence à pergunta | — |
| 22 | FISIO02 | 01.13 | 7 | Sentado beira leito | ID_RESPOSTA do DFM não pertence à pergunta | 1229 |
| 22 | FISIO02 | 01.13 | 8 | Sentado no leito | ID_RESPOSTA do DFM não pertence à pergunta | 1230 |
| 22 | FISIO02 | 01.13 | 9 | Sentado fora do leito | ID_RESPOSTA do DFM não pertence à pergunta | 1231 |
| 22 | FISIO02 | 01.13 | 10 | Incentivador inspiratório a fluxo | ID_RESPOSTA do DFM não pertence à pergunta | 1232 |
| 22 | FISIO02 | 01.13 | 11 | Postura ortostática | ID_RESPOSTA do DFM não pertence à pergunta | 1233 |
| 22 | FISIO02 | 01.13 | 12 | Deambulação | ID_RESPOSTA do DFM não pertence à pergunta | 1234 |
| 22 | FISIO02 | 01.13 | 13 | Adeq.postural no leito | ID_RESPOSTA do DFM não pertence à pergunta | 1235 |
| 22 | FISIO02 | 01.13 | 14 | VNI | ID_RESPOSTA do DFM não pertence à pergunta | 1221 |
| 22 | FISIO02 | 01.13 | 15 | Outros | ID_RESPOSTA do DFM não pertence à pergunta | 1220 |
| 23 | FISIO01 | 01.01 | 1 | Diurno | ID_RESPOSTA do DFM não pertence à pergunta | 1258 |
| 23 | FISIO01 | 01.01 | 2 | Noturno | ID_RESPOSTA do DFM não pertence à pergunta | 1259 |
| 23 | FISIO01 | 01.12.08 | 0 | Ausente | ID_RESPOSTA do DFM não pertence à pergunta | 1415 |
| 23 | FISIO01 | 01.12.08 | 1 | Seca | ID_RESPOSTA do DFM não pertence à pergunta | 1417 |
| 23 | FISIO01 | 01.12.08 | 2 | Produtiva | ID_RESPOSTA do DFM não pertence à pergunta | 1418 |
| 23 | FISIO01 | 01.12.08 | 3 | Eficaz | ID_RESPOSTA do DFM não pertence à pergunta | 1419 |
| 23 | FISIO01 | 01.12.08 | 4 | Ineficaz | ID_RESPOSTA do DFM não pertence à pergunta | 1420 |
| 23 | FISIO01 | 01.12.08 | 5 | Deglutinação | ID_RESPOSTA do DFM não pertence à pergunta | 1421 |
| 23 | FISIO01 | 01.12.08 | 7 | Aspiração | ID_RESPOSTA do DFM não pertence à pergunta | 1416 |
| 23 | FISIO01 | 01.19 | 1 | Diurno | ID_RESPOSTA do DFM não pertence à pergunta | 1258 |
| 23 | FISIO01 | 01.19 | 2 | Noturno | ID_RESPOSTA do DFM não pertence à pergunta | 1259 |
| 25 | MED13 | 01.02 | 5 | Fratura de tronozelo | rótulo do DFM diferente do cadastro da resposta (PRCADRESP) | — |
| 25 | MED13 | 01.02 | 7 | Fratura do plator tibial | rótulo do DFM diferente do cadastro da resposta (PRCADRESP) | — |
| 34 | ENF021 | 01.02.01.07 | 0 | Edema | ID_RESPOSTA do DFM não pertence à pergunta | 1909 |
| 34 | ENF021 | 01.02.01.07 | 1 | Eritema | ID_RESPOSTA do DFM não pertence à pergunta | 1908 |
| 34 | ENF021 | 01.02.01.10 | 1 | Presente | ID_RESPOSTA do DFM não pertence à pergunta | 1927 |
| 34 | ENF021 | 01.02.01.10 | 2 | Ausente | ID_RESPOSTA do DFM não pertence à pergunta | 1928 |
| 34 | ENF021 | 01.02.02.07 | 0 | Edema | ID_RESPOSTA do DFM não pertence à pergunta | 1909 |
| 34 | ENF021 | 01.02.02.07 | 1 | Eritema | ID_RESPOSTA do DFM não pertence à pergunta | 1908 |
| 34 | ENF021 | 01.02.02.10 | 1 | Presente | ID_RESPOSTA do DFM não pertence à pergunta | 1927 |
| 34 | ENF021 | 01.02.02.10 | 2 | Ausente | ID_RESPOSTA do DFM não pertence à pergunta | 1928 |
| 34 | ENF021 | 01.02.03.07 | 0 | Edema | ID_RESPOSTA do DFM não pertence à pergunta | 1909 |
| 34 | ENF021 | 01.02.03.07 | 1 | Eritema | ID_RESPOSTA do DFM não pertence à pergunta | 1908 |
| 34 | ENF021 | 01.02.03.10 | 1 | Presente | ID_RESPOSTA do DFM não pertence à pergunta | 1927 |
| 34 | ENF021 | 01.02.03.10 | 2 | Ausente | ID_RESPOSTA do DFM não pertence à pergunta | 1928 |
| 34 | ENF021 | 01.04 | 0 | Soro Fisiológico 10ml | ID_RESPOSTA do DFM não pertence à pergunta | 1963 |
| 34 | ENF021 | 01.04 | 1 | Soro Fisiológico 100ml | ID_RESPOSTA do DFM não pertence à pergunta | 1964 |
| 34 | ENF021 | 01.04 | 2 | Gaze (Pacote com 10 unidades) | ID_RESPOSTA do DFM não pertence à pergunta | 1965 |
| 34 | ENF021 | 01.04 | 3 | ISOBEC | ID_RESPOSTA do DFM não pertence à pergunta | 1966 |
| 34 | ENF021 | 01.04 | 4 | Luva de procedimento (par) | ID_RESPOSTA do DFM não pertence à pergunta | 1967 |
| 34 | ENF021 | 01.04 | 5 | Luva estéril (par) | ID_RESPOSTA do DFM não pertence à pergunta | 1968 |
| 34 | ENF021 | 01.04 | 6 | Esparadrapo comum | ID_RESPOSTA do DFM não pertence à pergunta | 1969 |
| 34 | ENF021 | 01.04 | 7 | Esparadrapo antialérgico | ID_RESPOSTA do DFM não pertence à pergunta | 1970 |
| 34 | ENF021 | 01.04 | 8 | Atadura 10cm | ID_RESPOSTA do DFM não pertence à pergunta | 1971 |
| 34 | ENF021 | 01.04 | 9 | Atadura 15cm | ID_RESPOSTA do DFM não pertence à pergunta | 1972 |
| 34 | ENF021 | 01.04 | 10 | Atadura 20cm | ID_RESPOSTA do DFM não pertence à pergunta | 1973 |
| 34 | ENF021 | 01.04 | 11 | Colagenase | ID_RESPOSTA do DFM não pertence à pergunta | 1974 |
| 34 | ENF021 | 01.04 | 12 | Sulfadiazina de prata | ID_RESPOSTA do DFM não pertence à pergunta | 1975 |
| 34 | ENF021 | 01.04 | 13 | Lâmina de bisturi | ID_RESPOSTA do DFM não pertence à pergunta | 1976 |
| 34 | ENF021 | 01.04 | 14 | Agulha 40x12 | ID_RESPOSTA do DFM não pertence à pergunta | 1977 |
| 34 | ENF021 | 01.04 | 15 | Transofix | ID_RESPOSTA do DFM não pertence à pergunta | 1978 |
| 34 | ENF021 | 01.04 | 16 | Alcool 70% | ID_RESPOSTA do DFM não pertence à pergunta | 1979 |
| 34 | ENF021 | 01.04 | 17 | Outro | ID_RESPOSTA do DFM não pertence à pergunta | 1962 |
| 35 | ENF041 | 01.15 | 0 | Ancoron | ID_RESPOSTA do DFM não pertence à pergunta | 2059 |
| 35 | ENF041 | 01.15 | 1 | Heparina | ID_RESPOSTA do DFM não pertence à pergunta | 2060 |
| 35 | ENF041 | 01.15 | 2 | Tridil | ID_RESPOSTA do DFM não pertence à pergunta | 2061 |
| 35 | ENF041 | 01.15 | 3 | Nipride | ID_RESPOSTA do DFM não pertence à pergunta | 2062 |
| 35 | ENF041 | 01.15 | 4 | Noradrenalina | ID_RESPOSTA do DFM não pertence à pergunta | 2063 |
| 35 | ENF041 | 01.15 | 5 | Dopamina | ID_RESPOSTA do DFM não pertence à pergunta | 2064 |
| 35 | ENF041 | 01.15 | 6 | Midazolan | ID_RESPOSTA do DFM não pertence à pergunta | 2065 |
| 35 | ENF041 | 01.15 | 7 | Hidratação venosa | ID_RESPOSTA do DFM não pertence à pergunta | 2066 |
| 35 | ENF041 | 01.15 | 8 | Fentanil | ID_RESPOSTA do DFM não pertence à pergunta | 2067 |
| 35 | ENF041 | 01.15 | 9 | Diazepan | ID_RESPOSTA do DFM não pertence à pergunta | 2068 |
| 35 | ENF041 | 01.15 | 10 | Outros | ID_RESPOSTA do DFM não pertence à pergunta | 2058 |
| 35 | ENF041 | 01.16 | 0 | MMSS | ID_RESPOSTA do DFM não pertence à pergunta | 2106 |
| 35 | ENF041 | 01.16 | 1 | MMII | ID_RESPOSTA do DFM não pertence à pergunta | 2107 |
| 35 | ENF041 | 01.16 | 2 | Integro | ID_RESPOSTA do DFM não pertence à pergunta | 2108 |
| 35 | ENF041 | 01.16 | 3 | Edema | ID_RESPOSTA do DFM não pertence à pergunta | 2105 |
| 35 | ENF041 | 01.20 | 0 | Swab nasal | ID_RESPOSTA do DFM não pertence à pergunta | 2115 |
| 35 | ENF041 | 01.20 | 1 | Swab retal | ID_RESPOSTA do DFM não pertence à pergunta | 2116 |
| 35 | ENF041 | 01.20 | 2 | Secreção Traqueal | ID_RESPOSTA do DFM não pertence à pergunta | 2117 |
| 35 | ENF041 | 01.20 | 3 | Urina | ID_RESPOSTA do DFM não pertence à pergunta | 2118 |
| 35 | ENF041 | 01.20 | 4 | Ponta de cateter | ID_RESPOSTA do DFM não pertence à pergunta | 2119 |
| 35 | ENF041 | 01.20 | 5 | Hemocultura | ID_RESPOSTA do DFM não pertence à pergunta | 2120 |
| 35 | ENF041 | 01.20 | 6 | Outros | ID_RESPOSTA do DFM não pertence à pergunta | 2114 |
| 36 | ENF091 | 01.10 | 0 | Ancoron | ID_RESPOSTA do DFM não pertence à pergunta | 2256 |
| 36 | ENF091 | 01.10 | 1 | Dieta | ID_RESPOSTA do DFM não pertence à pergunta | 2266 |
| 36 | ENF091 | 01.10 | 11 | Outros | ID_RESPOSTA do DFM não pertence à pergunta | 2255 |
| 36 | ENF091 | 01.12 | 0 | VAS | ID_RESPOSTA do DFM não pertence à pergunta | 2249 |
| 36 | ENF091 | 01.12 | 1 | Traqueostomia | ID_RESPOSTA do DFM não pertence à pergunta | 2250 |
| 36 | ENF091 | 01.12 | 2 | TOT | ID_RESPOSTA do DFM não pertence à pergunta | 2248 |
| 36 | ENF091 | 01.14 | 0 | Equipo de bomba | ID_RESPOSTA do DFM não pertence à pergunta | 2278 |
| 36 | ENF091 | 01.14 | 1 | Equipo comum | ID_RESPOSTA do DFM não pertence à pergunta | 2279 |
| 36 | ENF091 | 01.14 | 2 | Equipo fotossensível | ID_RESPOSTA do DFM não pertence à pergunta | 2280 |
| 36 | ENF091 | 01.14 | 3 | Equipo de dieta | ID_RESPOSTA do DFM não pertence à pergunta | 2281 |
| 36 | ENF091 | 01.14 | 4 | Discofix | ID_RESPOSTA do DFM não pertence à pergunta | 2282 |
| 36 | ENF091 | 01.14 | 5 | Outro | ID_RESPOSTA do DFM não pertence à pergunta | 2277 |
| 36 | ENF091 | 01.14.01 | 0 | Diarréia | ID_RESPOSTA do DFM não pertence à pergunta | 2284 |
| 36 | ENF091 | 01.14.01 | 1 | Uso de diuréticos | ID_RESPOSTA do DFM não pertence à pergunta | 2285 |
| 36 | ENF091 | 01.14.01 | 2 | Lesão por pressão secretiva em região sacra ou trocanter | ID_RESPOSTA do DFM não pertence à pergunta | 2286 |
| 36 | ENF091 | 01.14.01 | 3 | Outros | ID_RESPOSTA do DFM não pertence à pergunta | 2283 |
| 36 | ENF091 | 01.15 | 0 | Equipo de bomba | ID_RESPOSTA do DFM não pertence à pergunta | 2278 |
| 36 | ENF091 | 01.15 | 1 | Equipo comum | ID_RESPOSTA do DFM não pertence à pergunta | 2279 |
| 36 | ENF091 | 01.15 | 2 | Equipo fotossensível | ID_RESPOSTA do DFM não pertence à pergunta | 2280 |
| 36 | ENF091 | 01.15 | 3 | Equipo de dieta | ID_RESPOSTA do DFM não pertence à pergunta | 2281 |
| 36 | ENF091 | 01.15 | 4 | Discofix | ID_RESPOSTA do DFM não pertence à pergunta | 2282 |
| 36 | ENF091 | 01.15 | 5 | Outro | ID_RESPOSTA do DFM não pertence à pergunta | 2277 |
| 51 | M12 | 01.02.03.01 | 0 | Abolido | ID_RESPOSTA do DFM não pertence à pergunta | 2759 |
| 51 | M12 | 01.02.03.01 | 1 | Audível | ID_RESPOSTA do DFM não pertence à pergunta | 2754 |
| 51 | M12 | 01.02.03.01 | 2 | Diminuído | ID_RESPOSTA do DFM não pertence à pergunta | 2755 |
| 51 | M12 | 01.02.03.01 | 3 | Roncos | ID_RESPOSTA do DFM não pertence à pergunta | 2756 |
| 51 | M12 | 01.02.03.01 | 4 | Sibilos | ID_RESPOSTA do DFM não pertence à pergunta | 2757 |
| 51 | M12 | 01.02.03.01 | 5 | Creptação | ID_RESPOSTA do DFM não pertence à pergunta | 2758 |
| 51 | M12 | 01.06 | 0 | HC | ID_RESPOSTA do DFM não pertence à pergunta | 2818 |
| 51 | M12 | 01.06 | 1 | Bioquímico | ID_RESPOSTA do DFM não pertence à pergunta | 2811 |
| 51 | M12 | 01.06 | 2 | Enzimas cardíacas | ID_RESPOSTA do DFM não pertence à pergunta | 2812 |
| 51 | M12 | 01.06 | 3 | EAS | ID_RESPOSTA do DFM não pertence à pergunta | 2813 |
| 51 | M12 | 01.06 | 4 | ECG | ID_RESPOSTA do DFM não pertence à pergunta | 2814 |
| 51 | M12 | 01.06 | 5 | Tomografia | ID_RESPOSTA do DFM não pertence à pergunta | 2815 |
| 51 | M12 | 01.06 | 6 | USG | ID_RESPOSTA do DFM não pertence à pergunta | 2816 |
| 51 | M12 | 01.06 | 7 | RX | ID_RESPOSTA do DFM não pertence à pergunta | 2817 |
| 51 | M12 | 01.07.01 | 0 | Antibiótico | ID_RESPOSTA do DFM não pertence à pergunta | 2822 |
| 51 | M12 | 01.07.01 | 1 | Atestado médico | ID_RESPOSTA do DFM não pertence à pergunta | 2821 |
| 53 | ENF0411 | 01.15 | 0 | Ancoron | ID_RESPOSTA do DFM não pertence à pergunta | 2916 |
| 53 | ENF0411 | 01.15 | 1 | Heparina | ID_RESPOSTA do DFM não pertence à pergunta | 2917 |
| 53 | ENF0411 | 01.15 | 2 | Tridil | ID_RESPOSTA do DFM não pertence à pergunta | 2918 |
| 53 | ENF0411 | 01.15 | 3 | Nipride | ID_RESPOSTA do DFM não pertence à pergunta | 2919 |
| 53 | ENF0411 | 01.15 | 4 | Noradrenalina | ID_RESPOSTA do DFM não pertence à pergunta | 2920 |
| 53 | ENF0411 | 01.15 | 5 | Dopamina | ID_RESPOSTA do DFM não pertence à pergunta | 2921 |
| 53 | ENF0411 | 01.15 | 6 | Midazolan | ID_RESPOSTA do DFM não pertence à pergunta | 2922 |
| 53 | ENF0411 | 01.15 | 7 | Hidratação venosa | ID_RESPOSTA do DFM não pertence à pergunta | 2923 |
| 53 | ENF0411 | 01.15 | 8 | Fentanil | ID_RESPOSTA do DFM não pertence à pergunta | 2924 |
| 53 | ENF0411 | 01.15 | 9 | Diazepan | ID_RESPOSTA do DFM não pertence à pergunta | 2925 |
| 53 | ENF0411 | 01.15 | 10 | Outros | ID_RESPOSTA do DFM não pertence à pergunta | 2915 |
| 53 | ENF0411 | 01.16 | 0 | MMSS | ID_RESPOSTA do DFM não pertence à pergunta | 2963 |
| 53 | ENF0411 | 01.16 | 1 | MMII | ID_RESPOSTA do DFM não pertence à pergunta | 2964 |
| 53 | ENF0411 | 01.16 | 2 | Integro | ID_RESPOSTA do DFM não pertence à pergunta | 2965 |
| 53 | ENF0411 | 01.16 | 3 | Edema | ID_RESPOSTA do DFM não pertence à pergunta | 2962 |
| 53 | ENF0411 | 01.20 | 0 | Swab nasal | ID_RESPOSTA do DFM não pertence à pergunta | 2972 |
| 53 | ENF0411 | 01.20 | 1 | Swab retal | ID_RESPOSTA do DFM não pertence à pergunta | 2973 |
| 53 | ENF0411 | 01.20 | 2 | Secreção Traqueal | ID_RESPOSTA do DFM não pertence à pergunta | 2974 |
| 53 | ENF0411 | 01.20 | 3 | Urina | ID_RESPOSTA do DFM não pertence à pergunta | 2975 |
| 53 | ENF0411 | 01.20 | 4 | Ponta de cateter | ID_RESPOSTA do DFM não pertence à pergunta | 2976 |
| 53 | ENF0411 | 01.20 | 5 | Hemocultura | ID_RESPOSTA do DFM não pertence à pergunta | 2977 |
| 53 | ENF0411 | 01.20 | 6 | Outros | ID_RESPOSTA do DFM não pertence à pergunta | 2971 |
| 54 | FISAND | 01.14 | 2 | I - Esboço de contração musc. sem movimento | ID_RESPOSTA do DFM não pertence à pergunta | 3112 |
| 54 | FISAND | 01.14 | 3 | II - Não Vence a gravidade | ID_RESPOSTA do DFM não pertence à pergunta | 3113 |
| 54 | FISAND | 01.14 | 4 | III - Consegue vencer a força da gravidade | ID_RESPOSTA do DFM não pertence à pergunta | 3110 |
| 54 | FISAND | 01.14 | 5 | IV - Movimentação livre sem resistência | ID_RESPOSTA do DFM não pertence à pergunta | 3111 |
| 59 | ENF061 | 01.06.02 | 1 | Dispnéia | ID_RESPOSTA do DFM não pertence à pergunta | 3238 |
| 59 | ENF061 | 01.06.02 | 2 | Excursão torácica alterada | ID_RESPOSTA do DFM não pertence à pergunta | 3239 |
| 59 | ENF061 | 01.06.02 | 3 | Padrão respiratório anormal | ID_RESPOSTA do DFM não pertence à pergunta | 3240 |
| 59 | ENF061 | 01.17.02 | 1 | Agente farmacológico | ID_RESPOSTA do DFM não pertence à pergunta | 3360 |
| 59 | ENF061 | 01.17.02 | 2 | Alteração na taxa metabólica | ID_RESPOSTA do DFM não pertence à pergunta | 3361 |
| 59 | ENF061 | 01.17.02 | 3 | Condição que afeta a regulação da temperatura | ID_RESPOSTA do DFM não pertence à pergunta | 3362 |
| 59 | ENF061 | 01.17.02 | 4 | Desidratação | ID_RESPOSTA do DFM não pertence à pergunta | 3363 |
| 60 | ENF29 | 01.02.17.02 | 2 | Alteração na taxa metabólica | ID_RESPOSTA do DFM não pertence à pergunta | 3616 |
| 60 | ENF29 | 01.02.17.02 | 3 | Condição que afeta a regulação da temperatura | ID_RESPOSTA do DFM não pertence à pergunta | 3617 |
| 60 | ENF29 | 01.02.17.02 | 4 | Desidratação | ID_RESPOSTA do DFM não pertence à pergunta | 3618 |
| 60 | ENF29 | 01.02.17.02 | 0 | Extremos de idade | ID_RESPOSTA do DFM não pertence à pergunta | 3622 |
| 60 | ENF29 | 01.02.17.02 | 1 | Desidratação | ID_RESPOSTA do DFM não pertence à pergunta | 3623 |
| 60 | ENF29 | 01.02.17.02 | 3 | Alteração na taxa metabólica | ID_RESPOSTA do DFM não pertence à pergunta | 3625 |
| 60 | ENF29 | 01.02.17.02 | 4 | Condição que afeta a regulação da temperatura | ID_RESPOSTA do DFM não pertence à pergunta | 3626 |
| 60 | ENF29 | 01.02.17.02 | 5 | Lesão encefálica grave | ID_RESPOSTA do DFM não pertence à pergunta | 3627 |
| 60 | ENF29 | 01.02.17.02 | 6 | Sedação | ID_RESPOSTA do DFM não pertence à pergunta | 3628 |
| 60 | ENF29 | 01.02.17.02 | 7 | Sepse | ID_RESPOSTA do DFM não pertence à pergunta | 3629 |
| 60 | ENF29 | 01.02.17.02 | 8 | Procedimento invasivo | ID_RESPOSTA do DFM não pertence à pergunta | 3630 |
| 60 | ENF29 | 01.02.17.02 | 9 | Enfermidades crônicas | ID_RESPOSTA do DFM não pertence à pergunta | 3631 |
| 60 | ENF29 | 01.02.17.02 | 10 | Desnutrição | ID_RESPOSTA do DFM não pertence à pergunta | 3632 |
| 60 | ENF29 | 01.02.17.02 | 11 | Alteração na integridade da pele | ID_RESPOSTA do DFM não pertence à pergunta | 3633 |
| 60 | ENF29 | 01.02.21.02 | 0 | Extremos de idade | ID_RESPOSTA do DFM não pertence à pergunta | 3622 |
| 60 | ENF29 | 01.02.21.02 | 1 | Desidratação | ID_RESPOSTA do DFM não pertence à pergunta | 3623 |
| 60 | ENF29 | 01.02.21.02 | 3 | Alteração na taxa metabólica | ID_RESPOSTA do DFM não pertence à pergunta | 3625 |
| 60 | ENF29 | 01.02.21.02 | 4 | Condição que afeta a regulação da temperatura | ID_RESPOSTA do DFM não pertence à pergunta | 3626 |
| 60 | ENF29 | 01.02.21.02 | 5 | Lesão encefálica grave | ID_RESPOSTA do DFM não pertence à pergunta | 3627 |
| 60 | ENF29 | 01.02.21.02 | 6 | Sedação | ID_RESPOSTA do DFM não pertence à pergunta | 3628 |
| 60 | ENF29 | 01.02.21.02 | 7 | Sepse | ID_RESPOSTA do DFM não pertence à pergunta | 3629 |
| 60 | ENF29 | 01.02.21.02 | 8 | Procedimento invasivo | ID_RESPOSTA do DFM não pertence à pergunta | 3630 |
| 60 | ENF29 | 01.02.21.02 | 9 | Enfermidades crônicas | ID_RESPOSTA do DFM não pertence à pergunta | 3631 |
| 60 | ENF29 | 01.02.21.02 | 10 | Desnutrição | ID_RESPOSTA do DFM não pertence à pergunta | 3632 |
| 60 | ENF29 | 01.02.21.02 | 11 | Alteração na integridade da pele | ID_RESPOSTA do DFM não pertence à pergunta | 3633 |

## Outras pendências

| Modelo | Tipo | linkId | Detalhe |
|---|---|---|---|
| 35 | pai-ausente | 26.16.01.01.01.01 | ordem sem item de nível acima; ficou na raiz |
| 44 | pai-ausente | 14.05 | ordem sem item de nível acima; ficou na raiz |
| 53 | pai-ausente | 26.16.01.01.01.01 | ordem sem item de nível acima; ficou na raiz |
