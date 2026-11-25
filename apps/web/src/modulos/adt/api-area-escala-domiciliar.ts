// Cliente das rotas das áreas e da escala da atenção domiciliar (C2-105, 03-PEP linha 143):
// /api/internacao/domiciliar/areas, /vinculos e /escalas.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const D = '/api/internacao/domiciliar';
const opcao = z.object({ id: z.number(), nome: z.string() });
const n = z.number().nullable();
const s = z.string().nullable();

export const esquemaAreaDomiciliar = z.object({
  id: z.number(),
  versao: z.number(),
  codigo: z.string(),
  descricao: z.string(),
  ativo: z.boolean(),
  programa: n,
  programaNome: s,
  faixas: z.array(
    z.object({
      sequencia: z.number(),
      cepInicial: z.string(),
      cepFinal: z.string(),
      municipio: n,
      bairro: n,
    }),
  ),
  profissionais: z.array(
    z.object({
      id: z.number(),
      versao: z.number(),
      profissional: z.number(),
      nome: s,
      prioridade: z.number(),
      vigenciaInicio: z.string(),
      vigenciaFim: s,
    }),
  ),
});
export type AreaDomiciliar = z.infer<typeof esquemaAreaDomiciliar>;
export const esquemaAreasDomiciliares = z.object({
  areas: z.array(esquemaAreaDomiciliar),
  programas: z.array(opcao),
  tiposChamado: z.array(opcao),
  profissionais: z.array(opcao),
});
export type AreasDomiciliares = z.infer<typeof esquemaAreasDomiciliares>;

export const esquemaEscalaDomiciliar = z.object({
  id: z.number(),
  versao: z.number(),
  area: n,
  areaNome: s,
  profissional: z.number(),
  profissionalNome: s,
  tipoChamado: n,
  tipoNome: s,
  diaSemana: z.number(),
  horaInicio: z.string(),
  horaFim: z.string(),
  quantidade: z.number(),
  permiteExtra: z.boolean(),
  atendeFeriado: z.boolean(),
  vigenciaInicio: z.string(),
  vigenciaFim: s,
  ativo: z.boolean(),
});
export type EscalaDomiciliar = z.infer<typeof esquemaEscalaDomiciliar>;
export const esquemaGradeDomiciliar = z.object({
  inicio: z.string(),
  dias: z.array(
    z.object({
      data: z.string(),
      feriado: z.boolean().default(false),
      turnos: z.array(esquemaEscalaDomiciliar.extend({ ocupadas: z.number(), livres: z.number() })),
    }),
  ),
});
export type GradeDomiciliar = z.infer<typeof esquemaGradeDomiciliar>;

const gravado = z.object({ id: z.number().nullable().optional() }).passthrough();

export const lerAreasDomiciliares = () => ler(`${D}/areas`, esquemaAreasDomiciliares);
export const lerEscalasDomiciliares = () => ler(`${D}/escalas`, z.array(esquemaEscalaDomiciliar));
export const lerGradeDomiciliar = (inicio: string, dias = 7) =>
  ler(`${D}/escalas/grade?inicio=${encodeURIComponent(inicio)}&dias=${dias}`, esquemaGradeDomiciliar);
export const areaDoCepDomiciliar = (cep: string) =>
  ler(`${D}/areas/cep/${encodeURIComponent(cep)}`, z.object({ cep: s, area: n }));

export interface AreaProposta {
  codigo: string;
  descricao: string;
  programa: number | null;
  faixas: { cepInicial: string; cepFinal: string }[];
  versao?: number;
}
export const salvarAreaDomiciliar = (alvo: number | null, a: AreaProposta) =>
  enviar(alvo === null ? `${D}/areas` : `${D}/areas/${alvo}`, a, gravado, novaChave('area-domiciliar'));
export const agirAreaDomiciliar = (alvo: number, acao: 'inativar' | 'reativar', versao: number) =>
  enviar(`${D}/areas/${alvo}/${acao}`, { versao }, gravado, novaChave(`area-${acao}`));
export const vincularProfissionalArea = (
  area: number,
  v: { profissional: number | null; prioridade: number; vigenciaInicio: string; vigenciaFim: string | null },
) => enviar(`${D}/areas/${area}/profissionais`, v, gravado, novaChave('area-vinculo'));
export const encerrarVinculoArea = (vinculo: number, versao: number, vigenciaFim: string) =>
  enviar(
    `${D}/vinculos/${vinculo}/encerrar`,
    { versao, vigenciaFim },
    gravado,
    novaChave('vinculo-encerrar'),
  );

export interface TurnoProposto {
  area: number | null;
  profissional: number | null;
  tipoChamado: number | null;
  diaSemana: number;
  horaInicio: string;
  horaFim: string;
  quantidade: number;
  permiteExtra: boolean;
  atendeFeriado: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
}
export const criarTurnoDomiciliar = (t: TurnoProposto) =>
  enviar(`${D}/escalas`, t, gravado, novaChave('escala-domiciliar'));
export const agirTurnoDomiciliar = (
  alvo: number,
  acao: 'encerrar' | 'inativar' | 'reativar',
  versao: number,
  vigenciaFim: string | null = null,
) => enviar(`${D}/escalas/${alvo}/${acao}`, { versao, vigenciaFim }, gravado, novaChave(`escala-${acao}`));
