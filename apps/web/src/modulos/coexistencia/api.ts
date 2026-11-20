// Cliente das telas "Migração gradual dos usuários" (M37) e do diálogo "Abrir chamado", validado pelos contratos. As
// gravações mandam o CSRF (token duplo) e a Idempotency-Key; Problem Details viram ErroApi (mensagem em português).
import {
  esquemaPainelDesligamento,
  esquemaResumoEnsaioFirebird5,
  esquemaResumoEnsaioUtf8,
  esquemaPainelJanela,
  esquemaResultadoRegistroDesligamento,
  type PainelDesligamento,
  type RegistrarItemDesligamento,
  type ResultadoRegistroDesligamento,
  type ResumoEnsaioFirebird5,
  type ResumoEnsaioUtf8,
  type PainelJanela,
  esquemaRevisaoFimCoexistencia,
  esquemaTelaFimCoexistencia,
  type RevisaoFimCoexistencia,
  type TelaFimCoexistencia,
  type AbrirChamado,
  type ChamadoLido,
  esquemaChamadoLido,
  esquemaGuiaTreino,
  esquemaListaChamados,
  esquemaPainelConducao,
  esquemaPainelIndicadores,
  esquemaPainelSetores,
  esquemaPainelTreino,
  esquemaPaginaPessoas,
  esquemaResultadoConducao,
  esquemaResultadoLoteCoex,
  type EditarSetor,
  type GuiaTreino,
  type ListaChamados,
  type PainelConducao,
  type PainelIndicadores,
  type PainelSetores,
  type PainelTreino,
  type PaginaPessoas,
  type PedidoLoteCoex,
  type RegistrarConclusao,
  type ResultadoConducao,
  type ResultadoLoteCoex,
  type TriarChamado,
  esquemaPainelOnda1,
  esquemaPainelOnda2,
  esquemaPainelMigracaoOnda3,
  type PainelMigracaoOnda3,
  esquemaPainelMigracaoOnda4,
  type PainelMigracaoOnda4,
  esquemaAcompanhamentoOnda2,
  type AcompanhamentoOnda2,
  type GravarItensOnda2,
  type PainelOnda2,
  type GravarItensLigar,
  type PainelOnda1,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const M = '/api/administracao/coexistencia/migracao';
const JSON_ACEITO = { accept: 'application/json' };

async function lerJson<T>(r: Response, esquema: z.ZodType<T>): Promise<T> {
  if (!r.ok) throw await erroDaResposta(r);
  return esquema.parse(await r.json());
}

function chave(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function escrita(corpo: unknown): RequestInit {
  return {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chave(),
    },
    body: JSON.stringify(corpo),
  };
}

const get = <T>(url: string, e: z.ZodType<T>) =>
  fetch(url, { headers: JSON_ACEITO }).then((r) => lerJson(r, e));
const post = <T>(url: string, corpo: unknown, e: z.ZodType<T>) =>
  fetch(url, escrita(corpo)).then((r) => lerJson(r, e));
const ok = z.object({ ok: z.literal(true) });

export const lerSetores = (): Promise<PainelSetores> => get(`${M}/setores`, esquemaPainelSetores);
export const editarSetor = (codigo: string, corpo: EditarSetor) =>
  post(`${M}/setores/${encodeURIComponent(codigo)}`, corpo, ok);

export function lerPessoas(f: { setor?: string; termo?: string; pagina?: number }): Promise<PaginaPessoas> {
  const q = new URLSearchParams();
  if (f.setor) q.set('setor', f.setor);
  if (f.termo) q.set('termo', f.termo);
  if (f.pagina) q.set('pagina', String(f.pagina));
  return get(`${M}/pessoas?${q.toString()}`, esquemaPaginaPessoas);
}

export const lerTreino = (): Promise<PainelTreino> => get(`${M}/treinamento`, esquemaPainelTreino);
/** O guia ou o roteiro de vídeo de uma tarefa (o endereço vem do painel do treinamento, sempre da própria API). */
export function lerGuia(endereco: string): Promise<GuiaTreino> {
  if (!endereco.startsWith(`${M}/treinamento/guias/`))
    return Promise.reject(new Error('Endereço do guia inválido.'));
  return get(endereco, esquemaGuiaTreino);
}
export const publicarTrilha = (papel: string, onda: number, exercicio: string) =>
  post(`${M}/treinamento/trilhas/${papel}/${onda}`, { exercicio }, z.object({ versao: z.number() }));
export const registrarConclusao = (c: RegistrarConclusao) =>
  post(
    `${M}/treinamento/conclusoes`,
    c,
    z.object({ registradas: z.number(), naoEncontrados: z.array(z.string()) }),
  );

export const lerIndicadores = (dias = 14): Promise<PainelIndicadores> =>
  get(`${M}/indicadores?dias=${dias}`, esquemaPainelIndicadores);

// M39: a onda 1 (a lista para ligar cada setor e os indicadores de disputa do dia).
export const lerOnda1 = (): Promise<PainelOnda1> => get(`${M}/onda1`, esquemaPainelOnda1);
export const gravarItensLigar = (setor: string, corpo: Omit<GravarItensLigar, 'senha'>) =>
  fetch(`${M}/onda1/ligar/${encodeURIComponent(setor)}`, { ...escrita(corpo), method: 'PUT' }).then((r) =>
    lerJson(r, z.object({ gravados: z.number() })),
  );

// M40: a onda 2 (o critério de liberação de cada setor e o acompanhamento agregado).
export const lerOnda2 = (): Promise<PainelOnda2> => get(`${M}/onda2`, esquemaPainelOnda2);
export const gravarItensOnda2 = (setor: string, corpo: Omit<GravarItensOnda2, 'senha'>) =>
  fetch(`${M}/onda2/criterio/${encodeURIComponent(setor)}`, { ...escrita(corpo), method: 'PUT' }).then((r) =>
    lerJson(r, z.object({ gravados: z.number() })),
  );
export const lerAcompanhamentoOnda2 = (de: string, ate: string): Promise<AcompanhamentoOnda2> =>
  get(
    `${M}/onda2/acompanhamento?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`,
    esquemaAcompanhamentoOnda2,
  );

// M41: a onda 3 (o critério de cada setor da farmácia, do almoxarifado e das compras, com a regra 1 da farmácia).
export const lerOnda3 = (): Promise<PainelMigracaoOnda3> => get(`${M}/onda3`, esquemaPainelMigracaoOnda3);
export const gravarItensOnda3 = (setor: string, corpo: Omit<GravarItensOnda2, 'senha'>) =>
  fetch(`${M}/onda3/criterio/${encodeURIComponent(setor)}`, { ...escrita(corpo), method: 'PUT' }).then((r) =>
    lerJson(r, z.object({ gravados: z.number() })),
  );

// M42: a onda 4 (o critério de cada setor do faturamento, do financeiro e do repasse; regra 1 no início).
// M43: a aba "Fim da coexistência" e a revisão dos sem grupo e dos logins de painel (as ações são as do M10 e do M19).
export const lerFim = (): Promise<TelaFimCoexistencia> => get(`${M}/fim`, esquemaTelaFimCoexistencia);
export const lerRevisaoFim = (): Promise<RevisaoFimCoexistencia> =>
  get(`${M}/fim/revisao`, esquemaRevisaoFimCoexistencia);
export const lerOnda4 = (): Promise<PainelMigracaoOnda4> => get(`${M}/onda4`, esquemaPainelMigracaoOnda4);
export const gravarItensOnda4 = (setor: string, corpo: Omit<GravarItensOnda2, 'senha'>) =>
  fetch(`${M}/onda4/criterio/${encodeURIComponent(setor)}`, { ...escrita(corpo), method: 'PUT' }).then((r) =>
    lerJson(r, z.object({ gravados: z.number() })),
  );

export const aplicarLote = (p: PedidoLoteCoex): Promise<ResultadoLoteCoex> =>
  post(`${M}/lotes`, p, esquemaResultadoLoteCoex);
export const recolherLote = (id: string, justificativa: string, senha: string) =>
  post(
    `${M}/lotes/${id}/recolher`,
    { justificativa, senha },
    z.object({ recolhido: z.boolean(), alteradas: z.number() }),
  );

export const lerConducao = (setor: string): Promise<PainelConducao> =>
  get(`${M}/conducao/${encodeURIComponent(setor)}`, esquemaPainelConducao);
export const retirarConducao = (
  setor: string,
  corpo: {
    pares: { grupo: string; opcao: number }[];
    autorizacao: string;
    decisaoGestor: string[];
    senha: string;
  },
): Promise<ResultadoConducao> =>
  post(`${M}/conducao/${encodeURIComponent(setor)}/retirar`, corpo, esquemaResultadoConducao);
export const devolverConducao = (setor: string, senha: string): Promise<ResultadoConducao> =>
  post(`${M}/conducao/${encodeURIComponent(setor)}/devolver`, { senha }, esquemaResultadoConducao);

export function lerChamados(
  f: {
    severidade?: string;
    situacao?: string;
    sistema?: string;
    setor?: string;
    dias?: number;
    pagina?: number;
  } = {},
): Promise<ListaChamados> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') q.set(k, String(v));
  const qs = q.toString();
  return get(`${M}/chamados${qs ? `?${qs}` : ''}`, esquemaListaChamados);
}
export const abrirChamado = (c: AbrirChamado) =>
  post('/api/chamados', c, z.object({ id: z.string(), prazoResposta: z.string(), aviso: z.string() }));
