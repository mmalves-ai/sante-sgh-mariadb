# Lote 20-misto-preco (preço, relatório, exames, assinatura)

## O que mudou
- **Preço e relatório (comentários e textos):** saíram os nomes de tabela e coluna da origem. No lugar ficaram os
  termos de negócio: vigência de valor do procedimento, itens da tabela de honorários, percentual por procedimento,
  índices do convênio e contrato da fonte pagadora. Os dois alertas do reajuste exibidos na tela também mudaram.
- **Hora do envio agendado de relatório:** passou de número `HHMM` (0 a 2359) para `"HH:MM"`, de ponta a ponta:
  - contrato (`esquemaHora`);
  - domínio (`proximoEnvio`, pelo `horaParaMinutos`);
  - API (`TIME_FORMAT` na leitura e `horaNoBanco` estrito);
  - worker (`horaDoDominio`);
  - tela (o `<input type=time>` vai direto);
  - testes.
- **Agenda de exames em `"HH:MM"`:** porta própria, porta em memória, operações e serviço. A entrada aceita ainda os
  quatro dígitos, enquanto o contrato do lote 12 não volta ao `esquemaHora`. A sentinela `'0000'` do intervalo
  virou `null`.
  - O relógio ganhou a forma neutra: `relogioDoEstabelecimento`, `horaCivil`, `minutosDaHora`, `horaDeMinutos` e
    `normalizarHora`.
  - A forma antiga continua para os cerca de 20 módulos que importam o relógio (pedido coordenado).
- **Agenda de exames sem `modelo-pendente`:**
  - a cobertura por exame lê e grava `agenda_servico_exame`, pelo Executor e com a trilha na mesma transação;
  - os feriados vêm da tabela `feriado`, e a prévia deixou de avisar "feriados não conferidos";
  - o int.spec ganhou o teste da cobertura e o do feriado.
- **Contrato da captura de assinatura:** o formato `'HHMM'` virou `'hora-4-digitos'`. Nenhum arquivo
  `.assinatura.json` usava esse formato.

- **Motor da assinatura ICP ligado ao banco (segunda volta):** as cerca de 17 gravações e 10 leituras de
  `assinatura/porta-propria.ts` que respondiam 503 ou voltavam vazias agora usam as tabelas do modelo:
  - política por tipo de documento (`politica_assinatura` e a regra por destino e conselho);
  - pedido de autorização de uso único, tentativa com reprocessamento, validação, prévia (PDF em `arquivo`) e avisos;
  - numeração da receita controlada;
  - na conclusão, o envelope do documento assinado, a assinatura nele e o evento "assinatura" na cadeia do documento.
  - A fila do autor passou a trazer também as tentativas pendentes e em falha.
  - A consulta pública guarda também "indeterminado" e "pendente".
  - O int.spec ganhou o teste do motor inteiro, verde no cliente `f24_20mistopreco`.
- **Relógio de exames:** `RelogioEstabelecimento` chama a hora `"HH:MM"` de `hora`. A forma antiga em quatro dígitos
  (`relogioNoFuso`) tem tipo próprio, e o mesmo nome deixou de ter dois significados.
- **Comentários do contrato de preço:** saíram a menção ao sistema de origem e os nomes de coluna da origem.

## Decisões pela melhor prática (para o dono ver)
- **Retirar um exame da cobertura é exclusão lógica,** e incluir de novo reativa a mesma linha. A chave única
  agenda + exame + fonte pagadora vale também para as linhas excluídas, e a trilha fica completa.
- **O ponto facultativo não conta como feriado na geração da grade.** É o mesmo critério da qualidade, porque
  não é feriado legal.
- **O relógio compartilhado não foi quebrado.** `civil()` devolve `hora` (HH:MM) e `hhmm` (forma antiga) na
  transição. Por isso `relogio.ts` ainda aparece na dívida (linhas 14 e 69), de propósito e com pedido.

- **Assinatura ICP:**
  - mudar a regra da política encerra a vigente na véspera e abre outra hoje; a segunda mudança no mesmo dia altera
    a de hoje, com versão nova e trilha;
  - o envelope do documento assinado nasce na conclusão, com o código e o PDF da prévia; documento que já tem
    envelope recebe só o evento;
  - a situação clínica do documento não muda com a assinatura: o estado da assinatura fica no envelope;
  - o número da receita controlada fica no próprio pedido numerado; o documento aceita um número só;
  - a versão do PDF vem da emissão do documento até existir `arquivo.versao_objeto`. Outra versão recebe 503
    explícito, e nada é gravado.

## Pedidos (ver 20-misto-preco.json)
1. **DDL `arquivo.versao_objeto`** (feito o motor da assinatura, falta só isto para a versão do PDF não depender
   da emissão).
2. **Troca coordenada do relógio compartilhado nos outros módulos.** De preferência, mover o relógio para um
   módulo comum.
3. **Lote 12:** `contratos/agenda/exame.ts` pode voltar ao `esquemaHora`.
4. **Lote 21:** a farmácia deve usar `horaCivil`.
5. **Lote 12:** renomear `Relogio.hhmm` para `hora` no motor da agenda.
6. **Coordenado:** `destino: 'legado'` das respostas (o `destinoDoContrato` e cerca de 10 esquemas).
7. **Aviso:** `COLUNAS_CREDENCIAL` e `codigoLegado` levam nomes de coluna da origem fora do conector.
