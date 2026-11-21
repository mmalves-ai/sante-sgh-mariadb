# Pedido ao agente de marcação da ProntoCardio (Hal-AI): como você usa hoje agendas, valores e convênios

> Pedido do sistema hospitalar novo (sante-sgh). O dono cola este texto no chat do agente e traz a resposta de
> volta. Resposta em texto no próprio chat: não precisa publicar documento nem enviar e-mail.

## Para que serve

O hospital vai trocar o sistema de gestão. A API que você usa hoje (consultas, exames, convênios, médicos e
agendamentos) vai continuar existindo, **com as mesmas rotas e as mesmas respostas**, mas lendo de um banco novo.

No banco novo, o que hoje está escrito em **texto livre** passa a ter **campo próprio**:
- valor particular de consulta e de exame;
- convênios e subplanos aceitos em cada agenda;
- preparo e restrições.

Para isso, preciso saber **exatamente como você usa esses dados hoje**: de onde tira cada informação, em que formato
ela vem e que regra você aplica. Nada do seu jeito de atender pode mudar com a troca.

## Regras desta resposta

- **Não traga dado de paciente** (nome, telefone, CPF, data de nascimento): nenhum.
- Nos exemplos, **troque o nome de médico por um fictício** ("Médico A", "Médico B"). Valores em reais e nomes de
  convênio e plano podem ficar como vêm.
- Use só as ferramentas que você já tem. Chame cada uma **no máximo duas vezes**, só para mostrar a forma real da
  resposta.
- Se não souber ou não tiver acesso a algo, escreva **"não sei"** ou **"não tenho acesso"**. Não complete com
  suposição.

## O que preciso (responda por item, com o número)

1. **Mapa de onde cada informação vem.** Para cada informação abaixo, diga:
   - a ferramenta e o campo de onde você a tira;
   - se ela vem em **campo próprio** ou dentro de um **texto de observação** (e qual observação: da agenda, do
     convênio na agenda, do portal, do exame).

   As informações:
   - **a.** valor particular de consulta, por médico;
   - **b.** valor particular de exame;
   - **c.** se o médico ou a agenda atende um convênio;
   - **d.** se atende um **subplano** específico daquele convênio (plano, categoria, acomodação);
   - **e.** preparo e orientação do exame;
   - **f.** restrições: idade, sexo, "não atende retorno", "só primeira consulta", encaixe;
   - **g.** período em que a agenda vale (vigência) e dias de atendimento;
   - **h.** duração ou intervalo da consulta;
   - **i.** qualquer outra regra que você lê em texto e usa para decidir ou para responder ao paciente.
2. **Formatos do texto livre.** Para cada informação que vem dentro de observação, mostre de 2 a 4 exemplos **de
   formatos diferentes**, copiados como aparecem, com o nome do médico trocado. Exemplos do que procuro:
   - "Particular R$ 350,00";
   - "Consulta particular: 300 / retorno 150";
   - "Atende Unimed (exceto plano X)".
3. **Regras que você aplica ao ler.** Como você decide quando:
   - há dois valores no texto;
   - o valor não está em lugar nenhum;
   - o convênio está aceito, mas o subplano não está escrito;
   - o texto contradiz um campo próprio.

   Diga também qual fonte vence em cada caso.
4. **Casamentos por nome.** Onde você precisa casar nome de médico, de agenda, de convênio ou de exame entre uma
   ferramenta e outra, diga como faz e onde costuma falhar.
5. **Correções feitas pelo hospital.** O hospital corrigiu observações para incluir valores particulares e
   cobertura de subplanos. Diga, se souber:
   - quais tipos de correção foram feitos;
   - a data aproximada;
   - em que agendas ou exames;
   - o que ainda falta corrigir.
6. **Perguntas dos pacientes que dependem destes dados.** Liste as 10 a 15 perguntas mais comuns que exigem valor,
   convênio, subplano, preparo ou restrição, com a resposta que você daria hoje (nome do médico trocado). Essas
   perguntas viram o **teste de aceite**: o sistema novo tem de permitir a mesma resposta, ou melhor.
7. **Forma exata das respostas que você recebe.** Para cada ferramenta abaixo, cole **uma** resposta real
   completa, com o nome de médico trocado e sem dado de paciente:
   - `api_get_consultas_catalogo`
   - `api_get_consultas_valor`
   - `api_get_exames_valor`
   - `api_get_exames_cobertura`
   - `api_get_convenios`
   - `api_get_medicos`

   Diga quais campos você realmente usa em cada uma. O banco novo tem de devolver esses campos idênticos.
8. **O que você gostaria que existisse.** Campos ou respostas que hoje faltam e que, se viessem estruturados,
   deixariam você mais certeiro, como valor por subplano ou "agenda inexistente" distinto de "agenda lotada". Isso
   entra **só como acréscimo**: nada do que você usa hoje muda.

## Como responder

Um texto por item, numerado de 1 a 8. Onde houver resposta de ferramenta, cole o JSON como veio, trocando só o nome
do médico.
