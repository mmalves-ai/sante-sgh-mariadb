// Parâmetros do diagnóstico por setor (F3.5, 05-SADT linha 25): numeração do exame, impressão do laudo e da etiqueta e
// obrigatoriedades do pedido, um conjunto por setor (`sadt.<setor>.<nome>`), definidos para a rede e o estabelecimento,
// com vigência. A leitura do setor (GET /api/sadt/parametros) mostra só os do próprio setor. A semente no banco é a
// migração 10_SADT/97_parametros_setor (mesmas chaves e padrões).
import { SETORES_SADT, type SetorSadt } from '../sadt/vocabulario.js';
import type { DefinicaoParametro } from './definicoes.js';

const ORIGEM = 'ficha F3.5, 05-SADT linha 25 (parâmetros do diagnóstico por setor, com vigência)';

type Modelo = Omit<DefinicaoParametro, 'chave' | 'modulo' | 'niveis' | 'critico' | 'origem' | 'padrao'> & {
  readonly nome: string;
  readonly padrao: (s: SetorSadt) => string;
};

const MODELOS: readonly Modelo[] = [
  {
    nome: 'numeracaoExame',
    descricao: 'Como o número do exame do setor reinicia: contínua, por ano, por mês ou por dia',
    tipo: 'lista',
    padrao: () => 'continua',
    opcoes: ['continua', 'anual', 'mensal', 'diaria'],
    dono: 'coordenação do setor',
  },
  {
    nome: 'prefixoNumeracao',
    descricao:
      'Prefixo impresso antes do número do exame do setor (letras maiúsculas, dígitos e hífen; vazio: sem prefixo)',
    tipo: 'texto',
    padrao: () => '',
    formato: { expressao: '^[A-Z0-9-]{0,10}$', mensagem: 'Use até 10 letras maiúsculas, dígitos ou hífen.' },
    dono: 'coordenação do setor',
  },
  {
    nome: 'viasLaudo',
    descricao: 'Vias impressas do laudo do setor na entrega',
    tipo: 'inteiro',
    padrao: () => '1',
    minimo: 1,
    maximo: 5,
    dono: 'coordenação do setor',
  },
  {
    nome: 'imprimeResponsavelTecnico',
    descricao: 'Imprime o responsável técnico do setor no laudo',
    tipo: 'booleano',
    padrao: () => 'true',
    dono: 'responsável técnico do setor',
  },
  {
    nome: 'imprimeEtiquetaNaColeta',
    descricao: 'Imprime a etiqueta da amostra ou do exame no momento da coleta ou do recebimento',
    tipo: 'booleano',
    padrao: () => 'true',
    dono: 'coordenação do setor',
  },
  {
    nome: 'exigeCid',
    descricao: 'Exige o CID (Classificação Internacional de Doenças) no pedido de exame do setor',
    tipo: 'booleano',
    padrao: () => 'false',
    dono: 'diretoria clínica',
  },
  {
    nome: 'exigeSolicitante',
    descricao: 'Exige o profissional solicitante no pedido de exame do setor',
    tipo: 'booleano',
    padrao: () => 'true',
    dono: 'diretoria clínica',
  },
  {
    nome: 'exigeMaterial',
    descricao: 'Exige o material biológico no pedido de exame do setor',
    tipo: 'booleano',
    padrao: (s) => (s === 'laboratorio' ? 'true' : 'false'),
    dono: 'coordenação do setor',
  },
];

const ROTULO_MINUSCULO: Readonly<Record<SetorSadt, string>> = {
  laboratorio: 'laboratório',
  imagem: 'imagem',
  metodosGraficos: 'métodos gráficos',
  endoscopia: 'endoscopia',
};

export const PARAMETROS_SADT_SETOR: readonly DefinicaoParametro[] = SETORES_SADT.flatMap(({ codigo }) =>
  MODELOS.map(({ nome, padrao, descricao, ...resto }) => ({
    ...resto,
    chave: `sadt.${codigo}.${nome}`,
    modulo: 'sadt',
    descricao: `${descricao} (${ROTULO_MINUSCULO[codigo]})`,
    padrao: padrao(codigo),
    niveis: ['estabelecimento', 'rede'] as const,
    critico: false,
    origem: ORIGEM,
  })),
);
