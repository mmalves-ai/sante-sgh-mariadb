// Oncologia (M45, etapa 6; ficha, seções 5 e 7; mina, regra 19; DP-32): protocolos de quimioterapia publicados por versão
// (imutáveis, `content_hash` = SHA-256 do JCS do conteúdo) e os ciclos do paciente com a dose calculada pelo sistema:
//   - superfície corporal de Mosteller: √(peso kg × altura cm ÷ 3600), com o teto institucional opcional (parâmetro;
//     ASCO 2012 recomenda dose pelo peso real, sem teto);
//   - mg/kg pelo peso; dose fixa em mg;
//   - AUC pela fórmula de Calvert: dose (mg) = AUC × (TFG + 25), a TFG estimada por Cockcroft-Gault com a creatinina do
//     dia (× 0,85 no sexo feminino) e o teto de 125 mL/min (recomendação da FDA para a carboplatina);
//   - a redução de dose por toxicidade, com o motivo, vale para todos os fármacos;
//   - o ciclo segue a sequência e o intervalo do protocolo (antes do intervalo, só com a justificativa clínica) e nunca
//     passa do número de ciclos; ciclo só da versão vigente do protocolo;
//   - a validação é do farmacêutico, outra pessoa, com a dupla checagem independente: a dose que ele calculou não pode
//     diferir da do sistema mais que a tolerância (parâmetro; 5%).
//   - o tratamento (curso): a sequência e o intervalo valem dentro do curso; o mesmo protocolo recomeça num curso novo
//     (recaída, nova linha) só no ciclo 1, com o motivo;
//   - os medicamentos do ciclo são prescritos pela prescrição geral (`pep.prescrever`) e ligados ao ciclo pelo PRPRESC.ID
//     (a prescrição da internação que vale no dia previsto); a validação exige ao menos uma ligada.
// O tipo de prescrição oncológica do formulário de origem nunca foi usado, e valor nunca visto não é gravado (regra 15).
// Puro: a API aplica.
import {
  type DoseCalculada,
  type FarmacoProtocolo,
  jcs,
  type PublicarProtocoloOncologicoEntrada,
  type RegistrarCicloOncologicoEntrada,
  sha256Hex,
} from '@sgh/contratos';
import { arredondar, minutosEntreCivis, decimalBr, recusar } from './comum.js';

export const FORMATO_PROTOCOLO_ONCOLOGICO = 'sgh-protocolo-oncologico/1';
/** Teto da TFG na fórmula de Calvert (mL/min). */
export const TFG_MAXIMA_CALVERT = 125;

/** O conteúdo canônico do protocolo (o mesmo conteúdo dá o mesmo hash, em qualquer ordem de chaves). */
export function conteudoCanonicoProtocolo(p: PublicarProtocoloOncologicoEntrada): string {
  return jcs({
    formato: FORMATO_PROTOCOLO_ONCOLOGICO,
    protocolo: {
      ...p,
      indicacao: p.indicacao ?? null,
      farmacos: p.farmacos.map((f) => ({
        ...f,
        administracao: f.administracao ?? null,
        dias: [...new Set(f.dias)].sort((a, b) => a - b),
      })),
    },
  });
}

export function hashProtocolo(p: PublicarProtocoloOncologicoEntrada): Promise<string> {
  return sha256Hex(conteudoCanonicoProtocolo(p));
}

/** Confere o protocolo antes de publicar (os dias dentro do intervalo; o fármaco não se repete na mesma via). */
export function conferirProtocolo(
  p: PublicarProtocoloOncologicoEntrada,
  tiposDoCadastro: ReadonlySet<number>,
): void {
  if (!tiposDoCadastro.has(p.tipo))
    recusar(
      'valor-desconhecido',
      `Tipo de protocolo ${p.tipo} não existe no cadastro de tipos de protocolo.`,
    );
  if (p.farmacos.length === 0)
    recusar('protocolo-sem-farmaco', 'O protocolo precisa de ao menos um fármaco.');
  const vistos = new Set<string>();
  for (const f of p.farmacos) {
    if (f.dias.some((d) => d > p.intervaloDias))
      recusar(
        'dia-fora-do-ciclo',
        `${f.nome}: dia de administração depois do fim do ciclo de ${p.intervaloDias} dia(s).`,
      );
    const k = `${f.nome.toUpperCase()}:${f.via}`;
    if (vistos.has(k)) recusar('farmaco-repetido', `${f.nome} aparece duas vezes na mesma via.`);
    vistos.add(k);
  }
}

