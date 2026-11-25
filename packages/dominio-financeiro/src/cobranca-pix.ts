// Cobrança Pix sobre o título a receber (F7, 07-FIN linha 90): regras puras, sem banco e sem HTTP.
// - O identificador da cobrança (txid) segue a API Pix padronizada do Banco Central: 26 a 35 caracteres alfanuméricos,
//   escolhido pelo recebedor (o mesmo PUT no prestador é idempotente pelo txid).
// - O "copia e cola" é o BR Code (padrão EMV do QR do Pix) com o CRC16-CCITT no fim; o QR dinâmico leva a localização
//   do payload, o estático leva a chave e o txid.
// - A cobrança nasce de uma parcela em aberto, pelo saldo ou por parte dele; a cobrança com vencimento exige o
//   documento do pagador e a data a partir de hoje; a imediata expira entre 1 minuto e 30 dias.
// - A notificação do prestador (webhook "pix") é conferida inteira antes de gravar; cada Pix é único pelo
//   identificador fim a fim, e a repetição não baixa de novo.
// - A baixa usa o saldo da parcela: o que passar dele fica como excedente, à espera de devolução.
// - A devolução (até 90 dias do pagamento, regra do arranjo) consome primeiro o excedente; o resto desfaz a baixa
//   pelo valor devolvido (a parcela volta a ter saldo).

export type ModalidadeCobrancaPix = 'imediata' | 'com_vencimento';

const TXID = /^[a-zA-Z0-9]{26,35}$/;
const FIM_A_FIM = /^[A-Z][0-9]{8}[0-9]{12}[a-zA-Z0-9]{11}$/;
const ALFANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const centavos = (v: number) => Math.round(v * 100) / 100;
const DIA_MS = 86_400_000;

/** Um txid de 32 caracteres a partir de bytes aleatórios (quem chama fornece os bytes, a regra fica pura). */
export function gerarTxid(bytes: Uint8Array): string {
  if (bytes.length < 32) throw new Error('São necessários 32 bytes para o txid.');
  let s = '';
  for (let i = 0; i < 32; i++) s += ALFANUM[(bytes[i] ?? 0) % ALFANUM.length];
  return s;
}
export const txidValido = (t: string): boolean => TXID.test(t);
export const fimAFimValido = (e: string): boolean => FIM_A_FIM.test(e);

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), em 4 dígitos hexadecimais maiúsculos, como pede o BR Code. */
export function crc16Pix(texto: string): string {
  let crc = 0xffff;
  for (const b of new TextEncoder().encode(texto)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;
/** Sem acento e só os caracteres que o BR Code aceita no nome e na cidade. */
const limpo = (s: string, max: number) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max) || 'NAO INFORMADO';

export interface DadosBrCode {
  /** QR dinâmico: localização do payload (sem o https://). */
  readonly localizacao?: string | null;
  /** QR estático: a chave Pix do recebedor. */
  readonly chave?: string | null;
  readonly valor?: number | null;
  readonly nomeRecebedor: string;
  readonly cidade: string;
  readonly txid?: string | null;
}

/** O "copia e cola" (BR Code) do Pix, com o CRC conferível. */
export function montarBrCodePix(d: DadosBrCode): string {
  if (!d.localizacao && !d.chave) throw new Error('O BR Code precisa da localização ou da chave.');
  const conta =
    campo('00', 'br.gov.bcb.pix') +
    (d.localizacao ? campo('25', d.localizacao) : campo('01', String(d.chave)));
  let s =
    campo('00', '01') +
    (d.localizacao ? campo('01', '12') : '') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    (d.valor && d.valor > 0 ? campo('54', centavos(d.valor).toFixed(2)) : '') +
    campo('58', 'BR') +
    campo('59', limpo(d.nomeRecebedor, 25)) +
    campo('60', limpo(d.cidade, 15)) +
    campo('62', campo('05', d.localizacao ? '***' : (d.txid ?? '***').slice(0, 25)));
  s += '6304';
  return s + crc16Pix(s);
}

/** Confere o CRC do BR Code (o leitor do banco recusa o que não fecha). */
export function brCodeConfere(codigo: string): boolean {
  return (
    codigo.length > 8 && codigo.slice(-8, -4) === '6304' && crc16Pix(codigo.slice(0, -4)) === codigo.slice(-4)
  );
}

// ── Emissão ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PedidoCobrancaPix {
  readonly modalidade: ModalidadeCobrancaPix;
  readonly valor: number;
  readonly saldoParcela: number;
  readonly situacaoParcela: string;
  readonly hoje: string;
  readonly vencimento?: string | null;
  readonly validadeSegundos?: number | null;
  readonly pagadorDocumento?: string | null;
  readonly cobrancaAtivaNaParcela: boolean;
  readonly chaveAtiva: boolean;
}
export type ConferenciaCobrancaPix =
  | { readonly ok: true }
  | { readonly ok: false; readonly codigo: string; readonly mensagem: string; readonly campo: string };
