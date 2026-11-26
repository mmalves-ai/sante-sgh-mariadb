// Cliente dos dados demográficos do paciente (F3.1, 02-CAD linha 15): leitura do bloco com os vocabulários, gravação
// do bloco inteiro, busca da ocupação e vulnerabilidades. As respostas são as do controlador da API
// (demografia-paciente.controller.ts); a gravação leva CSRF e Idempotency-Key.
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };
const objeto = z.record(z.string(), z.unknown());

export interface OpcaoDemografia {
  id: number;
  descricao: string;
  /** A raça/cor exige etnia, a capacidade exige responsável legal, a identidade pede nome social. */
  marca: boolean;
}
export const CAMPOS_OPCAO = [
  'identidadeGenero',
  'racaCor',
  'povoIndigena',
  'escolaridade',
  'religiao',
  'nacionalidade',
  'paisNascimento',
  'capacidadeCivil',
  'orientacaoSexual',
  'situacaoFamiliar',
  'idiomaIndigena',
] as const;
export type CampoOpcao = (typeof CAMPOS_OPCAO)[number];

export interface Vulnerabilidade {
  id: number;
  condicao: { id: number; descricao: string };
  declaradaEm: string;
  informanteTipo: string;
  informanteNome: string | null;
  fim: string | null;
  vigente: boolean;
  observacao: string | null;
}
export type Demografia = Record<CampoOpcao, number | null> & {
  paciente: number;
  hoje: string;
  nome: string;
  usaNomeSocial: boolean;
  nomeSocial: string | null;
  ocupacao: { id: number; descricao: string } | null;
  temRepresentanteVigente: boolean;
  opcoes: Record<CampoOpcao, OpcaoDemografia[]> & {
    condicoesVulnerabilidade: OpcaoDemografia[];
    /** Doenças crônicas por CID-10 (a descrição já traz o código entre parênteses). */
    condicoesCronicas: OpcaoDemografia[];
    informantes: string[];
  };
  vulnerabilidades: Vulnerabilidade[];
  /** Doenças crônicas referidas no cadastro (declaração, não diagnóstico), com a mesma forma da vulnerabilidade. */
  condicoesCronicas: Vulnerabilidade[];
  /**
   * Sem `cadastro.paciente.verSensivel` (LGPD art. 5º II): raça/cor, povo e língua indígena, religião e orientação
   * sexual vêm nulos, as declarações vazias, e a gravação mantém o que está no banco.
   */
  sensivelRestrito: boolean;
};
export type GravacaoDemografia = Record<CampoOpcao, number | null> & {
  usaNomeSocial: boolean;
  nomeSocial: string | null;
  ocupacao: number | null;
};

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function pedir<T>(url: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const r = await fetch(
    url,
    metodo === 'GET'
      ? { headers: JSON_ACEITO }
      : {
          method: metodo,
          headers: {
            ...JSON_ACEITO,
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

const C = '/api/cadastros';
export const lerDemografia = (p: number) => pedir<Demografia>(`${C}/pacientes/${p}/demografia`);
export const gravarDemografia = (p: number, c: GravacaoDemografia) =>
  pedir<{ id: number }>(`${C}/pacientes/${p}/demografia`, 'PUT', c);
export const buscarOcupacoes = (termo: string) =>
  pedir<{ itens: { id: number; descricao: string }[] }>(
    `${C}/ocupacoes-em-uso?${new URLSearchParams({ termo })}`,
  );
export const declararVulnerabilidade = (p: number, c: Record<string, unknown>) =>
  pedir<{ id: number }>(`${C}/pacientes/${p}/vulnerabilidades`, 'POST', c);
export const encerrarVulnerabilidade = (p: number, id: number, fim: string) =>
  pedir<{ id: number }>(`${C}/pacientes/${p}/vulnerabilidades/${id}/encerrar`, 'POST', { fim });
export const declararCondicaoCronica = (p: number, c: Record<string, unknown>) =>
  pedir<{ id: number }>(`${C}/pacientes/${p}/condicoes-cronicas`, 'POST', c);
export const encerrarCondicaoCronica = (p: number, id: number, fim: string) =>
  pedir<{ id: number }>(`${C}/pacientes/${p}/condicoes-cronicas/${id}/encerrar`, 'POST', { fim });

export type PendenciaDemografia =
  'nomeSocial' | 'nomeSocialIgual' | 'povoIndigena' | 'idiomaIndigena' | 'capacidadeCivil';

/** O que impede a gravação, conferido na tela antes de ir ao servidor (a regra é a mesma do domínio). */
export function pendenciasDemografia(
  f: GravacaoDemografia,
  d: Pick<Demografia, 'nome' | 'opcoes' | 'temRepresentanteVigente' | 'capacidadeCivil'>,
): PendenciaDemografia[] {
  const p: PendenciaDemografia[] = [];
  const plano = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const social = (f.nomeSocial ?? '').trim();
  if (f.usaNomeSocial && social === '') p.push('nomeSocial');
  else if (social !== '' && plano(social) === plano(d.nome)) p.push('nomeSocialIgual');
  if (exigeEtnia(f.racaCor, d) && f.povoIndigena === null) p.push('povoIndigena');
  if (!exigeEtnia(f.racaCor, d) && f.idiomaIndigena !== null) p.push('idiomaIndigena');
  const capacidade = d.opcoes.capacidadeCivil.find((o) => o.id === f.capacidadeCivil);
  if (capacidade?.marca && f.capacidadeCivil !== d.capacidadeCivil && !d.temRepresentanteVigente)
    p.push('capacidadeCivil');
  return p;
}

/** A raça/cor escolhida exige o povo indígena (etnia). */
export const exigeEtnia = (racaCor: number | null, d: Pick<Demografia, 'opcoes'>): boolean =>
  d.opcoes.racaCor.find((o) => o.id === racaCor)?.marca === true;
