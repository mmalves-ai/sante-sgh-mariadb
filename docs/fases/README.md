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

> **ADR 0002 e dono, 2026-11-20:**
> - As fases são **ordem de construção**, não disponibilidade. Todo recurso fica disponível a todo cliente.
> - **A obra constrói o produto inteiro.** Homologação e virada são **operações do hospital**, decididas e
>   feitas por ele. A obra entrega as **ferramentas** para elas, não executa.
> - **Recursos novos não esperam a virada de ninguém.** O sistema só está completo com todos os recursos.

### Construção do produto (a obra)

| Fase | Nome | O que entrega | Prova de saída |
|---|---|---|---|
| [F0](F0-fundacao.md) | Fundação | Repositório, modelo base do `new-sgh`, MariaDB, esteira | Esteira verde com o modelo base sem o legado |
| [F1](F1-analise-e-modelo.md) | Análise cruzada e modelo próprio | Matriz funcional, princípios, DDL por módulo, catálogos públicos | Toda tabela do SPDATA e do MV com destino; catálogos carregam num banco vazio |
| [F2](F2-nucleo-e-persistencia.md) | Núcleo e persistência própria | Núcleo, adaptadores MariaDB, acesso próprio, **login pelo navegador**, fluxo vertical | Paciente → atendimento ponta a ponta no MariaDB |
| [F3](F3-paridade.md) | Paridade funcional | Regras dos gatilhos no domínio, módulo a módulo, telas ligadas | Todos os módulos com contrato de efeito verde |
| [F4](F4-conector.md) | Conector diferencial | Leitura de imagens, de-para, gravação, pendências, conciliação, diferencial | Carga completa de uma imagem real conciliada e diferencial medido |
| [F5](F5-homologacao.md) | **Ferramentas** de homologação e virada | Painel de conferência por setor, relatórios de conciliação, LGPD (mascaramento, neutralização), comandos do dia 0, dia 1 e dia 2+n, retorno | Ensaio geral completo num banco de teste, cronometrado |
| [F7](F7-serrano-e-hospital-do-zero.md) | Multi-hospital e hospital do zero | Índice único de pacientes entre hospitais, instalação de hospital novo sem SPDATA | Hospital novo instalável pelo administrador da plataforma |
| [F8](F8-recursos-novos.md) | Recursos novos | Todos os recursos que o MV tem a mais, com estrutura própria | Cobertura funcional completa contra a matriz da F1 |

### Operação de cada hospital (fora da obra, decidida pelo cliente)

| Etapa | Quem faz | Usa |
|---|---|---|
| Homologação com dados reais (antes F5) | Setores do hospital | Ferramentas da F5, conector da F4 |
| Virada: dia 0, dia 1 a 1+n, dia 2+n (antes F6) | Hospital, com apoio | Comandos da F5 |
| Virada de cada hospital da rede (Rede Santé: ProntoCardio, Serrano) | Cada hospital, quando quiser | O mesmo roteiro |

As fichas `F5-homologacao.md` e `F6-virada.md` continuam valendo como **especificação** do que as
ferramentas precisam suportar.

## Caminho de construção e paralelismo

```
F0 ─► F1 ─┬─► F2 ─► F3 (módulo a módulo) ─┬─► F7 ─► F8 ─► produto completo
          │                               │
          └─► F4 (conector) ─► F5 (ferramentas de homologação e virada)
```

- **F3 e F4 andam em paralelo** depois da F1.
- **F8 pode começar** assim que a F3 cobrir o módulo correspondente. Não depende de virada.
- **Quando um hospital começa a homologar** é decisão dele, a partir do momento em que F3, F4 e F5 cobrirem
  o que ele usa. Isso não interrompe a obra.

## Como cada marco é conduzido

1. **Ficha.** Cada marco tem objetivo, dependências, entregas e aceite na ficha da fase. Antes de
   construir, a sessão lê só a ficha do marco, o ADR e o `ESTADO.md`.
2. **Um marco por vez, na ordem.** Marcos de fases paralelas (F3 e F4) podem andar em trilhas
   separadas.
3. **Aceite por prova.** O marco só fecha com a prova pedida na ficha: teste, relatório de conciliação,
   medição. "Pronto" sem prova não conta.
4. **Validação humana:** as provas da obra são por teste e medição. A validação pelos setores
   é da operação de cada hospital, fora da obra.
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
