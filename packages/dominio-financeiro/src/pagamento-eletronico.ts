// Pagamento eletrônico a credores (F3.8, 07-FIN linha 66): o que o financeiro faz com cada linha do retorno do banco
// diante das parcelas enviadas na remessa, a remessa de pagamento por Pix (CNAB 240, segmentos A e B) e a conferência
// dos dados bancários e da chave Pix do credor antes de entrarem no cadastro. Regras puras: quem grava é a porta.
// Retorno: só baixa a parcela que foi enviada nesta remessa, ainda aguarda resposta e continua em aberto. Linha de
// título que não está na remessa fica registrada como não localizada; pagamento repetido de parcela já respondida ou
// já quitada vira informativo (nunca duas baixas). Pago a menor baixa só o que o banco pagou e a parcela continua com
// saldo; pago a maior quita a parcela e a diferença vai como acréscimo da baixa. Rejeitado devolve a parcela à fila com
// o motivo do banco; agendado continua aguardando o retorno seguinte.
import { centavos } from '@sgh/contratos/regras-financeiro';
import { cnpjValido, cpfValido, somenteDigitos } from '@sgh/contratos';
import { conferirChavePix, type TipoChavePix } from './chave-pix.js';
import type { OcorrenciaRetorno, RetornoLido } from './retorno-pagamento.js';

// ── Retorno do banco diante da remessa ──────────────────────────────────────────────────────────────────────────

/** A parcela enviada na remessa, como está agora no banco de dados. */
export interface ParcelaEnviada {
  /** O número enviado ao banco como "seu número": o id da parcela a pagar. */
  readonly parcela: number;
  /** Situação do vínculo da parcela com a remessa. */
  readonly vinculo: 'pendente' | 'retornada' | 'rejeitada';
  readonly valorEnviado: number;
  /** Saldo em aberto da parcela; zero quando já quitada por outra via. */
  readonly saldo: number;
}

export type SituacaoItemRetorno = 'liquidado' | 'agendado' | 'rejeitado' | 'informativo' | 'nao_localizado';

export interface ItemRetornoPlanejado {
  readonly titulo: number;
  readonly situacao: SituacaoItemRetorno;
  /** Primeiro código de ocorrência da linha e os demais. */
  readonly codigo: string;
  readonly complementares: readonly string[];
  readonly motivo: string;
  readonly dataPagamento: string | null;
  readonly valorEnviado: number | null;
  readonly valorEfetivado: number | null;
  /** A baixa a gravar (só no liquidado): principal abatido do saldo, acréscimo pago a maior e o saldo que sobra. */
  readonly baixa: {
    readonly principal: number;
    readonly acrescimo: number;
    readonly saldoRestante: number;
  } | null;
  /** A situação nova do vínculo da parcela com a remessa; null quando o vínculo não muda. */
  readonly vinculoNovo: 'retornada' | 'rejeitada' | null;
}

export interface RetornoPlanejado {
  readonly itens: readonly ItemRetornoPlanejado[];
  readonly baixados: number;
  readonly rejeitados: number;
  readonly agendados: number;
  readonly naoLocalizados: number;
  readonly informativos: number;
  /** Soma do que foi efetivamente baixado (principal mais acréscimo), com as parcelas em `itens`. */
  readonly totalBaixado: number;
  /** Parcelas da remessa que continuam aguardando resposta depois deste retorno. */
  readonly pendentes: number;
  /** processada: tudo respondido; aceita: ainda há parcela aguardando; rejeitada: tudo respondido e nada pago. */
  readonly situacaoRemessa: 'processada' | 'aceita' | 'rejeitada';
}

