// Porta própria de cargos e salários sobre o MariaDB do cliente (F2.2, lote 03-03), pelo @sgh/nucleo.
//   - Leituras: `nucleo.lerSomente`, com o estabelecimento da sessão onde a tabela o tem.
//   - Gravações: uma operação do Executor por gravação da tela (`gravarSgh`): idempotência, trilha e outbox na mesma
//     transação; a operação declara as tabelas que grava; a versão otimista é conferida pelo `tx.alterar`.
// O cargo é da rede inteira (a tabela `cargo` não tem estabelecimento): a lista, o nome único e a recontagem das
// dependências valem para o cliente todo. O histórico das correções (motivo, valor anterior e novo) mora na trilha de
// auditoria da própria gravação (`dados.correcao`), e o retrato da exclusão também (`dados.retrato`).
// Melhoria: o código do cargo é número de negócio do cliente (sequência "cargo", prefixo CG-), não digitado.
// Melhoria: a exclusão do cargo nunca usado é lógica (excluido_em/excluido_por), com o retrato na trilha.
// Melhoria: o cargo herda "profissional de saúde" da área do CBO no cadastro oficial e "exige registro" do conselho.
// Melhoria: a recontagem das dependências roda de novo dentro da transação da exclusão (sem corrida com a tela) e cobre
//   todas as tabelas com chave estrangeira para o cargo (DEPENDENCIAS_CARGO, conferida contra o information_schema no
//   teste de integração): a exclusão lógica não deixa referência viva a um cargo "excluído".
// Melhoria: a alteração só resolve de novo o CBO e o conselho que mudaram; um CBO ou conselho desativado depois não
//   trava a correção do nome, da descrição ou dos requisitos, e o que veio da migração não é recalculado à toa.
// Melhoria: a faixa só conta como vigente quando a tabela salarial está "vigente" e já começou no fuso do
//   estabelecimento (rascunho e tabela futura não contam).
// Pendência de modelo (pedido do lote 03-03): a faixa salarial por linha com vigência e o quadro de vagas aprovado
// por centro de custo não têm coluna/tabela no modelo. As faixas do modelo (faixa_salarial na tabela_salarial com
// vigência) são lidas; a inclusão, a versão, a situação e a exclusão de faixa e de vaga do quadro recusam com
// 409 modelo-pendente, sem gravar nada.
import { randomUUID } from 'node:crypto';
import {
  type ContextoNucleo,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  definirOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../../exames/public-api.js';
import { civil, FUSO_PADRAO, relogioNoFuso } from '../../exames/relogio.js';
import type {
  AlvoDependenciaCargos,
  CargoRegistrado,
  ContextoCargos,
  CorrecaoRegistrada,
  DadosCargo,
  DependenciaContada,
  FaixaSalarialRegistrada,
  GravadorCargos,
  OcupacaoCargo,
  PortaCargos,
  TabelaCargos,
  VagaQuadroRegistrada,
} from './porta-cargos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoCargos = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** Tabelas que a operação de cargos grava. */
const TABELAS_GRAVACAO = ['cargo', 'sequencia_negocio'] as const;
const TETO_LISTA = 2000;
const TETO_BUSCA_CBO = 30;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const textoN = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
/** DATETIME do banco → "AAAA-MM-DDTHH:MM" no fuso padrão. */
const instante = (v: unknown): string => {
  if (v instanceof Date) {
    const c = civil(v, FUSO_PADRAO);
    return `${c.data}T${c.hhmm.slice(0, 2)}:${c.hhmm.slice(2, 4)}`;
  }
  return v ? String(v).replace(' ', 'T').slice(0, 16) : '';
};
const quem = (login: unknown, id: unknown) => textoN(login) ?? (id ? `usuário ${String(id)}` : 'sistema');
const json = (v: unknown): Record<string, unknown> => {
  if (v === null || v === undefined) return {};
  const o = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
};
/** Escapa o termo para o LIKE (nunca concatenado ao SQL: vai como parâmetro). */
const semCuringa = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

export const modeloPendente = (o: string) =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Recurso aguardando o modelo do banco',
    `${o} aguarda a coluna ou tabela no modelo do banco (pedido registrado): nada foi gravado.`,
  );
const FAIXA_PENDENTE = 'A faixa salarial por linha, com vigência e versão,';
const QUADRO_PENDENTE = 'O quadro de vagas aprovado por cargo e centro de custo';