export const triarChamado = (id: string, t: TriarChamado): Promise<ChamadoLido> =>
  post(`${M}/chamados/${id}/triar`, t, esquemaChamadoLido);

/** Parcela impressa (regra 2): "novo 61 de 100 = 61%". */
export function textoParcela(p: { novo: number; total: number; percentual: number | null }): string {
  return p.total === 0 ? 'sem operações no dia' : `novo ${p.novo} de ${p.total} = ${p.percentual}%`;
}

// ── M58 (etapa 1): prontidão do desligamento (o cartão da plataforma fica no cliente do módulo config) ───────────────────────────

const DESLIG = '/api/administracao/coexistencia/desligamento';
export const lerDesligamento = (): Promise<PainelDesligamento> => get(DESLIG, esquemaPainelDesligamento);
/** Registra o item da checklist (senha de novo: a permissão é crítica). */
export const registrarItemDesligamento = (
  r: RegistrarItemDesligamento,
  senha: string,
): Promise<ResultadoRegistroDesligamento> =>
  post(
    `${DESLIG}/itens/${encodeURIComponent(r.item)}`,
    {
      situacao: r.situacao,
      contingencia: r.contingencia,
      papelResponsavel: r.papelResponsavel,
      evidencia: r.evidencia,
      senha,
    },
    esquemaResultadoRegistroDesligamento,
  );

