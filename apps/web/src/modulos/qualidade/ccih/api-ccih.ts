// Cliente das telas da CCIH (M48, etapa 3), validado na chegada. As gravações vão com o CSRF e a Idempotency-Key (uma
// por intenção de gravar); Problem Details viram ErroApi e o código da recusa fica em `problema.codigo` para a tela
// mostrar o texto certo (os textos das recusas ficam em @sgh/dominio-qualidade, os mesmos da API).
import {
  CODIGOS_DISPOSITIVO_INVASIVO,
  CODIGOS_PRECAUCAO,
  CODIGOS_TURNO_BUNDLE,
  type RegistrarBundleEntrada,
  type ConfigurarAntimicrobianoEntrada,
  type DefinirPrecaucaoEntrada,
  type LiberarAntimicrobianoEntrada,
  type RegistrarConsumoAlcoolEntrada,
  type RegistrarDispositivoEntrada,
  type RegistrarIrasEntrada,
  type RegistrarObservacaoMaosEntrada,
  type RegistrarSurtoEntrada,
  type TipoDispositivoInvasivo,
} from '@sgh/contratos';
import { z } from 'zod';
import { enviar, ler, qs } from '../../exames/api-exames.js';

export { codigoDaRecusa } from '../../exames/api-exames.js';

const C = '/api/qualidade/ccih';

let sequencia = 0;
/** Idempotency-Key de uma intenção de gravar (aleatória e única neste navegador). */
export function novaChaveCcih(rotulo: string): string {
  const aleatorio =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 14);
  return `m48c.${rotulo}.${Date.now().toString(36)}.${(sequencia++).toString(36)}.${aleatorio}`.slice(0, 80);
}

// ── Esquemas das respostas ──────────────────────────────────────────────────────────────────────────

const n = z.number();
const nN = z.number().nullable();
const s = z.string();
const sN = z.string().nullable();

export const esquemaParcela = z.object({
  numerador: n,
  denominador: n,
  valor: nN,
  fator: z.union([z.literal(1), z.literal(100), z.literal(1000)]),
});
export type Parcela = z.infer<typeof esquemaParcela>;

const esquemaUnidade = z.object({ codigo: n, nome: s });

const esquemaFormulario = z.object({
  ligada: z.boolean(),
  motivo: sN.optional().default(null),
  agora: s,
  prazoLiberacaoHoras: n,
  unidades: z.array(esquemaUnidade),
  tiposSurto: z.array(z.object({ codigo: n, nome: s })),
  acoes: z.object({
    registrar: z.boolean(),
    iras: z.boolean(),
    liberar: z.boolean(),
    precaucao: z.boolean(),
  }),
});
export type FormularioCcih = z.infer<typeof esquemaFormulario>;

const esquemaItemVigilancia = z.object({
  internacao: n,
  paciente: nN,
  nome: s,
  prontuario: n,
  setor: s,
  leito: s,
  entrada: s,
  motivos: z.array(s),
  peso: n,
  dispositivos: z.array(z.object({ id: n, tipo: s, dias: n })),
  antimicrobianos: z.array(z.object({ nome: s, restrito: z.boolean(), situacao: s, alerta: z.boolean() })),
  culturas: z.array(z.object({ id: n, exame: s, data: s, liberado: z.boolean() })),
  febre: z.boolean(),
  posOperatorio: z.boolean(),
  precaucoes: z.array(s),
  iras: n,
});
export type ItemVigilanciaTela = z.infer<typeof esquemaItemVigilancia>;

const esquemaVigilancia = z.object({
  agora: s,
  itens: z.array(esquemaItemVigilancia),
  cortada: z.boolean(),
  resumo: z.object({
    internados: n,
    emVigilancia: n,
    semLiberacao: n,
    febre: n,
    dispositivos: n,
  }),
});
export type VigilanciaCcih = z.infer<typeof esquemaVigilancia>;

const esquemaInternados = z.object({
  itens: z.array(z.object({ internacao: n, nome: s, prontuario: n, setor: s, leito: s, entrada: s })),
  cortada: z.boolean(),
});
export type InternadoTela = z.infer<typeof esquemaInternados>['itens'][number];

