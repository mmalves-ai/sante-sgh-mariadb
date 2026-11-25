// Cliente das telas do M10 (acesso, organização e auditoria), validado pelos contratos. As gravações levam o
// CSRF da sessão (token duplo), a Idempotency-Key (uma por pedido) e, nas críticas, a senha digitada na hora
// (reautenticação; nunca guardada). Problem Details viram ErroApi.
import {
  type Alertas,
  type ConferirConselho,
  type PreviaModeloTela,
  type ResultadoModeloTela,
  type ConselhoUsuarioTela,
  type DesviosPrivilegiosResposta,
  esquemaDesviosPrivilegiosResposta,
  esquemaInventarioContasBancoResposta,
  type InventarioContasBancoResposta,
  type ArvorePermissoes,
  type Backup,
  type ConferenciaLeitos,
  type DadosFiscais,
  type Estrutura,
  esquemaAlertas,
  esquemaArvorePermissoes,
  esquemaBackup,
  esquemaConferenciaLeitos,
  esquemaDadosFiscais,
  esquemaEstrutura,
  esquemaExclusoes,
  esquemaFichaUsuario,
  esquemaIndiceParametrosBanco,
  esquemaLeitos,
  esquemaListaPedidos,
  esquemaListaQuebrasVidro,
  esquemaListaUsuarios,
  esquemaPaginaAcessosProntuario,
  esquemaPaginaConexoes,
  esquemaPaginaExclusoes,
  esquemaPaginaTrilha,
  esquemaPainelPermissoes,
  esquemaResultadoSimulacao,
  esquemaServidorEmail,
  esquemaTabelaParametros,
  esquemaTermoDaSessao,
  esquemaTermoVigente,
  esquemaVersaoTermo,
  esquemaVersoesTermo,
  type Exclusoes,
  type FichaUsuario,
  type IndiceParametrosBanco,
  type Leitos,
  type ListaPedidos,
  type ListaQuebrasVidro,
  type ListaUsuarios,
  type PaginaAcessosProntuario,
  type PaginaConexoes,
  type PaginaExclusoes,
  type PaginaTrilha,
  type PainelPermissoes,
  type ResultadoSimulacao,
  type ServidorEmail,
  type TabelaParametrosBanco,
  type TermoDaSessao,
  type TermoVigente,
  type VersaoTermo,
  type VersoesTermo,
  type TipoEscopo,
  esquemaPainelCpf,
  esquemaPainelRedeCpf,
  esquemaResultadoBloqueioRedeCpf,
  type PainelCpf,
  type PainelRedeCpf,
  type ResultadoBloqueioRedeCpf,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const JSON_ACEITO = { accept: 'application/json' };

async function ler<T>(url: string, esquema: z.ZodType<T>): Promise<T> {
  const r = await fetch(url, { headers: JSON_ACEITO });
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

async function gravar<T = unknown>(url: string, corpo: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...JSON_ACEITO,
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chaveIdempotencia(),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as T;
}

export const qs = (p: Record<string, string | number | null | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

const A = '/api/administracao/acesso';

// ── Usuários ──────────────────────────────────────────────────────────────────────────────────────
export const listarUsuarios = (f: {
  busca?: string;
  grupo?: string;
  situacao?: string;
  pagina?: number;
  porPagina?: number;
}): Promise<ListaUsuarios> => ler(`${A}/usuarios${qs(f)}`, esquemaListaUsuarios);
export const buscarFicha = (login: string): Promise<FichaUsuario> =>
  ler(`${A}/usuarios/${encodeURIComponent(login)}`, esquemaFichaUsuario);
const esquemaOpcoesUsuarios = z.object({
  escopos: z.record(z.string(), z.array(z.object({ valor: z.string(), rotulo: z.string() }))),
  grupos: z.array(z.object({ nome: z.string(), ativo: z.boolean() })),
  setores: z.array(z.object({ valor: z.string(), rotulo: z.string() })),
});
export const buscarOpcoesUsuarios = () => ler(`${A}/usuarios-opcoes`, esquemaOpcoesUsuarios);
/** W1-01: identidade única (contas sem CPF e CPF repetido entre logins; o número do CPF nunca vem). */
export const buscarPainelCpf = (): Promise<PainelCpf> => ler(`${A}/usuarios-cpf`, esquemaPainelCpf);
/** W1-01 (11c): a pessoa (CPF ou login daqui) em cada estabelecimento da rede; POST para o CPF não ir na URL. */
export const buscarRedeCpf = async (alvo: { cpf?: string; login?: string }): Promise<PainelRedeCpf> =>
  esquemaPainelRedeCpf.parse(await gravar(`${A}/rede-cpf`, alvo));
/** W1-01 (11c): "bloquear em todos" (senha e motivo; resultado por conta e estabelecimento). */
export const bloquearNaRede = async (
  alvo: { cpf?: string; login?: string },
  motivo: string,
  senha: string,
): Promise<ResultadoBloqueioRedeCpf> =>
  esquemaResultadoBloqueioRedeCpf.parse(await gravar(`${A}/rede-cpf/bloquear`, { ...alvo, motivo, senha }));
export const criarUsuario = (
  entrada: { login: string; nomeCompleto: string; grupo: string; cpf?: string },
  senha: string,
) =>
  gravar<{ id?: number; senhaProvisoria?: string; trocaObrigatoria?: boolean; senhaPendente?: string }>(
    `${A}/usuarios`,
    { entrada, senha },
  );
export const alterarNome = (login: string, nomeCompleto: string, versao: string, senha: string) =>
  gravar(`${A}/usuarios/${encodeURIComponent(login)}/nome`, { entrada: { nomeCompleto, versao }, senha });
/** W1-01: troca do CPF (justificativa obrigatória; o CPF anterior e o motivo vão à trilha). */
export const trocarCpf = (
  login: string,
  dados: { nomeCompleto: string; versao: string; cpf: string; justificativa: string },
  senha: string,
) => gravar(`${A}/usuarios/${encodeURIComponent(login)}/nome`, { entrada: dados, senha });
/** W1-01: permissões complementares (a letra que a ficha mostrou vai junto: colisão se mudou por fora). */
export const alterarFlags = (
  login: string,
  flags: readonly { coluna: string; ligado: boolean; antes: 'T' | 'F' | '' | null }[],
  senha: string,
) => gravar(`${A}/usuarios/${encodeURIComponent(login)}/flags`, { entrada: { flags }, senha });
export const trocarGrupo = (login: string, grupo: string, senha: string) =>
  gravar(`${A}/usuarios/${encodeURIComponent(login)}/grupo`, { entrada: { grupo }, senha });
export const bloquear = (login: string, bloquear: boolean, senha: string) =>
  gravar(`${A}/usuarios/${encodeURIComponent(login)}/bloqueio`, { bloquear, senha });
/** W1-01: senha provisória gerada pelo servidor (volta só nesta resposta; o usuário troca no próximo acesso). */
// W1-01 (parte 11b3c): o PIN da troca rápida do usuário, para quem gere acessos (situação; retirar com motivo e senha).
const esquemaSituacaoPinGestao = z.object({
  ligada: z.boolean(),
  digitosPin: z.number().int(),
  definido: z.boolean(),
  bloqueado: z.boolean(),
  criadoEm: z.string().nullable(),
});
export type SituacaoPinGestao = z.infer<typeof esquemaSituacaoPinGestao>;
const PIN_GESTAO = '/api/acesso/gestao/usuarios';
export const buscarPinUsuario = (login: string) =>
  ler(`${PIN_GESTAO}/${encodeURIComponent(login)}/pin`, esquemaSituacaoPinGestao);
export const retirarPinUsuario = (login: string, motivo: string, senha: string) =>
  gravar<{ anterior: 'definido' | 'bloqueado'; situacao: SituacaoPinGestao }>(
    `${PIN_GESTAO}/${encodeURIComponent(login)}/pin/retirar`,
    { motivo, senha },
  );

/** W1-01 (11d): o registro no conselho do usuário (registros, última conferência, efeito e histórico). */
export const buscarConselhoUsuario = (login: string) =>
  ler(
    `${PIN_GESTAO}/${encodeURIComponent(login)}/conselho`,
    z.custom<ConselhoUsuarioTela>((v) => typeof v === 'object' && v !== null && 'registros' in v),
  );
/** W1-01 (11d): conferência nova (reautenticação no diálogo único). */
export const conferirConselhoUsuario = (
  login: string,
  corpo: Omit<ConferirConselho, 'senha'>,
  senha: string,
) =>
  gravar<{ anterior: string | null; atual: string; tela: ConselhoUsuarioTela }>(
    `${PIN_GESTAO}/${encodeURIComponent(login)}/conselho/conferencias`,
    { ...corpo, senha },
  );

/** W1-01 (12a): "Aplicar acessos de…": a diferença entre o modelo e o usuário (nada grava). */
export const previaModelo = (login: string, modelo: string, modo: 'somar' | 'igualar') =>
  gravar<PreviaModeloTela>(`${PIN_GESTAO}/${encodeURIComponent(login)}/modelo/previa`, { modelo, modo });
/** W1-01 (12a): grava o plano que a prévia mostrou (conferência), com motivo e a senha no diálogo único. */
export const aplicarModelo = (
  login: string,
  corpo: { modelo: string; modo: 'somar' | 'igualar'; conferencia: string; motivo: string },
  senha: string,
) =>
  gravar<ResultadoModeloTela>(`${PIN_GESTAO}/${encodeURIComponent(login)}/modelo/aplicar`, {
    ...corpo,
    senha,
  });

export const redefinirSenha = (login: string, senha: string) =>
  gravar<{ senhaProvisoria: string; trocaObrigatoria: boolean }>(
    `${A}/usuarios/${encodeURIComponent(login)}/senha-provisoria`,
    { senha },
  );
export const alterarEscopo = (
  login: string,
  tipo: TipoEscopo,
  acao: 'conceder' | 'retirar',
  valor: string,
  senha: string,
) =>
  gravar(`${A}/usuarios/${encodeURIComponent(login)}/escopos`, {
    tipo,
    acao,
    valor: /^\d+$/.test(valor) ? Number(valor) : valor,
    senha,
  });
export const alterarSetor = (login: string, bloco: string, acao: 'conceder' | 'retirar', senha: string) =>
  gravar(`${A}/usuarios/${encodeURIComponent(login)}/setores`, { bloco, acao, senha });

// ── Permissões, simulador, termo, quebras ─────────────────────────────────────────────────────────
export const buscarPainelPermissoes = (): Promise<PainelPermissoes> =>
  ler(`${A}/permissoes`, esquemaPainelPermissoes);
export const buscarArvore = (f: {
  modulo?: number | null;
  grupo?: string;
  papel?: number | null;
}): Promise<ArvorePermissoes> =>
  ler(
    `${A}/permissoes/arvore${qs({ modulo: f.modulo ?? null, grupo: f.grupo, papel: f.papel ?? null })}`,
    esquemaArvorePermissoes,
  );
export const opcoesDoGrupo = (acao: 'conceder' | 'revogar', grupo: string, opcoes: number[], senha: string) =>
  gravar(`${A}/permissoes/${acao}`, { grupo, opcoes, senha });
const esquemaPropostas = z.object({
  grupos: z.array(
    z.object({
      grupo: z.string(),
      perfil: z.string().nullable(),
      origem: z.string(),
      assistencial: z.boolean(),
      revisao: z.string(),
      motivo: z.string(),
      total: z.number(),
      porCategoria: z.record(z.string(), z.number()),
      ativo: z.boolean(),
      usuariosAtivos: z.number(),
    }),
  ),
});
export const buscarPropostas = () => ler(`${A}/grupos/propostas`, esquemaPropostas);
export const simular = (login: string, recurso: string): Promise<ResultadoSimulacao> =>
  ler(`${A}/simulador${qs({ login, recurso })}`, esquemaResultadoSimulacao);
export const buscarTermo = (): Promise<TermoVigente> => ler(`${A}/termo`, esquemaTermoVigente);
export const buscarTermoDaSessao = (): Promise<TermoDaSessao> =>
  ler(`${A}/termo/sessao`, esquemaTermoDaSessao);
export const aceitarTermo = (termo: number) => gravar(`${A}/termo/aceitar`, { termo });
/** W1-01 (parte 6b): as versões do termo, uma versão com os aceites (paginados) e publicar a nova (senha e motivo). */
export const buscarVersoesTermo = (): Promise<VersoesTermo> => ler(`${A}/termo/versoes`, esquemaVersoesTermo);
export const buscarVersaoTermo = (id: number, pagina = 1): Promise<VersaoTermo> =>
  ler(`${A}/termo/versoes/${id}${qs({ pagina })}`, esquemaVersaoTermo);
export const publicarTermo = (p: {
  termoAnterior: number | null;
  texto: string;
  motivo: string;
  senha: string;
}) => gravar<{ id: number; anterior: number | null }>(`${A}/termo/publicar`, p);
export const buscarQuebras = (): Promise<ListaQuebrasVidro> =>
  ler(`${A}/quebras-de-vidro`, esquemaListaQuebrasVidro);
export const revisarQuebra = (id: string, classificacao: 'justificado' | 'nao-justificado', nota?: string) =>
  gravar(`${A}/quebras-de-vidro/${encodeURIComponent(id)}/revisar`, {
    classificacao,
    ...(nota ? { nota } : {}),
  });

// ── Estrutura ─────────────────────────────────────────────────────────────────────────────────────
const E = '/api/cadastros/estrutura';
export const buscarEstrutura = (): Promise<Estrutura> => ler(E, esquemaEstrutura);
export const buscarLeitos = (): Promise<Leitos> => ler(`${E}/leitos`, esquemaLeitos);
export const buscarConferencia = (): Promise<ConferenciaLeitos> =>
  ler(`${E}/leitos/conferencia`, esquemaConferenciaLeitos);
/** Acomodação e leito pelas receitas, com a senha (reautenticação; ficha seção 5). */
export const gravarLeito = (operacao: string, entrada: unknown, senha: string) =>
  gravar<{ id?: number }>(`${E}/leitos/${operacao}`, { entrada, senha });
const esquemaLocais = z.object({
  guiches: z.array(z.object({ numero: z.number(), recepcao: z.string() })),
  horarios: z.number(),
  encaminhamentos: z.number(),
  pesquisados: z.number(),
});
export const buscarLocaisComplementos = () => ler(`${E}/locais/complementos`, esquemaLocais);

// ── Consultas da organização ──────────────────────────────────────────────────────────────────────
const C = '/api/administracao';
export const buscarAlertas = (): Promise<Alertas> => ler(`${C}/alertas`, esquemaAlertas);
export const buscarEmail = (): Promise<ServidorEmail> => ler(`${C}/notificacoes`, esquemaServidorEmail);
export const buscarEmpresa = (): Promise<DadosFiscais> => ler(`${C}/empresa`, esquemaDadosFiscais);
export const buscarBackup = (): Promise<Backup> => ler(`${C}/backup`, esquemaBackup);
// M59-F1: contas do banco de dados e desvios do privilégio mínimo por módulo (só consulta).
export const buscarContasBanco = (): Promise<InventarioContasBancoResposta> =>
  ler(`${C}/acesso/contas-banco`, esquemaInventarioContasBancoResposta);
export const buscarDesviosPrivilegios = (): Promise<DesviosPrivilegiosResposta> =>
  ler(`${C}/acesso/contas-banco/desvios`, esquemaDesviosPrivilegiosResposta);
export const buscarIndiceParametros = (): Promise<IndiceParametrosBanco> =>
  ler(`${C}/parametros-banco`, esquemaIndiceParametrosBanco);
export const buscarParametrosBanco = (chave: string, login?: string): Promise<TabelaParametrosBanco> =>
  ler(`${C}/parametros-banco/${encodeURIComponent(chave)}${qs({ login })}`, esquemaTabelaParametros);

// ── Auditoria e privacidade ───────────────────────────────────────────────────────────────────────
export interface FiltroTrilhaTela {
  inicio: string;
  fim: string;
  usuario?: string | undefined;
  origem?: string | undefined;
  tipo?: number | null;
  evento?: string | undefined;
  paciente?: number | null;
  /** Prontuário do paciente (o filtro de quem chega pelo número; o servidor acha o paciente). */
  prontuario?: number | null;
  pagina?: number;
}
const filtroQs = (f: FiltroTrilhaTela) =>
  qs({
    inicio: f.inicio,
    fim: f.fim,
    usuario: f.usuario,
    origem: f.origem,
    tipo: f.tipo ?? null,
    evento: f.evento,
    paciente: f.paciente ?? null,
    prontuario: f.prontuario ?? null,
    pagina: f.pagina,
  });
export const buscarTrilha = (f: FiltroTrilhaTela): Promise<PaginaTrilha> =>
  ler(`${C}/auditoria/trilha${filtroQs(f)}`, esquemaPaginaTrilha);
export const urlExportacao = (f: FiltroTrilhaTela, formato: 'csv' | 'xml' | 'html') =>
  `${C}/auditoria/trilha/exportar${filtroQs(f)}&formato=${formato}`;
export const buscarAcessos = (f: FiltroTrilhaTela): Promise<PaginaAcessosProntuario> =>
  ler(`${C}/auditoria/leituras-prontuario${filtroQs(f)}`, esquemaPaginaAcessosProntuario);
export const buscarExclusoes = (inicio: string, fim: string): Promise<Exclusoes> =>
  ler(`${C}/auditoria/exclusoes${qs({ inicio, fim })}`, esquemaExclusoes);
export interface FiltroRegistrosTela {
  inicio: string;
  fim: string;
  usuario?: string | undefined;
  pagina: number;
}
export const buscarRegistrosExclusao = (chave: string, f: FiltroRegistrosTela): Promise<PaginaExclusoes> =>
  ler(`${C}/auditoria/exclusoes/${encodeURIComponent(chave)}${qs({ ...f })}`, esquemaPaginaExclusoes);
export const buscarConexoes = (f: FiltroRegistrosTela): Promise<PaginaConexoes> =>
  ler(`${C}/auditoria/conexoes${qs({ ...f })}`, esquemaPaginaConexoes);
export const buscarPedidos = (): Promise<ListaPedidos> =>
  ler(`${C}/privacidade/pedidos`, esquemaListaPedidos);
export const registrarPedido = (p: { prontuario: number; tipo: string; canal: string; descricao?: string }) =>
  gravar<{ protocolo: string }>(`${C}/privacidade/pedidos`, p);
export const tratarPedido = (
  id: string,
  p: { acao: 'confirmar-identidade' | 'atender' | 'negar'; fundamento?: string; resposta?: string },
) => gravar(`${C}/privacidade/pedidos/${encodeURIComponent(id)}`, p);

/** Data civil de hoje e de n dias atrás (AAAA-MM-DD; fuso do navegador). */
export function diaRelativo(dias: number): string {
  const d = new Date(Date.now() - dias * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