function planejarItem(
  o: OcorrenciaRetorno,
  p: ParcelaEnviada | undefined,
  dataPadrao: string,
): ItemRetornoPlanejado {
  const [codigo = '', ...complementares] = o.ocorrencias;
  const base = {
    titulo: o.titulo,
    codigo: codigo || '--',
    complementares,
    dataPagamento: o.dataPagamento,
    valorEnviado: p ? p.valorEnviado : null,
    valorEfetivado: null,
    baixa: null,
    vinculoNovo: null,
  } as const;
  if (!p)
    return {
      ...base,
      situacao: 'nao_localizado',
      motivo: `O título ${o.titulo} não foi enviado nesta remessa (${o.motivo}).`,
    };
  if (p.vinculo !== 'pendente')
    return {
      ...base,
      situacao: 'informativo',
      motivo: `A parcela já tinha resposta do banco nesta remessa (${o.motivo}).`,
    };
  if (o.desfecho === 'agendado') return { ...base, situacao: 'agendado', motivo: o.motivo };
  if (o.desfecho === 'rejeitado')
    return { ...base, situacao: 'rejeitado', motivo: o.motivo, vinculoNovo: 'rejeitada' };
  // Pago pelo banco: parcela já quitada por outra via não recebe segunda baixa, mas a resposta fica registrada.
  if (!(p.saldo > 0) || !(o.valorPago > 0))
    return {
      ...base,
      situacao: 'informativo',
      valorEfetivado: o.valorPago,
      vinculoNovo: 'retornada',
      motivo:
        'O banco pagou, mas a parcela já estava quitada por outra via: confira o pagamento em duplicidade.',
    };
  const principal = centavos(Math.min(o.valorPago, p.saldo));
  return {
    ...base,
    situacao: 'liquidado',
    motivo: o.motivo,
    dataPagamento: o.dataPagamento ?? dataPadrao,
    valorEfetivado: o.valorPago,
    baixa: {
      principal,
      acrescimo: centavos(Math.max(0, o.valorPago - p.saldo)),
      saldoRestante: centavos(p.saldo - principal),
    },
    vinculoNovo: 'retornada',
  };
}

/**
 * Cruza o retorno lido com as parcelas da remessa. `dataPadrao` (hoje) só vale quando o banco confirma o pagamento sem
 * informar a data. Não recusa: cada linha do arquivo vira um item com o que fazer, e o resumo fecha com os itens.
 */
export function planejarRetorno(
  parcelas: readonly ParcelaEnviada[],
  lido: RetornoLido,
  dataPadrao: string,
): RetornoPlanejado {
  const porId = new Map(parcelas.map((p) => [p.parcela, p]));
  const itens = lido.titulos.map((o) => planejarItem(o, porId.get(o.titulo), dataPadrao));
  const conta = (s: SituacaoItemRetorno) => itens.filter((i) => i.situacao === s).length;
  const respondidas = new Set(itens.filter((i) => i.vinculoNovo !== null).map((i) => i.titulo));
  const pendentes = parcelas.filter((p) => p.vinculo === 'pendente' && !respondidas.has(p.parcela)).length;
  const baixados = conta('liquidado');
  const jaPagas = parcelas.some((p) => p.vinculo === 'retornada');
  return {
    itens,
    baixados,
    rejeitados: conta('rejeitado'),
    agendados: conta('agendado'),
    naoLocalizados: conta('nao_localizado'),
    informativos: conta('informativo'),
    totalBaixado: centavos(
      itens.reduce((s, i) => s + (i.baixa ? i.baixa.principal + i.baixa.acrescimo : 0), 0),
    ),
    pendentes,
    situacaoRemessa:
      pendentes > 0
        ? 'aceita'
        : baixados > 0 || jaPagas || itens.some((i) => i.vinculoNovo === 'retornada')
          ? 'processada'
          : 'rejeitada',
  };
}

// ── Dados bancários e chave Pix do credor ───────────────────────────────────────────────────────────────────────

export const TIPOS_CONTA_CREDOR = ['corrente', 'poupanca', 'pagamento', 'salario'] as const;
export type TipoContaCredor = (typeof TIPOS_CONTA_CREDOR)[number];

export interface ContaCredorEntrada {
  readonly titularNome: string;
  readonly titularDocumento: string;
  readonly tipoConta: TipoContaCredor;
  /** Conta em banco: os três juntos ou nenhum. */
  readonly banco: number | null;
  readonly agencia: string;
  readonly digitoAgencia: string;
  readonly conta: string;
  readonly digitoConta: string;
  readonly tipoChavePix: TipoChavePix | null;
  readonly chavePix: string;
}

export interface ContaCredorConferida {
  readonly titularNome: string;
  readonly titularDocumento: string;
  readonly tipoConta: TipoContaCredor;
  readonly banco: number | null;
  readonly agencia: string | null;
  readonly digitoAgencia: string | null;
  readonly conta: string | null;
  readonly digitoConta: string | null;
  readonly tipoChavePix: TipoChavePix | null;
  readonly chavePix: string | null;
}

export interface RecusaPagamentoEletronico {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos?: readonly string[];
}

