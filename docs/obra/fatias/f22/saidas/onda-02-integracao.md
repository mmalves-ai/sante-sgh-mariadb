# Integração da onda 2 da F2.2 (lotes 02-01 a 02-14)

- **Módulos ligados** (`REGISTRO_MODULOS`, 28 no total): entram assinatura, catalogos, consultas, contratualizacao,
  custos, documento, enfermagem, especialidades, exames, farmacia, faturamento, financeiro, implantacao, internacao,
  operadora, orcamento, patrimonio, portaria, precos, rede, rouparia, sessoes e suporte. A assinatura entrou depois do
  DDL que ela condicionava (pedido_assinatura, previa_assinatura, assinatura_icp, validacao_assinatura).
- **Typecheck cumulativo:** `apps/api/tsconfig.migrado.json` passa de 256 para 693 arquivos (fecho dos 14 lotes).
- **DDL aplicado** (só para frente, convenções do ADR 0002), gerado dos pedidos por script e conferido no banco vazio:
  13 pares `NN_tabelas.sql`/`NN_chaves.sql` em 01_SIS/02, 02_ADM/06, 03_CAD/06, 05_AGE/04, 06_PEP/14, 07_INT/05,
  09_HOT/05, 10_SADT/06, 12_FAT/08, 13_SUS/04, 14_FIN/11, 16_SGO/11 e 17_INTG/03. São 41 tabelas novas no catálogo e
  colunas, restrições e índices nas tabelas dos lotes. As chaves estrangeiras de cada pedido foram para o `_chaves.sql`.
  - Ajustes do integrador: o nome do CHECK `seletor` virou `ck_regra_faturabilidade_seletor` (o tipo JSON já cria um
    CHECK com o nome da coluna); duas FKs da meta contratual do SUS foram encurtadas (limite de 64 caracteres);
    `migracao_aplicada` ganhou as colunas de auditoria; a troca da UNIQUE da cota de depreciação cria antes o índice
    (bem, competência) que a FK do bem usa.
  - A baixa do enxoval passa a ter itens: as linhas existentes viram o item 1 de cada baixa (`09_HOT/05_chaves.sql`),
    antes de as colunas saírem do cabeçalho.
  - O DDL foi aplicado aos 8 clientes de dev e teste. Contagem igual ao banco de validação: 3564 tabelas e 13646 FKs.
- **Código ajustado ao DDL** (as portas foram escritas antes das colunas, e os CHECKs novos recusavam a gravação):
  - contratualização: o encerramento grava o motivo, o instante e o usuário;
  - agência transfusional: a invalidação grava `motivo_invalidacao`, e a leitura prefere a coluna à trilha;
  - operadora: o cancelamento da fatura e do reajuste grava o motivo, e o do reajuste também quem e quando;
    o pagamento da conta grava `pago_em` e o documento; a leitura do protocolo não duplica `operadora_saude_id`;
  - rouparia: a perda grava o item 1 em `baixa_enxoval_item`, e todo cancelamento guarda o instante e o motivo;
  - rede: o teste dos serviços compartilhados reconhece as tabelas novas, e a porta segue em 501 até ser escrita.
- **Ganchos do "login como" (pedido de fiação do lote 02-14):** a base cria `GanchosComoTardios`
  (`sessao/ganchos-como.ts`) e os entrega à sessão e ao `ContextoModulo.ganchosComo`. O `suporte/modulo.ts` liga a
  guarda, a reautenticação e o encerramento. Sem o suporte, nenhuma sessão "como" vale (falha fechada).
  O `unificacao-como.spec.ts`, que só roda com o suporte registrado, passou a montar a configuração de teste.
- **Testes de registro:** o exemplo de módulo "não migrado" passou de `faturamento`, já registrado, para `pep`.
- **Pedidos de modelo sem DDL**, que ficam para o lote dono: profilaxia_tev_decisao e o adendo da contenção (02-04);
  exame oftalmológico consolidado, versão do protocolo de quimioterapia, ciclo e eventos oncológicos, ciclo × prescrição,
  ordem do lactário, reanimação no registro de nascimento, fechamento do livro de controlados, parecer "revisão
  médica", conferência do controlado e dispensação ambulatorial (02-06); parecer_auditoria_conta, opcional (02-08).
  Até lá, as portas respondem `modelo-pendente`.
- **Pendências de código para as próximas ondas:** publicador de catálogos no worker (02-02); ALVOS_CONTINGENCIA e
  prescrição de cuidados do enfermeiro (02-04 e 02-05, bloqueante na enfermagem); ESTADO_PRONTUARIO global e
  AVISOS_FARMACIA (02-06); `app.module.ts` ainda importa a porta antiga do financeiro (desmontagem, última onda);
  autorizações por senha na operadora (02-10); arquivos de outras ondas que
  importavam utilitários removidos da rede (pep/infra/acesso-entre-hospitais.int.spec.ts, onda 4); a porta dos
  serviços compartilhados da rede sobre as tabelas novas (02-13); o inventário, o kit, as peças do envio e a perda de
  várias peças na rouparia (02-14); o "criar cliente" e a ferramenta de atualização das migrações ainda não gravam
  `migracao_aplicada`, que a conferência da instalação lê (02-08).
- **Provas:**
  - conferidor `--estrito` ok nos 14 lotes;
  - tsc 0 erros (migrado, login e contratos);
  - vitest da API: 137 arquivos, 923 testes verdes e 3 pulados;
  - vitest do núcleo: 73; vitest do domínio da enfermagem: 242;
  - validar_migracoes: 0 erros (3564 tabelas);
  - boot com API_MODULOS=todos: os 28 módulos sobem, e a rota da rouparia responde 401 (só a base: 404);
  - /api/saude 200 depois do subir-login;
  - legado restante: 623 arquivos (723 imports), 0 no fecho do login.
