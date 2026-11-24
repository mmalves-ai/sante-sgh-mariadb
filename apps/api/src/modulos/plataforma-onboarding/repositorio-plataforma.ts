// RepositorioOnboarding sobre o banco plataforma, pelo núcleo (lerPlataforma/escreverPlataforma): lista dos clientes
// com a origem ativa e a última execução, progresso de uma execução, e o enfileirar com o evento na mesma transação
// (o mesmo contrato do conector/sante_conector/plataforma.py: uma execução ativa por cliente pelo índice único).
import type { ClienteOnboarding, ExecucaoConector } from '@sgh/contratos';
import type { Escritor } from '@sgh/nucleo';
import type { NucleoPlataforma } from '../../sessao/fonte-plataforma.js';
import { execucaoDaLinha } from './execucao.js';
import { ErroOnboarding, type RepositorioOnboarding } from './porta.js';
import type {
  DadosOrigemServidor,
  LinhaConectorCarga,
  LinhaExecucaoCarga,
  PlanoCarga,
  RepositorioCarga,
  SituacaoCarga,
} from './servico-carga.js';

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

// ── tela "Carga e sincronismo" (obra carga-painel, 2026-11-24) ───────────────────────────────────────────────────

const COLUNAS_CARGA = `e.id, e.tipo, e.estado, e.etapa, e.percentual, e.contadores, e.motivo_falha, e.solicitado_em,
  e.iniciado_em, e.concluido_em, e.batimento_em, e.pausa_solicitada_em, e.modo, e.arquivo_log, e.cliente_origem_id,
  TIMESTAMPDIFF(SECOND, COALESCE(e.batimento_em, e.iniciado_em, e.solicitado_em), UTC_TIMESTAMP(3)) AS seg_sem_batimento`;

const isoData = (v: unknown): string | null =>
  v == null || v === ''
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v).replace(' ', 'T') + 'Z').toISOString();

