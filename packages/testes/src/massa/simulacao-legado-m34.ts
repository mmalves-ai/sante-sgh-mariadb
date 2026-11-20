// M34 (D-PROTOLIFE-34): a gravação que o BANCO RECUSA nos perfis de prioridade da classificação de risco externa
// (RETPPROTOLIFE, dado do fornecedor; o gatilho TRG_RETPPROTOLIFE_BIUD levanta e_geral_sistema em inclusão, alteração e
// exclusão). Só para o teste de integração provar a recusa, sempre na transação desfeita (nunca confirmada); nenhuma
// receita faz isto. A saída é só a contagem e a mensagem do banco (nenhum valor de linha).
import type { Escritor } from '@sgh/legado';

/** Quantos perfis há (contagem; nenhum nome). */
export async function perfisDaClassificacaoExterna(e: Pick<Escritor, 'consultar'>): Promise<number> {
  const [r] = await e.consultar('SELECT COUNT(*) N FROM RETPPROTOLIFE', [], { teto: 1 });
  return Number(r?.['N'] ?? 0);
}

/** A alteração sem efeito (o mesmo nome) do primeiro perfil: o gatilho do fornecedor recusa. */
export async function alterarPerfilDaClassificacaoExterna(e: Escritor): Promise<void> {
  await e.executar('UPDATE RETPPROTOLIFE SET NOME = NOME WHERE ID = (SELECT MIN(ID) FROM RETPPROTOLIFE)', []);
}

/** A inclusão de um perfil sintético: o gatilho do fornecedor recusa. */
export async function incluirPerfilDaClassificacaoExterna(e: Escritor): Promise<void> {
  await e.executar(
    'INSERT INTO RETPPROTOLIFE (ID, NOME) VALUES ((SELECT COALESCE(MAX(ID), 0) + 1 FROM RETPPROTOLIFE), ?)',
    ['PERFIL SINTETICO SGH M34'],
  );
}
