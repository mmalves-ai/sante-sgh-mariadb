// Leitura do arquivo de retorno do banco para o pagamento a fornecedores (F3.8, 07-FIN linha 66): CNAB 240 no padrão
// FEBRABAN, segmento A. Regra pura: recebe o texto do arquivo e devolve, por título, a ocorrência do banco, a data e o
// valor efetivamente pagos e o que o financeiro deve fazer com a parcela (baixar, aguardar o agendamento ou devolver à
// fila com o motivo). Arquivo de outro banco, de remessa em vez de retorno, com linha fora de 240 posições ou rodapé
// que não fecha com o corpo é recusado inteiro: nada é baixado pela metade.
import { centavos } from '@sgh/contratos/regras-financeiro';

/** O que o financeiro faz com a parcela depois do retorno. */
export type DesfechoRetorno = 'pago' | 'agendado' | 'rejeitado';

export interface OcorrenciaRetorno {
  /** O número do título enviado na remessa ("seu número", posições 74 a 93 do segmento A). */
  readonly titulo: number;
  /** Os códigos de ocorrência do banco (até cinco, posições 231 a 240). */
  readonly ocorrencias: readonly string[];
  readonly desfecho: DesfechoRetorno;
  /** Descrição da primeira ocorrência que decide o desfecho. */
  readonly motivo: string;
  /** Data do pagamento efetivo (AAAA-MM-DD), quando o banco informou. */
  readonly dataPagamento: string | null;
  /** Valor efetivamente pago, quando o banco informou; senão o valor do pagamento pedido. */
  readonly valorPago: number;
}

export interface RetornoLido {
  readonly banco: number;
  /** Número sequencial do arquivo (NSA) do cabeçalho. */
  readonly sequencial: number;
  readonly titulos: readonly OcorrenciaRetorno[];
  /** Soma dos valores pagos (só desfecho "pago"), com as parcelas impressas em `titulos`. */
  readonly totalPago: number;
}

export type RecusaRetorno = {
  readonly codigo:
    | 'arquivo-vazio'
    | 'linha-tamanho'
    | 'nao-e-retorno'
    | 'banco-diferente'
    | 'rodape-divergente'
    | 'titulo-invalido'
    | 'titulo-repetido';
  readonly mensagem: string;
};

/** Códigos FEBRABAN de ocorrência no pagamento a fornecedores que o financeiro trata pelo nome. */
const DESCRICOES: Readonly<Record<string, string>> = {
  '00': 'Crédito ou débito efetuado',
  '01': 'Insuficiência de fundos',
  '02': 'Crédito ou débito cancelado pelo pagador',
  '03': 'Débito autorizado pela agência',
  AA: 'Controle inválido',
  AB: 'Tipo de operação inválido',
  AE: 'Tipo, número ou inscrição do favorecido inválidos',
  AG: 'Agência ou conta do favorecido inválidas',
  AM: 'Valor do pagamento inválido',
  AP: 'Data do pagamento inválida',
  BD: 'Pagamento agendado (inclusão aceita pelo banco)',
  BE: 'Alteração do agendamento aceita pelo banco',
  BF: 'Exclusão do agendamento aceita pelo banco',
  PA: 'Chave Pix não encontrada',
  PB: 'Chave Pix inválida',
};
const AGENDAMENTO = new Set(['BD', 'BE', '03']);

/** A descrição da ocorrência; código desconhecido vira "Ocorrência <código> do banco". */
export function descreverOcorrencia(codigo: string): string {
  return DESCRICOES[codigo] ?? `Ocorrência ${codigo} do banco`;
}

/** O desfecho de um conjunto de ocorrências: "00" paga; agendamento aceito aguarda; qualquer outra rejeita. */
export function desfechoDasOcorrencias(codigos: readonly string[]): {
  desfecho: DesfechoRetorno;
  motivo: string;
} {
  if (codigos.includes('00')) return { desfecho: 'pago', motivo: descreverOcorrencia('00') };
  const rejeicao = codigos.find((c) => !AGENDAMENTO.has(c));
  if (rejeicao !== undefined || codigos.length === 0)
    return {
      desfecho: 'rejeitado',
      motivo: rejeicao !== undefined ? descreverOcorrencia(rejeicao) : 'Retorno sem ocorrência informada',
    };
  return { desfecho: 'agendado', motivo: descreverOcorrencia(codigos[0] as string) };
}