// ── M58 (etapa 2): o ensaio da versão 5 do motor na cópia (só leitura; o relatório é gerado fora da API) ──────────
export const lerEnsaioFirebird5 = (): Promise<ResumoEnsaioFirebird5> =>
  get(`${DESLIG}/ensaios/firebird5`, esquemaResumoEnsaioFirebird5);

// ── M58 (etapa 3): o ensaio da conversão do texto para UTF-8 na cópia em versão 5 (só leitura) ─────────────────────
export const lerEnsaioUtf8 = (): Promise<ResumoEnsaioUtf8> =>
  get(`${DESLIG}/ensaios/utf8`, esquemaResumoEnsaioUtf8);

// ── M58 (etapa 5): a janela em produção (roteiro, verificação depois da janela, retirada da restrição; só leitura) ──
export const lerJanela = (): Promise<PainelJanela> => get(`${DESLIG}/janela`, esquemaPainelJanela);

// ── W0-09: o ciclo de vida (fato novo com motivo; o anterior fica na história) ──────────────────────────────────────
/** Volta a 'pendente' o item do critério de liberação do setor (onda 1 a 4). */
export const voltarCriterioPendente = (setor: string, item: string, motivo: string) =>
  post(
    `${M}/criterio/${encodeURIComponent(setor)}/itens/${encodeURIComponent(item)}/pendente`,
    { motivo },
    z.object({ setor: z.string(), item: z.string(), situacao: z.literal('pendente') }),
  );
