// F3.8, 07-FIN linha 111: a EFD-REINF por evento, além do arquivo do período (declaracoes.ts). Cada evento é de um
// estabelecimento e de um beneficiário (R-2010: o prestador com retenção previdenciária; R-4010: a pessoa física e
// R-4020: a pessoa jurídica, com IR e contribuições), com o processo judicial ou administrativo que suspende a retenção, o protocolo do envio,
// o recibo do retorno e a retificação: o evento já aceito que mudou volta como retificador com o recibo do original;
// o igual não é reenviado; o rejeitado sem correção é apontado; o que espera retorno bloqueia o novo; o aceito que saiu da
// competência vai ao R-9000 (exclusão) com o recibo. Nada é apagado: o gerado, validado ou rejeitado trocado fica
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

/**
 * O fim de uma suspensão já lançada, sem apagar: `fim` com data encerra (a liminar caiu: vale até o dia, inclusive) e
 * `fim` nulo anula (lançada por engano: nunca valeu). Sempre com o motivo; a já encerrada ou anulada não muda de novo.
 */
export function conferirEncerramentoSuspensao(
  atual: { vigenciaInicio: string; encerradaEm: string | null; anulada: boolean },
  e: { fim: string | null; motivo: string },
): RecusaFinanceiro | null {
  if (atual.anulada || atual.encerradaEm !== null)
    return recusaFin('suspensao-ja-encerrada', 'A suspensão já foi encerrada ou anulada.', ['suspensao']);
  if (e.motivo.trim().length < 5)
    return recusaFin('motivo-obrigatorio', 'Informe o motivo (ao menos 5 letras).', ['motivo']);
  if (e.fim !== null && e.fim < atual.vigenciaInicio)
    return recusaFin(
      'fim-antes-do-inicio',
      'O fim da suspensão não vem antes do início da vigência. A lançada por engano é anulada.',
      ['fim'],
    );
  return null;
}

/** O fim que vale para a suspensão: o menor entre o fim da vigência do processo e o encerramento dela. */
export function fimDaSuspensao(vigenciaFim: string | null, encerradaEm: string | null): string | null {
  if (vigenciaFim === null) return encerradaEm;
  if (encerradaEm === null) return vigenciaFim;
  return encerradaEm < vigenciaFim ? encerradaEm : vigenciaFim;
}

/** A alteração dos dados do processo (vara e vigência), que vale para todas as suspensões dele. */
export function conferirAlteracaoProcesso(p: {
  tipo: string;
  vara: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
}): RecusaFinanceiro | null {
  if (p.tipo === 'judicial' && !(p.vara ?? '').trim())
    return recusaFin('vara-obrigatoria', 'Informe a vara do processo judicial.', ['vara']);
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
  readonly evento: 'R-2010' | 'R-4010' | 'R-4020';
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
      evento: serie === 'R-2000' ? 'R-2010' : benef.length === 11 ? 'R-4010' : 'R-4020',
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
  const tag = e.evento === 'R-2010' ? 'ServTom' : e.evento === 'R-4010' ? 'RetPF' : 'RetPJ';
  const benef =
    e.evento === 'R-2010'
      ? `<idePrestServ><cnpjPrestador>${e.beneficiario}</cnpjPrestador><vlrTotalBruto>${e.valorBruto.toFixed(2)}</vlrTotalBruto><vlrTotalRetPrinc>${e.valorRetido.toFixed(2)}</vlrTotalRetPrinc><vlrTotalNRetPrinc>${e.valorSuspenso.toFixed(2)}</vlrTotalNRetPrinc><nfs>${e.documentos}</nfs>`
      : `<ideBenef><${e.evento === 'R-4010' ? 'cpfBenef' : 'cnpjBenef'}>${e.beneficiario}</${e.evento === 'R-4010' ? 'cpfBenef' : 'cnpjBenef'}><vlrBruto>${e.valorBruto.toFixed(2)}</vlrBruto><vlrRet>${e.valorRetido.toFixed(2)}</vlrRet><vlrSusp>${e.valorSuspenso.toFixed(2)}</vlrSusp>`;
  const procs = e.processos
    .map(
      (p) =>
        `<infoProcRet><tpProcRet>${p.tipo === 'administrativo' ? 1 : 2}</tpProcRet><nrProcRet>${p.numero}</nrProcRet><codSusp>${p.indicativo}</codSusp><valor>${p.valor.toFixed(2)}</valor></infoProcRet>`,
    )
    .join('');
  const fecha = e.evento === 'R-2010' ? '</idePrestServ>' : '</ideBenef>';
  return `<Reinf><evt${tag}><ideEvento><indRetif>${reciboOriginal ? 2 : 1}</indRetif>${reciboOriginal ? `<nrRecibo>${reciboOriginal}</nrRecibo>` : ''}<perApur>${e.periodo}</perApur><tpAmb>2</tpAmb></ideEvento><ideEstab><tpInscEstab>1</tpInscEstab><nrInscEstab>${e.estabelecimento}</nrInscEstab>${benef}${procs}${fecha}</ideEstab></evt${tag}></Reinf>`;
}

