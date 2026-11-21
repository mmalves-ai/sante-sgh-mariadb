// Porta da enfermagem EM MEMÓRIA (M25): a sessão sintética de dev/ci (E2E) trabalha numa UTI e numa enfermaria
// SINTÉTICAS, com pacientes, prescrições e horários sintéticos gerados em torno do relógio (doses atrasadas, a checar e
// futuras; alta vigilância, hemocomponente, glicemia com a escala, infusão contínua, "se necessário", antimicrobiano),
// sem tocar a cópia. A checagem aplica o mesmo Zod da receita (operacao(op).entrada) e as mesmas recusas (CBO de outro
// login, categoria que não checa, prescrição suspensa, horário suspenso ou já checado depois da leitura, situação
// nunca vista, não administrado sem motivo), com a mesma chave de idempotência. O "outro sistema" (a suspensão feita
// na prescrição e a checagem feita em outro terminal) vem do arquivo do E2E (`arquivoPorFora`). Nada é de pessoa real
// (marca "SINTETICO M25").
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { FaixaGlicemiaLida } from '@sgh/contratos';
import {
  type AprazamentoRegistrado,
  type AtoChecagem,
  type ConflitoSincronizacao,
  type AparelhoBeiraLeito,
  type EventoHistoricoHorario,
  type EventoInfusao,
  type HorarioEnfermagem,
  type Internado,
  type PassagemPlantao,
  type RegraHorario,
  type SinalVitalRegistrado,
  type UnidadeComInternados,
} from './tipos.js';
import {
  type AprazamentoHorario,
  type ChecagemAdministracao,
  ESQUEMAS_CHECAGEM,
  type EstornoChecagem,
  justificativaDoEstorno,
  OPERACOES_CHECAGEM,
  recusaEstoqueBaixado,
} from './checagem.js';
import { type ContextoOperacao, ErroOperacao, recusa, type ResultadoOperacao } from '@sgh/nucleo';
import { type LiberacaoGravacao } from '../exames/public-api.js';
import { relogioDoEstabelecimento } from '../recepcao/porta-memoria.js';
import type { ContextoEnfermagem, GravadorSghEnfermagem, PortaEnfermagem } from './porta.js';

const M = 'SINTETICO M25';
/**
 * O estado sintético é por estabelecimento da sessão: o código do estabelecimento que a sessão sintética põe no contexto
 * (sem o mapa de estabelecimentos do banco, o id é nulo) ou, sem ele, o cliente e o id do estabelecimento.
 */
export const chaveDoEstado = (c: Pick<ContextoEnfermagem, 'cliente' | 'estabelecimento'>): string =>
  (c as { readonly hospital?: string }).hospital ?? `${c.cliente}|${c.estabelecimento ?? '-'}`;
/** O login da sessão que a API põe no contexto da gravação (a memória identifica o vínculo sintético por ele). */
const loginDe = (ctx: ContextoOperacao): string =>
  (ctx as ContextoOperacao & { readonly login?: string }).login ?? String(ctx.usuario ?? '');
