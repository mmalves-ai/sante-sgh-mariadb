export { AcessosProntuarioController } from './acessos.controller.js';
export { ESTADO_PRONTUARIO, ProntuarioController, SERVICO_PRONTUARIO } from './prontuario.controller.js';
export { PORTA_PRONTUARIO, type PortaProntuario } from './porta.js';
export { PortaProntuarioMemoria } from './porta-memoria.js';
export { EstadoProntuario } from './sessao-prontuario.js';
export { ServicoProntuario } from './servico.js';
// M22: registros clínicos nos modelos do formulário.
export { RegistroClinicoController, SERVICO_REGISTRO } from './registro.controller.js';
export { PORTA_REGISTRO, type PortaRegistro } from './registro-porta.js';
export { PortaRegistroMemoria } from './registro-porta-memoria.js';
export { ServicoRegistro } from './registro-servico.js';
// M24: prescrição eletrônica (CPOE), farmácia clínica e horários-padrão.
export { PrescricaoController, SERVICO_PRESCRICAO } from './prescricao.controller.js';
export { PORTA_PRESCRICAO, type PortaPrescricao } from './prescricao-porta.js';
export { PortaPrescricaoMemoria } from './prescricao-porta-memoria.js';
export { ServicoPrescricao } from './prescricao-servico.js';
// M23: prontuário de uso diário (documentos, exames, resultados e multiprofissional).
export {
  DocumentosPepController,
  ESTUDOS_IMAGEM_PEP,
  type FonteEstudosImagem,
  SERVICO_DOCUMENTOS,
} from './documentos.controller.js';
export { AcessoRedePepController } from './acesso-rede.controller.js';
export { AcessoProntuarioRede } from './acesso-rede.js';
export { PORTA_DOCUMENTOS, type PortaDocumentos } from './documentos-porta.js';
export { PortaDocumentosMemoria } from './documentos-porta-memoria.js';
export { ServicoDocumentos } from './documentos-servico.js';
// M27: a liberação por chave (recurso por estabelecimento, setor, grupo ou pessoa), usada pela página inicial.
export { type Liberacao, LiberacaoPep } from './liberacao-pep.js';
// M45 (etapa 1): construtor de formulários novos.
export { FormularioNovoController } from './formulario-novo.controller.js';
export { PORTA_FORMULARIO_NOVO, type PortaFormularioNovo } from './formulario-novo-porta.js';
export { PortaFormularioNovoMemoria } from './formulario-novo-porta-memoria.js';
// Fora de dev/ci sem o núcleo: as portas que recusam tudo (falha fechada).
export {
  portaDocumentosIndisponivel,
  portaFormularioNovoIndisponivel,
  portaPrescricaoIndisponivel,
  portaProntuarioIndisponivel,
  portaQueRecusa,
  portaRegistroIndisponivel,
} from './portas-indisponiveis.js';
