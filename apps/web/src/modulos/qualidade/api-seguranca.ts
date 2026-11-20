// Cliente das telas da segurança do paciente, etapa 2 do M48 (análise de causa e plano 5W2H, sugestão automática,
// tecnovigilância e farmacovigilância, adesão a protocolos e o painel do plano de segurança), validado na chegada.
// As gravações vão com o CSRF e a Idempotency-Key (uma por intenção de gravar); o código da recusa fica em
// `problema.codigo` para a tela mostrar o texto certo (ErroQualidade).
import {
  type AcaoPlanoLida,
  type AnaliseLida,
  CODIGOS_AREA_VIGILANCIA,
  CODIGOS_CONDUTA_PRODUTO,
  CODIGOS_EFICACIA_ACAO,
  CODIGOS_FATOR_CONTRIBUINTE,
  CODIGOS_FONTE_SUGESTAO,
  CODIGOS_METODO_ANALISE,
  CODIGOS_SITUACAO_ACAO,
  CODIGOS_SITUACAO_VIGILANCIA,
  CODIGOS_TIPO_INCIDENTE,
  CODIGOS_TIPO_VIGILANCIA,
  type ContagemPainel,
  esquemaConteudoAnalise,
  type ExpostoAoLote,
  type IndicadorPainel,
  type QueixaTecnicaLida,
  type RegistrarAnaliseEntrada,
  type RegistrarPlanoAcaoEntrada,
  type RegistrarQueixaTecnicaEntrada,
  type SugestaoNotificacao,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';
import { esquemaDetalheNotificacao, esquemaResumoNotificacao } from './api.js';

const Q = '/api/qualidade';
const instante = z.string();
const texto = z.string().nullable();

// ── Análise e plano ──────────────────────────────────────────────────────────────────────────────────

const esquemaAnalise = z.object({
  id: z.number().int(),
  notificacao: z.number().int(),
  metodo: z.enum(CODIGOS_METODO_ANALISE),
  conteudo: esquemaConteudoAnalise,
  causaRaiz: texto,
  fatores: z.array(z.enum(CODIGOS_FATOR_CONTRIBUINTE)),
  licoes: texto,
  semAcaoJustificativa: texto,
  situacao: z.enum(['rascunho', 'concluida']),
  versao: z.number().int(),
  registradaPor: z.string(),
  registradaEm: instante,
  atualizadaEm: instante.nullable(),
  concluidaEm: instante.nullable(),
  concluidaPor: texto,
});
const esquemaAcao = z.object({
  id: z.number().int(),
  notificacao: z.number().int(),
  sequencia: z.number().int(),
  oQue: z.string(),
  porQue: z.string(),
  onde: z.string(),
  quando: z.string(),
  quem: z.string(),
  como: z.string(),
  quanto: texto,
  situacao: z.enum(CODIGOS_SITUACAO_ACAO),
  versao: z.number().int(),
  texto,
  concluidaEm: instante.nullable(),
  eficacia: z.enum(CODIGOS_EFICACIA_ACAO).nullable(),
  eficaciaTexto: texto,
  eficaciaEm: instante.nullable(),
  eficaciaPor: texto,
  criadaPor: z.string(),
  criadaEm: instante,
  atrasada: z.boolean(),
});
const esquemaResumoPlano = z.object({
  total: z.number().int(),
  abertas: z.number().int(),
  atrasadas: z.number().int(),
  concluidas: z.number().int(),
  canceladas: z.number().int(),
  verificadas: z.number().int(),
  eficazes: z.number().int(),
});
const esquemaListaAnalises = z.object({
  itens: z.array(
    esquemaResumoNotificacao.extend({
      prazoAnalise: z.string().nullable(),
      analiseConcluidaEm: instante.nullable(),
    }),
  ),
  temMais: z.boolean(),
  pagina: z.number().int(),
  agora: instante,
});
export type ListaAnalises = z.infer<typeof esquemaListaAnalises>;
const esquemaTelaAnalise = z.object({
  notificacao: esquemaDetalheNotificacao,
  prazoAnalise: z.string().nullable(),
  analise: esquemaAnalise.nullable(),
  acoes: z.array(esquemaAcao),
  plano: esquemaResumoPlano,
  agora: instante,
  gravacao: z.object({
    ligada: z.boolean(),
    motivo: z.string().nullable().optional(),
    acoes: z.object({ analisar: z.boolean(), planejar: z.boolean() }),
  }),
});
export type TelaAnalise = z.infer<typeof esquemaTelaAnalise>;
const esquemaResultado = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  versao: z.number().int(),
  mensagem: z.string(),
});
export type ResultadoSeguranca = z.infer<typeof esquemaResultado>;
const esquemaMinhas = z.object({ itens: z.array(esquemaAcao), agora: instante });
export type MinhasAcoes = z.infer<typeof esquemaMinhas>;
const esquemaPessoas = z.object({ itens: z.array(z.object({ login: z.string(), nome: z.string() })) });

