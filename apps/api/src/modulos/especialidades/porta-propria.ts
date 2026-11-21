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
// Pendências de modelo (pedidos do lote 02-06): o exame oftalmológico consolidado (acuidade, PIO, gonioscopia e
// classificação), o protocolo oncológico versionado (hash, revogação), o ciclo calculado e validado (redução,
// creatinina, validação), os eventos do tratamento, a ligação ciclo × prescrição, a ordem do lactário por paciente e o
// histórico das alterações, e o recém-nascido com reanimação e observação. Até lá, essas leituras voltam vazias e as
// gravações recusam com 'modelo-pendente' (409), dizendo o que falta; nada é gravado pela metade.
import { randomUUID } from 'node:crypto';
import type { CicloDependente, LiquidoAmniotico } from '@sgh/contratos';
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
import { type ContextoPortaM18, type GravacaoFeita, type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { civil, FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../exames/relogio.js';
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
  CadastrosOftalmologia,
  InternacaoEspecialidadeLida,
  NovoPontoPartograma,
  PontoPartograma,
  PrescricaoDoCiclo,
  RecemNascidoRegistrado,
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
const TABELAS_GRAVACAO = ['partograma', 'partograma_registro'] as const;

/** Instante → "AAAA-MM-DDTHH:MM" no fuso do estabelecimento. */
function minutoCivil(v: unknown, fuso: string): string {
  const d = v instanceof Date ? v : new Date(String(v));
  const c = civil(d, fuso);
  return `${c.data}T${c.hhmm.slice(0, 2)}:${c.hhmm.slice(2, 4)}`;
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
    const r = await l.uma<{ fuso_horario: string | null }>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [
      est,
    ]);
    return r?.fuso_horario || FUSO_PADRAO;
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
  async podeGravar(_c: ContextoPortaM18, _op: string): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura da porta
  async executar(_c: ContextoPortaM18, op: string, _entrada: unknown, _ctx: ContextoOperacao): Promise<GravacaoFeita> {
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
      return { agora: `${r.hoje}T${r.hhmm.slice(0, 2)}:${r.hhmm.slice(2, 4)}`, hoje: r.hoje };
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
      ).map((r) => ({ vinculo: n(r['vinculo']), cbo: texto(r['cbo']).trim(), ativo: r['ativo'] === 1 || r['ativo'] === true })),
    );
  }

  internacoes(c: ContextoEspecialidades, termo: string): Promise<{ itens: InternacaoDaBusca[]; cortada: boolean }> {
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

  /** Cadastros da rede (grupos e exames oftalmológicos); acuidade, graduação e tipos de anexo: pendência de modelo. */
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
        acuidades: [],
        graduacoes: [],
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
        return { id: n(r['id']), em, medidas, por: texto(r['login']), registradoEm: minutoCivil(r['criado_em'], fuso) };
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
                rn.idade_gestacional_dias, rn.tipo_parto_id, rn.criado_em, u.login
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
          // Pendência de modelo: a reanimação e a observação do recém-nascido (pedido do lote 02-06).
          reanimacao: false,
          // A idade gestacional só em semanas (dias não anotados) classifica pelas semanas completas.
          classificacaoIg: sem === null ? null : classificarIdadeGestacional(sem, dias ?? 0),
          classificacaoPeso: peso === null ? null : classificarPesoAoNascer(peso),
          classificacaoApgar: apgar5 === null ? null : classificarApgar(apgar5),
          observacao: null,
          por: texto(r['login']),
          em: minutoCivil(r['criado_em'], fuso),
        };
      });
    });
  }

  // Leituras que esperam o modelo do banco (pedidos do lote 02-06): vazias, sem inventar dado.
  async exames() {
    return [];
  }
  async protocolos() {
    return [];
  }
  async protocolo() {
    return null;
  }
  async ciclosDoPaciente() {
    return [];
  }
  async ciclo() {
    return null;
  }
  async ciclosAValidar() {
    return [];
  }
  async ordensDoDia() {
    return [];
  }
  async ordem() {
    return null;
  }
  async eventosProtocolos() {
    return [];
  }
  async eventosCiclos() {
    return [];
  }
  async ciclosDaVersao(): Promise<{ total: number; emAndamento: number; cortada: boolean; itens: CicloDependente[] }> {
    return { total: 0, emAndamento: 0, cortada: false, itens: [] };
  }
  async alteracoesOrdens() {
    return [];
  }
}

/** O gravador das telas sobre a transação da operação (o estabelecimento vem do contexto). */
function gravadorSobre(tx: TxOperacao, est: number): GravadorEspecialidades {
  const pendente = (oQue: string) => async (): Promise<never> => {
    throw pendenteModelo(oQue);
  };
  return {
    registrarPartograma: (x) => registrarPontoPartograma(tx, est, x),
    registrarExame: pendente('O exame oftalmológico'),
    publicarProtocolo: pendente('O protocolo oncológico versionado'),
    registrarCiclo: pendente('O ciclo oncológico'),
    validarCiclo: pendente('A validação do ciclo oncológico'),
    vincularPrescricao: pendente('A ligação do ciclo com a prescrição'),
    registrarRecemNascido: pendente('O registro do recém-nascido (reanimação e observação)'),
    registrarOrdem: pendente('A ordem do lactário'),
    conferirOrdem: pendente('A conferência da ordem do lactário'),
    registrarEventoOnco: pendente('O evento do tratamento oncológico'),
    revogarVersao: pendente('A revogação da versão do protocolo'),
    mudarAndamentoCiclo: pendente('O andamento do ciclo oncológico'),
    ajustarCiclo: pendente('O ajuste do ciclo oncológico'),
    desligarPrescricao: pendente('O desligamento da prescrição do ciclo'),
    alterarOrdem: pendente('A alteração da ordem do lactário'),
    cancelarOrdem: pendente('O cancelamento da ordem do lactário'),
    marcarEtiqueta: pendente('A etiqueta da ordem do lactário'),
    registrarAlteracao: pendente('O histórico das alterações do lactário'),
  };
}

/**
 * O registro horário do partograma: abre o partograma do atendimento da internação na primeira medida (o responsável é
 * o vínculo de quem registra) e numera os registros. A internação tem de estar aberta, no estabelecimento da sessão e
 * ser do paciente informado.
 */
async function registrarPontoPartograma(tx: TxOperacao, est: number, x: NovoPontoPartograma): Promise<number> {
  const [i] = await tx.consultarParaAtualizar(
    `SELECT id, atendimento_id, paciente_id, situacao FROM internacao
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [x.internacao, est],
  );
  if (!i) throw new ErroOperacao(404, 'registro-inexistente', 'Internação não encontrada', 'A internação não existe neste estabelecimento.');
  if (n(i['paciente_id']) !== x.paciente)
    throw recusa('paciente-divergente', 'A internação é de outro paciente: recarregue a tela.');
  if (!['ativa', 'alta_medica'].includes(texto(i['situacao'])))
    throw recusa('internacao-encerrada', 'A internação não está aberta: o partograma não recebe registros.');
  const f = await tx.uma<{ fuso_horario: string | null }>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  const instante = deMinutoCivil(x.em, f?.fuso_horario || FUSO_PADRAO);
  const atendimento = n(i['atendimento_id']);
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
