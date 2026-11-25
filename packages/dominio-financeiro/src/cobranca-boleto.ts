// Cobrança bancária com boleto (F7, 07-FIN linha 78): regra pura da carteira de cobrança, do nosso número, do código de
// barras e da linha digitável no padrão FEBRABAN, da remessa CNAB 240 de cobrança (segmentos P, Q e R) e da leitura do
// retorno (segmentos T e U) com as ocorrências e o que o financeiro faz com cada uma (confirmar o registro, baixar a
// parcela a receber, devolver a rejeição com o motivo, lançar a tarifa).
// Desenho próprio:
// - o leiaute de cada banco vem da configuração (leiaute bancário da carteira); este arquivo segue o padrão FEBRABAN
//   do CNAB 240, versão 10.7, com o campo livre padrão (agência, carteira, nosso número e conta);
// - o arquivo de retorno é lido inteiro antes de qualquer gravação: arquivo que não fecha é recusado inteiro, e nada é
//   baixado pela metade;
// - a liquidação repetida (o mesmo boleto já pago) não gera segunda baixa: fica como informativa;
// - toda conta agregada (total da remessa, total liquidado, tarifas) sai com as parcelas que a compõem.
import { centavos } from '@sgh/contratos/regras-financeiro';

// ── Carteira e nosso número ─────────────────────────────────────────────────────────────────────────────────────

export interface CarteiraEntrada {
  readonly descricao: string;
  readonly codigoCarteira: string;
  readonly codigoBeneficiario: string;
  readonly nossoNumeroInicial: number;
  readonly nossoNumeroFinal: number;
  readonly diasCompensacao: number;
  readonly valorTarifa: number | null;
}

export interface RecusaCobranca {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campos: readonly string[];
}

const soDigitos = (v: string) => /^\d+$/.test(v);

/** A carteira tem de ter código numérico, beneficiário e faixa de nosso número coerente (validação na hora). */
export function conferirCarteira(c: CarteiraEntrada): RecusaCobranca | null {
  if (!c.descricao.trim())
    return { codigo: 'carteira-descricao', mensagem: 'Dê um nome à carteira.', campos: ['descricao'] };
  if (!soDigitos(c.codigoCarteira) || c.codigoCarteira.length > 3)
    return {
      codigo: 'carteira-codigo',
      mensagem: 'O código da carteira é o número que o banco definiu (até 3 dígitos).',
      campos: ['codigoCarteira'],
    };
  if (!soDigitos(c.codigoBeneficiario) || c.codigoBeneficiario.length > 20)
    return {
      codigo: 'carteira-beneficiario',
      mensagem: 'O código do beneficiário no banco tem só dígitos (até 20).',
      campos: ['codigoBeneficiario'],
    };
  if (
    !Number.isInteger(c.nossoNumeroInicial) ||
    !Number.isInteger(c.nossoNumeroFinal) ||
    c.nossoNumeroInicial < 1 ||
    c.nossoNumeroFinal < c.nossoNumeroInicial ||
    c.nossoNumeroFinal > 99_999_999_999
  )
    return {
      codigo: 'carteira-faixa',
      mensagem: 'A faixa do nosso número vai de 1 a 99.999.999.999, com o fim maior ou igual ao início.',
      campos: ['nossoNumeroInicial', 'nossoNumeroFinal'],
    };
  if (!Number.isInteger(c.diasCompensacao) || c.diasCompensacao < 0 || c.diasCompensacao > 30)
    return {
      codigo: 'carteira-compensacao',
      mensagem: 'Os dias até o crédito vão de 0 a 30.',
      campos: ['diasCompensacao'],
    };
  if (c.valorTarifa !== null && !(c.valorTarifa >= 0))
    return {
      codigo: 'carteira-tarifa',
      mensagem: 'A tarifa não pode ser negativa.',
      campos: ['valorTarifa'],
    };
  return null;
}

/** Dígito do nosso número: módulo 11 com pesos 2 a 7, sobre carteira e número (resto 0 vira 0; resto 1 vira "P"→0). */
export function digitoNossoNumero(carteira: string, sequencia: number): string {
  const base = `${carteira.padStart(2, '0').slice(-2)}${String(sequencia).padStart(11, '0')}`;
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i -= 1) {
    soma += Number(base[i]) * peso;
    peso = peso === 7 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? '0' : String(11 - resto);
}

