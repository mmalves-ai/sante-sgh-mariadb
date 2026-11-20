// W0-04 (programa CRUD completo): o cliente da correção por versão, do cancelamento com motivo e da competência fechada
// da qualidade e da CCIH, validado na chegada. Toda gravação leva a versão lida e a justificativa (10 a 500
// caracteres); as críticas (cancelar, estornar, reabrir, assinar) levam a senha no corpo, que o servidor confere e
// descarta (reautenticação em diálogo, SBIS-07). Problem Details viram ErroApi; o código da recusa e os avisos
// (quantos e quais dependentes, as competências fechadas) ficam no problema.
import {
  ACOES_VERSAO_QUALIDADE,
  type AlterarAuditoriaEntrada,
  type AlterarPrecaucaoEntrada,
  type CorrigirDispositivoEntrada,
  type CorrigirIrasEntrada,
  type CorrigirManifestacaoEntrada,
  type CorrigirObservacaoMaosEntrada,
  type RetificarAtaEntrada,
} from '@sgh/contratos';
import { z } from 'zod';
import { ErroApi } from '../../casca/erros/problem-details.js';
import { enviar, ler, qs } from '../exames/api-exames.js';

const C = '/api/qualidade/ccih';
const G = '/api/qualidade/gestao';
const O = '/api/qualidade/ouvidoria';

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChaveCorrecao(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `w004.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

const n = z.number();
const s = z.string();
const sN = z.string().nullable();

const CODIGOS_ACAO = ACOES_VERSAO_QUALIDADE.map((a) => a.codigo) as [string, ...string[]];
export const esquemaVersaoAnterior = z.object({
  versao: n,
  acao: z.enum(CODIGOS_ACAO),
  motivo: s,
  alteradoPor: s,
  alteradoEm: s,
  dados: z.record(z.string(), z.unknown()),
});
export type VersaoAnteriorTela = z.infer<typeof esquemaVersaoAnterior>;
const esquemaVersoes = z.object({ itens: z.array(esquemaVersaoAnterior) });

const esquemaDependentes = z.object({
  itens: z.array(z.object({ grupo: s, quantidade: n, ids: z.array(n) })),
  podeCancelar: z.boolean(),
});
export type DependentesTela = z.infer<typeof esquemaDependentes>;

export const esquemaCompetencia = z.object({
  id: n,
  competencia: s,
  situacao: z.enum(['fechada', 'reaberta']),
  fechadaPor: s,
  fechadaEm: s,
  reabertaPor: sN,
  reabertaEm: sN,
  motivoReabertura: sN,
  versao: n,
});
export type CompetenciaTela = z.infer<typeof esquemaCompetencia>;
const esquemaCompetencias = z.object({
  itens: z.array(esquemaCompetencia),
  acoes: z.object({ fechar: z.boolean(), reabrir: z.boolean() }),
  agora: s,
});
export type CompetenciasTela = z.infer<typeof esquemaCompetencias>;

export const esquemaSessaoMaos = z.object({
  id: n,
  unidade: n,
  setor: sN,
  observadoEm: s,
  categoria: s,
  oportunidades: n,
  conformes: n,
  detalhe: z.array(z.object({ momento: s, acao: s, luvas: z.boolean() })),
  registradoPor: s,
  versao: n.optional().default(1),
  observacao: sN.optional().default(null),
  estornadoEm: sN.optional().default(null),
  motivoEstorno: sN.optional().default(null),
});
export type SessaoMaosTela = z.infer<typeof esquemaSessaoMaos>;
const esquemaSessoes = z.object({ competencia: s, itens: z.array(esquemaSessaoMaos), cortada: z.boolean() });

const esquemaGravado = z.object({ versao: n.optional(), id: n.optional() }).passthrough();

/** Os registros com histórico de versões e a área da API que os lê. */
export type RegistroComVersao =
  | 'dispositivo'
  | 'iras'
  | 'precaucao'
  | 'observacao-maos'
  | 'competencia'
  | 'auditoria'
  | 'reuniao'
  | 'nao-conformidade'
  | 'manifestacao'
  // W0-04 (M5): a revisão de prontuários.
  | 'revisao-prontuario'
  | 'sorteio-revisao'
  | 'pendencia-revisao'
  // Revisão do W0-04: o checklist do bundle, a comissão e a revisão do checklist de completude.
  | 'bundle'
  | 'comissao'
  | 'checklist-revisao';
const DA_CCIH: readonly RegistroComVersao[] = [
  'dispositivo',
  'iras',
  'precaucao',
  'observacao-maos',
  'competencia',
];

/** A justificativa e, nas críticas, a senha (o servidor confere e descarta). */
export interface Motivo {
  readonly justificativa: string;
  readonly senha?: string;
}
const critica = (versao: number, m: Motivo) => ({ versao, justificativa: m.justificativa, senha: m.senha });
/**
 * Revisão do W0-04: a correção que o servidor passou a pedir com a senha (registro de outro autor, ata assinada) leva a
 * senha digitada no diálogo; sem ela, nada vai.
 */
type ComSenha<E> = E & { readonly senha?: string | undefined };
const id = (x: number) => String(x);

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────

const DA_REVISAO: readonly RegistroComVersao[] = [
  'revisao-prontuario',
  'sorteio-revisao',
  'pendencia-revisao',
  'checklist-revisao',
];
/** A aba de dispositivos do prontuário lê as versões pela rota da enfermagem (sem a permissão da CCIH). */
const DA_ENFERMAGEM: readonly RegistroComVersao[] = ['bundle'];
export const lerVersoes = (registro: RegistroComVersao, x: number, enfermagem = false) =>
  ler(
    `${
      enfermagem || DA_ENFERMAGEM.includes(registro)
        ? `${C}/enfermagem`
        : DA_CCIH.includes(registro)
          ? C
          : DA_REVISAO.includes(registro)
            ? '/api/qualidade/revisao-prontuarios'
            : G
    }/versoes/${registro}/${id(x)}`,
    esquemaVersoes,
  );
export const lerDependentesDispositivo = (x: number): Promise<DependentesTela> =>
  ler(`${C}/dispositivos/${id(x)}/dependentes`, esquemaDependentes);
export const lerCompetencias = (): Promise<CompetenciasTela> => ler(`${C}/competencias`, esquemaCompetencias);
export const lerSessoesMaos = (competencia: string, setor?: string) =>
  ler(`${C}/maos/sessoes${qs({ competencia, setor })}`, esquemaSessoes);

// ── CCIH ──────────────────────────────────────────────────────────────────────────────────────────────

export const corrigirDispositivo = (x: number, e: ComSenha<CorrigirDispositivoEntrada>, chave: string) =>
  enviar(`${C}/dispositivos/${id(x)}/correcao`, e, esquemaGravado, chave);
export const cancelarDispositivo = (x: number, versao: number, m: Motivo, chave: string) =>
  enviar(`${C}/dispositivos/${id(x)}/cancelamento`, critica(versao, m), esquemaGravado, chave);
export const corrigirIras = (x: number, e: CorrigirIrasEntrada, chave: string) =>
  enviar(`${C}/iras/${id(x)}/correcao`, e, esquemaGravado, chave);
export const alterarPrecaucao = (x: number, e: ComSenha<AlterarPrecaucaoEntrada>, chave: string) =>
  enviar(`${C}/precaucoes/${id(x)}/alteracao`, e, esquemaGravado, chave);
export const corrigirObservacaoMaos = (
  x: number,
  e: ComSenha<CorrigirObservacaoMaosEntrada>,
  chave: string,
) => enviar(`${C}/maos/observacoes/${id(x)}/correcao`, e, esquemaGravado, chave);
export const estornarObservacaoMaos = (x: number, versao: number, m: Motivo, chave: string) =>
  enviar(`${C}/maos/observacoes/${id(x)}/estorno`, critica(versao, m), esquemaGravado, chave);
export const fecharCompetencia = (competencia: string, chave: string) =>
  enviar(`${C}/competencias`, { competencia }, esquemaGravado, chave);
export const reabrirCompetencia = (x: number, versao: number, m: Motivo, chave: string) =>
  enviar(`${C}/competencias/${id(x)}/reabrir`, critica(versao, m), esquemaGravado, chave);

// ── Gestão da qualidade ─────────────────────────────────────────────────────────────────────────────────

export const alterarAuditoria = (x: number, e: AlterarAuditoriaEntrada, chave: string) =>
  enviar(`${G}/auditorias/${id(x)}/alteracao`, e, esquemaGravado, chave);
export const cancelarAuditoria = (x: number, versao: number, m: Motivo, chave: string) =>
  enviar(`${G}/auditorias/${id(x)}/cancelamento`, critica(versao, m), esquemaGravado, chave);
export const retificarAta = (x: number, e: ComSenha<RetificarAtaEntrada>, chave: string) =>
  enviar(`${G}/reunioes/${id(x)}/retificacao`, e, esquemaGravado, chave);
export const assinarAta = (x: number, versao: number, senha: string, chave: string) =>
  enviar(`${G}/reunioes/${id(x)}/assinatura`, { versao, senha }, esquemaGravado, chave);
export const cancelarReuniao = (x: number, versao: number, m: Motivo, chave: string) =>
  enviar(`${G}/reunioes/${id(x)}/cancelamento`, critica(versao, m), esquemaGravado, chave);
export const cancelarNaoConformidade = (
  x: number,
  versao: number,
  duplicadaDe: number | null,
  m: Motivo,
  chave: string,
) =>
  enviar(
    `${G}/nao-conformidades/${id(x)}/cancelamento`,
    { ...critica(versao, m), duplicadaDe },
    esquemaGravado,
    chave,
  );
export const corrigirManifestacao = (x: number, e: CorrigirManifestacaoEntrada, chave: string) =>
  enviar(`${O}/manifestacoes/${id(x)}/correcao`, e, esquemaGravado, chave);
export const cancelarManifestacao = (x: number, versao: number, m: Motivo, chave: string) =>
  enviar(`${O}/manifestacoes/${id(x)}/cancelamento`, critica(versao, m), esquemaGravado, chave);

// ── Recusas ─────────────────────────────────────────────────────────────────────────────────────────────

/** Os avisos da recusa (quantos e quais dependentes; as competências fechadas), quando houver. */
export function avisosDaRecusa(e: unknown): string[] {
  if (!(e instanceof ErroApi)) return [];
  const a = (e.problema as { avisos?: unknown } | null)?.avisos;
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
}

/** As competências `AAAA-MM` que a recusa `competencia-fechada` aponta (a oferta da reabertura). */
export function competenciasDaRecusa(e: unknown): string[] {
  return avisosDaRecusa(e)
    .map((a) => /(\d{4}-\d{2})/.exec(a)?.[1])
    .filter((c): c is string => !!c);
}
