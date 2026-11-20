// Regras puras da lista de trabalho DICOM (M47, etapa 3; ficha, regra 8; cap-05b §5.10; cap-12 §12.4): o número de
// acesso único, a modalidade do exame (a do cadastro do exame ou a do setor pelo parâmetro), a chave de idempotência e
// a chave natural do exame, o item da MWL no modelo JSON do DICOM (PS3.18, anexo F), o status vigente quando as
// mensagens do MPPS chegam fora de ordem, a situação do exame na tela e o link do visualizador. Nada aqui fala com o
// banco nem com a rede.
import {
  FORMATO_ACCESSION,
  type EntregaMwl,
  type SituacaoWorklist,
  STATUS_ESTUDO,
  type StatusEstudo,
} from '@sgh/contratos';
import { hex, sha256 } from './sha256.js';

/** Número de acesso do item: o prefixo do estabelecimento (até 3) e o ID do item com 9 dígitos ou mais (até 16). */
export function accessionDoItem(hospital: string, idItem: number): string {
  if (!Number.isInteger(idItem) || idItem <= 0) throw new Error('ID do item da lista de trabalho inválido.');
  const prefixo =
    hospital
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3) || 'SGH';
  const a = `${prefixo}${String(idItem).padStart(9, '0')}`;
  if (!FORMATO_ACCESSION.test(a)) throw new Error('Número de acesso fora do formato DICOM (até 16).');
  return a;
}

/** A chave de idempotência do item: um item por exame no estabelecimento. */
export function chaveIdempotenciaMwl(hospital: string, exame: number): string {
  return `mwl:${hospital}:${exame}`;
}

/** A chave natural do exame lançado (quando o ID some, a chave reencontra o exame). */
export function chaveNaturalExame(x: {
  readonly reg: number;
  readonly ato: number;
  readonly exame: string;
  readonly sequencia: number;
  readonly data: string;
}): string {
  return `${x.reg}|${x.ato}|${x.exame.trim()}|${x.sequencia}|${x.data.slice(0, 10)}`.slice(0, 80);
}

/** O parâmetro `pacs.modalidadePorSetor` lido: setor → sigla (o malformado é ignorado, nunca vira outra coisa). */
export function lerModalidadePorSetor(texto: string | null | undefined): ReadonlyMap<number, string> {
  const m = new Map<number, string>();
  for (const parte of String(texto ?? '').split(';')) {
    const r = /^\s*(\d{1,4})\s*:\s*([A-Z]{2,8})\s*$/.exec(parte);
    if (r) m.set(Number(r[1]), r[2]!);
  }
  return m;
}

export interface ModalidadeCadastrada {
  readonly id: number;
  readonly sigla: string;
}

/**
 * A modalidade do exame: a do cadastro do exame, se houver; senão a do setor pelo parâmetro, achada pela sigla no
 * cadastro de modalidades (sem ela no cadastro, a sigla vale sem o ID). null: setor sem modalidade DICOM.
 */
export function modalidadeDoExame(
  x: { readonly ato: number; readonly modalidadeCadastro: ModalidadeCadastrada | null },
  porSetor: ReadonlyMap<number, string>,
  modalidades: readonly ModalidadeCadastrada[],
): { id: number | null; sigla: string } | null {
  if (x.modalidadeCadastro) return { id: x.modalidadeCadastro.id, sigla: x.modalidadeCadastro.sigla.trim() };
  const sigla = porSetor.get(x.ato);
  if (!sigla) return null;
  const c = modalidades.find((m) => m.sigla.trim().toUpperCase() === sigla);
  return { id: c?.id ?? null, sigla };
}

/** UID DICOM determinístico (raiz 2.25 da ISO/IEC 9834-8): o mesmo número de acesso dá sempre o mesmo estudo. */
export function uidDoEstudo(hospital: string, accession: string): string {
  const h = sha256(`estudo:${hospital}:${accession}`);
  const n = BigInt(`0x${hex(h.subarray(0, 16))}`);
  return `2.25.${n.toString()}`;
}

const ordemDe = (s: StatusEstudo) => STATUS_ESTUDO.find((x) => x.codigo === s)!.ordem;

export interface MensagemStatus {
  readonly id: number;
  readonly status: StatusEstudo;
  readonly ocorridoEm: string;
}

/**
 * O status vigente das mensagens recebidas (regra 8, "MPPS fora de ordem"): a de maior ordem vence (em andamento <
 * concluído = descontinuado); empate pela hora na modalidade e, por fim, pela chegada. Uma mensagem "em andamento" que
 * chega depois do "concluído" fica registrada e não rebaixa o exame.
 */
export function statusVigente<T extends MensagemStatus>(mensagens: readonly T[]): T | null {
  let v: T | null = null;
  for (const m of mensagens) {
    if (!v) {
      v = m;
      continue;
    }
    const d = ordemDe(m.status) - ordemDe(v.status);
    if (d > 0 || (d === 0 && (m.ocorridoEm > v.ocorridoEm || (m.ocorridoEm === v.ocorridoEm && m.id > v.id))))
      v = m;
  }
  return v;
}

