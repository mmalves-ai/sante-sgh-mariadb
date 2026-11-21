# F2.4, lote 16-misto-financeiro (financeiro + ADT + enfermagem)

## O que mudou
- **Financeiro (porta própria):** saíram as três recusas `modelo-pendente`.
  - Glosa no título: toda glosa fica registrada em `glosa_titulo_receber` (situação, valor, motivo, meio e item). A que chega por evento leva a chave do evento: o mesmo evento entregue de novo devolve a glosa gravada (`repetida: true`) sem somar o valor.
  - NFS-e simulada, DMED e EFD-REINF geradas ficam em `arquivo_fiscal_gerado`, com o hash do arquivo. O mesmo hash devolve o registro existente. As listas fiscais (`nfse`, `declaracao`) juntam `nota_servico` e `declaracao_dmed` com os arquivos gerados, da mais recente para a mais antiga.
  - O teste de integração passou a provar a gravação, a repetição pelo hash e a glosa por evento sem soma dupla. As somas impressas continuam iguais: 60 + 30 + 40 = 130, aceita 60, recurso 40.
- **NIR (núcleo interno de regulação):** os limites de permanência leem e gravam `limite_permanencia`.
  - A alteração exige motivo, e o valor anterior fica na trilha.
  - A remoção volta ao padrão. A chave sem limite próprio é recusada com `limite-inexistente`.
- **Nomes do sistema de origem:**
  - comentários reescritos com termos de negócio, em 20 arquivos de contratos, domínio e API;
  - `tabelaAlvo` da trilha trocado para as tabelas próprias: `internacao`, `agendamento_internacao`, `leito_hospitalar` e `movimento_prontuario`.
- **Vocabulário (web do ADT):**
  - `paraHhmm` saiu: as telas de alta e pré-internação mandam a hora em HH:MM, que é o que o contrato de entrada (`esquemaHora`) exige.
  - `hhmm` ficou, corrigido pela revisão: quatro telas fora de qualquer lote (`PreInternacaoTela`, `ResumoInternacao`, `TrocasTela` e `HistoricoOcupacaoTela`) o usam para exibir a hora. A API do ADT ainda devolve a hora em quatro dígitos (`civil().hhmm`). Agora o auxiliar aceita as duas formas, e o spec cobre `1430`, `14:30`, vazio e nulo. Ele sai quando a resposta da API passar a HH:MM (pedido no JSON).
  - O comentário de `minutosDoDia` diz `"HH:MM"`.

## Decisões pela melhor prática
- A glosa da tela também é registrada, não só a do evento. Assim o título tem o histórico de cada glosa, além dos totais. O retorno passou a ser o id da glosa.
- O limite de permanência removido é apagado fisicamente, porque a tabela não tem exclusão lógica. O retrato fica na trilha da operação.
- A classificação tributária e o item de serviço da NFS-e vão no `leiaute` do arquivo gerado. A tabela não tem colunas próprias para eles.

## Pedidos (ver 16-misto-financeiro.json)
- DDL `atributo_categoria_acomodacao`: atributos padrão por tipo de acomodação.
- DDL `ocorrencia_arquivo_prontuario`: registros do SAME (arquivo de prontuários) sem movimento.
  - Enquanto as duas tabelas não existem, `adt/porta-propria.ts` mantém a recusa `modelo-pendente`. Essa é a única dívida que resta no lote.
- Respostas do ADT em HH:MM: `porta-propria.ts`, `porta-memoria.ts`, `servico.ts` e `diariasFaturaveis` trocados juntos, com as quatro telas. Depois disso, `hhmm` sai da web.
- Enfermagem: trocar os padrões de turno `'0700'` por `'07:00'`, para `minutosDoDia` ficar estrito.
- Fora do escopo do lote, para registro:
  - o histograma da calibragem e as cirurgias que pedem UTI no NIR seguem sem linhas, à espera do vínculo do agendamento cirúrgico com o pedido de leito;
  - a faixa etária do leito já tem colunas, mas a porta ainda não as grava.

## Fora da lista (avisado)
- `apps/api/src/modulos/financeiro/aplicacao/massa-banco.spec-util.ts`: a limpeza da massa apaga agora também `glosa_titulo_receber` e `arquivo_fiscal_gerado` antes dos títulos. Sem isso, a FK impedia a limpeza na segunda execução. São 2 linhas, só no teste.
- O cliente de teste `f24_16mistofinanceiro` recebeu os catálogos públicos (`catalogos/carregar.py`: ibge, bcb, cid10 e sigtap), porque a massa do ADT exige um procedimento do SIGTAP (tabela de procedimentos do SUS).
