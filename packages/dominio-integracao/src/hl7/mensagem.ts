// HL7 v2 das integrações novas (M34; ficha, regra 12; cap-12 §12.2): o pedido ao laboratório de apoio (ORM^O01), a
// leitura do resultado que volta (ORU^R01), o ACK e o enquadramento MLLP do motor de integração. A mensagem leva o
// dado do paciente porque o parceiro precisa dele; ela só existe em trânsito e no S3 (conteúdo bruto com o resumo),
// nunca em log, trace ou tabela SGH_ (cap-14 §14.2.8). Versão 2.5; separadores padrão |^~\&.

export const SEPARADORES = {
  campo: '|',
  componente: '^',
  repeticao: '~',
  escape: '\\',
  subcomponente: '&',
} as const;
export const VERSAO_HL7 = '2.5';
export const FIM_SEGMENTO = '\r';

/** Escapa o texto do campo (os separadores viram as sequências \F\ \S\ \R\ \T\ \E\; quebras de linha somem). */
export function escapar(texto: string): string {
  return texto
    .replace(/\\/g, '\\E\\')
    .replace(/\|/g, '\\F\\')
    .replace(/\^/g, '\\S\\')
    .replace(/~/g, '\\R\\')
    .replace(/&/g, '\\T\\')
    .replace(/[\r\n]+/g, ' ');
}

export function desescapar(texto: string): string {
  return texto.replace(/\\([FSRTE])\\/g, (_m, c: string) =>
    c === 'F' ? '|' : c === 'S' ? '^' : c === 'R' ? '~' : c === 'T' ? '&' : '\\',
  );
}