// ── Sugestão automática ──────────────────────────────────────────────────────────────────────────────

const esquemaSugestoes = z.object({
  ligada: z.boolean(),
  itens: z.array(
    z.object({
      origem: z.string(),
      fonte: z.enum(CODIGOS_FONTE_SUGESTAO),
      tipo: z.enum(CODIGOS_TIPO_INCIDENTE),
      titulo: z.string(),
      quando: instante,
      atendimento: z.number().int().nullable(),
      chegouAoPaciente: z.boolean(),
      descricao: z.string(),
    }),
  ),
  agora: instante,
});
export type Sugestoes = z.infer<typeof esquemaSugestoes>;

// ── Vigilância de produto ────────────────────────────────────────────────────────────────────────────

const esquemaQueixa = z.object({
  id: z.number().int(),
  area: z.enum(CODIGOS_AREA_VIGILANCIA),
  tipo: z.enum(CODIGOS_TIPO_VIGILANCIA),
  item: z.number().int().nullable(),
  produto: texto,
  lote: texto,
  serie: texto,
  fabricante: texto,
  registroAnvisa: texto,
  descricao: z.string(),
  notificacao: z.number().int().nullable(),
  alerta: texto,
  conduta: z.enum(CODIGOS_CONDUTA_PRODUTO),
  situacao: z.enum(CODIGOS_SITUACAO_VIGILANCIA),
  notivisaNumero: texto,
  versao: z.number().int(),
  registradaPor: z.string(),
  registradaEm: instante,
  atualizadaEm: instante.nullable(),
  encerradaEm: instante.nullable(),
});
const esquemaQueixaComNome = esquemaQueixa.extend({ itemNome: texto });
const esquemaGravacaoVigilancia = z.object({
  ligada: z.boolean(),
  motivo: z.string().nullable().optional(),
  registrar: z.boolean(),
});
const esquemaListaQueixas = z.object({
  itens: z.array(esquemaQueixaComNome),
  temMais: z.boolean(),
  pagina: z.number().int(),
  gravacao: esquemaGravacaoVigilancia,
});
export type ListaQueixas = z.infer<typeof esquemaListaQueixas>;
const esquemaTelaQueixa = z.object({
  registro: esquemaQueixaComNome,
  eventos: z.array(
    z.object({ em: instante, por: z.string(), situacao: z.string(), conduta: z.string(), texto }),
  ),
  protocoloNotificacao: texto,
  calculaExpostos: z.boolean(),
  gravacao: esquemaGravacaoVigilancia,
});
export type TelaQueixa = z.infer<typeof esquemaTelaQueixa>;
const esquemaExpostos = z.object({
  item: z.number().int().nullable(),
  itemNome: texto,
  lote: texto,
  expostos: z.array(
    z.object({
      origem: z.enum(['consumo-em-sala', 'estoque']),
      data: z.string().nullable(),
      atendimento: z.number().int(),
      paciente: z.number().int().nullable(),
      quantidade: z.number(),
    }),
  ),
  cortada: z.boolean(),
});
export type Expostos = z.infer<typeof esquemaExpostos>;
const esquemaItens = z.object({ itens: z.array(z.object({ codigo: z.number().int(), nome: z.string() })) });

// ── Painel ───────────────────────────────────────────────────────────────────────────────────────────

const esquemaIndicador = z.object({
  codigo: z.string(),
  titulo: z.string(),
  numerador: z.number(),
  denominador: z.number(),
  percentual: z.number().nullable(),
  meta: z.number().nullable(),
  fonte: z.string(),
});
const esquemaContagem = z.object({ codigo: z.string(), rotulo: z.string(), quantidade: z.number() });
const esquemaPainel = z.object({
  painel: z.object({
    periodo: z.object({ de: z.string(), ate: z.string() }),
    notificacoes: z.object({
      total: z.number(),
      anonimas: z.number(),
      obitos: z.number(),
      neverEvents: z.number(),
      descartadas: z.number(),
      porTipo: z.array(esquemaContagem),
      porClassificacao: z.array(esquemaContagem),
    }),
    analises: z.object({
      comPrazo: z.number(),
      concluidas: z.number(),
      vencidas: z.number(),
      noPrazo: esquemaIndicador,
    }),
    acoes: z.object({
      abertas: z.number(),
      atrasadas: z.number(),
      concluidas: z.number(),
      canceladas: z.number(),
      eficacia: esquemaIndicador,
    }),
    adesao: z.array(esquemaIndicador),
    protocolosGerenciados: z.array(esquemaIndicador),
    protocolosCortados: z.boolean(),
    historicoRiscos: z.array(z.object({ ano: z.number(), registros: z.number() })),
  }),
  agora: instante,
});
export type PainelSeguranca = z.infer<typeof esquemaPainel>;

