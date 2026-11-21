# F2.4, lote 24-misto-especialidades

Cliente de teste: `f24_24mistoespecialidade`. Pedidos em `24-misto-especialidades.json`.

## O que mudou

- **Rouparia (porta própria):** sem nenhuma recusa `modelo-pendente`.
  - O inventário do enxoval grava `inventario_enxoval` e `inventario_enxoval_item`. Ele entra na lista dos movimentos
    (dígito 6 do número composto), na leitura `inventarios` do painel e no cancelamento.
  - O kit grava a composição em `peca_enxoval_composicao` e a lê de volta. A mudança reativa, altera ou exclui as
    linhas sem duplicar. Um kit dentro de outro kit é recusado com `kit-dentro-de-kit`.
  - A perda de várias peças grava uma linha de `baixa_enxoval_item` por peça.
  - O teste de integração cobre o kit, a perda de várias peças, o inventário e a separação entre estabelecimentos.
- **Portaria (porta própria):** sobra uma recusa só, a passagem pela catraca, que depende de pedido de DDL.
  - A regra de visita grava e lê a idade mínima, a conduta no isolamento, a duração máxima e a observação.
  - O bloqueio grava e lê o limite de visitantes, a inclusão do acompanhante e o documento da ordem judicial.
  - O local que não é setor cadastrado vai para `visita.local_destino`. O local vazio é recusado com
    `destino-obrigatorio`.
  - O expurgo anonimiza o cadastro do visitante com a guarda vencida e marca `anonimizada_em`. O prazo da guarda é
    `guarda_ate`; sem ele, conta a última visita mais o prazo padrão. O expurgo devolve as fotos a apagar.
    - O prazo padrão é o da guarda do estabelecimento (parâmetro da portaria, de 30 a 1825 dias): o controller o passa
      ao expurgo (`retencaoDias`), e a contagem de vencidos usa o mesmo prazo. O teste cobre 90 e 1825 dias.
    - O cadastro já anonimizado não volta a contar.
- **Sessões e janela de publicação:** a hora agora é `HH:MM`.
  - O contrato já pedia `HH:MM`; a tela da série de sessões (`AgendaSessoesTela.vue`, fora de qualquer lote) passou a
    começar em `08:00` com 5 caracteres, e o e2e `m50-6` digita `08:00`/`08:30`. Sem isso, a série não gravava.
  - A história `hora` do catálogo de UI continua em `0801` até o `SanteHora.vue` migrar (pedido no json).
- **Comentários e dados com nome de origem**, reescritos em termos de negócio:
  - auditoria/eventos, início, liberação, orçamento, prontidão, sessão, texto, hotelaria e organização;
  - a descrição do evento "convênio suspenso".

## Decisões pela melhor prática (para o dono ver)

1. **Lista de alvos da trilha de origem, apagada.** `ALVOS_TRILHA_LEGADO` e `esquemaRegistrarEventoLegado` saíram de
   `auditoria/eventos.ts`. Eram a gravação na trilha do sistema de origem, que o produto não faz, e não tinham uso
   fora do arquivo.
2. **Códigos de baixa confiança da onda 2, apagados.** `CODIGOS_BAIXA_CONFIANCA_ONDA_2` saiu de `onda2.ts` e do teste.
   - Eram valores de colunas da origem que precisavam ser confirmados com a área. Decodificar a origem é tarefa do
     conector.
   - O `conector/mapa/colunas.tsv` já marca essas colunas como "sem evidência do significado".
   - O tipo `CodigoBaixaConfianca` continua, porque o faturamento o usa.
3. **O inventário conta peças.** O peso informado é recusado com `inventario-sem-peso`, porque o modelo não o guarda e
   descartá-lo calado seria perder dado.
4. **O bloqueio "por limite"** é gravado como bloqueio do paciente com `limite_visitantes`. O CHECK de abrangência
   não mudou, e a leitura devolve "limite" quando há limite. O limite fora da abrangência "limite", ou a abrangência
   sem limite, é recusado com `limite-invalido`.
5. **A anonimização mantém as visitas** ligadas ao cadastro anônimo, para o histórico seguir contável. Ela apaga
   nome social, nascimento, documentos, telefone, e-mail, empresa, foto e motivo de restrição.
6. **A composição do kit** é excluída de forma lógica (com quem e quando) e volta a ser usada pela chave única
   kit × peça.

## Pedidos

- **DDL em `evento_acesso_portaria`:** a ligação com `terminal_acesso`. É o que falta para gravar a passagem pela
  catraca.
- **Remover a regra 15 da onda 2.** Ela toca `contratos/onda2` e `dominio-config/onda2`, e o domínio não está em
  nenhum lote.
  - A regra listava tabelas da origem que os gatilhos gravam, o que não existe no banco próprio.
  - São as 17 ocorrências que restam em `onda2.ts`.
- **Apagar `formatacao/hora-legada.ts`** quando `agenda/exame.ts` e `portal/agenda-online.ts` migrarem (padroes.md,
  seção 1).
- **`SanteHora.vue`** ainda carrega `HHMM`. O verificador não lê arquivos `.vue`.

## O que falta neste lote

- **`especialidades/porta-propria.ts`:** as 15 gravações recusam com `modelo-pendente`, e as leituras delas voltam
  vazias. O DDL já está aplicado em `ddl-aplicado.md` (arq. 02-06). Falta ligar a porta:
  - o exame oftalmológico;
  - o protocolo oncológico versionado e a revogação;
  - o ciclo e a sua validação, o andamento e o ajuste;
  - a ligação com a prescrição e o desligamento;
  - o evento oncológico;
  - o recém-nascido;
  - a ordem do lactário e o seu histórico (`preparo_lactario` e `preparo_lactario_evento`).
- **`nutricao/porta-propria.ts`:** 9 gravações e as leituras delas. As tabelas já existem: `06_PEP/15` e `09_HOT/06`.
  - `acompanhamento_terapia_nutricional`;
  - `registro_social` e o adendo;
  - `correcao_registro_nutricao`;
  - `avaliacao_nutricao_parenteral`;
  - `plano_refeicao_acompanhante` e o registro de alteração da hotelaria.
