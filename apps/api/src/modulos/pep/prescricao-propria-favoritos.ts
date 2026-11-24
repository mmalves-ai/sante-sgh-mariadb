// Favoritos do prescritor no banco próprio (03-PEP L107): atalhos pessoais do profissional da sessão para o item do
// catálogo, o protocolo ou o kit (favorito_prescritor). A regra (alvo coerente, sem duplicar o ativo, reativar o
// antigo, teto) é do domínio (decidirFavorito); aqui só a leitura e a gravação. Desativar não apaga: a linha fica
// com ativo = false e volta a valer se o prescritor a marcar de novo.
import {
  decidirFavorito,
  type FavoritoNovo,
  ordenarFavoritos,
  type TipoFavoritoPrescricao,
} from '@sgh/dominio-pep';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';

export type { FavoritoNovo, TipoFavoritoPrescricao };

/** Um favorito lido, com o nome do alvo do cadastro quando o prescritor não deu rótulo. */
export interface FavoritoPrescritorLido {
  readonly id: number;
  readonly tipo: TipoFavoritoPrescricao;
  readonly alvo: number;
  readonly rotulo: string;
  readonly ordem: number | null;
}

const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Favorito recusado', detalhe);

const COLUNA_DO_TIPO: Readonly<Record<TipoFavoritoPrescricao, string>> = {
  item_prescritivel: 'item_prescritivel_id',
  protocolo_prescricao: 'protocolo_prescricao_id',
  kit_prescricao: 'kit_prescricao_id',
};

/** Tabela do alvo e a coluna do nome mostrado (o cadastro de cada tipo). */
const ALVO_DO_TIPO: Readonly<Record<TipoFavoritoPrescricao, { tabela: string; nome: string }>> = {
  item_prescritivel: { tabela: 'item_prescritivel', nome: 'descricao' },
  protocolo_prescricao: { tabela: 'protocolo_prescricao', nome: 'nome' },
  kit_prescricao: { tabela: 'kit_prescricao', nome: 'nome' },
};

/** Os favoritos ativos do profissional, valendo no estabelecimento da sessão (ou em todos), na ordem do prescritor. */
export async function lerFavoritos(
  l: Leitor,
  profissional: number,
  estabelecimento: number,
): Promise<FavoritoPrescritorLido[]> {
  const linhas = await l.consultar(
    `SELECT f.id, f.tipo_favorito, f.ordem, f.rotulo,
            COALESCE(f.item_prescritivel_id, f.protocolo_prescricao_id, f.kit_prescricao_id) AS alvo,
            COALESCE(ip.descricao, pp.nome, kp.nome) AS nome_alvo
       FROM favorito_prescritor f
       LEFT JOIN item_prescritivel ip ON ip.id = f.item_prescritivel_id
       LEFT JOIN protocolo_prescricao pp ON pp.id = f.protocolo_prescricao_id
       LEFT JOIN kit_prescricao kp ON kp.id = f.kit_prescricao_id
      WHERE f.profissional_id = ? AND f.ativo
        AND (f.estabelecimento_id IS NULL OR f.estabelecimento_id = ?)
        AND f.tipo_favorito IN ('item_prescritivel','protocolo_prescricao','kit_prescricao')
      LIMIT 200`,
    [profissional, estabelecimento],
  );
  return ordenarFavoritos(
    linhas.map((x) => ({
      id: Number(x['id']),
      tipo: String(x['tipo_favorito']) as TipoFavoritoPrescricao,
      alvo: Number(x['alvo']),
      rotulo: String(x['rotulo'] ?? x['nome_alvo'] ?? ''),
      ordem: x['ordem'] === null || x['ordem'] === undefined ? null : Number(x['ordem']),
    })),
  );
}

/** Marca o favorito (inclui ou reativa o antigo do mesmo alvo); devolve o id. */
export async function marcarFavorito(
  tx: TxOperacao,
  profissional: number,
  estabelecimento: number,
  novo: FavoritoNovo,
): Promise<number> {
  const coluna = COLUNA_DO_TIPO[novo.tipo];
  if (!coluna) throw recusar(422, 'favorito-invalido', 'Tipo de favorito fora da prescrição.');
  const alvo = ALVO_DO_TIPO[novo.tipo];
  const existe = await tx.uma(`SELECT id FROM ${alvo.tabela} WHERE id = ? AND excluido_em IS NULL`, [
    novo.alvo,
  ]);
  if (!existe) throw recusar(404, 'registro-inexistente', 'O item, protocolo ou kit não foi encontrado.');
  const existentes = (
    await tx.consultarParaAtualizar(
      `SELECT id, tipo_favorito, ativo,
              COALESCE(item_prescritivel_id, protocolo_prescricao_id, kit_prescricao_id) AS alvo
         FROM favorito_prescritor
        WHERE profissional_id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
      [profissional, estabelecimento],
    )
  ).map((x) => ({
    id: Number(x['id']),
    tipo: String(x['tipo_favorito']),
    alvo: Number(x['alvo']),
    ativo: Boolean(Number(x['ativo'])),
  }));
  const d = decidirFavorito(novo, existentes);
  if (d.acao === 'recusar') throw recusar(d.codigo === 'favorito-duplicado' ? 409 : 422, d.codigo, d.detalhe);
  if (d.acao === 'reativar') {
    const v = await tx.uma('SELECT versao FROM favorito_prescritor WHERE id = ?', [d.id]);
    await tx.alterar('favorito_prescritor', d.id, Number(v?.['versao'] ?? 1), {
      ativo: true,
      rotulo: novo.rotulo,
      ordem: novo.ordem,
    });
    return d.id;
  }
  return tx.incluir('favorito_prescritor', {
    profissional_id: profissional,
    estabelecimento_id: estabelecimento,
    tipo_favorito: novo.tipo,
    [coluna]: novo.alvo,
    rotulo: novo.rotulo,
    ordem: novo.ordem,
    ativo: true,
  });
}

/** Desmarca (ativo = false, sem apagar): só o dono do favorito. */
export async function desmarcarFavorito(tx: TxOperacao, profissional: number, id: number): Promise<number> {
  const [f] = await tx.consultarParaAtualizar(
    'SELECT id, versao, ativo, profissional_id FROM favorito_prescritor WHERE id = ?',
    [id],
  );
  if (!f || Number(f['profissional_id']) !== profissional)
    throw recusar(404, 'registro-inexistente', 'O favorito não foi encontrado entre os seus.');
  if (!Number(f['ativo'])) return id;
  await tx.alterar('favorito_prescritor', id, Number(f['versao']), { ativo: false });
  return id;
}
