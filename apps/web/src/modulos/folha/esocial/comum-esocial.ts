// Comuns da tela do eSocial (M53.6, etapa F5): o que cada evento e cada lote permitem na tela (previsão; o servidor confere
// de novo pelo ciclo do domínio), a escolha dos eventos para o lote (mesmo grupo, só validados, teto de 50), os campos
// do evento do trabalhador, o formulário dos parâmetros do empregador (com o FAP em texto "1,0000"), o retorno do lote
// evento a evento, a contagem que o sistema externo informou na conciliação e as recusas da resposta.
import {
  type ApoioEsocial,
  definicaoEventoEsocial,
  type EmpregadorEsocial,
  type EmpregadorEsocialLido,
  type EventoEsocial,
  type EventoEsocialResumo,
  type EventoTrabalhadorEsocial,
  type FichaEsocialVinculo,
  type GrupoEventoEsocial,
  type LoteEsocial,
  RECIBO_ESOCIAL,
  TETO_EVENTOS_LOTE_ESOCIAL,
} from '@sgh/contratos';
import { recusaDe } from '../comum-folha.js';

/** O colaborador escolhido nas abas do eSocial (pela busca ou pelo número do vínculo). */
export interface ColaboradorEscolhido {
  readonly vinculo: number;
  readonly rotulo: string;
  readonly tipo: string | null;
}

export interface AcoesEvento {
  readonly descartar: boolean;
  readonly excluir: boolean;
  readonly retificar: boolean;
  readonly lote: boolean;
}

const TRABALHADOR_RETIFICAVEL: readonly EventoEsocial[] = [
  'S-2200',
  'S-2205',
  'S-2206',
  'S-2230',
  'S-2299',
  'S-2300',
  'S-2399',
];

/** O que a tela oferece para o evento (o ciclo: descartar antes do envio ou depois da rejeição; excluir e retificar só o aceito). */
export function acoesDoEvento(e: EventoEsocialResumo, apoio: ApoioEsocial): AcoesEvento {
  const g = apoio.acoes.gerar;
  return {
    descartar: g && ['gerado', 'invalido', 'validado', 'rejeitado'].includes(e.situacao),
    excluir: g && e.situacao === 'aceito' && e.evento !== 'S-3000' && e.grupo === 'nao-periodico',
    retificar:
      g && e.situacao === 'aceito' && TRABALHADOR_RETIFICAVEL.includes(e.evento) && e.vinculo !== null,
    lote: apoio.acoes.transmitir && e.situacao === 'validado',
  };
}

export interface AcoesLote {
  readonly enviar: boolean;
  readonly retorno: boolean;
  /** Consultar o retorno no eSocial pelo protocolo (só no envio real, em produção). */
  readonly consultar: boolean;
  readonly cancelar: boolean;
}

export function acoesDoLote(l: LoteEsocial, apoio: ApoioEsocial): AcoesLote {
  const t = apoio.acoes.transmitir;
  return {
    enviar: t && apoio.transmissao.podeEnviar && l.situacao === 'montado',
    retorno: t && l.situacao === 'enviado',
    consultar:
      t &&
      apoio.transmissao.podeEnviar &&
      l.situacao === 'enviado' &&
      l.ambiente === 'producao' &&
      !!l.protocolo,
    cancelar: t && l.situacao === 'montado',
  };
}

export type ConferenciaEscolha =
  | { readonly ok: true; readonly grupo: GrupoEventoEsocial }
  | { readonly ok: false; readonly motivo: 'vazio' | 'misto' | 'teto' };

/** Os eventos escolhidos podem ir num lote? (mesmo grupo; até 50; a empresa é a da tela e os eventos já são dela). */
export function conferirEscolha(escolhidos: readonly EventoEsocialResumo[]): ConferenciaEscolha {
  if (escolhidos.length === 0) return { ok: false, motivo: 'vazio' };
  if (escolhidos.length > TETO_EVENTOS_LOTE_ESOCIAL) return { ok: false, motivo: 'teto' };
  const grupos = new Set(escolhidos.map((e) => e.grupo));
  if (grupos.size > 1) return { ok: false, motivo: 'misto' };
  return { ok: true, grupo: escolhidos[0]!.grupo };
}

