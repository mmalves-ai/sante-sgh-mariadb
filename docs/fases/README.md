# Plano de construção: banco próprio e virada do SPDATA

Este é o roteiro de construção do projeto `sante-sgh`: o sistema hospitalar sobre **banco próprio em
MariaDB**, montado a partir do modelo base do `new-sgh` e alimentado pelo **conector diferencial** a
partir do SPDATA. As decisões de fundo estão no
[ADR 0001](../adr/0001-banco-proprio-e-virada-por-conector-diferencial.md).

## Visão em uma página

| Fonte | Papel |
|---|---|
| **SPDATA** (Firebird) | **Base de dados.** É de onde vêm os dados da Rede Santé, pelo conector |
| **MV** (Oracle, ambiente de teste) | **Referência de recursos novos.** Só funcionalidade, nunca estrutura nem nomes |
| **`new-sgh`** | **Base do código:** domínios, regras, contratos, API e **todas as telas** |
| **Padrões públicos** (TISS, TUSS, SIGTAP, CID-10, CBO, IBGE, CNES, FHIR/RNDS) | Base do vocabulário e dos catálogos pré-carregados |

O resultado tem três partes:

1. **Um modelo de dados próprio:**
   - limpo e sem gatilho com regra de negócio;
   - sem nomes do SPDATA ou do MV;
   - capaz de receber os dados do SPDATA e de começar do zero para qualquer hospital.
2. **A aplicação do `new-sgh`** ligada a esse modelo, com as regras que hoje estão nos gatilhos do SPDATA
   reescritas no domínio, com teste.
3. **Um conector** que copia o SPDATA para o banco novo e o mantém em dia por diferencial até a virada.

## Fases

| Fase | Nome | O que entrega | Portão de saída |
|---|---|---|---|
| [F0](F0-fundacao.md) | Fundação | Repositório, modelo base do `new-sgh` trazido, MariaDB, esteira | Esteira verde com o modelo base sem o legado |
| [F1](F1-analise-e-modelo.md) | Análise cruzada e modelo próprio | Matriz funcional MV × SPDATA × `new-sgh`, princípios do modelo, DDL por módulo, catálogos públicos | Toda tabela do SPDATA com destino no modelo; catálogos carregam num banco vazio |
| [F2](F2-nucleo-e-persistencia.md) | Núcleo neutro e persistência própria | Núcleo extraído, portas neutras, adaptadores MariaDB, acesso próprio, fluxo vertical | Paciente → atendimento ponta a ponta no MariaDB, mesmos testes em memória e no banco |
| [F3](F3-paridade.md) | Paridade funcional com o SPDATA | Regras dos gatilhos no domínio, módulo a módulo, telas ligadas | Todos os módulos usados pela Rede Santé com contrato de efeito verde |
| [F4](F4-conector.md) | Conector diferencial | Leitura de imagens, mapa de-para, gravação, pendências, conciliação, diferencial | Carga completa de uma imagem real conciliada e diferencial medido |
| [F5](F5-homologacao.md) | Homologação com dados reais e ensaios | LGPD, neutralização, rodadas por setor, dois ensaios gerais cronometrados | Aceite por setor e plano de virada aprovado |
| [F6](F6-virada.md) | Virada da ProntoCardio | Dia 0, dia 1 a 1+n, dia 2+n | Produção no sistema novo; SPDATA arquivado |
| [F7](F7-serrano-e-hospital-do-zero.md) | Serrano e hospital do zero | Virada do `hs`, índice único de pacientes, instalação de hospital novo | Serrano em produção; hospital novo instalável sem SPDATA |
| [F8](F8-recursos-novos.md) | Recursos novos | Recursos inspirados no MV, por prioridade | Contínuo |

## Caminho crítico e paralelismo

```
F0 ─► F1 ─┬─► F2 ─► F3 (módulo a módulo) ─┐
          │                               ├─► F5 ─► F6 ─► F7
          └─► F4 (conector) ──────────────┘                └─► F8 (contínuo, depois da F6)
```

- **F3 e F4 andam em paralelo** depois da F1. O conector precisa do modelo (F1) e do mapa de rastreio
  SPDATA → modelo (F1.5). Não precisa das regras da F3.
- **A F5 começa** quando a F3 cobrir os módulos da primeira rodada e a F4 tiver a carga completa
  conciliada.
- **A F8 não atrasa a virada.** Recursos novos inspirados no MV entram depois da F6, salvo os que a F1
  classificar como F7 (exigidos para vender a hospital novo).

## Como cada marco é conduzido

1. **Ficha.** Cada marco tem objetivo, dependências, entregas e aceite na ficha da fase. Antes de
   construir, a sessão lê só a ficha do marco, o ADR e o `ESTADO.md`.
2. **Um marco por vez, na ordem.** Marcos de fases paralelas (F3 e F4) podem andar em trilhas
   separadas.
3. **Aceite por prova.** O marco só fecha com a prova pedida na ficha: teste, relatório de conciliação,
   medição. "Pronto" sem prova não conta.
4. **Validação humana** nos portões de fase. Na F5 e na F6, a validação é dos responsáveis de cada setor
   do hospital.
5. **Decisões e desvios viram ADR** em `docs/adr/`, numerados a partir de 0002.
6. **Estado.** O `docs/ESTADO.md` é atualizado no fim de cada sessão: marco atual, status, bloqueios,
   decisões pendentes.
7. **Tarefas longas** seguem a mesma regra do `new-sgh`: sessões curtas, contexto mínimo e relatório ao
   dono a cada 50 minutos (tarefas, % e tempo, completude e previsão).

## Prazos

O plano não fixa datas. O ritmo é medido marco a marco a partir da F0, e a previsão é refeita a cada
portão. O que mais pesa na duração:

- **Tamanho da paridade (F3):** quantas regras dos 2.538 gatilhos e 181 procedures do SPDATA a Rede
  Santé usa de fato. A F1 mede isso.
- **Tempo de avaliação do hospital:** o **n** do dia 2+n e as rodadas da F5.
- **Pré-requisitos externos:** contrato de tratamento de dados e RIPD, licenças de catálogo,
  credenciais de integração e contrato do SPDATA.
