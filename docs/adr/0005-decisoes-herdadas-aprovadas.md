# ADR 0005: decisões de arquitetura herdadas do `new-sgh`, aprovadas pelo dono

- **Data:** 2026-11-21
- **Situação:** aceita (decisão do dono, no chat da obra, 2026-11-21)

## Contexto

O `sante-sgh` herdou código do `new-sgh` que dependia de ADRs de lá que ficaram só **propostos** (decididos por
agente, sem o aceite do dono), além de infraestrutura que nunca teve ADR. O dono revisou a lista numerada de 15 itens
e decidiu.

## Aprovados

| Item | Decisão | Origem |
|---|---|---|
| 1 | **Gotenberg** para gerar PDF/A, como serviço local da instalação | ADR 0020 do `new-sgh` |
| 2 | **Valkey + BullMQ** para fila do worker e trava entre processos | sem ADR |
| 3 | **Observabilidade:** OpenTelemetry sempre; Grafana e coletor opcionais por cliente/instalação | sem ADR |
| 5 | **BI e data mart pseudonimizado:** adiado para a F8; nada de ferramenta de BI no produto até lá | ADR 0025 do `new-sgh` |
| 6 | **Executor de operações** com receitas declarativas, núcleo de toda gravação | ADR 0017 do `new-sgh` |
| 7 | **Permissões com CASL** (sobre o modelo próprio de acesso) | ADR 0018 do `new-sgh` |
| 9 | **XML TISS só na versão 04.03.00**, com acompanhamento das versões novas da ANS | ADR 0014 do `new-sgh` |
| 10 | **BR Core (RNDS) com versão fixada** | ADR 0016 do `new-sgh` |
| 11 | **Estabelecimentos genéricos, vários hospitais por cliente** | ADR 0011 do `new-sgh` |
| 13 | **Notificação de incidentes** (qualidade e segurança do paciente) só no sistema novo | ADR 0031 (qualidade) do `new-sgh` |
| 14 | **"Login como" do suporte**, com auditoria | ADR 0021 do `new-sgh` |

## Pendentes com o dono

| Item | Assunto | Quando |
|---|---|---|
| 4 | QZ Tray e etiquetas/pulseiras em ZPL (impressão silenciosa exige certificado pago) | decidir |
| 8 | Padrão dos códigos de permissão próprios (proposta do agente da F2.4: `docs/obra/fatias/f24/saida/padroes.md`) | confirmar |
| 12 | Índice de pacientes da rede (MPI) em cada banco | revisar na F7 |
| 15 | Decisões de destino e descarte do conector (`F4-decisoes-destino.md`, `declarado/sem_carga.tsv`) | revisar com a carga da ProntoCardio |

## Regra para os agentes

- Decisão de arquitetura (serviço novo na instalação, padrão, biblioteca estrutural, formato de dado, armazenamento,
  descarte de dado do cliente) **não se toma em silêncio**.
- O agente pode construir pela melhor prática para não parar (POL-1 do `new-sgh`), mas registra a decisão como
  **proposta** neste diretório e a leva ao dono no próximo relatório.
- Só vira regra com o aceite do dono registrado.
- Os ADRs do `new-sgh` que não estão aqui não valem no `sante-sgh`.