const recusada = (codigo: string, campo: string, mensagem: string): ConferenciaCobrancaPix => ({
  ok: false,
  codigo,
  campo,
  mensagem,
});

export const VALIDADE_PADRAO_SEGUNDOS = 86_400;

/** Confere o pedido de cobrança Pix antes de ir ao prestador; a mensagem é a da tela, na hora. */
export function conferirCobrancaPix(p: PedidoCobrancaPix): ConferenciaCobrancaPix {
  if (!['aberta', 'parcial'].includes(p.situacaoParcela) || p.saldoParcela <= 0)
    return recusada('parcela-sem-saldo', 'parcela', 'A parcela não tem saldo em aberto para cobrar.');
  if (p.cobrancaAtivaNaParcela)
    return recusada(
      'cobranca-ativa',
      'parcela',
      'A parcela já tem uma cobrança Pix ativa: use a mesma ou cancele antes de gerar outra.',
    );
  if (!p.chaveAtiva) return recusada('chave-inativa', 'chave', 'Escolha uma chave Pix ativa da conta.');
  if (!(p.valor > 0)) return recusada('valor-invalido', 'valor', 'O valor da cobrança tem de ser positivo.');
  if (centavos(p.valor) > centavos(p.saldoParcela))
    return recusada('valor-acima-saldo', 'valor', 'O valor da cobrança não pode passar do saldo da parcela.');
  if (p.modalidade === 'com_vencimento') {
    if (!p.vencimento || p.vencimento < p.hoje)
      return recusada(
        'vencimento-invalido',
        'vencimento',
        'O vencimento da cobrança tem de ser de hoje em diante.',
      );
    const doc = (p.pagadorDocumento ?? '').replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14)
      return recusada(
        'pagador-sem-documento',
        'parcela',
        'A cobrança com vencimento exige o CPF ou o CNPJ do pagador no título.',
      );
  } else {
    const v = p.validadeSegundos ?? VALIDADE_PADRAO_SEGUNDOS;
    if (!Number.isInteger(v) || v < 60 || v > 30 * 86_400)
      return recusada(
        'validade-invalida',
        'validade',
        'A validade da cobrança imediata vai de 1 minuto a 30 dias.',
      );
  }
  return { ok: true };
}

/** A cobrança imediata ativa passa a expirada depois da validade (a leitura mostra assim; a gravação também). */
export function cobrancaExpirada(
  c: { situacao: string; modalidade: ModalidadeCobrancaPix; criadaEm: Date; validadeSegundos: number | null },
  agora: Date,
): boolean {
  return (
    c.situacao === 'ativa' &&
    c.modalidade === 'imediata' &&
    agora.getTime() > c.criadaEm.getTime() + (c.validadeSegundos ?? VALIDADE_PADRAO_SEGUNDOS) * 1000
  );
}

// ── Retorno (notificação do prestador) ───────────────────────────────────────────────────────────────────────────

export interface PixRecebido {
  readonly fimAFim: string;
  readonly txid: string;
  readonly valor: number;
  readonly pagoEm: string;
  readonly pagadorNome: string | null;
  readonly pagadorCpf: string | null;
  readonly pagadorCnpj: string | null;
}
export type NotificacaoLida =
  | { readonly ok: true; readonly pix: readonly PixRecebido[] }
  | { readonly ok: false; readonly mensagem: string };

