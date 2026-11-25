// Auditoria da profilaxia antimicrobiana cirúrgica (F8, 04-CC linha 106; Anvisa, "Medidas de prevenção de infecção
// relacionada à assistência à saúde", capítulo do sítio cirúrgico). Regras puras, sem banco:
//   - o protocolo do estabelecimento por procedimento ou grupo (e, opcional, pela classe de contaminação): o
//     antimicrobiano, a dose (fixa ou por quilo), a via, a janela antes da incisão, o intervalo do repique e a duração
//     máxima. Validação do cadastro na hora (tela e servidor usam a mesma regra);
//   - a janela padrão é de até 60 minutos antes da incisão; vancomicina e fluoroquinolonas, de infusão longa, até 120;
//   - a auditoria do ato lê as administrações checadas no prontuário (PEP) e a incisão do registro do ato no bloco:
//     droga do protocolo, dose (com tolerância de 10%), via, momento da primeira dose, repique durante a cirurgia
//     (a cada intervalo do protocolo, com tolerância de 30 minutos) e suspensão em até 24 horas do fim da cirurgia
//     (nenhuma dose depois e o item prescrito encerrado). Sem incisão ou sem protocolo, a auditoria não é avaliável;
//     com a duração ainda em curso, fica pendente para nova auditoria.

export const JANELA_PADRAO_MINUTOS = 60;
export const JANELA_INFUSAO_LONGA_MINUTOS = 120;
export const DURACAO_PADRAO_HORAS = 24;
export const TOLERANCIA_REPIQUE_MINUTOS = 30;
export const TOLERANCIA_DOSE = 0.1;

export interface ProblemaProfilaxia {
  readonly campo: string;
  readonly mensagem: string;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Vancomicina e fluoroquinolonas (infusão longa): a janela antes da incisão vai a 120 minutos. */
export function exigeJanelaLonga(nome: string, classe: string | null = null): boolean {
  const n = semAcento(`${nome} ${classe ?? ''}`);
  return /vancomicin|fluoroquinolon|quinolon|ciprofloxacin|levofloxacin|moxifloxacin|ofloxacin|norfloxacin/.test(
    n,
  );
}

export interface ProtocoloProfilaxiaEntrada {
  readonly procedimento: number | null;
  readonly grupo: number | null;
  readonly antimicrobiano: number | null;
  readonly dose: number | null;
  readonly dosePorKg: boolean;
  readonly unidade: number | null;
  readonly antesMinimo: number | null;
  readonly antesMaximo: number | null;
  readonly intervaloRepiqueHoras: number | null;
  readonly duracaoMaximaHoras: number | null;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
}

const inteiroOuNull = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0);

/** Os problemas do cadastro do protocolo (lista vazia: aceito). `janelaLonga` vem do antimicrobiano escolhido. */
export function conferirProtocoloProfilaxia(
  e: ProtocoloProfilaxiaEntrada,
  janelaLonga = false,
): ProblemaProfilaxia[] {
  const p: ProblemaProfilaxia[] = [];
  if (e.procedimento === null && e.grupo === null)
    p.push({ campo: 'procedimento', mensagem: 'Informe o procedimento ou o grupo de procedimentos.' });
  if (e.antimicrobiano === null) p.push({ campo: 'antimicrobiano', mensagem: 'Escolha o antimicrobiano.' });
  if (e.dose === null || !Number.isFinite(e.dose) || e.dose <= 0)
    p.push({ campo: 'dose', mensagem: 'A dose tem de ser maior que zero.' });
  if (e.unidade === null) p.push({ campo: 'unidade', mensagem: 'Escolha a unidade da dose.' });
  if (!inteiroOuNull(e.antesMinimo) || !inteiroOuNull(e.antesMaximo))
    p.push({ campo: 'antesMaximo', mensagem: 'A janela antes da incisão é em minutos inteiros.' });
  else {
    const limite = janelaLonga ? JANELA_INFUSAO_LONGA_MINUTOS : JANELA_PADRAO_MINUTOS;
    if (e.antesMaximo !== null && e.antesMaximo > limite)
      p.push({
        campo: 'antesMaximo',
        mensagem: `A primeira dose vai até ${limite} minutos antes da incisão para este antimicrobiano.`,
      });
    if (e.antesMinimo !== null && e.antesMaximo !== null && e.antesMinimo > e.antesMaximo)
      p.push({ campo: 'antesMinimo', mensagem: 'O início da janela não pode passar do fim.' });
  }
  if (e.intervaloRepiqueHoras !== null && !(e.intervaloRepiqueHoras > 0 && e.intervaloRepiqueHoras <= 24))
    p.push({ campo: 'intervaloRepiqueHoras', mensagem: 'O repique é a cada 0,5 a 24 horas.' });
  if (
    e.duracaoMaximaHoras !== null &&
    !(Number.isInteger(e.duracaoMaximaHoras) && e.duracaoMaximaHoras > 0 && e.duracaoMaximaHoras <= 48)
  )
    p.push({
      campo: 'duracaoMaximaHoras',
      mensagem:
        'A profilaxia dura no máximo 24 horas (até 48 só em cirurgia cardíaca, por decisão da comissão).',
    });
  if (!e.vigenciaInicio) p.push({ campo: 'vigenciaInicio', mensagem: 'Informe o início da vigência.' });
  else if (e.vigenciaFim && e.vigenciaFim < e.vigenciaInicio)
    p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não pode ser antes do início.' });
  return p;
}

