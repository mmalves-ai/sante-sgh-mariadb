# Preço por profissional: levantamento na origem e proposta

Orçamento: `preco-profissional`. Data: 2026-11-21. Escopo: só leitura.

**Fonte dos números**
- Cópia de desenvolvimento `pc-20261019.fdb`, lida pelo abridor do conector: snapshot copy-on-write, transação
  `SNAPSHOT READ ONLY`, `MON$READ_ONLY = 1` conferido, container sem rede.
- Mapa e DDL do worktree `../sante-sgh-wt/f4`.
- Código de `packages/dominio-*` e `apps/api` na pasta principal.

Só há contagens e agregados aqui: nenhum valor de linha, nome ou número de conselho (registro do médico no
conselho de classe, como o CRM).

Termos usados:
- **Convênio / fonte pagadora:** quem paga a conta (operadora, particular, SUS).
- **Credenciamento:** o médico estar habilitado a atender por um convênio.
- **Repasse:** a parte da receita que o hospital paga ao médico.
- **Inscrição no conselho:** a linha da origem que liga o profissional à ocupação CBO (Classificação Brasileira
  de Ocupações). O código `000000` é a inscrição genérica, que só traz o número no conselho.

## 1. Onde mora cada coisa na origem

### (a) Valor por profissional (preço cobrado)

| Tabela | O que é | Contagens |
|---|---|---|
| `FCCODCON.VLR_CONSULTA` | Valor da consulta **por médico × convênio**, na mesma linha do código do médico no convênio | 768 linhas. Só **113 linhas têm valor**: 113 médicos, **1 convênio**, o de classe 2 "Particular", com 13 valores distintos. Os outros 6 convênios (classe 4) têm só o código, sem valor. Todas as 113 linhas apontam para a inscrição genérica. |
| Mesma tabela, por especialidade (pela `TBMEDESP` ativa) | — | 111 dos 113 médicos têm especialidade. 30 especialidades; em 22 há mais de um médico com valor; **em 15 os valores diferem entre médicos da mesma especialidade** (131 pares médico × especialidade). |
| Uso real em 2025 (`RECADATE.VLR_PROC`, por convênio × procedimento × mês) | Confirma o valor por médico na cobrança | Classe Particular: 129 grupos; 61 com mais de um médico; **24 com valores diferentes entre médicos**. Dentro do mesmo médico só 5 de 665 grupos variam, ou seja, o valor segue o médico. Classe convênio: 574 grupos; 403 com mais de um médico; 128 com valores diferentes (aqui entram também acréscimos de horário e urgência, o que não prova preço por médico). No Particular de 2025, de 1.554 lançamentos com valor, 1.312 são de médico com `VLR_CONSULTA` e 541 batem exatamente com ele. A conta cobre todos os procedimentos: o filtro só por consulta não casou e ficou sem número. |

**Particular**
- É o convênio de classe 2.
- Não existe tabela de preço por médico para os demais procedimentos.
- O valor por médico fora da consulta não está em tabela: é digitado no lançamento, e o sistema de origem não o
  calcula no banco.

**Gatilhos**
- `TRG_RECADATE_BIU` e `TRG_RECADATE_AU` leem de `FCCODCON` só o **código** do médico no convênio, para a
  integração.
- O `VLR_CONSULTA` não é lido por nenhum gatilho nem procedure. Quem o aplica é a aplicação (Delphi), na hora de
  lançar a consulta.

**Tabelas vazias na cópia** (0 linhas, sem destino no mapa e sem efeito):
- `TBREPGERMED`, `TBREPGERSUS`, `FCREPLAN`, `FAREPASSELANC`, `FHREPASSELANC`;
- `CRAGENDA` (tem `VALOR`) e `FALANCTO`.

### (b) Quais convênios cada profissional atende

| Tabela | Contagens | Observação |
|---|---|---|
| `TBCBOPRO_TBCONVEN` (credenciamento médico × convênio) | 90.455 linhas, 2.012 inscrições, 68 convênios. Por convênio: 19 convênios com 1.837 inscrições cada, 6 com 1.833, 5 com 1.850, 9 com uma só. Por inscrição, o mais comum é de 41 a 57 convênios; 44 inscrições têm 1 convênio. | **O modelo é de exclusão.** O gatilho `TRG_TBCONVEN_AIU` credencia **todas as inscrições ativas** em todo convênio novo ativo. O gatilho `TRG_TBCBOPRO_TBCONVEN_AID` espelha a inclusão e a exclusão na inscrição genérica. Na prática, o médico atende tudo, salvo o que foi retirado. |
| Validação | Amostra de junho de 2025: 3.810 atendimentos; **100%** com o par médico × convênio credenciado | `TBCONVEN.PERMITIR_ATE_ELET_MED_NAO_CRED` = T em 76 dos 77 convênios. A trava existe, mas está aberta. |
| `TBCREMED` (credenciamento para cobrança) | 185 linhas, 48 inscrições, 4 convênios, `CONTAS`=A | Lida pelos gatilhos `TRG_RECADATE_AI` e `TRG_REPROEXT_AI` (`tipo=2`) para decidir quem cobra o honorário: o hospital ou o médico direto. |
| `FCCRECUN` | 12 linhas, 3 inscrições, 4 convênios | Regra de crédito da produção. |
| `TBCREPRS` | 44 linhas, 9 prestadores, 7 convênios | Credenciamento de prestador terceiro. |
| `REAGENDA_TBCONVEN` / `SIAGENDA_TBCONVEN` | 4.167 e 968 linhas | Convênios aceitos **na agenda**, sem valor e sem profissional. |

### (c) Preço cobrado × repasse ao médico

**Preço cobrado (receita)**
- Tabela do convênio (`TBCONVEN.THM_E`/`THM` → `TBCTRTHM`, `TBTABTHM`, `TBVLRTHM`).
- Percentuais do acordo: `TBPERTHM`, com 89.015 linhas e 8 convênios. A coluna `PERC_N_CRED`, de percentual
  para não credenciado, tem **0 linhas** com valor; `CH_VALOR_CRED`='S' também tem 0.