const recusaConta = (codigo: string, mensagem: string, campos: string[]): RecusaPagamentoEletronico => ({
  codigo,
  mensagem,
  campos,
});

/**
 * Confere os dados bancários do credor e devolve a forma gravada: documento do titular só com dígitos, agência e conta
 * só com dígitos, chave Pix na forma canônica. Exige um destino completo (banco, agência e conta, ou a chave Pix) e,
 * quando a chave é CPF ou CNPJ, que seja o documento do titular (chave de documento alheio é o desvio mais comum).
 */
export function conferirContaCredor(e: ContaCredorEntrada): ContaCredorConferida | RecusaPagamentoEletronico {
  const titularNome = e.titularNome.trim();
  if (titularNome.length < 3)
    return recusaConta('titular-invalido', 'Informe o nome do titular da conta.', ['titularNome']);
  const documento = somenteDigitos(e.titularDocumento);
  const documentoOk =
    (documento.length === 11 && cpfValido(documento)) || (documento.length === 14 && cnpjValido(documento));
  if (!documentoOk)
    return recusaConta('documento-invalido', 'O CPF ou CNPJ do titular não é válido.', ['titularDocumento']);
  const agencia = somenteDigitos(e.agencia);
  const conta = somenteDigitos(e.conta);
  const algumDadoDeBanco = e.banco !== null || agencia.length > 0 || conta.length > 0;
  const bancoCompleto = e.banco !== null && agencia.length > 0 && conta.length > 0;
  if (algumDadoDeBanco && !bancoCompleto)
    return recusaConta(
      'conta-incompleta',
      'Informe o banco, a agência e a conta, ou deixe os três em branco.',
      ['banco', 'agencia', 'conta'],
    );
  if (agencia.length > 10 || conta.length > 20)
    return recusaConta('conta-invalida', 'A agência tem até 10 dígitos e a conta, até 20.', [
      'agencia',
      'conta',
    ]);
  const digito = (v: string) => v.trim().toUpperCase();
  if (!/^[0-9X]{0,2}$/.test(digito(e.digitoAgencia)) || !/^[0-9X]{0,2}$/.test(digito(e.digitoConta)))
    return recusaConta('digito-invalido', 'O dígito tem até 2 caracteres: números ou X.', [
      'digitoAgencia',
      'digitoConta',
    ]);
  let tipoChavePix: TipoChavePix | null = null;
  let chavePix: string | null = null;
  if (e.tipoChavePix !== null || e.chavePix.trim().length > 0) {
    if (e.tipoChavePix === null)
      return recusaConta('chave-pix-invalida', 'Escolha o tipo da chave Pix.', ['tipoChavePix']);
    const c = conferirChavePix(e.tipoChavePix, e.chavePix);
    if (!c.ok) return recusaConta('chave-pix-invalida', c.mensagem, ['chavePix']);
    if ((c.tipo === 'cpf' || c.tipo === 'cnpj') && c.chave !== documento)
      return recusaConta(
        'chave-pix-de-outro-titular',
        'A chave Pix de CPF ou CNPJ tem de ser o documento do titular informado.',
        ['chavePix', 'titularDocumento'],
      );
    tipoChavePix = c.tipo;
    chavePix = c.chave;
  }
  if (!bancoCompleto && chavePix === null)
    return recusaConta('sem-destino', 'Informe a conta em banco ou a chave Pix do credor.', [
      'banco',
      'chavePix',
    ]);
  return {
    titularNome: titularNome.slice(0, 150),
    titularDocumento: documento,
    tipoConta: e.tipoConta,
    banco: bancoCompleto ? e.banco : null,
    agencia: bancoCompleto ? agencia : null,
    digitoAgencia: bancoCompleto && digito(e.digitoAgencia) ? digito(e.digitoAgencia) : null,
    conta: bancoCompleto ? conta : null,
    digitoConta: bancoCompleto && digito(e.digitoConta) ? digito(e.digitoConta) : null,
    tipoChavePix,
    chavePix,
  };
}

/** Mostra só o fim do dado bancário ou da chave (lista do cadastro): "••••1234". */
export function mascararDadoBancario(v: string | null): string | null {
  if (v === null || v.length === 0) return null;
  return v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;
}

// ── Remessa de pagamento por Pix (CNAB 240, segmentos A e B) ────────────────────────────────────────────────────

