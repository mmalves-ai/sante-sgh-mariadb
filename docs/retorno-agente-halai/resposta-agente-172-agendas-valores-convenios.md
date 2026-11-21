# Resposta do agente de marcação da ProntoCardio (Hal-AI) ao pedido do sante-sgh

> Agendas, valores, convênios, subplanos, preparo e restrições: como o agente usa esses dados hoje.
> Respondido em 21/11/2026, com dados de **produção**.

## Antes de tudo: de onde vem esta resposta

- **Agente:** "Prontocardio 3.0", agente de canal da empresa ProntoCardio na Hal-AI, que atende pacientes no WhatsApp.
- **Instruções vigentes:** versão 2.9, publicada em **08/11/2026 às 21:06** (horário de Brasília), sem mudança desde então.
  As ferramentas foram atualizadas pela última vez em 02/11/2026. São 28 ao todo, incluindo as de cadastro de paciente.
- **Respostas reais:** saíram do histórico de conversas de **produção** de 16/11 a 21/11/2026, sem chamar a API de novo.
  Isso equivale a "chamar no máximo duas vezes": nenhuma chamada nova foi feita ao hospital.
- **Versão da API vista nessas respostas:** sante-api 0.30.x, com as observações da agenda expostas desde a v0.24.0 (31/10/2026).
- **Privacidade:** nenhum dado de paciente. Médicos viram "Médico A", "Médico B"…, e o CRM virou um número fictício
  (`90000xx`). A letra de um médico vale só dentro de cada exemplo: "Médico A" no item 2 não é necessariamente
  "Médico A" no item 7. Valores e nomes de convênio estão como vieram.
- Onde escrevo **"não sei"** ou **"não encontrado"**, procurei e não achei. Não completei com suposição.

---

## 1. Mapa de onde cada informação vem

Legenda: **[campo]** = campo próprio, estruturado. **[texto]** = dentro de observação livre. As observações são três e
vêm nas agendas de `api_get_consultas_catalogo` e `api_get_exames_catalogo`:

| nome na API | o que é (pela spec) | onde está no SGH |
|---|---|---|
| `observacao` | observação da agenda, "a que a recepção vê no SGH" | não diz (pelo histórico, nas consultas é `REAGENDA.OBS`) |
| `observacaoPortal` | observação do agendamento online | veio `null` nas 72 agendas medidas |
| `observacoesPorConvenio[]` | `{codigo, nome, observacao}`: texto de um convênio específico naquela agenda | observação do convênio na agenda |
| `observacaoTruncada` | só aparece, e só como `true`, quando o texto foi cortado | não apareceu em nenhuma resposta medida |

Não existe, hoje, observação do **exame** separada da observação da **agenda** de exame. Tudo o que é do exame
(preparo, valor, faixa etária) está na `observacao` da agenda de exame.

### a. Valor particular de consulta, por médico

- **Fonte principal: [campo]** `api_get_consultas_valor` → `itens[].valor` (número; ex.: `400`). O agente chama com
  `medico` = `medicoCadastro` vindo de `api_get_consultas_catalogo` (ou `api_get_medicos`) e `convenio` = o código do
  atendimento: 10 (PARTICULAR) quando é particular; quando o paciente tem plano, as instruções mandam repetir o código
  do plano "em toda chamada seguinte… conferência de valor", e aí a API responde `disponivel:false` (só há valor
  particular). Entre 16 e 21/11, 29 de 37 chamadas foram com 10 e 8 com código de convênio.
- **Também em [texto]**, na mesma agenda, em dois lugares:
  - `observacao` da agenda: linha "VALOR DA CONSULTA PARTICULAR: R$ …";
  - `observacoesPorConvenio[codigo=10 PARTICULAR].observacao`: o mesmo valor por extenso + forma de pagamento.
- **Valor de consulta por convênio: não existe.** A API responde `disponivel:false` com o motivo
  "Valor de consulta por convênio não é cadastrado no SGH (apenas particular)".
- Conferência feita em produção: em 12 de 12 médicos vistos nos dois lugares, o `itens[].valor` bate com o "R$" do
  texto (cruzado por CRM). Em 60 agendas de consulta, `observacao` e `observacoesPorConvenio[10]` nunca discordaram.

### b. Valor particular de exame

- **[campo]** `api_get_exames_valor` (`busca` = nome do procedimento, `convenio` = o código do atendimento, 10 no particular) → `itens[].valor` / `valorTotal`,
  com `componentes` (custo operacional, filme, anestesia, outros), `vigencia` (data do preço) e `situacao`. Vem da tabela
  de honorários do convênio. O casamento é por **nome do procedimento, aproximado**: pode vir mais de um item.
- **[texto]** `observacao` da agenda de exame e `observacoesPorConvenio[10].observacao`. É aqui que aparecem:
  - **parcelas** que a tabela não traz (ex.: colonoscopia "R$ 880,00 + R$ 200,00 (ANESTESISTA)"; na tabela,
    `anestesia: 0`);
  - **preço por subtipo** dentro de uma agenda que faz vários exames (ultrassom: 12 linhas de preço);
  - **unidade** ("POR MEMBRO" no doppler);
  - **forma de pagamento** ("SOMENTE EM DINHEIRO" × "DINHEIRO, CARTÃO DE DÉBITO, CRÉDITO E PIX").
- Há preço de **exame** dentro de agenda de **consulta** (otorrino: endoscopia nasossinusal e videolaringoscopia) e
  preço cobrado de paciente **de convênio** (bioimpedância na nutrição). Os dois estão só em [texto].

### c. Se o médico ou a agenda atende um convênio

- **Consulta: [campo]** `api_get_consultas_catalogo` com o parâmetro `convenio` → `consultas[].aceitaConvenio`
  (true/false). Sem o parâmetro, o campo não vem.
- **Exame: [campo]** `api_get_exames_cobertura` com `convenio` + `agenda` (nome exato) → `aceitoNaAgenda`. Os outros
  campos dessa resposta (`coberturaPorExame`, `permiteAtendimento`, `convenioAtende`) **não** são usados para dizer que
  o plano cobre ou não. A própria API avisa: "Cobertura por exame×convênio não está modelada no banco".
- **Conferência na gravação: [campo]** os POSTs de agendar/remarcar com `validarConvenio: true` devolvem
  409 `convenio_nao_aceito` com `conveniosAceitos` e `alternativas`, ou 409 `convenio_inativo`.
- **Convênio ativo: [campo]** `api_get_convenios` → `convenios[].ativo`.
- **Unimed:** a recusa ("não atendemos Unimed, inclusive consultas, exames e pronto atendimento") vem da **base de
  conhecimento do agente**, não da API.
- **Mas o [texto] restringe:** "CONVÊNIO SEM CREDENCIAMENTO: …" e "CONVÊNIOS COM CREDENCIAMENTO: …" na `observacao`.
  Se o texto exclui o convênio, o agente trata como não aceito, **mesmo com `aceitaConvenio`/`aceitoNaAgenda: true`**
  (ver item 3).

### d. Se atende um subplano específico (plano, categoria, acomodação)

- **Só [texto].** Não há campo. Vem de:
  - `observacoesPorConvenio[convênio do paciente].observacao` (ex.: `[340 ASSIM] NÃO ATENDEMOS SUBPLANO ASSIM A60`);
  - e da `observacao` geral da agenda (ex.: "CONVÊNIO SEM CREDENCIAMENTO: ASSIM A60 E SUL AMÉRICA TIPO DIRETO NACIONAL E EXTRA").
- Instrução literal do agente: "`aceitaConvenio: true` cobre só o convênio principal; qual plano ou subconvênio daquele
  convênio o médico atende, quem decide é o texto."
- Às vezes o "subplano" é um **código de convênio separado** em `api_get_convenios` (ex.: BRADESCO SAUDE INDIVIDUAL,
  EMPRESARIAL e OPERADORA são três códigos; SUL AMERICA INDIVIDUAL 310 e EMPRESARIAL 311). Nesse caso a escolha é
  feita pelo agente na lista de convênios, perguntando ao paciente quando mais de um servir.
