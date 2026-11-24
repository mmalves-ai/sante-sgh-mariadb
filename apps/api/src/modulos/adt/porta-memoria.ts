// Porta da internação EM MEMÓRIA (M21): a sessão sintética de dev/ci (E2E) admite, transfere, dá alta, agenda a
// pré-internação, troca, registra guia, pede e executa a limpeza e movimenta prontuários SINTÉTICOS, sem tocar a cópia.
// O mapa parte do painel sintético do M16 (FonteInternacaoMemoria: as mesmas acomodações e leitos) e sobrepõe o que esta
// porta gravou (admissões, transferências e saídas). As gravações aplicam o mesmo Zod das receitas (operacao(op).entrada)
// e as mesmas recusas (leito ocupado, internação com alta, carimbo divergente, mesmo destino, situação nunca vista,
// um lugar por vez no SAME). Nenhum nome aqui é de pessoa real (marca "SINTETICO").
import {
  type ApoioInternacaoTela,
  caraterInternacaoLegado,
  type ChaveLeito,
  chaveTextoLeito,
  dataPrevistaPlausivel,
  diariasFaturaveis,
  grupoMotivoAlta,
  type HistoricoOcupacao,
  iniciaisDoNome,
  type InternacaoResumo,
  type LeiturasPainel,
  type LocalizacaoConta,
  OPERACOES_SAME,
  type PreInternacaoItem,
  preservarVinculoOs,
} from '@sgh/contratos';
import { conferirMovimentoArquivo } from '@sgh/dominio-hotelaria';
import { type ContextoOperacao, ErroOperacao, recusa, type ResultadoOperacao } from '@sgh/nucleo';
import { type DetalheInternacao, type EstadosDoMapa, type SolicitacaoLimpezaFila } from './tipos.js';
import { type EstadoCatalogo } from '../cadastro/porta.js';
import { type LiberacaoGravacao } from '../exames/public-api.js';
import { esquemaDaOperacao } from './esquemas.js';
import { type PacienteFicha } from '../cadastro/tipos.js';
import { relogioDoEstabelecimento } from '../recepcao/porta-memoria.js';
import type { NirParaAdt } from './nir-memoria.js';
import type { ProfissionalDaSessao } from '../atendimento/porta.js';
import type {
  AltaMedicaDecidida,
  ContextoAdt,
  DadosImpressoInternacao,
  EtapaDaLimpeza,
  GravadorSghAdt,
  OpcoesListaInternacoes,
  PortaAdt,
} from './porta.js';

const M = 'SINTETICO';
/** Quem grava, para os registros sintéticos (o id do usuário da sessão; sem ele, o marcador sintético). */
const quemGrava = (ctx: ContextoOperacao) => (ctx.usuario === null ? M : String(ctx.usuario));

interface TrechoM {
  leito: ChaveLeito;
  tipo: number;
  entrada: string;
  hora: string;
  saida: string | null;
  horaSaida: string | null;
}
interface InternacaoM {
  reg: number;
  cab: string;
  paciente: number;
  prontuario: number;
  nome: string;
  sexo: 'M' | 'F' | null;
  nascimento: string | null;
  leito: ChaveLeito;
  tipo: number;
  entrada: string;
  hora: string;
  alta: string | null;
  horaSaida: string | null;
  motivo: number | null;
  convenio: number;
  clinica: string;
  especialidade: number;
  assistente: number;
  solicitante: number;
  procedimento: number;
  cid: number;
  isolamento: boolean;
  carater: string;
  matricula: string;
  plano: string;
  validadeCarteira: string | null;
  versao: string;
  origem: string | null;
  nivelCuidado: string | null;
  trechos: TrechoM[];
  guias: { conta: number; guia: string; inicio: string; fim: string; validade: number; senha: string }[];
  trocas: {
    tipo: 'convenio' | 'clinica' | 'especialidade' | 'medico';
    data: string;
    hora: string;
    de: string;
    para: string;
    usuario: string;
  }[];
  contas: { conta: number; inicio: string; tipo: string }[];
  /** Internação do painel sintético do M16 (já existia): só a posição e a alta mudam aqui. */
  base: boolean;
  /** Esta porta mudou a internação (transferência, troca, alta): fica, mesmo que saia do painel. */
  tocada?: boolean;
  ativa: boolean;
}
interface PreM {
  paciente: number;
  prontuario: number;
  nome: string;
  /** Nula na fila de espera (sem data). */
  data: string | null;
  hora: string;
  convenio: number;
  especialidade: number;
  clinica: string;
  carater: string;
  procedimento: number;
  solicitante: number;
  assistente: number;
  matricula: string;
  plano: string;
  acomodacao: string | null;
  status: 'T' | 'F';
}
interface EstadoLeitoM {
  id: number;
  leito: ChaveLeito;
  estado: string;
  motivo: string | null;
  precaucao: string | null;
  previsaoFim: string | null;
  /** W0-07: a observação do estado (alterável sem encerrar). */
  observacao?: string | null;
  desde: string;
  solicitacao: number | null;
  fim: string | null;
  conflitoReg: number | null;
  conflitoEm: string | null;
}
interface SolicitacaoM {
  id: number;
  leito: ChaveLeito;
  espelho: number;
  situacao: number;
  solicitadaEm: string;
  cab: string | null;
  finalizada: boolean;
}
interface MovimentoM {
  id: number;
  conta: number;
  operacao: number;
  origem: number;
  destino: number;
  em: string;
  usuario: string;
  responsavel: string;
  excluido: boolean;
}
interface Estado {
  internacoes: Map<number, InternacaoM>;
  pre: Map<number, PreM>;
  estados: EstadoLeitoM[];
  atributos: Map<
    string,
    {
      sexo: string | null;
      idadeMinima: number | null;
      idadeMaxima: number | null;
      criticidade: number | null;
    }
  >;
  altasMedicas: (AltaMedicaDecidida & { reg: number; situacao: string })[];
  solicitacoes: Map<number, SolicitacaoM>;
  etapas: (EtapaDaLimpeza & { solicitacao: number })[];
  contas: Map<number, { reg: number; numero: number }>;
  movimentos: MovimentoM[];
  sameExt: {
    movimento: number | null;
    conta: number;
    tipo: string;
    motivo: string | null;
    protocolo: string | null;
    prazo: string | null;
    em: string;
    por: string;
  }[];
  seqReg: number;
  seqCab: number;
  seq: number;
}

const CONVENIOS = [
  { codigo: 901, nome: `CONVENIO ${M} A` },
  { codigo: 902, nome: `CONVENIO ${M} B` },
  { codigo: 10, nome: `PARTICULAR ${M}` },
];
const ESPECIALIDADES = [
  { codigo: 11, nome: `CLINICA MEDICA ${M}` },
  { codigo: 33, nome: `CARDIOLOGIA ${M}` },
];
const MEDICOS = [
  { vinculo: 7101, nome: `ANA MEDICA ${M}`, conselho: '52001', especialidade: 'MEDICO CLINICO' },
  { vinculo: 7102, nome: `BRUNO MEDICO ${M}`, conselho: '52002', especialidade: 'MEDICO CARDIOLOGISTA' },
];
const CIDS = [
  { id: 50001, codigo: 'I21', nome: 'INFARTO AGUDO DO MIOCARDIO' },
  { id: 50002, codigo: 'J18', nome: 'PNEUMONIA POR MICROORGANISMO NAO ESPECIFICADO' },
];
const MOTIVOS_ALTA = [
  { codigo: 12, nome: 'MELHORADO' },
  { codigo: 31, nome: 'TRANSFERIDO PARA OUTRO ESTABELECIMENTO' },
  { codigo: 41, nome: 'OBITO COM DECLARACAO FORNECIDA PELO MEDICO ASSISTENTE' },
  { codigo: 16, nome: 'EVASAO' },
];
const TIPOS_LIMPEZA = [
  { codigo: 3, nome: 'LIMPEZA CONCORRENTE' },
  { codigo: 4, nome: 'LIMPEZA TERMINAL' },
  { codigo: 6, nome: 'LIMPEZA IMEDIATA' },
];
const PROFISSIONAIS_LIMPEZA = [
  { codigo: 1, nome: `PROFISSIONAL LIMPEZA ${M} 1` },
  { codigo: 2, nome: `PROFISSIONAL LIMPEZA ${M} 2` },
];
const SETORES = [
  { codigo: 1, nome: 'RECEPCAO INTERNA' },
  { codigo: 5, nome: 'FATURAMENTO' },
  { codigo: 8, nome: 'SAME' },
  { codigo: 9, nome: 'AUDITORIA' },
];
const MOTIVOS_SAME = [
  { codigo: 1, nome: 'FATURAMENTO' },
  { codigo: 2, nome: 'AUDITORIA' },
];

