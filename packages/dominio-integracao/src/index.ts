// @sgh/dominio-integracao (M34): regras puras das integrações novas — retentativa e fila de mortos, idempotência e
// ordem, HL7 v2 (pedido e resultado do laboratório de apoio, ACK, MLLP), FHIR R4 nos perfis BR Core fixados com o
// validador, identificação para a RNDS, retorno do laboratório de apoio, sem canal próprio de mensagem ao paciente e
// os pacotes aos parceiros que leem o banco. Sem banco, sem HTTP, sem Nest.
export * from './retentativa.js';
export * from './idempotencia.js';
export * from './sem-canal-proprio.js';
export * from './pacotes-parceiros.js';
export * from './hl7/mensagem.js';
export * from './fhir/mapeadores.js';
export * from './fhir/validador.js';
export * from './rnds.js';
export * from './ria.js';
export * from './apoio.js';
// F2.2 lote 05-14: o estado da liberação para o parceiro, o pedido ao apoio e a reserva do envio.
export * from './entrega-fatos.js';
export * from './fhir/perfis.js';
// W0-10 (M3): o pacote do titular em FHIR R4/IPS (portabilidade) e o validador do recorte IPS 2.0.0.
export * from './fhir/ips.js';
export * from './hl7/canais.js';
// M58-F4: a fachada da API de integração da Hal-AI (rotas, escopo, erros, motor de dois tempos, painel).
export * from './fachada/index.js';
// F3.9-6: mensagens ao paciente (L133), pacotes e entregas de parceiros (L134) e classificação externa (L140).
export * from './mensagens-paciente.js';
export * from './pacotes-entregas.js';
export * from './classificacao-externa.js';
// F3.9-3: rotinas agendadas com histórico de execução (01-SIS L95).
export * from './rotinas-agendadas.js';
