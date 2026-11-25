// O e-mail da porta de entrada mora no núcleo (@sgh/nucleo, email-acesso.ts), para a API e as ferramentas
// (plataforma:criar-admin) usarem o mesmo caminho sem a ferramenta importar a aplicação.
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