- **Acomodação** (enfermaria/apartamento) e **categoria**: não encontrei em nenhum texto nem campo. Não sei se o
  hospital usa.

### e. Preparo e orientação do exame

- **Só [texto]**, na `observacao` da agenda de exame (`api_get_exames_catalogo`). Inclui jejum, medicamentos, o que
  levar, roupa, antecedência de chegada, local (loja 01/03 ou hospital) e acompanhante.
- Numa agenda que faz vários exames, o preparo vem **por subtipo** no mesmo texto (ultrassom: abdome, transvaginal,
  mamas, próstata…). O agente tem de achar o trecho do tipo pedido.
- Preparo preso a **turno** ("PARA REALIZAÇÃO DO EXAME NO TURNO DA (TARDE)") também é [texto].
- Na consulta, orientação do médico (o que levar, tipo de caso atendido) também é [texto] na `observacao`.

### f. Restrições

| restrição | onde está | observação |
|---|---|---|
| idade | **[texto]** linha "FAIXA ETÁRIA: …" na `observacao` | também solta, por subtipo ("Mamas: mulheres com mais de 40 anos…") |
| sexo | **não existe como restrição** | só aparece como orientação de preparo ("Mulher: não vir com sutiã de bojo") |
| "não atende retorno" | **não encontrado** em texto nem em campo | os POSTs aceitam `retorno: true`, mas o agente não usa (ver 1i) |
| "só primeira consulta" | **não encontrado** | — |
| encaixe | **não encontrado** | — |
| tipo de caso que o médico não atende | **[texto]** ("Não atende casos de depressão ou ansiedade…", "NÃO REALIZA CIRURGIA PLÁSTICA") | as instruções mandam repassar ao paciente o "tipo de atendimento"; não há regra escrita de filtro |
| antecedência mínima | **[texto]** ("SÓ PODERÁ SER AGENDADO COM NO MÍNIMO 7 (SETE DIAS) DE ANTECEDÊNCIA") | em geral amarrada a convênio |
| autorização prévia / guia / senha | **[texto]** na `observacao` ou em `observacoesPorConvenio` | em exame, leva o atendimento a um humano |
| marcação pela recepção | **[texto]** ("SOLICITAR MARCAÇÃO NA RECEPÇÃO", "PREENCHER DOIS HORÁRIOS") | em exame, leva o atendimento a um humano |

Em **exame**, as instruções mandam comparar a faixa etária do texto com a idade do cadastro (`api_get_pacientes`, data de
nascimento) ou perguntar ao paciente. Em consulta, a idade atendida é orientação a repassar; na prática o agente também
recusa a agenda fora da faixa (ver 6.12).

### g. Vigência e dias de atendimento

- **[campo]** `vigencia: {inicio, fim}` em `api_get_consultas_catalogo`, `api_get_exames_catalogo` e `api_get_medicos`.
  Desde a v0.23.0, é o primeiro e o último dia com horário na grade de agora em diante.
- **O agente NÃO usa a vigência para decidir data.** Instrução literal: "NUNCA use a vigência para montar a janela de
  busca … Horário que a disponibilidade devolveu é real: ofereça e agende, mesmo fora da vigência".
- **Dias e horários reais: [campo]** só de `api_get_consultas_disponibilidade` / `api_get_exames_disponibilidade`
  (`horarios[].data`, `diaSemana`, `hora`), por período de 30 dias ou mais.
- **[campo]** `proximaDisponibilidade`, `agendasSemVagaNaJanela` e `gradeAte` distinguem "sem vaga na janela" de "grade
  ainda não aberta".
- Em texto livre: **não encontrei** vigência, férias nem data de validade de preço ou regra.

### h. Duração ou intervalo da consulta

- **[campo]** `api_get_consultas_catalogo` → `consultas[].duracaoMin` (ex.: 5, 15).
- **O agente não usa esse campo** nem fala de duração ao paciente. Os horários já vêm prontos da disponibilidade.
- Para exame não há campo de duração. "Ocupar mais de um horário" aparece só em [texto], e leva a um humano.

### i. Outras regras lidas em texto e usadas

Todas em **[texto]**, na `observacao` (e às vezes em `observacoesPorConvenio`):

1. **se a agenda faz o TIPO de exame pedido** ("REALIZA ECODOPPLER VENOSO…"): uma agenda pode fazer vários;
2. **local de atendimento** ("LOJA DE ATENDIMENTO: LOJA 01", "O EXAME É REALIZADO NO HOSPITAL"): em exame, vai na ficha do agendamento;
3. **documentos e antecedência de chegada** ("TRAZER PEDIDO MÉDICO ORIGINAL, CARTEIRINHA … CHEGAR COM 30 MINUTOS");
4. **especialidade e escopo do médico** ("ESPECIALIDADE: PEQUENAS CIRURGIAS, FACE, HÉRNIA…");
5. **modo de marcação** ("ATENDE POR HORA MARCADA", "REALIZADO APENAS UMA VEZ AO MÊS");
6. **instrução para a recepção** (combinar endoscopia + colonoscopia, preencher dois horários): em exame, leva a um humano;
7. **encaminhamento exigido por convênio** ("PARA O CONVÊNIO CAPE SAÚDE, O PACIENTE DEVE TRAZER ENCAMINHAMENTO DO PSIQUIATRA");
8. **forma de pagamento** do particular;
9. **acompanhante obrigatório** após o exame (colonoscopia).

**Retorno:** o agente não marca "retorno" de forma diferente. O parâmetro `retorno` existe nos POSTs, mas as instruções
não o mencionam.

---

## 2. Formatos do texto livre

Copiados como vieram da API em produção (trechos; "..." marca corte), de 16/11 a 21/11/2026, só com o nome do médico trocado. `\n` virou quebra de linha.

### Valor particular

```
VALOR DA CONSULTA PARTICULAR: R$: 250,00
VALOR DA CONSULTA PARTICULAR: R$:250,00
VALOR DE CONSULTA PARTICULAR: R$ 300,00
```
(`observacao` de consulta: mesmo dado, grafias diferentes de "R$:" e "DA/DE")

```
VALOR DA CONSULTA PARTICULAR : R$250,00 ( DUZENTOS E CINQUENTA REAIS) - RECEBEMOS O PAGAMENTO SOMENTE EM DINHEIRO
VALOR DO EXAME PARTICULAR: R$ 220,00 ( DUZENTOS E VINTE REAIS ) - RECEBEMOS O PAGAMENTO EM DINHEIRO, CARTÃO DE DÉBITO, CRÉDITO E PIX
```
(`observacoesPorConvenio[10 PARTICULAR]`: por extenso, com forma de pagamento)

```
VALOR DO EXAME PARTICULAR: R$ 880,00 + R$ 200,00 ( ANESTESISTA )
QUANDO O EXAME FOR PARTICULAR É NECESSÁRIO PAGAR TAMBÉM O VALOR DO ANESTESISTA.
```
(colonoscopia, `observacao`: valor em parcelas)

```
VALOR DO ECODOPPLER VENOSO PARTICULAR: R$ 350,00 ( POR MEMBRO )
VALOR DO ECODOPPLER DE CAROTIDAS E VERTEBRAIS PARTICULAR : R$ 420,00
VALOR DO EXAME PARTICULAR ULTRASSOM DE TIREOIDE: R$ 180.00 ( CENTO E OITENTA REAIS )- RECEBEMOS O PAGAMENTO SOMENTE EM DINHEIRO
```
(tabela por procedimento, com unidade; e ponto no lugar da vírgula)

```
VALORES DOS EXAMES PARTICULAR :
Endoscopia nasossinusal R$ 210,00
Videolaringoscopia R$ 262,50
```
(preço de exame dentro de agenda de **consulta**: otorrino)

