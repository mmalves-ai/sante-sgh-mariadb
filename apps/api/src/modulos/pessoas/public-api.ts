// Módulo da gestão de pessoas da API (M52): fatia F1, colaboradores e admissão (vínculo, lotação, dependentes, histórico,
// desligamento ligado ao acesso e a validade do conselho).
export { CifraCpf, chaveCpfDoAmbiente } from './cifra-cpf.js';
export { CIFRA_CPF_PESSOAS, PessoasController } from './pessoas.controller.js';
export { PORTA_PESSOAS, type GravadorPessoas, type PortaPessoas } from './porta.js';
export { portaPessoasIndisponivel, portaPessoasLegado, portaPessoasNaTransacao } from './porta-legado.js';
export { cpfSintetico, PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from './porta-memoria.js';
export { CHAVE_PESSOAS_COLABORADOR, ServicoPessoas } from './servico.js';
// M52.2: a escala de plantão (regimes, montagem e publicação).
export { EscalaController } from './escala/escala.controller.js';
export { PORTA_ESCALA, type PortaEscala } from './escala/porta-escala.js';
export {
  portaEscalaIndisponivel,
  portaEscalaLegado,
  portaEscalaNasTransacoes,
} from './escala/porta-escala-legado.js';
export { PortaEscalaMemoria } from './escala/porta-escala-memoria.js';
export { CHAVE_PESSOAS_ESCALA, ServicoEscala } from './escala/servico-escala.js';
// Fatia F5 (M52.5): SESMT (prontuário ocupacional e ASO, vacinas, acidentes e CAT, riscos e EPI, dosimetria).
export { GERADOR_PDF_SESMT, SesmtController } from './sesmt/sesmt.controller.js';
export { PORTA_SESMT, type GravadorSesmt, type PortaSesmt } from './sesmt/porta-sesmt.js';
export {
  portaSesmtIndisponivel,
  portaSesmtLegado,
  portaSesmtNaTransacao,
} from './sesmt/porta-sesmt-legado.js';
export { DOMINIOS_SESMT_SINTETICOS, PortaSesmtMemoria } from './sesmt/porta-sesmt-memoria.js';
export { CHAVE_PESSOAS_SESMT, PERMISSOES_SESMT, ServicoSesmt } from './sesmt/servico-sesmt.js';
// M53-F1: rubricas, incidências e tabelas legais da folha (só leitura; a gravação é a do CRUD genérico).
export { RubricasController } from './rubricas/rubricas.controller.js';
export { PORTA_RUBRICAS, type PortaRubricas } from './rubricas/porta-rubricas.js';
export {
  portaRubricasIndisponivel,
  portaRubricasLegado,
  portaRubricasNaTransacao,
} from './rubricas/porta-rubricas-legado.js';
export { PortaRubricasMemoria } from './rubricas/porta-rubricas-memoria.js';
export { CHAVE_RUBRICAS_FOLHA, PERMISSOES_RUBRICAS, ServicoRubricas } from './rubricas/servico-rubricas.js';
// M52.3: troca de plantão, quem está de plantão agora (consulta usada pelo PEP, pelo NIR e pelo PA), sobreaviso e
// dimensionamento de enfermagem.
export { PlantaoController } from './escala/plantao.controller.js';
export { CHAVE_PESSOAS_DIMENSIONAMENTO, ServicoPlantao } from './escala/servico-plantao.js';
// Fatia F4 (M52.4): ponto (arquivo do relógio, ajustes, apuração, banco de horas, espelho com ciência, AEJ).
export { GERADOR_PDF_PONTO, PontoController } from './ponto/ponto.controller.js';
export { GERADOR_PDF_FOLHA } from './folha/documentos-calculo.js';
export { PORTA_PONTO, type GravadorPonto, type PortaPonto } from './ponto/porta-ponto.js';
export {
  portaPontoIndisponivel,
  portaPontoLegado,
  portaPontoNaTransacao,
} from './ponto/porta-ponto-legado.js';
export { DOMINIOS_PONTO_SINTETICOS, PortaPontoMemoria } from './ponto/porta-ponto-memoria.js';
export { PERMISSOES_PONTO, ServicoPonto } from './ponto/servico-ponto.js';
// Fatia F6 (M52.6): treinamentos e POP, "Meu espaço" (autosserviço), plantão realizado para o repasse.
export { GERADOR_PDF_F6, TreinamentoController } from './treinamento/treinamento.controller.js';
export {
  PORTA_TREINAMENTO,
  type GravadorTreinamento,
  type PortaTreinamento,
} from './treinamento/porta-treinamento.js';
export {
  portaTreinamentoIndisponivel,
  portaTreinamentoLegado,
  portaTreinamentoNaTransacao,
} from './treinamento/porta-treinamento-legado.js';
export { PortaTreinamentoMemoria } from './treinamento/porta-treinamento-memoria.js';
export { PERMISSOES_TREINAMENTO, ServicoTreinamento } from './treinamento/servico-treinamento.js';
export { MeuEspacoController } from './autoatendimento/meu-espaco.controller.js';
export { MeuHoleriteController } from './autoatendimento/meu-holerite.controller.js';
export { ServicoMeuEspaco } from './autoatendimento/servico-meu-espaco.js';
export { RealizadoController } from './escala/realizado.controller.js';
export { PORTA_REALIZADO, type GravadorRealizado, type PortaRealizado } from './escala/porta-realizado.js';
export {
  portaRealizadoIndisponivel,
  portaRealizadoLegado,
  portaRealizadoNaTransacao,
} from './escala/porta-realizado-legado.js';
export { PortaRealizadoMemoria } from './escala/porta-realizado-memoria.js';
export { PERMISSOES_REALIZADO, ServicoRealizado } from './escala/servico-realizado.js';
// Fatia F0 do M53 (M53.1): a interface com a folha externa e o afastamento do colaborador.
export { FolhaController } from './folha/folha.controller.js';
export { PORTA_FOLHA, type GravadorFolha, type PortaFolha } from './folha/porta-folha.js';
export {
  portaFolhaIndisponivel,
  portaFolhaLegado,
  portaFolhaNaTransacao,
} from './folha/porta-folha-legado.js';
export { PortaFolhaMemoria } from './folha/porta-folha-memoria.js';
export { PERMISSOES_FOLHA, ServicoFolha } from './folha/servico-folha.js';
// M53.3: o cálculo mensal da folha (salário, parâmetros, processamento e memória).
export { CalculoFolhaController } from './folha/calculo.controller.js';
export { FeriasFolhaController } from './folha/ferias.controller.js';
export { RescisaoFolhaController } from './folha/rescisao.controller.js';
export { MinhasFeriasController } from './autoatendimento/minhas-ferias.controller.js';
export {
  FilaSolicitacoesController,
  MinhasSolicitacoesController,
} from './autoatendimento/solicitacoes.controller.js';
export {
  PORTA_AUTOATENDIMENTO,
  type GravadorAutoatendimento,
  type PortaAutoatendimento,
} from './autoatendimento/porta-autoatendimento.js';
export {
  portaAutoatendimentoIndisponivel,
  portaAutoatendimentoLegado,
  portaAutoatendimentoNaTransacao,
} from './autoatendimento/porta-autoatendimento-legado.js';
export { PortaAutoatendimentoMemoria } from './autoatendimento/porta-autoatendimento-memoria.js';
export {
  PERMISSOES_AUTOATENDIMENTO,
  ServicoAutoatendimento,
} from './autoatendimento/servico-autoatendimento.js';
export {
  type GravadorCalculoFolha,
  PORTA_CALCULO_FOLHA,
  type PortaCalculoFolha,
} from './folha/porta-calculo.js';
export {
  portaCalculoFolhaIndisponivel,
  portaCalculoFolhaLegado,
  portaCalculoFolhaNaTransacao,
} from './folha/porta-calculo-legado.js';
export { PortaCalculoFolhaMemoria } from './folha/porta-calculo-memoria.js';
export { PERMISSOES_CALCULO_FOLHA, ServicoCalculoFolha } from './folha/servico-calculo.js';
// M53.7: o fechamento do período da folha e os periódicos do eSocial.
export { FechamentoFolhaController } from './folha/fechamento.controller.js';
export { PERMISSOES_FECHAMENTO_FOLHA, ServicoFechamentoFolha } from './folha/servico-fechamento.js';
export { ServicoPeriodicosEsocial } from './esocial/servico-periodicos.js';
// M53.8: o FGTS Digital e as obrigações legais (SEFIP, CAGED e RAIS onde ainda exigidas).
export { ObrigacoesController } from './obrigacoes/obrigacoes.controller.js';
export { PERMISSOES_OBRIGACOES, ServicoObrigacoes } from './obrigacoes/servico-obrigacoes.js';
// M53.9: a integração da folha com o financeiro e o contábil (títulos e fatos contábeis).
export { IntegracaoFolhaController } from './folha/integracao.controller.js';
export {
  type GravadorIntegracaoFolha,
  PORTA_INTEGRACAO_FOLHA,
  type PortaIntegracaoFolha,
} from './folha/porta-integracao.js';
export {
  portaIntegracaoFolhaIndisponivel,
  portaIntegracaoFolhaLegado,
  portaIntegracaoFolhaNaTransacao,
} from './folha/porta-integracao-legado.js';
export { PortaIntegracaoFolhaMemoria } from './folha/porta-integracao-memoria.js';
export { PERMISSOES_INTEGRACAO_FOLHA, ServicoIntegracaoFolha } from './folha/servico-integracao.js';
// M53.6: o eSocial de tabela e não periódicos (eventos, lotes, retorno, pendências do outro sistema e conciliação).
export { EsocialController } from './esocial/esocial.controller.js';
export { PORTA_ESOCIAL, type PortaEsocial } from './esocial/porta-esocial.js';
export {
  portaEsocialIndisponivel,
  portaEsocialLegado,
  portaEsocialNaTransacao,
} from './esocial/porta-esocial-legado.js';
export { PortaEsocialMemoria } from './esocial/porta-esocial-memoria.js';
export { PERMISSOES_ESOCIAL, ServicoEsocial } from './esocial/servico-esocial.js';
export {
  TRANSMISSOR_ESOCIAL,
  type DisponibilidadeTransmissor,
  transmissorEsocialDoAmbiente,
} from './esocial/transmissor/transmissor-esocial.js';
// W0-06, parte 4: cargos e salários (M1 de mercado).
export { CargosController } from './cargos/cargos.controller.js';
export { PORTA_CARGOS, type GravadorCargos, type PortaCargos } from './cargos/porta-cargos.js';
export {
  portaCargosIndisponivel,
  portaCargosLegado,
  portaCargosNaTransacao,
} from './cargos/porta-cargos-legado.js';
export { CBO_SINTETICOS, PortaCargosMemoria } from './cargos/porta-cargos-memoria.js';
export { PERMISSOES_CARGOS, ServicoCargos } from './cargos/servico-cargos.js';
// W0-06, parte 7: painel de indicadores de pessoas (M4 de mercado).
export { IndicadoresPessoasController } from './indicadores/indicadores.controller.js';
export {
  PORTA_INDICADORES_PESSOAS,
  type PortaIndicadoresPessoas,
  portaIndicadoresPessoasIndisponivel,
} from './indicadores/porta-indicadores.js';
export {
  type FatosIndicadoresPessoas,
  PortaIndicadoresPessoasMemoria,
} from './indicadores/porta-indicadores-memoria.js';
export { portaIndicadoresPessoasLegado } from './indicadores/porta-indicadores-legado.js';
export { SEMENTE_INDICADORES_PESSOAS } from './indicadores/semente-indicadores.js';
export {
  PERMISSOES_INDICADORES_PESSOAS,
  ServicoIndicadoresPessoas,
} from './indicadores/servico-indicadores.js';
// W0-06, parte 5: avaliação de desempenho, competências, alerta de experiência e PDI (M2 de mercado).
export { AvaliacaoController } from './avaliacao/avaliacao.controller.js';
export { PORTA_AVALIACAO, type GravadorAvaliacao, type PortaAvaliacao } from './avaliacao/porta-avaliacao.js';
export {
  portaAvaliacaoIndisponivel,
  portaAvaliacaoLegado,
  portaAvaliacaoNaTransacao,
} from './avaliacao/porta-avaliacao-legado.js';
export { PortaAvaliacaoMemoria } from './avaliacao/porta-avaliacao-memoria.js';
export { PERMISSOES_AVALIACAO, ServicoAvaliacao } from './avaliacao/servico-avaliacao.js';