export interface ProtocoloProfilaxia {
  readonly id: number;
  readonly antimicrobiano: number;
  readonly nomeAntimicrobiano: string;
  readonly classe: string | null;
  readonly dose: number;
  readonly dosePorKg: boolean;
  readonly unidade: number;
  readonly via: number | null;
  readonly antesMinimo: number | null;
  readonly antesMaximo: number | null;
  readonly intervaloRepiqueHoras: number | null;
  readonly duracaoMaximaHoras: number | null;
  readonly ordem: number;
}

/** A janela antes da incisão (minutos) do protocolo: a cadastrada ou a padrão pelo antimicrobiano. */
export function janelaDoProtocolo(p: ProtocoloProfilaxia): { minimo: number; maximo: number } {
  return {
    minimo: p.antesMinimo ?? 0,
    maximo:
      p.antesMaximo ??
      (exigeJanelaLonga(p.nomeAntimicrobiano, p.classe)
        ? JANELA_INFUSAO_LONGA_MINUTOS
        : JANELA_PADRAO_MINUTOS),
  };
}

export interface AdministracaoProfilaxia {
  readonly prescricaoItem: number;
  readonly antimicrobiano: number | null;
  readonly administradoEm: Date;
  /** Dose administrada já na unidade de medida do protocolo (nula quando não há conversão). */
  readonly dose: number | null;
  readonly unidade: number | null;
  readonly via: number | null;
  /** A finalidade da ficha do antimicrobiano do item; nula quando o item não tem ficha (sem marca profilática). */
  readonly finalidade?: FinalidadeAntimicrobiano | null;
}

/** A finalidade da ficha do antimicrobiano: só a profilática conta como profilaxia; empírica e terapêutica são tratamento. */
export type FinalidadeAntimicrobiano = 'profilatica' | 'empirica' | 'terapeutica';

const tratamento = (x: { finalidade?: FinalidadeAntimicrobiano | null }) =>
  x.finalidade !== undefined && x.finalidade !== null && x.finalidade !== 'profilatica';
const marcada = (x: { finalidade?: FinalidadeAntimicrobiano | null }) => x.finalidade === 'profilatica';

export interface ItemProfilaxiaPrescrito {
  readonly prescricaoItem: number;
  readonly antimicrobiano: number | null;
  /** Fim do item (encerrado, suspenso ou vencido); nulo enquanto ativo sem fim. */
  readonly encerradoEm: Date | null;
  readonly finalidade?: FinalidadeAntimicrobiano | null;
}

export interface AtoProfilaxia {
  readonly incisao: Date | null;
  readonly fim: Date | null;
  readonly pesoKg: number | null;
}

export type SituacaoAuditoriaProfilaxia = 'pendente' | 'conforme' | 'nao_conforme' | 'nao_avaliavel';

export interface ResultadoAuditoriaProfilaxia {
  readonly avaliavel: boolean;
  readonly situacao: SituacaoAuditoriaProfilaxia;
  readonly protocolo: number | null;
  readonly antimicrobiano: number | null;
  readonly prescricaoItem: number | null;
  readonly administradoEm: Date | null;
  readonly minutosAntesIncisao: number | null;
  readonly drogaAdequada: boolean | null;
  readonly doseAdequada: boolean | null;
  readonly momentoAdequado: boolean | null;
  readonly viaAdequada: boolean | null;
  readonly repiqueAdequado: boolean | null;
  readonly duracaoAdequada: boolean | null;
  /** Os motivos, em códigos estáveis (a tela traduz). */
  readonly motivos: string[];
}

const MIN = 60_000;
const HORA = 60 * MIN;

