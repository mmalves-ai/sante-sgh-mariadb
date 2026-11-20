# infra/oie (M34)

Open Integration Engine 4.5.2 (imagem `openintegrationengine/engine:4.5.2-alpine-jre`, digest
`sha256:1981539a81253861a965aeadd3bbf37ae3980088e7351abb6cf7d3f9971dfb78`) para o HL7 v2 novo (ficha do M34, regra 12).

- **Canais versionados** em `canais/`: `oie-apoio-orm.xml` (pedido ao laboratório de apoio, ORM^O01 por MLLP na 6661, o
  ACK do laboratório volta ao Sante) e `oie-classificacao-adt.xml` (admissão no pronto atendimento para a classificação
  de risco externa, ADT^A04 na 6663; começa parado: DP-16). As variáveis `${...}` são trocadas na implantação pelo
  destino de cada ambiente (fora de produção, só simulador local). O retorno do laboratório (ORU^R01) entra pela entrada
  idempotente da API (`POST /api/integracoes/entrada/<estabelecimento>`; D-OIE-34).
- **Implantação**: pela API REST do motor (`POST /api/channels` e `POST /api/channels/<id>/_deploy`, cabeçalho
  `X-Requested-With`), a mesma que o teste `apps/worker/src/integracao/hl7/oie.int.spec.ts` usa: sobe o motor num
  contêiner descartável (`sgh-oie-teste-*`, portas só em 127.0.0.1), implanta o canal do repositório, manda o pedido pelo
  enviador do worker e confere o ACK do simulador do laboratório; apaga o contêiner no fim.
- **O Sante SGH** guarda a saída de eventos, o estado de cada mensagem (tentativas, recibo, fila de mortos) e a trilha;
  o motor só transforma e entrega. O endereço MLLP do motor no worker: `OIE_MLLP_HOST` (padrão 127.0.0.1); a API do
  motor na tela HL7 v2: `OIE_URL`.
- O primeiro canal real (os analisadores e o laboratório de verdade) depende da DP-17; até lá, só o simulador.
