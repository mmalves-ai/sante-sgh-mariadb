// Parâmetros da rouparia e lavanderia (M55, fatia F2; ficha, regra 4; manual m18 "Rouparia e lavanderia"). Os valores
// padrão são o padrão de mercado da hotelaria hospitalar (POL-1); a hotelaria troca por estabelecimento sem mudar código.
import type { DefinicaoParametro } from './definicoes.js';

export const PARAMETROS_ROUPARIA: readonly DefinicaoParametro[] = [
  {
    chave: 'rouparia.toleranciaDiferencaPct',
    modulo: 'rouparia',
    descricao:
      'Diferença aceita entre o peso enviado à lavanderia e o peso que retornou, em %; acima dela o retorno vira ocorrência para o fornecedor',
    tipo: 'inteiro',
    padrao: '5',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 30,
    dono: 'hotelaria (rouparia)',
    origem: 'manual m18, "Rouparia e lavanderia" (tolerância do contrato); padrão de mercado (POL-1)',
  },
  {
    chave: 'rouparia.prazoRetornoHoras',
    modulo: 'rouparia',
    descricao:
      'Prazo, em horas, para a roupa enviada à lavanderia retornar; depois dele o envio aparece atrasado',
    tipo: 'inteiro',
    padrao: '48',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 4,
    maximo: 240,
    dono: 'hotelaria (rouparia)',
    origem: 'ficha do M55, fatia F2; padrão de mercado da lavanderia hospitalar (POL-1)',
  },
  {
    chave: 'rouparia.precoKgCentavos',
    modulo: 'rouparia',
    descricao:
      'Preço do quilo de roupa lavada, em centavos (o contrato da lavanderia ou o custo da própria); zero deixa o custo por paciente-dia sem cálculo',
    tipo: 'inteiro',
    padrao: '0',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 100_000,
    dono: 'hotelaria (rouparia) e controladoria',
    origem: 'manual m18, indicador "custo da lavanderia por paciente-dia"',
  },
  {
    chave: 'rouparia.cancelamentoHoras',
    modulo: 'rouparia',
    descricao:
      'Prazo, em horas desde o registro, para cancelar um movimento da rouparia; depois, só movimento de correção',
    tipo: 'inteiro',
    padrao: '24',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 168,
    dono: 'hotelaria (rouparia)',
    origem: 'ficha do M55, fatia F2 (movimento auditado, sem exclusão)',
  },
];
