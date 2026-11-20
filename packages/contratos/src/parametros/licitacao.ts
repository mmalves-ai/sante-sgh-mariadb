// Parâmetros do processo formal de compra (M55, fatia F4; ficha, regra 9: "módulo configurável por estabelecimento
// (regras, alçadas, publicação ligadas ou desligadas)"; Lei 14.133/2021). Os padrões são os da lei (arts. 23, 53, 55,
// 75 e 165) e do Decreto 12.343/2024 (os limites da dispensa por valor vigentes em 2025); o jurídico troca por
// estabelecimento (o regulamento próprio de compras tem os seus) sem mudar código.
import type { DefinicaoParametro } from './definicoes.js';

const comum = {
  modulo: 'licitacao',
  niveis: ['estabelecimento', 'rede'] as const,
  dono: 'jurídico e diretoria administrativa',
};

export const PARAMETROS_LICITACAO: readonly DefinicaoParametro[] = [
  {
    ...comum,
    chave: 'licitacao.minimoPrecos',
    descricao:
      'Número mínimo de preços pesquisados por item; com menos, o processo só segue com a justificativa da pesquisa',
    tipo: 'inteiro',
    padrao: '3',
    critico: false,
    minimo: 1,
    maximo: 10,
    origem:
      'Lei 14.133/2021, art. 23 §1 (pesquisa com fontes diversas); padrão de mercado de 3 cotações (POL-1)',
  },
  {
    ...comum,
    chave: 'licitacao.metodoEstimativa',
    descricao: 'Como o valor estimado de cada item sai dos preços pesquisados: mediana, média ou menor preço',
    tipo: 'lista',
    padrao: 'mediana',
    opcoes: ['mediana', 'media', 'menor'],
    critico: false,
    origem:
      'Lei 14.133/2021, art. 23 (o valor estimado compatível com o de mercado); padrão de mercado (POL-1)',
  },
  {
    ...comum,
    chave: 'licitacao.prazoRecursoDiasUteis',
    descricao: 'Prazo do recurso contra o julgamento, em dias úteis; a homologação espera o fim dele',
    tipo: 'inteiro',
    padrao: '3',
    critico: true,
    minimo: 0,
    maximo: 15,
    origem: 'Lei 14.133/2021, art. 165, I',
  },
  {
    ...comum,
    chave: 'licitacao.prazoAvisoRegulamentoDiasUteis',
    descricao:
      'No regulamento próprio de compras: prazo mínimo, em dias úteis, entre a publicação do aviso e a abertura',
    tipo: 'inteiro',
    padrao: '5',
    critico: false,
    minimo: 1,
    maximo: 60,
    origem: 'regulamento próprio de compras (entidade privada); padrão de mercado (POL-1)',
  },
  {
    ...comum,
    chave: 'licitacao.exigeParecer',
    descricao: 'Exigir o parecer jurídico do edital antes da publicação do aviso (Lei 14.133/2021)',
    tipo: 'booleano',
    padrao: 'sim',
    critico: true,
    origem: 'Lei 14.133/2021, art. 53',
  },
  {
    ...comum,
    chave: 'licitacao.limiteDispensaObrasCentavos',
    descricao:
      'Limite da dispensa pelo valor para obra e serviço de engenharia (art. 75, I), em centavos; atualizado por decreto a cada ano',
    tipo: 'inteiro',
    padrao: '12545115',
    critico: true,
    minimo: 0,
    maximo: 100_000_000_000,
    origem: 'Lei 14.133/2021, art. 75, I; Decreto 12.343/2024 (R$ 125.451,15)',
  },
  {
    ...comum,
    chave: 'licitacao.limiteDispensaDemaisCentavos',
    descricao:
      'Limite da dispensa pelo valor para as demais compras e serviços (art. 75, II), em centavos; atualizado por decreto a cada ano',
    tipo: 'inteiro',
    padrao: '6272559',
    critico: true,
    minimo: 0,
    maximo: 100_000_000_000,
    origem: 'Lei 14.133/2021, art. 75, II; Decreto 12.343/2024 (R$ 62.725,59)',
  },
];
