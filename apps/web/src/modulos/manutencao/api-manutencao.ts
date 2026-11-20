// Cliente das telas da manutenção e engenharia clínica (M55, etapa 1): o apoio (setores, o que a pessoa pode, a
// liberação), as ordens de serviço (lista paginada pela chave, detalhe, abrir, assumir, andamento, concluir, aceite ou
// recusa, cancelamento), os equipamentos (lista, busca do combo, leitura pelo QR, ficha, cadastro e alteração), os
// recursos de agenda e os fornecedores dos combos, o plano de manutenção (painel, execuções, planejar, ativar, registrar a
// execução), os contratos de manutenção e os indicadores. O servidor é a fonte: as respostas são os tipos de
// @sgh/contratos, conferidos só na forma (como no patrimônio, D-RESP-551). Toda gravação vai com o CSRF e uma
// Idempotency-Key por intenção de gravar.
import type {
  AlertaEquipamento,
  CodigoModeloPlano,
  ModeloPlanoInfra,
  AlertaEquipamentoDetalhe,
  BemDoEquipamento,
  ApoioManutencao,
  ContratoManutencao,
  ContratoManutencaoDetalhe,
  CursoDoModelo,
  CriticidadeEquipamento,
  EquipamentoDetalhe,
  EquipamentoPeloCodigo,
  EquipamentoResumo,
  EventoCicloVida,
  ExecucaoPlano,
  IndicadoresManutencao,
  IndiceObsolescencia,
  ItemPlanoPainel,
  NaturezaOs,
  OsDetalhe,
  OsResumo,
  OperadoresDoModelo,
  PaginaManutencao,
  PainelPlano,
  PlanoDetalhe,
  PrioridadeOs,
  ResultadoAcaoDeCampo,
  ResultadoManutencao,
  SituacaoAlertaEquipamento,
  SituacaoEquipamento,
  SituacaoOs,
  TipoEquipamento,
  TipoRecursoAgenda,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

export { codigoDaRecusa } from '../exames/api-exames.js';

const B = '/api/manutencao';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');
const resultado = confiar<ResultadoManutencao>();
const gravar = (url: string, corpo: unknown, rotulo: string) =>
  enviar(url, corpo, resultado, novaChave(`m55m.${rotulo}`));

export type EquipamentoComPlanos = EquipamentoDetalhe & { readonly planos: readonly ItemPlanoPainel[] };
export type CoberturaComEquipamentos = ContratoManutencao;

export const lerApoioManutencao = () => ler(`${B}/apoio`, confiar<ApoioManutencao>());

// ── Ordens de serviço ───────────────────────────────────────────────────────────────────────────────────────────────
export interface FiltroOs {
  readonly centroCusto?: number | null;
  readonly equipamento?: number | null;
  readonly situacoes?: readonly SituacaoOs[];
  readonly natureza?: NaturezaOs | null;
  readonly prioridade?: PrioridadeOs | null;
  readonly minhas?: boolean;
  readonly antesDe?: number | null;
  readonly limite?: number;
}
export const listarOs = (f: FiltroOs) =>
  ler(
    `${B}/os${qs({
      centroCusto: f.centroCusto ?? null,
      equipamento: f.equipamento ?? null,
      situacoes: f.situacoes && f.situacoes.length > 0 ? f.situacoes.join(',') : null,
      natureza: f.natureza ?? null,
      prioridade: f.prioridade ?? null,
      minhas: f.minhas ? 'true' : null,
      antesDe: f.antesDe ?? null,
      limite: f.limite ?? 50,
    })}`,
    confiar<PaginaManutencao<OsResumo>>(),
  );
export const lerOs = (id: number) => ler(`${B}/os/${id}`, confiar<OsDetalhe>());
/** A OS em PDF/A (o servidor relê e converte). */
export const urlDocumentoOs = (id: number) => `${B}/os/${id}/documento`;
/** O laudo da execução do plano do equipamento em PDF/A. */
export const urlLaudoExecucao = (equipamento: number, execucao: number) =>
  `${B}/equipamentos/${equipamento}/laudo/${execucao}`;
export const abrirOs = (corpo: unknown) => gravar(`${B}/os`, corpo, 'abrir');
export type AcaoDaOs = 'assumir' | 'andamento' | 'concluir' | 'encerrar' | 'cancelamento' | 'correcao';
export const agirNaOs = (id: number, acao: AcaoDaOs, corpo: unknown) =>
  gravar(`${B}/os/${id}/${acao}`, corpo, acao);

// ── Equipamentos ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FiltroEquipamentos {
  readonly termo?: string | null;
  readonly centroCusto?: number | null;
  readonly tipo?: TipoEquipamento | null;
  readonly criticidade?: CriticidadeEquipamento | null;
  readonly situacao?: SituacaoEquipamento | null;
  readonly antesDe?: number | null;
  readonly limite?: number;
}
export const listarEquipamentos = (f: FiltroEquipamentos) =>
  ler(
    `${B}/equipamentos${qs({
      termo: f.termo ?? null,
      centroCusto: f.centroCusto ?? null,
      tipo: f.tipo ?? null,
      criticidade: f.criticidade ?? null,
      situacao: f.situacao ?? null,
      antesDe: f.antesDe ?? null,
      limite: f.limite ?? 50,
    })}`,
    confiar<PaginaManutencao<EquipamentoResumo>>(),
  );
