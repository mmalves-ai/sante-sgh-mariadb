// Parâmetros da lista de trabalho DICOM e do PACS, etapa 3 do M47 (ficha, regra 8; cap-05b §5.10; cap-12 §12.4). A TI
// e a coordenação da imagem são as donas: trocar a modalidade de um setor, a janela da geração automática ou o endereço
// do visualizador muda o valor, não o código (POL-1).
import type { DefinicaoParametro } from './definicoes.js';

const DONO = 'TI e coordenação da imagem';

export const PARAMETROS_PACS: readonly DefinicaoParametro[] = [
  {
    chave: 'pacs.modalidadePorSetor',
    modulo: 'sadt',
    descricao:
      'Modalidade DICOM de cada setor de imagem (código do setor e a sigla da modalidade, separados por ponto e vírgula); o exame cujo cadastro já tem a modalidade usa a do cadastro',
    tipo: 'texto',
    padrao: '16:CR;24:US;25:CT;26:MR;27:US;42:OT',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    formato: {
      expressao: '^$|^\\d{1,4}:[A-Z]{2,8}(;\\d{1,4}:[A-Z]{2,8})*$',
      mensagem: 'Use setor:SIGLA separados por ponto e vírgula (ex.: 16:CR;25:CT).',
    },
    dono: DONO,
    origem:
      'ficha do M47, regra 8 (setor com modalidade DICOM); padrão de mercado: radiologia CR, ultrassom US, tomografia CT, ressonância MR',
  },
  {
    chave: 'pacs.janelaDias',
    modulo: 'sadt',
    descricao:
      'Dias para trás em que os exames de imagem lançados entram sozinhos na lista de trabalho (geração automática)',
    tipo: 'inteiro',
    padrao: '2',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 30,
    dono: DONO,
    origem: 'ficha do M47, seção 4 (worklist de imagem a enviar: setor + data; meta a propor)',
  },
  {
    chave: 'pacs.visualizadorUrl',
    modulo: 'sadt',
    descricao:
      'Endereço do visualizador de imagens com {estudo} (UID do estudo) e {acesso} (número de acesso); vazio, o prontuário mostra o estudo sem o link',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    formato: {
      expressao: '^$|^https?://[^\\s"\'<>]+\\{(estudo|acesso)\\}[^\\s"\'<>]*$',
      mensagem:
        'Use um endereço http(s) com {estudo} ou {acesso} (ex.: https://pacs.exemplo/viewer?study={estudo}).',
    },
    dono: DONO,
    origem: 'ficha do M47, regra 8 (link do visualizador no PEP e no portal)',
  },
  {
    chave: 'pacs.visualizador',
    modulo: 'sadt',
    descricao: 'Visualizador de imagens em uso (um dos visualizadores cadastrados na imagem)',
    tipo: 'lista',
    padrao: 'OVIYAM',
    opcoes: ['OVIYAM', 'WEASIS'],
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: DONO,
    origem: 'ficha do M47, seções 4 e 6 (o visualizador do cadastro de visualizadores da imagem)',
  },
  {
    chave: 'pacs.parceiroWorklist',
    modulo: 'sadt',
    descricao:
      'Código do parceiro de integração (o PACS; fora de produção, o simulador) que recebe a lista de trabalho DICOM deste estabelecimento; vazio, nenhum exame do estabelecimento vai à lista de trabalho',
    tipo: 'texto',
    padrao: '',
    // Só por estabelecimento: o destino de um hospital nunca vale para outro (dado de paciente).
    niveis: ['estabelecimento'],
    critico: true,
    formato: {
      expressao: '^$|^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$',
      mensagem: 'Use o código do parceiro cadastrado em Integrações › Parceiros (letras, números, hífen).',
    },
    dono: DONO,
    origem: '05-SADT linha 20 (o destino da lista de trabalho por estabelecimento, sem chave de liberação)',
  },
];
