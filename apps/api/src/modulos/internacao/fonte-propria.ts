// Fonte do M16 sobre o banco do cliente, pelo @sgh/nucleo (somente leitura): painel de leitos, movimento para o motor
// do censo e dos indicadores, paciente da internação, conferência do cadastro de leitos, dias de censo fechado e o
// selo dos canais do vigia. Tabelas: bloco_internacao, acomodacao, categoria_acomodacao, leito_hospitalar,
// internacao, ocupacao_leito, fechamento_censo e trilha_auditoria. Toda leitura filtra o estabelecimento da sessão e
// os registros excluídos.
// Melhoria: o vigia lê a trilha de auditoria (toda gravação passa pelo Executor e deixa a linha na mesma transação):
// um selo por canal pelo maior id da trilha cujas ESCRITAS (não só o alvo da operação) tocam as tabelas do canal,
// sem soma de hash de linhas nem leitura de gerador; o vigia chega com o cliente e o estabelecimento (sem sessão);
// a hora de entrada e de saída é a do fuso do estabelecimento; o nome do paciente só vira iniciais no servidor.
// Melhoria: o grupo da saída (óbito, transferência, evasão…) vem do tipo de saída do cadastro de motivos, nunca de
// faixa de código; a clínica do recorte é a especialidade da internação.
// Pendências (registradas na saída do lote 01-05): o retrato do censo fechado (o worker que fecha o censo migra na
// onda 8: até lá nenhum dia vem fechado com linhas), os painéis operacional e financeiro mensais (módulo relatório,
// onda 4) e a rota de divergências, que comparava o cadastro com o espelho do sistema antigo (no banco próprio o
// cadastro e o retrato são o mesmo: nenhuma divergência).
import {
  type CanalVigia,
  iniciaisDoNome,
  type InternacaoMovimento,
  type LeiturasPainel,
  type MovimentoInternacao,
  type PosicaoLeito,
  type TransferenciaMovimento,
  type TrechoMovimento,
} from '@sgh/contratos';
import { grupoDoTipoSaida } from '@sgh/dominio-internacao';
import type { ContextoNucleo, Leitor, NucleoProprio } from '@sgh/nucleo';
import { ErroProblema } from '../../problema.filter.js';
import { civil, FUSO_PADRAO } from '../exames/relogio.js';
import type {
  CadastroLeitos,
  CensoFechadoLido,
  CtxInternacao,
  FinanceiroDoMes,
  FonteInternacao,
  OperacionalDoMes,
  PacienteDaInternacao,
  RetratoLeitos,
} from './fonte.js';
import type { LeituraCanal, MarcaVigia } from './vigia.js';

export type NucleoInternacao = Pick<NucleoProprio, 'lerSomente'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
/** Teto das leituras do movimento (histórico inteiro do estabelecimento). */
const TETO_MOVIMENTO = 500_000;

/**
 * Tabelas cuja gravação muda cada canal do vigia. A trilha guarda o alvo da operação em `entidade` e TODAS as
 * escritas em `dados_depois.escritas[*].tabela`: o selo confere os dois (uma alta tem como alvo a alta, mas escreve
 * a ocupação e o leito). Os alvos das operações de leito (ADT) também entram, para as escritas por comando livre.
 */
export const TABELAS_DO_CANAL: Readonly<Record<CanalVigia, readonly string[]>> = {
  leitos: [
    'internacao',
    'ocupacao_leito',
    'leito_hospitalar',
    'acomodacao',
    'bloco_internacao',
    'transferencia_leito',
    'solicitacao_transferencia_leito',
    'troca_internacao',
    'reserva_leito',
    'periodo_situacao_leito',
    'pedido_leito',
    'alta_hospitalar',
    'alta_a_pedido',
    'cancelamento_alta',
    'cancelamento_internacao',
    'desfecho_internacao',
    'isolamento_paciente',
    'leito_observacao',
  ],
  senhas: ['senha_emitida', 'evento_senha', 'atendimento_senha'],
  dispensacao: ['dispensacao', 'dispensacao_item'],
  bloco: ['agendamento_cirurgico', 'movimento_paciente_bloco'],
};

