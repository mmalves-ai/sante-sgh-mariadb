# Orçamento: carga-nucleo

estimativa_M: 16
teto_M: 21

- **Achado (22/11, 14h05):** a carga real da ProntoCardio grava pacientes (47.063) e itens faturáveis (265.117), mas:
  - **0 profissionais;**
  - **0 atendimentos:** os 209.147 são recusados por `estabelecimento_ausente`, porque o estabelecimento é recusado
    por CHECK (`restricao_destino_4025`);
  - **0 regras de preço particular.**
  - A conciliação marcou tudo como "conferido" (recusa conta como conciliada), e a execução saiu "concluída".
- **Objetivo:**
  - a cadeia principal entra com recusa só justificada: estabelecimento, usuário, profissional, agenda, marcação,
    atendimento, conta e itens, preço particular e repasse;
  - prova num recorte da cópia real, antes de recomeçar a carga completa;
  - recusa em massa numa entidade principal deixa a execução vermelha.
- **Agentes por papel:**
  - diagnóstico na cópia real: 1 × 2,5 M;
  - correção por causa: até 3 × 2 M;
  - revisão adversarial em 2 lentes (correção e continuidade): 2 × 0,6 M;
  - corretor: 1 × 1,5 M;
  - conferidor: 1 × 2 M.
  - Soma 13,2 M × 1,2 = **16 M**; teto 30% acima = **21 M**.
