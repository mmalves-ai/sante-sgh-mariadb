// Porta do ponto sobre o banco do cliente (M52.4), pelo @sgh/nucleo: o arquivo do relógio (arquivo_ponto, com o
// registro do arquivo), as marcações imutáveis (marcacao_ponto, por vínculo de trabalho, em UTC com o deslocamento
// local), os ajustes com aprovação por outra pessoa (ajuste_ponto), os domínios do ramo (justificativa_ponto,
// classificacao_marcacao, tipo_movimento_ponto, tipo_relogio_ponto) e os feriados. Gravações diretas (`gravarSgh`)
// numa transação com a linha da trilha junto. Toda leitura filtra o estabelecimento da sessão e os excluídos.
// Melhoria: a marcação guarda o instante em UTC e o deslocamento do relógio (o horário local sai na leitura); a
// mesma marcação do mesmo relógio e o mesmo arquivo uma vez só, por chave única do banco; todo ajuste tem
// justificativa do catálogo e quem aprova é outra pessoa (CHECK no banco); a desistência do ajuste fica como
// "cancelado", sem apagar nada; a marcação de CPF sem vínculo fica só no arquivo (conferência), nunca solta.
// Melhoria: o ajuste de inclusão vale para o vínculo vigente na data local da marcação (admissão a desligamento),
// conferido na gravação e reconstruído assim na leitura, nunca o primeiro vínculo do colaborador (readmissão); o
// mesmo pedido pendente reenviado devolve o ajuste já registrado, sem duplicar. Pendência: ajuste_ponto ganha
// vinculo_trabalho_id (pedido de DDL do lote) e a porta passa a gravar e ler por ele.
// Pendências de modelo (pedidos do lote 03-09; operações indisponíveis no banco até o DDL): a trilha do período
// (fechamento, reabertura e ciência do espelho), o banco de horas (movimentos e regra por regime de jornada) e o
// ajuste do tipo "justificativa" (abono por tipo de movimento com minutos). As leituras dessas partes voltam vazias
// e as gravações recusam com `modelo-pendente`.
import { CLASSES_HORA, DESTINOS_BANCO, EVENTOS_FOLHA, INICIOS_BANCO } from '@sgh/contratos';
import {
  alterarAuditado,
  type Escritor,
  gravarTrilha,
  type Leitor,
  type NucleoProprio,
  recusa,
} from '@sgh/nucleo';
import {
  type GravacaoFeita,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../../exames/public-api.js';
import {
  carimboDe,
  type CifraDoCpf,
  contextoDe,
  correcoesDaTrilha,
  dataIso,
  deslocamentoNormalizado,
  desatualizado,
  exigirEstabelecimento,
  fusoDoEstabelecimento,
  instante,
  type Linha,
  localNoFuso,
  marcadores,
  minutosDoDeslocamento,
  modeloPendente,
  n,
  nn,
  registrarCorrecaoNaTrilha,
  saidaIntegracao,
  texto,
  textoOuNulo,
  utcDoLocal,
} from '../banco-apoio.js';
import type { CorrecaoRegistrada } from '../tipos-pessoas.js';
import {
  type ContextoPonto,
  type GravadorPonto,
  METODOS_PORTA_PONTO,
  type PortaPonto,
} from './porta-ponto.js';
import type {
  AjustePonto,
  ArquivoRelogio,
  DominiosPonto,
  EventoDoPeriodo,
  FeriadoDoPeriodo,
  FiltroArquivosRelogio,
  MarcacaoRelogio,
  MovimentoBancoHoras,
  NovoArquivoRelogio,
  OpcaoPonto,
  RegraBancoDoRegime,
  VinculoDoCpf,
} from './tipos-ponto.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoPonto = Pick<NucleoProprio, 'lerSomente' | 'escrever'>;

const opcoes = (o: Readonly<Record<number, string>>): OpcaoPonto[] =>
  Object.entries(o).map(([k, v]) => ({ codigo: Number(k), nome: v }));
/** A coluna `conferencia` do arquivo guarda o resumo da conferência (até 1000 caracteres). */
const TETO_CONFERENCIA = 1000;
const SITUACAO_AJUSTE: Readonly<Record<string, string>> = { cancelado: 'desistido' };
const TIPO_AJUSTE: Readonly<Record<string, string>> = { desconsideracao: 'desconsiderar' };

const SQL_ARQUIVO = `
  SELECT ap.id, ap.hash_sha256, ap.periodo_inicio, ap.periodo_fim, ap.nsr_inicial, ap.nsr_final,
         ap.quantidade_marcacoes, ap.quantidade_rejeitadas, ap.importado_em, ap.situacao, ap.conferencia,
         a.nome_original, a.tamanho_bytes, rp.numero_fabricacao, rp.tipo_relogio_ponto_id, u.login
    FROM arquivo_ponto ap
    JOIN arquivo a ON a.id = ap.arquivo_id
    LEFT JOIN relogio_ponto rp ON rp.id = ap.relogio_ponto_id
    LEFT JOIN usuario u ON u.id = ap.importador_usuario_id
   WHERE ap.estabelecimento_id = ? AND ap.excluido_em IS NULL`;

const SQL_AJUSTE = `
  SELECT x.* FROM (
    SELECT aj.id, aj.tipo, aj.marcacao_ponto_id, aj.marcacao_em, aj.classificacao_marcacao_id, aj.justificativa_ponto_id,
           aj.justificativa_texto, aj.situacao, aj.solicitado_em, aj.decidido_em, aj.motivo_recusa, aj.versao,
           aj.solicitante_usuario_id, us.login AS solicitante, ua.login AS aprovador, mp.marcado_em,
           aj.colaborador_id, mp.vinculo_trabalho_id AS vinculo_marcacao
      FROM ajuste_ponto aj
      JOIN usuario us ON us.id = aj.solicitante_usuario_id
      LEFT JOIN usuario ua ON ua.id = aj.aprovador_usuario_id
      LEFT JOIN marcacao_ponto mp ON mp.id = aj.marcacao_ponto_id
     WHERE aj.estabelecimento_id = ? AND aj.excluido_em IS NULL) x`;

interface PeriodoVinculo {
  readonly id: number;
  readonly colaborador: number;
  readonly admissao: string;
  readonly desligamento: string | null;
}

/** Os vínculos do colaborador no estabelecimento vigentes no dia (admissão a desligamento, inclusive). */
function vigentesNoDia(vs: readonly PeriodoVinculo[], colaborador: number, dia: string): PeriodoVinculo[] {
  return vs.filter(
    (v) =>
      v.colaborador === colaborador &&
      v.admissao <= dia &&
      (v.desligamento === null || v.desligamento >= dia),
  );
}

/** Filtro das leituras de ajuste (lista branca: id, vínculo ou pendentes). */
type FiltroAjuste = { readonly id: number } | { readonly vinculo: number } | { readonly pendentes: true };

function conferenciaDe(v: unknown): Record<string, unknown> {
  try {
    return v ? (JSON.parse(String(v)) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** O resumo da conferência do arquivo, cortando a lista de falhas para caber na coluna (nunca o conteúdo da linha). */
function conferenciaPara(a: NovoArquivoRelogio): string {
  const base = {
    tipoRep: a.tipoRep,
    modelo: a.modelo,
    numeroRep: a.numeroRep,
    cnpjEmpregador: a.cnpjEmpregador,
    razaoSocial: a.razaoSocial,
    leiaute: a.leiaute,
    dataInicial: a.dataInicial,
    dataFinal: a.dataFinal,
    novas: a.novas,
    jaImportadas: a.jaImportadas,
    semColaborador: a.semColaborador,
    totalFalhas: a.totalFalhas,
  };
  let falhas: unknown[];
  try {
    falhas = a.falhas ? (JSON.parse(a.falhas) as unknown[]) : [];
  } catch {
    falhas = [];
  }
  for (let k = falhas.length; k >= 0; k--) {
    const s = JSON.stringify({ ...base, falhas: k > 0 ? falhas.slice(0, k) : null });
    if (s.length <= TETO_CONFERENCIA) return s;
  }
  return JSON.stringify({ ...base, razaoSocial: null, falhas: null }).slice(0, TETO_CONFERENCIA);
}

function arquivoDe(r: Linha): ArquivoRelogio {
  const k = conferenciaDe(r['conferencia']);
  const falhas = k['falhas'];
  return {
    id: n(r['id']),
    nome: texto(r['nome_original']),
    hash: texto(r['hash_sha256']),
    tamanho: n(r['tamanho_bytes']),
    tipoRep: texto(k['tipoRep']),
    modelo: nn(k['modelo'] ?? r['tipo_relogio_ponto_id']),
    numeroRep: textoOuNulo(k['numeroRep'] ?? r['numero_fabricacao']),
    cnpjEmpregador: textoOuNulo(k['cnpjEmpregador']),
    razaoSocial: textoOuNulo(k['razaoSocial']),
    leiaute: textoOuNulo(k['leiaute']),
    dataInicial:
      k['dataInicial'] === undefined ? dataIso(r['periodo_inicio']) : textoOuNulo(k['dataInicial']),
    dataFinal: k['dataFinal'] === undefined ? dataIso(r['periodo_fim']) : textoOuNulo(k['dataFinal']),
    nsrInicial: nn(r['nsr_inicial']),
    nsrFinal: nn(r['nsr_final']),
    marcacoes: n(r['quantidade_marcacoes']),
    novas: n(k['novas']),
    jaImportadas: n(k['jaImportadas']),
    semColaborador: n(k['semColaborador']),
    situacao: texto(r['situacao']) === 'rejeitado' ? 'quarentena' : 'importado',
    totalFalhas: n(r['quantidade_rejeitadas']),
    falhas: Array.isArray(falhas) ? JSON.stringify(falhas) : null,
    importadoPor: texto(r['login']),
    importadoEm: '',
  };
}

export class PortaPontoPropria implements PortaPonto {
  readonly destino = 'banco' as const;

  constructor(
    private readonly nucleo: NucleoPonto,
    private readonly cifra: CifraDoCpf,
  ) {}

  private ler<T>(c: ContextoPonto, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    let est: number;
    try {
      est = exigirEstabelecimento(c);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.nucleo.lerSomente(contextoDe(c), async (l) =>
      fn(l, est, await fusoDoEstabelecimento(l, est)),
    );
  }

  private async arquivos_(l: Leitor, est: number, fuso: string, filtro = '', p: unknown[] = [], cauda = '') {
    const linhas = await l.consultar(`${SQL_ARQUIVO}${filtro} ORDER BY ap.id DESC${cauda}`, [est, ...p]);
    return linhas.map((r) => ({
      ...arquivoDe(r),
      importadoEm: localNoFuso(instante(r['importado_em']) ?? new Date(0), fuso),
    }));
  }

  /** Vínculos do estabelecimento com o CPF de cada HMAC pedido (o modelo guarda o CPF; pendência: índice por HMAC). */
  private async porHmac(
    l: Leitor,
    est: number,
    hmacs: readonly string[],
  ): Promise<Map<string, VinculoDoCpf[]>> {
    const r = new Map<string, VinculoDoCpf[]>();
    if (hmacs.length === 0) return r;
    const alvo = new Set(hmacs);
    const linhas = await l.consultar(
      `SELECT vt.id, vt.colaborador_id, vt.data_admissao, vt.data_desligamento, c.cpf
         FROM vinculo_trabalho vt JOIN colaborador c ON c.id = vt.colaborador_id
        WHERE vt.estabelecimento_id = ? AND vt.excluido_em IS NULL AND c.excluido_em IS NULL ORDER BY vt.id`,
      [est],
    );
    for (const x of linhas) {
      const h = this.cifra.hmac(texto(x['cpf']));
      if (!alvo.has(h)) continue;
      r.set(h, [
        ...(r.get(h) ?? []),
        {
          vinculo: n(x['id']),
          pessoa: n(x['colaborador_id']),
          admissao: dataIso(x['data_admissao']) ?? '',
          desligamento: dataIso(x['data_desligamento']),
        },
      ]);
    }
    return r;
  }

  /** Marcações dos vínculos no intervalo local [de, ate), com o horário local de cada uma. */
  private async marcacoesDosVinculos(
    l: Leitor,
    vinculos: readonly number[],
    de: string,
    ate: string,
  ): Promise<(MarcacaoRelogio & { vinculo: number })[]> {
    if (vinculos.length === 0) return [];
    // Janela UTC folgada (±1 dia) e o corte exato pelo horário local de cada marcação.
    const ini = new Date(Date.parse(`${de.slice(0, 10)}T00:00:00Z`) - 86_400_000);
    const fim = new Date(Date.parse(`${ate.slice(0, 10)}T00:00:00Z`) + 2 * 86_400_000);
    const linhas = await l.consultar(
      `SELECT mp.id, mp.vinculo_trabalho_id, mp.arquivo_ponto_id, mp.nsr, mp.marcado_em, mp.fuso_horario, mp.fonte,
              mp.criado_em, ap.conferencia, rp.numero_fabricacao
         FROM marcacao_ponto mp
         LEFT JOIN arquivo_ponto ap ON ap.id = mp.arquivo_ponto_id
         LEFT JOIN relogio_ponto rp ON rp.id = mp.relogio_ponto_id
        WHERE mp.vinculo_trabalho_id IN (${marcadores(vinculos.length)}) AND mp.excluido_em IS NULL
          AND mp.marcado_em >= ? AND mp.marcado_em < ?
        ORDER BY mp.marcado_em, mp.id`,
      [...vinculos, ini, fim],
    );
    return linhas
      .map((r) => {
        const utc = instante(r['marcado_em']) ?? new Date(0);
        const local = new Date(utc.getTime() + minutosDoDeslocamento(texto(r['fuso_horario'])) * 60_000)
          .toISOString()
          .slice(0, 16);
        const fonte = texto(r['fonte']);
        return {
          id: n(r['id']),
          vinculo: n(r['vinculo_trabalho_id']),
          arquivo: n(r['arquivo_ponto_id']),
          numeroRep: texto(r['numero_fabricacao'] ?? conferenciaDe(r['conferencia'])['numeroRep']),
          nsr: n(r['nsr']),
          tipoRegistro: fonte === 'aplicativo' || fonte === 'web' ? 7 : 3,
          instante: local,
          criadoEm: (instante(r['criado_em']) ?? new Date(0)).toISOString().slice(0, 16),
        };
      })
      .filter((m) => m.instante >= de && m.instante < ate);
  }

  private async periodosDosVinculos(
    l: Leitor,
    est: number,
    colaboradores: readonly number[],
  ): Promise<PeriodoVinculo[]> {
    if (colaboradores.length === 0) return [];
    const linhas = await l.consultar(
      `SELECT id, colaborador_id, data_admissao, data_desligamento FROM vinculo_trabalho
        WHERE estabelecimento_id = ? AND excluido_em IS NULL AND colaborador_id IN (${marcadores(colaboradores.length)})`,
      [est, ...colaboradores],
    );
    return linhas.map((r) => ({
      id: n(r['id']),
      colaborador: n(r['colaborador_id']),
      admissao: dataIso(r['data_admissao']) ?? '',
      desligamento: dataIso(r['data_desligamento']),
    }));
  }

  private async ajustes_(l: Leitor, est: number, fuso: string, f: FiltroAjuste): Promise<AjustePonto[]> {
    let filtro: string;
    let p: unknown[];
    if ('id' in f) [filtro, p] = ['x.id = ?', [f.id]];
    else if ('vinculo' in f)
      [filtro, p] = [
        `(x.vinculo_marcacao = ? OR (x.vinculo_marcacao IS NULL AND x.colaborador_id =
           (SELECT vt.colaborador_id FROM vinculo_trabalho vt WHERE vt.id = ? AND vt.estabelecimento_id = ?)))`,
        [f.vinculo, f.vinculo, est],
      ];
    else [filtro, p] = ["x.situacao = 'pendente'", []];
    const brutas = await l.consultar(`${SQL_AJUSTE} WHERE ${filtro} ORDER BY x.id`, [est, ...p]);
    // O ajuste de inclusão ainda não guarda o vínculo (pendência de DDL): é o vínculo vigente na data local da marcação.
    const semMarcacao = [
      ...new Set(brutas.filter((r) => r['vinculo_marcacao'] == null).map((r) => n(r['colaborador_id']))),
    ];
    const periodos = await this.periodosDosVinculos(l, est, semMarcacao);
    const linhas: Linha[] = brutas
      .map((r): Linha => {
        if (r['vinculo_marcacao'] != null) return { ...r, vinculo: r['vinculo_marcacao'] };
        const quando = instante(r['marcacao_em']) ?? instante(r['solicitado_em']) ?? new Date(0);
        const [v] = vigentesNoDia(
          periodos,
          n(r['colaborador_id']),
          localNoFuso(quando, fuso).slice(0, 10),
        ).sort((a, b) => b.admissao.localeCompare(a.admissao));
        return { ...r, vinculo: v?.id ?? null };
      })
      .filter((r) => r['vinculo'] !== null && (!('vinculo' in f) || n(r['vinculo']) === f.vinculo));
    return linhas.map((r) => {
      const quando = instante(r['marcacao_em']) ?? instante(r['marcado_em']);
      const local = quando ? localNoFuso(quando, fuso) : null;
      const sit = texto(r['situacao']);
      return {
        id: n(r['id']),
        vinculo: n(r['vinculo']),
        dia: (local ?? localNoFuso(instante(r['solicitado_em']) ?? new Date(0), fuso)).slice(0, 10),
        tipo: TIPO_AJUSTE[texto(r['tipo'])] ?? texto(r['tipo']),
        marcacao: nn(r['marcacao_ponto_id']),
        instante: texto(r['tipo']) === 'inclusao' ? local : null,
        movimento: null,
        justificativa: nn(r['justificativa_ponto_id']),
        periodo: nn(r['classificacao_marcacao_id']),
        minutos: null,
        motivo: texto(r['justificativa_texto']),
        situacao: SITUACAO_AJUSTE[sit] ?? sit,
        pedidoPor: texto(r['solicitante']),
        pedidoEm: localNoFuso(instante(r['solicitado_em']) ?? new Date(0), fuso),
        decididoPor: sit === 'cancelado' ? texto(r['solicitante']) : textoOuNulo(r['aprovador']),
        decididoEm: r['decidido_em'] ? localNoFuso(instante(r['decidido_em']) ?? new Date(0), fuso) : null,
        motivoDecisao: textoOuNulo(r['motivo_recusa']),
        versao: n(r['versao']),
      };
    });
  }

  // ── Gravação ────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<GravacaoFeita> {
    throw recusa('operacao-desconhecida', 'O ponto não usa o executor.');
  }

  gravarSgh<T>(
    c: ContextoPonto,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorPonto) => Promise<T>,
  ): Promise<T> {
    let est: number;
    try {
      est = exigirEstabelecimento(c);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.nucleo.escrever(contextoDe(c), async (e) => {
      const fuso = await fusoDoEstabelecimento(e, est);
      const r = await fn(this.gravador(e, c, est, fuso));
      const t = typeof trilha === 'function' ? trilha(r) : trilha;
      await gravarTrilha(e, { ...t, ocorridoEm: t.ocorridoEm ?? new Date() });
      return r;
    });
  }

  private gravador(e: Escritor, c: ContextoPonto, est: number, fuso: string): GravadorPonto {
    const usuario = () => {
      if (c.usuario === null) throw recusa('sem-usuario', 'A gravação do ponto exige o usuário da sessão.');
      return c.usuario;
    };
    const ajusteVigente = async (id: number, versao: number) => {
      const [a] = await this.ajustes_(e, est, fuso, { id });
      if (!a || a.versao !== versao || a.situacao !== 'pendente') throw desatualizado();
      const s = await e.uma<{ solicitante_usuario_id: number }>(
        'SELECT solicitante_usuario_id FROM ajuste_ponto WHERE id = ?',
        [id],
      );
      return { a, solicitante: Number(s?.solicitante_usuario_id) };
    };
    const pendente = (o: string) =>
      Promise.reject(
        modeloPendente(
          o,
          'Esta parte do ponto aguarda a tabela no modelo do banco (pedido registrado): por enquanto fica em consulta.',
        ),
      );
    return {
      arquivoPorHash: async (hash) =>
        (await this.arquivos_(e, est, fuso, ' AND ap.hash_sha256 = ?', [hash]))[0] ?? null,
      nsrsImportados: async (numeroRep, de, ate) =>
        new Set(
          (
            await e.consultar(
              `SELECT mp.nsr FROM marcacao_ponto mp JOIN arquivo_ponto ap ON ap.id = mp.arquivo_ponto_id
                WHERE ap.estabelecimento_id = ? AND JSON_VALUE(ap.conferencia, '$.numeroRep') = ?
                  AND mp.nsr BETWEEN ? AND ? AND mp.excluido_em IS NULL`,
              [est, numeroRep, de, ate],
            )
          ).map((r) => n(r['nsr'])),
        ),
      incluirArquivo: async (a) => {
        const agora = new Date();
        const hoje = localNoFuso(agora, fuso).slice(0, 10);
        const ja = await e.uma(
          'SELECT id FROM arquivo_ponto WHERE estabelecimento_id = ? AND hash_sha256 = ?',
          [est, a.hash],
        );
        if (ja) throw recusa('arquivo-ja-importado', 'Este arquivo já foi importado (mesmo conteúdo).');
        const arquivo = await e.inserir(
          `INSERT INTO arquivo (estabelecimento_id, entidade, finalidade, nome_original, tipo_mime, tamanho_bytes,
             hash_sha256, chave_armazenamento, imutavel, criado_em, criado_por, versao)
           VALUES (?, 'arquivo_ponto', 'ponto_afd', ?, 'text/plain', ?, ?, ?, TRUE, ?, ?, 1)`,
          [est, a.nome.slice(0, 255), a.tamanho, a.hash, `ponto/afd/${est}/${a.hash}`, agora, c.usuario],
        );
        const relogio = a.numeroRep
          ? await e.uma<{ id: number }>(
              'SELECT id FROM relogio_ponto WHERE numero_fabricacao = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [a.numeroRep, est],
            )
          : null;
        const inicio = a.dataInicial ?? hoje;
        const fim = a.dataFinal && a.dataFinal >= inicio ? a.dataFinal : inicio;
        const nsrOk = a.nsrInicial !== null && a.nsrFinal !== null && a.nsrFinal >= a.nsrInicial;
        return e.inserir(
          `INSERT INTO arquivo_ponto (estabelecimento_id, relogio_ponto_id, arquivo_id, tipo_arquivo, hash_sha256,
             periodo_inicio, periodo_fim, nsr_inicial, nsr_final, quantidade_marcacoes, quantidade_rejeitadas,
             importado_em, importador_usuario_id, situacao, conferencia, criado_em, criado_por, versao)
           VALUES (?, ?, ?, 'afd', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            est,
            relogio ? Number(relogio.id) : null,
            arquivo,
            a.hash,
            inicio,
            fim,
            nsrOk ? a.nsrInicial : null,
            nsrOk ? a.nsrFinal : null,
            a.marcacoes,
            a.totalFalhas,
            agora,
            c.usuario,
            a.situacao === 'importado' ? 'importado' : 'rejeitado',
            conferenciaPara(a),
            agora,
            c.usuario,
          ],
        );
      },
      incluirMarcacao: async (m) => {
        if (m.vinculo === null) return null;
        const v = await e.uma('SELECT id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ?', [
          m.vinculo,
          est,
        ]);
        if (!v) throw recusa('vinculo-inexistente', 'O vínculo da marcação não é deste estabelecimento.');
        const ap = await e.uma<{ relogio_ponto_id: number | null }>(
          'SELECT relogio_ponto_id FROM arquivo_ponto WHERE id = ? AND estabelecimento_id = ?',
          [m.arquivo, est],
        );
        if (!ap) throw desatualizado();
        const relogio = nn(ap.relogio_ponto_id);
        const desloc = minutosDoDeslocamento(m.fuso);
        const utc = new Date(Date.parse(`${m.instante.slice(0, 16)}:00Z`) - desloc * 60_000);
        const fonte = m.tipoRegistro === 7 ? 'web' : relogio !== null ? 'relogio' : 'importacao';
        const agora = new Date();
        const ja = await e.uma(
          'SELECT id FROM marcacao_ponto WHERE vinculo_trabalho_id = ? AND marcado_em = ? AND fonte = ?',
          [m.vinculo, utc, fonte],
        );
        if (ja) throw recusa('marcacao-ja-importada', 'A marcação deste relógio já foi importada.');
        return e.inserir(
          `INSERT INTO marcacao_ponto (vinculo_trabalho_id, marcado_em, fuso_horario, fonte, relogio_ponto_id,
             arquivo_ponto_id, nsr, criado_em, criado_por, versao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            m.vinculo,
            utc,
            deslocamentoNormalizado(m.fuso),
            fonte,
            relogio,
            m.arquivo,
            m.nsr,
            agora,
            c.usuario,
          ],
        );
      },
      marcacoes: async (h, de, ate) => {
        const vs = (await this.porHmac(e, est, [h])).get(h) ?? [];
        return (
          (
            await this.marcacoesDosVinculos(
              e,
              vs.map((v) => v.vinculo),
              de,
              ate,
            )
          )
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- o campo é descartado de propósito
            .map(({ vinculo: _v, ...m }) => m)
        );
      },
      ajuste: async (id) => (await this.ajustes_(e, est, fuso, { id }))[0] ?? null,
      ajustes: async (v, de, ate) =>
        (await this.ajustes_(e, est, fuso, { vinculo: v })).filter((a) => a.dia >= de && a.dia <= ate),
      incluirAjuste: async (a) => {
        if (a.tipo !== 'inclusao' && a.tipo !== 'desconsiderar')
          return pendente('O ajuste de justificativa ou abono');
        if (a.justificativa === null)
          throw recusa('justificativa-obrigatoria', 'Escolha a justificativa do ajuste no catálogo.');
        const v = await e.uma<{ colaborador_id: number }>(
          'SELECT colaborador_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [a.vinculo, est],
        );
        if (!v) throw recusa('vinculo-inexistente', 'Colaborador inexistente neste estabelecimento.');
        if (a.tipo === 'desconsiderar') {
          const mp = await e.uma('SELECT id FROM marcacao_ponto WHERE id = ? AND vinculo_trabalho_id = ?', [
            a.marcacao,
            a.vinculo,
          ]);
          if (!mp) throw recusa('marcacao-inexistente', 'A marcação não é deste colaborador.');
        } else {
          if (!a.instante) throw recusa('instante-obrigatorio', 'Informe o horário da marcação que faltou.');
          // O ajuste ainda não guarda o vínculo (pendência de DDL): vale para o vínculo vigente na data da marcação.
          const vigentes = vigentesNoDia(
            await this.periodosDosVinculos(e, est, [Number(v.colaborador_id)]),
            Number(v.colaborador_id),
            a.instante.slice(0, 10),
          );
          if (vigentes.length > 1)
            throw modeloPendente(
              'A inclusão de marcação com dois vínculos no mesmo dia',
              'O colaborador tem mais de um vínculo vigente nesta data; o ajuste só indicará o vínculo quando o modelo o guardar.',
            );
          if (vigentes[0]?.id !== a.vinculo)
            throw recusa(
              'fora-do-vinculo',
              'O horário pedido está fora do período deste vínculo (da admissão ao desligamento).',
            );
        }
        // O mesmo pedido pendente reenviado (clique duplo, repetição da requisição) devolve o ajuste já registrado.
        const repetido = await e.uma<{ id: number }>(
          `SELECT id FROM ajuste_ponto WHERE estabelecimento_id = ? AND colaborador_id = ? AND situacao = 'pendente'
              AND excluido_em IS NULL AND tipo = ? AND marcacao_ponto_id <=> ? AND marcacao_em <=> ?
              AND justificativa_ponto_id = ? AND solicitante_usuario_id = ? LIMIT 1`,
          [
            est,
            Number(v.colaborador_id),
            a.tipo === 'inclusao' ? 'inclusao' : 'desconsideracao',
            a.tipo === 'desconsiderar' ? a.marcacao : null,
            a.tipo === 'inclusao' && a.instante ? utcDoLocal(a.instante, fuso) : null,
            a.justificativa,
            usuario(),
          ],
        );
        if (repetido) return Number(repetido.id);
        const agora = new Date();
        return e.inserir(
          `INSERT INTO ajuste_ponto (estabelecimento_id, colaborador_id, tipo, marcacao_ponto_id, marcacao_em,
             classificacao_marcacao_id, justificativa_ponto_id, justificativa_texto, solicitante_usuario_id,
             solicitado_em, situacao, criado_em, criado_por, versao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?, 1)`,
          [
            est,
            Number(v.colaborador_id),
            a.tipo === 'inclusao' ? 'inclusao' : 'desconsideracao',
            a.tipo === 'desconsiderar' ? a.marcacao : null,
            a.tipo === 'inclusao' && a.instante ? utcDoLocal(a.instante, fuso) : null,
            a.periodo,
            a.justificativa,
            a.motivo.slice(0, 500),
            usuario(),
            agora,
            agora,
            c.usuario,
          ],
        );
      },
      decidirAjuste: async (d) => {
        const { solicitante } = await ajusteVigente(d.id, d.versao);
        const aprovador = usuario();
        if (aprovador === solicitante)
          throw recusa('aprovador-e-solicitante', 'Quem pediu o ajuste não o aprova.');
        await alterarAuditado(
          e,
          'ajuste_ponto',
          d.id,
          d.versao,
          {
            situacao: d.situacao,
            aprovador_usuario_id: aprovador,
            decidido_em: new Date(),
            motivo_recusa: d.motivo?.slice(0, 500) ?? null,
          },
          carimboDe(c),
        );
      },
      desistirAjuste: async (d) => {
        const { solicitante } = await ajusteVigente(d.id, d.versao);
        if (usuario() !== solicitante) throw desatualizado();
        await alterarAuditado(
          e,
          'ajuste_ponto',
          d.id,
          d.versao,
          { situacao: 'cancelado', decidido_em: new Date(), motivo_recusa: d.motivo.slice(0, 500) },
          carimboDe(c),
        );
      },
      eventosPeriodo: async () => [],
      incluirEventoPeriodo: () => pendente('O fechamento, a reabertura e a ciência do período'),
      movimentosBanco: async () => [],
      incluirMovimentoBanco: () => pendente('O banco de horas'),
      regrasBanco: async () => [],
      gravarRegraBanco: () => pendente('A regra do banco de horas do regime'),
      situacaoRegraBanco: () => pendente('A regra do banco de horas do regime'),
      registrarCorrecao: (x) => registrarCorrecaoNaTrilha(e, c, x),
      travarPessoa: async (pessoa) => {
        await e.consultarParaAtualizar('SELECT id FROM colaborador WHERE id = ?', [pessoa]);
      },
      outbox: (ev) => saidaIntegracao(e, c, ev),
    };
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoPonto): Promise<{ hoje: string; agora: string }> {
    return this.ler(c, async (_l, _e, fuso) => {
      const agora = localNoFuso(new Date(), fuso);
      return { hoje: agora.slice(0, 10), agora };
    });
  }

  dominios(c: ContextoPonto): Promise<DominiosPonto> {
    return this.ler(c, async (l) => {
      const lista = async (sql: string) =>
        (await l.consultar(sql)).map((r) => ({ codigo: n(r['id']), nome: texto(r['descricao']) }));
      return {
        classesHora: opcoes(CLASSES_HORA),
        eventosFolha: opcoes(EVENTOS_FOLHA),
        destinosBanco: opcoes(DESTINOS_BANCO),
        iniciosBanco: opcoes(INICIOS_BANCO),
        modelosRelogio: await lista(
          'SELECT id, descricao FROM tipo_relogio_ponto WHERE ativo ORDER BY descricao, id',
        ),
        justificativas: await lista(
          'SELECT id, descricao FROM justificativa_ponto WHERE ativo ORDER BY descricao, id',
        ),
        periodos: await lista(
          'SELECT id, descricao FROM classificacao_marcacao WHERE ativo ORDER BY ordem, id',
        ),
        movimentos: await lista(
          'SELECT id, descricao FROM tipo_movimento_ponto WHERE ativo ORDER BY descricao, id',
        ),
      };
    });
  }

  /**
   * Feriados nacionais, do município do estabelecimento e do próprio estabelecimento. Pendência: os estaduais (a UF
   * do estabelecimento pelo município), pedido do lote 03-09.
   */
  feriados(c: ContextoPonto, de: string, ate: string): Promise<FeriadoDoPeriodo[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT f.data, f.nome FROM feriado f
            WHERE f.ativo AND f.excluido_em IS NULL AND f.data BETWEEN ? AND ?
              AND (f.abrangencia = 'nacional' OR f.estabelecimento_id = ?
                   OR (f.abrangencia = 'municipal'
                       AND f.municipio_ibge_id = (SELECT municipio_ibge_id FROM estabelecimento WHERE id = ?)))
            ORDER BY f.data, f.id`,
          [de, ate, est, est],
        )
      ).map((r) => ({ data: dataIso(r['data']) ?? '', nome: texto(r['nome']) })),
    );
  }

  arquivos(c: ContextoPonto, f: FiltroArquivosRelogio): Promise<ArquivoRelogio[]> {
    return this.ler(c, (l, est, fuso) => {
      const w: string[] = [];
      const p: unknown[] = [];
      if (f.situacao) {
        w.push('ap.situacao = ?');
        p.push(f.situacao === 'quarentena' ? 'rejeitado' : 'importado');
      }
      if (f.de) {
        w.push('ap.periodo_fim >= ?');
        p.push(f.de);
      }
      if (f.ate) {
        w.push('ap.periodo_inicio <= ?');
        p.push(f.ate);
      }
      const filtro = w.length ? ` AND ${w.join(' AND ')}` : '';
      return this.arquivos_(
        l,
        est,
        fuso,
        filtro,
        [...p, Math.max(1, f.limite), Math.max(0, f.pular)],
        ' LIMIT ? OFFSET ?',
      );
    });
  }

  arquivo(c: ContextoPonto, id: number): Promise<ArquivoRelogio | null> {
    return this.ler(
      c,
      async (l, est, fuso) => (await this.arquivos_(l, est, fuso, ' AND ap.id = ?', [id]))[0] ?? null,
    );
  }

  arquivosDoPeriodo(c: ContextoPonto, de: string, ate: string): Promise<ArquivoRelogio[]> {
    return this.ler(c, (l, est, fuso) =>
      this.arquivos_(
        l,
        est,
        fuso,
        " AND ap.situacao = 'importado' AND ap.periodo_inicio <= ? AND ap.periodo_fim >= ?",
        [ate, de],
      ),
    );
  }

  marcacoes(c: ContextoPonto, cpfHmac: string, de: string, ate: string): Promise<MarcacaoRelogio[]> {
    return this.ler(c, async (l, est) => {
      const vs = (await this.porHmac(l, est, [cpfHmac])).get(cpfHmac) ?? [];
      return (
        (
          await this.marcacoesDosVinculos(
            l,
            vs.map((v) => v.vinculo),
            de,
            ate,
          )
        )
          // eslint-disable-next-line @typescript-eslint/no-unused-vars -- o campo é descartado de propósito
          .map(({ vinculo: _v, ...m }) => m)
      );
    });
  }

  contagemMarcacoes(
    c: ContextoPonto,
    hmacs: readonly string[],
    de: string,
    ate: string,
  ): Promise<Map<string, number>> {
    if (hmacs.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const por = await this.porHmac(l, est, hmacs);
      const doVinculo = new Map<number, string>();
      for (const [h, vs] of por) for (const v of vs) doVinculo.set(v.vinculo, h);
      const r = new Map<string, number>();
      for (const m of await this.marcacoesDosVinculos(l, [...doVinculo.keys()], de, ate)) {
        const h = doVinculo.get(m.vinculo)!;
        r.set(h, (r.get(h) ?? 0) + 1);
      }
      return r;
    });
  }

  hmacs(c: ContextoPonto, vinculos: readonly number[]): Promise<Map<number, string>> {
    if (vinculos.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT vt.id, c.cpf FROM vinculo_trabalho vt JOIN colaborador c ON c.id = vt.colaborador_id
          WHERE vt.estabelecimento_id = ? AND vt.id IN (${marcadores(vinculos.length)}) AND vt.excluido_em IS NULL`,
        [est, ...vinculos],
      );
      return new Map(linhas.map((r) => [n(r['id']), this.cifra.hmac(texto(r['cpf']))]));
    });
  }

  ajustes(c: ContextoPonto, vinculo: number, de: string, ate: string): Promise<AjustePonto[]> {
    return this.ler(c, async (l, est, fuso) =>
      (await this.ajustes_(l, est, fuso, { vinculo })).filter((a) => a.dia >= de && a.dia <= ate),
    );
  }

  ajuste(c: ContextoPonto, id: number): Promise<AjustePonto | null> {
    return this.ler(c, async (l, est, fuso) => (await this.ajustes_(l, est, fuso, { id }))[0] ?? null);
  }

  pendentesPorVinculo(c: ContextoPonto, de: string, ate: string): Promise<Map<number, number>> {
    return this.ler(c, async (l, est, fuso) => {
      const r = new Map<number, number>();
      for (const a of await this.ajustes_(l, est, fuso, { pendentes: true }))
        if (a.dia >= de && a.dia <= ate) r.set(a.vinculo, (r.get(a.vinculo) ?? 0) + 1);
      return r;
    });
  }

  /** Pendência de modelo (trilha do período): lê vazio até a tabela existir. */
  async eventosPeriodo(): Promise<EventoDoPeriodo[]> {
    return [];
  }

  /** Pendência de modelo (trilha do período): lê vazio até a tabela existir. */
  async eventosDaCompetencia(): Promise<EventoDoPeriodo[]> {
    return [];
  }

  /** Pendência de modelo (regra do banco por regime): lê vazio até a coluna existir. */
  async regrasBanco(): Promise<RegraBancoDoRegime[]> {
    return [];
  }

  correcoes(c: ContextoPonto, tabela: string, registros: readonly number[]): Promise<CorrecaoRegistrada[]> {
    if (registros.length === 0) return Promise.resolve([]);
    return this.ler(c, (l, est, fuso) => correcoesDaTrilha(l, est, tabela, registros, fuso));
  }

  /** Pendência de modelo (banco de horas por vínculo): lê vazio até o DDL. */
  async movimentosBanco(): Promise<MovimentoBancoHoras[]> {
    return [];
  }

  /** Pendência de modelo (banco de horas por vínculo): sem saldo até o DDL. */
  async saldosBanco(): Promise<Map<number, number>> {
    return new Map();
  }

  vinculosDoLogin(c: ContextoPonto, login: string): Promise<number[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT vt.id FROM vinculo_trabalho vt JOIN colaborador c ON c.id = vt.colaborador_id
             JOIN usuario u ON u.id = c.usuario_id
            WHERE u.login = ? AND vt.estabelecimento_id = ? AND vt.excluido_em IS NULL AND c.excluido_em IS NULL
            ORDER BY vt.id`,
          [login, est],
        )
      ).map((r) => n(r['id'])),
    );
  }

  vinculosPorHmacs(c: ContextoPonto, hmacs: readonly string[]): Promise<Map<string, VinculoDoCpf[]>> {
    if (hmacs.length === 0) return Promise.resolve(new Map());
    return this.ler(c, (l, est) => this.porHmac(l, est, hmacs));
  }
}

export function portaPontoIndisponivel(): PortaPonto {
  return portaIndisponivel<PortaPonto>(METODOS_PORTA_PONTO);
}
