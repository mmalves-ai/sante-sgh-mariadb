// Montagem das respostas da notificação compulsória (M48, etapa 4) a partir das leituras da porta: o cadastro de CID
// notificável, os eventos para a fila (as regras puras de @sgh/dominio-qualidade decidem o que é gatilho), o caso com
// o estado do prazo e os gatilhos de exame que valem. Sem banco nem Nest.
import {
  type AutoridadeSanitaria,
  type CanalNotificacaoAgravo,
  type CasoAgravoLido,
  type GatilhoAgravoLido,
  type GatilhoExameLido,
  type MotivoDescarteAgravo,
  type OrigemCasoAgravo,
  type PacienteAgravo,
  type PeriodicidadeAgravo,
  periodicidadeDoCadastro,
  type SituacaoCasoAgravo,
} from '@sgh/contratos';
import {
  type CasoExistente,
  type CidCadastro,
  cidNotificavel,
  estadoPrazoAgravo,
  type EventoObito,
  GATILHOS_EXAME_PADRAO,
  montarFilaAgravos,
  normalizarTexto,
} from '@sgh/dominio-qualidade';
import type {
  AtendimentoComCid,
  CasoAgravoRegistrado,
  CidNotificavelCadastro,
  GatilhoExameRegistrado,
  ObitoComCid,
  PacienteDoAgravo,
  ResultadoCandidato,
  UnidadeDoAgravo,
} from './tipos.js';

/** O cadastro de CID notificável como as regras puras o usam (só os de periodicidade conhecida). */
export function cadastroDe(cids: readonly CidNotificavelCadastro[]): Map<string, CidCadastro> {
  const m = new Map<string, CidCadastro>();
  for (const c of cids) {
    const p = periodicidadeDoCadastro(c.codigoCadastro);
    if (p) m.set(c.cid, { cid: c.cid, nome: c.nome, periodicidade: p });
  }
  return m;
}

export function pacienteAgravo(id: number, p: PacienteDoAgravo | undefined): PacienteAgravo {
  return {
    id,
    nome: p?.nome ?? '',
    prontuario: p?.prontuario ?? null,
    nascimento: p?.nascimento ?? null,
    sexo: p?.sexo ?? null,
  };
}

/** Os gatilhos de exame que valem (os do estabelecimento ou a lista padrão), no formato da resposta. */
export function gatilhosExameVigentesDe(configurados: readonly GatilhoExameRegistrado[]): GatilhoExameLido[] {
  if (configurados.length === 0) return GATILHOS_EXAME_PADRAO.map((g) => ({ ...g }));
  return configurados.map((g) => ({ ...g, fonte: 'configurado' as const }));
}

/** Os padrões ASCII dos gatilhos ativos (a consulta do legado exige texto sem acento). */
export function padroesDeExame(gatilhos: readonly GatilhoExameLido[]): string[] {
  return [...new Set(gatilhos.filter((g) => g.ativo).map((g) => normalizarTexto(g.padrao)))];
}

export interface LeiturasDaFila {
  readonly cadastro: ReadonlyMap<string, CidCadastro>;
  readonly atendimentos: readonly AtendimentoComCid[];
  readonly obitos: readonly ObitoComCid[];
  readonly resultados: readonly ResultadoCandidato[];
  readonly pacientes: ReadonlyMap<number, PacienteDoAgravo>;
  readonly unidades: ReadonlyMap<number, UnidadeDoAgravo>;
  readonly gatilhosExame: readonly GatilhoExameLido[];
  readonly casos: readonly {
    origem: string;
    atendimento: number | null;
    exame: number | null;
    paciente: number;
    cid: string;
    situacao: string;
    gatilhoEm: string;
  }[];
  readonly agora: string;
}

/** A fila de gatilhos sem caso (as regras puras decidem; aqui só a conversão das leituras). */
export function filaDeGatilhos(l: LeiturasDaFila): GatilhoAgravoLido[] {
  const pac = (id: number) => pacienteAgravo(id, l.pacientes.get(id));
  const unidade = (u: number | null) => (u === null ? null : (l.unidades.get(u)?.nome ?? null));
  const obitos: EventoObito[] = l.obitos.flatMap((o) =>
    o.cids
      .filter((cid) => cidNotificavel(cid, l.cadastro) !== null)
      .map((cid) => ({
        atendimento: o.atendimento,
        paciente: pac(o.paciente),
        unidade: unidade(o.unidade),
        cid,
        obitoEm: o.obitoEm,
      })),
  );
  const casos: CasoExistente[] = l.casos.map((c) => ({
    origem: c.origem as OrigemCasoAgravo,
    atendimento: c.atendimento,
    exame: c.exame,
    paciente: c.paciente,
    cid: c.cid,
    situacao: c.situacao as SituacaoCasoAgravo,
    gatilhoEm: c.gatilhoEm,
  }));
  return montarFilaAgravos({
    cids: l.atendimentos.map((a) => ({
      atendimento: a.atendimento,
      paciente: pac(a.paciente),
      unidade: unidade(a.unidade),
      cid: a.cid,
      registradoEm: a.registradoEm,
    })),
    exames: l.resultados.map((r) => ({
      exame: r.exame,
      atendimento: r.atendimento,
      paciente: pac(r.paciente),
      unidade: unidade(r.unidade),
      nomeExame: r.nomeExame,
      resultado: r.resultado,
      liberadoEm: r.liberadoEm,
    })),
    obitos,
    cadastro: l.cadastro,
    gatilhosExame: l.gatilhosExame,
    casos,
    agora: l.agora,
  });
}

/** O caso na resposta, com o estado do prazo no instante `agora`. */
export function casoLido(
  x: CasoAgravoRegistrado,
  paciente: PacienteAgravo,
  nomeCid: string,
  agora: string,
): CasoAgravoLido {
  const periodicidade = x.periodicidade as PeriodicidadeAgravo;
  const situacao = x.situacao as SituacaoCasoAgravo;
  const p = estadoPrazoAgravo(periodicidade, x.prazoEm, agora, situacao);
  return {
    id: x.id,
    versao: x.versao,
    situacao,
    origem: x.origem as OrigemCasoAgravo,
    atendimento: x.atendimento,
    exame: x.exame,
    paciente,
    cid: x.cid,
    nomeCid,
    periodicidade,
    gatilhoEm: x.gatilhoEm,
    prazoEm: x.prazoEm,
    estadoPrazo: p.estado,
    horasRestantes: p.horasRestantes,
    fichaModelo: x.fichaModelo,
    autoridade: x.autoridade as AutoridadeSanitaria | null,
    canal: x.canal as CanalNotificacaoAgravo | null,
    numero: x.numero,
    notificadoEm: x.notificadoEm,
    recebidoPor: x.recebidoPor,
    motivoDescarte: x.motivoDescarte as MotivoDescarteAgravo | null,
    justificativaDescarte: x.justificativa,
    observacao: x.observacao,
    abertoPor: x.abertoPor,
    abertoEm: x.abertoEm,
    encerradoPor: x.encerradoPor,
    encerradoEm: x.encerradoEm,
  };
}
