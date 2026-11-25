// Família acesso-email (modulos-proprios-2): o e-mail da porta de entrada. O código mora em @sgh/nucleo
// (email-acesso.ts), dividido com a ferramenta plataforma:criar-admin; aqui só a reexportação, sem mudar o comportamento.
export {
  ENDERECO_EMAIL,
  REMETENTE_ACESSO_PADRAO,
  emailAcessoDoAmbiente,
  emailAcessoMemoria,
  emailDoDono,
  enviarSmtpAcesso,
  envioPeloCanalDoDono,
  montarMensagemAcesso,
  type MensagemAcesso,
  type PortaEmailAcesso,
} from '@sgh/nucleo';
