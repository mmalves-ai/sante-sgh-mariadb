// Regras de tela da notificação de incidentes (M48, etapa 1): montar a entrada do diálogo com o contrato (a mesma
// validação do servidor, para dizer o campo antes de enviar), a tela de origem sem query, o tempo até o prazo, o texto
// dos campos do Notivisa para copiar e o formato das datas. Sem Vue: testável à parte.
import {
  type CamposNotivisa,
  esquemaNotificarIncidente,
  type GrauDano,
  type NotificarIncidenteEntrada,
  type SituacaoNotificacao,
  type SituacaoPrazo,
  type TipoIncidente,
} from '@sgh/contratos';
import { mensagensQualidade } from './i18n.js';

/** O caminho da tela de origem como o contrato aceita (sem query nem fragmento; até 120 caracteres). */
export function telaDeOrigem(caminho: string): string {
  const semQuery = caminho.split(/[?#]/)[0] ?? '/';
  const limpo = semQuery.replace(/[^A-Za-z0-9/_:.-]/g, '-').slice(0, 120);
  return limpo.startsWith('/') ? limpo : `/${limpo}`.slice(0, 120);
}

/** "AAAA-MM-DD" + "HH:mm" → instante local "AAAA-MM-DDTHH:mm" (null se faltar um dos dois). */
export function instanteDosCampos(data: string | null, hora: string | null): string | null {
  if (!data || !hora || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  // O campo de hora devolve "HHMM" depois que o usuário edita (o formato do cadastro); "HH:MM" vem do relógio.
  if (/^\d{4}$/.test(hora)) return `${data}T${hora.slice(0, 2)}:${hora.slice(2)}`;
  return /^\d{2}:\d{2}/.test(hora) ? `${data}T${hora.slice(0, 5)}` : null;
}

export interface FormularioIncidente {
  readonly semPaciente: boolean;
  readonly unidade: number | null;
  readonly local: string;
  readonly data: string | null;
  readonly hora: string | null;
  readonly tipo: TipoIncidente | '';
  readonly tipoOutro: string;
  readonly chegouAoPaciente: 'sim' | 'nao' | '';
  readonly danoPercebido: GrauDano | '';
  readonly descricao: string;
  readonly anonima: boolean;
}

export type Montagem =
  | { readonly ok: true; readonly entrada: NotificarIncidenteEntrada }
  | { readonly ok: false; readonly campo: string; readonly mensagem: string };

/**
 * A entrada de `POST /qualidade/notificacoes` pelo contrato. Com o contexto da tela (e sem "sem paciente"), vai só o
 * ID do atendimento; sem ele, a unidade escolhida. Quem notifica sem identificação manda `anonima: true` e nada mais
 * muda na entrada (o servidor é quem deixa de gravar quem notificou).
 */
export function montarNotificacao(
  f: FormularioIncidente,
  contexto: { readonly atendimento: number } | null,
  caminho: string,
  sugestao?: string,
): Montagem {
  const comAtendimento = contexto !== null && !f.semPaciente;
  const bruto = {
    atendimento: comAtendimento ? contexto.atendimento : null,
    unidade: comAtendimento ? null : f.unidade,
    local: f.local.trim() ? f.local.trim() : null,
    ocorridoEm: instanteDosCampos(f.data, f.hora) ?? '',
    tipo: f.tipo,
    tipoOutro: f.tipo === 'outro' ? f.tipoOutro.trim() || null : null,
    chegouAoPaciente: f.chegouAoPaciente === 'sim',
    danoPercebido: f.chegouAoPaciente === 'nao' ? 'nenhum' : f.danoPercebido,
    descricao: f.descricao,
    anonima: f.anonima,
    origem: { tela: telaDeOrigem(caminho), ...(sugestao ? { sugestao } : {}) },
  };
  if (f.chegouAoPaciente === '')
    return {
      ok: false,
      campo: 'chegouAoPaciente',
      mensagem: mensagensQualidade.notificar.faltando.chegouAoPaciente,
    };
  const r = esquemaNotificarIncidente.safeParse(bruto);
  if (r.success) return { ok: true, entrada: r.data };
  const p = r.error.issues[0];
  const campo = String(p?.path[0] ?? 'descricao');
  return {
    ok: false,
    campo,
    mensagem: MENSAGEM_DO_CAMPO[campo] ?? p?.message ?? mensagensQualidade.notificar.faltando.geral,
  };
}

const MENSAGEM_DO_CAMPO: Readonly<Record<string, string>> = mensagensQualidade.notificar.faltando;

/** Minutos → "2 d 3 h", "5 h 10 min", "40 min" (o valor absoluto: o sinal diz se venceu). */
export function duracaoCurta(minutos: number): string {
  const m = Math.abs(Math.round(minutos));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return h > 0 ? `${String(d)} d ${String(h)} h` : `${String(d)} d`;
  if (h > 0) return min > 0 ? `${String(h)} h ${String(min)} min` : `${String(h)} h`;
  return `${String(min)} min`;
}

/** A classe visual da situação do prazo (vermelho, âmbar, neutro, verde). */
export function classeDoPrazo(s: SituacaoPrazo): string {
  return `prazo prazo--${s}`;
}

/** "AAAA-MM-DDTHH:mm[:ss]" → "DD/MM/AAAA HH:mm"; "AAAA-MM-DD" → "DD/MM/AAAA". */
export function dataHora(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso ?? '');
  if (!m) return '';
  const data = `${m[3]}/${m[2]}/${m[1]}`;
  return m[4] ? `${data} ${m[4]}:${m[5]}` : data;
}

/** "AAAA-MM-DD" daqui a n dias a partir do instante local (o prazo sugerido da análise). */
export function diasDepois(agora: string, dias: number): string {
  const [a, m, d] = agora.slice(0, 10).split('-').map(Number);
  const x = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (d ?? 1) + dias));
  return x.toISOString().slice(0, 10);
}

