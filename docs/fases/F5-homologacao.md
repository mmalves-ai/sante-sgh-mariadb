# F5. Homologação com dados reais e ensaios (Fase A do ADR 0001)

**Objetivo:** a equipe do hospital testa o sistema novo com os próprios dados, enquanto continua no
SPDATA. A virada é ensaiada até ter duração conhecida.

**Entra:** F3 dos módulos da rodada; F4 com a carga completa conciliada.
**Sai (portão):**
- aceite por setor;
- dois ensaios gerais cronometrados;
- plano de virada aprovado pelo hospital.

---

### F5.1 Pré-requisitos de LGPD (bloqueantes)

A primeira carga com dados reais não acontece sem os quatro itens:

1. contrato de tratamento de dados entre o hospital (controlador) e a equipe do sistema (operadora);
2. RIPD aprovado pelo encarregado (DPO) do hospital;
3. lista nominal de quem acessa a homologação, as pendências e o de-para;
4. registro de acesso por pessoa.

### F5.2 Ambiente de homologação

- **Entregas:**
  - **MariaDB de homologação descartável.**
  - **Neutralização a cada carga:**
    - SMTP para captura local;
    - WhatsApp e SMS desligados;
    - TISS e laboratório para destinos falsos;
    - sem rede de saída;
    - envio para fora só com a chave de produção.
  - **Bucket próprio,** sem Object Lock COMPLIANCE.
- **Aceite:** relatório de cada rodada com zero saídas externas.

### F5.3 Inventários

- **Entregas:**
  - origens externas (CPDIGITAL/CDDIGITAL, GED, arquivos), que viram origens do conector;
  - integrações de entrada e saída, com o plano de cada uma para a virada;
  - licenças de catálogo (Brasíndice, Simpro, CBHPM, CEP) para a Rede Santé no sistema novo;
  - contrato do SPDATA: direito de manter e consultar a cópia arquivada.
- **Aceite:** inventários revisados pela TI do hospital.

### F5.4 Rodadas por setor

- **Entregas:**
  - **Cada rodada:** carga completa de uma imagem nova, avaliação por setor e conciliação.
  - **Correções:** viram regra do mapa, de-para ou regra de domínio, nunca edição manual.
  - **Usuários e perfis:** migrados, com o mapeamento de perfis aprovado por setor.
- **Aceite:** aceite assinado pelo responsável de cada setor.

### F5.5 Ensaios gerais da virada

- **Entregas:**
  - **Pelo menos dois ensaios completos e cronometrados:** dia 0, diferenciais, janela final, numeração,
    integrações e liberação.
  - **Valores fixados a partir dos ensaios:**
    - duração da janela e hora H;
    - N e M da trava;
    - X horas do gatilho de retorno;
    - lista de pendências críticas.
- **Aceite:** o último ensaio fecha dentro da janela-alvo.

### F5.6 Plano de virada

- **Entregas:**
  - formulários de contingência em papel e redigitação;
  - ordem de desligar e ligar as integrações;
  - gatilhos de retorno e o relatório de redigitação para o caso de retorno;
  - comunicação aos setores;
  - escala de plantão do dia.
- **Aceite:** plano aprovado pela direção do hospital.