/** Superfície corporal de Mosteller (m², duas casas), com o teto opcional (0 = sem teto). */
export function superficieCorporalOnco(pesoKg: number, alturaCm: number, tetoM2 = 0): number {
  const sc = arredondar(Math.sqrt((pesoKg * alturaCm) / 3600), 2);
  return tetoM2 > 0 ? Math.min(sc, tetoM2) : sc;
}

/** Clearance de creatinina estimado por Cockcroft-Gault (mL/min, uma casa). */
export function clearanceCockcroftGault(
  idade: number,
  pesoKg: number,
  creatininaMgDl: number,
  sexo: 'M' | 'F' | 'I',
): number {
  const base = ((140 - idade) * pesoKg) / (72 * creatininaMgDl);
  return arredondar(sexo === 'F' ? base * 0.85 : base, 1);
}

export interface BaseCalculo {
  readonly superficieM2: number;
  readonly pesoKg: number;
  /** TFG estimada (mL/min) para as doses por AUC; null sem creatinina. */
  readonly clearanceMlMin: number | null;
  readonly reducaoPct: number;
}

/** As doses do ciclo fármaco a fármaco, com as parcelas da conta impressas (mg, uma casa). */
export function calcularDoses(farmacos: readonly FarmacoProtocolo[], b: BaseCalculo): DoseCalculada[] {
  return farmacos.map((f) => {
    let base: number;
    let conta: string;
    switch (f.unidade) {
      case 'mg/m2':
        base = b.superficieM2;
        conta = `${decimalBr(f.dose)} mg/m² × ${decimalBr(base, 2)} m²`;
        break;
      case 'mg/kg':
        base = b.pesoKg;
        conta = `${decimalBr(f.dose)} mg/kg × ${decimalBr(base)} kg`;
        break;
      case 'auc': {
        if (b.clearanceMlMin === null)
          recusar('creatinina-ausente', `${f.nome}: dose por AUC exige a creatinina do dia.`);
        const tfg = Math.min(b.clearanceMlMin as number, TFG_MAXIMA_CALVERT);
        base = arredondar(tfg + 25, 1);
        conta = `AUC ${decimalBr(f.dose)} × (TFG ${decimalBr(tfg)} + 25) mL/min`;
        break;
      }
      default:
        base = 1;
        conta = `${decimalBr(f.dose)} mg (dose fixa)`;
    }
    const calculada = arredondar(f.dose * base, 1);
    const final = arredondar(calculada * (1 - b.reducaoPct / 100), 1);
    conta += ` = ${decimalBr(calculada)} mg`;
    if (b.reducaoPct > 0) conta += `; redução de ${b.reducaoPct}% = ${decimalBr(final)} mg`;
    return {
      farmaco: f.nome,
      via: f.via,
      dias: [...f.dias],
      prescrita: f.dose,
      unidade: f.unidade,
      base,
      calculada,
      final,
      conta,
    };
  });
}

export interface CicloAnterior {
  readonly numero: number;
  readonly dataPrevista: string;
}

export interface ProtocoloDoCiclo {
  readonly id: number;
  readonly vigente: boolean;
  readonly ciclos: number;
  readonly intervaloDias: number;
  readonly farmacos: readonly FarmacoProtocolo[];
}

export interface CicloDoPaciente extends CicloAnterior {
  readonly curso: number;
}

/**
 * O curso (tratamento) do ciclo novo e os ciclos anteriores DELE: sem `novoTratamento`, o curso atual (o maior do
 * paciente no código do protocolo, 1 no primeiro); com ele (o motivo), o curso seguinte, só no ciclo 1 e só depois de
 * outro tratamento com o mesmo protocolo.
 */
export function cursoDoCiclo(
  e: { readonly numero: number; readonly novoTratamento?: string | undefined },
  doPaciente: readonly CicloDoPaciente[],
): { curso: number; anteriores: CicloAnterior[] } {
  const atual = doPaciente.reduce((m, c) => Math.max(m, c.curso), 0);
  if (e.novoTratamento) {
    if (e.numero !== 1)
      recusar('novo-tratamento-fora-do-ciclo-1', 'O tratamento novo com este protocolo começa no ciclo 1.');
    if (atual === 0)
      recusar(
        'novo-tratamento-sem-anterior',
        'O paciente ainda não fez este protocolo: registre o ciclo 1 sem iniciar um tratamento novo.',
      );
    return { curso: atual + 1, anteriores: [] };
  }
  const curso = Math.max(atual, 1);
  return {
    curso,
    anteriores: doPaciente
      .filter((c) => c.curso === curso)
      .map((c) => ({ numero: c.numero, dataPrevista: c.dataPrevista })),
  };
}

/** A prescrição geral candidata a ligar ao ciclo (da internação, valendo no dia previsto). */
export interface PrescricaoCandidata {
  readonly id: number;
  readonly suspensa: boolean;
}

