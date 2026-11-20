import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { CensoFechamentoService } from './censo-fechamento.service.js';
import { ClassificacaoEstouroService } from './classificacao-estouro.service.js';
import { ContratosVencimentoService } from './contratos-vencimento.service.js';
import { NirReservaService } from './nir-reserva.service.js';
import { LeituraFatosContabeisService } from './contabil/leitura-fatos.service.js';
import { PacsWorklistService } from './pacs-worklist.service.js';
import { PessoasConselhoService } from './pessoas-conselho.service.js';
import { RedeMpiService } from './rede-mpi.service.js';
import { CoexistenciaRetratoService } from './coexistencia-retrato.service.js';
import { IntegracaoService } from './integracao/integracao.service.js';
import { EnvioRelatorioService } from './relatorios/envio-agendado.service.js';
import { EmailService } from './email.service.js';
import { IndiceBuscaService } from './indice-busca.service.js';
import { PublicadorCatalogosService } from './publicador-catalogos.service.js';
import { RelayOutboxService } from './relay-outbox.service.js';
import { RepresentacaoPepService } from './representacao-pep.service.js';
import { VigiaParecerService } from './vigia-parecer.service.js';
import { Relogio } from './relogio.js';
import { SinalDeVidaService } from './sinal-de-vida.service.js';
import { VigiaFirebirdService } from './vigia-firebird.service.js';
import { VigiaGravacaoService } from './vigia-gravacao.service.js';
import { VigiaVaziasService } from './vigia-vazias.service.js';

// M09: vigia do Firebird (coletor MON$, alertas, saúde dos serviços) exportado por OpenTelemetry.
// M04: relay da outbox (SGH_OUTBOX → BullMQ) com o consumidor nulo idempotente.
// M06: fila email (alerta de quebra de vidro ao Auditor, por SMTP; Mailpit fora de produção).
// M11: leitura incremental do índice de busca do cadastro (SGH_BUSCA_NOME).
// M13: publicador das cargas de catálogo aprovadas (lotes curtos na janela fora do pico, pelo executor).
// M15: representação derivada dos formulários do PEP (SGH_PEP_FORM_VERSAO), quando o layout muda no Delphi.
// M14: vigia diária das tabelas vazias (SGH_CFG_TABELA_VAZIA; aviso à TI e ao responsável técnico).
// M16: fechamento do censo diário na hora de fechamento (SGH_INT_CENSO_DIA), com a chave internacao.censo.fechamento.
// M44: aviso do estouro do tempo-alvo da classificação de risco (SGH_PA_CLASSIF_AVISO), com a chave pa.classificacao.
// M44 (etapa 2): expiração das reservas de leito do NIR vencidas (SGH_INT_RESERVA_LEITO; a solicitação volta à análise).
// M34: envio agendado de relatório (fila relatorio-<rede> e os vencidos) e as integrações novas (vigia dos fatos,
// entrega com retentativa e fila de mortos, alerta da regra 10); o consumidor dos eventos fica no relay.
const SERVICOS: Readonly<Record<string, Provider>> = {
  'sinal-de-vida': SinalDeVidaService,
  'vigia-firebird': VigiaFirebirdService,
  'relay-outbox': RelayOutboxService,
  email: EmailService,
  'indice-busca': IndiceBuscaService,
  'publicador-catalogos': PublicadorCatalogosService,
  'representacao-pep': RepresentacaoPepService,
  'vigia-parecer': VigiaParecerService,
  'vigia-vazias': VigiaVaziasService,
  'censo-fechamento': CensoFechamentoService,
  'classificacao-estouro': ClassificacaoEstouroService,
  'nir-reserva': NirReservaService,
  // M54.1: leitura incremental dos fatos contábeis (SGH_CTB_FATO), fora do pico, com a chave contabil.
  'contabil-fatos': LeituraFatosContabeisService,
  // M52.1: o retrato diário da validade do conselho dos colaboradores (SGH_PES_CONSELHO_DIA; só contagens).
  'pessoas-conselho': PessoasConselhoService,
  // M55 (etapa 3): o alerta diário de vencimento dos contratos com fornecedores (90, 60, 30 dias e vencido).
  'contratos-vencimento': ContratosVencimentoService,
  // M47 (etapa 3): a geração automática da lista de trabalho DICOM (os exames de imagem lançados sem item).
  'pacs-worklist': PacsWorklistService,
  // M57 (etapa 1): a carga noturna do MPI da Rede em lotes e o relatório diário de divergência com o reparo.
  'rede-mpi': RedeMpiService,
  'relatorio-envio': EnvioRelatorioService,
  integracao: IntegracaoService,
  // M37: retrato das conexões do outro sistema e uso do dia (painel de migração gradual).
  'coexistencia-retrato': CoexistenciaRetratoService,
  // M38: vigilância diária de gravação em produção (SGH_CFG_COEX_VIGIA e o alerta direto da divergência).
  'vigia-gravacao': VigiaGravacaoService,
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
    VigiaFirebirdService,
    RelayOutboxService,
    EmailService,
    IndiceBuscaService,
    PublicadorCatalogosService,
    RepresentacaoPepService,
    // M23: pedidos de parecer feitos no outro sistema entram na fila (leitura incremental).
    VigiaParecerService,
    VigiaVaziasService,
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
    // M47 (etapa 3): lista de trabalho DICOM (PACS_WORKLIST=ligado em dev/ci).
    PacsWorklistService,
    // M57 (etapa 1): MPI da Rede noturno (REDE_MPI_NOTURNO=ligado).
    RedeMpiService,
    EnvioRelatorioService,
    IntegracaoService,
    CoexistenciaRetratoService,
    VigiaGravacaoService,
  ],
})
export class WorkerModule {
  static com(env: NodeJS.ProcessEnv = process.env): DynamicModule {
    return { module: WorkerModuloFiltrado, providers: [Relogio, ...servicosDoWorker(env)] };
  }
}

@Module({})
class WorkerModuloFiltrado {}
