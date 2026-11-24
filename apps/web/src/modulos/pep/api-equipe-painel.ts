// Cliente das rotas do painel no banco (acompanhados e colunas), da configuração do prontuário por setor e da equipe
// assistencial (F3.3, linhas 03-PEP L90, L91 e L94).
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const P = '/api/pep';

async function pedir<T>(
  url: string,
  metodo = 'GET',
  corpo?: unknown,
  buscar: typeof fetch = fetch,
): Promise<T> {
  const r = await buscar(url, {
    method: metodo,
    headers: {
      accept: 'application/json',
      ...(metodo === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf': tokenCsrf() }),
    },
    ...(metodo === 'GET' ? {} : { body: JSON.stringify(corpo ?? {}) }),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export interface Acompanhado {
  id: number;
  paciente: number;
  atendimento: number | null;
  inicio: string | null;
  motivo: string | null;
}
export const lerAcompanhados = () => pedir<{ itens: Acompanhado[] }>(`${P}/painel/acompanhados`);
export const acompanhar = (paciente: number, atendimento: number | null = null) =>
  pedir<{ id: number }>(`${P}/painel/acompanhados`, 'POST', { paciente, atendimento });
export const deixarDeAcompanhar = (paciente: number) =>
  pedir<{ id: number }>(`${P}/painel/acompanhados/${paciente}/fim`, 'POST');
export const lerColunas = () => pedir<{ colunas: string[] }>(`${P}/painel/colunas`);
export const gravarColunas = (colunas: readonly string[]) =>
  pedir<{ colunas: string[] }>(`${P}/painel/colunas`, 'PUT', { colunas });

export const lerFiltroPadrao = () => pedir<{ unidade: number | null }>(`${P}/painel/filtro-padrao`);
export const gravarFiltroPadrao = (unidade: number | null) =>
  pedir<{ id: number }>(`${P}/painel/filtro-padrao`, 'PUT', { unidade });

export type TipoAtendimento =
  'todos' | 'internacao' | 'pronto_atendimento' | 'ambulatorio' | 'hospital_dia' | 'externo';
export interface ConfiguracaoSetor {
  id?: number;
  setor: number;
  setorNome?: string;
  tipoAtendimento: TipoAtendimento;
  permiteRetroativo: boolean;
  toleranciaRetroativoHoras: number | null;
  assinaturaExigida: 'nenhuma' | 'eletronica' | 'digital_icp';
  exigeEvolucaoMedica: boolean;
  exigeEvolucaoEnfermagem: boolean;
  ativo: boolean;
  versao?: number | null;
}
export const lerConfiguracoesSetor = () =>
  pedir<{ itens: ConfiguracaoSetor[]; setores: { id: number; nome: string }[] }>(`${P}/prontuario-setor`);
export const gravarConfiguracaoSetor = (c: ConfiguracaoSetor) =>
  pedir<{ id: number }>(`${P}/prontuario-setor`, 'PUT', {
    setor: c.setor,
    tipoAtendimento: c.tipoAtendimento,
    permiteRetroativo: c.permiteRetroativo,
    toleranciaRetroativoHoras: c.toleranciaRetroativoHoras,
    assinaturaExigida: c.assinaturaExigida,
    exigeEvolucaoMedica: c.exigeEvolucaoMedica,
    exigeEvolucaoEnfermagem: c.exigeEvolucaoEnfermagem,
    ativo: c.ativo,
    versao: c.versao ?? null,
  });

export interface FuncaoEquipe {
  id: number;
  descricao: string;
  categoria: string;
  responsavelPrincipal: boolean;
}
export interface MembroEquipe {
  id: number;
  profissional: number;
  profissionalNome: string;
  funcao: number;
  funcaoDescricao: string;
  responsavelPrincipal: boolean;
  recebeNotificacao: boolean;
  inicio: string;
  fim: string | null;
  motivoSaida: string | null;
}
export const lerFuncoesEquipe = () => pedir<{ itens: FuncaoEquipe[] }>(`${P}/equipe/funcoes`);
export const lerEquipe = (atendimento: number) =>
  pedir<{ equipe: number | null; paciente: number; membros: MembroEquipe[] }>(
    `${P}/equipe/atendimento/${atendimento}`,
  );
export const incluirMembro = (
  atendimento: number,
  m: { profissional: number; funcao: number; especialidade: number | null; recebeNotificacao: boolean },
) => pedir<{ id: number }>(`${P}/equipe/atendimento/${atendimento}`, 'POST', m);
export const lerEspecialidadesProfissional = (profissional: number) =>
  pedir<{ itens: { id: number; descricao: string }[] }>(
    `${P}/equipe/profissional/${profissional}/especialidades`,
  );
export const encerrarEquipe = (atendimento: number, motivo: string) =>
  pedir<{ id: number; membros: number }>(`${P}/equipe/atendimento/${atendimento}/encerramento`, 'POST', {
    motivo,
  });
export const encerrarMembro = (membro: number, motivo: string) =>
  pedir<{ id: number }>(`${P}/equipe/membro/${membro}/saida`, 'POST', { motivo });
