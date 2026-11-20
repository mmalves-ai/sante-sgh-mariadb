# Brief comum da rodada 2: rastreio tabela a tabela

**Projeto:** `sante-sgh` (`/home/mmalves/workspace/redesante/sante-sgh`). É um sistema hospitalar sobre
banco **MariaDB próprio**, com a aplicação vinda do `new-sgh`.

**Objetivo do dono:** o modelo tem de ficar **melhor que a soma do SPDATA com o MV**. Não é para
economizar.

**Papel de cada origem:**
- **SPDATA:** é a base de dados de onde a Rede Santé migra.
- **MV:** é referência de recursos.
- **Nosso modelo:** é próprio.

**Meta desta rodada:** **toda** tabela do MV e **toda** tabela com dados do SPDATA ganha destino
explícito. Nada fica de fora sem decisão.

## Regras de nome (obrigatórias)

**Nome de tabela própria:**
- português, `snake_case`, singular, sem prefixo de sistema;
- exemplos: `paciente`, `conta_hospitalar`, `conta_hospitalar_item`, `lote_estoque`.

**Proibido no nome e na descrição:**
- nome de tabela do MV ou do SPDATA;
- siglas deles (`TB`, `PW_`, `IT`, `CD_`);
- as palavras "mv", "soul", "spdata".

Os nomes do MV e do SPDATA só podem aparecer na coluna `evidencia` e nos campos `esquema`/`tabela` de
origem.

**Descrição:** sempre com palavras próprias, até 160 caracteres. Nunca copie o descritivo do MV.

## Modelo físico: liste TABELAS, não só entidades

Cada conceito vira as tabelas de que precisa. Use um destes tipos:

| tipo | uso |
|---|---|
| `principal` | O registro de negócio (paciente, atendimento, conta) |
| `item` | Linhas de um documento (item da conta, item da prescrição) |
| `dominio` | Lista fechada mantida pelo hospital (motivo de alta, tipo de leito) |
| `vinculo` | N:N entre duas tabelas (profissional × especialidade) |
| `historico` | Versões ou mudanças de situação de uma tabela, quando o negócio exige a linha do tempo |
| `configuracao` | Regra ou parâmetro estruturado de um módulo (regra de repasse, regra de cobrança) |
| `catalogo_publico` | Carregado de fonte oficial (TUSS, SIGTAP, CID, CBO, IBGE, CNES, TISS) |

**Fases:**
- `F3`: paridade com o que a Rede Santé usa no SPDATA;
- `F7`: exigido para vender a hospital novo;
- `F8`: recurso novo inspirado no MV.

**Módulos (código):**

| Código | Módulo | Código | Módulo |
|---|---|---|---|
| `ADM` | administração e segurança | `SUP` | farmácia e suprimentos |
| `SIS` | técnico | `FAT` | faturamento de convênio e TISS |
| `REL` | relatórios e BI | `SUS` | faturamento SUS |
| `CAD` | cadastros-base | `FIN` | financeiro, fiscal e contábil |
| `REC` | recepção e atendimento | `RH` | pessoas |
| `AGE` | agenda | `SGO` | operadora de plano |
| `PEP` | prontuário, prescrição e enfermagem | `INTG` | integrações |
| `INT` | internação e leitos | `QUA` | qualidade e segurança do paciente |
| `CC` | centro cirúrgico e CME | | |
| `HOT` | hotelaria, SAME, nutrição e manutenção | | |
| `SADT` | diagnóstico | | |

## Mecanismos comuns

Use um mecanismo comum quando a tabela de origem não vira tabela própria. O valor vai em `destino`:

| Mecanismo | Quando usar |
|---|---|
| `trilha_auditoria` | Log de quem fez o quê (auditoria única do sistema) |
| `historico_entidade:<tabela_propria>` | Log ou histórico que vira o histórico daquela tabela |
| `parametro` | Parâmetro ou configuração solta (mecanismo único de parâmetros por estabelecimento) |
| `integracao` | Fila, área de troca ou log de integração (motor único de integração) |
| `datamart` | Dimensão ou fato de BI (o data mart é gerado do nosso modelo) |
| `catalogo_publico:<fonte>` | O conteúdo vem da fonte oficial (`tuss`, `sigtap`, `cid10`, `cbo`, `ibge`, `cnes`, `tiss`, `ans_rol`) |
| `framework` | Tela, menu, editor de formulário, tradução, agendador de jobs, controle de versão do produto. A nossa plataforma cobre |
| `arquivo` | Documento ou anexo binário (vai para o armazenamento de objetos, com metadado na tabela dona) |

## Formatos de saída (TSV com cabeçalho, separador TAB, UTF-8)

### Mapa de origem: `mapa/<lote>.tsv`

| Campo | Conteúdo |
|---|---|
| `esquema`, `tabela` | Origem, exatamente como na fatia. Para o SPDATA, `esquema = SPDATA` |
| `destino_tipo` | `TABELA`, `MECANISMO` ou `NAO` |
| `destino` | Nome(s) de tabela própria separados por `;`; ou o mecanismo; ou vazio se `NAO` |
| `nova` | `S` se alguma tabela de destino não existe no catálogo compacto; senão `N` |
| `modulo`, `fase` | Da tabela de destino principal (para `NAO`, deixe `fase` vazia) |
| `motivo` | Até 120 caracteres. Obrigatório para `NAO`, com uma destas razões: `copia/backup`, `tecnico do fornecedor sem equivalente`, `obsoleto`, `duplicado de <tabela>`, `sem valor de negocio` |

### Tabelas novas: `novas/<lote>.tsv`

Campos: `tabela`, `modulo`, `tipo`, `fase`, `descricao`, `evidencia`. Uma linha por tabela própria que você
propôs e que não estava no catálogo.

### Catálogo: `catalogo/<grupo>.tsv`

Campos: `tabela`, `modulo`, `tipo`, `fase`, `descricao`, `evidencia`.

## Regras de trabalho (protocolo de tokens)

- Leia **só** a sua fatia e este brief.
- Os arquivos grandes (catálogo completo, `docs/analise/0N-*.md`) só por `grep`/`sed -n` do trecho.
- Grave os resultados em arquivo e devolva só o resumo pedido.
- **Só metadados.** Nunca consulte conteúdo de linhas no Oracle nem no Firebird.
- **Seja minucioso.** Uma linha de mapa por tabela de origem, sem pular nenhuma. Confira, ao final, que o
  número de linhas do seu mapa é igual ao da fatia.