const hhmmDe = (agora: string) => agora.slice(11, 13) + agora.slice(14, 16);
const k = (l: ChaveLeito) => chaveTextoLeito(l);
const k16 = (l: { bloco: string; acomodacao: string; leito: string }) =>
  `${l.bloco}/${l.acomodacao}/${l.leito}`;

/** O que a porta em memória precisa do painel sintético do M16. */
export interface PainelSintetico {
  leiturasPainel(): Promise<LeiturasPainel>;
}

export class PortaAdtMemoria implements PortaAdt {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(
    private readonly catalogo: EstadoCatalogo,
    private readonly deps: {
      readonly painel: PainelSintetico;
      readonly lerPacientes?: (c: ContextoAdt, ids: readonly number[]) => Promise<PacienteFicha[]>;
      readonly agora?: () => Date;
      /** M44 (etapa 2): o NIR em memória (o leito reservado no mapa; a admissão e a transferência vindas dele). */
      readonly nir?: NirParaAdt;
    },
  ) {}

  private relogioAtual() {
    return relogioDoEstabelecimento(this.deps.agora?.() ?? new Date());
  }

  private e(c: ContextoAdt): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = {
        internacoes: new Map(),
        pre: new Map(),
        estados: [],
        atributos: new Map(),
        altasMedicas: [],
        solicitacoes: new Map(),
        etapas: [],
        contas: new Map(),
        movimentos: [],
        sameExt: [],
        seqReg: 880_000,
        seqCab: 9_880_000,
        seq: 0,
      };
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  /** As internações abertas do painel sintético viram internações desta porta (uma vez), para o detalhe e as ações. */
  private async materializar(_c: ContextoAdt, s: Estado): Promise<void> {
    const base = await this.deps.painel.leiturasPainel();
    const tipos = new Map(base.acomodacoes.map((a) => [`${a.bloco}/${a.acomodacao}`, a.tipo ?? 0]));
    // A internação do painel que saiu de lá (a "gravação por fora" retirada) e que esta porta não tocou sai daqui também.
    const naBase = new Set(base.abertas.map((a) => a.reg));
    for (const [reg, i] of s.internacoes)
      if (i.base && !i.tocada && !naBase.has(reg)) s.internacoes.delete(reg);
    for (const a of base.abertas) {
      if (s.internacoes.has(a.reg)) continue;
      const leito = { bloco: a.bloco, acomodacao: a.acomodacao, leito: a.leito };
      const entrada = a.entrada.toISOString().slice(0, 10);
      const tipo = tipos.get(`${a.bloco}/${a.acomodacao}`) ?? 0;
      s.internacoes.set(a.reg, {
        reg: a.reg,
        cab: String(s.seqCab++),
        paciente: 700_000 + (a.reg % 100_000),
        prontuario: 600_000 + (a.reg % 100_000),
        nome: `PACIENTE ${M} ${a.iniciais}`,
        sexo: a.sexo === 'M' || a.sexo === 'F' ? a.sexo : null,
        nascimento: a.nascimento ? a.nascimento.toISOString().slice(0, 10) : null,
        leito,
        tipo,
        entrada,
        hora: '1000',
        alta: null,
        horaSaida: null,
        motivo: null,
        convenio: 901,
        clinica: 'M',
        especialidade: 11,
        assistente: 7101,
        solicitante: 7101,
        procedimento: 303010037,
        cid: 50001,
        isolamento: false,
        carater: '2',
        matricula: '900000000001',
        plano: 'APARTAMENTO',
        validadeCarteira: null,
        versao: `${entrada} 10:00:00.0000`,
        origem: null,
        nivelCuidado: null,
        trechos: [{ leito, tipo, entrada, hora: '1000', saida: null, horaSaida: null }],
        guias: [],
        trocas: [],
        contas: [{ conta: a.reg, inicio: entrada, tipo: 'P' }],
        base: true,
        ativa: true,
      });
    }
  }

  private async internacao(c: ContextoAdt, reg: number): Promise<InternacaoM> {
    const s = this.e(c);
    await this.materializar(c, s);
    const i = s.internacoes.get(reg);
    if (!i || !i.ativa)
      throw new ErroOperacao(
        404,
        'internacao-inexistente',
        'Internação não encontrada',
        'A internação não existe mais.',
      );
    return i;
  }

  async podeGravar(c: ContextoAdt, op: string): Promise<LiberacaoGravacao> {
    const estado = this.catalogo.estado(op, c.hospital);
    if (estado === null || estado === 'bloqueada')
      return { pode: false, codigo: 'operacao-bloqueada', motivo: 'A operação está bloqueada.' };
    return { pode: true, codigo: null, motivo: null };
  }

  /** A ocupação vista pelo mapa: o painel do M16 com o que esta porta gravou por cima. */
  async leiturasPainel(c: ContextoAdt): Promise<LeiturasPainel> {
    const s = this.e(c);
    await this.materializar(c, s);
    const base = await this.deps.painel.leiturasPainel();
    const ocupacao = new Map<string, number>();
    for (const i of s.internacoes.values()) if (i.ativa && i.alta === null) ocupacao.set(k16(i.leito), i.reg);
    const baseRegs = new Set(base.abertas.map((a) => a.reg));
    return {
      ...base,
      leitos: base.leitos.map((l) => ({ ...l, reg: ocupacao.get(k16(l)) ?? 0 })),
      abertas: [
        ...base.abertas
          .filter((a) => {
            const i = s.internacoes.get(a.reg);
            return !i || (i.ativa && i.alta === null);
          })
          .map((a) => {
            const i = s.internacoes.get(a.reg);
            return i
              ? { ...a, bloco: i.leito.bloco, acomodacao: i.leito.acomodacao, leito: i.leito.leito }
              : a;
          }),
        ...[...s.internacoes.values()]
          .filter((i) => !baseRegs.has(i.reg) && i.ativa && i.alta === null)
          .map((i) => ({
            reg: i.reg,
            bloco: i.leito.bloco,
            acomodacao: i.leito.acomodacao,
            leito: i.leito.leito,
            entrada: new Date(`${i.entrada}T00:00:00Z`),
            iniciais: iniciaisDoNome(i.nome),
            nascimento: i.nascimento ? new Date(`${i.nascimento}T00:00:00Z`) : null,
            sexo: i.sexo,
            convenio: CONVENIOS.find((x) => x.codigo === i.convenio)?.nome ?? null,
            tipoTrecho: i.tipo,
          })),
      ],
    };
  }

  private async leitoLivre(c: ContextoAdt, l: ChaveLeito) {
    const p = await this.leiturasPainel(c);
    const x = p.leitos.find(
      (y) => y.bloco === l.bloco && y.acomodacao === l.acomodacao && y.leito === l.leito,
    );
    if (!x)
      throw new ErroOperacao(404, 'leito-inexistente', 'Leito não encontrado', 'O leito não existe no mapa.');
    if (x.status === 'I')
      throw recusa('leito-inativo', 'O leito está inativo no mapa.', { campos: ['leito'] });
    if (x.reg !== 0)
      throw recusa(
        'leito-ocupado',
        'Leito ocupado em outro terminal: escolha outro leito no mapa (o mapa já mostra a ocupação).',
        {
          campos: ['leito'],
        },
      );
    const tipo = p.acomodacoes.find((a) => a.bloco === l.bloco && a.acomodacao === l.acomodacao)?.tipo ?? 0;
    return { tipo, espelho: x.id };
  }