- Valor de consulta por médico no Particular: `FCCODCON.VLR_CONSULTA`.
- O lançamento grava o resultado em `RECADATE.VLR_PROC`, `VLR_CRM` e `VLR_ANE`.

**Repasse (custo)**
- `TBREPGER` tem 105.430 regras: 98.462 de médico (`M`) e 6.968 de prestador (`P`).
- Nas regras de médico:
  - 766 médicos distintos (`COD`) e 51 convênios;
  - **96.544 em percentual** e 1.847 em valor fixo;
  - 81.515 para um procedimento só e 23.915 para uma faixa de procedimentos;
  - `UNID` preenchida em 10.087;
  - `ATO` em 1.720;
  - **`ESP` nunca preenchida**.
- 3.623 chaves têm mais de uma vigência, entre 2018 e 2026.
- `TBREPGER_TBCBOPRO` liga 98.406 regras a 769 inscrições.
- A produção já apurada (`FCINTEGRPA`) tem 10.726 linhas e usou 286 regras.
- **Repasse diferente por médico:**
  - agrupando por convênio, procedimento ou faixa, tipo de conta, ato e tipo de lançamento, são 17.904 grupos;
    11.043 têm mais de um médico; **466 têm percentual diferente entre médicos** e 67 têm valor fixo diferente;
  - acrescentando a especialidade (pela `TBMEDESP`), são 19.028 grupos com mais de um médico; **433 diferem**.
- **Ligação entre preço e repasse:** `TBCONVEN.VLR_CONSULTA_MEDICO`='T' em 2 convênios de classe Particular. Os
  gatilhos `TRG_RECADATE_AI` e `TRG_REPROEXT_AI` gravam então o repasse da consulta com o **valor cobrado sem o
  acréscimo** (`VLR_PROC / ((PERC+100)/100)`): a consulta particular vai inteira ao médico.

### Precedência que a origem aplica

- **Preço:**
  1. Há valor do médico (`FCCODCON`) no Particular? Ele vale. A aplicação aplica.
  2. Senão, vale a tabela do convênio na vigência (`TBVLRTHM`), com os percentuais do acordo (`TBPERTHM`).
  3. O banco não tem precedência programada. Os gatilhos só leem o código do médico e o credenciamento para
     cobrança.
- **Repasse:** a regra mais específica vence.
  - A ordem é profissional > procedimento (a faixa mais estreita vence) > demais dimensões > convênio.
  - No empate, vence a vigência mais recente.
  - Está reproduzida em `packages/dominio-repasse/src/resolver-regra.ts`, com a ordem em `DIMENSOES_REGRA`.

## 2. Destino no mapa e cobertura do modelo novo

| Origem | Destino no mapa (f4) | Cobre? |
|---|---|---|
| `FCCODCON` (código + `VLR_CONSULTA`) | `codigo_prestador_fonte_pagadora` (`valor_consulta`, vigência = data da carga) e `profissional_fonte_pagadora` (em `tabelas.tsv`) | **Parcial.** Guarda o número, mas só para **consulta**, sem item ou grupo e sem plano na origem. Há **dois lugares** com `valor_consulta` (`profissional_fonte_pagadora.valor_consulta` e `codigo_prestador_fonte_pagadora.valor_consulta`): ambíguo. **Nenhum cálculo lê** essa coluna: o `operacoes.ts` não a consulta, e só a `fonte-memoria.ts` da tela de preços a exibe. |
| `TBCBOPRO_TBCONVEN` | `profissional_fonte_pagadora` (vigência = carga) | **Sim, a estrutura.** A semântica de exclusão (credenciado em tudo por padrão) vira 90 mil linhas explícitas, o que está correto. A agenda e o lançamento **não validam** o credenciamento: `agenda/porta-propria.ts` e `faturamento/operacoes.ts` não leem `profissional_fonte_pagadora`. |
| `TBCREMED` | `credenciamento_cobranca` e `profissional_fonte_pagadora` | Sim (quem cobra o honorário). |
| `FCCRECUN` / `TBCREPRS` | `regra_credito_producao` / `credenciamento_cobranca` | Sim. |
| `REAGENDA_TBCONVEN` / `SIAGENDA_TBCONVEN` | `agenda_fonte_pagadora` | Sim (sem valor, como a origem). |
| `TBMEDESP` | `profissional_especialidade` | Sim. |
| `TBREPGER` / `TBREPGER_TBCBOPRO` | `regra_repasse`, `regra_repasse_item` e `regra_repasse_profissional` (L8-06) | Sim. O `regra_repasse_item` tem profissional, plano, item, grupo, faixa, percentual ou valor fixo e vigência. |
| `TBPERTHM` | `regra_percentual_cobranca` | Sim, por convênio, tabela e item, **sem profissional**. `CH_VALOR_CRED` fica sem coluna (0 linhas em uso). |
| `TBCTRTHM`, `TBTABTHM`, `TBVLRTHM` | `tabela_preco`, `preco_procedimento`, `preco_procedimento_valor` | Sim. |
| `TBCONVEN.VLR_CONSULTA_MEDICO` | sem destino declarado | **Não.** É a regra "consulta particular = 100% ao médico". Cabe como regra de repasse (item de consulta, percentual 100) gerada pelo conector. |

## 3. O cálculo de preço do produto hoje

- `apps/api/src/modulos/faturamento/operacoes.ts`:
  - `tabelasDePreco` monta a ordem: **tabela da conta > tabela do plano > tabelas da fonte pagadora** (a do
    estabelecimento antes da da rede);
  - `precoVigente` pega a **primeira tabela que tem o item**, com a maior vigência até a data;
  - sem preço, a conta recusa com `item-sem-preco` e pede preço manual justificado.
