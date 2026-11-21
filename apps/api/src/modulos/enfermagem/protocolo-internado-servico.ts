// W0-03, mercado M3: o serviço dos protocolos gerenciados no paciente internado (unidades de internação e UTI). Monta o
// relógio da unidade (os protocolos dos internados com cada meta e o prazo, as inclusões encerradas ou inativadas, as
// sugestões pelo alerta do NEWS2) e os indicadores por origem (PA, internação, UTI), e decide no servidor o que a tela
// só mostra: quem inclui e registra (enfermeiro ou médico com o conselho ativo), a versão vigente vista, os critérios
// da definição, o escore que alertou (do mesmo atendimento, válido, no limiar), a hora do reconhecimento, a meta
// cumprida ou perdida (com o motivo), o encerramento e a inativação por engano (só do autor).
// O relógio das metas é o mesmo do PA (`relogioDoProtocolo` do dominio-recepcao), com o tempo zero do internado (a hora
// do alerta ou a do reconhecimento) no lugar da chegada. Base: RDC 36/2013.
import {
  type ConteudoGerenciado,
  type EncerrarProtocoloInternadoEntrada,
  type IncluirProtocoloInternadoEntrada,
  type IndicadorOrigemProtocolo,
  LIMIAR_NEWS2_PROTOCOLO_PADRAO,
  type ProtocoloInternado,
  type RegistrarMetaInternadoEntrada,
  type SugestaoNews2,
} from '@sgh/contratos';
import {
  categoriaPorCbo,
  type EscoreParaProtocolo,
  indicadoresPorOrigem,
  localDaUnidade,
  MENSAGENS_INCLUSAO_INTERNADO,
  problemaDaInclusaoInternado,
  type ProtocoloParaIndicador,
  somarMinutos,
  sugestoesPeloNews2,
  tempoZeroDoInternado,
} from '@sgh/dominio-enfermagem';
import {
  decidirRegistroMeta,
  nomeDoTipo,
  problemaDoEncerramento,
  relogioDoProtocolo,
} from '@sgh/dominio-recepcao';
import type { ProtocoloPaciente } from '../recepcao/tipos.js';
import type { EscoreRegistrado, InternadoEnfermagem, ProtocoloDoInternado } from './tipos-vinculados.js';
import { ErroProblema } from '../../problema.filter.js';
import type { VinculoAssistencial } from './escores-porta.js';

const recusa = (status: number, codigo: string, detalhe: string, campos?: string[]) =>
  new ErroProblema(
    status === 409 ? 'recusa-de-negocio' : 'entrada-invalida',
    status,
    status === 409 ? 'Não registrado' : 'Registro incompleto',
    detalhe,
    { codigo, ...(campos ? { campos } : {}) },
  );

/** A versão publicada com o conteúdo conferido (do serviço do PA). */
export interface VersaoComConteudo {
  readonly v: { readonly id: number; readonly tipo: string; readonly versao: number };
  readonly conteudo: ConteudoGerenciado;
}

export interface ParametrosProtocoloInternado {
  readonly limiar: number;
  readonly unidadesUti: readonly string[];
}

export function parametrosProtocoloInternado(
  limiar: unknown,
  unidadesUti: unknown,
): ParametrosProtocoloInternado {
  const l = Number(limiar);
  return {
    limiar: Number.isInteger(l) && l >= 3 && l <= 12 ? l : LIMIAR_NEWS2_PROTOCOLO_PADRAO,
    unidadesUti: String(unidadesUti ?? 'UTI')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  };
}

/** Enfermeiro ou médico com o conselho ativo (o técnico e os demais não incluem nem registram). */
export function motivoSemAtor(v: VinculoAssistencial | null): string | null {
  if (!v) return 'Seu usuário não tem vínculo assistencial ativo neste estabelecimento.';
  const cbo = v.codigoCbo.replace(/\D/g, '');
  const medico = /^225[123]|^2231/.test(cbo);
  if (categoriaPorCbo(cbo) !== 'enfermeiro' && !medico)
    return 'A inclusão e o registro do protocolo são do enfermeiro ou do médico.';
  if (!v.conselhoAtivo) return 'O registro no conselho profissional não está ativo.';
  return null;
}

/** O escore lido como entrada das regras do internado (a hora em minutos; o estornado marcado). */
export function escoreParaProtocolo(x: EscoreRegistrado): EscoreParaProtocolo {
  return {
    id: x.id,
    atendimento: x.atendimento ?? 0,
    escala: x.escala,
    total: x.total,
    em: x.aferidoEm.slice(0, 16),
    estornado: !!x.estorno,
  };
}

export const fechado = (p: ProtocoloDoInternado) =>
  p.eventos.some((e) => e.tipo === 'encerramento' || e.tipo === 'inativacao');

