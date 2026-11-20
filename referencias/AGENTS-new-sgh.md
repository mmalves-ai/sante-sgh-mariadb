# Instruções para agentes de IA (qualquer ferramenta)

Projeto Sante SGH: sistema hospitalar que convive com o sistema anterior sobre o mesmo banco Firebird.

- Comece por `planejamento/ESTADO.md`, que diz em que pé a obra está, as autorizações do dono e os bloqueios.
- Se o `ESTADO.md` disser que a obra está **PAUSADA**, ou se o dono disser "retomar", siga
  `planejamento/RETOMADA.md` do começo ao fim.
- O roteiro de construção, com uma ficha por marco, está em `planejamento/instrucoes-construcao-sante-sgh.md`.
- As regras invioláveis estão em `planejamento/obra/agendador.js` (constante `REGRAS`), resumidas em
  `planejamento/RETOMADA.md` §3.
- **Tarefa longa (regra obrigatória, 18/11/2026):** siga `planejamento/obra/protocolo-tokens.md`, com sessões curtas, contexto
  mínimo e relatório ao dono a cada 50 minutos (tarefas em termos da área, % e tempo de cada uma, completude e previsão
  geral). Ao começar, avise: "Rodando sob o protocolo de otimização de tokens e reports periódicos".
- **Programa CRUD completo: PARADO pelo dono em 19/11/2026 (parada graciosa).** Se o dono disser "continue", "retome",
  "volta a obra" ou algo parecido, NÃO pergunte nada; faça você mesmo, nesta ordem:
  1. avise "Rodando sob o protocolo de otimização de tokens e reports periódicos";
  2. `bash /home/mmalves/workspace/redesante/obra-sgh/crud/continuar.sh` (tira a pausa e confere/sobe cópias, vigia e
     dev; mostra o estado; se disser ATENÇÃO, resolva antes);
  3. `Workflow({ scriptPath: '/home/mmalves/workspace/redesante/obra-sgh/crud/crud-continuar.js' })`, sem args. Ele
     lê o estado no git e continua de onde parou. Se terminar com "rode de novo", relance;
  4. relatório ao dono a cada 50 min (`python3 obra-sgh/crud/status.py`, CronCreate one-shot que se reagenda) e
     Monitor do `obra-sgh/logs/vigia-vm.log`.

  Se o dono pedir para parar: `touch obra-sgh/crud/PAUSA`. As sessões terminam a parte em que estão e o roteiro
  encerra sozinho. Detalhe e lições: `planejamento/obra/crud-parada-2026-11-19.md`.
