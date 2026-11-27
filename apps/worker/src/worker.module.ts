import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { CensoFechamentoService } from './censo-fechamento.service.js';
import { ClassificacaoEstouroService } from './classificacao-estouro.service.js';
import { AvisoClinicoEmailService } from './aviso-clinico-email.service.js';
import { CancelamentoContratoService } from './cancelamento-contrato.service.js';
import { ContratosVencimentoService } from './contratos-vencimento.service.js';
import { DataMartCargaService } from './datamart-carga.service.js';
import { FilaErpService } from './exportacao-erp/fila.service.js';
import { PacotesParceiroEntregaService } from './pacotes-parceiro-entrega.service.js';
import { NotificacaoDespachoService } from './notificacao-despacho.service.js';
import { NirReservaService } from './nir-reserva.service.js';
import { LeituraFatosContabeisService } from './contabil/leitura-fatos.service.js';
import { PacsWorklistService } from './pacs-worklist.service.js';
import { PessoasConselhoService } from './pessoas-conselho.service.js';
import { RedeMpiService } from './rede-mpi.service.js';
import { IntegracaoService } from './integracao/integracao.service.js';
import { EnvioRelatorioService } from './relatorios/envio-agendado.service.js';
import { EmailService } from './email.service.js';
import { IndiceBuscaService } from './indice-busca.service.js';
import { PublicadorCatalogosService } from './publicador-catalogos.service.js';
import { RelayOutboxService } from './relay-outbox.service.js';
import { TransmissorTissService } from './transmissor-tiss.service.js';
import { Relogio } from './relogio.js';
import { SinalDeVidaService } from './sinal-de-vida.service.js';
import { VigiaArquivosService } from './vigia-arquivos.service.js';
import { VigiaBancoService } from './vigia-banco.service.js';

// Vigia do banco próprio (transações abertas, pools, plataforma, saúde dos serviços) exportado por OpenTelemetry
// (lote F2.2 05-17; as vigias de coexistência com o banco de origem saíram: ADR 0003).
// M04: relay da outbox (SGH_OUTBOX → BullMQ) com o consumidor nulo idempotente.
// M06: fila email (alerta de quebra de vidro ao Auditor, por SMTP; Mailpit fora de produção).
// M11: leitura incremental do índice de busca do cadastro (SGH_BUSCA_NOME).
// M13: publicador das cargas de catálogo aprovadas (lotes curtos na janela fora do pico, pelo executor).
// M15: representação derivada dos formulários do PEP (SGH_PEP_FORM_VERSAO), quando o layout muda no Delphi.
// M16: fechamento do censo diário na hora de fechamento (SGH_INT_CENSO_DIA), com a chave internacao.censo.fechamento.
// M44: aviso do estouro do tempo-alvo da classificação de risco (SGH_PA_CLASSIF_AVISO), com a chave pa.classificacao.
// M44 (etapa 2): expiração das reservas de leito do NIR vencidas (SGH_INT_RESERVA_LEITO; a solicitação volta à análise).
// M34: envio agendado de relatório (fila relatorio-<rede> e os vencidos) e as integrações novas (vigia dos fatos,
// entrega com retentativa e fila de mortos, alerta da regra 10); o consumidor dos eventos fica no relay.
const SERVICOS: Readonly<Record<string, Provider>> = {
  'sinal-de-vida': SinalDeVidaService,
  'vigia-banco': VigiaBancoService,
  // ADR 0004: integridade dos arquivos no disco local (hash x registro) e espaço livre da raiz.
  'vigia-arquivos': VigiaArquivosService,
  'relay-outbox': RelayOutboxService,
  email: EmailService,
  'indice-busca': IndiceBuscaService,
  'publicador-catalogos': PublicadorCatalogosService,
  'censo-fechamento': CensoFechamentoService,
  'classificacao-estouro': ClassificacaoEstouroService,
  'nir-reserva': NirReservaService,
  // M54.1: leitura incremental dos fatos contábeis (SGH_CTB_FATO), fora do pico, com a chave contabil.
  'contabil-fatos': LeituraFatosContabeisService,
  // M52.1: o retrato diário da validade do conselho dos colaboradores (SGH_PES_CONSELHO_DIA; só contagens).
  'pessoas-conselho': PessoasConselhoService,
  // M55 (etapa 3): o alerta diário de vencimento dos contratos com fornecedores (90, 60, 30 dias e vencido).
  'contratos-vencimento': ContratosVencimentoService,
  // 08-SGO L94 (C2-108): a efetivação diária dos cancelamentos de contrato de plano vencidos (baixa e crédito).
  'cancelamento-contrato': CancelamentoContratoService,
  // 03-PEP L133: o despacho por e-mail do aviso clínico das regras (enviado ou falha; fora de produção, a captura).
  'aviso-clinico-email': AvisoClinicoEmailService,
  // 01-ADM L115: a carga diária do data mart pseudonimizado com o registro (carga_data_mart e etapas).
  'datamart-carga': DataMartCargaService,
  // 08-INTG L134: o agendador das entregas aos parceiros (arquivo tratado na porta de arquivos, envio simulado fora de produção).
  'pacotes-parceiro-entrega': PacotesParceiroEntregaService,
  // 01-ADM L76: o despachante da notificação por regra (consolida e, em produção, entrega o canal externo).
  'notificacao-despacho': NotificacaoDespachoService,
  // M47 (etapa 3): a geração automática da lista de trabalho DICOM (os exames de imagem lançados sem item).
  'pacs-worklist': PacsWorklistService,
  // M57 (etapa 1): a carga noturna do MPI da Rede em lotes e o relatório diário de divergência com o reparo.
  'rede-mpi': RedeMpiService,
  // 08-INTG L136: a fila com o ERP corporativo (envio do lote gerado e retorno item a item; simulador fora de produção).
  'fila-erp': FilaErpService,
  // 06-FAT L26: o transmissor TISS da elegibilidade e da comunicação de beneficiário (destino falso fora de produção).
  'transmissor-tiss': TransmissorTissService,
  'relatorio-envio': EnvioRelatorioService,
  integracao: IntegracaoService,
};