/** Posição de um leito pelos códigos do cadastro (bloco, acomodação e leito). */
const SQL_POSICAO = `
  SELECT lh.id, COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao, lh.codigo AS leito,
         ac.categoria_acomodacao_id
    FROM leito_hospitalar lh
    JOIN acomodacao ac ON ac.id = lh.acomodacao_id
    LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
   WHERE lh.estabelecimento_id = ? AND lh.excluido_em IS NULL`;

/** Data civil à meia-noite UTC (a forma do contrato do movimento) e a hora "HHMM", no fuso do estabelecimento. */
function diaEHora(v: unknown, fuso: string): { dia: Date; hora: string } {
  const c = civil(v as Date, fuso);
  return { dia: new Date(`${c.data}T00:00:00Z`), hora: c.hhmm };
}

export class FonteInternacaoPropria implements FonteInternacao {
  readonly destino = 'banco' as const;

  constructor(private readonly nucleo: NucleoInternacao) {}

  private ler<T>(c: CtxInternacao, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const p = c.porta;
    if (!p || p.estabelecimento === null)
      return Promise.reject(
        new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento', 'A sessão não tem estabelecimento.'),
      );
    const est = p.estabelecimento;
    const ctx: ContextoNucleo = {
      cliente: p.cliente,
      estabelecimento: est,
      usuario: p.usuario,
      correlacao: (c.traceId || p.correlacao).slice(0, 64),
    };
    return this.nucleo.lerSomente(ctx, (l) => fn(l, est));
  }

