// Modelos ZPL de pulseira e etiquetas (regra 10 da ficha do M09; cap-09 §9.8, §9.6), gerados no servidor e
// versionados. Dois identificadores legíveis (nome completo e data de nascimento; prontuário como apoio) e
// código só com os IDs do legado (paciente, atendimento REG, amostra), nunca CPF nem nome no código.
// O ZPL é comparado como texto com a referência (`referencias/*.zpl`) até o deploy (DP-15): a impressão
// física e a leitura pelo leitor da beira-leito ficam registradas em ata na primeira versão.

export const VERSAO_MODELOS_ZPL = '1';

export class ErroZpl extends Error {
  override readonly name = 'ErroZpl';
}

/**
 * Campo de texto com ^FH (hexadecimal com `_`): os caracteres de comando do ZPL (^ e ~) e o próprio `_`
 * nunca chegam crus à impressora. Codificação UTF-8 (^CI28); controle e quebra de linha são recusados.
 */
export function campoZpl(texto: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(texto)) throw new ErroZpl('Caractere de controle em campo de etiqueta.');
  let s = '';
  for (const ch of texto) {
    if (ch === '_' || ch === '^' || ch === '~') s += '_' + ch.charCodeAt(0).toString(16).toUpperCase();
    else s += ch;
  }
  return `^FH_^FD${s}^FS`;
}

/** Dado do código de barras: só dígitos, letras ASCII, ponto, hífen e barra (IDs do legado). */
function dadoCodigo(texto: string): string {
  if (!/^[A-Za-z0-9.\-/:|]+$/.test(texto)) throw new ErroZpl(`Dado de código inválido: só IDs do legado.`);
  return texto;
}

function inteiroPositivo(nome: string, v: number): string {
  if (!Number.isSafeInteger(v) || v <= 0) throw new ErroZpl(`${nome} inválido: inteiro positivo do legado.`);
  return String(v);
}

/** DD/MM/AAAA a partir de AAAA-MM-DD (sentinela 1899-12-30 é recusada: pulseira sem data não sai). */
function dataLegivel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || iso === '1899-12-30') throw new ErroZpl('Data de nascimento ausente ou inválida.');
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export interface DadosPulseira {
  readonly nomeCompleto: string;
  /**
   * Nome social do cadastro (Decreto 8.727/2016): sai em destaque e o nome civil logo abaixo, menor (a pulseira segue
   * com os dois identificadores da identificação segura).
   */
  readonly nomeSocial?: string | null;
  /** AAAA-MM-DD */
  readonly nascimento: string;
  /** RICADPAC.ID (paciente) e prontuário do legado. */
  readonly idPaciente: number;
  readonly prontuario: number;
  /** REG do atendimento. */
  readonly atendimento: number;
  readonly leito?: string | null;
  readonly alergia?: boolean;
}

/** O nome da pulseira: com nome social, o social em destaque e o civil ("REG.: ...") menor na mesma faixa. */
function linhasDoNome(d: DadosPulseira): string[] {
  const civil = d.nomeCompleto.trim().toUpperCase();
  const social = (d.nomeSocial ?? '').trim().toUpperCase();
  if (!social || social === civil) return ['^FO130,250^A0R,42,42' + campoZpl(civil)];
  return ['^FO150,250^A0R,36,36' + campoZpl(social), '^FO118,250^A0R,26,26' + campoZpl(`REG.: ${civil}`)];
}

/** Pulseira adulto (térmica 1" × 11", 203 dpi, rotacionada): DataMatrix com paciente e atendimento. */
export function zplPulseira(d: DadosPulseira): string {
  const paciente = inteiroPositivo('idPaciente', d.idPaciente);
  const atend = inteiroPositivo('atendimento', d.atendimento);
  const pront = inteiroPositivo('prontuario', d.prontuario);
  const codigo = dadoCodigo(`P${paciente}|A${atend}`);
  return [
    '^XA',
    '^CI28',
    '^PW203',
    '^LL2233',
    '^LH0,0',
    '^FWR',
    ...linhasDoNome(d),
    '^FO80,250^A0R,34,34' + campoZpl(`NASC. ${dataLegivel(d.nascimento)}  PRONT. ${pront}`),
    '^FO35,250^A0R,28,28' + campoZpl(`ATEND. ${atend}${d.leito ? `  LEITO ${d.leito.trim()}` : ''}`),
    ...(d.alergia ? ['^FO35,1500^A0R,34,34' + campoZpl('ALERGIA')] : []),
    `^FO30,1750^BXR,6,200^FD${codigo}^FS`,
    '^PQ1',
    '^XZ',
    '',
  ].join('\n');
}

export interface DadosEtiquetaAmostra {
  readonly nomeCompleto: string;
  readonly nascimento: string;
  readonly prontuario: number;
  readonly atendimento: number;
  /** Identificador da amostra no legado (pedido/amostra). */
  readonly amostra: string;
  readonly exame: string;
}

