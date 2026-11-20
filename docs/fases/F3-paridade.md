# F3. Paridade funcional com o SPDATA

**Objetivo:** tudo o que a Rede Santé usa hoje no SPDATA funcionando no sistema novo sobre o banco
próprio. As regras que estavam nos gatilhos e procedures do SPDATA passam a ser escritas no domínio, com
teste.

**Entra:** F2; F1.3 do módulo; decisões F3 da F1.1.
**Sai (portão):** todos os módulos marcados F3 com as operações cobertas por contrato de efeito verde e as
telas do `new-sgh` ligadas ao MariaDB.

---

## Como cada módulo é feito

1. **Inventário das regras.**
   - Ler os gatilhos e procedures do SPDATA que tocam as tabelas do módulo: PSQL, catálogo de operações e
     capturas de assinatura do `new-sgh`.
   - Marcar o que o sistema novo reproduz e o que não reproduz, com o motivo.
2. **Regra no domínio.**
   - Cada regra vira função de domínio testada: custo médio, saldo, totais de conta, numeração,
     situação, consistências.
   - Nenhum gatilho com regra no MariaDB.
3. **Contrato de efeito por operação.**
   - Diz o que a operação deixa no banco.
   - **Deriva da captura de assinatura** do `new-sgh`, ou de uma captura nova numa imagem restaurada.
   - Divergência intencional em relação ao SPDATA fica registrada no contrato, com o motivo.
4. **Adaptadores "próprio"** das portas do módulo.
5. **Telas do `new-sgh` ligadas,** com os E2E do módulo verdes no MariaDB.
6. **Recursos F3 apontados pela análise** que o `new-sgh` ainda não tem: as lacunas frente ao SPDATA.

## Marcos (um por grupo de módulos, na ordem do fluxo do paciente)

**Primeiro os motores.** A análise cruzada (`docs/analise/RESUMO.md`) mostrou que as lacunas mais pesadas
são regras que o SPDATA faz por gatilho. Elas vêm antes das telas de cada módulo, porque sem elas a
conciliação do dia 0 não fecha nos saldos nem nos totais de conta.

| Marco | Módulos | Destaques de regra (vindas dos gatilhos do SPDATA) |
|---|---|---|
| F3.0 | **Motores** | **Conta** (abertura na admissão, lançamento de itens, totais), **estoque** (saldo por local e lote, item da conta, custo médio), **repasse** (integração com o faturamento), **unificação de prontuários** |
| F3.1 | Cadastros-base e catálogos de uso interno | Unicidade de paciente, vínculos com convênio, estrutura física |
| F3.2 | Recepção, agenda e atendimento | Numeração de atendimento, senhas, regras de agenda |
| F3.3 | Prontuário, prescrição e enfermagem | Versões imutáveis, assinatura, aprazamento, checagem |
| F3.4 | Internação, leitos e centro cirúrgico | Situação do leito, censo, mapa cirúrgico |
| F3.5 | Diagnóstico (SADT) | Pedido, coleta, laudo, numeração de laudo |
| F3.6 | Farmácia e suprimentos | **Saldo por local, lote e validade; custo médio;** dispensação |
| F3.7 | Faturamento de convênio, TISS e SUS | **Totais de conta,** lançamento de itens, guias, lotes, glosa, repasse |
| F3.8 | Financeiro, fiscal e contábil | Contas a pagar e a receber, tesouraria, NFS-e, integração contábil |
| F3.9 | Hotelaria, SAME, manutenção, pessoas, relatórios | Conforme a análise |

**Aceite de cada marco:**
- contrato de efeito verde de todas as operações do grupo;
- E2E do grupo verde;
- lista de regras do SPDATA reproduzidas e não reproduzidas, revisada.