/** O próximo nosso número da faixa da carteira, com o dígito; null quando a faixa acabou. */
export function proximoNossoNumero(carteira: {
  codigoCarteira: string;
  atual: number;
  final: number;
  inicial: number;
}): { sequencia: number; nossoNumero: string } | null {
  const sequencia = Math.max(carteira.atual + 1, carteira.inicial);
  if (sequencia > carteira.final) return null;
  return {
    sequencia,
    nossoNumero: `${String(sequencia).padStart(11, '0')}${digitoNossoNumero(carteira.codigoCarteira, sequencia)}`,
  };
}

// ── Código de barras e linha digitável (FEBRABAN) ───────────────────────────────────────────────────────────────

const DIA = 86_400_000;
/** Fator de vencimento: dias desde 07/10/1997; a partir de 22/02/2025 o fator recomeça em 1000 (ciclo de 9000). */
export function fatorVencimento(vencimento: string): string {
  const dias = Math.round((Date.parse(`${vencimento}T00:00:00Z`) - Date.parse('1997-10-07T00:00:00Z')) / DIA);
  if (dias < 1000) throw new Error('vencimento-fora-do-fator');
  return String(((dias - 1000) % 9000) + 1000).padStart(4, '0');
}

/** Módulo 10 (pesos 2 e 1 da direita para a esquerda; produto acima de 9 soma os algarismos). */
export function modulo10(numeros: string): string {
  let soma = 0;
  let peso = 2;
  for (let i = numeros.length - 1; i >= 0; i -= 1) {
    const p = Number(numeros[i]) * peso;
    soma += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    peso = peso === 2 ? 1 : 2;
  }
  return String((10 - (soma % 10)) % 10);
}

