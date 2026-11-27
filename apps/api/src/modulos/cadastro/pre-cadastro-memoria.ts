// 02-AGE 42 (C1-101): a conversão do pré-cadastro na fonte sintética (dev/ci, sem banco do cliente). O pré-cadastro e as
// marcações sem prontuário estão na agenda em memória; o paciente escolhido vem do cadastro em memória. A decisão é a
// mesma do domínio (decidirConversao) que a porta própria usa: a recusa, a divergência que exige motivo e a ligação.
// A memória não tem CPF no pré-cadastro da marcação, então a prévia sem escolha pede a busca do paciente.
import { decidirConversao, type PacienteEscolhido } from '@sgh/dominio-cadastro';
import { ErroOperacao } from '@sgh/nucleo';
import { agendaMemoriaAtual } from '../agenda/public-api.js';
import type { SessaoCadastro } from './comum.js';
import { cadastroMemoriaAtual } from './porta-memoria.js';

/** Há conversão em memória quando a agenda e o cadastro sintéticos estão montados no processo. */
export function conversaoEmMemoria(): boolean {
  return agendaMemoriaAtual() !== null && cadastroMemoriaAtual() !== null;
}

function preCadastro(s: SessaoCadastro, id: number) {
  const pre = agendaMemoriaAtual()?.preCadastroMemoria(s.hospital, id) ?? null;
  if (!pre)
    throw new ErroOperacao(404, 'nao-encontrado', 'Pré-cadastro não encontrado', 'Confira o pré-cadastro.');
  return pre;
}

async function escolhido(
  s: SessaoCadastro,
  id: number,
): Promise<PacienteEscolhido & { readonly prontuario: number }> {
  const [p] = (await cadastroMemoriaAtual()?.lerPacientes(s.porta, [id])) ?? [];
  if (!p)
    throw new ErroOperacao(404, 'nao-encontrado', 'Paciente não encontrado', 'Confira o paciente escolhido.');
  return {
    id: p.id,
    nome: p.nome,
    nascimento: p.nascimento,
    cpf: p.cpf === null ? null : String(p.cpf),
    prontuario: p.prontuario,
  };
}

export async function previaConversaoMemoria(s: SessaoCadastro, id: number, paciente: number | null) {
  const pre = preCadastro(s, id);
  const d = decidirConversao(
    { nascimento: pre.nascimento, nome: pre.nome, cpf: null },
    [],
    paciente ? await escolhido(s, paciente) : null,
  );
  return {
    acao: d.acao,
    paciente: d.acao === 'vincular' ? d.paciente : null,
    codigo: d.acao === 'recusar' ? d.codigo : null,
    mensagem: d.acao === 'recusar' ? d.mensagem : null,
    divergencias: d.acao === 'cadastrar' ? [] : [...(d.divergencias ?? [])],
    rascunho:
      d.acao === 'cadastrar'
        ? {
            nome: pre.nome,
            nascimento: pre.nascimento,
            cpf: null,
            celular: pre.celular,
            telefone: pre.telefone,
            email: null,
          }
        : null,
  };
}

export async function converterPreCadastroMemoria(
  s: SessaoCadastro,
  e: { id: number; paciente?: number | null; motivoDivergencia?: string | null },
): Promise<{ paciente: number; marcacoes: number; cobertura: number | null }> {
  const pre = preCadastro(s, e.id);
  if (pre.situacao !== 'pendente')
    throw new ErroOperacao(
      409,
      'pre-cadastro-nao-pendente',
      'Pré-cadastro já tratado',
      'O pré-cadastro já foi convertido ou cancelado.',
    );
  if (!e.paciente)
    throw new ErroOperacao(
      409,
      'escolha-o-paciente',
      'Escolha o paciente',
      'Na fonte sintética, a conversão liga a um paciente escolhido na busca.',
    );
  const p = await escolhido(s, e.paciente);
  const d = decidirConversao(
    { nascimento: pre.nascimento, nome: pre.nome, cpf: null },
    [],
    p,
    e.motivoDivergencia ?? null,
  );
  if (d.acao === 'recusar') throw new ErroOperacao(409, d.codigo, 'Conversão recusada', d.mensagem);
  const marcacoes = agendaMemoriaAtual()?.converterPreCadastroMemoria(s.hospital, e.id, p) ?? 0;
  return { paciente: p.id, marcacoes, cobertura: null };
}