const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Lê a notificação no formato da API Pix ({ pix: [{ endToEndId, txid, valor, horario, pagador? }] }), inteira. */
export function lerNotificacaoPix(corpo: unknown): NotificacaoLida {
  const raiz = obj(corpo);
  const lista = raiz?.['pix'];
  if (!Array.isArray(lista) || lista.length === 0)
    return { ok: false, mensagem: 'A notificação não traz a lista de Pix recebidos.' };
  if (lista.length > 1000) return { ok: false, mensagem: 'A notificação passa de 1000 Pix.' };
  const pix: PixRecebido[] = [];
  const vistos = new Set<string>();
  for (const [i, bruto] of lista.entries()) {
    const p = obj(bruto);
    const n = i + 1;
    if (!p) return { ok: false, mensagem: `O Pix ${n} não é um objeto.` };
    const e2e = String(p['endToEndId'] ?? '');
    const txid = String(p['txid'] ?? '');
    const valor = Number(String(p['valor'] ?? ''));
    const horario = new Date(String(p['horario'] ?? ''));
    if (!fimAFimValido(e2e))
      return { ok: false, mensagem: `O Pix ${n} não tem identificador fim a fim válido.` };
    if (!txidValido(txid)) return { ok: false, mensagem: `O Pix ${n} não tem txid válido.` };
    if (!/^\d{1,10}\.\d{2}$/.test(String(p['valor'] ?? '')) || !(valor > 0))
      return { ok: false, mensagem: `O Pix ${n} não tem valor válido (formato 0.00).` };
    if (Number.isNaN(horario.getTime())) return { ok: false, mensagem: `O Pix ${n} não tem horário válido.` };
    if (vistos.has(e2e)) continue;
    vistos.add(e2e);
    const pag = obj(p['pagador']);
    const cpf = String(pag?.['cpf'] ?? '').replace(/\D/g, '');
    const cnpj = String(pag?.['cnpj'] ?? '').replace(/\D/g, '');
    pix.push({
      fimAFim: e2e,
      txid,
      valor: centavos(valor),
      pagoEm: horario.toISOString(),
      pagadorNome: pag?.['nome'] ? String(pag['nome']).slice(0, 150) : null,
      pagadorCpf: cpf.length === 11 ? cpf : null,
      pagadorCnpj: cnpj.length === 14 ? cnpj : null,
    });
  }
  return { ok: true, pix };
}

export type PlanoBaixaPix =
  | { readonly acao: 'repetido' }
  | {
      readonly acao: 'registrar';
      /** Parte que baixa a parcela (0 quando nada há a baixar). */
      readonly principal: number;
      /** O que passou do saldo, à espera de devolução. */
      readonly excedente: number;
      readonly saldoRestante: number;
      readonly quitada: boolean;
      readonly situacaoRetorno: 'baixado' | 'recebido';
      readonly concluiCobranca: boolean;
      readonly aviso: string | null;
    };

/** O que fazer com um Pix recebido para a cobrança: baixar a parcela pelo saldo e guardar o excedente. */
export function planejarBaixaPix(e: {
  readonly fimAFimJaRegistrado: boolean;
  readonly situacaoCobranca: string;
  readonly fimAFimDaCobranca: string | null;
  readonly valorPago: number;
  readonly saldoParcela: number;
  readonly situacaoParcela: string;
}): PlanoBaixaPix {
  if (e.fimAFimJaRegistrado) return { acao: 'repetido' };
  const segundo =
    e.situacaoCobranca === 'concluida' || e.situacaoCobranca === 'devolvida' || !!e.fimAFimDaCobranca;
  const podeBaixar = !segundo && ['aberta', 'parcial'].includes(e.situacaoParcela) && e.saldoParcela > 0;
  const principal = podeBaixar ? centavos(Math.min(e.valorPago, e.saldoParcela)) : 0;
  const excedente = centavos(e.valorPago - principal);
  const saldoRestante = centavos(Math.max(0, e.saldoParcela - principal));
  let aviso: string | null = null;
  if (segundo) aviso = 'Pagamento em duplicidade da mesma cobrança: devolva ao pagador.';
  else if (principal === 0) aviso = 'A parcela já não tinha saldo: o valor ficou para devolução.';
  else if (excedente > 0) aviso = `Pago acima do saldo: ${excedente.toFixed(2)} ficou para devolução.`;
  return {
    acao: 'registrar',
    principal,
    excedente,
    saldoRestante: podeBaixar ? saldoRestante : e.saldoParcela,
    quitada: podeBaixar && saldoRestante === 0,
    situacaoRetorno: principal > 0 ? 'baixado' : 'recebido',
    concluiCobranca: !segundo,
    aviso,
  };
}