```
VALOR DA BIOIMPEDANCIA PARA PACIENTES DE CONVÊNIO: R$ 100,00
```
(valor cobrado de paciente **de convênio**: nutrição)

### Convênio aceito / recusado (lista no texto)

```
CONVÊNIO SEM CREDENCIAMENTO: SUL AMERICA , ASSIM SAUDE
CONVÊNIO SEM CREDENCIAMENTO: SULAMERICA, ASSIM A60
CONVÊNIOS SEM CREDENCIAMENTO: AMIL, ASSEFAZ, BRADESCO, CAPESESP, EMBRATEL E TELOS, GAMA SAÚDE, GEAP,INB, IPALERJ, MONDIAL, POSTAL SAÚDE,PETROBRÁS, SAMP, SOMPO/ MARÍTIMA, SUL AMÉRICA.
CONVÊNIOS COM CREDENCIAMENTO: CABERJ,CABERJ INTEGRAL,CAPE SAÚDE,IPALERJ,SAÚDE CAIXA
```
O mesmo convênio aparece escrito de vários jeitos ("SUL AMERICA", "SULAMERICA", "SUL AMÉRICA", "SULAMÉRICA"). Algumas
agendas trazem lista de **recusados**; outras, de **aceitos**. Os nomes do texto não são os nomes de `api_get_convenios`
("BRADESCO" no texto × "BRADESCO SAUDE INDIVIDUAL/EMPRESARIAL/OPERADORA" na lista).

### Subplano

```
[340 ASSIM]                    NÃO ATENDEMOS SUBPLANO ASSIM A60
[340 ASSIM]                    NÃO ATENDEMOS O SUBPLANO ASSIM A60
[311 SUL AMERICA EMPRESARIAL]  NÃO ATENDEMOS O SUBPLANO SUL AMERICA EMPRESARIAL DIRETO NACIONAL E SUL AMERICA EMPRESARIAL EXTRA
[310 SUL AMERICA INDIVIDUAL]   NÃO ATENDEMOS SUL AMERICA INDIVIDUAL DIRETO NACIONAL E SUL AMERICA INDIVIDUAL EXTRA
```
(`observacoesPorConvenio[codigo nome].observacao`; na mesma agenda, a `observacao` geral repete:
"CONVÊNIO SEM CREDENCIAMENTO: ASSIM A60, SUL AMÉRICA")

### Convênio aceito com condição

```
NECESSÁRIO SOLICITAR AUTORIZAÇÃO PRÉVIA
```
(`observacoesPorConvenio[620 SAUDE CAIXA]`)

```
PARA O CONVÊNIO SAÚDE CAIXA, A CONSULTA SÓ PODE DE SER MARCADA COM NO MÍNIMO 7 ( SETE DIAS ) DE ANTECEDÊNCIA,O PACIENTE DEVE ENVIAR O PEDIDO MÉDICO E CARTEIRINHA PELO WHATSAPP PARA AUTORIZAÇÃO.
PARA O CONVÊNIO CAPE SAÚDE, O PACIENTE DEVE TRAZER ENCAMINHAMENTO DO PSIQUIATRA
```

```
PARA PACIENTES DOS CONVÊNIOS SAÚDE CAIXA, BRADESCO, GEAP E CASSI,O EXAME SÓ PODERÁ SER AGENDADO COM NO MÍNIMO 7 ( SETE DIAS ) DE ANTECEDÊNCIA. O PACIENTE DEVE SOLICITAR FALAR COM ATENDIMENTO HUMANO PARA ENVIAR O PEDIDO MÉDICO EM PDF E INFORMAR A NUMERAÇÃO DA CARTEIRINHA OU LEVAR O PEDIDO PRESENCIALMENTE AO CENTRO MÉDICO PARA A AUTORIZAÇÃO PRÉVIA. SOLICITAR AGENDAMENTO NA RECEPÇÃO.
```
(Holter/MAPA, `observacao`)

### Preparo

```
NO DIA DO EXAME É NECESSÁRIO TRAZER PEDIDO MÉDICO ORIGINAL, CARTEIRINHA DO CONVÊNIO E DOCUMENTO. RECOMENDÁVEL CHEGAR AO CENTRO MÉDICO COM 30 MINUTOS DE ANTECEDÊNCIA.
NÃO É NECESSÁRIO PREPARO
```
(linha padrão, repetida em quase todas as agendas de exame)

```
PREPARO PARA O HOLTER
Orientações:
· Não vir com cordão
· Não fazer o uso de creme hidratante na região do tórax
· Vir com roupa aberta e mais folgada, facilitando a instalação do aparelho.
· ATENÇÃO: não é permitido tomar banho após a colocação do aparelho. É aconselhável tomá-lo antes.
· Mulher: Não vir com sutiã de bojo
· Homem: Vir com a região do tórax depilada
```
(lista com o marcador "·")

```
Preparos:
Ultrassonografia de Abdome Total e/ou Abdome Superior:
 Jejum de 6 a 8 horas .
 Não mascar chicletes nem fumar no dia do exame.
 ...
Ultrassonografia Transvaginal:
 Bexiga vazia (urinar antes do exame).
 Não necessita jejum.
Ultrassonografia Mamas : Mulheres com mais de 40 anos , trazer mamografia prévia atual de até 1 ano.
```
(preparo por subtipo, numa agenda que faz vários exames; `observacao` com 2.758 caracteres; antes de cada linha de
lista vem o caractere de controle U+0095, invisível na maioria das telas)

```
PREPARO COLONOSCOPIA PARA REALIZAÇÃO DO EXAME NO TURNO DA (TARDE) - INICIO DOS ATENDIMENTOS : 13H
MEDICAMENTOS NECESSÁRIOS (COMPRAR ALGUNS DIAS ANTES PARA ORGANIZAR MELHOR O PREPARO)
...
7- Após o exame, o paciente precisará ser obrigatoriamente acompanhado por uma pessoa maior de 18 anos e não poderá dirigir.
```
(protocolo longo, numerado, preso a um turno; `observacao` com cerca de 7.800 caracteres, inteira, sem `observacaoTruncada`)

### Restrições

```
FAIXA ETÁRIA: TODAS AS IDADES
FAIXA ETÁRIA: ATENDE TODAS AS IDADES
FAIXA ETÁRIA: A PARTIR DE 18 ANOS
FAIXA ETÁRIA: A PARTIR DE 06 ANOS
```
(contagem nas 72 agendas medidas: "TODAS AS IDADES" em 22, "A PARTIR DE 18 ANOS" em 17, "A PARTIR DE 14 ANOS" em 10)

```
Não atende casos de depressão ou ansiedade; doença de Parkinson e Alzheimer; perda de memória; casos de neurologia geral.
ESPECIALIDADE: CIRURGIA , NÃO REALIZA CIRURGIA PLÁSTICA , NÃO REALIZA CIRURGIA NA FACE E NÃO REALIZA PEQUENAS CIRURGIAS
ESPECIALIDADE: NUTRICIONISTA,ESPECIALISTA EM EMAGRECIMENTO E GANHO DE MASSA, ÁREA ESPORTIVA, ATENDE PACIENTE BARIATRICO APÓS 3 MESES DA CIRURGIA.
```

```
ATENDE POR HORA MARCADA
VIDEOLARINGOSCOPIA REALIZADO APENAS UMA VEZ AO MÊS - SOLICITAR MARCAÇÃO NA RECEPÇÃO
ATENÇÃO : QUANDO O PACIENTE TAMBÉM TIVER PEDIDO DE AGENDAMENTO PARA COLONOSCOPIA, A ENDOSCOPIA PODERÁ SER REALIZADA JUNTO COM A COLONOSCOPIA, NO MESMO DIA E HORÁRIO. PARA ISSO, BASTA AGENDAR O PACIENTE NA AGENDA DE COLONOSCOPIA E PREECHER DOIS HORÁRIOS.
```

**Retorno, primeira consulta, encaixe, sexo como restrição, vigência em texto:** procurei nas 72 agendas e não aparecem.

---