/** Data e hora HL7 (AAAAMMDDHHMMSS) do relógio de parede (o Date carrega a hora local nos campos UTC). */
export function dataHl7(d: Date): string {
  const p = (n: number, t = 2) => String(n).padStart(t, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function lerDataHl7(v: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?/.exec(v);
  if (!m) return null;
  const d = new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    ),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

type Componente = string | null | undefined;
/** Campo com componentes (já escapados um a um). */
const comp = (...c: Componente[]) =>
  c
    .map((x) => (x === null || x === undefined ? '' : escapar(String(x))))
    .join(SEPARADORES.componente)
    .replace(/\^+$/, '');

function segmento(nome: string, campos: readonly string[]): string {
  return [nome, ...campos].join(SEPARADORES.campo).replace(/\|+$/, '');
}

export interface Cabecalho {
  readonly aplicacaoOrigem: string;
  readonly instituicaoOrigem: string;
  readonly aplicacaoDestino: string;
  readonly instituicaoDestino: string;
  readonly dataHora: Date;
  /** MSH-10: identificador único da mensagem (o parceiro deduplica por ele). */
  readonly controle: string;
  /** P produção, T teste (fora de produção, sempre T). */
  readonly processamento: 'P' | 'T';
}

function msh(c: Cabecalho, tipo: string): string {
  if (!/^[A-Za-z0-9._:-]{1,20}$/.test(c.controle))
    throw new Error('MSH-10 fora do formato (até 20 caracteres).');
  return segmento('MSH', [
    '^~\\&',
    comp(c.aplicacaoOrigem),
    comp(c.instituicaoOrigem),
    comp(c.aplicacaoDestino),
    comp(c.instituicaoDestino),
    dataHl7(c.dataHora),
    '',
    tipo,
    c.controle,
    c.processamento,
    VERSAO_HL7,
  ]);
}

export interface PedidoApoio {
  readonly cabecalho: Cabecalho;
  readonly paciente: {
    readonly id: number;
    readonly prontuario: number | null;
    readonly nome: string;
    readonly nascimento: Date | null;
    readonly sexo: 'M' | 'F' | 'U';
  };
  readonly atendimento: { readonly numero: number; readonly classe: 'I' | 'O' | 'E' };
  /** O exame do pedido (SILANEXA.ID: o identificador do pedido no Sante SGH e no outro sistema). */
  readonly pedido: number;
  readonly exame: { readonly codigo: string; readonly nome: string; readonly material: string | null };
  readonly solicitadoEm: Date;
  readonly urgente: boolean;
}

/** ORM^O01: o pedido ao laboratório de apoio, com o exame no código do laboratório (de-para do estabelecimento). */
export function montarPedidoApoio(p: PedidoApoio): string {
  const [sobrenome, ...nomes] = p.paciente.nome.trim().split(/\s+/).reverse();
  const segmentos = [
    msh(p.cabecalho, 'ORM^O01^ORM_O01'),
    segmento('PID', [
      '1',
      '',
      comp(String(p.paciente.id), null, null, null, 'PI'),
      '',
      comp(sobrenome ?? '', nomes.reverse().join(' ')),
      '',
      p.paciente.nascimento ? dataHl7(p.paciente.nascimento).slice(0, 8) : '',
      p.paciente.sexo,
    ]),
    segmento('PV1', ['1', p.atendimento.classe, ...Array<string>(16).fill(''), String(p.atendimento.numero)]),
    segmento('ORC', [
      'NW',
      String(p.pedido),
      '',
      '',
      '',
      '',
      comp(null, null, null, null, null, p.urgente ? 'S' : 'R'),
      '',
      dataHl7(p.solicitadoEm),
    ]),
    segmento('OBR', [
      '1',
      String(p.pedido),
      '',
      comp(p.exame.codigo, p.exame.nome),
      p.urgente ? 'S' : 'R',
      dataHl7(p.solicitadoEm),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      comp(p.exame.material ?? ''),
    ]),
  ];
  return segmentos.join(FIM_SEGMENTO) + FIM_SEGMENTO;
}

export interface MensagemLida {
  readonly segmentos: readonly { readonly nome: string; readonly campos: readonly string[] }[];
  readonly tipo: string;
  readonly controle: string;
  readonly processamento: string;
}

/** Lê a mensagem em segmentos e campos (o MSH-1 é o próprio separador: o MSH-2 fica no índice 1). */
export function lerMensagem(texto: string): MensagemLida {
  const linhas = texto
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!linhas[0]?.startsWith('MSH|')) throw new Error('Mensagem HL7 sem o MSH no início.');
  const segmentos = linhas.map((l) => {
    const partes = l.split(SEPARADORES.campo);
    const nome = partes[0] ?? '';
    // MSH: o campo 1 é o separador; MSH-2 (codificação) é partes[1].
    const campos = nome === 'MSH' ? ['|', ...partes.slice(1)] : partes.slice(1);
    return { nome, campos };
  });
  const m = segmentos[0]!.campos;
  return { segmentos, tipo: m[8] ?? '', controle: m[9] ?? '', processamento: m[10] ?? '' };
}

/** Campo N (1-based) do segmento; componente C (1-based) opcional. */
export function campo(s: { readonly campos: readonly string[] }, n: number, c?: number): string {
  const v = s.campos[n - 1] ?? '';
  if (c === undefined) return desescapar(v);
  return desescapar(v.split(SEPARADORES.componente)[c - 1] ?? '');
}

export interface ResultadoApoioLido {
  readonly controle: string;
  readonly pedido: number | null;
  readonly exameLaboratorio: string;
  readonly protocolo: string;
  readonly valores: readonly {
    readonly codigo: string;
    readonly nome: string;
    readonly tipo: string;
    readonly valor: string;
    readonly unidade: string;
    readonly referencia: string;
    readonly situacao: string;
  }[];
  readonly observacoes: readonly string[];
}

/** ORU^R01: o resultado do laboratório de apoio (OBR com o pedido, OBX com os valores, NTE com as observações). */
export function lerResultadoApoio(texto: string): ResultadoApoioLido {
  const m = lerMensagem(texto);
  if (!m.tipo.startsWith('ORU^R01')) throw new Error(`Mensagem ${m.tipo || 'sem tipo'}: esperado ORU^R01.`);
  if (!m.controle) throw new Error('Mensagem sem o MSH-10 (a chave do parceiro).');
  const obr = m.segmentos.find((s) => s.nome === 'OBR');
  if (!obr) throw new Error('Resultado sem o OBR.');
  const pedido = Number(campo(obr, 2));
  return {
    controle: m.controle,
    pedido: Number.isSafeInteger(pedido) && pedido > 0 ? pedido : null,
    exameLaboratorio: campo(obr, 4, 1),
    protocolo: campo(obr, 3) || m.controle,
    valores: m.segmentos
      .filter((s) => s.nome === 'OBX')
      .map((s) => ({
        codigo: campo(s, 3, 1),
        nome: campo(s, 3, 2),
        tipo: campo(s, 2),
        valor: campo(s, 5),
        unidade: campo(s, 6, 1),
        referencia: campo(s, 7),
        situacao: campo(s, 11),
      })),
    observacoes: m.segmentos.filter((s) => s.nome === 'NTE').map((s) => campo(s, 3)),
  };
}

/** ACK de uma mensagem recebida: AA aceita, AE erro, AR recusada (MSA-2 = o MSH-10 da original). */
export function montarAck(
  original: MensagemLida,
  codigo: 'AA' | 'AE' | 'AR',
  texto: string,
  c: Omit<Cabecalho, 'controle'> & { readonly controle: string },
): string {
  return (
    [
      msh(c, `ACK^${original.tipo.split('^')[1] ?? ''}^ACK`),
      segmento('MSA', [codigo, original.controle, escapar(texto).slice(0, 80)]),
    ].join(FIM_SEGMENTO) + FIM_SEGMENTO
  );
}

export function lerAck(texto: string): { codigo: string; controle: string; texto: string } {
  const m = lerMensagem(texto);
  const msa = m.segmentos.find((s) => s.nome === 'MSA');
  if (!msa) throw new Error('ACK sem o MSA.');
  return { codigo: campo(msa, 1), controle: campo(msa, 2), texto: campo(msa, 3) };
}

// ── MLLP (Minimal Lower Layer Protocol) ─────────────────────────────────────────────────────────────

const INICIO = 0x0b;
const FIM = [0x1c, 0x0d] as const;

export function emMllp(mensagem: string): Uint8Array {
  const corpo = new TextEncoder().encode(mensagem);
  const r = new Uint8Array(corpo.length + 3);
  r[0] = INICIO;
  r.set(corpo, 1);
  r[corpo.length + 1] = FIM[0];
  r[corpo.length + 2] = FIM[1];
  return r;
}

/** Separa as mensagens completas de um fluxo MLLP; o que sobra (mensagem incompleta) volta em `resto`. */
export function deMllp(dados: Uint8Array): { mensagens: string[]; resto: Uint8Array } {
  const mensagens: string[] = [];
  let i = 0;
  for (;;) {
    const ini = dados.indexOf(INICIO, i);
    if (ini < 0) return { mensagens, resto: new Uint8Array(0) };
    let fim = -1;
    for (let k = ini + 1; k < dados.length - 1; k++)
      if (dados[k] === FIM[0] && dados[k + 1] === FIM[1]) {
        fim = k;
        break;
      }
    if (fim < 0) return { mensagens, resto: dados.slice(ini) };
    mensagens.push(new TextDecoder().decode(dados.slice(ini + 1, fim)));
    i = fim + 2;
  }
}
