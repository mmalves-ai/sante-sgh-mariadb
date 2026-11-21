// Evento de saúde e segurança do trabalhador (W0-06, leiaute S-1.3): S-2210 comunicação de acidente de trabalho (CAT).
// Os dados vêm do acidente do SESMT (SGH_PES_ACIDENTE), do vínculo e do atestado médico do atendimento. Regras puras.
//
// A retificação (indRetif = 2, com o recibo do S-2210 aceito) substitui o evento inteiro; a anulação é o S-3000 do
// S-2210 aceito (montarS3000). O original nunca se apaga: a cadeia original → retificação/exclusão fica na fila
// (SGH_PES_ESOCIAL_EVENTO.ID_EVENTO_ANTERIOR).
//
// D-W006-CAT-INICIATIVA (POL-5): o Sante SGH emite a CAT como empregador (`iniciatCAT` = 1); a CAT emitida pelo próprio
// trabalhador, pelo sindicato ou pelo médico vai direto ao INSS e não passa por esta fila.
import type { PendenciaEsocial } from '@sgh/contratos';
import {
  type ContextoEventoEsocial,
  type EmpregadorParaEvento,
  envelope,
  idEventoEsocial,
  ideEmpregador,
  ideEventoTrabalhador,
  pendencia,
  raizCnpj,
  type ResultadoEventoEsocial,
} from './comum.js';
import {
  matriculaEsocial,
  pendenciasTrabalhador,
  type TrabalhadorParaEvento,
} from './eventos-trabalhador.js';
import { el, type NoXml, obrig, textoCampo } from './xml.js';

export type TipoAcidenteCat = 'tipico' | 'trajeto' | 'doenca';

/** tpAcid do leiaute: 1 típico, 2 doença, 3 trajeto. */
export const TP_ACID: Readonly<Record<TipoAcidenteCat, 1 | 2 | 3>> = { tipico: 1, doenca: 2, trajeto: 3 };

export interface AtestadoCatParaEvento {
  /** AAAA-MM-DD. */
  readonly data: string;
  /** HH:MM (o leiaute do eSocial leva quatro dígitos; a conversão é deste gerador). */
  readonly hora: string;
  readonly internacao: boolean;
  /** Duração provável do tratamento, em dias. */
  readonly duracaoDias: number;
  readonly afastamento: boolean;
  /** Natureza da lesão (tabela 17 do eSocial, 9 dígitos). */
  readonly naturezaLesao: number | null;
  readonly complementoLesao: string | null;
  readonly diagnostico: string | null;
  /** CID-10 sem ponto (3 ou 4 posições). */
  readonly cid: string | null;
  readonly emitenteNome: string | null;
  /** 1 CRM, 2 CRO, 3 RMS. */
  readonly emitenteConselho: 1 | 2 | 3 | null;
  readonly emitenteNumero: string | null;
  readonly emitenteUf: string | null;
}

export interface LocalCatParaEvento {
  /** 1 estabelecimento do empregador no Brasil, 3 de terceiros, 4 via pública, 5 área rural, 6 embarcação, 9 outros. */
  readonly tipo: 1 | 2 | 3 | 4 | 5 | 6 | 9;
  readonly descricao: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly cep: string | null;
  readonly municipio: string | null;
  readonly uf: string | null;
}

export interface CatParaEvento {
  /** O acidente (SGH_PES_ACIDENTE.ID). */
  readonly id: number;
  /** AAAA-MM-DDTHH:MM. */
  readonly ocorridoEm: string;
  readonly tipo: TipoAcidenteCat;
  /** Duração em HH:MM (até 99:59); exigida no típico e no trajeto. */
  readonly horasTrabalhadasAntes: string | null;
  /** 1 inicial, 2 reabertura, 3 comunicação de óbito. */
  readonly tipoCat: 1 | 2 | 3 | null;
  readonly obito: boolean;
  readonly dataObito: string | null;
  readonly comunicouPolicia: boolean;
  /** Situação geradora (tabela 15/16 do eSocial, 9 dígitos). */
  readonly situacaoGeradora: number | null;
  readonly observacao: string | null;
  readonly ultimoDiaTrabalhado: string | null;
  readonly houveAfastamento: boolean;
  readonly local: LocalCatParaEvento;
  /** Parte do corpo atingida (tabela 13 do eSocial, 9 dígitos). */
  readonly parteAtingida: number | null;
  readonly lateralidade: 0 | 1 | 2 | 3 | null;
  /** Agente causador (tabela 14/15 do eSocial, 9 dígitos). */
  readonly agenteCausador: number | null;
  readonly atestado: AtestadoCatParaEvento | null;
  /** O recibo do S-2210 da CAT de origem (reabertura e óbito). */
  readonly reciboCatOrigem: string | null;
}

