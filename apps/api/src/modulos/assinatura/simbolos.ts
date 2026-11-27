// Tokens de injeção da assinatura ICP-Brasil (M49, etapas 1 e 2): o serviço isolado compartilhado entre as rotas do
// certificado e as dos documentos (a volta do provedor conclui os dois), a fonte do conteúdo do documento (o
// prontuário de uso diário), o armazém do PDF (o serviço de emissão do M09) e a configuração dos documentos.
export const SERVICO_ASSINATURA_ICP = Symbol('SERVICO_ASSINATURA_ICP');
export const FONTE_CONTEUDO_ICP = Symbol('FONTE_CONTEUDO_ICP');
export const ARMAZEM_PDF_ICP = Symbol('ARMAZEM_PDF_ICP');
export const CONFIG_DOCUMENTOS_ICP = Symbol('CONFIG_DOCUMENTOS_ICP');
/** O serviço da assinatura dos documentos emitidos (um só: as rotas internas e a fila do portal do médico externo). */
export const SERVICO_DOCUMENTOS_ICP = Symbol('SERVICO_DOCUMENTOS_ICP');