- O `packages/dominio-preco` tem modelo de valor, vigência, reajuste e comparação. **Não tem profissional.**
- **No lançamento, não se aplicam** nem `contrato_tabela_vigencia` (o percentual de ajuste) nem
  `regra_percentual_cobranca`.
- **Não existe precedência profissional > contrato do convênio > tabela de referência.**
  - O valor por médico migrado fica morto.
  - O Particular com valor por médico vai cair em "sem preço" ou na tabela genérica.
- O repasse (`dominio-repasse`) já resolve por especificidade, com o profissional em primeiro. É o lado do custo,
  independente do preço.

## 4. Proposta (melhor prática de mercado)

### 4.1 Princípios

- **Três camadas separadas.** É a prática dos sistemas hospitalares de mercado e da ANS (Agência Nacional de
  Saúde Suplementar), em que o contrato com a operadora define a tabela e o hospital define o particular.
  1. **Credenciamento.** Quem pode atender e cobrar por qual convênio: `profissional_fonte_pagadora`, que já
     existe.
  2. **Preço cobrado.** Tabela de referência, ajustada pelo contrato do convênio e sobreposta pela regra do
     profissional.
  3. **Repasse.** Quanto o médico recebe: `regra_repasse_item`, que já existe e já tem o profissional.
- **O preço por médico é regra, não coluna solta.** O `valor_consulta` em duas tabelas vira uma regra única,
  geral (qualquer item ou grupo), com vigência e prioridade.
- **O repasse nunca deriva do preço por cópia.** Ele é calculado sobre o valor cobrado
  (`regra_repasse_item.incidencia`) ou é fixo. A ligação é a **base de cálculo**, não a duplicação do número.

### 4.2 DDL (ADR 0002: PK, auditoria, FK RESTRICT, CHECK, vigência, estabelecimento)

```sql
CREATE TABLE regra_preco_profissional (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id       BIGINT UNSIGNED NULL COMMENT 'NULL = vale na rede inteira do cliente',
  profissional_id          BIGINT UNSIGNED NOT NULL,
  fonte_pagadora_id        BIGINT UNSIGNED NOT NULL COMMENT 'o particular é uma fonte pagadora de classe particular',
  plano_fonte_pagadora_id  BIGINT UNSIGNED NULL,
  especialidade_medica_id  BIGINT UNSIGNED NULL COMMENT 'quando o médico tem preço diferente por especialidade',
  item_faturavel_id        BIGINT UNSIGNED NULL,
  grupo_faturamento_id     BIGINT UNSIGNED NULL,
  escopo_conta             VARCHAR(20) NOT NULL DEFAULT 'todas',
  modo                     VARCHAR(20) NOT NULL COMMENT 'valor_fixo | percentual_sobre_tabela | fator_sobre_tabela',
  valor_fixo               DECIMAL(15,2) NULL,
  percentual               DECIMAL(7,4)  NULL COMMENT 'acréscimo ou desconto sobre o preço do contrato, -100 a 1000',
  fator                    DECIMAL(9,4)  NULL COMMENT 'multiplicador sobre o preço do contrato',
  componente               VARCHAR(20) NOT NULL DEFAULT 'total' COMMENT 'total | honorario',
  prioridade               SMALLINT UNSIGNED NOT NULL DEFAULT 100 COMMENT 'desempate explícito; menor vence',
  vigencia_inicio          DATE NOT NULL,
  vigencia_fim             DATE NULL,
  ativo                    BOOLEAN NOT NULL DEFAULT TRUE,
  origem                   VARCHAR(20) NOT NULL DEFAULT 'sistema',
  observacao               VARCHAR(500) NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL,
  excluido_em DATETIME(3) NULL, excluido_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT fk_rpp_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimento(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rpp_profissional    FOREIGN KEY (profissional_id) REFERENCES profissional(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rpp_fonte           FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rpp_plano           FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rpp_especialidade   FOREIGN KEY (especialidade_medica_id) REFERENCES especialidade_medica(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rpp_item            FOREIGN KEY (item_faturavel_id) REFERENCES item_faturavel(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rpp_grupo           FOREIGN KEY (grupo_faturamento_id) REFERENCES grupo_faturamento(id) ON DELETE RESTRICT,
  CONSTRAINT ck_rpp_alvo     CHECK (item_faturavel_id IS NULL OR grupo_faturamento_id IS NULL),
  CONSTRAINT ck_rpp_modo     CHECK (modo IN ('valor_fixo','percentual_sobre_tabela','fator_sobre_tabela')),
  CONSTRAINT ck_rpp_valor    CHECK ((modo = 'valor_fixo'              AND valor_fixo IS NOT NULL AND valor_fixo >= 0 AND percentual IS NULL AND fator IS NULL)
                                 OR (modo = 'percentual_sobre_tabela' AND percentual IS NOT NULL AND percentual BETWEEN -100 AND 1000 AND valor_fixo IS NULL AND fator IS NULL)
                                 OR (modo = 'fator_sobre_tabela'      AND fator IS NOT NULL AND fator > 0 AND valor_fixo IS NULL AND percentual IS NULL)),
  CONSTRAINT ck_rpp_fixo_item CHECK (modo <> 'valor_fixo' OR item_faturavel_id IS NOT NULL OR grupo_faturamento_id IS NOT NULL),
  CONSTRAINT ck_rpp_componente CHECK (componente IN ('total','honorario')),
  CONSTRAINT ck_rpp_escopo   CHECK (escopo_conta IN ('todas','externa','internacao')),
  CONSTRAINT ck_rpp_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_rpp_origem   CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_rpp_chave (profissional_id, fonte_pagadora_id, plano_fonte_pagadora_id, especialidade_medica_id,
                           item_faturavel_id, grupo_faturamento_id, escopo_conta, estabelecimento_id, vigencia_inicio),
  KEY ix_rpp_busca (fonte_pagadora_id, profissional_id, vigencia_inicio),
  KEY ix_rpp_item (item_faturavel_id), KEY ix_rpp_grupo (grupo_faturamento_id),
  KEY ix_rpp_plano (plano_fonte_pagadora_id), KEY ix_rpp_estabelecimento (estabelecimento_id),
  KEY ix_rpp_especialidade (especialidade_medica_id)
) COMMENT='Preço cobrado definido pelo profissional (valor fixo, percentual ou fator sobre o contrato) por fonte pagadora, plano, item ou grupo, com vigência';
```

