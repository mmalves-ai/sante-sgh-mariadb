// F3.8, 07-FIN linha 89: o cartão na sessão sintética (sem banco do cliente). Só as leituras que o recebimento do
// caixa usa: as administradoras e bandeiras dos combos e a prévia do crédito, calculada pela mesma regra do domínio
// (taxa vigente por modalidade e faixa de parcelas, parcelas líquidas com a data prevista). Nada é gravado aqui: a
// gravação do cartão existe só no banco do cliente (cartao-propria.ts).
import { escolherTaxa, gerarParcelasRecebivel, type TaxaAdministradora } from '@sgh/dominio-financeiro';
import { recusa } from '@sgh/nucleo';
import type { OpcoesCartao, PedidoCartao, PlanoCartao } from './cartao-propria.js';

const ADMINISTRADORA = 1;
const taxa = (
  id: number,
  modalidade: 'credito' | 'debito',
  parcelaInicial: number,
  parcelaFinal: number,
  percentual: number,
  diasRepasse: number,
): TaxaAdministradora => ({
  id,
  administradora: ADMINISTRADORA,
  bandeira: null,
  modalidade,
  parcelaInicial,
  parcelaFinal,
  tipo: 'percentual',
  percentual,
  valor: null,
  diasRepasse,
  vigenciaInicio: '2020-01-01',
  vigenciaFim: null,
  ativo: true,
});
const TAXAS: readonly TaxaAdministradora[] = [
  taxa(1, 'debito', 1, 1, 1, 1),
  taxa(2, 'credito', 1, 1, 2, 30),
  taxa(3, 'credito', 2, 12, 3, 30),
];
const OPCOES: OpcoesCartao = {
  administradoras: [
    {
      id: ADMINISTRADORA,
      versao: 1,
      nome: 'Administradora Sintética',
      diasParaPagamento: 30,
      contaBancaria: null,
      permiteParcelamento: true,
      ativo: true,
    },
  ],
  bandeiras: [
    { id: 1, nome: 'Bandeira Sintética Crédito', modalidade: 'credito' },
    { id: 2, nome: 'Bandeira Sintética Débito', modalidade: 'debito' },
    { id: 3, nome: 'Bandeira Sintética Crédito e Débito', modalidade: 'credito_debito' },
  ],
};
const r2 = (v: number) => Math.round(v * 100) / 100;

export const opcoesCartaoMemoria = (): OpcoesCartao => OPCOES;

export function planoDoCartaoMemoria(p: PedidoCartao): PlanoCartao {
  const bandeira = OPCOES.bandeiras.find((b) => b.id === p.bandeira);
  if (p.administradora !== ADMINISTRADORA)
    throw recusa('administradora-cartao-inexistente', 'A administradora do cartão não existe.', {
      campos: ['administradora'],
    });
  if (!bandeira || ![p.modalidade, 'credito_debito'].includes(bandeira.modalidade))
    throw recusa('bandeira-cartao-modalidade', 'Esta bandeira não é aceita nesta modalidade de cartão.', {
      campos: ['bandeira', 'modalidade'],
    });
  const escolha = escolherTaxa(TAXAS, {
    administradora: p.administradora,
    bandeira: p.bandeira,
    modalidade: p.modalidade,
    parcelas: p.parcelas,
    data: p.dataVenda,
  });
  if ('recusa' in escolha) throw recusa(escolha.recusa.codigo, escolha.recusa.mensagem);
  const gerado = gerarParcelasRecebivel({
    valor: p.valor,
    parcelas: p.parcelas,
    dataVenda: p.dataVenda,
    taxa: escolha.taxa,
  });
  if ('recusa' in gerado) throw recusa(gerado.recusa.codigo, gerado.recusa.mensagem);
  const bruto = r2(gerado.parcelas.reduce((s, x) => s + x.bruto, 0));
  const taxaTotal = r2(gerado.parcelas.reduce((s, x) => s + x.taxa, 0));
  return { taxa: escolha.taxa, parcelas: gerado.parcelas, bruto, taxaTotal, liquido: r2(bruto - taxaTotal) };
}