export const buscarEquipamentos = (termo: string, centroCusto: number | null) =>
  ler(`${B}/equipamentos/busca${qs({ termo, centroCusto })}`, confiar<EquipamentoPeloCodigo[]>());
export const lerEquipamentoPeloCodigo = (codigo: string) =>
  ler(`${B}/equipamentos/codigo/${encodeURIComponent(codigo)}`, confiar<EquipamentoPeloCodigo>());
export const lerEquipamento = (id: number) => ler(`${B}/equipamentos/${id}`, confiar<EquipamentoComPlanos>());
export const cadastrarEquipamento = (corpo: unknown) => gravar(`${B}/equipamentos`, corpo, 'equipamento');
export const alterarEquipamento = (id: number, corpo: unknown) =>
  gravar(`${B}/equipamentos/${id}`, corpo, 'equipamento');
export const lerRecursos = (tipo: TipoRecursoAgenda) =>
  ler(`${B}/recursos${qs({ tipo })}`, confiar<{ id: number; nome: string; ativo: boolean }[]>());
/** Bens do patrimônio para ligar ao equipamento (a plaqueta ou a descrição; o servidor confere ao gravar). */
export const buscarBens = (termo: string) =>
  ler(`${B}/bens${qs({ termo })}`, z.array(confiar<BemDoEquipamento>()));
export const buscarFornecedores = (termo: string) =>
  ler(`${B}/fornecedores${qs({ termo })}`, confiar<{ codigo: number; nome: string }[]>());

// ── Plano de manutenção ─────────────────────────────────────────────────────────────────────────────────────────────
export const lerPainelPlano = () => ler(`${B}/plano/painel`, confiar<PainelPlano>());
export const lerExecucoes = (plano: number) =>
  ler(`${B}/plano/${plano}/execucoes`, confiar<ExecucaoPlano[]>());
export const planejar = (corpo: unknown) => gravar(`${B}/plano`, corpo, 'plano');
export const ativarPlano = (plano: number, versao: number, ativo: boolean) =>
  gravar(`${B}/plano/${plano}/ativo`, { versao, ativo }, 'ativo');
export const lerPlano = (plano: number) => ler(`${B}/plano/${plano}`, confiar<PlanoDetalhe>());
/** W0-08: PUT (ou DELETE com corpo) pela versão lida (versão velha devolve 409); o `enviar` comum só faz POST. */
async function trocar(
  url: string,
  corpo: unknown,
  rotulo: string,
  metodo: 'PUT' | 'DELETE' = 'PUT',
): Promise<ResultadoManutencao> {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave(`m55m.${rotulo}`),
    },
    body: JSON.stringify(corpo ?? {}),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as ResultadoManutencao;
}
/** W0-08: alterar o plano pela versão lida (PUT; versão velha devolve 409). */
export const alterarPlano = (plano: number, corpo: unknown) =>
  trocar(`${B}/plano/${plano}`, corpo, 'alterar-plano');