**Ajustes de DDL associados**
- `profissional_fonte_pagadora.valor_consulta` e `codigo_prestador_fonte_pagadora.valor_consulta`:
  **deprecar**.
  - Na migração, a carga vai para `regra_preco_profissional`, com o item de consulta da tabela do convênio e o
    modo `valor_fixo`.
  - As colunas são removidas numa migração seguinte, sem leitores.
- O `uq` usa colunas anuláveis.
  - No MariaDB, o NULL não colide no UNIQUE. A sobreposição de vigências de chaves com NULL deve ser **validada
    no domínio**, que já é a regra do produto.
  - Outra saída é uma coluna gerada `chave_normalizada` com `COALESCE(...,0)` e UNIQUE nela.
- O "sem especialidade" é coberto: a especialidade é opcional, para o caso, visto na origem, de médicos da mesma
  especialidade com valores diferentes, e também do médico com duas especialidades.

### 4.3 Mapa do conector (origem → destino)

| Origem | Destino | Regra |
|---|---|---|
| `FCCODCON` com `VLR_CONSULTA > 0` (113 linhas) | `regra_preco_profissional` (`modo`=`valor_fixo`, `item_faturavel_id` = item de consulta da tabela do convênio, `TBCTRTHM.COD_CONS` → item, `vigencia_inicio` = data da carga com `vigencia_sem_fonte`, `origem`=`migracao`, `estabelecimento_id` = o único do cliente) | Sem item de consulta resolvido: pendência `item_consulta_indefinido`, nunca valor solto |
| `FCCODCON` (todas, 768) | `codigo_prestador_fonte_pagadora` (código e TISS, sem `valor_consulta`) | Como hoje |
| `TBCBOPRO_TBCONVEN` (90.455) | `profissional_fonte_pagadora` (credenciado = verdadeiro) | Como hoje. O relatório de carga mostra que a origem credencia por padrão. |
| `TBCONVEN.VLR_CONSULTA_MEDICO`='T' (2) | `regra_repasse` / `regra_repasse_item` (fonte pagadora, item de consulta, `percentual`=100, `incidencia` = valor cobrado sem acréscimo, `origem`=`migracao`) | Regra explícita no lugar da flag no gatilho |
| `TBREPGER` / `TBREPGER_TBCBOPRO` | `regra_repasse*` | Como hoje (L8-06) |

### 4.4 Precedência no domínio (`packages/dominio-preco`, função pura `resolverPreco`)

**Entrada:** item, data, estabelecimento, fonte pagadora, plano, profissional executante, especialidade,
escopo da conta e candidatos lidos pela porta.

1. **Credenciamento.**
   - Sem `profissional_fonte_pagadora` vigente para o par, e o convênio não permitindo não credenciado, o
     resultado é `recusa: profissional-nao-credenciado`.
   - Se o convênio permitir, segue com o motivo anotado na memória de cálculo. O sistema dá alerta, não trava
     sozinho (ADR 0002); a trava é configuração do convênio.
2. **Preço base do contrato:**
   - tabela da conta > tabela do plano > tabela do contrato vigente (`contrato_tabela_vigencia`, aplicando
     `percentual_ajuste`) > tabela da fonte pagadora;
   - depois, `regra_percentual_cobranca` por componente.
3. **Regra do profissional.**
   - Filtra as regras vigentes na data e no estabelecimento (o próprio antes do NULL).
   - Escolhe pela especificidade: item > grupo > nenhum; plano > sem plano; especialidade > sem; escopo
     específico > `todas`.
   - Depois, `prioridade` menor, vigência mais recente e maior id (determinístico).
   - Aplicação:
     - `valor_fixo` substitui o valor (ou só o honorário, se `componente`=`honorario`);
     - `percentual` e `fator` incidem sobre o preço base do passo 2;
     - sem preço base, só o `valor_fixo` resolve.
4. **Sem nada:** `item-sem-preco` e preço manual justificado, como hoje.

**Memória de cálculo**
- `conta_hospitalar_item_memoria` ganha `regra_preco_profissional_id` e o passo que decidiu.
- A tela de preços explica "contrato X, ajustado pela regra do médico Y".

**Repasse**
- Continua no `dominio-repasse`, com o profissional primeiro, já implementado.
- Incide sobre o **valor efetivamente cobrado** (resultado do passo 3), nunca sobre a tabela de referência,
  exceto se a regra de repasse disser `incidencia`=`tabela`.
- Assim, preço por médico e repasse por médico são independentes e coerentes. A consulta particular
  "100% ao médico" vira regra de repasse com percentual 100.

**Onde ligar**
- `faturamento/operacoes.ts` passa a chamar `resolverPreco` no lugar de `precoVigente` direto, recebendo o
  executante do item.
- A agenda usa o passo 1 para filtrar os convênios na marcação, cruzando `agenda_fonte_pagadora` com
  `profissional_fonte_pagadora`.
- Teste de contrato de efeito: o mesmo item, convênio e data, com dois médicos da mesma especialidade, gera dois
  valores, e a memória aponta a regra.

### 4.5 Pendências de decisão (dono)

- Valor por médico em **convênio** (não só no Particular): a origem não tem. O modelo proposto permite. Confirmar
  com o setor se há acordos assim fora do sistema.
- Trava de não credenciado: hoje está aberta em 76 de 77 convênios. Manter como alerta, ou travar por
  convênio.

## 5. Texto livre das agendas: valores, subplanos e restrições

