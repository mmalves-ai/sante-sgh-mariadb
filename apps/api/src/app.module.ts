import { rtfParaTexto, textoCorrido } from '@sgh/dominio-pep';
import type { MedicamentoIps } from '@sgh/dominio-integracao';
import { ErroProblema } from './problema.filter.js';
import { randomBytes } from 'node:crypto';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  type DocumentoSghLido,
  ErroOperacao,
  type Executor,
  fonteCatalogoArquivo,
  NucleoLegado,
} from '@sgh/legado';
import { CATALOGO_LEGADO_ORIGEM } from '@sgh/contratos/catalogo-legado';
import { VinculoSintetico } from '@sgh/dominio-acesso';
import { InterceptadorAuditoria, REGISTRADOR_TRILHA } from './autorizacao/auditoria.interceptor.js';
import { GuardaPermissao } from './autorizacao/guarda.js';
import { GuardaChaveDeTela } from './modulos/config/guarda-chave-de-tela.js';
import { RESOLVEDOR_SESSAO, ResolvedorSessao } from './autorizacao/resolvedor-sessao.js';
import {
  type RegistradorTrilha,
  RegistradorTrilhaLegado,
  RegistradorTrilhaMemoria,
} from './autorizacao/trilha.js';
import { ALERTA_AUDITOR, AlertaPorFila, AlertaSemFila, type AlertaAuditor } from './modulos/acesso/alerta.js';
import { ConsultaAcessoController } from './modulos/acesso/consulta.controller.js';
import { GestaoAcessoController } from './modulos/acesso/gestao.controller.js';
import {
  PedidosAcessoController,
  PedidosAcessoGestaoController,
} from './modulos/acesso/pedido-acesso.controller.js';
import { RecertificacaoController } from './modulos/acesso/recertificacao.controller.js';
import { RhAcessoController } from './modulos/acesso/rh.controller.js';
import {
  ContasDormentesController,
  DESPERTAR_CONTAS_DORMENTES,
} from './modulos/acesso/contas-dormentes.controller.js';
import {
  DespertarContasDormentes,
  SERVICO_CONTAS_DORMENTES,
  ServicoContasDormentes,
} from './modulos/acesso/contas-dormentes.js';
import {
  parametrosDormenciaPelaConfiguracao,
  portaDormenciaDaFonte,
  responsavelDaFonte,
} from './modulos/acesso/contas-dormentes-porta.js';
import {
  EXECUTOR_IDENTIDADE,
  IdentidadeController,
  SERVICO_IDENTIDADE,
} from './modulos/acesso/identidade/identidade.controller.js';
import { contingenciaPelaConfiguracao } from './modulos/acesso/identidade/contingencia.js';
import { portaIdentidadeDoNucleo } from './modulos/acesso/identidade/porta-identidade-legado.js';
import { portaIdentidadeSintetica } from './modulos/acesso/identidade/porta-identidade-sintetica.js';
import { ServicoIdentidade } from './modulos/acesso/identidade/servico-identidade.js';
import { portaSenhaDoNucleo, portaSenhaMemoria } from './modulos/acesso/senha/porta-senha.js';
import { administradoresMaximoPelaConfiguracao } from './modulos/acesso/saneamento/parametro.js';
import { portaSaneamentoDoNucleo } from './modulos/acesso/saneamento/porta-legado.js';
import { PortaSaneamentoSintetica } from './modulos/acesso/saneamento/porta-sintetica.js';
import type { PortaSaneamento } from './modulos/acesso/saneamento/porta.js';
import {
  SERVICO_SANEAMENTO,
  SaneamentoController,
} from './modulos/acesso/saneamento/saneamento.controller.js';
import { ServicoSaneamento } from './modulos/acesso/saneamento/servico.js';
import {
  FONTE_GESTAO,
  fonteGestaoIndisponivel,
  fonteGestaoLegado,
  fonteGestaoMemoria,
} from './modulos/acesso/gestao-fonte.js';
import {
  EmergenciaController,
  REGISTRO_EMERGENCIA,
  RegistroEmergenciaLegado,
  RegistroEmergenciaMemoria,
  VINCULO_ASSISTENCIAL,
} from './modulos/acesso/emergencia.controller.js';
import { NUCLEO_ACESSO } from './modulos/acesso/legado-acesso.js';
import { devGravaCopia, fonteDevDaCopia, fontesSinteticas } from './sessao/montar.js';
import { AUDITORIA_COMO } from './autorizacao/simbolos.js';
import { InterceptadorComo } from './autorizacao/interceptor-como.js';
import { certificadoVigente, chaveMestra, cifrarSenha, minutosSessaoComo } from '@sgh/dominio-acesso';
import {
  FonteComoLegado,
  FonteComoMemoria,
  type FonteComoEstabelecimento,
  RepositorioPlataformaLegado,
  RepositorioPlataformaMemoria,
  type RepositorioPlataforma,
} from './modulos/suporte/repositorio.js';
import { ServicoPlataforma } from './modulos/suporte/servico-plataforma.js';
import { ServicoComo } from './modulos/suporte/servico-como.js';
import {
  PlataformaController,
  SERVICO_COMO,
  SERVICO_PLATAFORMA,
} from './modulos/suporte/plataforma.controller.js';
import { FonteAcessoSintetica } from './modulos/acesso/fonte-sintetica.js';
import { logger } from './logger.js';
import { CONFIGURACAO, type Configuracao } from './configuracao.js';
import {
  AcessoController,
  RESOLVEDOR_REDE,
  SERVICO_LOGIN_CERTIFICADO,
  SERVICO_RECUPERACAO_SENHA,
  SERVICO_SESSAO,
  SERVICO_TROCA_RAPIDA,
  SESSAO_SINTETICA,
} from './modulos/acesso/acesso.controller.js';
import { PinGestaoController } from './modulos/acesso/pin-gestao.controller.js';
import { ConselhoGestaoController } from './modulos/acesso/conselho-gestao.controller.js';
import { UsuarioModeloController } from './modulos/acesso/usuario-modelo.controller.js';
import {
  portaPinDoNucleo,
  portaPinIndisponivel,
  portaPinMemoria,
  type PortaPin,
} from './sessao/porta-pin.js';
import { parametrosTrocaRapidaPelaConfiguracao, ServicoTrocaRapida } from './sessao/troca-rapida.js';
import { parametrosConselhoPelaConfiguracao } from './autorizacao/conselho.js';
import { SessaoSintetica } from './modulos/acesso/sessao-sintetica.js';
import { envioRecuperacaoMemoria, ServicoRecuperacaoSenha } from './sessao/recuperacao-senha.js';
import { ComunicacaoController, AVISOS_INICIO } from './modulos/acesso/comunicacao.controller.js';
import {
  PORTA_COMUNICACAO,
  type PortaComunicacao,
  portaComunicacaoIndisponivel,
  portaComunicacaoLegado,
} from './modulos/acesso/comunicacao-porta.js';
import { PortaComunicacaoMemoria } from './modulos/acesso/comunicacao-porta-memoria.js';
import { ServicoComunicacao } from './modulos/acesso/aplicacao/comunicacao.js';
import { ServicoWorklistMedico } from './modulos/pep/aplicacao/worklist-medico.js';
import { WorklistMedicoController } from './modulos/pep/worklist.controller.js';
import {
  PORTA_WORKLIST,
  type PortaWorklist,
  portaWorklistIndisponivel,
  portaWorklistLegado,
  PortaWorklistMemoria,
} from './modulos/pep/worklist-porta.js';
import { PORTA_GUIAS, WorklistRecepcaoController } from './modulos/recepcao/worklist.controller.js';
import {
  type PortaGuias,
  portaGuiasIndisponivel,
  portaGuiasLegado,
  portaGuiasMemoria,
} from './modulos/recepcao/aplicacao/worklist-recepcao.js';
import { combinacaoDoAmbiente, type ContextoOperacao, lerCodigos } from '@sgh/legado';
import { ConsultasController } from './modulos/consultas/consultas.controller.js';
import { MatrizController } from './modulos/consultas/matriz.controller.js';
import {
  FONTE_CONSULTAS,
  type FonteConsultas,
  fonteConsultasIndisponivel,
  fonteConsultasLegado,
  fonteConsultasMemoria,
} from './modulos/consultas/fonte.js';
import {
  AssinaturasController,
  caminhoProntidao,
  caminhoHomologacao,
  FONTE_HOMOLOGACAO,
  Onda0Controller,
  PORTA_ONDA0,
  type PortaOnda0,
  portaOnda0Legado,
  portaOnda0Memoria,
  fonteArquivoHomologacao,
  type FonteHomologacao,
  HomologacaoController,
  caminhosPadrao,
  CoexistenciaController,
  FONTE_PRONTIDAO,
  fonteArquivoProntidao,
  type FonteProntidao,
  ProntidaoController,
  FONTE_ASSINATURAS,
  FONTE_COEXISTENCIA,
  fonteArquivosAssinatura,
  type FonteAssinaturas,
  type FonteCoexistencia,
  criarFonteGravacao,
  FONTE_GRAVACAO,
  GravacaoController,
  METRICAS_EXECUTOR,
  type NucleoLeitura,
  CACHE_CONFIG,
  CacheConfig,
  CAMINHO_CATALOGO_LIBERACAO,
  CRITERIO_LIGAR_SETOR,
  criterioLigarSetor,
  DominiosController,
  FONTE_CONFIGURACAO,
  FONTE_DOMINIOS,
  VIGIA_RECONCILIACAO,
  VigiaReconciliacaoCrud,
  type FonteConfiguracao,
  type FonteDominios,
  fonteConfiguracaoIndisponivel,
  fonteConfiguracaoLegado,
  chavesIniciaisSinteticas,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
  fonteConfiguracaoMemoria,
  fonteDominiosIndisponivel,
  fonteDominiosLegado,
  fonteDominiosMemoria,
  LiberacaoController,
  ParametrosController,
} from './modulos/config/public-api.js';
import { ArmazemMemoria } from './sessao/armazem.js';
import { MetricasExecutor } from '@sgh/legado';
import { resolve } from 'node:path';
import type { FonteAcesso } from './sessao/fonte-acesso.js';
import { montarServicoSessao } from './sessao/montar.js';
import { ResolvedorRedeConfigurado } from './sessao/rede.js';
import type { ArmazemSessao } from './sessao/armazem.js';
import type { RegistroComo, ServicoSessao } from './sessao/servico-sessao.js';
import { criarFonteDocumento, DocumentoController, FONTE_DOCUMENTO } from './modulos/documento/public-api.js';
import { CargaController, FONTE_CARGA, type FonteCarga } from './modulos/carga/carga.controller.js';
import {
  PacientesController,
  PORTA_CADASTRO,
  type PortaCadastro,
  PortaCadastroMemoria,
  portaCadastroIndisponivel,
  portaCadastroLegado,
  ProfissionaisController,
} from './modulos/cadastro/public-api.js';
import { SistemaController } from './sistema.controller.js';
import {
  ConveniosController,
  FONTE_PRECOS,
  type FontePrecos,
  FontePrecosMemoria,
  fontePrecosIndisponivel,
  fontePrecosLegado,
  ImportacoesController,
  MotorController,
  PrecosController,
  SERVICO_PRECOS,
  ServicoPrecos,
} from './modulos/precos/public-api.js';
import {
  CatalogosController,
  FONTE_CATALOGOS,
  type FonteCatalogos,
  FonteCatalogosMemoria,
  fonteCatalogosIndisponivel,
  fonteCatalogosLegado,
  SERVICO_CATALOGOS,
  ServicoCatalogos,
} from './modulos/catalogos/public-api.js';
import { guardarArquivoCatalogo } from './modulos/catalogos/guardar-arquivo.js';
import {
  AcessosProntuarioController,
  ESTADO_PRONTUARIO,
  EstadoProntuario,
  PORTA_PRONTUARIO,
  type PortaProntuario,
  portaProntuarioIndisponivel,
  portaProntuarioLegado,
  PortaProntuarioMemoria,
  ProntuarioController,
  PORTA_REGISTRO,
  type PortaRegistro,
  portaRegistroIndisponivel,
  portaRegistroLegado,
  PortaRegistroMemoria,
  RegistroClinicoController,
  AcessoRedePepController,
  FormularioNovoController,
  PORTA_FORMULARIO_NOVO,
  type PortaFormularioNovo,
  portaFormularioNovoIndisponivel,
  portaFormularioNovoLegado,
  PortaFormularioNovoMemoria,
  DocumentosPepController,
  PORTA_DOCUMENTOS,
  type PortaDocumentos,
  portaDocumentosIndisponivel,
  portaDocumentosLegado,
  PortaDocumentosMemoria,
  SERVICO_DOCUMENTOS,
  ESTUDOS_IMAGEM_PEP,
  ServicoDocumentos,
  SERVICO_REGISTRO,
  ServicoRegistro,
  SERVICO_PRONTUARIO,
  ServicoProntuario,
  PORTA_PRESCRICAO,
  type PortaPrescricao,
  portaPrescricaoIndisponivel,
  portaPrescricaoLegado,
  PortaPrescricaoMemoria,
  PrescricaoController,
  SERVICO_PRESCRICAO,
  ServicoPrescricao,
  LiberacaoPep,
} from './modulos/pep/public-api.js';
import {
  EspecialidadesController,
  PORTA_ESPECIALIDADES,
  type PortaEspecialidades,
  portaEspecialidadesIndisponivel,
  portaEspecialidadesLegado,
  PortaEspecialidadesMemoria,
} from './modulos/especialidades/public-api.js';
import {
  AgendasController,
  ApoioAgendaController,
  MarcacoesController,
  PORTA_AGENDA,
  type PortaAgenda,
  portaAgendaIndisponivel,
  portaAgendaLegado,
  PortaAgendaMemoria,
} from './modulos/agenda/public-api.js';
import {
  CENTRAL_CHAMADAS,
  CentralChamadas,
  DispositivoController,
  GestaoRecepcaoController,
  TermosRecepcaoController,
  PORTA_RECEPCAO,
  type PortaRecepcao,
  portaRecepcaoIndisponivel,
  portaRecepcaoLegado,
  PortaRecepcaoMemoria,
  RecepcaoController,
  REDE_RECEPCAO,
  ClassificacaoController,
  ProtocoloGerenciadoController,
  fonteRiscoPa,
  PAINEL_BLOCO_TV,
  PAINEL_PA_TV,
  PORTA_CLASSIFICACAO,
  type PortaClassificacao,
  portaClassificacaoIndisponivel,
  portaClassificacaoLegado,
  PortaClassificacaoMemoria,
  ServicoClassificacao,
  fonteAtendimentosPa,
} from './modulos/recepcao/public-api.js';
import {
  ApoioGravacao,
  ExamesController,
  PORTA_EXAME,
  type PortaExame,
  portaExameIndisponivel,
  portaExameLegado,
  PortaExameMemoria,
} from './modulos/exames/public-api.js';
import {
  AtendimentoController,
  AVISOS_ATENDIMENTO,
  AvisosAtendimento,
  FONTE_RISCO_PA,
  PaController,
  PORTA_ATENDIMENTO,
  type PortaAtendimento,
  portaAtendimentoIndisponivel,
  portaAtendimentoLegado,
  PortaAtendimentoMemoria,
} from './modulos/atendimento/public-api.js';
import {
  AVISOS_SADT,
  CENTRAL_AVISOS_SADT,
  PORTA_SADT,
  PortalController,
  type PortaSadt,
  portaSadtIndisponivel,
  portaSadtLegado,
  PortaSadtMemoria,
  SadtController,
  PacsController,
  PORTA_PACS,
  type PortaPacs,
  portaPacsIndisponivel,
  portaPacsLegado,
  PortaPacsMemoria,
  SERVICO_PACS,
  ServicoPacs,
  SERVICO_PORTAL,
  ServicoPortal,
  VIGIA_CRITICOS,
  VigiaCriticos,
} from './modulos/sadt/public-api.js';
import {
  ArmazemProvasMemoria,
  criarArmazemProvas,
  gatewayDoAmbiente,
  type GatewayPagamento,
  PortalAgendaController,
  PortalAgendaInternoController,
  portaAgendaOnlineIndisponivel,
  portaAgendaOnlineLegado,
  PortaAgendaOnlineMemoria,
  type PortaAgendaOnline,
  PortalPacienteController,
  PortalPacienteInternoController,
  SERVICO_AGENDA_PORTAL,
  sementeAgendaOnline,
  ServicoAgendaPortal,
  portaPortalIndisponivel,
  portaPortalLegado,
  PortaPortalMemoria,
  type PortaPortalPaciente,
  SERVICO_PORTAL_PACIENTE,
  ServicoPortalPaciente,
  canalDoAmbiente,
} from './modulos/portal-paciente/public-api.js';
import {
  OPERACOES_TELEMEDICINA,
  PortaGravacaoTelemedicina,
  portaTelemedicinaIndisponivel,
  portaTelemedicinaLegado,
  PortaTelemedicinaMemoria,
  type PortaTelemedicina,
  PortalTeleconsultaController,
  provedorDoAmbiente,
  type ProvedorTeleconsulta,
  SERVICO_TELEMEDICINA,
  ServicoTelemedicina,
  TelemedicinaController,
} from './modulos/telemedicina/public-api.js';
import {
  PortalMedicoController,
  PortalMedicoInternoController,
  type PortaPortalMedico,
  PortaPortalMedicoMemoria,
  portaPortalMedicoIndisponivel,
  portaPortalMedicoLegado,
  SERVICO_PORTAL_MEDICO,
  canalMedicoDoAmbiente,
  type FonteAssinaturaPortalMedico,
  retornoDoPortalMedico,
  ServicoPortalMedico,
} from './modulos/portal-medico/public-api.js';
import {
  BiRedeController,
  CatalogoRelatoriosController,
  FILA_ENVIO_RELATORIO,
  FilaEnvioPorValkey,
  GERADOR_PDF_RELATORIO,
  PORTA_RELATORIO,
  type PortaRelatorio,
  portaRelatorioIndisponivel,
  portaRelatorioLegado,
  PortaRelatorioMemoria,
} from './modulos/relatorio/public-api.js';
import {
  MigracaoController,
  FimCoexistenciaController,
  DesligamentoController,
  RetrocompatibilidadeController,
  RAIZES_DESLIGAMENTO,
  RAIZ_RETROCOMPATIBILIDADE,
  raizRetrocompatibilidadeDoAmbiente,
  raizesDesligamentoDoAmbiente,
  RAIZ_FIM_COEXISTENCIA,
  raizFimDoAmbiente,
  OPCOES_MIGRACAO,
  opcoesMigracaoDoAmbiente,
  PORTA_COEXISTENCIA,
  type PortaCoexistencia,
  portaCoexistenciaIndisponivel,
  portaCoexistenciaLegado,
  PortaCoexistenciaMemoria,
} from './modulos/coexistencia/public-api.js';
import { ContasBancoController } from './modulos/acesso/contas-banco/contas-banco.controller.js';
import type { PortaSbis } from './modulos/administracao/sbis/porta.js';
import { portaSbisIndisponivel, portaSbisLegado } from './modulos/administracao/sbis/porta-legado.js';
import { PortaSbisMemoria } from './modulos/administracao/sbis/porta-memoria.js';
import { SbisController } from './modulos/administracao/sbis/sbis.controller.js';
import { SERVICO_SBIS, ServicoSbis } from './modulos/administracao/sbis/servico.js';
import { ServicoSegredos } from './modulos/acesso/segredos/servico.js';
import { PORTA_CONTAS_BANCO, type PortaContasBanco } from './modulos/acesso/contas-banco/porta.js';
import { ServicoContasBanco } from './modulos/acesso/contas-banco/servico.js';
import {
  SegredosController,
  SITUACAO_HOSPITAL_SEGREDOS,
} from './modulos/acesso/segredos/segredos.controller.js';
import {
  COFRE_SEGREDOS,
  EXECUTOR_SEGREDOS,
  PORTA_SEGREDOS,
  type PortaSegredos,
} from './modulos/acesso/segredos/porta.js';
import { portaSegredosIndisponivel, portaSegredosLegado } from './modulos/acesso/segredos/porta-legado.js';
import { PortaSegredosMemoria } from './modulos/acesso/segredos/porta-memoria.js';
import {
  portaContasBancoIndisponivel,
  portaContasBancoLegado,
} from './modulos/acesso/contas-banco/porta-legado.js';
import { PortaContasBancoMemoria } from './modulos/acesso/contas-banco/porta-memoria.js';
import {
  ConferenciaInstalacaoController,
  FILAS_IMPLANTACAO,
  filasDoAmbiente,
  FumacaServidorController,
  type PortaFilasImplantacao,
  PORTA_IMPLANTACAO,
  type PortaImplantacao,
  portaImplantacaoIndisponivel,
  portaImplantacaoLegado,
  PortaImplantacaoMemoria,
  SCRIPTS_DO_PACOTE,
  scriptsDoPacoteDoDisco,
} from './modulos/implantacao/public-api.js';
import {
  BeneficiariosOperadoraController,
  CobrancaOperadoraController,
  OperadoraController,
  PORTA_COBRANCA_OPERADORA,
  PORTA_OPERADORA,
  type PortaCobrancaOperadora,
  portaCobrancaOperadoraIndisponivel,
  portaCobrancaOperadoraLegado,
  PortaCobrancaOperadoraMemoria,
  type PortaOperadora,
  portaOperadoraIndisponivel,
  portaOperadoraLegado,
  PortaOperadoraMemoria,
  PORTA_REDE_OPERADORA,
  type PortaRedeOperadora,
  portaRedeOperadoraIndisponivel,
  portaRedeOperadoraLegado,
  PortaRedeOperadoraMemoria,
  RedeOperadoraController,
  AutorizacaoOperadoraController,
  PORTA_AUTORIZACAO_OPERADORA,
  type PortaAutorizacaoOperadora,
  portaAutorizacaoOperadoraIndisponivel,
  portaAutorizacaoOperadoraLegado,
  PortaAutorizacaoOperadoraMemoria,
  ContasOperadoraController,
  PORTA_CONTAS_OPERADORA,
  type PortaContasOperadora,
  portaContasOperadoraIndisponivel,
  portaContasOperadoraLegado,
  PortaContasOperadoraMemoria,
  AnsOperadoraController,
  PORTA_ANS_OPERADORA,
  type PortaAnsOperadora,
  portaAnsOperadoraIndisponivel,
  portaAnsOperadoraLegado,
  PortaAnsOperadoraMemoria,
  AtendimentoOperadoraController,
  PORTA_ATENDIMENTO_OPERADORA,
  type PortaAtendimentoOperadora,
  portaAtendimentoOperadoraIndisponivel,
  portaAtendimentoOperadoraLegado,
  PortaAtendimentoOperadoraMemoria,
  PortalPrestadorController,
  SERVICO_PORTAL_PRESTADOR,
  ServicoPortalPrestador,
  ServicoSituacaoOperadora,
} from './modulos/operadora/public-api.js';
import {
  ContabilController,
  DemonstracoesContabilController,
  GERADOR_PDF_CONTABIL,
  LancamentosContabilController,
  PORTA_CONTABIL,
  type PortaContabil,
  portaContabilIndisponivel,
  portaContabilLegado,
  PortaContabilMemoria,
} from './modulos/contabil/public-api.js';
import {
  CIFRA_CPF_PESSOAS,
  CifraCpf,
  chaveCpfDoAmbiente,
  PORTA_PESSOAS,
  PessoasController,
  type PortaPessoas,
  portaPessoasIndisponivel,
  portaPessoasLegado,
  PortaPessoasMemoria,
  EscalaController,
  PlantaoController,
  PORTA_ESCALA,
  type PortaEscala,
  portaEscalaIndisponivel,
  portaEscalaLegado,
  PortaEscalaMemoria,
  GERADOR_PDF_SESMT,
  PORTA_SESMT,
  type PortaSesmt,
  portaSesmtIndisponivel,
  portaSesmtLegado,
  PortaSesmtMemoria,
  SesmtController,
  CargosController,
  PORTA_CARGOS,
  type PortaCargos,
  portaCargosIndisponivel,
  portaCargosLegado,
  PortaCargosMemoria,
  IndicadoresPessoasController,
  PORTA_INDICADORES_PESSOAS,
  type PortaIndicadoresPessoas,
  portaIndicadoresPessoasIndisponivel,
  portaIndicadoresPessoasLegado,
  PortaIndicadoresPessoasMemoria,
  SEMENTE_INDICADORES_PESSOAS,
  AvaliacaoController,
  PORTA_AVALIACAO,
  type PortaAvaliacao,
  portaAvaliacaoIndisponivel,
  portaAvaliacaoLegado,
  PortaAvaliacaoMemoria,
  PORTA_RUBRICAS,
  type PortaRubricas,
  portaRubricasIndisponivel,
  portaRubricasLegado,
  PortaRubricasMemoria,
  RubricasController,
  GERADOR_PDF_FOLHA,
  GERADOR_PDF_PONTO,
  PORTA_PONTO,
  type PortaPonto,
  portaPontoIndisponivel,
  portaPontoLegado,
  PortaPontoMemoria,
  PontoController,
  GERADOR_PDF_F6,
  MeuEspacoController,
  MeuHoleriteController,
  PORTA_REALIZADO,
  PORTA_TREINAMENTO,
  type PortaRealizado,
  portaRealizadoIndisponivel,
  portaRealizadoLegado,
  PortaRealizadoMemoria,
  type PortaTreinamento,
  portaTreinamentoIndisponivel,
  portaTreinamentoLegado,
  PortaTreinamentoMemoria,
  FolhaController,
  PORTA_FOLHA,
  type PortaFolha,
  portaFolhaIndisponivel,
  portaFolhaLegado,
  PortaFolhaMemoria,
  CalculoFolhaController,
  FechamentoFolhaController,
  ObrigacoesController,
  FeriasFolhaController,
  RescisaoFolhaController,
  MinhasFeriasController,
  MinhasSolicitacoesController,
  FilaSolicitacoesController,
  PORTA_AUTOATENDIMENTO,
  type PortaAutoatendimento,
  portaAutoatendimentoIndisponivel,
  portaAutoatendimentoLegado,
  PortaAutoatendimentoMemoria,
  PORTA_CALCULO_FOLHA,
  type PortaCalculoFolha,
  portaCalculoFolhaIndisponivel,
  portaCalculoFolhaLegado,
  PortaCalculoFolhaMemoria,
  IntegracaoFolhaController,
  PORTA_INTEGRACAO_FOLHA,
  type PortaIntegracaoFolha,
  portaIntegracaoFolhaIndisponivel,
  portaIntegracaoFolhaLegado,
  PortaIntegracaoFolhaMemoria,
  EsocialController,
  PORTA_ESOCIAL,
  type PortaEsocial,
  portaEsocialIndisponivel,
  portaEsocialLegado,
  PortaEsocialMemoria,
  TRANSMISSOR_ESOCIAL,
  type DisponibilidadeTransmissor,
  transmissorEsocialDoAmbiente,
  RealizadoController,
  TreinamentoController,
} from './modulos/pessoas/public-api.js';
import {
  ARMAZEM_CONTEUDO,
  type ArmazemConteudo,
  ArmazemConteudoMemoria,
  ArmazemConteudoS3,
  criarServicoFachada,
  ESTABELECIMENTOS_ENTRADA,
  FachadaController,
  IntegracaoController,
  PORTA_FACHADA,
  type PortaFachada,
  portaFachadaIndisponivel,
  portaFachadaLegado,
  PortaFachadaMemoria,
  SERVICO_FACHADA,
  PORTA_INTEGRACAO,
  type PortaIntegracao,
  portaIntegracaoIndisponivel,
  portaIntegracaoLegado,
  PortaIntegracaoMemoria,
} from './modulos/integracao/public-api.js';
import { ClienteS3, converterHtmlEmPdfA } from './modulos/documento/public-api.js';
import {
  PORTA_SUPRIMENTOS,
  type PortaSuprimentos,
  portaSuprimentosIndisponivel,
  portaSuprimentosLegado,
  PortaSuprimentosMemoria,
  SuprimentosController,
  OpmeController,
  PORTA_OPME,
  type PortaOpme,
  portaOpmeIndisponivel,
  portaOpmeLegado,
  PortaOpmeMemoria,
  ConsignadoController,
  PORTA_CONSIGNADO,
  type PortaConsignado,
  portaConsignadoIndisponivel,
  portaConsignadoLegado,
  PortaConsignadoMemoria,
  ContratoController,
  PORTA_CONTRATO,
  type PortaContrato,
  portaContratoIndisponivel,
  portaContratoLegado,
  PortaContratoMemoria,
  LicitacaoController,
  PORTA_LICITACAO,
  type PortaLicitacao,
  portaLicitacaoIndisponivel,
  portaLicitacaoLegado,
  PortaLicitacaoMemoria,
  ManipulacaoController,
  PORTA_MANIPULACAO,
  type PortaManipulacao,
  portaManipulacaoIndisponivel,
  portaManipulacaoLegado,
  PortaManipulacaoMemoria,
} from './modulos/suprimentos/public-api.js';
import {
  PORTA_ROUPARIA,
  type PortaRouparia,
  portaRoupariaIndisponivel,
  portaRoupariaLegado,
  PortaRoupariaMemoria,
  RoupariaController,
} from './modulos/rouparia/public-api.js';
import {
  GERADOR_PDF_MANUTENCAO,
  ManutencaoController,
  PORTA_MANUTENCAO,
  type PortaManutencao,
  portaManutencaoIndisponivel,
  portaManutencaoLegado,
  PortaManutencaoMemoria,
} from './modulos/manutencao/public-api.js';
import {
  ContratualizacaoController,
  PORTA_CONTRATUALIZACAO,
  type PortaContratualizacao,
  portaContratualizacaoIndisponivel,
  portaContratualizacaoLegado,
  PortaContratualizacaoMemoria,
} from './modulos/contratualizacao/public-api.js';
import {
  AVISOS_FARMACIA,
  FarmaciaController,
  GERADOR_PDF_FARMACIA,
  PORTA_FARMACIA,
  type PortaFarmacia,
  portaFarmaciaIndisponivel,
  portaFarmaciaLegado,
  PortaFarmaciaMemoria,
} from './modulos/farmacia/public-api.js';
import {
  FaturamentoController,
  PORTA_FATURAMENTO,
  type PortaFaturamento,
  portaFaturamentoIndisponivel,
  portaFaturamentoLegado,
  PortaFaturamentoMemoria,
} from './modulos/faturamento/public-api.js';
import {
  ARMAZEM_XML_TISS,
  type ArmazemXmlTiss,
  armazemXmlS3,
  GERADOR_PDF_TISS,
  PORTA_TISS,
  type PortaTiss,
  portaTissIndisponivel,
  portaTissLegado,
  PortaTissMemoria,
  TissController,
} from './modulos/tiss/public-api.js';
import { criarMontadorLote } from '@sgh/dominio-faturamento';
import { definirMontadorLoteTiss } from '@sgh/legado';
import {
  ARMAZEM_FINANCEIRO,
  type ArmazemFinanceiro,
  armazemFinanceiroMemoria,
  armazemFinanceiroS3,
  FinanceiroController,
  PORTA_FINANCEIRO,
  type PortaFinanceiro,
  portaFinanceiroIndisponivel,
  portaFinanceiroLegado,
  PortaFinanceiroMemoria,
} from './modulos/financeiro/public-api.js';
import {
  GERADOR_PDF_REPASSE,
  PORTA_REPASSE,
  type PortaRepasse,
  portaRepasseIndisponivel,
  portaRepasseLegado,
  PortaRepasseMemoria,
  RepasseController,
  ServicoRepasse,
} from './modulos/repasse/public-api.js';
import {
  estabelecimentosSinteticosRede,
  PORTA_REDE,
  type PortaRede,
  portaRedeIndisponivel,
  portaRedeLegado,
  PortaRedeMemoria,
  RedeMpiController,
  PORTA_SERVICOS_REDE,
  type PortaServicosRede,
  portaServicosRedeIndisponivel,
  portaServicosRedeLegado,
  PortaServicosRedeMemoria,
  ServicosRedeController,
} from './modulos/rede/public-api.js';
import {
  ARMAZEM_ARQUIVO_SUS,
  type ArmazemArquivoSus,
  armazemSusMemoria,
  armazemSusS3,
  PORTA_SUS,
  type PortaSus,
  portaSusIndisponivel,
  portaSusLegado,
  PortaSusMemoria,
  SusAihController,
  SusController,
} from './modulos/sus/public-api.js';
import {
  ARMAZEM_PDF_ICP,
  armazemPdfIcp,
  AssinaturaDocumentosController,
  AssinaturaIcpController,
  CONFIG_DOCUMENTOS_ICP,
  configDocumentosIcpDoAmbiente,
  FONTE_CONTEUDO_ICP,
  SERVICO_ASSINATURA_ICP,
  ServicoAssinaturaIcp,
  ServicoAssinaturaDocumentos,
  type ArmazemPdfIcp,
  type ConfigDocumentosIcp,
  type FonteConteudoIcp,
  SimuladorSncr,
  CONFIG_ASSINATURA_ICP,
  type ConfigServicoAssinatura,
  configAssinaturaDoAmbiente,
  type Cofre,
  CofreMemoria,
  cofreDoAmbiente,
  PORTA_ASSINATURA_ICP,
  type PortaAssinaturaIcp,
  portaAssinaturaIndisponivel,
  portaAssinaturaLegado,
  PortaAssinaturaMemoria,
  estabelecimentosDoVerificador,
  SERVICO_VERIFICADOR,
  ServicoLoginCertificado,
  ServicoVerificador,
  VerificadorController,
} from './modulos/assinatura/public-api.js';
import {
  ARMAZEM_FOTOS,
  AVISOS_ADT,
  criarArmazemFotos,
  HigienizacaoController,
  INTEGRACAO_OS_LEITO,
  IntegracaoOsLeitoAdt,
  InternacaoController,
  MapaLeitosController,
  PORTA_ADT,
  type PortaAdt,
  portaAdtIndisponivel,
  portaAdtLegado,
  PortaAdtMemoria,
  SameController,
  EstadoNirMemoria,
  NirController,
  RegulacaoController,
  PORTA_NIR,
  type PortaNir,
  portaNirIndisponivel,
  portaNirLegado,
  PortaNirMemoria,
} from './modulos/adt/public-api.js';
import {
  ARMAZEM_FOTOS_PORTARIA,
  criarArmazemFotosPortaria,
  OPCOES_PORTARIA,
  PORTA_PORTARIA,
  type PortaPortaria,
  PortariaController,
  portaPortariaIndisponivel,
  portaPortariaLegado,
  PortaPortariaMemoria,
} from './modulos/portaria/public-api.js';
import {
  NutricaoController,
  PORTA_NUTRICAO,
  type PortaNutricao,
  portaNutricaoIndisponivel,
  portaNutricaoLegado,
  PortaNutricaoMemoria,
} from './modulos/nutricao/public-api.js';
import {
  PORTA_SESSOES,
  type PortaSessoes,
  portaSessoesIndisponivel,
  portaSessoesLegado,
  PortaSessoesMemoria,
  SessoesController,
} from './modulos/sessoes/public-api.js';
import {
  ARMAZEM_DIGITALIZACAO,
  type ArmazemDigitalizacao,
  ArmazemDigitalizacaoMemoria,
  criarArmazemDigitalizacao,
  DigitalizacaoController,
  PORTA_DIGITALIZACAO,
  type PortaDigitalizacao,
  portaDigitalizacaoIndisponivel,
  portaDigitalizacaoLegado,
  PortaDigitalizacaoMemoria,
  SERVICO_ASSINATURA_DIGITALIZACAO,
  ServicoAssinaturaDigitalizacao,
} from './modulos/digitalizacao/public-api.js';
import {
  AVISOS_ENFERMAGEM,
  BalancoController,
  PORTA_BALANCO,
  type PortaBalanco,
  portaBalancoIndisponivel,
  portaBalancoLegado,
  PortaBalancoMemoria,
  PORTA_SAE,
  type PortaSae,
  portaSaeIndisponivel,
  portaSaeLegado,
  PortaSaeMemoria,
  PORTA_TRANSFUSAO,
  type PortaTransfusao,
  portaTransfusaoIndisponivel,
  portaTransfusaoLegado,
  PortaTransfusaoMemoria,
  TransfusaoController,
  AgenciaController,
  PORTA_AGENCIA,
  type PortaAgencia,
  portaAgenciaIndisponivel,
  portaAgenciaLegado,
  PortaAgenciaMemoria,
  PrescricaoEnfermeiroController,
  SaeController,
  VacinaController,
  ClassificacaoPacientesController,
  EnfermagemController,
  EscoresController,
  IndicesUtiController,
  PORTA_ENFERMAGEM,
  PORTA_ESCORES,
  type PortaEnfermagem,
  portaEnfermagemIndisponivel,
  portaEnfermagemLegado,
  PortaEnfermagemMemoria,
  type PortaEscores,
  portaEscoresIndisponivel,
  portaEscoresLegado,
  PortaEscoresMemoria,
  VigiaHorarios,
  ContencaoController,
  TrrController,
  ProtocoloInternadoController,
  LesaoController,
  VIGIA_CONTENCAO,
  VigiaContencao,
} from './modulos/enfermagem/public-api.js';
import {
  AgravoController,
  CcihController,
  GestaoQualidadeController,
  NotificacaoController,
  RevisaoProntuarioController,
  PORTA_GESTAO,
  type PortaGestao,
  portaGestaoIndisponivel,
  portaGestaoLegado,
  PortaGestaoMemoria,
  SegurancaPacienteController,
  PORTA_AGRAVO,
  PORTA_CCIH,
  PORTA_QUALIDADE,
  type PortaAgravo,
  portaAgravoIndisponivel,
  portaAgravoLegado,
  PortaAgravoMemoria,
  type PortaCcih,
  portaCcihIndisponivel,
  portaCcihLegado,
  PortaCcihMemoria,
  type PortaQualidade,
  portaQualidadeIndisponivel,
  portaQualidadeLegado,
  PortaQualidadeMemoria,
  RESUMO_SUGESTAO,
  ResumoSugestao,
  CENTRAL_AVISOS_QUALIDADE,
} from './modulos/qualidade/public-api.js';
import {
  AnestesiaController,
  AVISOS_BLOCO,
  BlocoSeguroController,
  PainelBlocoFamilia,
  PORTA_BLOCO_SEGURO,
  type PortaBlocoSeguro,
  portaBlocoSeguroIndisponivel,
  portaBlocoSeguroLegado,
  PortaBlocoSeguroMemoria,
  TRAVA_INCISAO,
  TravaIncisao,
  PORTA_ANESTESIA,
  type PortaAnestesia,
  portaAnestesiaIndisponivel,
  portaAnestesiaLegado,
  PortaAnestesiaMemoria,
  CirurgiaController,
  PORTA_CIRURGIA,
  type PortaCirurgia,
  portaCirurgiaIndisponivel,
  portaCirurgiaLegado,
  PortaCirurgiaMemoria,
} from './modulos/cirurgia/public-api.js';
import { VersaoService } from './versao.service.js';
import {
  CONFIGURACAO_M16,
  ConfiguracaoM16,
  FONTE_INTERNACAO,
  type FonteInternacao,
  fonteInternacaoIndisponivel,
  fonteInternacaoLegado,
  FonteInternacaoMemoria,
  variantesSinteticasRede,
  intervaloDoAmbiente,
  LeitosController,
  BATIDA_EVENTOS_MS,
  BATIDA_EVENTOS_PADRAO_MS,
  MOTOR_VIGIA,
  MotorVigia,
  RelatorioController,
  SERVICO_INTERNACAO,
  ServicoInternacao,
} from './modulos/internacao/public-api.js';
import { AuditoriaController } from './modulos/administracao/auditoria.controller.js';
import { EstruturaController } from './modulos/administracao/estrutura.controller.js';
import {
  FONTE_ADMINISTRACAO,
  type FonteAdministracao,
  fonteAdministracaoIndisponivel,
  fonteAdministracaoLegado,
} from './modulos/administracao/fonte.js';
import {
  ApuracaoCustosController,
  CustosController,
  GERADOR_PDF_CUSTOS,
  PORTA_CUSTOS,
  type PortaCustos,
  portaCustosIndisponivel,
  portaCustosLegado,
  PortaCustosMemoria,
} from './modulos/custos/public-api.js';
import {
  OrcamentoController,
  PORTA_ORCAMENTO,
  type PortaOrcamento,
  portaOrcamentoIndisponivel,
  portaOrcamentoLegado,
  PortaOrcamentoMemoria,
} from './modulos/orcamento/public-api.js';
import {
  GERADOR_PDF_PATRIMONIO,
  ARMAZEM_LAUDO_PATRIMONIO,
  type ArmazemLaudoPatrimonio,
  ArmazemLaudoMemoria,
  armazemLaudoS3,
  PatrimonioController,
  PORTA_PATRIMONIO,
  type PortaPatrimonio,
  portaPatrimonioIndisponivel,
  portaPatrimonioLegado,
  PortaPatrimonioMemoria,
} from './modulos/patrimonio/public-api.js';
import { estadoM10Sintetico, fonteAdministracaoMemoria } from './modulos/administracao/fonte-memoria.js';
import { PermissoesController } from './modulos/administracao/permissoes.controller.js';
import { UsuariosController } from './modulos/administracao/usuarios.controller.js';
import { RedeCpfController } from './modulos/administracao/rede-cpf.controller.js';