/** Mesmo código da tela e da memória para a versão antiga. */
const desatualizado = () =>
  new ErroOperacao(
    409,
    'desatualizado',
    'Operação recusada',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

const semEstabelecimento = () => recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');

const SQL_CARGO = `
  SELECT c.id, c.nome, o.codigo_cbo, c.descricao, c.requisitos, cc.sigla AS conselho, c.ativo, c.versao,
         c.criado_por, uc.login AS criado_login, c.criado_em, c.alterado_por, ua.login AS alterado_login, c.alterado_em,
         (SELECT t.motivo FROM trilha_auditoria t
           WHERE t.entidade = 'cargo' AND t.entidade_id = c.id
             AND JSON_VALUE(t.dados_depois, '$.dados.correcao.operacao') IN ('cargo.inativado', 'cargo.reativado')
           ORDER BY t.id DESC LIMIT 1) AS motivo_situacao
    FROM cargo c
    JOIN ocupacao_cbo o ON o.id = c.ocupacao_cbo_id
    LEFT JOIN conselho_classe cc ON cc.id = c.conselho_classe_id
    LEFT JOIN usuario uc ON uc.id = c.criado_por
    LEFT JOIN usuario ua ON ua.id = c.alterado_por
   WHERE c.excluido_em IS NULL`;

function cargoDe(r: Linha): CargoRegistrado {
  const criadoPor = quem(r['criado_login'], r['criado_por']);
  const criadoEm = instante(r['criado_em']);
  const alterado = r['alterado_em'] !== null && r['alterado_em'] !== undefined;
  return {
    id: n(r['id']),
    nome: String(r['nome']),
    cbo: String(r['codigo_cbo']),
    descricao: textoN(r['descricao']),
    requisitos: textoN(r['requisitos']),
    conselho: textoN(r['conselho']),
    ativo: verdadeiro(r['ativo']),
    motivoSituacao: textoN(r['motivo_situacao']),
    versao: n(r['versao']),
    criadoPor,
    criadoEm,
    alteradoPor: alterado ? quem(r['alterado_login'], r['alterado_por']) : criadoPor,
    alteradoEm: alterado ? instante(r['alterado_em']) : criadoEm,
  };
}

// As faixas do modelo: faixa (nível) e degrau na tabela salarial do estabelecimento, com a vigência da tabela.
const SQL_FAIXA = `
  SELECT f.id, f.cargo_id, f.nivel, f.degrau, f.valor, t.vigencia_inicio, t.vigencia_fim, t.ativo, t.situacao,
         f.versao, f.criado_por, u.login AS criado_login, f.criado_em
    FROM faixa_salarial f
    JOIN tabela_salarial t ON t.id = f.tabela_salarial_id
    LEFT JOIN usuario u ON u.id = f.criado_por
   WHERE t.estabelecimento_id = ? AND f.excluido_em IS NULL`;

/** Hoje no fuso do estabelecimento (estabelecimento.fuso_horario; sem ele, o fuso padrão). */
async function hojeNoEstabelecimento(l: Pick<Leitor, 'uma'>, est: number): Promise<string> {
  const f = await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return relogioNoFuso(textoN(f?.['fuso_horario']) ?? FUSO_PADRAO).hoje;
}

/** A faixa vale hoje só se a tabela salarial está vigente e já começou (rascunho e tabela futura não contam). */
function faixaDe(r: Linha, hoje: string): FaixaSalarialRegistrada {
  const inicio = dataIso(r['vigencia_inicio']);
  const fim = dataIso(r['vigencia_fim']);
  const vigente =
    verdadeiro(r['ativo']) &&
    String(r['situacao']) === 'vigente' &&
    inicio !== null &&
    inicio <= hoje &&
    (fim === null || fim >= hoje);
  return {
    id: n(r['id']),
    cargo: n(r['cargo_id']),
    faixa: String(r['nivel']),
    nivel: String(r['degrau']),
    valor: Math.round(Number(r['valor']) * 100),
    desde: dataIso(r['vigencia_inicio']) ?? '',
    ate: dataIso(r['vigencia_fim']),
    anterior: null,
    motivo: null,
    ativo: vigente,
    motivoSituacao: null,
    versao: n(r['versao']),
    criadoPor: quem(r['criado_login'], r['criado_por']),
    criadoEm: instante(r['criado_em']),
  };
}

/**
 * Todas as tabelas com chave estrangeira para cargo(id) no modelo. A exclusão do cargo é lógica (a FK RESTRICT não
 * protege), então cada uma é recontada aqui; o teste de integração confere esta lista contra o information_schema.
 * O cargo é da rede: a contagem vale para todos os estabelecimentos. `excluido_em` filtra onde a tabela o tem.
 */
export const DEPENDENCIAS_CARGO: readonly { grupo: string; tabela: string; sql: string }[] = [
  ['Colaboradores no cargo', 'vinculo_trabalho', true],
  ['Faixas da tabela salarial', 'faixa_salarial', true],
  ['Vagas abertas para recrutamento', 'vaga', true],
  ['Histórico de cargo dos vínculos', 'historico_cargo', false],
  ['Funções do cargo', 'funcao', true],
  ['Trabalhadores sem vínculo no cargo', 'trabalhador_sem_vinculo', true],
  ['Ciclos de avaliação do cargo', 'ciclo_avaliacao', true],
  ['Cláusulas de convenção coletiva', 'clausula_convencao', true],
  ['Tarefas de manutenção preventiva', 'plano_preventivo_tarefa', true],
  ['Qualificações de plano de manutenção', 'qualificacao_plano_manutencao', true],
  ['Distribuição de documentos da qualidade', 'documento_qualidade_distribuicao', true],
  ['Recursos de propostas de iniciativa', 'proposta_iniciativa_recurso', true],
].map(([grupo, tabela, comExclusao]) => ({
  grupo: String(grupo),
  tabela: String(tabela),
  // Nome de tabela literal desta lista branca (nunca entrada do usuário).
  sql: `SELECT COUNT(*) AS n FROM ${String(tabela)} WHERE cargo_id = ?${comExclusao ? ' AND excluido_em IS NULL' : ''}`,
}));

async function contarDependenciasCargo(l: Leitor, id: number): Promise<DependenciaContada[]> {
  const r: DependenciaContada[] = [];
  for (const d of DEPENDENCIAS_CARGO) {
    const q = n((await l.uma(d.sql, [id]))?.['n']);
    if (q > 0) r.push({ grupo: d.grupo, tabela: d.tabela, coluna: 'cargo_id', quantidade: q });
  }
  return r;
}

const contextoDe = (c: ContextoPortaM18): ContextoNucleo => ({
  cliente: c.cliente,
  estabelecimento: c.estabelecimento,
  usuario: c.usuario,
  correlacao: (c.correlacao || 'cargos').slice(0, 64),
});

interface Extras {
  motivo: string | null;
  dados: Record<string, unknown>;
}

export class PortaCargosPropria implements PortaCargos {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCargos,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoCargos, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(contextoDe(c), fn);
  }

  private lerNoEstabelecimento<T>(c: ContextoCargos, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) return Promise.reject(semEstabelecimento());
    return this.ler(c, (l) => fn(l, est));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────

  /** Cargos e salários gravam pelas ações da própria tela (gravarSgh), não por operação de catálogo. */
  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw recusa('operacao-desconhecida', 'Cargos e salários gravam pelas ações da própria tela.');
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorCargos) => Promise<T>,
  ): Promise<T> {
    if (c.usuario === null) throw recusa('sem-usuario', 'A gravação de cargos exige o usuário da sessão.');
    let saida: { valor: T } | null = null;
    const extras: Extras = { motivo: null, dados: {} };
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'pessoas.cargos.gravacao',
      tabelas: TABELAS_GRAVACAO,
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        saida = { valor: await fn(gravadorSobre(tx, extras)) };
        return { valor: JSON.stringify(saida.valor ?? null) } as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'cargo', id: l?.entidadeId ?? null };
      },
      trilha: () => {
        const depois = linha()?.dadosDepois;
        const base = depois && typeof depois === 'object' ? (depois as Record<string, unknown>) : {};
        return { dados: { ...base, ...extras.dados }, motivo: extras.motivo ?? linha()?.motivo ?? null };
      },
    });
    const chave = `cargos:${randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...contextoDe(c), chaveIdempotencia: chave },
    );
    if (r.repetida) return JSON.parse(String(r.resultado['valor'] ?? 'null')) as T;
    if (!saida) throw new Error('Gravação de cargos sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────

  hoje(c: ContextoCargos): Promise<string> {
    const est = c.estabelecimento;
    if (est === null) return Promise.resolve(relogioNoFuso(FUSO_PADRAO).hoje);
    return this.ler(c, (l) => hojeNoEstabelecimento(l, est));
  }

  cargos(c: ContextoCargos): Promise<CargoRegistrado[]> {
    // O cargo é da rede inteira (sem estabelecimento na tabela).
    return this.ler(c, async (l) =>
      (await l.consultar(`${SQL_CARGO} ORDER BY c.nome, c.id`, [], { teto: TETO_LISTA })).map(cargoDe),
    );
  }

  cargo(c: ContextoCargos, id: number): Promise<CargoRegistrado | null> {
    return this.ler(c, async (l) => {
      const r = await l.uma(`${SQL_CARGO} AND c.id = ?`, [id]);
      return r ? cargoDe(r) : null;
    });
  }

  faixas(c: ContextoCargos, cargo: number | null): Promise<FaixaSalarialRegistrada[]> {
    return this.lerNoEstabelecimento(c, async (l, est) => {
      const hoje = await hojeNoEstabelecimento(l, est);
      return (
        await l.consultar(
          `${SQL_FAIXA}${cargo === null ? '' : ' AND f.cargo_id = ?'} ORDER BY f.cargo_id, f.nivel, f.degrau, t.vigencia_inicio, f.id`,
          cargo === null ? [est] : [est, cargo],
          { teto: TETO_LISTA },
        )
      ).map((r) => faixaDe(r, hoje));
    });
  }

  faixa(c: ContextoCargos, id: number): Promise<FaixaSalarialRegistrada | null> {
    return this.lerNoEstabelecimento(c, async (l, est) => {
      const r = await l.uma(`${SQL_FAIXA} AND f.id = ?`, [est, id]);
      return r ? faixaDe(r, await hojeNoEstabelecimento(l, est)) : null;
    });
  }

  /** Quadro de vagas aprovado: sem tabela no modelo (pedido do lote 03-03); a lista sai vazia até o DDL. */
  async vagas(): Promise<VagaQuadroRegistrada[]> {
    return [];
  }

  async vaga(): Promise<VagaQuadroRegistrada | null> {
    return null;
  }

  ocupacao(c: ContextoCargos): Promise<OcupacaoCargo[]> {
    return this.lerNoEstabelecimento(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT cargo_id, centro_custo_id, COUNT(*) AS n FROM vinculo_trabalho
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao NOT IN ('desligado', 'transferido')
            GROUP BY cargo_id, centro_custo_id`,
          [est],
          { teto: TETO_LISTA },
        )
      ).map((r) => ({
        cargo: n(r['cargo_id']),
        centroCusto: r['centro_custo_id'] === null ? null : n(r['centro_custo_id']),
        ocupadas: n(r['n']),
      })),
    );
  }

  dependencias(c: ContextoCargos, alvo: AlvoDependenciaCargos, id: number): Promise<DependenciaContada[]> {
    // Faixa e vaga do quadro não têm versão encadeada no modelo (pendência): nada as barra além do próprio modelo.
    if (alvo !== 'cargo') return Promise.resolve([]);
    return this.ler(c, (l) => contarDependenciasCargo(l, id));
  }

  buscarCbo(c: ContextoCargos, termo: string): Promise<{ codigo: string; rotulo: string }[]> {
    const t = termo.trim();
    if (t.length < 2) return Promise.resolve([]);
    const p = semCuringa(t);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT codigo_cbo, descricao FROM ocupacao_cbo
            WHERE ativo = TRUE AND (codigo_cbo LIKE CONCAT(?, '%') OR descricao LIKE CONCAT('%', ?, '%'))
            ORDER BY descricao, codigo_cbo LIMIT ${TETO_BUSCA_CBO}`,
          [p, p],
          { teto: TETO_BUSCA_CBO },
        )
      ).map((r) => ({
        codigo: String(r['codigo_cbo']),
        rotulo: `${String(r['codigo_cbo'])} · ${String(r['descricao'])}`,
      })),
    );
  }

  cboPorCodigo(c: ContextoCargos, codigos: readonly string[]): Promise<Map<string, string>> {
    const cs = [...new Set(codigos)].filter((x) => /^\d{6}$/.test(x));
    if (cs.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l) => {
      const rs = await l.consultar(
        `SELECT codigo_cbo, descricao FROM ocupacao_cbo WHERE codigo_cbo IN (${cs.map(() => '?').join(', ')})`,
        cs,
        { teto: cs.length },
      );
      return new Map(rs.map((r) => [String(r['codigo_cbo']), String(r['descricao'])]));
    });
  }

  conselhos(c: ContextoCargos): Promise<{ codigo: string; rotulo: string }[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT sigla, descricao FROM conselho_classe WHERE ativo = TRUE ORDER BY sigla',
          [],
          {
            teto: 200,
          },
        )
      ).map((r) => ({
        codigo: String(r['sigla']),
        rotulo: `${String(r['sigla'])} · ${String(r['descricao'])}`,
      })),
    );
  }

  correcoes(
    c: ContextoCargos,
    tabela: TabelaCargos,
    registros: readonly number[],
  ): Promise<CorrecaoRegistrada[]> {
    const ids = [...new Set(registros)];
    if (ids.length === 0) return Promise.resolve([]);
    // O histórico é a trilha das gravações da tela (a entidade e o id do registro, com a correção nos dados).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT t.id, t.entidade_id, t.motivo, t.ocorrido_em, t.usuario_id, u.login,
                  JSON_VALUE(t.dados_depois, '$.dados.correcao.operacao') AS operacao,
                  JSON_EXTRACT(t.dados_depois, '$.dados.correcao.antes') AS antes,
                  JSON_EXTRACT(t.dados_depois, '$.dados.correcao.depois') AS depois
             FROM trilha_auditoria t LEFT JOIN usuario u ON u.id = t.usuario_id
            WHERE t.entidade = ? AND t.entidade_id IN (${ids.map(() => '?').join(', ')})
              AND JSON_VALUE(t.dados_depois, '$.dados.correcao.operacao') IS NOT NULL
            ORDER BY t.id DESC`,
          [tabela, ...ids],
          { teto: TETO_LISTA },
        )
      ).map((r) => ({
        id: n(r['id']),
        tabela,
        registro: n(r['entidade_id']),
        operacao: String(r['operacao']),
        antes: json(r['antes']),
        depois: json(r['depois']),
        motivo: textoN(r['motivo']) ?? '',
        por: quem(r['login'], r['usuario_id']),
        em: instante(r['ocorrido_em']),
      })),
    );
  }
}