const p2 = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) =>
  `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
const somar = (t: string, min: number) => local(new Date(Date.parse(`${t.slice(0, 16)}:00Z`) + min * 60_000));

/** Os vínculos de enfermagem dos logins sintéticos (CBO 2235 enfermeiro; 3222 técnico). */
export const VINCULOS_SINTETICOS: Readonly<Record<string, { cbo: number; codigo: string; nome: string }>> = {
  'SINT.ENF.PLANTAO': { cbo: 92501, codigo: '223505', nome: `ENFERMEIRA ${M} PLANTAO` },
  'SINT.ENF.APOIO': { cbo: 92502, codigo: '223505', nome: `ENFERMEIRO ${M} APOIO` },
  'SINT.TECNICO.ENF': { cbo: 92503, codigo: '322205', nome: `TECNICA ${M}` },
  'SINT.SUPERVISOR.ENF': { cbo: 92504, codigo: '223505', nome: `SUPERVISORA ${M}` },
};

interface HorarioM {
  id: number;
  item: number;
  prescricao: number;
  atendimento: number;
  previsto: string;
  situacao: string;
  checadoEm: string | null;
  cbo: number | null;
  quantidade: number | null;
  justificativa: string | null;
  tipo: HorarioEnfermagem['tipo'];
  descricao: string;
  dose: number | null;
  unidadeDose: string | null;
  via: string | null;
  produto: number | null;
  barras: string | null;
  seNecessario: boolean;
  altaVigilancia: boolean;
  antimicrobiano: boolean;
  hemocomponente: boolean;
  infusao: HorarioEnfermagem['infusao'];
  faixasGlicemia: FaixaGlicemiaLida[];
  faixa: number | null;
  procedimento: number | null;
  numDoses: number;
  observacaoMedica: string | null;
  historico: EventoHistoricoHorario[];
}

interface EstadoM {
  seq: number;
  internados: (Internado & { prescricao: number; suspensa: boolean })[];
  horarios: HorarioM[];
  atos: AtoChecagem[];
  infusao: EventoInfusao[];
  sinais: SinalVitalRegistrado[];
  aprazamentos: (AprazamentoRegistrado & { id: number })[];
  conflitos: ConflitoSincronizacao[];
  passagens: PassagemPlantao[];
  dispositivos: ({ -readonly [K in keyof AparelhoBeiraLeito]: AparelhoBeiraLeito[K] } & { hash: string })[];
  /** W0-03: checagens antigas feitas por aparelho (só os identificadores; a contagem da recusa de exclusão). */
  checagensDeAparelho: string[];
  respostas: {
    registro: number;
    componente: string;
    chave: string;
    valor: string | null;
    referencia: number | null;
  }[];
  idempotencia: Map<string, { hash: string; usuario: string; resultado: ResultadoOperacao }>;
  /** Mudanças de situação (para a vigia): horário → instante. */
  mudancas: { id: number; situacao: string; quando: string }[];
  forasAplicados: Set<string>;
}

interface PorFora {
  /** Horários suspensos pela prescrição (neste ou no outro sistema). */
  readonly suspensos?: readonly number[];
  /** Horários checados em outro terminal. */
  readonly checados?: readonly { id: number; situacao: string }[];
}

export class PortaEnfermagemMemoria implements PortaEnfermagem {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, EstadoM>();

  constructor(
    private readonly opcoes: { readonly arquivoPorFora?: string | null; readonly agora?: () => Date } = {},
  ) {}

  private relogioAtual(): string {
    return relogioDoEstabelecimento(this.opcoes.agora?.() ?? new Date()).agora;
  }

  /** O arquivo do E2E (o outro sistema): cada linha nova é aplicada uma vez. */
  private aplicarPorFora(s: EstadoM): void {
    const arq = this.opcoes.arquivoPorFora;
    if (!arq) return;
    let x: PorFora;
    try {
      x = JSON.parse(readFileSync(arq, 'utf8')) as PorFora;
    } catch {
      return;
    }
    const agora = this.relogioAtual().slice(0, 16);
    for (const id of x.suspensos ?? []) {
      const k = `s:${id}`;
      if (s.forasAplicados.has(k)) continue;
      s.forasAplicados.add(k);
      const h = s.horarios.find((y) => y.id === id);
      if (h && h.situacao === 'P') this.mudar(s, h, 'S', agora, null, 'Suspenso na prescrição');
    }
    for (const c of x.checados ?? []) {
      const k = `c:${c.id}`;
      if (s.forasAplicados.has(k)) continue;
      s.forasAplicados.add(k);
      const h = s.horarios.find((y) => y.id === c.id);
      if (h && h.situacao === 'P') this.mudar(s, h, c.situacao, agora, 9_000, null);
    }
  }

  private mudar(
    s: EstadoM,
    h: HorarioM,
    situacao: string,
    quando: string,
    cbo: number | null,
    j: string | null,
  ) {
    h.situacao = situacao;
    h.checadoEm = situacao === 'A' || situacao === 'N' ? quando : null;
    h.cbo = cbo;
    h.justificativa = j;
    h.historico.push({ quando, origem: 'historico', situacao, aprazamento: null, cbo, justificativa: j });
    s.mudancas.push({ id: h.id, situacao, quando });
  }

  private e(c: Pick<ContextoEnfermagem, 'cliente' | 'estabelecimento'>): EstadoM {
    const k = chaveDoEstado(c);
    let s = this.estados.get(k);
    if (!s) {
      s = this.semear(k);
      this.estados.set(k, s);
    }
    this.aplicarPorFora(s);
    return s;
  }

  /** O estado sintético inicial, em torno do relógio (uma vez por estabelecimento). */
  private semear(HOSPITAL_SEMENTE: string): EstadoM {
    const agora = this.relogioAtual().slice(0, 16);
    const s: EstadoM = {
      seq: 26_000,
      internados: [],
      horarios: [],
      atos: [],
      infusao: [],
      sinais: [],
      aprazamentos: [],
      conflitos: [],
      passagens: [],
      dispositivos: [],
      checagensDeAparelho: [],
      respostas: [],
      idempotencia: new Map(),
      mudancas: [],
      forasAplicados: new Set(),
    };
    // W0-03: o tablet do posto da UTI, autorizado há tempo, com 3 checagens feitas nele (a exclusão é recusada com a
    // contagem; retirar é o caminho).
    const tabletPosto = 'tablet-sintetico-posto-uti';
    s.dispositivos.push({
      id: ++s.seq,
      hash: createHash('sha256').update(`${HOSPITAL_SEMENTE}:${tabletPosto}`).digest('hex'),
      nome: 'Tablet do posto da UTI',
      unidade: 'UTI',
      tipo: 'tablet',
      ativo: true,
      ultimoSincronismo: null,
      cadastradoPor: 'SINT.SUPERVISOR.ENF',
    });
    s.checagensDeAparelho.push(tabletPosto, tabletPosto, tabletPosto);
    const pacientes = [
      { n: 1, nome: `PACIENTE ${M} UM`, leito: 'UTI-01', unidade: 'UTI', alergia: true },
      { n: 2, nome: `PACIENTE ${M} DOIS`, leito: 'UTI-02', unidade: 'UTI', alergia: false },
      { n: 3, nome: `PACIENTE ${M} TRES`, leito: 'UTI-03', unidade: 'UTI', alergia: false },
      { n: 4, nome: `PACIENTE ${M} QUATRO`, leito: '101-A', unidade: 'ENF1', alergia: false },
    ];
    for (const p of pacientes)
      s.internados.push({
        paciente: 25_000 + p.n,
        atendimento: 25_100 + p.n,
        numero: 25_200 + p.n,
        nome: p.nome,
        leito: p.leito,
        unidade: p.unidade,
        alergia: p.alergia,
        prescricao: 25_300 + p.n,
        suspensa: false,
      });
    let item = 25_400;
    const novoItem = () => ++item;
    const base = (pac: number): Pick<HorarioM, 'prescricao' | 'atendimento'> => ({
      prescricao: 25_300 + pac,
      atendimento: 25_100 + pac,
    });
    const h = (pac: number, it: number, minutos: number, x: Partial<HorarioM>): HorarioM => ({
      id: ++s.seq,
      item: it,
      ...base(pac),
      previsto: somar(agora, minutos),
      situacao: 'P',
      checadoEm: null,
      cbo: null,
      quantidade: null,
      justificativa: null,
      tipo: 'medicamento',
      descricao: '',
      dose: null,
      unidadeDose: null,
      via: null,
      produto: null,
      barras: null,
      seNecessario: false,
      altaVigilancia: false,
      antimicrobiano: false,
      hemocomponente: false,
      infusao: null,
      faixasGlicemia: [],
      faixa: null,
      procedimento: null,
      numDoses: 4,
      observacaoMedica: null,
      historico: [],
      ...x,
    });
    const dipirona = novoItem();
    const med = (pac: number, it: number, min: number, x: Partial<HorarioM> = {}) =>
      h(pac, it, min, {
        tipo: 'medicamento',
        descricao: `DIPIRONA ${M} 1 G`,
        dose: 1,
        unidadeDose: 'G',
        via: 'EV',
        produto: 601,
        barras: '7891000100014',
        ...x,
      });
    s.horarios.push(
      med(1, dipirona, -120),
      med(1, dipirona, -20),
      med(1, dipirona, 240),
      med(1, dipirona, 600),
    );
    // Glicemia capilar com a escala (duas faixas por horário: linhas próprias, como o banco grava).
    const gli = novoItem();
    const faixas: FaixaGlicemiaLida[] = [
      { id: 25_600, de: 161, ate: 200, dose: 2, unidade: 'UI', produto: 605 },
      { id: 25_601, de: 201, ate: 300, dose: 4, unidade: 'UI', produto: 605 },
    ];
    for (const min of [-10, 350]) {
      s.horarios.push(
        h(1, gli, min, {
          tipo: 'glicemia',
          descricao: `GLICEMIA CAPILAR ${M}`,
          procedimento: 25_501,
          faixasGlicemia: faixas,
        }),
      );
      faixas.forEach((f, i) =>
        s.horarios.push(
          h(1, gli, min, {
            tipo: 'glicemia',
            descricao: `Escala da glicemia ${f.de} a ${f.ate}`,
            faixa: 25_600 + i,
            dose: f.dose,
            unidadeDose: f.unidade,
            produto: f.produto,
            procedimento: 25_501,
          }),
        ),
      );
    }
    s.horarios.push(
      h(1, novoItem(), 60, {
        tipo: 'cuidado',
        descricao: `CURATIVO ${M}`,
        procedimento: 25_502,
        numDoses: 1,
      }),
    );
    // Alta vigilância (dupla checagem), infusão contínua e hemocomponente.
    s.horarios.push(
      h(2, novoItem(), -15, {
        descricao: `MORFINA ${M} 2 MG`,
        dose: 2,
        unidadeDose: 'MG',
        via: 'EV',
        produto: 603,
        barras: '7891000300032',
        altaVigilancia: true,
      }),
      h(2, novoItem(), -45, {
        tipo: 'solucao',
        descricao: `SORO FISIOLOGICO ${M} 0,9% 500 ML`,
        dose: 500,
        unidadeDose: 'ML',
        via: 'EV',
        produto: 610,
        barras: '7891000700012',
        infusao: { solucao: 25_701, velocidadeMlH: 83, ajustavel: true },
        numDoses: 1,
      }),
      h(2, novoItem(), 30, {
        tipo: 'hemoterapia',
        descricao: `CONCENTRADO DE HEMACIAS ${M}`,
        dose: 1,
        unidadeDose: 'UN',
        hemocomponente: true,
        numDoses: 1,
      }),
    );
    // Antimicrobiano (tempo crítico) e "se necessário".
    const cef = novoItem();
    s.horarios.push(
      h(3, cef, -90, {
        descricao: `CEFTRIAXONA ${M} 1 G`,
        dose: 1,
        unidadeDose: 'G',
        via: 'EV',
        produto: 602,
        barras: '7891000200025',
        antimicrobiano: true,
        numDoses: 2,
      }),
      h(3, cef, 30, {
        descricao: `CEFTRIAXONA ${M} 1 G`,
        dose: 1,
        unidadeDose: 'G',
        via: 'EV',
        produto: 602,
        barras: '7891000200025',
        antimicrobiano: true,
        numDoses: 2,
      }),
      h(3, novoItem(), 0, {
        descricao: `ONDANSETRONA ${M} 4 MG`,
        dose: 4,
        unidadeDose: 'MG',
        via: 'EV',
        produto: 604,
        barras: '7891000400049',
        seNecessario: true,
      }),
    );
    s.horarios.push(
      h(4, novoItem(), 10, {
        descricao: `OMEPRAZOL ${M} 40 MG`,
        dose: 40,
        unidadeDose: 'MG',
        via: 'EV',
        produto: 606,
        barras: '7891000600066',
      }),
    );
    for (const x of s.horarios)
      x.historico.push({
        quando: somar(agora, -600),
        origem: 'historico',
        situacao: 'P',
        aprazamento: null,
        cbo: 7001,
        justificativa: null,
      });
    return s;
  }

  private lido(s: EstadoM, h: HorarioM): HorarioEnfermagem {
    return {
      id: h.id,
      item: h.item,
      prescricao: h.prescricao,
      atendimento: h.atendimento,
      previsto: h.previsto,
      situacao: h.situacao,
      checadoEm: h.checadoEm,
      cboChecagem: h.cbo,
      quantidade: h.quantidade,
      tipo: h.tipo,
      descricao: h.descricao,
      dose: h.dose,
      unidadeDose: h.unidadeDose,
      via: h.via,
      produto: h.produto,
      barras: h.barras,
      seNecessario: h.seNecessario,
      altaVigilancia: h.altaVigilancia,
      antimicrobiano: h.antimicrobiano,
      duplaMarcada: h.altaVigilancia,
      hemocomponente: h.hemocomponente,
      infusao: h.infusao,
      faixasGlicemia: h.faixasGlicemia,
      faixa: h.faixa,
      procedimento: h.procedimento,
      aprazamento: 1,
      numDoses: h.numDoses,
      observacaoMedica: h.observacaoMedica,
    };
    void s;
  }

  async podeGravar(c: ContextoEnfermagem, op: string): Promise<LiberacaoGravacao> {
    void c;
    if (!(OPERACOES_CHECAGEM as readonly string[]).includes(op))
      return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida.' };
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoEnfermagem, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    const s = this.e(c);
    const esquema = ESQUEMAS_CHECAGEM[op as keyof typeof ESQUEMAS_CHECAGEM];
    if (!esquema) throw recusa('operacao-desconhecida', 'Operação desconhecida na enfermagem.');
    const analise = esquema.safeParse(entradaBruta);
    if (!analise.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(analise.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const hash = createHash('sha256')
      .update(`${op}:${JSON.stringify(analise.data)}`)
      .digest('hex');
    const ja = s.idempotencia.get(ctx.chaveIdempotencia);
    if (ja) {
      if (ja.hash !== hash || ja.usuario !== loginDe(ctx))
        throw new ErroOperacao(
          422,
          'idempotencia-divergente',
          'Chave reutilizada',
          'A mesma chave foi usada com outro pedido.',
        );
      return { resultado: ja.resultado, repetida: true, trilha: null };
    }
    if (op === 'enfermagem.estornarChecagem')
      return this.estornar(s, analise.data as EstornoChecagem, ctx, hash);
    if (op === 'enfermagem.aprazarHorario')
      return this.aprazar(s, analise.data as AprazamentoHorario, ctx, hash);
    if (op !== 'enfermagem.checarAdministracao') throw new Error(`Operação ${op} sem simulação em memória.`);
    const e = analise.data as ChecagemAdministracao;
    const v = VINCULOS_SINTETICOS[loginDe(ctx)];
    if (!v || v.cbo !== e.cbo)
      throw recusa('cbo-invalido', 'O CBO informado não é do profissional da sessão ou não está ativo.');
    const pres = s.internados.find((x) => x.prescricao === e.prescricao);
    if (!pres || pres.atendimento !== e.atendimento)
      throw recusa('prescricao-inexistente', 'Prescrição não encontrada.');
    if (pres.suspensa) throw recusa('horario-suspenso', 'A prescrição está suspensa: nada foi gravado.');
    const principal = e.marcacoes.find((m) => m.papel === 'principal') ?? e.marcacoes[0]!;
    if (principal.situacao === 'N' && !(e.sgh.motivo ?? '').trim())
      throw recusa('motivo-obrigatorio', 'O não administrado exige o motivo da lista.');
    const hs = e.marcacoes.map((m) => {
      const h = s.horarios.find((x) => x.id === m.horario);
      if (!h || h.item !== m.item || h.prescricao !== e.prescricao)
        throw recusa('horario-inexistente', 'O horário não é deste item da prescrição.');
      if (h.situacao !== m.situacaoLida || h.situacao !== 'P') {
        if (['S', 'C', 'X'].includes(h.situacao))
          throw recusa(
            'horario-suspenso',
            'O horário foi suspenso depois que a tela foi aberta: nada foi gravado.',
          );
        if (h.situacao === 'A' || h.situacao === 'N')
          throw recusa('horario-ja-checado', 'O horário já foi checado em outro terminal: nada foi gravado.');
        throw recusa(
          'horario-mudou',
          'A situação do horário mudou depois que a tela foi aberta: nada foi gravado.',
        );
      }
      return { m, h };
    });
    const agora = this.relogioAtual().slice(0, 16);
    for (const { m, h } of hs) {
      this.mudar(s, h, m.situacao, agora, e.cbo, m.justificativa);
      h.quantidade = m.quantidade;
      s.atos.push({
        id: ++s.seq,
        horario: h.id,
        tipo: 'checagem',
        situacao: m.situacao,
        horaReal: e.sgh.horaReal.slice(0, 16),
        gravadoEm: agora,
        usuario: loginDe(ctx),
        quantidade: m.quantidade,
        motivo: m.papel === 'principal' ? e.sgh.motivo : null,
        observacao: m.papel === 'principal' ? e.sgh.observacao : 'Fora da faixa da glicemia medida',
        pulseiraLida: e.sgh.pulseiraLida,
        motivoSemPulseira: e.sgh.motivoSemPulseira,
        gtin: m.papel === 'principal' ? e.sgh.gtin : null,
        lote: m.papel === 'principal' ? e.sgh.lote : null,
        validade: m.papel === 'principal' ? e.sgh.validade : null,
        conferente: e.sgh.conferente,
        dispositivo: e.sgh.dispositivo,
        origemOffline: e.sgh.origemOffline,
        avisos: e.sgh.avisos.join(' | ') || null,
      });
    }
    if (e.glicemia !== null)
      s.sinais.push({
        id: ++s.seq,
        paciente: e.paciente,
        atendimento: e.atendimento,
        horario: principal.horario,
        tipo: 'glicemia',
        valor: e.glicemia,
        unidade: 'mg/dL',
        metodo: 'capilar',
        foraDaFaixa: e.glicemia < 70 || e.glicemia > 250,
        horaReal: e.sgh.horaReal.slice(0, 16),
        versao: 1,
        anterior: null,
        justificativa: null,
        usuario: loginDe(ctx),
      });
    const resultado: ResultadoOperacao = {
      horario: principal.horario,
      horarios: e.marcacoes.length,
      documentos: new Set(e.marcacoes.map((m) => m.situacao)).size,
    };
    s.idempotencia.set(ctx.chaveIdempotencia, { hash, usuario: loginDe(ctx), resultado });
    return { resultado, repetida: false, trilha: null };
  }

  /**
   * W1-08: o estorno como o executor grava (o horário volta a "P", o retrato no histórico, o pedido com o motivo). A
   * dose sintética que baixa estoque é a da morfina (produto 603, alta vigilância): administrada, tem a baixa e o
   * estorno é recusado sem a devolução pendente.
   */
  private estornar(s: EstadoM, e: EstornoChecagem, ctx: ContextoOperacao, hash: string) {
    const v = VINCULOS_SINTETICOS[loginDe(ctx)];
    if (!v || v.cbo !== e.cbo)
      throw recusa('cbo-invalido', 'O CBO informado não é do profissional da sessão ou não está ativo.');
    const h = s.horarios.find((x) => x.id === e.horario);
    if (!h) throw recusa('horario-inexistente', 'O horário não foi encontrado.');
    const pres = s.internados.find((x) => x.prescricao === h.prescricao);
    if (!pres || pres.paciente !== e.paciente)
      throw recusa('horario-inexistente', 'O horário não é deste paciente.');
    if (h.situacao !== 'A' && h.situacao !== 'N')
      throw recusa('horario-nao-checado', 'O horário não está checado: nada a estornar.');
    const baixa = { integracoes: h.situacao === 'A' && h.produto === 603 ? 1 : 0, dispensacoes: 0 };
    const temBaixa = baixa.integracoes + baixa.dispensacoes > 0;
    if (temBaixa && !e.devolucaoPendente) throw recusaEstoqueBaixado(baixa);
    const anterior = h.situacao;
    const agora = this.relogioAtual().slice(0, 16);
    this.mudar(s, h, 'P', agora, e.cbo, justificativaDoEstorno(e));
    h.quantidade = null;
    const id = ++s.seq;
    s.atos.push({
      id,
      horario: h.id,
      tipo: 'estorno',
      situacao: anterior,
      horaReal: agora,
      gravadoEm: agora,
      usuario: loginDe(ctx),
      quantidade: null,
      motivo: e.motivo,
      observacao: e.justificativa,
      pulseiraLida: false,
      motivoSemPulseira: null,
      gtin: null,
      lote: null,
      validade: null,
      conferente: null,
      dispositivo: null,
      origemOffline: false,
      avisos: temBaixa ? 'Devolução da dose pendente' : null,
    });
    const resultado: ResultadoOperacao = {
      horario: h.id,
      item: h.item,
      prescricao: h.prescricao,
      atendimento: h.atendimento,
      situacaoAnterior: anterior,
      idHistorico: id,
      integracoes: baixa.integracoes,
      dispensacoes: baixa.dispensacoes,
      devolucaoPendente: temBaixa,
    };
    s.idempotencia.set(ctx.chaveIdempotencia, { hash, usuario: loginDe(ctx), resultado });
    return Promise.resolve({ resultado, repetida: false, trilha: null });
  }

  /** W1-08: o aprazamento como o executor grava (reaprazar substitui a hora de checar; suprimir só com o motivo). */
  private aprazar(s: EstadoM, e: AprazamentoHorario, ctx: ContextoOperacao, hash: string) {
    const v = VINCULOS_SINTETICOS[loginDe(ctx)];
    if (!v || v.cbo !== e.cbo)
      throw recusa('cbo-invalido', 'O CBO informado não é do profissional da sessão ou não está ativo.');
    if (e.acao !== 'aprazar' && !(e.motivo ?? '').trim())
      throw recusa('motivo-obrigatorio', 'Reaprazar e suprimir exigem o motivo.');
    if (e.acao !== 'suprimir' && !e.confirmado)
      throw recusa('hora-obrigatoria', 'Informe a hora confirmada.');
    const h = s.horarios.find((x) => x.id === e.horario);
    if (!h || h.situacao !== 'P') throw recusa('horario-mudou', 'O horário não está mais a checar.');
    if (h.item !== e.item || h.prescricao !== e.prescricao)
      throw recusa('horario-inexistente', 'O horário não é deste item da prescrição.');
    const origem = h.previsto;
    const situacaoAprazamento = { aprazar: 3, reaprazar: 5, suprimir: 4 }[e.acao];
    if (e.acao === 'reaprazar' && e.confirmado) h.previsto = e.confirmado;
    h.historico.push({
      quando: this.relogioAtual().slice(0, 16),
      origem: 'historico',
      situacao: 'P',
      aprazamento: situacaoAprazamento,
      cbo: e.cbo,
      justificativa: e.motivo,
    });
    const resultado: ResultadoOperacao = {
      horario: h.id,
      situacaoAprazamento,
      origem,
      destino: e.confirmado,
      reaprazamento: e.acao === 'reaprazar',
      extrato: h.tipo === 'medicamento' || h.tipo === 'solucao',
    };
    s.idempotencia.set(ctx.chaveIdempotencia, { hash, usuario: loginDe(ctx), resultado });
    return Promise.resolve({ resultado, repetida: false, trilha: null });
  }

  async gravarSgh<T>(
    c: ContextoEnfermagem,
    _trilha: unknown,
    fn: (g: GravadorSghEnfermagem) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const agora = () => this.relogioAtual().slice(0, 16);
    const g: GravadorSghEnfermagem = {
      gravarSinal: async (x) => {
        const id = ++s.seq;
        s.sinais.push({
          id,
          paciente: x.paciente,
          atendimento: x.atendimento,
          horario: x.horario,
          tipo: x.tipo,
          valor: x.valor,
          unidade: x.unidade,
          metodo: x.metodo,
          foraDaFaixa: x.foraDaFaixa,
          horaReal: x.horaReal.slice(0, 16),
          versao: 1,
          anterior: null,
          justificativa: null,
          usuario: x.usuario,
        });
        return id;
      },
      retificarSinal: async (x) => {
        const a = s.sinais.find((y) => y.id === x.id);
        if (!a) throw recusa('sinal-inexistente', 'O sinal vital não foi encontrado.');
        if (s.sinais.some((y) => y.anterior === a.id))
          throw recusa('sinal-ja-retificado', 'Este registro já foi retificado: retifique a versão vigente.');
        if (x.versao !== undefined && x.versao !== a.versao)
          throw recusa('conflito-versao', 'O sinal vital mudou desde a leitura: recarregue e retifique de novo.');
        const id = ++s.seq;
        s.sinais.push({
          ...a,
          id,
          valor: x.valor,
          foraDaFaixa: x.foraDaFaixa,
          versao: a.versao + 1,
          anterior: a.id,
          justificativa: x.justificativa,
          usuario: x.usuario,
        });
        return id;
      },
      gravarEventoInfusao: async (x) => {
        const id = ++s.seq;
        s.infusao.push({
          id,
          horario: x.horario,
          evento: x.evento,
          velocidadeMlH: x.velocidadeMlH,
          volumeInfundidoMl: x.volumeMl,
          horaReal: x.horaReal.slice(0, 16),
          usuario: x.usuario,
        });
        return id;
      },
      gravarAprazamento: async (x) => {
        const id = ++s.seq;
        s.aprazamentos.push({
          id,
          horario: x.horario,
          acao: x.acao,
          proposto: x.proposto.slice(0, 16),
          confirmado: x.confirmado ? x.confirmado.slice(0, 16) : null,
          motivo: x.motivo,
          usuario: x.usuario,
        });
        return id;
      },
      registrarConflito: async (x) => {
        const ja = s.conflitos.find((y) => y.chave === x.chave);
        if (ja) return { id: ja.id, novo: false };
        const id = ++s.seq;
        s.conflitos.push({
          id,
          horario: x.horario,
          paciente: x.paciente,
          chave: x.chave,
          tipo: x.tipo,
          situacaoEncontrada: x.situacaoEncontrada,
          desfechoTentado: x.desfechoTentado,
          horaReal: x.horaReal.slice(0, 16),
          dispositivo: x.dispositivo,
          usuario: x.usuario,
          registradoEm: agora(),
          resolucao: null,
          resolvidoPor: null,
          resolvidoEm: null,
          observacao: null,
        });
        return { id, novo: true };
      },
      resolverConflito: async (x) => {
        const k = s.conflitos.find((y) => y.id === x.id && y.resolvidoEm === null);
        if (!k) throw recusa('conflito-resolvido', 'O conflito não existe ou já foi resolvido.');
        Object.assign(k, {
          resolucao: x.resolucao,
          resolvidoPor: x.usuario,
          resolvidoEm: agora(),
          observacao: x.observacao,
        });
        return x.id;
      },
      passarPlantao: async (x) => {
        if (
          s.passagens.some(
            (p) =>
              p.unidade === x.unidade &&
              p.data === x.data &&
              p.turno === x.turno &&
              p.situacao === 'aguardandoAceite',
          )
        )
          throw recusa(
            'plantao-aguardando',
            'Já há uma passagem deste plantão aguardando o aceite de quem recebe.',
          );
        const id = ++s.seq;
        s.passagens.unshift({
          id,
          unidade: x.unidade,
          turno: x.turno,
          data: x.data,
          passadoPor: x.passadoPor,
          recebedor: x.recebedor,
          situacao: 'aguardandoAceite',
          passadoEm: agora(),
          respondidoEm: null,
          observacao: null,
          cancelamento: null,
          notas: x.notas.map((n) => ({ ...n, pendencias: [...n.pendencias] })),
        });
        return id;
      },
      responderPlantao: async (x) => {
        const p = s.passagens.find((y) => y.id === x.id);
        if (!p || p.situacao !== 'aguardandoAceite' || p.recebedor !== x.usuario)
          throw recusa('plantao-respondido', 'A passagem não existe, já foi respondida ou não é sua.');
        Object.assign(p, {
          situacao: x.aceite ? 'aceita' : 'recusada',
          respondidoEm: agora(),
          observacao: x.observacao,
        });
        return x.id;
      },
      gravarDispositivo: async (x) => {
        const hash = createHash('sha256')
          .update(`${chaveDoEstado(c)}:${x.identificador}`)
          .digest('hex');
        if (s.dispositivos.some((d) => d.hash === hash))
          throw recusa('dispositivo-existente', 'Este aparelho já está autorizado.');
        const id = ++s.seq;
        s.dispositivos.push({
          id,
          hash,
          nome: x.nome,
          unidade: x.unidade,
          tipo: x.tipo,
          ativo: true,
          ultimoSincronismo: null,
          cadastradoPor: x.usuario,
        });
        return id;
      },
      alterarDispositivo: async (x) => {
        const d = s.dispositivos.find((y) => y.id === x.id);
        if (!d) throw recusa('dispositivo-inexistente', 'O aparelho não foi encontrado.');
        if (!x.motivo || x.motivo.trim().length < 10)
          throw recusa('motivo-obrigatorio', 'Descreva o motivo da alteração do aparelho.');
        // Revisão W0-03: o valor anterior guardado antes da alteração (com o motivo, quem e quando).
        d.versoes = [
          ...(d.versoes ?? []),
          {
            versao: (d.versoes?.length ?? 0) + 1,
            nome: d.nome,
            unidade: d.unidade,
            ativo: d.ativo,
            motivo: x.motivo,
            usuario: x.usuario ?? '',
            em: new Date().toISOString().slice(0, 16),
          },
        ];
        if (x.ativo !== undefined) d.ativo = x.ativo;
        if (x.nome !== undefined) d.nome = x.nome.slice(0, 60);
        if (x.unidade !== undefined) d.unidade = x.unidade.slice(0, 5);
        return x.id;
      },
      excluirDispositivo: async (x) => {
        const k = s.dispositivos.findIndex((y) => y.id === x.id);
        const d = s.dispositivos[k];
        if (!d) throw recusa('dispositivo-inexistente', 'O aparelho não foi encontrado.');
        const doAparelho = (id: string | null) =>
          !!id &&
          createHash('sha256')
            .update(`${chaveDoEstado(c)}:${id}`)
            .digest('hex') === d.hash;
        const checagens =
          s.atos.filter((a) => doAparelho(a.dispositivo)).length +
          s.checagensDeAparelho.filter((x) => doAparelho(x)).length;
        const conflitos = s.conflitos.filter((a) => doAparelho(a.dispositivo)).length;
        const grupos = [
          ...(checagens ? [`${checagens} checagens feitas no aparelho`] : []),
          ...(conflitos ? [`${conflitos} conflitos de sincronização do aparelho`] : []),
        ];
        if (checagens + conflitos > 0)
          throw recusa(
            'dispositivo-com-leituras',
            `O aparelho tem ${checagens + conflitos} leitura(s) vinculada(s) (${grupos.join('; ')}): não pode ser excluído. Retire-o do modo beira do leito (inativar).`,
          );
        s.dispositivos.splice(k, 1);
        return x.id;
      },
      cancelarPlantao: async (x) => {
        const p = s.passagens.find((y) => y.id === x.id);
        if (!p) throw recusa('plantao-inexistente', 'A passagem não existe.');
        if (p.situacao !== 'aguardandoAceite')
          throw recusa(
            'plantao-ja-respondido',
            p.situacao === 'cancelada'
              ? 'A passagem já foi cancelada.'
              : 'A passagem já foi respondida por quem recebe: depois do aceite, não se cancela.',
          );
        if (p.passadoPor !== x.usuario)
          throw recusa('plantao-de-outro', 'Só quem passou o plantão pode cancelar a passagem.');
        Object.assign(p, {
          situacao: 'cancelada',
          cancelamento: { motivo: x.motivo, por: x.usuario, em: agora() },
        });
        return x.id;
      },
      marcarSincronismo: async (x) => {
        const hash = createHash('sha256')
          .update(`${chaveDoEstado(c)}:${x.identificador}`)
          .digest('hex');
        const d = s.dispositivos.find((y) => y.hash === hash && y.ativo);
        if (!d) return false;
        d.ultimoSincronismo = agora();
        return true;
      },
      registrarEstornoPedido: async (x) => {
        const id = ++s.seq;
        s.atos.push({
          id,
          horario: x.horario,
          tipo: 'estorno',
          situacao: x.situacao,
          horaReal: agora(),
          gravadoEm: agora(),
          usuario: x.usuario,
          quantidade: null,
          motivo: null,
          observacao: x.justificativa,
          pulseiraLida: false,
          motivoSemPulseira: null,
          gtin: null,
          lote: null,
          validade: null,
          conferente: null,
          dispositivo: null,
          origemOffline: false,
          avisos: null,
        });
        return id;
      },
      gravarRespostaExt: async (x) => {
        s.respostas.push({ ...x });
        return ++s.seq;
      },
    };
    return fn(g);
  }

  async relogio() {
    return this.relogioAtual();
  }

  async unidades(c: ContextoEnfermagem): Promise<UnidadeComInternados[]> {
    const s = this.e(c);
    return [
      {
        unidade: 'UTI',
        nome: `UTI ADULTO ${M}`,
        internados: s.internados.filter((x) => x.unidade === 'UTI').length,
      },
      {
        unidade: 'ENF1',
        nome: `ENFERMARIA ${M}`,
        internados: s.internados.filter((x) => x.unidade === 'ENF1').length,
      },
    ];
  }

  async internados(c: ContextoEnfermagem, unidade: string) {
    return this.e(c)
      .internados.filter((x) => x.unidade === unidade)
      .map((x) => semInternos(x));
  }

  async internado(c: ContextoEnfermagem, atendimento: number) {
    const i = this.e(c).internados.find((x) => x.atendimento === atendimento);
    if (!i) return null;
    return semInternos(i);
  }

  async horarios(
    c: ContextoEnfermagem,
    o: { atendimentos: readonly number[]; inicio: string; fim: string; teto: number },
  ) {
    const s = this.e(c);
    const ats = new Set(o.atendimentos);
    const itens = s.horarios
      .filter(
        (h) =>
          ats.has(h.atendimento) && h.previsto >= o.inicio.slice(0, 16) && h.previsto < o.fim.slice(0, 16),
      )
      .sort((a, b) => a.previsto.localeCompare(b.previsto) || a.id - b.id);
    return { itens: itens.slice(0, o.teto).map((h) => this.lido(s, h)), cortada: itens.length > o.teto };
  }

  async horario(c: ContextoEnfermagem, id: number) {
    const s = this.e(c);
    const h = s.horarios.find((x) => x.id === id);
    return h ? this.lido(s, h) : null;
  }

  async faixasDoHorario(c: ContextoEnfermagem, h: Pick<HorarioEnfermagem, 'id' | 'item' | 'previsto'>) {
    return this.e(c)
      .horarios.filter((x) => x.item === h.item && x.faixa !== null && x.previsto === h.previsto)
      .map((x) => ({ id: x.id, situacao: x.situacao, faixa: x.faixa as number }));
  }

  async historico(c: ContextoEnfermagem, id: number) {
    const h = this.e(c).horarios.find((x) => x.id === id);
    return { eventos: h ? [...h.historico] : [], cortado: false };
  }

  async situacoes(c: ContextoEnfermagem, ids: readonly number[]) {
    const s = this.e(c);
    return new Map(s.horarios.filter((h) => ids.includes(h.id)).map((h) => [h.id, h.situacao]));
  }

  async mudancas(c: ContextoEnfermagem, o: { inicio: string; fim: string; desde: string }) {
    const s = this.e(c);
    return s.mudancas.filter((m) => m.quando > o.desde.slice(0, 16) || m.quando === o.desde.slice(0, 16));
  }

  async vinculos(_c: ContextoEnfermagem, login: string) {
    const v = VINCULOS_SINTETICOS[login];
    return v ? [{ cbo: v.cbo, codigo: v.codigo }] : [];
  }

  async nomesVinculos(_c: ContextoEnfermagem, cbos: readonly number[]) {
    const r = new Map<number, string>();
    for (const v of Object.values(VINCULOS_SINTETICOS)) if (cbos.includes(v.cbo)) r.set(v.cbo, v.nome);
    if (cbos.includes(7001)) r.set(7001, `PRESCRITOR ${M}`);
    if (cbos.includes(9000)) r.set(9000, `PROFISSIONAL ${M} OUTRO TERMINAL`);
    return r;
  }

  async laboratorio(c: ContextoEnfermagem, o: { paciente: number; de: string; ate: string }) {
    const agora = this.relogioAtual().slice(0, 16);
    if (o.paciente !== 25_001) return [];
    void c;
    return [
      { exame: 'GLI', nome: `GLICOSE ${M}`, valor: 182, quando: somar(agora, -300) },
      { exame: 'POT', nome: `POTASSIO ${M}`, valor: 4.1, quando: somar(agora, -300) },
    ].filter((x) => x.quando >= o.de.slice(0, 16) && x.quando <= o.ate.slice(0, 16));
  }

  async regrasHorario() {
    const grade = new Map<number, readonly string[]>([
      [1, ['1000']],
      [2, ['1000', '2200']],
      [3, ['0600', '1400', '2200']],
      [4, ['0000', '0600', '1200', '1800']],
      [6, ['0200', '0600', '1000', '1400', '1800', '2200']],
    ]);
    const regras: RegraHorario[] = [
      { id: 1, tipoAtendimento: 'I', horarioInicial: '1601', considerar: 0, padrao: true, grade },
    ];
    return { regras, porBloco: new Map<string, number>() };
  }

  async atos(c: ContextoEnfermagem, hs: readonly number[]) {
    return this.e(c).atos.filter((a) => hs.includes(a.horario));
  }

  async eventosInfusao(c: ContextoEnfermagem, hs: readonly number[]) {
    return this.e(c).infusao.filter((a) => hs.includes(a.horario));
  }

  async sinais(c: ContextoEnfermagem, o: { paciente: number; de: string; ate: string }) {
    const itens = this.e(c).sinais.filter(
      (x) => x.paciente === o.paciente && x.horaReal >= o.de.slice(0, 16) && x.horaReal <= o.ate.slice(0, 16),
    );
    return { itens, cortada: false };
  }

  async sinalPorId(c: ContextoEnfermagem, id: number) {
    const todos = this.e(c).sinais;
    const x = todos.find((y) => y.id === id);
    if (!x) return null;
    return {
      id: x.id,
      paciente: x.paciente,
      atendimento: x.atendimento,
      horario: x.horario,
      tipo: x.tipo,
      unidade: x.unidade,
      metodo: x.metodo,
      horaReal: x.horaReal,
      versao: x.versao,
      substituido: todos.some((y) => y.anterior === x.id),
    };
  }

  async ultimosSinais(c: ContextoEnfermagem, ps: readonly number[]) {
    const r = new Map<number, string>();
    for (const x of this.e(c).sinais)
      if (ps.includes(x.paciente) && (r.get(x.paciente) ?? '') < x.horaReal) r.set(x.paciente, x.horaReal);
    return r;
  }

  async aprazamentos(c: ContextoEnfermagem, hs: readonly number[]) {
    const r = new Map<number, AprazamentoRegistrado>();
    for (const a of this.e(c).aprazamentos) if (hs.includes(a.horario)) r.set(a.horario, a);
    return r;
  }

  async conflitos(c: ContextoEnfermagem, o: { abertos: boolean }) {
    return this.e(c)
      .conflitos.filter((k) => !o.abertos || k.resolvidoEm === null)
      .sort((a, b) => b.id - a.id);
  }

  async passagens(c: ContextoEnfermagem, o: { unidade?: string; id?: number }) {
    return this.e(c).passagens.filter((p) => (o.id !== undefined ? p.id === o.id : p.unidade === o.unidade));
  }

  async dispositivos(c: ContextoEnfermagem) {
    return this.e(c).dispositivos.map((d) => semHash(d));
  }

  async dispositivoAutorizado(c: ContextoEnfermagem, identificador: string) {
    const hash = createHash('sha256')
      .update(`${chaveDoEstado(c)}:${identificador}`)
      .digest('hex');
    const d = this.e(c).dispositivos.find((x) => x.hash === hash && x.ativo);
    if (!d) return null;
    return semHash(d);
  }

  /** Testes: o "outro sistema" suspende a prescrição inteira de um paciente. */
  /** M40 (regra 6): os extras do relatório de contingência, sintéticos (a alergia marcada ganha um nome de teste). */
  async extrasContingencia(
    c: ContextoEnfermagem,
    o: {
      unidade: string;
      pacientes: readonly number[];
      atendimentos: readonly number[];
      prescricoes: readonly number[];
    },
  ) {
    const s = this.e(c);
    const alergicos = s.internados.filter((x) => o.pacientes.includes(x.paciente) && x.alergia);
    return {
      alergias: new Map(alergicos.map((x) => [x.paciente, ['ALERGIA SINTETICA']] as const)),
      problemas: o.pacientes
        .slice(0, 1)
        .map((paciente) => ({ paciente, descricao: 'PROBLEMA SINTETICO', cid: null })),
      justificativas: [],
      amostras: o.atendimentos
        .slice(0, 1)
        .map((atendimento) => ({ atendimento, codigo: 'S0001', estado: 'coletada' })),
      limpezas: o.unidade === 'UTI' ? [{ leito: '99', etapa: 'emExecucao', prazo: null }] : [],
      naoLidos: [],
    };
  }

  suspenderPrescricaoPorFora(
    c: Pick<ContextoEnfermagem, 'cliente' | 'estabelecimento'>,
    atendimento: number,
  ): void {
    const s = this.e(c);
    const i = s.internados.find((x) => x.atendimento === atendimento);
    if (!i) return;
    i.suspensa = true;
    const agora = this.relogioAtual().slice(0, 16);
    for (const h of s.horarios)
      if (h.prescricao === i.prescricao && h.situacao === 'P')
        this.mudar(s, h, 'S', agora, 7001, 'Suspensão médica');
  }
}

/** O internado sem os campos internos da memória (a prescrição e a suspensão vêm pela porta). */
function semInternos<T extends { prescricao: unknown; suspensa: unknown }>(
  x: T,
): Omit<T, 'prescricao' | 'suspensa'> {
  const r: Partial<T> = { ...x };
  delete r.prescricao;
  delete r.suspensa;
  return r as Omit<T, 'prescricao' | 'suspensa'>;
}

/** O aparelho sem o resumo do identificador (fica só na memória). */
function semHash<T extends { hash: unknown }>(x: T): Omit<T, 'hash'> {
  const r: Partial<T> = { ...x };
  delete r.hash;
  return r as Omit<T, 'hash'>;
}