### 5.1 O que existe hoje (cópia de 19/10/2026)

**Ressalva de data**
- A cópia é **anterior às correções** que o hospital fez nas observações (valores particulares e subplanos).
- Os números abaixo medem a forma e a ordem de grandeza.
- Dependem de uma cópia mais nova:
  - o conteúdo final dos textos;
  - quantas agendas citam valor ou plano depois da correção;
  - se o hospital passou a usar a observação por agenda × convênio, que hoje está vazia.

**Busca de palavras-chave no banco**
- Usa `CONTAINING`, sem diferença entre maiúscula e minúscula.
- É um sinal, não interpretação. Nenhum texto foi lido para o chat.

| Campo de origem | Destino no mapa (f4) | Linhas com texto | Sinais (contagem de linhas) |
|---|---|---|---|
| `REAGENDA.OBS` (agenda de consulta, vista pela recepção) | `agenda_servico.observacao` (VARCHAR(2000); acima disso **é resumida com pendência**) | 136 de 138 agendas; 133 das 135 ativas. Até 1.112 bytes, média de 325. | `R$`: 102; `R$` + "PARTICULAR": 93; `R$` + "CONSULTA": 66; `R$` + "EXAME": 2; nome de operadora com planos ("AMIL"): 79; "NÃO ATENDE": 26; "SOMENTE/APENAS": 35; "ANOS" (idade): 52; "RETORNO": 11; sexo: 3 |
| `REAGENDA.OBS_PORTAL_PAC_AGEND_ONLINE` | `agenda_servico.orientacao_marcacao` | 1 | Cita valor e convênio. |
| `SIAGENDA.OBSERVACAO` (agenda de exame) | `agenda_servico.observacao` | 37 de 40; as 19 ativas, todas com texto. Até 1.936 bytes, média de 370. | `R$`: 14; `R$` + "EXAME": 4; "AMIL": 4; "NÃO ATENDE": 7; "ANOS": 4; preparo e jejum: 3 |
| `SIAGENDA.OBS_PORTAL_PAC_AGEND_ONLINE` | `agenda_servico.orientacao_marcacao` | 0 | — |
| `REAGENDA_TBCONVEN.OBS_AGEND_ONLINE` / `SIAGENDA_TBCONVEN.OBS_AGEND_ONLINE` (por agenda × convênio) | `agenda_fonte_pagadora.observacao_marcacao_online` | **0 e 0** | Vazia na cópia. O código da API atual já a expõe (`observacoesPorConvenio`): conferir numa cópia nova. |

**Dados estruturados ao lado do texto**
- `REAGENDA_TBCONVEN`: 98 agendas × 44 convênios. `SIAGENDA_TBCONVEN`: 22 agendas × 44 convênios.
  - Só o convênio principal, sem plano.
- `TBTIPPLANO`: 2 linhas, nenhuma ligada a convênio. **Os subplanos não existem como cadastro**: só no texto.
  - Exemplo de forma: uma operadora única no cadastro com "atende somente o plano X e Y" na observação.
- `REAGENDA.CRM` = 0 em **136 de 138** agendas de consulta, e `SIAGENDA.CRM` = 0 em 38 de 40.
  - A agenda **não aponta para o médico**.
  - A API atual deduz o médico **pelo nome da agenda** (padrão "ESPECIALIDADE - DR NOME") e casa o nome com o
    cadastro por palavras.
  - No destino, `agenda_servico.profissional_id` fica nulo em quase todas, salvo resolução.
- Faixa etária em coluna: `FX_INC`=0 e `FX_FIN`=999 em todas as 138. Ou seja, **nenhuma** agenda usa a coluna:
  a restrição de idade está no texto (52 citam "ANOS").
  - O mapa trata só o 0 como sem limite: o 999 também deve virar NULL.
- `PERFIN >= hoje` em 0 agendas na cópia: o período cadastrado já passou. Os pedidos da Hal-AI mostram que
  `PERINI` e `PERFIN` não limitam vagas.

### 5.2 Como a API atual (sante-api) usa isso, só leitura

**`/consultas/valor`** (`services/valores.js`)
- Lê `FCCODCON.VLR_CONSULTA` (`CON` = particular; o código vem de `perfil-cadastro`) por
  `TBPROFIS.NOME` → `TBCBOPRO` (ativo) → `FCCODCON`.
- Casa o nome por palavras, todas obrigatórias.
- Devolve:
  - `disponivel`, `medico` (o termo), `convenio`, `total`;
  - `itens[]{medico, crm, valor}`;
  - `motivo` e `sugestoes` quando vem zero.
- Para outro convênio: `disponivel:false`, com o motivo de que só o particular tem valor.
- O pedido da Hal-AI (29/08) mediu que 24 de 54 médicos do catálogo ficavam sem valor pelo casamento por
  substring. Já foi corrigido para casar por palavra.

**`/exames/valor`**
- Tabela `TBCONVEN.THM_E` → `TBTABTHM` (nome `LIKE`) + `TBVLRTHM` na maior data até hoje.
- Devolve:
  - `convenio{codigo, nome, ativo, tabelaHonorario}`;
  - `itens[]{codigo, nome, valor, componentes{custoOperacional, filme, anestesia, outros}, valorTotal,
    vigencia, situacao}`;
  - `disponivel` e `motivo` quando vem zero.

**`/exames/cobertura`**
- Devolve `coberturaPorExame:false`, `motivo`, `convenio`, `convenioAtende` e, com `agenda`, também
  `aceitoNaAgenda` e `restricaoConfigurada`.
- Sai de `SIAGENDA_TBCONVEN`; a lista vazia vale como "aceita todos".

**`/convenios`**
- Devolve `{codigo, nome, ativo, permiteAtendimento, particular}` a partir de `TBCONVEN`.
- Há três convênios chamados "particular". A API usa o código configurado.

**`/medicos`**
- Devolve `{tipo, agenda, especialidade | procedimento, categoria, vigencia}`, montado das agendas vigentes,
  mais o campo `atende`.

