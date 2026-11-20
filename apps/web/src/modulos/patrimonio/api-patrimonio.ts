// Cliente das telas do patrimônio (M54, etapa 6): o apoio (por tela, pela permissão de cada uma), os bens (lista,
// detalhe, leitura pelo QR ou pela plaqueta, etiqueta, cadastro da nota ou do termo, alteração, baixa com a senha), as
// notas de entrada do mês com os itens, a depreciação (prévia ou cotas gravadas; calcular), os movimentos (registrar,
// aceitar ou recusar, cancelar) e o inventário (abrir, ler, encerrar). O servidor é a fonte: as respostas são os tipos
// de @sgh/contratos, conferidos só na forma.
import type {
  AbrirInventarioBens,
  AlterarBem,
  ApoioPatrimonio,
  BemPatrimonial,
  CadastrarBem,
  DepreciacaoCompetencia,
  DetalheInventario,
  Inventario,
  ItemNotaParaBem,
  LeituraInventarioRegistrada,
  ListaBens,
  MovimentoBem,
  NotaEntradaParaBem,
  ResumoInventario,
  SituacaoBem,
  SituacaoMovimentoBem,
  GrupoBem,
  AlterarGrupoBemEntrada,
  GrupoBemCadastro,
  ListaGruposBem,
  GrupoBemDetalhe,
  IncluirGrupoBemEntrada,
  MotivoGrupoBemEntrada,
  AjusteBem,
  AnexarLaudoBem,
  LaudoBem,
  RegistrarAjusteBem,
} from '@sgh/contratos';
import { z } from 'zod';
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';
import { novaChave } from '../contabil/api-contabil.js';
import { enviar, ler, qs } from '../exames/api-exames.js';

const P = '/api/patrimonio';
const confiar = <X>() => z.custom<X>((v) => v !== null && typeof v === 'object');

/** A tela que pede o apoio (cada uma com a sua permissão no servidor). */
export type TelaPatrimonio = 'bens' | 'depreciacao' | 'movimentos' | 'inventario';
export const lerApoioPatrimonio = (tela: TelaPatrimonio) =>
  ler(tela === 'bens' ? `${P}/apoio` : `${P}/apoio/${tela}`, confiar<ApoioPatrimonio>());

export const lerBens = (f: {
  busca?: string | null;
  centro?: number | null;
  situacao?: SituacaoBem | null;
  grupo?: GrupoBem | null;
  pagina: number;
  tamanho: number;
}) => ler(`${P}/bens${qs(f)}`, confiar<ListaBens>());

export const lerBem = (id: number) => ler(`${P}/bens/${id}`, confiar<BemPatrimonial>());
export const lerBemPorCodigo = (codigo: string) =>
  ler(`${P}/bens/codigo${qs({ codigo })}`, confiar<BemPatrimonial>());
export const lerEtiqueta = (id: number) =>
  ler(`${P}/bens/${id}/etiqueta`, confiar<{ plaqueta: string; zpl: string }>());

/** O termo de baixa do bem baixado (PDF/A), baixado pelo navegador. */
export const urlTermoBaixa = (id: number) => `${P}/bens/${id}/termo-baixa`;

export const lerNotas = (competencia: string, busca?: string | null) =>
  ler(
    `${P}/notas${qs({ competencia, busca })}`,
    confiar<{ notas: NotaEntradaParaBem[]; truncado: boolean }>(),
  );
export const lerItensDaNota = (id: number) =>
  ler(`${P}/notas/${id}/itens`, confiar<{ nota: NotaEntradaParaBem; itens: ItemNotaParaBem[] }>());

/** Entradas como a tela as monta (o servidor aplica os padrões do esquema). */
export type EntradaCadastro = Partial<CadastrarBem> & Pick<CadastrarBem, 'documento'>;
export const cadastrarBens = (c: EntradaCadastro) =>
  enviar(`${P}/bens`, c, confiar<{ bens: BemPatrimonial[] }>(), novaChave('pat-cadastro'));