const esquemaResumo = z.object({ ligada: z.boolean(), emVigilancia: n, semLiberacao: n });
export type ResumoCcih = z.infer<typeof esquemaResumo>;

const esquemaDispositivo = z.object({
  id: n,
  reg: n,
  setor: s,
  tipo: z.enum(CODIGOS_DISPOSITIVO_INVASIVO),
  sitio: sN,
  inseridoEm: s,
  itemPrescricao: nN,
  observacao: sN,
  retiradoEm: sN,
  motivoRetirada: sN,
  versao: n,
  dias: n,
  /** W0-04: o cancelamento lógico (o cancelado fica visível como inativo e fora dos dispositivos-dia). */
  canceladoEm: sN.optional().default(null),
  motivoCancelamento: sN.optional().default(null),
  /** Revisão do W0-04: quem registrou (a correção é do autor) e o responsável pela inserção. */
  registradoPor: s.optional().default(''),
  responsavel: z.object({ registro: n, nome: s }).nullable().optional().default(null),
});
export type DispositivoTela = z.infer<typeof esquemaDispositivo>;

const esquemaIras = z.object({
  id: n,
  reg: n,
  setor: s,
  sitio: s,
  dataInfeccao: s,
  criterios: z.array(s),
  nivelIsc: sN,
  cirurgia: nN,
  implante: z.boolean(),
  exame: nN,
  microrganismo: sN,
  multirresistente: z.boolean(),
  dispositivo: nN,
  descricao: sN,
  situacao: s,
  motivoDescarte: sN,
  registradoPor: s,
  registradoEm: s,
  versao: n,
});
export type IrasTela = z.infer<typeof esquemaIras>;

const esquemaLeito = z.object({ bloco: s, acomodacao: s, leito: s });

const esquemaPrecaucao = z.object({
  id: n,
  reg: n,
  leito: esquemaLeito,
  motivo: s,
  motivoOutro: sN,
  tipo: z.enum(CODIGOS_PRECAUCAO),
  origem: s,
  exame: nN,
  multirresistente: z.boolean(),
  bloqueios: z.array(esquemaLeito),
  observacao: sN,
  inicioEm: s,
  inicioPor: s,
  fimEm: sN,
  motivoFim: sN,
  versao: n,
});
export type PrecaucaoTela = z.infer<typeof esquemaPrecaucao>;

const esquemaRevisao = z.object({ em: s, por: s, conduta: s, observacao: sN }).nullable();
const esquemaItemFila = z.object({
  itemPrescricao: n,
  prescricao: n,
  internacao: n,
  item: n,
  nome: s,
  restrito: z.boolean(),
  prescritoEm: s,
  inicioTratamento: s,
  situacao: z.object({
    situacao: z.enum(['aguardando', 'vencida', 'liberado', 'naoLiberado']),
    venceEm: s,
    alerta: z.boolean(),
  }),
  liberacao: z
    .object({
      id: n,
      decisao: s,
      diasAutorizados: nN,
      decididoEm: s,
      decididoPor: s,
      versao: n,
      revisoes: z.object({ d3: esquemaRevisao, d7: esquemaRevisao }),
    })
    .nullable(),
  revisaoDevida: z.object({ marco: z.enum(['d3', 'd7']), devidaEm: s, atrasada: z.boolean() }).nullable(),
  ficha: nN,
});
export type ItemFilaTela = z.infer<typeof esquemaItemFila>;

const esquemaInternacao = z.object({
  agora: s,
  internacao: z.object({
    internacao: n,
    paciente: nN,
    nome: s,
    prontuario: n,
    setor: s,
    leito: s,
    chaveLeito: esquemaLeito,
    entrada: s,
    aberta: z.boolean(),
  }),
  dispositivos: z.array(esquemaDispositivo),
  iras: z.array(esquemaIras),
  precaucoes: z.array(esquemaPrecaucao),
  antimicrobianos: z.array(esquemaItemFila),
  culturas: z.array(z.object({ id: n, reg: n, exame: s, data: s, liberado: z.boolean() })),
  cirurgias: z.array(z.object({ id: n, reg: n, data: s })),
  temperaturaMaxima48h: nN,
  vizinhos: z.array(esquemaLeito.extend({ ocupado: z.boolean() })),
});
export type InternacaoCcih = z.infer<typeof esquemaInternacao>;

