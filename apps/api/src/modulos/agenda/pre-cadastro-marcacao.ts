// 02-AGE 42 e 44: o pré-cadastro da marcação sem prontuário, comum à agenda de consultas e à de exames. Lê os
// pendentes do estabelecimento com o mesmo nascimento (a regra do domínio decide o reaproveitamento) e grava o
// pré-cadastro novo na MESMA transação da marcação. Na chegada, `cadastro.converterPreCadastro` passa as marcações
// ao paciente; o pré-cadastro nunca é apagado.
import { decidirPreCadastroDaMarcacao, type PessoaSemProntuario } from '@sgh/dominio-agenda';
import { recusa, type TxOperacao } from '@sgh/nucleo';

/** Data civil (AAAA-MM-DD) do instante no fuso do estabelecimento. */
export function dataNoFuso(fuso: string, agora: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * Pré-cadastro da pessoa para a marcação: reaproveita o pendente da mesma pessoa ou inclui um novo, com a fonte
 * pagadora da marcação. Recusa na hora o dado mínimo inválido, com o campo.
 */
export async function preCadastroDaMarcacao(
  tx: TxOperacao,
  p: { estabelecimento: number; pessoa: PessoaSemProntuario; hoje: string; fontePagadora: number },
): Promise<{ id: number; novo: boolean }> {
  const pendentes = await tx.consultarParaAtualizar(
    `SELECT id, nome, data_nascimento, telefone, celular FROM pre_cadastro
      WHERE estabelecimento_id = ? AND data_nascimento = ? AND situacao = 'pendente' AND excluido_em IS NULL
      ORDER BY id LIMIT 50`,
    [p.estabelecimento, p.pessoa.nascimento],
    { teto: 50 },
  );
  const d = decidirPreCadastroDaMarcacao(
    p.pessoa,
    p.hoje,
    pendentes.map((x) => ({
      id: Number(x['id']),
      nome: String(x['nome']),
      nascimento: iso(x['data_nascimento']),
      telefone: textoOuNulo(x['telefone']),
      celular: textoOuNulo(x['celular']),
    })),
  );
  if (!d.ok) throw recusa(d.codigo, d.motivo, { campos: [d.campo] });
  if (d.acao === 'reaproveitar') return { id: d.preCadastro, novo: false };
  const id = await tx.incluir('pre_cadastro', {
    estabelecimento_id: p.estabelecimento,
    nome: d.nome,
    data_nascimento: p.pessoa.nascimento,
    telefone: d.telefone,
    celular: d.celular,
    fonte_pagadora_id: p.fontePagadora,
    situacao: 'pendente',
  });
  return { id, novo: true };
}