export type RotulosCampos = Readonly<Record<string, string>>;

/** As linhas "Rótulo: valor" dos campos do Notivisa, na ordem do formulário (o paciente só com iniciais, sexo e idade). */
export function linhasDosCampos(
  c: CamposNotivisa,
  rotulos: RotulosCampos,
  periodos: Readonly<Record<CamposNotivisa['periodo'], string>>,
  simNao: (b: boolean) => string,
): { chave: string; rotulo: string; valor: string }[] {
  const linhas: [string, string][] = [
    ['protocoloInterno', c.protocoloInterno],
    ['tipoIncidente', c.tipoIncidente],
    ['classificacao', c.classificacao],
    ['ocorridoEm', dataHora(c.ocorridoEm)],
    ['periodo', periodos[c.periodo]],
    ['unidade', c.unidade ?? '-'],
    ['local', c.local ?? '-'],
    ['dano', c.dano],
    ['obito', simNao(c.obito)],
    ['neverEvent', simNao(c.neverEvent)],
    ...(c.paciente
      ? ([
          ['iniciais', c.paciente.iniciais],
          ['sexo', c.paciente.sexo],
          ['idade', c.paciente.idade === null ? '-' : String(c.paciente.idade)],
        ] as [string, string][])
      : []),
    ['descricao', c.descricao],
  ];
  return linhas.map(([chave, valor]) => ({ chave, rotulo: rotulos[chave] ?? chave, valor }));
}

/** O texto para a área de transferência (uma linha por campo). */
export function textoParaCopiar(linhas: readonly { rotulo: string; valor: string }[]): string {
  return linhas.map((l) => `${l.rotulo}: ${l.valor}`).join('\n');
}

/** O que a tela do NSP oferece em cada situação (a mesma regra do fluxo do domínio; o servidor confere de novo). */
export function acoesDaSituacao(s: SituacaoNotificacao): {
  readonly triar: boolean;
  readonly distribuir: boolean;
  readonly devolver: boolean;
  readonly descartar: boolean;
  readonly notivisa: boolean;
} {
  return {
    triar: s === 'recebida' || s === 'triada' || s === 'distribuida',
    distribuir: s === 'triada' || s === 'distribuida',
    devolver: s !== 'recebida',
    descartar: s === 'recebida' || s === 'triada',
    notivisa: s !== 'recebida' && s !== 'descartada',
  };
}