const esquemaListaIras = z.object({ competencia: s, itens: z.array(esquemaIras), cortada: z.boolean() });

const tresSitios = z.object({ ipcs: n, pav: n, itu: n });
const tresDispositivos = z.object({ cvc: n, sondaVesical: n, ventilacaoMecanica: n });
const esquemaDenominadorSetor = z.object({
  setor: s,
  pacientesDia: n,
  dispositivosDia: tresDispositivos,
  iras: tresSitios,
  densidade: z.object({ ipcs: esquemaParcela, pav: esquemaParcela, itu: esquemaParcela }),
  utilizacao: z.object({
    cvc: esquemaParcela,
    sondaVesical: esquemaParcela,
    ventilacaoMecanica: esquemaParcela,
  }),
});
export type DenominadorSetorTela = z.infer<typeof esquemaDenominadorSetor>;
const esquemaDenominadores = z.object({
  competencia: s,
  setores: z.array(esquemaDenominadorSetor),
  todos: esquemaDenominadorSetor,
  censo: z.object({ diasFechados: n, diasTerminados: n, completo: z.boolean() }),
  /** Dispositivos sem retirada registrada de internação já encerrada (a contagem parou na alta). */
  semRetirada: z
    .array(
      z.object({
        id: n,
        versao: n,
        internacao: n,
        tipo: s,
        setor: s,
        inseridoEm: s,
        alta: s,
      }),
    )
    .default([]),
  cortada: z.boolean(),
});
export type DenominadoresCcih = z.infer<typeof esquemaDenominadores>;

const esquemaFila = z.object({
  agora: s,
  prazoLiberacaoHoras: n,
  itens: z.array(esquemaItemFila.extend({ paciente: s, prontuario: nN, leito: s })),
  cortada: z.boolean(),
});
export type FilaAntimicrobianos = z.infer<typeof esquemaFila>;

const esquemaItemConsumo = z.object({
  item: n,
  nome: s,
  atc: sN,
  unidadesDispensadas: n,
  ddd: nN,
  diasTerapia: n,
});
const esquemaConsumo = z.object({
  competencia: s,
  pacientesDia: n,
  itens: z.array(esquemaItemConsumo),
  semDdd: z.array(esquemaItemConsumo),
  dddPorMilPacientesDia: esquemaParcela,
  dotPorMilPacientesDia: esquemaParcela,
  cortada: z.boolean(),
});
export type ConsumoCcih = z.infer<typeof esquemaConsumo>;

const esquemaItensAtm = z.object({
  itens: z.array(
    z.object({
      item: n,
      nome: s,
      restrito: z.boolean(),
      atc: sN,
      dddGramas: nN,
      gramasPorUnidade: nN,
      configurado: z.boolean(),
    }),
  ),
});
export type ItemAntimicrobianoTela = z.infer<typeof esquemaItensAtm>['itens'][number];

const esquemaAlertas = z.object({
  itens: z.array(z.object({ itemPrescricao: n, nome: s, situacao: s, venceEm: s })),
});
export type AlertasAntimicrobiano = z.infer<typeof esquemaAlertas>;

const esquemaPrecaucoes = z.object({
  itens: z.array(
    esquemaPrecaucao.extend({
      paciente: s,
      prontuario: nN,
      leitoTexto: s,
      /** Diante da internação de agora: a transferida e a de internação encerrada são pendência da CCIH. */
      situacao: z.enum(['vigente', 'transferida', 'internacaoEncerrada']).default('vigente'),
      leitoAtual: sN.default(null),
    }),
  ),
});
export type PrecaucoesAbertas = z.infer<typeof esquemaPrecaucoes>;
const esquemaPrecaucoesDoPaciente = z.object({
  itens: z.array(
    z.object({
      tipo: z.enum(CODIGOS_PRECAUCAO),
      motivo: s,
      motivoOutro: s.nullable(),
      multirresistente: z.boolean(),
    }),
  ),
});
export type PrecaucoesDoPaciente = z.infer<typeof esquemaPrecaucoesDoPaciente>;