/** As gravações sobre a transação da operação (só as tabelas declaradas). */
function gravadorSobre(tx: TxOperacao, extras: Extras): GravadorCargos {
  const lerCargo = async (id: number) => {
    const r = await tx.uma(`${SQL_CARGO} AND c.id = ?`, [id]);
    return r ? cargoDe(r) : null;
  };
  /** CBO do cadastro oficial (só ativo: vale para o valor novo). Herda "profissional de saúde" da área do CBO. */
  const cboNovo = async (cbo: string) => {
    const o = await tx.uma('SELECT id, area_saude FROM ocupacao_cbo WHERE codigo_cbo = ? AND ativo = TRUE', [
      cbo,
    ]);
    if (!o)
      throw recusa('cbo-inexistente', 'O CBO informado não está no cadastro oficial de ocupações.', {
        campos: ['cbo'],
      });
    return { ocupacao_cbo_id: n(o['id']), profissional_saude: verdadeiro(o['area_saude']) };
  };
  /** Conselho do cadastro (só ativo: vale para o valor novo). "Exige registro" segue o conselho. */
  const conselhoNovo = async (sigla: string | null) => {
    if (sigla === null) return { conselho_classe_id: null, exige_registro_conselho: false };
    const cc = await tx.uma('SELECT id FROM conselho_classe WHERE sigla = ? AND ativo = TRUE', [sigla]);
    if (!cc)
      throw recusa('conselho-inexistente', 'O conselho informado não está no cadastro de conselhos.', {
        campos: ['conselho'],
      });
    return { conselho_classe_id: n(cc['id']), exige_registro_conselho: true };
  };
  const referencias = async (d: DadosCargo) => ({
    ...(await cboNovo(d.cbo)),
    ...(await conselhoNovo(d.conselho)),
  });
  /** Versão otimista com o mesmo código da tela ("desatualizado"), igual à memória. */
  const alterarLinha = (id: number, versao: number, valores: Record<string, unknown>) =>
    tx.alterar('cargo', id, versao, valores).catch((e: unknown) => {
      if (e instanceof ErroOperacao && e.problema.codigo === 'conflito-versao') throw desatualizado();
      throw e;
    });
  const nomeUnico = async (nome: string, outro: number | null) => {
    const r = await tx.uma(
      'SELECT id FROM cargo WHERE UPPER(nome) = UPPER(?) AND excluido_em IS NULL AND id <> ? LIMIT 1',
      [nome.trim(), outro ?? 0],
    );
    if (r) throw recusa('cargo-nome-em-uso', 'Já existe um cargo com este nome.', { campos: ['nome'] });
  };
  const soCargo = (t: TabelaCargos) => {
    if (t === 'faixa_salarial') throw modeloPendente(FAIXA_PENDENTE);
    if (t === 'quadro_vaga') throw modeloPendente(QUADRO_PENDENTE);
  };
  return {
    cargo: lerCargo,
    faixa: async (id) => {
      const est = tx.contexto.estabelecimento;
      if (est === null) throw semEstabelecimento();
      const r = await tx.uma(`${SQL_FAIXA} AND f.id = ?`, [est, id]);
      return r ? faixaDe(r, await hojeNoEstabelecimento(tx, est)) : null;
    },
    vaga: async () => null,
    incluirCargo: async (x) => {
      await nomeUnico(x.nome, null);
      const ref = await referencias(x);
      const agora = new Date();
      await garantirSequencia(
        tx,
        { tipo: 'cargo', estabelecimento: null, prefixo: 'CG-' },
        {
          usuario: tx.contexto.usuario,
          agora,
        },
      );
      const numero = await tx.proximoNumero('cargo', { porCliente: true });
      return tx.incluir('cargo', {
        codigo: numero.formatado,
        nome: x.nome.trim(),
        descricao: x.descricao,
        requisitos: x.requisitos,
        ...ref,
        data_inicio: relogioNoFuso(FUSO_PADRAO).hoje,
        ativo: true,
      });
    },
    alterarCargo: async (x) => {
      await nomeUnico(x.nome, x.id);
      // Só o que mudou é resolvido de novo: CBO ou conselho desativado depois não trava a correção dos outros campos,
      // e profissional_saude/exige_registro_conselho só mudam com o CBO/conselho.
      const atual = await tx.uma(
        `SELECT o.codigo_cbo, cc.sigla FROM cargo c JOIN ocupacao_cbo o ON o.id = c.ocupacao_cbo_id
           LEFT JOIN conselho_classe cc ON cc.id = c.conselho_classe_id WHERE c.id = ? AND c.excluido_em IS NULL`,
        [x.id],
      );
      if (!atual) throw recusa('nao-encontrado', 'O cargo não existe ou foi excluído.');
      await alterarLinha(x.id, x.versao, {
        nome: x.nome.trim(),
        descricao: x.descricao,
        requisitos: x.requisitos,
        ...(String(atual['codigo_cbo']) === x.cbo ? {} : await cboNovo(x.cbo)),
        ...(textoN(atual['sigla']) === x.conselho ? {} : await conselhoNovo(x.conselho)),
      });
    },
    situacao: async (x) => {
      soCargo(x.tabela);
      await alterarLinha(x.id, x.versao, { ativo: x.ativo });
    },
    excluir: async (x) => {
      soCargo(x.tabela);
      const v = await contarDependenciasCargo(tx, x.id);
      if (v.length > 0)
        throw recusa(
          'cargo-com-vinculos',
          `Há registros ligados: ${v.map((y) => `${y.grupo}: ${y.quantidade}`).join('; ')}.`,
        );
      const retrato = await tx.uma('SELECT * FROM cargo WHERE id = ? AND excluido_em IS NULL', [x.id]);
      if (!retrato) throw recusa('nao-encontrado', 'O cargo não existe ou já foi excluído.');
      await alterarLinha(x.id, x.versao, { excluido_em: new Date(), excluido_por: tx.contexto.usuario });
      extras.motivo = x.motivo;
      extras.dados = { ...extras.dados, retrato };
    },
    incluirFaixa: async () => {
      throw modeloPendente(FAIXA_PENDENTE);
    },
    versionarFaixa: async () => {
      throw modeloPendente(FAIXA_PENDENTE);
    },
    incluirVaga: async () => {
      throw modeloPendente(QUADRO_PENDENTE);
    },
    versionarVaga: async () => {
      throw modeloPendente(QUADRO_PENDENTE);
    },
    registrarCorrecao: async (x) => {
      extras.motivo = x.motivo;
      extras.dados = {
        ...extras.dados,
        correcao: {
          tabela: x.tabela,
          registro: x.registro,
          operacao: x.operacao,
          antes: x.antes,
          depois: x.depois,
        },
      };
    },
  };
}
