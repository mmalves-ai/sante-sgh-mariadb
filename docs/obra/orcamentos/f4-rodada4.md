# Orçamento: f4-rodada4

estimativa_M: 69
teto_M: 90

- **Objetivo e critério de pronto:** fechar a F4 (conector) no branch `f4-conector` (worktree
  `../sante-sgh-wt/f4`): zero tabelas bloqueadas (hoje 64 de 1.185), Sincronizar (L9: a origem vence, a edição do
  destino fica guardada e visível) e relatório de conciliação (L10). Pronto quando:
  - `cobertura_conector.py --falhar-se-bloqueada` passa;
  - `conferir-fatia-f4.sh` dá ok em todas as fatias;
  - `verificar_mapa`, `conector.sh testes` e `validar_migracoes.py` passam;
  - o ponta a ponta do painel concilia 100%;
  - a prova do L9 com duas imagens sintéticas passa (alteração só de coluna, linhas novas, apagadas e antigas alteradas,
    edição manual no destino);
  - o relatório do L10 aparece no painel;
  - o orquestrador faz o merge no `main`.
- **Escopo:**
  1. Compartilhado, em sequência: pedidos de modelo (DDL) e o resíduo de motor (`regra_faltante` 13,
     `mecanismo_pedido` 4, desdobrar item, parâmetro, fonte de conta).
  2. As cerca de 21 fatias com bloqueio, em lotes de 3 fatias.
  3. Conferidor.
  4. L9.
  5. L10.
- **Agentes por papel:**

  | Papel | Agentes | Custo por agente | Total |
  |---|---|---|---|
  | Compartilhado | 2 | 4,5 M | 9 M |
  | Listar | 1 (esforço baixo) | 0,3 M | 0,3 M |
  | Construtor de lote de fatias | 7 | 2,5 M | 17,5 M |
  | Revisor | 7 | 0,5 M | 3,5 M |
  | Corretor | cerca de 5 | 0,8 M | 4 M |
  | Conferidor | 2 | 3,5 M | 7 M |
  | Refazer | até 3 | 1,5 M | 4,5 M |
  | L9 e L10 (construtor, revisor e corretor de cada um) | 2 × (4,5 + 0,5 + 0,8) | | 11,6 M |

- **Estimativa:** 57,4 × 1,2 ≈ 69 M equivalentes. Teto: 90 M. `LIMITE_AGENTES` = 40.
- **Economia:**
  - o brief da F4 vai colado no `PREFIXO`, idêntico para todos;
  - as fatias vão agrupadas em lotes de 3, para pagar o contexto 7 vezes e não 21;
  - o revisor lê só o diff;
  - o corretor recebe só os achados.
- **Isolamento (pedido do dono, 2026-11-21):** cada agente que roda testes de banco usa banco próprio.
  - As fatias usam o banco descartável do `conferir-fatia`.
  - O L9 e o L10 usam um cliente de teste com o nome do agente.
  - A plataforma está protegida pela trava `GET_LOCK` do `criar_cliente.py`.
- **Fora do escopo:** a F2.4 (trilha paralela, com orçamento próprio) e a revisão das decisões de destino pelo dono.
- **Riscos:**
  - o merge com o `main` em `db/migracoes`, que o orquestrador resolve;
  - fatia que dependa de DDL não aplicado, que vai para o conferidor.