/** Os estados do evento, os mesmos do banco (evento_reinf, ck_evento_reinf_situacao). */
export const SITUACOES_EVENTO_REINF = [
  'gerado',
  'validado',
  'enviado',
  'aceito',
  'rejeitado',
  'cancelado',
] as const;
export type SituacaoEventoReinf = (typeof SITUACOES_EVENTO_REINF)[number];

export interface EventoReinfGravado {
  readonly id: number;
  /** Código do evento (R-2010, R-4010, R-4020; R-9000 na exclusão). */
  readonly evento: string;
  readonly beneficiario: string;
  readonly situacao: SituacaoEventoReinf;
  readonly recibo: string | null;
  readonly hash: string;
  /** O evento que este retifica ou, no R-9000, o que ele exclui (evento_reinf.retificado_evento_reinf_id). */
  readonly retificadoId?: number | null;
}

export interface PlanoEnvioReinf {
  /**
   * Novo evento. `retifica` é o aceito que ele corrige (leva o recibo dele), mesmo quando um retificador anterior
   * foi rejeitado; `substitui` é o gerado, validado ou rejeitado que ele troca (este fica "cancelado").
   */
  readonly novos: readonly {
    evento: EventoReinfPlanejado;
    hash: string;
    retifica: EventoReinfGravado | null;
    substitui: EventoReinfGravado | null;
  }[];
  /** Planejados iguais ao vigente gerado, validado ou aceito: nada a enviar. */
  readonly iguais: number;
  /** Beneficiários com evento enviado esperando retorno: não se gera outro antes do retorno. */
  readonly aguardando: readonly string[];
  /** Rejeitado cujo conteúdo não mudou: a tela pede a correção (o beneficiário segue sem evento aceito). */
  readonly rejeitadosSemCorrecao: readonly EventoReinfGravado[];
  /** Aceito cujo beneficiário saiu da competência (estorno, correção do documento): vai o R-9000 com o recibo. */
  readonly exclusoes: readonly EventoReinfGravado[];
}

const ESPERA: readonly SituacaoEventoReinf[] = ['enviado'];

/**
 * Compara o planejado com o vigente de cada evento e beneficiário da competência e do estabelecimento (os gravados
 * são só dessa competência e desse estabelecimento). O vigente é o último não cancelado: o retificador sucede o
 * original. O R-9000 aceito ou a caminho encerra a cadeia do evento que ele exclui.
 */