**`/consultas/catalogo` e `/exames/catalogo`**
- Devolvem `{agendaId, agenda, especialidade, medico, duracaoMin, vigencia, observacao, observacaoPortal,
  observacaoTruncada?, observacoesPorConvenio[]{codigo, nome, observacao}}`, mais `medicoCadastro` e `crm`
  quando a resolução é inequívoca.
- Nos exames, `modalidade` e `categoria`.

**`/consultas/disponibilidade` e `/exames/disponibilidade`**
- Devolvem `horarios[]{data, diaSemana, hora, horaRaw}` e `corte`, a partir de `REPACAGI`/`SIPACAGI` com o
  predicado de vaga livre.

**Observações** (`services/observacoes-agenda.js`)
- A API entrega o **texto inteiro, fiel, com as quebras de linha**. Não extrai plano nem valor.
- **Quem interpreta é o agente de IA de marcação da Hal-AI.**

### 5.3 Decisão do dono: dado estruturado com o texto ao lado

Valores de agenda, subplanos e restrições ganham **colunas e tabelas próprias**. O texto original fica
preservado ao lado, só como origem.

#### DDL proposto

**Ajustes na seção 4.2**
- `regra_preco_profissional` passa a se chamar **`regra_preco`**, com dono flexível:
  - `profissional_id` NULL;
  - mais `agenda_servico_id BIGINT UNSIGNED NULL` com FK RESTRICT para `agenda_servico`;
  - `CHECK (profissional_id IS NOT NULL OR agenda_servico_id IS NOT NULL)`.
- Também entra `origem_texto_id BIGINT UNSIGNED NULL`, com FK RESTRICT para `texto_origem_agenda`.
- Também entra `situacao_revisao VARCHAR(20) NOT NULL DEFAULT 'confirmada'`, com
  `CHECK IN ('proposta','confirmada','recusada')`.
- **Só a situação `confirmada` entra no cálculo de preço.**
- **Exemplos:**
  - valor particular de consulta: `fonte` = particular, item = consulta, `profissional` ou `agenda`;
  - valor particular de exame: `agenda` de exame (sem médico em 38 de 40), item ou grupo do exame;
  - ambos com vigência.

**Cobertura por plano**

```sql
CREATE TABLE agenda_cobertura_plano (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agenda_fonte_pagadora_id BIGINT UNSIGNED NOT NULL,
  plano_fonte_pagadora_id BIGINT UNSIGNED NOT NULL COMMENT 'subplano: plano_fonte_pagadora com plano_superior_id',
  aceita                  BOOLEAN NOT NULL COMMENT 'TRUE = atende o plano; FALSE = exceção "não atende"',
  vigencia_inicio         DATE NOT NULL,
  vigencia_fim            DATE NULL,
  origem_texto_id         BIGINT UNSIGNED NULL,
  situacao_revisao        VARCHAR(20) NOT NULL DEFAULT 'confirmada',
  origem                  VARCHAR(20) NOT NULL DEFAULT 'sistema',
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL,
  excluido_em DATETIME(3) NULL, excluido_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT fk_acp_agenda_fonte FOREIGN KEY (agenda_fonte_pagadora_id) REFERENCES agenda_fonte_pagadora(id) ON DELETE RESTRICT,
  CONSTRAINT fk_acp_plano  FOREIGN KEY (plano_fonte_pagadora_id) REFERENCES plano_fonte_pagadora(id) ON DELETE RESTRICT,
  CONSTRAINT fk_acp_texto  FOREIGN KEY (origem_texto_id) REFERENCES texto_origem_agenda(id) ON DELETE RESTRICT,
  CONSTRAINT ck_acp_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT ck_acp_revisao  CHECK (situacao_revisao IN ('proposta','confirmada','recusada')),
  CONSTRAINT ck_acp_origem   CHECK (origem IN ('sistema','migracao','integracao')),
  UNIQUE KEY uq_acp (agenda_fonte_pagadora_id, plano_fonte_pagadora_id, vigencia_inicio),
  KEY ix_acp_plano (plano_fonte_pagadora_id), KEY ix_acp_texto (origem_texto_id)
) COMMENT='Cobertura da agenda por subplano da fonte pagadora (aceita ou exceção), com vigência e texto de origem';
```

- **Regra:** sem linha em `agenda_cobertura_plano`, vale o convênio inteiro (`agenda_fonte_pagadora`).
- Com linhas `aceita=TRUE`, **só** esses planos.
- Uma linha `aceita=FALSE` exclui o plano.
- O plano do paciente vem de `cobertura_paciente` / `plano_fonte_pagadora`.

**Restrições da agenda**
- `agenda_servico` já tem `idade_minima_anos`, `idade_maxima_anos`, `dias_retorno`, `peso_maximo_kg` e
  `exige_encaminhamento`.
- Acrescentar `sexo_atendido VARCHAR(20) NOT NULL DEFAULT 'todos'`, com
  `CHECK IN ('todos','feminino','masculino')`.
- Para restrição que muda por convênio ou plano, criar `agenda_restricao`, com:
  - `agenda_servico_id`, `fonte_pagadora_id` NULL e `plano_fonte_pagadora_id` NULL;
  - `idade_minima_anos`, `idade_maxima_anos`, `sexo_atendido` e `dias_retorno`, todos NULL = herda;
  - vigência, `origem_texto_id`, `situacao_revisao` e auditoria;
  - `CHECK idade_minima_anos <= idade_maxima_anos`.

**Texto de origem preservado, igual byte a byte**