/** Dígito geral do código de barras: módulo 11, pesos 2 a 9; resultado 0, 10 ou 11 vira 1. */
export function digitoCodigoBarras(semDigito43: string): string {
  let soma = 0;
  let peso = 2;
  for (let i = semDigito43.length - 1; i >= 0; i -= 1) {
    soma += Number(semDigito43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? '1' : String(dv);
}

const num = (v: number | string, n: number) => String(v).replace(/\D/g, '').padStart(n, '0').slice(-n);

/** Campo livre padrão (25 posições): agência (4), carteira (2), nosso número sem dígito (11), conta (7) e zero. */
export function campoLivrePadrao(d: {
  agencia: string;
  carteira: string;
  nossoNumero: string;
  conta: string;
}): string {
  return `${num(d.agencia, 4)}${num(d.carteira, 2)}${num(d.nossoNumero.slice(0, 11), 11)}${num(d.conta, 7)}0`;
}

export interface CodigoBoleto {
  /** Os 44 dígitos do código de barras (padrão intercalado 2 de 5). */
  readonly codigoBarras: string;
  /** A linha digitável formatada (47 dígitos em cinco campos). */
  readonly linhaDigitavel: string;
}

/** Código de barras e linha digitável do boleto (moeda 9, real). */
export function montarCodigoBoleto(d: {
  banco: number | string;
  vencimento: string;
  valor: number;
  campoLivre: string;
}): CodigoBoleto {
  if (!/^\d{25}$/.test(d.campoLivre)) throw new Error('campo-livre-invalido');
  if (!(d.valor > 0) || d.valor > 99_999_999.99) throw new Error('valor-fora-do-boleto');
  const banco = num(d.banco, 3);
  const fator = fatorVencimento(d.vencimento);
  const valor = num(Math.round(d.valor * 100), 10);
  const sem = `${banco}9${fator}${valor}${d.campoLivre}`;
  const dv = digitoCodigoBarras(sem);
  const codigoBarras = `${banco}9${dv}${fator}${valor}${d.campoLivre}`;
  const c1 = `${banco}9${d.campoLivre.slice(0, 5)}`;
  const c2 = d.campoLivre.slice(5, 15);
  const c3 = d.campoLivre.slice(15, 25);
  const f1 = `${c1}${modulo10(c1)}`;
  const f2 = `${c2}${modulo10(c2)}`;
  const f3 = `${c3}${modulo10(c3)}`;
  const linhaDigitavel =
    `${f1.slice(0, 5)}.${f1.slice(5)} ${f2.slice(0, 5)}.${f2.slice(5)} ${f3.slice(0, 5)}.${f3.slice(5)} ` +
    `${dv} ${fator}${valor}`;
  return { codigoBarras, linhaDigitavel };
}

/** Confere a linha digitável digitada (os três dígitos de campo e o geral) e devolve o código de barras. */
export function linhaParaCodigoBarras(linha: string): string | null {
  const d = linha.replace(/\D/g, '');
  if (d.length !== 47) return null;
  const c1 = d.slice(0, 9);
  const c2 = d.slice(10, 20);
  const c3 = d.slice(21, 31);
  if (modulo10(c1) !== d[9] || modulo10(c2) !== d[20] || modulo10(c3) !== d[31]) return null;
  const codigo = `${d.slice(0, 4)}${d[32]}${d.slice(33, 47)}${d.slice(4, 9)}${c2}${c3}`;
  return digitoCodigoBarras(`${codigo.slice(0, 4)}${codigo.slice(5)}`) === codigo[4] ? codigo : null;
}

// ── Emissão ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ParcelaParaBoleto {
  readonly parcela: number;
  readonly situacao: string;
  readonly tituloSituacao: string;
  readonly saldo: number;
  readonly vencimento: string;
  readonly boletoAtivo: boolean;
  readonly pagadorDocumento: string;
  readonly pagadorNome: string;
}

const DOCUMENTO = /^(\d{11}|\d{14})$/;

/** A parcela pode ganhar boleto? Recusa dita por parcela, para a tela mostrar na hora. */
export function conferirEmissao(p: ParcelaParaBoleto, dataEmissao: string): RecusaCobranca | null {
  if (
    !['aberta', 'parcial'].includes(p.situacao) ||
    ['cancelado', 'renegociado', 'recebido'].includes(p.tituloSituacao)
  )
    return {
      codigo: 'parcela-nao-aberta',
      mensagem: `A parcela ${p.parcela} não está em aberto.`,
      campos: ['parcelas'],
    };
  if (!(p.saldo > 0))
    return {
      codigo: 'parcela-sem-saldo',
      mensagem: `A parcela ${p.parcela} não tem saldo.`,
      campos: ['parcelas'],
    };
  if (p.boletoAtivo)
    return {
      codigo: 'boleto-ja-emitido',
      mensagem: `A parcela ${p.parcela} já tem boleto ativo: cancele o anterior antes de emitir outro.`,
      campos: ['parcelas'],
    };
  if (!DOCUMENTO.test(p.pagadorDocumento))
    return {
      codigo: 'pagador-sem-documento',
      mensagem: `O pagador da parcela ${p.parcela} não tem CPF ou CNPJ no cadastro: informe o documento.`,
      campos: ['pagadorDocumento'],
    };
  if (!p.pagadorNome.trim())
    return { codigo: 'pagador-sem-nome', mensagem: 'Informe o nome do pagador.', campos: ['pagadorNome'] };
  if (p.vencimento < dataEmissao)
    return {
      codigo: 'vencimento-passado',
      mensagem: `A parcela ${p.parcela} vence antes da emissão: prorrogue o vencimento antes do boleto.`,
      campos: ['parcelas'],
    };
  return null;
}

// ── Remessa CNAB 240 de cobrança ────────────────────────────────────────────────────────────────────────────────

export type InstrucaoRemessa = 'registro' | 'baixa';
const MOVIMENTO_REMESSA: Readonly<Record<InstrucaoRemessa, string>> = { registro: '01', baixa: '02' };

export interface BeneficiarioRemessa {
  readonly banco: number | string;
  readonly cnpj: string;
  readonly nome: string;
  readonly convenio: string;
  readonly agencia: string;
  readonly conta: string;
  readonly digitoConta: string;
  readonly carteira: string;
}

export interface ItemRemessaCobranca {
  readonly instrucao: InstrucaoRemessa;
  readonly nossoNumero: string;
  readonly numeroDocumento: string;
  readonly vencimento: string;
  readonly emissao: string;
  readonly valor: number;
  readonly pagadorDocumento: string;
  readonly pagadorNome: string;
  readonly percentualMulta: number | null;
  readonly percentualJurosMes: number | null;
  readonly mensagem: string | null;
}

const alfa = (v: string, n: number) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .,/-]/g, ' ')
    .padEnd(n, ' ')
    .slice(0, n);
