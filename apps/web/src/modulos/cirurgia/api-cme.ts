// Cliente da central de material esterilizado (CME; F7, 05-SUP linha 29; RDC 15/2012): /api/cirurgia/cme.
// Painel (caixas, equipamentos, métodos, pacotes, ciclos, solicitações, setores e cirurgias), rastreio pela etiqueta,
// e as gravações: caixa, equipamento, solicitação, pacote, ciclo (abrir, concluir, liberar), entrega e uso.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/cirurgia/cme';
const nulo = <T extends z.ZodTypeAny>(x: T) => x.nullable();
const opcao = z.object({ id: z.number(), nome: z.string() });

const esquemaPacote = z.object({
  id: z.number(),
  etiqueta: z.string(),
  caixa: nulo(z.number()),
  produto: z.string(),
  situacao: z.string(),
  ciclo: nulo(z.number()),
  lote: nulo(z.string()),
  validade: nulo(z.string()),
  versao: z.number(),
});
const esquemaCiclo = z.object({
  id: z.number(),
  numero: z.string(),
  lote: z.string(),
  equipamento: z.string(),
  metodo: z.string(),
  situacao: z.string(),
  inicio: nulo(z.string()),
  fim: nulo(z.string()),
  fisico: z.boolean(),
  quimico: z.boolean(),
  biologico: z.boolean(),
  pacotes: z.number(),
  versao: z.number(),
});
export const esquemaPainelCme = z.object({
  setores: z.array(opcao),
  unidades: z.array(opcao),
  agendamentos: z.array(
    z.object({ id: z.number(), numero: z.string(), paciente: z.string(), inicio: nulo(z.string()) }),
  ),
  caixas: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      validadeDias: nulo(z.number()),
      reprocessamentos: z.number(),
      limite: nulo(z.number()),
      pecas: z.number(),
    }),
  ),
  equipamentos: z.array(
    z.object({ id: z.number(), codigo: z.string(), descricao: z.string(), metodo: nulo(z.number()) }),
  ),
  metodos: z.array(z.object({ id: z.number(), codigo: z.string(), descricao: z.string() })),
  pacotes: z.array(esquemaPacote),
  ciclos: z.array(esquemaCiclo),
  solicitacoes: z.array(
    z.object({
      id: z.number(),
      numero: z.string(),
      tipo: z.string(),
      situacao: z.string(),
      agendamento: nulo(z.number()),
      itens: z.array(
        z.object({
          id: z.number(),
          caixa: z.number(),
          quantidade: z.number(),
          situacao: z.string(),
          pacote: nulo(z.number()),
        }),
      ),
    }),
  ),
});
export type PainelCme = z.infer<typeof esquemaPainelCme>;
export type PacoteCme = z.infer<typeof esquemaPacote>;
export type CicloCme = z.infer<typeof esquemaCiclo>;

export const esquemaRastreio = z.object({
  pacote: esquemaPacote.extend({
    esterilizadoEm: nulo(z.string()),
    preparadoPor: nulo(z.string()),
    metodo: nulo(z.string()),
    faltasEtiqueta: z.array(z.string()),
  }),
  ciclo: nulo(esquemaCiclo),
  cirurgias: z.array(
    z.object({
      movimento: z.number(),
      agendamento: nulo(z.number()),
      agendamentoNumero: nulo(z.string()),
      atendimento: nulo(z.number()),
      paciente: nulo(z.number()),
      pacienteNome: nulo(z.string()),
      entregueEm: nulo(z.string()),
      usado: z.boolean(),
    }),
  ),
  // F7 (04-CME linha 118): a baixa do uso no paciente, com a conferência da abertura.
  usos: z.array(
    z.object({
      id: z.number(),
      usadoEm: nulo(z.string()),
      paciente: z.number(),
      atendimento: z.number(),
      atoCirurgico: nulo(z.number()),
      integridadeConferida: z.boolean(),
      indicadorExternoOk: nulo(z.boolean()),
    }),
  ),
});
export type RastreioCme = z.infer<typeof esquemaRastreio>;

export type Indicador = 'conforme' | 'nao_conforme' | 'pendente';
const qualquer = z.record(z.string(), z.unknown());

export const lerPainelCme = () => ler(C, esquemaPainelCme);
export const rastrearPacote = (etiqueta: string) =>
  ler(`${C}/rastreio?${new URLSearchParams({ etiqueta }).toString()}`, esquemaRastreio);
export const buscarProdutosCme = (busca: string) =>
  ler(
    `${C}/produtos?${new URLSearchParams({ busca }).toString()}`,
    z.object({ itens: z.array(z.object({ id: z.number(), descricao: z.string() })) }),
  );

export const criarEquipamentoCme = (corpo: {
  codigo: string;
  descricao: string;
  natureza: string;
  metodo: number | null;
}) => enviar(`${C}/equipamentos`, corpo, qualquer, novaChave('cme.equipamento'));
export const solicitarCme = (corpo: {
  tipo: 'setor' | 'cirurgia';
  setor: number;
  agendamento: number | null;
  itens: { caixa: number; quantidade: number }[];
}) => enviar(`${C}/solicitacoes`, corpo, qualquer, novaChave('cme.solicitacao'));
export const prepararPacoteCme = (corpo: { caixa: number; solicitacaoItem: number | null }) =>
  enviar(
    `${C}/pacotes`,
    corpo,
    z.object({ pacote: z.number(), etiqueta: z.string() }),
    novaChave('cme.pacote'),
  );
export const abrirCicloCme = (corpo: { equipamento: number; metodo: number; pacotes: number[] }) =>
  enviar(`${C}/ciclos`, corpo, qualquer, novaChave('cme.ciclo'));
export const concluirCicloCme = (
  id: number,
  corpo: { versao: number; temperatura: number | null; tempoExposicao: number | null } & Record<
    'fisico' | 'quimico' | 'biologico',
    Indicador
  >,
) =>
  enviar(
    `${C}/ciclos/${id}/concluir`,
    corpo,
    z.object({ situacao: z.string(), motivo: z.string() }),
    novaChave('cme.concluir'),
  );
export const liberarCicloCme = (id: number, corpo: { versao: number; biologico: Indicador }) =>
  enviar(
    `${C}/ciclos/${id}/liberar`,
    corpo,
    z.object({ situacao: z.string(), motivo: z.string() }),
    novaChave('cme.liberar'),
  );
export const entregarPacoteCme = (id: number, corpo: { agendamento: number; cme: number; setor: number }) =>
  enviar(`${C}/pacotes/${id}/entregar`, corpo, qualquer, novaChave('cme.entregar'));
/** O ZPL da etiqueta do pacote estéril (RDC 15/2012, art. 83); a reimpressão confere pelo SHA-256. */
export const etiquetaPacoteCme = (etiqueta: string) =>
  ler(
    `${C}/pacotes/etiqueta?${new URLSearchParams({ etiqueta }).toString()}`,
    z.object({ codigo: z.string(), zpl: z.string(), sha256: z.string() }),
  );
export const usarPacoteCme = (
  id: number,
  corpo: { agendamento: number; integridadeConferida: boolean; indicadorExternoOk: boolean | null },
) => enviar(`${C}/pacotes/${id}/usar`, corpo, qualquer, novaChave('cme.usar'));