```sql
CREATE TABLE texto_origem_agenda (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agenda_servico_id   BIGINT UNSIGNED NOT NULL,
  fonte_pagadora_id   BIGINT UNSIGNED NULL COMMENT 'preenchido só no texto por agenda × convênio',
  campo               VARCHAR(30) NOT NULL COMMENT 'observacao | orientacao_marcacao | observacao_convenio',
  texto               MEDIUMTEXT NOT NULL COMMENT 'íntegro, sem corte e sem mexer em quebras',
  hash_texto          BINARY(16) NOT NULL COMMENT 'BLAKE2b-128 dos bytes da origem (o mesmo hash do conector)',
  situacao_estruturacao VARCHAR(20) NOT NULL DEFAULT 'pendente' COMMENT 'pendente | proposta | revisada | sem_regra',
  revisado_em DATETIME(3) NULL, revisado_por BIGINT UNSIGNED NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), criado_por BIGINT UNSIGNED NULL,
  alterado_em DATETIME(3) NULL, alterado_por BIGINT UNSIGNED NULL,
  versao INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT fk_toa_agenda FOREIGN KEY (agenda_servico_id) REFERENCES agenda_servico(id) ON DELETE RESTRICT,
  CONSTRAINT fk_toa_fonte  FOREIGN KEY (fonte_pagadora_id) REFERENCES fonte_pagadora(id) ON DELETE RESTRICT,
  CONSTRAINT ck_toa_campo  CHECK (campo IN ('observacao','orientacao_marcacao','observacao_convenio')),
  CONSTRAINT ck_toa_conv   CHECK ((campo = 'observacao_convenio') = (fonte_pagadora_id IS NOT NULL)),
  CONSTRAINT ck_toa_sit    CHECK (situacao_estruturacao IN ('pendente','proposta','revisada','sem_regra')),
  UNIQUE KEY uq_toa (agenda_servico_id, campo, fonte_pagadora_id),
  KEY ix_toa_fonte (fonte_pagadora_id)
) COMMENT='Texto livre original das agendas, preservado íntegro como origem das regras estruturadas';
```

- **Correção no mapa:** `agenda_servico.observacao` em VARCHAR(2000) **resumida com pendência** quebra a
  fidelidade.
  - Os textos vão inteiros para `texto_origem_agenda`.
  - As colunas `agenda_servico.observacao`, `orientacao_marcacao` e
    `agenda_fonte_pagadora.observacao_marcacao_online` passam a ser a observação editável do produto, ou viram
    visão sobre `texto_origem_agenda`, sem duplicar.

#### Migração do texto (conector e revisão)

1. O conector copia os três campos para `texto_origem_agenda`, íntegros, com o hash.
   - **Não interpreta**: a regra 5 e o ADR 0002 proíbem vetorização e texto clínico no conector, e
     interpretar valor é decisão de negócio.
2. Um **extrator determinístico** (script versionado, com teste) gera regras em `situacao_revisao='proposta'`:
   - valor: padrão monetário próximo de "consulta", "exame" ou "particular" → `regra_preco` `valor_fixo`;
   - plano: nome de plano contra o cadastro de `plano_fonte_pagadora`, com "somente/apenas" → `aceita=TRUE` e
     "não atende" → `aceita=FALSE`;
   - idade: "N anos", "a partir de", "até" → `agenda_restricao` ou colunas da agenda;
   - retorno e sexo do mesmo modo.
   - O que não casar fica no texto, com `situacao_estruturacao='pendente'`.
3. **Revisão pela tela** (ADR 0007, "revisão pelas telas"):
   - a tela mostra lado a lado o texto original, com o trecho destacado, e a regra proposta;
   - a pessoa confirma, corrige ou recusa;
   - só `confirmada` vale.
4. Os subplanos citados no texto e inexistentes no cadastro viram `plano_fonte_pagadora` com
   `plano_superior_id`, em situação `proposta`, para o cliente confirmar.
   - A origem tem 0 planos ligados a convênio.
5. **Agenda sem médico** (136 de 138): a ligação agenda → profissional é resolvida pelo nome da agenda com a
   mesma regra de palavras da API atual.
   - Só a resolução inequívoca grava `profissional_id`. A ambígua vira pendência de revisão.
6. **Sincronização diferencial:** se o hash do texto mudar na origem, o texto é atualizado. As regras que nasceram
   dele voltam para `proposta`, com alerta. Nunca se apaga uma regra confirmada sem revisão.
7. **Depende de cópia mais nova:**
   - o extrator e a amostra de conferência têm de rodar sobre a cópia com as correções do hospital;
   - a cópia de 19/10 serve para medir a forma e testar o extrator, não para fechar a carga.

#### Coerência com o agente de IA

- Na coexistência, o agente continua lendo o texto (`observacao` e afins), **idêntico** ao de hoje, porque sai de
  `texto_origem_agenda.texto` com a mesma normalização da API atual (`normalizaTextoAgenda` + `textoExibivel` +
  teto `MAX_OBSERVACAO_AGENDA`, que gera `observacaoTruncada`).
- **Conferência por script**, para cada agenda: a regra estruturada confirmada × o que o extrator acha no texto
  atual.
  - A divergência aparece na tela e no relatório: "o texto diz X e a regra diz Y".
  - A edição só da regra, ou só do texto, gera alerta até as duas ficarem coerentes.
- **Passagem do agente para o estruturado:** campos **novos** numa versão nova da API, nunca alterando a de
  compatibilidade.
  - Exemplos: `valorParticular`, `planosAceitos`, `restricoes`.
  - Quando o agente migrar, o texto vira só a observação humana.

### 5.4 API de compatibilidade: origem estruturada de cada campo

**Princípio:** a resposta tem de ser **idêntica** à atual.
- Por isso a compatibilidade reproduz a **semântica da origem**, inclusive as limitações, e não a regra nova.
  Exemplos de limitação:
  - só particular tem valor de consulta;
  - `/exames/valor` pelo nome na tabela `THM_E`;
  - `coberturaPorExame:false`.
