# Onda 5d, integração (lotes 05-12, 05-15, 05-17)

- **Lotes:** 05-12 leva a contabilização e a leitura dos fatos do worker à porta própria (contabilização automática
  recusa `modelo-pendente`); 05-15 leva censo, classificação, NIR, contratos, índice de busca e e-mail ao MariaDB e
  remove o retrato de coexistência; 05-17 troca o vigia do banco de origem pelo vigia do banco próprio, remove as
  vigias de gravação, parecer e tabelas vazias e leva o envio agendado de relatórios ao banco. Legado: 0.
- **DDL aplicado** (ADR 0002, só para frente; validar_migracoes 0 erros; aplicado aos 10 clientes de dev e teste):
  `03_CAD/08_tabelas.sql`, índices de `criado_em` e `alterado_em` em paciente, pessoa_fisica, profissional e
  solicitante_externo (05-15, leitura incremental do índice de busca).
- **Outros aplicados:** `worker.module.ts` sem o retrato de coexistência; `coexistencia-retrato.service.ts` e
  `vigia-vazias.ts` apagados; código morto dos alertas de tabela vazia e de divergência de gravação removido
  (`email.service.ts`, `relay-outbox.ts`); parâmetros `alerta.email.{auditoria,encarregado,plantao,ti,
  responsavelTecnico}` (nível rede, texto com formato de lista de e-mails) em `PARAMETROS_NOVOS`; instalação:
  `VIGIA_BANCO`, `VIGIA_BANCO_MS`, `VIGIA_TRANSACAO_LIMITE_MS` e `WORKER_CLIENTES` entram, 22 variáveis obsoletas saem
  (vigias da coexistência, `CONTABIL_EMPRESA`, destinatários de e-mail por variável, representação do PEP, catálogo e
  impressões homologadas); `VIGIA_BANCO` no lugar de `VIGIA_FIREBIRD` no vitest do worker.
- **Não aplicados** (ficam como pedido): DDL `marca_processamento` (exige o worker do índice adotar a marca gravada);
  `fechamento_censo.versao_calculo/hora_fechamento` (hoje no JSON do resumo); DDL do agendamento de relatório
  (decisão do dono: só link ou anexo/condição; validade do link; vocabulário `forma_envio`); refatoração
  `gravacao-contabil-comum`, publicação dos fatos pelos módulos de origem e regras publicadas (com o 04-01); limpeza de
  `ciclo.ts`/`fontes.ts` do domínio contábil; contrato `esquemaJobEnvioRelatorio` com `cliente`; jobId determinístico do
  "enviar agora"; `proximoEnvio` até o dia 31; recusa de anexo/formato/condição no cadastro; avaliação "só com
  linhas"; alerta do envio reservado há mais de 15 min; privilégio PROCESS do usuário de leitura; painel Grafana
  `sgh.banco.*`; `TIPOS_INTENSIVA_PADRAO` e `internacao.acomodacao.intensiva`; `bloco` → `unidade`; antecedência
  própria do contrato no domínio; leitura do censo fechado pela API; rede na carga `alerta-suporte`; carregador de
  `parametro_definicao` a partir de `PARAMETROS_NOVOS`.