export interface TituloRemessaPix {
  readonly titulo: number;
  readonly valor: number;
  /** Data do pagamento pedida ao banco (AAAA-MM-DD). */
  readonly dataPagamento: string;
  readonly favorecido: string;
  /** CPF ou CNPJ do favorecido, só dígitos. */
  readonly documento: string;
  readonly tipoChavePix: TipoChavePix | null;
  readonly chavePix: string | null;
}

/** Forma de iniciação do Pix no segmento B (padrão FEBRABAN): telefone, e-mail, CPF ou CNPJ, chave aleatória. */
const INICIACAO_PIX: Readonly<Record<TipoChavePix, string>> = {
  telefone: '01',
  email: '02',
  cpf: '03',
  cnpj: '03',
  aleatoria: '04',
};
/** Câmara centralizadora do Pix e forma de lançamento "Pix transferência" no cabeçalho do lote. */
const CAMARA_PIX = '009';
const LANCAMENTO_PIX = '45';

/** Monta uma linha de 240 posições a partir dos campos (posição inicial contada de 1). */
function linha240(campos: readonly (readonly [number, string])[]): string {
  const l = Array.from({ length: 240 }, () => ' ');
  for (const [de, v] of campos) for (let i = 0; i < v.length && de - 1 + i < 240; i++) l[de - 1 + i] = v[i]!;
  return l.join('');
}
const zeros = (v: number | string, n: number) => String(v).replace(/\D/g, '').padStart(n, '0').slice(-n);
const letras = (v: string, n: number) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .padEnd(n, ' ')
    .slice(0, n);
const ddmmaaaa = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

/**
 * A remessa de pagamento por Pix: cabeçalho do arquivo, um lote com a forma de lançamento Pix, e por título o segmento A
 * (favorecido, número do título, data e valor) seguido do segmento B com a chave Pix. Título sem chave conferida, com
 * valor que não é positivo ou repetido recusa a remessa inteira, com a lista dos títulos. Posições do segmento A iguais
 * às que `lerRetornoCnab240` lê (74 a 93 o número do título, 94 a 101 a data, 120 a 134 o valor); no segmento B a forma
 * de iniciação fica em 15 a 17, o documento do favorecido em 19 a 32 e a chave em 128 a 226.
 */
