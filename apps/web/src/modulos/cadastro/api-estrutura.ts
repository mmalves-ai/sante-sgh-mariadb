// Cliente da manutenção da estrutura e da configuração TISS (F3.1, 02-CAD linhas 25, 26 e 27). Respostas do
// estrutura-gestao.controller.ts da API; a gravação leva CSRF e Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const objeto = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);
const chave = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function pedir<T>(url: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const aceito = { accept: 'application/json' };
  const r = await fetch(
    url,
    metodo === 'GET'
      ? { headers: aceito }
      : {
          method: metodo,
          headers: {
            ...aceito,
            'content-type': 'application/json',
            'x-csrf': tokenCsrf(),
            'idempotency-key': chave(),
          },
          body: JSON.stringify(corpo ?? {}),
        },
  );
  if (!r.ok) throw await erroDaResposta(r);
  return objeto.parse(await r.json()) as T;
}

export interface Opcao {
  id: number;
  nome: string;
}
export interface Ramal {
  id: number | null;
  ramal: string;
  contato: string | null;
  principal: boolean;
  responsavel: boolean;
  telefoneExterno: string | null;
  observacao: string | null;
}
export interface Estabelecimento {
  id: number;
  versao: number;
  codigo: string | null;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  cnpj: string | null;
  inscricaoEstadual: string | null;
  inscricaoMunicipal: string | null;
  cnes: string | null;
  tipo: number | null;
  porte: number | null;
  esfera: number | null;
  hospitalDia: boolean;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  telefone: string | null;
  email: string | null;
  site: string | null;
  inicioAtividade: string | null;
  fimAtividade: string | null;
}
export interface Unidade {
  id: number;
  versao: number;
  codigo: string;
  nome: string;
  nomeCompleto: string | null;
  sigla: string | null;
  tipo: string;
  cnes: string | null;
  cnpj: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  telefone: string | null;
  orientacaoAcesso: string | null;
  ativo: boolean;
}
export interface Setor {
  id: number;
  versao: number;
  codigo: string;
  nome: string;
  sigla: string | null;
  tipo: string;
  superior: number | null;
  unidade: number | null;
  centroCusto: number | null;
  centroCustoNome: string | null;
  responsavel: number | null;
  responsavelNome: string | null;
  responsavelInicio: string | null;
  responsavelFim: string | null;
  ramalPrincipal: string | null;
  podeSolicitarExames: boolean;
  aceitaLancamentoConta: boolean;
  producaoFaturada: boolean;
  exigeProfissionalAgendamento: boolean;
  exigeRecursoAgendamento: boolean;
  siglaAgendamento: string | null;
  observacaoAgendamento: string | null;
  ativo: boolean;
  dataInativacao: string | null;
  /** Histórico de quem respondeu pelo setor, do mais recente ao mais antigo (fim nulo = sem fim). */
  responsaveis: {
    id: number;
    profissional: number;
    nome: string | null;
    inicio: string;
    fim: string | null;
  }[];
  ramais: Ramal[];
}
export interface Estrutura {
  estabelecimento: Estabelecimento;
  unidades: Unidade[];
  setores: Setor[];
  opcoes: { tipos: Opcao[]; portes: Opcao[]; esferas: Opcao[]; centrosCusto: Opcao[] };
}

const E = '/api/cadastros/estrutura-gestao';
type Gravado = { id: number };
export type Corpo = Record<string, unknown>;

export const lerEstrutura = () => pedir<Estrutura>(E);
export const buscarProfissionais = (termo: string) =>
  pedir<Opcao[]>(`${E}/profissionais?termo=${encodeURIComponent(termo)}`);
export const alterarEstabelecimento = (c: Corpo) => pedir<Gravado>(`${E}/estabelecimento`, 'PUT', c);
export const gravarUnidade = (id: number | null, c: Corpo) =>
  id ? pedir<Gravado>(`${E}/unidades/${id}`, 'PUT', c) : pedir<Gravado>(`${E}/unidades`, 'POST', c);
export const situacaoUnidade = (id: number, c: Corpo) =>
  pedir<Gravado>(`${E}/unidades/${id}/situacao`, 'POST', c);
export const gravarSetor = (id: number | null, c: Corpo) =>
  id ? pedir<Gravado>(`${E}/setores/${id}`, 'PUT', c) : pedir<Gravado>(`${E}/setores`, 'POST', c);
export const situacaoSetor = (id: number, c: Corpo) =>
  pedir<Gravado>(`${E}/setores/${id}/situacao`, 'POST', c);

// ── TISS ──

export interface ConfiguracaoTiss extends Corpo {
  id: number;
  versao: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
}
export interface FaixaGuia {
  id: number;
  versao: number;
  tipoGuia: string;
  formaGeracao: string;
  prefixo: string | null;
  tamanhoFixo: number | null;
  numeroInicial: number;
  numeroFinal: number;
  proximoNumero: number;
  usados: number;
  restantes: number;
  noFim: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  situacao: string;
}
export interface PainelTiss {
  fontes: Opcao[];
  versoes: Opcao[];
  configuracoes: ConfiguracaoTiss[];
  faixas: FaixaGuia[];
}
const T = '/api/cadastros/tiss-configuracao';
export const lerPainelTiss = (fonte: number | null) => pedir<PainelTiss>(fonte ? `${T}?fonte=${fonte}` : T);
export const gravarConfiguracaoTiss = (id: number | null, c: Corpo) =>
  id ? pedir<Gravado>(`${T}/${id}`, 'PUT', c) : pedir<Gravado>(T, 'POST', c);
export const incluirFaixa = (c: Corpo) => pedir<Gravado>(`${T}/faixas`, 'POST', c);
export const encerrarFaixa = (id: number, c: Corpo) =>
  pedir<Gravado>(`${T}/faixas/${id}/encerrar`, 'POST', c);
