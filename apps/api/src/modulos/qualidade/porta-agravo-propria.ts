// Porta PRÓPRIA da notificação compulsória (M48, etapa 4) sobre o MariaDB do cliente, pelo @sgh/nucleo.
// Lê o cadastro de agravos notificáveis (agravo_notificavel, agravo_notificavel_cid, periodicidade_notificacao,
// agravo_pergunta) e a CID-10 (termo_terminologia da terminologia `cid10`), os gatilhos do prontuário (diagnostico_atendimento
// e os CIDs principal e secundário do atendimento), os óbitos (declaracao_obito), os resultados liberados
// (resultado_exame, resultado_analito, exame_item, requisicao_exame e exame), o paciente (paciente, pessoa_fisica, sexo)
// e o estabelecimento (com município e UF). Grava o caso (notificacao_agravo) e os gatilhos de exame
// (gatilho_exame_agravo) numa operação do Executor (gravacaoDireta: trilha, outbox e idempotência na mesma transação),
// com a linha travada (FOR UPDATE) e conferida pela versão vista.
// Melhoria: a unidade do agravo é o estabelecimento da sessão (CNES, município e UF do cadastro), não um setor solto.
// Melhoria: o "modelo da ficha" é o próprio agravo notificável (o nome dele são os CIDs do agravo separados por "/", para
// o domínio escolher a ficha pelo CID) e as perguntas são as do agravo; o caso grava o agravo (FK obrigatória).
// Melhoria: a situação do caso segue o modelo (rascunho = aberto, notificada, descartada); enviada e confirmada são lidas
// como notificado, cancelada como descartado.
// Melhoria: o exame do caso é o item pedido (exame_item, pela chave do gatilho); a coluna exame_id guarda o exame do
// catálogo (a FK do modelo), e o reenvio do mesmo gatilho é barrado pela chave única (estabelecimento, chave do gatilho).
import { type Executor, ErroOperacao, recusa, type TxOperacao } from '@sgh/nucleo';
import { gravacaoDireta } from '../enfermagem/gravacao-direta.js';
import type { GravacaoFeita, TrilhaDaGravacao } from '../exames/public-api.js';
import {
  dataIso,
  exigirUsuario,
  instante,
  instanteN,
  type L,
  lerNoEstabelecimento,
  type Linha,
  marcas,
  n,
  nn,
  type NucleoQualidade,
  paraBanco,
  relogioDoEstabelecimento,
  texto,
  textoN,
  verdadeiro,
} from './apoio-propria.js';
import type { ContextoAgravo, GravadorAgravo, PortaAgravo } from './porta-agravo.js';
import type {
  AtendimentoParaAgravo,
  CasoAgravoRegistrado,
  CidNotificavelCadastro,
  ExameParaAgravo,
  FiltroCasosAgravo,
  GatilhoExameRegistrado,
  PacienteDoAgravo,
  UnidadeDoAgravo,
} from './tipos.js';
import { recusaVersaoAgravo } from './tipos.js';

/** As tabelas que a gravação da notificação compulsória escreve (a transação recusa as outras). */
export const TABELAS_AGRAVO = ['notificacao_agravo', 'gatilho_exame_agravo'] as const;

const TETO_FILA = 2000;
const ERRNO_DUPLICADO = 1062;
const CID = "REPLACE(%s.codigo_termo, '.', '')";
const cidDe = (alias: string) => CID.replace('%s', alias);

/** Situação do modelo → a do contrato. */
const SITUACAO_CONTRATO: Record<string, string> = {
  rascunho: 'aberto',
  notificada: 'notificado',
  enviada: 'notificado',
  confirmada: 'notificado',
  descartada: 'descartado',
  cancelada: 'descartado',
};
/** Situação do contrato → as do modelo (o filtro da fila). */
const SITUACOES_BANCO: Record<string, readonly string[]> = {
  aberto: ['rascunho'],
  notificado: ['notificada', 'enviada', 'confirmada'],
  descartado: ['descartada', 'cancelada'],
};

const comSegundos = (t: string) => paraBanco(t.length === 16 ? `${t}:00` : t);
const maiusculo = (v: string) => v.toUpperCase();

