// Cliente das rotas da RAAS da atenção psicossocial e da atenção domiciliar (F8, 06-SUS linha 64): /api/sus/raas.
import { TIPOS_RAAS, type TipoRaas } from '@sgh/dominio-faturamento';
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/sus/raas';
const comId = z.object({ id: z.number() }).passthrough();
const tipo = z.enum(TIPOS_RAAS);

export const esquemaRegistroRaas = z.object({
  id: z.number(),
  numero: z.string(),
  tipo,
  competencia: z.string(),
  paciente: z.number(),
  pacienteNome: z.string(),
  prontuario: z.string(),
  dataAdmissao: z.string(),
  dataConclusao: z.string().nullable(),
  situacao: z.string(),
  cidPrincipal: z.string().nullable(),
  continuacao: z.number().nullable(),
  remessa: z.number().nullable(),
  acoes: z.number(),
  criticasAbertas: z.number(),
  bloqueantes: z.number(),
  versao: z.number(),
});
export type RegistroRaas = z.infer<typeof esquemaRegistroRaas>;

const esquemaRemessa = z.object({
  id: z.number(),
  numero: z.string(),
  tipo: z.string(),
  situacao: z.string(),
  registros: z.number(),
  procedimentos: z.number(),
  nomeArquivo: z.string().nullable(),
  hash: z.string().nullable(),
  conferidoContraOficial: z.boolean(),
  geradaEm: z.string().nullable(),
  versao: z.number(),
});
export type RemessaRaas = z.infer<typeof esquemaRemessa>;

const esquemaPainel = z.object({
  competencia: z.string(),
  situacaoCompetencia: z.string().nullable(),
  criticadaEm: z.string().nullable(),
  conferidoContraOficial: z.boolean(),
  registros: z.array(esquemaRegistroRaas),
  remessas: z.array(esquemaRemessa),
});
export type PainelRaas = z.infer<typeof esquemaPainel>;

const esquemaAcao = z.object({
  id: z.number(),
  sequencia: z.number(),
  procedimento: z.string(),
  procedimentoDescricao: z.string(),
  cbo: z.string(),
  profissional: z.number().nullable(),
  dataInicio: z.string(),
  dataFim: z.string().nullable(),
  quantidade: z.number(),
  local: z.enum(['unidade', 'territorio', 'domicilio']),
  cid: z.string().nullable(),
  versao: z.number(),
});
export type AcaoRaasLida = z.infer<typeof esquemaAcao>;

const esquemaCritica = z.object({
  id: z.number(),
  regra: z.string(),
  gravidade: z.string(),
  descricao: z.string(),
  situacao: z.string(),
});
const esquemaDetalhe = esquemaRegistroRaas.extend({
  acoes: z.array(esquemaAcao),
  criticas: z.array(esquemaCritica),
});
export type DetalheRaas = z.infer<typeof esquemaDetalhe>;

const esquemaOpcoes = z.object({ destinos: z.array(z.object({ id: z.number(), descricao: z.string() })) });
const esquemaPaciente = z.object({ id: z.number(), nome: z.string(), prontuario: z.string() });
export type PacienteRaas = z.infer<typeof esquemaPaciente>;

export interface CorpoRegistroRaas {
  tipo: TipoRaas;
  competencia: string;
  paciente: number;
  dataAdmissao: string;
  cidPrincipal: string;
  cidSecundarios: string[];
  cidAssociado: string | null;
  estrategiaSaudeFamilia: boolean;
  cnesSaudeFamilia: string | null;
  responsavel: string | null;
}
export interface CorpoAcaoRaas {
  procedimento: string;
  cbo: string;
  dataInicio: string;
  dataFim: string | null;
  quantidade: number;
  local: 'unidade' | 'territorio' | 'domicilio';
  cid: string | null;
  versao: number;
}

const consulta = (q: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const lerPainelRaas = (f: { competencia: string; tipo?: TipoRaas | null; paciente?: number | null }) =>
  ler(`${B}${consulta(f)}`, esquemaPainel);
export const lerOpcoesRaas = () => ler(`${B}/opcoes`, esquemaOpcoes);
export const buscarPacientesRaas = (busca: string) =>
  ler(`${B}/pacientes${consulta({ busca })}`, z.object({ pacientes: z.array(esquemaPaciente) }));
export const lerRegistroRaas = (id: number) => ler(`${B}/registros/${id}`, esquemaDetalhe);
export const incluirRegistroRaas = (corpo: CorpoRegistroRaas) =>
  enviar(
    `${B}/registros`,
    corpo,
    z.object({ id: z.number(), numero: z.string() }).passthrough(),
    novaChave('sus-raas-registro'),
  );
export const lancarAcaoRaas = (registro: number, corpo: CorpoAcaoRaas) =>
  enviar(`${B}/registros/${registro}/acoes`, corpo, comId, novaChave('sus-raas-acao'));
export const retirarAcaoRaas = (acao: number, versao: number) =>
  enviar(`${B}/acoes/${acao}/retirar`, { versao }, comId, novaChave('sus-raas-retirar'));
export const concluirRegistroRaas = (
  registro: number,
  corpo: { dataConclusao: string; destino: number; versao: number },
) => enviar(`${B}/registros/${registro}/concluir`, corpo, comId, novaChave('sus-raas-concluir'));
export const continuarRegistroRaas = (registro: number, versao: number) =>
  enviar(
    `${B}/registros/${registro}/continuar`,
    { versao },
    z.object({ id: z.number(), numero: z.string(), competencia: z.string() }).passthrough(),
    novaChave('sus-raas-continuar'),
  );
export const criticarRaas = (corpo: { competencia: string; tipo: TipoRaas }) =>
  enviar(
    `${B}/criticar`,
    corpo,
    z.object({
      registros: z.number(),
      criticas: z.number(),
      bloqueantes: z.number(),
      corrigidas: z.number(),
    }),
    novaChave('sus-raas-criticar'),
  );
export const gerarRemessaRaas = (corpo: {
  competencia: string;
  tipo: TipoRaas;
  orgaoDestino: string;
  indicadorDestino: 'M' | 'E';
}) =>
  enviar(
    `${B}/remessas`,
    corpo,
    z
      .object({
        id: z.number(),
        numero: z.string(),
        nome: z.string(),
        hash: z.string(),
        registros: z.number(),
        conteudo: z.string(),
        substituidas: z.number(),
      })
      .passthrough(),
    novaChave('sus-raas-remessa'),
  );
