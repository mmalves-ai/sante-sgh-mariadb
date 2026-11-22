# Orçamento: velocidade-carga

estimativa_M: 7
teto_M: 9

- **Medição na carga real da ProntoCardio (execução 3, 22/11, 6h53):** a carga pelo mapa grava cerca de 1.400 linhas
  por segundo (84 mil linhas por minuto em `conector_origem`). A origem tem 195 milhões de registros; nesse ritmo,
  são mais de 30 horas.
- **Objetivo:** pelo menos 10 vezes mais rápido, com a mesma conciliação, idempotência e pendências. Caminhos:
  - gravação em lote (`executemany` / INSERT de várias linhas) no lugar de linha a linha;
  - savepoint por bloco, com nova tentativa linha a linha só no bloco que falhar;
  - commit por bloco;
  - leitura da origem em blocos;
  - paralelismo entre tabelas independentes da mesma onda do plano.
- **Agentes por papel:** construtor 1 × 3,5 M; revisor 1 × 0,6 M; corretor 1 × 1,5 M. Soma 5,6 M × 1,2 = **7 M**;
  teto 30% acima = **9 M**.
- **Prova:**
  - medição antes e depois na cópia real, só com contagens, num cliente próprio sobre um recorte de tabelas grandes;
  - suíte do conector verde;
  - autoconferência das 57 fatias verde.