const SQL_CASO = `
  SELECT na.id, na.origem_gatilho, na.chave_gatilho, na.atendimento_id, na.paciente_id, na.periodicidade,
         na.gatilho_em, na.prazo_envio_em, na.agravo_notificavel_id, na.situacao, na.observacao, na.autoridade, na.canal,
         na.numero_notificacao, na.notificada_em, na.recebido_por, na.observacao_notificacao, na.motivo_descarte,
         na.justificativa_descarte, na.criado_em, na.encerrado_em, na.versao, ${cidDe('t')} AS cid,
         ua.login AS aberto_por, ue.login AS encerrado_por
    FROM notificacao_agravo na
    LEFT JOIN termo_terminologia t ON t.id = na.cid_termo_terminologia_id
    LEFT JOIN usuario ua ON ua.id = na.criado_por
    LEFT JOIN usuario ue ON ue.id = na.encerrado_por_usuario_id
   WHERE na.estabelecimento_id = ? AND na.excluido_em IS NULL`;

/** O item de exame do caso, pela chave do gatilho (`exame:<item>:<cid>`). */
function exameDaChave(origem: string, chave: string | null): number | null {
  if (origem !== 'exame' || !chave) return null;
  const m = /^exame:(\d+):/.exec(chave);
  return m ? Number(m[1]) : null;
}

function casoDe(r: Linha): CasoAgravoRegistrado {
  const origem = texto(r['origem_gatilho']);
  const chave = textoN(r['chave_gatilho']);
  const autoridade = textoN(r['autoridade']);
  return {
    id: n(r['id']),
    origem,
    chaveGatilho: chave,
    atendimento: nn(r['atendimento_id']),
    exame: exameDaChave(origem, chave),
    paciente: n(r['paciente_id']),
    cid: texto(r['cid']),
    periodicidade: texto(r['periodicidade']),
    gatilhoEm: instante(r['gatilho_em'] ?? r['criado_em']),
    prazoEm: instante(r['prazo_envio_em'] ?? r['gatilho_em'] ?? r['criado_em']),
    fichaModelo: nn(r['agravo_notificavel_id']),
    situacao: SITUACAO_CONTRATO[texto(r['situacao'])] ?? texto(r['situacao']),
    observacao: textoN(r['observacao']),
    autoridade: autoridade === null ? null : maiusculo(autoridade),
    canal: textoN(r['canal']),
    numero: textoN(r['numero_notificacao']),
    notificadoEm: instanteN(r['notificada_em']),
    recebidoPor: textoN(r['recebido_por']),
    observacaoNotificacao: textoN(r['observacao_notificacao']),
    motivoDescarte: textoN(r['motivo_descarte']),
    justificativa: textoN(r['justificativa_descarte']),
    abertoPor: texto(r['aberto_por']),
    abertoEm: instante(r['criado_em']),
    encerradoPor: textoN(r['encerrado_por']),
    encerradoEm: instanteN(r['encerrado_em']),
    versao: n(r['versao']),
  };
}

/** Os CIDs (sem ponto) registrados em cada atendimento: os diagnósticos não inativados e os CIDs principal e secundário. */
async function cidsDosAtendimentos(l: L, est: number, ids: readonly number[]): Promise<Map<number, string[]>> {
  const r = new Map<number, string[]>();
  const unicos = [...new Set(ids)];
  if (!unicos.length) return r;
  const linhas = await l.consultar(
    `SELECT x.atendimento_id, x.cid FROM (
       SELECT d.atendimento_id, ${cidDe('t')} AS cid, d.diagnosticado_em AS em
         FROM diagnostico_atendimento d JOIN termo_terminologia t ON t.id = d.cid_termo_terminologia_id
        WHERE d.estabelecimento_id = ? AND d.atendimento_id IN (${marcas(unicos.length)})
          AND d.excluido_em IS NULL AND d.situacao <> 'inativado'
       UNION ALL
       SELECT a.id, ${cidDe('t')}, a.entrada_em FROM atendimento a JOIN termo_terminologia t
           ON t.id IN (a.cid_principal_termo_terminologia_id, a.cid_secundario_termo_terminologia_id)
        WHERE a.estabelecimento_id = ? AND a.id IN (${marcas(unicos.length)}) AND a.excluido_em IS NULL
     ) x ORDER BY x.atendimento_id, x.em`,
    [est, ...unicos, est, ...unicos],
    { teto: 10_000 },
  );
  for (const x of linhas) {
    const id = n(x['atendimento_id']);
    const lista = r.get(id) ?? [];
    const cid = texto(x['cid']);
    if (cid && !lista.includes(cid)) lista.push(cid);
    r.set(id, lista);
  }
  return r;
}