/** De onde vem o registro de origem de cada evento do trabalhador na tela. */
export type OrigemTrabalhador = 'nenhuma' | 'data' | 'afastamento' | 'rescisao';
export function origemDoEvento(evento: EventoTrabalhadorEsocial): OrigemTrabalhador {
  switch (evento) {
    case 'S-2205':
    case 'S-2206':
      return 'data';
    case 'S-2230':
      return 'afastamento';
    case 'S-2299':
      return 'rescisao';
    default:
      return 'nenhuma';
  }
}

/** "1,0000" → 10000 (FAP em décimos de milésimo); null se fora do formato. */
export function lerFap(texto: string): number | null {
  const m = /^\s*(\d)(?:[,.](\d{1,4}))?\s*$/.exec(texto);
  if (!m) return null;
  return Number(m[1]) * 10_000 + Number((m[2] ?? '').padEnd(4, '0'));
}
/** 10000 → "1,0000". */
export const textoFap = (fap: number) =>
  `${Math.floor(fap / 10_000)},${String(fap % 10_000).padStart(4, '0')}`;

/** O formulário do empregador: a vigência anterior como ponto de partida (correção = nova vigência). */
export interface FormEmpregador {
  inicio: string | null;
  transmissor: 'sante' | 'externo';
  leiaute: string;
  classTrib: string;
  indCoop: number | null;
  indConstr: number | null;
  indDesFolha: number;
  indOptRegEletron: number;
  cnaePrep: string;
  aliqRat: number;
  fap: string;
  codLotacao: string;
  fpas: string;
  codTercs: string;
  ideTabRubr: string;
  cnpjSindicato: string;
  motivos: Record<string, string>;
}

export function formDoEmpregador(
  anterior: EmpregadorEsocialLido | null,
  leiaute: string,
  inicio: string | null,
): FormEmpregador {
  return {
    inicio,
    transmissor: anterior?.transmissor ?? 'sante',
    leiaute: anterior?.leiaute ?? leiaute,
    classTrib: anterior?.classTrib ?? '',
    indCoop: anterior?.indCoop ?? null,
    indConstr: anterior?.indConstr ?? null,
    indDesFolha: anterior?.indDesFolha ?? 0,
    indOptRegEletron: anterior?.indOptRegEletron ?? 0,
    cnaePrep: anterior?.cnaePrep ?? '',
    aliqRat: anterior?.aliqRat ?? 1,
    fap: anterior ? textoFap(anterior.fap) : '1,0000',
    codLotacao: anterior?.codLotacao ?? '',
    fpas: anterior?.fpas ?? '',
    codTercs: anterior?.codTercs ?? '',
    ideTabRubr: anterior?.ideTabRubr ?? '',
    cnpjSindicato: anterior?.cnpjSindicato ?? '',
    motivos: { ...(anterior?.motivosAfastamento ?? {}) },
  };
}

const soDigitos = (s: string) => s.replace(/[.\-/\s]/g, '');

/** A entrada da gravação a partir do formulário (o esquema do contrato confere o resto). */
export function entradaDoEmpregador(empresa: number | null, f: FormEmpregador): Record<string, unknown> {
  const motivos: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.motivos)) if (v.trim()) motivos[k] = v.trim();
  return {
    empresa: empresa ?? -1,
    inicio: f.inicio ?? '',
    transmissor: f.transmissor,
    leiaute: f.leiaute,
    classTrib: f.classTrib.trim(),
    indCoop: f.indCoop,
    indConstr: f.indConstr,
    indDesFolha: f.indDesFolha,
    indOptRegEletron: f.indOptRegEletron,
    cnaePrep: soDigitos(f.cnaePrep),
    aliqRat: f.aliqRat,
    fap: lerFap(f.fap) ?? -1,
    codLotacao: f.codLotacao.trim(),
    fpas: soDigitos(f.fpas),
    codTercs: soDigitos(f.codTercs),
    ideTabRubr: f.ideTabRubr.trim(),
    cnpjSindicato: f.cnpjSindicato.trim() ? soDigitos(f.cnpjSindicato).toUpperCase() : null,
    motivosAfastamento: motivos,
  } satisfies Record<keyof EmpregadorEsocial, unknown>;
}

