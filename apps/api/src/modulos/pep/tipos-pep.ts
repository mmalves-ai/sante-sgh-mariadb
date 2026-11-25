// Tipos de negócio do prontuário (PEP) usados pelas portas, pelos serviços e pelas telas: leitura, gravação e
// esquemas de entrada (zod). Sem dependência de banco: as portas própria e de memória os produzem.
// Melhoria: tipos e esquemas próprios do módulo (antes vinham do pacote de convivência); entrada validada por zod.

import {
  GRAVIDADES_ALERGIA,
  ORIGENS_ALERGIA,
  textoCp1252,
  type LinhaCadastroPrescricao,
} from '@sgh/contratos';
import { GRUPOS_LINHA_SUMARIO, type ItemDatado } from '@sgh/dominio-pep';
import { inflateSync } from 'node:zlib';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
export const HASH = z.string().regex(/^[0-9a-f]{64}$/);
export const HORA_LOCAL = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);
export const ID = z.number().int().positive();

export const EVENTO_ALERTA_LEITURA = 'auditoria.leitura.alertada';

export const EVENTOS_LEITURA_PRONTUARIO = [
  'pep.prontuario.lido',
  'pep.prontuario.listado',
  'pep.registro.lido',
  'pep.prontuario.buscado',
  'pep.motivo.informado',
  'acesso.emergencia.aberta',
  EVENTO_ALERTA_LEITURA,
] as const;

export interface FiltroAcessos {
  readonly paciente?: number;
  readonly usuario?: string;
  readonly de?: string;
  readonly ate?: string;
  readonly soAlertas?: boolean;
}

export interface AcessoLido {
  readonly id: string;
  readonly em: string | null;
  readonly usuario: string;
  readonly evento: string;
  readonly estacao: string | null;
  readonly paciente: number | null;
  readonly tabela: string | null;
  readonly alvo: string | null;
  readonly chave: string | null;
  readonly resultado: string;
  readonly origem: string | null;
}

export function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

export const TABELA_CP1252: string = new TextDecoder('windows-1252').decode(
  Uint8Array.from({ length: 256 }, (_, i) => i),
);

export const PARA_BYTE = new Map<number, number>();
// A tabela inversa (caractere → byte): sem ela, todo texto fora do ASCII seria recusado.
for (let i = 0; i < 256; i++) PARA_BYTE.set(TABELA_CP1252.charCodeAt(i), i);

export class ErroCp1252 extends Error {
  override readonly name = 'ErroCp1252';
}

export function codificarCp1252(texto: string): Buffer {
  const saida = Buffer.alloc(texto.length);
  for (let i = 0; i < texto.length; i++) {
    const b = PARA_BYTE.get(texto.charCodeAt(i));
    if (b === undefined) throw new ErroCp1252('Texto com caractere fora do CP1252.');
    saida[i] = b;
  }
  return saida;
}

export function decodificarCp1252(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += TABELA_CP1252[b];
  return s;
}

export interface LiberacaoConsultada {
  readonly pode: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
}

export const TETO_DOCUMENTO_DESCOMPRIMIDO = 16 * 1024 * 1024;

export const TETO_DOCUMENTO_BASE64 = 24 * 1024 * 1024;

export class ErroDocumento extends Error {
  override readonly name = 'ErroDocumento';
}

export const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function codificacaoDeclarada(cabeca: Uint8Array): 'cp1252' | 'utf8' {
  const prologo = Buffer.from(cabeca.subarray(0, 200)).toString('latin1');
  const m = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(prologo);
  const enc = (m?.[1] ?? 'utf-8').toLowerCase();
  return /1252|latin|8859/.test(enc) ? 'cp1252' : 'utf8';
}

export function decodificarDocumentoEmitido(bruto: Uint8Array): string {
  if (bruto.length > TETO_DOCUMENTO_BASE64) throw new ErroDocumento('Documento acima do teto de tamanho.');
  const b64 = Buffer.from(bruto).toString('latin1').replace(/\s+/g, '');
  if (b64 === '' || b64.length % 4 !== 0 || !BASE64.test(b64))
    throw new ErroDocumento('Documento ilegível: o conteúdo não está em base64.');
  let xml: Buffer;
  try {
    xml = inflateSync(Buffer.from(b64, 'base64'), { maxOutputLength: TETO_DOCUMENTO_DESCOMPRIMIDO });
  } catch (e) {
    const codigo = (e as { code?: string }).code ?? '';
    throw new ErroDocumento(
      codigo === 'ERR_BUFFER_TOO_LARGE'
        ? 'Documento acima do teto depois de descomprimido.'
        : 'Documento ilegível: a compressão não confere.',
    );
  }
  return codificacaoDeclarada(xml) === 'cp1252' ? decodificarCp1252(xml) : xml.toString('utf8');
}

export const esquemaGravacaoAlergia = z
  .object({
    paciente: ID,
    atendimento: ID,
    cbo: ID,
    /** Sem registro: a alergia do componente do formulário clínico, ligada só ao atendimento. */
    registro: ID.optional(),
    nega: z.boolean(),
    agente: ID.optional(),
    principios: z.array(ID).max(10),
    observacao: textoCp1252(255).optional(),
    reacao: textoCp1252(200).optional(),
    gravidade: z.enum(GRAVIDADES_ALERGIA).optional(),
    origem: z.enum(ORIGENS_ALERGIA).optional(),
    /** Manifestações do catálogo (03-PEP L100); a porta própria grava em alergia_paciente_manifestacao. */
    manifestacoes: z.array(ID).max(10).optional(),
    versao: z.string().max(200),
    hashConteudo: HASH,
    comoSuporte: z.boolean().optional(),
  })
  .strict()
  .refine((x) => x.nega || x.agente !== undefined, { path: ['agente'], message: 'agente' });

export const esquemaInativacaoAlergia = z
  .object({
    paciente: ID,
    alergia: ID,
    motivo: textoCp1252(500).pipe(z.string().trim().min(10)),
    versao: z.string().max(200),
  })
  .strict();

/** Reativação (pep.reativarAlergia): os mesmos campos da inativação. */
export const esquemaReativacaoAlergia = esquemaInativacaoAlergia;

/** Alteração (pep.alterarAlergia): o estado completo dos campos editáveis; o agente não muda. */
export const esquemaAlteracaoAlergia = z
  .object({
    paciente: ID,
    alergia: ID,
    gravidade: z.enum(GRAVIDADES_ALERGIA).nullable(),
    reacao: textoCp1252(200).nullable(),
    origem: z.enum(ORIGENS_ALERGIA).nullable(),
    observacao: textoCp1252(255).nullable(),
    manifestacoes: z.array(ID).max(10),
    motivo: textoCp1252(500).optional(),
    versao: z.string().max(200),
  })
  .strict();

export const esquemaRetratos = z.object({ htAtendimento: ID, htPaciente: ID }).strict();

export const TIPO_ATO = { atestado: 40, receita: 41, resultadoLancado: 54, pedidoExame: 79 } as const;

export const SITUACAO_DOC = { lancado: 1, suspenso: 2, solicitado: 9 } as const;

export const TIPOS_RECEITA = ['receita', 'receita-controlada', 'receita-antimicrobiano'] as const;

export const TIPOS_ATESTADO = ['atestado', 'declaracao', 'requerimento'] as const;

export const base = {
  paciente: ID,
  atendimento: ID,
  cbo: ID,
  retratos: esquemaRetratos,
  dataHoraClinica: HORA_LOCAL,
  justificativaRetroativo: textoCp1252(255).pipe(z.string().trim().min(10)).optional(),
  documento: z.string().min(50).max(4_000_000),
  hashConteudo: HASH,
  comoSuporte: z.boolean().optional(),
};