/** Os textos de cada resultado liberado (o texto livre, a conclusão e o valor de cada analito), por item de exame. */
async function textosDosResultados(l: L, itens: readonly number[]): Promise<Map<number, { textos: string[]; em: string; id: number }[]>> {
  const r = new Map<number, { textos: string[]; em: string; id: number }[]>();
  if (!itens.length) return r;
  const linhas = await l.consultar(
    `SELECT r.id, r.exame_item_id, r.liberado_em, r.texto_resultado, r.conclusao,
            (SELECT GROUP_CONCAT(COALESCE(ra.valor_texto, CAST(ra.valor_numerico AS CHAR)) ORDER BY ra.sequencia SEPARATOR '\\n')
               FROM resultado_analito ra WHERE ra.resultado_exame_id = r.id AND ra.excluido_em IS NULL) AS analitos
       FROM resultado_exame r
      WHERE r.exame_item_id IN (${marcas(itens.length)}) AND r.excluido_em IS NULL AND r.situacao = 'liberado'
      ORDER BY r.exame_item_id, r.liberado_em, r.id`,
    [...itens],
    { teto: 10_000 },
  );
  for (const x of linhas) {
    const textos = [
      ...texto(x['analitos']).split('\n'),
      texto(x['texto_resultado']),
      texto(x['conclusao']),
    ]
      .map((t) => t.trim().slice(0, 500))
      .filter((t) => t !== '');
    const item = n(x['exame_item_id']);
    const lista = r.get(item) ?? [];
    lista.push({ textos, em: instante(x['liberado_em']), id: n(x['id']) });
    r.set(item, lista);
  }
  return r;
}

/** O id do termo da CID-10 pelo código (com ou sem ponto); null: não existe na terminologia. */
async function termoDoCid(l: L, cid: string): Promise<{ id: number; nome: string } | null> {
  const r = await l.uma(
    `SELECT t.id, t.descricao FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
      WHERE g.codigo = 'cid10' AND ${cidDe('t')} = ? ORDER BY t.ativo DESC, t.id LIMIT 1`,
    [cid.replace('.', '')],
  );
  return r ? { id: n(r['id']), nome: texto(r['descricao']) } : null;
}

export class PortaAgravoPropria implements PortaAgravo {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoQualidade,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoAgravo, fn: (l: L, est: number) => Promise<T>): Promise<T> {
    return lerNoEstabelecimento(this.nucleo, c, fn);
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  /** A notificação compulsória grava direto, pela própria tela (a liberação é a da chave de permissão). */
  podeGravar() {
    return Promise.resolve({ pode: true, codigo: null, motivo: null });
  }

  executar(_c: ContextoAgravo, op: string): Promise<GravacaoFeita> {
    return Promise.reject(recusa('operacao-desconhecida', `Operação ${op} sem receita do executor na notificação compulsória.`));
  }

