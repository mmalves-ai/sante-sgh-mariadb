// Textos da entrada por e-mail (família acesso-ligacao), na chave `acessoEmail`.
export const mensagensAcessoEmail = {
  codigoEnviado: 'Enviamos um código de 6 dígitos ao seu e-mail. Digite-o no campo do código.',
  codigoEsgotado: 'O código venceu ou as tentativas acabaram. Entre de novo para receber outro código.',
  semEmail:
    'A conta escolheu o código por e-mail, mas não tem e-mail cadastrado. Procure o gestor de acessos.',
  muitosEnvios: 'Muitos códigos pedidos na última hora. Aguarde e tente de novo.',
  esqueciPlataforma: 'Esqueci a senha da conta da plataforma',
  recuperar: {
    titulo: 'Recuperar a senha da conta da plataforma',
    email: 'E-mail da conta',
    informeEmail: 'Informe o e-mail da conta da plataforma.',
    pedir: 'Enviar o link',
    gerar: 'Gerar a senha provisória',
    linkRecebido:
      'Link recebido. Gere a senha provisória: ela aparece uma vez só, e a troca é exigida na entrada.',
    provisoria: 'Senha provisória da conta {login}:',
    aviso: 'Anote agora: ela não aparece de novo. Na entrada, o sistema pede a senha nova.',
    linkInvalido: 'O link é inválido, venceu ou já foi usado. Peça outro.',
    muitosPedidos: 'Muitos pedidos na última hora. Aguarde e tente de novo.',
    indisponivel: 'A recuperação por e-mail não está disponível neste endereço.',
    voltar: 'Voltar para a entrada',
  },
  metodo: {
    titulo: 'Segundo fator da entrada',
    aplicativo: 'Código do aplicativo autenticador',
    email: 'Código enviado ao meu e-mail',
    ajuda: 'O código por e-mail chega a cada entrada e vale por 5 minutos.',
    emailIndisponivel: 'O envio de e-mail não está disponível neste endereço.',
    salvo: 'Escolha gravada.',
    confirmeSenha: 'Confirme a senha (botão "Confirmar senha" da sessão) e tente de novo.',
    erro: 'Não foi possível gravar a escolha.',
  },
};