/**
 * M34: WORKER_SERVICOS="relatorio-envio" (lista) sobe só esses serviços (o E2E de um worktree com o dev do dono no ar:
 * só a fila nova, sem disputar as filas e o banco do worker do dono). Sem a variável, todos.
 */
export function servicosDoWorker(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const pedidos = (env['WORKER_SERVICOS'] ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (pedidos.length === 0) return Object.values(SERVICOS);
  return ['sinal-de-vida', ...pedidos]
    .filter((n, i, l) => l.indexOf(n) === i && SERVICOS[n])
    .map((n) => SERVICOS[n]!);
}

@Module({
  providers: [
    Relogio,
    SinalDeVidaService,
    VigiaBancoService,
    VigiaArquivosService,
    RelayOutboxService,
    // 06-FAT L26: transmissor TISS (destino falso fora de produção; TRANSMISSOR_TISS=desligado nos testes).
    TransmissorTissService,
    EmailService,
    IndiceBuscaService,
    PublicadorCatalogosService,
    CensoFechamentoService,
    // M44: aviso do estouro do tempo-alvo da classificação de risco (uma vez por classificação).
    ClassificacaoEstouroService,
    // M44 (etapa 2): expiração das reservas de leito do NIR (uma vez por reserva).
    NirReservaService,
    // M54.1: leitura incremental dos fatos contábeis (CONTABIL_LEITURA=ligado em dev/ci).
    LeituraFatosContabeisService,
    // M52.1: o retrato diário da validade do conselho (PESSOAS_CONSELHO_DIARIO=ligado em dev/ci).
    PessoasConselhoService,
    // M55 (etapa 3): alerta de vencimento dos contratos (CONTRATOS_ALERTA_DIARIO=ligado em dev/ci).
    ContratosVencimentoService,
    // 08-SGO L94 (C2-108): efetivação dos cancelamentos de contrato vencidos (CANCELAMENTO_CONTRATO_DIARIO=ligado em dev/ci).
    CancelamentoContratoService,
    // 03-PEP L133: despacho por e-mail do aviso clínico (AVISO_CLINICO_EMAIL=ligado em dev/ci).
    AvisoClinicoEmailService,
    // 01-ADM L115: carga diária do data mart (DATAMART_CARGA_DIARIA=ligado em dev/ci).
    DataMartCargaService,
    PacotesParceiroEntregaService,
    // 01-ADM L76: despachante da notificação por regra (NOTIFICACAO_DESPACHO=ligado em dev/ci).
    NotificacaoDespachoService,
    // M47 (etapa 3): lista de trabalho DICOM (PACS_WORKLIST=ligado em dev/ci).
    PacsWorklistService,
    // M57 (etapa 1): MPI da Rede noturno (REDE_MPI_NOTURNO=ligado).
    RedeMpiService,
    // 08-INTG L136: fila com o ERP corporativo (FILA_ERP_ENVIO=ligado em dev/ci).
    FilaErpService,
    EnvioRelatorioService,
    IntegracaoService,
  ],
})
export class WorkerModule {
  static com(env: NodeJS.ProcessEnv = process.env): DynamicModule {
    return { module: WorkerModuloFiltrado, providers: [Relogio, ...servicosDoWorker(env)] };
  }
}

@Module({})
class WorkerModuloFiltrado {}
