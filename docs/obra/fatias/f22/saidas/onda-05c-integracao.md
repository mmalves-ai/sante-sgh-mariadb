# Onda 5c, integração (lotes 05-02, 05-03, 05-04, 05-05, 05-16)

- **Lotes:** 05-02 a 05-05 removem os specs da cópia do sistema de origem (ADR 0003; mapa de cobertura em
  `saida/<lote>.json`); 05-05 reescreve `trilha.int.spec.ts`; 05-16 leva o worker (relay do outbox, lista de trabalho de
  imagem, validade do conselho, MPI da rede, catálogos) ao MariaDB e apaga `representacao-pep`.
- **DDL aplicado** (ADR 0002, só para frente; validar_migracoes 0 erros, 3606 tabelas, 13802 FKs; aplicado aos 10
  clientes de dev e teste):
  - `15_RH/06_tabelas.sql`: `retrato_validade_conselho` (05-16), com linha no catálogo da modelagem;
  - `10_SADT/08_tabelas.sql`: `uq_item_lista_trabalho_imagem_exame_vigente` sobre coluna gerada (05-16);
  - `12_FAT/11_tabelas.sql`: `uq_lote_tiss_conta_conta_sem_guia` sobre coluna gerada `conta_sem_guia_id` (05-02; sem a
    sentinela 0 do pedido: a coluna só tem valor na linha sem guia).
- **Outros aplicados:** `worker.module.ts` sem a representação do PEP; 44 exceções órfãs do `guardas-legado.ts`
  (specs apagados) removidas; `packages/testes/src/m45` (fixture do adaptador antigo) apagado; `regras-no-banco` prova a
  recusa da conta sem guia e a chave do item vigente; o retrato do conselho prova a gravação e a refeitura no dia.
- **Não aplicados** (ficam como pedido): DDL `trilha_auditoria_fecho` + fecho/verificação no núcleo e job (05-05);
  DDL condicional do recém-nascido, versão do protocolo de quimioterapia e protocolo da receita do enfermeiro (05-03);
  portas próprias pedidas como `adaptador`/`operacao-faltante` (prescrição, gravação do registro clínico, reajuste de
  preços, formulário novo, índice de UTI/classificação, SAE, OPME, manipulação, lactário, quimioterapia, catraca,
  anestesia/bloco seguro, serviço social, oftalmologia, licitação); aplicador incremental de migrações (05-05); mover
  `PortaRedePropria` para pacote comum, `cicloRelayOutbox` para o núcleo e `validade-conselho` para o domínio (05-16);
  `WORKER_CLIENTES` na instalação; leitura da validade do conselho na folha; modalidade no conector; specs de
  integração pedidos (05-04) e cenários sem prova (05-02 a 05-05).
