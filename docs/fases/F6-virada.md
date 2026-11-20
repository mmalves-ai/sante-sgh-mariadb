# F6. Virada da ProntoCardio (operação de produção)

**Objetivo:** a produção da ProntoCardio passa do SPDATA para o sistema novo, pelo roteiro do ADR 0001
(itens 3.6 a 3.8).

**Entra:** F5 com o portão aprovado.
**Sai (portão):** produção no sistema novo, imagem final do SPDATA arquivada, prazo de retorno encerrado.

---

## Roteiro

| Dia | O que acontece | Quem | Sistema oficial |
|---|---|---|---|
| **Dia 0** | **Cópia** do Firebird sem parar a produção (`nbackup`/`gbak` online) e do acervo externo. **Carga completa** pelo conector num MariaDB de produção vazio. Schema e mapa congelados. Sistema novo aberto só para consulta | Equipe do sistema e TI | SPDATA |
| **Dia 1 até 1+n** | **A equipe avalia os dados** no sistema novo, em modo consulta, com o relatório de conciliação. Correções viram regra do mapa. **Diferencial diário** sobre uma cópia nova (recomendado). Criação de cadastros no SPDATA congelada nos últimos dias. **n** é o tempo que a equipe levar para aprovar a qualidade dos dados | Responsáveis por setor | SPDATA |
| **Dia 2+n** | **Virada:** contingência em papel, SPDATA parado, cópia a frio final, sincronismo diferencial final, conciliação final, numeração ajustada, integrações trocadas, aceite por setor, **gravação liberada**, redigitação da contingência | Todos, com plantão | **Sistema novo** |

## Marcos

### F6.1 Dia 0

- **Aceite:** carga completa conciliada, sem pendência crítica sem dono.

### F6.2 Dia 1 até 1+n

- **Aceite:**
  - aprovação da qualidade dos dados por setor;
  - diferenciais diários dentro do tempo-meta;
  - zero pendência crítica.

### F6.3 Dia 2+n: janela de virada

- **Aceite:**
  - conciliação final com zero pendência crítica antes da hora H;
  - nenhum número de negócio novo já existente na origem;
  - integrações conferidas;
  - aceite por setor.
- **Se a conciliação não fechar até a hora H,** a virada é abortada e o SPDATA volta a operar.

### F6.4 Acompanhamento e retorno

- **Prazo de retorno:** definido antes da virada, com os gatilhos de retorno.
- **Fim da opção de retorno:** a opção acaba na primeira emissão fiscal ou no primeiro lote TISS, salvo
  decisão expressa do hospital.
- **Se houver retorno:** relatório de redigitação por setor e numerações reservadas.

### F6.5 Arquivamento

- **Entregas:**
  - imagem final do SPDATA e acervo externo arquivados como guarda legal do prontuário por 20 anos,
    cifrados, em somente leitura, com procedimento de consulta;
  - imagens intermediárias e homologação destruídas, com registro, no prazo definido.
- **Aceite:** registro de arquivamento e de destruição.
