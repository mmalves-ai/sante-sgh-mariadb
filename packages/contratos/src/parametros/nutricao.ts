// Parâmetros da nutrição e do serviço de nutrição e dietética, etapa 5 do M45 (ficha, regras 10 e 11; cap-05b §5.9;
// cap-06a §6.3). Padrão de mercado como parâmetro (POL-1; regra comum 8 da Fase 5: meta a propor); a nutrição é a dona:
// a resposta dela troca o valor sem mudar código. O corte de cada refeição é por unidade (o bloco da internação).
import type { DefinicaoParametro } from './definicoes.js';

const NUTRICAO = 'nutrição clínica e serviço de nutrição e dietética';

export const PARAMETROS_NUTRICAO: readonly DefinicaoParametro[] = [
  {
    chave: 'nutricao.triagemPrazoHoras',
    modulo: 'nutricao',
    descricao:
      'Prazo da triagem nutricional depois da admissão, em horas (vencido, o paciente aparece em vermelho na fila)',
    tipo: 'inteiro',
    padrao: '48',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 12,
    maximo: 96,
    dono: NUTRICAO,
    origem: 'ficha do M45, regra 10 (em até 48 h da admissão); cap-05b §5.9',
  },
  {
    chave: 'nutricao.triagemPreferencialHoras',
    modulo: 'nutricao',
    descricao: 'Prazo preferencial da triagem nutricional, em horas (passado, o paciente aparece em atenção)',
    tipo: 'inteiro',
    padrao: '24',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 6,
    maximo: 72,
    dono: NUTRICAO,
    origem: 'ficha do M45, regra 10 (de preferência em 24 h); cap-05b §5.9',
  },
  {
    chave: 'nutricao.triagemReavaliacaoDias',
    modulo: 'nutricao',
    descricao: 'Dias até a reavaliação da triagem sem risco nutricional (NRS-2002: semanal)',
    tipo: 'inteiro',
    padrao: '7',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 30,
    dono: NUTRICAO,
    origem: 'NRS-2002 (Kondrup, 2003): sem risco, reavaliar semanalmente; padrão de mercado',
  },
  {
    chave: 'nutricao.metaAdequadaPct',
    modulo: 'nutricao',
    descricao:
      'Percentual da meta calórica e proteica considerado adequado no dia (abaixo dele, o acompanhamento pede o motivo)',
    tipo: 'inteiro',
    padrao: '80',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 50,
    maximo: 100,
    dono: 'EMTN',
    origem: 'cap-05b §5.9 (adequação calórica e proteica); padrão de mercado (BRASPEN: 80% da meta)',
  },
  {
    chave: 'nutricao.corteAntecedenciaMin',
    modulo: 'nutricao',
    descricao:
      'Antecedência do corte de cada refeição em relação ao horário de servir, em minutos (o mapa usa a última prescrição até o corte)',
    tipo: 'inteiro',
    padrao: '120',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 15,
    maximo: 600,
    dono: NUTRICAO,
    origem: 'ficha do M45, regra 11 (corte de cada refeição, parametrizado por unidade); cap-06a §6.3',
  },
  {
    chave: 'nutricao.cortesRefeicao',
    modulo: 'nutricao',
    descricao:
      'Corte próprio por refeição, quando difere da antecedência padrão: pares código=HH:MM separados por ponto e vírgula (ex.: 2=09:30;5=15:30)',
    tipo: 'texto',
    padrao: '',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    formato: {
      expressao: '^$|^\\d{1,2}=([01]\\d|2[0-3]):[0-5]\\d(;\\d{1,2}=([01]\\d|2[0-3]):[0-5]\\d)*$',
      mensagem: 'Use pares código=HH:MM separados por ponto e vírgula (ex.: 2=09:30;5=15:30).',
    },
    dono: NUTRICAO,
    origem: 'ficha do M45, regra 11 (corte de cada refeição, parametrizado por unidade); cap-06a §6.3',
  },
  {
    chave: 'nutricao.fechamentoToleranciaHoras',
    modulo: 'nutricao',
    descricao:
      'Até quantas horas depois do horário de servir o mapa da refeição ainda pode ser fechado (depois, o retrato não seria mais o do corte)',
    tipo: 'inteiro',
    padrao: '24',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 48,
    dono: NUTRICAO,
    origem:
      'ficha do M45, regra 11 (retrato do mapa no corte); correção da revisão do M45.5: o mapa de dias atrás não fecha com o censo de agora',
  },
  {
    chave: 'nutricao.cadastrosPorLoginMax',
    modulo: 'nutricao',
    descricao:
      'Quantos cadastros de profissional um login pode ter para a categoria (nutricionista, assistente social, EMTN) valer; acima disso é conta compartilhada e a categoria não é reconhecida',
    tipo: 'inteiro',
    padrao: '3',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 20,
    dono: 'segurança da informação e nutrição',
    origem:
      'correção da revisão do M45.5 (D-VINCULO-455): a cópia tem logins ligados a centenas de cadastros de profissional; o ato e o parecer sigiloso exigem o login pessoal',
  },
  {
    chave: 'nutricao.jejumCirurgiaHoras',
    modulo: 'nutricao',
    descricao:
      'Horas de jejum antes da cirurgia agendada (a refeição nesse intervalo, ou durante a cirurgia, sai em jejum no mapa)',
    tipo: 'inteiro',
    padrao: '8',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 2,
    maximo: 24,
    dono: 'nutrição e centro cirúrgico',
    origem:
      'ficha do M45, regra 11 (jejum agendado prevalece); ASA, jejum pré-operatório de 8 h para refeição completa',
  },
  {
    chave: 'nutricao.jejumExameHoras',
    modulo: 'nutricao',
    descricao: 'Horas de jejum antes do exame agendado que pede jejum',
    tipo: 'inteiro',
    padrao: '8',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 2,
    maximo: 24,
    dono: 'nutrição e serviço de diagnóstico',
    origem: 'ficha do M45, regra 11 (jejum agendado de exames prevalece); padrão de mercado',
  },
  {
    chave: 'nutricao.examesComJejum',
    modulo: 'nutricao',
    descricao:
      'Códigos dos exames agendados que pedem jejum, separados por vírgula (vazio: nenhum exame agendado suspende a refeição)',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    formato: {
      expressao: '^$|^[A-Za-z0-9]{1,10}(,[A-Za-z0-9]{1,10})*$',
      mensagem: 'Use os códigos dos exames separados por vírgula (ex.: USABD,ENDO).',
    },
    dono: 'nutrição e serviço de diagnóstico',
    origem:
      'ficha do M45, regra 11 (jejum de exames agendados); o cadastro de exames não marca o preparo com jejum: a lista é do serviço',
  },
  // W0-05 (ficha EMTN completa).
  {
    chave: 'nutricao.alertaMetaDias',
    modulo: 'nutricao',
    descricao:
      'Dias seguidos com a meta calórica ou proteica abaixo do adequado que acendem o alerta de meta não atingida na ficha da EMTN',
    tipo: 'inteiro',
    padrao: '3',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 10,
    dono: 'EMTN (equipe multiprofissional de terapia nutricional)',
    origem:
      'W0-05 (mercado: meta não atingida por 3 dias seguidos aciona a reavaliação da EMTN); RDC 503/2021 (acompanhamento da terapia enteral)',
  },
  {
    chave: 'nutricao.nptOrigem',
    modulo: 'nutricao',
    descricao:
      'De onde vem a nutrição parenteral: a ficha da EMTN (terapia informada) ou a ordem de NPT com composição da prescrição eletrônica',
    tipo: 'lista',
    padrao: 'ficha-emtn',
    opcoes: ['ficha-emtn', 'cpoe'],
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'EMTN e farmácia',
    origem:
      'W0-05: enquanto a ordem de NPT com composição não existe na prescrição (pacote da prescrição eletrônica), a NPT entra na ficha da EMTN; Portaria SVS/MS 272/1998',
  },
];
