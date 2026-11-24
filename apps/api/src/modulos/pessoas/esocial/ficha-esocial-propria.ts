// Ficha do eSocial do vínculo no banco próprio (modulos-proprios-2, família folha-executor): a gravação (gravarFicha do
// gravador do eSocial) e a leitura, sobre ficha_esocial_vinculo (migração 15_RH/96_ficha_esocial). A ficha chega
// inteira e já cifrada pela API; o banco guarda o texto cifrado e a versão (trava otimista), com o mesmo comportamento
// da porta de memória: ficha nova só sem ficha; troca só com a versão que a tela leu; senão, `desatualizado`.
// O vínculo tem de ser do estabelecimento da sessão. Quem alterou e quando vêm da auditoria (alterado_por ou criado_por).
import { type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { exigirUsuario } from '../../qualidade/apoio-propria.js';
import type { FichaEsocialCifrada, GravacaoFichaEsocial } from './porta-esocial.js';

/** A tabela que a gravação da ficha escreve (soma-se às tabelas do gravador do eSocial). */
export const TABELA_FICHA_ESOCIAL = 'ficha_esocial_vinculo';

const n = (v: unknown): number => Number(v ?? 0);
const instante = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const desatualizado = () => recusa('desatualizado', 'A ficha mudou desde a leitura: abra de novo e confira.');

const SQL_FICHA = `
  SELECT f.id, f.vinculo_trabalho_id, f.dados_cifrados, f.versao, f.criado_em, f.alterado_em,
         COALESCE(ua.login, uc.login) AS alterado_login
    FROM ficha_esocial_vinculo f
    LEFT JOIN usuario uc ON uc.id = f.criado_por
    LEFT JOIN usuario ua ON ua.id = f.alterado_por
   WHERE f.estabelecimento_id = ? AND f.vinculo_trabalho_id = ?`;

function fichaDe(r: Record<string, unknown>): FichaEsocialCifrada {
  return {
    id: n(r['id']),
    vinculo: n(r['vinculo_trabalho_id']),
    dadosCifrados: String(r['dados_cifrados'] ?? ''),
    versao: n(r['versao']),
    alteradoPor: String(r['alterado_login'] ?? ''),
    alteradoEm: instante(r['alterado_em'] ?? r['criado_em']),
  };
}

/** A ficha do vínculo no estabelecimento da sessão (null sem ficha). */
export async function lerFichaEsocial(
  l: Pick<Leitor, 'uma'>,
  est: number,
  vinculo: number,
): Promise<FichaEsocialCifrada | null> {
  const r = await l.uma(SQL_FICHA, [est, vinculo]);
  return r ? fichaDe(r) : null;
}

/** Grava a ficha (nova com `versao` null; troca pela versão lida) e devolve o id e a versão nova. */
export async function gravarFichaEsocial(
  tx: TxOperacao,
  est: number,
  x: GravacaoFichaEsocial,
): Promise<{ id: number; versao: number }> {
  if (x.dadosCifrados.length === 0) throw recusa('ficha-vazia', 'A ficha do eSocial chegou vazia.');
  const [v] = await tx.consultarParaAtualizar(
    'SELECT id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [x.vinculo, est],
  );
  if (!v) throw recusa('vinculo-inexistente', 'O vínculo não existe neste estabelecimento.');
  await exigirUsuario(tx, x.por);
  const [atual] = await tx.consultarParaAtualizar(
    'SELECT id, estabelecimento_id, versao FROM ficha_esocial_vinculo WHERE vinculo_trabalho_id = ?',
    [x.vinculo],
  );
  if (x.versao === null) {
    if (atual) throw desatualizado();
    const id = await tx.incluir(TABELA_FICHA_ESOCIAL, {
      estabelecimento_id: est,
      vinculo_trabalho_id: x.vinculo,
      dados_cifrados: x.dadosCifrados,
    });
    return { id, versao: 1 };
  }
  if (!atual || n(atual['estabelecimento_id']) !== est || n(atual['versao']) !== x.versao)
    throw desatualizado();
  const versao = await tx.alterar(TABELA_FICHA_ESOCIAL, n(atual['id']), x.versao, {
    dados_cifrados: x.dadosCifrados,
  });
  return { id: n(atual['id']), versao };
}
