// Porta do SADT sobre o banco do cliente (M26), pelo @sgh/nucleo: leituras somente leitura nas tabelas do diagnóstico
// (requisicao_exame, exame_item, exame, setor_diagnostico, resultado_exame, amostra_biologica e o rastreio,
// aviso_valor_critico e as tentativas, regra_valor_critico, emissao_laudo, visualizacao_resultado_exame) e gravações
// pelo Executor, com a trilha na mesma transação. Toda leitura filtra o estabelecimento da sessão e os excluídos; o
// catálogo de exames, de analitos e de modalidades é da rede inteira (sem estabelecimento).
// Melhoria: o estado do exame vem da situação do item pedido e do rastreio da amostra (vocabulario-banco.ts), nunca de
// marcas S/N; a conferência da pulseira fica no evento da amostra (com a estação); a passagem de estado da amostra
// confere o estado relido sob trava (FOR UPDATE) e a versão; o aviso de valor crítico guarda cada tentativa de contato
// com o canal e o nível de escalonamento; a segunda via do laudo exige o motivo do cadastro (motivo_reimpressao); a faixa crítica é uma regra com vigência (a anterior é encerrada, não apagada).
// Melhoria: a regra de valor crítico do estabelecimento sobrepõe a da rede (a leitura mostra só a efetiva; a edição na
// unidade cria a regra da unidade e não mexe na da rede, que segue para as outras unidades).
// Melhoria: o aviso crítico vai ao solicitante da requisição (usuário ativo, pelo vínculo do profissional), nunca ao
// executante do atendimento de laboratório; a amostra vigente do exame ignora a rejeitada/cancelada (a recoleta volta
// à lista de coleta e o exame volta a "solicitado"); a leitura do resultado grava só a primeira abertura.
// Melhoria: toda inclusão passa por tx.incluir (auditoria e escritas da trilha); cada gravação leva o nome do evento
// da tela como operação e a chave de idempotência da requisição, quando a tela a manda.
// Pendências (pedido do lote 02-09; a tela recebe o motivo, nada em silêncio): as operações do executor
// (OPERACOES_SADT_PENDENTES: contrato novo) e as leituras/gravações em LEITURAS_PENDENTES e GRAVACOES_PENDENTES.
import {
  type AmostraDetalhe,
  type AvisoCritico,
  type ColetaGrupo,
  type EstadoAmostra,
  type ExameSadt,
  NIVEIS_ESCALONAMENTO,
  rotuloEstadoAmostra,
  rotuloEstadoExame,
  type SetorSadt,
  type ValorCriticoLido,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  erroConflitoVersao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { alvosDoAviso, avisoDoAlvo, type RegraCriticoCandidata } from '@sgh/dominio-sadt';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import { OPERACOES_SADT_PENDENTES } from './operacoes.js';
import { type ContextoSadt, type GravadorSghSadt, METODOS_PORTA_SADT, type PortaSadt, type VinculoDaSessao } from './porta.js';
import {
  atoDoExame,
  estadoDaAmostra,
  estadoDoItem,
  SITUACAO_DA_AMOSTRA,
  SITUACOES_DO_FILTRO,
  setorDoTipo,
  siglasDoAto,
  TIPOS_DO_SETOR,
} from './vocabulario-banco.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoSadt = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export const TETO_EXAMES_SADT = 500;
const TABELAS_GRAVACAO = [
  'amostra_biologica',
  'amostra_biologica_exame',
  'amostra_biologica_evento',
  'exame_item',
  'regra_valor_critico',
  'aviso_valor_critico',
  'aviso_valor_critico_tentativa',
  'visualizacao_resultado_exame',
  'emissao_laudo',
  'emissao_laudo_exame',
] as const;

/** Leituras que o banco ainda não atende, com o que falta (pedido do lote 02-09). */
export const LEITURAS_PENDENTES: Readonly<Record<string, string>> = {
  digitacao: 'a tela de digitação (modelo de resultado, variáveis de fórmula e grandezas por exame)',
  conferencia: 'a conferência do resultado antes da liberação (valores com faixa e versões)',
  filaLiberacao: 'a fila de liberação de cada setor',
  laudoParaEmitir: 'os dados do laudo para emissão',
  requisicoes: 'a lista de requisições do dia',
  atendimento: 'o atendimento para lançamento no setor',
  atendimentosPorNumero: 'a busca de atendimento por número para lançamento',
  orcamentos: 'os orçamentos do diagnóstico',
  orcamento: 'o orçamento do diagnóstico',
  apoio: 'os cadastros de apoio do lançamento (prestador, kit, recipiente, convênio)',
  parametros: 'os parâmetros do setor',
  indicadores: 'os indicadores do setor',
  laudosPortalDoPaciente: 'os laudos do paciente no portal',
  laudosPortalDoMedico: 'os laudos do médico externo no portal',
  laudoPortal: 'o laudo aberto no portal',
  acessoPorProtocolo: 'o acesso do paciente ao portal por protocolo',
  acessoDoMedico: 'o acesso do médico externo ao portal',
  acessoPorId: 'o acesso ao portal',
  autocadastros: 'os autocadastros de médicos externos no portal',
};

/** Gravações diretas que o banco ainda não atende (pedido do lote 02-09). */
export const GRAVACOES_PENDENTES: Readonly<Record<string, string>> = {
  registrarOrcamento: 'o orçamento do diagnóstico',
  marcarOrcamentoConvertido: 'a conversão do orçamento em atendimento',
  criarProtocoloPortal: 'o protocolo de acesso do paciente ao portal',
  registrarAutocadastro: 'o autocadastro do médico externo no portal',
  decidirAutocadastro: 'a decisão do autocadastro do médico externo',
  registrarTentativaPortal: 'as tentativas de acesso ao portal',
};

const pendente = (o: string): ErroOperacao =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Recurso ainda não disponível no banco',
    `${o.slice(0, 1).toUpperCase()}${o.slice(1)} ainda não está disponível neste banco: a tela fica em consulta.`,
  );

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1' || v === 1n;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
/** DATETIME do banco → "AAAA-MM-DDTHH:MM:SS". */
const instante = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : '';
const dataIso = (v: unknown): string | null => (v ? instante(v).slice(0, 10) : null);
const idadeAnos = (nasc: string | null, hoje: string): number | null => {
  if (!nasc) return null;
  const [a, m, d] = nasc.split('-').map(Number) as [number, number, number];
  const [ha, hm, hd] = hoje.split('-').map(Number) as [number, number, number];
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
};

const SQL_EXAME = `
  SELECT ei.id, ei.sequencia, ei.situacao, ei.urgente, ei.versao, ei.criado_em, ei.alterado_em, ei.emitido_em,
         ei.previsto_em, r.id AS requisicao, r.numero AS requisicao_numero, r.atendimento_id, r.paciente_id,
         r.solicitado_em, r.tipo_solicitacao, r.prioridade, r.unidade_assistencial_id, sd.tipo AS tipo_setor,
         e.id AS exame_id, e.codigo AS exame_codigo, e.sigla, e.nome AS exame_nome, mi.sigla_padrao,
         pf.nome AS paciente_nome, pf.data_nascimento, sx.sigla AS sexo, p.numero_prontuario,
         a.numero AS atendimento_numero,
         EXISTS (SELECT 1 FROM internacao i WHERE i.atendimento_id = a.id) AS internado,
         COALESCE(prof.nome_exibicao, pfp.nome) AS solicitante,
         mb.descricao AS material, rc.id AS recipiente_id, rc.descricao AS recipiente,
         ed.id AS especialidade_id, ed.descricao AS especialidade,
         am.id AS amostra_id, am.codigo_barras, am.situacao AS amostra_situacao,
         COALESCE(am.alterado_em, am.criado_em) AS amostra_em,
         EXISTS (SELECT 1 FROM visualizacao_resultado_exame v JOIN resultado_exame re ON re.id = v.resultado_exame_id
                  WHERE re.exame_item_id = ei.id) AS visualizado,
         EXISTS (SELECT 1 FROM resultado_exame re WHERE re.exame_item_id = ei.id AND re.critico = TRUE
                    AND re.excluido_em IS NULL) AS critico
    FROM exame_item ei
    JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
    JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id)
    JOIN exame e ON e.id = ei.exame_id
    LEFT JOIN modalidade_imagem mi ON mi.id = e.modalidade_imagem_id
    JOIN paciente p ON p.id = r.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN sexo sx ON sx.id = pf.sexo_id
    JOIN atendimento a ON a.id = r.atendimento_id
    LEFT JOIN profissional prof ON prof.id = r.solicitante_profissional_id
    LEFT JOIN pessoa_fisica pfp ON pfp.id = prof.pessoa_fisica_id
    LEFT JOIN material_biologico mb ON mb.id = ei.material_biologico_id
    LEFT JOIN recipiente_coleta rc ON rc.id = ei.recipiente_coleta_id
    LEFT JOIN especialidade_diagnostica ed ON ed.id = e.especialidade_diagnostica_id
    LEFT JOIN amostra_biologica am ON am.id = (
         SELECT abe.amostra_biologica_id FROM amostra_biologica_exame abe
           JOIN amostra_biologica x ON x.id = abe.amostra_biologica_id
          WHERE abe.exame_item_id = ei.id AND abe.excluido_em IS NULL AND x.excluido_em IS NULL
          ORDER BY x.situacao IN ('rejeitada', 'cancelada', 'descartada'), abe.amostra_biologica_id DESC LIMIT 1)
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND ei.excluido_em IS NULL
     AND sd.tipo IN ('laboratorio', 'imagem', 'metodos_graficos', 'endoscopia')`;