/** A nova mensagem chegou fora de ordem (a vigente anterior já tinha ordem maior ou acontecera depois)? */
export function chegouForaDeOrdem(
  anterior: MensagemStatus | null,
  nova: Pick<MensagemStatus, 'status' | 'ocorridoEm'>,
): boolean {
  if (!anterior) return false;
  const d = ordemDe(nova.status) - ordemDe(anterior.status);
  return d < 0 || (d === 0 && nova.ocorridoEm < anterior.ocorridoEm);
}

/** A situação do exame na lista (a contagem do topo e o filtro). */
export function situacaoDoExame(x: {
  readonly temModalidade: boolean;
  readonly entrega: EntregaMwl | null;
  readonly status: StatusEstudo | null;
}): SituacaoWorklist {
  if (x.status) return x.status;
  if (x.entrega === null) return x.temModalidade ? 'a-enviar' : 'sem-modalidade';
  if (x.entrega === 'enviado') return 'entregue';
  if (x.entrega === 'morto' || x.entrega === 'descartado') return 'falhou';
  return 'na-fila';
}

/**
 * O link do visualizador: o endereço do parâmetro com {estudo} e {acesso} trocados (codificados). null sem endereço,
 * com endereço que não seja http(s), ou sem o UID quando o endereço pede o estudo.
 */
export function linkDoVisualizador(
  modelo: string | null | undefined,
  uidEstudo: string | null,
  accession: string,
): string | null {
  const m = String(modelo ?? '').trim();
  if (!/^https?:\/\//i.test(m) || !/\{(estudo|acesso)\}/.test(m)) return null;
  if (m.includes('{estudo}') && !uidEstudo) return null;
  return m
    .replace(/\{estudo\}/g, encodeURIComponent(uidEstudo ?? ''))
    .replace(/\{acesso\}/g, encodeURIComponent(accession));
}

export interface DadosItemMwl {
  readonly accession: string;
  readonly hospital: string;
  readonly modalidade: string;
  /** O AE title da estação agendada (a sigla do setor, se não houver outra). */
  readonly estacao: string;
  readonly paciente: {
    readonly id: number;
    readonly nome: string;
    readonly nascimento: string | null;
    readonly sexo: string | null;
  };
  readonly exame: { readonly codigo: string; readonly nome: string };
  /** AAAA-MM-DDTHH:MM (hora local do estabelecimento). */
  readonly agendadoPara: string;
  readonly urgente: boolean;
  readonly solicitante: string | null;
}

type ValorDicom = { vr: string; Value?: unknown[] };

const dataDicom = (iso: string | null) => (iso ? iso.slice(0, 10).replace(/-/g, '') : null);
const horaDicom = (iso: string) => `${iso.slice(11, 13) || '00'}${iso.slice(14, 16) || '00'}00`;
const sh = (t: string, max = 16) =>
  t
    .replace(/[\\^=]/g, ' ')
    .trim()
    .slice(0, max);
const lo = (t: string) => sh(t, 64);
const valor = (vr: string, v: unknown | null | undefined): ValorDicom =>
  v === null || v === undefined || v === '' ? { vr } : { vr, Value: [v] };

/** Nome DICOM (PN): "SOBRENOME^NOMES", em maiúsculas, sem acento. */
export function nomeDicom(nome: string): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  const partes = limpo.split(' ').filter(Boolean);
  if (partes.length < 2) return limpo.slice(0, 64);
  return `${partes.at(-1)}^${partes.slice(0, -1).join(' ')}`.slice(0, 64);
}

/** O item da MWL no modelo JSON do DICOM (PS3.18 F.2), com o estudo pré-atribuído pelo número de acesso. */
export function itemMwlDicom(d: DadosItemMwl): Record<string, ValorDicom> {
  if (!FORMATO_ACCESSION.test(d.accession)) throw new Error('Número de acesso inválido.');
  const sexo = d.paciente.sexo === 'M' || d.paciente.sexo === 'F' ? d.paciente.sexo : 'O';
  return {
    '00080050': valor('SH', d.accession),
    '00080090': valor('PN', d.solicitante ? { Alphabetic: nomeDicom(d.solicitante) } : null),
    '00100010': valor('PN', { Alphabetic: nomeDicom(d.paciente.nome) }),
    '00100020': valor('LO', String(d.paciente.id)),
    '00100021': valor('LO', sh(d.hospital.toUpperCase())),
    '00100030': valor('DA', dataDicom(d.paciente.nascimento)),
    '00100040': valor('CS', sexo),
    '0020000D': valor('UI', uidDoEstudo(d.hospital, d.accession)),
    '00321060': valor('LO', lo(d.exame.nome)),
    '00401001': valor('SH', d.accession),
    '00401003': valor('SH', d.urgente ? 'STAT' : 'ROUTINE'),
    '00400100': {
      vr: 'SQ',
      Value: [
        {
          '00080060': valor('CS', sh(d.modalidade)),
          '00400001': valor('AE', sh(d.estacao)),
          '00400002': valor('DA', dataDicom(d.agendadoPara)),
          '00400003': valor('TM', horaDicom(d.agendadoPara)),
          '00400007': valor('LO', lo(d.exame.nome)),
          '00400009': valor('SH', d.accession),
          '00400008': {
            vr: 'SQ',
            Value: [
              {
                '00080100': valor('SH', sh(d.exame.codigo)),
                '00080102': valor('SH', 'SGH'),
                '00080104': valor('LO', lo(d.exame.nome)),
              },
            ],
          },
        },
      ],
    },
  };
}