/** A inclusão para a tela: o relógio das metas (parado no encerramento ou na inativação), o escore e os fatos. */
export function protocoloParaTela(
  p: ProtocoloDoInternado,
  def: VersaoComConteudo | undefined,
  nome: string,
  escore: EscoreRegistrado | undefined,
  agora: string,
): ProtocoloInternado {
  const inativacao = p.eventos.find((e) => e.tipo === 'inativacao') ?? null;
  const encerramento = p.eventos.find((e) => e.tipo === 'encerramento') ?? null;
  const eventos = p.eventos.flatMap((e) =>
    e.tipo === 'inativacao'
      ? []
      : [
          {
            tipo: e.tipo,
            codigo: e.codigo,
            situacao: e.situacao,
            quando: e.quando,
            motivo: e.motivo,
            por: e.por,
            em: e.em,
          },
        ],
  );
  const r = def
    ? relogioDoProtocolo({
        conteudo: def.conteudo,
        chegadaEm: p.reconhecidoEm,
        incluidoEm: p.reconhecidoEm,
        eventos,
        agora: inativacao?.em ?? agora,
      })
    : null;
  return {
    id: p.id,
    atendimento: p.atendimento,
    paciente: nome,
    unidade: p.unidade,
    local: p.local,
    tipo: p.tipo,
    nomeTipo: def?.conteudo.nome ?? nomeDoTipo(p.tipo),
    versao: def?.v.versao ?? 0,
    origem: p.origem,
    escore:
      p.escore !== null
        ? {
            id: p.escore,
            total: escore?.total ?? 0,
            em: escore?.aferidoEm.slice(0, 16) ?? p.reconhecidoEm.slice(0, 16),
            // Revisão W0-03: o escore que abriu a inclusão foi estornado (a origem não vale mais; a tela marca).
            estornado: !!escore?.estorno,
          }
        : null,
    criterios: p.criterios,
    reconhecidoEm: p.reconhecidoEm.slice(0, 16),
    incluidoEm: p.incluidoEm.slice(0, 16),
    incluidoPor: p.incluidoPor,
    observacao: p.observacao,
    metas: (r?.metas ?? []).map((m) => ({
      codigo: m.codigo,
      titulo: m.titulo,
      tipo: m.tipo,
      prazoEm: m.prazoEm?.slice(0, 16) ?? null,
      minutosRestantes: inativacao || encerramento ? null : m.minutosRestantes,
      situacao: m.situacao,
      quando: m.quando?.slice(0, 16) ?? null,
      motivo: m.motivo,
      por: m.por,
    })),
    atrasadas: inativacao ? 0 : (r?.atrasadas ?? 0),
    encerramento: encerramento
      ? {
          desfecho: encerramento.situacao as NonNullable<ProtocoloInternado['encerramento']>['desfecho'],
          em: encerramento.em.slice(0, 16),
          por: encerramento.por,
          motivo: encerramento.motivo,
        }
      : null,
    inativacao: inativacao
      ? { em: inativacao.em.slice(0, 16), por: inativacao.por, motivo: inativacao.motivo ?? '' }
      : null,
  };
}

/**
 * As sugestões pelo NEWS2: o alerta mais recente de cada internado sem sepse aberta, que ainda não abriu protocolo e
 * é posterior ao tempo zero da última sepse do atendimento (o alerta antigo não volta depois do encerramento).
 */
export function sugestoesDaUnidade(
  internados: readonly InternadoEnfermagem[],
  escores: readonly EscoreRegistrado[],
  protocolos: readonly ProtocoloDoInternado[],
  p: ParametrosProtocoloInternado,
): SugestaoNews2[] {
  const porAt = new Map(internados.map((i) => [i.atendimento, i]));
  const sepse = protocolos.filter((x) => x.tipo === 'sepse');
  const abertos = new Set(sepse.filter((x) => !fechado(x)).map((x) => x.atendimento));
  const usados = new Set(sepse.flatMap((x) => (x.escore === null ? [] : [x.escore])));
  const ultimoZero = new Map<number, string>();
  for (const x of sepse) {
    const z = x.reconhecidoEm.slice(0, 16);
    if ((ultimoZero.get(x.atendimento) ?? '') < z) ultimoZero.set(x.atendimento, z);
  }
  const candidatos = escores
    .map(escoreParaProtocolo)
    .filter(
      (e) => porAt.has(e.atendimento) && !usados.has(e.id) && e.em > (ultimoZero.get(e.atendimento) ?? ''),
    );
  return sugestoesPeloNews2(candidatos, abertos, p.limiar).map((e) => {
    const i = porAt.get(e.atendimento)!;
    return {
      escore: e.id,
      atendimento: e.atendimento,
      paciente: i.nome,
      unidade: i.unidade,
      local: localDaUnidade(i.unidade, p.unidadesUti),
      total: e.total,
      em: e.em,
    };
  });
}