const taxaMomento = esquemaParcela.extend({ momento: s });
const taxaCategoria = esquemaParcela.extend({ categoria: s });
const esquemaMaos = z.object({
  competencia: s,
  observacoes: n,
  adesao: z.object({
    total: esquemaParcela,
    porMomento: z.array(taxaMomento),
    porCategoria: z.array(taxaCategoria),
  }),
  consumo: z.array(z.object({ unidade: n, setor: sN, mililitros: n, porPacienteDia: esquemaParcela })),
  cortada: z.boolean(),
});
export type MaosCcih = z.infer<typeof esquemaMaos>;

const esquemaSurto = z.object({
  id: n,
  titulo: s,
  tipoSurto: nN,
  agente: sN,
  unidade: n,
  setor: sN,
  inicio: s,
  casos: n,
  medidas: sN,
  situacao: s,
  encerradoEm: sN,
  versao: n,
});
export type SurtoTela = z.infer<typeof esquemaSurto>;
const esquemaSurtos = z.object({ itens: z.array(esquemaSurto) });

const esquemaGravado = z.object({ id: n.optional(), versao: n.optional() }).passthrough();
const esquemaRetirada = z.object({ versao: n, sugerirNotificacao: z.boolean() });
const esquemaIrasGravada = z.object({ id: n, dispositivoAssociado: nN.optional().default(null) });
const esquemaLiberada = z.object({ id: n, noPrazo: z.boolean() });
const esquemaPrecaucaoDefinida = z.object({
  id: n,
  tipoDoLeito: z.enum(CODIGOS_PRECAUCAO).nullable(),
  /** Quantos leitos vizinhos o registro bloqueou (a API devolve o número). */
  bloqueados: n,
  bloqueioVizinho: z.enum(['exigido', 'sugerido', 'naoSeAplica']),
  vizinhosOcupados: z.array(s),
});
export type PrecaucaoDefinida = z.infer<typeof esquemaPrecaucaoDefinida>;

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────

export const lerFormularioCcih = (): Promise<FormularioCcih> => ler(`${C}/formulario`, esquemaFormulario);
export const lerVigilancia = (): Promise<VigilanciaCcih> => ler(`${C}/vigilancia`, esquemaVigilancia);
export const lerInternadosCcih = () => ler(`${C}/internados`, esquemaInternados);
export const lerResumoCcih = (): Promise<ResumoCcih> => ler(`${C}/resumo`, esquemaResumo);
export const lerInternacaoCcih = (reg: number): Promise<InternacaoCcih> =>
  ler(`${C}/internacoes/${String(reg)}`, esquemaInternacao);
export const listarIras = (competencia: string, setor?: string) =>
  ler(`${C}/iras${qs({ competencia, setor })}`, esquemaListaIras);
export const lerDenominadores = (competencia: string, setor?: string): Promise<DenominadoresCcih> =>
  ler(`${C}/denominadores${qs({ competencia, setor })}`, esquemaDenominadores);
export const lerFilaAntimicrobianos = (todos: boolean): Promise<FilaAntimicrobianos> =>
  ler(`${C}/antimicrobianos${qs({ todos: todos ? '1' : null })}`, esquemaFila);
export const lerConsumoAntimicrobianos = (competencia: string): Promise<ConsumoCcih> =>
  ler(`${C}/antimicrobianos/consumo${qs({ competencia })}`, esquemaConsumo);
export const lerItensAntimicrobianos = () => ler(`${C}/antimicrobianos/itens`, esquemaItensAtm);
export const lerAlertasDoAtendimento = (atendimento: number): Promise<AlertasAntimicrobiano> =>
  ler(`${C}/antimicrobianos/alertas${qs({ atendimento })}`, esquemaAlertas);
export const lerPrecaucoes = (): Promise<PrecaucoesAbertas> => ler(`${C}/precaucoes`, esquemaPrecaucoes);
/** Regra 7: as precauções abertas do internado, para o cabeçalho do prontuário. */
export const lerPrecaucoesDoPaciente = (paciente: number): Promise<PrecaucoesDoPaciente> =>
  ler(`${C}/precaucoes/do-paciente/${String(paciente)}`, esquemaPrecaucoesDoPaciente);