export function gerarCnab240Pix(
  banco: number,
  conta: { agencia: number; numero: number },
  sequencial: number,
  titulos: readonly TituloRemessaPix[],
): { conteudo: string; linhas: number; total: number } | RecusaPagamentoEletronico {
  if (titulos.length === 0)
    return { codigo: 'remessa-vazia', mensagem: 'Escolha ao menos um título para a remessa por Pix.' };
  const semChave: number[] = [];
  const invalidos: number[] = [];
  const vistos = new Set<number>();
  const chaves = new Map<number, { tipo: TipoChavePix; chave: string }>();
  for (const t of titulos) {
    if (vistos.has(t.titulo) || !(t.valor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(t.dataPagamento))
      invalidos.push(t.titulo);
    vistos.add(t.titulo);
    const c = t.tipoChavePix && t.chavePix ? conferirChavePix(t.tipoChavePix, t.chavePix) : null;
    if (c?.ok) chaves.set(t.titulo, { tipo: c.tipo, chave: c.chave });
    else semChave.push(t.titulo);
  }
  if (invalidos.length > 0)
    return {
      codigo: 'titulo-invalido',
      mensagem: `Título repetido, sem valor ou sem data de pagamento: ${invalidos.join(', ')}.`,
    };
  if (semChave.length > 0)
    return {
      codigo: 'credor-sem-chave-pix',
      mensagem: `O credor não tem chave Pix válida no cadastro para o(s) título(s) ${semChave.join(', ')}: cadastre a chave ou pague por outra forma.`,
    };
  const b = zeros(banco, 3);
  const linhas: string[] = [];
  linhas.push(
    linha240([
      [1, b],
      [4, '0000'],
      [8, '0'],
      [53, zeros(conta.agencia, 5)],
      [59, zeros(conta.numero, 12)],
      [143, '1'],
      [158, zeros(sequencial, 6)],
    ]),
  );
  linhas.push(
    linha240([
      [1, b],
      [4, '0001'],
      [8, '1'],
      [9, 'C'],
      [10, '20'],
      [12, LANCAMENTO_PIX],
      [53, zeros(conta.agencia, 5)],
      [59, zeros(conta.numero, 12)],
    ]),
  );
  let seq = 0;
  for (const t of titulos) {
    const chave = chaves.get(t.titulo)!;
    seq += 1;
    linhas.push(
      linha240([
        [1, b],
        [4, '0001'],
        [8, '3'],
        [9, zeros(seq, 5)],
        [14, 'A'],
        [15, '000'],
        [18, CAMARA_PIX],
        [44, letras(t.favorecido, 30)],
        [74, zeros(t.titulo, 20)],
        [94, ddmmaaaa(t.dataPagamento)],
        [102, 'BRL'],
        [120, zeros(Math.round(t.valor * 100), 15)],
      ]),
    );
    seq += 1;
    const documento = somenteDigitos(t.documento);
    linhas.push(
      linha240([
        [1, b],
        [4, '0001'],
        [8, '3'],
        [9, zeros(seq, 5)],
        [14, 'B'],
        [15, INICIACAO_PIX[chave.tipo].padEnd(3, ' ')],
        [18, documento.length === 14 ? '2' : '1'],
        [19, zeros(documento, 14)],
        // CPF e CNPJ como chave já vão no documento do favorecido; as demais chaves, no campo da chave.
        [128, chave.tipo === 'cpf' || chave.tipo === 'cnpj' ? '' : chave.chave.slice(0, 99)],
      ]),
    );
  }
  const total = centavos(titulos.reduce((s, t) => s + t.valor, 0));
  linhas.push(
    linha240([
      [1, b],
      [4, '0001'],
      [8, '5'],
      [18, zeros(seq + 2, 6)],
      [24, zeros(Math.round(total * 100), 18)],
    ]),
  );
  linhas.push(
    linha240([
      [1, b],
      [4, '9999'],
      [8, '9'],
      [18, zeros(1, 6)],
      [24, zeros(linhas.length + 1, 6)],
    ]),
  );
  return { conteudo: `${linhas.join('\r\n')}\r\n`, linhas: linhas.length, total };
}

export const remessaPixRecusada = (
  r: { conteudo: string; linhas: number; total: number } | RecusaPagamentoEletronico,
): r is RecusaPagamentoEletronico => 'codigo' in r;

// ── Retorno do simulador (fora de produção) ─────────────────────────────────────────────────────────────────────

export interface RespostaSimulada {
  readonly titulo: number;
  /** Valor do pagamento pedido na remessa. */
  readonly valor: number;
  /** Códigos de ocorrência (até cinco); "00" confirma o pagamento. */
  readonly ocorrencias: readonly string[];
  readonly dataPagamento?: string | null;
  /** Valor efetivamente pago, quando diferente do pedido. */
  readonly valorPago?: number | null;
}

/**
 * O arquivo de retorno que o simulador do banco devolve fora de produção (nada sai do estabelecimento): CNAB 240 com o
 * cabeçalho de retorno, um segmento A por título com as ocorrências e o rodapé que fecha com as linhas. É o mesmo
 * formato que `lerRetornoCnab240` lê: serve à homologação da leitura do retorno sem o banco.
 */
export function montarRetornoCnab240(
  banco: number,
  sequencial: number,
  respostas: readonly RespostaSimulada[],
): string {
  const b = zeros(banco, 3);
  const linhas: string[] = [];
  linhas.push(
    linha240([
      [1, b],
      [4, '0000'],
      [8, '0'],
      [143, '2'],
      [158, zeros(sequencial, 6)],
    ]),
  );
  respostas.forEach((r, i) => {
    linhas.push(
      linha240([
        [1, b],
        [4, '0001'],
        [8, '3'],
        [9, zeros(i + 1, 5)],
        [14, 'A'],
        [74, zeros(r.titulo, 20)],
        [94, r.dataPagamento ? ddmmaaaa(r.dataPagamento) : '00000000'],
        [120, zeros(Math.round(r.valor * 100), 15)],
        [155, r.dataPagamento ? ddmmaaaa(r.dataPagamento) : '00000000'],
        [163, zeros(Math.round((r.valorPago ?? 0) * 100), 15)],
        [231, r.ocorrencias.slice(0, 5).join('').padEnd(10, ' ')],
      ]),
    );
  });
  linhas.push(
    linha240([
      [1, b],
      [4, '9999'],
      [8, '9'],
      [18, zeros(1, 6)],
      [24, zeros(linhas.length + 1, 6)],
    ]),
  );
  return `${linhas.join('\r\n')}\r\n`;
}
