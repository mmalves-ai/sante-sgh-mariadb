// Massa sintética dos testes de integração do lote 04-01 no cliente f22_o4 (nenhum dado de pessoa): estabelecimentos
// de teste, o padrão de troca HL7 v2 e a limpeza do que cada parceiro de teste deixou.
import type { Escritor } from '@sgh/nucleo';

export const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
export const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';

export async function garantir(
  e: Escritor,
  sel: string,
  p: unknown[],
  ins: string,
  pi: unknown[],
): Promise<number> {
  const l = await e.uma<{ id: unknown }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

export function garantirEstabelecimento(e: Escritor, codigo: string): Promise<number> {
  return garantir(
    e,
    'SELECT id FROM estabelecimento WHERE codigo = ?',
    [codigo],
    'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
    [codigo, `Hospital de teste ${codigo}`, `Hospital de teste ${codigo} (fictício)`, new Date()],
  );
}

/** O padrão de troca de cada família usada pelos parceiros de teste (o catálogo do cliente pode não tê-lo). */
export async function garantirPadroes(e: Escritor): Promise<void> {
  for (const familia of ['hl7v2', 'fhir', 'api', 'proprio'])
    await garantir(
      e,
      'SELECT id FROM padrao_troca WHERE familia = ? AND ativo ORDER BY id LIMIT 1',
      [familia],
      'INSERT INTO padrao_troca (codigo, descricao, familia, criado_em) VALUES (?, ?, ?, ?)',
      [`f2241-${familia}`, `Padrão de teste ${familia}`, familia, new Date()],
    );
}

/** Apaga tudo o que o parceiro de teste deixou (mensagens, falhas, pontos, chaves, cliente da API e sistema). */
export async function limparParceiro(e: Escritor, codigo: string): Promise<void> {
  const p = await e.uma<{ id: unknown; sistema_externo_id: unknown; cliente_api_id: unknown }>(
    'SELECT id, sistema_externo_id, cliente_api_id FROM parceiro_dados WHERE codigo = ?',
    [codigo],
  );
  const s = await e.uma<{ id: unknown }>('SELECT id FROM sistema_externo WHERE codigo = ?', [codigo]);
  const sistema = p?.sistema_externo_id ?? s?.id ?? null;
  if (sistema !== null) {
    await e.executar(
      'DELETE FROM falha_integracao WHERE mensagem_integracao_saida_id IN (SELECT id FROM mensagem_integracao_saida WHERE sistema_externo_id = ?)',
      [sistema],
    );
    await e.executar('DELETE FROM mensagem_integracao_saida WHERE sistema_externo_id = ?', [sistema]);
    const arquivos = await e.consultar<{ arquivo_id: unknown }>(
      'SELECT arquivo_id FROM mensagem_integracao_entrada WHERE sistema_externo_id = ? AND arquivo_id IS NOT NULL',
      [sistema],
    );
    await e.executar('DELETE FROM mensagem_integracao_entrada WHERE sistema_externo_id = ?', [sistema]);
    for (const a of arquivos) await e.executar('DELETE FROM arquivo WHERE id = ?', [a.arquivo_id]);
    await e.executar('DELETE FROM ponto_integracao WHERE sistema_externo_id = ?', [sistema]);
  }
  if (p) {
    if (p.cliente_api_id !== null)
      await e.executar('DELETE FROM chave_api WHERE cliente_api_id = ?', [p.cliente_api_id]);
    await e.executar('DELETE FROM parceiro_dados WHERE id = ?', [p.id]);
    if (p.cliente_api_id !== null)
      await e.executar('DELETE FROM cliente_api WHERE id = ?', [p.cliente_api_id]);
  }
  if (sistema !== null) await e.executar('DELETE FROM sistema_externo WHERE id = ?', [sistema]);
}

/** As mensagens da fila comum gravadas pelos testes (ponto próprio dos testes). */
export async function limparFilaComum(e: Escritor, ponto: string): Promise<void> {
  await e.executar('DELETE FROM integracao_mensagem WHERE ponto = ?', [ponto]);
}