// Os esquemas espelham os contratos (o compilador barra a divergência).
type Igual<A, B> = [A] extends [B] ? true : false;
const _conferencia: [
  Igual<z.infer<typeof esquemaAnalise>, AnaliseLida>,
  Igual<z.infer<typeof esquemaAcao>, AcaoPlanoLida>,
  Igual<z.infer<typeof esquemaQueixa>, QueixaTecnicaLida>,
  Igual<Expostos['expostos'][number], ExpostoAoLote>,
  Igual<Sugestoes['itens'][number], SugestaoNotificacao>,
  Igual<z.infer<typeof esquemaIndicador>, IndicadorPainel>,
  Igual<z.infer<typeof esquemaContagem>, ContagemPainel>,
] = [true, true, true, true, true, true, true];
void _conferencia;

// ── Chamadas ─────────────────────────────────────────────────────────────────────────────────────────

export const listarAnalises = (f: { situacao?: string; pagina?: number }): Promise<ListaAnalises> =>
  ler(`${Q}/analises${qs({ situacao: f.situacao, pagina: f.pagina })}`, esquemaListaAnalises);
export const lerAnalise = (id: number): Promise<TelaAnalise> =>
  ler(`${Q}/analises/${String(id)}`, esquemaTelaAnalise);
export const registrarAnalise = (e: RegistrarAnaliseEntrada, chave: string): Promise<ResultadoSeguranca> =>
  enviar(`${Q}/analises/${String(e.notificacao)}`, e, esquemaResultado, chave);
export const registrarPlanoAcao = (
  e: RegistrarPlanoAcaoEntrada,
  chave: string,
): Promise<ResultadoSeguranca> =>
  enviar(`${Q}/analises/${String(e.notificacao)}/acoes`, e, esquemaResultado, chave);
export const lerMinhasAcoes = (): Promise<MinhasAcoes> => ler(`${Q}/acoes/minhas`, esquemaMinhas);
export const buscarResponsaveis = (busca: string) =>
  ler(`${Q}/acoes/responsaveis${qs({ busca: busca.trim() })}`, esquemaPessoas);

export const lerSugestoes = (): Promise<Sugestoes> => ler(`${Q}/sugestoes`, esquemaSugestoes);
export const dispensarSugestao = (origem: string, chave: string) =>
  enviar(
    `${Q}/sugestoes/dispensar`,
    { origem },
    z.object({ ok: z.literal(true), mensagem: z.string() }),
    chave,
  );

export const listarQueixas = (f: {
  situacao?: string;
  area?: string;
  pagina?: number;
}): Promise<ListaQueixas> =>
  ler(
    `${Q}/tecnovigilancia${qs({ situacao: f.situacao, area: f.area, pagina: f.pagina })}`,
    esquemaListaQueixas,
  );
export const lerQueixa = (id: number): Promise<TelaQueixa> =>
  ler(`${Q}/tecnovigilancia/${String(id)}`, esquemaTelaQueixa);
export const lerExpostos = (id: number): Promise<Expostos> =>
  ler(`${Q}/tecnovigilancia/${String(id)}/expostos`, esquemaExpostos);
export const buscarProdutos = (busca: string) =>
  ler(`${Q}/tecnovigilancia/itens${qs({ busca: busca.trim() })}`, esquemaItens);
export const abrirQueixa = (
  e: Extract<RegistrarQueixaTecnicaEntrada, { acao: 'abrir' }>,
  chave: string,
): Promise<ResultadoSeguranca> => enviar(`${Q}/tecnovigilancia`, e, esquemaResultado, chave);
export const andamentoQueixa = (
  e: Extract<RegistrarQueixaTecnicaEntrada, { acao: 'andamento' }>,
  chave: string,
): Promise<ResultadoSeguranca> =>
  enviar(`${Q}/tecnovigilancia/${String(e.id)}/andamento`, e, esquemaResultado, chave);

export const lerPainelSeguranca = (p: {
  de?: string | null;
  ate?: string | null;
}): Promise<PainelSeguranca> => ler(`${Q}/nsp/painel${qs({ de: p.de, ate: p.ate })}`, esquemaPainel);