export const alterarBem = (id: number, a: AlterarBem) =>
  enviar(`${P}/bens/${id}`, a, confiar<{ bem: BemPatrimonial; mudou: boolean }>(), novaChave('pat-bem'));
export const baixarBem = (
  id: number,
  b: {
    versao: number;
    data: string;
    motivo: string;
    termoNumero: string;
    valorVendaCent: number | null;
    senha: string;
  },
) =>
  enviar(
    `${P}/bens/${id}/baixa`,
    b,
    confiar<{ movimento: MovimentoBem; bem: BemPatrimonial }>(),
    novaChave('pat-baixa'),
  );

export const lerDepreciacao = (empresa: number, competencia: string) =>
  ler(`${P}/depreciacao${qs({ empresa, competencia })}`, confiar<DepreciacaoCompetencia>());
export const calcularDepreciacao = (empresa: number, competencia: string) =>
  enviar(
    `${P}/depreciacao/calculo`,
    { empresa, competencia },
    confiar<DepreciacaoCompetencia>(),
    novaChave('pat-deprec'),
  );

/** W0-08: estorna o último cálculo da competência, com o motivo e a senha de novo. */
export const estornarDepreciacao = (x: {
  empresa: number;
  competencia: string;
  motivo: string;
  senha: string;
}) =>
  enviar(`${P}/depreciacao/estorno`, x, confiar<DepreciacaoCompetencia>(), novaChave('pat-deprec-estorno'));

export const lerMovimentos = (f: { situacao?: SituacaoMovimentoBem | null; bem?: number | null }) =>
  ler(`${P}/movimentos${qs(f)}`, z.array(confiar<MovimentoBem>()));

/** Transferência, empréstimo, comodato ou devolução (a baixa tem rota própria, com a senha). */
export type EntradaMovimento =
  | {
      tipo: 'transferencia';
      bem: number;
      versao: number;
      data: string;
      motivo: string;
      destino: number;
      destinoResponsavel: string | null;
    }
  | {
      tipo: 'emprestimo' | 'comodato';
      bem: number;
      versao: number;
      data: string;
      motivo: string;
      terceiro: string;
      retornoPrevisto: string | null;
      termoNumero: string | null;
    }
  | { tipo: 'devolucao'; bem: number; versao: number; data: string; motivo: string };
export const registrarMovimento = (m: EntradaMovimento) =>
  enviar(
    `${P}/movimentos`,
    m,
    confiar<{ movimento: MovimentoBem; bem: BemPatrimonial }>(),
    novaChave('pat-mov'),
  );
export const decidirMovimento = (
  id: number,
  d: { aceitar: boolean; motivo: string | null; versao: number },
) =>
  enviar(
    `${P}/movimentos/${id}/decisao`,
    d,
    confiar<{ movimento: MovimentoBem; bem: BemPatrimonial }>(),
    novaChave('pat-decisao'),
  );
export const cancelarMovimento = (id: number, c: { motivo: string; versao: number }) =>
  enviar(
    `${P}/movimentos/${id}/cancelamento`,
    c,
    confiar<{ movimento: MovimentoBem }>(),
    novaChave('pat-cancela'),
  );

export const lerInventarios = () => ler(`${P}/inventarios`, z.array(confiar<Inventario>()));
export const lerInventario = (id: number) => ler(`${P}/inventarios/${id}`, confiar<DetalheInventario>());
export const abrirInventario = (a: AbrirInventarioBens) =>
  enviar(`${P}/inventarios`, a, confiar<DetalheInventario>(), novaChave('pat-inv'));
export const lerNoInventario = (
  id: number,
  l: { codigo: string; centro: number; observacao: string | null },
) =>
  enviar(
    `${P}/inventarios/${id}/leituras`,
    l,
    confiar<{ leitura: LeituraInventarioRegistrada; resumo: ResumoInventario }>(),
    novaChave('pat-leitura'),
  );