function exameDe(r: Linha, hoje: string): ExameSadt {
  const ato = atoDoExame(texto(r['tipo_setor']), r['sigla_padrao'] === null ? null : texto(r['sigla_padrao']));
  const amostra = r['amostra_id'] === null ? null : estadoDaAmostra(texto(r['amostra_situacao']));
  const estado = estadoDoItem({
    situacao: texto(r['situacao']),
    emitido: r['emitido_em'] !== null,
    visualizado: verdadeiro(r['visualizado']),
    amostra,
  });
  const nasc = dataIso(r['data_nascimento']);
  const sexo = texto(r['sexo']).toUpperCase();
  const tipo = texto(r['tipo_solicitacao']);
  return {
    id: n(r['id']),
    chave: {
      data: dataIso(r['solicitado_em']) ?? hoje,
      reg: n(r['atendimento_id']),
      conta: n(r['requisicao']),
      atend: verdadeiro(r['internado']) ? 'I' : 'E',
      ato,
      exame: (texto(r['sigla']) || texto(r['exame_codigo'])).slice(0, 4),
      sequencia: n(r['sequencia']),
    },
    versao: instante(r['alterado_em'] ?? r['criado_em']) || null,
    paciente: {
      id: n(r['paciente_id']),
      prontuario: Number(texto(r['numero_prontuario']).replace(/\D/g, '')) || 0,
      nome: texto(r['paciente_nome']),
      sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
      idadeAnos: idadeAnos(nasc, hoje),
      nascimento: nasc,
    },
    atendimento: {
      cabecalho: texto(r['atendimento_numero']),
      reg: n(r['atendimento_id']),
      tipo: verdadeiro(r['internado']) ? 'I' : 'E',
      unidade: nn(r['unidade_assistencial_id']),
      leito: null,
    },
    setor: setorDoTipo(texto(r['tipo_setor'])) ?? 'laboratorio',
    ato,
    atoRotulo: rotuloDoAto(ato),
    exame: { id: n(r['exame_id']), codigo: texto(r['exame_codigo']), nome: texto(r['exame_nome']) },
    estado,
    estadoRotulo: rotuloEstadoExame(estado),
    urgente: verdadeiro(r['urgente']) || texto(r['prioridade']) !== 'rotina',
    origem: tipo === 'pedido_prontuario' ? 'pedidoProntuario' : tipo === 'lancado_no_setor' ? 'lancadoNoSetor' : 'outro',
    solicitante: texto(r['solicitante']),
    pedidoEm: instante(r['solicitado_em']).slice(0, 16) || null,
    previsaoColeta: r['previsto_em'] === null ? null : instante(r['previsto_em']).slice(0, 16),
    material: r['material'] === null ? null : texto(r['material']),
    recipiente: r['recipiente_id'] === null ? null : { codigo: n(r['recipiente_id']), nome: texto(r['recipiente']) },
    especialidade:
      r['especialidade_id'] === null ? null : { codigo: n(r['especialidade_id']), nome: texto(r['especialidade']) },
    amostra:
      amostra === null
        ? null
        : {
            id: n(r['amostra_id']),
            codigo: texto(r['codigo_barras']),
            estado: amostra,
            rotulo: rotuloEstadoAmostra(amostra),
            em: instante(r['amostra_em']),
          },
    critico: verdadeiro(r['critico']),
  };
}

const ROTULOS_ATO: Readonly<Record<number, string>> = {
  15: 'Patologia clínica',
  16: 'Radiologia',
  21: 'Endoscopia',
  24: 'Ultrassonografia',
  25: 'Tomografia',
  26: 'Ressonância magnética',
  27: 'Ecocardiograma com Doppler',
  42: 'Outros exames de imagem',
  90: 'Métodos gráficos',
};
const rotuloDoAto = (ato: number) => ROTULOS_ATO[ato] ?? 'Outro';

const SQL_AMOSTRA = `
  SELECT am.id, am.codigo_barras, am.situacao, am.versao, am.paciente_id_req AS paciente_id, rc.descricao AS recipiente,
         pf.nome AS paciente_nome, pf.data_nascimento, sx.sigla AS sexo, p.numero_prontuario
    FROM (SELECT x.*, r.paciente_id AS paciente_id_req FROM amostra_biologica x
            JOIN requisicao_exame r ON r.id = x.requisicao_exame_id) am
    JOIN paciente p ON p.id = am.paciente_id_req
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN sexo sx ON sx.id = pf.sexo_id
    LEFT JOIN recipiente_coleta rc ON rc.id = am.recipiente_coleta_id
   WHERE am.estabelecimento_id = ? AND am.excluido_em IS NULL`;

export class PortaSadtPropria implements PortaSadt {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoSadt, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  private async hoje(l: Leitor, est: number): Promise<{ hoje: string; agora: string }> {
    const r = await l.uma<{ fuso_horario: string | null }>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
    const x = relogioNoFuso(r?.fuso_horario || FUSO_PADRAO);
    return { hoje: x.hoje, agora: `${x.hoje}T${x.hhmm.slice(0, 2)}:${x.hhmm.slice(2, 4)}:00` };
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(_c: ContextoSadt, op: string): Promise<LiberacaoGravacao> {
    const motivo = OPERACOES_SADT_PENDENTES[op];
    if (motivo) return { pode: false, codigo: 'operacao-nao-liberada', motivo: `Operação desligada no banco: ${motivo}.` };
    return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida no SADT.' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async executar(_c: ContextoSadt, op: string, _entrada: unknown, _ctx: ContextoOperacao): Promise<never> {
    const motivo = OPERACOES_SADT_PENDENTES[op];
    throw motivo ? pendente(motivo) : recusa('operacao-desconhecida', 'Operação desconhecida no SADT.');
  }

