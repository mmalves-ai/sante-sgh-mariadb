// F3.8, 07-FIN linha 111: a EFD-REINF por evento, além do arquivo do período (declaracoes.ts). Cada evento é de um
// estabelecimento e de um beneficiário (R-2010: o prestador com retenção previdenciária; R-4020: a pessoa jurídica
// com IR e contribuições), com o processo judicial ou administrativo que suspende a retenção, o protocolo do envio,
// o recibo do retorno e a retificação: o evento já aceito que mudou volta como retificador com o recibo do original;
// o igual não é reenviado; o que espera retorno bloqueia o novo. Nada é apagado: o gerado ou rejeitado trocado fica
// "cancelado" e o retificado continua "aceito", com o retificador ligado a ele (evento_reinf.retificado_evento_reinf_id).
import { centavos, recusaFin, type RecusaFinanceiro } from '@sgh/contratos/regras-financeiro';
import type { RetencaoServico } from './declaracoes.js';

export const TRIBUTOS_PROCESSO_REINF = ['inss', 'ir', 'csrf'] as const;
export type TributoProcessoReinf = (typeof TRIBUTOS_PROCESSO_REINF)[number];

export interface ProcessoSuspensao {
  readonly id: number;
  readonly tipo: 'judicial' | 'administrativo';
  readonly numero: string;
  /** Código do indicativo de suspensão (2 dígitos), como informado no processo. */
  readonly indicativo: string;
  readonly tributo: TributoProcessoReinf;
  /** Documento do beneficiário (só dígitos) ou null: o processo vale para todos. */
  readonly beneficiario: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

const so = (s: string) => s.replace(/\D/g, '');

export function conferirProcessoSuspensao(p: Omit<ProcessoSuspensao, 'id'>): RecusaFinanceiro | null {
  const n = so(p.numero);
  if (p.tipo === 'judicial' && n.length !== 20)
    return recusaFin('numero-processo', 'O processo judicial tem 20 dígitos (numeração única).', ['numero']);
  if (p.tipo === 'administrativo' && (n.length < 1 || n.length > 21))
    return recusaFin('numero-processo', 'O processo administrativo tem de 1 a 21 dígitos.', ['numero']);
  if (!/^\d{2}$/.test(p.indicativo))
    return recusaFin('indicativo-invalido', 'O indicativo de suspensão tem 2 dígitos.', ['indicativo']);
  if (!TRIBUTOS_PROCESSO_REINF.includes(p.tributo))
    return recusaFin('tributo-invalido', 'Escolha o tributo suspenso.', ['tributo']);
  if (p.beneficiario !== null && ![11, 14].includes(so(p.beneficiario).length))
    return recusaFin('beneficiario-invalido', 'O beneficiário é um CPF (11) ou CNPJ (14).', ['beneficiario']);
  if (p.vigenciaFim !== null && p.vigenciaFim < p.vigenciaInicio)
    return recusaFin('vigencia-invalida', 'O fim da vigência vem depois do início.', ['vigenciaFim']);
  return null;
}

/** O processo que suspende o tributo do beneficiário na competência: o do beneficiário vence o geral. */
export function processoQueSuspende(
  processos: readonly ProcessoSuspensao[],
  tributo: TributoProcessoReinf,
  beneficiario: string,
  periodo: string,
): ProcessoSuspensao | null {
  const dia = `${periodo}-01`;
  const fim = `${periodo}-31`;
  const vale = processos.filter(
    (p) =>
      p.tributo === tributo &&
      (p.beneficiario === null || so(p.beneficiario) === so(beneficiario)) &&
      p.vigenciaInicio <= fim &&
      (p.vigenciaFim === null || p.vigenciaFim >= dia),
  );
  return vale.find((p) => p.beneficiario !== null) ?? vale[0] ?? null;
}

export interface EventoReinfPlanejado {
  readonly evento: 'R-2010' | 'R-4020';
  readonly periodo: string;
  readonly estabelecimento: string;
  readonly beneficiario: string;
  readonly documentos: number;
  readonly valorBruto: number;
  readonly valorRetido: number;
  readonly valorSuspenso: number;
  readonly processos: readonly {
    id: number;
    tipo: 'judicial' | 'administrativo';
    numero: string;
    indicativo: string;
    valor: number;
  }[];
}

/** Um evento por estabelecimento e beneficiário da competência; o valor do tributo com processo vai como suspenso. */
export function montarEventosReinf(
  serie: 'R-2000' | 'R-4000',
  periodo: string,
  estabelecimento: string,
  retencoes: readonly RetencaoServico[],
  processos: readonly ProcessoSuspensao[],
): EventoReinfPlanejado[] {
  const porBenef = new Map<string, RetencaoServico[]>();
  for (const r of retencoes.filter((x) => x.dataEmissao.slice(0, 7) === periodo))
    porBenef.set(so(r.cnpjPrestador), [...(porBenef.get(so(r.cnpjPrestador)) ?? []), r]);
  const soma = (rs: readonly RetencaoServico[], f: (r: RetencaoServico) => number) =>
    centavos(rs.reduce((s, r) => s + f(r), 0));
  const saida: EventoReinfPlanejado[] = [];
  for (const [benef, rs] of [...porBenef.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const partes: [TributoProcessoReinf, number][] =
      serie === 'R-2000'
        ? [['inss', soma(rs, (r) => r.inss)]]
        : [
            ['ir', soma(rs, (r) => r.ir)],
            ['csrf', soma(rs, (r) => r.csll + r.pis + r.cofins)],
          ];
    let retido = 0;
    let suspenso = 0;
    const procs: EventoReinfPlanejado['processos'][number][] = [];
    for (const [tributo, v] of partes) {
      if (v <= 0) continue;
      const p = processoQueSuspende(processos, tributo, benef, periodo);
      if (p) {
        suspenso = centavos(suspenso + v);
        procs.push({ id: p.id, tipo: p.tipo, numero: so(p.numero), indicativo: p.indicativo, valor: v });
      } else retido = centavos(retido + v);
    }
    if (retido + suspenso <= 0) continue;
    saida.push({
      evento: serie === 'R-2000' ? 'R-2010' : 'R-4020',
      periodo,
      estabelecimento: so(estabelecimento),
      beneficiario: benef,
      documentos: rs.length,
      valorBruto: soma(rs, (r) => r.valorBruto),
      valorRetido: retido,
      valorSuspenso: suspenso,
      processos: procs,
    });
  }
  return saida;
}

/** O XML do evento; o retificador leva o recibo do original. */
export function xmlEventoReinf(e: EventoReinfPlanejado, reciboOriginal: string | null): string {
  const tag = e.evento === 'R-2010' ? 'ServTom' : 'RetPJ';
  const benef =
    e.evento === 'R-2010'
      ? `<idePrestServ><cnpjPrestador>${e.beneficiario}</cnpjPrestador><vlrTotalBruto>${e.valorBruto.toFixed(2)}</vlrTotalBruto><vlrTotalRetPrinc>${e.valorRetido.toFixed(2)}</vlrTotalRetPrinc><vlrTotalNRetPrinc>${e.valorSuspenso.toFixed(2)}</vlrTotalNRetPrinc><nfs>${e.documentos}</nfs>`
      : `<ideBenef><cnpjBenef>${e.beneficiario}</cnpjBenef><vlrBruto>${e.valorBruto.toFixed(2)}</vlrBruto><vlrRet>${e.valorRetido.toFixed(2)}</vlrRet><vlrSusp>${e.valorSuspenso.toFixed(2)}</vlrSusp>`;
  const procs = e.processos
    .map(
      (p) =>
        `<infoProcRet><tpProcRet>${p.tipo === 'administrativo' ? 1 : 2}</tpProcRet><nrProcRet>${p.numero}</nrProcRet><codSusp>${p.indicativo}</codSusp><valor>${p.valor.toFixed(2)}</valor></infoProcRet>`,
    )
    .join('');
  const fecha = e.evento === 'R-2010' ? '</idePrestServ>' : '</ideBenef>';
  return `<Reinf><evt${tag}><ideEvento><indRetif>${reciboOriginal ? 2 : 1}</indRetif>${reciboOriginal ? `<nrRecibo>${reciboOriginal}</nrRecibo>` : ''}<perApur>${e.periodo}</perApur><tpAmb>2</tpAmb></ideEvento><ideEstab><tpInscEstab>1</tpInscEstab><nrInscEstab>${e.estabelecimento}</nrInscEstab>${benef}${procs}${fecha}</ideEstab></evt${tag}></Reinf>`;
}

export type SituacaoEventoReinf =
  'gerado' | 'enviado' | 'aceito' | 'rejeitado' | 'retificado' | 'substituido';

export interface EventoReinfGravado {
  readonly id: number;
  readonly evento: string;
  readonly beneficiario: string;
  readonly situacao: SituacaoEventoReinf;
  readonly recibo: string | null;
  readonly hash: string;
}

export interface PlanoEnvioReinf {
  /** Novo evento; `retifica` é o aceito que ele corrige (com o recibo); `substitui` é o gerado ou rejeitado que ele troca. */
  readonly novos: readonly {
    evento: EventoReinfPlanejado;
    hash: string;
    retifica: EventoReinfGravado | null;
    substitui: EventoReinfGravado | null;
  }[];
  readonly iguais: number;
  /** Beneficiários com evento enviado esperando retorno: não se gera outro antes do retorno. */
  readonly aguardando: readonly string[];
}

/** Compara o planejado com o vigente de cada beneficiário (o último não cancelado: o retificador sucede o original). */
export function planejarEnvioReinf(
  planejados: readonly { evento: EventoReinfPlanejado; hash: string }[],
  gravados: readonly EventoReinfGravado[],
): PlanoEnvioReinf {
  const novos: PlanoEnvioReinf['novos'][number][] = [];
  const aguardando: string[] = [];
  let iguais = 0;
  for (const p of planejados) {
    const vigente = [...gravados]
      .filter(
        (g) =>
          g.evento === p.evento.evento &&
          g.beneficiario === p.evento.beneficiario &&
          g.situacao !== 'retificado' &&
          g.situacao !== 'substituido',
      )
      .sort((a, b) => b.id - a.id)[0];
    if (!vigente) novos.push({ ...p, retifica: null, substitui: null });
    else if (vigente.situacao === 'enviado' || vigente.situacao === 'validado')
      aguardando.push(p.evento.beneficiario);
    else if (vigente.hash === p.hash) iguais += 1;
    else if (vigente.situacao === 'aceito') novos.push({ ...p, retifica: vigente, substitui: null });
    else novos.push({ ...p, retifica: null, substitui: vigente });
  }
  return { novos, iguais, aguardando };
}

export function conferirTransmissaoReinf(situacao: string): RecusaFinanceiro | null {
  return situacao === 'gerado'
    ? null
    : recusaFin('evento-nao-transmissivel', 'Só o evento gerado vai ao envio.');
}

/** O retorno do envio: aceito com o recibo; rejeitado com as ocorrências. */
export function conferirRetornoReinf(
  situacao: string,
  r: { aceito: boolean; recibo: string | null; ocorrencias: string | null },
): RecusaFinanceiro | null {
  if (situacao !== 'enviado')
    return recusaFin('evento-sem-envio', 'O retorno é do evento enviado e ainda sem resposta.');
  if (r.aceito && !/^[\w.-]{5,52}$/.test(r.recibo ?? ''))
    return recusaFin('recibo-obrigatorio', 'Informe o número do recibo do evento aceito.', ['recibo']);
  if (!r.aceito && !(r.ocorrencias ?? '').trim())
    return recusaFin('ocorrencias-obrigatorias', 'Informe as ocorrências da rejeição.', ['ocorrencias']);
  return null;
}
