// Porta das especialidades sob demanda e do lactário sobre o banco do cliente (M45, etapa 6), pelo @sgh/nucleo:
// leituras somente leitura (internação, leito, vínculo profissional, cadastros, prescrições, partograma e nascimentos)
// e as gravações das telas por uma operação do Executor (trilha, outbox e idempotência na mesma transação). Toda
// leitura filtra o estabelecimento da sessão e os registros excluídos; os cadastros de tipos (exames oftalmológicos,
// tipos de protocolo e de parto) são da rede inteira (não têm estabelecimento).
// Melhoria: o partograma grava no modelo próprio (partograma aberto por atendimento + registro horário numerado), com
// as faixas conferidas pelo banco (CHECK); os alertas de cada registro são recalculados na leitura pelo mesmo caminho
// da gravação (os do ponto e os das linhas de alerta e de ação sobre os registros anteriores, com a fase ativa do
// parâmetro do estabelecimento), e as classificações do recém-nascido pelo domínio só quando o valor existe (peso,
// Apgar ou idade gestacional nulos dão classificação null, nunca a de um zero); horas no fuso do estabelecimento; o vínculo do login vem do
// cadastro (usuario_vinculo_profissional + profissional_ocupacao), não de uma consulta por login em texto.
// F2.4: o recém-nascido grava e lê a reanimação e a observação (registro_nascimento); a ordem do lactário é um preparo
// por paciente (preparo_lactario, com a fórmula do cadastro e o manipulador do cadastro de colaboradores) e uma porção
// por horário (preparo_lactario_item), com a conferência por outra pessoa, o cancelamento, a etiqueta e o histórico
// (preparo_lactario_evento); a acuidade visual e a graduação vêm dos cadastros.
// O exame oftalmológico consolidado grava e lê em exame_oftalmologico (tipo nulo), exame_oftalmologico_valor e
// exame_oftalmologico_item.
// A oncologia (protocolo versionado, ciclo no tratamento oncológico, validação, ligação com a prescrição e eventos)
// lê e grava pelo adaptador próprio (oncologia-propria.ts, C2-090).
import { randomUUID } from 'node:crypto';
import type { CicloDependente, LadoExame, LiquidoAmniotico } from '@sgh/contratos';
import {
  alertasDoRegistro,
  classificarApgar,
  classificarIdadeGestacional,
  classificarPesoAoNascer,
  linhasDoPartograma,
  posicaoNasLinhas,
} from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaM18,
  type GravacaoFeita,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../exames/public-api.js';
import { civil, FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../exames/relogio.js';
import * as onco from './oncologia-propria.js';
import {
  type ContextoEspecialidades,
  FASE_ATIVA_CM_PADRAO,
  type GravadorEspecialidades,
  type InternacaoDaBusca,
  METODOS_PORTA_ESPECIALIDADES,
  type PortaEspecialidades,
  type VinculoDoLogin,
} from './porta.js';
import type {
  AlteracaoLactarioRegistrada,
  CadastrosOftalmologia,
  ConteudoOrdemLactario,
  InternacaoEspecialidadeLida,
  NovaAlteracaoLactario,
  NovaOrdemLactario,
  NovoPontoPartograma,
  NovoRecemNascido,
  OrdemLactarioAnterior,
  OrdemLactarioRegistrada,
  PontoPartograma,
  PrescricaoDoCiclo,
  RecemNascidoRegistrado,
  ExameOftalmologicoRegistrado,
  MedidasOlho,
  NovoExameOftalmologico,
} from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoEspecialidades = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));

/** Teto das buscas de internação (a tela pede refinar a busca). */
export const TETO_INTERNACOES = 50;

/** Tabelas que a gravação direta das especialidades pode gravar (o Executor recusa as outras). */
const TABELAS_GRAVACAO = [
  'partograma',
  'partograma_registro',
  'registro_nascimento',
  'preparo_lactario',
  'preparo_lactario_item',
  'preparo_lactario_evento',
  'exame_oftalmologico',
  'exame_oftalmologico_valor',
  'exame_oftalmologico_item',
  // As tabelas da oncologia (as mesmas de onco.TABELAS_ONCOLOGIA), literais para o gerador de privilégios.
  'protocolo_quimioterapia',
  'tratamento_oncologico',
  'ciclo_quimioterapia',
  'ciclo_quimioterapia_prescricao',
  'evento_tratamento_oncologico',
] as const;

/** Evento do histórico do lactário (tela) ↔ evento do modelo. */
const EVENTO_LACTARIO = {
  alterada: 'alterado',
  cancelada: 'cancelado',
  'etiqueta-emitida': 'etiqueta_emitida',
} as const;
const EVENTO_LACTARIO_LIDO: Readonly<Record<string, AlteracaoLactarioRegistrada['evento']>> = {
  alterado: 'alterada',
  cancelado: 'cancelada',
  etiqueta_emitida: 'etiqueta-emitida',
};
/** O histórico guarda o texto da tela como literal JSON (sem perda); a leitura devolve o texto. */
const jsonDoTexto = (v: string | null) => (v === null ? null : JSON.stringify(v));
function textoDoJson(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v);
  try {
    const x = JSON.parse(t) as unknown;
    return typeof x === 'string' ? x : t;
  } catch {
    return t;
  }
}

/** Instante → "AAAA-MM-DDTHH:MM" no fuso do estabelecimento. */
function minutoCivil(v: unknown, fuso: string): string {
  const d = v instanceof Date ? v : new Date(String(v));
  const c = civil(d, fuso);
  return `${c.data}T${c.hora}`;
}
/** "AAAA-MM-DDTHH:MM" no fuso do estabelecimento → instante. */
function deMinutoCivil(v: string, fuso: string): Date {
  return instanteCivil(v.slice(0, 10), `${v.slice(11, 13)}${v.slice(14, 16)}`, fuso);
}
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;

/** A recusa das gravações que esperam o modelo do banco (pedidos do lote 02-06). */
export function pendenteModelo(oQue: string): ErroOperacao {
  return new ErroOperacao(
    409,
    'modelo-pendente',
    'Gravação indisponível',
    `${oQue} aguarda a estrutura própria no modelo do banco: nada foi gravado.`,
  );
}

/** Líquido amniótico: o modelo distingue o meconial fluido do espesso; a tela ainda tem um só "meconial". */
const LIQUIDO_DO_MODELO: Readonly<Record<LiquidoAmniotico, string>> = {
  claro: 'claro',
  meconial: 'meconial_fluido',
  sanguinolento: 'sanguinolento',
  ausente: 'ausente',
};
/**
 * Os alertas de um registro do partograma pelo mesmo caminho da gravação (conferirPartograma do domínio, sem as
 * conferências de entrada): os do ponto e, com a dilatação, a posição nas linhas de alerta e de ação calculadas sobre
 * os registros anteriores mais este.
 */