## 3. Regras que o agente aplica ao ler

| situação | o que o agente faz | qual fonte vence |
|---|---|---|
| **dois valores** para o mesmo item | consulta, `total > 1`: a **descrição da ferramenta** manda não cotar `itens[0]` e confirmar qual médico antes de dizer preço. Consulta, `total: 1` com `aviso` (outros homônimos sem preço): o agente confirma com o paciente de quem se trata. Exame: a busca por nome pode trazer vários procedimentos (ex.: "colonoscopia" → 3 itens); **não há regra escrita** para escolher entre eles. A regra escrita é só esta: se o texto traz parcela (anestesista), **informar todas as parcelas**. Também não há regra para dois valores **diferentes no texto** da mesma agenda. **Não sei** como ele decide nesses casos. | campo para o valor base; texto para acrescentar parcelas |
| **valor ausente** | **não há regra escrita** nas instruções. O que se vê em produção: consulta com `total: 0` → diz que o preço não consta e que a recepção informa; as `sugestoes` dessa rota são palpites fonéticos de nome, a confirmar com o paciente. Convênio ≠ particular → repassa o `motivo` da API (valor de convênio não é cadastrado). Exame com `total: 0` e o aviso "Isto NÃO significa que o hospital não realiza o exame" → usa o **preço escrito no texto da agenda** (ex.: teste ergométrico R$ 200 com a API de valor vazia). Sem preço em lugar nenhum → diz que não encontrou e leva a um humano. | campo; texto quando o campo vem vazio |
| **convênio aceito, subplano não escrito** | texto vazio, `null` ou `[]` = "nada escrito: siga normalmente" → vale o `aceitaConvenio`/`aceitoNaAgenda`. Duas exceções: (1) se o texto distingue planos do mesmo convênio e não se sabe o do paciente, **pergunta só isso**; (2) em **exame**, se esta agenda não fala de autorização mas outras agendas exigem autorização para aquele convênio, **leva o atendimento a um humano** (a regra pode só não ter sido escrita nesta agenda). | campo |
| **texto contradiz campo** | **o texto vence para restringir, nunca para ampliar.** Texto exclui o plano → trata como não aceito, mesmo com `aceitaConvenio: true` / `aceitoNaAgenda: true`, e oferece outro profissional ou o particular. Texto "aceita" algo que o campo recusa → o campo vence (o POST com `validarConvenio: true` recusaria). O texto nunca cria vaga nem data. | **texto** (restrição); **campo** (permissão e datas) |
| **texto contraditório, ambíguo ou truncado** | consulta: agenda assim mesmo, escreve no campo `observacao` do agendamento o plano declarado e "a confirmar", e avisa que a recepção confirma. **Exame: não marca e leva a um humano**, porque o agendamento de exame não tem campo de observação e o plano declarado se perderia. | nenhuma: decide o humano |
| **plano dito × cadastro do paciente** | vale o que o paciente disse **nesta conversa**; o convênio do cadastro é dado antigo e nunca substitui | conversa |
| **convênio inativo** (`ativo: false` ou 409 `convenio_inativo`) | não agenda; oferece particular ou outro convênio que o paciente tenha | campo |
| **vigência × disponibilidade** | a disponibilidade vence sempre; vigência nunca limita data | campo da disponibilidade |
| **instruções × descrição da ferramenta** | as instruções do agente vencem (ex.: a descrição de exame fala em gravar `observacao`, mas esse campo não existe no agendamento de exame) | instruções |

---

## 4. Casamentos por nome

| casamento | como é feito hoje | onde falha |
|---|---|---|
| **nome da agenda**, do catálogo para a disponibilidade, os POSTs e a cobertura | **cópia literal** do campo `agenda` ("copiado letra por letra"; o hífen irregular é proposital) | normalizar dá 404 `agenda_nao_encontrada` (com `sugestoes`). Agendas com hífen e espaço variando: "CIRURGIA GERAL - DR …", "CIRURGIA GERAL- DRA …", "CIRURGIA GERAL-DR …" |
| **médico da agenda → valor da consulta** | manda `medicoCadastro` (de `api_get_consultas_catalogo`/`api_get_medicos`) para `api_get_consultas_valor`; a API casa por **todas as palavras**, sem título, conectivo, acento e caixa | `medicoCadastro`/`crm` ausentes quando o nome da agenda não resolve um único profissional; **uma letra a mais ou trocada zera** (ex.: sobrenome com letra duplicada no cadastro da agenda); homônimos → `aviso`, e o agente confirma. Até 30/08 eram 24 de 54 médicos sem valor alcançável; a v0.19.0 corrigiu |
| **plano dito pelo paciente → código de convênio** | puxa `api_get_convenios` inteiro (`limite: 500`, **sem** `busca`) e casa **pelo sentido** ("Bradesco Nacional Flex" → um dos 3 Bradesco) | nome comercial × nome da operadora; vários candidatos → pergunta; nenhum seguro → consulta marca com "convênio a confirmar na recepção", exame vai para humano. Nome de operadora que parece palavra comum já fez o agente não reconhecer o plano |
| **convênio do texto livre → código de convênio** | leitura pelo agente: casa "SUL AMÉRICA", "SULAMERICA" etc. com os códigos 310/311; "BRADESCO" com os 3 Bradesco | **é o ponto mais frágil**: grafias variadas, nome genérico ("BRADESCO") que cobre vários códigos, subplano escrito só no texto ("ASSIM A60"), listas de aceitos numa agenda e de recusados em outra |
| **nome do exame → valor do exame** | `api_get_exames_valor?busca=` com termo do procedimento; **aproximado** | nome coloquial ("eco de coração", "ultrassom transvaginal") × nome da tabela; vários itens para a mesma busca; a tabela não traz a parcela do anestesista |
| **exame pedido → agenda de exame** | leitura do texto da agenda ("REALIZA …"), porque uma agenda faz vários tipos e o catálogo traz só `procedimento` + `modalidade` | se nenhuma agenda faz o exame, o agente não marca outro parecido |
| **paciente → agendamento de exame** | o vínculo do exame é o **nome do paciente**, exatamente como veio de `api_get_pacientes` | nome diferente faz o exame "sumir" da confirmação e do remarcar; homônimos (`homonimos` ≠ 1) → não mexe e leva a um humano |
| **pedido de preço → parâmetros de `api_get_consultas_valor`** | `medico` = `medicoCadastro`; `convenio` = o código do atendimento (as instruções mandam repetir o código do plano também na conferência de valor; só a descrição da ferramenta diz que só o 10 tem preço) | medido em produção: nome de **especialidade** no campo `medico` (14 de 371 chamadas em 30 dias, erro do agente) e **código do convênio do paciente** (8 de 37 entre 16 e 21/11, que segue as instruções, mas volta `disponivel:false`). As duas dão `total: 0`. Um preço particular por agenda, no catálogo, eliminaria as duas |
| **termos de busca** (catálogos, convênios, médicos, especialidade) | `total: 0` com `sugestoes` → repete com a sugestão; sem `sugestoes` → "não temos" | a busca aproximada não acha grafia com letra trocada, e aí vale a regra de `sugestoes` |

---

## 5. Correções feitas pelo hospital

Registro do lado da Hal-AI. Não tenho acesso ao histórico de alterações do SGH.

**Até 24/09/2026: situação de partida**
- Em 40 de 47 agendas abertas, a lista de convênios era o mesmo modelo de 44 códigos.
- Em 24 agendas, a OBS recusava um convênio ativo que a lista aceitava (75 pares).
- Em 24/09 a Hal-AI mandou ao gestor do SGH a regra proposta:
  - a lista tem os planos principais;
  - a OBS só detalha subplanos e nunca contradiz a lista;
  - convênio inativo sai da lista;
  - lista vazia, nunca.

**Entre 24/09 e 31/10/2026: data exata não sei**
- Valores particulares escritos na observação do convênio 10 (PARTICULAR) nas **72 de 72** agendas, sempre iguais à
  observação geral.