/** Etiqueta de amostra (50 × 25 mm, 203 dpi): Code 128 com o identificador da amostra. */
export function zplEtiquetaAmostra(d: DadosEtiquetaAmostra): string {
  const amostra = dadoCodigo(d.amostra);
  return [
    '^XA',
    '^CI28',
    '^PW400',
    '^LL200',
    '^LH0,0',
    '^FO10,10^A0N,24,24' + campoZpl(d.nomeCompleto.trim().toUpperCase().slice(0, 32)),
    '^FO10,38^A0N,20,20' +
      campoZpl(`NASC. ${dataLegivel(d.nascimento)}  PRONT. ${inteiroPositivo('prontuario', d.prontuario)}`),
    '^FO10,62^A0N,20,20' +
      campoZpl(`ATEND. ${inteiroPositivo('atendimento', d.atendimento)}  ${d.exame.trim().slice(0, 18)}`),
    `^FO10,90^BY2^BCN,70,Y,N,N^FD${amostra}^FS`,
    '^PQ1',
    '^XZ',
    '',
  ].join('\n');
}

export interface DadosEtiquetaProntuario {
  readonly nomeCompleto: string;
  readonly nascimento: string;
  readonly prontuario: number;
  readonly idPaciente: number;
}

/** Etiqueta de prontuário (100 × 30 mm): Code 128 com o prontuário. */
export function zplEtiquetaProntuario(d: DadosEtiquetaProntuario): string {
  const pront = inteiroPositivo('prontuario', d.prontuario);
  inteiroPositivo('idPaciente', d.idPaciente);
  return [
    '^XA',
    '^CI28',
    '^PW800',
    '^LL240',
    '^LH0,0',
    '^FO20,20^A0N,36,36' + campoZpl(d.nomeCompleto.trim().toUpperCase()),
    '^FO20,64^A0N,28,28' + campoZpl(`NASC. ${dataLegivel(d.nascimento)}  PRONT. ${pront}`),
    `^FO20,110^BY3^BCN,90,Y,N,N^FD${dadoCodigo(pront)}^FS`,
    '^PQ1',
    '^XZ',
    '',
  ].join('\n');
}

export interface DadosEtiquetaLeito {
  /** O leito como a tela mostra (bloco, acomodação e leito); nada do paciente. */
  readonly rotulo: string;
  /** O endereço da solicitação de limpeza do leito (`…/higienizacao/solicitacoes?leito=…&origem=qrcode`). */
  readonly url: string;
}

/**
 * Etiqueta do leito (100 × 50 mm, 203 dpi): o QR code com o endereço da solicitação de limpeza daquele leito (ficha do
 * M21: "Solicitações … QR code"); a câmera do celular abre a tela já com o leito. Só o leito, nenhum dado de paciente.
 */
export function zplEtiquetaLeito(d: DadosEtiquetaLeito): string {
  if (!/^https?:\/\/[A-Za-z0-9.:[\]-]+\/[A-Za-z0-9/._?=&%-]*$/.test(d.url) || d.url.length > 300)
    throw new ErroZpl('Endereço do QR do leito inválido.');
  return [
    '^XA',
    '^CI28',
    '^PW800',
    '^LL400',
    '^LH0,0',
    '^FO20,20^A0N,40,40' + campoZpl(`LEITO ${d.rotulo.trim().toUpperCase()}`.slice(0, 40)),
    '^FO20,72^A0N,26,26' + campoZpl('SOLICITAR LIMPEZA: APONTE A CAMERA'),
    `^FO20,110^BQN,2,6^FDQA,${d.url}^FS`,
    '^PQ1',
    '^XZ',
    '',
  ].join('\n');
}

export interface DadosEtiquetaDose {
  /** O leito e o atendimento (REG) do paciente: a etiqueta vai presa à dose do paciente. */
  readonly leito: string;
  readonly atendimento: number;
  /** As iniciais do paciente (o nome completo fica na pulseira; a etiqueta da dose é pequena). */
  readonly iniciais: string;
  readonly medicamento: string;
  /** Dose, unidade e via como a tela mostra ("500 MG EV"). */
  readonly dose: string;
  /** Horário previsto (DD/MM HH:MM). */
  readonly horario: string;
  readonly lote: string | null;
  /** DD/MM/AAAA. */
  readonly validade: string | null;
  /** O conteúdo do DataMatrix GS1 (`codigoEtiquetaDose`); o GS vira o FNC1 (`_1`, escape do ^BX). */
  readonly datamatrix: string;
  readonly controlado?: boolean;
}

/**
 * Etiqueta de dose da farmácia (ficha do M29; 60 × 30 mm, 203 dpi): DataMatrix GS1 (^BX com o FNC1 inicial, `_1`)
 * com o produto, a validade, o lote e a série da dose; o leito, o atendimento, as iniciais, o medicamento, a dose, o
 * horário e o lote legíveis. Nada do paciente no código.
 */
