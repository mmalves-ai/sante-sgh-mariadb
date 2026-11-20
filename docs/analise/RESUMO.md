# Análise cruzada: resultado da primeira rodada

Primeira rodada da matriz funcional (marco F1.1), feita em 2026-11-20 sobre três fontes:
- o dicionário do MV: 8.867 tabelas, já sem backups e temporárias;
- a matriz das 1.503 tabelas com dados do SPDATA;
- o código e o estado do `new-sgh`.

Oito grupos de módulos foram analisados em paralelo, e um crítico de completude procurou áreas sem dono e
contradições. Detalhe por grupo em `docs/analise/01` a `09`. Só metadados foram lidos; nenhum conteúdo
de linha.

## Números consolidados

| Grupo | Funcionalidades | F3 paridade | F7 vender | F8 novo | Não fazer | Entidades propostas |
|---|---:|---:|---:|---:|---:|---:|
| 01 Administração, segurança e BI | 55 | 33 | 2 | 8 | 12 | 110 |
| 02 Cadastro, recepção e agenda | 59 | 36 | 5 | 14 | 4 | 115 |
| 03 Prontuário | 61 | 35 | 8 | 15 | 3 | 139 |
| 04 Internação, cirurgia, CME e hotelaria | 66 | 30 | 17 | 16 | 3 | 186 |
| 05 Diagnóstico e suprimentos | 59 | 36 | 10 | 9 | 4 | 232 |
| 06 Faturamento (convênio, TISS, SUS) | 65 | 40 | 15 | 9 | 1 | 227 |
| 07 Financeiro, fiscal, contábil e pessoas | 69 | 20 | 26 | 16 | 7 | 228 |
| 08 Operadora própria e integrações | 48 | 15 | 19 | 6 | 8 | 161 |
| 09 Áreas sem dono (crítico) | 29 | 2 | 7 | 11 | 9 | 28 |
| **Total** | **511** | **247** | **109** | **104** | **51** | **1.426** |

**O que os números dizem:**

- **Entidades distintas.** As 1.426 entidades propostas viram **cerca de 1.376 nomes distintos**, e menos
  ainda depois da unificação de vocabulário (28 conceitos com mais de um nome). O modelo próprio deve
  ficar na faixa de 1.000 a 1.300 tabelas. É menos que as 1.503 com dados do SPDATA e muito menos que as
  8.867 do MV, e cobre as duas.
- **Paridade (F3):** 247 funcionalidades. É o que a Rede Santé usa hoje e que tem de funcionar no dia
  2+n. É o maior bloco do plano.
- **Exigido para vender (F7):** 109 funcionalidades. Concentra-se em financeiro e fiscal, operadora,
  integrações e internação e cirurgia. Exemplos: CME com rastreio, contratos, OPME, login corporativo e
  obrigações legais.
- **Recurso novo (F8):** 104 funcionalidades, inspiradas no MV, para depois da virada.

## A lição principal: o que o SPDATA fazia por gatilho

Os oito grupos chegaram à mesma conclusão. As **lacunas mais pesadas do `new-sgh`** frente ao SPDATA são
regras que, no legado, moram em gatilhos. O `new-sgh` hoje só confere o efeito delas. No banco próprio,
elas têm de ser escritas no domínio:

| Área | Regra que vira domínio | Situação no `new-sgh` |
|---|---|---|
| Internação | A admissão gera conta, guia, ocupação e diária | Herdada dos gatilhos; sem regra no domínio |
| Faturamento | Lançamento de itens na conta (diárias, honorários, SADT, mat/med) | Desligado; reprodução de 0,75% (mat/med) a 94,60% (diárias e taxas) |
| Suprimentos | Saldo por local e lote, item da conta, custo médio | Movimentos de estoque desligados até o cenário controlado |
| Repasse | Integração do faturamento com o repasse médico | Teste dourado em 51% contra a meta de 97% |
| Cadastro | Unificação de prontuários (a carga do dia 0 traz duplicatas) | Completa, mas desligada |
| Prontuário | 67 modelos de registro clínico em uso; alergia dentro do formulário | 3 de 10 modelos liberados |

**Consequência para o plano:** a F3 começa por esses **motores** (conta, estoque, admissão, repasse),
antes das telas de cada módulo. Sem eles, a conciliação do dia 0 não fecha nos saldos e nos totais de
conta.

## Recursos do MV que mais valem a pena (em palavras próprias)

**F7, exigidos para vender:**

1. **Central de material e esterilização com rastreio completo:** caixa, ciclo, indicadores, etiqueta e
   vínculo ao paciente.
2. **Microbiologia estruturada:** germe isolado e antibiograma, que alimentam a CCIH.
3. **Dose unitarizada com identificador único,** lido na checagem à beira do leito.
4. **Autorização prévia eletrônica TISS:** SP/SADT, internação, prorrogação, quimioterapia e OPME, com
   resposta por item.
5. **Login corporativo** (LDAP, AD, SSO).
6. **Contratos com fornecedores:** vigência, aditivo, reajuste e saldo.

**F8, recursos novos de alto valor:**

1. **Protocolos clínicos gerenciados** (sepse, dor torácica, AVC), com critério automático de entrada e
   metas de tempo.
2. **Central de comando assistencial,** com risco clínico e alertas a quem precisa agir.
3. **Controle orçamentário que age na operação,** na compra, na nota e no título.
4. **Consolidação gerencial das empresas da Rede,** com DRE consolidada.
5. **Remuneração médica variável,** por produtividade, mínimo garantido e resultado.
6. **Simulação de cenários de receita,** como troca de tabela e reajuste.
7. **Agendamento inteligente:** preparo por fonte pagadora, conflito entre itens, cotas por operadora.
8. **Portal do beneficiário e reembolso completo** (operadora), com mensagens pela Hal-AI.

## Decisões que o dono precisa tomar (arbitragens)

O crítico encontrou 13 funcionalidades com decisões diferentes entre grupos e propôs uma arbitragem para
cada uma. Se forem aceitas, **a paridade cresce em cerca de seis funcionalidades**, que passam a ser
condição da virada:

| Funcionalidade | Proposta |
|---|---|
| Regulação de leitos e consultas pela central estadual | Paridade (F3) |
| Elegibilidade e autorização eletrônica com a operadora | Paridade (F3); o bloqueio sem elegibilidade fica F7 |
| Declaração de óbito | Paridade (F3) |
| Ficha e liberação de antimicrobianos | Paridade (F3) |
| OPME, caução do particular, contratos com fornecedores | F7 |
| Declaração de nascido vivo | F7, ou F3 se o ProntoCardio fizer partos |
| Compras públicas e empenho | Depende de o alvo incluir hospital com recurso público |

## Próximos passos

1. **O dono valida as arbitragens.** A mais importante é a de compras públicas: o alvo inclui hospital
   filantrópico com recurso público?
2. **Segunda rodada da análise:**
   - abrir o grupo de qualidade e segurança do paciente (154 tabelas sem dono);
   - fechar o **vocabulário único**, por exemplo "fonte pagadora" e mecanismos únicos de parâmetro,
     alçada, pendência e alerta;
   - aplicar o "dono" de cada entidade, para que nasça uma vez só.
3. **ADR 0002 (princípios do modelo)** e início do DDL por módulo (F1.2 e F1.3).