const campo = (linha: string, de: number, ate: number) => linha.slice(de - 1, ate);
const inteiro = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);
const valor = (s: string) => (/^\d+$/.test(s) ? centavos(Number(s) / 100) : Number.NaN);
/** DDMMAAAA → AAAA-MM-DD; zeros ou data impossível → null. */
function data(s: string): string | null {
  if (!/^\d{8}$/.test(s) || s === '00000000') return null;
  const iso = `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/**
 * Lê o retorno CNAB 240 de pagamento. `bancoEsperado` é o banco da conta da remessa: arquivo de outro banco é recusado.
 * Posições (FEBRABAN 240, segmento A): 1–3 banco; 8 tipo de registro; 14 segmento; 74–93 seu número; 94–101 data do
 * pagamento; 120–134 valor do pagamento; 155–162 data real; 163–177 valor real; 231–240 ocorrências. Cabeçalho do
 * arquivo: 143 código remessa (1) ou retorno (2); 158–163 sequencial. Rodapé do arquivo: 24–29 quantidade de registros.
 */
export function lerRetornoCnab240(conteudo: string, bancoEsperado: number): RetornoLido | RecusaRetorno {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.length > 0);
  if (linhas.length < 2) return { codigo: 'arquivo-vazio', mensagem: 'O arquivo de retorno está vazio.' };
  const torta = linhas.findIndex((l) => l.length !== 240);
  if (torta >= 0)
    return {
      codigo: 'linha-tamanho',
      mensagem: `A linha ${torta + 1} do retorno não tem 240 posições: o arquivo não é CNAB 240 ou veio cortado.`,
    };
  const cabecalho = linhas[0] as string;
  if (campo(cabecalho, 8, 8) !== '0' || campo(cabecalho, 143, 143) !== '2')
    return {
      codigo: 'nao-e-retorno',
      mensagem: 'O arquivo não é um retorno do banco (o cabeçalho não traz o código de retorno).',
    };
  const banco = inteiro(campo(cabecalho, 1, 3));
  if (banco !== bancoEsperado)
    return {
      codigo: 'banco-diferente',
      mensagem: `O retorno é do banco ${String(banco).padStart(3, '0')}, mas a conta da remessa é do banco ${String(bancoEsperado).padStart(3, '0')}.`,
    };
  const rodape = linhas[linhas.length - 1] as string;
  if (campo(rodape, 8, 8) !== '9' || inteiro(campo(rodape, 24, 29)) !== linhas.length)
    return {
      codigo: 'rodape-divergente',
      mensagem: 'O rodapé do retorno não fecha com a quantidade de linhas: o arquivo veio incompleto.',
    };
  const titulos: OcorrenciaRetorno[] = [];
  const vistos = new Set<number>();
  for (const [i, l] of linhas.entries()) {
    if (campo(l, 8, 8) !== '3' || campo(l, 14, 14) !== 'A') continue;
    const titulo = inteiro(campo(l, 74, 93));
    const pedido = valor(campo(l, 120, 134));
    if (!Number.isInteger(titulo) || titulo <= 0 || Number.isNaN(pedido))
      return {
        codigo: 'titulo-invalido',
        mensagem: `A linha ${i + 1} do retorno não traz o número do título ou o valor do pagamento.`,
      };
    if (vistos.has(titulo))
      return {
        codigo: 'titulo-repetido',
        mensagem: `O título ${titulo} aparece duas vezes no mesmo retorno.`,
      };
    vistos.add(titulo);
    const codigos = (campo(l, 231, 240).match(/.{2}/g) ?? [])
      .map((c) => c.trim())
      .filter((c) => c.length === 2);
    const real = valor(campo(l, 163, 177));
    const { desfecho, motivo } = desfechoDasOcorrencias(codigos);
    titulos.push({
      titulo,
      ocorrencias: codigos,
      desfecho,
      motivo,
      dataPagamento: data(campo(l, 155, 162)) ?? data(campo(l, 94, 101)),
      valorPago: !Number.isNaN(real) && real > 0 ? real : pedido,
    });
  }
  const totalPago = centavos(
    titulos.filter((t) => t.desfecho === 'pago').reduce((s, t) => s + t.valorPago, 0),
  );
  return { banco, sequencial: inteiro(campo(cabecalho, 158, 163)), titulos, totalPago };
}

/** Distingue a recusa do retorno lido. */
export const retornoRecusado = (r: RetornoLido | RecusaRetorno): r is RecusaRetorno => 'codigo' in r;