/**
 * Opções do módulo. `armazem`/`servico`: sessão (M05). `assinaturas`: fonte do painel de assinaturas
 * (M03; padrão: os arquivos do repositório).
 */
export interface OpcoesApp {
  armazem?: ArmazemSessao;
  servico?: ServicoSessao | null;
  assinaturas?: FonteAssinaturas | null;
  /** M35: o relatório de prontidão (padrão: docs/prontidao/prontidao.json do repositório). */
  prontidao?: FonteProntidao | null;
  /** M36: o painel da homologação (padrão: docs/homologacao/homologacao.json do repositório). */
  homologacao?: FonteHomologacao | null;
  /** M38: porta da onda 0 (testes). */
  onda0?: PortaOnda0;
  /** Contagens do executor (M04): uma por processo. */
  metricas?: MetricasExecutor;
  /** M06: registrador da trilha (padrão: memória com a fonte sintética; trilha dupla com o núcleo real). */
  trilha?: RegistradorTrilha;
  /** M06: alerta ao Auditor (padrão: fila `email` com VALKEY_URL; senão, só log). */
  alerta?: AlertaAuditor;
  /** M08: fontes do CRUD genérico e da configuração (padrão: pelo ambiente). */
  dominios?: FonteDominios;
  /** Revisão do W0-02: a vigia de reconciliação dos cadastros (testes injetam; null desliga). */
  vigiaReconciliacao?: VigiaReconciliacaoCrud | null;
  /** M14: fonte das consultas somente leitura (testes). */
  consultas?: FonteConsultas;
  configuracao?: FonteConfiguracao;
  /** M11: porta do cadastro (padrão: pelo ambiente, como a do CRUD genérico). */
  cadastro?: PortaCadastro;
  /** ADR 0021: banco da plataforma e o "como" por estabelecimento (padrão: pelo ambiente). */
  plataforma?: RepositorioPlataforma | null;
  comoEstabelecimento?: FonteComoEstabelecimento | null;
  /** M12: fonte de convênios e preços (padrão: pelo ambiente). */
  precos?: FontePrecos;
  /** M10: fonte das telas de acesso, organização e auditoria (padrão: pelo ambiente). */
  administracao?: FonteAdministracao;
  /** M13: fonte dos catálogos oficiais (padrão: pelo ambiente, como a de preços). */
  catalogos?: FonteCatalogos;
  /** M15: porta do prontuário ao vivo (padrão: pelo ambiente, como a do cadastro). */
  prontuario?: PortaProntuario;
  /** M22: registros clínicos (testes injetam a porta). */
  registro?: PortaRegistro;
  /** M45 (etapa 1): construtor de formulários novos (testes injetam a porta). */
  formularioNovo?: PortaFormularioNovo;
  /** M45 (etapa 3): balanço hídrico (testes injetam a porta). */
  balanco?: PortaBalanco;
  /** M50 (etapa 5): portaria e visitantes (testes injetam a porta). */
  portaria?: PortaPortaria;
  /** M45 (etapa 6): especialidades sob demanda e o lactário (testes injetam a porta). */
  especialidades?: PortaEspecialidades;
  /** M45 (etapa 4): SAE, prescrição de enfermagem, receita do enfermeiro e vacina (testes injetam a porta). */
  sae?: PortaSae;
  /** M47 (etapa 1): agência transfusional (testes injetam a porta). */
  transfusao?: PortaTransfusao;
  /** M48 (etapa 1): notificação de incidentes (testes injetam a porta). */
  qualidade?: PortaQualidade;
  ccih?: PortaCcih;
  agravo?: PortaAgravo;
  /** M48 (etapa 5): gestão da qualidade e envios regulatórios (testes injetam a porta). */
  gestao?: PortaGestao;
  /** M47 (etapa 2): imuno-hematologia e estoque de bolsas (testes injetam a porta). */
  agencia?: PortaAgencia;
  /** M24: prescrição eletrônica (testes injetam a porta). */
  prescricao?: PortaPrescricao;
  /** M16: fonte do painel de leitos, censo e painéis (padrão: pelo ambiente, como a do prontuário). */
  internacao?: FonteInternacao;
  /** M16: vigia de mudanças (testes injetam; padrão: um por processo, com o armazém da sessão). */
  vigia?: MotorVigia | null;
  /** M16: intervalo da batida do canal de eventos, que também reconfere a sessão (padrão 15 s; testes encurtam). */
  batidaEventosMs?: number;
  /** M17: agenda de consultas (testes injetam a porta). */
  agenda?: PortaAgenda;
  /** M23: prontuário de uso diário (documentos, exames, resultados e multiprofissional). */
  documentos?: PortaDocumentos;
  /** M19: recepção, senhas, totens e painéis (testes injetam a porta). */
  recepcao?: PortaRecepcao;
  /** M18: agenda de exames e centro cirúrgico (testes injetam as portas). */
  exame?: PortaExame;
  cirurgia?: PortaCirurgia;
  anestesia?: PortaAnestesia;
  /** M46 (etapa 2): checklist de cirurgia segura, rastreio no bloco e painel para familiares (testes injetam). */
  blocoSeguro?: PortaBlocoSeguro;
  /** M20: atendimento ambulatorial e pronto atendimento (testes injetam a porta). */
  atendimento?: PortaAtendimento;
  /** M44: a porta da classificação de risco (testes). */
  classificacao?: PortaClassificacao;
  /** M26: SADT, laudos e portal de resultados (testes injetam a porta). */
  sadt?: PortaSadt;
  /** M47 (etapa 3): a lista de trabalho DICOM e o PACS (testes injetam a porta). */
  pacs?: PortaPacs;
  /** M27: comunicação interna, avisos e dicionário; leituras da fila do médico e as guias da recepção. */
  comunicacao?: PortaComunicacao;
  worklist?: PortaWorklist;
  guias?: PortaGuias;
  /** M21: internação, leitos, higienização e SAME (testes injetam a porta). */
  adt?: PortaAdt;
  nir?: PortaNir;
  /** M45 (etapa 5): nutrição, mapa de dietas e serviço social (testes injetam a porta). */
  nutricao?: PortaNutricao;
  /** M50 (etapa 6): a agenda de sessões e a digitalização certificada (testes injetam as portas e o armazém). */
  sessoes?: PortaSessoes;
  digitalizacao?: PortaDigitalizacao;
  armazemDigitalizacao?: ArmazemDigitalizacao;
  /** M25: enfermagem beira-leito (testes injetam a porta e desligam a vigia). */
  enfermagem?: PortaEnfermagem;
  vigiaEnfermagem?: VigiaHorarios | null;
  /** M45 (etapa 2): escores, classificação de pacientes e índices de UTI (testes injetam a porta). */
  escores?: PortaEscores;
  /** M34: catálogo de relatórios e integrações novas (testes injetam as portas e o armazém do conteúdo). */
  relatorio?: PortaRelatorio;
  coexistencia?: PortaCoexistencia;
  /** M59-F1: porta do painel de contas do banco (testes injetam a de memória). */
  contasBanco?: PortaContasBanco;
  /** M59-F4: porta do saneamento dos grupos (testes injetam a de memória). */
  saneamento?: PortaSaneamento;
  /** M59-F3: segredos de parceiros e senhas secundárias (testes injetam a porta de memória e o cofre). */
  segredos?: PortaSegredos;
  /** M59-F5: termo das concessões, ciclos SBIS e backup verificado (testes injetam a porta de memória). */
  sbis?: PortaSbis;
  cofreSegredos?: Cofre;
  /** M60 (etapa 2): a conferência da instalação (testes injetam a porta e os scripts do pacote). */
  implantacao?: PortaImplantacao;
  scriptsDoPacote?: () => readonly { numero: number; hash: string }[];
  /** M60 (etapa 3): o Valkey e as filas lidos pela fumaça do servidor (testes injetam a porta). */
  filasImplantacao?: PortaFilasImplantacao;
  /** M56 (etapa F0): a porta da operadora própria (testes injetam a porta). */
  operadora?: PortaOperadora;
  /** M56 (etapa 4, F3): a rede credenciada da operadora própria. */
  redeOperadora?: PortaRedeOperadora;
  /** M54 (etapa 1, F1): a contabilidade (plano de contas, regras versionadas e fatos dos módulos). */
  contabil?: PortaContabil;
  /** M56 (etapa 3, F2): a cobrança e as mensalidades da operadora própria. */
  cobrancaOperadora?: PortaCobrancaOperadora;
  /** M56 (etapa 5, F4): a autorização de guias e a auditoria médica da operadora própria. */
  autorizacaoOperadora?: PortaAutorizacaoOperadora;
  /** M56 (etapa 6, F5): as contas médicas recebidas pela operadora própria. */
  contasOperadora?: PortaContasOperadora;
  /** M56 (etapa 7, F6): as obrigações da operadora própria com a ANS. */
  ansOperadora?: PortaAnsOperadora;
  /** M56 (etapa 8, F7): o atendimento com protocolo e as contas do portal do prestador. */
  atendimentoOperadora?: PortaAtendimentoOperadora;
  integracao?: PortaIntegracao;
  /** M58-F4: a fachada da API de integração da Hal-AI (testes injetam a porta). */
  fachada?: PortaFachada;
  armazemConteudo?: ArmazemConteudo;
  /** M28: estoque, almoxarifado e compras (testes injetam a porta). */
  suprimentos?: PortaSuprimentos;
  /** M46 (etapa 3): OPME (testes injetam a porta). */
  opme?: PortaOpme;
  /** M46 (etapa 4): consignados e manipulação (testes injetam as portas). */
  consignado?: PortaConsignado;
  manipulacao?: PortaManipulacao;
  /** M55 (fatia F2): rouparia e lavanderia (testes injetam a porta). */
  rouparia?: PortaRouparia;
  /** M55 (etapa 1): manutenção e engenharia clínica (testes injetam a porta). */
  manutencao?: PortaManutencao;
  /** M55 (etapa 5): contratualização SUS (testes injetam a porta). */
  contratualizacao?: PortaContratualizacao;
  /** M55 (etapa 3): contratos com fornecedores (testes injetam a porta). */
  contrato?: PortaContrato;
  /** M55 (etapa 4): licitação e pregão (testes injetam a porta). */
  licitacao?: PortaLicitacao;
  /** M29: farmácia hospitalar, dispensação e farmácia clínica. */
  farmacia?: PortaFarmacia;
  /** M30: conta do paciente, lançamentos e auditoria de contas (testes injetam a porta). */
  faturamento?: PortaFaturamento;
  /** M32: financeiro e fiscal (testes injetam a porta e a guarda dos arquivos). */
  financeiro?: PortaFinanceiro;
  /** M52.1: a porta da gestão de pessoas (testes injetam a porta) e a chave do CPF. */
  pessoas?: PortaPessoas;
  cifraCpf?: CifraCpf | null;
  /** M52.2: a porta da escala de plantão (testes injetam a porta). */
  escala?: PortaEscala;
  /** M52.5: a porta do SESMT (testes injetam a porta). */
  sesmt?: PortaSesmt;
  /** W0-06, parte 4: a porta de cargos e salários (testes injetam a porta). */
  cargos?: PortaCargos;
  /** W0-06, parte 5: a porta da avaliação de desempenho, competências e PDI (testes injetam a porta). */
  avaliacao?: PortaAvaliacao;
  /** M53-F1: a porta das rubricas e tabelas legais da folha (testes injetam a porta). */
  rubricas?: PortaRubricas;
  /** M52.4: a porta do ponto (testes injetam a porta). */
  ponto?: PortaPonto;
  /** M52.6: as portas dos treinamentos e do plantão realizado (testes injetam as portas). */
  treinamento?: PortaTreinamento;
  realizado?: PortaRealizado;
  /** M53.1: a porta da interface com a folha externa (testes injetam a porta). */
  folha?: PortaFolha;
  calculoFolha?: PortaCalculoFolha;
  /** W0-06, parte 6: a porta das solicitações do autoatendimento (testes injetam a porta). */
  autoatendimento?: PortaAutoatendimento;
  /** W0-06, parte 7: a porta do painel de indicadores de pessoas (testes injetam a porta). */
  indicadoresPessoas?: PortaIndicadoresPessoas;
  /** M53.9: a porta da integração da folha com o financeiro e o contábil (testes). */
  integracaoFolha?: PortaIntegracaoFolha;
  /** M53.6: a porta do eSocial (testes). */
  esocial?: PortaEsocial;
  /** M53.6: o transmissor real do eSocial (testes injetam o do simulador). */
  transmissorEsocial?: DisponibilidadeTransmissor;
  /** M33: a porta do repasse (testes). */
  repasse?: PortaRepasse;
  /** M57 (etapa 1): a porta do MPI da Rede (testes). */
  rede?: PortaRede;
  /** M57 (etapa 3): a porta do registro dos serviços compartilhados da Rede (testes). */
  servicosRede?: PortaServicosRede;
  custos?: PortaCustos;
  /** M54 (etapa 7): a porta do orçamento empresarial (testes). */
  orcamento?: PortaOrcamento;
  patrimonio?: PortaPatrimonio;
  /** W0-08 (achado 6): o armazenamento dos PDFs dos laudos do patrimônio (padrão: S3 com Object Lock; memória na sintética). */
  armazemLaudoPatrimonio?: ArmazemLaudoPatrimonio;
  /** M51 (etapa 1): a porta e a guarda do arquivo do faturamento SUS (testes). */
  sus?: PortaSus;
  armazemArquivoSus?: ArmazemArquivoSus;
  /** M49 (etapa 1): a porta e a configuração da assinatura ICP-Brasil (testes injetam o simulador e o cofre). */
  assinaturaIcp?: PortaAssinaturaIcp;
  /** M50 (etapa 1): a porta do portal do paciente (os testes injetam a memória ou a transação na cópia). */
  portalPaciente?: PortaPortalPaciente;
  /** M50 (etapa 3): a porta do portal do médico externo (os testes injetam a memória ou a transação na cópia). */
  portalMedico?: PortaPortalMedico;
  /** M50 (etapa 2): a porta da agenda online, do pré-check-in, do pagamento e da pesquisa; e o gateway (simulado). */
  agendaOnline?: PortaAgendaOnline;
  gatewayPortal?: GatewayPagamento;
  /** M50 (etapa 4): a porta da telemedicina e o provedor da sala (os testes injetam a memória e o simulado). */
  telemedicina?: PortaTelemedicina;
  provedorTeleconsulta?: ProvedorTeleconsulta;
  configAssinaturaIcp?: ConfigServicoAssinatura;
  armazemFinanceiro?: ArmazemFinanceiro;
  /** M31: TISS, competência, demonstrativos, glosa e recurso (testes injetam a porta e a guarda do XML). */
  tiss?: PortaTiss;
  armazemXmlTiss?: ArmazemXmlTiss;
}