/** A vigência em vigor na competência (a de início mais recente até ela). */
export function vigenciaEm(
  vs: readonly EmpregadorEsocialLido[],
  competencia: string,
): EmpregadorEsocialLido | null {
  return (
    [...vs].filter((v) => v.inicio <= competencia).sort((a, b) => b.inicio.localeCompare(a.inicio))[0] ?? null
  );
}

/** A ficha vazia (o que o formulário mostra para o colaborador sem ficha). */
export function fichaVazia(): FichaEsocialVinculo {
  return {
    sexo: 'F',
    racaCor: 6,
    estadoCivil: null,
    grauInstrucao: '07',
    nomeSocial: null,
    nascimento: '',
    paisNascimento: '105',
    paisNacionalidade: '105',
    endereco: {
      tipoLogradouro: null,
      logradouro: '',
      numero: '',
      complemento: null,
      bairro: null,
      cep: '',
      municipio: '',
      uf: '',
    },
    categoria: '101',
    cboCargo: null,
    cboFuncao: null,
    regimeJornada: 1,
    naturezaAtividade: 1,
    tipoContrato: 1,
    terminoContrato: null,
    tipoJornada: 2,
    tempoParcial: 0,
    descricaoJornada: '',
    tipoAdmissao: 1,
    indicativoAdmissao: 1,
    cnpjSindicato: null,
    estagio: null,
  };
}

/** Texto em branco vira null (campos opcionais da ficha). */
export const ouNulo = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export interface LinhaRetorno {
  evento: number;
  aceito: boolean;
  recibo: string;
  codigo: string;
  descricao: string;
}

/** As linhas do retorno, uma por evento enviado do lote (o DP preenche o que o eSocial devolveu; D-RETORNO-536). */
export const linhasRetorno = (eventos: readonly EventoEsocialResumo[]): LinhaRetorno[] =>
  eventos
    .filter((e) => e.situacao === 'enviado')
    .map((e) => ({ evento: e.id, aceito: true, recibo: '', codigo: '', descricao: '' }));

/** Cada linha completa? (aceito exige o recibo no formato do eSocial; código e descrição sempre). */
export function linhaRetornoOk(l: LinhaRetorno): boolean {
  if (!l.codigo.trim() || !l.descricao.trim()) return false;
  if (l.aceito) return RECIBO_ESOCIAL.test(l.recibo.trim());
  return l.recibo.trim() === '' || RECIBO_ESOCIAL.test(l.recibo.trim());
}

export function entradaRetorno(versao: number, protocolo: string, ls: readonly LinhaRetorno[]) {
  return {
    versao,
    protocolo: ouNulo(protocolo),
    eventos: ls.map((l) => ({
      evento: l.evento,
      aceito: l.aceito,
      recibo: ouNulo(l.recibo),
      codigo: l.codigo.trim(),
      descricao: l.descricao.trim(),
    })),
  };
}

/** A contagem do sistema externo digitada por evento: em branco não vai; número inteiro ≥ 0; null = inválido. */
export function lerExterno(textos: Readonly<Record<string, string>>): Record<string, number> | null {
  const r: Record<string, number> = {};
  for (const [evento, v] of Object.entries(textos)) {
    const s = v.trim();
    if (!s) continue;
    if (!/^\d{1,7}$/.test(s)) return null;
    r[evento] = Number(s);
  }
  return r;
}

/** O rótulo do evento ("S-2200 · Admissão"). */
export const rotuloEvento = (codigo: string) => {
  try {
    const d = definicaoEventoEsocial(codigo as EventoEsocial);
    return d ? `${codigo} · ${d.rotulo}` : codigo;
  } catch {
    return codigo;
  }
};

/** O código da recusa do eSocial (ou nulo para o erro genérico). */
export function codigoRecusa(e: unknown): string | null {
  return recusaDe(e)?.codigo ?? null;
}
