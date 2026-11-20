// Cliente das telas do cadastro (M11), validado pelos contratos. As gravações mandam o CSRF (token duplo) e a
// Idempotency-Key (uma por pedido). Problem Details viram ErroApi (mensagem em português na tela).
import {
  type AlteracoesPaciente,
  type AlteracoesProfissional,
  type CadastrarProfissionalEntrada,
  type CredenciamentoProfissionalEntrada,
  type DependenciasProfissional,
  esquemaDependenciasProfissional,
  esquemaEventoProfissional,
  esquemaLoginsProfissional,
  type EventoProfissional,
  type LoginsProfissional,
  type EspecialidadeProfissionalEntrada,
  esquemaOpcoesProfissional,
  esquemaProfissionalGravado,
  esquemaRegistroProfissionalGravado,
  type LotacaoProfissionalEntrada,
  type OpcoesProfissional,
  type ProfissionalGravado,
  type RegistroNovoProfissional,
  type RegistroProfissionalGravado,
  type CadastrarPacienteEntrada,
  type CandidatosCpf,
  type Consentimentos,
  type EnderecoCep,
  esquemaCandidatosCpf,
  esquemaEnderecoCep,
  esquemaGravacaoCadastro,
  esquemaConsentimentos,
  esquemaFichaPaciente,
  esquemaFichaProfissional,
  esquemaFilaDuplicidades,
  esquemaHistoricoCadastro,
  esquemaHistoricoProfissional,
  esquemaListaPessoas,
  esquemaListaProfissionais,
  esquemaListaSolicitantes,
  esquemaParDuplicidade,
  esquemaProcedimentosEspecialidade,
  esquemaResultadoBuscaPaciente,
  esquemaSiglasConselho,
  esquemaSolicitanteIncluido,
  type FichaPaciente,
  type FichaProfissional,
  type FilaDuplicidades,
  type GravacaoCadastro,
  type HistoricoCadastro,
  type HistoricoProfissional,
  type IncluirSolicitante,
  type ListaPessoas,
  type ListaProfissionais,
  type ListaSolicitantes,
  type ParDuplicidade,
  type PedidoConsentimento,
  type ProcedimentosEspecialidade,
  type ResultadoBuscaPaciente,
  type SiglasConselho,
  type SolicitanteIncluido,
  type TipoBuscaPaciente,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

function chaveIdempotencia(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function escrita(metodo: string, corpo?: unknown): RequestInit {
  return {
    method: metodo,
    headers: {
      ...JSON_ACEITO,
      ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
      'x-csrf': tokenCsrf(),
      'idempotency-key': chaveIdempotencia(),
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  };
}

const ler = async <T>(url: string, esquema: z.ZodType<T>, buscar: typeof fetch = fetch): Promise<T> =>
  lerJson(await buscar(url, { headers: JSON_ACEITO }), esquema);

const P = '/api/cadastros/pacientes';

export function buscarPacientes(
  termo: string,
  tipo: TipoBuscaPaciente = 'auto',
  inativos = false,
  buscar: typeof fetch = fetch,
): Promise<ResultadoBuscaPaciente> {
  const q = new URLSearchParams({ termo, tipo, ...(inativos ? { inativos: 'sim' } : {}) });
  return ler(`${P}?${q.toString()}`, esquemaResultadoBuscaPaciente, buscar);
}

export function candidatosPorCpf(cpf: string, buscar: typeof fetch = fetch): Promise<CandidatosCpf> {
  return ler(`${P}/candidatos?cpf=${encodeURIComponent(cpf)}`, esquemaCandidatosCpf, buscar);
}

export function lerFicha(id: number, buscar: typeof fetch = fetch): Promise<FichaPaciente> {
  return ler(`${P}/${id}`, esquemaFichaPaciente, buscar);
}

/** "Cadastrar paciente" grava agora para este login? (o motivo vem do servidor). */
export function lerGravacaoCadastro(buscar: typeof fetch = fetch): Promise<GravacaoCadastro> {
  return ler(`${P}/gravacao`, esquemaGravacaoCadastro, buscar);
}

/** Endereço pelo CEP; CEP inexistente devolve null (o campo avisa antes de salvar). */
export async function lerEnderecoCep(cep: string, buscar: typeof fetch = fetch): Promise<EnderecoCep | null> {
  const r = await buscar(`${P}/cep/${encodeURIComponent(cep)}`, { headers: JSON_ACEITO });
  if (r.status === 404) return null;
  return lerJson(r, esquemaEnderecoCep);
}

/** Revisão do M39: inclui o médico solicitante externo (conselho pela sigla; o servidor deduplica). */
export async function incluirSolicitante(
  e: IncluirSolicitante,
  buscar: typeof fetch = fetch,
): Promise<SolicitanteIncluido> {
  return lerJson(await buscar('/api/cadastros/solicitantes', escrita('POST', e)), esquemaSolicitanteIncluido);
}

export async function cadastrarPaciente(
  e: CadastrarPacienteEntrada | Record<string, unknown>,
  buscar: typeof fetch = fetch,
): Promise<{ idPaciente: number; prontuario: number }> {
  return lerJson(
    await buscar(P, escrita('POST', e)),
    z.object({ idPaciente: z.number(), prontuario: z.number() }),
  );
}

export async function alterarPaciente(
  id: number,
  versao: string,
  alteracoes: Partial<AlteracoesPaciente> | Record<string, unknown>,
  buscar: typeof fetch = fetch,
): Promise<{ idPaciente: number }> {
  return lerJson(
    await buscar(`${P}/${id}`, escrita('PUT', { versao, alteracoes })),
    z.object({ idPaciente: z.number() }),
  );
}

export function lerHistorico(
  id: number,
  pagina = 1,
  buscar: typeof fetch = fetch,
): Promise<HistoricoCadastro> {
  return ler(`${P}/${id}/historico?pagina=${pagina}`, esquemaHistoricoCadastro, buscar);
}

export function lerConsentimentos(id: number, buscar: typeof fetch = fetch): Promise<Consentimentos> {
  return ler(`${P}/${id}/consentimentos`, esquemaConsentimentos, buscar);
}

export async function gravarConsentimento(
  id: number,
  p: PedidoConsentimento,
  buscar: typeof fetch = fetch,
): Promise<{ id: number }> {
  return lerJson(await buscar(`${P}/${id}/consentimentos`, escrita('POST', p)), z.object({ id: z.number() }));
}

export function lerFila(
  situacao: FilaDuplicidades['itens'][number]['situacao'] = 'aberto',
  pagina = 1,
  buscar: typeof fetch = fetch,
): Promise<FilaDuplicidades> {
  return ler(`${P}/duplicidades?situacao=${situacao}&pagina=${pagina}`, esquemaFilaDuplicidades, buscar);
}

export function lerPar(id: number, buscar: typeof fetch = fetch): Promise<ParDuplicidade> {
  return ler(`${P}/duplicidades/${id}`, esquemaParDuplicidade, buscar);
}

export async function atualizarFila(buscar: typeof fetch = fetch): Promise<{ novos: number; total: number }> {
  return lerJson(
    await buscar(`${P}/duplicidades/atualizar`, escrita('POST')),
    z.object({ novos: z.number(), total: z.number() }),
  );
}

/** M57.2: "Unificar" o par da fila (`fica`: o lado que fica; a senha confirma a ação crítica). */
export async function unificarPar(
  id: number,
  pedido: { fica: 'a' | 'b'; justificativa: string; senha?: string },
  buscar: typeof fetch = fetch,
): Promise<{ idAbsorvido: number; idSobrevivente: number }> {
  return lerJson(
    await buscar(`${P}/duplicidades/${id}/unificar`, escrita('POST', pedido)),
    z.object({ idAbsorvido: z.number(), idSobrevivente: z.number() }),
  );
}

export async function decidirOutraPessoa(
  id: number,
  justificativa: string,
  buscar: typeof fetch = fetch,
): Promise<void> {
  await lerJson(
    await buscar(
      `${P}/duplicidades/${id}/decisao`,
      escrita('POST', { decisao: 'outra_pessoa', justificativa }),
    ),
    z.object({ id: z.number() }),
  );
}

export function buscarPessoas(documento: string, buscar: typeof fetch = fetch): Promise<ListaPessoas> {
  return ler(
    `/api/cadastros/pessoas?documento=${encodeURIComponent(documento)}`,
    esquemaListaPessoas,
    buscar,
  );
}

export function buscarProfissionais(
  termo: string,
  ativos = true,
  buscar: typeof fetch = fetch,
): Promise<ListaProfissionais> {
  const q = new URLSearchParams({ termo, ativos: ativos ? 'sim' : 'nao' });
  return ler(`/api/cadastros/profissionais?${q.toString()}`, esquemaListaProfissionais, buscar);
}

export function lerProfissional(id: number, buscar: typeof fetch = fetch): Promise<FichaProfissional> {
  return ler(`/api/cadastros/profissionais/${id}`, esquemaFichaProfissional, buscar);
}

export function lerHistoricoProfissional(
  id: number,
  pagina = 1,
  buscar: typeof fetch = fetch,
): Promise<HistoricoProfissional> {
  return ler(
    `/api/cadastros/profissionais/${id}/historico?pagina=${pagina}`,
    esquemaHistoricoProfissional,
    buscar,
  );
}

/** Solicitantes pelo nome (termo) ou pelo registro (conselho + UF + número; a busca da guia TISS). */
export function buscarSolicitantes(
  pedido: string | { conselho: string; uf: string; numero: string },
  buscar: typeof fetch = fetch,
): Promise<ListaSolicitantes> {
  const q =
    typeof pedido === 'string'
      ? new URLSearchParams({ termo: pedido })
      : new URLSearchParams({
          numero: pedido.numero,
          ...(pedido.conselho ? { conselho: pedido.conselho } : {}),
          ...(pedido.uf ? { uf: pedido.uf } : {}),
        });
  return ler(`/api/cadastros/solicitantes?${q.toString()}`, esquemaListaSolicitantes, buscar);
}

export function lerProcedimentos(
  especialidade: number,
  pagina = 1,
  buscar: typeof fetch = fetch,
): Promise<ProcedimentosEspecialidade> {
  return ler(
    `/api/cadastros/especialidades/${especialidade}/procedimentos?pagina=${pagina}`,
    esquemaProcedimentosEspecialidade,
    buscar,
  );
}

export function lerSiglas(buscar: typeof fetch = fetch): Promise<SiglasConselho> {
  return ler('/api/cadastros/conselhos/siglas', esquemaSiglasConselho, buscar);
}

// ── D-PROF-39: inclusão e edição do profissional do corpo clínico ──────────────────────────────────────

const PR = '/api/cadastros/profissionais';

export function lerOpcoesProfissional(buscar: typeof fetch = fetch): Promise<OpcoesProfissional> {
  return ler(`${PR}/opcoes`, esquemaOpcoesProfissional, buscar);
}

/** O corpo do formulário de inclusão (o CPF e o registro vão como o servidor valida). */
export type NovoProfissional = Omit<CadastrarProfissionalEntrada, 'registro'> & {
  registro: Omit<RegistroNovoProfissional, 'convenios'> & { convenios: number[] };
};

export async function incluirProfissional(
  e: NovoProfissional,
  buscar: typeof fetch = fetch,
): Promise<ProfissionalGravado> {
  return lerJson(await buscar(PR, escrita('POST', e)), esquemaProfissionalGravado);
}

export async function alterarDadosProfissional(
  id: number,
  versao: string,
  alteracoes: AlteracoesProfissional,
  buscar: typeof fetch = fetch,
): Promise<void> {
  await lerJson(await buscar(`${PR}/${id}`, escrita('PUT', { versao, alteracoes })), z.unknown());
}

export async function incluirRegistroProfissional(
  id: number,
  r: Omit<RegistroNovoProfissional, 'convenios'> & { convenios: number[] },
  buscar: typeof fetch = fetch,
): Promise<RegistroProfissionalGravado> {
  return lerJson(
    await buscar(`${PR}/${id}/registros`, escrita('POST', r)),
    esquemaRegistroProfissionalGravado,
  );
}

export async function alterarRegistroProfissional(
  id: number,
  registro: number,
  versao: string,
  alteracoes: { ativo?: boolean; conselho?: string; sigla?: number | null },
  buscar: typeof fetch = fetch,
  motivo?: string,
): Promise<void> {
  await lerJson(
    await buscar(
      `${PR}/${id}/registros/${registro}`,
      escrita('PUT', { versao, alteracoes, ...(motivo !== undefined ? { motivo } : {}) }),
    ),
    z.unknown(),
  );
}

export async function definirEspecialidadeProfissional(
  id: number,
  e: EspecialidadeProfissionalEntrada,
  buscar: typeof fetch = fetch,
): Promise<void> {
  await lerJson(await buscar(`${PR}/${id}/especialidades`, escrita('PUT', e)), z.unknown());
}

export async function lotarProfissional(
  id: number,
  e: LotacaoProfissionalEntrada,
  buscar: typeof fetch = fetch,
): Promise<void> {
  await lerJson(await buscar(`${PR}/${id}/lotacao`, escrita('PUT', e)), z.unknown());
}

export async function credenciarProfissional(
  id: number,
  e: CredenciamentoProfissionalEntrada,
  buscar: typeof fetch = fetch,
): Promise<void> {
  await lerJson(await buscar(`${PR}/${id}/credenciamentos`, escrita('PUT', e)), z.unknown());
}

// ── D-PROF-39 (requisitos do dono): login do profissional, inativar/reativar e exclusão só sem vínculo ──

export function lerLoginsProfissional(buscar: typeof fetch = fetch): Promise<LoginsProfissional> {
  return ler(`${PR}/logins`, esquemaLoginsProfissional, buscar);
}

export function lerEventosProfissional(
  id: number,
  buscar: typeof fetch = fetch,
): Promise<EventoProfissional[]> {
  return ler(`${PR}/${id}/eventos`, z.array(esquemaEventoProfissional), buscar);
}

export function lerVinculosProfissional(
  id: number,
  registro?: number,
  buscar: typeof fetch = fetch,
): Promise<DependenciasProfissional> {
  const q = registro === undefined ? '' : `?registro=${registro}`;
  return ler(`${PR}/${id}/vinculos${q}`, esquemaDependenciasProfissional, buscar);
}

/** Liga, troca (login novo) ou desliga (null) o login do registro; a senha de novo vai junto (crítica). */
export async function vincularLoginProfissional(
  id: number,
  e: { registro: number; login: string | null; versao: string; justificativa?: string },
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<{ registro: number; semRegistroAtivo: boolean }> {
  return lerJson(
    await buscar(`${PR}/${id}/login`, escrita('PUT', { ...e, senha })),
    z.object({ registro: z.number().int(), semRegistroAtivo: z.boolean() }),
  );
}

export async function situacaoProfissional(
  id: number,
  acao: 'inativar' | 'reativar',
  motivo: string,
  buscar: typeof fetch = fetch,
): Promise<void> {
  await lerJson(await buscar(`${PR}/${id}/${acao}`, escrita('POST', { motivo })), z.unknown());
}

export async function excluirProfissional(
  id: number,
  motivo: string,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<void> {
  await lerJson(await buscar(`${PR}/${id}/excluir`, escrita('POST', { motivo, senha })), z.unknown());
}

export async function excluirRegistroProfissional(
  id: number,
  registro: number,
  motivo: string,
  senha: string,
  buscar: typeof fetch = fetch,
): Promise<void> {
  await lerJson(
    await buscar(`${PR}/${id}/registros/${registro}/excluir`, escrita('POST', { motivo, senha })),
    z.unknown(),
  );
}