const data8 = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const valor15 = (v: number) => num(Math.round(v * 100), 15);
const linha240 = (partes: readonly string[]) => {
  const l = partes.join('');
  if (l.length > 240) throw new Error(`linha-maior-que-240:${l.length}`);
  return l.padEnd(240, ' ');
};

/** O arquivo de remessa de cobrança (CNAB 240): cabeçalhos, P, Q e R por boleto, rodapés; cada linha com 240. */
export function gerarRemessaCobranca240(
  b: BeneficiarioRemessa,
  sequencial: number,
  geradoEm: Date,
  itens: readonly ItemRemessaCobranca[],
): { conteudo: string; linhas: number; total: number; parcelas: readonly number[] } {
  const banco = num(b.banco, 3);
  const dia = geradoEm.toISOString().slice(0, 10);
  const hora = geradoEm.toISOString().slice(11, 19).replace(/:/g, '');
  const conta = [num(b.agencia, 5), ' ', num(b.conta, 12), alfa(b.digitoConta || ' ', 1), ' '].join('');
  const linhas: string[] = [];
  linhas.push(
    linha240([
      banco,
      '0000',
      '0',
      ' '.repeat(9),
      '2',
      num(b.cnpj, 14),
      alfa(b.convenio, 20),
      conta,
      alfa(b.nome, 30),
      alfa('', 30),
      ' '.repeat(10),
      '1',
      data8(dia),
      hora,
      num(sequencial, 6),
      '087',
      '00000',
    ]),
  );
  linhas.push(
    linha240([
      banco,
      '0001',
      '1',
      'R',
      '01',
      '  ',
      '045',
      ' ',
      '2',
      num(b.cnpj, 15),
      alfa(b.convenio, 20),
      conta,
      alfa(b.nome, 30),
      alfa('', 40),
      alfa('', 40),
      num(sequencial, 8),
      data8(dia),
      '00000000',
    ]),
  );
  let seq = 0;
  for (const i of itens) {
    const mov = MOVIMENTO_REMESSA[i.instrucao];
    const juros = i.percentualJurosMes && i.percentualJurosMes > 0 ? i.percentualJurosMes : null;
    seq += 1;
    linhas.push(
      linha240([
        banco,
        '0001',
        '3',
        num(seq, 5),
        'P',
        ' ',
        mov,
        conta,
        num(i.nossoNumero, 20),
        num(b.carteira, 1),
        '1',
        '1',
        '2',
        '2',
        alfa(i.numeroDocumento, 15),
        data8(i.vencimento),
        valor15(i.valor),
        '00000',
        ' ',
        '04',
        'N',
        data8(i.emissao),
        juros ? '2' : '3',
        juros ? data8(i.vencimento) : '00000000',
        juros ? num(Math.round(juros * 100), 15) : num(0, 15),
        '0',
        '00000000',
        num(0, 15),
        num(0, 15),
        num(0, 15),
        alfa(i.numeroDocumento, 25),
        '3',
        '00',
        '1',
        '060',
        '09',
        num(0, 10),
        ' ',
      ]),
    );
    seq += 1;
    linhas.push(
      linha240([
        banco,
        '0001',
        '3',
        num(seq, 5),
        'Q',
        ' ',
        mov,
        i.pagadorDocumento.length === 14 ? '2' : '1',
        num(i.pagadorDocumento, 15),
        alfa(i.pagadorNome, 40),
      ]),
    );
    const multa = i.percentualMulta && i.percentualMulta > 0 ? i.percentualMulta : null;
    if (multa || i.mensagem) {
      seq += 1;
      const msg = alfa(i.mensagem ?? '', 80);
      linhas.push(
        linha240([
          banco,
          '0001',
          '3',
          num(seq, 5),
          'R',
          ' ',
          mov,
          '0',
          '00000000',
          num(0, 15),
          '0',
          '00000000',
          num(0, 15),
          multa ? '2' : '0',
          multa ? data8(i.vencimento) : '00000000',
          multa ? num(Math.round(multa * 100), 15) : num(0, 15),
          ' '.repeat(10),
          msg.slice(0, 40),
          msg.slice(40),
        ]),
      );
    }
  }
  const parcelas = itens.filter((i) => i.instrucao === 'registro').map((i) => centavos(i.valor));
  const total = centavos(parcelas.reduce((s, v) => s + v, 0));
  linhas.push(
    linha240([
      banco,
      '0001',
      '5',
      ' '.repeat(9),
      num(seq + 2, 6),
      num(parcelas.length, 6),
      num(Math.round(total * 100), 17),
    ]),
  );
  linhas.push(linha240([banco, '9999', '9', ' '.repeat(9), '000001', num(linhas.length + 1, 6), '000000']));
  return { conteudo: `${linhas.join('\r\n')}\r\n`, linhas: linhas.length, total, parcelas };
}

