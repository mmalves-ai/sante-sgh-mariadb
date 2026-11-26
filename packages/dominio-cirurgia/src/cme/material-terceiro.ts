// Material de terceiro e consignado processado pela CME (F7, 04-CME linha 119; RDC ANVISA 15/2012, arts. 21 e 22, que
// obrigam a CME a reprocessar o material de terceiros e o consignado com o mesmo protocolo do material próprio, com
// recebimento, conferência e devolução registrados). Regras puras:
//   - o cadastro do material: quem é o dono (fornecedor, profissional, outro estabelecimento ou o próprio paciente) e o
//     roteiro do reprocessamento (expurgo, lavagem, desinfecção, preparo, esterilização e guarda no arsenal);
//   - o recebimento na CME: itens com quantidade, entregador identificado, material do mesmo dono quando há fornecedor;
//   - a conferência peça a peça: tudo conferido sem divergência deixa o recebimento conferido; senão, divergente;
//   - o envio ao reprocessamento só do recebimento conferido, um pacote por item que exige esterilização;
//   - a disponibilidade para a cirurgia só com todos os pacotes estéreis (nenhum rejeitado ou pendente);
//   - a devolução conferida: quem retirou, utilizado + devolvido = recebido em cada item, e o uso só com paciente.
// A porta reconfere tudo no banco e nunca apaga. O consignado do OPME (órtese, prótese e material especial) com
// faturamento segue pelo suprimentos; aqui é o caminho físico do material dentro da CME.
import type { ProblemaCme } from './cme.js';

export const TIPOS_PROPRIETARIO = [
  'fornecedor',
  'profissional',
  'outro_estabelecimento',
  'paciente',
] as const;
export type TipoProprietario = (typeof TIPOS_PROPRIETARIO)[number];
export const SITUACOES_RECEBIMENTO_TERCEIRO = [
  'recebido',
  'conferido',
  'em_reprocessamento',
  'disponivel',
  'devolvido',
  'divergente',
  'cancelado',
] as const;
export type SituacaoRecebimentoTerceiro = (typeof SITUACOES_RECEBIMENTO_TERCEIRO)[number];

export interface MaterialTerceiroEntrada {
  readonly descricao: string;
  readonly tipoProprietario: TipoProprietario;
  readonly fornecedor: number | null;
  readonly profissional: number | null;
  readonly quantidadePecas: number | null;
  readonly validadeDias: number | null;
  readonly expurgo: boolean;
  readonly lavagem: boolean;
  readonly desinfeccao: boolean;
  readonly preparo: boolean;
  readonly esterilizacao: boolean;
  readonly guardaArsenal: boolean;
  readonly arsenal: number | null;
}

/** Confere o cadastro do material de terceiro e o roteiro do reprocessamento. */
export function conferirMaterialTerceiro(m: MaterialTerceiroEntrada): ProblemaCme[] {
  const p: ProblemaCme[] = [];
  if (!m.descricao.trim()) p.push({ campo: 'descricao', mensagem: 'Informe a descrição do material.' });
  if (m.tipoProprietario === 'fornecedor' && m.fornecedor === null)
    p.push({
      campo: 'fornecedor',
      mensagem: 'O material do fornecedor ou consignado exige o fornecedor dono.',
    });
  if (m.tipoProprietario === 'profissional' && m.profissional === null)
    p.push({ campo: 'profissional', mensagem: 'O material do profissional exige o profissional dono.' });
  if (m.tipoProprietario !== 'fornecedor' && m.fornecedor !== null)
    p.push({ campo: 'fornecedor', mensagem: 'Só o material do fornecedor leva fornecedor dono.' });
  if (m.tipoProprietario !== 'profissional' && m.profissional !== null)
    p.push({ campo: 'profissional', mensagem: 'Só o material do profissional leva profissional dono.' });
  if (!m.lavagem && !m.desinfeccao && !m.esterilizacao)
    p.push({
      campo: 'roteiro',
      mensagem: 'O material de terceiro passa ao menos pela limpeza, desinfecção ou esterilização na CME.',
    });
  if (m.esterilizacao && !m.preparo)
    p.push({ campo: 'preparo', mensagem: 'A esterilização exige o preparo e a embalagem antes.' });
  if ((m.desinfeccao || m.esterilizacao) && !m.lavagem)
    p.push({ campo: 'lavagem', mensagem: 'A desinfecção e a esterilização exigem a limpeza antes.' });
  if (m.esterilizacao && (m.validadeDias === null || m.validadeDias <= 0))
    p.push({ campo: 'validadeDias', mensagem: 'Informe a validade da esterilização, em dias.' });
  if (m.guardaArsenal && m.arsenal === null)
    p.push({ campo: 'arsenal', mensagem: 'A guarda no arsenal exige o arsenal.' });
  if (m.quantidadePecas !== null && m.quantidadePecas <= 0)
    p.push({ campo: 'quantidadePecas', mensagem: 'A quantidade de peças é maior que zero.' });
  return p;
}