@Module({})
export class AppModule {
  /**
   * `fonte`: o núcleo do legado (M02/M05). Implementa a coexistência (M02) e a fonte de acesso (M05); null
   * quando não configurado. `armazem`: armazém de sessões (padrão: em memória; o servidor passa o Valkey).
   * `servico`: serviço de sessão já montado (opcional; senão é montado aqui pelo ambiente).
   * `assinaturas`: fonte do painel de assinaturas (M03).
   */
  static com(
    configuracao: Configuracao,
    fonte: (FonteCoexistencia & Partial<FonteAcesso>) | null = null,
    env: NodeJS.ProcessEnv = process.env,
    opcoes: OpcoesApp = {},
  ): DynamicModule {
    const fonteAssinaturas =
      opcoes.assinaturas ?? fonteArquivosAssinatura(caminhosPadrao(process.cwd(), env), codigosOuVazio(env));
    const fonteProntidao = opcoes.prontidao ?? fonteArquivoProntidao(caminhoProntidao(process.cwd(), env));
    const fonteHomologacao =
      opcoes.homologacao ?? fonteArquivoHomologacao(caminhoHomologacao(process.cwd(), env));
    const real = fonte && typeof fonte.autenticar === 'function' ? (fonte as FonteAcesso) : null;
    // M06: trilha dupla. Fonte sintética (dev/ci): em memória, nada grava na cópia. Núcleo real: o executor
    // grava TBCABTRILHA/TBLANTRILHASGH e SGH_TRILHA na mesma transação (auditoria.registrarEventoLegado).
    const nucleoReal = fonte instanceof NucleoLegado ? fonte : null;
    const caminhoCatalogo = resolve(process.cwd(), env['CATALOGO_OPERACOES'] ?? 'docs/operacoes/catalogo');
    const trilha: RegistradorTrilha =
      opcoes.trilha ??
      (nucleoReal && !fontesSinteticas(env)
        ? new RegistradorTrilhaLegado(
            nucleoReal,
            nucleoReal.criarExecutor({ catalogo: fonteCatalogoArquivo(caminhoCatalogo) }),
          )
        : new RegistradorTrilhaMemoria());
    const aviso = (m: string, c: Record<string, unknown>) => logger.warn(c, m);
    const url = env['VALKEY_URL']?.trim();
    const alerta: AlertaAuditor = opcoes.alerta ?? (url ? new AlertaPorFila(url) : new AlertaSemFila(aviso));
    // ADR 0021: suporte técnico e "login como". Com a fonte sintética (dev/ci), as contas SINTÉTICAS da
    // plataforma em memória; senão (fora de dev/ci, ou dev com ACESSO_FONTE_DEV=copia), as tabelas SGH_ do
    // banco da plataforma (PLATAFORMA_ESTABELECIMENTO; padrão: o primeiro estabelecimento configurado).
    const armazemSessoes = opcoes.armazem ?? new ArmazemMemoria();
    const codigosConfigurados = codigosOuVazio(env);
    const suporteSintetico = fontesSinteticas(env) && !fonteDevDaCopia(env);
    const redeSuporte = real?.rede ?? configuracao.rede ?? 'rede-sintetica';
    const hospitalPlataforma = env['PLATAFORMA_ESTABELECIMENTO']?.trim() || codigosConfigurados[0] || '';
    const repoPlataforma: RepositorioPlataforma | null =
      opcoes.plataforma !== undefined
        ? opcoes.plataforma
        : suporteSintetico
          ? RepositorioPlataformaMemoria.sintetico(redeSuporte, codigosConfigurados, (x) => cifrarSenha(x))
          : nucleoReal && hospitalPlataforma
            ? new RepositorioPlataformaLegado(nucleoReal, hospitalPlataforma)
            : null;
    const fonteComo: FonteComoEstabelecimento | null =
      opcoes.comoEstabelecimento !== undefined
        ? opcoes.comoEstabelecimento
        : suporteSintetico
          ? new FonteComoMemoria(new FonteAcessoSintetica(env))
          : nucleoReal
            ? // Dev/ci sobre a cópia (ACESSO_FONTE_DEV=copia): prévia sim, Corrigir não (COMMIT no SPDATA
              // da cópia compartilhada fora da trava; ADR 0021, decisão 20).
              new FonteComoLegado(nucleoReal, !fontesSinteticas(env))
            : null;
    const ganchos: { servico: ServicoSessao | null } = { servico: null };
    const servicoPlataforma = repoPlataforma
      ? new ServicoPlataforma(repoPlataforma, armazemSessoes, {
          ambiente: configuracao.ambiente,
          produto: configuracao.produtoNome,
          chaveMestra: chaveMestra(env['PLATAFORMA_CHAVE_MESTRA']),
        })
      : null;
    const servicoComo =
      repoPlataforma && fonteComo
        ? new ServicoComo(repoPlataforma, fonteComo, armazemSessoes, {
            rede: redeSuporte,
            estabelecimentos: () => {
              const s = ganchos.servico;
              try {
                return s ? s.estabelecimentos(s.rede).estabelecimentos : [];
              } catch {
                return [];
              }
            },
            minutos: minutosSessaoComo(env['SUPORTE_SESSAO_MINUTOS']),
            avisoAuditor: (env['SUPORTE_AVISO_AUDITOR'] ?? '').trim() !== 'nao',
            alerta,
            aviso,
            // ADR 0022: padrão de "em nome de quem gravar" do acesso total, por estabelecimento.
            emNomeDe: emNomeDePadrao(env['PLATAFORMA_EM_NOME_DE']),
          })
        : null;
    const ganchosComo = {
      // Sem o serviço do "como", nenhuma sessão "como" vale (falha fechada).
      guardaComo: (c: RegistroComo, rede: string, hospital: string) =>
        servicoComo ? servicoComo.guarda(c, rede, hospital) : Promise.resolve(false),
      reautenticarAtor: (c: RegistroComo, senha: string) =>
        servicoPlataforma ? servicoPlataforma.conferirSenhaDaConta(c.idConta, senha) : Promise.resolve(false),
      aoEncerrarComo: (c: RegistroComo, motivo: string) =>
        servicoComo ? servicoComo.aoEncerrar(c, motivo) : Promise.resolve(),
    };
    // M59-F2: credencial forte, segundo fator e política, só com o núcleo real (a contingência vem da configuração,
    // montada adiante: o fecho só é chamado depois da partida).
    // M59.2: com a fonte sintética (dev/ci, E2E), a porta em memória das contas sintéticas da identidade (nada na cópia).
    const portaIdentidade = suporteSintetico
      ? portaIdentidadeSintetica()
      : nucleoReal
        ? portaIdentidadeDoNucleo(nucleoReal)
        : null;
    const identidade = portaIdentidade
      ? new ServicoIdentidade({
          porta: portaIdentidade,
          contingencia: contingenciaPelaConfiguracao(() => fonteConfig),
          chave:
            chaveMestra(env['ACESSO_CHAVE_MESTRA'] ?? env['PLATAFORMA_CHAVE_MESTRA']) ??
            (fontesSinteticas(env) ? randomBytes(32) : null),
          emissor: configuracao.produtoNome,
          aviso,
        })
      : null;
    // W1-01: troca de senha pelo novo. Dev/ci sintético: memória (nada no banco); núcleo real: a receita
    // acesso.trocarSenha pelo executor, com a combinação confirmada (ACESSO_COMBINACAO_SENHA).
    const portaSenha = suporteSintetico
      ? portaSenhaMemoria()
      : nucleoReal
        ? portaSenhaDoNucleo(
            nucleoReal,
            () => nucleoReal.criarExecutor({ catalogo: fonteCatalogoArquivo(caminhoCatalogo) }),
            combinacaoDoAmbiente(env),
          )
        : null;
    const servico =
      opcoes.servico !== undefined
        ? opcoes.servico
        : montarServicoSessao(env, real, armazemSessoes, trilha, aviso, {
            ...ganchosComo,
            ...(identidade ? { identidade } : {}),
            ...(portaSenha ? { senhaLegado: portaSenha } : {}),
          });
    ganchos.servico = servico;
    servicoComo?.ligarSessao(servico);
    const sintetica = new SessaoSintetica(env, { nucleoReal: nucleoReal !== null });
    const resolvedorRede = new ResolvedorRedeConfigurado(env);
    const resolvedorSessao = new ResolvedorSessao(
      servico,
      sintetica,
      resolvedorRede,
      !['dev', 'ci'].includes(configuracao.ambiente),
    );
    const registroEmergencia =
      nucleoReal && !fontesSinteticas(env)
        ? new RegistroEmergenciaLegado(nucleoReal)
        : new RegistroEmergenciaMemoria(trilha);
    const metricas = opcoes.metricas ?? new MetricasExecutor();
    const fonteGravacao = criarFonteGravacao({
      catalogo: caminhoCatalogo,
      estabelecimentos: codigosOuVazio(env),
      metricas,
      nucleo: fonte && 'lerSomente' in fonte ? (fonte as unknown as NucleoLeitura) : null,
    });
    // M08: CRUD genérico e configuração. Em dev/ci, SEMPRE a memória: a sessão de dev/ci é sintética
    // (SINT.ADMIN, senha no repositório), e gravar com ela na cópia compartilhada seria COMMIT sem a trava,
    // em nome de quem não existe no TBUSERS. Fora de dev/ci, o núcleo real; sem ele, falha fechada (503),
    // nunca a memória. A validação humana na cópia roda com AMBIENTE=homolog ou treino e o login real.
    if (fontesSinteticas(env) && env['CONFIG_FONTE']?.trim())
      throw new Error(
        'CONFIG_FONTE não é mais aceito: em dev/ci o CRUD genérico e a configuração usam a memória; a validação na cópia roda com AMBIENTE=homolog ou treino e o login real.',
      );
    const usarLegado = nucleoReal !== null && !fontesSinteticas(env);
    const catalogoOps = fonteCatalogoArquivo(caminhoCatalogo);
    // M38: onda 0. Com o núcleo real (fora de dev/ci, ou dev sobre a cópia: só leitura e a conferência do executor,
    // que não grava), o executor e o banco; na memória, o catálogo e a vigilância sintética.
    const onda0: PortaOnda0 =
      opcoes.onda0 ??
      (nucleoReal && (!fontesSinteticas(env) || fonteDevDaCopia(env))
        ? portaOnda0Legado(
            nucleoReal,
            nucleoReal.criarExecutor({ catalogo: catalogoOps }),
            codigosConfigurados,
          )
        : portaOnda0Memoria(catalogoOps, codigosConfigurados));
    const dominios =
      opcoes.dominios ??
      (usarLegado && nucleoReal
        ? fonteDominiosLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env)
          ? fonteDominiosMemoria(catalogoOps, configuracao.ambiente)
          : fonteDominiosIndisponivel());
    // Revisão do W0-02 (D-CRUD-SEM-GATILHO): a vigia de reconciliação dos cadastros, só com a fonte do banco; cada
    // estabelecimento liga pelo parâmetro crud.vigiaReconciliacao (CRUD_VIGIA_RECONCILIACAO=nao desliga o despertar).
    const vigiaCrud =
      opcoes.vigiaReconciliacao !== undefined
        ? opcoes.vigiaReconciliacao
        : dominios.destino === 'legado' && env['CRUD_VIGIA_RECONCILIACAO'] !== 'nao'
          ? new VigiaReconciliacaoCrud(dominios, real?.rede ?? configuracao.rede ?? '', codigosConfigurados)
          : null;
    const fonteConfig =
      opcoes.configuracao ??
      (usarLegado && nucleoReal
        ? fonteConfiguracaoLegado(nucleoReal)
        : fontesSinteticas(env)
          ? fonteConfiguracaoMemoria(trilha, {
              chavesIniciais: chavesIniciaisSinteticas,
              prerequisitosIniciais: prerequisitosIniciaisSinteticos,
              parametrosIniciais: parametrosIniciaisSinteticos,
            })
          : fonteConfiguracaoIndisponivel());
    // W1-01 (parte 11d; D-W101-46): bloqueio dos atos privativos pela conferência do conselho (acesso.conselho.*).
    servico?.servicoAutorizacao?.definirRegraConselho(parametrosConselhoPelaConfiguracao(() => fonteConfig));
    // W1-01 (parte 11b2): troca rápida de usuário por PIN (D-W101-36). Dev/ci sintético: o PIN em memória (nada no
    // banco); núcleo real: SGH_ACESSO_PIN (1209) na transação SGH_ com a trilha; sem núcleo: indisponível. Parâmetros
    // acesso.trocaRapida.* pela configuração; o nascimento (recusa do PIN derivado) pela porta da senha.
    const portaPin: PortaPin = suporteSintetico
      ? portaPinMemoria((t) => {
          void trilha
            .registrar({
              evento: t.evento,
              rede: t.rede,
              hospital: t.hospital,
              usuario: t.usuario ?? '',
              estacao: t.estacao ?? '',
              correlacao: t.correlacao ?? '',
              recurso: t.recurso,
              resultado: t.resultado === 'falha' ? 'falha' : 'sucesso',
              tabelaAlvo: 'SGH_ACESSO_PIN',
              chaveNaturalAlvo: `pin:${t.operacao}`,
            })
            .catch(() => undefined);
        })
      : nucleoReal
        ? portaPinDoNucleo(nucleoReal)
        : portaPinIndisponivel();
    const nascimentoPin = portaSenha?.nascimento?.bind(portaSenha);
    const trocaRapida = servico
      ? new ServicoTrocaRapida(servico, {
          porta: portaPin,
          parametros: parametrosTrocaRapidaPelaConfiguracao(() => fonteConfig),
          trilha,
          ...(nascimentoPin ? { nascimento: nascimentoPin } : {}),
          aviso,
        })
      : null;
    // M12: convênios e preços. Fora de dev/ci, o núcleo real (gravação pelo executor); em dev com a fonte da
    // cópia (ACESSO_FONTE_DEV=copia: login real do SPDATA), a LEITURA da cópia e a gravação desligada com o
    // motivo na tela (COMMIT na cópia compartilhada fora da trava não é caminho de tela); em dev/ci com a
    // sessão sintética, a memória; sem núcleo fora de dev/ci, 503.
    const precos: FontePrecos =
      opcoes.precos ??
      (usarLegado && nucleoReal
        ? fontePrecosLegado(nucleoReal, catalogoOps, { metricas, gravacaoPermitida: true })
        : nucleoReal && fonteDevDaCopia(env)
          ? fontePrecosLegado(nucleoReal, catalogoOps, {
              metricas,
              gravacaoPermitida: false,
              motivoSemGravacao:
                'Em desenvolvimento sobre a cópia compartilhada (ACESSO_FONTE_DEV=copia), a gravação fica desligada: ela confirmaria no banco da cópia, fora da trava e sem a conferência no SPDATA. A gravação é provada pelos testes de assinatura e de integração; a validação na cópia roda com AMBIENTE=homolog ou treino.',
            })
          : fontesSinteticas(env)
            ? new FontePrecosMemoria(catalogoOps, configuracao.ambiente)
            : fontePrecosIndisponivel());
    // M13: catálogos oficiais, pela mesma regra da fonte de preços (núcleo fora de dev/ci; em dev sobre a cópia, a
    // leitura da cópia e a gravação SGH_ desligada com o motivo; na sessão sintética, a memória; sem núcleo, 503).
    // A publicação no banco do estabelecimento é do worker.
    const catalogos: FonteCatalogos =
      opcoes.catalogos ??
      (usarLegado && nucleoReal
        ? fonteCatalogosLegado(nucleoReal, { gravacaoPermitida: true })
        : nucleoReal && fonteDevDaCopia(env)
          ? fonteCatalogosLegado(nucleoReal, {
              gravacaoPermitida: false,
              motivoSemGravacao:
                'Em desenvolvimento sobre a cópia compartilhada (ACESSO_FONTE_DEV=copia), o envio de cargas fica desligado: ele confirmaria no banco da cópia, fora da trava. As cargas são provadas pelos testes de assinatura e de integração; a validação roda com AMBIENTE=homolog ou treino.',
            })
          : fontesSinteticas(env)
            ? new FonteCatalogosMemoria(async (t) => {
                await trilha.registrar({
                  evento: t.evento,
                  rede: t.rede,
                  hospital: t.hospital,
                  usuario: t.usuario,
                  estacao: t.estacao ?? '',
                  correlacao: t.correlacao,
                  recurso: t.recurso,
                  resultado: 'sucesso',
                  tabelaAlvo: t.tabelaAlvo,
                  idAlvo: t.idAlvo,
                  ...(t.chaveNaturalAlvo ? { chaveNaturalAlvo: t.chaveNaturalAlvo } : {}),
                });
              })
            : fonteCatalogosIndisponivel());
    const guardar = usarLegado ? guardarArquivoCatalogo(configuracao, env) : undefined;
    const servicoCatalogos = new ServicoCatalogos(catalogos, {
      ambiente: configuracao.ambiente,
      janela: env['CATALOGO_JANELA_PUBLICACAO'] ?? null,
      ...(guardar ? { guardarArquivo: guardar } : {}),
    });
    // ADR 0022: tela "Perfis e permissões". Com o núcleo real (fora de dev/ci, ou dev sobre a cópia), as
    // leituras ao vivo e as gravações SGH_ no banco; as receitas do legado pelo executor, desligadas em dev
    // sobre a cópia compartilhada (COMMIT no SPDATA da cópia só sob a trava, nos testes). Fonte sintética:
    // a memória (o estado sintético que a sessão lê). Sem nada: 503.
    const gestao =
      nucleoReal && (!fontesSinteticas(env) || fonteDevDaCopia(env))
        ? fonteGestaoLegado(
            nucleoReal,
            nucleoReal.criarExecutor({ catalogo: catalogoOps, metricas }),
            catalogoOps,
            configuracao.ambiente,
            // Opt-in explícito do dono (ACESSO_GESTAO_LEGADO_DEV=sim, ou o dev que grava, DEV_GRAVA_COPIA=sim): COMMIT no
            // legado da cópia em dev.
            {
              receitasDesligadas:
                fonteDevDaCopia(env) &&
                !devGravaCopia(env) &&
                (env['ACESSO_GESTAO_LEGADO_DEV'] ?? '').trim() !== 'sim',
            },
          )
        : suporteSintetico
          ? fonteGestaoMemoria(trilha, catalogoOps, configuracao.ambiente)
          : fonteGestaoIndisponivel();
    // M59-F4: saneamento dos grupos de acesso amplo. Com o núcleo real, as leituras ao vivo e o plano em SGH_; a troca de
    // grupo, o bloqueio e a retirada das opções pelas receitas do M10 (as mesmas da gestão, com o estado do catálogo).
    // Fonte sintética: a porta sobre o estado sintético do acesso, com o plano em memória (nada na cópia). Sem nada: 503.
    const portaSaneamento = opcoes.saneamento
      ? opcoes.saneamento
      : suporteSintetico
        ? new PortaSaneamentoSintetica()
        : nucleoReal
          ? portaSaneamentoDoNucleo(nucleoReal)
          : null;
    const saneamento = portaSaneamento
      ? new ServicoSaneamento({
          porta: portaSaneamento,
          executor: {
            receita: (n: string, h: string) => gestao.receita(n, h),
            executar: (n: string, h: string, e: unknown, c: ContextoOperacao) => gestao.executar(n, h, e, c),
          },
          administradoresMaximo: administradoresMaximoPelaConfiguracao(() => fonteConfig),
          invalidar: async (rede: string, h: string, login: string | null) => {
            const a = servico?.servicoAutorizacao;
            if (!a) return;
            await (login ? a.invalidar(rede, h, login) : a.invalidarEstabelecimento(rede, h));
          },
        })
      : null;
    // W1-01 (parte 9b): a rotina das contas dormentes sobre a fonte da gestão (bloqueio pelo executor com o estado da
    // receita; parâmetros acesso.contasDormentes.* pela configuração; trilha pelo registrador da API; aviso = a
    // trilha, sem fila de e-mail ainda). O despertar diário só com a fonte do banco FORA de dev/ci (a cópia é
    // compartilhada: lá a rotina roda pela tela, com reautenticação), salvo ACESSO_CONTAS_DORMENTES_DESPERTAR=sim;
    // ACESSO_CONTAS_DORMENTES_DESPERTAR=nao desliga em qualquer ambiente.
    const parametrosDormencia = parametrosDormenciaPelaConfiguracao(() => fonteConfig);
    const portaDormencia = portaDormenciaDaFonte({
      fonte: () => gestao,
      parametros: parametrosDormencia,
      trilha,
    });
    const contasDormentes = new ServicoContasDormentes({
      porta: portaDormencia,
      responsavel: responsavelDaFonte(() => gestao),
    });
    const despertarDormentesEnv = (env['ACESSO_CONTAS_DORMENTES_DESPERTAR'] ?? '').trim();
    const despertarDormentes =
      gestao.destino === 'legado' &&
      despertarDormentesEnv !== 'nao' &&
      (despertarDormentesEnv === 'sim' || !['dev', 'ci'].includes(configuracao.ambiente))
        ? new DespertarContasDormentes(
            contasDormentes,
            portaDormencia,
            real?.rede ?? configuracao.rede ?? '',
            codigosConfigurados,
          )
        : null;
    // M10: telas de acesso, organização e auditoria, pela regra da tela "Perfis e permissões" (ADR 0022): com o
    // núcleo real, as leituras ao vivo e as receitas pelo executor (desligadas em dev sobre a cópia compartilhada,
    // salvo o opt-in do dono); com a fonte sintética, a memória; sem nada, 503.
    const administracao: FonteAdministracao =
      opcoes.administracao ??
      (nucleoReal && (!fontesSinteticas(env) || fonteDevDaCopia(env))
        ? fonteAdministracaoLegado(
            nucleoReal,
            nucleoReal.criarExecutor({ catalogo: catalogoOps, metricas }),
            catalogoOps,
            configuracao.ambiente,
            {
              receitasDesligadas:
                fonteDevDaCopia(env) &&
                !devGravaCopia(env) &&
                (env['ACESSO_GESTAO_LEGADO_DEV'] ?? '').trim() !== 'sim',
            },
          )
        : suporteSintetico
          ? fonteAdministracaoMemoria(
              trilha,
              catalogoOps,
              configuracao.ambiente,
              () =>
                registroEmergencia instanceof RegistroEmergenciaMemoria ? registroEmergencia.aberturas : [],
              // X-01: o vínculo login → profissional vem da memória do cadastro (a mesma da aba Login do sistema).
              (c, login) =>
                cadastro instanceof PortaCadastroMemoria ? cadastro.profissionalDoLogin(c, login) : null,
            )
          : fonteAdministracaoIndisponivel());
    // M11: cadastro de pacientes e profissionais, pela mesma regra do CRUD genérico: núcleo fora de dev/ci; em
    // dev/ci com a cópia (ACESSO_FONTE_DEV=copia), as LEITURAS vêm da cópia (READ ONLY; DP-41) e as gravações
    // pelo mesmo executor ficam recusadas fora da trava (a cópia é compartilhada); na sessão sintética, a
    // memória (pacientes sintéticos).
    const cadastro =
      opcoes.cadastro ??
      (usarLegado && nucleoReal
        ? portaCadastroLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaCadastroLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaCadastroMemoria(catalogoOps)
            : portaCadastroIndisponivel());
    // M15: prontuário ao vivo, só leitura. Fora de dev/ci, o núcleo; em dev/ci com a cópia
    // (ACESSO_FONTE_DEV=copia), as LEITURAS da cópia (READ ONLY; DP-41: a cópia real em dev); na sessão
    // sintética, a memória (registros sintéticos dos pacientes sintéticos); sem núcleo fora de dev/ci, 503.
    const prontuario =
      opcoes.prontuario ??
      (nucleoReal && (usarLegado || fonteDevDaCopia(env))
        ? portaProntuarioLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaProntuarioMemoria(trilha instanceof RegistradorTrilhaMemoria ? trilha : null)
          : portaProntuarioIndisponivel());
    // M14: consultas somente leitura. Consulta não grava: fora de dev/ci, o núcleo; em dev com a fonte da cópia
    // (ACESSO_FONTE_DEV=copia), a leitura da cópia (READ ONLY); na sessão sintética, linhas sintéticas; sem
    // núcleo fora de dev/ci, 503.
    const consultas: FonteConsultas =
      opcoes.consultas ??
      (usarLegado && nucleoReal
        ? fonteConsultasLegado(nucleoReal)
        : nucleoReal && fonteDevDaCopia(env)
          ? fonteConsultasLegado(nucleoReal)
          : fontesSinteticas(env)
            ? fonteConsultasMemoria()
            : fonteConsultasIndisponivel());
    // M22: registros clínicos, pela regra do cadastro (M11): núcleo fora de dev/ci; em dev com a cópia, as
    // LEITURAS da cópia e as gravações recusadas pelo executor só de leitura (cópia compartilhada); na sessão
    // sintética, a memória (modelos, rascunhos e registros sintéticos); sem núcleo fora de dev/ci, 503.
    const registro =
      opcoes.registro ??
      (usarLegado && nucleoReal
        ? portaRegistroLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaRegistroLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaRegistroMemoria(trilha)
            : portaRegistroIndisponivel());
    // M45 (etapa 1): construtor de formulários novos, pela mesma regra (em dev sobre a cópia, as gravações SGH_
    // recusadas e o executor só de leitura; na sessão sintética, a memória; sem núcleo fora de dev/ci, 503).
    const formularioNovo =
      opcoes.formularioNovo ??
      (usarLegado && nucleoReal
        ? portaFormularioNovoLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaFormularioNovoLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura(), {
              sghSoLeitura: true,
            })
          : fontesSinteticas(env)
            ? new PortaFormularioNovoMemoria()
            : portaFormularioNovoIndisponivel());
    // M45 (etapa 6; DP-32): as especialidades sob demanda e o lactário, pela mesma regra (em dev sobre a cópia, as
    // gravações SGH_ recusadas e o executor só de leitura; na sessão sintética, a memória; sem núcleo fora de dev/ci, 503).
    const especialidades =
      opcoes.especialidades ??
      (usarLegado && nucleoReal
        ? portaEspecialidadesLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaEspecialidadesLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura(), {
              sghSoLeitura: true,
            })
          : fontesSinteticas(env)
            ? new PortaEspecialidadesMemoria()
            : portaEspecialidadesIndisponivel());
    // M24: prescrição eletrônica, pela mesma regra dos registros clínicos (M22): a cópia em dev só para leitura
    // (gravação recusada pelo executor só de leitura); a memória na sessão sintética; 503 sem núcleo fora de dev/ci.
    const prescricao =
      opcoes.prescricao ??
      (usarLegado && nucleoReal
        ? portaPrescricaoLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaPrescricaoLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaPrescricaoMemoria(trilha)
            : portaPrescricaoIndisponivel());
    // M16: painel de leitos, censo, painéis e indicadores, só leitura. Pela regra do prontuário (M15): o núcleo
    // fora de dev/ci e em dev com a cópia (ACESSO_FONTE_DEV=copia); na sessão sintética, o estabelecimento
    // sintético (a "gravação por fora" do E2E chega pelo arquivo LEITOS_SINTETICOS_POR_FORA, só dev/ci); sem
    // núcleo fora de dev/ci, 503. O vigia de mudanças: um por processo, marca d'água no armazém da sessão.
    const internacao: FonteInternacao =
      opcoes.internacao ??
      (nucleoReal && (usarLegado || fonteDevDaCopia(env))
        ? fonteInternacaoLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new FonteInternacaoMemoria({
              arquivoPorFora: env['LEITOS_SINTETICOS_POR_FORA']?.trim() || null,
              // M57 (etapa 3): o estabelecimento sintético da rede (REDE_SINTETICA_SEGUNDO) tem movimento próprio,
              // para o BI consolidado somar estabelecimentos diferentes.
              variantes: variantesSinteticasRede(env['REDE_SINTETICA_SEGUNDO']),
            })
          : fonteInternacaoIndisponivel());
    // M19: recepção, pela regra da agenda (M17): núcleo fora de dev/ci; em dev com a cópia, as LEITURAS da cópia e as
    // gravações recusadas pelo executor só de leitura; na sessão sintética, a memória (a "chamada pelo outro sistema"
    // do E2E chega pelo arquivo RECEPCAO_SINTETICA_POR_FORA, só dev/ci); senão, 503.
    const recepcao =
      opcoes.recepcao ??
      (usarLegado && nucleoReal
        ? portaRecepcaoLegado(nucleoReal, catalogoOps, codigosOuVazio(env), metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaRecepcaoLegado(nucleoReal, catalogoOps, codigosOuVazio(env), metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaRecepcaoMemoria(catalogoOps, {
                arquivoPorFora: env['RECEPCAO_SINTETICA_POR_FORA']?.trim() || null,
              })
            : portaRecepcaoIndisponivel());
    const vigia =
      opcoes.vigia !== undefined
        ? opcoes.vigia
        : new MotorVigia({
            rede: real?.rede ?? configuracao.rede ?? 'rede-sintetica',
            lerCanal: (hospital, canal, marca) =>
              // M19: na sessão sintética, o canal das senhas é o da recepção em memória (a do legado é a do M16).
              canal === 'senhas' && recepcao.canalSenhas
                ? recepcao.canalSenhas({ rede: real?.rede ?? configuracao.rede ?? '', hospital }, marca)
                : internacao.canal(
                    { rede: real?.rede ?? configuracao.rede ?? '', hospital, traceId: `vigia-${canal}` },
                    canal,
                    marca,
                  ),
            armazem: opcoes.armazem ?? new ArmazemMemoria(),
            tipoArmazem: opcoes.armazem && !(opcoes.armazem instanceof ArmazemMemoria) ? 'valkey' : 'memoria',
            intervaloMs: intervaloDoAmbiente(env),
            aviso,
          });
    // M17: agenda de consultas, pela regra do cadastro (M11): núcleo fora de dev/ci; em dev com a cópia, as
    // LEITURAS da cópia e as gravações recusadas pelo executor só de leitura (cópia compartilhada); na sessão
    // sintética, a memória (agendas, horários e marcações sintéticos dos pacientes sintéticos); senão, 503.
    const agenda =
      opcoes.agenda ??
      (usarLegado && nucleoReal
        ? portaAgendaLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaAgendaLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaAgendaMemoria(catalogoOps, (c, ids) => cadastro.lerPacientes(c, ids), undefined, {
                // M39: a marcação "por fora" do E2E (o outro terminal ocupa o horário), só dev/ci; e as recusas
                // nas contagens do executor (indicadores de disputa).
                arquivoPorFora: env['AGENDA_SINTETICA_POR_FORA']?.trim() || null,
                metricas,
              })
            : portaAgendaIndisponivel());
    // M23: o prontuário de uso diário, pela mesma regra (as gravações SGH_ também recusadas em dev sobre a cópia).
    const documentos =
      opcoes.documentos ??
      (usarLegado && nucleoReal
        ? portaDocumentosLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaDocumentosLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura(), {
              sghSoLeitura: true,
            })
          : fontesSinteticas(env)
            ? new PortaDocumentosMemoria(trilha, registro instanceof PortaRegistroMemoria ? registro : null)
            : portaDocumentosIndisponivel());
    // M18: agenda de exames e centro cirúrgico, pela mesma regra da agenda de consultas (M17).
    const exame =
      opcoes.exame ??
      (usarLegado && nucleoReal
        ? portaExameLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaExameLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaExameMemoria(catalogoOps, (c, ids) => cadastro.lerPacientes(c, ids))
            : portaExameIndisponivel());
    const cirurgia =
      opcoes.cirurgia ??
      (usarLegado && nucleoReal
        ? portaCirurgiaLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaCirurgiaLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaCirurgiaMemoria(catalogoOps, (c, ids) => cadastro.lerPacientes(c, ids))
            : portaCirurgiaIndisponivel());
    // M46 (etapa 1): APA, ficha anestésica e SRPA, só do novo (em dev sobre a cópia, as gravações SGH_ recusadas; na
    // sessão sintética, a memória sobre o centro cirúrgico em memória; sem núcleo fora de dev/ci, 503).
    const anestesia =
      opcoes.anestesia ??
      (usarLegado && nucleoReal
        ? portaAnestesiaLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaAnestesiaLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaAnestesiaMemoria(cirurgia)
            : portaAnestesiaIndisponivel());
    // M46 (etapa 2): checklist, rastreio e painel para familiares, só do novo (a mesma regra da anestesia).
    const blocoSeguro =
      opcoes.blocoSeguro ??
      (usarLegado && nucleoReal
        ? portaBlocoSeguroLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaBlocoSeguroLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaBlocoSeguroMemoria(cirurgia)
            : portaBlocoSeguroIndisponivel());
    // M20: atendimento externo, pela mesma regra (a memória usa a recepção em memória para a senha e o fluxo).
    const atendimento =
      opcoes.atendimento ??
      (usarLegado && nucleoReal
        ? portaAtendimentoLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaAtendimentoLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaAtendimentoMemoria(catalogoOps, {
                lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids),
                recepcao: recepcao instanceof PortaRecepcaoMemoria ? recepcao : null,
              })
            : portaAtendimentoIndisponivel());
    // M44: classificação de risco no PA, pela mesma regra (em dev sobre a cópia, as gravações SGH_ recusadas).
    const classificacao =
      opcoes.classificacao ??
      (usarLegado && nucleoReal
        ? portaClassificacaoLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaClassificacaoLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura(), {
              sghSoLeitura: true,
            })
          : fontesSinteticas(env)
            ? new PortaClassificacaoMemoria({ trilha })
            : portaClassificacaoIndisponivel());
    // M26: SADT, laudos e portal, pela mesma regra (a memória usa o prontuário em memória para os pedidos e a ciência).
    const sadt =
      opcoes.sadt ??
      (usarLegado && nucleoReal
        ? portaSadtLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaSadtLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaSadtMemoria(
                catalogoOps,
                documentos instanceof PortaDocumentosMemoria ? documentos : null,
              )
            : portaSadtIndisponivel());
    // M27: comunicação interna, avisos e dicionário, pela mesma regra (em dev sobre a cópia, as leituras da cópia; o
    // dicionário recusado pelo executor só de leitura e as gravações SGH_ recusadas também).
    const comunicacao =
      opcoes.comunicacao ??
      (usarLegado && nucleoReal
        ? portaComunicacaoLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaComunicacaoLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura(), {
              sghSoLeitura: true,
            })
          : fontesSinteticas(env)
            ? new PortaComunicacaoMemoria(catalogoOps)
            : portaComunicacaoIndisponivel());
    // M27: as leituras próprias da fila do médico e as guias da recepção (só leitura).
    const worklist =
      opcoes.worklist ??
      (nucleoReal && (usarLegado || fonteDevDaCopia(env))
        ? portaWorklistLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaWorklistMemoria(documentos)
          : portaWorklistIndisponivel());
    const guias =
      opcoes.guias ??
      (nucleoReal && (usarLegado || fonteDevDaCopia(env))
        ? portaGuiasLegado(nucleoReal)
        : fontesSinteticas(env)
          ? portaGuiasMemoria
          : portaGuiasIndisponivel());
    const avisosSadt = new AvisosAtendimento(null);
    // M27: o canal do sino é um só (o da casca e o dos módulos que emitem na central de avisos).
    const avisosInicio = new AvisosAtendimento(null);
    const centralAvisos = new ServicoComunicacao(comunicacao, avisosInicio);
    const redeSadt = real?.rede ?? configuracao.rede ?? '';
    // A vigia do valor crítico só com os dados do banco (no ar: as liberações feitas no outro sistema). W0-10 (11d2b):
    // na fonte sintética, só com a marca explícita (o E2E do escalonamento e da notificação do crítico ao médico externo).
    const vigiaSadt =
      (usarLegado && env['SADT_VIGIA_CRITICOS'] !== 'nao') ||
      (fontesSinteticas(env) && env['SADT_VIGIA_CRITICOS'] === 'sintetica')
        ? new VigiaCriticos(
            sadt,
            redeSadt,
            codigosConfigurados,
            fonteConfig,
            avisosSadt,
            undefined,
            centralAvisos,
          )
        : null;
    const chavePortal =
      chaveMestra(env['PORTAL_CHAVE_MESTRA'] ?? env['PLATAFORMA_CHAVE_MESTRA']) ??
      (fontesSinteticas(env) ? randomBytes(32) : null);
    const servicoPortal = new ServicoPortal(
      sadt,
      redeSadt,
      fonteConfig,
      chavePortal,
      configuracao.produtoNome,
      codigosConfigurados[0] ?? null,
    );
    // M50 (etapa 1): o portal do paciente, só SGH_ (nenhuma tabela do legado). Na cópia de dev, as tabelas SGH_ do marco
    // na cópia (sgh:aplicar nas duas, como o M49); na sessão sintética, em memória com os pacientes sintéticos e os
    // documentos do prontuário em memória; sem núcleo fora de dev/ci, 503. A mesma chave mestra do portal do M26.
    const portalPaciente =
      opcoes.portalPaciente ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaPortalLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaPortalMemoria(
              documentos instanceof PortaDocumentosMemoria ? (h) => documentos.documentosParaIcp(h) : null,
            )
          : portaPortalIndisponivel());
    // M50 (etapa 2): agenda online, pré-check-in, pagamento e pesquisa, só SGH_ (scripts 0503 a 0506), pela mesma regra
    // da etapa 1; na sessão sintética, em memória com a agenda sintética 902 liberada no portal (D-SEMENTE-50).
    const agendaOnline =
      opcoes.agendaOnline ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaAgendaOnlineLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaAgendaOnlineMemoria(undefined, sementeAgendaOnline)
          : portaAgendaOnlineIndisponivel());
    const gatewayPortal = opcoes.gatewayPortal ?? gatewayDoAmbiente(env, configuracao.ambiente);
    // M50 (etapa 4): telemedicina, só SGH_ (script 0954), pela mesma regra; na sessão sintética, em memória com a
    // teleconsulta de hoje da paciente 1003 (D-SEMENTE-50.4), cuja marcação a abertura do atendimento em memória conhece.
    const telemedicina =
      opcoes.telemedicina ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaTelemedicinaLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaTelemedicinaMemoria(undefined, {
              semente: true,
              aoSemear: (h, m) => {
                if (atendimento instanceof PortaAtendimentoMemoria)
                  atendimento.incluirMarcacaoSintetica(h, m);
              },
            })
          : portaTelemedicinaIndisponivel());
    const provedorTele = opcoes.provedorTeleconsulta ?? provedorDoAmbiente(env, configuracao.ambiente);
    const armazemProvas =
      fontesSinteticas(env) && !env['S3_ENDPOINT']?.trim()
        ? new ArmazemProvasMemoria()
        : criarArmazemProvas(configuracao.rede ?? null, env);
    // M34: catálogo de relatórios (só leitura no legado; as gravações só em SGH_) e as integrações novas, pela mesma
    // regra: o núcleo fora de dev/ci; em dev com a cópia, as leituras da cópia e a gravação no legado recusada pelo
    // executor só de leitura; na sessão sintética, a memória; sem núcleo fora de dev/ci, 503.
    const relatorio =
      opcoes.relatorio ??
      (nucleoReal && (usarLegado || fonteDevDaCopia(env))
        ? portaRelatorioLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaRelatorioMemoria(trilha)
          : portaRelatorioIndisponivel());
    // M37: painel de migração gradual (só leitura no legado; gravações só em SGH_), pela mesma regra do M34.
    const coexistencia =
      opcoes.coexistencia ??
      (nucleoReal && (usarLegado || fonteDevDaCopia(env))
        ? portaCoexistenciaLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaCoexistenciaMemoria(trilha, fonteConfig)
          : portaCoexistenciaIndisponivel());
    // M59-F1: painel de contas do banco (só leitura do catálogo de segurança), pela mesma regra do M37. Sem núcleo e
    // fora do ambiente sintético, indisponível (503).
    const contasBanco =
      opcoes.contasBanco ??
      (nucleoReal && (usarLegado || fonteDevDaCopia(env))
        ? portaContasBancoLegado(nucleoReal, env)
        : fontesSinteticas(env)
          ? new PortaContasBancoMemoria()
          : portaContasBancoIndisponivel());
    // M59-F3: segredos de parceiros e senhas secundárias, pela mesma regra; o cofre é o do M49 (arquivo cifrado fora do
    // repositório com a chave mestra do deploy; memória na sessão sintética; sem os dois, indisponível).
    const segredos =
      opcoes.segredos ??
      (nucleoReal && (usarLegado || fonteDevDaCopia(env))
        ? portaSegredosLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaSegredosMemoria()
          : portaSegredosIndisponivel());
    const cofreSegredos =
      opcoes.cofreSegredos ??
      (fontesSinteticas(env)
        ? new CofreMemoria()
        : cofreDoAmbiente(env, chaveMestra(env['PLATAFORMA_CHAVE_MESTRA']), process.cwd()));
    // M59-F5: certificação SBIS, termo das concessões e backup verificado, pela mesma regra (cópia em dev; memória na
    // sessão sintética; sem os dois, indisponível). A situação do estabelecimento é a das contas do banco; as medidas
    // das concessões vêm das telas das fatias F1 a F4 (sem leitura nova do banco).
    const portaSbis =
      opcoes.sbis ??
      (nucleoReal && (usarLegado || fonteDevDaCopia(env))
        ? portaSbisLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaSbisMemoria()
          : portaSbisIndisponivel());
    const contasBancoSbis = new ServicoContasBanco({
      porta: contasBanco,
      raizDesligamento: raizesDesligamentoDoAmbiente(env).desligamento,
      configuracao: fonteConfig,
    });
    const servicoSbis = new ServicoSbis({
      porta: portaSbis,
      situacao: (c) => contasBancoSbis.situacao(c),
      medidas: (c) => ({
        privilegio: () => contasBancoSbis.desvios(c),
        prontuario: () => contasBancoSbis.imutabilidade(c),
        segredos: () =>
          new ServicoSegredos({
            porta: segredos,
            cofre: cofreSegredos,
            situacao: (x) => contasBancoSbis.situacao(x),
            receita: (n, h) => gestao.receita(n, h),
          }).situacaoSegredos(c),
        ...(identidade ? { senha: () => identidade.resumo(c.rede, c.hospital) } : {}),
        ...(saneamento
          ? {
              permissoes: () =>
                saneamento.painel({ ...c, login: 'sbis', estacao: null, correlacao: 'sbis-medida' }),
            }
          : {}),
      }),
      ...(identidade ? { politicas2fa: (h: string) => identidade.politicas(h) } : {}),
      ambiente: configuracao.ambiente,
      versao: () => new VersaoService().atual(configuracao.produtoNome),
    });
    // M60 (etapa 2): a conferência da instalação, pela mesma regra (cópia em dev; sintética em dev/ci sem o núcleo).
    const scriptsDoPacote = opcoes.scriptsDoPacote ?? scriptsDoPacoteDoDisco();
    const implantacao =
      opcoes.implantacao ??
      (nucleoReal && (usarLegado || fonteDevDaCopia(env))
        ? portaImplantacaoLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaImplantacaoMemoria(scriptsDoPacote)
          : portaImplantacaoIndisponivel());
    // M56 (etapa F0): os catálogos da ANS da operadora própria (só leitura), pela mesma regra do M34. M56.2 (F1): as
    // gravações SGH_OPE_* pelo núcleo fora de dev/ci; em dev sobre a cópia compartilhada, a leitura da cópia e a
    // gravação recusada com o motivo (`sghSoLeitura`); na sessão sintética, a memória com a trilha da API.
    const operadora =
      opcoes.operadora ??
      (nucleoReal && (usarLegado || fonteDevDaCopia(env))
        ? portaOperadoraLegado(nucleoReal, { sghSoLeitura: !usarLegado })
        : fontesSinteticas(env)
          ? new PortaOperadoraMemoria(trilha)
          : portaOperadoraIndisponivel());
    // M56 (etapa 3, F2): a cobrança e as mensalidades, pela regra da F1 (a memória lê os contratos e os beneficiários
    // da porta da F1 em memória; em dev sobre a cópia, a leitura da cópia e a gravação recusada com o motivo).
    const cobrancaOperadora =
      opcoes.cobrancaOperadora ??
      (operadora instanceof PortaOperadoraMemoria
        ? new PortaCobrancaOperadoraMemoria(operadora)
        : nucleoReal && (usarLegado || fonteDevDaCopia(env))
          ? portaCobrancaOperadoraLegado(nucleoReal, { sghSoLeitura: !usarLegado })
          : portaCobrancaOperadoraIndisponivel());
    // M56 (etapa 4, F3): a rede credenciada, pela regra do NIR (em dev sobre a cópia, as gravações SGH_ recusadas).
    const redeOperadora =
      opcoes.redeOperadora ??
      (usarLegado && nucleoReal
        ? portaRedeOperadoraLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaRedeOperadoraLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaRedeOperadoraMemoria()
            : portaRedeOperadoraIndisponivel());
    // M54 (etapa 1, F1): a contabilidade, pela regra da rede (em dev sobre a cópia, as gravações SGH_ recusadas).
    const contabil =
      opcoes.contabil ??
      (usarLegado && nucleoReal
        ? portaContabilLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaContabilLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaContabilMemoria()
            : portaContabilIndisponivel());
    // M56 (etapa 5, F4): a autorização de guias, pela regra da rede (em dev sobre a cópia, as gravações SGH_ recusadas);
    // na sessão sintética, a memória sobre as portas em memória da F1 (beneficiários) e da F3 (rede).
    const autorizacaoOperadora =
      opcoes.autorizacaoOperadora ??
      (usarLegado && nucleoReal
        ? portaAutorizacaoOperadoraLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaAutorizacaoOperadoraLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env) && operadora.destino === 'memoria' && redeOperadora.destino === 'memoria'
            ? new PortaAutorizacaoOperadoraMemoria(operadora, redeOperadora)
            : portaAutorizacaoOperadoraIndisponivel());
    // M56 (etapa 6, F5): as contas médicas, pela regra da autorização (em dev sobre a cópia, as gravações SGH_ recusadas);
    // na sessão sintética, a memória sobre as portas em memória da F1, da F3 e da F4 (autorizações pela senha, auditores).
    const contasOperadora =
      opcoes.contasOperadora ??
      (usarLegado && nucleoReal
        ? portaContasOperadoraLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaContasOperadoraLegado(nucleoReal, { sghSoLeitura: true })
          : autorizacaoOperadora instanceof PortaAutorizacaoOperadoraMemoria &&
              operadora.destino === 'memoria' &&
              redeOperadora.destino === 'memoria'
            ? new PortaContasOperadoraMemoria(operadora, redeOperadora, autorizacaoOperadora)
            : portaContasOperadoraIndisponivel());
    // M56 (etapa 7, F6): os envios à ANS, pela regra das contas (em dev sobre a cópia, as gravações SGH_ recusadas); na
    // sessão sintética, a memória sobre as portas em memória da F1 (beneficiários), da F2 (cobrança) e da F5 (contas).
    const ansOperadora =
      opcoes.ansOperadora ??
      (usarLegado && nucleoReal
        ? portaAnsOperadoraLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaAnsOperadoraLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env) && operadora.destino === 'memoria'
            ? new PortaAnsOperadoraMemoria(
                operadora,
                cobrancaOperadora instanceof PortaCobrancaOperadoraMemoria ? cobrancaOperadora : null,
                contasOperadora instanceof PortaContasOperadoraMemoria ? contasOperadora : null,
              )
            : portaAnsOperadoraIndisponivel());
    // M56 (etapa 8, F7): o atendimento com protocolo e as contas do portal, pela regra das contas (em dev sobre a cópia,
    // as gravações SGH_ recusadas); na sessão sintética, a memória sobre as portas em memória da F1, da F3 e da F4.
    const atendimentoOperadora =
      opcoes.atendimentoOperadora ??
      (usarLegado && nucleoReal
        ? portaAtendimentoOperadoraLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaAtendimentoOperadoraLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env) &&
              operadora.destino === 'memoria' &&
              redeOperadora.destino === 'memoria' &&
              autorizacaoOperadora.destino === 'memoria'
            ? new PortaAtendimentoOperadoraMemoria(operadora, redeOperadora, autorizacaoOperadora)
            : portaAtendimentoOperadoraIndisponivel());
    const armazemConteudo: ArmazemConteudo =
      opcoes.armazemConteudo ??
      (fontesSinteticas(env) && !fonteDevDaCopia(env)
        ? new ArmazemConteudoMemoria()
        : new ArmazemConteudoS3(
            new ClienteS3({
              endpoint: env['S3_ENDPOINT']?.trim() || 'http://127.0.0.1:9318',
              regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
              acesso: env['S3_SEGREDO']?.trim() ? env['S3_ACESSO']?.trim() : undefined,
              segredo: env['S3_SEGREDO']?.trim() || undefined,
            }),
          ));
    const integracao =
      opcoes.integracao ??
      (usarLegado && nucleoReal
        ? portaIntegracaoLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaIntegracaoLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env) && armazemConteudo instanceof ArmazemConteudoMemoria
            ? new PortaIntegracaoMemoria(armazemConteudo, trilha)
            : portaIntegracaoIndisponivel());
    const fachada =
      opcoes.fachada ??
      (usarLegado && nucleoReal
        ? portaFachadaLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaFachadaLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaFachadaMemoria()
            : portaFachadaIndisponivel());
    const filaEnvio = url ? new FilaEnvioPorValkey(url) : null;
    const gotenberg = env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';
    const geradorPdf = async (html: string, titulo: string) =>
      (await converterHtmlEmPdfA(gotenberg, html, { metadados: { Title: titulo } })).pdf;
    // M21: internação, leitos, higienização e SAME, pela mesma regra (a memória sobre o painel sintético do M16).
    // M44 (etapa 2): o NIR em memória compartilha o estado com a internação em memória (o leito reservado no mapa; a
    // admissão e a transferência vindas do NIR); o relógio do E2E avança pelo arquivo NIR_SINTETICO_POR_FORA.
    const estadoNir = new EstadoNirMemoria({ arquivoPorFora: env['NIR_SINTETICO_POR_FORA']?.trim() || null });
    const adt =
      opcoes.adt ??
      (usarLegado && nucleoReal
        ? portaAdtLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaAdtLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env) && internacao instanceof FonteInternacaoMemoria
            ? new PortaAdtMemoria(catalogoOps, {
                painel: internacao,
                lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids),
                nir: estadoNir,
              })
            : portaAdtIndisponivel());
    // M44 (etapa 2): o NIR, pela mesma regra (em dev sobre a cópia, as gravações SGH_ recusadas).
    const nir =
      opcoes.nir ??
      (usarLegado && nucleoReal
        ? portaNirLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaNirLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura(), { sghSoLeitura: true })
          : adt instanceof PortaAdtMemoria
            ? new PortaNirMemoria(estadoNir, adt, trilha, (c, ids) => cadastro.lerPacientes(c, ids))
            : portaNirIndisponivel());
    // M45 (etapa 5): a nutrição, o mapa de dietas e o serviço social, pela mesma regra (em dev sobre a cópia, as
    // gravações SGH_ recusadas e o executor só de leitura; na sessão sintética, a memória; sem núcleo fora de dev/ci, 503).
    const nutricao =
      opcoes.nutricao ??
      (usarLegado && nucleoReal
        ? portaNutricaoLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaNutricaoLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura(), {
              sghSoLeitura: true,
            })
          : fontesSinteticas(env)
            ? new PortaNutricaoMemoria()
            : portaNutricaoIndisponivel());
    // M50 (etapa 6): a agenda de sessões e a digitalização certificada, pela mesma regra (em dev sobre a cópia, as
    // gravações SGH_ recusadas; na sessão sintética, a memória com os pacientes do cadastro sintético; sem núcleo fora de
    // dev/ci, 503). O arquivo digitalizado vai ao S3 local com retenção; sem S3 na sessão sintética, à memória.
    const sessoes =
      opcoes.sessoes ??
      (usarLegado && nucleoReal
        ? portaSessoesLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaSessoesLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaSessoesMemoria((c, ids) => cadastro.lerPacientes(c, ids))
            : portaSessoesIndisponivel());
    const digitalizacao =
      opcoes.digitalizacao ??
      (usarLegado && nucleoReal
        ? portaDigitalizacaoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaDigitalizacaoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaDigitalizacaoMemoria(async (c, pront) => {
                const r = await cadastro.buscarDireto(c, { tipo: 'prontuario', prontuario: pront }, false);
                return r.pacientes[0] ?? null;
              })
            : portaDigitalizacaoIndisponivel());
    const armazemDigitalizacao =
      opcoes.armazemDigitalizacao ??
      (fontesSinteticas(env) && !env['S3_ENDPOINT']?.trim()
        ? new ArmazemDigitalizacaoMemoria()
        : criarArmazemDigitalizacao(configuracao.rede ?? null, env));
    // M25: enfermagem beira-leito, pela mesma regra (a memória com a UTI e a enfermaria sintéticas; a "gravação por
    // fora" do E2E — a suspensão na prescrição, a checagem em outro terminal — pelo arquivo ENFERMAGEM_SINTETICA_POR_FORA).
    const enfermagem =
      opcoes.enfermagem ??
      (usarLegado && nucleoReal
        ? portaEnfermagemLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaEnfermagemLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaEnfermagemMemoria(catalogoOps, {
                arquivoPorFora: env['ENFERMAGEM_SINTETICA_POR_FORA']?.trim() || null,
              })
            : portaEnfermagemIndisponivel());
    // M45 (etapa 3): balanço hídrico, pela mesma regra (em dev sobre a cópia, as gravações SGH_ recusadas; na sessão
    // sintética, a memória sobre a enfermagem em memória; sem núcleo fora de dev/ci, 503).
    const balanco =
      opcoes.balanco ??
      (usarLegado && nucleoReal
        ? portaBalancoLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaBalancoLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura(), { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaBalancoMemoria(enfermagem)
            : portaBalancoIndisponivel());
    // M50 (etapa 5): portaria e visitantes, pela mesma regra (em dev sobre a cópia, as gravações SGH_ recusadas; na sessão
    // sintética, a memória com internados sintéticos; sem núcleo fora de dev/ci, 503).
    const portaria =
      opcoes.portaria ??
      (usarLegado && nucleoReal
        ? portaPortariaLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaPortariaLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura(), {
              sghSoLeitura: true,
            })
          : fontesSinteticas(env)
            ? new PortaPortariaMemoria()
            : portaPortariaIndisponivel());
    // M45 (etapa 4): SAE, prescrição de enfermagem, receita do enfermeiro e vacina, pela mesma regra (só do novo: em dev
    // sobre a cópia, as gravações SGH_ recusadas; na sessão sintética, a memória sobre a enfermagem em memória; sem
    // núcleo fora de dev/ci, 503).
    const sae =
      opcoes.sae ??
      (usarLegado && nucleoReal
        ? portaSaeLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaSaeLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaSaeMemoria(enfermagem)
            : portaSaeIndisponivel());
    // M47 (etapa 1): agência transfusional, pela mesma regra (só do novo, salvo a checagem do horário pela enfermagem: em
    // dev sobre a cópia, as gravações SGH_ recusadas; na sessão sintética, a memória sobre a enfermagem em memória; sem
    // núcleo fora de dev/ci, 503).
    const transfusao =
      opcoes.transfusao ??
      (usarLegado && nucleoReal
        ? portaTransfusaoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaTransfusaoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaTransfusaoMemoria(enfermagem)
            : portaTransfusaoIndisponivel());
    // M48 (etapa 1): notificação de incidentes, só do novo, pela mesma regra (em dev sobre a cópia, as gravações SGH_
    // recusadas; na sessão sintética, a memória; sem núcleo fora de dev/ci, 503).
    const qualidade =
      opcoes.qualidade ??
      (usarLegado && nucleoReal
        ? portaQualidadeLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaQualidadeLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? PortaQualidadeMemoria.sintetica()
            : portaQualidadeIndisponivel());
    // M48.2 (correção da revisão): o resumo da sugestão resolvida é um HMAC com a chave derivada da chave mestra da
    // plataforma (fora do banco); na sessão sintética, aleatória; sem ela fora de dev/ci, as sugestões ficam desligadas
    // com o motivo (POL-3).
    const mestraSugestao =
      chaveMestra(env['PLATAFORMA_CHAVE_MESTRA']) ?? (fontesSinteticas(env) ? randomBytes(32) : null);
    const resumoSugestao = mestraSugestao ? new ResumoSugestao(mestraSugestao) : null;
    // M48 (etapa 3): CCIH, só do novo, pela mesma regra.
    const ccih =
      opcoes.ccih ??
      (usarLegado && nucleoReal
        ? portaCcihLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaCcihLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaCcihMemoria()
            : portaCcihIndisponivel());
    // M48 (etapa 4): notificação compulsória, só do novo, pela mesma regra.
    const agravo =
      opcoes.agravo ??
      (usarLegado && nucleoReal
        ? portaAgravoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaAgravoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaAgravoMemoria({
                // D-BUSCA-48.4: o caso sem sugestão com os pacientes do cadastro sintético.
                cadastro: async (c, ids) =>
                  (await cadastro.lerPacientes(c, ids)).map((p) => ({
                    id: p.id,
                    nome: p.nome,
                    prontuario: p.prontuario,
                    nascimento: p.nascimento,
                    sexo: p.sexo,
                    mae: p.mae,
                    cns: p.cns,
                  })),
              })
            : portaAgravoIndisponivel());
    // M48 (etapa 5): gestão da qualidade e envios regulatórios, só do novo, pela mesma regra.
    const gestaoQualidade =
      opcoes.gestao ??
      (usarLegado && nucleoReal
        ? portaGestaoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaGestaoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaGestaoMemoria()
            : portaGestaoIndisponivel());
    // W0-10 (M1): na sessão sintética, a manifestação do portal do paciente vai à ouvidoria interna em memória (a mesma
    // linha nas duas telas, como a SGH_QUA_OUVIDORIA na cópia).
    if (portalPaciente instanceof PortaPortalMemoria && gestaoQualidade instanceof PortaGestaoMemoria)
      portalPaciente.ouvidoriaInterna ??= gestaoQualidade.ouvidoriaDoPortal();
    // Revisão do W0-10 (M3): na sessão sintética, a área de privacidade vê e trata os pedidos abertos pelo portal (a
    // mesma SGH_AUD_PEDIDO_TITULAR na cópia); atendida a portabilidade, o portal oferece o pacote FHIR/IPS.
    if (portalPaciente instanceof PortaPortalMemoria)
      estadoM10Sintetico().pedidosDoPortal = portalPaciente.pedidosParaPrivacidade();
    // M47 (etapa 2): imuno-hematologia, prova cruzada e estoque de bolsas, pela mesma regra (na sessão sintética, a
    // memória sobre a agência da etapa 1 em memória).
    const agencia =
      opcoes.agencia ??
      (usarLegado && nucleoReal
        ? portaAgenciaLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaAgenciaLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaAgenciaMemoria(transfusao, (c) => enfermagem.relogio(c))
            : portaAgenciaIndisponivel());
    // M45 (etapa 2): escores, classificação de pacientes e índices de UTI, pela regra do construtor de formulários (só
    // do novo: em dev sobre a cópia, as gravações SGH_ recusadas; na sessão sintética, a memória; sem núcleo, 503).
    const escores =
      opcoes.escores ??
      (usarLegado && nucleoReal
        ? portaEscoresLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaEscoresLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaEscoresMemoria()
            : portaEscoresIndisponivel());
    // W0-03, M5: a vigia da contenção vencida (o aviso na central), só com o banco de verdade.
    const vigiaContencao =
      usarLegado && nucleoReal && env['ENFERMAGEM_VIGIA_CONTENCAO'] !== 'nao'
        ? new VigiaContencao(escores, enfermagem, real?.rede ?? configuracao.rede ?? '', codigosConfigurados)
        : null;
    // A vigia dos horários (regra 10): só com ouvinte; o intervalo do vigia de mudanças (1 a 2 s).
    const vigiaEnfermagem =
      opcoes.vigiaEnfermagem !== undefined
        ? opcoes.vigiaEnfermagem
        : env['ENFERMAGEM_VIGIA'] === 'nao'
          ? null
          : new VigiaHorarios(
              enfermagem,
              real?.rede ?? configuracao.rede ?? 'rede-sintetica',
              Math.min(2_000, Math.max(500, Number(env['VIGIA_MUDANCAS_MS'] ?? 1_500) || 1_500)),
            );
    // M28: estoque, almoxarifado e compras, pela mesma regra (a memória tem itens, saldos e pedidos sintéticos).
    const suprimentos =
      opcoes.suprimentos ??
      (usarLegado && nucleoReal
        ? portaSuprimentosLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaSuprimentosLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaSuprimentosMemoria(catalogoOps)
            : portaSuprimentosIndisponivel());
    // M46 (etapa 3): OPME, pela mesma regra (a memória tem itens da classe 50 sintéticos; o consumo é a saída simulada).
    const opme =
      opcoes.opme ??
      (usarLegado && nucleoReal
        ? portaOpmeLegado(nucleoReal, catalogoOps, { metricas })
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaOpmeLegado(nucleoReal, catalogoOps, {
              metricas,
              executor: executorSoLeitura(),
              sghSoLeitura: true,
            })
          : fontesSinteticas(env)
            ? new PortaOpmeMemoria()
            : portaOpmeIndisponivel());
    // M46 (etapa 4): consignados e manipulação, pela mesma regra (o consignado em memória lê os consumos do OPME em
    // memória; a manipulação em memória tem os itens validados, as capelas e a baixa simulada).
    const consignado =
      opcoes.consignado ??
      (usarLegado && nucleoReal
        ? portaConsignadoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaConsignadoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaConsignadoMemoria(opme instanceof PortaOpmeMemoria ? opme : null)
            : portaConsignadoIndisponivel());
    // M55 (etapa 3): contratos com fornecedores, pela mesma regra.
    const contrato =
      opcoes.contrato ??
      (usarLegado && nucleoReal
        ? portaContratoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaContratoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaContratoMemoria()
            : portaContratoIndisponivel());
    // M55 (etapa 4): licitação e pregão, pela mesma regra.
    const licitacao =
      opcoes.licitacao ??
      (usarLegado && nucleoReal
        ? portaLicitacaoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaLicitacaoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaLicitacaoMemoria()
            : portaLicitacaoIndisponivel());
    const manipulacao =
      opcoes.manipulacao ??
      (usarLegado && nucleoReal
        ? portaManipulacaoLegado(nucleoReal, catalogoOps, { metricas })
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaManipulacaoLegado(nucleoReal, catalogoOps, {
              metricas,
              executor: executorSoLeitura(),
              sghSoLeitura: true,
            })
          : fontesSinteticas(env)
            ? new PortaManipulacaoMemoria()
            : portaManipulacaoIndisponivel());
    // M55 (fatia F2): rouparia e lavanderia, pela mesma regra (a memória tem setores, a lavanderia e o enxoval sintéticos).
    const rouparia =
      opcoes.rouparia ??
      (usarLegado && nucleoReal
        ? portaRoupariaLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaRoupariaLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaRoupariaMemoria()
            : portaRoupariaIndisponivel());
    // M55 (etapa 1): manutenção e engenharia clínica, pela mesma regra (a memória tem setores, recursos de agenda, um
    // fornecedor, equipamentos, uma cobertura e planos sintéticos; na cópia de dev, as gravações SGH_ recusam).
    const manutencao =
      opcoes.manutencao ??
      (usarLegado && nucleoReal
        ? portaManutencaoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaManutencaoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaManutencaoMemoria()
            : portaManutencaoIndisponivel());
    // M55 (etapa 5): contratualização SUS, pela mesma regra (a memória tem os domínios, a SIGTAP e a produção sintéticos).
    const contratualizacao =
      opcoes.contratualizacao ??
      (usarLegado && nucleoReal
        ? portaContratualizacaoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaContratualizacaoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaContratualizacaoMemoria()
            : portaContratualizacaoIndisponivel());
    // M29: farmácia hospitalar e clínica, pela mesma regra (a memória tem a unidade, as doses e os controlados sintéticos).
    const farmacia =
      opcoes.farmacia ??
      (usarLegado && nucleoReal
        ? portaFarmaciaLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaFarmaciaLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaFarmaciaMemoria(catalogoOps)
            : portaFarmaciaIndisponivel());
    // M30: conta do paciente, pela mesma regra (a memória tem contas, itens e fichas sintéticas).
    const faturamento =
      opcoes.faturamento ??
      (usarLegado && nucleoReal
        ? portaFaturamentoLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaFaturamentoLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaFaturamentoMemoria(catalogoOps)
            : portaFaturamentoIndisponivel());
    // M31: o pós-fechamento pela mesma regra (a memória tem contas, lotes e itens sintéticos). O XML TISS vai ao S3 com
    // Object Lock (a memória na sessão sintética) e o montador do lote (gerador 04.03.00 + XSD + guarda) é o do
    // adaptador: a receita faturamento.gerarLote o chama dentro da transação, antes de gravar.
    const tissMemoria =
      !opcoes.tiss &&
      !(usarLegado && nucleoReal) &&
      !(fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env))
        ? fontesSinteticas(env)
          ? new PortaTissMemoria(catalogoOps)
          : null
        : null;
    // M42: o acompanhamento da competência na sessão sintética conta as contas fechadas pela porta do M30.
    if (tissMemoria && faturamento instanceof PortaFaturamentoMemoria)
      tissMemoria.fonteContas = {
        linhas: (h, a, m) => faturamento.linhasDaCompetencia(h, a, m),
        gravacoes: (h) => faturamento.gravacoesAqui(h),
      };
    const tiss =
      opcoes.tiss ??
      (usarLegado && nucleoReal
        ? portaTissLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaTissLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : (tissMemoria ?? portaTissIndisponivel()));
    const armazemXmlTiss: ArmazemXmlTiss =
      opcoes.armazemXmlTiss ??
      tissMemoria?.armazem ??
      armazemXmlS3(
        new ClienteS3({
          endpoint: env['S3_ENDPOINT']?.trim() || 'http://127.0.0.1:9318',
          regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
          acesso: env['S3_SEGREDO']?.trim() ? env['S3_ACESSO']?.trim() : undefined,
          segredo: env['S3_SEGREDO']?.trim() || undefined,
        }),
        env['S3_BUCKET_TISS']?.trim() || `sgh-${configuracao.rede ?? 'rede'}-tiss`,
        (env['AMBIENTE'] ?? 'dev').trim() || 'dev',
      );
    definirMontadorLoteTiss(criarMontadorLote(armazemXmlTiss.guardar));
    // M32: o financeiro e fiscal pela mesma regra (a memória tem títulos, contas bancárias e contas sintéticas). Os
    // arquivos (extrato, remessa, NFS-e, declarações, lote contábil) vão ao S3 com Object Lock (a memória na sintética).
    const financeiroMemoria =
      !opcoes.financeiro &&
      !(usarLegado && nucleoReal) &&
      !(fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)) &&
      fontesSinteticas(env);
    const financeiro =
      opcoes.financeiro ??
      (usarLegado && nucleoReal
        ? portaFinanceiroLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaFinanceiroLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : financeiroMemoria
            ? new PortaFinanceiroMemoria(catalogoOps)
            : portaFinanceiroIndisponivel());
    const armazemFinanceiro: ArmazemFinanceiro =
      opcoes.armazemFinanceiro ??
      (financeiroMemoria
        ? armazemFinanceiroMemoria()
        : armazemFinanceiroS3(
            new ClienteS3({
              endpoint: env['S3_ENDPOINT']?.trim() || 'http://127.0.0.1:9318',
              regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
              acesso: env['S3_SEGREDO']?.trim() ? env['S3_ACESSO']?.trim() : undefined,
              segredo: env['S3_SEGREDO']?.trim() || undefined,
            }),
            env['S3_BUCKET_FINANCEIRO']?.trim() || `sgh-${configuracao.rede ?? 'rede'}-financeiro`,
            (env['AMBIENTE'] ?? 'dev').trim() || 'dev',
          ));
    // M33: o repasse pela mesma regra; em memória, o título do RPA vai ao financeiro em memória (o contas a pagar o mostra).
    const repasse =
      opcoes.repasse ??
      (usarLegado && nucleoReal
        ? portaRepasseLegado(nucleoReal, catalogoOps, metricas)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaRepasseLegado(nucleoReal, catalogoOps, metricas, executorSoLeitura())
          : fontesSinteticas(env)
            ? new PortaRepasseMemoria(
                catalogoOps,
                financeiro instanceof PortaFinanceiroMemoria ? financeiro : null,
              )
            : portaRepasseIndisponivel());
    // M52.1: a gestão de pessoas (colaboradores, F1): o núcleo fora de dev/ci (gravação SGH_ e o bloqueio pelo executor);
    // em dev sobre a cópia, as leituras da cópia com a gravação SGH_ recusada e o executor só de leitura; na sessão
    // sintética, a memória (o bloqueio vale no login sintético); sem núcleo fora de dev/ci, 503. A chave do CPF vem do
    // cofre (PESSOAS_CHAVE_CPF ou a chave mestra da plataforma); na sessão sintética, aleatória; sem ela, a admissão
    // fica desligada com o motivo (POL-3).
    const pessoas =
      opcoes.pessoas ??
      (usarLegado && nucleoReal
        ? portaPessoasLegado(nucleoReal, nucleoReal.criarExecutor({ catalogo: catalogoOps, metricas }))
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaPessoasLegado(nucleoReal, executorSoLeitura(), { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaPessoasMemoria(catalogoOps)
            : portaPessoasIndisponivel());
    // M52.2: a escala de plantão, pela mesma regra da gestão de pessoas. A Rede da regra 7, como o MPI do M57: no núcleo, só
    // os bancos do HS-1 (o do catálogo); por pedido, só os com a escala liberada no estabelecimento inteiro (D-ESCALA-REDE-52).
    const escala =
      opcoes.escala ??
      (usarLegado && nucleoReal
        ? portaEscalaLegado(nucleoReal, { liberados: new Set([CATALOGO_LEGADO_ORIGEM.estabelecimento]) })
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaEscalaLegado(nucleoReal, {
              sghSoLeitura: true,
              liberados: new Set([CATALOGO_LEGADO_ORIGEM.estabelecimento]),
            })
          : fontesSinteticas(env)
            ? new PortaEscalaMemoria(pessoas instanceof PortaPessoasMemoria ? pessoas : null)
            : portaEscalaIndisponivel());
    // M52.5: o SESMT, pela mesma regra da gestão de pessoas (só SGH_; nenhuma operação do executor).
    const sesmt =
      opcoes.sesmt ??
      (usarLegado && nucleoReal
        ? portaSesmtLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaSesmtLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaSesmtMemoria(pessoas)
            : portaSesmtIndisponivel());
    // W0-06, parte 4: cargos e salários, pela mesma regra do SESMT (só SGH_; nenhuma operação do executor).
    const cargos =
      opcoes.cargos ??
      (usarLegado && nucleoReal
        ? portaCargosLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaCargosLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaCargosMemoria()
            : portaCargosIndisponivel());
    // W0-06 (5d-3a): em memória, a ficha do colaborador liga o cargo do quadro pela porta de cargos em memória.
    if (pessoas instanceof PortaPessoasMemoria && cargos instanceof PortaCargosMemoria)
      pessoas.quadroDeCargos = (hospital, id) => cargos.cargo({ rede: '', hospital }, id);
    // W0-06, parte 5: avaliação de desempenho, competências e PDI, pela mesma regra (só SGH_; sem executor).
    const avaliacao =
      opcoes.avaliacao ??
      (usarLegado && nucleoReal
        ? portaAvaliacaoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaAvaliacaoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaAvaliacaoMemoria(pessoas)
            : portaAvaliacaoIndisponivel());
    // M53-F1: as rubricas e tabelas legais da folha (só leitura; a gravação é a do CRUD genérico, pelo executor).
    const rubricas =
      opcoes.rubricas ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaRubricasLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaRubricasMemoria()
          : portaRubricasIndisponivel());
    // M52.4: o ponto, pela mesma regra da gestão de pessoas (só SGH_; nenhuma operação do executor).
    const ponto =
      opcoes.ponto ??
      (usarLegado && nucleoReal
        ? portaPontoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaPontoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaPontoMemoria(pessoas instanceof PortaPessoasMemoria ? pessoas : null)
            : portaPontoIndisponivel());
    // M52.6: os treinamentos (só SGH_) e o plantão realizado (SGH_ e o lançamento no repasse pelo executor do M04).
    const treinamento =
      opcoes.treinamento ??
      (usarLegado && nucleoReal
        ? portaTreinamentoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaTreinamentoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaTreinamentoMemoria(pessoas)
            : portaTreinamentoIndisponivel());
    // W0-06 (5d-3-3): em memória, o PDI da avaliação lê os cursos e as conclusões dos treinamentos em memória.
    if (avaliacao instanceof PortaAvaliacaoMemoria && treinamento instanceof PortaTreinamentoMemoria)
      avaliacao.treinamento = treinamento;
    const realizado =
      opcoes.realizado ??
      (usarLegado && nucleoReal
        ? portaRealizadoLegado(nucleoReal, nucleoReal.criarExecutor({ catalogo: catalogoOps, metricas }))
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaRealizadoLegado(nucleoReal, executorSoLeitura(), { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaRealizadoMemoria(escala, pessoas)
            : portaRealizadoIndisponivel());
    // M53.1: a interface com a folha externa, pela regra do ponto (só SGH_; nenhuma operação do executor).
    const folha =
      opcoes.folha ??
      (usarLegado && nucleoReal
        ? portaFolhaLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaFolhaLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaFolhaMemoria(pessoas)
            : portaFolhaIndisponivel());
    // M53.3: o cálculo mensal da folha, pela mesma regra (só SGH_; nenhuma operação do executor).
    const calculoFolha =
      opcoes.calculoFolha ??
      (usarLegado && nucleoReal
        ? portaCalculoFolhaLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaCalculoFolhaLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaCalculoFolhaMemoria(pessoas)
            : portaCalculoFolhaIndisponivel());
    // W0-06, parte 6: as solicitações do autoatendimento, pela mesma regra (só SGH_; sem executor). Em memória, sobre as
    // portas em memória do ponto, do cálculo da folha e do colaborador (o efeito da aprovação é tudo ou nada).
    const autoatendimento =
      opcoes.autoatendimento ??
      (usarLegado && nucleoReal
        ? portaAutoatendimentoLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaAutoatendimentoLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env) &&
              ponto instanceof PortaPontoMemoria &&
              calculoFolha instanceof PortaCalculoFolhaMemoria &&
              pessoas instanceof PortaPessoasMemoria
            ? new PortaAutoatendimentoMemoria(ponto, calculoFolha, pessoas)
            : portaAutoatendimentoIndisponivel());
    // W0-06, parte 7: o painel de indicadores de pessoas (só leitura: transações READ ONLY, nada gravado), pela mesma
    // regra das outras portas; a cópia de dev também lê pelo banco.
    const indicadoresPessoas =
      opcoes.indicadoresPessoas ??
      (usarLegado && nucleoReal
        ? portaIndicadoresPessoasLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaIndicadoresPessoasLegado(nucleoReal)
          : fontesSinteticas(env)
            ? // Parte 7d: a sessão sintética mostra a base de teste conferida à mão (o E2E confere os números).
              new PortaIndicadoresPessoasMemoria(SEMENTE_INDICADORES_PESSOAS)
            : portaIndicadoresPessoasIndisponivel());
    // M53.9: a integração da folha (os títulos pelo executor: financeiro.criarTituloPagar, ação incluir-folha).
    const integracaoFolha =
      opcoes.integracaoFolha ??
      (usarLegado && nucleoReal
        ? portaIntegracaoFolhaLegado(
            nucleoReal,
            nucleoReal.criarExecutor({ catalogo: catalogoOps, metricas }),
          )
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaIntegracaoFolhaLegado(nucleoReal, executorSoLeitura(), { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaIntegracaoFolhaMemoria(folha instanceof PortaFolhaMemoria ? folha : null)
            : portaIntegracaoFolhaIndisponivel());
    const esocial =
      opcoes.esocial ??
      (usarLegado && nucleoReal
        ? portaEsocialLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaEsocialLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env)
            ? new PortaEsocialMemoria()
            : portaEsocialIndisponivel());
    // M53.6: o transmissor real só com AMBIENTE=producao, ESOCIAL_MODO=producao e o certificado conferido (POL-3).
    const transmissorEsocial = opcoes.transmissorEsocial ?? transmissorEsocialDoAmbiente(env);
    const chaveCpf = chaveCpfDoAmbiente(env) ?? (fontesSinteticas(env) ? randomBytes(32) : null);
    const cifraCpf =
      opcoes.cifraCpf !== undefined ? opcoes.cifraCpf : chaveCpf ? new CifraCpf(chaveCpf) : null;
    // M50 (etapa 3): o portal do médico externo (o vínculo da conta do portal do M26 com o corpo clínico, só SGH_), pela
    // regra do portal do paciente; a agenda e o pedido pela porta do M18 e o extrato pelo serviço do M33.
    const portalMedico =
      opcoes.portalMedico ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaPortalMedicoLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaPortalMedicoMemoria(
              async (c, a) => (await sadt.acessoPorId(c, a))?.situacao ?? null,
              undefined,
              (c, a, x) =>
                sadt instanceof PortaSadtMemoria ? sadt.definirSituacaoAcesso(c, a, x) : undefined,
              (c, a, x) =>
                sadt instanceof PortaSadtMemoria ? sadt.definirCredencialAcesso(c, a, x) : undefined,
            )
          : portaPortalMedicoIndisponivel());
    // M57 (etapa 1): o MPI da Rede, só SGH_REDE_* (o cadastro de cada estabelecimento é só lido). Com o núcleo, cada
    // banco configurado (HS-1: só o do catálogo, onde os scripts 0570 a 0574 estão aplicados); na sessão sintética, em
    // memória, com o estabelecimento sintético da rede de REDE_SINTETICA_SEGUNDO (dev/ci) para haver dois bancos.
    const redeMpi: PortaRede =
      opcoes.rede ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaRedeLegado(nucleoReal, new Set([CATALOGO_LEGADO_ORIGEM.estabelecimento]))
        : fontesSinteticas(env)
          ? new PortaRedeMemoria({
              rede: real?.rede ?? configuracao.rede ?? 'rede-sintetica',
              estabelecimentos: estabelecimentosSinteticosRede(
                codigosConfigurados.map((codigo) => ({
                  codigo,
                  nome: env[`FB_${codigo.toUpperCase()}_NOME`]?.trim() || codigo,
                })),
                env['REDE_SINTETICA_SEGUNDO'],
              ),
            })
          : portaRedeIndisponivel());
    // M57 (etapa 3): o registro dos serviços compartilhados, só SGH_REDE_SERVICO_COMPART (cada registro no banco do
    // estabelecimento em que foi feito), pela regra do MPI: o núcleo (HS-1: os bancos com os scripts 0570 a 0575); na
    // sessão sintética, em memória.
    const servicosRede: PortaServicosRede =
      opcoes.servicosRede ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaServicosRedeLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaServicosRedeMemoria()
          : portaServicosRedeIndisponivel());
    // M54 (etapa 4): a estrutura de custos e as estatísticas, só SGH_CUS_* (script 0546) e as fontes READ ONLY, pela
    // regra dos serviços compartilhados: o núcleo; na sessão sintética, em memória.
    const custos: PortaCustos =
      opcoes.custos ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaCustosLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaCustosMemoria()
          : portaCustosIndisponivel());
    // M54 (etapa 7): o orçamento empresarial, só SGH_ORC_* (script 0549) e o realizado READ ONLY, pela mesma regra.
    const orcamento: PortaOrcamento =
      opcoes.orcamento ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaOrcamentoLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaOrcamentoMemoria()
          : portaOrcamentoIndisponivel());
    // M54 (etapa 6): o patrimônio (bens, movimentos, depreciação e inventário), só SGH_PAT_* (script 0548) e as leituras
    // READ ONLY da nota fiscal de entrada e dos domínios; na sessão sintética, em memória.
    const patrimonio: PortaPatrimonio =
      opcoes.patrimonio ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaPatrimonioLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaPatrimonioMemoria()
          : portaPatrimonioIndisponivel());
    // W0-08 (achado 6): o PDF do laudo do ajuste vai ao S3 do ambiente com Object Lock (como os arquivos do financeiro);
    // com a porta em memória (sessão sintética e testes), em memória.
    const armazemLaudoPatrimonio: ArmazemLaudoPatrimonio =
      opcoes.armazemLaudoPatrimonio ??
      (patrimonio.destino !== 'legado'
        ? new ArmazemLaudoMemoria()
        : armazemLaudoS3(
            new ClienteS3({
              endpoint: env['S3_ENDPOINT']?.trim() || 'http://127.0.0.1:9318',
              regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
              acesso: env['S3_SEGREDO']?.trim() ? env['S3_ACESSO']?.trim() : undefined,
              segredo: env['S3_SEGREDO']?.trim() || undefined,
            }),
            env['S3_BUCKET_PATRIMONIO']?.trim() || `sgh-${configuracao.rede ?? 'rede'}-patrimonio`,
            (env['AMBIENTE'] ?? 'dev').trim() || 'dev',
          ));
    // M51 (etapa 1): o faturamento SUS próprio (CIHA), só SGH_FAT_SUS_* (scripts 0510 a 0514) e leituras READ ONLY;
    // na sessão sintética, em memória. O arquivo exportado vai ao S3 com Object Lock (tem dado pessoal), como o TISS.
    const susMemoria = fontesSinteticas(env) ? new PortaSusMemoria() : null;
    const sus: PortaSus =
      opcoes.sus ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaSusLegado(nucleoReal)
        : (susMemoria ?? portaSusIndisponivel()));
    const armazemArquivoSus: ArmazemArquivoSus =
      opcoes.armazemArquivoSus ??
      (sus.destino === 'memoria' || sus.destino === 'indisponivel'
        ? armazemSusMemoria()
        : armazemSusS3(
            new ClienteS3({
              endpoint: env['S3_ENDPOINT']?.trim() || 'http://127.0.0.1:9318',
              regiao: env['S3_REGIAO']?.trim() || 'us-east-1',
              acesso: env['S3_SEGREDO']?.trim() ? env['S3_ACESSO']?.trim() : undefined,
              segredo: env['S3_SEGREDO']?.trim() || undefined,
            }),
            env['S3_BUCKET_SUS']?.trim() || `sgh-${configuracao.rede ?? 'rede'}-sus`,
            (env['AMBIENTE'] ?? 'dev').trim() || 'dev',
          ));
    // M49 (etapa 1): assinatura ICP-Brasil, só SGH_ (nenhuma tabela do legado). Na cópia de dev, as tabelas SGH_ do
    // marco na cópia (sgh:aplicar nas duas); na sessão sintética, em memória. O modo (simulador, produção ou
    // desligado) e o cofre vêm do ambiente (configAssinaturaDoAmbiente: o simulador nunca fora de dev/ci).
    const assinaturaIcp =
      opcoes.assinaturaIcp ??
      (nucleoReal && (usarLegado || (fontesSinteticas(env) && fonteDevDaCopia(env)))
        ? portaAssinaturaLegado(nucleoReal)
        : fontesSinteticas(env)
          ? new PortaAssinaturaMemoria(
              // Etapa 2: a fila do autor e o evento "assinado" nos documentos da mesma sessão sintética (M23).
              documentos instanceof PortaDocumentosMemoria
                ? {
                    todos: (h) => documentos.documentosParaIcp(h),
                    marcarAssinadoIcp: (h, d) => documentos.marcarAssinadoIcp(h, d),
                  }
                : null,
            )
          : portaAssinaturaIndisponivel());
    // M49 (etapa 2): o serviço de emissão (PDF/A da prévia e o PDF assinado) e o prontuário (o conteúdo do documento).
    // SBIS-42: o rodapé "Sistema certificado SBIS nº" sai só com a auditoria formal apta registrada no estabelecimento.
    const fonteDocumento = criarFonteDocumento(configuracao, env, {
      certificadoSbis: async (h) => certificadoVigente(await portaSbis.ciclos(h)),
    });
    const servicoDocumentos = new ServicoDocumentos(documentos);
    // Cache no armazém compartilhado (Valkey) só quando os dados são do banco: com a fonte em memória da sessão
    // sintética, um cache que sobrevive ao processo mostraria dados de um processo anterior.
    const cacheConfig = new CacheConfig(
      (usarLegado || opcoes.configuracao) && opcoes.armazem ? opcoes.armazem : new ArmazemMemoria(),
    );
    // M47 (etapa 3): a lista de trabalho DICOM, pela regra da rede (em dev sobre a cópia, as gravações SGH_ recusadas); na
    // sessão sintética, a memória sobre a porta em memória do SADT, com o simulador de modalidade no lugar do PACS.
    const pacs =
      opcoes.pacs ??
      (usarLegado && nucleoReal
        ? portaPacsLegado(nucleoReal)
        : fontesSinteticas(env) && nucleoReal && fonteDevDaCopia(env)
          ? portaPacsLegado(nucleoReal, { sghSoLeitura: true })
          : fontesSinteticas(env) && sadt.destino === 'memoria'
            ? new PortaPacsMemoria(sadt)
            : portaPacsIndisponivel());
    const servicoPacs = new ServicoPacs(pacs, trilha, fonteConfig, cacheConfig, env);
    servicoPortal.imagens = (c, exame) => servicoPacs.imagemDoLaudo(c, exame);
    return {
      module: AppModule,
      controllers: [
        SistemaController,
        AcessoController,
        CoexistenciaController,
        AssinaturasController,
        ProntidaoController,
        HomologacaoController,
        Onda0Controller,
        DocumentoController,
        CargaController,
        GravacaoController,
        ConsultaAcessoController,
        GestaoAcessoController,
        ContasDormentesController,
        PinGestaoController,
        ConselhoGestaoController,
        UsuarioModeloController,
        RecertificacaoController,
        RhAcessoController,
        PedidosAcessoController,
        PedidosAcessoGestaoController,
        IdentidadeController,
        SaneamentoController,
        EmergenciaController,
        DominiosController,
        ParametrosController,
        LiberacaoController,
        PlataformaController,
        PacientesController,
        ProfissionaisController,
        ConveniosController,
        PrecosController,
        ImportacoesController,
        MotorController,
        UsuariosController,
        RedeCpfController,
        PermissoesController,
        EstruturaController,
        AuditoriaController,
        CatalogosController,
        ProntuarioController,
        AcessosProntuarioController,
        ConsultasController,
        MatrizController,
        RegistroClinicoController,
        FormularioNovoController,
        EspecialidadesController,
        PrescricaoController,
        LeitosController,
        RelatorioController,
        AgendasController,
        MarcacoesController,
        ApoioAgendaController,
        AcessoRedePepController,
        DocumentosPepController,
        RecepcaoController,
        GestaoRecepcaoController,
        TermosRecepcaoController,
        DispositivoController,
        ExamesController,
        CirurgiaController,
        AnestesiaController,
        BlocoSeguroController,
        AtendimentoController,
        PaController,
        ClassificacaoController,
        ProtocoloGerenciadoController,
        SadtController,
        PortalController,
        PacsController,
        PortalPacienteController,
        PortalPacienteInternoController,
        PortalMedicoController,
        PortalMedicoInternoController,
        PortalAgendaController,
        PortalAgendaInternoController,
        TelemedicinaController,
        PortalTeleconsultaController,
        ComunicacaoController,
        WorklistMedicoController,
        WorklistRecepcaoController,
        InternacaoController,
        MapaLeitosController,
        NirController,
        RegulacaoController,
        NutricaoController,
        SessoesController,
        DigitalizacaoController,
        EnfermagemController,
        BalancoController,
        PortariaController,
        SaeController,
        PrescricaoEnfermeiroController,
        VacinaController,
        TransfusaoController,
        AgenciaController,
        NotificacaoController,
        SegurancaPacienteController,
        CcihController,
        AgravoController,
        GestaoQualidadeController,
        RevisaoProntuarioController,
        EscoresController,
        ClassificacaoPacientesController,
        IndicesUtiController,
        ContencaoController,
        TrrController,
        ProtocoloInternadoController,
        LesaoController,
        HigienizacaoController,
        SameController,
        CatalogoRelatoriosController,
        MigracaoController,
        FimCoexistenciaController,
        DesligamentoController,
        RetrocompatibilidadeController,
        ContasBancoController,
        SegredosController,
        SbisController,
        ConferenciaInstalacaoController,
        FumacaServidorController,
        OperadoraController,
        RedeOperadoraController,
        ContabilController,
        LancamentosContabilController,
        DemonstracoesContabilController,
        BeneficiariosOperadoraController,
        CobrancaOperadoraController,
        AutorizacaoOperadoraController,
        ContasOperadoraController,
        AnsOperadoraController,
        AtendimentoOperadoraController,
        PortalPrestadorController,
        IntegracaoController,
        FachadaController,
        SuprimentosController,
        OpmeController,
        ConsignadoController,
        ContratoController,
        LicitacaoController,
        ManipulacaoController,
        RoupariaController,
        ManutencaoController,
        ContratualizacaoController,
        FarmaciaController,
        FaturamentoController,
        TissController,
        FinanceiroController,
        RepasseController,
        PessoasController,
        EscalaController,
        SesmtController,
        CargosController,
        AvaliacaoController,
        RubricasController,
        PlantaoController,
        PontoController,
        TreinamentoController,
        MeuEspacoController,
        MeuHoleriteController,
        RealizadoController,
        FolhaController,
        CalculoFolhaController,
        // M53.4 (F3): férias e 13º; as férias do próprio colaborador.
        FeriasFolhaController,
        MinhasFeriasController,
        // W0-06 (6b-3): as solicitações do autoatendimento e a fila do gestor.
        MinhasSolicitacoesController,
        FilaSolicitacoesController,
        // W0-06 (7b): o painel de indicadores de pessoas.
        IndicadoresPessoasController,
        // M53.5 (F4): rescisão.
        RescisaoFolhaController,
        // M53.6 (F5): eSocial de tabela e não periódicos.
        EsocialController,
        // M53.7 (F6): fechamento do período da folha (os periódicos ficam no EsocialController).
        FechamentoFolhaController,
        // M53.8 (F7): FGTS Digital e obrigações legais.
        ObrigacoesController,
        IntegracaoFolhaController,
        RedeMpiController,
        // M57 (etapa 3): o BI consolidado da Rede e os serviços compartilhados.
        BiRedeController,
        ServicosRedeController,
        CustosController,
        OrcamentoController,
        ApuracaoCustosController,
        PatrimonioController,
        // M51 (etapa 1): competência SUS, crítica prévia e CIHA.
        SusController,
        // M51 (etapa 4): AIH, leitos de UTI, espelho e retorno do gestor.
        SusAihController,
        AssinaturaIcpController,
        AssinaturaDocumentosController,
        VerificadorController,
      ],
      providers: [
        { provide: CONFIGURACAO, useValue: configuracao },
        { provide: FONTE_COEXISTENCIA, useValue: fonte },
        { provide: SERVICO_SESSAO, useValue: servico },
        // M09: rotas da linha de base de carga (dev) leem pelo mesmo núcleo, quando ele implementa a leitura.
        {
          provide: FONTE_CARGA,
          useValue: fonte && 'lerSomente' in fonte ? (fonte as unknown as FonteCarga) : null,
        },
        { provide: SESSAO_SINTETICA, useValue: sintetica },
        // W1-01 (parte 7): "Esqueci a senha". Dev/ci sintético: o envio fica em memória (nada sai da VM); com o banco,
        // o servidor de envio ao e-mail institucional é dependência do dono (sem ele, o botão não aparece).
        {
          provide: SERVICO_RECUPERACAO_SENHA,
          useValue: servico
            ? new ServicoRecuperacaoSenha(
                servico,
                armazemSessoes,
                fonteConfig,
                suporteSintetico ? envioRecuperacaoMemoria() : null,
                trilha,
                aviso,
              )
            : null,
        },
        // M06: autorização (guarda global com as regras CASL), @Auditar e a trilha dupla.
        { provide: RESOLVEDOR_SESSAO, useValue: resolvedorSessao },
        { provide: REGISTRADOR_TRILHA, useValue: trilha },
        { provide: APP_GUARD, useClass: GuardaPermissao },
        // M38 (regra 3 e seção 12): a leitura sob chave de tela da onda 0, depois da permissão.
        { provide: APP_GUARD, useClass: GuardaChaveDeTela },
        // ADR 0021: o "como" envolve a auditoria (a trilha gravada no @Auditar também leva o ator real).
        { provide: AUDITORIA_COMO, useValue: servicoComo },
        { provide: APP_INTERCEPTOR, useClass: InterceptadorComo },
        { provide: APP_INTERCEPTOR, useClass: InterceptadorAuditoria },
        { provide: SERVICO_PLATAFORMA, useValue: servicoPlataforma },
        { provide: SERVICO_COMO, useValue: servicoComo },
        { provide: ALERTA_AUDITOR, useValue: alerta },
        { provide: REGISTRO_EMERGENCIA, useValue: registroEmergencia },
        // Vínculo assistencial: massa sintética até o M15/M21 (ninguém tem vínculo com o paciente sintético).
        { provide: VINCULO_ASSISTENCIAL, useValue: new VinculoSintetico() },
        {
          provide: NUCLEO_ACESSO,
          useValue: fonte && 'lerSomente' in fonte ? (fonte as unknown as FonteCarga) : null,
        },
        { provide: FONTE_ASSINATURAS, useValue: fonteAssinaturas },
        { provide: FONTE_PRONTIDAO, useValue: fonteProntidao },
        { provide: FONTE_HOMOLOGACAO, useValue: fonteHomologacao },
        { provide: PORTA_ONDA0, useValue: onda0 },
        // M04: conferência de gravação e saúde das conexões; contagens do executor deste processo.
        { provide: METRICAS_EXECUTOR, useValue: metricas },
        { provide: FONTE_GRAVACAO, useValue: fonteGravacao },
        { provide: RESOLVEDOR_REDE, useValue: resolvedorRede },
        // M09: spike de documentos e etiquetas (S3, Gotenberg, Valkey e chave do QZ Tray do ambiente).
        { provide: FONTE_DOCUMENTO, useValue: fonteDocumento },
        // M08: CRUD genérico, parâmetros e funcionalidades por estabelecimento.
        { provide: FONTE_DOMINIOS, useValue: dominios },
        { provide: VIGIA_RECONCILIACAO, useValue: vigiaCrud },
        { provide: FONTE_GESTAO, useValue: gestao },
        { provide: SERVICO_CONTAS_DORMENTES, useValue: contasDormentes },
        { provide: SERVICO_TROCA_RAPIDA, useValue: trocaRapida },
        { provide: DESPERTAR_CONTAS_DORMENTES, useValue: despertarDormentes },
        { provide: SERVICO_IDENTIDADE, useValue: identidade },
        { provide: SERVICO_SANEAMENTO, useValue: saneamento },
        {
          provide: EXECUTOR_IDENTIDADE,
          useValue: {
            receita: (n: string, h: string) => gestao.receita(n, h),
            executar: (n: string, h: string, e: unknown, c: ContextoOperacao) => gestao.executar(n, h, e, c),
          },
        },
        { provide: FONTE_CONFIGURACAO, useValue: fonteConfig },
        { provide: CACHE_CONFIG, useValue: cacheConfig },
        { provide: CAMINHO_CATALOGO_LIBERACAO, useValue: caminhoCatalogo },
        // M40: o critério do setor da onda 2 ao ligar pela tela de chaves (o avaliador vem da coexistência).
        { provide: CRITERIO_LIGAR_SETOR, useValue: criterioLigarSetor() },
        // M11: pacientes, profissionais, solicitantes, pessoas e especialidades.
        { provide: PORTA_CADASTRO, useValue: cadastro },
        // M12: convênios, contratos, tabelas de preço e motor de preços.
        { provide: FONTE_PRECOS, useValue: precos },
        { provide: SERVICO_PRECOS, useValue: new ServicoPrecos(precos, cacheConfig) },
        // M10: acesso, organização e auditoria (telas).
        { provide: FONTE_ADMINISTRACAO, useValue: administracao },
        // M13: catálogos oficiais e importadores.
        { provide: FONTE_CATALOGOS, useValue: catalogos },
        { provide: SERVICO_CATALOGOS, useValue: servicoCatalogos },
        // M15: prontuário ao vivo (consulta) e registro de acesso ao prontuário.
        { provide: PORTA_PRONTUARIO, useValue: prontuario },
        { provide: SERVICO_PRONTUARIO, useValue: new ServicoProntuario(prontuario, cadastro) },
        { provide: ESTADO_PRONTUARIO, useValue: new EstadoProntuario() },
        // M14: consultas somente leitura de todas as tabelas do marco.
        { provide: FONTE_CONSULTAS, useValue: consultas },
        // M22: registros clínicos nos modelos do formulário.
        { provide: PORTA_REGISTRO, useValue: registro },
        { provide: PORTA_FORMULARIO_NOVO, useValue: formularioNovo },
        // M45 (etapa 6): as especialidades sob demanda e o lactário.
        { provide: PORTA_ESPECIALIDADES, useValue: especialidades },
        { provide: SERVICO_REGISTRO, useValue: new ServicoRegistro(registro) },
        // M24: prescrição eletrônica (CPOE), farmácia clínica e horários-padrão.
        { provide: PORTA_PRESCRICAO, useValue: prescricao },
        { provide: SERVICO_PRESCRICAO, useValue: new ServicoPrescricao(prescricao) },
        // M16: painel de leitos ao vivo, censo, painéis gerenciais, indicadores, BI e o vigia de mudanças.
        { provide: FONTE_INTERNACAO, useValue: internacao },
        { provide: MOTOR_VIGIA, useValue: vigia },
        { provide: BATIDA_EVENTOS_MS, useValue: opcoes.batidaEventosMs ?? BATIDA_EVENTOS_PADRAO_MS },
        {
          provide: SERVICO_INTERNACAO,
          // Painéis da cópia diária no armazém compartilhado (Valkey) só com dados do banco (como o cache da
          // configuração): a fonte em memória da sessão sintética é deste processo.
          useValue: new ServicoInternacao(
            internacao,
            vigia,
            undefined,
            internacao.destino === 'legado' && opcoes.armazem && !(opcoes.armazem instanceof ArmazemMemoria)
              ? opcoes.armazem
              : null,
          ),
        },
        { provide: CONFIGURACAO_M16, useValue: new ConfiguracaoM16(fonteConfig, cacheConfig) },
        // M17: agenda de consultas.
        { provide: PORTA_AGENDA, useValue: agenda },
        // M23: prontuário de uso diário.
        { provide: PORTA_DOCUMENTOS, useValue: documentos },
        { provide: SERVICO_DOCUMENTOS, useValue: servicoDocumentos },
        // M19: recepção (a central de chamadas dos painéis assina o canal "senhas" do vigia).
        { provide: PORTA_RECEPCAO, useValue: recepcao },
        {
          provide: CENTRAL_CHAMADAS,
          useValue: new CentralChamadas(recepcao, real?.rede ?? configuracao.rede ?? '', vigia),
        },
        { provide: REDE_RECEPCAO, useValue: real?.rede ?? configuracao.rede ?? '' },
        // M18: agenda de exames e centro cirúrgico.
        { provide: PORTA_EXAME, useValue: exame },
        { provide: PORTA_CIRURGIA, useValue: cirurgia },
        { provide: PORTA_ANESTESIA, useValue: anestesia },
        // M46 (etapa 2): o checklist, a trava da incisão, o rastreio, os avisos do quadro do bloco e o painel da família.
        { provide: PORTA_BLOCO_SEGURO, useValue: blocoSeguro },
        { provide: AVISOS_BLOCO, useValue: new AvisosAtendimento(vigia, 'bloco') },
        { provide: TRAVA_INCISAO, useValue: new TravaIncisao(blocoSeguro, trilha, fonteConfig, cacheConfig) },
        { provide: PAINEL_BLOCO_TV, useValue: new PainelBlocoFamilia(blocoSeguro, cirurgia) },
        // M20: atendimento ambulatorial e pronto atendimento.
        { provide: PORTA_ATENDIMENTO, useValue: atendimento },
        // M20: os avisos da fila do consultório e do quadro do PA (as gravações deste processo e o canal "senhas").
        { provide: AVISOS_ATENDIMENTO, useValue: new AvisosAtendimento(vigia) },
        // M44: a classificação de risco, a cor no quadro do PA e o painel de TV do PA.
        { provide: PORTA_CLASSIFICACAO, useValue: classificacao },
        { provide: FONTE_RISCO_PA, useValue: fonteRiscoPa(classificacao, atendimento) },
        {
          provide: PAINEL_PA_TV,
          useValue: new ServicoClassificacao(classificacao, fonteAtendimentosPa(atendimento, recepcao)),
        },
        // M26: SADT, o canal do valor crítico, a vigia das liberações do outro sistema e o portal de resultados.
        { provide: PORTA_SADT, useValue: sadt },
        { provide: PORTA_PACS, useValue: pacs },
        { provide: SERVICO_PACS, useValue: servicoPacs },
        { provide: ESTUDOS_IMAGEM_PEP, useValue: servicoPacs },
        { provide: AVISOS_SADT, useValue: avisosSadt },
        { provide: VIGIA_CRITICOS, useValue: vigiaSadt },
        { provide: CENTRAL_AVISOS_SADT, useValue: centralAvisos },
        // Revisão do W0-04: a pendência de prontuário ao médico pela mesma central.
        { provide: CENTRAL_AVISOS_QUALIDADE, useValue: centralAvisos },
        { provide: SERVICO_PORTAL, useValue: servicoPortal },
        // M50 (etapa 1): o portal do paciente; o PDF assinado do documento pelo serviço de emissão do M49.
        {
          provide: SERVICO_PORTAL_PACIENTE,
          useFactory: (
            icp: ServicoAssinaturaIcp,
            cfgDoc: ConfigDocumentosIcp,
            fonte: FonteConteudoIcp,
            armazem: ArmazemPdfIcp,
          ) => {
            // Só o PDF assinado: o construtor liga a conclusão do lote no serviço ICP, e a ligação feita pelo controlador
            // das assinaturas (com a liberação do PEP) é a que vale; a anterior volta no lugar.
            const ligacao = icp.documentos;
            const emissao = new ServicoAssinaturaDocumentos(icp, assinaturaIcp, fonte, armazem, null, cfgDoc);
            if (ligacao) icp.documentos = ligacao;
            const servico = new ServicoPortalPaciente(
              portalPaciente,
              sadt,
              fonteConfig,
              armazemProvas,
              {
                rede: redeSadt,
                produto: configuracao.produtoNome,
                chaveMestra: chavePortal,
                estabelecimentoPadrao: codigosConfigurados[0] ?? null,
                estabelecimentos: codigosConfigurados,
              },
              (c, assinatura) => emissao.gerarPdfAssinado(c, assinatura),
            );
            // M47 (etapa 3): o link das imagens do laudo aberto no portal do paciente.
            servico.imagens = (c, exame) => servicoPacs.imagemDoLaudo(c, exame);
            // W0-10: o link da confirmação do e-mail novo: simulador em dev/ci; fora, a Hal-AI com a trava de saídas.
            servico.canal = canalDoAmbiente(configuracao.ambiente, fonteConfig, redeSadt);
            // W0-10 (M2): o texto dos registros do prontuário na cópia, pelo leitor do PEP (o mesmo da tela).
            servico.prontuarioCopia = async (c, paciente) => {
              const r = await prontuario.textos(c, paciente, {}, 500);
              const linhas = r.registros.map((x) => {
                let texto: string;
                try {
                  texto = x.rtf ? textoCorrido(rtfParaTexto(x.rtf)) : '';
                } catch {
                  texto = '(texto formatado ilegível)';
                }
                return `${(x.dataHora ?? '').replace('T', ' ').slice(0, 16)} · ${x.modelo ?? 'Registro'}: ${texto}`;
              });
              if (r.truncado)
                linhas.push('(os registros mais antigos ficam para outra cópia: teto de 500 por cópia)');
              return [
                { titulo: 'Registros do prontuário', linhas: linhas.length ? linhas : ['Nenhum registro.'] },
              ];
            };
            // W0-10 (M3): os dados do pacote de portabilidade FHIR/IPS: a identificação pelo cadastro, o estabelecimento
            // pela identificação da SBIS e o resumo clínico pelos leitores do PEP (problemas vigentes, alergias e os
            // medicamentos da última prescrição do atendimento mais recente).
            servico.fonteIps = async (c, paciente) => {
              const [p] = await cadastro.lerPacientes(c, [paciente]);
              if (!p)
                throw new ErroProblema(
                  'nao-encontrado',
                  404,
                  'Paciente não encontrado',
                  'Paciente não encontrado.',
                );
              const est = await portaSbis.identificacao(c.hospital).catch(() => null);
              const [problemas, alergias, atendimentos] = await Promise.all([
                servicoDocumentos.problemas(c, paciente),
                documentos.alergias(c, paciente),
                prescricao.atendimentos(c, paciente),
              ]);
              const data = (t: string | null) =>
                t ? new Date(t.length === 10 ? `${t}T00:00:00Z` : t) : null;
              const medicamentos: MedicamentoIps[] = [];
              const at = atendimentos[0];
              const ultima = at
                ? (await prescricao.prescricoes(c, at.id)).filter((x) => x.dataHora).at(-1)
                : undefined;
              if (ultima) {
                const desde = data(ultima.inicio ?? ultima.dataHora) ?? new Date(0);
                const ativa =
                  ultima.suspensaoEm === null && (ultima.fim === null || new Date(ultima.fim) > new Date());
                for (const i of await prescricao.itens(c, ultima.id)) {
                  if (i.detalhe.tipo !== 'medicamento') continue;
                  const d = i.detalhe;
                  medicamentos.push({
                    id: String(i.id),
                    descricao: d.produtoNome ?? `Medicamento ${d.produto ?? d.id}`,
                    posologia:
                      [
                        d.dose !== null ? `${d.dose} ${d.unidade ?? ''}`.trim() : null,
                        i.via,
                        i.frequenciaNome,
                      ]
                        .filter(Boolean)
                        .join(' · ') || null,
                    desde,
                    ativo: ativa,
                  });
                }
              }
              return {
                paciente: {
                  id: p.id,
                  cpf: p.cpf,
                  cns: p.cns,
                  nome: p.nome,
                  nascimento: data(p.nascimento),
                  sexo: p.sexo,
                },
                estabelecimento: {
                  cnes: est?.cnes ?? '0',
                  cnpj: est?.cnpj ?? null,
                  nome: est?.nome ?? configuracao.produtoNome,
                  apelido: c.hospital,
                  cidade: '',
                  uf: '',
                },
                problemas: problemas
                  .filter((x) => x.situacao !== 'descartado')
                  .map((x) => ({
                    id: String(x.id),
                    descricao: x.descricao,
                    cid10: x.cid,
                    desde: data(x.inicio),
                    ativo: x.situacao === 'ativo',
                  })),
                alergias: alergias
                  .filter((x) => x.ativa)
                  .map((x) => ({ id: String(x.id), descricao: x.agente, reacao: null, critica: false })),
                medicamentos,
              };
            };
            return servico;
          },
          inject: [SERVICO_ASSINATURA_ICP, CONFIG_DOCUMENTOS_ICP, FONTE_CONTEUDO_ICP, ARMAZEM_PDF_ICP],
        },
        // M50 (etapa 2): agendamento online, pré-check-in, pagamento e pesquisa sobre a sessão do portal da etapa 1.
        {
          provide: SERVICO_AGENDA_PORTAL,
          useFactory: (portal: ServicoPortalPaciente) =>
            new ServicoAgendaPortal(
              portal,
              agendaOnline,
              agenda,
              exame,
              cadastro,
              fonteConfig,
              armazemProvas,
              gatewayPortal,
            ),
          inject: [SERVICO_PORTAL_PACIENTE],
        },
        // M50 (etapa 4): telemedicina (a tela do médico e a sala de espera do portal); liga o gancho da teleconsulta na
        // agenda online do portal e a marca da telemedicina nos documentos do PEP.
        {
          provide: SERVICO_TELEMEDICINA,
          useFactory: (portal: ServicoPortalPaciente, agendaPortal: ServicoAgendaPortal) => {
            const apoio = new ApoioGravacao(
              { chave: 'telemedicina', nome: 'a telemedicina', operacoes: OPERACOES_TELEMEDICINA },
              new PortaGravacaoTelemedicina(telemedicina, atendimento),
              trilha,
              fonteConfig,
              cacheConfig,
            );
            const s = new ServicoTelemedicina(
              telemedicina,
              atendimento,
              cadastro,
              apoio,
              provedorTele,
              fonteConfig,
              portal,
            );
            agendaPortal.ligarTeleconsulta(s);
            servicoDocumentos.ligarTelemedicina((c, a) => s.atendimentoEmTeleconsulta(c, a));
            return s;
          },
          inject: [SERVICO_PORTAL_PACIENTE, SERVICO_AGENDA_PORTAL],
        },
        // M27: página inicial, central de avisos (canal por estabelecimento e login), mensagens e dicionário.
        { provide: PORTA_COMUNICACAO, useValue: comunicacao },
        { provide: AVISOS_INICIO, useValue: avisosInicio },
        { provide: PORTA_WORKLIST, useValue: worklist },
        { provide: PORTA_GUIAS, useValue: guias },
        // M21: internação, leitos, higienização e SAME (o mapa e a higienização assinam o canal "leitos" do vigia).
        { provide: PORTA_ADT, useValue: adt },
        // M44 (etapa 2): o NIR (os avisos pelo canal da internação e dos leitos).
        { provide: PORTA_NIR, useValue: nir },
        // M45 (etapa 5): a nutrição, o mapa de dietas e o serviço social.
        { provide: PORTA_NUTRICAO, useValue: nutricao },
        // M50 (etapa 6): a agenda de sessões, a digitalização certificada (o arquivo com retenção) e a assinatura de quem
        // conferiu pelo serviço do M49 (a conclusão ligada ao serviço ao ser criado).
        { provide: PORTA_SESSOES, useValue: sessoes },
        { provide: PORTA_DIGITALIZACAO, useValue: digitalizacao },
        { provide: ARMAZEM_DIGITALIZACAO, useValue: armazemDigitalizacao },
        {
          provide: SERVICO_ASSINATURA_DIGITALIZACAO,
          useFactory: (icp: ServicoAssinaturaIcp) =>
            new ServicoAssinaturaDigitalizacao(icp, assinaturaIcp, digitalizacao, armazemDigitalizacao),
          inject: [SERVICO_ASSINATURA_ICP],
        },
        // M28: estoque, almoxarifado e compras.
        { provide: PORTA_SUPRIMENTOS, useValue: suprimentos },
        // M46 (etapa 3): OPME.
        { provide: PORTA_OPME, useValue: opme },
        // M46 (etapa 4): consignados e manipulação.
        { provide: PORTA_CONSIGNADO, useValue: consignado },
        // M55 (etapa 3): contratos com fornecedores.
        { provide: PORTA_CONTRATO, useValue: contrato },
        // M55 (etapa 4): licitação e pregão.
        { provide: PORTA_LICITACAO, useValue: licitacao },
        { provide: PORTA_MANIPULACAO, useValue: manipulacao },
        // M55 (fatia F2): rouparia e lavanderia.
        { provide: PORTA_ROUPARIA, useValue: rouparia },
        // M55 (etapa 1): manutenção e engenharia clínica.
        { provide: PORTA_MANUTENCAO, useValue: manutencao },
        { provide: GERADOR_PDF_MANUTENCAO, useValue: geradorPdf },
        // W0-07 (M4): a OS num leito propõe e encerra o bloqueio por manutenção (parâmetro adt.osBloqueiaLeito).
        { provide: INTEGRACAO_OS_LEITO, useClass: IntegracaoOsLeitoAdt },
        // M55 (etapa 5): contratualização SUS.
        { provide: PORTA_CONTRATUALIZACAO, useValue: contratualizacao },
        // M29: farmácia (a fila e a avaliação assinam a vigia dos horários da enfermagem: prescrição nova, suspensão).
        { provide: PORTA_FARMACIA, useValue: farmacia },
        { provide: AVISOS_FARMACIA, useValue: new AvisosAtendimento(vigiaEnfermagem, 'leitos') },
        { provide: GERADOR_PDF_FARMACIA, useValue: geradorPdf },
        // M30: conta do paciente, lançamentos e auditoria de contas.
        { provide: PORTA_FATURAMENTO, useValue: faturamento },
        // M31: TISS, competência, demonstrativos, glosa e recurso.
        { provide: PORTA_TISS, useValue: tiss },
        { provide: ARMAZEM_XML_TISS, useValue: armazemXmlTiss },
        // M32: financeiro e fiscal.
        { provide: PORTA_FINANCEIRO, useValue: financeiro },
        { provide: PORTA_REPASSE, useValue: repasse },
        { provide: PORTA_PESSOAS, useValue: pessoas },
        { provide: PORTA_ESCALA, useValue: escala },
        { provide: PORTA_SESMT, useValue: sesmt },
        { provide: PORTA_CARGOS, useValue: cargos },
        { provide: PORTA_AVALIACAO, useValue: avaliacao },
        { provide: PORTA_RUBRICAS, useValue: rubricas },
        { provide: GERADOR_PDF_SESMT, useValue: geradorPdf },
        { provide: PORTA_PONTO, useValue: ponto },
        { provide: GERADOR_PDF_PONTO, useValue: geradorPdf },
        { provide: PORTA_TREINAMENTO, useValue: treinamento },
        { provide: PORTA_REALIZADO, useValue: realizado },
        { provide: PORTA_FOLHA, useValue: folha },
        { provide: PORTA_CALCULO_FOLHA, useValue: calculoFolha },
        { provide: PORTA_AUTOATENDIMENTO, useValue: autoatendimento },
        { provide: PORTA_INDICADORES_PESSOAS, useValue: indicadoresPessoas },
        { provide: PORTA_INTEGRACAO_FOLHA, useValue: integracaoFolha },
        { provide: PORTA_ESOCIAL, useValue: esocial },
        { provide: TRANSMISSOR_ESOCIAL, useValue: transmissorEsocial },
        { provide: GERADOR_PDF_FOLHA, useValue: geradorPdf },
        { provide: GERADOR_PDF_F6, useValue: geradorPdf },
        // M54.3: o balancete, o diário, a DRE e o balanço em PDF/A.
        { provide: GERADOR_PDF_CONTABIL, useValue: geradorPdf },
        { provide: CIFRA_CPF_PESSOAS, useValue: cifraCpf },
        // M50 (etapa 3): o portal do médico externo (a sessão do portal do M26; o extrato pelo serviço do M33).
        {
          provide: SERVICO_PORTAL_MEDICO,
          // W0-10: o link da confirmação do e-mail novo: simulador em dev/ci; fora, desligado até o dono (Hal-AI).
          // W0-10 (M6): a fila de assinatura remota pelo serviço da assinatura dos documentos (M49), com a mesma
          // liberação do PEP; o construtor liga a conclusão no serviço ICP, e a ligação do controlador volta no lugar.
          useFactory: (
            icp: ServicoAssinaturaIcp,
            cfgAssinatura: ConfigServicoAssinatura,
            cfgDoc: ConfigDocumentosIcp,
            fonte: FonteConteudoIcp,
            armazem: ArmazemPdfIcp,
          ) => {
            const ligacao = icp.documentos;
            const documentosIcp = new ServicoAssinaturaDocumentos(
              icp,
              assinaturaIcp,
              fonte,
              armazem,
              new LiberacaoPep(fonteConfig, cacheConfig),
              cfgDoc,
            );
            if (ligacao) icp.documentos = ligacao;
            const retornoPortal = retornoDoPortalMedico(cfgAssinatura.retorno);
            return Object.assign(
              new ServicoPortalMedico(
                servicoPortal,
                sadt,
                portalMedico,
                cirurgia,
                new ServicoRepasse(repasse, trilha, fonteConfig, null),
                fonteConfig,
                redeSadt,
              ),
              {
                canal: canalMedicoDoAmbiente(configuracao.ambiente),
                // W0-10 (M4): meus pacientes pela fila do médico interno (M27), pelo vínculo assistencial.
                pacientes: new ServicoWorklistMedico(servicoDocumentos, prescricao, worklist),
                // W0-10 (M5): a notificação do crítico ao médico externo roda onde roda a vigia do valor crítico.
                hospitaisAvisoCritico: vigiaSadt ? codigosConfigurados : [],
                assinatura: {
                  retorno: retornoPortal,
                  fila: (x) => documentosIcp.fila(x),
                  prepararLote: (x, e) => documentosIcp.prepararLote(x, e),
                  pedir: (x, e, r) => documentosIcp.pedir(x, e, r),
                  concluir: (x, q, r) => icp.retornoPsc(x, q, r),
                } satisfies FonteAssinaturaPortalMedico,
              },
            );
          },
          inject: [
            SERVICO_ASSINATURA_ICP,
            CONFIG_ASSINATURA_ICP,
            CONFIG_DOCUMENTOS_ICP,
            FONTE_CONTEUDO_ICP,
            ARMAZEM_PDF_ICP,
          ],
        },
        { provide: PORTA_REDE, useValue: redeMpi },
        { provide: PORTA_SERVICOS_REDE, useValue: servicosRede },
        { provide: PORTA_CUSTOS, useValue: custos },
        { provide: PORTA_ORCAMENTO, useValue: orcamento },
        { provide: PORTA_PATRIMONIO, useValue: patrimonio },
        { provide: ARMAZEM_LAUDO_PATRIMONIO, useValue: armazemLaudoPatrimonio },
        { provide: GERADOR_PDF_PATRIMONIO, useValue: geradorPdf },
        { provide: PORTA_SUS, useValue: sus },
        { provide: ARMAZEM_ARQUIVO_SUS, useValue: armazemArquivoSus },
        { provide: PORTA_ASSINATURA_ICP, useValue: assinaturaIcp },
        {
          provide: CONFIG_ASSINATURA_ICP,
          useFactory: () =>
            opcoes.configAssinaturaIcp ??
            configAssinaturaDoAmbiente(
              env,
              fontesSinteticas(env),
              chaveMestra(env['PLATAFORMA_CHAVE_MESTRA']),
              process.cwd(),
            ),
        },
        {
          provide: SERVICO_ASSINATURA_ICP,
          useFactory: (cfg: ConfigServicoAssinatura) =>
            new ServicoAssinaturaIcp(assinaturaIcp, trilha, cfg, fonteConfig),
          inject: [CONFIG_ASSINATURA_ICP],
        },
        // M49 (etapa 3): a conferência da entrada com certificado A1/A3 (desafio no armazém das sessões).
        {
          provide: SERVICO_LOGIN_CERTIFICADO,
          useFactory: (icp: ServicoAssinaturaIcp) =>
            new ServicoLoginCertificado(icp, assinaturaIcp, armazemSessoes, fonteConfig, trilha),
          inject: [SERVICO_ASSINATURA_ICP],
        },
        {
          provide: CONFIG_DOCUMENTOS_ICP,
          useFactory: (cfg: ConfigServicoAssinatura) =>
            configDocumentosIcpDoAmbiente(env, cfg.modo === 'simulador' ? new SimuladorSncr() : null),
          inject: [CONFIG_ASSINATURA_ICP],
        },
        {
          provide: FONTE_CONTEUDO_ICP,
          useValue: {
            conteudo: (c: { rede: string; hospital: string }, d: DocumentoSghLido) =>
              servicoDocumentos.conteudoParaAssinatura(c, d),
            nomes: (c: { rede: string; hospital: string }, ps: readonly number[]) => documentos.nomes(c, ps),
          },
        },
        { provide: ARMAZEM_PDF_ICP, useValue: armazemPdfIcp(fonteDocumento) },
        // M49 (etapa 3): o verificador público procura o código nos estabelecimentos da rede (só SGH_) e conta o
        // limite de taxa no armazém das sessões (Valkey; compartilhado entre as instâncias). HS-1: com o núcleo
        // real, só o estabelecimento do catálogo (a mesma regra da sessão; os scripts SGH_ só estão aplicados nele).
        {
          provide: SERVICO_VERIFICADOR,
          useFactory: (cfg: { urlVerificador: string }) =>
            new ServicoVerificador(assinaturaIcp, armazemSessoes, fonteConfig, {
              rede: real?.rede ?? configuracao.rede ?? 'rede-sintetica',
              estabelecimentos: estabelecimentosDoVerificador(
                codigosConfigurados,
                real ? new Set([CATALOGO_LEGADO_ORIGEM.estabelecimento]) : null,
              ),
              endereco: cfg.urlVerificador,
            }),
          inject: [CONFIG_DOCUMENTOS_ICP],
        },
        { provide: GERADOR_PDF_REPASSE, useValue: geradorPdf },
        { provide: GERADOR_PDF_CUSTOS, useValue: geradorPdf },
        { provide: ARMAZEM_FINANCEIRO, useValue: armazemFinanceiro },
        { provide: GERADOR_PDF_TISS, useValue: geradorPdf },
        { provide: AVISOS_ADT, useValue: new AvisosAtendimento(vigia, 'leitos') },
        { provide: ARMAZEM_FOTOS, useValue: criarArmazemFotos(configuracao, env) },
        // M25: enfermagem beira-leito (as telas assinam a vigia dos horários).
        { provide: PORTA_ENFERMAGEM, useValue: enfermagem },
        // M45 (etapa 3): balanço hídrico.
        { provide: PORTA_BALANCO, useValue: balanco },
        // M50 (etapa 5): portaria e visitantes (as fotos no armazenamento local; o simulador da catraca fora de produção).
        { provide: PORTA_PORTARIA, useValue: portaria },
        { provide: ARMAZEM_FOTOS_PORTARIA, useValue: criarArmazemFotosPortaria(configuracao, env) },
        { provide: OPCOES_PORTARIA, useValue: { simulador: configuracao.ambiente !== 'producao' } },
        // M45 (etapa 4): SAE, prescrição de enfermagem, receita do enfermeiro e vacina.
        { provide: PORTA_SAE, useValue: sae },
        { provide: PORTA_TRANSFUSAO, useValue: transfusao },
        { provide: PORTA_QUALIDADE, useValue: qualidade },
        { provide: RESUMO_SUGESTAO, useValue: resumoSugestao },
        { provide: PORTA_CCIH, useValue: ccih },
        { provide: PORTA_AGRAVO, useValue: agravo },
        { provide: PORTA_GESTAO, useValue: gestaoQualidade },
        { provide: PORTA_AGENCIA, useValue: agencia },
        // M45 (etapa 2): escores, classificação de pacientes e índices de UTI.
        { provide: PORTA_ESCORES, useValue: escores },
        { provide: VIGIA_CONTENCAO, useValue: vigiaContencao },
        { provide: AVISOS_ENFERMAGEM, useValue: new AvisosAtendimento(vigiaEnfermagem, 'leitos') },
        // M34: catálogo de relatórios, envio agendado (a fila do worker) e as integrações novas.
        { provide: PORTA_RELATORIO, useValue: relatorio },
        { provide: PORTA_COEXISTENCIA, useValue: coexistencia },
        { provide: PORTA_CONTAS_BANCO, useValue: contasBanco },
        { provide: PORTA_SEGREDOS, useValue: segredos },
        { provide: SERVICO_SBIS, useValue: servicoSbis },
        { provide: COFRE_SEGREDOS, useValue: cofreSegredos },
        {
          provide: SITUACAO_HOSPITAL_SEGREDOS,
          useValue: (c: { rede: string; hospital: string }) =>
            new ServicoContasBanco({
              porta: contasBanco,
              raizDesligamento: raizesDesligamentoDoAmbiente(env).desligamento,
              configuracao: fonteConfig,
            }).situacao(c),
        },
        {
          provide: EXECUTOR_SEGREDOS,
          useValue: {
            receita: (n: string, h: string) => gestao.receita(n, h),
            executar: (n: string, h: string, e: unknown, c: ContextoOperacao) => gestao.executar(n, h, e, c),
          },
        },
        { provide: PORTA_OPERADORA, useValue: operadora },
        { provide: PORTA_REDE_OPERADORA, useValue: redeOperadora },
        { provide: PORTA_CONTABIL, useValue: contabil },
        { provide: PORTA_COBRANCA_OPERADORA, useValue: cobrancaOperadora },
        { provide: PORTA_AUTORIZACAO_OPERADORA, useValue: autorizacaoOperadora },
        { provide: PORTA_CONTAS_OPERADORA, useValue: contasOperadora },
        { provide: PORTA_ANS_OPERADORA, useValue: ansOperadora },
        { provide: PORTA_ATENDIMENTO_OPERADORA, useValue: atendimentoOperadora },
        // M56 (etapa 8, F7): o portal do prestador (identidade própria; a chave mestra do portal do M26 cifra o segundo
        // fator; a situação das chaves pela configuração do estabelecimento).
        {
          provide: SERVICO_PORTAL_PRESTADOR,
          useValue: new ServicoPortalPrestador(
            atendimentoOperadora,
            autorizacaoOperadora,
            new ServicoSituacaoOperadora(fonteConfig, cacheConfig),
            redeSadt,
            chavePortal,
            configuracao.produtoNome,
          ),
        },
        { provide: OPCOES_MIGRACAO, useValue: opcoesMigracaoDoAmbiente(env) },
        { provide: RAIZ_FIM_COEXISTENCIA, useValue: raizFimDoAmbiente(env) },
        { provide: RAIZES_DESLIGAMENTO, useValue: raizesDesligamentoDoAmbiente(env) },
        { provide: RAIZ_RETROCOMPATIBILIDADE, useValue: raizRetrocompatibilidadeDoAmbiente(env) },
        { provide: PORTA_IMPLANTACAO, useValue: implantacao },
        { provide: SCRIPTS_DO_PACOTE, useValue: scriptsDoPacote },
        { provide: FILAS_IMPLANTACAO, useValue: opcoes.filasImplantacao ?? filasDoAmbiente(env) },
        { provide: FILA_ENVIO_RELATORIO, useValue: filaEnvio },
        { provide: GERADOR_PDF_RELATORIO, useValue: geradorPdf },
        { provide: PORTA_INTEGRACAO, useValue: integracao },
        { provide: PORTA_FACHADA, useValue: fachada },
        { provide: SERVICO_FACHADA, useValue: criarServicoFachada(fachada, fonteConfig, env) },
        { provide: ARMAZEM_CONTEUDO, useValue: armazemConteudo },
        {
          provide: ESTABELECIMENTOS_ENTRADA,
          useValue: fontesSinteticas(env) && !fonteDevDaCopia(env) ? [] : codigosConfigurados,
        },
        VersaoService,
      ],
    };
  }
}