// ── Retorno CNAB 240 de cobrança ────────────────────────────────────────────────────────────────────────────────

export type EfeitoOcorrencia = 'entrada_confirmada' | 'liquidado' | 'baixado' | 'rejeitado' | 'informativo';

/** Ocorrências FEBRABAN do retorno de cobrança tratadas pelo nome (código do movimento, posições 16 e 17 do T). */
export const OCORRENCIAS_COBRANCA: Readonly<Record<string, { descricao: string; efeito: EfeitoOcorrencia }>> =
  {
    '02': { descricao: 'Entrada confirmada', efeito: 'entrada_confirmada' },
    '03': { descricao: 'Entrada rejeitada', efeito: 'rejeitado' },
    '04': { descricao: 'Transferência de carteira (entrada)', efeito: 'informativo' },
    '06': { descricao: 'Liquidação', efeito: 'liquidado' },
    '09': { descricao: 'Baixa', efeito: 'baixado' },
    '12': { descricao: 'Confirmação de abatimento', efeito: 'informativo' },
    '14': { descricao: 'Confirmação de alteração do vencimento', efeito: 'informativo' },
    '17': { descricao: 'Liquidação após baixa ou título não registrado', efeito: 'liquidado' },
    '19': { descricao: 'Confirmação da instrução de protesto', efeito: 'informativo' },
    '23': { descricao: 'Remessa a cartório', efeito: 'informativo' },
    '25': { descricao: 'Protestado e baixado', efeito: 'baixado' },
    '26': { descricao: 'Instrução rejeitada', efeito: 'rejeitado' },
    '28': { descricao: 'Débito de tarifas e custas', efeito: 'informativo' },
    '30': { descricao: 'Alteração de dados rejeitada', efeito: 'rejeitado' },
  };

/** Motivos de rejeição mais comuns (posições 214 a 223 do T, até cinco códigos). */
const MOTIVOS: Readonly<Record<string, string>> = {
  '03': 'CEP inválido',
  '08': 'Nosso número inválido',
  '09': 'Nosso número duplicado',
  '10': 'Carteira inválida',
  '16': 'Data de vencimento inválida',
  '20': 'Valor do título inválido',
  '45': 'Nome do pagador não informado',
  '46': 'Tipo ou número de inscrição do pagador inválidos',
  '48': 'CEP do pagador inválido',
};

export function descreverOcorrenciaCobranca(codigo: string): string {
  return OCORRENCIAS_COBRANCA[codigo]?.descricao ?? `Ocorrência ${codigo} do banco`;
}

export interface LinhaRetornoCobranca {
  readonly codigo: string;
  readonly efeito: EfeitoOcorrencia;
  readonly descricao: string;
  readonly motivos: readonly string[];
  readonly nossoNumero: string;
  readonly numeroDocumento: string;
  readonly vencimento: string | null;
  readonly valorTitulo: number;
  readonly valorTarifa: number;
  readonly encargos: number;
  readonly desconto: number;
  readonly abatimento: number;
  readonly valorPago: number;
  readonly dataOcorrencia: string | null;
  readonly dataCredito: string | null;
}

export interface RetornoCobrancaLido {
  readonly banco: number;
  readonly sequencial: number;
  readonly dataGravacao: string;
  readonly linhas: readonly LinhaRetornoCobranca[];
}

export type RecusaRetornoCobranca = { readonly codigo: string; readonly mensagem: string };

export function retornoCobrancaRecusado(
  r: RetornoCobrancaLido | RecusaRetornoCobranca,
): r is RecusaRetornoCobranca {
  return 'codigo' in r;
}