- Subplanos escritos na observação por convênio:
  - "NÃO ATENDEMOS O SUBPLANO ASSIM A60" (convênio 340);
  - exclusão de Sul América Direto Nacional/Extra (convênios 310/311).
- Resultado em 31/10: 43 das 59 agendas de consulta com lista, texto e preço coerentes.
- Ficaram:
  - 9 contradições (6 consultas, 3 exames);
  - 13 agendas com convênio inativo na lista.
- Entre 30/08 e 31/10, o prefixo de nome que travava a agenda de neurocirurgia foi corrigido.

**Entre 31/10 e 08/11/2026: exames**
- **Preparo:**
  - "Não é necessário preparo" escrito nos 4 ecocardiogramas e no doppler;
  - preparo completo nos 3 tipos de um ultrassom.
- **Sul América** retirada das listas de endoscopia, doppler e de um ultrassom.
- **Autorização prévia escrita:**
  - Saúde Caixa: colonoscopia, endoscopia, ecos, Holter, MAPA e doppler;
  - Bradesco, GEAP e CASSI: Holter;
  - Cape Saúde: doppler.

**O que ainda falta** (último levantamento: 08/11/2026; não fiz um novo para esta resposta):

- **Exames:**
  - regra de autorização nos 2 testes ergométricos e nos 2 ultrassons, por convênio;
  - confirmar se Bradesco, GEAP e CASSI exigem autorização só no Holter;
  - ASSIM: o faturamento exige autorização em colonoscopia com biópsia, doppler venoso de membro superior, ultrassom de
    mamas e obstétrico com doppler, mas isso não está escrito nas agendas;
  - preparo da colonoscopia pela **manhã** (hoje só existe o da tarde);
  - "40 gotas" sem o nome do remédio num ultrassom;
  - regra e valor do combinado endoscopia + colonoscopia;
  - eletrocardiograma, raio-x, tomografia e laboratório **sem agenda** no catálogo.
- **Consultas:**
  - um médico com AMIL na lista e "sem credenciamento" no texto;
  - na psicologia, a lista positiva do texto não inclui PRMT, colaboradores e funcionários.
- **Nomes:** grafias divergentes entre agenda e cadastro em pelo menos 2 médicos, e um sobrenome com letra duplicada numa agenda de teste ergométrico (vistos em 31/10; o sobrenome duplicado continuava assim em 21/11).
- **Perguntas ao faturamento sem resposta:** o hospital ainda atende Intermédica e Real Grandeza?
- **Sem registro de correção:**
  - SUS numa agenda de bucomaxilo;
  - Sul América parcial e instrução para a recepção numa cirurgia geral;
  - Mondial × Allianz;
  - AMBEP e Fundação Itaú nas nutricionistas;
  - ENMG;
  - dia da videolaringoscopia e valores do otorrino.

---

## 6. Perguntas dos pacientes que dependem destes dados

Fonte: conversas reais do agente em **produção**, de 22/10 a 21/11/2026 (30 dias). Foram lidas 3.636 conversas;
as 25.875 mensagens de paciente analisadas são de 2.686 delas. A contagem é de conversas, aproximada: uma conversa pode cair em mais de uma pergunta.
As respostas foram encurtadas, com o nome do médico trocado.

Cada pergunta traz o **critério de aceite** para o sistema novo: o que a API tem de permitir para a mesma resposta, ou melhor.

### Valor

**6.1 "Quanto custa a consulta particular com o Dr. X / de cardiologia?"** (~122 conversas)
- **Hoje:** "A consulta particular de gastroenterologia custa: Médico A R$ 300 • Médico B R$ 360. Qual profissional
  prefere?" / "A consulta particular com cardiologista custa R$ 400, com pagamento somente em dinheiro."
- **Falha de hoje:** quando parte dos médicos não tem valor cadastrado: "…para os demais profissionais, o preço não
  consta no sistema de valores".
- **Aceite:** valor por médico (e por agenda) para todos os médicos da especialidade, mais a forma de pagamento.

**6.2 "Quanto custa a colonoscopia / endoscopia / ultrassom / teste ergométrico / doppler particular?"** (~30 conversas)
- **Hoje:**
  - "A colonoscopia particular custa R$ 880,00, mais R$ 200,00 do anestesista, total de R$ 1.080,00. Pagamento
    somente em dinheiro.";
  - "ecodoppler arterial particular: R$ 350 por membro";
  - "O teste ergométrico custa R$ 200,00 no particular" (a API de valor não achou; o valor saiu do texto da agenda).
- **Falha de hoje:** entre 16 e 21/11, `api_get_exames_valor` trouxe valor em só **3 de 15** chamadas. Os termos foram
  ultrassom transvaginal, tomografia, ressonância, teste ergométrico e doppler. Fora do catálogo (ex.: um exame hormonal de laboratório): "Não encontrei um valor cadastrado", com transferência.
- **Aceite:** valor do exame achável pela agenda/exame do catálogo, com as parcelas (anestesista), a unidade ("por
  membro") e a forma de pagamento.

**6.3 "Aceita cartão / Pix?"** (~15 conversas)
- **Hoje:** "Pelo cadastro, nenhum dos três recebe cartão para consulta particular: aceitam somente pagamento em
  dinheiro. A consulta custa R$ 300,00 com cada um."
- **Falha de hoje:** em outra conversa, a mesma pergunta foi transferida a um humano. A informação só existe em texto.
- **Aceite:** forma de pagamento por agenda/exame.

**6.4 "Tem consulta social / valor social?"** (~38 conversas)
- **Hoje:** "Não encontrei um convênio chamado 'Social' no cadastro. Você quis dizer atendimento particular?" / "A equipe
  precisa confirmar se há valor social."
- **Falha de hoje:** o agente não sabe; não há dado em lugar nenhum.
- **Aceite:** se o hospital tiver valor social, um campo próprio. Se não tiver, a resposta "não temos" tem de vir de dado.

### Convênio e subplano

**6.5 "Vocês aceitam o convênio X?"** (~231 conversas)
- **Hoje:** "O convênio ASSIM consta ativo no cadastro do hospital. A aceitação pode variar conforme o atendimento ou a
  agenda; o que você precisa consultar?"
- **Falha de hoje:** no SUS, "consta ativo" soa como "atende", mas as agendas de cardiologia não aceitavam SUS.
- **Aceite:** `ativo` por convênio (como hoje), mais, de preferência, em quais serviços ou agendas ele é aceito.

**6.6 "Vocês aceitam Unimed?"** (~69 conversas)
- **Hoje:** "Atualmente, o Hospital Geral ProntoCardio não atende pelo convênio Unimed, inclusive para consultas, exames
  e pronto atendimento. Podemos atender você como particular."
- **Fonte de hoje:** essa regra **não vem da API**: vem da base de conhecimento do agente.
- **Aceite:** que a lista de convênios mostre a Unimed como não atendida (inativa), para a API dar a mesma resposta.

**6.7 "O Dr. X / a cardiologia atende o meu plano Y?"** (~19 conversas com a frase completa; muitas mais dentro da marcação)
- **Hoje:** "Sim. A agenda de Cardiologia do Médico A consta como aceita para Porto Seguro." / "as agendas de
  Nutricionista não atendem Bradesco… particular: Médico B R$ 300; Médico C R$ 290."
- **Aceite:** `aceitaConvenio` por agenda, idêntico ao de hoje, mais a exclusão escrita no texto.

**6.8 "Meu plano é Bradesco Nacional Flex / SulAmérica Direto Nacional / Assim A60 / Amil Nacional. Atende?"** (~135 conversas)
- **Hoje, Assim A60:** "O Médico A atende pelo Assim Saúde, exceto pelo subplano Assim A60. Você sabe se o seu
  plano é o A60?" (certa, pelo texto da agenda).
- **Hoje, Amil Nacional:** casado com AMIL e conferido na agenda (certa).
- **Falha de hoje, Bradesco:** "qual categoria aparece na carteirinha? [Individual] [Empresarial] [Operadora de
  Planos]". O paciente diz o produto e o cadastro só tem a modalidade; muitos não sabem responder.
