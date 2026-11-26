// Cliente da API da microbiologia estruturada (F7, 05-SADT linha 12): o cadastro que a cultura usa, a cultura pelo
// exame pedido (da digitação), a retificação da final, e o cadastro dos painéis e dos pontos de corte.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const B = '/api/sadt/microbiologia';
const n = z.number();
const txt = z.string();
const nul = <T extends z.ZodTypeAny>(t: T) => t.nullable();
const interpretacao = z.enum([
  'sensivel',
  'sensivel_dose_dependente',
  'intermediario',
  'resistente',
  'nao_testado',
]);
export type Interpretacao = z.infer<typeof interpretacao>;

const opcao = z.object({ id: n, nome: txt });
const esquemaItemPainel = z.object({
  antimicrobiano: n,
  exibeNoLaudo: z.boolean(),
  liberacaoRestrita: z.boolean(),
  indicaMultirresistencia: z.boolean(),
  sequencia: n,
});
const esquemaCadastro = z.object({
  materiais: z.array(opcao),
  microrganismos: z.array(opcao.extend({ painel: nul(n) })),
  antimicrobianos: z.array(opcao),
  paineis: z.array(
    z.object({
      id: n,
      codigo: txt,
      versao: n,
      nome: txt,
      microrganismo: nul(n),
      material: nul(n),
      metodo: txt,
      norma: txt,
      /** Situação do painel: a cultura recebe só os ativos; o cadastro dos painéis, também os inativos. */
      ativo: z.boolean().default(true),
      itens: z.array(esquemaItemPainel),
    }),
  ),
});
export type CadastroMicrobiologia = z.infer<typeof esquemaCadastro>;

const esquemaTesteLido = z.object({
  antimicrobiano: n,
  antimicrobianoNome: txt,
  metodo: nul(txt),
  cim: nul(n),
  halo: nul(n),
  valorTexto: nul(txt),
  interpretacao,
  pontoCorte: nul(n),
  exibeNoLaudo: z.boolean(),
});
const esquemaCultura = z.object({
  id: n,
  versao: n,
  material: n,
  materialNome: txt,
  crescimento: z.enum(['em_andamento', 'sem_crescimento', 'com_crescimento', 'contaminada', 'flora_normal']),
  contagemColonias: nul(txt),
  conclusao: nul(txt),
  observacao: nul(txt),
  notificaControleInfeccao: z.boolean(),
  situacao: txt,
  laudo: txt,
  isolados: z.array(
    z.object({
      id: n,
      sequencia: n,
      microrganismo: n,
      microrganismoNome: txt,
      contagemUfcMl: nul(n),
      multirresistente: z.boolean(),
      betalactamaseEspectroEstendido: z.boolean(),
      carbapenemase: z.boolean(),
      resistenteMeticilina: z.boolean(),
      resistenteVancomicina: z.boolean(),
      contaminanteProvavel: z.boolean(),
      notificadoControleInfeccao: z.boolean(),
      testes: z.array(esquemaTesteLido),
    }),
  ),
});
export type CulturaLida = z.infer<typeof esquemaCultura>;
const esquemaCulturaDoExame = z.object({ resultado: nul(n), cultura: nul(esquemaCultura) });
export type CulturaDoExame = z.infer<typeof esquemaCulturaDoExame>;
const esquemaGravada = z.object({
  id: n,
  situacao: txt,
  isolados: n,
  testes: n,
  multirresistentes: n,
  notificados: n,
});

const esquemaPonto = z.object({
  id: n,
  microrganismo: n,
  microrganismoNome: txt,
  antimicrobiano: n,
  antimicrobianoNome: txt,
  material: nul(n),
  metodo: z.enum(['concentracao_inibitoria', 'disco_difusao']),
  norma: txt,
  versaoNorma: txt,
  sensivelAte: nul(n),
  resistenteAcima: nul(n),
  haloSensivelMinimo: nul(n),
  haloResistenteMaximo: nul(n),
  vigenciaInicio: txt,
  vigenciaFim: nul(txt),
  ativo: z.boolean(),
  versao: n,
  emUso: z.boolean(),
});
export type PontoCorteLido = z.infer<typeof esquemaPonto>;

export const lerCadastroMicrobiologia = () => ler(`${B}/cadastro`, esquemaCadastro);
/** O cadastro da tela dos painéis (sadt.catalogo.ler), com os painéis inativos. */
export const lerCadastroDosPaineis = () => ler(`${B}/paineis`, esquemaCadastro);
export const lerCulturaDoExame = (exame: number) =>
  ler(`${B}/exames/${exame}/cultura`, esquemaCulturaDoExame);
export const gravarCulturaDoExame = (exame: number, c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/exames/${exame}/cultura`, c, esquemaGravada, chave);
export const retificarCultura = (resultado: number, c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/culturas/${resultado}/retificar`, c, esquemaGravada, chave);
export const listarPontosCorte = (microrganismo: number | null) =>
  ler(`${B}/pontos-corte${microrganismo ? `?microrganismo=${microrganismo}` : ''}`, z.array(esquemaPonto));
export const gravarPainelAntibiograma = (painel: number | null, c: Record<string, unknown>, chave: string) =>
  enviar(painel ? `${B}/paineis/${painel}` : `${B}/paineis`, c, z.object({ id: n }).passthrough(), chave);
export const criarPontoCorte = (c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/pontos-corte`, c, z.object({ id: n, encerrados: z.array(n) }), chave);
export const encerrarPontoCorte = (ponto: number, c: Record<string, unknown>, chave: string) =>
  enviar(`${B}/pontos-corte/${ponto}/encerrar`, c, z.object({ id: n }).passthrough(), chave);
