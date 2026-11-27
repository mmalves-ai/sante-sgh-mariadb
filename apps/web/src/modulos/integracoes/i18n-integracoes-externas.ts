// Textos da central de integrações externas (decisão 53), em português claro para quem administra o hospital.
export const mensagensIntegracoesExternas = {
  titulo: 'Integrações externas',
  texto:
    'Cada serviço de fora com que o sistema conversa (operadoras, banco, governo, equipamentos) aparece aqui. Toda ' +
    'integração nasce no simulador, que responde como o serviço real sem mandar nada para fora. O real só fala com o ' +
    'fornecedor em produção, com os parâmetros e as credenciais completos e a chave do real ligada.',
  carregando: 'Carregando as integrações…',
  ambiente: {
    producao: 'Ambiente de produção: as integrações com o real ligado e completo falam com o fornecedor.',
    foraProducao:
      'Este ambiente não é produção: nenhuma integração fala com fornecedor. Ligar o real aqui fica gravado, mas ' +
      'neutralizado, e tudo segue no simulador.',
    semCofre:
      'O cofre de credenciais não está disponível neste ambiente: não dá para saber se as credenciais estão ' +
      'definidas nem guardar novas.',
  },
  areas: {
    faturamento: 'Faturamento',
    financeiro: 'Financeiro',
    pessoas: 'Gestão de pessoas',
    fiscal: 'Fiscal',
    laboratorio: 'Laboratório',
    sus: 'SUS',
    paciente: 'Paciente',
    cadastro: 'Cadastro',
    regulacao: 'Regulação',
  },
  selos: {
    simulador: 'Simulador',
    'real-incompleto': 'Real ligado, mas incompleto: segue no simulador',
    'real-neutralizado': 'Real ligado, neutralizado neste ambiente: segue no simulador',
    'real-configurado': 'Real: falando com o fornecedor',
    'real-com-falha': 'Real com falha',
  },
  selo: 'Situação',
  area: 'Área',
  funcoes: 'Usada em',
  faltam: 'Falta para o real ficar completo:',
  ultimaFalha: 'Última falha do real em {quando}: {motivo}',
  alterado: 'Última alteração em {quando}, por {quem}.',
  nuncaAlterada: 'Ainda não configurada.',
  fornecedor: {
    titulo: 'Passe a definição à equipe de desenvolvimento',
    texto:
      'O real desta integração só pode ser escrito depois que o fornecedor entregar a definição da API. Peça ao ' +
      'fornecedor os itens abaixo e passe tudo à equipe de desenvolvimento. Até lá, o sistema usa o simulador.',
  },
  configurar: 'Configurar',
  semPermissao:
    'Você pode ver as integrações, mas não alterá-las. Peça a quem tem a permissão de gerir as integrações externas.',
  parametros: {
    titulo: 'Parâmetros',
    texto:
      'Dados que não são segredo, como o endereço do serviço. Os marcados com * são obrigatórios para o real.',
    nenhum: 'Esta integração não tem parâmetros.',
    obrigatorio: '{rotulo} *',
    gravar: 'Gravar parâmetros',
    gravado: 'Parâmetros de {nome} gravados.',
  },
  credenciais: {
    titulo: 'Credenciais',
    texto:
      'Usuários, senhas e certificados vão direto ao cofre. Depois de guardados, nunca voltam à tela: aqui aparece ' +
      'só se cada um está definido.',
    definida: 'Definida',
    naoDefinida: 'Não definida',
    desconhecida: 'Não dá para saber (cofre indisponível)',
    campo: 'Credencial',
    valor: 'Valor da credencial',
    valorAjuda: 'O valor não é mostrado de volta. Para trocar, guarde de novo.',
    guardar: 'Guardar credencial',
    guardada: 'Credencial "{campo}" de {nome} guardada no cofre.',
  },
  modo: {
    titulo: 'Simulador ou real',
    texto:
      'O real só fala com o fornecedor em produção e com tudo completo. Ligar ou desligar exige justificativa e a ' +
      'sua senha de novo; fica registrado na trilha.',
    atual: 'Chave atual: {modo}.',
    simulador: 'Simulador',
    real: 'Real',
    escolha: 'Usar',
    justificativa: 'Justificativa (10 caracteres ou mais)',
    gravar: 'Gravar a chave',
    gravado: '{nome}: chave gravada em "{modo}".',
    neutralizado:
      'Gravado, mas neutralizado neste ambiente: aqui não é produção, então {nome} segue no simulador e nada sai ' +
      'para o fornecedor.',
  },
};
