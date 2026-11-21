# Plano obrigatório de orquestração com economia (dono, 2026-11-21)

Por que existe: em 21/11/2026 a obra gastou cerca de 1,4 bilhão de tokens equivalentes, dos quais cerca de 600
a 700 milhões eram evitáveis, por falha de orquestração (análise em `docs/obra/consumo.md`).

Este plano é **obrigatório** e tem **travas técnicas**: o guardião `tools/obra/guardiao.py` roda como gancho
do Claude Code (`.claude/settings.json`) e **recusa** o que estiver fora dele. Complementa o protocolo
(`protocolo-tokens.md`, regras 1 a 24). Se houver conflito entre os dois, vale este plano.

## 1. Orçamento antes de qualquer subagente (travado pelo guardião: G1 e G5)

1. **O orçamento é responsabilidade do orquestrador, não do dono** (decisão do dono, 2026-11-21: "não tenho
   como ter referência da performance interna dos subagentes; você analisa, prossegue ou otimiza").
2. Antes de lançar um workflow ou um subagente, o orquestrador grava `docs/obra/orcamentos/<id>.md`, a partir do
   `modelo.md`, com:
   - objetivo e critério de pronto;
   - escopo;
   - agentes por papel;
   - `estimativa_M` (tabela da seção 6);
   - `teto_M` (30% acima da estimativa);
   - o que fica fora.
3. Sem esse arquivo, o guardião recusa o Workflow (G1) e o subagente (G5). Ficam de fora os tipos só de leitura:
   Explore, claude-code-guide e web-fetch.
4. **Teto:**
   - o orquestrador mede com `tools/obra/medir_consumo.py` a cada relatório;
   - se o gasto passar do `teto_M`, o orquestrador para o workflow (TaskStop), analisa a causa, otimiza e só então
     segue;
   - o script também limita o número de agentes (`LIMITE_AGENTES`, G3).
5. **Ao fechar, o orquestrador registra em `docs/obra/consumo.md`:**
   - quanto foi estimado e quanto foi gasto;
   - qual foi a qualidade;
   - o que vai otimizar na próxima rodada.

## 2. Cache garantido e aproveitado entre subagentes (G2 e G4)

- **Prefixo idêntico.** Todo prompt de subagente começa com a constante `PREFIXO`, igual byte a byte para todos
  os agentes do workflow. A parte variável (lote e saída) vai **no fim**. Assim o 2º agente em diante lê o
  prefixo do cache, a cerca de 10% do preço. Travado pelo G2.
- **O PREFIXO contém o brief, não manda ler o brief.** Colar o brief no prefixo sai mais barato (cache) do que
  cada agente abrir o arquivo com uma ferramenta.
- **Mesmo papel, mesma janela de tempo.** Agentes do mesmo papel são lançados juntos, em `pipeline`/`parallel`,
  para reaproveitar o cache, que expira em 5 minutos sem uso. Nada de espalhar o mesmo prefixo por horas.
- **Nunca usar fork** (o fork herda o contexto inteiro do orquestrador). Sempre agente novo.
- **Esforço:** etapas mecânicas usam `effort: 'low'`; julgamento usa o padrão. O modelo é sempre o da sessão
  (decisão do dono).

## 3. Leitura mínima de contexto

- **A fatia é gerada por script** e traz já extraído o que o agente precisa: a lista de arquivos, os trechos
  relevantes, o DDL e os contratos. O agente não sai procurando.
- **Roteiro fixo de turnos para o construtor:**
  1. um comando lê de uma vez todos os arquivos da fatia;
  2. no máximo 3 consultas extras;
  3. de 1 a 3 scripts que gravam tudo;
  4. autoconferência (no máximo 3 vezes).

  Meta: 15 a 40 turnos. Teto: 100 turnos; ao chegar nele, o agente grava o que fez e devolve a lista do que
  falta.
- **O revisor lê só o diff do lote** (`git diff` dos arquivos do lote) e a fatia, não o repositório.
- **O corretor recebe só os achados e as linhas citadas.**
- **Saídas longas vão para arquivo,** e o agente lê só o `tail` ou o `grep`. O agente devolve um resumo
  estruturado pequeno (schema).
- **O orquestrador** lê contagens e resumos produzidos por script, nunca o resultado inteiro de um workflow.

## 4. Ordem obrigatória de toda rodada

1. **Mudança compartilhada primeiro** (motor, modelo, contratos): um agente sozinho, em sequência (regra 24).
2. **Fatias uma vez só**, com o **verificador de completude** ativo desde o início (regra 23). Faltando decisão,
   o agente decide pela melhor prática e registra para o dono; nunca "bloqueia com motivo".
3. **Conferência enxuta:** só aplica pedidos pequenos e verifica. O que sobrar volta às fatias, em no máximo uma
   volta.
4. **Lotes de até cerca de 15 arquivos** (ou cerca de 20 tabelas no conector).

## 5. Qualidade (não se troca por economia)

- Revisão adversarial em todo lote, sobre o diff, com as lentes da tarefa.
- Verificação determinística por script antes de qualquer agente verificador.
- Conferência final independente pelo orquestrador (tsc, testes, validadores) antes do commit.
- **Se a qualidade cair** (integração falhando, achados graves escapando), a regra que causou é desfeita e o fato
  é registrado.

## 6. Tabela de estimativa (medida em 21/11/2026, custo equivalente por agente)

| Papel | Com as regras (medido) | Observação |
|---|---|---|
| Construtor com roteiro fixo, lote de até 15 arquivos | 1,5 M | onda 5 da F2.2 |
| Construtor de fatia do conector | 1,2 a 2,5 M | o maior valor quando a fatia precisa zerar bloqueios |
| Revisor só do diff | 0,5 M | meta |
| Corretor só dos achados | 0,8 M | meta; era de 1,5 a 2,4 M |
| Conferidor ou integrador enxuto | 1,5 a 3,5 M | |
| Agente sequencial de mudança compartilhada | 2,5 a 4,5 M | |

Fórmula: `estimativa = Σ (agentes × custo do papel) × 1,2`, onde 1,2 é a margem. O teto fica 30% acima da
estimativa.

## 7. Modelo de script (o guardião exige este formato)

```js
export const meta = { name: '...', description: '...', phases: [...] }
// ORCAMENTO: <id>
const LIMITE_AGENTES = 30
let agentes = 0
async function chamar(prompt, opts) {
  if (++agentes > LIMITE_AGENTES) throw new Error('LIMITE_AGENTES atingido: parar e reportar')
  return agent(prompt, opts)
}
const PREFIXO = `...brief colado aqui, idêntico para todos... ECONOMIA (regras 20 a 24)...

`
// toda chamada: chamar(PREFIXO + `parte variável`, {...})
```

## 8. Relatório

A cada 50 minutos, o relatório traz:
- a etapa, o que foi construído, o que está em andamento e o que falta;
- a seção **Economia**: gasto contra o orçamento, custo por papel e o percentual em relação à linha de base;
- a qualidade (achados e integração).

## 9. Instalação do guardião (local de cada máquina)

O `.claude/` fica fora do git. Em cada máquina, `.claude/settings.json` deve conter:

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Workflow|Agent", "hooks": [ { "type": "command",
  "command": "python3 -I \"$CLAUDE_PROJECT_DIR/tools/obra/guardiao.py\"", "timeout": 20, "onFailure": "block",
  "statusMessage": "Guardião da orquestração" } ] } ] } }
```

Nesta VM ele está instalado desde 2026-11-21. Ao começar uma sessão, confira que o arquivo existe. Se não existir,
avise o dono antes de orquestrar.