function alertasDoPonto(
  e: Parameters<typeof alertasDoRegistro>[0],
  anteriores: readonly { em: string; dilatacaoCm: number | null }[],
  faseAtivaCm: number,
): string[] {
  const alertas = alertasDoRegistro(e);
  if (e.dilatacaoCm !== null) {
    const linhas = linhasDoPartograma([...anteriores, { em: e.em, dilatacaoCm: e.dilatacaoCm }], faseAtivaCm);
    const pos = posicaoNasLinhas(linhas, e.em, e.dilatacaoCm);
    if (pos === 'alerta')
      alertas.push('Dilatação à direita da linha de alerta: reavaliar a evolução do trabalho de parto.');
    if (pos === 'acao') alertas.push('Dilatação além da linha de ação: conduta médica imediata.');
  }
  return alertas;
}

function liquidoDaTela(v: unknown): LiquidoAmniotico | null {
  const s = textoOuNulo(v);
  if (s === null) return null;
  return s.startsWith('meconial') ? 'meconial' : (s as LiquidoAmniotico);
}

const SQL_INTERNACAO = `
  SELECT i.id, i.paciente_id, i.atendimento_id, i.data_hora_entrada, i.situacao, p.numero_prontuario,
         COALESCE(NULLIF(p.nome_social, ''), pf.nome) AS nome, pf.data_nascimento, sx.sigla AS sexo,
         b.codigo AS bloco, ac.codigo AS acomodacao, lh.codigo AS leito
    FROM internacao i
    JOIN paciente p ON p.id = i.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN sexo sx ON sx.id = pf.sexo_id
    LEFT JOIN ocupacao_leito ol ON ol.internacao_vigente_id = i.id AND ol.excluido_em IS NULL
    LEFT JOIN leito_hospitalar lh ON lh.id = COALESCE(ol.leito_hospitalar_id, i.leito_hospitalar_id)
    LEFT JOIN acomodacao ac ON ac.id = COALESCE(lh.acomodacao_id, i.acomodacao_id)
    LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
   WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL`;

const SITUACOES_ABERTAS = "('ativa','alta_medica')";

export class PortaEspecialidadesPropria implements PortaEspecialidades {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEspecialidades,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoEspecialidades, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  private async fuso(l: Leitor, est: number): Promise<string> {
    const r = await l.uma<{ fuso_horario: string | null }>(
      'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
      [est],
    );
    return r?.fuso_horario || FUSO_PADRAO;
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
  async podeGravar(_c: ContextoPortaM18, _op: string): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(
    _c: ContextoPortaM18,
    op: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
    _entrada: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
    _ctx: ContextoOperacao,
  ): Promise<GravacaoFeita> {
    throw new ErroOperacao(
      400,
      'operacao-desconhecida',
      'Operação desconhecida',
      `A operação ${op} não existe nas especialidades: elas gravam pela gravação direta da tela.`,
    );
  }

  async gravarSgh<T>(
    c: ContextoEspecialidades,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorEspecialidades) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = (): TrilhaDaGravacao | null =>
      typeof trilha === 'function' ? (saida ? trilha((saida as { valor: T }).valor) : null) : trilha;
    const op = definirOperacao({
      nome: 'especialidades.gravacao-direta',
      tabelas: TABELAS_GRAVACAO,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est)) };
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'partograma_registro', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `direta:${randomUUID()}`;
    await this.executor.executar(op, c.cliente, { chave }, { ...contextoDe(c), chaveIdempotencia: chave });
    if (!saida) throw new Error('Gravação direta sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoEspecialidades) {
    return this.ler(c, async (l, est) => {
      const r = relogioNoFuso(await this.fuso(l, est));
      return { agora: `${r.hoje}T${r.hora}`, hoje: r.hoje };
    });
  }

  /** Os vínculos profissionais do usuário da sessão no estabelecimento, com a ocupação (CBO). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
  vinculos(c: ContextoEspecialidades, _login: string): Promise<VinculoDoLogin[]> {
    if (c.usuario === null) return Promise.resolve([]);
    const usuario = c.usuario;
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT pr.id AS vinculo, oc.codigo_cbo AS cbo,
                  (pr.situacao = 'ativo' AND po.ativo AND (uv.vigencia_fim IS NULL OR uv.vigencia_fim >= CURRENT_DATE)) AS ativo
             FROM usuario_vinculo_profissional uv
             JOIN profissional pr ON pr.id = uv.profissional_id AND pr.excluido_em IS NULL
             JOIN profissional_ocupacao po ON po.profissional_id = pr.id AND po.excluido_em IS NULL
             JOIN ocupacao_cbo oc ON oc.id = po.ocupacao_cbo_id
            WHERE uv.usuario_id = ? AND uv.estabelecimento_id = ? AND uv.excluido_em IS NULL
              AND uv.vigencia_inicio <= CURRENT_DATE
            ORDER BY po.principal DESC, pr.id, oc.codigo_cbo LIMIT 20`,
          [usuario, est],
        )
      ).map((r) => ({
        vinculo: n(r['vinculo']),
        cbo: texto(r['cbo']).trim(),
        ativo: r['ativo'] === 1 || r['ativo'] === true,
      })),
    );
  }

  internacoes(
    c: ContextoEspecialidades,
    termo: string,
  ): Promise<{ itens: InternacaoDaBusca[]; cortada: boolean }> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      let sql = `${SQL_INTERNACAO} AND i.situacao IN ${SITUACOES_ABERTAS}`;
      const p: unknown[] = [est];
      const t = termo.trim();
      if (/^\d{1,18}$/.test(t)) {
        sql += ' AND (i.numero = ? OR p.numero_prontuario = ? OR i.id = ?)';
        p.push(t, Number(t), Number(t));
      } else if (t.length >= 2 && !/[%_\\]/.test(t)) {
        sql += " AND CONCAT(' ', pf.nome, ' ') LIKE CONCAT('% ', ?, '%')";
        p.push(t.toUpperCase());
      }
      sql += ` ORDER BY pf.nome, i.id LIMIT ${TETO_INTERNACOES + 1}`;
      const linhas = await l.consultar(sql, p, { teto: TETO_INTERNACOES + 1 });
      return {
        itens: linhas.slice(0, TETO_INTERNACOES).map((r) => ({
          internacao: n(r['id']),
          prontuario: n(r['numero_prontuario']),
          nome: texto(r['nome']),
          leito: { bloco: texto(r['bloco']), acomodacao: texto(r['acomodacao']), leito: texto(r['leito']) },
          entrada: minutoCivil(r['data_hora_entrada'], fuso),
        })),
        cortada: linhas.length > TETO_INTERNACOES,
      };
    });
  }

  internacao(c: ContextoEspecialidades, internacao: number): Promise<InternacaoEspecialidadeLida | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_INTERNACAO} AND i.id = ?`, [est, internacao]);
      if (!r) return null;
      const fuso = await this.fuso(l, est);
      const sexo = texto(r['sexo']).toUpperCase();
      return {
        internacao: n(r['id']),
        prontuario: n(r['numero_prontuario']),
        paciente: n(r['paciente_id']),
        nome: texto(r['nome']),
        nascimento: dataIso(r['data_nascimento']),
        sexo: sexo === 'M' || sexo === 'F' ? sexo : 'I',
        bloco: texto(r['bloco']),
        acomodacao: texto(r['acomodacao']),
        leito: texto(r['leito']),
        admissao: minutoCivil(r['data_hora_entrada'], fuso),
        aberta: ['ativa', 'alta_medica'].includes(texto(r['situacao'])),
      };
    });
  }

  /** Cadastros da rede: grupos e exames oftalmológicos, acuidade visual e graduação. */
  cadastrosOftalmologia(c: ContextoEspecialidades): Promise<CadastrosOftalmologia> {
    return this.ler(c, async (l) => {
      const grupos = await l.consultar(
        'SELECT id, descricao FROM grupo_exame_oftalmologico WHERE ativo ORDER BY ordem, descricao LIMIT 200',
      );
      const exames = await l.consultar(
        `SELECT id, grupo_exame_oftalmologico_id, descricao FROM tipo_exame_oftalmologico
          WHERE ativo ORDER BY ordem, descricao LIMIT 500`,
      );
      return {
        grupos: grupos.map((g) => ({ codigo: n(g['id']), nome: texto(g['descricao']) })),
        exames: exames.map((e) => ({
          codigo: n(e['id']),
          grupo: n(e['grupo_exame_oftalmologico_id']),
          nome: texto(e['descricao']),
        })),
        acuidades: (
          await l.consultar(
            'SELECT id, rotulo, tipo FROM acuidade_visual WHERE ativo ORDER BY ordem, id LIMIT 200',
          )
        ).map((a) => ({ codigo: n(a['id']), nome: texto(a['rotulo']), tipo: textoOuNulo(a['tipo']) })),
        graduacoes: (
          await l.consultar(
            'SELECT id, sigla, descricao FROM graduacao_oftalmologica WHERE ativo ORDER BY sigla LIMIT 200',
          )
        ).map((g) => ({ codigo: n(g['id']), sigla: texto(g['sigla']), nome: texto(g['descricao']) })),
        // Os tipos de anexo do exame acompanham o exame consolidado (pendência de modelo).
        tiposArquivo: [],
      };
    });
  }

