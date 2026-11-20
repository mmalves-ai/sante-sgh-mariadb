# ESTADO do sante-sgh

Atualizado em: 2026-11-20.

## Fase atual

| Fase | Marco | Status | Observação |
|---|---|---|---|
| F1 | F1.1 Matriz funcional MV × SPDATA × `new-sgh` | rodada 2 concluída e conferida: 3.500 tabelas próprias (F3 1.658, F7 1.105, F8 737); 8.867 do MV e 1.503 do SPDATA com destino (`docs/analise/rodada2/RESUMO.md`). Rodada 1: | 511 funcionalidades (F3 247, F7 109, F8 104, não fazer 51) e cerca de 1.376 entidades propostas (`docs/analise/RESUMO.md`). Aguarda o dono validar as arbitragens D1 a D13. A segunda rodada cobre qualidade e segurança do paciente e o vocabulário único |
| F0 | todos | pendente | Começa com a autorização do dono para `git init` e para trazer o modelo base |

## Quadro de fases

| Fase | Status |
|---|---|
| F0 Fundação | pendente |
| F1 Análise cruzada e modelo | em andamento (F1.1, primeira rodada concluída) |
| F2 Núcleo e persistência | pendente |
| F3 Paridade | pendente |
| F4 Conector | pendente |
| F5 Homologação | pendente |
| F6 Virada | pendente |
| F7 Serrano e hospital do zero | pendente |
| F8 Recursos novos | pendente |

## Decisões registradas

- **ADR 0001** (aceito em 2026-11-20): banco próprio em MariaDB 12.3, modelo base do `new-sgh` trazido para
  cá, conector diferencial, operação dia 0, dia 1 e dia 2+n.

## Decisões pendentes (do dono)

1. **"Vetorização de-para":** confirmar que é sugestão por similaridade com aprovação humana.
2. **Isolamento entre hospitais:** banco por hospital (recomendado) ou coluna de estabelecimento. Decidir
   antes da F1.3.
3. **Commit de partida do `new-sgh`** para a F0.2.
4. **Dump do MV:** registrar a origem e a autorização de posse; apagar os dados do volume Oracle e manter
   só o metadado.
5. **`git init`** desta pasta (F0.1).

## Ambiente

- **Oracle de referência:** `sante-sgh-oracle` no ar, com o dump do MV carregado parcialmente no 23ai Free
  (limite de 12 GB; 172.981 linhas recusadas por conversão de charset). Só metadados interessam.
- **MariaDB de desenvolvimento:** ainda não criado (F0.3).

## Diário

- **2026-11-19 e 2026-11-20:**
  - Oracle Free montado e dump do MV importado: o arquivo da `sante-api` estava truncado, e a cópia
    completa veio do cache do VMware.
  - Avaliação do `new-sgh`: cinco leituras e parecer.
  - ADR 0001 escrito, revisado por três lentes (43 achados) e aceito.
  - Fases F0 a F8 escritas.
  - Análise cruzada iniciada.
