# F3. Cobertura funcional melhorada

**Objetivo:** o sistema novo faz **tudo** o que o SPDATA fazia, **melhorado**:
- desenho próprio;
- o que o MV tem a mais;
- boas práticas e normas da área.

O resultado **não é uma cópia do SPDATA.** O SPDATA diz **o que** o hospital precisa fazer, nunca **como**
o sistema novo faz.

**Entra:** F2; F1.3 do módulo; a análise cruzada do grupo (`docs/analise/`).
**Sai (portão):** todos os módulos com:
- 100% das funções do SPDATA cobertas;
- as melhorias registradas;
- os recursos do MV do grupo incluídos (ou postos na fila da F8, com o motivo);
- contrato de efeito e E2E verdes no MariaDB.

---

## Três fontes por módulo, com papéis diferentes

| Fonte | Papel | Nunca |
|---|---|---|
| **SPDATA** | Inventário do **que** o hospital usa: funções, relatórios e regras de negócio legítimas. É a **lista mínima**: nada pode faltar | Ser molde de fluxo, tela, estrutura ou contorno técnico (S/N, sentinelas, recálculo por gatilho, duplicidade) |
| **MV** | Referência do **sistema mais completo**: o que ele faz a mais e o que faz melhor, no mesmo assunto | Nomes, estrutura ou cópia de tela |
| **Boas práticas e normas** | ANS/TISS, regras do SUS, CFM, COFEN, ANVISA, LGPD, acreditação (ONA/JCI), padrões de interoperabilidade (FHIR/RNDS) | — |

Onde o SPDATA e o MV divergem, vale o que serve melhor ao hospital. Em caso de dúvida, segue-se o MV
(ADR 0002, item 12).

## Como cada módulo é feito

1. **Ficha funcional do módulo,** em termos de negócio. Junta as três fontes:
   - o que o hospital precisa fazer (lista mínima do SPDATA);
   - o que melhora (MV e boas práticas);
   - o que sai porque era contorno do sistema antigo, com o motivo.
2. **Desenho próprio** do fluxo e da tela, sobre o modelo próprio.
   - As telas do `new-sgh` são o **ponto de partida e são melhoradas**: menos cliques, validação na hora,
     atalhos e visão por paciente.
   - Nenhum fluxo é reproduzido só porque "no SPDATA era assim".
3. **Regras no domínio,** com teste.
   - A regra de negócio legítima do SPDATA é reescrita.
   - O contorno técnico não entra.
   - Nenhum gatilho com regra no MariaDB.
4. **Contrato de efeito por operação,** derivado do **desenho próprio**.
   - A captura de assinatura do SPDATA serve só para **conferir**:
     - que nenhuma função ficou para trás;
     - que o conector traduz o histórico corretamente.
   - Ela não é molde.
5. **Adaptadores próprios, telas ligadas e E2E** do módulo verdes no MariaDB.
6. **Trava contra "sistema com cara de SPDATA":** revisão adversarial por módulo.
   - Um revisor independente compara a ficha e as telas com o SPDATA e o MV e responde:
     - "o que aqui só repete o SPDATA sem ganho?";
     - "o que o MV faz melhor e ficou de fora?".
   - Achado de gravidade alta reabre o módulo.

## Marcos (um por grupo de módulos, na ordem do fluxo do paciente)

**Primeiro os motores.** A análise cruzada (`docs/analise/RESUMO.md`) mostrou que as lacunas mais pesadas
são regras que o SPDATA faz por gatilho. Elas vêm antes das telas de cada módulo, porque sem elas a
conciliação do dia 0 não fecha nos saldos nem nos totais de conta.

Os motores são **redesenhados**, não copiados:
- saldo e custo calculados no domínio, com histórico auditável;
- conta com itens versionados;
- repasse por regra configurável.

| Marco | Módulos | Destaques (lista mínima do SPDATA; as melhorias vêm na ficha de cada módulo) |
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
- ficha funcional com a lista mínima do SPDATA **100% coberta**, as melhorias e os recursos do MV do grupo;
- contrato de efeito e E2E do grupo verdes;
- revisão "sem cara de SPDATA" sem achado de gravidade alta.