/** Volta a 'pendente' o item da checklist do desligamento (crítica: senha de novo). */
export const voltarDesligamentoPendente = (item: string, motivo: string, senha: string) =>
  post(
    `${DESLIG}/itens/${encodeURIComponent(item)}/pendente`,
    { motivo, senha },
    z.object({ item: z.string(), situacao: z.literal('pendente') }),
  );
/** Estorna a conclusão de treinamento (ela sai da contagem; o estorno fica com o motivo). */
export const estornarConclusao = (id: string, motivo: string) =>
  post(
    `${M}/treinamento/conclusoes/${encodeURIComponent(id)}/estorno`,
    { motivo },
    z.object({}).passthrough(),
  );
/**
 * Retira a versão da trilha: sem `inativar`, a exclusão (409 `trilha-com-vinculos` com a contagem e a oferta de
 * inativar quando há turmas ou conclusões); com `inativar`, a inativação (fica visível com a história).
 */
export const retirarVersaoTrilha = (
  papel: string,
  onda: number,
  versao: number,
  motivo: string,
  inativar: boolean,
) =>
  post(
    `${M}/treinamento/trilhas/${encodeURIComponent(papel)}/${onda}/versoes/${versao}/retirada`,
    inativar ? { motivo, inativar: true } : { motivo },
    z.object({}).passthrough(),
  );

// ── W0-09: o registro do fim e da retrocompatibilidade gravado pela tela (D-RETRO-REGISTRO-F6) ──────────────
export const URL_REGISTROS_COEX = '/api/administracao/coexistencia/registros';
const esquemaRegistroCoexGravado = z.object({
  tipo: z.enum(['fim', 'retrocompatibilidade']),
  modo: z.enum(['tela', 'excecao']),
  fonte: z.enum(['tela', 'arquivo']),
  versaoVigente: z.number().nullable(),
  conteudo: z.record(z.string(), z.unknown()).nullable(),
  historico: z.array(
    z.object({
      versao: z.number(),
      motivo: z.string(),
      gravadoPor: z.string(),
      gravadoEm: z.string(),
      retornoAoArquivo: z.boolean(),
    }),
  ),
});
export type RegistroCoexTela = z.infer<typeof esquemaRegistroCoexGravado>;
export type TipoRegistroCoexTela = RegistroCoexTela['tipo'];

/** O registro gravado (modo do estabelecimento, de onde vem o que vale e o histórico de versões). */
export const lerRegistroCoex = (tipo: TipoRegistroCoexTela): Promise<RegistroCoexTela> =>
  get(`${URL_REGISTROS_COEX}/${tipo}`, esquemaRegistroCoexGravado);
/**
 * Grava a versão nova do registro (crítica: senha de novo). `conteudo` null volta a valer o registro versionado; a
 * versão anterior fica no histórico com o motivo.
 */
export const gravarRegistroCoex = (
  tipo: TipoRegistroCoexTela,
  conteudo: Record<string, unknown> | null,
  motivo: string,
  senha: string,
) => post(`${URL_REGISTROS_COEX}/${tipo}`, { conteudo, motivo, senha }, esquemaRegistroCoexGravado);