- **Falha de hoje, SulAmérica "Especial 100":** "a aceitação desse produto específico deve ser confirmada na recepção".
- **Aceite:** lista de subplanos/produtos de cada convênio, com os nomes comerciais, ligada ao código, e quais deles
  cada agenda aceita ou recusa.

**6.9 "Faço o exame X pelo meu plano? Precisa de autorização?"** (~34 conversas)
- **Hoje:** "O Bradesco Empresarial consta como aceito na agenda, mas a equipe precisa verificar se há autorização ou
  documentação prévia necessária antes de confirmar a endoscopia", com transferência. A regra é de propósito: exame
  que depende de aprovação vai a um humano.
- **Aceite:** "exige autorização prévia" por agenda/exame × convênio, e a antecedência mínima. Com isso o agente diz
  com certeza o que for preciso e só transfere quando de fato precisa.

### Preparo e documentos

**6.10 "Qual o preparo? Precisa de jejum? Posso tomar meu remédio?"** (~41 conversas)
- **Hoje, ultrassom de abdome total:** "Jejum de 6 a 8 horas; não mascar chiclete nem fumar; no dia anterior evite
  gordurosos e gaseificados; medicamentos de uso contínuo normalmente…"
- **Hoje, MAPA:** "não passe creme nos braços, roupa folgada, tome banho antes, leve o pedido original… chegar 30
  minutos antes."
- **Falha de hoje:** exame de laboratório (sem agenda no catálogo) e dúvida sobre medicamento do preparo vão para humano.
- **Aceite:** preparo por exame e subtipo, e por turno quando muda; incluir os exames que hoje não têm agenda, se o
  agente for responder por eles.

**6.11 "Precisa de pedido médico / guia / senha?"** (~24 explícitas; ~90 citando o assunto)
- **Hoje:** "é necessário levar o pedido médico original no dia da colonoscopia; peçam uma segunda via ao médico."
- **Falha de hoje:** exame de laboratório sem agenda: "Ainda não consegui confirmar se é necessário pedido
  médico", com transferência.
- **Aceite:** documentos exigidos por exame.

### Restrições e vaga

**6.12 "Atende criança? A partir de que idade? Tem cardiologia infantil?"** (~131 conversas)
- **Hoje:**
  - "Nas agendas de cardiologia, a idade mínima é de 12 anos com o Médico A e 14 anos com os demais. Não encontrei uma
    agenda que atenda uma criança dessa idade." (criança abaixo da idade mínima);
  - "Neurologia com a Médica B, mas ela atende somente pacientes a partir de 18 anos";
  - ecocardiograma para criança de 2 anos: não marcou e passou a um humano.
- **Aceite:** idade mínima e máxima por agenda (e por subtipo de exame quando diferir), com o mesmo resultado.

**6.13 "Tem encaixe? Tem vaga hoje / mais cedo?"** (~46 com "encaixe"; ~217 no sentido amplo)
- **Hoje:** "Não há vaga de Endocrinologia hoje nem amanhã… com a Médica A, que aceita Bradesco Empresarial, há estas
  opções: …". Responde pela disponibilidade e nunca promete encaixe. Com dor ou crise, manda para a emergência.
- **Aceite:** disponibilidade por período, idêntica. Se houver política de encaixe, um campo próprio por agenda.

**6.14 "Tenho direito a retorno? É cobrado? Em quantos dias?"** (~4 conversas com a pergunta de regra; ~128 pedindo para marcar retorno)
- **Hoje:** "Não consigo confirmar com segurança se essa consulta inclui retorno ou revisão… A equipe poderá esclarecer."
- **Falha de hoje:** o agente não sabe; não há dado.
- **Aceite:** regra de retorno (prazo, se é cobrado, por agenda/convênio), se o hospital quiser que o agente responda.

**Quase nunca perguntado nos 30 dias:**
- "só primeira consulta" (8 conversas, todas só avisando que é a primeira vez);
- restrição por sexo (nenhuma).

---

## 7. Forma exata das respostas que o agente recebe

Respostas reais de produção, de 16/11 a 21/11/2026. Mudanças feitas: nome de médico trocado, CRM e `agendaId` fictícios (`90000xx`, `90xx`) e,
nas listas longas, só os primeiros itens. A contagem total vai indicada fora do JSON. Os campos e a ordem estão como vieram.

### `api_get_consultas_catalogo`

Chamada: `{"busca":"cirurg","convenio":325}`. Veio `total: 6`; abaixo, 3 dos 6 itens (o 1º, o 2º e o 5º).

```json
{
  "total": 6,
  "consultas": [
    {
      "agendaId": 9001,
      "agenda": "CIRURGIA GERAL - DR Médico A",
      "especialidade": "CIRURGIA GERAL",
      "medico": "DR Médico A",
      "duracaoMin": 5,
      "vigencia": { "inicio": "2026-11-24", "fim": "2026-12-22" },
      "observacao": "FAIXA ETÁRIA: TODAS AS IDADES\nESPECIALIDADE: PEQUENAS CIRURGIAS, FACE , HERNIA ABDOMINAL E INGUINAL, COLECISTECTOMIA VIDEOLAPAROSCÓPICA, LIGADURA DE TROMPAS, OOFORECTOMIA (OVÁRIO), CISTO SEBÁCEO, LIPOMA, ONICOCRIPTOSE (UNHA ENCRAVADA), BIÓPSIAS DE PELE EM GERAL.\nCONVÊNIO SEM CREDENCIAMENTO: SUL AMERICA , ASSIM SAUDE\nVALOR DA CONSULTA PARTICULAR: R$: 250,00\nLOJA DE ATENDIMENTO : LOJA 01",
      "observacaoPortal": null,
      "observacoesPorConvenio": [
        { "codigo": 10, "nome": "PARTICULAR", "observacao": "VALOR DA CONSULTA PARTICULAR : R$250,00 ( DUZENTOS E CINQUENTA REAIS) - RECEBEMOS O PAGAMENTO SOMENTE EM DINHEIRO" }
      ],
      "medicoCadastro": "Médico A",
      "crm": 9000001,
      "aceitaConvenio": true
    },
    {
      "agendaId": 9002,
      "agenda": "CIRURGIA GERAL- DRA Médico B",
      "especialidade": "CIRURGIA GERAL",
      "medico": "DRA Médico B",
      "duracaoMin": 15,
      "vigencia": { "inicio": "2026-11-24", "fim": "2026-12-15" },
      "observacao": "FAIXA ETÁRIA: A PARTIR DE 18 ANOS\nESPECIALIDADE: CIRURGIA , REALIZA PEQUENAS CIRURGIAS, NÃO REALIZA CIRURGIA PLÁSTICA , NÃO REALIZA CIRURGIA NA FACE\nCONVÊNIO SEM CREDENCIAMENTO: ASSIM A60, SUL AMÉRICA\nATENDE POR HORA MARCADA\nLOJA DE ATENDIMENTO : LOJA 03",
      "observacaoPortal": null,
      "observacoesPorConvenio": [
        { "codigo": 340, "nome": "ASSIM", "observacao": "NÃO ATENDEMOS SUBPLANO ASSIM A60" },
        { "codigo": 10, "nome": "PARTICULAR", "observacao": "VALOR DA CONSULTA PARTICULAR : R$250,00 ( DUZENTOS E CINQUENTA REAIS) - RECEBEMOS O PAGAMENTO SOMENTE EM DINHEIRO" }
      ],
      "medicoCadastro": "Médico B",
      "crm": 9000002,
      "aceitaConvenio": true
    },
    {
      "agendaId": 9003,
      "agenda": "CIRURGIA GERAL-DR Médico C",
      "especialidade": "CIRURGIA GERAL",
      "medico": "DR Médico C",
      "duracaoMin": 15,
      "vigencia": { "inicio": "2026-11-26", "fim": "2026-12-17" },
      "observacao": "FAIXA ETÁRIA: A PARTIR DE 16 ANOS\nESPECIALIDADE:CIRURGIA BARIATRICA; CIRURGIAS ONCOLÓGICAS (DIGESTIVAS); EX: INTESTINO, PANCREAS, ESOFAGO, VESICULA.\nCIRURGIA DE VESICULA;HÉRNIA; CIRURGIAS DE URGÊNCIA: APÊNDICE, OBSTRUÇÃO INTESTINAL.\nCONVÊNIO SEM CREDENCIAMENTO: SULAMERICA, ASSIM A60\nVALOR DA CONSULTA PARTICULAR: R$: 350,00\nLOJA DE ATENDIMENTO : LOJA 01",
      "observacaoPortal": null,
      "observacoesPorConvenio": [
        { "codigo": 340, "nome": "ASSIM", "observacao": "NÃO ATENDEMOS SUBPLANO ASSIM A60" },
        { "codigo": 10, "nome": "PARTICULAR", "observacao": "VALOR DA CONSULTA PARTICULAR : R$350,00 ( TREZENTOS E CINQUENTA REAIS) - RECEBEMOS O PAGAMENTO SOMENTE EM DINHEIRO" }
      ],
      "medicoCadastro": "Médico C",
      "crm": 9000003,
      "aceitaConvenio": true
    }
  ],
  "sugestoes": []
}
```

