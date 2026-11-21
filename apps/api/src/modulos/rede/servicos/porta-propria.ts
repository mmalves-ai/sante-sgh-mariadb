// Porta PRÓPRIA do registro de serviços compartilhados da Rede (M57, etapa 3) sobre o banco do cliente.
// As tabelas do registro (oportunidades de serviço compartilhado entre os estabelecimentos; não é o rateio
// `regra_servico_compartilhado` do financeiro) entraram no modelo na integração da onda 2 (02_ADM/06:
// `servico_compartilhado_rede` e `servico_compartilhado_rede_estabelecimento`); falta escrever a porta sobre elas. Até lá, toda chamada recusa com 501
// `pendente-modelo-proprio` (falha fechada: nada lido nem gravado), sem contorno em outra tabela.
// Melhoria (no DDL proposto): os estabelecimentos envolvidos numa tabela filha com chave estrangeira, no lugar de uma
// lista de códigos separada por vírgula; situação e área com CHECK; um registro por cliente (sem junção entre bancos).
import { ErroOperacao } from '@sgh/nucleo';
import type { PortaServicosRede } from './porta.js';

export function recusaServicosPendente(operacao: string): ErroOperacao {
  return new ErroOperacao(
    501,
    'pendente-modelo-proprio',
    'Ainda não disponível no banco próprio',
    `O registro de serviços compartilhados da Rede (${operacao}) aguarda a tabela no modelo do cliente.`,
  );
}

export class PortaServicosRedePropria implements PortaServicosRede {
  readonly destino = 'proprio' as const;

  listar(): Promise<never> {
    return Promise.reject(recusaServicosPendente('listar'));
  }

  ler(): Promise<never> {
    return Promise.reject(recusaServicosPendente('ler'));
  }

  registrar(): Promise<never> {
    return Promise.reject(recusaServicosPendente('registrar'));
  }

  alterar(): Promise<never> {
    return Promise.reject(recusaServicosPendente('alterar'));
  }
}