  tiposProtocolo(c: ContextoEspecialidades) {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id, descricao FROM tipo_protocolo_oncologico WHERE ativo ORDER BY ordem, descricao LIMIT 200',
        )
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['descricao']) })),
    );
  }

  tiposParto(c: ContextoEspecialidades) {
    return this.ler(c, async (l) =>
      (
        await l.consultar('SELECT id, descricao FROM tipo_parto WHERE ativo ORDER BY descricao LIMIT 100')
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['descricao']) })),
    );
  }

  /** As prescrições médicas da internação vigentes em algum momento do dia (para ligar ao ciclo). */
  prescricoesDoDia(
    c: ContextoEspecialidades,
    internacao: number,
    paciente: number,
    dia: string,
  ): Promise<PrescricaoDoCiclo[]> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const inicio = instanteCivil(dia, '0000', fuso);
      const fim = new Date(inicio.getTime() + 86_400_000);
      const linhas = await l.consultar(
        `SELECT pr.id, pr.vigencia_inicio_em, pr.vigencia_fim_em, pr.situacao,
                (SELECT COUNT(*) FROM prescricao_item it WHERE it.prescricao_id = pr.id AND it.excluido_em IS NULL) AS itens
           FROM prescricao pr JOIN internacao i ON i.atendimento_id = pr.atendimento_id
          WHERE i.id = ? AND i.estabelecimento_id = ? AND pr.paciente_id = ? AND pr.estabelecimento_id = ?
            AND pr.excluido_em IS NULL AND pr.situacao NOT IN ('rascunho','cancelada')
            AND pr.vigencia_inicio_em < ? AND pr.vigencia_fim_em > ?
          ORDER BY pr.vigencia_inicio_em, pr.id LIMIT 50`,
        [internacao, est, paciente, est, fim, inicio],
      );
      return linhas.map((r) => ({
        id: n(r['id']),
        inicio: minutoCivil(r['vigencia_inicio_em'], fuso),
        fim: r['vigencia_fim_em'] ? minutoCivil(r['vigencia_fim_em'], fuso) : null,
        suspensa: r['situacao'] === 'suspensa',
        itens: n(r['itens']),
      }));
    });
  }

  partograma(
    c: ContextoEspecialidades,
    internacao: number,
    faseAtivaCm: number = FASE_ATIVA_CM_PADRAO,
  ): Promise<PontoPartograma[]> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT r.id, r.registrado_em, r.dilatacao_cm, r.altura_apresentacao, r.frequencia_cardiaca_fetal,
                r.contracoes_10_minutos, r.duracao_contracao_segundos, r.bolsa, r.liquido_amniotico,
                r.pressao_sistolica, r.pressao_diastolica, r.temperatura, r.ocitocina_dose, r.observacao,
                r.criado_em, u.login
           FROM partograma_registro r
           JOIN partograma p ON p.id = r.partograma_id
           JOIN internacao i ON i.atendimento_id = p.atendimento_id
           LEFT JOIN usuario u ON u.id = r.criado_por
          WHERE i.id = ? AND i.estabelecimento_id = ? AND p.estabelecimento_id = ?
            AND r.excluido_em IS NULL AND p.excluido_em IS NULL AND p.situacao <> 'cancelado'
          ORDER BY r.registrado_em, r.id LIMIT 500`,
        [internacao, est, est],
      );
      const pontos = linhas.map((r) => {
        const em = minutoCivil(r['registrado_em'], fuso);
        const medidas = {
          dilatacaoCm: nn(r['dilatacao_cm']),
          alturaApresentacao: nn(r['altura_apresentacao']),
          bcf: nn(r['frequencia_cardiaca_fetal']),
          contracoes10min: nn(r['contracoes_10_minutos']),
          duracaoContracaoS: nn(r['duracao_contracao_segundos']),
          bolsa: (textoOuNulo(r['bolsa']) as PontoPartograma['bolsa']) ?? null,
          liquido: liquidoDaTela(r['liquido_amniotico']),
          paSistolica: nn(r['pressao_sistolica']),
          paDiastolica: nn(r['pressao_diastolica']),
          temperatura: nn(r['temperatura']),
          ocitocina: nn(r['ocitocina_dose']),
          observacao: textoOuNulo(r['observacao']),
        };
        return {
          id: n(r['id']),
          em,
          medidas,
          por: texto(r['login']),
          registradoEm: minutoCivil(r['criado_em'], fuso),
        };
      });
      return pontos.map((p) => ({
        id: p.id,
        em: p.em,
        ...p.medidas,
        // Os anteriores são os registrados antes deste (id menor), como a gravação os via.
        alertas: alertasDoPonto(
          { internacao, em: p.em, ...p.medidas, observacao: p.medidas.observacao ?? undefined },
          pontos.filter((x) => x.id < p.id).map((x) => ({ em: x.em, dilatacaoCm: x.medidas.dilatacaoCm })),
          faseAtivaCm,
        ),
        por: p.por,
        registradoEm: p.registradoEm,
      }));
    });
  }

  recemNascidos(c: ContextoEspecialidades, internacao: number): Promise<RecemNascidoRegistrado[]> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const linhas = await l.consultar(
        `SELECT rn.id, rn.nascido_em, sx.sigla AS sexo, rn.peso_gramas, rn.comprimento_cm, rn.perimetro_cefalico_cm,
                rn.apgar_1_minuto, rn.apgar_5_minutos, rn.apgar_10_minutos, rn.idade_gestacional_semanas,
                rn.idade_gestacional_dias, rn.tipo_parto_id, rn.reanimacao_neonatal, rn.observacao, rn.criado_em, u.login
           FROM registro_nascimento rn
           JOIN internacao i ON i.atendimento_id = rn.mae_atendimento_id
           LEFT JOIN sexo sx ON sx.id = rn.sexo_id
           LEFT JOIN usuario u ON u.id = rn.criado_por
          WHERE i.id = ? AND i.estabelecimento_id = ? AND rn.estabelecimento_id = ? AND rn.excluido_em IS NULL
          ORDER BY rn.nascido_em, rn.ordem_nascimento LIMIT 20`,
        [internacao, est, est],
      );
      return linhas.map((r) => {
        const sexo = texto(r['sexo']).toUpperCase();
        // Peso, Apgar e idade gestacional podem faltar (coluna nula): sem o valor, sem a classificação.
        const peso = nn(r['peso_gramas']);
        const sem = nn(r['idade_gestacional_semanas']);
        const dias = nn(r['idade_gestacional_dias']);
        const apgar5 = nn(r['apgar_5_minutos']);
        return {
          id: n(r['id']),
          nascimentoEm: minutoCivil(r['nascido_em'], fuso),
          sexo: (sexo === 'M' || sexo === 'F' ? sexo : 'I') as RecemNascidoRegistrado['sexo'],
          pesoG: peso,
          comprimentoCm: nn(r['comprimento_cm']),
          perimetroCefalicoCm: nn(r['perimetro_cefalico_cm']),
          apgar1: nn(r['apgar_1_minuto']),
          apgar5,
          apgar10: nn(r['apgar_10_minutos']),
          igSemanas: sem,
          igDias: dias,
          tipoParto: n(r['tipo_parto_id']),
          reanimacao: r['reanimacao_neonatal'] === 1 || r['reanimacao_neonatal'] === true,
          // A idade gestacional só em semanas (dias não anotados) classifica pelas semanas completas.
          classificacaoIg: sem === null ? null : classificarIdadeGestacional(sem, dias ?? 0),
          classificacaoPeso: peso === null ? null : classificarPesoAoNascer(peso),
          classificacaoApgar: apgar5 === null ? null : classificarApgar(apgar5),
          observacao: textoOuNulo(r['observacao']),
          por: texto(r['login']),
          em: minutoCivil(r['criado_em'], fuso),
        };
      });
    });
  }

  /** As ordens do lactário com o preparo no dia (no fuso do estabelecimento). */
  ordensDoDia(c: ContextoEspecialidades, dia: string): Promise<OrdemLactarioRegistrada[]> {
    return this.ler(c, async (l, est) =>
      this.ordens(l, est, await this.fuso(l, est), 'p.data_preparo = ?', [dia]),
    );
  }

  ordem(c: ContextoEspecialidades, id: number): Promise<OrdemLactarioRegistrada | null> {
    return this.ler(
      c,
      async (l, est) => (await this.ordens(l, est, await this.fuso(l, est), 'p.id = ?', [id]))[0] ?? null,
    );
  }

  private async ordens(
    l: Leitor,
    est: number,
    fuso: string,
    filtro: string,
    p: unknown[],
  ): Promise<OrdemLactarioRegistrada[]> {
    const rs = await l.consultar(
      `SELECT p.id, p.lote, p.iniciado_em, p.validade_ate, p.observacao, p.situacao, p.criado_em, p.conferido_em,
              p.cancelado_em, p.motivo_cancelamento, p.etiqueta_emitida_em, uc.login AS por, uf.login AS conferido_por,
              (SELECT ue.login FROM preparo_lactario_evento e JOIN usuario ue ON ue.id = e.usuario_id
                WHERE e.preparo_lactario_id = p.id AND e.evento = 'cancelado' ORDER BY e.id DESC LIMIT 1) AS cancelado_por
         FROM preparo_lactario p
         LEFT JOIN usuario uc ON uc.id = p.criado_por
         LEFT JOIN usuario uf ON uf.id = p.conferido_por_usuario_id
        WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND ${filtro}
        ORDER BY p.iniciado_em, p.id LIMIT 500`,
      [est, ...p],
      { teto: 500 },
    );
    if (rs.length === 0) return [];
    const ids = rs.map((r) => n(r['id']));
    const itens = await l.consultar(
      `SELECT it.preparo_lactario_id AS preparo, it.administrar_em, it.volume_ml, f.nome AS formula,
              i.id AS internacao, i.paciente_id, pc.numero_prontuario
         FROM preparo_lactario_item it
         JOIN formula_lactea f ON f.id = it.formula_lactea_id
         LEFT JOIN internacao i ON i.atendimento_id = it.atendimento_id AND i.estabelecimento_id = ? AND i.excluido_em IS NULL
         LEFT JOIN paciente pc ON pc.id = i.paciente_id
        WHERE it.preparo_lactario_id IN (${ids.map(() => '?').join(', ')}) AND it.excluido_em IS NULL
        ORDER BY it.preparo_lactario_id, it.sequencia`,
      [est, ...ids],
      { teto: 10_000 },
    );
    return rs.flatMap((r) => {
      const meus = itens.filter((x) => n(x['preparo']) === n(r['id']));
      const primeiro = meus[0];
      if (!primeiro) return [];
      const cancelada = r['cancelado_em'] !== null && r['cancelado_em'] !== undefined;
      return [
        {
          id: n(r['id']),
          internacao: n(primeiro['internacao']),
          prontuario: n(primeiro['numero_prontuario']),
          paciente: n(primeiro['paciente_id']),
          formula: texto(primeiro['formula']),
          volumeMl: n(primeiro['volume_ml']),
          horarios: meus.map((x) => minutoCivil(x['administrar_em'], fuso).slice(11, 16)),
          preparoEm: minutoCivil(r['iniciado_em'], fuso),
          validadeEm: minutoCivil(r['validade_ate'], fuso),
          lote: textoOuNulo(r['lote']),
          observacao: textoOuNulo(r['observacao']),
          situacao: r['conferido_em'] ? 'conferida' : 'preparada',
          por: texto(r['por']),
          em: minutoCivil(r['criado_em'], fuso),
          conferidoPor: textoOuNulo(r['conferido_por']),
          conferidoEm: r['conferido_em'] ? minutoCivil(r['conferido_em'], fuso) : null,
          canceladaPor: cancelada ? textoOuNulo(r['cancelado_por']) : null,
          canceladaEm: cancelada ? minutoCivil(r['cancelado_em'], fuso) : null,
          motivoCancelamento: textoOuNulo(r['motivo_cancelamento']),
          etiquetaEm: r['etiqueta_emitida_em'] ? minutoCivil(r['etiqueta_emitida_em'], fuso) : null,
        },
      ];
    });
  }

  /** O histórico das ordens (alteração, cancelamento e etiqueta), o mais recente primeiro. */
  alteracoesOrdens(
    c: ContextoEspecialidades,
    ids: readonly number[],
  ): Promise<AlteracaoLactarioRegistrada[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      return (
        await l.consultar(
          `SELECT e.id, e.preparo_lactario_id, e.evento, e.dados_antes, e.dados_depois, e.motivo, e.ocorrido_em, u.login
             FROM preparo_lactario_evento e
             JOIN preparo_lactario p ON p.id = e.preparo_lactario_id AND p.estabelecimento_id = ?
             LEFT JOIN usuario u ON u.id = e.usuario_id
            WHERE e.preparo_lactario_id IN (${ids.map(() => '?').join(', ')})
            ORDER BY e.ocorrido_em DESC, e.id DESC LIMIT 2000`,
          [est, ...ids],
          { teto: 2000 },
        )
      ).map((r) => ({
        id: n(r['id']),
        idRegistro: n(r['preparo_lactario_id']),
        evento: EVENTO_LACTARIO_LIDO[texto(r['evento'])] ?? 'alterada',
        antes: textoDoJson(r['dados_antes']),
        depois: textoDoJson(r['dados_depois']),
        motivo: textoOuNulo(r['motivo']),
        por: texto(r['login']),
        em: minutoCivil(r['ocorrido_em'], fuso),
      }));
    });
  }

  /** Os exames oftalmológicos consolidados da internação (tipo nulo: os tipos estão nos itens), o mais recente primeiro. */
  exames(c: ContextoEspecialidades, internacao: number): Promise<ExameOftalmologicoRegistrado[]> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const cab = await l.consultar(
        `SELECT e.id, e.achados, e.conclusao, e.alertas, e.realizado_em, i.id AS internacao, u.login
           FROM internacao i
           JOIN exame_oftalmologico e ON e.atendimento_id = i.atendimento_id AND e.estabelecimento_id = i.estabelecimento_id
           LEFT JOIN usuario u ON u.id = e.criado_por
          WHERE i.id = ? AND i.estabelecimento_id = ? AND e.excluido_em IS NULL AND e.situacao <> 'cancelado'
            AND e.tipo_exame_oftalmologico_id IS NULL
          ORDER BY e.realizado_em DESC, e.id DESC LIMIT 500`,
        [internacao, est],
        { teto: 500 },
      );
      if (cab.length === 0) return [];
      const ids = cab.map((r) => n(r['id']));
      const marcas = ids.map(() => '?').join(', ');
      const valores = await l.consultar(
        `SELECT exame_oftalmologico_id, olho, medida, correcao, valor_numerico, metodo FROM exame_oftalmologico_valor
          WHERE exame_oftalmologico_id IN (${marcas}) AND excluido_em IS NULL ORDER BY exame_oftalmologico_id, sequencia`,
        ids,
        { teto: 5000 },
      );
      const itens = await l.consultar(
        `SELECT exame_oftalmologico_id, tipo_exame_oftalmologico_id, olho, resultado FROM exame_oftalmologico_item
          WHERE exame_oftalmologico_id IN (${marcas}) AND excluido_em IS NULL ORDER BY exame_oftalmologico_id, sequencia`,
        ids,
        { teto: 5000 },
      );
      return cab.map((r) => {
        const id = n(r['id']);
        const meus = valores.filter((v) => n(v['exame_oftalmologico_id']) === id);
        const olho = (o: 'direito' | 'esquerdo'): MedidasOlho => {
          // O grau da gonioscopia é a medida 'outro' com o método 'gonioscopia'.
          const v = (medida: string, correcao?: string) => {
            const x = meus.find(
              (y) =>
                texto(y['olho']) === o &&
                (medida === 'gonioscopia_grau'
                  ? texto(y['medida']) === 'outro' && texto(y['metodo']) === 'gonioscopia'
                  : texto(y['medida']) === medida) &&
                (!correcao || texto(y['correcao']) === correcao),
            );
            return x && x['valor_numerico'] !== null ? Number(x['valor_numerico']) : null;
          };
          return {
            avSc: v('acuidade_visual', 'sem_correcao'),
            avCc: v('acuidade_visual', 'com_correcao'),
            pio: v('pressao_intraocular'),
            gonio: v('gonioscopia_grau'),
          };
        };
        const pio = meus.find((y) => texto(y['medida']) === 'pressao_intraocular' && y['metodo'] !== null);
        let alertas: string[];
        try {
          const a = JSON.parse(texto(r['alertas']) || '[]') as unknown;
          alertas = Array.isArray(a) ? a.map(String) : [];
        } catch {
          alertas = [];
        }
        return {
          id,
          internacao: n(r['internacao']),
          od: olho('direito'),
          oe: olho('esquerdo'),
          metodoPio: pio ? texto(pio['metodo']) : null,
          classificacao: texto(r['achados']),
          alertas,
          conduta: textoOuNulo(r['conclusao']),
          itens: itens
            .filter((x) => n(x['exame_oftalmologico_id']) === id)
            .map((x) => ({
              exame: n(x['tipo_exame_oftalmologico_id']),
              lado: LADO_DO_OLHO[texto(x['olho'])] ?? 'ao',
              resultado: texto(x['resultado']),
            })),
          por: texto(r['login']),
          em: minutoCivil(r['realizado_em'], fuso),
        };
      });
    });
  }
  // ── Oncologia (oncologia-propria.ts) ──
  protocolos(c: ContextoEspecialidades) {
    return this.ler(c, async (l, est) => onco.lerProtocolos(l, est, await this.fuso(l, est), null));
  }
  protocolo(c: ContextoEspecialidades, id: number) {
    return this.ler(
      c,
      async (l, est) => (await onco.lerProtocolos(l, est, await this.fuso(l, est), id))[0] ?? null,
    );
  }
  ciclosDoPaciente(c: ContextoEspecialidades, paciente: number) {
    return this.ler(c, async (l, est) =>
      onco.lerCiclos(l, est, await this.fuso(l, est), 'paciente', paciente),
    );
  }
  ciclo(c: ContextoEspecialidades, id: number) {
    return this.ler(
      c,
      async (l, est) => (await onco.lerCiclos(l, est, await this.fuso(l, est), 'id', id))[0] ?? null,
    );
  }
  ciclosAValidar(c: ContextoEspecialidades) {
    return this.ler(c, async (l, est) => onco.lerCiclos(l, est, await this.fuso(l, est), 'a-validar', null));
  }
  eventosProtocolos(c: ContextoEspecialidades) {
    return this.ler(c, async (l, est) => onco.lerEventos(l, est, await this.fuso(l, est), null));
  }
  eventosCiclos(c: ContextoEspecialidades, ciclos: readonly number[]) {
    return this.ler(c, async (l, est) => onco.lerEventos(l, est, await this.fuso(l, est), ciclos));
  }
  ciclosDaVersao(
    c: ContextoEspecialidades,
    protocolo: number,
  ): Promise<{ total: number; emAndamento: number; cortada: boolean; itens: CicloDependente[] }> {
    return this.ler(c, async (l, est) => onco.lerCiclosDaVersao(l, est, await this.fuso(l, est), protocolo));
  }
}

/** O gravador das telas sobre a transação da operação (o estabelecimento vem do contexto). */
function gravadorSobre(tx: TxOperacao, est: number): GravadorEspecialidades {
  return {
    registrarPartograma: (x) => registrarPontoPartograma(tx, est, x),
    registrarRecemNascido: (x) => registrarRecemNascido(tx, est, x),
    registrarOrdem: (x) => registrarOrdemLactario(tx, est, x),
    conferirOrdem: (x) => conferirOrdemLactario(tx, est, x.id),
    alterarOrdem: (x) => alterarOrdemLactario(tx, est, x),
    cancelarOrdem: (x) => cancelarOrdemLactario(tx, est, x),
    marcarEtiqueta: (x) => marcarEtiquetaLactario(tx, est, x.id),
    registrarAlteracao: (x) => registrarAlteracaoLactario(tx, est, x),
    registrarExame: (x) => registrarExameOftalmologico(tx, est, x),
    publicarProtocolo: (x) => onco.publicarProtocolo(tx, est, x),
    registrarCiclo: async (x) =>
      onco.registrarCiclo(tx, est, await internacaoAberta(tx, est, x, 'o ciclo não é registrado'), x),
    validarCiclo: (x) => onco.validarCiclo(tx, est, x),
    vincularPrescricao: (x) => onco.vincularPrescricao(tx, est, x),
    registrarEventoOnco: (x) => onco.registrarEventoOnco(tx, est, x),
    revogarVersao: (x) => onco.revogarVersao(tx, est, x),
    mudarAndamentoCiclo: (x) => onco.mudarAndamentoCiclo(tx, est, x),
    ajustarCiclo: (x) => onco.ajustarCiclo(tx, est, x),
    desligarPrescricao: (x) => onco.desligarPrescricao(tx, est, x),
  };
}

/**
 * O registro horário do partograma: abre o partograma do atendimento da internação na primeira medida (o responsável é
 * o vínculo de quem registra) e numera os registros. A internação tem de estar aberta, no estabelecimento da sessão e
 * ser do paciente informado.
 */
async function registrarPontoPartograma(
  tx: TxOperacao,
  est: number,
  x: NovoPontoPartograma,
): Promise<number> {
  const atendimento = await internacaoAberta(tx, est, x, 'o partograma não recebe registros');
  const instante = deMinutoCivil(x.em, await fusoTx(tx, est));
  const [aberto] = await tx.consultarParaAtualizar(
    `SELECT id FROM partograma WHERE atendimento_id = ? AND estabelecimento_id = ? AND situacao = 'aberto'
        AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
    [atendimento, est],
  );
  const partograma = aberto
    ? n(aberto['id'])
    : await tx.incluir('partograma', {
        estabelecimento_id: est,
        atendimento_id: atendimento,
        paciente_id: x.paciente,
        aberto_em: instante,
        inicio_trabalho_parto_em: instante,
        situacao: 'aberto',
        responsavel_profissional_id: x.vinculo,
      });
  const s = await tx.uma<{ proxima: unknown }>(
    'SELECT COALESCE(MAX(sequencia), 0) + 1 AS proxima FROM partograma_registro WHERE partograma_id = ?',
    [partograma],
  );
  return tx.incluir('partograma_registro', {
    partograma_id: partograma,
    sequencia: n(s?.proxima ?? 1),
    registrado_em: instante,
    profissional_id: x.vinculo,
    dilatacao_cm: x.dilatacaoCm,
    altura_apresentacao: x.alturaApresentacao,
    frequencia_cardiaca_fetal: x.bcf,
    contracoes_10_minutos: x.contracoes10min,
    duracao_contracao_segundos: x.duracaoContracaoS,
    bolsa: x.bolsa,
    liquido_amniotico: x.liquido ? LIQUIDO_DO_MODELO[x.liquido] : null,
    ocitocina_dose: x.ocitocina,
    pressao_sistolica: x.paSistolica,
    pressao_diastolica: x.paDiastolica,
    temperatura: x.temperatura,
    observacao: x.observacao,
  });
}

