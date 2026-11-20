// Parâmetros das especialidades sob demanda e do lactário, etapa 6 do M45 (ficha, seções 8 e 12; DP-32). Padrão de
// mercado como parâmetro (POL-1; regra comum 8 da Fase 5: meta a propor); a área dona troca o valor sem mudar código.
import type { DefinicaoParametro } from './definicoes.js';

export const PARAMETRO_OFTALMO_PIO_LIMITE = 'pep.oftalmologiaPioLimiteMmHg';
export const PARAMETRO_ONCO_SC_MAXIMA = 'pep.oncologiaSuperficieMaximaCentesimos';
export const PARAMETRO_ONCO_TOLERANCIA = 'pep.oncologiaToleranciaDuplaChecagemPct';
export const PARAMETRO_OBST_FASE_ATIVA = 'pep.obstetriciaFaseAtivaCm';
export const PARAMETRO_LACTARIO_VALIDADE = 'nutricao.lactarioValidadeHoras';

export const PARAMETROS_ESPECIALIDADES: readonly DefinicaoParametro[] = [
  {
    chave: PARAMETRO_OFTALMO_PIO_LIMITE,
    modulo: 'pep',
    descricao:
      'Pressão intraocular acima da qual o exame oftalmológico alerta hipertensão ocular, em mmHg (assimetria de 5 mmHg ou mais entre os olhos também alerta)',
    tipo: 'inteiro',
    padrao: '21',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 15,
    maximo: 40,
    dono: 'oftalmologia (diretoria clínica)',
    origem: 'padrão de mercado: PIO normal de 10 a 21 mmHg (Sociedade Brasileira de Glaucoma); DP-32',
  },
  {
    chave: PARAMETRO_ONCO_SC_MAXIMA,
    modulo: 'pep',
    descricao:
      'Teto da superfície corporal usada no cálculo da dose por m², em centésimos de m² (0 = sem teto, dose pelo peso real)',
    tipo: 'inteiro',
    padrao: '0',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 0,
    maximo: 300,
    dono: 'oncologia e farmácia clínica',
    origem:
      'ASCO 2012 (dose pelo peso real, sem teto de superfície, em adultos obesos); o serviço decide o teto institucional; DP-32',
  },
  {
    chave: PARAMETRO_ONCO_TOLERANCIA,
    modulo: 'pep',
    descricao:
      'Diferença máxima, em %, entre a dose calculada pelo sistema e a calculada pelo farmacêutico na dupla checagem (acima dela a validação é recusada)',
    tipo: 'inteiro',
    padrao: '5',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 1,
    maximo: 10,
    dono: 'farmácia clínica e oncologia',
    origem: 'padrão de mercado (dupla checagem independente de antineoplásicos, ISMP Brasil); DP-32',
  },
  {
    chave: PARAMETRO_OBST_FASE_ATIVA,
    modulo: 'pep',
    descricao:
      'Dilatação do colo, em cm, a partir da qual o trabalho de parto está na fase ativa (início das linhas de alerta e de ação do partograma)',
    tipo: 'inteiro',
    padrao: '4',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 4,
    maximo: 6,
    dono: 'obstetrícia (diretoria clínica)',
    origem:
      'Diretrizes Nacionais de Assistência ao Parto Normal (Ministério da Saúde, 2017): fase ativa a partir de 4 cm; OMS 2018 propõe 5 cm; DP-32',
  },
  {
    chave: PARAMETRO_LACTARIO_VALIDADE,
    modulo: 'nutricao',
    descricao:
      'Validade da fórmula preparada no lactário sob refrigeração, em horas desde o preparo (horário de porção depois dela é recusado)',
    tipo: 'inteiro',
    padrao: '24',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 24,
    dono: 'nutrição clínica (lactário)',
    origem:
      'padrão de mercado para fórmula reconstituída refrigerada (até 24 h; a nutrição confirma o valor do serviço); DP-32',
  },
];