function vazio(situacao: SituacaoAuditoriaProfilaxia, motivo: string): ResultadoAuditoriaProfilaxia {
  return {
    avaliavel: false,
    situacao,
    protocolo: null,
    antimicrobiano: null,
    prescricaoItem: null,
    administradoEm: null,
    minutosAntesIncisao: null,
    drogaAdequada: null,
    doseAdequada: null,
    momentoAdequado: null,
    viaAdequada: null,
    repiqueAdequado: null,
    duracaoAdequada: null,
    motivos: [motivo],
  };
}

/**
 * Audita a profilaxia do ato contra os protocolos que valem para ele (já filtrados por procedimento, classe e
 * vigência, em ordem de preferência), com as administrações de antimicrobiano checadas no atendimento e os itens
 * prescritos. `agora` decide se a duração ainda está em curso.
 *
 * Só conta como profilaxia o que a ficha do antimicrobiano marca como profilático. O tratamento (ficha empírica ou
 * terapêutica), antes ou depois da cirurgia, nunca é a primeira dose, o repique nem o prolongamento. O que não tem
 * ficha entra como profilaxia possível, com o alerta 'sem-marca-profilatica'; depois do limite da duração, só dá o
 * alerta, não o prolongamento.
 */
export function auditarProfilaxia(
  ato: AtoProfilaxia,
  protocolos: readonly ProtocoloProfilaxia[],
  administracoes: readonly AdministracaoProfilaxia[],
  itens: readonly ItemProfilaxiaPrescrito[],
  agora: Date,
): ResultadoAuditoriaProfilaxia {
  if (!ato.incisao) return vazio('nao_avaliavel', 'sem-incisao');
  if (!protocolos.length) return vazio('nao_avaliavel', 'sem-protocolo');
  const incisao = ato.incisao.getTime();
  const ordenadas = administracoes
    .filter((a) => !tratamento(a))
    .sort((a, b) => a.administradoEm.getTime() - b.administradoEm.getTime());
  const motivos: string[] = [];
  const ordemProtocolos = [...protocolos].sort((a, b) => a.ordem - b.ordem);
  const doProtocolo = (a: AdministracaoProfilaxia) =>
    ordemProtocolos.find((p) => p.antimicrobiano === a.antimicrobiano) ?? null;
  // A primeira dose: a última antes (ou na) incisão de um antimicrobiano do protocolo, a marcada como profilática
  // primeiro; sem ela, a última antes de qualquer antimicrobiano; sem nada antes, a primeira depois (dose atrasada).
  const antes = ordenadas.filter((a) => a.administradoEm.getTime() <= incisao);
  const primeira =
    [...antes].reverse().find((a) => doProtocolo(a) && marcada(a)) ??
    [...antes].reverse().find((a) => doProtocolo(a)) ??
    antes[antes.length - 1] ??
    ordenadas.find((a) => a.administradoEm.getTime() > incisao) ??
    null;
  if (!primeira) {
    return {
      ...vazio('nao_conforme', 'sem-dose'),
      avaliavel: true,
      protocolo: ordemProtocolos[0]!.id,
      antimicrobiano: ordemProtocolos[0]!.antimicrobiano,
      drogaAdequada: false,
      momentoAdequado: false,
    };
  }
  const p = doProtocolo(primeira);
  const protocolo = p ?? ordemProtocolos[0]!;
  const drogaAdequada = p !== null;
  if (!drogaAdequada) motivos.push('droga-fora-do-protocolo');
  let semMarca = !marcada(primeira);

  const minutos = Math.round((incisao - primeira.administradoEm.getTime()) / MIN);
  const janela = janelaDoProtocolo(protocolo);
  const momentoAdequado = minutos >= janela.minimo && minutos <= janela.maximo;
  if (!momentoAdequado) motivos.push(minutos < 0 ? 'dose-depois-da-incisao' : 'dose-fora-da-janela');

  let doseAdequada: boolean | null = null;
  const esperada = protocolo.dosePorKg ? (ato.pesoKg ? protocolo.dose * ato.pesoKg : null) : protocolo.dose;
  if (
    drogaAdequada &&
    esperada !== null &&
    primeira.dose !== null &&
    primeira.unidade === protocolo.unidade
  ) {
    doseAdequada = Math.abs(primeira.dose - esperada) <= esperada * TOLERANCIA_DOSE + 1e-9;
    if (!doseAdequada) motivos.push('dose-diferente');
  } else if (drogaAdequada) motivos.push('dose-sem-comparacao');

  let viaAdequada: boolean | null = null;
  if (protocolo.via !== null && primeira.via !== null) {
    viaAdequada = protocolo.via === primeira.via;
    if (!viaAdequada) motivos.push('via-diferente');
  }

  // Repique: em cada múltiplo do intervalo contado da primeira dose que cai antes do fim da cirurgia, uma dose da
  // mesma droga dentro da tolerância.
  let repiqueAdequado: boolean | null = null;
  const mesma = ordenadas.filter((a) => a.antimicrobiano === primeira.antimicrobiano);
  if (protocolo.intervaloRepiqueHoras && ato.fim) {
    repiqueAdequado = true;
    const passo = protocolo.intervaloRepiqueHoras * HORA;
    const fim = ato.fim.getTime();
    for (let t = primeira.administradoEm.getTime() + passo; t < fim; t += passo) {
      const feito = mesma.some(
        (a) => Math.abs(a.administradoEm.getTime() - t) <= TOLERANCIA_REPIQUE_MINUTOS * MIN,
      );
      if (!feito) {
        repiqueAdequado = false;
        motivos.push('repique-faltando');
        break;
      }
    }
  }

  // Duração: nenhuma dose da droga depois do limite e o item prescrito encerrado até ele.
  const limite =
    (ato.fim ?? ato.incisao).getTime() + (protocolo.duracaoMaximaHoras ?? DURACAO_PADRAO_HORAS) * HORA;
  // Depois do limite, só a dose marcada como profilática prolonga; a sem ficha dá o alerta.
  const depois = mesma.filter((a) => a.administradoEm.getTime() > limite);
  const doseDepois = depois.some(marcada);
  if (depois.some((a) => !marcada(a))) semMarca = true;
  const itensDaDroga = itens.filter((i) => i.antimicrobiano === primeira.antimicrobiano && !tratamento(i));
  const alemDoLimite = itensDaDroga.filter((i) => i.encerradoEm !== null && i.encerradoEm.getTime() > limite);
  const itemAlemDoLimite = alemDoLimite.some(marcada);
  const abertos = itensDaDroga.filter((i) => i.encerradoEm === null);
  const itemAberto = abertos.length > 0;
  const abertoMarcado = abertos.some(marcada);
  if (alemDoLimite.some((i) => !marcada(i)) || (agora.getTime() > limite && abertos.some((i) => !marcada(i))))
    semMarca = true;
  let duracaoAdequada: boolean | null;
  if (doseDepois || itemAlemDoLimite || (abertoMarcado && agora.getTime() > limite)) {
    duracaoAdequada = false;
    motivos.push('profilaxia-prolongada');
  } else if (itemAberto && agora.getTime() <= limite) {
    duracaoAdequada = null;
    motivos.push('duracao-em-curso');
  } else duracaoAdequada = true;
  if (semMarca) motivos.push('sem-marca-profilatica');

  const criterios = [
    drogaAdequada,
    doseAdequada,
    momentoAdequado,
    viaAdequada,
    repiqueAdequado,
    duracaoAdequada,
  ];
  const situacao: SituacaoAuditoriaProfilaxia = criterios.includes(false)
    ? 'nao_conforme'
    : duracaoAdequada === null
      ? 'pendente'
      : 'conforme';
  return {
    avaliavel: true,
    situacao,
    protocolo: protocolo.id,
    antimicrobiano: primeira.antimicrobiano,
    prescricaoItem: primeira.prescricaoItem,
    administradoEm: primeira.administradoEm,
    minutosAntesIncisao: minutos,
    drogaAdequada,
    doseAdequada,
    momentoAdequado,
    viaAdequada,
    repiqueAdequado,
    duracaoAdequada,
    motivos,
  };
}