function jsonDe(v: unknown): Record<string, unknown> {
  try {
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const numOuNulo = (v: unknown): number | null => (v == null ? null : Number(v));
const textoOuNulo = (v: unknown): string | null => (v == null ? null : String(v));

function linhaCarga(l: Record<string, unknown>): LinhaExecucaoCarga {
  return {
    id: Number(l['id']),
    tipo: String(l['tipo']),
    estado: String(l['estado']),
    etapa: textoOuNulo(l['etapa']),
    percentual: Number(l['percentual'] ?? 0) || 0,
    contadores: jsonDe(l['contadores']),
    motivoFalha: textoOuNulo(l['motivo_falha']),
    solicitadoEm: isoData(l['solicitado_em']),
    iniciadoEm: isoData(l['iniciado_em']),
    concluidoEm: isoData(l['concluido_em']),
    batimentoEm: isoData(l['batimento_em']),
    pausaSolicitadaEm: isoData(l['pausa_solicitada_em']),
    modo: textoOuNulo(l['modo']),
    arquivoLog: textoOuNulo(l['arquivo_log']),
    origemId: numOuNulo(l['cliente_origem_id']),
    segundosSemBatimento: numOuNulo(l['seg_sem_batimento']),
  };
}

async function evento(
  e: Escritor,
  cid: number,
  tipo: string,
  detalhe: Record<string, unknown>,
  admin: number | null,
): Promise<void> {
  await e.executar(
    `INSERT INTO cliente_evento (cliente_id, tipo, detalhe, ocorrido_em, administrador_plataforma_id, criado_em,
                                 criado_por)
     VALUES (?, ?, ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?)`,
    [cid, tipo, JSON.stringify(detalhe), admin, admin],
  );
}

async function clienteTravado(e: Escritor, codigo: string): Promise<number> {
  const cli = await e.consultarParaAtualizar<{ id: number }>('SELECT id FROM cliente WHERE codigo = ?', [
    codigo,
  ]);
  const cid = cli[0]?.id;
  if (cid == null) throw new ErroOnboarding('inexistente', 'Cliente inexistente.');
  return Number(cid);
}

export class RepositorioCargaPlataforma implements RepositorioCarga {
  constructor(private readonly nucleo: NucleoPlataforma) {}

  async listarConectores(): Promise<LinhaConectorCarga[]> {
    const linhas = await this.nucleo.lerPlataforma('carga-conectores', (l) =>
      l.consultar(
        `SELECT c.codigo, c.nome, o.id AS oid, o.tipo AS otipo, o.nome_exibicao, o.caminho_relativo, o.servidor_host,
                o.servidor_porta, o.servidor_banco, o.senha_referencia_cofre, ${COLUNAS_CARGA}
           FROM cliente c
           LEFT JOIN cliente_origem o ON o.cliente_ativo = c.id
           LEFT JOIN conector_execucao e
                  ON e.id = (SELECT MAX(x.id) FROM conector_execucao x WHERE x.cliente_id = c.id)
          ORDER BY c.codigo`,
      ),
    );
    return linhas.map((l) => ({
      codigo: String(l['codigo']),
      nome: String(l['nome']),
      origem:
        l['oid'] == null
          ? null
          : {
              tipo: l['otipo'] === 'firebird_servidor' ? 'firebird_servidor' : 'firebird_arquivo',
              nomeExibicao: textoOuNulo(l['nome_exibicao']),
              caminhoRelativo: textoOuNulo(l['caminho_relativo']),
              host: textoOuNulo(l['servidor_host']),
              porta: numOuNulo(l['servidor_porta']),
              banco: textoOuNulo(l['servidor_banco']),
              senhaReferencia: textoOuNulo(l['senha_referencia_cofre']),
            },
      ultimaExecucao: l['id'] == null ? null : linhaCarga(l),
    }));
  }

  async origemDoCliente(codigo: string): Promise<{ existe: boolean; tipo: string | null }> {
    const l = await this.nucleo.lerPlataforma('carga-origem', (x) =>
      x.uma(
        `SELECT c.id, o.tipo FROM cliente c LEFT JOIN cliente_origem o ON o.cliente_ativo = c.id WHERE c.codigo = ?`,
        [codigo],
      ),
    );
    return { existe: !!l, tipo: l ? textoOuNulo(l['tipo']) : null };
  }

  async gravarOrigemServidor(
    codigo: string,
    d: DadosOrigemServidor,
    referenciaSenha: string,
    admin: number | null,
  ): Promise<{ origemId: number; nova: boolean }> {
    return this.nucleo.escreverPlataforma('carga-origem-servidor', async (e) => {
      const cid = await clienteTravado(e, codigo);
      const ativa = await e.uma('SELECT id FROM conector_execucao WHERE cliente_ativo = ?', [cid]);
      if (ativa)
        throw new ErroOnboarding(
          'conflito',
          'Há uma carga em andamento: pause ou aguarde antes de trocar a origem.',
        );
      const atual = await e.uma<{ id: number; tipo: string }>(
        'SELECT id, tipo FROM cliente_origem WHERE cliente_ativo = ?',
        [cid],
      );
      let origemId: number;
      let nova = false;
      const desativadas: number[] = [];
      if (atual && atual.tipo === 'firebird_servidor') {
        origemId = Number(atual.id);
        await e.executar(
          `UPDATE cliente_origem SET nome_exibicao = ?, servidor_host = ?, servidor_porta = ?, servidor_banco = ?,
                  servidor_usuario = ?, senha_referencia_cofre = ?, alterado_em = UTC_TIMESTAMP(3), alterado_por = ?,
                  versao = versao + 1
            WHERE id = ?`,
          [d.nomeExibicao, d.host, d.porta, d.banco, d.usuario, referenciaSenha, admin, origemId],
        );
      } else {
        if (atual) {
          desativadas.push(Number(atual.id));
          await e.executar(
            `UPDATE cliente_origem SET ativo = FALSE, alterado_em = UTC_TIMESTAMP(3), alterado_por = ?,
                    versao = versao + 1 WHERE id = ?`,
            [admin, atual.id],
          );
        }
        nova = true;
        origemId = await e.inserir(
          `INSERT INTO cliente_origem (cliente_id, tipo, nome_exibicao, servidor_host, servidor_porta, servidor_banco,
                                       servidor_usuario, senha_referencia_cofre, vinculado_em, vinculado_por, ativo,
                                       criado_em, criado_por)
           VALUES (?, 'firebird_servidor', ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, TRUE, UTC_TIMESTAMP(3), ?)`,
          [cid, d.nomeExibicao, d.host, d.porta, d.banco, d.usuario, referenciaSenha, admin, admin],
        );
      }
      // Sem o caminho do banco nem o usuário no evento: só o endereço de rede e a troca.
      await evento(
        e,
        cid,
        'conector_origem_servidor',
        { cliente_origem_id: origemId, nova, host: d.host, porta: d.porta, origens_desativadas: desativadas },
        admin,
      );
      return { origemId, nova };
    });
  }

  async cargaDoCliente(
    codigo: string,
  ): Promise<{ origemId: number | null; execucao: LinhaExecucaoCarga | null } | null> {
    return this.nucleo.lerPlataforma('carga-progresso', async (x) => {
      const c = await x.uma(
        `SELECT c.id, o.id AS oid FROM cliente c LEFT JOIN cliente_origem o ON o.cliente_ativo = c.id
          WHERE c.codigo = ?`,
        [codigo],
      );
      if (!c) return null;
      const cid = Number(c['id']);
      const l =
        (await x.uma(`SELECT ${COLUNAS_CARGA} FROM conector_execucao e WHERE e.cliente_ativo = ?`, [cid])) ??
        (await x.uma(
          `SELECT ${COLUNAS_CARGA} FROM conector_execucao e WHERE e.cliente_id = ? ORDER BY e.id DESC LIMIT 1`,
          [cid],
        ));
      return { origemId: numOuNulo(c['oid']), execucao: l ? linhaCarga(l) : null };
    });
  }

  async enfileirarCarga(
    codigo: string,
    decidir: (s: SituacaoCarga) => PlanoCarga,
    admin: number | null,
  ): Promise<{ id: number; plano: PlanoCarga }> {
    try {
      return await this.nucleo.escreverPlataforma('carga-enfileirar', async (e) => {
        const cid = await clienteTravado(e, codigo);
        if (await e.uma('SELECT id FROM conector_execucao WHERE cliente_ativo = ?', [cid]))
          throw new ErroOnboarding('conflito', 'Já há uma carga na fila ou rodando para o cliente.');
        const origem = await e.uma<{ id: number }>('SELECT id FROM cliente_origem WHERE cliente_ativo = ?', [
          cid,
        ]);
        const concl = await e.uma<{ n: number }>(
          `SELECT COUNT(*) AS n FROM conector_execucao WHERE cliente_id = ? AND tipo = 'importar'
             AND estado = 'concluida'`,
          [cid],
        );
        const ui = await e.uma(
          `SELECT id, estado, cliente_origem_id FROM conector_execucao WHERE cliente_id = ? AND tipo = 'importar'
            ORDER BY id DESC LIMIT 1`,
          [cid],
        );
        const u = await e.uma(
          `SELECT id, tipo, estado, cliente_origem_id, modo, contadores FROM conector_execucao WHERE cliente_id = ?
            ORDER BY id DESC LIMIT 1`,
          [cid],
        );
        const situacao: SituacaoCarga = {
          origemId: origem ? Number(origem.id) : null,
          importacaoConcluida: Number(concl?.n ?? 0) > 0,
          ultimaImportacao: ui
            ? {
                id: Number(ui['id']),
                estado: String(ui['estado']) as NonNullable<SituacaoCarga['ultimaImportacao']>['estado'],
                origemId: numOuNulo(ui['cliente_origem_id']),
              }
            : null,
          ultima: u
            ? {
                id: Number(u['id']),
                tipo: u['tipo'] === 'sincronizar' ? 'sincronizar' : 'importar',
                estado: String(u['estado']) as NonNullable<SituacaoCarga['ultima']>['estado'],
                origemId: numOuNulo(u['cliente_origem_id']),
                modo: u['modo'] === 'completa' || u['modo'] === 'diferencial' ? u['modo'] : null,
                reprocessarRecusadas: jsonDe(u['contadores'])['reprocessar_recusadas'] === true,
              }
            : null,
        };
        const plano = decidir(situacao);
        const contadores: Record<string, unknown> = {};
        if (plano.continuarDe != null) contadores['continuar_de'] = plano.continuarDe;
        if (plano.reprocessarRecusadas) contadores['reprocessar_recusadas'] = true;
        const id = await e.inserir(
          `INSERT INTO conector_execucao (cliente_id, cliente_origem_id, tipo, estado, etapa, modo, contadores,
                                          solicitado_em, solicitado_por, criado_em, criado_por)
           VALUES (?, ?, ?, 'fila', 'aguardando o motor', ?, ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3), ?)`,
          [
            cid,
            situacao.origemId,
            plano.tipo,
            plano.modo,
            Object.keys(contadores).length ? JSON.stringify(contadores) : null,
            admin,
            admin,
          ],
        );
        await evento(
          e,
          cid,
          EVENTO[plano.tipo],
          { estado: 'fila', execucao_id: id, tipo: plano.tipo, modo: plano.modo, ...contadores },
          admin,
        );
        return { id, plano };
      });
    } catch (e) {
      if (duplicado(e))
        throw new ErroOnboarding('conflito', 'Já há uma carga na fila ou rodando para o cliente.');
      throw e;
    }
  }

  async pedirPausa(codigo: string, admin: number | null): Promise<number> {
    return this.nucleo.escreverPlataforma('carga-pausar', async (e) => {
      const cid = await clienteTravado(e, codigo);
      const l = (
        await e.consultarParaAtualizar(
          'SELECT id, estado, pausa_solicitada_em FROM conector_execucao WHERE cliente_ativo = ?',
          [cid],
        )
      )[0];
      if (!l) throw new ErroOnboarding('invalido', 'Não há carga em andamento para pausar.');
      const id = Number(l['id']);
      if (l['estado'] === 'pausando' || l['pausa_solicitada_em'] != null) return id;
      if (l['estado'] === 'fila')
        throw new ErroOnboarding(
          'conflito',
          'A carga ainda está na fila: aguarde o serviço começar para pausar.',
        );
      await e.executar(
        `UPDATE conector_execucao SET pausa_solicitada_em = UTC_TIMESTAMP(3), pausa_solicitada_por = ?,
                alterado_em = UTC_TIMESTAMP(3), alterado_por = ?, versao = versao + 1
          WHERE id = ?`,
        [admin, admin, id],
      );
      await evento(e, cid, 'conector_pausa', { execucao_id: id, estado: String(l['estado']) }, admin);
      return id;
    });
  }

  async arquivoLog(codigo: string, id: number): Promise<string | null | undefined> {
    const l = await this.nucleo.lerPlataforma('carga-log', (x) =>
      x.uma(
        `SELECT e.arquivo_log FROM conector_execucao e JOIN cliente c ON c.id = e.cliente_id
          WHERE e.id = ? AND c.codigo = ?`,
        [id, codigo],
      ),
    );
    return l ? textoOuNulo(l['arquivo_log']) : undefined;
  }
}
