# Orçamento: f78-fichas

estimativa_M: 23
teto_M: 30

- **Por quê:** o prazo de 27/11 precisa de número para a F7 (recursos exigidos para vender: 109 funcionalidades na
  análise) e a F8 (recursos novos: 104). Parte já foi construída junto com a F3 (as fichas da F3 marcam linhas
  "coberta (cenários: f8)"). Sem ficha com a situação conferida no código, não há como fatiar nem medir.
- **Agentes:** 9 inventariantes, um por arquivo de grupo de `docs/analise/0N-*.md`, só leitura de código (nenhum teste
  pesado, nenhuma trava), cada um escreve `docs/fases/fichas/F78-0N-<grupo>.md` no formato das fichas da F3 (linha,
  o que o hospital faz, onde o código cumpre, situação coberta/parcial/falta conferida no código) × 2,5 M ≈ 23 M;
  teto 30 M.
- **Saída:** contagem por script (cobertas, parciais, faltam) por grupo e por fase, que alimenta o fatiamento das
  rodadas de construção da F7 e da F8.