export const esquemaEmissaoDocumento = z.discriminatedUnion('familia', [
  z
    .object({
      familia: z.literal('receita'),
      ...base,
      tipo: z.enum(TIPOS_RECEITA),
      tpPadrao: z.union([z.literal(1), z.literal(4)]),
      rtf: z.string().min(10).max(2_000_000),
    })
    .strict(),
  z
    .object({
      familia: z.literal('atestado'),
      ...base,
      tipo: z.enum(TIPOS_ATESTADO),
      modeloNome: textoCp1252(50).pipe(z.string().trim().min(2)),
      conteudoXml: z.string().min(20).max(2_000_000),
      cid: z
        .string()
        .regex(/^[A-Z]\d{2}(\.?\d{1,2})?$/)
        .optional(),
      autorizacaoCid: z.enum(['paciente', 'responsavel']).optional(),
      corrige: ID.optional(),
      /** Dias de afastamento: obrigatório no atestado (CHECK do banco); declaração e requerimento não levam. */
      diasAfastamento: z.number().int().min(0).max(365).optional(),
    })
    .strict()
    .refine((x) => x.tipo !== 'atestado' || x.diasAfastamento !== undefined, {
      path: ['diasAfastamento'],
      message: 'diasAfastamento',
    }),
]);

export const esquemaSuspensaoDocumento = z
  .object({
    familia: z.enum(['receita', 'atestado']),
    paciente: ID,
    origem: ID,
    cbo: ID,
    justificativa: textoCp1252(70).pipe(z.string().trim().min(10)),
    documento: z.string().min(50).max(4_000_000),
  })
  .strict();

export const esquemaFinalizacaoSumario = z
  .object({
    paciente: ID,
    atendimento: ID,
    cbo: ID,
    retratos: esquemaRetratos,
    dataHoraClinica: HORA_LOCAL,
    modeloNome: textoCp1252(50).pipe(z.string().trim().min(2)),
    conteudoXml: z.string().min(20).max(2_000_000),
    documento: z.string().min(50).max(4_000_000),
    hashConteudo: HASH,
    versao: z.number().int().min(1).max(999),
    sumario: z.string().min(2).max(500_000),
    fhir: z.string().min(2).max(2_000_000),
    perfilFhir: z.string().min(2).max(30),
    comoSuporte: z.boolean().optional(),
    // F3.3 (L124): as linhas do sumário por seção vigente (regra linhasDoSumario do domínio), gravadas uma a uma.
    linhas: z
      .array(
        z
          .object({
            sequencia: z.number().int().min(1).max(9999),
            grupo: z.enum(GRUPOS_LINHA_SUMARIO),
            secao: z.string().min(1).max(30),
            titulo: z.string().trim().min(1).max(150),
            texto: z.string().max(4000).nullable(),
            cid10: z
              .string()
              .regex(/^[A-Z][0-9]{2}[0-9A-Z]{0,3}$/)
              .nullable(),
          })
          .strict()
          .refine((l) => l.texto !== null || l.cid10 !== null, { message: 'Linha sem conteúdo.' }),
      )
      .max(300)
      .optional(),
  })
  .strict();

export const esquemaAnexo = z
  .object({
    paciente: ID,
    atendimento: ID,
    cbo: ID,
    retratos: esquemaRetratos,
    dataHoraClinica: HORA_LOCAL,
    nome: textoCp1252(40).pipe(z.string().trim().min(2)),
    tipoAnexo: ID.optional(),
    referencia: z.iso.date().optional(),
    estacao: textoCp1252(100).pipe(z.string().trim().min(2)),
    conteudo: z.string().min(8).max(12_000_000),
    hashConteudo: HASH,
    comoSuporte: z.boolean().optional(),
  })
  .strict();

export const esquemaExameExterno = z
  .object({
    paciente: ID,
    atendimento: ID,
    cbo: ID,
    retratos: esquemaRetratos,
    dataHoraClinica: HORA_LOCAL,
    realizadoEm: HORA_LOCAL,
    nomeExame: textoCp1252(80).pipe(z.string().trim().min(2)),
    metodo: textoCp1252(80).optional(),
    rtf: z.string().min(10).max(2_000_000),
    itens: z
      .array(
        z
          .object({ elemento: textoCp1252(250).pipe(z.string().trim().min(1)), tipo: z.enum(['N', 'T']) })
          .strict(),
      )
      .max(60),
    documento: z.string().min(50).max(4_000_000),
    hashConteudo: HASH,
    comoSuporte: z.boolean().optional(),
  })
  .strict();

export type EstadoFormularioNovo = 'rascunho' | 'revisao' | 'publicado' | 'aposentado';

export type PonteFormularioNovo = 'modelo-legado' | 'registro-resumo' | 'so-sante';

export type TipoEventoFormularioNovo =
  'salvo' | 'revisao' | 'aprovado' | 'devolvido' | 'publicado' | 'aposentado';

export interface FormularioNovoLido {
  readonly id: number;
  readonly codigo: string;
  readonly versao: number;
  readonly estado: EstadoFormularioNovo;
  readonly titulo: string;
  readonly tipoRegistro: string;
  readonly formato: string;
  readonly definicao: unknown;
  readonly contentHash: string | null;
  readonly ponte: PonteFormularioNovo;
  readonly baseadoEm: number | null;
  readonly autor: string;
  readonly aprovadoPor: string | null;
  readonly aprovadoEm: string | null;
  readonly parecer: string | null;
  readonly publicadoPor: string | null;
  readonly publicadoEm: string | null;
  readonly aposentadoPor: string | null;
  readonly aposentadoEm: string | null;
  readonly motivoAposentadoria: string | null;
  readonly idModeloLegado: number | null;
  readonly codModelo: string | null;
  readonly versaoLinha: string;
  readonly atualizadoEm: string;
  readonly casos: readonly { readonly ordem: number; readonly caso: unknown }[];
}

export interface EventoFormularioNovoLido {
  readonly tipo: TipoEventoFormularioNovo;
  readonly por: string;
  readonly em: string;
  readonly contentHash: string | null;
  readonly texto: string | null;
}

export interface SalvarFormularioNovo {
  readonly hospital: string;
  readonly id: number | null;
  readonly baseadoEm: number | null;
  readonly codigo: string;
  readonly titulo: string;
  readonly tipoRegistro: string;
  readonly formato: string;
  readonly definicao: unknown;
  readonly casos: readonly { readonly nome: string; readonly caso: unknown }[];
  readonly autor: string;
  readonly versaoEsperada: string | null;
}

export type PassoFormularioNovo =
  | { readonly tipo: 'revisao' }
  | { readonly tipo: 'aprovado'; readonly parecer: string }
  | { readonly tipo: 'devolvido'; readonly parecer: string }
  | {
      readonly tipo: 'publicado';
      readonly contentHash: string;
      readonly ponte: PonteFormularioNovo;
      readonly idModeloLegado: number | null;
      readonly codModelo: string | null;
      readonly ligacoes: Readonly<Record<string, number>> | null;
    }
  | { readonly tipo: 'aposentado'; readonly motivo: string };

export interface MudancaFormularioNovo {
  readonly hospital: string;
  readonly id: number;
  readonly por: string;
  readonly versaoEsperada: string | null;
  readonly passo: PassoFormularioNovo;
}

