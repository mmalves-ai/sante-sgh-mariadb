// Cliente da API do consumo padrão de insumos por exame (F8, 05-SADT linha 22): o cadastro diz o que o exame gasta
// (produto ou kit, por setor executante ou para todos) e a realização baixa no estoque e lança na conta só o cobrável
// fora do pacote. As rotas exigem o banco do cliente (sem ele, 503 sem-banco-cliente).
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const B = '/api/sadt/consumo-padrao';
const n = z.number();
const txt = z.string();
const opcao = z.object({ id: n, nome: txt });

const esquemaApoio = z.object({
  setores: z.array(opcao),
  locais: z.array(opcao),
  kits: z.array(opcao),
  produtos: z.array(z.object({ id: n, codigo: txt, nome: txt })),
});
export type ApoioConsumoPadrao = z.infer<typeof esquemaApoio>;

const esquemaConsumo = z.object({
  id: n,
  exame: n,
  exameNome: txt,
  setor: n.nullable(),
  setorNome: txt.nullable(),
  descricao: txt.nullable(),
  baixaAutomatica: z.boolean(),
  lancamentoConta: z.boolean(),
  ativo: z.boolean(),
  versao: n,
  itens: z.array(
    z.object({
      id: n,
      sequencia: n,
      insumo: n.nullable(),
      kit: n.nullable(),
      nome: txt,
      quantidade: n,
      ajustavel: z.boolean(),
    }),
  ),
});
export type ConsumoPadrao = z.infer<typeof esquemaConsumo>;
const esquemaLista = z.object({ itens: z.array(esquemaConsumo) });

const esquemaPendentes = z.object({
  itens: z.array(
    z.object({
      item: n,
      situacao: txt,
      exame: txt,
      requisicao: txt,
      solicitadoEm: txt,
      paciente: txt.nullable(),
      setor: txt.nullable(),
      comAtendimento: z.boolean(),
    }),
  ),
});
export type PendenteConsumo = z.infer<typeof esquemaPendentes>['itens'][number];

const esquemaSugestao = z.object({
  item: n,
  versao: n,
  situacao: txt,
  exame: txt,
  setor: n.nullable(),
  comAtendimento: z.boolean(),
  realizadoEm: txt.nullable(),
  consumo: z.object({ id: n, baixaAutomatica: z.boolean(), lancamentoConta: z.boolean() }).nullable(),
  produtos: z.array(
    z.object({
      insumo: n,
      quantidade: n,
      ajustavel: z.boolean(),
      nome: txt,
      cobravelNoCadastro: z.boolean(),
    }),
  ),
  baixados: z.array(
    z.object({
      insumo: n,
      nome: txt,
      quantidade: n,
      cobravel: z.boolean(),
      movimento: n.nullable(),
      itemConta: n.nullable(),
    }),
  ),
});
export type SugestaoConsumo = z.infer<typeof esquemaSugestao>;

export interface ItemConsumoEntrada {
  readonly insumo: number | null;
  readonly kit: number | null;
  readonly quantidade: number;
  readonly ajustavel: boolean;
}
export interface ConsumoPadraoEntrada {
  readonly id?: number;
  readonly versao?: number;
  readonly exame: number;
  readonly setor: number | null;
  readonly descricao: string | null;
  readonly baixaAutomatica: boolean;
  readonly lancamentoConta: boolean;
  readonly ativo?: boolean;
  readonly itens: readonly ItemConsumoEntrada[];
}
export interface AjusteConsumoEntrada {
  readonly insumo: number;
  readonly quantidade: number;
  readonly cobrar?: boolean;
}

const esquemaGravado = z.object({ id: n, versao: n }).passthrough();
const esquemaRealizado = z.object({ id: n, baixados: n, itensConta: n }).passthrough();

const busca = (b: string | null) =>
  b && b.trim().length >= 3 ? `?busca=${encodeURIComponent(b.trim())}` : '';

/** Setores executantes, locais de estoque, kits e produtos ativos (produto só com 3 letras ou mais). */
export const lerApoioConsumo = (termo: string | null) => ler(`${B}/apoio${busca(termo)}`, esquemaApoio);
export const listarConsumosPadrao = (exame: number | null) =>
  ler(`${B}${exame === null ? '' : `?exame=${exame}`}`, esquemaLista);
export const salvarConsumoPadrao = (c: ConsumoPadraoEntrada, chave: string) =>
  enviar(B, c, esquemaGravado, chave);
export const listarPendentesConsumo = (setor: number | null) =>
  ler(`${B}/pendentes${setor === null ? '' : `?setor=${setor}`}`, esquemaPendentes);
export const lerSugestaoConsumo = (item: number) => ler(`${B}/exames/${item}`, esquemaSugestao);
export const realizarConsumo = (
  item: number,
  corpo: { local: number; ajustes: readonly AjusteConsumoEntrada[] },
  chave: string,
) => enviar(`${B}/exames/${item}/realizar`, corpo, esquemaRealizado, chave);