/** W0-08: cancela o inventário aberto com motivo (as leituras feitas ficam). */
export const cancelarInventario = (id: number, motivo: string) =>
  enviar(
    `${P}/inventarios/${id}/cancelamento`,
    { motivo },
    confiar<DetalheInventario>(),
    novaChave('pat-inv-cancela'),
  );
export const encerrarInventario = (id: number) =>
  enviar(`${P}/inventarios/${id}/encerramento`, {}, confiar<DetalheInventario>(), novaChave('pat-encerra'));

// ── Grupo do bem (W0-08: cadastro do estabelecimento, partindo dos 8 grupos da IN RFB) ──────────────────────────────
export const lerGrupos = () => ler(`${P}/grupos`, confiar<ListaGruposBem>());
export const lerGrupo = (codigo: string) =>
  ler(`${P}/grupos/${encodeURIComponent(codigo)}`, confiar<GrupoBemDetalhe>());
export const incluirGrupo = (x: IncluirGrupoBemEntrada) =>
  enviar(`${P}/grupos`, x, confiar<GrupoBemCadastro>(), novaChave('pat-grupo'));
/** Alterar pela versão lida (PUT; versão velha devolve 409); a vida útil nova vale só para as cotas seguintes. */
export async function alterarGrupo(codigo: string, x: AlterarGrupoBemEntrada): Promise<GrupoBemCadastro> {
  const r = await fetch(`${P}/grupos/${encodeURIComponent(codigo)}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': novaChave('pat-grupo-alterar'),
    },
    body: JSON.stringify(x),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as GrupoBemCadastro;
}
/** Inativar, reativar ou excluir (o nunca usado; com bens, 409 `com-dependentes` com a contagem). */
export const situacaoGrupo = (
  codigo: string,
  acao: 'inativacao' | 'reativacao' | 'exclusao',
  x: MotivoGrupoBemEntrada,
) =>
  enviar(
    `${P}/grupos/${encodeURIComponent(codigo)}/${acao}`,
    x,
    confiar<GrupoBemCadastro | { codigo: string; excluido: true }>(),
    novaChave(`pat-grupo-${acao}`),
  );

// ── Ajustes de valor do bem (W0-08, M1: revisão de estimativa, impairment com laudo, reavaliação) ──────────────────
export const lerAjustes = (bem: number) => ler(`${P}/bens/${bem}/ajustes`, z.array(confiar<AjusteBem>()));
export const registrarAjuste = (bem: number, x: Omit<RegistrarAjusteBem, 'bem'>) =>
  enviar(`${P}/bens/${bem}/ajustes`, x, confiar<AjusteBem>(), novaChave('pat-ajuste'));
/** Estorna o ajuste com o motivo e a senha de novo (desfaz o lançamento da perda pelo estorno). */
export const estornarAjuste = (id: number, x: { motivo: string; senha: string }) =>
  enviar(`${P}/ajustes/${id}/estorno`, x, confiar<AjusteBem>(), novaChave('pat-ajuste-estorno'));

// ── Laudos do bem (W0-08, achado 6: o PDF anexado, guardado com Object Lock) ─────────────────────────────────────────
export const lerLaudos = (bem: number) => ler(`${P}/bens/${bem}/laudos`, z.array(confiar<LaudoBem>()));
/** Anexa o PDF do laudo (em base64) ao bem; o servidor guarda o arquivo e devolve o laudo para o ajuste escolher. */
export const anexarLaudo = (bem: number, x: AnexarLaudoBem) =>
  enviar(`${P}/bens/${bem}/laudos`, x, confiar<LaudoBem>(), novaChave('pat-laudo'));
/** O PDF do laudo (abre na aba nova; o servidor confere o SHA-256). */
export const urlArquivoLaudo = (id: number) => `${P}/laudos/${id}/arquivo`;

/** O conteúdo do arquivo em base64 (sem o prefixo data:), em blocos para não estourar a pilha. */
export async function arquivoEmBase64(f: Blob): Promise<string> {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
