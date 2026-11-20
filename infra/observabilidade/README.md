# infra/observabilidade (M09)

OpenTelemetry + Grafana (Prometheus, Tempo, Loki) e o coletor `MON$` do Firebird, só em loopback.

- **Coletor e armazenamento**: serviço `otel` do Compose `sgh` (`sgh-otel`, imagem `grafana/otel-lgtm`
  com tag e digest): recebe OTLP/HTTP em `127.0.0.1:3331` e guarda métricas (Prometheus), rastros (Tempo) e
  logs (Loki) no volume `sgh-otel-dados`. Nada publicado além do OTLP.
- **Quem exporta**: a API (`sgh-api`: latência e erros por rota, rastros das consultas ao Firebird sem valor
  de parâmetro) e o worker (`sgh-worker`: coletor `MON$` a cada 15 s, saúde do Gotenberg e do S3), quando
  `OTEL_EXPORTER_URL=http://127.0.0.1:3331` está no ambiente do processo. Sem a chave, nada é exportado.
- **Grafana** (`127.0.0.1:3330`): fontes de dados e painéis provisionados por arquivo
  (`grafana/provisionamento/`, `grafana/paineis/`), pasta "SGH": **Banco e coexistência** (`sgh-banco`),
  **Técnico** (`sgh-tecnico`), **Jornadas** (`sgh-jornadas`) e, no M38, **Linha de base da onda 0**
  (`sgh-linha-de-base-onda0`: CPU e disco do servidor do banco pelo node_exporter montado no deploy, transações,
  conexões por sistema, OIT/OAT, consultas lentas, as operações-chave do outro sistema e os SLIs da onda, cada
  série com o "antes" deslocado pelo período de comparação). Leitura anônima (Viewer) só em loopback; a
  senha padrão do administrador segue pendente com o dono (M01). Os painéis são regenerados pelo JSON do
  repositório (edição pela interface não é salva).
- **Alerta direto** (regra 13 da ficha do M09): o worker registra no log `alerta do vigia: …` com o anexo
  (`MON$ATTACHMENT_ID`) e a marca da conexão do novo (`sgh:<rede>:<estab>:<processo>`); o painel mostra a
  transação mais longa do novo contra o limite (`VIGIA_TRANSACAO_LIMITE_MS`, padrão 5 s).