/** Os indicadores por origem: o internado do período mais o PA do período, com as metas da versão usada. */
export function indicadoresDoPeriodo(
  internado: readonly ProtocoloDoInternado[],
  pa: readonly ProtocoloPaciente[],
  versoes: readonly VersaoComConteudo[],
): IndicadorOrigemProtocolo[] {
  const metas = new Map(versoes.map((x) => [x.v.id, x.conteudo.metas.map((m) => m.codigo)]));
  const entrada: ProtocoloParaIndicador[] = [
    ...pa.map((x) => ({
      local: 'pa' as const,
      tipo: x.tipo,
      pelaNews2: false,
      metas: metas.get(x.gerenciado) ?? [],
      eventos: x.eventos,
      inativo: false,
    })),
    ...internado.map((x) => ({
      local: x.local,
      tipo: x.tipo,
      pelaNews2: x.origem === 'news2',
      metas: metas.get(x.gerenciado) ?? [],
      eventos: x.eventos.filter((e) => e.tipo !== 'inativacao'),
      inativo: x.eventos.some((e) => e.tipo === 'inativacao'),
    })),
  ];
  return indicadoresPorOrigem(entrada);
}

/** A inclusão conferida: a versão vigente vista, os critérios da definição, o escore e a hora do reconhecimento. */
export function conferirInclusao(p: {
  e: IncluirProtocoloInternadoEntrada;
  vigente: VersaoComConteudo | undefined;
  escore: EscoreRegistrado | undefined;
  jaAberto: boolean;
  limiar: number;
  agora: string;
}): { reconhecidoEm: string } {
  const { e, vigente } = p;
  if (!vigente) throw recusa(409, 'sem-definicao', 'Este protocolo ainda não tem versão publicada.');
  if (vigente.v.id !== e.versao)
    throw recusa(
      409,
      'versao-desatualizada',
      'Outra versão deste protocolo foi publicada depois que você abriu. Abra de novo.',
    );
  const fora = e.criterios.filter((k) => !vigente.conteudo.criterios.some((c) => c.codigo === k));
  if (fora.length > 0)
    throw recusa(422, 'criterio-desconhecido', `Critério fora da definição: ${fora.join(', ')}.`, [
      'criterios',
    ]);
  const escore = p.escore ? escoreParaProtocolo(p.escore) : null;
  const agora = p.agora.slice(0, 16);
  const problema = problemaDaInclusaoInternado({
    origem: e.origem,
    atendimento: e.atendimento,
    escore,
    limiar: p.limiar,
    reconhecidoEm: e.reconhecidoEm,
    agora,
    jaAberto: p.jaAberto,
  });
  if (problema)
    throw recusa(
      problema.startsWith('reconhecimento') ? 422 : 409,
      problema,
      MENSAGENS_INCLUSAO_INTERNADO[problema],
      problema.startsWith('reconhecimento')
        ? ['reconhecidoEm']
        : problema.startsWith('escore')
          ? ['escore']
          : undefined,
    );
  return { reconhecidoEm: tempoZeroDoInternado(e.origem, escore?.em ?? null, e.reconhecidoEm, agora) };
}

/** A meta ou o item do checklist conferido pela definição da versão usada (cumprida no prazo; senão, perdida). */
export function conferirMeta(
  p: ProtocoloDoInternado,
  def: VersaoComConteudo | undefined,
  e: RegistrarMetaInternadoEntrada,
  agora: string,
): { situacao: 'cumprida' | 'perdida'; prazoEm: string | null } {
  if (!def)
    throw recusa(409, 'versao-inexistente', 'A versão do protocolo deste paciente não foi encontrada.');
  const meta = e.tipo === 'meta' ? def.conteudo.metas.find((m) => m.codigo === e.codigo) : undefined;
  const item = e.tipo === 'checklist' ? def.conteudo.checklist.find((c) => c.codigo === e.codigo) : undefined;
  if (!meta && !item)
    throw recusa(422, 'item-desconhecido', 'Item fora da definição deste protocolo.', ['codigo']);
  const d = decidirRegistroMeta({
    meta: meta ?? null,
    feita: e.situacao === 'cumprida',
    quando: e.quando,
    motivo: e.motivo,
    chegadaEm: p.reconhecidoEm,
    incluidoEm: p.reconhecidoEm,
    agora,
  });
  if (!d.ok)
    throw recusa(
      422,
      d.codigo === 'motivo-obrigatorio' ? 'meta-sem-motivo' : d.codigo,
      d.codigo === 'hora-antes-da-chegada'
        ? 'A hora informada é anterior ao tempo zero do protocolo.'
        : d.mensagem,
      [d.campo],
    );
  return { situacao: d.situacao, prazoEm: d.prazoEm };
}

/** O encerramento conferido: o descarte e as metas sem registro pedem o motivo. */
export function conferirEncerramento(
  p: ProtocoloDoInternado,
  def: VersaoComConteudo | undefined,
  e: EncerrarProtocoloInternadoEntrada,
): void {
  const semRegistro = (def?.conteudo.metas ?? []).filter(
    (m) => !p.eventos.some((x) => x.tipo === 'meta' && x.codigo === m.codigo),
  ).length;
  const problema = problemaDoEncerramento(e.desfecho, e.motivo, semRegistro);
  if (problema) throw recusa(422, 'encerramento-sem-motivo', problema, ['motivo']);
}

/** A janela das sugestões e da hora do alerta (o reconhecimento passa de 24 horas não entra). */
export const desdeDaJanela = (agora: string) => somarMinutos(agora.slice(0, 16), -24 * 60);