**Campos que o agente usa:**

| campo | para quê |
|---|---|
| `total`, `sugestoes` | regra do "total 0 com sugestões" |
| `agenda` | copiado literal para a disponibilidade e os POSTs |
| `especialidade`, `medico` | dizer ao paciente |
| `observacao`, `observacaoPortal`, `observacoesPorConvenio[]` (`codigo`, `observacao`), `observacaoTruncada` quando vier | ver itens 1 a 3 |
| `medicoCadastro`, `crm` | consultar o valor |
| `aceitaConvenio` | filtrar quem atende o plano |

`agendaId` não é usado para casar. `vigencia` é lida, mas **não** decide data. `duracaoMin` não é usado.

### `api_get_consultas_valor`

Com valor (`convenio = 10`, PARTICULAR):

```json
{
  "disponivel": true,
  "medico": "Médico D",
  "convenio": { "codigo": 10, "nome": "PARTICULAR", "ativo": true },
  "total": 1,
  "itens": [
    { "medico": "Médico D", "crm": 9000004, "valor": 400 }
  ]
}
```

Sem valor (convênio ≠ particular):

```json
{
  "disponivel": false,
  "motivo": "Valor de consulta por convênio não é cadastrado no SGH (apenas particular). Consultar a recepção.",
  "sugestoes": [],
  "medico": "Médico E",
  "convenio": { "codigo": 320, "nome": "AMIL", "ativo": true },
  "total": 0,
  "itens": []
}
```

