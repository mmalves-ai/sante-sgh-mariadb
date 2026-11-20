// Parâmetros da assinatura ICP-Brasil (M49; ficha, regras 1, 3, 5, 9 e 10; DP-22 sem resposta → POL-1 com o padrão
// das referências: DOC-ICP-15, SBIS-37 e cap-13 §13.6.4). A resposta da DP-22 troca o valor sem mudar código. O
// provedor contratado e os segredos não são parâmetro: o provedor é cadastro (tela de provedores) e o segredo fica
// no cofre.
import type { DefinicaoParametro } from './definicoes.js';

export const PARAMETROS_DOCUMENTO_ASSINATURA: readonly DefinicaoParametro[] = [
  {
    chave: 'documento.assinaturaMinimoAutoridades',
    modulo: 'documento',
    descricao:
      'Quantas autoridades certificadoras diferentes cada mídia (nuvem, A1, A3) tem de aceitar para o serviço ligar',
    tipo: 'inteiro',
    padrao: '2',
    niveis: ['rede'],
    critico: true,
    minimo: 1,
    maximo: 10,
    dono: 'TI',
    origem: 'ficha do M49, regra 1 (ICP-02: pelo menos duas ACs por mídia)',
  },
  {
    chave: 'documento.assinaturaTentativas',
    modulo: 'documento',
    descricao:
      'Tentativas automáticas de reprocessar a assinatura pendente (revogação, carimbo ou provedor fora do ar) antes de virar falha',
    tipo: 'inteiro',
    padrao: '12',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 100,
    dono: 'TI',
    origem:
      'ficha do M49, regra 5 (SBIS-37); padrão: 12 tentativas com espera crescente (cerca de 24 h no total)',
  },
  {
    chave: 'documento.assinaturaEsperaInicialMin',
    modulo: 'documento',
    descricao:
      'Espera da primeira nova tentativa da assinatura pendente, em minutos (dobra a cada tentativa, até 4 h)',
    tipo: 'inteiro',
    padrao: '5',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 240,
    dono: 'TI',
    origem: 'ficha do M49, regra 5; cap-13 §13.6.4',
  },
  {
    chave: 'documento.autorizacaoPscMin',
    modulo: 'documento',
    descricao:
      'Validade da autorização pedida ao provedor em nuvem para um lote, em minutos (lifetime do OAuth)',
    tipo: 'inteiro',
    padrao: '15',
    niveis: ['rede'],
    critico: true,
    minimo: 1,
    maximo: 720,
    dono: 'TI',
    origem:
      'ficha do M49, regras 1 e 10 (DOC-ICP-17.01 v3.0, item 6.4); padrão curto: um lote por autorização',
  },
  {
    chave: 'documento.verificadorConsultasPorMinuto',
    modulo: 'documento',
    descricao:
      'Consultas por minuto, por origem, aceitas no verificador público de documentos (contra varredura)',
    tipo: 'inteiro',
    padrao: '20',
    niveis: ['rede'],
    critico: false,
    minimo: 1,
    maximo: 600,
    dono: 'TI',
    origem: 'ficha do M49, regra 9 (cap-07 §7.6; cap-12 §12.4)',
  },
  {
    chave: 'documento.atestaCfm',
    modulo: 'documento',
    descricao:
      'Enviar o atestado ao serviço de atestados do conselho de medicina (desligado: resolução suspensa)',
    tipo: 'booleano',
    padrao: 'false',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'diretoria clínica',
    origem:
      'ficha do M49, regra 10 (DOC-06; DP-47.1: Res. CFM 2.382/2024 suspensa por liminar; o atestado é emitido aqui pela Res. CFM 2.381/2024, com ICP-Brasil)',
  },
];
