// Cliente da produção interna da farmácia e da central (C1-124, 05-SUP linha 12): o painel (as ordens de manipulação
// baixadas a fechar, os custos indiretos com o valor vigente, os kits padrão com a composição, os locais e os lotes
// produzidos no período), o fechamento da ordem em lote produzido e a montagem do kit. Os contratos de resposta são os
// da porta própria (PainelProducaoInterna e LoteProduzidoGravado em apps/api/src/modulos/suprimentos/producao-interna.ts),
// validados aqui antes de chegar à tela.
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

const B = '/api/farmacia/producao-interna';
const id = z.number().int();
const instante = z.string();

export const esquemaLoteProduzido = z.object({
  id,
  tipo: z.enum(['manipulacao', 'kit_montado']),
  numeroLote: z.string(),
  produto: id,
  produtoNome: z.string(),
  local: id,
  ordem: id.nullable(),
  ordemNumero: id.nullable(),
  kit: id.nullable(),
  kitNome: z.string().nullable(),
  quantidadeProduzida: z.number(),
  perda: z.number(),
  produzidoEm: instante,
  validadeEm: instante,
  valorTotal: z.number(),
  custoUnitario: z.number().nullable(),
  situacao: z.string(),
  custos: z.array(z.object({ descricao: z.string(), valorTotal: z.number() })),
});
export type LoteProduzidoTela = z.infer<typeof esquemaLoteProduzido>;

export const esquemaPainelProducaoInterna = z.object({
  hoje: z.string(),
  agora: instante,
  aFechar: z.array(
    z.object({
      id,
      numero: id,
      versao: id,
      finalidade: z.string(),
      produto: id,
      produtoNome: z.string(),
      quantidadePrevista: z.number(),
      valorInsumos: z.number(),
      validadeSugerida: instante.nullable(),
    }),
  ),
  custos: z.array(z.object({ id, descricao: z.string(), valor: z.number().nullable() })),
  kits: z.array(
    z.object({
      id,
      codigo: z.string(),
      nome: z.string(),
      componentes: z.array(z.object({ insumo: id, nome: z.string(), quantidade: z.number() })),
    }),
  ),
  locais: z.array(z.object({ id, nome: z.string() })),
  lotes: z.array(esquemaLoteProduzido),
});
export type PainelProducaoInternaTela = z.infer<typeof esquemaPainelProducaoInterna>;
export type OrdemAFecharTela = PainelProducaoInternaTela['aFechar'][number];
export type KitDoPainelTela = PainelProducaoInternaTela['kits'][number];

export const esquemaLoteProduzidoGravado = z.object({
  id,
  numeroLote: z.string(),
  loteEstoque: id,
  movimento: id,
  valorInsumos: z.number(),
  valorIndireto: z.number(),
  valorAdicional: z.number(),
  valorTotal: z.number(),
  custoUnitario: z.number(),
});
export type LoteProduzidoGravadoTela = z.infer<typeof esquemaLoteProduzidoGravado>;

export interface CustoMandadoTela {
  readonly custo: number;
  readonly quantidade: number;
}
export interface FechamentoProducaoTela {
  readonly versaoVista: number;
  readonly quantidadeProduzida: number;
  readonly perda: number;
  readonly validadeEm: string;
  readonly numeroLote: string | null;
  readonly custos: readonly CustoMandadoTela[];
  readonly valorAdicional: number;
}
export interface MontagemKitTela {
  readonly kit: number;
  readonly produto: number;
  readonly local: number;
  readonly quantidadeKits: number;
  readonly validadeEm: string;
  readonly numeroLote: string | null;
  readonly custos: readonly CustoMandadoTela[];
  readonly valorAdicional: number;
}

export const painelProducaoInterna = (de: string, ate: string): Promise<PainelProducaoInternaTela> =>
  ler(`${B}${qs({ de, ate })}`, esquemaPainelProducaoInterna);
export const fecharOrdemProducao = (
  ordem: number,
  e: FechamentoProducaoTela,
  chave: string,
): Promise<LoteProduzidoGravadoTela> =>
  enviar(`${B}/ordens/${ordem}/fechamento`, e, esquemaLoteProduzidoGravado, chave);
export const montarKitProducao = (e: MontagemKitTela, chave: string): Promise<LoteProduzidoGravadoTela> =>
  enviar(`${B}/kits`, e, esquemaLoteProduzidoGravado, chave);