  async gravarSgh<T>(
    c: ContextoSadt,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorSghSadt) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: nomeDaGravacao('sadt', trilha),
      tabelas: TABELAS_GRAVACAO,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est)) };
        return resultadoDe(saida.valor);
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'exame_item', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = c.chaveIdempotencia ? `sadt:${c.chaveIdempotencia}` : `sadt:${randomUUID()}`;
    const r = await this.executor.executar(op, c.cliente, { chave }, { ...contextoDe(c), chaveIdempotencia: chave });
    // A mesma chave com a mesma entrada: o resultado da primeira execução, sem gravar de novo.
    if (!saida) return valorDe<T>(r.resultado);
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoSadt) {
    return this.ler(c, (l, est) => this.hoje(l, est));
  }

  examesDoSetor(c: ContextoSadt, f: Parameters<PortaSadt['examesDoSetor']>[1]) {
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      const p: unknown[] = [est, f.inicio, f.fim];
      let sql = `${SQL_EXAME} AND r.solicitado_em >= ? AND r.solicitado_em < DATE_ADD(?, INTERVAL 1 DAY)`;
      if (f.setor) {
        const tipos = TIPOS_DO_SETOR[f.setor];
        sql += ` AND sd.tipo IN (${lista(tipos.length)})`;
        p.push(...tipos);
      }
      const situacoes = SITUACOES_DO_FILTRO[f.situacao ?? 'todos'] ?? null;
      if (situacoes) {
        sql += ` AND ei.situacao IN (${lista(situacoes.length)})`;
        p.push(...situacoes);
      } else sql += ` AND ei.situacao NOT IN ('cancelado', 'recusado')`;
      if (f.situacao === 'aEmitir') sql += ' AND ei.emitido_em IS NULL';
      if (f.urgentes) sql += " AND (ei.urgente = TRUE OR r.prioridade <> 'rotina')";
      if (f.unidade) {
        sql += ' AND r.unidade_assistencial_id = ?';
        p.push(f.unidade);
      }
      if (f.termo) {
        sql += ' AND (pf.nome LIKE ? OR e.nome LIKE ? OR e.codigo = ?)';
        p.push(`%${f.termo}%`, `%${f.termo}%`, f.termo);
      }
      if (f.ato) {
        const siglas = siglasDoAto(f.ato);
        if (siglas) {
          sql += ` AND mi.sigla_padrao IN (${lista(siglas.length)})`;
          p.push(...siglas);
        }
      }
      const ls = await l.consultar(`${sql} ORDER BY r.solicitado_em, ei.id LIMIT ${TETO_EXAMES_SADT + 1}`, p, {
        teto: TETO_EXAMES_SADT + 1,
      });
      const todos = ls.map((r) => exameDe(r, hoje)).filter((x) => !f.ato || x.ato === f.ato);
      const itens = todos.slice(0, TETO_EXAMES_SADT);
      const contagens: Record<string, number> = {};
      for (const x of itens) contagens[x.estado] = (contagens[x.estado] ?? 0) + 1;
      return { itens, cortada: todos.length > TETO_EXAMES_SADT, contagens };
    });
  }

  async exame(c: ContextoSadt, id: number) {
    const [x] = await this.examesPorId(c, [id]);
    return x ?? null;
  }

  examesPorId(c: ContextoSadt, ids: readonly number[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      return (await l.consultar(`${SQL_EXAME} AND ei.id IN (${lista(ids.length)}) ORDER BY ei.id`, [est, ...ids])).map(
        (r) => exameDe(r, hoje),
      );
    });
  }

  coleta(c: ContextoSadt, f: { inicio: string; fim: string; unidade?: number; deHora?: string; ateHora?: string }) {
    return this.examesDoSetor(c, {
      setor: 'laboratorio',
      inicio: f.inicio,
      fim: f.fim,
      situacao: 'aReceber',
      ...(f.unidade ? { unidade: f.unidade } : {}),
    }).then((r) => {
      const grupos = new Map<string, ColetaGrupo>();
      const unidades = new Map<number, number>();
      for (const x of r.itens) {
        const hora = (x.previsaoColeta ?? x.pedidoEm ?? '').slice(11, 16);
        if ((f.deHora && hora < f.deHora) || (f.ateHora && hora > f.ateHora)) continue;
        if (x.atendimento.unidade !== null)
          unidades.set(x.atendimento.unidade, (unidades.get(x.atendimento.unidade) ?? 0) + 1);
        const k = `${x.paciente.id}:${x.recipiente?.codigo ?? 0}:${x.material ?? ''}`;
        const g = grupos.get(k) ?? {
          paciente: x.paciente,
          atendimento: {
            cabecalho: x.atendimento.cabecalho,
            tipo: x.atendimento.tipo,
            leito: x.atendimento.leito,
            unidade: x.atendimento.unidade,
          },
          recipiente: x.recipiente,
          material: x.material,
          previsao: x.previsaoColeta,
          urgente: false,
          exames: [],
          exigePulseira: x.atendimento.tipo === 'I',
        };
        g.urgente = g.urgente || x.urgente;
        const coletado = x.amostra !== null && x.amostra.estado !== 'rejeitada' && x.amostra.estado !== 'recoleta';
        g.exames.push({ id: x.id, codigo: x.exame.codigo, nome: x.exame.nome, coletado });
        grupos.set(k, g);
      }
      return {
        grupos: [...grupos.values()],
        cortada: r.cortada,
        unidades: [...unidades].map(([codigo, exames]) => ({ codigo, exames })),
      };
    });
  }

  mapa(c: ContextoSadt, f: { setor: SetorSadt; inicio: string; fim: string }) {
    return this.examesDoSetor(c, { setor: f.setor, inicio: f.inicio, fim: f.fim, situacao: 'aDigitar' }).then(
      (r) => ({
        // A bancada do exame (exame_setor_executante) entra com o pedido de leitura da bancada; até lá, uma só.
        bancadas: [
          { codigo: null, nome: 'Sem bancada', urgentes: r.itens.filter((x) => x.urgente).length, exames: r.itens },
        ],
        cortada: r.cortada,
      }),
    );
  }

  digitacao(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['digitacao']!));
  }
  conferencia(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['conferencia']!));
  }
  filaLiberacao(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['filaLiberacao']!));
  }

  liberacaoVigente(c: ContextoSadt, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT re.id, re.liberado_em,
                EXISTS (SELECT 1 FROM visualizacao_resultado_exame v WHERE v.resultado_exame_id = re.id) AS visto
           FROM resultado_exame re
           JOIN exame_item ei ON ei.id = re.exame_item_id
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE re.exame_item_id = ? AND r.estabelecimento_id = ? AND re.situacao = 'liberado' AND re.excluido_em IS NULL
          ORDER BY re.numero_versao DESC, re.id DESC LIMIT 1`,
        [id, est],
      );
      return r
        ? { id: n(r['id']), em: r['liberado_em'] === null ? null : instante(r['liberado_em']), visualizada: verdadeiro(r['visto']) }
        : null;
    });
  }

  liberadosComCritico(c: ContextoSadt, o: { desde: Date; hoje: string }) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT re.id, re.exame_item_id, re.liberado_em, r.paciente_id, r.atendimento_id, r.numero, ei.sequencia,
                  COALESCE(u.login, '') AS usuario
             FROM resultado_exame re
             JOIN exame_item ei ON ei.id = re.exame_item_id
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
             LEFT JOIN usuario u ON u.id = ei.liberado_por_usuario_id
            WHERE r.estabelecimento_id = ? AND re.situacao = 'liberado' AND re.critico = TRUE
              AND re.excluido_em IS NULL AND re.liberado_em >= ?
              AND NOT EXISTS (SELECT 1 FROM aviso_valor_critico a WHERE a.resultado_exame_id = re.id)
            ORDER BY re.liberado_em, re.id`,
          [est, o.desde],
          { teto: 500 },
        )
      ).map((r) => ({
        exame: n(r['exame_item_id']),
        chave: `${texto(r['numero'])}:${n(r['sequencia'])}`,
        liberacao: n(r['id']),
        liberadoEm: r['liberado_em'] instanceof Date ? r['liberado_em'] : new Date(texto(r['liberado_em'])),
        paciente: n(r['paciente_id']),
        atendimento: n(r['atendimento_id']),
        usuario: texto(r['usuario']),
      })),
    );
  }

  avisos(c: ContextoSadt, o: { inicio: string; fim: string; pendentes?: boolean }) {
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      const ls = await l.consultar(
        `SELECT a.id, a.gerado_em, a.prazo_em, a.situacao, a.nivel_escalonamento, a.comunicado_descricao, a.comunicado_em,
                a.leitura_confirmada_em, re.exame_item_id, re.liberado_em, r.numero, ei.sequencia, r.atendimento_id,
                at.numero AS atendimento_numero, p.id AS paciente_id, p.numero_prontuario, pf.nome, pf.data_nascimento,
                sx.sigla AS sexo, an.nome AS analito, ra.valor_numerico, ra.valor_texto, ur.simbolo,
                (SELECT cn.descricao FROM aviso_valor_critico_tentativa t JOIN canal_notificacao cn ON cn.id = t.canal_notificacao_id
                  WHERE t.aviso_valor_critico_id = a.id ORDER BY t.sequencia DESC LIMIT 1) AS canal,
                COALESCE(uc.login, '') AS comunicado_por, COALESCE(pcf.nome, a.comunicado_descricao, '') AS destinatario
           FROM aviso_valor_critico a
           JOIN resultado_exame re ON re.id = a.resultado_exame_id
           JOIN exame_item ei ON ei.id = re.exame_item_id
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
           JOIN atendimento at ON at.id = r.atendimento_id
           JOIN paciente p ON p.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN sexo sx ON sx.id = pf.sexo_id
           LEFT JOIN resultado_analito ra ON ra.id = a.resultado_analito_id
           LEFT JOIN analito an ON an.id = ra.analito_id
           LEFT JOIN unidade_resultado ur ON ur.id = ra.unidade_resultado_id
           LEFT JOIN usuario uc ON uc.id = a.comunicado_por_usuario_id
           LEFT JOIN profissional pc ON pc.id = a.comunicado_profissional_id
           LEFT JOIN pessoa_fisica pcf ON pcf.id = pc.pessoa_fisica_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
            AND a.gerado_em >= ? AND a.gerado_em < DATE_ADD(?, INTERVAL 1 DAY)
            ${o.pendentes ? "AND a.situacao IN ('pendente', 'em_contato', 'escalonado')" : ''}
          ORDER BY a.gerado_em DESC, a.id DESC`,
        [est, o.inicio, o.fim],
        { teto: 500 },
      );
      return ls.map((r): AvisoCritico => {
        const nivel = Math.min(2, n(r['nivel_escalonamento'])) as 0 | 1 | 2;
        const nasc = dataIso(r['data_nascimento']);
        const sexo = texto(r['sexo']).toUpperCase();
        const gerado = instante(r['gerado_em']);
        const liberado = instante(r['liberado_em']) || gerado;
        const sit = texto(r['situacao']);
        return {
          id: n(r['id']),
          exame: n(r['exame_item_id']),
          chave: `${texto(r['numero'])}:${n(r['sequencia'])}`,
          paciente: {
            id: n(r['paciente_id']),
            prontuario: Number(texto(r['numero_prontuario']).replace(/\D/g, '')) || 0,
            nome: texto(r['nome']),
            sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
            idadeAnos: idadeAnos(nasc, hoje),
            nascimento: nasc,
          },
          atendimento: texto(r['atendimento_numero']),
          elemento: texto(r['analito']),
          valor:
            r['valor_numerico'] !== null && r['valor_numerico'] !== undefined
              ? `${texto(r['valor_numerico'])}${r['simbolo'] ? ` ${texto(r['simbolo'])}` : ''}`
              : texto(r['valor_texto']),
          origem: 'novo',
          liberadoEm: liberado,
          emitidoEm: gerado,
          segundosAteAviso: Math.max(0, Math.round((Date.parse(gerado) - Date.parse(liberado)) / 1000)),
          prazoEm: instante(r['prazo_em']),
          nivel,
          nivelRotulo: NIVEIS_ESCALONAMENTO[nivel]?.rotulo ?? String(nivel),
          comunicado:
            r['comunicado_em'] === null
              ? null
              : {
                  canal: texto(r['canal']),
                  destinatario: texto(r['destinatario']),
                  por: texto(r['comunicado_por']),
                  em: instante(r['comunicado_em']),
                },
          ciencia:
            r['leitura_confirmada_em'] === null
              ? null
              : { usuario: texto(r['comunicado_por']), em: instante(r['leitura_confirmada_em']) },
          situacao:
            sit === 'comunicado' || sit === 'leitura_confirmada'
              ? 'comCiencia'
              : nivel > 0 || sit === 'escalonado'
                ? 'escalonado'
                : 'aguardandoCiencia',
        };
      });
    });
  }

  valoresCriticos(c: ContextoSadt) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT v.id, v.limite_inferior, v.limite_superior, v.prazo_comunicacao_minutos, v.ativo, v.vigencia_inicio,
                  COALESCE(v.alterado_em, v.criado_em) AS atualizado, e.codigo, e.nome AS exame_nome, an.id AS analito,
                  an.nome AS analito_nome, sd.tipo, mi.sigla_padrao
             FROM regra_valor_critico v
             JOIN exame e ON e.id = v.exame_id
             LEFT JOIN analito an ON an.id = v.analito_id
             LEFT JOIN modalidade_imagem mi ON mi.id = e.modalidade_imagem_id
             LEFT JOIN setor_diagnostico sd ON sd.tipo = CASE e.tipo_servico WHEN 'imagem' THEN 'imagem' ELSE 'laboratorio' END
                   AND sd.estabelecimento_id = ? AND sd.excluido_em IS NULL AND sd.id = (
                     SELECT MIN(s2.id) FROM setor_diagnostico s2 WHERE s2.estabelecimento_id = ? AND s2.tipo = sd.tipo)
            WHERE (v.estabelecimento_id = ? OR v.estabelecimento_id IS NULL) AND v.vigencia_fim IS NULL
              -- A regra da unidade sobrepõe a da rede (regra da rede: vale para todas as unidades sem regra própria).
              AND NOT (v.estabelecimento_id IS NULL AND EXISTS (
                    SELECT 1 FROM regra_valor_critico u WHERE u.estabelecimento_id = ? AND u.exame_id <=> v.exame_id
                       AND u.analito_id <=> v.analito_id AND u.vigencia_fim IS NULL))
            ORDER BY e.codigo, an.nome, v.id`,
          [est, est, est, est],
        )
      ).map(
        (r): ValorCriticoLido => ({
          id: n(r['id']),
          ato: atoDoExame(texto(r['tipo']) || 'laboratorio', r['sigla_padrao'] === null ? null : texto(r['sigla_padrao'])),
          exame: texto(r['codigo']),
          exameNome: texto(r['exame_nome']),
          elemento: n(r['analito']),
          elementoNome: texto(r['analito_nome']),
          abaixoDe: nn(r['limite_inferior']),
          acimaDe: nn(r['limite_superior']),
          prazoMinutos: n(r['prazo_comunicacao_minutos']),
          aprovacao: `Vigente desde ${dataIso(r['vigencia_inicio']) ?? ''}`,
          ativo: verdadeiro(r['ativo']),
          atualizadoEm: instante(r['atualizado']),
        }),
      ),
    );
  }

  elementos(c: ContextoSadt, exame: string) {
    // Catálogo de exames e analitos da rede inteira (sem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT an.id, an.nome, ur.simbolo
             FROM exame e
             JOIN exame_analito ea ON ea.exame_id = e.id AND ea.ativo = TRUE AND ea.excluido_em IS NULL
             JOIN analito an ON an.id = ea.analito_id AND an.excluido_em IS NULL
             LEFT JOIN unidade_resultado ur ON ur.id = COALESCE(ea.unidade_resultado_id, an.unidade_resultado_id)
            WHERE e.codigo = ? AND e.excluido_em IS NULL
            ORDER BY ea.ordem, an.id`,
          [exame],
        )
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']), unidade: r['simbolo'] === null ? null : texto(r['simbolo']) })),
    );
  }

  private async amostrasDe(l: Leitor, est: number, filtro: string, p: unknown[]): Promise<AmostraDetalhe[]> {
    const { hoje } = await this.hoje(l, est);
    const ls = await l.consultar(`${SQL_AMOSTRA} ${filtro} ORDER BY am.id DESC`, [est, ...p], { teto: 501 });
    if (ls.length === 0) return [];
    const ids = ls.map((r) => n(r['id']));
    const exames = await l.consultar(
      `SELECT abe.amostra_biologica_id, ei.id, e.codigo, e.nome FROM amostra_biologica_exame abe
         JOIN exame_item ei ON ei.id = abe.exame_item_id JOIN exame e ON e.id = ei.exame_id
        WHERE abe.excluido_em IS NULL AND abe.amostra_biologica_id IN (${lista(ids.length)}) ORDER BY ei.id`,
      ids,
    );
    const eventos = await l.consultar(
      `SELECT ev.amostra_biologica_id, ev.evento, ev.ocorrido_em, ev.descricao, ev.dados, COALESCE(u.login, '') AS por
         FROM amostra_biologica_evento ev LEFT JOIN usuario u ON u.id = ev.usuario_id
        WHERE ev.amostra_biologica_id IN (${lista(ids.length)}) ORDER BY ev.ocorrido_em, ev.id`,
      ids,
    );
    return ls.map((r) => {
      const id = n(r['id']);
      const estado = estadoDaAmostra(texto(r['situacao']));
      const evs = eventos.filter((e) => n(e['amostra_biologica_id']) === id);
      const nasc = dataIso(r['data_nascimento']);
      const sexo = texto(r['sexo']).toUpperCase();
      return {
        id,
        codigo: texto(r['codigo_barras']),
        estado,
        rotulo: rotuloEstadoAmostra(estado),
        paciente: {
          id: n(r['paciente_id']),
          prontuario: Number(texto(r['numero_prontuario']).replace(/\D/g, '')) || 0,
          nome: texto(r['paciente_nome']),
          sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
          idadeAnos: idadeAnos(nasc, hoje),
          nascimento: nasc,
        },
        recipiente: r['recipiente'] === null ? null : texto(r['recipiente']),
        exames: exames
          .filter((e) => n(e['amostra_biologica_id']) === id)
          .map((e) => ({ id: n(e['id']), codigo: texto(e['codigo']), nome: texto(e['nome']) })),
        pulseiraConferida: evs.some((e) => {
          const d = typeof e['dados'] === 'string' ? (JSON.parse(e['dados']) as Linha) : (e['dados'] as Linha | null);
          return verdadeiro(d?.['pulseiraConferida']);
        }),
        eventos: evs
          .filter((e) => texto(e['evento']) !== 'ocorrencia' && texto(e['evento']) !== 'etiqueta_impressa')
          .map((e) => {
            const est2 = estadoDoEvento(texto(e['evento']));
            return {
              estado: est2,
              rotulo: rotuloEstadoAmostra(est2),
              em: instante(e['ocorrido_em']),
              por: texto(e['por']),
              motivo: e['descricao'] === null ? null : texto(e['descricao']),
            };
          }),
      };
    });
  }

  amostras(c: ContextoSadt, o: { data: string; estado?: EstadoAmostra }) {
    return this.ler(c, async (l, est) => {
      const p: unknown[] = [o.data, o.data];
      let f = 'AND COALESCE(am.coletada_em, am.criado_em) >= ? AND COALESCE(am.coletada_em, am.criado_em) < DATE_ADD(?, INTERVAL 1 DAY)';
      if (o.estado) {
        f += ' AND am.situacao = ?';
        p.push(SITUACAO_DA_AMOSTRA[o.estado].situacao);
      }
      const itens = await this.amostrasDe(l, est, f, p);
      const rejeicoes = await l.consultar(
        `SELECT COALESCE(ev.descricao, 'Sem motivo') AS motivo, COUNT(*) AS quantidade
           FROM amostra_biologica_evento ev JOIN amostra_biologica am ON am.id = ev.amostra_biologica_id
          WHERE am.estabelecimento_id = ? AND ev.evento = 'rejeitada'
            AND ev.ocorrido_em >= ? AND ev.ocorrido_em < DATE_ADD(?, INTERVAL 1 DAY)
          GROUP BY COALESCE(ev.descricao, 'Sem motivo') ORDER BY quantidade DESC`,
        [est, o.data, o.data],
      );
      return {
        itens: itens.slice(0, 500),
        cortada: itens.length > 500,
        rejeicoes: rejeicoes.map((r) => ({ motivo: texto(r['motivo']), quantidade: n(r['quantidade']) })),
      };
    });
  }

  amostraPorCodigo(c: ContextoSadt, codigo: string) {
    return this.ler(c, async (l, est) => (await this.amostrasDe(l, est, 'AND am.codigo_barras = ?', [codigo]))[0] ?? null);
  }

  amostraPorId(c: ContextoSadt, id: number) {
    return this.ler(c, async (l, est) => (await this.amostrasDe(l, est, 'AND am.id = ?', [id]))[0] ?? null);
  }

  atendimentoDosExames(c: ContextoSadt, ids: readonly number[]) {
    if (ids.length === 0) return Promise.resolve(null);
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT DISTINCT r.paciente_id, r.atendimento_id, p.numero_prontuario,
                EXISTS (SELECT 1 FROM internacao i WHERE i.atendimento_id = r.atendimento_id) AS internado
           FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
           JOIN paciente p ON p.id = r.paciente_id
          WHERE r.estabelecimento_id = ? AND ei.excluido_em IS NULL AND ei.id IN (${lista(ids.length)})`,
        [est, ...ids],
      );
      const r = ls[0];
      if (!r) return null;
      return {
        paciente: n(r['paciente_id']),
        atendimento: n(r['atendimento_id']),
        reg: n(r['atendimento_id']),
        atend: verdadeiro(r['internado']) ? ('I' as const) : ('E' as const),
        prontuario: Number(texto(r['numero_prontuario']).replace(/\D/g, '')) || 0,
        mesmos: ls.length === 1,
      };
    });
  }

  laudosDoExame(c: ContextoSadt, id: number) {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT el.numero, el.codigo_autenticacao, el.emitida_em, el.tipo_emissao, COALESCE(u.login, '') AS por
           FROM emissao_laudo_exame ex JOIN emissao_laudo el ON el.id = ex.emissao_laudo_id
           LEFT JOIN usuario u ON u.id = el.emitido_por_usuario_id
          WHERE ex.exame_item_id = ? AND el.estabelecimento_id = ? AND el.excluido_em IS NULL AND ex.excluido_em IS NULL
          ORDER BY el.emitida_em, el.id`,
        [id, est],
      );
      const vias = ls.filter((r) => texto(r['tipo_emissao']) === 'reimpressao').length;
      return ls
        .filter((r) => texto(r['tipo_emissao']) !== 'reimpressao')
        .map((r) => ({
          codigo: texto(r['codigo_autenticacao']),
          emitidoEm: instante(r['emitida_em']),
          emitidoPor: texto(r['por']),
          segundasVias: vias,
        }));
    });
  }

  impressaoDosExames(c: ContextoSadt, ids: readonly number[]) {
    if (ids.length === 0) return Promise.resolve(null);
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT el.id, el.codigo_autenticacao, COUNT(DISTINCT ex.exame_item_id) AS exames
           FROM emissao_laudo el JOIN emissao_laudo_exame ex ON ex.emissao_laudo_id = el.id AND ex.excluido_em IS NULL
          WHERE el.estabelecimento_id = ? AND el.excluido_em IS NULL AND el.tipo_emissao <> 'reimpressao'
            AND ex.exame_item_id IN (${lista(ids.length)})
          GROUP BY el.id, el.codigo_autenticacao HAVING COUNT(DISTINCT ex.exame_item_id) = ?
          ORDER BY el.id DESC LIMIT 1`,
        [est, ...ids, new Set(ids).size],
      );
      return r ? { impressao: n(r['id']), codigo: texto(r['codigo_autenticacao']) } : null;
    });
  }

  validarLaudo(c: ContextoSadt, codigo: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT el.emitida_em, (SELECT COUNT(*) FROM emissao_laudo_exame ex WHERE ex.emissao_laudo_id = el.id
                                   AND ex.excluido_em IS NULL) AS exames
           FROM emissao_laudo el WHERE el.estabelecimento_id = ? AND el.codigo_autenticacao = ? AND el.excluido_em IS NULL
          ORDER BY el.id LIMIT 1`,
        [est, codigo],
      );
      return r
        ? { valido: true, emitidoEm: instante(r['emitida_em']), exames: n(r['exames']) }
        : { valido: false, emitidoEm: null, exames: 0 };
    });
  }

  laudoParaEmitir(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['laudoParaEmitir']!));
  }
  requisicoes(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['requisicoes']!));
  }
  atendimento(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['atendimento']!));
  }
  atendimentosPorNumero(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['atendimentosPorNumero']!));
  }
  orcamentos(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['orcamentos']!));
  }
  orcamento(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['orcamento']!));
  }
  apoio(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['apoio']!));
  }

  vinculos(c: ContextoSadt, login: string): Promise<VinculoDaSessao[]> {
    // Profissional e inscrição no conselho são do cliente inteiro (sem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT ic.id, ic.numero_inscricao, COALESCE(pr.nome_exibicao, pf.nome) AS nome, COALESCE(oc.codigo_cbo, '') AS cbo,
                  (ic.situacao = 'ativa' AND pr.situacao = 'ativo') AS ativo
             FROM usuario u
             JOIN profissional pr ON pr.pessoa_fisica_id = u.pessoa_fisica_id AND pr.excluido_em IS NULL
             JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
             JOIN inscricao_conselho ic ON ic.profissional_id = pr.id AND ic.excluido_em IS NULL
             LEFT JOIN ocupacao_cbo oc ON oc.id = ic.ocupacao_cbo_id
            WHERE u.login = ? AND u.excluido_em IS NULL
            ORDER BY ic.principal DESC, ic.id`,
          [login],
        )
      ).map((r) => ({
        vinculo: n(r['id']),
        conselho: Number(texto(r['numero_inscricao']).replace(/\D/g, '')) || 0,
        nome: texto(r['nome']),
        codigoCbo: texto(r['cbo']),
        ativo: verdadeiro(r['ativo']),
      })),
    );
  }

  /**
   * O solicitante da requisição do exame (regra_valor_critico.comunica_solicitante): o usuário ativo ligado ao
   * profissional pelo vínculo vigente na unidade ou, sem vínculo, pela mesma pessoa. Nunca o profissional do
   * atendimento, que na requisição de laboratório é o executante. Sem solicitante com usuário, null: o aviso segue no
   * painel do setor (o plantonista do setor entra com a leitura da escala, pedido do lote 02-09).
   */
  destinatarioDoCritico(c: ContextoSadt, exameItem: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT u.login FROM exame_item ei
           JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id
           JOIN profissional pr ON pr.id = q.solicitante_profissional_id AND pr.excluido_em IS NULL
           JOIN usuario u ON u.situacao = 'ativo' AND u.excluido_em IS NULL
          WHERE ei.id = ? AND q.estabelecimento_id = ? AND q.excluido_em IS NULL AND ei.excluido_em IS NULL
            AND (EXISTS (SELECT 1 FROM usuario_vinculo_profissional v
                          WHERE v.usuario_id = u.id AND v.profissional_id = pr.id AND v.estabelecimento_id = q.estabelecimento_id
                            AND v.excluido_em IS NULL AND v.vigencia_inicio <= CURRENT_DATE
                            AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE))
                 OR u.pessoa_fisica_id = pr.pessoa_fisica_id)
          ORDER BY u.id LIMIT 1`,
        [exameItem, est],
      );
      return r ? texto(r['login']) : null;
    });
  }

  profissionais(c: ContextoSadt, termo: string) {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT ic.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome, cc.sigla, uf.sigla AS uf, ic.numero_inscricao,
                  COALESCE(oc.codigo_cbo, '') AS cbo
             FROM profissional pr
             JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
             JOIN inscricao_conselho ic ON ic.profissional_id = pr.id AND ic.excluido_em IS NULL
             JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
             LEFT JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
             LEFT JOIN ocupacao_cbo oc ON oc.id = ic.ocupacao_cbo_id
            WHERE pr.excluido_em IS NULL AND (pf.nome LIKE ? OR pr.nome_exibicao LIKE ? OR ic.numero_inscricao = ?)
            ORDER BY nome, ic.id LIMIT 50`,
          [`%${termo}%`, `%${termo}%`, termo],
          { teto: 50 },
        )
      ).map((r) => ({
        id: n(r['id']),
        nome: texto(r['nome']),
        conselho: `${texto(r['sigla'])} ${texto(r['numero_inscricao'])}${r['uf'] ? `/${texto(r['uf'])}` : ''}`,
        cbo: texto(r['cbo']),
      })),
    );
  }

  solicitantes(c: ContextoSadt, o: { termo?: string; numero?: number; uf?: string }) {
    return this.ler(c, async (l) => {
      const p: unknown[] = [];
      let f = '';
      if (o.termo) {
        f += ' AND s.nome LIKE ?';
        p.push(`%${o.termo}%`);
      }
      if (o.numero) {
        f += ' AND s.numero_conselho = ?';
        p.push(String(o.numero));
      }
      if (o.uf) {
        f += ' AND uf.sigla = ?';
        p.push(o.uf);
      }
      return (
        await l.consultar(
          `SELECT s.id, s.nome, cc.sigla, s.numero_conselho, uf.sigla AS uf, s.ativo
             FROM solicitante_externo s
             JOIN conselho_classe cc ON cc.id = s.conselho_classe_id
             JOIN unidade_federativa uf ON uf.id = s.conselho_unidade_federativa_id
            WHERE s.excluido_em IS NULL ${f} ORDER BY s.nome, s.id LIMIT 50`,
          p,
          { teto: 50 },
        )
      ).map((r) => ({
        id: n(r['id']),
        nome: texto(r['nome']),
        registro: `${texto(r['sigla'])} ${texto(r['numero_conselho'])}/${texto(r['uf'])}`,
        ativo: verdadeiro(r['ativo']),
      }));
    });
  }

  parametros(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['parametros']!));
  }
  indicadores(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['indicadores']!));
  }
  laudosPortalDoPaciente(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['laudosPortalDoPaciente']!));
  }
  laudosPortalDoMedico(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['laudosPortalDoMedico']!));
  }
  laudoPortal(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['laudoPortal']!));
  }

  pacienteDoAtendimento(c: ContextoSadt, reg: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT p.id, pf.nome, pf.data_nascimento FROM atendimento a JOIN paciente p ON p.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE a.id = ? AND a.estabelecimento_id = ?`,
        [reg, est],
      );
      return r ? { paciente: n(r['id']), nome: texto(r['nome']), nascimento: dataIso(r['data_nascimento']) } : null;
    });
  }

  nascimentoDoPaciente(c: ContextoSadt, paciente: number) {
    // O paciente é do cliente inteiro (cadastro único).
    return this.ler(c, async (l) => {
      const r = await l.uma(
        `SELECT pf.nome, pf.data_nascimento FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.id = ? AND p.excluido_em IS NULL`,
        [paciente],
      );
      return r ? { nome: texto(r['nome']), nascimento: dataIso(r['data_nascimento']) } : null;
    });
  }

  acessoPorProtocolo(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['acessoPorProtocolo']!));
  }
  acessoDoMedico(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['acessoDoMedico']!));
  }
  acessoPorId(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['acessoPorId']!));
  }
  autocadastros(): Promise<never> {
    return Promise.reject(pendente(LEITURAS_PENDENTES['autocadastros']!));
  }

  atosPublicados(c: ContextoSadt) {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT DISTINCT sd.tipo, mi.sigla_padrao
           FROM setor_publicado_portal sp
           JOIN setor_diagnostico sd ON sd.id = sp.setor_diagnostico_id
           LEFT JOIN exame e ON e.id = sp.exame_id
           LEFT JOIN modalidade_imagem mi ON mi.id = e.modalidade_imagem_id
          WHERE sp.estabelecimento_id = ? AND sp.ativo = TRUE AND sp.publica_laudo = TRUE`,
        [est],
      );
      const atos = new Set<number>();
      for (const r of ls) {
        const tipo = texto(r['tipo']);
        if (tipo === 'imagem' && r['sigla_padrao'] === null) for (const a of [16, 24, 25, 26, 27, 42]) atos.add(a);
        else atos.add(atoDoExame(tipo, r['sigla_padrao'] === null ? null : texto(r['sigla_padrao'])));
      }
      return [...atos].sort((a, b) => a - b);
    });
  }
}

/** amostra_biologica_evento.evento → estado da amostra das telas. */
function estadoDoEvento(evento: string): EstadoAmostra {
  switch (evento) {
    case 'coletada':
      return 'coletada';
    case 'enviada':
      return 'emTransporte';
    case 'recebida':
    case 'triada':
    case 'aliquotada':
      return 'recebida';
    case 'em_analise':
    case 'analisada':
    case 'armazenada':
      return 'emAnalise';
    case 'cancelada':
      return 'recoleta';
    default:
      return 'rejeitada';
  }
}

/** O gravador sobre a transação da operação (o estabelecimento do contexto). */
function gravadorSobre(tx: TxOperacao, est: number): GravadorSghSadt {
  const usuario = tx.contexto.usuario;
  const agora = () => new Date();
  const nao = (o: string) => () => Promise.reject(pendente(GRAVACOES_PENDENTES[o]!));
  return {
    async registrarColeta(a) {
      if (a.exames.length === 0) throw recusa('sem-exames', 'Escolha ao menos um exame para coletar.');
      const ids = a.exames.map((x) => x.id);
      const itens = await tx.consultarParaAtualizar(
        `SELECT ei.id, ei.versao, ei.situacao, ei.requisicao_exame_id, ei.material_biologico_id, ei.recipiente_coleta_id,
                COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id) AS setor, e.id AS exame_id
           FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id JOIN exame e ON e.id = ei.exame_id
          WHERE r.estabelecimento_id = ? AND r.paciente_id = ? AND ei.excluido_em IS NULL AND ei.id IN (${lista(ids.length)})`,
        [est, a.paciente, ...ids],
      );
      if (itens.length !== new Set(ids).size)
        throw recusa('exame-inexistente', 'Algum exame não é deste paciente neste estabelecimento.');
      const [ja] = await tx.consultar(
        `SELECT abe.exame_item_id FROM amostra_biologica_exame abe JOIN amostra_biologica am ON am.id = abe.amostra_biologica_id
          WHERE abe.excluido_em IS NULL AND am.excluido_em IS NULL AND am.situacao NOT IN ('rejeitada', 'cancelada', 'descartada')
            AND abe.exame_item_id IN (${lista(ids.length)}) LIMIT 1`,
        ids,
      );
      if (ja) throw recusa('amostra-coletada', 'O exame já tem amostra coletada: rejeite a anterior para coletar de novo.');
      const primeiro = itens[0]!;
      let material = nn(primeiro['material_biologico_id']);
      if (material === null) {
        const m = await tx.uma(
          `SELECT em.material_biologico_id FROM exame_material em WHERE em.exame_id = ? ORDER BY em.id LIMIT 1`,
          [n(primeiro['exame_id'])],
        );
        material = nn(m?.['material_biologico_id']);
      }
      if (material === null) throw recusa('sem-material', 'O exame não tem material de coleta no cadastro.');
      const coletada = agora();
      const provisorio = `C${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
      const id = await tx.incluir('amostra_biologica', {
        estabelecimento_id: est,
        codigo_barras: provisorio,
        requisicao_exame_id: n(primeiro['requisicao_exame_id']),
        material_biologico_id: material,
        recipiente_coleta_id: a.recipiente ?? nn(primeiro['recipiente_coleta_id']),
        setor_diagnostico_id: nn(primeiro['setor']),
        situacao: 'coletada',
        coletada_em: coletada,
        coletada_no_setor: false,
        coleta_domiciliar: false,
        coleta_externa: false,
        repeticao: false,
        origem: 'sistema',
      });
      const codigo = a.codigo(id);
      await tx.alterar('amostra_biologica', id, 1, { codigo_barras: codigo });
      for (const i of itens) {
        await tx.incluir('amostra_biologica_exame', { amostra_biologica_id: id, exame_item_id: n(i['id']) });
        if (['solicitado', 'autorizado', 'agendado'].includes(texto(i['situacao'])))
          await tx.alterar('exame_item', n(i['id']), n(i['versao']), { situacao: 'coletado', coletado_em: coletada });
      }
      await tx.incluir('amostra_biologica_evento', {
        amostra_biologica_id: id,
        operacao: 'inclusao',
        evento: 'coletada',
        ocorrido_em: coletada,
        usuario_id: usuario,
        dados: JSON.stringify({ pulseiraConferida: a.pulseiraConferida, estacao: a.estacao }),
      });
      return { id, codigo };
    },

    async mudarEstadoAmostra(r) {
      const [am] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao FROM amostra_biologica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [r.amostra, est],
        { teto: 1 },
      );
      if (!am) throw recusa('amostra-inexistente', 'A amostra não existe neste estabelecimento.');
      if (estadoDaAmostra(texto(am['situacao'])) !== r.de) throw erroConflitoVersao(['situacao']);
      const para = SITUACAO_DA_AMOSTRA[r.para];
      if ((r.para === 'rejeitada' || r.para === 'recoleta') && !r.motivo)
        throw recusa('motivo-obrigatorio', 'Informe o motivo da rejeição da amostra.');
      const quando = agora();
      await tx.alterar('amostra_biologica', r.amostra, n(am['versao']), {
        situacao: para.situacao,
        ...(r.para === 'recebida' ? { recebida_em: quando, recebida_por_usuario_id: usuario } : {}),
      });
      await tx.incluir('amostra_biologica_evento', {
        amostra_biologica_id: r.amostra,
        operacao: 'alteracao',
        evento: para.evento,
        ocorrido_em: quando,
        usuario_id: usuario,
        descricao: r.motivo ?? r.detalhe,
        dados: JSON.stringify({ de: r.de, para: r.para, estacao: r.estacao }),
      });
      // O exame acompanha a amostra na análise (o item pedido passa a "em análise" ao entrar na bancada).
      if (r.para === 'recebida' || r.para === 'emAnalise') {
        const itens = await tx.consultarParaAtualizar(
          `SELECT ei.id, ei.versao FROM amostra_biologica_exame abe JOIN exame_item ei ON ei.id = abe.exame_item_id
            WHERE abe.amostra_biologica_id = ? AND abe.excluido_em IS NULL AND ei.situacao IN ('solicitado', 'autorizado', 'agendado', 'coletado')`,
          [r.amostra],
        );
        for (const i of itens) await tx.alterar('exame_item', n(i['id']), n(i['versao']), { situacao: 'em_analise' });
      }
      // A amostra rejeitada (ou cancelada para recoleta) devolve o exame ainda sem resultado à coleta.
      if (r.para === 'rejeitada' || r.para === 'recoleta') {
        const itens = await tx.consultarParaAtualizar(
          `SELECT ei.id, ei.versao FROM amostra_biologica_exame abe JOIN exame_item ei ON ei.id = abe.exame_item_id
            WHERE abe.amostra_biologica_id = ? AND abe.excluido_em IS NULL AND ei.situacao IN ('coletado', 'em_analise')`,
          [r.amostra],
        );
        for (const i of itens) await tx.alterar('exame_item', n(i['id']), n(i['versao']), { situacao: 'solicitado' });
      }
    },

    async gravarValorCritico(f) {
      const e = await tx.uma('SELECT id FROM exame WHERE codigo = ? AND excluido_em IS NULL', [f.exame]);
      if (!e) throw recusa('exame-inexistente', 'O exame não existe no catálogo.');
      if (f.abaixoDe === null && f.acimaDe === null)
        throw recusa('faixa-vazia', 'Informe o limite inferior, o superior ou os dois.');
      const hoje = agora();
      const anteriores = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM regra_valor_critico
          WHERE estabelecimento_id = ? AND exame_id = ? AND analito_id <=> ? AND vigencia_fim IS NULL`,
        [est, n(e['id']), f.elemento || null],
      );
      // A regra vigente da unidade é encerrada (não apagada): o histórico da faixa fica. A regra da rede
      // (estabelecimento nulo) não é tocada: a nova regra da unidade a sobrepõe só nesta unidade.
      for (const a of anteriores)
        await tx.alterar('regra_valor_critico', n(a['id']), n(a['versao']), { vigencia_fim: hoje, ativo: false });
      return tx.incluir('regra_valor_critico', {
        estabelecimento_id: est,
        exame_id: n(e['id']),
        analito_id: f.elemento || null,
        limite_inferior: f.abaixoDe,
        limite_superior: f.acimaDe,
        prazo_comunicacao_minutos: f.prazoMinutos,
        comunica_solicitante: true,
        comunica_plantonista: false,
        comunica_enfermagem: false,
        exige_confirmacao_leitura: true,
        tentativas_maximas: 3,
        intervalo_tentativa_minutos: 10,
        vigencia_inicio: hoje,
        ativo: f.ativo,
      });
    },

    async avisarCriticos(a) {
      // A porta lê o resultado, os analitos críticos, os avisos que já existem e as regras vigentes candidatas; quem
      // escolhe os alvos, a regra (unidade antes da rede, analito antes do exame) e o prazo é o domínio
      // (@sgh/dominio-sadt, critico/regra-aviso). Avisar de novo o mesmo resultado não repete o aviso.
      const [re] = await tx.consultarParaAtualizar<Linha>(
        `SELECT re.id, re.critico, ei.exame_id, r.paciente_id
           FROM resultado_exame re
           JOIN exame_item ei ON ei.id = re.exame_item_id
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE re.id = ? AND re.exame_item_id = ? AND r.estabelecimento_id = ? AND re.situacao = 'liberado'
            AND re.excluido_em IS NULL`,
        [a.idLiberacao, a.exameItem, est],
      );
      if (!re) throw recusa('liberacao-inexistente', 'A liberação do exame não está neste estabelecimento.');
      const resultado = n(re['id']);
      const exame = n(re['exame_id']);
      const criticos = (
        await tx.consultar<Linha>(
          `SELECT id, analito_id FROM resultado_analito
            WHERE resultado_exame_id = ? AND critico = TRUE AND excluido_em IS NULL ORDER BY sequencia, id`,
          [resultado],
        )
      ).map((x) => ({ analito: nn(x['analito_id']), resultadoAnalito: n(x['id']) }));
      const ja = new Set(
        (
          await tx.consultar<Linha>(
            'SELECT resultado_analito_id AS ra FROM aviso_valor_critico WHERE resultado_exame_id = ? AND excluido_em IS NULL',
            [resultado],
          )
        ).map((x) => nn(x['ra'])),
      );
      const alvos = alvosDoAviso(criticos, verdadeiro(re['critico']), ja);
      if (!alvos.length) return 0;
      const gerado = agora();
      const analitos = [...new Set(alvos.map((x) => x.analito).filter((x): x is number => x !== null))];
      const candidatas: RegraCriticoCandidata[] = (
        await tx.consultar<Linha>(
          `SELECT id, estabelecimento_id, analito_id, exame_id, prazo_comunicacao_minutos FROM regra_valor_critico
            WHERE (estabelecimento_id = ? OR estabelecimento_id IS NULL) AND ativo = TRUE
              AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
              AND (exame_id = ?${analitos.length ? ` OR analito_id IN (${analitos.map(() => '?').join(', ')})` : ''})`,
          [est, gerado, gerado, exame, ...analitos],
        )
      ).map((x) => ({
        id: n(x['id']),
        estabelecimento: nn(x['estabelecimento_id']),
        analito: nn(x['analito_id']),
        exame: nn(x['exame_id']),
        prazoMinutos: nn(x['prazo_comunicacao_minutos']),
      }));
      for (const x of alvos) {
        const aviso = avisoDoAlvo(candidatas, { estabelecimento: est, exame, analito: x.analito }, gerado);
        await tx.incluir('aviso_valor_critico', {
          estabelecimento_id: est,
          resultado_exame_id: resultado,
          resultado_analito_id: x.resultadoAnalito,
          paciente_id: n(re['paciente_id']),
          regra_valor_critico_id: aviso.regra,
          gerado_em: gerado,
          prazo_em: aviso.prazoEm,
          situacao: 'pendente',
          nivel_escalonamento: 0,
        });
      }
      return alvos.length;
    },

    async comunicarAviso(r) {
      const [a] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao, nivel_escalonamento FROM aviso_valor_critico WHERE id = ? AND estabelecimento_id = ?',
        [r.aviso, est],
        { teto: 1 },
      );
      if (!a) throw recusa('aviso-inexistente', 'O aviso não existe neste estabelecimento.');
      if (['comunicado', 'leitura_confirmada', 'cancelado'].includes(texto(a['situacao'])))
        throw recusa('aviso-comunicado', 'O aviso já foi comunicado.');
      const canal = await tx.uma('SELECT id FROM canal_notificacao WHERE codigo = ? AND ativo = TRUE', [r.canal]);
      if (!canal) throw recusa('canal-inexistente', 'O canal de comunicação não está cadastrado.');
      const [seq] = await tx.consultar(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM aviso_valor_critico_tentativa WHERE aviso_valor_critico_id = ?',
        [r.aviso],
      );
      const quando = agora();
      await tx.incluir('aviso_valor_critico_tentativa', {
        aviso_valor_critico_id: r.aviso,
        operacao: 'inclusao',
        ocorrido_em: quando,
        usuario_id: usuario,
        sequencia: n(seq?.['s']),
        canal_notificacao_id: n(canal['id']),
        destinatario_descricao: r.destinatario.slice(0, 150),
        nivel_escalonamento: n(a['nivel_escalonamento']),
        resultado: 'comunicado',
        observacao: r.observacao?.slice(0, 500) ?? null,
      });
      await tx.alterar('aviso_valor_critico', r.aviso, n(a['versao']), {
        situacao: 'comunicado',
        comunicado_descricao: r.destinatario.slice(0, 150),
        comunicado_em: quando,
        comunicado_por_usuario_id: usuario,
        observacao: r.observacao,
      });
    },

    async escalonarAviso(r) {
      const [a] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao, nivel_escalonamento FROM aviso_valor_critico WHERE id = ? AND estabelecimento_id = ?',
        [r.aviso, est],
        { teto: 1 },
      );
      if (!a || !['pendente', 'em_contato', 'escalonado'].includes(texto(a['situacao']))) return false;
      if (n(a['nivel_escalonamento']) >= r.nivel) return false;
      await tx.alterar('aviso_valor_critico', r.aviso, n(a['versao']), { nivel_escalonamento: r.nivel, situacao: 'escalonado' });
      return true;
    },

    async registrarLeitura(r) {
      // A leitura no portal (paciente ou médico externo, sem usuário interno) é registrada pela operação de
      // visualização no portal (acesso_resultado_portal), ainda pendente no banco: recusa explícita, nunca silêncio.
      if (r.origem === 'portal') throw pendente('o registro da leitura do resultado feita no portal');
      if (usuario === null) throw recusa('sem-usuario', 'A leitura do resultado exige o usuário da sessão.');
      const re = await tx.uma(
        `SELECT re.id, re.paciente_id FROM resultado_exame re JOIN exame_item ei ON ei.id = re.exame_item_id
           JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id
          WHERE re.exame_item_id = ? AND q.estabelecimento_id = ? AND re.situacao = 'liberado' AND re.excluido_em IS NULL`,
        [r.exameItem, est],
      );
      if (!re) throw recusa('resultado-inexistente', 'O resultado liberado não existe neste estabelecimento.');
      // Só a primeira abertura por usuário (uq_visualizacao_resultado_exame_usuario): a repetida não grava.
      const ja = await tx.uma('SELECT id FROM visualizacao_resultado_exame WHERE resultado_exame_id = ? AND usuario_id = ?', [
        n(re['id']),
        usuario,
      ]);
      if (ja) return;
      await tx.incluir('visualizacao_resultado_exame', {
        estabelecimento_id: est,
        resultado_exame_id: n(re['id']),
        paciente_id: n(re['paciente_id']),
        usuario_id: usuario,
        visualizado_em: agora(),
        origem: 'sistema',
      });
    },

    registrarOrcamento: nao('registrarOrcamento'),
    marcarOrcamentoConvertido: nao('marcarOrcamentoConvertido'),

    async registrarLaudoEmitido(r) {
      const ids = r.idsExames ?? [];
      if (ids.length === 0) throw recusa('sem-exames', 'O laudo emitido precisa dos exames.');
      const itens = await tx.consultar(
        `SELECT ei.id, r.paciente_id, r.id AS requisicao,
                (SELECT MAX(re.id) FROM resultado_exame re WHERE re.exame_item_id = ei.id AND re.situacao = 'liberado') AS resultado
           FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE r.estabelecimento_id = ? AND ei.id IN (${lista(ids.length)})`,
        [est, ...ids],
      );
      if (itens.length !== new Set(ids).size) throw recusa('exame-inexistente', 'Algum exame não é deste estabelecimento.');
      if (new Set(itens.map((i) => n(i['paciente_id']))).size > 1)
        throw recusa('pacientes-diferentes', 'O laudo reúne exames de um paciente só.');
      if (r.via > 1 && !r.motivo) throw recusa('motivo-obrigatorio', 'Informe o motivo da segunda via.');
      // A segunda via leva o motivo do cadastro (motivo_reimpressao, pelo código ou pela descrição escolhida na tela).
      let motivo: number | null = null;
      if (r.via > 1) {
        const mr = await tx.uma(
          'SELECT id FROM motivo_reimpressao WHERE (codigo = ? OR descricao = ?) AND ativo = TRUE ORDER BY id LIMIT 1',
          [r.motivo, r.motivo],
        );
        if (!mr) throw recusa('motivo-nao-cadastrado', 'Escolha um motivo de segunda via do cadastro.');
        motivo = n(mr['id']);
      }
      const quando = agora();
      const numero = await tx.proximoNumero('laudo_exame');
      const id = await tx.incluir('emissao_laudo', {
        estabelecimento_id: est,
        numero: numero.formatado,
        codigo_autenticacao: r.codigo,
        paciente_id: n(itens[0]!['paciente_id']),
        requisicao_exame_id: n(itens[0]!['requisicao']),
        tipo_emissao: r.via > 1 ? 'reimpressao' : 'pdf',
        motivo_reimpressao_id: motivo,
        laudo_gerado_em: quando,
        emitida_em: quando,
        emitido_por_usuario_id: usuario,
        origem: 'sistema',
      });
      let seq = 0;
      for (const i of itens)
        await tx.incluir('emissao_laudo_exame', {
          emissao_laudo_id: id,
          sequencia: ++seq,
          exame_item_id: n(i['id']),
          resultado_exame_id: nn(i['resultado']),
          origem: 'sistema',
        });
      if (r.via === 1)
        for (const i of itens) {
          const v = await tx.uma('SELECT versao FROM exame_item WHERE id = ?', [n(i['id'])]);
          await tx.alterar('exame_item', n(i['id']), n(v?.['versao']), { emitido_em: quando });
        }
      return id;
    },

    criarProtocoloPortal: nao('criarProtocoloPortal'),
    registrarAutocadastro: nao('registrarAutocadastro'),
    decidirAutocadastro: nao('decidirAutocadastro'),
    registrarTentativaPortal: nao('registrarTentativaPortal'),
  };
}

/** O nome da operação: o evento da tela (`dadosDepois.evento`) quando a trilha é fixa; senão, o genérico do módulo. */
export function nomeDaGravacao(modulo: string, trilha: unknown): string {
  const ev = typeof trilha === 'function' ? null : (trilha as { dadosDepois?: { evento?: unknown } } | null)?.dadosDepois?.evento;
  if (typeof ev !== 'string') return `${modulo}.gravacao`;
  const nome = ev.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return /^[a-z][a-z0-9_.-]{2,119}$/.test(nome) && nome.startsWith(`${modulo.split('.')[0]}.`) ? nome : `${modulo}.gravacao`;
}

/** O valor da gravação guardado no resultado da operação (a repetida pela chave devolve o mesmo valor). */
export function resultadoDe(v: unknown): ResultadoOperacao {
  return { valor: v === undefined ? null : JSON.stringify(v) };
}

export function valorDe<T>(r: ResultadoOperacao): T {
  const v = r['valor'];
  return (typeof v === 'string' ? JSON.parse(v) : undefined) as T;
}

function contextoDe(c: ContextoNucleo): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'sadt').slice(0, 64),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaSadtIndisponivel(): PortaSadt {
  return portaIndisponivel<PortaSadt>(METODOS_PORTA_SADT);
}
