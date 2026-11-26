// Cliente do material de terceiro e consignado processado pela CME (F7, 04-CME linha 119). Toda gravação leva a chave
// de idempotência; as mudanças do recebimento levam a versão lida (409 se outro gravou antes).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/cirurgia/cme/terceiros';

export const TIPOS_PROPRIETARIO = [
  'fornecedor',
  'profissional',
  'outro_estabelecimento',
  'paciente',
] as const;
export type TipoProprietario = (typeof TIPOS_PROPRIETARIO)[number];

const item = z.object({
  sequencia: z.number(),
  material: z.number(),
  descricao: z.string(),
  recebida: z.number(),
  utilizada: z.number(),
  devolvida: z.number(),
  conferidoRecebimento: z.boolean(),
  conferidoDevolucao: z.boolean(),
  divergencia: z.string().nullable(),
});
export const esquemaPainelTerceiros = z.object({
  materiais: z.array(
    z.object({
      id: z.number(),
      descricao: z.string(),
      tipoProprietario: z.enum(TIPOS_PROPRIETARIO),
      dono: z.string().nullable(),
      fornecedor: z.number().nullable(),
      codigoBarras: z.string().nullable(),
      quantidadePecas: z.number().nullable(),
      validadeDias: z.number().nullable(),
      esterilizacao: z.boolean(),
      ativo: z.boolean(),
    }),
  ),
  recebimentos: z.array(
    z.object({
      id: z.number(),
      numero: z.number(),
      situacao: z.string(),
      versao: z.number(),
      fornecedor: z.string().nullable(),
      agendamento: z.string().nullable(),
      temPaciente: z.boolean(),
      cme: z.string(),
      entregador: z.string().nullable(),
      recebidoEm: z.string().nullable(),
      conferidoEm: z.string().nullable(),
      devolvidoEm: z.string().nullable(),
      recebedorDevolucao: z.string().nullable(),
      itens: z.array(item),
      pacotes: z.array(
        z.object({ id: z.number(), etiqueta: z.string(), situacao: z.string(), material: z.number() }),
      ),
    }),
  ),
  setores: z.array(z.object({ id: z.number(), nome: z.string() })),
  agendamentos: z.array(z.object({ id: z.number(), numero: z.string(), paciente: z.number().nullable() })),
});
export type PainelTerceiros = z.infer<typeof esquemaPainelTerceiros>;
export type RecebimentoTerceiro = PainelTerceiros['recebimentos'][number];
const esquemaDonos = z.array(z.object({ id: z.number(), nome: z.string() }));
const esquemaGravado = z.object({}).passthrough();

export interface MaterialEntrada {
  descricao: string;
  tipoProprietario: TipoProprietario;
  fornecedor: number | null;
  profissional: number | null;
  codigoBarras: string | null;
  quantidadePecas: number | null;
  validadeDias: number | null;
  expurgo: boolean;
  lavagem: boolean;
  desinfeccao: boolean;
  preparo: boolean;
  esterilizacao: boolean;
}
export interface RecebimentoEntrada {
  cme: number;
  fornecedor: number | null;
  agendamento: number | null;
  entregador: string | null;
  observacao: string | null;
  itens: { material: number; quantidade: number }[];
}

export const lerPainelTerceiros = () => ler(C, esquemaPainelTerceiros);
export const buscarDonos = (tipo: 'fornecedor' | 'profissional', termo: string) =>
  ler(`${C}/donos?tipo=${tipo}&termo=${encodeURIComponent(termo)}`, esquemaDonos);
export const cadastrarMaterial = (e: MaterialEntrada) =>
  enviar(`${C}/materiais`, e, esquemaGravado, novaChave('cme-terceiro-material'));
export const receber = (e: RecebimentoEntrada) =>
  enviar(`${C}/recebimentos`, e, esquemaGravado, novaChave('cme-terceiro-receber'));
export const conferir = (
  id: number,
  versao: number,
  itens: { sequencia: number; conferido: boolean; divergencia: string | null }[],
) =>
  enviar(
    `${C}/recebimentos/${id}/conferir`,
    { versao, itens },
    esquemaGravado,
    novaChave('cme-terceiro-conferir'),
  );
export const reprocessar = (id: number, versao: number) =>
  enviar(
    `${C}/recebimentos/${id}/reprocessar`,
    { versao },
    esquemaGravado,
    novaChave('cme-terceiro-reprocessar'),
  );
export const disponibilizar = (id: number, versao: number) =>
  enviar(
    `${C}/recebimentos/${id}/disponibilizar`,
    { versao },
    esquemaGravado,
    novaChave('cme-terceiro-disponivel'),
  );
export const devolver = (
  id: number,
  versao: number,
  recebedor: string | null,
  itens: { sequencia: number; utilizada: number; devolvida: number; conferido: boolean }[],
) =>
  enviar(
    `${C}/recebimentos/${id}/devolver`,
    { versao, recebedor, observacao: null, itens },
    esquemaGravado,
    novaChave('cme-terceiro-devolver'),
  );
