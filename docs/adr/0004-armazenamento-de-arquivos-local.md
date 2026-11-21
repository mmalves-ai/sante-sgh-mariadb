# ADR 0004: arquivos no armazenamento da própria máquina, sem S3

- **Data:** 2026-11-21
- **Situação:** aceita (decisão do dono)

## Decisão

Em produção, o sistema **não usa S3** (nem o da AWS nem compatível). Todos os arquivos ficam no **armazenamento da
máquina que hospeda o sistema**:

- na **EC2 de hospedagem**, para o cliente na nuvem;
- na **máquina local do cliente**, quando ele opta por instalação local.

Valem para todos os arquivos: documentos clínicos emitidos (PDF/A), segundas vias, digitalizações, fotos (portaria,
internação), XML do TISS, provas do portal do paciente, arquivos de catálogo e anexos.

## Origem do S3 (para registro)

- **Ninguém aprovou o S3.** Ele veio do `new-sgh`, pelo ADR 0015 de lá, "Armazenamento S3 com Object Lock".
  - Um agente o escreveu em 2026-10-19, no marco M09.
  - A situação continua "proposto, aguarda o aceite do dono (DP-2)": o aceite nunca veio.
- Junto com o ADR, o agente criou o container provisório `sgh-s3` (SeaweedFS) e o código de emissão que grava nele.
  O `sante-sgh` herdou esse código ao copiar a API do `new-sgh`.
- **Fica a exigência de fundo**, que é legítima:
  - documento emitido imutável, com retenção de 20 anos (Lei 13.787/2018 e Res. CFM 1.821/2007);
  - original nunca sobrescrito, 2ª via marcada e hash conferido.

  Muda só o meio: disco da máquina, no lugar do S3.

## Consequências

1. **Uma porta de armazenamento de arquivos** (vocabulário neutro: guardar, ler, existe, reter até, verificar), com um
   adaptador de **sistema de arquivos local**. Os 14 módulos da API e o worker que hoje usam o cliente S3 direto
   (`apps/api/src/modulos/documento/infra/s3.ts`) passam a usar a porta. O adaptador S3 sai do produto.
2. **A imutabilidade, que o Object Lock dava, passa a ser garantida pelo sistema:**
   - gravação só uma vez: arquivo temporário, depois rename atômico, criação exclusiva e nunca sobrescrita;
   - arquivo somente leitura no disco;
   - caminho por cliente, estabelecimento e data, mais o hash;
   - registro no banco do cliente com hash SHA-256, tamanho, tipo, `retido_ate` e modo de retenção;
   - exclusão recusada antes de `retido_ate`, pela regra do domínio;
   - versão nova nunca apaga a anterior;
   - o vigia do worker confere periodicamente o hash de cada arquivo contra o registro e alerta divergência ou falta.
3. **Raiz configurável por instalação** (`ARQUIVOS_RAIZ`), com um diretório por cliente (um banco e uma pasta por
   cliente, ADR 0002). Na instalação, o sistema confere permissão, espaço livre e alerta abaixo de um limite.
4. **Cópia de segurança** é responsabilidade da hospedagem:
   - na EC2, snapshot do volume (EBS);
   - na instalação local, rotina de backup do cliente.

   O sistema entrega a ferramenta de conferência (hash × registro) e o relatório para provar que a cópia está íntegra.
5. **Desenvolvimento e testes** usam uma pasta local por cliente de teste (`SGH_CLIENTE_TESTE`). Deixam de depender do
   container `sgh-s3`, que é do `new-sgh`, e a lotação de buckets de teste deixa de existir.

## Execução

Mudança compartilhada, por um agente sozinho, depois da F2.4 (ela edita os mesmos módulos). O pedido
`docs/obra/fatias/f24/saida/s3-testes.json` fica substituído por esta decisão: os testes de PDF passam a usar o
armazenamento local.