export interface IndicadoresProfilaxia {
  readonly cirurgias: number;
  readonly auditadas: number;
  readonly conformes: number;
  readonly naoConformes: number;
  readonly momentoAdequado: number;
  readonly duracaoAdequada: number;
  /** Percentual de conformidade sobre as auditadas avaliáveis (nulo sem nenhuma). */
  readonly percentualConforme: number | null;
}

/** Os indicadores do painel da CCIH a partir das auditorias vigentes do período. */
export function indicadoresProfilaxia(
  cirurgias: number,
  auditorias: readonly {
    situacao: string;
    momentoAdequado: boolean | null;
    duracaoAdequada: boolean | null;
  }[],
): IndicadoresProfilaxia {
  const conformes = auditorias.filter((a) => a.situacao === 'conforme').length;
  const naoConformes = auditorias.filter((a) => a.situacao === 'nao_conforme').length;
  const base = conformes + naoConformes;
  return {
    cirurgias,
    auditadas: auditorias.length,
    conformes,
    naoConformes,
    momentoAdequado: auditorias.filter((a) => a.momentoAdequado === true).length,
    duracaoAdequada: auditorias.filter((a) => a.duracaoAdequada === true).length,
    percentualConforme: base ? Math.round((conformes / base) * 1000) / 10 : null,
  };
}