export interface ItemRecebimentoEntrada {
  readonly material: number;
  readonly quantidade: number;
  /** Do cadastro do material, lido pela porta. */
  readonly ativo: boolean;
  readonly tipoProprietario: TipoProprietario;
  readonly fornecedor: number | null;
}
export interface RecebimentoEntrada {
  readonly fornecedor: number | null;
  readonly entregador: string | null;
  readonly itens: readonly ItemRecebimentoEntrada[];
}

/** Confere o recebimento do material de terceiro na CME. */
export function conferirRecebimento(r: RecebimentoEntrada): ProblemaCme[] {
  const p: ProblemaCme[] = [];
  if (!r.itens.length) p.push({ campo: 'itens', mensagem: 'O recebimento tem ao menos um item.' });
  if (!r.entregador?.trim())
    p.push({ campo: 'entregador', mensagem: 'Identifique quem entregou o material na CME.' });
  const vistos = new Set<number>();
  r.itens.forEach((i, n) => {
    const campo = `itens.${n}`;
    if (vistos.has(i.material))
      p.push({ campo, mensagem: 'O mesmo material aparece duas vezes no recebimento.' });
    vistos.add(i.material);
    if (!i.ativo) p.push({ campo, mensagem: 'O material está inativo.' });
    if (!(i.quantidade > 0)) p.push({ campo, mensagem: 'A quantidade recebida é maior que zero.' });
    if (i.tipoProprietario === 'fornecedor' && r.fornecedor !== null && i.fornecedor !== r.fornecedor)
      p.push({ campo, mensagem: 'O material é de outro fornecedor.' });
  });
  return p;
}

export interface ItemConferido {
  readonly sequencia: number;
  readonly conferido: boolean;
  readonly divergencia: string | null;
}

/** Desfecho da conferência peça a peça do recebimento. */
export function desfechoDaConferencia(
  situacao: string,
  sequencias: readonly number[],
  itens: readonly ItemConferido[],
): { situacao: 'conferido' | 'divergente'; problemas: ProblemaCme[] } {
  const problemas: ProblemaCme[] = [];
  if (situacao !== 'recebido' && situacao !== 'divergente')
    problemas.push({ campo: 'situacao', mensagem: 'Só o recebimento recebido ou divergente é conferido.' });
  const dados = new Map(itens.map((i) => [i.sequencia, i]));
  for (const s of sequencias)
    if (!dados.has(s))
      problemas.push({ campo: `itens.${s}`, mensagem: 'Confira todos os itens do recebimento.' });
  for (const i of itens) {
    if (!sequencias.includes(i.sequencia))
      problemas.push({ campo: `itens.${i.sequencia}`, mensagem: 'O item não é deste recebimento.' });
    if (!i.conferido && !i.divergencia?.trim())
      problemas.push({ campo: `itens.${i.sequencia}`, mensagem: 'Item não conferido exige a divergência.' });
  }
  const ok = itens.every((i) => i.conferido && !i.divergencia?.trim());
  return { situacao: ok ? 'conferido' : 'divergente', problemas };
}