const lerData = (s: string): string | null => {
  if (!/^\d{8}$/.test(s) || s === '00000000') return null;
  const iso = `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
};
const lerValor = (s: string) => (/^\d+$/.test(s) ? Number(s) / 100 : 0);

/** Lê o retorno inteiro; qualquer defeito recusa o arquivo todo (nada é baixado pela metade). */
export function lerRetornoCobranca240(
  conteudo: string,
  bancoEsperado: number,
): RetornoCobrancaLido | RecusaRetornoCobranca {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.length > 0);
  if (linhas.length < 4)
    return { codigo: 'arquivo-vazio', mensagem: 'O arquivo de retorno está vazio ou incompleto.' };
  const fora = linhas.findIndex((l) => l.length !== 240);
  if (fora >= 0)
    return {
      codigo: 'linha-tamanho',
      mensagem: `A linha ${fora + 1} não tem 240 posições: arquivo recusado inteiro.`,
    };
  const cab = linhas[0] as string;
  if (cab[7] !== '0' || cab[142] !== '2')
    return {
      codigo: 'nao-e-retorno',
      mensagem: 'O arquivo não é um retorno de cobrança (cabeçalho de remessa).',
    };
  const banco = Number(cab.slice(0, 3));
  if (banco !== bancoEsperado)
    return {
      codigo: 'banco-diferente',
      mensagem: `O retorno é do banco ${num(banco, 3)}, não do banco da carteira.`,
    };
  const rodape = linhas[linhas.length - 1] as string;
  if (rodape[7] !== '9' || Number(rodape.slice(23, 29)) !== linhas.length)
    return {
      codigo: 'rodape-divergente',
      mensagem: 'A quantidade de linhas do rodapé não fecha com o arquivo.',
    };
  const lidas: LinhaRetornoCobranca[] = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const t = linhas[i] as string;
    if (t[7] !== '3' || t[13] !== 'T') continue;
    const u = linhas[i + 1];
    if (!u || u[7] !== '3' || u[13] !== 'U')
      return { codigo: 'segmento-sem-par', mensagem: `O segmento T da linha ${i + 1} não tem o segmento U.` };
    const codigo = t.slice(15, 17);
    const ocorr = OCORRENCIAS_COBRANCA[codigo];
    const motivos = (t.slice(213, 223).match(/.{2}/g) ?? [])
      .filter((m) => m.trim() && m !== '00')
      .map((m) => (MOTIVOS[m] ? `${m} ${MOTIVOS[m]}` : m));
    const nosso = t
      .slice(37, 57)
      .trim()
      .replace(/^0+(?=\d)/, '');
    if (!nosso)
      return { codigo: 'nosso-numero-vazio', mensagem: `A linha ${i + 1} não traz o nosso número.` };
    lidas.push({
      codigo,
      efeito: ocorr?.efeito ?? 'informativo',
      descricao: descreverOcorrenciaCobranca(codigo),
      motivos,
      nossoNumero: nosso,
      numeroDocumento: t.slice(58, 73).trim(),
      vencimento: lerData(t.slice(73, 81)),
      valorTitulo: lerValor(t.slice(81, 96)),
      valorTarifa: lerValor(t.slice(198, 213)),
      encargos: lerValor(u.slice(17, 32)),
      desconto: lerValor(u.slice(32, 47)),
      abatimento: lerValor(u.slice(47, 62)),
      valorPago: lerValor(u.slice(77, 92)),
      dataOcorrencia: lerData(u.slice(137, 145)),
      dataCredito: lerData(u.slice(145, 153)),
    });
    i += 1;
  }
  return {
    banco,
    sequencial: Number(cab.slice(157, 163)) || 0,
    dataGravacao: lerData(cab.slice(143, 151)) ?? '',
    linhas: lidas,
  };
}

/** Monta um retorno válido (simulador fora de produção e testes). */
export function montarRetornoCobranca240(
  banco: number,
  sequencial: number,
  dataGravacao: string,
  itens: readonly {
    codigo: string;
    nossoNumero: string;
    valorTitulo: number;
    valorPago?: number;
    encargos?: number;
    desconto?: number;
    tarifa?: number;
    motivos?: string;
    vencimento?: string;
    dataOcorrencia?: string;
    dataCredito?: string;
  }[],
): string {
  const b = num(banco, 3);
  const linhas: string[] = [];
  linhas.push(
    linha240([b, '0000', '0', ' '.repeat(134), '2', data8(dataGravacao), '000000', num(sequencial, 6)]),
  );
  linhas.push(linha240([b, '0001', '1', 'T']));
  let seq = 0;
  for (const i of itens) {
    seq += 1;
    linhas.push(
      linha240([
        b,
        '0001',
        '3',
        num(seq, 5),
        'T',
        ' ',
        i.codigo,
        ' '.repeat(20),
        num(i.nossoNumero, 20),
        '1',
        ' '.repeat(15),
        i.vencimento ? data8(i.vencimento) : '00000000',
        valor15(i.valorTitulo),
        ' '.repeat(102),
        valor15(i.tarifa ?? 0),
        (i.motivos ?? '').padEnd(10, ' ').slice(0, 10),
      ]),
    );
    seq += 1;
    linhas.push(
      linha240([
        b,
        '0001',
        '3',
        num(seq, 5),
        'U',
        ' ',
        i.codigo,
        valor15(i.encargos ?? 0),
        valor15(i.desconto ?? 0),
        valor15(0),
        valor15(0),
        valor15(i.valorPago ?? 0),
        valor15(i.valorPago ?? 0),
        valor15(0),
        valor15(0),
        i.dataOcorrencia ? data8(i.dataOcorrencia) : '00000000',
        i.dataCredito ? data8(i.dataCredito) : '00000000',
      ]),
    );
  }
  linhas.push(linha240([b, '0001', '5', ' '.repeat(9), num(seq + 2, 6)]));
  linhas.push(linha240([b, '9999', '9', ' '.repeat(9), '000001', num(linhas.length + 1, 6)]));
  return `${linhas.join('\r\n')}\r\n`;
}

// ── Plano do retorno: o que o financeiro faz com cada linha ─────────────────────────────────────────────────────

export interface BoletoDoRetorno {
  readonly boleto: number;
  readonly parcela: number | null;
  readonly situacao: string;
  readonly saldoParcela: number;
}

export interface ItemPlanoRetornoCobranca {
  readonly linha: LinhaRetornoCobranca;
  readonly boleto: number | null;
  readonly parcela: number | null;
  readonly situacao:
    'entrada_confirmada' | 'liquidado' | 'baixado' | 'rejeitado' | 'informativo' | 'nao_localizado';
  readonly motivo: string;
  /** A situação nova do boleto, quando muda. */
  readonly boletoNovo: string | null;
  /** A baixa da parcela a receber: principal abatido do saldo, descontos e encargos. */
  readonly baixa: {
    readonly recebido: number;
    readonly principal: number;
    readonly desconto: number;
    readonly encargos: number;
    readonly saldoRestante: number;
    readonly data: string;
    readonly dataCredito: string;
  } | null;
}

export interface PlanoRetornoCobranca {
  readonly itens: readonly ItemPlanoRetornoCobranca[];
  readonly liquidados: number;
  readonly rejeitados: number;
  readonly naoLocalizados: number;
  /** Total recebido, com as parcelas (valores pagos dos liquidados) impressas em `parcelasLiquidadas`. */
  readonly totalLiquidado: number;
  readonly parcelasLiquidadas: readonly number[];
  readonly totalRejeitado: number;
  /** Total das tarifas, com as parcelas em `parcelasTarifa`. */
  readonly totalTarifas: number;
  readonly parcelasTarifa: readonly number[];
}

/** Decide cada linha do retorno sobre os boletos da carteira (por nosso número). Regra pura. */
export function planejarRetornoCobranca(
  boletos: ReadonlyMap<string, BoletoDoRetorno>,
  lido: RetornoCobrancaLido,
  diasCompensacao: number,
): PlanoRetornoCobranca {
  const saldo = new Map<number, number>();
  const situacao = new Map<number, string>();
  const itens: ItemPlanoRetornoCobranca[] = [];
  const parcelasLiquidadas: number[] = [];
  const parcelasTarifa: number[] = [];
  let rejeitados = 0;
  let naoLocalizados = 0;
  let totalRejeitado = 0;
  for (const linha of lido.linhas) {
    if (linha.valorTarifa > 0) parcelasTarifa.push(centavos(linha.valorTarifa));
    const b = boletos.get(linha.nossoNumero) ?? boletos.get(linha.nossoNumero.padStart(12, '0'));
    if (!b) {
      naoLocalizados += 1;
      itens.push({
        linha,
        boleto: null,
        parcela: null,
        situacao: 'nao_localizado',
        boletoNovo: null,
        baixa: null,
        motivo: `Nosso número ${linha.nossoNumero} não é de boleto desta carteira`,
      });
      continue;
    }
    const atual = situacao.get(b.boleto) ?? b.situacao;
    const base = { linha, boleto: b.boleto, parcela: b.parcela };
    if (linha.efeito === 'rejeitado') {
      rejeitados += 1;
      totalRejeitado = centavos(totalRejeitado + linha.valorTitulo);
      const novo = linha.codigo === '03' && atual === 'emitido' ? 'rejeitado' : null;
      if (novo) situacao.set(b.boleto, novo);
      itens.push({
        ...base,
        situacao: 'rejeitado',
        boletoNovo: novo,
        baixa: null,
        motivo: `${linha.descricao}${linha.motivos.length ? `: ${linha.motivos.join(', ')}` : ''}`,
      });
      continue;
    }
    if (linha.efeito === 'entrada_confirmada') {
      const novo = atual === 'emitido' || atual === 'rejeitado' ? 'registrado' : null;
      if (novo) situacao.set(b.boleto, novo);
      itens.push({
        ...base,
        situacao: 'entrada_confirmada',
        boletoNovo: novo,
        baixa: null,
        motivo: linha.descricao,
      });
      continue;
    }
    if (linha.efeito === 'baixado') {
      const novo = ['emitido', 'registrado', 'protestado'].includes(atual) ? 'baixado' : null;
      if (novo) situacao.set(b.boleto, novo);
      itens.push({ ...base, situacao: 'baixado', boletoNovo: novo, baixa: null, motivo: linha.descricao });
      continue;
    }
    if (linha.efeito === 'liquidado') {
      if (atual === 'pago' || atual === 'cancelado' || b.parcela === null) {
        itens.push({
          ...base,
          situacao: 'informativo',
          boletoNovo: null,
          baixa: null,
          motivo:
            atual === 'pago'
              ? 'Liquidação repetida: o boleto já estava pago, nada foi baixado de novo'
              : 'Boleto cancelado pago no banco: confira e devolva ou baixe manualmente',
        });
        continue;
      }
      const data = linha.dataOcorrencia ?? lido.dataGravacao;
      const disponivel = saldo.get(b.boleto) ?? b.saldoParcela;
      const desconto = centavos(linha.desconto + linha.abatimento);
      const principalPago = centavos(Math.max(0, linha.valorPago - linha.encargos));
      const abate = centavos(Math.min(disponivel, principalPago + desconto));
      const principal = centavos(Math.max(0, abate - desconto));
      const saldoRestante = centavos(disponivel - abate);
      saldo.set(b.boleto, saldoRestante);
      situacao.set(b.boleto, 'pago');
      parcelasLiquidadas.push(centavos(linha.valorPago));
      itens.push({
        ...base,
        situacao: 'liquidado',
        boletoNovo: 'pago',
        motivo: saldoRestante > 0 ? `${linha.descricao} a menor: a parcela fica parcial` : linha.descricao,
        baixa: {
          recebido: centavos(linha.valorPago),
          principal,
          desconto: centavos(abate - principal),
          encargos: centavos(linha.encargos),
          saldoRestante,
          data,
          dataCredito: linha.dataCredito ?? somarDias(data, diasCompensacao),
        },
      });
      continue;
    }
    itens.push({ ...base, situacao: 'informativo', boletoNovo: null, baixa: null, motivo: linha.descricao });
  }
  return {
    itens,
    liquidados: parcelasLiquidadas.length,
    rejeitados,
    naoLocalizados,
    totalLiquidado: centavos(parcelasLiquidadas.reduce((s, v) => s + v, 0)),
    parcelasLiquidadas,
    totalRejeitado,
    totalTarifas: centavos(parcelasTarifa.reduce((s, v) => s + v, 0)),
    parcelasTarifa,
  };
}

function somarDias(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + dias * DIA).toISOString().slice(0, 10);
}