export const esquemaPedidoExames = z
  .object({
    paciente: ID,
    atendimento: ID,
    cbo: ID,
    retratos: esquemaRetratos,
    dataHoraClinica: HORA_LOCAL,
    itens: z
      .array(
        z
          .object({
            exame: ID,
            urgente: z.boolean(),
            indicacao: textoCp1252(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(80),
    kit: ID.optional(),
    documento: z.string().min(50).max(4_000_000),
    hashConteudo: HASH,
    comoSuporte: z.boolean().optional(),
  })
  .strict();

export const UNIDADE = z.string().trim().min(1).max(10);

export const QTDE = z.number().nonnegative().max(1_000_000);

export const esquemaHorarioGravacao = z.object({ dataHora: HORA_LOCAL, relativo: ID.nullable() }).strict();

export const esquemaKit = z.object({ produto: ID, quantidade: QTDE, unidade: UNIDADE }).strict();

export const esquemaDetalheGravacao = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('medicamento'),
      produto: ID,
      dose: QTDE,
      unidade: UNIDADE,
      agora: z.boolean(),
      naoAjustar: z.boolean(),
      tempoInfusaoMinutos: z.number().int().positive().max(1_440).nullable(),
      naoPadronizado: z
        .object({ justificativa: textoCp1252(255).pipe(z.string().min(10)), htcid: ID })
        .strict()
        .nullable(),
      justificativaAlergia: textoCp1252(255).nullable(),
      seNecessario: z.array(ID).max(5),
      /** "Se necessário": intervalo mínimo entre doses (min) e dose máxima no período; nulos sem condição. */
      intervaloMinimoMinutos: z.number().int().positive().max(2_880).nullable().default(null),
      doseMaxima: z
        .object({ dose: QTDE, periodoHoras: z.number().int().min(1).max(72) })
        .strict()
        .nullable()
        .default(null),
      kit: z.array(esquemaKit).max(30),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('procedimento'),
      procedimento: ID,
      agora: z.boolean(),
      naoAjustar: z.boolean(),
      seNecessario: z.array(ID).max(5),
      faixas: z
        .array(
          z
            .object({
              de: z.number().int().min(0).max(9_999),
              ate: z.number().int().min(0).max(9_999),
              produto: ID,
              dose: QTDE,
              unidade: UNIDADE,
              via: UNIDADE,
            })
            .strict(),
        )
        .max(12),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('dieta'),
      /** Jejum e dieta livre sem quantidade; oral medida e enteral com quantidade (regra no domínio). */
      classe: z.enum(['jejum', 'livre', 'oral', 'enteral']),
      dieta: ID,
      viaDieta: ID.nullable(),
      quantidade: QTDE.nullable(),
      unidade: UNIDADE.nullable(),
      tipoInfusao: ID.nullable(),
      velocidade: QTDE.nullable(),
      unidadeInfusao: ID.nullable(),
      caracteristicas: z.array(z.object({ caracteristica: ID, resposta: textoCp1252(100) }).strict()).max(20),
      /** Composição por refeição do dia (03-PEP L112): alimento, quantidade, medida caseira e substituto. */
      refeicoes: z
        .array(
          z
            .object({
              refeicao: ID,
              alimento: ID,
              quantidade: QTDE,
              unidade: ID.nullable(),
              medidaCaseira: ID.nullable(),
              quantidadeMedidaCaseira: QTDE.nullable(),
              substitui: z.number().int().min(1).max(60).nullable(),
              percentualDiario: z.number().min(0).max(100).nullable(),
              calorias: z.number().min(0).max(20_000).nullable(),
            })
            .strict(),
        )
        .max(60)
        .optional(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('solucao'),
      unidade: UNIDADE,
      tipoInfusao: ID,
      agora: z.boolean(),
      naoAjustar: z.boolean(),
      componentes: z
        .array(
          z.object({ produto: ID, dose: QTDE, unidade: UNIDADE, principal: z.boolean(), etapa: ID }).strict(),
        )
        .min(1)
        .max(40),
      etapas: z
        .array(
          z
            .object({
              etapa: ID,
              inicio: HORA_LOCAL,
              fim: HORA_LOCAL,
              velocidade: QTDE,
              unidadeInfusao: ID,
              volume: QTDE,
            })
            .strict(),
        )
        .min(1)
        .max(24),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('vmi'),
      viaAerea: ID,
      modo: ID,
      unidade: UNIDADE,
      /** Parâmetro não prescrito vem nulo e fica nulo (sem sentinela); faixas clínicas no domínio. */
      frequenciaRespiratoria: z.number().int().min(0).max(80).nullable(),
      peep: z.number().min(0).max(40).nullable(),
      volumeCorrente: QTDE.nullable(),
      pressao: z.number().min(0).max(80).nullable(),
      unidadePressao: ID.nullable(),
      fio2: z.number().int().min(0).max(100).nullable(),
      unidadeFio2: ID.nullable(),
      tempoInspiratorio: QTDE.nullable(),
      tempoExpiratorio: QTDE.nullable(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('vni'),
      viaAerea: ID,
      modo: ID,
      pressaoInspiratoria: z.number().min(0).max(80).nullable(),
      unidadePressaoInspiratoria: ID.nullable(),
      /** EPAP (CPAP quando só ele), pressão de suporte e duração da sessão. */
      pressaoExpiratoria: z.number().min(0).max(40).nullable().default(null),
      pressaoSuporte: z.number().min(0).max(40).nullable().default(null),
      duracaoMinutos: z.number().int().positive().max(1_440).nullable().default(null),
      fio2: z.number().int().min(0).max(100).nullable(),
      unidadeFio2: ID.nullable(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('hemoterapia'),
      ato: z.number().int().min(0),
      codigo: z.string().trim().min(1).max(20),
      dose: QTDE,
      unidade: UNIDADE,
      tipoInfusao: ID,
      indicacao: textoCp1252(2_000).nullable(),
      agora: z.boolean(),
    })
    .strict(),
]);

export const esquemaItemGravacao = z
  .object({
    chave: z.string().min(1).max(40),
    plano: ID,
    numDose: z.number().int().min(0).max(48),
    frequencia: ID.nullable(),
    via: UNIDADE.nullable(),
    observacao: textoCp1252(2_000).nullable(),
    integracaoEstoque: z.boolean(),
    detalhe: esquemaDetalheGravacao,
    horarios: z.array(esquemaHorarioGravacao).max(48),
  })
  .strict();

export type ItemGravacao = z.infer<typeof esquemaItemGravacao>;

export const esquemaPrescricaoGravada = z
  .object({
    prioridade: z.enum(['rotina', 'urgente']),
    nota: textoCp1252(4_000).nullable(),
    coassinaturaExigida: z.boolean(),
    origemModo: z.enum(['copia', 'renovacao', 'protocolo', 'kit', 'futura']).nullable(),
    origemId: ID.nullable(),
    itens: z
      .array(
        z
          .object({
            chave: z.string().min(1).max(40),
            pesoKg: z.number().positive().nullable(),
            alturaCm: z.number().positive().nullable(),
            clearance: z.number().positive().nullable(),
            dataDado: z.string().max(19).nullable(),
            regraDose: z.string().max(20).nullable(),
            dosePorUnidade: z.number().positive().nullable(),
            altaVigilancia: z.boolean(),
            duplaChecagem: z.boolean(),
          })
          .strict(),
      )
      .max(150),
    decisoes: z
      .array(
        z
          .object({
            chave: z.string().min(1).max(40),
            alerta: z.string().min(1).max(120),
            tipo: z.string().min(1).max(30),
            nivel: z.enum(['aviso', 'justificar', 'bloqueio']),
            regra: z.string().min(1).max(40),
            versaoRegra: z.number().int().positive(),
            decisao: z.enum(['mantido', 'retirado', 'exibido']),
            justificativa: textoCp1252(500).nullable(),
          })
          .strict(),
      )
      .max(500),
    fichas: z
      .array(
        z
          .object({
            chave: z.string().min(1).max(40),
            produto: ID,
            indicacao: textoCp1252(500),
            sitio: textoCp1252(100),
            tipo: z.enum(['empirico', 'dirigido', 'profilatico']),
            culturaColhida: z.boolean(),
            diaTratamento: z.number().int().min(1).max(180),
            duracaoDias: z.number().int().min(1).max(180).nullable(),
          })
          .strict(),
      )
      .max(50),
    futuras: z.array(ID).max(50),
    comoSuporte: z.boolean(),
  })
  .strict();

export interface NovaVersaoRegra {
  readonly codigo: string;
  readonly tipo: string;
  readonly nivel: 'aviso' | 'justificar' | 'bloqueio';
  readonly vigenteDesde: string;
  readonly ativa: boolean;
  readonly descricao: string;
  readonly justificativa: string | null;
  readonly grauGravidade?: number | null;
  readonly classeInteracao?: number | null;
}

export interface FuturaProgramada {
  readonly atendimento: number;
  readonly paciente: number;
  readonly aPartirDe: string;
  readonly descricao: string;
  readonly itemJson: string;
  readonly motivo: string | null;
}

export interface ReconciliacaoGravacao {
  readonly atendimento: number;
  readonly paciente: number;
  readonly momento: 'admissao' | 'transferencia' | 'alta';
  readonly linhas: readonly {
    readonly descricao: string;
    readonly produto: number | null;
    readonly dose: string | null;
    readonly frequencia: string | null;
    readonly fonte: string;
    readonly conduta: string;
    readonly justificativa: string | null;
    readonly item: number | null;
  }[];
}

export interface FichaAvulsa {
  readonly atendimento: number;
  readonly paciente: number;
  readonly prescricao: number | null;
  readonly item: number | null;
  readonly produto: number;
  readonly indicacao: string;
  readonly sitio: string;
  readonly tipo: 'empirico' | 'dirigido' | 'profilatico';
  readonly culturaColhida: boolean;
  readonly diaTratamento: number;
  readonly duracaoDias: number | null;
}

export interface NovaGradeClasse {
  readonly unidade: number;
  readonly classe: string;
  readonly numDoses: number;
  readonly horarios: readonly string[];
  readonly vigenteDesde: string;
  readonly ativa: boolean;
}

export const JUSTIFICATIVA = textoCp1252(255);

export const esquemaSuspensaoPrescricao = z
  .object({
    prescricao: ID,
    paciente: ID,
    atendimento: ID,
    cbo: ID,
    justificativa: JUSTIFICATIVA,
    documento: z.string().min(1).max(4_000_000),
    hashConteudo: z.string().regex(/^[0-9a-f]{64}$/),
    comoSuporte: z.boolean(),
  })
  .strict();

export type SuspensaoPrescricao = z.infer<typeof esquemaSuspensaoPrescricao>;

export const esquemaSuspensaoItem = z
  .object({
    prescricao: ID,
    item: ID,
    paciente: ID,
    atendimento: ID,
    cbo: ID,
    justificativa: JUSTIFICATIVA,
    correcao: esquemaItemGravacao.nullable(),
    documento: z.string().min(1).max(4_000_000),
    hashConteudo: z.string().regex(/^[0-9a-f]{64}$/),
    comoSuporte: z.boolean(),
    sgh: esquemaPrescricaoGravada.optional(),
  })
  .strict();

export type SuspensaoItem = z.infer<typeof esquemaSuspensaoItem>;

export const esquemaGravacaoPrescricao = z
  .object({
    paciente: ID,
    atendimento: ID,
    cbo: ID,
    retratos: z.object({ htAtendimento: ID, htPaciente: ID }).strict(),
    dataHora: HORA_LOCAL,
    vigencia: z.object({ inicio: HORA_LOCAL, fim: HORA_LOCAL }).strict(),
    justificativaRetroativo: textoCp1252(255).nullable(),
    observacaoGeral: textoCp1252(4_000).nullable(),
    protocolos: z.array(ID).max(20),
    itens: z.array(esquemaItemGravacao).min(1).max(150),
    origem: z
      .object({
        prescricao: ID,
        modo: z.enum(['copia', 'renovacao']),
        itens: z.array(z.object({ item: ID, ativo: z.boolean() }).strict()).max(300),
      })
      .strict()
      .nullable(),
    documento: z.string().min(1).max(4_000_000),
    hashConteudo: z.string().regex(/^[0-9a-f]{64}$/),
    sgh: esquemaPrescricaoGravada,
  })
  .strict();

export type GravacaoPrescricao = z.infer<typeof esquemaGravacaoPrescricao>;

export const esquemaInclusaoItem = z
  .object({
    prescricao: ID,
    paciente: ID,
    atendimento: ID,
    cbo: ID,
    item: esquemaItemGravacao,
    documento: z.string().min(1).max(4_000_000),
    hashConteudo: z.string().regex(/^[0-9a-f]{64}$/),
    sgh: esquemaPrescricaoGravada,
  })
  .strict();

export type InclusaoItem = z.infer<typeof esquemaInclusaoItem>;

export const MARCADOR_REGISTRO = '{{REGISTRO}}';

export const SITUACAO_LANCADO = 1;

export const SITUACAO_SUSPENSO = 2;

export const esquemaLinhaGravacao = z.object({
  ordem: z.string().regex(/^(\d{2}){1,6}$/),
  seq: z.number().int().min(0).max(999),
  idResposta: ID,
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  hora: z
    .string()
    .regex(/^([01]\d|2[0-3])[0-5]\d$/)
    .nullable(),
  indice: z
    .string()
    .regex(/^\d{1,2}$/)
    .nullable(),
  valor: z.number().finite().nullable(),
  alfa: textoCp1252(255).nullable(),
  texto: z.string().max(2_000_000).nullable(),
  unidade: textoCp1252(10),
  cid: z
    .string()
    .regex(/^[A-Z]\d{2}(\.\d{1,2})?$/)
    .nullable(),
  autopreenchido: z.boolean(),
});

export type LinhaGravacao = z.infer<typeof esquemaLinhaGravacao>;

export const esquemaRepresentacaoGravada = z
  .object({
    impressao: z.string().regex(/^[0-9a-f]{64}$/),
    selo: z.string().regex(/^[\d.]{1,120}$/),
    codigo: z.string().max(10).nullable(),
    versaoLayout: z.number().int().nullable(),
    representacao: z.unknown(),
  })
  .strict();

export const sinalOuNulo = z.number().finite().min(0).max(1500).nullable();

export const CORES_CLASSIFICACAO = z.enum(['vermelho', 'laranja', 'amarelo', 'verde', 'azul']);

export const esquemaClassificacaoNoRegistro = z
  .object({
    cabecalho: z.string().regex(/^\d{1,18}$/),
    reg: ID,
    versaoProtocolo: ID,
    fluxograma: z.string().min(2).max(60),
    discriminadores: z.array(z.string().min(2).max(60)).max(60),
    automaticos: z.array(z.string().min(2).max(60)).max(60),
    sinais: z
      .object({
        pas: sinalOuNulo,
        pad: sinalOuNulo,
        fc: sinalOuNulo,
        fr: sinalOuNulo,
        temperatura: sinalOuNulo,
        saturacao: sinalOuNulo,
        glicemia: sinalOuNulo,
        dor: sinalOuNulo,
        glasgow: sinalOuNulo,
      })
      .strict(),
    corProposta: CORES_CLASSIFICACAO,
    corFinal: CORES_CLASSIFICACAO,
    justificativa: textoCp1252(500).nullable(),
    motivo: z.enum(['inicial', 'estouro', 'mudanca_quadro']),
    descricaoMudanca: textoCp1252(500).nullable(),
    anterior: ID.nullable(),
    tempoAlvoMin: z.number().int().min(0).max(1440),
    comPrioridade: z.boolean(),
    eventos: z
      .array(
        z
          .object({
            evento: z.string().regex(/^recepcao\.classificacao\.[a-zA-Z]{3,40}$/),
            chave: z.string().max(200),
          })
          .strict(),
      )
      .max(3)
      .default([]),
  })
  .strict();

export const esquemaGravacaoEvolucao = z
  .object({
    paciente: ID,
    modelo: ID,
    atendimento: ID,
    cbo: ID,
    dataHoraClinica: HORA_LOCAL,
    justificativaRetroativo: textoCp1252(255).optional(),
    toleranciaMin: z.number().int().min(0).max(1440),
    /** 03-PEP L91: a assinatura exigida do estabelecimento (parâmetro), quando o setor não tem configuração. */
    assinaturaEstabelecimento: z.enum(['nenhuma', 'eletronica', 'digital_icp']).optional(),
    retratos: esquemaRetratos,
    linhas: z.array(esquemaLinhaGravacao).min(1).max(5_000),
    rtf: z.string().min(10).max(4_000_000),
    xml: z
      .string()
      .min(10)
      .max(8_000_000)
      .refine((s) => s.includes(MARCADOR_REGISTRO), 'XML sem o marcador do registro.'),
    documento: z
      .string()
      .min(10)
      .max(8_000_000)
      .refine((s) => s.includes(MARCADOR_REGISTRO), 'Documento sem o marcador.'),
    rascunho: z
      .object({ id: ID, versao: z.string().min(8).max(64) })
      .strict()
      .optional(),
    hashConteudo: z.string().regex(/^[0-9a-f]{64}$/),
    representacao: esquemaRepresentacaoGravada,
    corrige: ID.optional(),
    comoSuporte: z.boolean().optional(),
    fluxo: z
      .discriminatedUnion('tipo', [
        z
          .object({
            tipo: z.literal('pedido'),
            especialidade: ID.nullable(),
            categoria: z.string().max(30).nullable(),
            prioridade: z.enum(['rotina', 'prioritario', 'urgente']),
            prazo: z.iso.datetime().nullable(),
          })
          .strict(),
        z.object({ tipo: z.literal('resposta'), parecer: ID }).strict(),
      ])
      .optional(),
    supervisao: z
      .object({ preceptor: z.string().trim().min(1).max(31), idProfissional: ID })
      .strict()
      .optional(),
    classificacao: esquemaClassificacaoNoRegistro.optional(),
  })
  .strict();

export type GravacaoEvolucao = z.infer<typeof esquemaGravacaoEvolucao>;

export const esquemaGravacaoRascunho = z
  .object({
    paciente: ID,
    modelo: ID,
    atendimento: ID,
    cbo: ID,
    dataHoraClinica: HORA_LOCAL,
    justificativaRetroativo: textoCp1252(255).optional(),
    retratos: esquemaRetratos,
    linhas: z.array(esquemaLinhaGravacao).max(5_000),
    rascunho: z
      .object({ id: ID, versao: z.string().min(8).max(64) })
      .strict()
      .optional(),
    corrige: ID.optional(),
  })
  .strict();

export type GravacaoRascunho = z.infer<typeof esquemaGravacaoRascunho>;

export const esquemaDescarteRascunho = z
  .object({ rascunho: ID, versao: z.string().min(8).max(64), cbo: ID })
  .strict();

export type DescarteRascunho = z.infer<typeof esquemaDescarteRascunho>;

export const esquemaSuspensaoEvolucao = z
  .object({
    registro: ID,
    cbo: ID,
    justificativa: textoCp1252(200).pipe(z.string().trim().min(10)),
    documento: z.string().min(10).max(8_000_000),
    comoSuporte: z.boolean().optional(),
  })
  .strict();

export type SuspensaoEvolucao = z.infer<typeof esquemaSuspensaoEvolucao>;

export interface RepresentacaoGravada {
  readonly id: number;
  readonly impressao: string;
  readonly selo: string;
  readonly representacao: unknown;
}

export interface ContextoGravacaoPep extends ContextoPorta {
  readonly usuarioLogin: string;
  readonly traceId: string;
  readonly estacao?: string | null;
}

export class ErroProntuario extends Error {
  override readonly name = 'ErroProntuario';
  readonly codigo: string;
  readonly status: number;
  constructor(codigo: string, mensagem: string, status = 409) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
  }
}

export interface ProblemaNovo {
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly descricao: string;
  readonly cid: string | null;
  readonly idCid: number | null;
  readonly tipo: 'problema' | 'diagnostico';
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly situacao: 'ativo' | 'resolvido' | 'descartado';
  readonly anterior: number | null;
}

export interface LinhaPainelLida {
  readonly paciente: number;
  readonly nome: string;
  readonly nomeSocial: string | null;
  readonly nascimento: string | null;
  readonly sexo: string | null;
  readonly prontuario: number;
  readonly atendimento: number;
  readonly registro: number;
  readonly tipo: 'internacao' | 'externo';
  readonly entrada: string | null;
  readonly unidade: string | null;
  readonly idUnidade: number | null;
  readonly leito: string | null;
  readonly convenio: string | null;
  readonly medico: string | null;
  readonly alergiasAtivas: number;
}

export interface RecortePainel {
  readonly meus?: { readonly cbos: readonly number[]; readonly login: string; readonly hospital: string };
  readonly equipe?: { readonly especialidades: readonly number[] };
  /** Recortes do filtro salvo (F3.3, L90): cada um preenchido precisa bater; nulo não recorta. */
  readonly filtro?: RecortesFiltroPainel;
}

export interface RecortesFiltroPainel {
  readonly setor: number | null;
  readonly acomodacao: number | null;
  readonly leito: number | null;
  readonly especialidade: number | null;
  readonly tipoAtendimento:
    'todos' | 'internacao' | 'ambulatorio' | 'urgencia' | 'externo' | 'domiciliar' | null;
  readonly situacao: 'em_atendimento' | 'aguardando' | 'alta_prevista' | 'alta' | 'todos' | null;
}

export interface CompletudePainelLida {
  readonly evolucoesMedicas: readonly { atendimento: number; em: string }[];
  readonly alergiasInformadas: readonly { paciente: number; em: string }[];
  readonly negas: readonly { paciente: number; em: string }[];
  readonly valores: readonly {
    paciente: number;
    exame: number;
    elemento: string;
    numerico: number;
    minAbe: number | null;
    maxAbe: number | null;
    liberadoEm: string | null;
  }[];
  readonly ciencias: readonly { paciente: number; exame: number }[];
  readonly pareceres: readonly { paciente: number; situacao: FluxoLido['situacao']; prazo: string | null }[];
}

export interface PacientePepLido {
  readonly id: number;
  readonly nome: string;
  readonly nomeSocial: string | null;
  readonly nascimento: string | null;
  readonly sexo: string | null;
  readonly prontuario: number;
  readonly obito: string | null;
}

export interface AtendimentoPepLido {
  readonly id: number;
  readonly registro: number;
  readonly tipo: 'internacao' | 'externo';
  readonly entrada: string | null;
  readonly alta: string | null;
  readonly unidade: string | null;
  readonly leito: string | null;
  readonly convenio: string | null;
  readonly medico: string | null;
}

export interface EventoLido {
  readonly chave: string;
  readonly tipo: string;
  readonly quando: string;
  readonly titulo: string;
  readonly detalhe: string | null;
  readonly profissional: string | null;
  readonly cbo: string | null;
  readonly suspenso: boolean;
  readonly situacao: string | null;
  readonly documento: { tipo: string; id: number } | null;
}

export interface DocumentoHistoricoLido {
  readonly tipo: string;
  readonly id: number;
  readonly titulo: string;
  readonly emitidoEm: string | null;
  readonly profissional: string | null;
  readonly cbo: string | null;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly suspensoEm: string | null;
  readonly justificativaSuspensao: string | null;
  readonly rtf: string | null;
  readonly xml: string | null;
  readonly retratos: { htPaciente: number; htAtendimento: number } | null;
  readonly modelo: string | null;
  readonly corrige: number | null;
}

export interface AnexoLido {
  readonly id: number;
  readonly paciente: number;
  readonly nome: string | null;
  readonly extensao: string | null;
  readonly tipo: string | null;
  readonly em: string | null;
  readonly profissional: string | null;
  readonly suspenso: boolean;
  readonly bytes: number | null;
}

export interface DocumentoResumoLido {
  readonly id: number;
  readonly familia: 'receita' | 'atestado';
  readonly titulo: string;
  readonly em: string | null;
  readonly profissional: string | null;
  readonly atendimento: number | null;
  readonly suspenso: boolean;
  readonly corrige: number | null;
  readonly tpPadrao: number | null;
}

export interface FichaImpressao {
  readonly codigo: number;
  readonly nome: string;
  readonly tipo: number | null;
  readonly componentes: { nome: string; modelo: string | null }[];
}

export interface AlergiaDoProntuarioLida {
  readonly id: number;
  /** Alérgeno do catálogo; null na alergia de descrição livre. */
  readonly agenteId: number | null;
  readonly agente: string;
  readonly tipo: string | null;
  readonly observacao: string | null;
  readonly ativa: boolean;
  /** Registro clínico em que foi informada; null na alergia sem registro clínico (classificação de risco ou importada). */
  readonly registro: number | null;
  readonly registradaEm: string | null;
  readonly profissional: string | null;
  readonly principios: string[];
  /** Agente descrito em texto (não cadastrado), quando houver. */
  readonly descricaoLivre: string | null;
  readonly tipoRegistro: 'alergia' | 'intolerancia';
  readonly reacao: string | null;
  readonly gravidade: string | null;
  readonly certeza: string | null;
  readonly origemInformacao: string | null;
  readonly inativadaEm: string | null;
  readonly motivoInativacao: string | null;
  /** Estabelecimento (do mesmo cliente) em que a alergia foi registrada. */
  readonly estabelecimentoId: number;
}

export interface ExameCatalogoLido {
  readonly id: number;
  readonly ato: number;
  readonly codigo: string;
  readonly nome: string;
  readonly ativo: boolean;
  readonly sexo: 'F' | 'M' | null;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly material: number | null;
}

export interface PedidoLido {
  readonly id: number;
  readonly agrupamento: number | null;
  readonly exame: number;
  readonly nome: string;
  readonly ato: number;
  readonly data: string | null;
  readonly solicitadoEm: string | null;
  readonly urgente: boolean;
  readonly pendSadt: string | null;
  readonly liberado: boolean;
  readonly profissional: string | null;
  readonly indicacao: string | null;
}

export interface ValorLido {
  readonly elemento: string;
  readonly numerico: number | null;
  readonly alfa: string | null;
  readonly unidade: string | null;
  readonly refIni: number | null;
  readonly refFin: number | null;
  readonly referencia: string | null;
  readonly minAbe: number | null;
  readonly maxAbe: number | null;
}

export interface ResultadoLido {
  readonly exame: number;
  readonly nome: string;
  readonly chave: {
    data: string;
    reg: number;
    conta: number;
    atend: string;
    ato: number;
    exame: string;
    sequencia: number;
  };
  readonly liberadoEm: string | null;
  readonly valores: ValorLido[];
  readonly texto: string | null;
}

export interface DocumentoProprioLido {
  readonly id: number;
  readonly tipo: string;
  readonly origemTabela: string;
  readonly origemId: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly usuario: string;
  readonly hash: string;
  readonly nivel: string;
  readonly criadoEm: string | null;
  readonly assinadoEm: string | null;
  readonly suspenso: boolean;
  readonly comoSuporte: boolean;
}

export interface ProblemaLido {
  readonly id: number;
  readonly anterior: number | null;
  readonly descricao: string;
  readonly cid: string | null;
  readonly tipo: 'problema' | 'diagnostico';
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly situacao: 'ativo' | 'resolvido' | 'descartado';
  readonly usuario: string;
  readonly em: string;
}

export interface TcleLido {
  readonly id: number;
  readonly anterior: number | null;
  readonly atendimento: number;
  readonly tipo: number | null;
  readonly procedimento: string;
  readonly situacao: 'pendente' | 'assinado' | 'revogado';
  readonly motivo: string | null;
  readonly documento: number | null;
  readonly usuario: string;
  readonly em: string;
}

export interface SumarioLido {
  readonly versao: number;
  readonly situacao: 'rascunho' | 'finalizado';
  readonly conteudo: string | null;
  readonly documento: number | null;
  readonly usuario: string;
  readonly em: string;
}

export interface SupervisaoLida {
  readonly id: number;
  readonly registro: number;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly residente: string;
  readonly preceptor: string;
  readonly situacao: 'pendente' | 'coassinado' | 'recusado';
  readonly em: string | null;
}

export interface EpisodioLido {
  readonly motivoInternacao: string | null;
  readonly procedimentos: readonly string[];
  readonly exames: readonly string[];
  /** F3.3 (L124): os mesmos itens com o momento clínico, para a janela de cada seção (banco próprio). */
  readonly datados?: {
    readonly procedimentos: readonly ItemDatado[];
    readonly exames: readonly ItemDatado[];
  };
}

export interface CienciaLida {
  readonly exame: number;
  readonly usuario: string;
  readonly em: string;
  readonly conduta: string;
  readonly elemento: string | null;
}

export interface FluxoLido {
  readonly id: number;
  readonly tipo: string;
  readonly paciente: number;
  readonly atendimento: number | null;
  readonly pedido: number | null;
  readonly resposta: number | null;
  readonly especialidade: number | null;
  readonly categoria: string | null;
  readonly prioridade: 'rotina' | 'prioritario' | 'urgente';
  readonly prazo: string | null;
  readonly situacao: 'solicitado' | 'aceito' | 'respondido' | 'cancelado';
  readonly origem: 'novo' | 'legado';
  readonly solicitante: string;
  readonly aceitoPor: string | null;
  readonly criadoEm: string;
}

export interface PerguntaDoBancoLida {
  readonly id: number;
  readonly descricao: string;
  readonly tipoperg: string;
  readonly unidade: string | null;
  readonly ativo: boolean;
  readonly opcoes: readonly string[];
  readonly usoEmModelos: number;
}

export interface RespostaCadastradaLida {
  readonly cod: number;
  readonly descricao: string;
}

export interface EspecialidadeLida {
  readonly codigo: number;
  readonly nome: string;
}

export interface ModeloFormularioLido {
  readonly id: number;
  readonly codigo: string | null;
  readonly descricao: string | null;
  readonly fase: number | null;
}

export interface DefinicaoFormularioLida {
  readonly modelo: ModeloFormularioLido;
  readonly vinculos: {
    readonly id: number;
    readonly idPergunta: number;
    readonly ordem: string;
    readonly obrigatorio: string | null;
    readonly ativo: string | null;
  }[];
  readonly perguntas: {
    readonly id: number;
    readonly codPergunta: number;
    readonly descricao: string | null;
    readonly tipo: string | null;
    readonly unidade: string | null;
    readonly ativo: string | null;
    readonly manterHist: number | null;
  }[];
  readonly respostas: {
    readonly id: number;
    readonly idPergunta: number;
    readonly cod: number | null;
    readonly ordem: number;
    readonly ativo: boolean;
    readonly descricao: string | null;
  }[];
  readonly componentes: {
    readonly id: number;
    readonly idVinculo: number;
    readonly classe: string;
    readonly pai: string;
    readonly ordemCriacao: number | null;
    readonly dfm: string;
  }[];
  readonly versoes: { readonly versao: number; readonly componentes: number }[];
  readonly colunasGrade: {
    readonly idPerguntaGrade: number;
    readonly coluna: number;
    readonly idPergunta: number;
    readonly descricao: string | null;
    readonly tipo: string | null;
    readonly unidade: string | null;
    readonly idResposta: number | null;
  }[];
  readonly bytesDfm: number;
}

export interface ConsultaCadastroLida {
  readonly linhas: LinhaCadastroPrescricao[];
  readonly truncada: boolean;
}

export interface RegraAlertaLida {
  readonly id: number;
  readonly codigo: string;
  readonly tipo: string;
  readonly nivel: 'aviso' | 'justificar' | 'bloqueio';
  readonly versao: number;
  readonly vigenteDesde: string;
  readonly ativa: boolean;
  readonly descricao: string;
  readonly autor: string;
  readonly criadaEm: string | null;
}

export interface InteracaoLida {
  readonly a: number;
  readonly b: number;
  readonly gravidade: 'leve' | 'moderada' | 'grave' | 'contraindicada';
  readonly efeito: string;
  readonly fonte: string;
  readonly versaoBase: string;
}

export interface ProvaPrescricaoLida {
  readonly eventos: readonly {
    readonly tipo: string;
    readonly item: number | null;
    readonly em: string;
    readonly usuario: string;
    readonly hashAnterior: string;
    readonly comoSuporte: boolean;
  }[];
  readonly coassinaturaExigida: boolean;
  readonly coassinada: boolean;
}

export interface DecisaoLida {
  readonly item: number | null;
  readonly chave: string;
  readonly tipo: string;
  readonly decisao: string;
  readonly justificativa: string | null;
  readonly regra: string;
  readonly versao: number;
}

export interface FuturaGravadaLida {
  readonly id: number;
  readonly aPartirDe: string;
  readonly descricao: string;
  readonly situacao: 'programada' | 'efetivada' | 'cancelada';
  readonly prescricao: number | null;
  readonly itemJson: string | null;
}

export interface ReconciliacaoGravadaLida {
  readonly lote: number;
  readonly momento: 'admissao' | 'transferencia' | 'alta';
  readonly em: string | null;
  readonly usuario: string;
  readonly linhas: readonly {
    readonly descricao: string;
    readonly produto: number | null;
    readonly dose: string | null;
    readonly frequencia: string | null;
    readonly fonte: string;
    readonly conduta: string;
    readonly justificativa: string | null;
    readonly item: number | null;
  }[];
}

export interface FichaNovaLida {
  readonly id: number;
  readonly paciente: number;
  readonly item: number | null;
  readonly produto: number;
  readonly produtoNome: string | null;
  readonly indicacao: string;
  readonly sitio: string;
  readonly tipo: string;
  readonly culturaColhida: boolean;
  readonly diaTratamento: number;
  readonly em: string | null;
}

export interface GradeClasseLida {
  readonly id: number;
  readonly unidade: number;
  readonly classe: string;
  readonly numDoses: number;
  readonly horarios: readonly string[];
  readonly vigenteDesde: string;
  readonly ativa: boolean;
  readonly autor: string;
}

export interface AtendimentoDaPrescricao {
  readonly id: number;
  readonly numero: number | null;
  readonly paciente: number;
  readonly tipo: string;
  readonly aberto: boolean;
  readonly bloco: string | null;
  readonly unidade: number | null;
  readonly convenio: number | null;
}

export interface PrescritorLido {
  readonly cbo: number;
  readonly ocupacao: string | null;
  readonly nome: string | null;
}

export interface RegraHorarioLida {
  readonly id: number;
  readonly tipoAtendimento: string;
  readonly horarioInicial: string | null;
  readonly considerar: number | null;
  readonly padrao: boolean;
  readonly grade: ReadonlyMap<number, readonly string[]>;
}

export interface PrescricaoCabecalhoLida {
  readonly id: number;
  readonly atendimento: number | null;
  readonly htPaciente: number;
  readonly htAtendimento: number;
  readonly dataHora: string | null;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly cbo: number;
  readonly prescritor: string | null;
  readonly suspensaoEm: string | null;
  readonly suspensaoPor: string | null;
  readonly suspensaoJustificativa: string | null;
  readonly gravacao: string | null;
  readonly itens: number;
}

export interface HorarioPadraoLido {
  readonly id: number;
  readonly dataHora: string;
  readonly situacao: string;
  readonly acessoria: boolean;
}

export interface ItemPrescricaoLido {
  readonly id: number;
  readonly prescricao: number;
  readonly plano: number;
  readonly planoNome: string | null;
  readonly numDoses: number | null;
  readonly frequencia: number | null;
  readonly frequenciaNome: string | null;
  readonly via: string | null;
  readonly observacaoEnfermagem: string | null;
  readonly cboLancamento: number;
  readonly incluidoEm: string | null;
  readonly corrigidoEm: string | null;
  /**
   * Item suspenso ou cancelado pela situação gravada no próprio item (banco próprio), mesmo sem horários marcados.
   * Ausente na origem que marca a suspensão só nos horários (o domínio decide pelos horários, como antes).
   */
  readonly suspenso?: boolean;
  readonly gravacao: string | null;
  readonly detalhe: DetalheLido;
  readonly horarios: readonly HorarioPadraoLido[];
}

export type DetalheLido =
  | {
      readonly tipo: 'medicamento';
      readonly id: number;
      readonly produto: number | null;
      readonly produtoNome: string | null;
      readonly dose: number | null;
      readonly unidade: string | null;
      readonly agora: boolean;
      readonly naoAjustar: boolean;
      readonly motivosSeNecessario: readonly number[];
      readonly justificativaNaoPadronizado: string | null;
      readonly justificativaAlergia: string | null;
      readonly principios: readonly number[];
    }
  | {
      readonly tipo: 'dieta';
      readonly id: number;
      readonly dieta: number;
      readonly dietaNome: string | null;
      readonly quantidade: number | null;
      readonly viaDieta: number | null;
    }
  | {
      readonly tipo: 'procedimento';
      readonly id: number;
      readonly procedimento: number;
      readonly procedimentoNome: string | null;
      readonly faixas: readonly {
        de: number;
        ate: number;
        produto: number | null;
        dose: number | null;
        unidade: string | null;
      }[];
      readonly agora: boolean;
      readonly motivosSeNecessario: readonly number[];
    }
  | {
      readonly tipo: 'solucao';
      readonly id: number;
      readonly volumeTotal: number | null;
      readonly componentes: readonly {
        produto: number | null;
        nome: string | null;
        dose: number | null;
        unidade: string | null;
        principal: boolean;
      }[];
    }
  | {
      readonly tipo: 'ventilacao';
      readonly id: number;
      readonly modo: number;
      readonly modoNome: string | null;
    }
  | {
      readonly tipo: 'hemoterapia';
      readonly id: number;
      readonly ato: number;
      readonly codigo: string;
      readonly nome: string | null;
      readonly dose: number | null;
      readonly unidade: string | null;
    }
  | {
      readonly tipo: 'outro';
      readonly id: null;
      /**
       * Resumo do que foi prescrito, quando a leitura o monta (dieta com composição por refeição, 03-PEP L112: cada
       * refeição com os alimentos, a quantidade, a medida caseira e o substituto).
       */
      readonly resumo?: string;
    };

export interface ProdutoLido {
  readonly produto: number;
  readonly nome: string;
  readonly unidade: string | null;
  readonly padronizado: boolean;
  readonly psicotropico: boolean;
  readonly portaria: string | null;
  readonly antimicrobiano: boolean;
  readonly principios: readonly { id: number; nome: string }[];
  readonly vias: readonly string[];
  readonly potencialmentePerigoso: boolean;
  readonly periodoMinimoHoras: number | null;
  readonly faixasDose: readonly { unidade: string; minima: number | null; maxima: number | null }[];
}

export interface ItemDoIndice {
  readonly produto: number;
  readonly nome: string;
  readonly unidade: string | null;
  readonly padronizado: boolean;
  readonly psicotropico: boolean;
  readonly portaria: string | null;
  readonly antimicrobiano: boolean;
  readonly potencialmentePerigoso: boolean;
  readonly principios: readonly { id: number; nome: string }[];
  readonly faixasDose: ProdutoLido['faixasDose'];
}

export interface AlergiaLida {
  readonly alergia: number;
  readonly nome: string;
  readonly principios: readonly number[];
}

export interface DadosClinicosLidos {
  readonly pesoKg: number | null;
  readonly alturaCm: number | null;
  readonly dataPeso: string | null;
  readonly sexo: 'F' | 'M' | null;
  readonly nascimento: string | null;
  readonly creatinina: number | null;
  readonly dataCreatinina: string | null;
}

export interface KitMedicamentoLido {
  readonly id: number;
  readonly produto: number;
  readonly doseDe: number;
  readonly doseAte: number;
  readonly unidade: string;
  readonly via: string;
  readonly tipoAtendimento: string | null;
  readonly itens: readonly { produto: number; quantidade: number; unidade: string }[];
}

export interface ProtocoloLido {
  readonly id: number;
  readonly nome: string;
  readonly ativo: boolean;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  readonly idadeMin: number | null;
  readonly idadeMax: number | null;
  readonly pesoMin: number | null;
  readonly pesoMax: number | null;
  readonly sexo: string | null;
  readonly especialidades: readonly number[];
  readonly itens: number;
}

export interface OpcaoDominio {
  readonly id: string;
  readonly nome: string;
  readonly grupo?: string | null;
}

export interface FichaAntigaLida {
  readonly id: number;
  readonly produto: string | null;
  readonly inicio: string | null;
  readonly dias: number;
  readonly situacao: string;
}

export interface PrescricaoAVencer {
  readonly prescricao: number;
  readonly atendimento: number;
  readonly fim: string | null;
  readonly paciente: number;
  readonly nome: string | null;
  readonly nomeSocial: string | null;
  readonly unidade: number | null;
  readonly unidadeNome: string | null;
  readonly leito: string | null;
}

export interface FiltroRegistros {
  readonly de?: string;
  readonly ate?: string;
  readonly modelo?: number;
  readonly profissional?: number;
  readonly cboIncluir?: readonly string[];
  readonly cboExcluir?: readonly string[];
}

export interface RegistroProntuarioLido {
  readonly id: number;
  readonly idHtPaciente: number;
  readonly idHtAtendimento: number | null;
  readonly dataHora: string | null;
  readonly lancadoEm: string | null;
  readonly modelo: number;
  readonly modeloCodigo: string | null;
  readonly modeloNome: string | null;
  readonly registroProfissional: number | null;
  readonly profissional: number | null;
  readonly profissionalNome: string | null;
  readonly cbo: string | null;
  readonly suspensoEm: string | null;
  readonly justificativaSuspensao: string | null;
  readonly corrigeRegistro: number | null;
  readonly justificativaRetroativo: string | null;
  readonly supervisor: number | null;
}

export interface FontesLidas {
  readonly temConteudo: boolean;
  readonly temXml: boolean;
  readonly temDocumento: boolean;
  readonly situacoes: readonly number[];
  readonly tiposDocumento: readonly number[];
}

export interface ExcecaoAgregadaLida {
  readonly tipo: 'sem-conteudo' | 'data-impossivel';
  readonly modelo: number;
  readonly codigo: string | null;
  readonly nome: string | null;
  readonly mes: string | null;
  readonly registros: number;
}

export interface ConteudoLido {
  readonly rtf: string | null;
  readonly xml: string | null;
  readonly bytes: number;
}

export interface EventoDocumentoLido {
  readonly id: number;
  readonly situacao: number;
  readonly situacaoNome: string | null;
  readonly tipoDocumento: number;
  readonly em: string | null;
  readonly profissional: string | null;
  readonly temDocumento: boolean;
}

export interface RespostaLida {
  readonly ordem: string;
  readonly seq: number;
  readonly idResposta: number | null;
  readonly data: string | null;
  readonly hora: string | null;
  readonly indice: string | null;
  readonly valor: number | null;
  readonly alfa: string | null;
  readonly texto: string | null;
  readonly unidade: string | null;
  readonly cid: string | null;
  readonly procedimento: string | null;
  readonly observacao: string | null;
  readonly autopreenchido: boolean;
}

export interface ContextoLido {
  readonly pacienteNome: string | null;
  readonly pacienteNomeSocial: string | null;
  readonly pacienteNascimento: string | null;
  readonly atendimentoNumero: number | null;
  readonly entrada: string | null;
  readonly unidade: string | null;
  readonly leito: string | null;
  readonly convenio: string | null;
  readonly cidPrincipal: string | null;
  readonly cidSecundario: string | null;
  readonly medicoAssistente: string | null;
  readonly responsavelNome: string | null;
  readonly responsavelParentesco: string | null;
  readonly profissionalNome: string | null;
  readonly profissionalConselho: string | null;
  readonly cbo: string | null;
}

export interface ProfissionalDoRegistro {
  readonly idUsuario: number;
  readonly idProfissional: number;
  readonly nome: string | null;
  readonly cbo: number;
  readonly cbos: readonly number[];
  readonly especialidades: readonly number[];
  readonly permiteRetroativo: boolean;
}

export interface ModeloDoRegistro {
  readonly id: number;
  readonly codigo: string | null;
  readonly nome: string | null;
  readonly tipoComposicao: number | null;
  readonly nomeTipoComposicao: string | null;
  readonly especialidades: readonly number[];
  /** Modelo aposentado (situação explícita do modelo): os registros antigos continuam, mas não se registra mais. */
  readonly aposentado: boolean;
  /** Registros no estabelecimento na janela recente: só ordena a lista, nunca descontinua o modelo. */
  readonly usoRecente: number;
}

export function modeloPermitido(
  m: Pick<ModeloDoRegistro, 'especialidades'>,
  p: Pick<ProfissionalDoRegistro, 'especialidades'>,
): boolean {
  return m.especialidades.length === 0 || m.especialidades.some((e) => p.especialidades.includes(e));
}

/** Fluxo do atendimento (a categoria do atendimento segue um destes). */
export type TipoAtendimento = 'ambulatorio' | 'pronto_atendimento' | 'externo' | 'internacao' | 'telessaude';
/** Situação do atendimento no cadastro próprio. */
export type SituacaoAtendimento = 'aberto' | 'em_atendimento' | 'em_observacao' | 'encerrado' | 'cancelado';

/**
 * Regra: o atendimento aceita registro enquanto a situação está em curso (aberto, em atendimento ou em observação) e
 * ainda não houve saída nem alta médica. Vale para todo tipo de atendimento (sem janela de dias desde a entrada).
 */
export function atendimentoEmCurso(a: {
  readonly situacao: SituacaoAtendimento;
  readonly altaMedica: string | null;
  readonly saida: string | null;
}): boolean {
  return (
    (a.situacao === 'aberto' || a.situacao === 'em_atendimento' || a.situacao === 'em_observacao') &&
    a.altaMedica === null &&
    a.saida === null
  );
}

export interface AtendimentoLido {
  readonly id: number;
  readonly numero: number | null;
  readonly tipo: TipoAtendimento;
  /** Em curso (aceita registro), pela situação explícita, a saída e a alta médica: ver `atendimentoEmCurso`. */
  readonly aberto: boolean;
  readonly entrada: string | null;
  readonly unidade: string | null;
  readonly leito: string | null;
  readonly altaMedica: string | null;
  readonly saida: string | null;
}

export interface RetratosAtuais {
  readonly htAtendimento: number;
  readonly htPaciente: number;
  readonly doPaciente: boolean;
}

export interface RascunhoLido {
  readonly id: number;
  readonly paciente: number;
  readonly pacienteNome: string | null;
  readonly modelo: number;
  readonly modeloCodigo: string | null;
  readonly modeloNome: string | null;
  readonly idHtAtendimento: number;
  readonly atendimento: number | null;
  readonly cbo: number;
  readonly dataHoraClinica: string | null;
  readonly lancadoEm: string | null;
  readonly justificativa: string | null;
  readonly respostas: number;
  readonly versao: string;
  readonly doNovo: boolean;
  readonly corrige: number | null;
}

export interface LinhaRespostaLida {
  readonly ordem: string;
  readonly seq: number;
  readonly idResposta: number | null;
  readonly data: string | null;
  readonly hora: string | null;
  readonly indice: string | null;
  readonly valor: number | null;
  readonly alfa: string | null;
  readonly texto: string | null;
  readonly unidade: string | null;
  readonly cid: string | null;
  readonly procedimento: string | null;
  readonly observacao: string | null;
  readonly autopreenchido: boolean;
}

export interface CabecalhoRegistroLido {
  readonly id: number;
  readonly paciente: number;
  readonly modelo: number;
  readonly idHtPaciente: number;
  readonly idHtAtendimento: number;
  readonly atendimento: number | null;
  readonly cbo: number;
  readonly dataHoraClinica: string | null;
  readonly lancadoEm: string | null;
  readonly suspensoEm: string | null;
  readonly justificativaSuspensao: string | null;
  readonly profissionalNome: string | null;
  readonly corrige: number | null;
}

export type CampoDocumentoLido = readonly [string, string | number | null | readonly CampoDocumentoLido[]];

export interface CabecalhoDocumentoLido {
  readonly hospital: readonly CampoDocumentoLido[];
  readonly paciente: readonly CampoDocumentoLido[];
  readonly atendimento: readonly CampoDocumentoLido[];
  readonly profissional: readonly CampoDocumentoLido[];
  readonly tipoAssinatura: string | null;
  readonly situacao: string | null;
}

/**
 * Quem opera, para os registros em memória (dev/ci): o login da sessão quando o contexto da gravação o traz (a sessão
 * sintética não tem id numérico de usuário); senão, o id do usuário (null: processo automático).
 */
export const loginDaOperacao = (ctx: {
  readonly usuario: number | null;
  readonly login?: string | null;
}): string => ctx.login || (ctx.usuario === null ? 'sistema' : String(ctx.usuario));