export function zplEtiquetaDose(d: DadosEtiquetaDose): string {
  const atend = inteiroPositivo('atendimento', d.atendimento);
  const partes = d.datamatrix.split('\u001d');
  if (partes.some((x) => !/^[0-9A-Za-z./-]+$/.test(x))) throw new ErroZpl('Dado do DataMatrix inválido.');
  // ^BX com o escape `_` (7º parâmetro): `_1` é o FNC1 (o inicial marca GS1; os outros separam os campos variáveis).
  const dm = `_1${partes.join('_1')}`;
  const linha = (t: string, n = 30) => t.trim().toUpperCase().slice(0, n);
  return [
    '^XA',
    '^CI28',
    '^PW480',
    '^LL240',
    '^LH0,0',
    '^FO10,10^A0N,26,26' + campoZpl(linha(`LEITO ${d.leito}  AT ${atend}  ${d.iniciais}`, 34)),
    '^FO10,42^A0N,24,24' + campoZpl(linha(d.medicamento, 28)),
    '^FO10,70^A0N,22,22' + campoZpl(linha(d.dose, 28)),
    '^FO10,96^A0N,22,22' + campoZpl(linha(`HORARIO ${d.horario}`, 28)),
    '^FO10,122^A0N,20,20' + campoZpl(linha(`LOTE ${d.lote ?? '-'}  VAL ${d.validade ?? '-'}`, 32)),
    ...(d.controlado ? ['^FO10,148^A0N,22,22' + campoZpl('CONTROLADO')] : []),
    `^FO330,20^BXN,5,200,,,,_^FD${dm}^FS`,
    '^PQ1',
    '^XZ',
    '',
  ].join('\n');
}

export interface DadosEtiquetaBandeja {
  /** Os dois identificadores (ficha do M45, regra 12): nome completo e data de nascimento (AAAA-MM-DD). */
  readonly nomeCompleto: string;
  readonly nascimento: string;
  readonly prontuario: number;
  /** REG da internação (o código de barras leva só os IDs). */
  readonly internacao: number;
  /** O leito como a copa lê ("2A 201 B") e a refeição ("Almoço 11:45"). */
  readonly leito: string;
  readonly refeicao: string;
  /** DD/MM/AAAA. */
  readonly data: string;
  /** A dieta (o jejum prevalece: "JEJUM" com a origem) e as características (consistência e restrições). */
  readonly dieta: string;
  readonly restricoes: string | null;
  /** As alergias alimentares do prontuário (destaque); vazio sem alergia. */
  readonly alergias: readonly string[];
  readonly acompanhante?: boolean;
  /** Número da refeição no código (o cadastro de refeições). */
  readonly codigoRefeicao: number;
}

/**
 * Etiqueta de bandeja (ficha do M45, regra 12; cap-06a §6.3; 100 × 60 mm, 203 dpi): o nome completo e o nascimento
 * (dois identificadores), o prontuário, o leito, a refeição, a dieta e as restrições, a alergia alimentar em destaque
 * (faixa invertida) e a refeição do acompanhante; o Code 128 leva só a internação e a refeição.
 */
export function zplEtiquetaBandeja(d: DadosEtiquetaBandeja): string {
  const reg = inteiroPositivo('internacao', d.internacao);
  const pront = inteiroPositivo('prontuario', d.prontuario);
  if (!Number.isSafeInteger(d.codigoRefeicao) || d.codigoRefeicao < 0)
    throw new ErroZpl('Refeição inválida.');
  const linha = (t: string, n: number) => t.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, n);
  const alergia = d.alergias.map((a) => a.trim()).filter(Boolean);
  return [
    '^XA',
    '^CI28',
    '^PW800',
    '^LL480',
    '^LH0,0',
    '^FO20,16^A0N,38,38' + campoZpl(linha(d.nomeCompleto, 36)),
    '^FO20,60^A0N,28,28' + campoZpl(`NASC. ${dataLegivel(d.nascimento)}  PRONT. ${pront}`),
    '^FO20,96^A0N,30,30' + campoZpl(linha(`LEITO ${d.leito}`, 40)),
    '^FO20,134^A0N,26,26' + campoZpl(linha(`${d.refeicao}  ${d.data}`, 46)),
    '^FO20,174^A0N,40,40' + campoZpl(linha(d.dieta, 32)),
    ...(d.restricoes ? ['^FO20,222^A0N,26,26' + campoZpl(linha(d.restricoes, 52))] : []),
    ...(alergia.length > 0
      ? [
          '^FO20,262^GB760,44,44^FS',
          '^FO30,270^A0N,30,30^FR' + campoZpl(linha(`ALERGIA ALIMENTAR: ${alergia.join(', ')}`, 46)),
        ]
      : []),
    ...(d.acompanhante ? ['^FO20,316^A0N,26,26' + campoZpl('COM REFEICAO DO ACOMPANHANTE')] : []),
    `^FO20,356^BY2^BCN,80,Y,N,N^FD${dadoCodigo(`I${reg}R${d.codigoRefeicao}`)}^FS`,
    '^PQ1',
    '^XZ',
    '',
  ].join('\n');
}