export const registrarExecucao = (plano: number, corpo: unknown) =>
  gravar(`${B}/plano/${plano}/execucao`, corpo, 'execucao');

// ── Contratos de manutenção e indicadores ───────────────────────────────────────────────────────────────────────────
export const lerCoberturas = (equipamento: number | null = null) =>
  ler(`${B}/coberturas${qs({ equipamento })}`, confiar<CoberturaComEquipamentos[]>());
export const gravarCobertura = (corpo: unknown) => gravar(`${B}/coberturas`, corpo, 'cobertura');
/** W0-08: o contrato com as versões anteriores; alterar pela versão, encerrar e excluir com motivo. */
export const lerCobertura = (id: number) =>
  ler(`${B}/coberturas/${id}`, confiar<ContratoManutencaoDetalhe>());
export const alterarCobertura = (id: number, corpo: unknown) =>
  trocar(`${B}/coberturas/${id}`, corpo, 'alterar-cobertura');
export const encerrarCobertura = (id: number, corpo: unknown) =>
  gravar(`${B}/coberturas/${id}/encerramento`, corpo, 'encerrar-cobertura');
export const excluirCobertura = (id: number, corpo: unknown) =>
  gravar(`${B}/coberturas/${id}/exclusao`, corpo, 'excluir-cobertura');
/** Os registros que impedem a exclusão (rótulo de produto e quantidade), quando a recusa é `com-dependentes`. */
export function dependentesDaRecusa(erro: unknown): { rotulo: string; quantidade: number }[] {
  const p = (erro as { problema?: { codigo?: string; dependentes?: unknown } } | null)?.problema;
  if (!p || p.codigo !== 'com-dependentes' || !Array.isArray(p.dependentes)) return [];
  return p.dependentes
    .filter((d): d is { rotulo: string; quantidade: number } => typeof d?.rotulo === 'string')
    .map((d) => ({ rotulo: d.rotulo, quantidade: Number(d.quantidade) || 0 }));
}
export const lerIndicadores = (f: {
  inicio: string;
  fim: string;
  centroCusto?: number | null;
  criticidade?: CriticidadeEquipamento | null;
  equipamento?: number | null;
}) =>
  ler(
    `${B}/indicadores${qs({
      inicio: f.inicio,
      fim: f.fim,
      centroCusto: f.centroCusto ?? null,
      criticidade: f.criticidade ?? null,
      equipamento: f.equipamento ?? null,
    })}`,
    confiar<IndicadoresManutencao>(),
  );

// ── Tecnovigilância e recall (W0-08, parte 8; mercado M2) ──────────────────────────────────────────────────────────
export const lerAlertas = (situacao: SituacaoAlertaEquipamento | null = null) =>
  ler(`${B}/alertas${qs({ situacao })}`, confiar<AlertaEquipamento[]>());
export const lerAlerta = (id: number) => ler(`${B}/alertas/${id}`, confiar<AlertaEquipamentoDetalhe>());
export const registrarAlerta = (corpo: unknown) => gravar(`${B}/alertas`, corpo, 'alerta');
export const alterarAlerta = (id: number, corpo: unknown) =>
  trocar(`${B}/alertas/${id}`, corpo, 'alterar-alerta');
export const encerrarAlerta = (id: number, corpo: unknown) =>
  gravar(`${B}/alertas/${id}/encerramento`, corpo, 'encerrar-alerta');
/** Excluir o alerta registrado por engano: DELETE com a versão e o motivo no corpo. */
export const excluirAlerta = (id: number, corpo: unknown) =>
  trocar(`${B}/alertas/${id}`, corpo, 'excluir-alerta', 'DELETE');
