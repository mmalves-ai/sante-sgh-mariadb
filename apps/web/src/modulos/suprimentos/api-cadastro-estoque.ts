// Cliente do cadastro do estoque (F3.6, 05-SUP linhas 1, 3 e 6). As gravações levam o CSRF; a recusa volta como
// problema com os campos (a tela mostra no campo).
import type {
  ItemEstoqueEntrada,
  LinhaSeparacao,
  LocalEstoqueEntrada,
  PermissaoLocalUsuario,
} from '@sgh/contratos/regras-suprimentos';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const B = '/api/suprimentos/cadastro';

export interface Opcao {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly grupo?: number;
}
export interface ApoioCadastroEstoque {
  readonly hoje: string;
  readonly grupos: Opcao[];
  readonly subgrupos: Opcao[];
  readonly unidades: Opcao[];
  readonly vias: Opcao[];
  readonly setores: Opcao[];
  readonly centrosCusto: Opcao[];
  readonly locais: Opcao[];
  readonly guardas: Opcao[];
  readonly diluentes: Opcao[];
  /** As classificações de despesa ativas: a concessão só por despesa cobre os grupos ligados a ela. */
  readonly despesas?: Opcao[];
}
export interface FichaItemEdicao extends ItemEstoqueEntrada {
  readonly id: number;
  readonly versao: number;
  readonly situacao: 'ativo' | 'inativo' | 'em_analise';
  readonly saldoTotal: number;
  readonly registrosNaData: readonly (string | null)[];
  readonly nomesPrincipios: Readonly<Record<number, string>>;
  readonly nomesFabricantes: Readonly<Record<number, string>>;
}
export interface LocalResumo {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly ativo: boolean;
  readonly versao: number;
  readonly usuarios: number;
}
export interface FichaLocalEdicao extends LocalEstoqueEntrada {
  readonly id: number;
  readonly versao: number;
  readonly ativo: boolean;
}
export interface ConcessaoVigente {
  readonly id: number;
  /** A classificação de despesa da concessão só por despesa (nula na concessão por grupo). */
  readonly despesa?: number | null;
  readonly nome: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly permissoes: string[];
  readonly vigente: boolean;
}
export interface EscopoCompletoUsuario {
  readonly usuario: number;
  readonly login: string;
  readonly nome: string;
  readonly locais: {
    local: number;
    codigo: string;
    nome: string;
    permissoes: PermissaoLocalUsuario[];
    variacaoValorPct: number | null;
    padrao: boolean;
  }[];
  readonly classificacoes: ConcessaoVigente[];
  readonly centrosCusto: ConcessaoVigente[];
}
export interface ListaSeparacao {
  readonly requisicao: number;
  readonly numero: number;
  readonly situacao: string;
  readonly tipo: string;
  readonly local: { readonly id: number; readonly codigo: string; readonly nome: string };
  readonly destino: string;
  readonly solicitadoEm: string;
  readonly urgente: boolean;
  readonly geradaEm: string;
  readonly linhas: LinhaSeparacao[];
  readonly totalFalta: number;
}

async function ler<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}
async function enviar<T>(metodo: 'POST' | 'PUT', url: string, corpo: unknown = {}): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-csrf': tokenCsrf() },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}
type Versao = { id: number; versao: number };

export const apoioCadastroEstoque = () => ler<ApoioCadastroEstoque>(`${B}/apoio`);
export const buscarCadastro = (tipo: 'principios' | 'fabricantes' | 'usuarios', termo: string) =>
  ler<Opcao[]>(`${B}/buscar/${tipo}?termo=${encodeURIComponent(termo)}`);
export const fichaItemEdicao = (id: number) => ler<FichaItemEdicao>(`${B}/itens/${id}`);
export const incluirItem = (e: ItemEstoqueEntrada) => enviar<Versao>('POST', `${B}/itens`, e);
export const alterarItem = (id: number, versao: number, e: ItemEstoqueEntrada) =>
  enviar<Versao>('PUT', `${B}/itens/${id}`, { ...e, versao });
export const situacaoItem = (id: number, versao: number, ativo: boolean, motivo: string) =>
  enviar<Versao>('POST', `${B}/itens/${id}/situacao`, { versao, ativo, motivo });
export const listarLocaisCadastro = () => ler<LocalResumo[]>(`${B}/locais`);
export const fichaLocalEdicao = (id: number) => ler<FichaLocalEdicao>(`${B}/locais/${id}`);
export const incluirLocal = (e: LocalEstoqueEntrada) => enviar<Versao>('POST', `${B}/locais`, e);
export const alterarLocal = (id: number, versao: number, e: LocalEstoqueEntrada) =>
  enviar<Versao>('PUT', `${B}/locais/${id}`, { ...e, versao });
export const situacaoLocal = (id: number, versao: number, ativo: boolean, motivo: string) =>
  enviar<Versao>('POST', `${B}/locais/${id}/situacao`, { versao, ativo, motivo });
export const escopoDoUsuario = (u: number) => ler<EscopoCompletoUsuario>(`${B}/usuarios/${u}`);
export const gravarEscopoLocal = (u: number, local: number, permissoes: PermissaoLocalUsuario[]) =>
  enviar<{ id: number }>('PUT', `${B}/usuarios/${u}/locais/${local}`, { permissoes });
export const retirarEscopoLocal = (u: number, local: number) =>
  enviar<{ id: number }>('POST', `${B}/usuarios/${u}/locais/${local}/retirar`);
export const concederClassificacao = (
  u: number,
  e: {
    grupo?: number | null;
    classificacaoDespesa?: number | null;
    inicio: string;
    fim?: string | null;
    requisitar: boolean;
    movimentar: boolean;
    comprar: boolean;
  },
) => enviar<{ id: number }>('POST', `${B}/usuarios/${u}/classificacoes`, e);
export const concederCentroCusto = (
  u: number,
  e: { centroCusto: number; inicio: string; fim?: string | null; requisitar: boolean; movimentar: boolean },
) => enviar<{ id: number }>('POST', `${B}/usuarios/${u}/centros-custo`, e);
export const retirarConcessao = (tipo: 'classificacao' | 'centro-custo', id: number, motivo: string) =>
  enviar<{ id: number; fim: string | null; cancelada: boolean }>(
    'POST',
    `${B}/concessoes/${tipo}/${id}/retirar`,
    { motivo },
  );
export const listaSeparacao = (id: number) => ler<ListaSeparacao>(`${B}/requisicoes/${id}/separacao`);