  private async fuso(l: Leitor, est: number): Promise<string> {
    const r = await l.uma<{ fuso_horario: string | null }>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [
      est,
    ]);
    return r?.fuso_horario || FUSO_PADRAO;
  }

  private async posicoes(l: Leitor, est: number): Promise<Map<number, PosicaoLeito & { tipo: number }>> {
    const linhas = await l.consultar(SQL_POSICAO, [est], { teto: 50_000 });
    return new Map(
      linhas.map((r) => [
        n(r['id']),
        {
          bloco: texto(r['bloco']),
          acomodacao: texto(r['acomodacao']),
          leito: texto(r['leito']),
          tipo: n(r['categoria_acomodacao_id']),
        },
      ]),
    );
  }

  private async tipos(l: Leitor): Promise<Map<number, string>> {
    const linhas = await l.consultar('SELECT id, descricao FROM categoria_acomodacao ORDER BY id');
    return new Map(linhas.map((r) => [n(r['id']), texto(r['descricao'])]));
  }

  private async acomodacoes(l: Leitor, est: number): Promise<Linha[]> {
    return l.consultar(
      `SELECT ac.id, COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao, ac.nome, ac.categoria_acomodacao_id,
              ac.tipo_atendimento, ac.ativo
         FROM acomodacao ac LEFT JOIN bloco_internacao b ON b.id = ac.bloco_internacao_id
        WHERE ac.estabelecimento_id = ? AND ac.excluido_em IS NULL
        ORDER BY bloco, ac.codigo`,
      [est],
      { teto: 20_000 },
    );
  }

  /** Leitos com a internação que os ocupa agora (ocupação ativa sem fim). */
  private async leitos(l: Leitor, est: number): Promise<Linha[]> {
    return l.consultar(
      `SELECT lh.id, COALESCE(b.codigo, '') AS bloco, ac.codigo AS acomodacao, lh.codigo AS leito, lh.ativo,
              lh.ramal, lh.andar,
              (SELECT o.internacao_id FROM ocupacao_leito o
                WHERE o.leito_hospitalar_id = lh.id AND o.situacao = 'ativa' AND o.data_hora_fim IS NULL
                  AND o.excluido_em IS NULL ORDER BY o.data_hora_inicio DESC LIMIT 1) AS reg
         FROM leito_hospitalar lh
         JOIN acomodacao ac ON ac.id = lh.acomodacao_id
         LEFT JOIN bloco_internacao b ON b.id = COALESCE(lh.bloco_internacao_id, ac.bloco_internacao_id)
        WHERE lh.estabelecimento_id = ? AND lh.excluido_em IS NULL
        ORDER BY bloco, ac.codigo, lh.codigo`,
      [est],
      { teto: 50_000 },
    );
  }

  leiturasPainel(c: CtxInternacao): Promise<LeiturasPainel> {
    return this.ler(c, async (l, est) => {
      const [blocos, acomodacoes, leitos, tipos, posicoes] = await Promise.all([
        l.consultar(
          `SELECT codigo, nome FROM bloco_internacao
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND ativo = TRUE ORDER BY ordem_exibicao, codigo`,
          [est],
        ),
        this.acomodacoes(l, est),
        this.leitos(l, est),
        this.tipos(l),
        this.posicoes(l, est),
      ]);
      const abertas = await l.consultar(
        `SELECT i.id, i.data_hora_entrada, i.leito_hospitalar_id, pf.nome, pf.data_nascimento, sx.sigla AS sexo,
                fp.nome AS convenio,
                (SELECT ac.categoria_acomodacao_id FROM ocupacao_leito o JOIN acomodacao ac ON ac.id = o.acomodacao_id
                  WHERE o.internacao_id = i.id AND o.situacao = 'ativa' AND o.data_hora_fim IS NULL
                    AND o.excluido_em IS NULL ORDER BY o.data_hora_inicio DESC LIMIT 1) AS tipo_trecho
           FROM internacao i
           JOIN paciente p ON p.id = i.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN sexo sx ON sx.id = pf.sexo_id
           LEFT JOIN fonte_pagadora fp ON fp.id = i.fonte_pagadora_id
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao IN ('ativa', 'alta_medica')
          ORDER BY i.data_hora_entrada`,
        [est],
        { teto: 20_000 },
      );
      const fuso = await this.fuso(l, est);
      return {
        blocos: blocos.map((r) => ({ bloco: texto(r['codigo']), nome: texto(r['nome']) })),
        acomodacoes: acomodacoes
          .filter((r) => r['tipo_atendimento'] !== 'observacao')
          .map((r) => ({
            bloco: texto(r['bloco']),
            acomodacao: texto(r['acomodacao']),
            nome: texto(r['nome']),
            tipo: nn(r['categoria_acomodacao_id']),
          })),
        leitos: leitos.map((r) => ({
          id: n(r['id']),
          bloco: texto(r['bloco']),
          acomodacao: texto(r['acomodacao']),
          leito: texto(r['leito']),
          // Forma do contrato do painel ('A' ativo, 'I' inativo; reg 0 = livre).
          status: verdadeiro(r['ativo']) ? 'A' : 'I',
          reg: n(r['reg']),
          ramal: ramalDe(r['ramal']),
        })),
        abertas: abertas.map((r) => {
          const pos = posicoes.get(n(r['leito_hospitalar_id']));
          return {
            reg: n(r['id']),
            bloco: pos?.bloco ?? '',
            acomodacao: pos?.acomodacao ?? '',
            leito: pos?.leito ?? '',
            entrada: diaEHora(r['data_hora_entrada'], fuso).dia,
            iniciais: iniciaisDoNome(texto(r['nome'])),
            nascimento: r['data_nascimento'] instanceof Date ? r['data_nascimento'] : null,
            sexo: r['sexo'] === null ? null : texto(r['sexo']),
            convenio: r['convenio'] === null ? null : texto(r['convenio']),
            tipoTrecho: nn(r['tipo_trecho']),
          };
        }),
        tipos,
      };
    });
  }

  pacienteDaInternacao(c: CtxInternacao, reg: number): Promise<PacienteDaInternacao | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT i.id, i.data_hora_entrada, pf.nome, fp.nome AS convenio, em.descricao AS clinica
           FROM internacao i
           JOIN paciente p ON p.id = i.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN fonte_pagadora fp ON fp.id = i.fonte_pagadora_id
           LEFT JOIN especialidade_medica em ON em.id = i.especialidade_medica_id
          WHERE i.id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL`,
        [reg, est],
      );
      if (!r) return null;
      return {
        internacao: n(r['id']),
        nome: texto(r['nome']),
        entrada: civil(r['data_hora_entrada'] as Date, await this.fuso(l, est)).data,
        convenio: r['convenio'] === null ? null : texto(r['convenio']),
        clinica: r['clinica'] === null ? null : texto(r['clinica']),
      };
    });
  }

  movimento(c: CtxInternacao): Promise<MovimentoInternacao> {
    return this.ler(c, async (l, est) => {
      const fuso = await this.fuso(l, est);
      const [posicoes, tipos, acomodacoes, leitos] = await Promise.all([
        this.posicoes(l, est),
        this.tipos(l),
        this.acomodacoes(l, est),
        this.leitos(l, est),
      ]);
      const intern = await l.consultar(
        `SELECT i.id, i.paciente_id, i.data_hora_entrada, i.data_hora_alta, i.leito_hospitalar_id,
                ms.tipo_saida, ca.urgencia, em.descricao AS clinica
           FROM internacao i
           JOIN carater_admissao ca ON ca.id = i.carater_admissao_id
           JOIN especialidade_medica em ON em.id = i.especialidade_medica_id
           LEFT JOIN motivo_saida_hospitalar ms ON ms.id = i.motivo_saida_hospitalar_id
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'
          ORDER BY i.data_hora_entrada, i.id`,
        [est],
        { teto: TETO_MOVIMENTO },
      );
      const ocup = await l.consultar(
        `SELECT o.id, o.internacao_id, o.leito_hospitalar_id, o.data_hora_inicio, o.data_hora_fim,
                o.anterior_ocupacao_leito_id, ac.categoria_acomodacao_id
           FROM ocupacao_leito o JOIN acomodacao ac ON ac.id = o.acomodacao_id
          WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.situacao <> 'cancelada'
          ORDER BY o.data_hora_inicio, o.id`,
        [est],
        { teto: TETO_MOVIMENTO },
      );
      const vazio: PosicaoLeito = { bloco: '', acomodacao: '', leito: '' };
      const pos = (id: unknown): PosicaoLeito => {
        const p = posicoes.get(n(id));
        return p ? { bloco: p.bloco, acomodacao: p.acomodacao, leito: p.leito } : vazio;
      };
      // A posição da internação é a do primeiro trecho (a admissão); sem trecho, o leito atual.
      const primeiroLeito = new Map<number, unknown>();
      for (const o of ocup) if (!primeiroLeito.has(n(o['internacao_id']))) primeiroLeito.set(n(o['internacao_id']), o['leito_hospitalar_id']);
      const internacoes: InternacaoMovimento[] = intern.map((r) => {
        const e = diaEHora(r['data_hora_entrada'], fuso);
        const a = r['data_hora_alta'] instanceof Date ? diaEHora(r['data_hora_alta'], fuso) : null;
        return {
          ...pos(primeiroLeito.get(n(r['id'])) ?? r['leito_hospitalar_id']),
          reg: n(r['id']),
          paciente: n(r['paciente_id']),
          entrada: e.dia,
          horaEntrada: e.hora,
          alta: a?.dia ?? null,
          horaAlta: a?.hora ?? null,
          // O id do cadastro não é código de classificação: o grupo vem do tipo de saída (domínio).
          motivo: null,
          grupoSaida: grupoDoTipoSaida(r['tipo_saida'] === null ? null : texto(r['tipo_saida'])),
          // Forma do contrato do motor ('1' eletiva, '2' urgência).
          carater: verdadeiro(r['urgencia']) ? '2' : '1',
          clinica: r['clinica'] === null ? null : texto(r['clinica']),
          // Diárias faturáveis: são do faturamento (conta da internação), não do cadastro da internação.
          permanencia: null,
        };
      });
      const porId = new Map(ocup.map((o) => [n(o['id']), o]));
      const trechos: TrechoMovimento[] = ocup.map((o) => {
        const e = diaEHora(o['data_hora_inicio'], fuso);
        const s = o['data_hora_fim'] instanceof Date ? diaEHora(o['data_hora_fim'], fuso) : null;
        return {
          ...pos(o['leito_hospitalar_id']),
          reg: n(o['internacao_id']),
          cod: n(o['id']),
          entrada: e.dia,
          horaEntrada: e.hora,
          saida: s?.dia ?? null,
          horaSaida: s?.hora ?? null,
          tipo: n(o['categoria_acomodacao_id']),
        };
      });
      const transferencias: TransferenciaMovimento[] = ocup.flatMap((o) => {
        const anterior = porId.get(n(o['anterior_ocupacao_leito_id']));
        if (!anterior) return [];
        const e = diaEHora(o['data_hora_inicio'], fuso);
        return [
          {
            reg: n(o['internacao_id']),
            data: e.dia,
            hora: e.hora,
            origem: pos(anterior['leito_hospitalar_id']),
            destino: pos(o['leito_hospitalar_id']),
          },
        ];
      });
      const unidades = acomodacoes
        .filter((a) => a['tipo_atendimento'] !== 'observacao')
        .map((a) => {
          const daqui = leitos.filter((x) => x['bloco'] === a['bloco'] && x['acomodacao'] === a['acomodacao']);
          return {
            bloco: texto(a['bloco']),
            acomodacao: texto(a['acomodacao']),
            nome: texto(a['nome']),
            tipo: nn(a['categoria_acomodacao_id']),
            leitos: daqui.length,
            leitosAtivos: daqui.filter((x) => verdadeiro(x['ativo'])).length,
          };
        });
      const hoje = civil(new Date(), fuso).data;
      return { internacoes, trechos, transferencias, unidades, tipos, dadosAte: new Date(`${hoje}T00:00:00Z`) };
    });
  }

  /** Cadastro e retrato vêm do mesmo banco (não há espelho de outro sistema): a conferência não acha divergência. */
  conferencia(c: CtxInternacao): Promise<{ cadastro: CadastroLeitos; espelho: RetratoLeitos }> {
    return this.ler(c, async (l, est) => {
      const [blocos, acomodacoes, leitos] = await Promise.all([
        l.consultar(
          'SELECT codigo, nome, quantidade_andares FROM bloco_internacao WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY codigo',
          [est],
        ),
        this.acomodacoes(l, est),
        this.leitos(l, est),
      ]);
      const internas = acomodacoes.filter((a) => a['tipo_atendimento'] !== 'observacao');
      const cadastro: CadastroLeitos = {
        blocos: blocos.map((b) => ({
          bloco: texto(b['codigo']),
          nome: texto(b['nome']),
          andares: nn(b['quantidade_andares']),
        })),
        acomodacoes: internas.map((a) => ({
          bloco: texto(a['bloco']),
          acomodacao: texto(a['acomodacao']),
          nome: texto(a['nome']),
        })),
        leitos: leitos.map((x) => ({
          id: n(x['id']),
          bloco: texto(x['bloco']),
          acomodacao: texto(x['acomodacao']),
          leito: texto(x['leito']),
          ativo: verdadeiro(x['ativo']),
          ocupado: n(x['reg']) > 0,
          ramal: ramalDe(x['ramal']),
          andar: nn(x['andar']),
          reg: n(x['reg']),
        })),
      };
      const espelho: RetratoLeitos = {
        acomodacoes: cadastro.acomodacoes.map((a) => ({ ...a, tipoAtendimento: 'I' as const })),
        leitos: cadastro.leitos.map((x) => ({
          bloco: x.bloco,
          acomodacao: x.acomodacao,
          leito: x.leito,
          tipoAtendimento: 'I' as const,
          ativo: x.ativo,
          ramal: x.ramal,
        })),
        retratos: 1,
      };
      return { cadastro, espelho };
    });
  }

  /** O retrato do censo fechado é gravado pelo fechamento do censo (worker, onda 8): até lá, o motor recalcula. */
  async censoFechado(): Promise<CensoFechadoLido | null> {
    return null;
  }

  diasFechados(c: CtxInternacao, de: string, ate: string): Promise<string[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT DISTINCT data_referencia FROM fechamento_censo
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'fechado'
              AND data_referencia BETWEEN ? AND ?
            ORDER BY data_referencia`,
          [est, de, ate],
        )
      ).map((r) => (r['data_referencia'] as Date).toISOString().slice(0, 10)),
    );
  }

  /** Painel operacional mensal: é do módulo relatório (onda 4); sem a apuração, nenhum mês. */
  async operacional(): Promise<OperacionalDoMes[]> {
    return [];
  }

  /** Painel financeiro mensal: é do módulo relatório (onda 4); sem a apuração, nenhum mês. */
  async financeiro(): Promise<FinanceiroDoMes[]> {
    return [];
  }

  /** O banco do cliente é o de produção (não é cópia diária): os dados valem até agora. */
  async dataDaCopia(): Promise<Date | null> {
    return new Date();
  }

  /**
   * Selo do canal pela trilha de auditoria: `maiorId` é o topo da trilha já varrido; `maiorId2`, a última linha da
   * trilha que escreveu nas tabelas do canal (o selo). Cada ciclo lê só as linhas novas (id acima da marca). O vigia
   * chega sem sessão: o contexto traz só o cliente e o estabelecimento.
   */
  canal(alvo: ContextoNucleo, canal: CanalVigia, marca: MarcaVigia): Promise<LeituraCanal> {
    const est = alvo.estabelecimento;
    if (est === null)
      return Promise.reject(new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento', 'O vigia não tem estabelecimento.'));
    return this.nucleo.lerSomente(alvo, async (l) => {
      const tabelas = TABELAS_DO_CANAL[canal];
      if (marca.maiorId === 0) {
        // Marca perdida ou primeiro ciclo: recomeça do topo da trilha (o vigia já avisa a perda por precaução). O selo
        // tem a mesma forma do ciclo normal, para o ciclo seguinte sem gravação não parecer mudança.
        const t = n((await l.uma('SELECT MAX(id) AS topo FROM trilha_auditoria'))?.['topo']);
        return { selo: `${canal}:${t}`, marca: { maiorId: t, maiorId2: t, janela: 0 }, consultas: 1 };
      }
      const r = await l.uma(
        `SELECT (SELECT MAX(id) FROM trilha_auditoria) AS topo,
                (SELECT MAX(id) FROM trilha_auditoria
                  WHERE id > ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
                    AND (entidade IN (${lista(tabelas.length)})
                         OR JSON_OVERLAPS(JSON_EXTRACT(dados_depois, '$.escritas[*].tabela'), ?))) AS ultimo`,
        [marca.maiorId, est, ...tabelas, JSON.stringify(tabelas)],
      );
      const topo = Math.max(marca.maiorId, n(r?.['topo']));
      const ultimo = Math.max(marca.maiorId2, n(r?.['ultimo']));
      return { selo: `${canal}:${ultimo}`, marca: { maiorId: topo, maiorId2: ultimo, janela: 0 }, consultas: 1 };
    });
  }
}

function ramalDe(v: unknown): number | null {
  const s = texto(v).replace(/\D/g, '');
  return s ? Number(s) : null;
}