/**
 * M11: em dev com a cópia (ACESSO_FONTE_DEV=copia), a sessão de dev lê o cadastro real (READ ONLY) mas não grava:
 * gravar na cópia compartilhada com COMMIT, fora da trava, em nome de um login da sessão de dev, é o que o M08
 * recusa (D15/D29). O executor responde 403 operacao-nao-liberada com o motivo.
 */
const MOTIVO_SO_LEITURA =
  'Em desenvolvimento sobre a cópia compartilhada, o cadastro é só consulta: a gravação real roda em homologação ou treino, com o login real.';

function executorSoLeitura(): Executor {
  return {
    executar: () =>
      Promise.reject(
        new ErroOperacao(
          403,
          'operacao-nao-liberada',
          'Gravação desligada nesta sessão de desenvolvimento',
          MOTIVO_SO_LEITURA,
        ),
      ),
    // A tela pergunta antes (busca e ficha): a mesma recusa, com o motivo, sem a pessoa preencher o formulário.
    liberacao: () =>
      Promise.resolve({ pode: false, codigo: 'operacao-nao-liberada', motivo: MOTIVO_SO_LEITURA }),
  } as unknown as Executor;
}

/** Estabelecimentos configurados (ARQ-1); configuração inválida não derruba a tela (lista vazia). */
function codigosOuVazio(env: NodeJS.ProcessEnv): string[] {
  try {
    return lerCodigos(env);
  } catch {
    return [];
  }
}

/**
 * ADR 0022: PLATAFORMA_EM_NOME_DE="pc=LOGIN;hs=OUTRO" (login exato do TBUSERS por estabelecimento). Entrada
 * fora do formato é ignorada (o modal pede a escolha): a configuração nunca derruba a API.
 */
export function emNomeDePadrao(valor: string | undefined): (hospital: string) => string | null {
  const mapa = new Map<string, string>();
  for (const parte of (valor ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i <= 0) continue;
    const cod = parte.slice(0, i).trim();
    const login = parte.slice(i + 1);
    if (/^[a-z][a-z0-9]{1,9}$/.test(cod) && /^\S.{0,30}$/.test(login) && login.trim() === login)
      mapa.set(cod, login);
  }
  return (h) => mapa.get(h) ?? null;
}