**Campos que o agente usa:**
- `disponivel`, `total`, `itens[].medico`, `itens[].valor`, `motivo`, `sugestoes`;
- `aviso`, que aparece quando há homônimos ("O valor devolvido é de … mas '…' também casa outros 4 profissionais…
  CONFIRME com o paciente…").

### `api_get_exames_valor`

Com valor (`busca: "colonoscopia"`, `convenio = 10`):

```json
{
  "busca": "colonoscopia",
  "convenio": { "codigo": 10, "nome": "PARTICULAR", "ativo": true, "tabelaHonorario": 10 },
  "total": 3,
  "itens": [
    { "codigo": 400001, "nome": "BIOPSIA DE COLONOSCOPIA", "valor": 210,
      "componentes": { "custoOperacional": 0, "filme": 0, "anestesia": 0, "outros": 0 },
      "valorTotal": 210, "vigencia": "2024-03-01", "situacao": "A" },
    { "codigo": 40201082, "nome": "COLONOSCOPIA  INCLUI A RETOSSIGMOIDOSCOPIA", "valor": 880,
      "componentes": { "custoOperacional": 0, "filme": 0, "anestesia": 0, "outros": 0 },
      "valorTotal": 880, "vigencia": "2025-04-01", "situacao": "A" },
    { "codigo": 300328, "nome": "COLONOSCOPIA - PREPARO INTERNADO SEM COLONOSCOPIA", "valor": 1500,
      "componentes": { "custoOperacional": 0, "filme": 0, "anestesia": 0, "outros": 0 },
      "valorTotal": 1500, "vigencia": "2024-01-01", "situacao": "A" }
  ],
  "disponivel": true
}
```

Sem valor:

```json
{
  "busca": "ULTRASSOM TRANSVAGINAL",
  "convenio": { "codigo": 306, "nome": "BRADESCO SAUDE EMPRESARIAL", "ativo": true, "tabelaHonorario": 306 },
  "total": 0,
  "itens": [],
  "disponivel": false,
  "motivo": "Nenhum honorário encontrado para \"ULTRASSOM TRANSVAGINAL\" na tabela do convênio BRADESCO SAUDE EMPRESARIAL (306). O casamento é por NOME do procedimento e é aproximado: tente um termo mais curto ou outra grafia (ex.: \"ecocardiograma\" em vez de \"eco de coração\"). Isto NÃO significa que o hospital não realiza o exame — para saber se é realizado, use /exames/catalogo."
}
```

**Campos que o agente usa:**
- `disponivel`, `total`, `itens[].nome`, `itens[].valor` / `valorTotal`, `motivo`;
- `componentes`, quando não-zero.

`codigo`, `vigencia` e `situacao` vêm, mas não aparecem na fala ao paciente.

### `api_get_exames_cobertura`

Chamada com `convenio` + `agenda`:

```json
{
  "coberturaPorExame": false,
  "motivo": "Cobertura por exame×convênio não está modelada no banco. Retornamos apenas a situação do convênio.",
  "convenio": { "codigo": 10, "nome": "PARTICULAR", "ativo": true, "permiteAtendimento": 3 },
  "convenioAtende": true,
  "agenda": "ULTRASSOM - DRA Médico F",
  "aceitoNaAgenda": true,
  "restricaoConfigurada": true
}
```

**Campo que o agente usa:** `aceitoNaAgenda`, e só ele decide. `coberturaPorExame` e `permiteAtendimento` são
**explicitamente ignorados** pelas instruções. `convenioAtende` não é citado nas instruções (a descrição da ferramenta
diz que é o único campo, além de `aceitoNaAgenda`, que informa algo: se o convênio está ativo).

### `api_get_convenios`

Chamada com `limite: 500`, sem `busca`. Veio `total: 77`; abaixo, 3 itens escolhidos da lista (ativo, ativo com subplano no texto, inativo), fora da ordem original.

```json
{
  "total": 77,
  "convenios": [
    { "codigo": 10,  "nome": "PARTICULAR", "ativo": true,  "permiteAtendimento": 3 },
    { "codigo": 340, "nome": "ASSIM",      "ativo": true,  "permiteAtendimento": 3 },
    { "codigo": 632, "nome": "AMAFRERJ",   "ativo": false, "permiteAtendimento": 3 }
  ]
}
```

**Campos que o agente usa:** `codigo`, `nome` e `ativo`. `permiteAtendimento` não é usado. O **código 10 = PARTICULAR**
vai nas chamadas de preço do atendimento particular. Com plano, o código do plano vai em todas as chamadas seguintes, inclusive
as de preço.

### `api_get_medicos`

Busca por especialidade/nome. Veio `total: 6`; abaixo, 3 itens.

```json
{
  "total": 6,
  "atende": true,
  "medicos": [
    {
      "medico": "DR Médico C",
      "atende": true,
      "agendas": [
        { "tipo": "consulta", "agenda": "CIRURGIA GERAL-DR Médico C", "especialidade": "CIRURGIA GERAL",
          "vigencia": { "inicio": "2026-11-26", "fim": "2026-12-17" } }
      ],
      "medicoCadastro": "Médico C",
      "crm": 9000003
    },
    {
      "medico": "DR Médico G",
      "atende": true,
      "agendas": [
        { "tipo": "consulta", "agenda": "CIRURGIA GERAL - DR Médico G", "especialidade": "CIRURGIA GERAL",
          "vigencia": { "inicio": "2026-11-26", "fim": "2026-12-17" } }
      ],
      "medicoCadastro": "Médico G",
      "crm": 9000005
    },
    {
      "medico": "DR Médico H",
      "atende": true,
      "agendas": [
        { "tipo": "consulta", "agenda": "CIRURGIA TORACICA - DR Médico H", "especialidade": "CIRURGIA TORACICA",
          "vigencia": { "inicio": "2026-11-23", "fim": "2026-12-21" } }
      ],
      "medicoCadastro": "Médico H",
      "crm": 9000006
    }
  ],
  "sugestoes": []
}
```

**Campos que o agente usa:**

| campo | para quê |
|---|---|
| `total`, `sugestoes` | regra do "total 0 com sugestões" |
| `atende` | se o médico existe e atende aqui; a pergunta "vocês têm o Dr. X?" se responde por ele, nunca pela vaga |
| `medicos[].medico` | dizer ao paciente |
| `agendas[].agenda`, `agendas[].tipo`, `agendas[].especialidade` | achar e copiar a agenda |
| `medicoCadastro`, `crm` | consultar o valor |

`vigencia` não decide data.

### Duas que o pedido não listou, mas que carregam os mesmos dados

**`api_get_exames_catalogo`** traz o preparo, o preço do exame em texto e as restrições do exame. Os campos de cada
agenda são:

```
agendaId, agenda, procedimento, medico, modalidade, categoria{codigo,nome}, vigencia{inicio,fim},
observacao, observacaoPortal, observacoesPorConvenio[{codigo,nome,observacao}]
```

- O nome do médico às vezes vem trocado. Ex.: `"agenda": "DOPPLER ARTERIAL- VENOSO-CAROTIDAS"`,
  `"procedimento": "DOPPLER ARTERIAL"`, `"medico": "VENOSO-CAROTIDAS"`. O médico de verdade está escrito no fim da
  `observacao`.
- `aceitaConvenio` não vem, porque a ferramenta do agente não passa `convenio` nesse catálogo. A API aceita isso desde a
  v0.30.0, mas as instruções (de 08/11) mandam usar `api_get_exames_cobertura`.
- **Campos que o agente usa:** `agenda`, `procedimento`, `modalidade` e as três
  observações.

**`api_get_consultas_disponibilidade` / `api_get_exames_disponibilidade`** dão os dias reais:

```
consulta: agendas[{agenda, especialidade, medico, total, horarios[{data, diaSemana, hora, horaRaw}]}]
exame:    horarios[{agenda, data, diaSemana, hora, horaRaw, exame, crm}]
```

com `total`, `truncado`, `janelaCoberta`, `proximoOffset`, `aviso`, `agendasSemVagaNaJanela` e
`proximaDisponibilidade`. O agente copia `agenda`, `data` e `hora` para os POSTs; em exame, também `exame` (a letra
da modalidade) e `crm`.

---

## 8. O que o agente gostaria que existisse (só acréscimo)

Nada abaixo muda o que existe. São campos novos, opcionais, ao lado dos atuais.

### Valores

1. **Valor particular estruturado no catálogo**, por agenda e por procedimento: `valorParticular[{procedimento, valor,
   unidade ("por membro"), parcelas[{descricao ("anestesista"), valor}], formasPagamento[]}]`. Hoje o anestesista da
   colonoscopia e o preço "por membro" do doppler só existem em texto, e a tabela de honorários devolve `anestesia: 0`.
2. **Valor de exame por agenda**, não só por nome aproximado: `GET /exames/valor?agenda=…` devolvendo os
   procedimentos daquela agenda com preço. Isso acaba com o casamento por nome ("eco de coração" × "ECOCARDIOGRAMA…").
3. **Valor cobrado de paciente de convênio** (ex.: bioimpedância R$ 100), em campo próprio, por agenda e convênio.
4. **Valor por subplano**, se o hospital cobrar diferente por subplano. Hoje **não sei** se cobra: nenhum texto mostra isso.

### Convênio e subplano

5. **Subplano estruturado:**
   - `subplanosAceitos[]` / `subplanosRecusados[]` por agenda e convênio, com o mesmo vocabulário de nomes que
     `api_get_convenios` usa;
   - e, em `api_get_convenios`, a lista de subplanos de cada convênio (ASSIM → A60…; SUL AMÉRICA → Direto Nacional,
     Extra…), para o agente perguntar ao paciente pelo nome certo.
6. **Condições por convênio na agenda**, estruturadas:
   - `exigeAutorizacaoPrevia` (true/false);
   - `antecedenciaMinimaDias`;
   - `exigeEncaminhamento` (texto curto: "do psiquiatra");
   - `marcacaoSomentePelaRecepcao` (true/false).

   Hoje isso decide se o exame é marcado pelo agente ou vai a um humano, e vem em frase livre.
7. **Uma única fonte de "aceita"**: que a lista de convênios da agenda e o texto nunca se contradigam, ou que a API
   devolva `conflitoListaTexto: true` quando acontecer.
8. **Cobertura por exame × convênio** de verdade (hoje `coberturaPorExame: false`, "não está modelada").

### Restrições e preparo

9. **Restrições estruturadas** por agenda e, quando couber, por subtipo de exame:
   - `idadeMinima`, `idadeMaxima`;
   - `sexo` (se o hospital tiver essa regra);
   - `aceitaRetorno`, `somentePrimeiraConsulta`, `permiteEncaixe` (hoje não aparecem em lugar nenhum);
   - `naoAtende[]` (tipos de caso).
10. **Preparo estruturado por subtipo de exame e por turno**: `preparos[{exame, turno, texto, jejumHoras}]`, e
    `documentosNecessarios[]`, `chegarMinutosAntes`, `exigeAcompanhante`. Hoje é um texto de até 7.800 caracteres.
11. **Lista de exames que a agenda realiza**, estruturada (`examesRealizados[]`), em vez de "REALIZA …" no texto.
12. **Local de atendimento** em campo (`local: "LOJA 01" | "LOJA 03" | "HOSPITAL"`).
13. **Médico da agenda de exame** em campo próprio (hoje às vezes `medico` traz parte do nome do exame).

### Respostas e agenda

14. **"Agenda inexistente" × "agenda lotada" × "grade ainda não aberta" × "agenda inativa"** já existem para nome exato
    (404 `agenda_nao_encontrada`, `total: 0` + `proximaDisponibilidade`, `gradeAte`, 404 `fora_de_vigencia`). Que
    continuem **idênticos**. Pedido pendente: na busca aproximada (por médico ou especialidade), avisar quando houver
    agenda **inativa** com aquele nome.
15. **Duração do exame** e "ocupa N horários" em campo, para casos como endoscopia + colonoscopia no mesmo horário.
16. **Campo de observação no agendamento de exame** (hoje não existe). Com ele, o agente marcaria com "plano a
    confirmar" em vez de levar o atendimento a um humano, como já faz na consulta.
17. **Vínculo do exame ao paciente por id**, não por nome. Hoje nome diferente ou homônimo faz o exame sumir da
    confirmação e do remarcar.

---

*Fontes do lado da Hal-AI:*
- instruções vigentes do agente (versão 2.9, 08/11/2026) e as descrições das 28 ferramentas, lidas em produção;
- respostas reais das ferramentas no histórico de conversas de produção, de 16/11 a 21/11/2026;
- pedidos já enviados à sante-api: 11/08, 18 e 19/08, 29/08, 16/09 e 27/09/2026; e-mails ao hospital sobre o cadastro
  (24/09, 31/10 e 08/11/2026); respostas da sante-api a achados do Hospital Serrano (13/11/2026);
- documentação da sante-api até a v0.30.1.