/** A ligação do ciclo com a prescrição: ciclo ainda prescrito, prescrição da internação no dia e não suspensa. */
export function conferirVinculoPrescricao(
  c: { readonly situacao: string; readonly prescricoes: readonly number[] },
  prescricao: number,
  candidatas: readonly PrescricaoCandidata[],
): void {
  if (c.situacao === 'validado')
    recusar('ciclo-ja-validado', 'O ciclo já foi validado: a ligação com a prescrição não muda mais.');
  if (c.prescricoes.includes(prescricao))
    recusar('prescricao-ja-vinculada', 'Esta prescrição já está ligada ao ciclo.');
  const p = candidatas.find((x) => x.id === prescricao);
  if (!p)
    recusar(
      'prescricao-fora-do-ciclo',
      'A prescrição não é desta internação ou não vale no dia previsto do ciclo.',
    );
  if (p?.suspensa) recusar('prescricao-suspensa', 'A prescrição está suspensa: ligue a prescrição vigente.');
}

/** A validação farmacêutica só do ciclo com a prescrição dos medicamentos ligada. */
export function conferirPrescricaoParaValidar(c: { readonly prescricoes: readonly number[] }): void {
  if (c.prescricoes.length === 0)
    recusar(
      'ciclo-sem-prescricao',
      'O ciclo ainda não tem a prescrição dos medicamentos ligada: o médico liga a prescrição antes da validação.',
    );
}

/** Confere o ciclo (sequência, intervalo, teto do protocolo, creatinina e motivo da redução). */
export function conferirCiclo(
  e: RegistrarCicloOncologicoEntrada,
  p: ProtocoloDoCiclo,
  anteriores: readonly CicloAnterior[],
): { diasDesdeAnterior: number | null } {
  if (!p.vigente)
    recusar(
      'protocolo-substituido',
      'Esta versão do protocolo foi substituída por outra mais nova: registre o ciclo na versão vigente.',
    );
  if (e.numero > p.ciclos)
    recusar(
      'ciclo-alem-do-protocolo',
      `O protocolo tem ${p.ciclos} ciclo(s); o ciclo ${e.numero} passa dele.`,
    );
  if (anteriores.some((a) => a.numero === e.numero))
    recusar(
      'ciclo-repetido',
      `O ciclo ${e.numero} deste protocolo já foi registrado no tratamento atual do paciente: para recomeçar o protocolo, inicie um tratamento novo.`,
    );
  const anterior = anteriores.find((a) => a.numero === e.numero - 1) ?? null;
  if (e.numero > 1 && !anterior)
    recusar(
      'ciclo-fora-de-sequencia',
      `Registre antes o ciclo ${e.numero - 1}: os ciclos seguem a sequência do protocolo.`,
    );
  if (p.farmacos.some((f) => f.unidade === 'auc') && e.creatininaMgDl === null)
    recusar('creatinina-ausente', 'O protocolo tem dose por AUC: informe a creatinina do dia.');
  if (e.reducaoPct > 0 && !e.motivoReducao) recusar('motivo-reducao', 'Informe o motivo da redução de dose.');
  let dias: number | null = null;
  if (anterior) {
    dias = Math.round(minutosEntreCivis(anterior.dataPrevista, e.dataPrevista) / 1440);
    if (dias < 0) recusar('data-antes-do-anterior', 'A data prevista é anterior à do ciclo anterior.');
    if (dias < p.intervaloDias && !e.justificativaIntervalo)
      recusar(
        'intervalo-curto',
        `O ciclo anterior foi há ${dias} dia(s) e o protocolo pede ${p.intervaloDias}: informe a justificativa clínica.`,
      );
  }
  return { diasDesdeAnterior: dias };
}

/**
 * Dupla checagem independente: a dose que o farmacêutico calculou, fármaco a fármaco, contra a do sistema. Devolve as
 * divergências (fora da tolerância em %); a API recusa com elas.
 */
export function duplaChecagem(
  doses: readonly DoseCalculada[],
  informadas: readonly number[],
  toleranciaPct: number,
): { farmaco: string; sistema: number; informada: number; diferencaPct: number }[] {
  if (informadas.length !== doses.length)
    recusar(
      'doses-incompletas',
      `Informe a dose de cada um dos ${doses.length} fármaco(s) do ciclo, na ordem do protocolo.`,
    );
  return doses
    .map((d, i) => {
      const informada = informadas[i] as number;
      const diferencaPct =
        d.final === 0 ? 100 : arredondar((Math.abs(informada - d.final) / d.final) * 100, 1);
      return { farmaco: d.farmaco, sistema: d.final, informada, diferencaPct };
    })
    .filter((x) => x.diferencaPct > toleranciaPct);
}