// ── Devolução ────────────────────────────────────────────────────────────────────────────────────────────────────

export const PRAZO_DEVOLUCAO_DIAS = 90;
export const MOTIVOS_DEVOLUCAO_PIX = {
  MD06: 'Devolução solicitada pelo pagador',
  BE08: 'Erro do recebedor',
  FR01: 'Fraude',
  SL02: 'Pagamento em duplicidade ou acima do devido',
} as const;
export type MotivoDevolucaoPix = keyof typeof MOTIVOS_DEVOLUCAO_PIX;

export type PlanoDevolucaoPix =
  | { readonly ok: false; readonly codigo: string; readonly mensagem: string; readonly campo: string }
  | {
      readonly ok: true;
      /** Quanto do pedido sai do excedente (não mexe na parcela). */
      readonly doExcedente: number;
      /** Quanto desfaz a baixa da parcela (volta ao saldo). */
      readonly reverteBaixa: number;
      /** A baixa que continua valendo depois da devolução. */
      readonly principalRestante: number;
      readonly devolvidoTotal: number;
      readonly total: boolean;
    };

/** Confere e reparte a devolução: primeiro o excedente, depois a parte que baixou a parcela. */
export function planejarDevolucaoPix(e: {
  readonly valorPago: number;
  /** Quanto do Pix baixa a parcela hoje (o recebimento em vigor). */
  readonly principalAtual: number;
  readonly jaDevolvido: number;
  readonly pedido: number;
  readonly pagoEm: string;
  readonly hoje: string;
}): PlanoDevolucaoPix {
  const disponivel = centavos(e.valorPago - e.jaDevolvido);
  if (!(e.pedido > 0))
    return { ok: false, codigo: 'valor-invalido', campo: 'valor', mensagem: 'Informe o valor a devolver.' };
  if (centavos(e.pedido) > disponivel)
    return {
      ok: false,
      codigo: 'valor-acima-disponivel',
      campo: 'valor',
      mensagem: `O valor passa do que ainda pode ser devolvido (${disponivel.toFixed(2)}).`,
    };
  const dias = Math.floor(
    (Date.parse(`${e.hoje}T00:00:00Z`) - Date.parse(`${e.pagoEm.slice(0, 10)}T00:00:00Z`)) / DIA_MS,
  );
  if (dias > PRAZO_DEVOLUCAO_DIAS)
    return {
      ok: false,
      codigo: 'prazo-devolucao',
      campo: 'valor',
      mensagem: `A devolução Pix vale até ${PRAZO_DEVOLUCAO_DIAS} dias do pagamento; faça a devolução por transferência.`,
    };
  // pago = baixa em vigor + já devolvido + excedente livre
  const excedenteLivre = centavos(Math.max(0, e.valorPago - e.jaDevolvido - e.principalAtual));
  const doExcedente = centavos(Math.min(e.pedido, excedenteLivre));
  const reverteBaixa = centavos(e.pedido - doExcedente);
  const principalAtual = e.principalAtual;
  const devolvidoTotal = centavos(e.jaDevolvido + e.pedido);
  return {
    ok: true,
    doExcedente,
    reverteBaixa,
    principalRestante: centavos(principalAtual - reverteBaixa),
    devolvidoTotal,
    total: devolvidoTotal === centavos(e.valorPago),
  };
}