  gravarSgh<T>(
    c: ContextoAgravo,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorAgravo) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'qualidade.agravo',
      tabelas: TABELAS_AGRAVO,
      trilha,
      gravador: (tx, est) => this.gravador(tx, est),
      fn,
    });
  }

  /** Trava o caso aberto e confere a versão vista (outra pessoa agiu nele: recusa). */
  private async travarAberto(tx: TxOperacao, est: number, id: number, versao: number): Promise<void> {
    const [r] = await tx.consultarParaAtualizar(
      'SELECT versao, situacao FROM notificacao_agravo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
      { teto: 1 },
    );
    if (!r) throw new ErroOperacao(404, 'nao-encontrado', 'Caso não encontrado', 'O caso não existe neste estabelecimento.');
    if (n(r['versao']) !== versao || texto(r['situacao']) !== 'rascunho') throw recusaVersaoAgravo();
  }

  private gravador(tx: TxOperacao, est: number): GravadorAgravo {
    return {
      abrirCaso: async (x) => {
        if (x.chaveGatilho) {
          const ja = await tx.uma('SELECT id FROM notificacao_agravo WHERE estabelecimento_id = ? AND chave_gatilho = ?', [est, x.chaveGatilho]);
          if (ja) throw recusa('caso-ja-aberto', 'Este gatilho já virou caso (outra pessoa da vigilância abriu): recarregue a fila.');
        }
        const paciente = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [x.paciente]);
        if (!paciente) throw recusa('paciente-inexistente', 'O paciente informado não existe neste cliente.');
        if (x.atendimento !== null) {
          const a = await tx.uma('SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL', [x.atendimento, est]);
          if (!a) throw recusa('atendimento-inexistente', 'O atendimento não é deste estabelecimento.');
          if (n(a['paciente_id']) !== x.paciente) throw recusa('atendimento-de-outro-paciente', 'O atendimento é de outro paciente.');
        }
        let exameCatalogo: number | null = null;
        if (x.exame !== null) {
          const e = await tx.uma(
            `SELECT ei.exame_id, rq.paciente_id FROM exame_item ei JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id
              WHERE ei.id = ? AND rq.estabelecimento_id = ? AND ei.excluido_em IS NULL`,
            [x.exame, est],
          );
          if (!e || n(e['paciente_id']) !== x.paciente) throw recusa('exame-de-outro-paciente', 'O exame não é deste paciente neste estabelecimento.');
          exameCatalogo = n(e['exame_id']);
        }
        const termo = await termoDoCid(tx, x.cid);
        if (!termo) throw recusa('cid-inexistente', 'O CID informado não existe na CID-10 do cliente.');
        const agravo = await this.agravoDoCaso(tx, x.fichaModelo, x.cid);
        try {
          const id = await tx.incluir('notificacao_agravo', {
            estabelecimento_id: est,
            paciente_id: x.paciente,
            atendimento_id: x.atendimento,
            agravo_notificavel_id: agravo.id,
            tipo_notificacao_agravo_id: agravo.tipo,
            cid_termo_terminologia_id: termo.id,
            data_notificacao: x.agora.slice(0, 10),
            prazo_envio_em: comSegundos(x.prazoEm),
            situacao: 'rascunho',
            observacao: x.observacao,
            origem_gatilho: x.origem,
            chave_gatilho: x.chaveGatilho,
            exame_id: exameCatalogo,
            periodicidade: x.periodicidade,
            gatilho_em: comSegundos(x.gatilhoEm),
          });
          return { id };
        } catch (e) {
          if ((e as { errno?: unknown } | null)?.errno === ERRNO_DUPLICADO)
            throw recusa('caso-ja-aberto', 'Este gatilho já virou caso (outra pessoa da vigilância abriu): recarregue a fila.');
          throw e;
        }
      },
      registrarNotificacao: async (r) => {
        await this.travarAberto(tx, est, r.id, r.versao);
        const usuario = await exigirUsuario(tx, r.usuario);
        if (r.numero) {
          const dup = await tx.uma('SELECT id FROM notificacao_agravo WHERE estabelecimento_id = ? AND numero_notificacao = ? AND id <> ?', [est, r.numero, r.id]);
          if (dup) throw recusa('numero-duplicado', 'Este número de notificação já foi registrado em outro caso deste estabelecimento.');
        }
        const versao = await tx.alterar('notificacao_agravo', r.id, r.versao, {
          situacao: 'notificada',
          autoridade: r.autoridade.toLowerCase(),
          canal: r.canal,
          numero_notificacao: r.numero,
          notificada_em: comSegundos(r.notificadoEm),
          data_notificacao: r.notificadoEm.slice(0, 10),
          recebido_por: r.recebidoPor,
          observacao_notificacao: r.observacao,
          encerrado_em: comSegundos(r.agora),
          encerrado_por_usuario_id: usuario,
        });
        return { versao };
      },
      descartarCaso: async (r) => {
        await this.travarAberto(tx, est, r.id, r.versao);
        const usuario = await exigirUsuario(tx, r.usuario);
        const versao = await tx.alterar('notificacao_agravo', r.id, r.versao, {
          situacao: 'descartada',
          motivo_descarte: r.motivo.slice(0, 40),
          justificativa_descarte: r.justificativa,
          encerrado_em: comSegundos(r.agora),
          encerrado_por_usuario_id: usuario,
        });
        return { versao };
      },
      configurarGatilhoExame: async (g) => {
        await exigirUsuario(tx, g.usuario);
        const dup = await tx.uma(
          `SELECT id FROM gatilho_exame_agravo
            WHERE estabelecimento_id = ? AND padrao = ? AND codigo_cid10 = ? AND excluido_em IS NULL AND id <> ?`,
          [est, g.padrao, g.cid, g.id ?? 0],
        );
        if (dup) throw recusa('gatilho-duplicado', 'Já existe gatilho com este padrão de exame para o mesmo CID.');
        const valores = { padrao: g.padrao, exceto: g.exceto, codigo_cid10: g.cid, ativo: g.ativo };
        if (g.id === null) {
          const id = await tx.incluir('gatilho_exame_agravo', { estabelecimento_id: est, ...valores });
          return { id, versao: 1, criado: true };
        }
        const [atual] = await tx.consultarParaAtualizar(
          'SELECT versao FROM gatilho_exame_agravo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [g.id, est],
          { teto: 1 },
        );
        if (!atual || n(atual['versao']) !== g.versao)
          throw recusa(
            'versao-desatualizada',
            'O gatilho mudou desde que você abriu a tela (outra pessoa da vigilância alterou): recarregue e confira.',
          );
        const versao = await tx.alterar('gatilho_exame_agravo', g.id, n(atual['versao']), valores);
        return { id: g.id, versao, criado: false };
      },
    };
  }

  /** O agravo do caso: o da ficha escolhida ou, sem ela, o do cadastro cujo CID casa (o mais específico). */
  private async agravoDoCaso(tx: TxOperacao, ficha: number | null, cid: string): Promise<{ id: number; tipo: number | null }> {
    const r =
      ficha !== null
        ? await tx.uma('SELECT id, tipo_notificacao_agravo_id FROM agravo_notificavel WHERE id = ? AND ativo = TRUE', [ficha])
        : await tx.uma(
            `SELECT a.id, a.tipo_notificacao_agravo_id FROM agravo_notificavel a
               JOIN agravo_notificavel_cid c ON c.agravo_notificavel_id = a.id AND c.excluido_em IS NULL
              WHERE a.ativo = TRUE AND ? LIKE CONCAT(REPLACE(c.codigo_cid10, '.', ''), '%')
              ORDER BY LENGTH(c.codigo_cid10) DESC, a.id LIMIT 1`,
            [cid],
          );
    if (!r) throw recusa('agravo-nao-cadastrado', 'O CID não tem agravo notificável ativo no cadastro deste cliente.');
    return { id: n(r['id']), tipo: nn(r['tipo_notificacao_agravo_id']) };
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoAgravo) {
    return this.ler(c, (l, est) => relogioDoEstabelecimento(l, est));
  }

  /** O cadastro de CID notificável: os CIDs dos agravos ativos (2 imediata: até 24 horas; 1 semanal). */
  cidsNotificaveis(c: ContextoAgravo): Promise<CidNotificavelCadastro[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT REPLACE(ac.codigo_cid10, '.', '') AS cid, a.descricao, pn.codigo AS periodicidade,
                COALESCE(a.prazo_horas, pn.prazo_horas) AS prazo,
                (SELECT t.descricao FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
                  WHERE g.codigo = 'cid10' AND ${cidDe('t')} = REPLACE(ac.codigo_cid10, '.', '') LIMIT 1) AS nome_cid
           FROM agravo_notificavel_cid ac
           JOIN agravo_notificavel a ON a.id = ac.agravo_notificavel_id AND a.ativo = TRUE
           LEFT JOIN periodicidade_notificacao pn ON pn.id = a.periodicidade_notificacao_id
          WHERE ac.excluido_em IS NULL
          ORDER BY cid, a.id`,
        [],
        { teto: 10_000 },
      );
      const porCid = new Map<string, CidNotificavelCadastro>();
      for (const r of linhas) {
        const prazo = nn(r['prazo']);
        const imediata = texto(r['periodicidade']).startsWith('imediat') || (prazo !== null && prazo <= 24);
        const cid = texto(r['cid']);
        const atual = porCid.get(cid);
        if (atual && atual.codigoCadastro === 2) continue;
        porCid.set(cid, { cid, nome: textoN(r['nome_cid']) ?? texto(r['descricao']), codigoCadastro: imediata ? 2 : 1 });
      }
      return [...porCid.values()];
    });
  }

  cidDoCadastro(c: ContextoAgravo, cid: string) {
    return this.ler(c, async (l) => {
      const termo = await termoDoCid(l, cid);
      if (!termo) return null;
      const cad = (await this.cidsNotificaveis(c)).find((x) => x.cid === cid.replace('.', ''));
      return { cid: cid.replace('.', ''), nome: termo.nome, codigoCadastro: cad?.codigoCadastro ?? 0 };
    });
  }

  atendimentosComCid(c: ContextoAgravo, desde: string) {
    return this.ler(c, async (l, est) => {
      const casa = `EXISTS (SELECT 1 FROM agravo_notificavel_cid ac JOIN agravo_notificavel a ON a.id = ac.agravo_notificavel_id AND a.ativo = TRUE
                     WHERE ac.excluido_em IS NULL AND ${cidDe('t')} LIKE CONCAT(REPLACE(ac.codigo_cid10, '.', ''), '%'))`;
      const linhas = await l.consultar(
        `SELECT atendimento_id, paciente_id, cid, MIN(em) AS em FROM (
           SELECT d.atendimento_id, d.paciente_id, ${cidDe('t')} AS cid, d.diagnosticado_em AS em
             FROM diagnostico_atendimento d JOIN termo_terminologia t ON t.id = d.cid_termo_terminologia_id
            WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao <> 'inativado' AND d.diagnosticado_em >= ? AND ${casa}
           UNION ALL
           SELECT a.id, a.paciente_id, ${cidDe('t')}, a.entrada_em FROM atendimento a JOIN termo_terminologia t
               ON t.id IN (a.cid_principal_termo_terminologia_id, a.cid_secundario_termo_terminologia_id)
            WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.entrada_em >= ? AND ${casa}
         ) x GROUP BY atendimento_id, paciente_id, cid ORDER BY em, atendimento_id`,
        [est, paraBanco(desde), est, paraBanco(desde)],
        { teto: TETO_FILA + 1 },
      );
      const itens = linhas.slice(0, TETO_FILA).map((r) => ({
        atendimento: n(r['atendimento_id']),
        paciente: n(r['paciente_id']),
        unidade: est,
        cid: texto(r['cid']),
        registradoEm: instante(r['em']),
      }));
      return { itens, cortado: linhas.length > TETO_FILA };
    });
  }

  obitos(c: ContextoAgravo, desde: string) {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT atendimento_id, paciente_id, MIN(obito_em) AS obito_em FROM declaracao_obito
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada' AND obito_em >= ?
          GROUP BY atendimento_id, paciente_id ORDER BY obito_em`,
        [est, paraBanco(desde)],
        { teto: TETO_FILA },
      );
      const cids = await cidsDosAtendimentos(l, est, linhas.map((r) => n(r['atendimento_id'])));
      return linhas.map((r) => ({
        atendimento: n(r['atendimento_id']),
        paciente: n(r['paciente_id']),
        unidade: est,
        cids: cids.get(n(r['atendimento_id'])) ?? [],
        obitoEm: instante(r['obito_em']),
      }));
    });
  }

  resultados(c: ContextoAgravo, desde: string, padroes: readonly string[], termos: readonly string[]) {
    return this.ler(c, async (l, est) => {
      if (!padroes.length) return { itens: [], cortado: false };
      const linhas = await l.consultar(
        `SELECT DISTINCT ei.id, rq.atendimento_id, rq.paciente_id, ex.nome
           FROM resultado_exame r
           JOIN exame_item ei ON ei.id = r.exame_item_id AND ei.excluido_em IS NULL
           JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id
           JOIN exame ex ON ex.id = ei.exame_id
          WHERE rq.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.situacao = 'liberado' AND r.liberado_em >= ?
            AND (${padroes.map(() => "UPPER(ex.nome) LIKE CONCAT('%', ?, '%')").join(' OR ')})
          ORDER BY ei.id`,
        [est, paraBanco(desde), ...padroes.map(maiusculo)],
        { teto: TETO_FILA + 1 },
      );
      const cortado = linhas.length > TETO_FILA;
      const base = linhas.slice(0, TETO_FILA);
      const textos = await textosDosResultados(l, base.map((r) => n(r['id'])));
      const alvo = termos.map(maiusculo);
      const itens = base.flatMap((r) =>
        (textos.get(n(r['id'])) ?? [])
          .filter((x) => x.em >= desde.slice(0, 19))
          .flatMap((x) =>
            x.textos
              .filter((t) => !alvo.length || alvo.some((a) => maiusculo(t).includes(a)))
              .map((resultado) => ({
                exame: n(r['id']),
                atendimento: n(r['atendimento_id']),
                paciente: n(r['paciente_id']),
                unidade: est,
                nomeExame: texto(r['nome']),
                resultado,
                liberadoEm: x.em,
              })),
          ),
      );
      return { itens, cortado };
    });
  }

  atendimento(c: ContextoAgravo, id: number): Promise<AtendimentoParaAgravo | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT a.id, a.paciente_id, a.entrada_em,
                (SELECT MIN(d.obito_em) FROM declaracao_obito d
                  WHERE d.atendimento_id = a.id AND d.excluido_em IS NULL AND d.situacao <> 'cancelada') AS obito_em
           FROM atendimento a WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [id, est],
      );
      if (!r) return null;
      const cids = await cidsDosAtendimentos(l, est, [id]);
      return {
        atendimento: id,
        paciente: n(r['paciente_id']),
        unidade: est,
        entrada: instanteN(r['entrada_em']),
        cids: cids.get(id) ?? [],
        obitoEm: instanteN(r['obito_em']),
      };
    });
  }

  declaracaoObito(c: ContextoAgravo, atendimento: number): Promise<string | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT numero FROM declaracao_obito
          WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'
          ORDER BY obito_em LIMIT 1`,
        [atendimento, est],
      );
      return r ? textoN(r['numero']) : null;
    });
  }

  exame(c: ContextoAgravo, id: number): Promise<ExameParaAgravo | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT ei.id, rq.atendimento_id, rq.paciente_id, ex.nome FROM exame_item ei
           JOIN requisicao_exame rq ON rq.id = ei.requisicao_exame_id JOIN exame ex ON ex.id = ei.exame_id
          WHERE ei.id = ? AND rq.estabelecimento_id = ? AND ei.excluido_em IS NULL`,
        [id, est],
      );
      if (!r) return null;
      const res = (await textosDosResultados(l, [id])).get(id) ?? [];
      return {
        exame: id,
        atendimento: nn(r['atendimento_id']),
        paciente: nn(r['paciente_id']),
        nomeExame: texto(r['nome']),
        liberado: res.length > 0,
        resultados: res.flatMap((x) => x.textos),
      };
    });
  }

  pacientes(c: ContextoAgravo, ids: readonly number[]): Promise<Map<number, PacienteDoAgravo>> {
    return this.ler(c, async (l) => {
      const r = new Map<number, PacienteDoAgravo>();
      const unicos = [...new Set(ids)];
      if (!unicos.length) return r;
      const linhas = await l.consultar(
        `SELECT p.id, pf.nome, p.numero_prontuario, pf.data_nascimento, sx.sigla, COALESCE(p.nome_mae, pf.nome_mae) AS mae, pf.cns
           FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN sexo sx ON sx.id = pf.sexo_id
          WHERE p.id IN (${marcas(unicos.length)}) AND p.excluido_em IS NULL`,
        unicos,
        { teto: unicos.length },
      );
      for (const x of linhas) {
        const prontuario = Number(texto(x['numero_prontuario']));
        const sexo = texto(x['sigla']);
        r.set(n(x['id']), {
          id: n(x['id']),
          nome: texto(x['nome']),
          prontuario: Number.isFinite(prontuario) && texto(x['numero_prontuario']) !== '' ? prontuario : null,
          nascimento: dataIso(x['data_nascimento']),
          sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
          mae: textoN(x['mae']),
          cns: textoN(x['cns']),
        });
      }
      return r;
    });
  }

  unidades(c: ContextoAgravo): Promise<Map<number, UnidadeDoAgravo>> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT e.id, e.nome_fantasia, e.codigo_cnes, m.nome AS cidade, uf.sigla AS uf FROM estabelecimento e
           LEFT JOIN municipio_ibge m ON m.id = e.municipio_ibge_id
           LEFT JOIN unidade_federativa uf ON uf.id = m.unidade_federativa_id
          WHERE e.id = ?`,
        [est],
      );
      const mapa = new Map<number, UnidadeDoAgravo>();
      if (r)
        mapa.set(est, {
          codigo: est,
          nome: texto(r['nome_fantasia']),
          cnes: textoN(r['codigo_cnes']),
          cidade: textoN(r['cidade']),
          uf: textoN(r['uf']),
        });
      return mapa;
    });
  }

  /** Os modelos de ficha: os agravos ativos que exigem ficha, nomeados pelos CIDs (ou pela descrição, sem CID). */
  modelosFicha(c: ContextoAgravo): Promise<{ id: number; nome: string }[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT a.id, a.descricao,
                GROUP_CONCAT(REPLACE(ac.codigo_cid10, '.', '') ORDER BY ac.codigo_cid10 SEPARATOR '/') AS cids
           FROM agravo_notificavel a
           LEFT JOIN agravo_notificavel_cid ac ON ac.agravo_notificavel_id = a.id AND ac.excluido_em IS NULL
          WHERE a.ativo = TRUE AND a.exige_ficha = TRUE
          GROUP BY a.id, a.descricao ORDER BY a.id`,
        [],
        { teto: 5000 },
      );
      return linhas.map((r) => ({ id: n(r['id']), nome: textoN(r['cids']) ?? texto(r['descricao']) }));
    });
  }

  perguntasFicha(c: ContextoAgravo, modelo: number): Promise<{ codigo: number; subcodigo: number; texto: string }[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT sequencia, codigo_campo, subcodigo, enunciado FROM agravo_pergunta
          WHERE agravo_notificavel_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY sequencia, id`,
        [modelo],
        { teto: 2000 },
      );
      return linhas.map((r) => {
        const campo = texto(r['codigo_campo']);
        return { codigo: /^\d+$/.test(campo) ? Number(campo) : n(r['sequencia']), subcodigo: n(r['subcodigo']), texto: texto(r['enunciado']) };
      });
    });
  }

  caso(c: ContextoAgravo, id: number): Promise<CasoAgravoRegistrado | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_CASO} AND na.id = ?`, [est, id]);
      return r ? casoDe(r) : null;
    });
  }

  casos(c: ContextoAgravo, f: FiltroCasosAgravo): Promise<{ itens: CasoAgravoRegistrado[]; total: number }> {
    return this.ler(c, async (l, est) => {
      const onde: string[] = [];
      const p: unknown[] = [est];
      if (f.situacao) {
        const s = SITUACOES_BANCO[f.situacao] ?? [f.situacao];
        onde.push(`na.situacao IN (${marcas(s.length)})`);
        p.push(...s);
      }
      if (f.periodicidade) {
        onde.push('na.periodicidade = ?');
        p.push(f.periodicidade);
      }
      if (f.desde) {
        onde.push('COALESCE(na.gatilho_em, na.criado_em) >= ?');
        p.push(paraBanco(f.desde));
      }
      if (f.ate) {
        onde.push('COALESCE(na.gatilho_em, na.criado_em) < ?');
        p.push(paraBanco(f.ate));
      }
      const filtro = onde.map((x) => ` AND ${x}`).join('');
      const total = await l.uma(`SELECT COUNT(*) AS q FROM notificacao_agravo na WHERE na.estabelecimento_id = ? AND na.excluido_em IS NULL${filtro}`, p);
      const linhas = await l.consultar(
        `${SQL_CASO}${filtro}
          ORDER BY na.situacao <> 'rascunho', CASE WHEN na.situacao = 'rascunho' THEN na.prazo_envio_em END,
                   COALESCE(na.gatilho_em, na.criado_em) DESC, na.id DESC
          LIMIT ? OFFSET ?`,
        [...p, f.porPagina, (f.pagina - 1) * f.porPagina],
        { teto: f.porPagina },
      );
      return { itens: linhas.map(casoDe), total: n(total?.['q']) };
    });
  }

  casosDesde(c: ContextoAgravo, desde: string) {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(`${SQL_CASO} AND COALESCE(na.gatilho_em, na.criado_em) >= ? ORDER BY na.id`, [est, paraBanco(desde)], {
        teto: 20_000,
      });
      return linhas.map(casoDe).map((x) => ({
        origem: x.origem,
        atendimento: x.atendimento,
        exame: x.exame,
        paciente: x.paciente,
        cid: x.cid,
        situacao: x.situacao,
        gatilhoEm: x.gatilhoEm,
      }));
    });
  }

  contagem(c: ContextoAgravo, agora: string, inicioDoMes: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT SUM(situacao = 'rascunho') AS abertos,
                SUM(situacao = 'rascunho' AND periodicidade = 'imediata') AS imediatos,
                SUM(situacao = 'rascunho' AND prazo_envio_em < ?) AS vencidos,
                SUM(situacao = 'notificada' AND notificada_em >= ?) AS notificados
           FROM notificacao_agravo WHERE estabelecimento_id = ? AND excluido_em IS NULL`,
        [paraBanco(agora), paraBanco(inicioDoMes), est],
      );
      return {
        abertos: n(r?.['abertos']),
        imediatosAbertos: n(r?.['imediatos']),
        vencidos: n(r?.['vencidos']),
        notificadosNoMes: n(r?.['notificados']),
      };
    });
  }

  gatilhosExame(c: ContextoAgravo): Promise<GatilhoExameRegistrado[]> {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT id, padrao, exceto, codigo_cid10, ativo, versao FROM gatilho_exame_agravo
          WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY padrao, id`,
        [est],
        { teto: 2000 },
      );
      return linhas.map((r) => ({
        id: n(r['id']),
        padrao: texto(r['padrao']),
        exceto: textoN(r['exceto']),
        cid: texto(r['codigo_cid10']),
        ativo: verdadeiro(r['ativo']),
        versao: n(r['versao']),
      }));
    });
  }
}
