// Textos das telas do prontuário ao vivo (M15). Sem nome de sistema antigo (ADR 0023).
import { mensagensPrescricao } from './i18n-prescricao.js';
import { mensagensDocumentos } from './i18n-documentos.js';
import { mensagensRegistroClinico } from './i18n-registro.js';
import { mensagensFormularioNovo } from './i18n-formulario-novo.js';
import { mensagensEquipePainel } from './i18n-equipe-painel.js';
import { mensagensSumarioSecoes } from './i18n-sumario-secoes.js';
import { mensagensResultadosGrupos } from './i18n-resultados-grupos.js';
import { mensagensFarmacovigilancia } from './i18n-farmacovigilancia.js';
import { mensagensNotasPaciente } from './i18n-notas-paciente.js';
import { mensagensPedidoVaga } from './i18n-pedido-vaga.js';
import { mensagensAnotacoesAdministrativas } from './i18n-anotacoes-administrativas.js';

export const mensagensPep = {
  // M22: registros clínicos e administração do PEP.
  reg: mensagensRegistroClinico,
  // M24: prescrição eletrônica, farmácia clínica e horários-padrão.
  presc: mensagensPrescricao,
  // M23: prontuário de uso diário.
  doc: mensagensDocumentos,
  // M45, etapa 1: construtor de formulários novos.
  formNovo: mensagensFormularioNovo,
  // F3.3 (L91, L94): equipe assistencial e regras do prontuário por setor.
  equipe: mensagensEquipePainel,
  // F3.3 (L124): seções configuráveis do sumário de alta.
  sumarioSecoes: mensagensSumarioSecoes,
  resultadosGrupos: mensagensResultadosGrupos,
  // F7 (03-PEP L103 e L104): reação adversa no paciente e uso contínuo.
  farmaco: mensagensFarmacovigilancia,
  // 03-PEP L102: notas e lembretes livres sobre o paciente.
  notas: mensagensNotasPaciente,
  // 02-AGE linha 53: pedido de vaga do médico no prontuário.
  pedidoVaga: mensagensPedidoVaga,
  // 03-PEP L147: anotação administrativa do caso.
  anotAdm: mensagensAnotacoesAdministrativas,
  carregando: 'Carregando…',
  busca: {
    titulo: 'Prontuário ao vivo: consulta',
    texto:
      'Procure o paciente por nome, nome da mãe, telefone, CPF, prontuário ou nascimento. O prontuário abre com os registros deste estabelecimento, lidos na hora; a primeira abertura do paciente pede o motivo do acesso.',
    termo: 'Paciente',
    buscar: 'Buscar',
    vazio: 'Nenhum paciente encontrado. Confira a grafia ou procure por outro dado.',
    legenda: 'Pacientes encontrados ({n})',
    abrir: 'Abrir o prontuário de {nome}',
    excecoes: 'Exceções do prontuário (relatório do arquivo médico)',
  },
  excecoes: {
    titulo: 'Exceções do prontuário',
    texto:
      'Registros com exceção neste estabelecimento, para o arquivo médico e a comissão de revisão de prontuário: só contagens por tipo, modelo e mês do lançamento, sem paciente. Contagens de 1 a 4 aparecem como "<5".',
    ilegivel:
      'Texto ou formulário ilegível não entra nesta contagem: ele aparece como aviso no próprio registro, ao ser aberto.',
    tipos: { 'sem-conteudo': 'Sem conteúdo', 'data-impossivel': 'Data impossível' },
    tipo: 'Exceção',
    modelo: 'Modelo',
    mes: 'Mês do lançamento',
    semMes: 'sem data',
    registros: 'Registros',
    totais: 'Totais: {sem} sem conteúdo; {datas} com data impossível.',
    vazio: 'Nenhuma exceção neste estabelecimento.',
    legenda: 'Exceções por tipo, modelo e mês',
    gerado: 'Contagem de {em}.',
    voltar: 'Voltar à busca do prontuário',
  },
  cabecalho: {
    regiao: 'Paciente',
    civil: 'Nome civil: {nome}',
    nascimento: 'Nascimento: {data}',
    semData: 'não informado',
    idade: '{anos} anos',
    prontuario: 'Prontuário {n}',
    sexo: { F: 'Feminino', M: 'Masculino' },
    obito: 'Óbito registrado',
  },
  motivo: {
    titulo: 'Motivo do acesso ao prontuário',
    texto:
      'Para abrir o prontuário deste paciente, informe o motivo. Ele fica registrado com cada leitura e pode ser conferido pela auditoria.',
    restricao:
      'Neste estabelecimento, o prontuário de paciente fora do atendimento só abre para quem atende o paciente ou com o acesso de emergência.',
    legenda: 'Motivo',
    confirmar: 'Abrir o prontuário',
    cancelar: 'Cancelar',
    aguardando: 'Informe o motivo do acesso para abrir o prontuário.',
  },
  categorias: {
    medico: 'Médico',
    enfermagem: 'Enfermagem',
    odontologia: 'Odontologia',
    farmacia: 'Farmácia',
    'outros-saude': 'Outros da saúde',
    outros: 'Outros',
  },
  filtros: {
    titulo: 'Filtros',
    de: 'De',
    ate: 'Até',
    modelo: 'Modelo',
    categoria: 'Categoria profissional',
    profissional: 'Profissional',
    todos: 'Todos',
    todas: 'Todas',
    aplicar: 'Aplicar',
    limpar: 'Limpar',
  },
  registros: {
    titulo: 'Registros do paciente',
    vazio: 'Nenhum registro com estes filtros.',
    legenda: 'Registros do prontuário, mais novos primeiro (página {pagina})',
    data: 'Data e hora',
    modelo: 'Modelo',
    profissional: 'Profissional',
    marcas: 'Marcas',
    abrir: 'Abrir o registro de {data}',
    paginacao: 'Páginas',
    anterior: 'Anterior',
    proxima: 'Próxima',
    pagina: 'Página {n}',
    excecoes:
      'Este prontuário tem {sem} registro(s) sem conteúdo e {datas} com data impossível. Eles aparecem na lista, marcados, e vão ao relatório do arquivo médico.',
  },
  marcas: {
    suspenso: 'Suspenso',
    correcao: 'Correção',
    retroativo: 'Retroativo',
    supervisao: 'Sob supervisão',
    semConteudo: 'Sem conteúdo',
    dataImpossivel: 'Data impossível',
    semData: 'sem data',
    semJustificativa: 'sem justificativa',
    suspensoEm: 'Suspenso em {em}. Justificativa: {motivo}.',
    corrige: 'Este registro corrige o',
    original: 'registro {id}',
    retroativoPorque: 'Lançado depois do horário do ato. Justificativa: {motivo}.',
    semIcp: 'Registro eletrônico sem assinatura digital qualificada (certificado ICP-Brasil).',
  },
  palavra: {
    titulo: 'Buscar palavra nos registros',
    termo: 'Palavra ou expressão',
    buscar: 'Buscar nos registros',
    resumo: '{n} registro(s) com a palavra, entre {lidos} lido(s).',
    ocorrencias: '{n} ocorrência(s)',
    truncado:
      'A busca leu o limite de registros: escolha um período menor nos filtros para ver os mais antigos.',
  },
  registro: {
    titulo: 'Registro do prontuário',
    voltar: 'Voltar aos registros do paciente',
    lancado: 'Gravado em',
    abas: 'Partes do registro',
    indisponivel: 'Parte indisponível neste registro.',
    eventos: 'Histórico do documento',
    textoVazio: 'Sem texto formatado.',
    ativoRemovido: '{n} conteúdo(s) ativo(s) do texto original (objeto, imagem ou link) não são exibidos.',
  },
  abas: {
    'como-emitido': 'Como emitido',
    layout: 'Formulário da época',
    texto: 'Texto formatado',
    respostas: 'Respostas',
    contexto: 'Contexto do ato',
  },
  campo: {
    vazio: '(em branco)',
    semTitulo: '(sem título)',
    autopreenchido: 'Preenchido automaticamente',
    naoMapeado: 'Campo de tipo antigo',
    nenhum: 'Nenhum campo.',
  },
  respostas: {
    vazio: 'Este registro não tem respostas estruturadas.',
    aConfirmar: 'a confirmar',
    resumo: '{total} resposta(s); {confirmar} com leitura a confirmar.',
  },
  contexto: {
    paciente: 'Paciente no momento do ato',
    atendimento: 'Atendimento',
    entrada: 'Entrada',
    unidade: 'Unidade',
    leito: 'Leito',
    convenio: 'Convênio',
    cid: 'CID principal',
    assistente: 'Médico assistente',
    profissional: 'Profissional do registro',
    responsavel: 'Responsável',
  },
  acessos: {
    titulo: 'Registro de acesso ao prontuário',
    texto:
      'Leituras do prontuário neste estabelecimento: quem abriu, quando, de onde, o paciente e o registro, a parte aberta e o motivo. Nenhum conteúdo clínico.',
    paciente: 'Paciente (número)',
    usuario: 'Usuário',
    estacao: 'Estação',
    registro: 'Registro',
    parte: 'Parte',
    motivo: 'Motivo',
    origem: 'Suporte técnico',
    em: 'Quando',
    exportar: 'Exportar CSV',
    vazio: 'Nenhuma leitura com estes filtros.',
    legenda: 'Leituras do prontuário, mais novas primeiro (página {pagina})',
    soAlertas: 'Só os alertas ao Auditor',
    alerta: 'Alerta',
    alertas: {
      'muitos-prontuarios': 'Muitos prontuários em pouco tempo',
      'fora-do-horario': 'Fora do horário habitual',
    },
    criticidade: { 2: 'alerta', 4: 'erro' },
  },
  partes: {
    lista: 'Lista de registros',
    registro: 'Registro',
    'como-emitido': 'Como emitido',
    layout: 'Formulário da época',
    texto: 'Texto formatado',
    respostas: 'Respostas',
    contexto: 'Contexto do ato',
    busca: 'Busca de palavra',
    emergencia: 'Acesso de emergência',
    motivo: 'Motivo informado',
    alerta: 'Alerta ao Auditor',
  },
  paleta: {
    abrir: 'Abrir prontuário: {termo}',
    detalhe: 'Prontuário ao vivo (busca do paciente)',
  },
} as const;