export const lerMaos = (competencia: string, setor?: string): Promise<MaosCcih> =>
  ler(`${C}/maos${qs({ competencia, setor })}`, esquemaMaos);
export const lerSurtos = () => ler(`${C}/surtos`, esquemaSurtos);

// ── Gravações ───────────────────────────────────────────────────────────────────────────────────────

export const registrarDispositivo = (e: RegistrarDispositivoEntrada, chave: string) =>
  enviar(`${C}/dispositivos`, e, esquemaGravado, chave);
export const retirarDispositivo = (
  id: number,
  e: { versao: number; retiradoEm: string; motivo: string; observacao: string | null },
  chave: string,
) => enviar(`${C}/dispositivos/${String(id)}/retirar`, e, esquemaRetirada, chave);
export const registrarIras = (e: RegistrarIrasEntrada, chave: string) =>
  enviar(`${C}/iras`, e, esquemaIrasGravada, chave);
export const descartarIras = (id: number, e: { versao: number; justificativa: string }, chave: string) =>
  enviar(`${C}/iras/${String(id)}/descartar`, e, esquemaGravado, chave);
export const configurarAntimicrobiano = (e: ConfigurarAntimicrobianoEntrada, chave: string) =>
  enviar(`${C}/antimicrobianos/itens`, e, esquemaGravado, chave);
export const liberarAntimicrobiano = (e: LiberarAntimicrobianoEntrada, chave: string) =>
  enviar(`${C}/antimicrobianos/liberar`, e, esquemaLiberada, chave);
export const revisarAntimicrobiano = (
  liberacao: number,
  e: { versao: number; marco: 'd3' | 'd7'; conduta: string; observacao: string | null },
  chave: string,
) => enviar(`${C}/antimicrobianos/liberacoes/${String(liberacao)}/revisar`, e, esquemaGravado, chave);
export const definirPrecaucao = (e: DefinirPrecaucaoEntrada, chave: string): Promise<PrecaucaoDefinida> =>
  enviar(`${C}/precaucoes`, e, esquemaPrecaucaoDefinida, chave);
export const encerrarPrecaucao = (
  id: number,
  e: { versao: number; motivo: string; observacao: string | null },
  chave: string,
) => enviar(`${C}/precaucoes/${String(id)}/encerrar`, e, esquemaGravado, chave);
export const registrarObservacaoMaos = (e: RegistrarObservacaoMaosEntrada, chave: string) =>
  enviar(`${C}/maos/observacoes`, e, esquemaGravado, chave);
export const registrarConsumoAlcool = (e: RegistrarConsumoAlcoolEntrada, chave: string) =>
  enviar(`${C}/maos/consumo`, e, esquemaGravado, chave);
export const registrarSurto = (e: RegistrarSurtoEntrada, chave: string) =>
  enviar(`${C}/surtos`, e, esquemaGravado, chave);
export const atualizarSurto = (
  id: number,
  e: {
    versao: number;
    situacao: string;
    casos: number;
    medidas: string | null;
    encerradoEm: string | null;
  },
  chave: string,
) => enviar(`${C}/surtos/${String(id)}`, e, esquemaGravado, chave);

// ── W0-04 (M1): a aba de dispositivos do prontuário (o mesmo registro da CCIH) ─────────────────────────