/** Trava a internação (do estabelecimento, do paciente e aberta) e devolve o atendimento dela. */
async function internacaoAberta(
  tx: TxOperacao,
  est: number,
  x: { internacao: number; paciente: number },
  efeito: string,
): Promise<number> {
  const [i] = await tx.consultarParaAtualizar(
    `SELECT id, atendimento_id, paciente_id, situacao FROM internacao
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [x.internacao, est],
  );
  if (!i)
    throw new ErroOperacao(
      404,
      'registro-inexistente',
      'Internação não encontrada',
      'A internação não existe neste estabelecimento.',
    );
  if (n(i['paciente_id']) !== x.paciente)
    throw recusa('paciente-divergente', 'A internação é de outro paciente: recarregue a tela.');
  if (!['ativa', 'alta_medica'].includes(texto(i['situacao'])))
    throw recusa('internacao-encerrada', `A internação não está aberta: ${efeito}.`);
  return n(i['atendimento_id']);
}

/** Lado do exame na tela ↔ olho no modelo. */
const OLHO_DO_LADO = { od: 'direito', oe: 'esquerdo', ao: 'ambos' } as const;
const LADO_DO_OLHO: Readonly<Record<string, LadoExame>> = { direito: 'od', esquerdo: 'oe', ambos: 'ao' };

/**
 * O exame oftalmológico consolidado da internação aberta: o cabeçalho (tipo nulo; a classificação visual nos achados,
 * a conduta na conclusão e os alertas calculados), as medidas por olho em exame_oftalmologico_valor (acuidade sem e
 * com correção, pressão intraocular com o método e o grau da gonioscopia) e um item por tipo de exame e lado.
 */
async function registrarExameOftalmologico(
  tx: TxOperacao,
  est: number,
  x: NovoExameOftalmologico,
): Promise<number> {
  const atendimento = await internacaoAberta(tx, est, x, 'o exame não é registrado');
  const tipos = [...new Set(x.itens.map((i) => i.exame))];
  if (tipos.length) {
    const achados = await tx.consultar(
      `SELECT id FROM tipo_exame_oftalmologico WHERE id IN (${tipos.map(() => '?').join(', ')})`,
      tipos,
    );
    if (achados.length !== tipos.length)
      throw recusa('tipo-exame-inexistente', 'Um dos tipos de exame não existe no cadastro.');
  }
  const id = await tx.incluir('exame_oftalmologico', {
    estabelecimento_id: est,
    paciente_id: x.paciente,
    atendimento_id: atendimento,
    tipo_exame_oftalmologico_id: null,
    profissional_id: x.vinculo,
    realizado_em: new Date(),
    olho: 'ambos',
    achados: x.classificacao,
    conclusao: x.conduta === null ? null : x.conduta.slice(0, 2000),
    alertas: JSON.stringify([...x.alertas]),
    situacao: 'concluido',
    origem: 'sistema',
  });
  let seq = 0;
  for (const [olho, m] of [
    ['direito', x.od],
    ['esquerdo', x.oe],
  ] as const) {
    const medidas: [string, string, number | null, string | null, string | null][] = [
      ['acuidade_visual', 'sem_correcao', m.avSc, null, null],
      ['acuidade_visual', 'com_correcao', m.avCc, null, null],
      ['pressao_intraocular', 'nao_se_aplica', m.pio, 'mmHg', x.metodoPio],
      ['gonioscopia_grau', 'nao_se_aplica', m.gonio, 'grau', null],
    ];
    for (const [medida, correcao, valor, unidade, metodo] of medidas) {
      if (valor === null) continue;
      await tx.incluir('exame_oftalmologico_valor', {
        exame_oftalmologico_id: id,
        sequencia: ++seq,
        olho,
        medida: medida === 'gonioscopia_grau' ? 'outro' : medida,
        correcao,
        valor_numerico: valor,
        unidade,
        metodo: medida === 'gonioscopia_grau' ? 'gonioscopia' : metodo,
        origem: 'sistema',
      });
    }
  }
  seq = 0;
  for (const i of x.itens)
    await tx.incluir('exame_oftalmologico_item', {
      exame_oftalmologico_id: id,
      sequencia: ++seq,
      tipo_exame_oftalmologico_id: i.exame,
      olho: OLHO_DO_LADO[i.lado],
      resultado: i.resultado.slice(0, 500),
    });
  return id;
}

async function fusoTx(tx: TxOperacao, est: number): Promise<string> {
  const f = await tx.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return f?.fuso_horario || FUSO_PADRAO;
}

/** O recém-nascido do parto da internação da mãe: ordem do nascimento no atendimento e o partograma aberto, se houver. */
async function registrarRecemNascido(tx: TxOperacao, est: number, x: NovoRecemNascido): Promise<number> {
  const atendimento = await internacaoAberta(tx, est, x, 'o nascimento não é registrado');
  const sexo = await tx.uma('SELECT id FROM sexo WHERE sigla = ?', [x.sexo]);
  if (!sexo) throw recusa('sexo-inexistente', 'O sexo informado não está no cadastro.');
  const ordem = await tx.uma<{ proxima: unknown }>(
    'SELECT COALESCE(MAX(ordem_nascimento), 0) + 1 AS proxima FROM registro_nascimento WHERE mae_atendimento_id = ?',
    [atendimento],
  );
  const partograma = await tx.uma(
    `SELECT id FROM partograma WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
      ORDER BY (situacao = 'aberto') DESC, id DESC LIMIT 1`,
    [atendimento, est],
  );
  return tx.incluir('registro_nascimento', {
    estabelecimento_id: est,
    mae_paciente_id: x.paciente,
    mae_atendimento_id: atendimento,
    partograma_id: partograma ? n(partograma['id']) : null,
    ordem_nascimento: n(ordem?.proxima ?? 1),
    nascido_em: deMinutoCivil(x.nascimentoEm, await fusoTx(tx, est)),
    tipo_parto_id: x.tipoParto,
    sexo_id: n(sexo['id']),
    idade_gestacional_semanas: x.igSemanas,
    idade_gestacional_dias: x.igDias,
    peso_gramas: x.pesoG,
    comprimento_cm: x.comprimentoCm,
    perimetro_cefalico_cm: x.perimetroCefalicoCm,
    apgar_1_minuto: x.apgar1,
    apgar_5_minutos: x.apgar5,
    apgar_10_minutos: x.apgar10,
    responsavel_profissional_id: x.vinculo,
    reanimacao_neonatal: x.reanimacao,
    observacao: x.observacao,
  });
}

// ── Lactário ────────────────────────────────────────────────────────────────────────────────────────────────

/** A fórmula do cadastro de fórmulas lácteas do estabelecimento, pelo nome ou pelo código. */
async function formulaDoCadastro(tx: TxOperacao, est: number, formula: string): Promise<number> {
  const f = await tx.uma(
    `SELECT id FROM formula_lactea
      WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL AND (UPPER(nome) = UPPER(?) OR UPPER(codigo) = UPPER(?))
      ORDER BY id LIMIT 1`,
    [est, formula.trim(), formula.trim()],
  );
  if (!f)
    throw recusa(
      'formula-nao-cadastrada',
      'A fórmula não está no cadastro de fórmulas lácteas do estabelecimento.',
    );
  return n(f['id']);
}

/** O colaborador ligado ao usuário da sessão (o manipulador ou o conferente do preparo). */
async function colaboradorDoUsuario(tx: TxOperacao): Promise<number | null> {
  if (tx.contexto.usuario === null) return null;
  const r = await tx.uma(
    'SELECT id FROM colaborador WHERE usuario_id = ? AND ativo AND excluido_em IS NULL ORDER BY id LIMIT 1',
    [tx.contexto.usuario],
  );
  return r ? n(r['id']) : null;
}

/** As porções: um horário "HH:MM" vale no dia do preparo, ou no seguinte quando é antes da hora do preparo. */
function porcoes(c: ConteudoOrdemLactario, fuso: string): Date[] {
  const dia = c.preparoEm.slice(0, 10);
  const hora = c.preparoEm.slice(11, 16);
  const amanha = new Date(Date.parse(`${dia}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const validade = deMinutoCivil(c.validadeEm, fuso);
  return c.horarios.map((h) => {
    const em = deMinutoCivil(`${h >= hora ? dia : amanha}T${h}`, fuso);
    if (em.getTime() > validade.getTime())
      throw recusa(
        'porcao-fora-da-validade',
        `A porção das ${h} fica depois da validade do preparo: ajuste os horários.`,
      );
    return em;
  });
}

async function incluirPorcoes(
  tx: TxOperacao,
  preparo: number,
  atendimento: number,
  formula: number,
  c: ConteudoOrdemLactario,
  fuso: string,
  rodada: number,
): Promise<void> {
  const s = await tx.uma<{ ultima: unknown }>(
    'SELECT COALESCE(MAX(sequencia), 0) AS ultima FROM preparo_lactario_item WHERE preparo_lactario_id = ?',
    [preparo],
  );
  let seq = n(s?.ultima);
  const validade = deMinutoCivil(c.validadeEm, fuso);
  for (const em of porcoes(c, fuso)) {
    seq += 1;
    await tx.incluir('preparo_lactario_item', {
      preparo_lactario_id: preparo,
      sequencia: seq,
      atendimento_id: atendimento,
      formula_lactea_id: formula,
      volume_ml: c.volumeMl,
      quantidade_frascos: 1,
      administrar_em: em,
      validade_ate: validade,
      codigo_etiqueta: `LAC${preparo}-${rodada}-${seq}`,
      situacao: 'preparado',
    });
  }
}

/** A ordem do paciente: um preparo com o número do estabelecimento e uma porção por horário. */
async function registrarOrdemLactario(tx: TxOperacao, est: number, x: NovaOrdemLactario): Promise<number> {
  const atendimento = await internacaoAberta(tx, est, x, 'o lactário não recebe ordens');
  const fuso = await fusoTx(tx, est);
  const formula = await formulaDoCadastro(tx, est, x.formula);
  const manipulador = await colaboradorDoUsuario(tx);
  if (manipulador === null)
    throw recusa(
      'sem-cadastro-colaborador',
      'O usuário da sessão não está no cadastro de colaboradores: o preparo do lactário registra o manipulador.',
    );
  const s = await tx.uma<{ proximo: unknown }>(
    'SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM preparo_lactario WHERE estabelecimento_id = ?',
    [est],
  );
  const numero = n(s?.proximo ?? 1);
  const id = await tx.incluir('preparo_lactario', {
    estabelecimento_id: est,
    numero,
    data_preparo: x.preparoEm.slice(0, 10),
    manipulador_colaborador_id: manipulador,
    lote: x.lote ?? `L${numero}`,
    iniciado_em: deMinutoCivil(x.preparoEm, fuso),
    validade_ate: deMinutoCivil(x.validadeEm, fuso),
    situacao: 'preparado',
    observacao: x.observacao,
  });
  await incluirPorcoes(tx, id, atendimento, formula, x, fuso, 1);
  return id;
}

async function travarOrdem(tx: TxOperacao, est: number, id: number) {
  const [o] = await tx.consultarParaAtualizar(
    `SELECT id, versao, situacao, lote, iniciado_em, validade_ate, observacao, conferido_em, cancelado_em,
            etiqueta_emitida_em, criado_por
       FROM preparo_lactario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [id, est],
  );
  return o ?? null;
}

async function conferirOrdemLactario(tx: TxOperacao, est: number, id: number): Promise<number> {
  const o = await travarOrdem(tx, est, id);
  const usuario = tx.contexto.usuario;
  // Dupla checagem: quem confere não pode ter preparado nem alterado o conteúdo atual da ordem. A alteração refaz as
  // porções (o autor delas é quem alterou) e fica no histórico como 'alterado'.
  const mexeu =
    o && usuario !== null
      ? await tx.uma(
          `SELECT 1 AS sim FROM preparo_lactario_item
            WHERE preparo_lactario_id = ? AND excluido_em IS NULL AND criado_por = ?
           UNION ALL
           SELECT 1 FROM preparo_lactario_evento WHERE preparo_lactario_id = ? AND evento = 'alterado' AND usuario_id = ?
           LIMIT 1`,
          [id, usuario, id, usuario],
        )
      : null;
  if (
    !o ||
    usuario === null ||
    o['conferido_em'] ||
    o['cancelado_em'] ||
    texto(o['situacao']) !== 'preparado' ||
    nn(o['criado_por']) === usuario ||
    mexeu
  )
    throw recusa(
      'ordem-nao-conferivel',
      'A ordem já foi conferida, não existe ou foi preparada ou alterada por você: a conferência é de outra pessoa, uma vez.',
    );
  await tx.alterar('preparo_lactario', id, n(o['versao']), {
    conferido_por_usuario_id: tx.contexto.usuario,
    conferido_em: new Date(),
    conferente_colaborador_id: await colaboradorDoUsuario(tx),
  });
  return id;
}

async function alterarOrdemLactario(
  tx: TxOperacao,
  est: number,
  x: ConteudoOrdemLactario & { id: number },
): Promise<OrdemLactarioAnterior> {
  const o = await travarOrdem(tx, est, x.id);
  if (!o || o['conferido_em'] || o['cancelado_em'] || texto(o['situacao']) !== 'preparado')
    throw recusa(
      'ordem-conferida',
      'A ordem já foi conferida ou foi cancelada: não se altera; cancele com o motivo.',
    );
  const fuso = await fusoTx(tx, est);
  const itens = await tx.consultarParaAtualizar(
    `SELECT it.id, it.versao, it.atendimento_id, it.volume_ml, it.administrar_em, f.nome AS formula
       FROM preparo_lactario_item it JOIN formula_lactea f ON f.id = it.formula_lactea_id
      WHERE it.preparo_lactario_id = ? AND it.excluido_em IS NULL ORDER BY it.sequencia`,
    [x.id],
  );
  const primeiro = itens[0];
  if (!primeiro) throw recusa('ordem-sem-porcoes', 'A ordem não tem porções: cancele e registre de novo.');
  const antes: OrdemLactarioAnterior = {
    formula: texto(primeiro['formula']),
    volumeMl: n(primeiro['volume_ml']),
    horarios: itens.map((i) => minutoCivil(i['administrar_em'], fuso).slice(11, 16)),
    preparoEm: minutoCivil(o['iniciado_em'], fuso),
    validadeEm: minutoCivil(o['validade_ate'], fuso),
    lote: textoOuNulo(o['lote']),
    observacao: textoOuNulo(o['observacao']),
  };
  const formula = await formulaDoCadastro(tx, est, x.formula);
  const versao = await tx.alterar('preparo_lactario', x.id, n(o['versao']), {
    data_preparo: x.preparoEm.slice(0, 10),
    lote: x.lote ?? texto(o['lote']),
    iniciado_em: deMinutoCivil(x.preparoEm, fuso),
    validade_ate: deMinutoCivil(x.validadeEm, fuso),
    observacao: x.observacao,
  });
  for (const i of itens) await tx.excluir('preparo_lactario_item', n(i['id']), n(i['versao']));
  await incluirPorcoes(tx, x.id, n(primeiro['atendimento_id']), formula, x, fuso, versao);
  return antes;
}

async function cancelarOrdemLactario(
  tx: TxOperacao,
  est: number,
  x: { id: number; motivo: string },
): Promise<number> {
  const o = await travarOrdem(tx, est, x.id);
  if (!o || o['cancelado_em']) throw recusa('ordem-cancelada', 'A ordem já foi cancelada (ou não existe).');
  await tx.alterar('preparo_lactario', x.id, n(o['versao']), {
    situacao: 'cancelado',
    cancelado_em: new Date(),
    motivo_cancelamento: x.motivo.slice(0, 500),
  });
  const itens = await tx.consultarParaAtualizar(
    "SELECT id, versao FROM preparo_lactario_item WHERE preparo_lactario_id = ? AND excluido_em IS NULL AND situacao = 'preparado'",
    [x.id],
  );
  for (const i of itens)
    await tx.alterar('preparo_lactario_item', n(i['id']), n(i['versao']), { situacao: 'cancelado' });
  return x.id;
}

async function marcarEtiquetaLactario(tx: TxOperacao, est: number, id: number): Promise<number> {
  const o = await travarOrdem(tx, est, id);
  if (o?.['cancelado_em'])
    throw recusa('ordem-cancelada', 'A ordem foi cancelada: não se emite etiqueta de fórmula cancelada.');
  if (!o || o['etiqueta_emitida_em']) return 0;
  await tx.alterar('preparo_lactario', id, n(o['versao']), {
    etiqueta_emitida_em: new Date(),
    etiquetas_impressas: true,
  });
  return 1;
}

async function registrarAlteracaoLactario(
  tx: TxOperacao,
  est: number,
  x: NovaAlteracaoLactario,
): Promise<number> {
  const o = await tx.uma('SELECT id FROM preparo_lactario WHERE id = ? AND estabelecimento_id = ?', [
    x.id,
    est,
  ]);
  if (!o) throw recusa('ordem-inexistente', 'A ordem do lactário não existe neste estabelecimento.');
  if (tx.contexto.usuario === null)
    throw recusa('sem-usuario', 'O histórico do lactário exige o usuário da sessão.');
  return tx.incluir('preparo_lactario_evento', {
    preparo_lactario_id: x.id,
    evento: EVENTO_LACTARIO[x.evento],
    dados_antes: jsonDoTexto(x.antes),
    dados_depois: jsonDoTexto(x.depois),
    motivo: x.motivo === null ? null : x.motivo.slice(0, 500),
    ocorrido_em: new Date(),
    usuario_id: tx.contexto.usuario,
  });
}

function contextoDe(c: ContextoPortaM18) {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'especialidades').slice(0, 64),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaEspecialidadesIndisponivel(): PortaEspecialidades {
  return portaIndisponivel<PortaEspecialidades>(METODOS_PORTA_ESPECIALIDADES);
}