export function planejarEnvioReinf(
  planejados: readonly { evento: EventoReinfPlanejado; hash: string }[],
  gravados: readonly EventoReinfGravado[],
): PlanoEnvioReinf {
  const novos: PlanoEnvioReinf['novos'][number][] = [];
  const aguardando: string[] = [];
  const rejeitadosSemCorrecao: EventoReinfGravado[] = [];
  const exclusoes: EventoReinfGravado[] = [];
  let iguais = 0;
  const exclusaoDe = (id: number) =>
    gravados
      .filter((g) => g.evento === 'R-9000' && g.retificadoId === id && g.situacao !== 'cancelado')
      .sort((a, b) => b.id - a.id)[0];
  const cadeia = (evento: string, beneficiario: string) => {
    const doBenef = gravados
      .filter((g) => g.evento === evento && g.beneficiario === beneficiario)
      .sort((a, b) => b.id - a.id);
    const vigente = doBenef.find((g) => g.situacao !== 'cancelado');
    const ultimoAceito = doBenef.find((g) => g.situacao === 'aceito');
    return { vigente, ultimoAceito };
  };
  const planejadosChave = new Set(planejados.map((p) => `${p.evento.evento}|${p.evento.beneficiario}`));
  for (const p of planejados) {
    let { vigente, ultimoAceito } = cadeia(p.evento.evento, p.evento.beneficiario);
    const exc = ultimoAceito ? exclusaoDe(ultimoAceito.id) : undefined;
    if (exc && ESPERA.includes(exc.situacao)) {
      aguardando.push(p.evento.beneficiario);
      continue;
    }
    // O aceito já excluído (R-9000 aceito, gerado ou validado) não é retificável: o novo entra como inclusão.
    if (exc && exc.situacao !== 'rejeitado') {
      if (vigente?.id === ultimoAceito?.id) vigente = undefined;
      ultimoAceito = undefined;
    }
    if (!vigente) novos.push({ ...p, retifica: null, substitui: null });
    else if (ESPERA.includes(vigente.situacao)) aguardando.push(p.evento.beneficiario);
    else if (vigente.hash === p.hash && vigente.situacao === 'rejeitado') rejeitadosSemCorrecao.push(vigente);
    else if (vigente.hash === p.hash) iguais += 1;
    else if (vigente.situacao === 'aceito') novos.push({ ...p, retifica: vigente, substitui: null });
    else {
      // Gerado, validado ou rejeitado trocado: se ele retificava um aceito, o novo herda o original (e o recibo).
      const original =
        (vigente.retificadoId != null ? gravados.find((g) => g.id === vigente!.retificadoId) : undefined) ??
        ultimoAceito;
      novos.push({ ...p, retifica: original?.situacao === 'aceito' ? original : null, substitui: vigente });
    }
  }
  const vistos = new Set<string>();
  for (const g of [...gravados].sort((a, b) => b.id - a.id)) {
    if (g.evento === 'R-9000') continue;
    const chave = `${g.evento}|${g.beneficiario}`;
    if (planejadosChave.has(chave) || vistos.has(chave)) continue;
    vistos.add(chave);
    const { ultimoAceito } = cadeia(g.evento, g.beneficiario);
    if (!ultimoAceito) continue;
    const exc = exclusaoDe(ultimoAceito.id);
    if (exc && exc.situacao !== 'rejeitado') {
      if (ESPERA.includes(exc.situacao)) aguardando.push(g.beneficiario);
      continue;
    }
    exclusoes.push(ultimoAceito);
  }
  return { novos, iguais, aguardando, rejeitadosSemCorrecao, exclusoes };
}

/** O R-9000 que exclui o evento aceito, pelo recibo dele. */
export function xmlExclusaoReinf(evento: string, periodo: string, recibo: string): string {
  return `<Reinf><evtExclusao><ideEvento><tpAmb>2</tpAmb></ideEvento><infoExclusao><tpEvento>${evento}</tpEvento><nrRecEvt>${recibo}</nrRecEvt><perApur>${periodo}</perApur></infoExclusao></evtExclusao></Reinf>`;
}

/** Vai ao envio o evento ainda não transmitido: o gerado ou o já validado no leiaute. */
export function conferirTransmissaoReinf(situacao: string): RecusaFinanceiro | null {
  return situacao === 'gerado' || situacao === 'validado'
    ? null
    : recusaFin('evento-nao-transmissivel', 'Só o evento gerado ou validado vai ao envio.');
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