const nove = (n: number | null) => (n !== null && /^\d{9}$/.test(String(n)) ? String(n) : null);
/** "HH:MM" (hora do dia ou duração até o teto) → os quatro dígitos do leiaute; null se inválida. */
const horaLeiaute = (h: string | null, teto: number) => {
  const m = h === null ? null : /^(\d{2}):([0-5]\d)$/.exec(h);
  const quatro = m ? `${m[1] ?? ''}${m[2] ?? ''}` : '';
  return quatro.length === 4 && Number(quatro) <= teto ? quatro : null;
};
const sn = (b: boolean) => (b ? 'S' : 'N');

/** O que a CAT precisa ter para sair (além do vínculo e do empregador). */
export function pendenciasCat(c: CatParaEvento): PendenciaEsocial[] {
  const p: PendenciaEsocial[] = [];
  const exigeHora = c.tipo !== 'doenca';
  if (exigeHora && !horaLeiaute(c.ocorridoEm.slice(11, 16), 2359))
    p.push(pendencia('cat-sem-hora', 'A hora do acidente não está no formato do eSocial.'));
  if (exigeHora && !horaLeiaute(c.horasTrabalhadasAntes, 9959))
    p.push(pendencia('cat-sem-horas-antes', 'Informe as horas trabalhadas antes do acidente.'));
  if (!c.tipoCat) p.push(pendencia('cat-sem-tipo', 'Informe o tipo da CAT (inicial, reabertura ou óbito).'));
  if ((c.tipoCat === 2 || c.tipoCat === 3) && !c.reciboCatOrigem)
    p.push(pendencia('cat-sem-origem', 'A reabertura e o óbito pedem o recibo da CAT de origem.'));
  if (c.obito && !c.dataObito) p.push(pendencia('cat-sem-data-obito', 'Informe a data do óbito.'));
  if (!nove(c.situacaoGeradora))
    p.push(pendencia('cat-sem-situacao', 'A situação geradora não tem o código do eSocial.'));
  if (!nove(c.parteAtingida))
    p.push(pendencia('cat-sem-parte', 'A parte do corpo atingida não tem o código do eSocial.'));
  if (c.lateralidade === null) p.push(pendencia('cat-sem-lateralidade', 'Informe a lateralidade.'));
  if (!nove(c.agenteCausador))
    p.push(pendencia('cat-sem-agente', 'O agente causador não tem o código do eSocial.'));
  if (!textoCampo(c.local.logradouro, 100) || !textoCampo(c.local.numero, 10))
    p.push(pendencia('cat-sem-local', 'Informe o logradouro e o número do local do acidente.'));
  const a = c.atestado;
  if (!a) {
    p.push(pendencia('cat-sem-atestado', 'Registre o atestado médico do atendimento.'));
    return p;
  }
  if (!horaLeiaute(a.hora, 2359))
    p.push(pendencia('cat-sem-hora-atendimento', 'Informe a hora do atendimento.'));
  if (!nove(a.naturezaLesao))
    p.push(pendencia('cat-sem-natureza', 'A natureza da lesão não tem o código do eSocial.'));
  if (!a.cid || !/^[A-Z]\d{2,3}$/.test(a.cid))
    p.push(pendencia('cat-sem-cid', 'Informe o CID-10 do atestado (sem ponto).'));
  if (!textoCampo(a.emitenteNome, 70) || !a.emitenteConselho || !textoCampo(a.emitenteNumero, 14))
    p.push(pendencia('cat-sem-emitente', 'Informe o médico emitente do atestado e o número no conselho.'));
  if (!Number.isInteger(a.duracaoDias) || a.duracaoDias < 0 || a.duracaoDias > 9999)
    p.push(pendencia('cat-sem-duracao', 'Informe a duração provável do tratamento em dias.'));
  return p;
}

