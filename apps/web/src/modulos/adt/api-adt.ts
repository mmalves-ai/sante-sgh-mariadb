// Cliente das telas da internação, do mapa de leitos, da higienização e do SAME (M21), validado pelos contratos. As
// gravações vão com o CSRF e a Idempotency-Key (uma por intenção de gravar); Problem Details viram ErroApi e o código da
// recusa (ex.: leito-ocupado, sem-alta-medica, nao-enviado) fica em `problema.codigo` para a tela mostrar o texto certo.
import {
  type ApoioInternacaoTela,
  type DevolucoesAtrasadas,
  esquemaApoioInternacao,
  esquemaDevolucoesAtrasadas,
  esquemaGravacaoInternacao,
  esquemaHistoricoOcupacao,
  esquemaImpressoGerado,
  esquemaInternacaoDetalhe,
  esquemaInternacoes,
  esquemaLocalizacaoConta,
  esquemaMapaOperacional,
  esquemaIndicadoresGiroLeito,
  esquemaPainelHigienizacao,
  esquemaPreInternacoes,
  esquemaProfissionalBusca,
  esquemaResultadoInternacao,
  type GravacaoInternacao,
  type HistoricoOcupacao,
  type ImpressoGerado,
  type InternacaoDetalhe,
  type InternacoesLista,
  type LocalizacaoConta,
  type MapaOperacional,
  type IndicadoresGiroLeitoResposta,
  type PainelHigienizacao,
  type PreInternacoes,
  type ResultadoInternacao,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const I = '/api/internacoes';
const L = '/api/leitos';
const H = '/api/higienizacao';
const S = '/api/same';

export const CANAL_MAPA = `${L}/eventos`;
export const CANAL_HIGIENIZACAO = `${H}/eventos`;

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChave(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m21.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

const gravar = (url: string, corpo: unknown, chave: string): Promise<ResultadoInternacao> =>
  enviar(url, corpo, esquemaResultadoInternacao, chave);

const esquemaCid = z.array(z.object({ id: z.number(), codigo: z.string(), nome: z.string() }));
const esquemaPreDoPaciente = z.object({
  pre: z
    .object({
      dataPrevista: z.string().nullable(),
      convenio: z.number(),
      especialidade: z.number(),
      clinica: z.string().nullable(),
      carater: z.string(),
      procedimento: z.number().nullable(),
      vinculoSolicitante: z.number(),
      vinculoAssistente: z.number(),
      matricula: z.string(),
      plano: z.string(),
    })
    .nullable(),
});
export type PreDoPaciente = z.infer<typeof esquemaPreDoPaciente>['pre'];
const esquemaItemIncoerencia = z.object({
  reg: z.number(),
  prontuario: z.number(),
  entrada: z.string(),
  horaEntrada: z.string(),
  alta: z.string().nullable(),
  horaSaida: z.string().nullable(),
});
const esquemaIncoerencias = z.object({
  altaAntesDaEntrada: z.array(z.number()),
  listaAltaAntes: z.array(esquemaItemIncoerencia),
  leitosCadastro: z.number(),
  leitosEspelho: z.number(),
  internadosSemTrechoAberto: z.number(),
  listaSemTrecho: z.array(esquemaItemIncoerencia),
});
const esquemaFoto = z.object({ chave: z.string() });
const esquemaFichas = z.object({
  fichas: z.array(
    z.object({ modelo: z.number(), grafica: z.boolean(), nome: z.string(), copias: z.number() }),
  ),
});
export type FichaConfigurada = z.infer<typeof esquemaFichas>['fichas'][number];
const esquemaFotoLida = z.object({ tipo: z.string(), conteudo: z.string() });

// ── Internação ──────────────────────────────────────────────────────────────────────────────────────
/** A área da tela: cada uma lê a gravação e o apoio pela permissão de leitura da própria área. */
export type AreaAdt = 'internacoes' | 'leitos' | 'higienizacao' | 'same';
export const lerGravacaoInternacao = (area: AreaAdt = 'internacoes'): Promise<GravacaoInternacao> =>
  ler(`/api/${area}/gravacao`, esquemaGravacaoInternacao);
export const lerApoioInternacao = (area: AreaAdt = 'internacoes'): Promise<ApoioInternacaoTela> =>
  ler(`/api/${area}/apoio`, esquemaApoioInternacao);
export type SituacaoInternacoes = 'internados' | 'alta' | 'todas';
export const listarInternacoes = (
  f: {
    termo?: string;
    bloco?: string;
    situacao?: SituacaoInternacoes;
    altaDe?: string | null;
    altaAte?: string | null;
  } = {},
): Promise<InternacoesLista> =>
  ler(
    `${I}${qs({
      termo: f.termo || null,
      bloco: f.bloco || null,
      situacao: f.situacao && f.situacao !== 'internados' ? f.situacao : null,
      altaDe: f.situacao && f.situacao !== 'internados' ? (f.altaDe ?? null) : null,
      altaAte: f.situacao && f.situacao !== 'internados' ? (f.altaAte ?? null) : null,
    })}`,
    esquemaInternacoes,
  );
export const lerInternacao = (reg: number): Promise<InternacaoDetalhe> =>
  ler(`${I}/${reg}`, esquemaInternacaoDetalhe);
export const buscarMedicos = (termo: string) =>
  ler(`${I}/busca/medicos${qs({ termo })}`, esquemaProfissionalBusca);
export const buscarCid = (termo: string) => ler(`${I}/busca/cid${qs({ termo })}`, esquemaCid);
export const lerIncoerencias = () => ler(`${I}/relatorios/incoerencias`, esquemaIncoerencias);
export const listarPreInternacoes = (
  f: { todas?: boolean; saneamento?: boolean } = {},
): Promise<PreInternacoes> =>
  ler(
    `${I}/pre${qs({ situacao: f.todas ? 'todas' : null, problema: f.saneamento ? 'saneamento' : null })}`,
    esquemaPreInternacoes,
  );
export const lerPreDoPaciente = (paciente: number) => ler(`${I}/pre/${paciente}`, esquemaPreDoPaciente);

export const preInternar = (corpo: unknown, chave: string) => gravar(`${I}/pre`, corpo, chave);
export const corrigirPreInternacao = (paciente: number, corpo: unknown, chave: string) =>
  gravar(`${I}/pre/${paciente}/corrigir`, corpo, chave);
export const internar = (corpo: unknown, chave: string) => gravar(I, corpo, chave);
export const trocar = (reg: number, corpo: unknown, chave: string) =>
  gravar(`${I}/${reg}/trocas`, corpo, chave);
export const registrarGuia = (reg: number, corpo: unknown, chave: string) =>
  gravar(`${I}/${reg}/guias`, corpo, chave);
export const registrarAltaMedica = (reg: number, corpo: unknown, chave: string) =>
  gravar(`${I}/${reg}/alta-medica`, corpo, chave);
export const cancelarAltaMedica = (reg: number, corpo: unknown, chave: string) =>
  gravar(`${I}/${reg}/alta-medica/cancelar`, corpo, chave);
export const darAlta = (reg: number, corpo: unknown, chave: string) =>
  gravar(`${I}/${reg}/alta`, corpo, chave);
export const cancelarAlta = (reg: number, corpo: unknown, chave: string) =>
  gravar(`${I}/${reg}/alta/cancelar`, corpo, chave);
export const excluirInternacao = (reg: number, corpo: unknown, chave: string) =>
  gravar(`${I}/${reg}/excluir`, corpo, chave);
export const lerFichas = (reg: number) => ler(`${I}/${reg}/impressos`, esquemaFichas);
export const emitirImpresso = (reg: number, corpo: unknown, chave: string): Promise<ImpressoGerado> =>
  enviar(`${I}/${reg}/impressos`, corpo, esquemaImpressoGerado, chave);

// ── Leitos ──────────────────────────────────────────────────────────────────────────────────────────
export const lerMapa = (
  abertura = false,
  para: { paciente?: number; internacao?: number; solicitacao?: number } = {},
): Promise<MapaOperacional> =>
  ler(
    `${L}/mapa${qs({
      abertura: abertura ? '1' : null,
      paciente: para.paciente ? String(para.paciente) : null,
      internacao: para.internacao ? String(para.internacao) : null,
      solicitacao: para.solicitacao ? String(para.solicitacao) : null,
    })}`,
    esquemaMapaOperacional,
  );
export const transferir = (corpo: unknown, chave: string) => gravar(`${L}/transferencias`, corpo, chave);
export const abrirEstadoLeito = (corpo: unknown, chave: string) => gravar(`${L}/estados`, corpo, chave);
export const encerrarEstadoLeito = (corpo: unknown, chave: string) =>
  gravar(`${L}/estados/encerrar`, corpo, chave);
export const gravarAtributosLeito = (corpo: unknown, chave: string) => gravar(`${L}/atributos`, corpo, chave);
// W0-07 (programa CRUD completo; mudança documentada para o W1-06, que retoma este arquivo na onda 1): alterar o
// estado aberto do leito sem encerrar e limpar os atributos próprios (volta ao padrão), ambos com a justificativa.
// Só SGH_: nada aqui grava no legado; a gravação da reserva no legado é do W1-06.
export const alterarEstadoLeito = (corpo: unknown, chave: string) =>
  gravar(`${L}/estados/alterar`, corpo, chave);
export const limparAtributosLeito = (corpo: unknown, chave: string) =>
  gravar(`${L}/atributos/limpar`, corpo, chave);
/** A etiqueta do leito com o QR code da solicitação de limpeza (ZPL na fila da impressora da estação). */
export const emitirEtiquetaLeito = (corpo: unknown, chave: string): Promise<ImpressoGerado> =>
  enviar(`${L}/etiqueta`, corpo, esquemaImpressoGerado, chave);
export const lerHistorico = (f: {
  inicio?: string;
  fim?: string;
  bloco?: string;
  pagina?: number;
}): Promise<HistoricoOcupacao> =>
  ler(
    `${L}/historico${qs({ inicio: f.inicio || null, fim: f.fim || null, bloco: f.bloco || null, pagina: f.pagina ?? 1 })}`,
    esquemaHistoricoOcupacao,
  );

// ── Higienização ────────────────────────────────────────────────────────────────────────────────────
export const lerPainelHigienizacao = (): Promise<PainelHigienizacao> =>
  ler(`${H}/painel`, esquemaPainelHigienizacao);
// W0-07 (M3; para o W1-06): os indicadores de higienização e giro de leito do período (só leitura).
export const lerIndicadoresGiro = (de: string, ate: string): Promise<IndicadoresGiroLeitoResposta> =>
  ler(`${H}/indicadores${qs({ de, ate })}`, esquemaIndicadoresGiroLeito);
export const lerFilaHigienizacao = (profissional?: number | null): Promise<PainelHigienizacao> =>
  ler(`${H}/fila${qs({ profissional: profissional ?? null })}`, esquemaPainelHigienizacao);
export const solicitarLimpeza = (corpo: unknown, chave: string) => gravar(`${H}/solicitacoes`, corpo, chave);
export const registrarEtapa = (solicitacao: number, corpo: unknown, chave: string) =>
  gravar(`${H}/solicitacoes/${solicitacao}/etapas`, corpo, chave);
export const enviarFoto = (corpo: unknown, chave: string) => enviar(`${H}/fotos`, corpo, esquemaFoto, chave);
export const lerFoto = (chave: string) => ler(`${H}/fotos${qs({ chave })}`, esquemaFotoLida);

// ── SAME ────────────────────────────────────────────────────────────────────────────────────────────
export const lerConta = (codigo: string): Promise<LocalizacaoConta> =>
  ler(`${S}/contas/${encodeURIComponent(codigo)}`, esquemaLocalizacaoConta);
export const movimentar = (corpo: unknown, chave: string) => gravar(`${S}/movimentos`, corpo, chave);
/** Ocorrência, aceite da remessa ou cobrança da devolução (só no novo). */
export const registrarSame = (corpo: unknown, chave: string) => gravar(`${S}/registros`, corpo, chave);
export const lerDevolucoesAtrasadas = (): Promise<DevolucoesAtrasadas> =>
  ler(`${S}/devolucoes-atrasadas`, esquemaDevolucoesAtrasadas);
export const excluirMovimento = (id: number, corpo: unknown, chave: string) =>
  gravar(`${S}/movimentos/${id}/excluir`, corpo, chave);

/** A imagem em base64 (sem o prefixo data:) do arquivo escolhido na câmera ou no aparelho. */
export function base64DoArquivo(arquivo: Blob): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).replace(/^data:[^,]+,/, ''));
    leitor.onerror = () => rejeitar(leitor.error);
    leitor.readAsDataURL(arquivo);
  });
}