  async executar(c: ContextoAdt, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    const s = this.e(c);
    await this.materializar(c, s);
    const e = esquemaDaOperacao(op).parse(entradaBruta) as Record<string, never>;
    const r = this.relogioAtual();
    const hora = hhmmDe(r.agora);
    const versao = () => `${r.hoje} ${r.agora.slice(11, 19)}.${String(++s.seq).padStart(4, '0')}`;
    const conferirVersao = (i: InternacaoM, v: string) => {
      if (i.versao.slice(0, 19) !== String(v).slice(0, 19))
        throw new ErroOperacao(
          409,
          'conflito-versao',
          'Registro alterado',
          'O registro foi alterado desde a leitura. Releia e confira antes de salvar.',
          { colunas: ['DATA_HORA_ULTIMA_ATUALIZACAO'] },
        );
    };
    const aberta = (i: InternacaoM) => {
      if (i.alta !== null)
        throw recusa('internacao-com-alta', 'A internação já tem alta: nada a mudar no leito.');
    };
    let resultado: ResultadoOperacao;
    switch (op) {
      case 'internacao.internar': {
        const x = e as unknown as {
          paciente: number;
          leito: ChaveLeito;
          convenio: number;
          especialidade: number;
          medicoAssistente: number;
          medicoSolicitante: number;
          cidPrincipal: number;
          procedimento: number;
          carater: 'eletivo' | 'urgencia';
          clinica: string;
          isolamento: boolean;
          matricula?: string;
          acomodacaoPlano: string;
          validadeCarteira?: string;
          origem: string;
          nivelCuidado?: string;
        };
        const { tipo } = await this.leitoLivre(c, x.leito);
        // M44: o leito reservado pelo NIR para outra solicitação e a solicitação que não está mais reservada.
        const solicitacaoNir = (e as unknown as { solicitacaoNir?: number }).solicitacaoNir ?? null;
        this.deps.nir?.conferirAdmissao(c.hospital, x.leito, solicitacaoNir, { paciente: x.paciente });
        if ([...s.internacoes.values()].some((i) => i.ativa && i.alta === null && i.paciente === x.paciente))
          throw recusa(
            'paciente-ja-internado',
            'O paciente já está internado: transfira de leito em vez de admitir.',
          );
        const [p] = (await this.deps.lerPacientes?.(c, [x.paciente])) ?? [];
        if (!p)
          throw new ErroOperacao(
            404,
            'paciente-inexistente',
            'Paciente não encontrado',
            'O cadastro do paciente não existe mais.',
          );
        const reg = ++s.seqReg;
        const cab = String(++s.seqCab);
        s.internacoes.set(reg, {
          reg,
          cab,
          paciente: p.id,
          prontuario: p.prontuario,
          nome: p.nome,
          sexo: p.sexo,
          nascimento: p.nascimento,
          leito: x.leito,
          tipo,
          entrada: r.hoje,
          hora,
          alta: null,
          horaSaida: null,
          motivo: null,
          convenio: x.convenio,
          clinica: x.clinica,
          especialidade: x.especialidade,
          assistente: x.medicoAssistente,
          solicitante: x.medicoSolicitante,
          procedimento: x.procedimento,
          cid: x.cidPrincipal,
          isolamento: x.isolamento,
          carater: caraterInternacaoLegado(x.carater),
          matricula: x.matricula || '0',
          plano: x.acomodacaoPlano,
          validadeCarteira: x.validadeCarteira ?? null,
          versao: versao(),
          origem: x.origem,
          nivelCuidado: x.nivelCuidado ?? null,
          trechos: [{ leito: x.leito, tipo, entrada: r.hoje, hora, saida: null, horaSaida: null }],
          guias: [{ conta: reg, guia: String(reg), inicio: r.hoje, fim: r.hoje, validade: 1, senha: '' }],
          trocas: [],
          contas: [{ conta: reg, inicio: r.hoje, tipo: 'P' }],
          base: false,
          ativa: true,
        });
        // A pré-internação pendente do paciente sai (o gatilho da admissão apaga).
        const pre = s.pre.get(p.id);
        if (pre?.status === 'T') s.pre.delete(p.id);
        const conta = ++s.seq;
        s.contas.set(conta, { reg, numero: reg });
        s.movimentos.push({
          id: ++s.seq,
          conta,
          operacao: 1,
          origem: 1,
          destino: 1,
          em: r.agora,
          usuario: quemGrava(ctx),
          responsavel: quemGrava(ctx),
          excluido: false,
        });
        if (solicitacaoNir !== null)
          this.deps.nir?.concluir(c.hospital, solicitacaoNir, reg, quemGrava(ctx), x.leito);
        resultado = { reg, cabecalho: cab, conta, paciente: p.id };
        break;
      }
      case 'internacao.transferirLeito': {
        const x = e as unknown as { internacao: number; destino: ChaveLeito; versao: string };
        const i = await this.internacao(c, x.internacao);
        aberta(i);
        conferirVersao(i, x.versao);
        if (k(i.leito) === k(x.destino))
          throw recusa('mesmo-leito', 'O destino é o leito atual do paciente.');
        const { tipo } = await this.leitoLivre(c, x.destino);
        const solicitacaoNir = (e as unknown as { solicitacaoNir?: number }).solicitacaoNir ?? null;
        this.deps.nir?.conferirAdmissao(c.hospital, x.destino, solicitacaoNir, { internacao: i.reg });
        const t = i.trechos.find((y) => y.saida === null);
        if (t) {
          t.saida = r.hoje;
          t.horaSaida = hora;
        }
        i.trechos.push({ leito: x.destino, tipo, entrada: r.hoje, hora, saida: null, horaSaida: null });
        const origem = k(i.leito);
        i.leito = x.destino;
        i.tipo = tipo;
        i.versao = versao();
        i.tocada = true;
        if (solicitacaoNir !== null)
          this.deps.nir?.concluir(c.hospital, solicitacaoNir, i.reg, quemGrava(ctx), x.destino);
        resultado = { reg: i.reg, cabecalho: i.cab, origem, destino: k(x.destino) };
        break;
      }
      case 'internacao.darAlta': {
        const x = e as unknown as {
          internacao: number;
          motivo: number;
          medicoAlta: number;
          horaSaida?: string;
          versao: string;
        };
        const i = await this.internacao(c, x.internacao);
        aberta(i);
        conferirVersao(i, x.versao);
        const h = x.horaSaida?.replace(':', '') ?? hora;
        if (h > hora) throw recusa('hora-futura', 'A hora da saída não pode ser depois de agora.');
        i.alta = r.hoje;
        i.horaSaida = h;
        i.motivo = x.motivo;
        const t = i.trechos.find((y) => y.saida === null);
        if (t) {
          t.saida = r.hoje;
          t.horaSaida = h;
        }
        i.versao = versao();
        i.tocada = true;
        for (const a of s.altasMedicas)
          if (a.reg === i.reg && a.situacao === 'decidida') a.situacao = 'efetivada';
        const id = ++s.seq;
        const p = await this.leiturasPainel(c);
        const espelho =
          p.leitos.find(
            (y) =>
              y.bloco === i.leito.bloco && y.acomodacao === i.leito.acomodacao && y.leito === i.leito.leito,
          )?.id ?? 0;
        s.solicitacoes.set(id, {
          id,
          leito: i.leito,
          espelho,
          situacao: 1,
          solicitadaEm: `${r.hoje}T${h.slice(0, 2)}:${h.slice(2, 4)}:00`,
          cab: i.cab,
          finalizada: false,
        });
        const precaucao = s.estados.find(
          (y) => y.fim === null && k(y.leito) === k(i.leito) && y.estado === 'precaucao',
        );
        if (precaucao) precaucao.fim = r.agora;
        s.estados.push({
          id: ++s.seq,
          leito: i.leito,
          estado: 'higienizacao',
          motivo: null,
          precaucao: precaucao?.precaucao ?? (i.isolamento ? 'contato' : null),
          previsaoFim: null,
          desde: r.agora,
          solicitacao: id,
          fim: null,
          conflitoReg: null,
          conflitoEm: null,
        });
        s.etapas.push({
          id: ++s.seq,
          solicitacao: id,
          etapa: 'solicitado',
          tipoLimpeza: 4,
          profissional: null,
          precaucao: (precaucao?.precaucao ?? (i.isolamento ? 'contato' : null)) as never,
          prazo: null,
          checklist: [],
          foto: null,
          registradoPor: quemGrava(ctx),
          registradoEm: r.agora,
          aparelho: null,
          origem: 'alta',
        });
        resultado = { reg: i.reg, cabecalho: i.cab, solicitacao: id };
        break;
      }
      case 'internacao.cancelarAlta': {
        const x = e as unknown as { internacao: number };
        const i = await this.internacao(c, x.internacao);
        if (i.alta === null) throw recusa('internacao-aberta', 'A internação não tem alta para cancelar.');
        const p = await this.leiturasPainel(c);
        const l = p.leitos.find(
          (y) =>
            y.bloco === i.leito.bloco && y.acomodacao === i.leito.acomodacao && y.leito === i.leito.leito,
        );
        if (l && l.reg !== 0)
          throw recusa(
            'leito-ocupado',
            'O leito da internação já está ocupado por outro paciente: a alta fica.',
          );
        i.alta = null;
        i.horaSaida = null;
        i.motivo = null;
        const t = i.trechos.at(-1);
        if (t) {
          t.saida = null;
          t.horaSaida = null;
        }
        i.versao = versao();
        i.tocada = true;
        resultado = { reg: i.reg, cabecalho: i.cab, solicitacao: 0 };
        break;
      }
      case 'internacao.excluirInternacao': {
        const x = e as unknown as { internacao: number };
        const i = await this.internacao(c, x.internacao);
        if (i.alta !== null) throw recusa('exclusao-recusada', 'A internação tem alta: não se exclui.');
        if (i.base) throw recusa('exclusao-recusada', 'A internação não foi aberta hoje: não se exclui.');
        i.ativa = false;
        resultado = { reg: i.reg };
        break;
      }
      case 'internacao.preInternar': {
        const x = e as unknown as PreM & {
          dataPrevista?: string;
          horaPrevista?: string;
          medicoSolicitante: number;
          medicoAssistente?: number;
          matricula?: string;
          acomodacao?: { bloco: string; acomodacao: string };
        };
        if (s.pre.has(x.paciente))
          throw recusa(
            'pre-internacao-existente',
            'O paciente já tem pré-internação agendada: corrija a data ou interne pela admissão.',
          );
        const [p] = (await this.deps.lerPacientes?.(c, [x.paciente])) ?? [];
        if (!p)
          throw new ErroOperacao(
            404,
            'paciente-inexistente',
            'Paciente não encontrado',
            'O cadastro do paciente não existe mais.',
          );
        s.pre.set(p.id, {
          paciente: p.id,
          prontuario: p.prontuario,
          nome: p.nome,
          data: x.dataPrevista ?? null,
          hora: x.horaPrevista?.replace(':', '') ?? '0000',
          convenio: x.convenio,
          especialidade: x.especialidade,
          clinica: x.clinica,
          carater: x.carater,
          procedimento: x.procedimento,
          solicitante: x.medicoSolicitante,
          assistente: x.medicoAssistente ?? x.medicoSolicitante,
          matricula: x.matricula || '0',
          plano: x.plano,
          acomodacao: x.acomodacao ? `${x.acomodacao.bloco}/${x.acomodacao.acomodacao}` : null,
          status: 'T',
        });
        resultado = { paciente: p.id, pront: p.prontuario };
        break;
      }
      case 'internacao.corrigirPreInternacao': {
        const x = e as unknown as { paciente: number; dataPrevista?: string; lida: string | null };
        const p = s.pre.get(x.paciente);
        if (!p)
          throw new ErroOperacao(
            404,
            'pre-inexistente',
            'Pré-internação não encontrada',
            'A pré-internação não existe mais.',
          );
        if (p.data !== x.lida)
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'Registro alterado',
            'O registro foi alterado desde a leitura. Releia e confira antes de salvar.',
            { colunas: ['ENTRADA'] },
          );
        p.data = x.dataPrevista ?? null;
        resultado = { paciente: p.paciente, pront: p.prontuario };
        break;
      }
      case 'internacao.trocarConvenio':
      case 'internacao.trocarClinica':
      case 'internacao.trocarEspecialidade':
      case 'internacao.trocarMedico': {
        const x = e as unknown as {
          internacao: number;
          versao: string;
          convenio?: number;
          clinica?: string;
          especialidade?: number;
          medico?: number;
          tipo?: string;
        };
        const i = await this.internacao(c, x.internacao);
        aberta(i);
        conferirVersao(i, x.versao);
        const tipo =
          op === 'internacao.trocarConvenio'
            ? 'convenio'
            : op === 'internacao.trocarClinica'
              ? 'clinica'
              : op === 'internacao.trocarEspecialidade'
                ? 'especialidade'
                : 'medico';
        const atual = String(
          tipo === 'convenio'
            ? i.convenio
            : tipo === 'clinica'
              ? i.clinica
              : tipo === 'especialidade'
                ? i.especialidade
                : i.solicitante,
        );
        const novo = String(
          tipo === 'convenio'
            ? x.convenio
            : tipo === 'clinica'
              ? x.clinica
              : tipo === 'especialidade'
                ? x.especialidade
                : x.medico,
        );
        if (tipo === 'medico' && x.tipo !== 'S')
          throw recusa('troca-nao-vista', 'Só a troca do médico solicitante está prevista (a única vista).');
        if (atual === novo) throw recusa('mesmo-destino', 'O destino é o atual.');
        if (tipo === 'convenio') i.convenio = Number(novo);
        if (tipo === 'clinica') i.clinica = novo;
        if (tipo === 'especialidade') i.especialidade = Number(novo);
        if (tipo === 'medico') i.solicitante = Number(novo);
        i.trocas.push({ tipo, data: r.hoje, hora, de: atual, para: novo, usuario: quemGrava(ctx) });
        i.versao = versao();
        i.tocada = true;
        resultado = { reg: i.reg, cabecalho: i.cab, de: atual, para: novo };
        break;
      }
      case 'internacao.registrarGuia': {
        const x = e as unknown as {
          internacao: number;
          conta: number;
          guia: string;
          senha?: string;
          validadeDias: number;
        };
        const i = await this.internacao(c, x.internacao);
        if (x.conta === i.reg)
          throw recusa(
            'conta-principal',
            'A guia da conta principal nasce na admissão: registre a guia na conta parcial aberta pelo faturamento.',
          );
        let conta = i.contas.find((y) => y.conta === x.conta);
        if (!conta) {
          // Na sessão sintética, a conta parcial nasce com a primeira guia (o faturamento sintético).
          conta = { conta: x.conta, inicio: r.hoje, tipo: 'P' };
          i.contas.push(conta);
        }
        if (i.guias.some((g) => g.conta === x.conta && g.guia === x.guia))
          throw recusa('guia-repetida', 'Esta guia já está registrada na conta.');
        const fim = new Date(`${conta.inicio}T00:00:00Z`);
        fim.setUTCDate(fim.getUTCDate() + x.validadeDias);
        i.guias.push({
          conta: x.conta,
          guia: x.guia,
          inicio: conta.inicio,
          fim: fim.toISOString().slice(0, 10),
          validade: x.validadeDias,
          senha: x.senha ?? '',
        });
        resultado = { reg: i.reg, conta: x.conta, cabecalho: i.cab, guia: x.guia };
        break;
      }
      case 'hotelaria.solicitarLimpeza': {
        const x = e as unknown as {
          leito: ChaveLeito;
          tipoLimpeza: number;
          origem: string;
          precaucao?: string;
          observacao?: string;
        };
        if (s.estados.some((y) => y.fim === null && y.estado === 'higienizacao' && k(y.leito) === k(x.leito)))
          throw recusa('limpeza-em-aberto', 'O leito já tem solicitação de limpeza em aberto.');
        const p = await this.leiturasPainel(c);
        const l = p.leitos.find(
          (y) =>
            y.bloco === x.leito.bloco && y.acomodacao === x.leito.acomodacao && y.leito === x.leito.leito,
        );
        if (!l)
          throw new ErroOperacao(
            404,
            'leito-inexistente',
            'Leito não encontrado',
            'O leito não existe no mapa.',
          );
        const id = ++s.seq;
        s.solicitacoes.set(id, {
          id,
          leito: x.leito,
          espelho: l.id,
          situacao: 1,
          solicitadaEm: `${r.hoje}T${hora.slice(0, 2)}:${hora.slice(2, 4)}:00`,
          cab: null,
          finalizada: false,
        });
        s.estados.push({
          id: ++s.seq,
          leito: x.leito,
          estado: 'higienizacao',
          motivo: null,
          precaucao: x.precaucao ?? null,
          previsaoFim: null,
          desde: r.agora,
          solicitacao: id,
          fim: null,
          conflitoReg: null,
          conflitoEm: null,
        });
        s.etapas.push({
          id: ++s.seq,
          solicitacao: id,
          etapa: 'solicitado',
          tipoLimpeza: x.tipoLimpeza,
          profissional: null,
          precaucao: (x.precaucao ?? null) as never,
          prazo: null,
          checklist: [],
          foto: null,
          registradoPor: quemGrava(ctx),
          registradoEm: r.agora,
          aparelho: null,
          origem: x.origem as never,
        });
        resultado = { solicitacao: id, leito: k(x.leito), leitoEspelho: l.id };
        break;
      }
      case 'hotelaria.liberarLeito': {
        const x = e as unknown as { solicitacao: number };
        const sol = s.solicitacoes.get(x.solicitacao);
        if (!sol)
          throw new ErroOperacao(
            404,
            'solicitacao-inexistente',
            'Solicitação não encontrada',
            'A solicitação de limpeza não existe.',
          );
        if (sol.finalizada) throw recusa('ja-liberado', 'A execução já foi finalizada.');
        sol.finalizada = true;
        sol.situacao = 4;
        resultado = { solicitacao: sol.id, execucao: sol.id };
        break;
      }
      case 'same.movimentarProntuario': {
        const x = e as unknown as {
          conta: number;
          operacao: number;
          setorOrigem: number;
          setorDestino: number;
          responsavel: string;
          avalComissao?: string;
        };
        if (!s.contas.has(x.conta))
          throw new ErroOperacao(404, 'conta-inexistente', 'Conta não encontrada', 'A conta não existe.');
        const atual = this.ultimo(s, x.conta);
        const problema = conferirMovimentoArquivo(atual, x);
        if (problema) throw recusa(problema.codigo, problema.mensagem);
        const id = ++s.seq;
        s.movimentos.push({
          id,
          conta: x.conta,
          operacao: x.operacao,
          origem: x.setorOrigem,
          destino: x.setorDestino,
          em: r.agora,
          usuario: quemGrava(ctx),
          responsavel: x.responsavel,
          excluido: false,
        });
        resultado = { movimento: id, conta: x.conta, operacao: x.operacao };
        break;
      }
      case 'same.excluirMovimento': {
        const x = e as unknown as { movimento: number };
        const m = s.movimentos.find((y) => y.id === x.movimento);
        if (!m)
          throw new ErroOperacao(
            404,
            'movimento-inexistente',
            'Movimento não encontrado',
            'O movimento não existe.',
          );
        if (m.excluido) throw recusa('ja-excluido', 'O movimento já está excluído.');
        if (this.ultimo(s, m.conta)?.id !== m.id)
          throw recusa(
            'nao-e-o-ultimo',
            'Só o último movimento da conta pode ser desfeito (um lugar por vez).',
          );
        m.excluido = true;
        resultado = { movimento: m.id, conta: m.conta };
        break;
      }
      default:
        throw new Error(`Operação ${op} sem simulação em memória.`);
    }
    return { resultado, repetida: false, trilha: null };
  }

  private ultimo(s: Estado, conta: number) {
    return s.movimentos.filter((m) => m.conta === conta && !m.excluido).at(-1) ?? null;
  }

  /** W0-07: a versão anterior das alterações do mapa (a trilha de auditoria em memória). */
  readonly alteracoes: {
    tabela: string;
    chave: string;
    acao: string;
    antes: Record<string, unknown>;
    motivo: string;
    por: string;
  }[] = [];

  async gravarSgh<T>(c: ContextoAdt, _trilha: unknown, fn: (g: GravadorSghAdt) => Promise<T>): Promise<T> {
    const s = this.e(c);
    const r = this.relogioAtual();
    return fn({
      registrarAltaMedica: async (x) => {
        if (s.altasMedicas.some((a) => a.reg === x.reg && a.situacao === 'decidida'))
          throw recusa(
            'alta-medica-registrada',
            'A internação já tem alta médica decidida: cancele a anterior para registrar outra.',
          );
        const id = ++s.seq;
        s.altasMedicas.push({
          id,
          reg: x.reg,
          vinculo: x.vinculo,
          motivo: x.motivo,
          destino: x.destino,
          decididaEm: r.agora,
          decididaPor: x.usuario,
          situacao: 'decidida',
        });
        return id;
      },
      cancelarAltaMedica: async (x) => {
        const a = s.altasMedicas.find((y) => y.reg === x.reg && y.situacao === 'decidida');
        if (!a) throw recusa('sem-alta-medica', 'A internação não tem alta médica decidida.');
        a.situacao = 'cancelada';
        return a.id;
      },
      abrirEstadoLeito: async (x) => {
        if (s.estados.some((y) => y.fim === null && y.estado === x.estado && k(y.leito) === k(x.leito)))
          throw recusa('estado-ja-aberto', 'O leito já está nesse estado: encerre o atual antes.');
        const id = ++s.seq;
        s.estados.push({
          id,
          leito: x.leito,
          estado: x.estado,
          motivo: x.motivo ?? null,
          precaucao: x.precaucao ?? null,
          previsaoFim: x.previsaoFim ?? null,
          desde: r.agora,
          solicitacao: x.solicitacao ?? null,
          fim: null,
          conflitoReg: null,
          conflitoEm: null,
          observacao: x.observacao ?? null,
        });
        return id;
      },
      encerrarEstadoLeito: async (x) => {
        let n = 0;
        for (const y of s.estados)
          if (y.fim === null && y.estado === x.estado && k(y.leito) === k(x.leito)) {
            y.fim = r.agora;
            n++;
          }
        return n;
      },
      alterarEstadoLeito: async (x) => {
        const y = s.estados.find((e) => e.fim === null && e.estado === x.estado && k(e.leito) === k(x.leito));
        if (!y) throw recusa('estado-inexistente', 'O leito não está nesse estado.');
        const antes = {
          motivo: y.motivo,
          precaucao: y.precaucao,
          previsaoFim: y.previsaoFim,
          observacao: y.observacao ?? null,
        };
        const depois = {
          motivo: x.motivo === undefined ? antes.motivo : x.motivo,
          precaucao: x.precaucao === undefined ? antes.precaucao : x.precaucao,
          previsaoFim: x.previsaoFim === undefined ? antes.previsaoFim : x.previsaoFim,
          observacao: x.observacao === undefined ? antes.observacao : x.observacao,
        };
        const vinculo = preservarVinculoOs({ estado: x.estado, ...antes }, depois);
        if (!vinculo.ok) throw recusa('bloqueio-da-os', vinculo.mensagem);
        depois.observacao = vinculo.observacao;
        const dif: Record<string, unknown> = {};
        for (const [c2, v] of Object.entries(depois))
          if ((antes as Record<string, unknown>)[c2] !== v) dif[c2] = (antes as Record<string, unknown>)[c2];
        if (Object.keys(dif).length === 0)
          throw recusa(
            'nada-a-alterar',
            'Nada mudou: altere o motivo, a precaução, a previsão ou a observação.',
          );
        Object.assign(y, depois);
        this.alteracoes.push({
          tabela: 'periodo_situacao_leito',
          chave: String(y.id),
          acao: 'alterar',
          antes: dif,
          motivo: x.justificativa,
          por: x.usuario,
        });
        return y.id;
      },
      limparAtributos: async (x) => {
        const antes = s.atributos.get(x.chave);
        if (!antes)
          throw recusa('atributos-inexistentes', 'O leito não tem atributos próprios: já vale o padrão.');
        this.alteracoes.push({
          tabela: 'leito_hospitalar',
          chave: `${x.escopo}:${x.chave}`,
          acao: 'limpar',
          antes: { ...antes },
          motivo: x.justificativa,
          por: x.usuario,
        });
        s.atributos.delete(x.chave);
        return 1;
      },
      gravarAtributo: async (x) => {
        const novo = {
          sexo: x.sexo ?? null,
          idadeMinima: x.idadeMinima ?? null,
          idadeMaxima: x.idadeMaxima ?? null,
          criticidade: x.criticidade ?? null,
        };
        const atual = s.atributos.get(x.chave);
        if (atual) {
          // W0-07: a alteração leva o motivo e deixa o valor anterior na trilha (como na gravação real).
          const antes: Record<string, unknown> = {};
          for (const c of ['sexo', 'idadeMinima', 'idadeMaxima', 'criticidade'] as const)
            if (atual[c] !== novo[c]) antes[c] = atual[c];
          if (Object.keys(antes).length === 0) return;
          if (!x.motivo?.trim())
            throw recusa(
              'motivo-obrigatorio',
              'Informe o motivo da alteração: o valor anterior fica no histórico, com quem o definiu.',
              { campos: ['motivo'] },
            );
          this.alteracoes.push({
            tabela: 'leito_hospitalar',
            chave: `${x.escopo}:${x.chave}`,
            acao: 'alterar',
            antes,
            motivo: x.motivo,
            por: x.usuario,
          });
        }
        s.atributos.set(x.chave, novo);
      },
      gravarEtapaLimpeza: async (x) => {
        const id = ++s.seq;
        const prazo = x.prazoMinutos
          ? new Date(Date.parse(`${r.agora}Z`) + x.prazoMinutos * 60_000).toISOString().slice(0, 19)
          : null;
        s.etapas.push({
          id,
          solicitacao: x.solicitacao,
          etapa: x.etapa,
          tipoLimpeza: x.tipoLimpeza ?? null,
          profissional: x.profissional ?? null,
          precaucao: (x.precaucao ?? null) as never,
          prazo,
          checklist: [...(x.checklist ?? [])],
          foto: x.foto ?? null,
          registradoPor: x.usuario,
          registradoEm: r.agora,
          aparelho: x.aparelho ?? null,
          origem: (x.origem ?? null) as never,
        });
        // A liberação encerra, na mesma gravação, o período de higienização do leito (se houver).
        if (x.etapa === 'liberado')
          for (const y of s.estados)
            if (y.fim === null && y.estado === 'higienizacao' && k(y.leito) === k(x.leito)) y.fim = r.agora;
        return id;
      },
      gravarSameExt: async (x) => {
        s.sameExt.push({
          movimento: x.movimento,
          conta: x.conta,
          tipo: x.tipo,
          motivo: x.motivo ?? null,
          protocolo: x.protocolo ?? null,
          prazo: x.prazoDevolucao ?? null,
          em: r.agora,
          por: x.usuario,
        });
        return ++s.seq;
      },
    });
  }

  async relogio(): Promise<{ hoje: string; agora: string }> {
    return this.relogioAtual();
  }

  private resumo(i: InternacaoM, hoje: string, intensivas: readonly number[]): InternacaoResumo {
    const dias = Math.max(
      0,
      Math.round(
        (Date.parse(`${i.alta ?? hoje}T00:00:00Z`) - Date.parse(`${i.entrada}T00:00:00Z`)) / 86_400_000,
      ),
    );
    return {
      reg: i.reg,
      paciente: i.paciente,
      prontuario: i.prontuario,
      nome: i.nome,
      leito: i.leito,
      tipoAcomodacao: i.tipo === 3 ? 'U.T.I.' : i.tipo === 2 ? 'Apartamento' : 'Enfermaria',
      intensiva: intensivas.includes(i.tipo),
      entrada: i.entrada,
      horaEntrada: i.hora,
      alta: i.alta,
      horaSaida: i.horaSaida,
      convenio: CONVENIOS.find((x) => x.codigo === i.convenio) ?? {
        codigo: i.convenio,
        nome: `CONVENIO ${i.convenio}`,
      },
      clinica: i.clinica,
      especialidade: ESPECIALIDADES.find((x) => x.codigo === i.especialidade) ?? {
        codigo: i.especialidade,
        nome: `ESPECIALIDADE ${i.especialidade}`,
      },
      medicoAssistente: MEDICOS.find((m) => m.vinculo === i.assistente)?.nome ?? '',
      diasInternacao: dias,
      isolamento: i.isolamento,
      altaMedica: null,
      versao: i.versao,
    };
  }

  async internacoes(c: ContextoAdt, o: OpcoesListaInternacoes) {
    const s = this.e(c);
    await this.materializar(c, s);
    const t = (o.termo ?? '').trim().toUpperCase();
    const hoje = this.relogioAtual().hoje;
    const situacao = o.situacao ?? 'internados';
    const noPeriodo = (a: string) => a >= (o.altaDe ?? '1900-01-01') && a <= (o.altaAte ?? '2999-12-31');
    const itens = [...s.internacoes.values()]
      .filter((i) => i.ativa)
      .filter((i) => (i.alta === null ? situacao !== 'alta' : situacao !== 'internados' && noPeriodo(i.alta)))
      .filter((i) => !o.bloco || i.leito.bloco === o.bloco)
      .filter((i) => !t || i.nome.includes(t) || String(i.reg) === t || String(i.prontuario) === t)
      .sort((a, b) => k(a.leito).localeCompare(k(b.leito)))
      .map((i) => this.resumo(i, hoje, o.intensivas));
    return { itens, cortada: false };
  }

  async detalhe(
    c: ContextoAdt,
    reg: number,
    intensivas: readonly number[],
  ): Promise<DetalheInternacao | null> {
    const s = this.e(c);
    await this.materializar(c, s);
    const i = s.internacoes.get(reg);
    if (!i || !i.ativa) return null;
    const hoje = this.relogioAtual().hoje;
    return {
      resumo: this.resumo(i, hoje, intensivas),
      cabecalho: i.cab,
      procedimento: i.procedimento,
      cid: CIDS.find((x) => x.id === i.cid)?.codigo ?? null,
      medicoSolicitante: MEDICOS.find((m) => m.vinculo === i.solicitante)?.nome ?? '',
      acomodacaoPlano: i.plano,
      matricula: i.matricula,
      validadeCarteira: i.validadeCarteira,
      carater: i.carater,
      motivo: i.motivo,
      motivoNome: MOTIVOS_ALTA.find((m) => m.codigo === i.motivo)?.nome ?? '',
      permanen: i.alta ? diariasFaturaveis(i.entrada, i.alta, i.horaSaida ?? '0000') : 0,
      vinculoAssistente: i.assistente,
      trechos: i.trechos.map((t) => ({
        leito: t.leito,
        tipo: { codigo: t.tipo, nome: t.tipo === 3 ? 'U.T.I.' : t.tipo === 2 ? 'Apartamento' : 'Enfermaria' },
        entrada: t.entrada,
        horaEntrada: t.hora,
        saida: t.saida,
        horaSaida: t.horaSaida,
      })),
      guias: i.guias.map((g) => ({
        conta: g.conta,
        guia: g.guia,
        inicio: g.inicio,
        fim: g.fim,
        validadeDias: g.validade,
        temSenha: g.senha !== '',
      })),
      trocas: i.trocas,
      contas: i.contas.map((x) => ({
        conta: x.conta,
        inicio: x.inicio,
        fim: null,
        tipo: x.tipo,
        guias: i.guias.filter((g) => g.conta === x.conta).length,
      })),
      procedimentosExtras: [],
      historicoPaciente: [...s.internacoes.values()]
        .filter((x) => x.paciente === i.paciente && x.ativa)
        .map((x) => ({ reg: x.reg, entrada: x.entrada, alta: x.alta, motivo: x.motivo })),
    };
  }

  async altaMedica(c: ContextoAdt, reg: number): Promise<AltaMedicaDecidida | null> {
    return this.e(c).altasMedicas.find((a) => a.reg === reg && a.situacao === 'decidida') ?? null;
  }

  async altasMedicas(c: ContextoAdt, regs: readonly number[]) {
    const m = new Map<number, AltaMedicaDecidida>();
    for (const a of this.e(c).altasMedicas)
      if (a.situacao === 'decidida' && regs.includes(a.reg)) m.set(a.reg, a);
    return m;
  }

  async preInternacoes(c: ContextoAdt, o: { situacao?: 'pendente' | 'todas'; problema?: 'saneamento' }) {
    const hoje = this.relogioAtual().hoje;
    const itens: PreInternacaoItem[] = [...this.e(c).pre.values()]
      .filter((p) => o.situacao === 'todas' || p.status === 'T')
      .map((p) => {
        const pl = dataPrevistaPlausivel(p.data, hoje);
        return {
          paciente: p.paciente,
          prontuario: p.prontuario,
          nome: p.nome,
          dataPrevista: p.data,
          horaPrevista: p.hora,
          situacao: p.status === 'T' ? ('pendente' as const) : ('outra' as const),
          problema: pl === 'ok' ? null : pl,
          convenio: CONVENIOS.find((x) => x.codigo === p.convenio) ?? { codigo: p.convenio, nome: '' },
          especialidade: ESPECIALIDADES.find((x) => x.codigo === p.especialidade) ?? {
            codigo: p.especialidade,
            nome: '',
          },
          medico: MEDICOS.find((m) => m.vinculo === p.solicitante)?.nome ?? '',
          acomodacao: p.acomodacao,
          procedimento: p.procedimento,
        };
      });
    const filtrados = o.problema === 'saneamento' ? itens.filter((i) => i.problema === 'impossivel') : itens;
    return {
      itens: filtrados,
      cortada: false,
      contagens: {
        pendentes: itens.filter((i) => i.situacao === 'pendente').length,
        semData: itens.filter((i) => i.problema === 'sem-data').length,
        impossiveis: itens.filter((i) => i.problema === 'impossivel').length,
      },
    };
  }

  async preDoPaciente(c: ContextoAdt, paciente: number) {
    const p = this.e(c).pre.get(paciente);
    if (!p || p.status !== 'T') return null;
    return {
      dataPrevista: p.data,
      convenio: p.convenio,
      especialidade: p.especialidade,
      clinica: p.clinica,
      carater: p.carater === 'urgencia' ? '2' : '1',
      procedimento: p.procedimento,
      vinculoSolicitante: p.solicitante,
      vinculoAssistente: p.assistente,
      matricula: p.matricula,
      plano: p.plano,
    };
  }

  async estadosDoMapa(c: ContextoAdt): Promise<EstadosDoMapa> {
    const s = this.e(c);
    const ultimaEtapa = (sol: number) => s.etapas.filter((x) => x.solicitacao === sol).at(-1);
    return {
      estados: s.estados
        .filter((x) => x.fim === null)
        .map((x) => ({
          chave: k(x.leito),
          estado: x.estado as 'bloqueio',
          motivo: x.motivo,
          precaucao: x.precaucao,
          previsaoFim: x.previsaoFim,
          desde: x.desde,
          solicitacao: x.solicitacao,
          conflitoReg: x.conflitoReg,
          conflitoEm: x.conflitoEm,
          observacao: x.observacao ?? null,
        })),
      limpezas: [...s.solicitacoes.values()]
        .map((x) => ({ x, et: ultimaEtapa(x.id) }))
        .filter(({ et }) => et && et.etapa !== 'liberado' && et.etapa !== 'cancelado')
        .map(({ x, et }) => ({
          chave: k(x.leito),
          solicitacao: x.id,
          etapa: et?.etapa ?? 'solicitado',
          prazo: et?.prazo ?? null,
        })),
      atributos: [...s.atributos.entries()].map(([chave, a]) => ({ chave, ...a })),
      reservas: this.deps.nir?.reservasDoMapa(c.hospital) ?? [],
    };
  }

  async historico(
    c: ContextoAdt,
    o: { inicio: string; fim: string; bloco?: string; pagina: number; porPagina: number },
  ): Promise<HistoricoOcupacao> {
    const s = this.e(c);
    await this.materializar(c, s);
    const hoje = this.relogioAtual().hoje;
    const todos = [...s.internacoes.values()]
      .filter((i) => i.ativa)
      .flatMap((i) => i.trechos.map((t) => ({ i, t })))
      .filter(
        ({ t }) => t.entrada >= o.inicio && t.entrada <= o.fim && (!o.bloco || t.leito.bloco === o.bloco),
      )
      .sort((a, b) => `${b.t.entrada}${b.t.hora}`.localeCompare(`${a.t.entrada}${a.t.hora}`));
    const pagina = todos.slice((o.pagina - 1) * o.porPagina, o.pagina * o.porPagina);
    const min = (d: string, h: string) => Date.parse(`${d}T${h.slice(0, 2)}:${h.slice(2, 4)}:00Z`) / 60_000;
    return {
      itens: pagina.map(({ i, t }) => ({
        internacao: i.reg,
        leito: t.leito,
        tipo: { codigo: t.tipo, nome: t.tipo === 3 ? 'U.T.I.' : t.tipo === 2 ? 'Apartamento' : 'Enfermaria' },
        entrada: t.entrada,
        horaEntrada: t.hora,
        saida: t.saida,
        horaSaida: t.horaSaida,
        horas: Math.max(
          0,
          Math.round(
            ((t.saida ? min(t.saida, t.horaSaida ?? '0000') : min(hoje, '2359')) - min(t.entrada, t.hora)) /
              6,
          ) / 10,
        ),
      })),
      total: todos.length,
      pagina: o.pagina,
      porPagina: o.porPagina,
    };
  }

  async solicitacoes(
    c: ContextoAdt,
  ): Promise<{ itens: SolicitacaoLimpezaFila[]; paradasAntigas: number; cortada: boolean }> {
    const s = this.e(c);
    const fechada = (id: number) =>
      s.etapas.some((x) => x.solicitacao === id && (x.etapa === 'liberado' || x.etapa === 'cancelado'));
    return {
      itens: [...s.solicitacoes.values()]
        .filter((x) => !fechada(x.id))
        .map((x) => ({
          solicitacao: x.id,
          leito: x.leito,
          situacaoCodigo: x.situacao,
          solicitadaEm: x.solicitadaEm,
          atendimento: x.cab,
        })),
      paradasAntigas: 3,
      cortada: false,
    };
  }

  async etapas(c: ContextoAdt, solicitacao: number): Promise<EtapaDaLimpeza[]> {
    return this.e(c).etapas.filter((x) => x.solicitacao === solicitacao);
  }

  /** W0-07 (M3): as liberadas no período, com as etapas gravadas (a área é o bloco; o nome, o próprio código). */
  async limpezasLiberadas(c: ContextoAdt, de: string, ate: string) {
    const s = this.e(c);
    const itens = [...s.solicitacoes.values()]
      .map((sol) => ({ sol, etapas: s.etapas.filter((x) => x.solicitacao === sol.id) }))
      .filter(({ etapas }) =>
        etapas.some(
          (x) =>
            x.etapa === 'liberado' && x.registradoEm.slice(0, 10) >= de && x.registradoEm.slice(0, 10) <= ate,
        ),
      )
      .map(({ sol, etapas }) => ({
        solicitacao: sol.id,
        solicitadaEm: sol.solicitadaEm,
        area: sol.leito.bloco,
        etapas: etapas.map((x) => ({
          etapa: x.etapa,
          em: x.registradoEm,
          prazo: x.prazo,
          tipoLimpeza: x.tipoLimpeza,
          profissional: x.profissional,
        })),
      }));
    return { itens, areas: Object.fromEntries(itens.map((x) => [x.area, `Bloco ${x.area}`])) };
  }

  async leitoDaSolicitacao(c: ContextoAdt, solicitacao: number) {
    const x = this.e(c).solicitacoes.get(solicitacao);
    if (!x) return null;
    return {
      leito: x.leito,
      espelho: x.espelho,
      criticidade: x.leito.acomodacao.startsWith('UTI') ? 1 : 2,
      situacaoCodigo: x.situacao,
    };
  }

  async contaDoCodigo(c: ContextoAdt, codigo: number): Promise<number | null> {
    const s = this.e(c);
    if (s.contas.has(codigo)) return codigo;
    for (const [id, x] of s.contas) if (x.numero === codigo) return id;
    return null;
  }

  async localizacao(c: ContextoAdt, conta: number): Promise<LocalizacaoConta | null> {
    const s = this.e(c);
    const x = s.contas.get(conta);
    if (!x) return null;
    const i = s.internacoes.get(x.reg);
    const nomeSetor = (cod: number) => SETORES.find((y) => y.codigo === cod)?.nome ?? `SETOR ${cod}`;
    const movs = s.movimentos.filter((m) => m.conta === conta).reverse();
    const linha = movs.map((m) => {
      const exc = s.sameExt.find((y) => y.movimento === m.id && y.tipo === 'exclusao');
      const rem = s.sameExt.find((y) => y.movimento === m.id && y.tipo === 'remessa');
      return {
        id: m.id,
        operacao: {
          codigo: m.operacao,
          nome: OPERACOES_SAME.find((y) => y.codigo === m.operacao)?.rotulo ?? '',
        },
        origem: { codigo: m.origem, nome: nomeSetor(m.origem) },
        destino: { codigo: m.destino, nome: nomeSetor(m.destino) },
        em: m.em,
        usuario: m.usuario,
        responsavel: m.responsavel,
        excluido: m.excluido,
        motivoExclusao: exc?.motivo ?? null,
        protocolo: rem?.protocolo ?? null,
        prazoDevolucao: rem?.prazo ?? null,
        aceito: s.sameExt.some((y) => y.movimento === m.id && y.tipo === 'aceite'),
        cobrada: s.sameExt.some((y) => y.movimento === m.id && y.tipo === 'cobranca'),
      };
    });
    const atual = linha.find((m) => !m.excluido) ?? null;
    const ocorrencias = s.sameExt
      .filter((y) => y.conta === conta && y.tipo === 'ocorrencia')
      .reverse()
      .map((y) => ({ motivo: y.motivo ?? '', em: y.em, por: y.por }));
    return {
      conta,
      numero: x.numero,
      atendimento: x.reg,
      tipo: 'internacao',
      paciente: i?.nome ?? '',
      prontuario: i?.prontuario ?? 0,
      local: atual ? { setor: atual.destino, desde: atual.em, operacao: atual.operacao.nome } : null,
      devolucaoAtrasada: false,
      linhaDoTempo: linha,
      ocorrencias,
      cortada: false,
    };
  }

  /** Os volumes fora do SAME além do prazo (pelo relógio da porta; o último movimento válido de cada conta). */
  async devolucoesAtrasadas(c: ContextoAdt, o: { setorSame: number; prazoDias: number }) {
    const s = this.e(c);
    const agora = Date.parse(`${this.relogioAtual().agora}Z`);
    const nomeSetor = (cod: number) => SETORES.find((y) => y.codigo === cod)?.nome ?? `SETOR ${cod}`;
    const itens = [...s.contas.keys()]
      .map((conta) => this.ultimo(s, conta))
      .filter((m): m is MovimentoM => m !== null && [2, 5].includes(m.operacao) && m.destino !== o.setorSame)
      .map((m) => {
        const rem = s.sameExt.find((y) => y.movimento === m.id && y.tipo === 'remessa');
        const prazo = rem?.prazo
          ? Date.parse(`${rem.prazo}T23:59:59Z`)
          : Date.parse(`${m.em}Z`) + o.prazoDias * 86_400_000;
        return { m, prazo };
      })
      .filter((x) => agora > x.prazo)
      .map(({ m, prazo }) => ({
        conta: m.conta,
        movimento: m.id,
        setor: { codigo: m.destino, nome: nomeSetor(m.destino) },
        desde: m.em,
        prazo: new Date(prazo).toISOString().slice(0, 10),
        diasAtraso: Math.floor((agora - prazo) / 86_400_000),
        cobrada: s.sameExt.some((y) => y.movimento === m.id && y.tipo === 'cobranca'),
      }));
    return { itens, cortada: false };
  }

  async apoio(c: ContextoAdt): Promise<ApoioInternacaoTela> {
    const p = await this.leiturasPainel(c);
    return {
      convenios: CONVENIOS,
      especialidades: ESPECIALIDADES,
      motivosAlta: MOTIVOS_ALTA.map((m) => ({ ...m, grupo: grupoMotivoAlta(m.codigo) })),
      acomodacoes: p.acomodacoes.map((a) => ({
        bloco: a.bloco,
        acomodacao: a.acomodacao,
        nome: a.nome,
        tipo: a.tipo ?? 0,
      })),
      tiposLimpeza: TIPOS_LIMPEZA,
      profissionaisLimpeza: PROFISSIONAIS_LIMPEZA,
      setores: SETORES,
      operacoesSame: OPERACOES_SAME.map((o) => ({ codigo: o.codigo, nome: o.rotulo })),
      motivosSame: MOTIVOS_SAME,
      motivosExclusao: [],
      unidades: [{ codigo: 4, nome: `UNIDADE ${M}` }],
      centrosCusto: [{ codigo: 300100, nome: `INTERNACAO ${M}` }],
    };
  }

  async medicos(_c: ContextoAdt, termo: string) {
    const t = termo.trim().toUpperCase();
    return MEDICOS.filter((m) => !t || m.nome.includes(t) || m.conselho === t);
  }

  async cid(_c: ContextoAdt, termo: string) {
    const t = termo.trim().toUpperCase();
    return CIDS.filter((x) => !t || x.codigo.startsWith(t) || x.nome.includes(t));
  }

  async incoerencias() {
    return {
      altaAntesDaEntrada: [],
      listaAltaAntes: [],
      leitosCadastro: 15,
      leitosEspelho: 15,
      internadosSemTrechoAberto: 0,
      listaSemTrecho: [],
    };
  }

  async pacienteParaLeito(c: ContextoAdt, q: { paciente?: number; reg?: number }) {
    if (q.paciente !== undefined) {
      const [p] = (await this.deps.lerPacientes?.(c, [q.paciente])) ?? [];
      return p ? { paciente: p.id, sexo: p.sexo, nascimento: p.nascimento } : null;
    }
    if (q.reg === undefined) return null;
    const s = this.e(c);
    await this.materializar(c, s);
    const i = s.internacoes.get(q.reg);
    return i ? { paciente: i.paciente, sexo: i.sexo, nascimento: i.nascimento } : null;
  }

  async impresso(c: ContextoAdt, reg: number): Promise<DadosImpressoInternacao | null> {
    const i = this.e(c).internacoes.get(reg);
    if (!i || !i.ativa) return null;
    return {
      reg: i.reg,
      idPaciente: i.paciente,
      prontuario: i.prontuario,
      nome: i.nome,
      nascimento: i.nascimento,
      convenio: CONVENIOS.find((x) => x.codigo === i.convenio)?.nome ?? '',
      entrada: i.entrada,
      hora: i.hora,
      leito: `${i.leito.bloco} ${i.leito.acomodacao} ${i.leito.leito}`,
      medico: MEDICOS.find((m) => m.vinculo === i.assistente)?.nome ?? '',
      alergia: false,
    };
  }

  async fichas(c: ContextoAdt, reg: number) {
    const i = this.e(c).internacoes.get(reg);
    if (!i) return [];
    return [
      { modelo: 1, grafica: true, nome: 'FICHA DE INTERNACAO', copias: 1 },
      ...(i.convenio === 901 ? [{ modelo: 2, grafica: true, nome: 'TERMO DO CONVENIO', copias: 2 }] : []),
    ];
  }

  /** O profissional sintético da higienização ligado ao login sintético (SINT.HIGIENIZACAO → 1; SINT.HIGIENIZACAO2 → 2). */
  async profissionalLimpeza(_c: ContextoAdt, login: string): Promise<number | null> {
    const l = login.trim().toUpperCase();
    return l === 'SINT.HIGIENIZACAO' ? 1 : l === 'SINT.HIGIENIZACAO2' ? 2 : null;
  }

  async profissional(_c: ContextoAdt, login: string): Promise<ProfissionalDaSessao | null> {
    // O médico sintético da sessão é a ANA MEDICA (CBO 225125, conselho ativo); a recepção não tem vínculo clínico.
    if (!/MEDICO/i.test(login)) return null;
    return { vinculo: 7101, crm: 52001, nome: `ANA MEDICA ${M}`, codigoCbo: '225125', conselhoAtivo: true };
  }
}
