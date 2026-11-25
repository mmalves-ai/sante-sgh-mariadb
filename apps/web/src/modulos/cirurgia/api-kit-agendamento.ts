// Cliente do kit padrão no agendamento cirúrgico (F3.6, 05-SUP linha 13): /api/cirurgia/agendamentos/:id/kit-padrao.
// A sugestão (o kit padrão de cada procedimento, com a composição, e a lista de materiais previstos), aplicar os kits
// escolhidos e retirar uma linha da lista (nada se apaga).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const base = (agendamento: number) => `/api/cirurgia/agendamentos/${agendamento}`;

const esquemaSugestao = z.object({
  agendamento: z.number(),
  numero: z.string(),
  situacao: z.string(),
  aberta: z.boolean(),
  sugeridos: z.array(
    z.object({
      procedimentoAgendamento: z.number(),
      procedimento: z.number(),
      procedimentoCodigo: z.string(),
      procedimentoNome: z.string(),
      principal: z.boolean(),
      kit: z.number(),
      codigo: z.string(),
      nome: z.string(),
      quantidadeKits: z.number(),
      jaNaLista: z.boolean(),
      itens: z.array(
        z.object({ insumo: z.number(), nome: z.string(), unidade: z.string(), quantidade: z.number() }),
      ),
    }),
  ),
  materiais: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      sequencia: z.number(),
      natureza: z.string(),
      insumo: z.number().nullable(),
      kit: z.number().nullable(),
      procedimentoAgendamento: z.number().nullable(),
      nome: z.string().nullable(),
      quantidade: z.number(),
      retiravel: z.boolean(),
    }),
  ),
});
export type SugestaoKitAgendamento = z.infer<typeof esquemaSugestao>;
export type KitSugeridoAgendamento = SugestaoKitAgendamento['sugeridos'][number];

const esquemaAplicado = z.object({ incluidos: z.number(), jaNaLista: z.number() }).passthrough();
const esquemaRetirado = z.object({ id: z.number().nullable().optional() }).passthrough();

export const lerKitAgendamento = (agendamento: number) =>
  ler(`${base(agendamento)}/kit-padrao`, esquemaSugestao);

export const aplicarKitAgendamento = (
  agendamento: number,
  kits: readonly { kit: number; procedimentoAgendamento: number }[],
) => enviar(`${base(agendamento)}/kit-padrao`, { kits }, esquemaAplicado, novaChave('kit-agendamento'));

export const retirarMaterialAgendamento = (agendamento: number, material: number, versao: number) =>
  enviar(
    `${base(agendamento)}/materiais/${material}/retirar`,
    { versao },
    esquemaRetirado,
    novaChave('kit-agendamento-retirar'),
  );