/**
 * S-2210: comunicação de acidente de trabalho. `reciboRetificado` preenchido = retificação (indRetif 2) do S-2210
 * aceito com aquele recibo, que substitui o evento inteiro.
 */
export function montarS2210(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  t: TrabalhadorParaEvento,
  c: CatParaEvento,
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  const extras = [...pendenciasTrabalhador(t), ...pendenciasCat(c)];
  const p = [
    ...(e.cnpj
      ? []
      : [pendencia('empregador-sem-cnpj', 'O cadastro da empresa não tem o CNPJ de 14 posições.')]),
    ...extras,
  ];
  if (p.length) return { ok: false, pendencias: p };
  const cnpj = e.cnpj!;
  const a = c.atestado!;
  const data = c.ocorridoEm.slice(0, 10);
  const comHora = c.tipo !== 'doenca';
  const id = idEventoEsocial(raizCnpj(cnpj), ctx.instante, ctx.sequencia);
  const local = c.local;
  const filhos: (NoXml | null)[] = [
    ideEventoTrabalhador(ctx, reciboRetificado),
    ideEmpregador(cnpj),
    obrig('ideVinculo', [obrig('cpfTrab', t.cpf), el('matricula', matriculaEsocial(t))]),
    obrig('cat', [
      obrig('dtAcid', data),
      obrig('tpAcid', TP_ACID[c.tipo]),
      el('hrAcid', comHora ? horaLeiaute(c.ocorridoEm.slice(11, 16), 2359) : null),
      el('hrsTrabAntesAcid', comHora ? horaLeiaute(c.horasTrabalhadasAntes, 9959) : null),
      obrig('tpCat', c.tipoCat),
      obrig('indCatObito', sn(c.obito)),
      el('dtObito', c.obito ? c.dataObito : null),
      obrig('indComunPolicia', sn(c.comunicouPolicia)),
      obrig('codSitGeradora', nove(c.situacaoGeradora)),
      obrig('iniciatCAT', 1),
      el('obsCAT', textoCampo(c.observacao, 999)),
      el('ultDiaTrab', c.ultimoDiaTrabalhado),
      obrig('houveAfast', sn(c.houveAfastamento)),
      obrig('localAcidente', [
        obrig('tpLocal', local.tipo),
        el('dscLocal', textoCampo(local.descricao, 255)),
        obrig('dscLograd', textoCampo(local.logradouro, 100)),
        obrig('nrLograd', textoCampo(local.numero, 10)),
        el('cep', local.tipo === 1 || local.tipo === 3 || local.tipo === 4 ? local.cep : null),
        el('codMunic', local.municipio),
        el('uf', local.uf),
        local.tipo === 1 || local.tipo === 3
          ? obrig('ideLocalAcid', [obrig('tpInsc', 1), obrig('nrInsc', cnpj)])
          : null,
      ]),
      obrig('parteAtingida', [
        obrig('codParteAting', nove(c.parteAtingida)),
        obrig('lateralidade', c.lateralidade),
      ]),
      obrig('agenteCausador', [obrig('codAgntCausador', nove(c.agenteCausador))]),
      obrig('atestado', [
        obrig('dtAtendimento', a.data),
        obrig('hrAtendimento', horaLeiaute(a.hora, 2359)),
        obrig('indInternacao', sn(a.internacao)),
        obrig('durTrat', a.duracaoDias),
        obrig('indAfast', sn(a.afastamento)),
        obrig('dscLesao', nove(a.naturezaLesao)),
        el('dscCompLesao', textoCampo(a.complementoLesao, 200)),
        el('diagProvavel', textoCampo(a.diagnostico, 100)),
        obrig('codCID', a.cid),
        obrig('emitente', [
          obrig('nmEmit', textoCampo(a.emitenteNome, 70)),
          obrig('ideOC', a.emitenteConselho),
          obrig('nrOC', textoCampo(a.emitenteNumero, 14)),
          el('ufOC', a.emitenteUf),
        ]),
      ]),
      c.tipoCat === 2 || c.tipoCat === 3
        ? obrig('catOrigem', [obrig('nrRecCatOrig', c.reciboCatOrigem)])
        : null,
    ]),
  ];
  return { ok: true, raiz: envelope('S-2210', ctx, filhos, id), idEsocial: id, dataReferencia: data };
}
