// RepositorioOnboarding sobre o banco plataforma, pelo núcleo (lerPlataforma/escreverPlataforma): lista dos clientes
// com a origem ativa e a última execução, progresso de uma execução, e o enfileirar com o evento na mesma transação
// (o mesmo contrato do conector/sante_conector/plataforma.py: uma execução ativa por cliente pelo índice único).
import type { ClienteOnboarding, ExecucaoConector } from '@sgh/contratos';
import type { NucleoPlataforma } from '../../sessao/fonte-plataforma.js';
import { execucaoDaLinha } from './execucao.js';
import { ErroOnboarding, type RepositorioOnboarding } from './porta.js';

const COLUNAS_EXECUCAO = `e.id, e.tipo, e.estado, e.etapa, e.percentual, e.contadores, e.motivo_falha, e.solicitado_em,
  e.iniciado_em, e.concluido_em`;
const EVENTO = { importar: 'conector_carga', sincronizar: 'conector_diferencial' } as const;

function duplicado(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    const o = x as { errno?: number; code?: string };
    if (o.errno === 1062 || o.code === 'ER_DUP_ENTRY') return true;
  }
  return false;
}

export class RepositorioOnboardingPlataforma implements RepositorioOnboarding {
  constructor(private readonly nucleo: NucleoPlataforma) {}

  async listarClientes(): Promise<ClienteOnboarding[]> {
    const linhas = await this.nucleo.lerPlataforma('onboarding-listar', (l) =>
      l.consultar(
        `SELECT c.id AS cid, c.codigo, c.nome, c.situacao, c.origem_dados, o.caminho_relativo, o.tamanho_bytes,
                o.sha256, o.vinculado_em, ${COLUNAS_EXECUCAO}
           FROM cliente c
           LEFT JOIN cliente_origem o ON o.cliente_ativo = c.id
           LEFT JOIN conector_execucao e
                  ON e.id = (SELECT MAX(x.id) FROM conector_execucao x WHERE x.cliente_id = c.id)
          ORDER BY c.codigo`,
      ),
    );
    return linhas.map((l) => ({
      id: Number(l['cid']),
      codigo: String(l['codigo']),
      nome: String(l['nome']),
      situacao: String(l['situacao']),
      origemDados: String(l['origem_dados'] ?? ''),
      origem: l['caminho_relativo']
        ? {
            arquivo: String(l['caminho_relativo']),
            tamanhoBytes: Number(l['tamanho_bytes']),
            sha256: String(l['sha256']),
            vinculadoEm: l['vinculado_em'] instanceof Date ? l['vinculado_em'].toISOString() : null,
          }
        : null,
      ultimaExecucao: l['id'] == null ? null : execucaoDaLinha(l),
    }));
  }

  async execucao(codigo: string, id: number): Promise<ExecucaoConector | null> {
    const l = await this.nucleo.lerPlataforma('onboarding-execucao', (x) =>
      x.uma(
        `SELECT ${COLUNAS_EXECUCAO} FROM conector_execucao e JOIN cliente c ON c.id = e.cliente_id
          WHERE e.id = ? AND c.codigo = ?`,
        [id, codigo],
      ),
    );
    return l ? execucaoDaLinha(l) : null;
  }

  async historico(codigo: string, limite = 20): Promise<ExecucaoConector[]> {
    const linhas = await this.nucleo.lerPlataforma('onboarding-historico', (x) =>
      x.consultar(
        `SELECT ${COLUNAS_EXECUCAO} FROM conector_execucao e JOIN cliente c ON c.id = e.cliente_id
          WHERE c.codigo = ? ORDER BY e.id DESC LIMIT ${Math.max(1, Math.min(100, Math.trunc(limite)))}`,
        [codigo],
      ),
    );
    return linhas.map(execucaoDaLinha);
  }

  async enfileirar(
    codigo: string,
    tipo: 'importar' | 'sincronizar',
    admin: number | null,
    confirmarExclusaoEmMassa = false,
  ): Promise<number> {
    try {
      return await this.nucleo.escreverPlataforma('onboarding-enfileirar', async (e) => {
        const cli = await e.consultarParaAtualizar<{ id: number }>(
          'SELECT id FROM cliente WHERE codigo = ?',
          [codigo],
        );
        const cid = cli[0]?.id;
        if (cid == null) throw new ErroOnboarding('inexistente', 'Cliente inexistente.');
        const origem = await e.uma<{ id: number }>('SELECT id FROM cliente_origem WHERE cliente_ativo = ?', [
          cid,
        ]);
        if (!origem) throw new ErroOnboarding('invalido', 'Vincule o arquivo de origem antes de importar.');
        if (tipo === 'sincronizar') {
          const ok = await e.uma<{ n: number }>(
            `SELECT COUNT(*) AS n FROM conector_execucao WHERE cliente_id = ? AND tipo = 'importar'
               AND estado = 'concluida'`,
            [cid],
          );
          if (!ok || Number(ok.n) === 0)
            throw new ErroOnboarding('invalido', 'Sincronizar exige uma importação concluída.');
        }
        const eid = await e.inserir(
          `INSERT INTO conector_execucao (cliente_id, cliente_origem_id, tipo, estado, etapa,
                                          confirmar_exclusao_em_massa, solicitado_em, solicitado_por, criado_em,
                                          criado_por)
           VALUES (?, ?, ?, 'fila', 'aguardando o motor', ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?)`,
          [cid, origem.id, tipo, confirmarExclusaoEmMassa ? 1 : 0, admin, admin],
        );
        await e.executar(
          `INSERT INTO cliente_evento (cliente_id, tipo, detalhe, ocorrido_em, administrador_plataforma_id, criado_em,
                                       criado_por)
           VALUES (?, ?, ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?)`,
          [
            cid,
            EVENTO[tipo],
            JSON.stringify(
              confirmarExclusaoEmMassa
                ? {
                    confirmado_por: admin,
                    confirmar_exclusao_em_massa: true,
                    estado: 'fila',
                    execucao_id: eid,
                    tipo,
                  }
                : { estado: 'fila', execucao_id: eid, tipo },
            ),
            admin,
            admin,
          ],
        );
        return eid;
      });
    } catch (e) {
      if (duplicado(e))
        throw new ErroOnboarding('conflito', 'Já há uma execução na fila ou rodando para o cliente.');
      throw e;
    }
  }
}
