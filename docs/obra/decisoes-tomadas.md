# Decisões tomadas pela obra (para o dono revisar no fim do projeto)

Por ordem do dono (25/11/2026, 00h10): a obra não para para perguntar. Cada decisão segue a melhor prática de mercado,
a coerência do produto e a qualidade; as críticas são informadas no relatório seguinte. Cada linha diz o que foi
decidido, por quê e como desfazer. O dono altera o que quiser ao final.

| # | Data | Assunto | Decisão | Motivo | Como desfazer |
|---|---|---|---|---|---|
| 1 | 25/11 23h59 | Teste do faturamento SUS (`sus.spec`) | Toda permissão `faturamento.sus*` precisa de opção no mapa do conector **ou** concessão por perfil (mesmo critério do `portal.spec`) | Recurso que só existe no sistema novo não tem menu de origem; inventar linha no mapa seria falso. **Escolhida pelo dono.** | Voltar a exigir só o mapa no `sus.spec.ts` |
| 2 | 25/11 23h59 | Perfil da diretoria da Rede | A publicação da regra de risco da Rede (central de comando, clínica) sai da diretoria e vai a um perfil clínico da Rede; rotinas agendadas e painéis gerenciais (administrativas) ficam com a diretoria | Regra 10: diretoria sem permissão clínica nem do prontuário. **Escolhida pelo dono.** | Mover a permissão de volta em `permissoes/enfermagem.ts` |
| 3 | 25/11 | Variável de ambiente da classificação externa | `SGH_AMBIENTE` corrigida para `AMBIENTE` | Era defeito: em produção o envio nunca marcava produção | — (correção) |
| 4 | 25/11 | Memória da checagem de tipos | `tsc` da API com 8 GB e `vue-tsc` do web com 14 GB de heap no `project.json` | O tamanho do código passou de 4.400 arquivos; não afrouxa checagem. Risco: runner do GitHub com pouca memória (conferir no push) | Reduzir o limite ou dividir projetos |
| 5 | 25/11 | Concorrência de agentes | No máximo 4 a 6 agentes ao mesmo tempo na mesma árvore | Com 14, a disputa fez 57 de 64 construtores saírem sem commit e houve perda de trabalho em arquivo compartilhado | — (processo) |
| 6 | 25/11 | Funções grandes | Feitas em duas etapas (domínio e API; depois tela e E2E) | Num agente só estoura o teto de ferramentas; em duas etapas o custo por função pronta caiu de ~3,8 M para ~2 M | — (processo) |
| 7 | 25/11 | Trava de apagamento no pre-commit | Commit que apaga arquivo só passa com `SGH_PERMITIR_APAGAR=1` | Um corretor apagou 11 arquivos de outras funções levando um índice velho | Tirar o bloco em `.githooks/pre-commit` |
| 8 | 25/11 | E2E fora da fila do limite de memória | O `e2e-vm.sh` não disputa as vagas do `limite-vm` (já roda sozinho na trava pesada, com vigia de memória) | O servidor do teste esperava vaga e o Playwright desistia em 240 s | Tirar `SGH_TRAVAS_VM` do ambiente do `e2e-vm.sh` |
| 9 | 25/11 | Perfil comercial da operadora (C2-095) | A porta indisponível recebe `Set` (a API caía na partida) | Correção de defeito | — |
| 10 | 25/11 | Decisões C pendentes (`decisoes-pendentes-2026-11-25.md`) | Seguem a recomendação registrada em cada uma | O dono pediu para não parar | Ver cada item naquele documento |