- Os textos de `motivo` e `sugestoes` vêm do mesmo código, portado, sobre as colunas abaixo.
- Os códigos externos (convênio, agenda, procedimento) usam a chave da origem, guardada no destino:
  - `fonte_pagadora.codigo` = `TBCONVEN.COD`;
  - `preco_procedimento.codigo_cobranca` = `TBTABTHM.COD`;
  - **`agenda_servico` precisa guardar `codigo_origem`** = `REAGENDA.ID`/`SIAGENDA.ID`, para o `agendaId`.

| Rota | Campo | Coluna estruturada de origem |
|---|---|---|
| `/convenios` | `codigo`, `nome` | `fonte_pagadora.codigo`, `fonte_pagadora.nome` |
| | `ativo` | `fonte_pagadora.situacao = 'ativa'` |
| | `permiteAtendimento` | coluna a criar (`fonte_pagadora.permite_atendimento`), a partir de `TBCONVEN.PERMITE_ATEND`. Conferir se está no mapa. |
| | `particular` | `fonte_pagadora.id` = o particular padrão do cliente: parâmetro de configuração `fonte_pagadora_particular_id`, já que há três "particular" |
| `/consultas/valor` | `convenio{...}` | o mesmo de `/convenios` |
| | `itens[].medico` | `profissional.nome` (nome legal, o mesmo que a API casa hoje) |
| | `itens[].crm` | `inscricao_conselho.numero` da inscrição ativa |
| | `itens[].valor` | `regra_preco.valor_fixo` com fonte = particular, item = consulta, `profissional_id` preenchido, `agenda_servico_id` NULL, `situacao_revisao='confirmada'`, `origem='migracao'` de `FCCODCON`, vigente na data. Para ser idêntico, **só as regras nascidas de `FCCODCON`** (marcadas por `origem_texto_id IS NULL`); as do texto ficam para a API nova. |
| | `disponivel`, `total`, `motivo`, `sugestoes` | Calculados (mesmo código); `sugestoes` sobre `profissional.nome` |
| `/exames/valor` | `convenio.tabelaHonorario` | `tabela_preco.codigo` da tabela de honorário externo vigente do contrato (`contrato_tabela_vigencia.tipo_item='honorario_ambulatorial'`), equivalente a `THM_E` |
| | `itens[].codigo`, `nome` | `preco_procedimento.codigo_cobranca`, `descricao_cobranca` (ou `item_faturavel.descricao`) |
| | `valor` | `preco_procedimento_valor.valor_honorario` da maior `vigencia_inicio` ≤ hoje |
| | `componentes.custoOperacional`, `filme`, `anestesia`, `outros` | `preco_procedimento_valor.valor_custo_operacional`, `valor_filme`, `valor_anestesia`, `valor_outros` |
| | `valorTotal` | A soma dos cinco, calculada como hoje, e não `valor_total` |
| | `vigencia`, `situacao` | `preco_procedimento_valor.vigencia_inicio`; `preco_procedimento.ativo` (A/I) |
| `/exames/cobertura` | `coberturaPorExame`, `motivo` | Constantes, como hoje |
| | `convenio`, `convenioAtende` | `fonte_pagadora` (como em `/convenios`) |
| | `aceitoNaAgenda`, `restricaoConfigurada` | `agenda_fonte_pagadora` da agenda (lista vazia = aceita todos). **Ignora `agenda_cobertura_plano`**, que fica para a API nova. |
| `/consultas/catalogo`, `/exames/catalogo` | `agendaId` | `agenda_servico.codigo_origem` |
| | `agenda` | `agenda_servico.nome` |
| | `especialidade`, `medico` | Calculados do nome da agenda (mesmo parser). Não vêm de `profissional_id`, para manter o idêntico. |
| | `medicoCadastro`, `crm` | `profissional.nome` / `inscricao_conselho.numero`, pela mesma resolução por nome. O `profissional_id` confirmado pode ser usado se der o mesmo resultado (teste dourado). |
| | `duracaoMin` | `agenda_servico.duracao_horario_minutos` |
| | `vigencia{inicio, fim}` | **A criar:** `agenda_servico.vigencia_inicio` e `vigencia_fim`, de `PERINI`/`PERFIN`. Conferir no mapa; o filtro "vigente" da API depende disso. |
| | `observacao`, `observacaoPortal`, `observacaoTruncada` | `texto_origem_agenda.texto` (campos `observacao` e `orientacao_marcacao`), com a mesma normalização e o mesmo teto |
| | `observacoesPorConvenio[]` | `texto_origem_agenda` (campo `observacao_convenio`) + `fonte_pagadora.codigo` e `nome` |
| | `modalidade`, `categoria{codigo, nome}` (exame) | **Conferir:** coluna da modalidade em `agenda_servico` e `grupo_ato` (`TBTABATO`) via `categoria_agenda_id` |
| `/medicos` | `tipo`, `agenda`, `especialidade`/`procedimento`, `categoria`, `vigencia` | O mesmo do catálogo |
| `/consultas/disponibilidade`, `/exames/disponibilidade` | `horarios[].data`, `hora`, `horaRaw`, `diaSemana`; `corte` | Horário livre da grade do produto (`geracao_grade` / horário da agenda). `horaRaw` é o HHMM da origem, recalculado de `hora`. O predicado "livre" tem de reproduzir `LIVRE`, `SITUACAO` e `PACIENTE` vazio. |

**Prova exigida**
- Teste dourado de compatibilidade: as mesmas consultas, contra o Firebird pela API atual e contra o MariaDB pela
  API de compatibilidade, sobre a **mesma imagem**.
- Comparação do JSON byte a byte, depois de ordenar as chaves, para cada rota e uma amostra de termos (os
  critérios de aceite dos pedidos da Hal-AI servem de roteiro).
- A divergência bloqueia a virada.

**Colunas que faltam no modelo** para o "idêntico":
- `agenda_servico.codigo_origem`;
- `agenda_servico.vigencia_inicio` e `vigencia_fim`;
- `fonte_pagadora.permite_atendimento`;
- `texto_origem_agenda`, sem corte;
- o parâmetro `fonte_pagadora_particular_id`.