/** Confere o envio do recebimento ao reprocessamento; devolve as sequências que viram pacote. */
export function conferirEnvio(
  situacao: string,
  itens: readonly { sequencia: number; esterilizacao: boolean; ativo: boolean }[],
): { pacotes: number[]; problemas: ProblemaCme[] } {
  const problemas: ProblemaCme[] = [];
  if (situacao !== 'conferido')
    problemas.push({
      campo: 'situacao',
      mensagem: 'Só o recebimento conferido sem divergência vai ao reprocessamento.',
    });
  if (itens.some((i) => !i.ativo))
    problemas.push({ campo: 'itens', mensagem: 'Há material inativo no recebimento.' });
  return { pacotes: itens.filter((i) => i.esterilizacao).map((i) => i.sequencia), problemas };
}

/** Confere se o material reprocessado está disponível para a cirurgia (todos os pacotes estéreis). */
export function conferirDisponibilidade(situacao: string, pacotes: readonly string[]): ProblemaCme[] {
  const p: ProblemaCme[] = [];
  if (situacao !== 'em_reprocessamento')
    p.push({ campo: 'situacao', mensagem: 'Só o recebimento em reprocessamento fica disponível.' });
  if (pacotes.some((s) => s === 'rejeitado' || s === 'descartado' || s === 'vencido'))
    p.push({ campo: 'pacotes', mensagem: 'Há pacote rejeitado, vencido ou descartado: reprocesse antes.' });
  else if (pacotes.some((s) => s !== 'esteril' && s !== 'distribuido' && s !== 'usado'))
    p.push({ campo: 'pacotes', mensagem: 'Há pacote ainda não esterilizado.' });
  return p;
}

export interface ItemDevolvido {
  readonly sequencia: number;
  readonly recebida: number;
  readonly utilizada: number;
  readonly devolvida: number;
  readonly conferido: boolean;
}

/** Confere a devolução do material de terceiro ao dono. */
export function conferirDevolucao(d: {
  readonly situacao: string;
  readonly recebedor: string | null;
  readonly temPaciente: boolean;
  readonly sequencias: readonly number[];
  readonly itens: readonly ItemDevolvido[];
}): ProblemaCme[] {
  const p: ProblemaCme[] = [];
  if (!['conferido', 'disponivel', 'divergente'].includes(d.situacao))
    p.push({
      campo: 'situacao',
      mensagem:
        'Só se devolve o material conferido, divergente ou já reprocessado (nunca no meio do reprocessamento).',
    });
  if (!d.recebedor?.trim()) p.push({ campo: 'recebedor', mensagem: 'Identifique quem retirou o material.' });
  const vistas = new Set(d.itens.map((i) => i.sequencia));
  for (const s of d.sequencias)
    if (!vistas.has(s)) p.push({ campo: `itens.${s}`, mensagem: 'Confira todos os itens na devolução.' });
  for (const i of d.itens) {
    const campo = `itens.${i.sequencia}`;
    if (!d.sequencias.includes(i.sequencia)) p.push({ campo, mensagem: 'O item não é deste recebimento.' });
    if (i.utilizada < 0 || i.devolvida < 0) p.push({ campo, mensagem: 'Quantidade negativa.' });
    if (i.utilizada + i.devolvida !== i.recebida)
      p.push({ campo, mensagem: 'Utilizado mais devolvido tem de somar o recebido.' });
    if (!i.conferido) p.push({ campo, mensagem: 'Confira o item na devolução.' });
    // Só o material já reprocessado chega ao paciente: o conferido ou divergente volta ao dono sem uso.
    if (i.utilizada > 0 && (d.situacao === 'conferido' || d.situacao === 'divergente'))
      p.push({
        campo,
        mensagem: 'O material não reprocessado pela CME não pode constar como utilizado: devolva-o inteiro.',
      });
    if (i.utilizada > 0 && !d.temPaciente)
      p.push({
        campo,
        mensagem: 'O material utilizado exige o paciente no recebimento, para a rastreabilidade.',
      });
  }
  return p;
}
