// Cliente das regras comerciais da conta (F8, 06-FAT linhas 13, 19 e 23): criação e quebra de conta, desconto por
// volume e franquia, remoção em ambulância e ligação tarifada. As validações vêm de @sgh/dominio-faturamento (a mesma
// regra da API), para o erro aparecer enquanto se digita; o servidor confere de novo.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento';
const qualquer = z.record(z.string(), z.unknown());
const opcao = z.object({ id: z.number(), descricao: z.string() });

const esquemaRegras = z.object({
  regrasConta: z.array(
    z
      .object({
        id: z.number(),
        versao: z.number(),
        acao: z.string(),
        origemEntrada: z.number().nullable().optional(),
        categoriaAtendimento: z.number().nullable().optional(),
        setor: z.number().nullable().optional(),
        grupo: z.number().nullable().optional(),
        fonteDestino: z.number().nullable().optional(),
        periodicidade: z.string().nullable().optional(),
        prioridade: z.number(),
        vigenciaInicio: z.string(),
        ativo: z.boolean(),
      })
      .passthrough(),
  ),
  descontos: z.array(
    z
      .object({
        id: z.number(),
        versao: z.number(),
        fontePagadoraId: z.number(),
        descricao: z.string(),
        baseVolume: z.string(),
        ativo: z.boolean(),
        faixas: z.array(qualquer),
      })
      .passthrough(),
  ),
  franquias: z.array(
    z
      .object({
        id: z.number(),
        contratoId: z.number(),
        descricao: z.string(),
        tipo: z.string(),
        ativo: z.boolean(),
      })
      .passthrough(),
  ),
  ambulancia: z.array(
    z
      .object({
        id: z.number(),
        fontePagadoraId: z.number().nullable(),
        categoriaAmbulanciaId: z.number(),
        forma: z.string(),
        rotaId: z.number().nullable(),
        itemId: z.number(),
        ativo: z.boolean(),
      })
      .passthrough(),
  ),
  ligacao: z.array(
    z
      .object({
        id: z.number(),
        tipoLigacaoId: z.number(),
        itemMinutoId: z.number().nullable(),
        itemSegundoId: z.number().nullable(),
        assumeValorTarifador: z.boolean(),
        ativo: z.boolean(),
      })
      .passthrough(),
  ),
  opcoes: z.object({
    fontes: z.array(opcao),
    contratos: z.array(opcao),
    origensEntrada: z.array(opcao),
    categoriasAtendimento: z.array(opcao),
    setores: z.array(opcao),
    grupos: z.array(opcao),
    categoriasAmbulancia: z.array(opcao),
    rotas: z.array(opcao),
    tiposLigacao: z.array(opcao),
  }),
});
export type RegrasComerciais = z.infer<typeof esquemaRegras>;

const esquemaComercialConta = z.object({
  conta: z.object({
    id: z.number(),
    numero: z.string(),
    situacao: z.string(),
    atendimentoId: z.number().nullable(),
    // Valores da conta (06-FAT linha 19): total cobrado da fonte pagadora e parte do paciente (franquia).
    valorItens: z.number().optional(),
    valorAcrescimo: z.number().optional(),
    valorDesconto: z.number().optional(),
    valorPaciente: z.number().optional(),
    valorTotal: z.number().optional(),
  }),
  previa: z.object({
    franquia: z.array(
      z.object({
        id: z.number(),
        descricao: z.string(),
        motivo: z.string().nullable(),
        valor: z.number(),
        base: z.number(),
      }),
    ),
    desconto: z
      .object({
        regraId: z.number(),
        descricao: z.string(),
        medida: z.string(),
        volume: z.number(),
        valor: z.number(),
      })
      .nullable(),
    situacao: z.object({
      vinculo: z.enum(['titular', 'dependente', 'pensionista']).nullable(),
      origemVinculo: z.enum(['simulacao', 'cadastro']).nullable(),
      coberturaPacienteId: z.number().nullable(),
    }),
  }),
  aplicados: z.array(
    z.object({
      id: z.number(),
      sequencia: z.number(),
      tipo: z.string(),
      valor: z.number(),
      observacao: z.string().nullable(),
      vigente: z.boolean(),
    }),
  ),
  ligacoes: z.array(
    z.object({
      id: z.number(),
      tipo: z.string(),
      iniciadaEm: z.string(),
      duracaoSegundos: z.number(),
      valor: z.number().nullable(),
      situacao: z.string(),
      itemId: z.number().nullable(),
    }),
  ),
});
export type ComercialConta = z.infer<typeof esquemaComercialConta>;

export const lerRegrasComerciais = () => ler(`${F}/regras-comerciais`, esquemaRegras);
export const simularRegraConta = (atendimento: number, item?: number | null) =>
  ler(`${F}/regras-comerciais/simulacao?atendimento=${atendimento}${item ? `&item=${item}` : ''}`, qualquer);
export const salvarRegraConta = (corpo: unknown, chave: string) =>
  enviar(`${F}/regras-comerciais/contas`, corpo, qualquer, chave);
export const salvarDescontoVolume = (corpo: unknown, chave: string) =>
  enviar(`${F}/regras-comerciais/descontos-volume`, corpo, qualquer, chave);
export const salvarFranquia = (corpo: unknown, chave: string) =>
  enviar(`${F}/regras-comerciais/franquias`, corpo, qualquer, chave);
export const salvarRegraAmbulancia = (corpo: unknown, chave: string) =>
  enviar(`${F}/regras-comerciais/ambulancia`, corpo, qualquer, chave);
export const salvarRegraLigacao = (corpo: unknown, chave: string) =>
  enviar(`${F}/regras-comerciais/ligacao`, corpo, qualquer, chave);
/** Prévia da conta; o vínculo vem da carteira do cadastro, e `simulacao` só simula outro vínculo na leitura. */
export const lerComercialConta = (conta: number, simulacao?: string | null) =>
  ler(
    `${F}/contas/${conta}/comercial${simulacao ? `?vinculo=${encodeURIComponent(simulacao)}` : ''}`,
    esquemaComercialConta,
  );
/** Aplica a franquia e o desconto com o vínculo da carteira do cadastro (a requisição não leva vínculo). */
export const aplicarFranquiaDesconto = (conta: number, chave: string) =>
  enviar(`${F}/contas/${conta}/franquia-desconto`, {}, qualquer, chave);
export const lancarRemocao = (conta: number, corpo: unknown, chave: string) =>
  enviar(`${F}/contas/${conta}/remocoes`, corpo, qualquer, chave);
export const lancarLigacoes = (conta: number, chave: string) =>
  enviar(`${F}/contas/${conta}/ligacoes/lancamento`, {}, qualquer, chave);
export const registrarLigacao = (corpo: unknown, chave: string) =>
  enviar(`${F}/ligacoes-tarifadas`, corpo, qualquer, chave);