const esquemaBundle = z.object({
  id: n,
  dispositivo: n,
  data: s,
  turno: z.enum(CODIGOS_TURNO_BUNDLE),
  itens: z.record(z.string(), z.boolean()),
  conforme: z.boolean(),
  indicacaoRevisada: z.boolean(),
  observacao: sN,
  registradoPor: s,
  registradoEm: s,
  /** Revisão do W0-04: a versão (correção) e o estorno (visível como inativo). */
  versao: n.optional().default(1),
  estornadoEm: sN.optional().default(null),
  estornadoPor: sN.optional().default(null),
  motivoEstorno: sN.optional().default(null),
});
export type BundleTela = z.infer<typeof esquemaBundle>;
const esquemaAbaDispositivos = z.object({
  agora: s,
  ligada: z.boolean(),
  turnoAtual: z.object({ data: s, turno: z.enum(CODIGOS_TURNO_BUNDLE) }),
  podeRegistrar: z.boolean(),
  /** Revisão do W0-04: o autor corrige o próprio; o de outro autor, só com a permissão própria e a senha. */
  login: s.optional().default(''),
  podeCorrigirDeOutro: z.boolean().optional().default(false),
  internacao: z.object({ internacao: n, setor: s, leito: s, entrada: s }).nullable(),
  itens: z.array(
    esquemaDispositivo.extend({
      dispositivosDiaCompetencia: n,
      itensBundle: z.array(s),
      bundles: z.array(esquemaBundle),
      bundleDoTurno: z.boolean(),
      alerta: z.object({ horas: n, limiteHoras: n, ultimaIndicacao: sN }).nullable(),
    }),
  ),
});
export type AbaDispositivosTela = z.infer<typeof esquemaAbaDispositivos>;
export type DispositivoDaAba = AbaDispositivosTela['itens'][number];

const E = `${C}/enfermagem`;
export const lerDispositivosDoPaciente = (paciente: number): Promise<AbaDispositivosTela> =>
  ler(`${E}/paciente/${String(paciente)}/dispositivos`, esquemaAbaDispositivos);
export const registrarDispositivoNaAba = (e: RegistrarDispositivoEntrada, chave: string) =>
  enviar(`${E}/dispositivos`, e, esquemaGravado, chave);
export const retirarDispositivoNaAba = (
  id: number,
  e: { versao: number; retiradoEm: string; motivo: string; observacao: string | null },
  chave: string,
) => enviar(`${E}/dispositivos/${String(id)}/retirar`, e, esquemaRetirada, chave);
export const registrarBundleNaAba = (id: number, e: RegistrarBundleEntrada, chave: string) =>
  enviar(`${E}/dispositivos/${String(id)}/bundle`, e, esquemaGravado, chave);

// Revisão do W0-04 (regras_governanca: correção por versão, com justificativa e pelo autor): a aba corrige e cancela o
// próprio dispositivo, corrige e estorna o checklist do turno, e busca o profissional responsável pela inserção.
const esquemaDependentesAba = z.object({
  itens: z.array(z.object({ grupo: s, quantidade: n, ids: z.array(n) })),
  podeCancelar: z.boolean(),
});
type ComSenha<E> = E & { readonly senha?: string | undefined };
export const corrigirDispositivoNaAba = (
  id: number,
  e: ComSenha<{
    versao: number;
    tipo: TipoDispositivoInvasivo;
    sitio: string | null;
    inseridoEm: string;
    retiradoEm: string | null;
    responsavel?: number | null;
    justificativa: string;
  }>,
  chave: string,
) => enviar(`${E}/dispositivos/${String(id)}/correcao`, e, esquemaGravado, chave);
export const cancelarDispositivoNaAba = (
  id: number,
  versao: number,
  m: { justificativa: string; senha: string },
  chave: string,
) => enviar(`${E}/dispositivos/${String(id)}/cancelamento`, { versao, ...m }, esquemaGravado, chave);
export const lerDependentesNaAba = (id: number) =>
  ler(`${E}/dispositivos/${String(id)}/dependentes`, esquemaDependentesAba);
export const corrigirBundleNaAba = (
  id: number,
  e: ComSenha<{
    versao: number;
    itens: Record<string, boolean>;
    observacao: string | null;
    justificativa: string;
  }>,
  chave: string,
) => enviar(`${E}/bundles/${String(id)}/correcao`, e, esquemaGravado, chave);
export const estornarBundleNaAba = (
  id: number,
  versao: number,
  m: { justificativa: string; senha: string },
  chave: string,
) => enviar(`${E}/bundles/${String(id)}/estorno`, { versao, ...m }, esquemaGravado, chave);
export const buscarProfissionaisNaAba = async (q: string) =>
  (
    await ler(
      `${E}/profissionais${qs({ q })}`,
      z.object({ itens: z.array(z.object({ id: n, cod: n, nome: s })) }),
    )
  ).itens;
