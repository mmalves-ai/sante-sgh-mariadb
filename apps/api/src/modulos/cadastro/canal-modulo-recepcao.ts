// Canal de entrada do módulo de recepção (F3.1, 02-CAD linha 2; migração 04_REC/93_canal_modulo_recepcao). Sem local
// de atendimento, a abertura do atendimento e a admissão da internação tiram o módulo de recepção do canal por onde o
// paciente entra (moduloDaAbertura, no domínio): agenda, urgência, internação, exames ou demanda espontânea. Aqui a
// leitura dos módulos com o canal e a operação que declara (ou tira) o canal de um módulo. A validação é a do domínio
// (errosDoCanal); um canal só tem um módulo (chave única no banco, recusada antes com mensagem própria). Nada se apaga:
// tirar o canal é gravar nulo, com a trilha na mesma transação.
import { CANAIS_ENTRADA, type CanalEntrada, errosDoCanal } from '@sgh/dominio-cadastro';
import { definirOperacao, type Leitor, recusa } from '@sgh/nucleo';
import { z } from 'zod';
import type { RegistroTrilhaTela } from './tipos.js';

export interface ModuloRecepcaoComCanal {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly ativo: boolean;
  readonly canal: CanalEntrada | null;
  readonly versao: number;
}

/** Os módulos de recepção da rede, com o canal de entrada declarado (ativos primeiro). */
export async function lerModulosComCanal(l: Leitor): Promise<ModuloRecepcaoComCanal[]> {
  const linhas = await l.consultar(
    `SELECT id, codigo, descricao, ativo, canal_entrada, versao FROM modulo_recepcao
      ORDER BY ativo DESC, descricao, id`,
    [],
    { teto: 500 },
  );
  return linhas.map((x) => ({
    id: Number(x['id']),
    codigo: String(x['codigo']),
    descricao: String(x['descricao']),
    ativo: x['ativo'] === true || Number(x['ativo']) === 1,
    canal: errosDoCanal(x['canal_entrada'] as string | null).length
      ? null
      : ((x['canal_entrada'] as CanalEntrada | null) ?? null),
    versao: Number(x['versao']),
  }));
}

export const esquemaCanalModulo = z
  .object({
    modulo: z.number().int().positive(),
    versao: z.number().int().positive(),
    canal: z.string().trim().max(20).nullable(),
  })
  .strict();
export type EntradaCanalModulo = z.infer<typeof esquemaCanalModulo>;

/** Declara o canal de entrada de um módulo de recepção (nulo tira o canal). */
export const operacaoGravarCanalModulo = (trilha: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.gravar-canal-modulo-recepcao',
    tabelas: ['modulo_recepcao'],
    entrada: esquemaCanalModulo,
    acao: 'alteracao',
    async gravar(tx, e) {
      const canal = e.canal === '' ? null : e.canal;
      if (errosDoCanal(canal).length)
        throw recusa('canal-invalido', `Canal de entrada inválido: use ${CANAIS_ENTRADA.join(', ')}.`, {
          campos: ['canal'],
        });
      const m = await tx.uma('SELECT id, ativo FROM modulo_recepcao WHERE id = ?', [e.modulo]);
      if (!m) throw recusa('modulo-inexistente', 'O módulo de recepção não existe.', { campos: ['modulo'] });
      if (canal !== null) {
        if (!(m['ativo'] === true || Number(m['ativo']) === 1))
          throw recusa('modulo-inativo', 'Módulo inativo não atende canal de entrada.', {
            campos: ['modulo'],
          });
        const outro = await tx.uma(
          'SELECT id, codigo, descricao FROM modulo_recepcao WHERE canal_entrada = ? AND id <> ?',
          [canal, e.modulo],
        );
        if (outro)
          throw recusa(
            'canal-ocupado',
            `O canal já é atendido pelo módulo ${String(outro['codigo'])} (${String(outro['descricao'])}): tire o canal dele antes.`,
            { campos: ['canal'] },
          );
      }
      try {
        await tx.alterar('modulo_recepcao', e.modulo, e.versao, { canal_entrada: canal });
      } catch (x) {
        if ((x as { errno?: unknown }).errno === 1062)
          throw recusa('canal-ocupado', 'O canal já é atendido por outro módulo.', { campos: ['canal'] });
        throw x;
      }
      return { id: e.modulo };
    },
    alvo: (e) => ({ tabela: 'modulo_recepcao', id: e.modulo }),
    trilha: () => ({ dados: trilha.dadosDepois ?? null, motivo: null }),
  });