/** Uma OS de ação de campo por equipamento afetado ainda sem OS (vazio: todos os afetados pela faixa). */
export const gerarAcaoDeCampo = (id: number, corpo: unknown) =>
  enviar(
    `${B}/alertas/${id}/acao-de-campo`,
    corpo,
    confiar<ResultadoAcaoDeCampo>(),
    novaChave('m55m.acao-de-campo'),
  );
/** A queixa técnica da OS, aberta na vigilância de produto da qualidade (o `id` da resposta é o da queixa). */
export const abrirQueixaDaOs = (os: number, corpo: unknown) =>
  gravar(`${B}/os/${os}/queixa-tecnica`, corpo, 'queixa-tecnica');

// ── Treinamento dos operadores e ciclo de vida (W0-08, parte 9; mercado M3; RDC 509/2021) ─────────────────────────
/** Um curso do catálogo do treinamento (só leitura), para o combo do curso exigido pelo modelo. */
export interface CursoDoCatalogo {
  readonly id: number;
  readonly codigo: string;
  readonly titulo: string;
  readonly validadeMeses: number;
  readonly ativo: boolean;
}
export const lerCursosDoModelo = (fabricante: string, modelo: string) =>
  ler(`${B}/modelos/cursos${qs({ fabricante, modelo })}`, confiar<CursoDoModelo[]>());
export const lerCatalogoCursos = () => ler(`${B}/modelos/cursos/catalogo`, confiar<CursoDoCatalogo[]>());
export const vincularCursoModelo = (corpo: unknown) => gravar(`${B}/modelos/cursos`, corpo, 'curso-modelo');
/** Deixar de exigir o curso: DELETE com o motivo no corpo. */
export const desvincularCursoModelo = (id: number, motivo: string) =>
  trocar(`${B}/modelos/cursos/${id}`, { motivo }, 'desvincular-curso', 'DELETE');
export const lerOperadores = (equipamento: number) =>
  ler(`${B}/equipamentos/${equipamento}/operadores`, confiar<OperadoresDoModelo>());
export const lerObsolescencia = (equipamento: number) =>
  ler(`${B}/equipamentos/${equipamento}/obsolescencia`, confiar<IndiceObsolescencia>());
export const lerEventosCiclo = (equipamento: number) =>
  ler(`${B}/equipamentos/${equipamento}/eventos`, confiar<EventoCicloVida[]>());
export const registrarEventoCiclo = (equipamento: number, corpo: unknown) =>
  gravar(`${B}/equipamentos/${equipamento}/eventos`, corpo, 'evento-ciclo');
/** O plano de gerenciamento das tecnologias em saúde (PDF/A gerado do cadastro). */
export const URL_PGTS = `${B}/equipamentos/pgts/documento`;

// ── PMOC e infraestrutura crítica (W0-08, parte 10; mercado M4) ─────────────────────────────────────────────────────
export type ModeloPlanoLido = { readonly codigo: CodigoModeloPlano } & ModeloPlanoInfra;
/** Os modelos prontos de plano (PMOC do ar, reservatório de água, grupo gerador, central de gases). */
export const lerModelosPlano = () => ler(`${B}/plano/modelos`, z.array(confiar<ModeloPlanoLido>()));
/** Instala o modelo no equipamento como plano comum (versionado; 409 `modelo-instalado`). */
export const instalarModeloPlano = (corpo: unknown) => gravar(`${B}/plano/modelo`, corpo, 'modelo-plano');
/** O relatório do PMOC do período em PDF/A, com a assinatura do responsável técnico; recusa vira ErroApi. */
export async function baixarRelatorioPmoc(
  de: string,
  ate: string,
): Promise<{ nome: string; conteudo: Blob }> {
  const r = await fetch(`${B}/plano/pmoc/relatorio${qs({ de, ate })}`, {
    headers: { accept: 'application/pdf, application/problem+json' },
  });
  if (!r.ok) throw await erroDaResposta(r);
  const nome =
    /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `pmoc_${de}_${ate}.pdf`;
  return { nome, conteudo: await r.blob() };
}
