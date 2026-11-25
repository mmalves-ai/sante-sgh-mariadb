// Porta da portaria EM MEMÓRIA (M50, etapa 5): a sessão sintética de dev/ci (E2E) e os testes da API. Os internados, as
// unidades e os domínios são SINTÉTICOS (marca "SINTETICO"; os domínios repetem os rótulos do controle de acesso da
// configuração de origem, que não são dado de pessoa); as gravações seguem as mesmas recusas da porta do banco (a visita aberta
// uma vez por visitante, a chave do ato, a saída uma vez só, a regra pela versão, o bloqueio revogado uma vez, o
// acompanhante vigente com a troca, o terminal pela versão, o evento da catraca uma vez só). Nada conecta a banco.
import { type ContextoOperacao, ErroOperacao, recusa } from '@sgh/nucleo';
import type {
  AcompanhanteRegistrado,
  BloqueioVisitaRegistrado,
  DominiosDaPortaria,
  EventoCatracaRegistrado,
  RegraAcessoRegistrada,
  InternadoPortaria,
  RegraVisitaRegistrada,
  SituacaoDoPaciente,
  TerminalRegistrado,
  VisitaRegistrada,
  VisitanteRegistrado,
} from './tipos.js';
import type { ContextoPortaria, GravadorPortaria, PortaPortaria } from './porta.js';

/** Chave do estabelecimento da sessão na memória. */
const est = (c: Pick<ContextoPortaria, 'estabelecimento'> & { readonly hospital?: string }) =>
  c.estabelecimento != null ? String(c.estabelecimento) : String(c.hospital ?? '0');

const minuto = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** Os internados sintéticos (nenhum dado real). */
export const INTERNADOS_PORTARIA_SINTETICOS: readonly InternadoPortaria[] = [
  {
    internacao: 50_501,
    paciente: 905_501,
    nome: 'PACIENTE SINTETICO PORTARIA UM',
    nascimento: '1950-03-10',
    unidade: 'INT-2',
    unidadeNome: 'INTERNACAO SINTETICA 2',
    acomod: '201',
    leitoCodigo: 'A',
    leito: '201-A',
    isolamento: false,
  },
  {
    internacao: 50_502,
    paciente: 905_502,
    nome: 'PACIENTE SINTETICO PORTARIA DOIS',
    nascimento: '1985-07-01',
    unidade: 'INT-2',
    unidadeNome: 'INTERNACAO SINTETICA 2',
    acomod: '202',
    leitoCodigo: 'B',
    leito: '202-B',
    isolamento: true,
  },
  {
    internacao: 50_503,
    paciente: 905_503,
    nome: 'PACIENTE SINTETICO PORTARIA TRES',
    nascimento: '1970-11-20',
    unidade: 'UTI-1',
    unidadeNome: 'UTI SINTETICA',
    acomod: 'U1',
    leitoCodigo: '02',
    leito: 'U1-02',
    isolamento: false,
  },
  {
    internacao: 50_504,
    paciente: 905_504,
    nome: 'PACIENTE SINTETICO PORTARIA SIGILO',
    nascimento: '1990-01-15',
    unidade: 'INT-3',
    unidadeNome: 'INTERNACAO SINTETICA 3',
    acomod: '301',
    leitoCodigo: 'A',
    leito: '301-A',
    isolamento: false,
  },
  {
    internacao: 50_505,
    paciente: 905_505,
    nome: 'PACIENTE SINTETICO PORTARIA CRIANCA',
    nascimento: '2018-06-05',
    unidade: 'INT-1',
    unidadeNome: 'INTERNACAO SINTETICA 1',
    acomod: '101',
    leitoCodigo: 'C',
    leito: '101-C',
    isolamento: false,
  },
];

const DOMINIOS: DominiosDaPortaria = {
  tiposVisitante: [
    { codigo: 1, nome: 'Acompanhante', ativo: true },
    { codigo: 2, nome: 'Fornecedor', ativo: true },
    { codigo: 3, nome: 'Funcionário', ativo: true },
    { codigo: 4, nome: 'Representante', ativo: true },
    { codigo: 5, nome: 'Terceiro', ativo: true },
    { codigo: 6, nome: 'Visitante', ativo: true },
    { codigo: 7, nome: 'Profissional', ativo: true },
    { codigo: 8, nome: 'Colaborador', ativo: true },
  ],
  tiposVisitado: [
    { codigo: 1, nome: 'Funcionário', paciente: false },
    { codigo: 2, nome: 'Local', paciente: false },
    { codigo: 3, nome: 'Médico', paciente: false },
    { codigo: 4, nome: 'Paciente', paciente: true },
    { codigo: 5, nome: 'Geral', paciente: false },
    { codigo: 6, nome: 'Colaborador', paciente: false },
  ],
  identificacoes: [
    { codigo: 1, nome: 'Biometria', biometrica: true },
    { codigo: 2, nome: 'Crachá', biometrica: false },
    { codigo: 3, nome: 'Etiqueta', biometrica: false },
    { codigo: 4, nome: 'Facial', biometrica: true },
  ],
  situacoesAcesso: [
    { codigo: 1, nome: 'Todas' },
    { codigo: 2, nome: 'Pré - Visita' },
    { codigo: 3, nome: 'Registrar' },
  ],
  tiposTerminal: [
    { codigo: 1, nome: 'Catraca IHM', fabricante: 1, fabricanteNome: 'TECNIBRA', ativo: true },
    { codigo: 2, nome: 'Terminal IHM', fabricante: 1, fabricanteNome: 'TECNIBRA', ativo: false },
    { codigo: 5, nome: 'Local', fabricante: 2, fabricanteNome: 'Não informado', ativo: true },
    { codigo: 6, nome: 'Inner Acesso', fabricante: 3, fabricanteNome: 'TOPDATA', ativo: true },
  ],
};

interface VisitanteMem extends VisitanteRegistrado {
  readonly hospital: string;
  readonly chave: string | null;
  readonly anonimizado: boolean;
}
type VisitaMem = VisitaRegistrada & { hospital: string; chave: string | null; origem?: string };

export interface OpcoesPortariaMemoria {
  /** O relógio (padrão: o do processo). */
  readonly agora?: () => Date;
  /** Regras de visita sintéticas iniciais (padrão: o dia inteiro, para a sessão sintética rodar a qualquer hora). */
  readonly regras?: readonly Omit<
    RegraVisitaRegistrada,
    'id' | 'versao' | 'atualizadoPor' | 'atualizadoEm'
  >[];
  /** Os internados sintéticos (padrão: INTERNADOS_PORTARIA_SINTETICOS; os testes que cruzam módulos trazem os seus). */
  readonly internados?: readonly InternadoPortaria[];
}

/** A regra sintética do estabelecimento e da UTI (o dia inteiro; a UTI com 1 visitante ao mesmo tempo). */
export const REGRAS_SINTETICAS: NonNullable<OpcoesPortariaMemoria['regras']> = [
  {
    unidade: '*',
    horaInicio: '00:00',
    horaFim: '23:59',
    maxSimultaneos: 2,
    idadeMinima: 12,
    uti: false,
    isolamento: 'orientar',
    duracaoMaxMin: 120,
    observacao: 'Regra SINTETICA da sessão de desenvolvimento',
  },
  {
    unidade: 'UTI-1',
    horaInicio: '00:00',
    horaFim: '23:59',
    maxSimultaneos: 1,
    idadeMinima: 12,
    uti: true,
    isolamento: 'bloquear',
    duracaoMaxMin: 60,
    observacao: 'Regra SINTETICA da UTI',
  },
];

/** Perfis, setores e colaboradores SINTÉTICOS da catraca (o crachá do colaborador pela matrícula). */
export const PERFIS_SINTETICOS = [{ id: 501, nome: 'ENFERMAGEM SINTETICA' }] as const;
export const SETORES_SINTETICOS = [
  { id: 601, nome: 'UTI SINTETICA' },
  { id: 602, nome: 'RECEPCAO SINTETICA' },
] as const;
export const COLABORADORES_SINTETICOS = [
  { id: 701, matricula: 'SINT-0001', ativo: true, perfis: [501], setores: [601] },
] as const;

export class PortaPortariaMemoria implements PortaPortaria {
  readonly destino = 'memoria' as const;
  private seq = 7_000;
  private readonly agora: () => Date;
  readonly visitantes: VisitanteMem[] = [];
  readonly visitas: VisitaMem[] = [];
  readonly regrasMem: (RegraVisitaRegistrada & { hospital: string })[] = [];
  readonly bloqueiosMem: (BloqueioVisitaRegistrado & { hospital: string; revogadoEm: string | null })[] = [];
  readonly acompanhantesMem: (AcompanhanteRegistrado & { hospital: string })[] = [];
  readonly terminaisMem: (TerminalRegistrado & { hospital: string })[] = [];
  readonly eventosMem: (EventoCatracaRegistrado & {
    hospital: string;
    chave: string;
    colaborador?: number | null;
  })[] = [];
  readonly travas: string[] = [];
  readonly regrasAcessoMem: (RegraAcessoRegistrada & { hospital: string })[] = [];
  /** O crachá ligado a cada matrícula sintética, por estabelecimento. */
  readonly crachasMem: { hospital: string; matricula: string; cracha: string }[] = [];

  private readonly regrasIniciais: NonNullable<OpcoesPortariaMemoria['regras']>;
  private readonly semeados = new Set<string>();
  private readonly internadosLista: readonly InternadoPortaria[];

  constructor(o: OpcoesPortariaMemoria = {}) {
    this.agora = o.agora ?? (() => new Date());
    this.regrasIniciais = o.regras ?? REGRAS_SINTETICAS;
    this.internadosLista = o.internados ?? INTERNADOS_PORTARIA_SINTETICOS;
  }

  /** As regras, o sigilo e o terminal sintéticos de cada estabelecimento, na primeira vez que ele é usado. */
  private semear(hospital: string): void {
    if (this.semeados.has(hospital)) return;
    this.semeados.add(hospital);
    for (const r of this.regrasIniciais)
      this.regrasMem.push({
        ...r,
        id: ++this.seq,
        versao: 1,
        atualizadoPor: 'SINT.ADMIN',
        atualizadoEm: '2026-10-25T08:00',
        hospital,
      });
    // O paciente com sigilo de presença (não aparece na busca da portaria).
    this.bloqueiosMem.push({
      id: ++this.seq,
      internacao: 50_504,
      paciente: 905_504,
      motivo: 'sigilo',
      abrangencia: 'todos',
      visitante: null,
      visitanteNome: null,
      limite: null,
      incluiAcompanhante: false,
      justificativa: 'Sigilo de presença SINTETICO pedido pelo paciente',
      documento: null,
      inicio: '2026-10-01T08:00',
      fim: null,
      revogado: false,
      revogadoEm: null,
      criadoPor: 'SINT.ADMIN',
      hospital,
    });
    this.terminaisMem.push({
      id: ++this.seq,
      nome: 'CATRACA SINTETICA PRINCIPAL',
      tipoTerminal: 1,
      fabricante: 1,
      local: 'PORTARIA SINTETICA A',
      sentido: 'ambos',
      ativo: true,
      versao: 1,
      hospital,
    });
  }

  private agoraTexto(): string {
    return minuto(this.agora());
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(...a: [unknown, string, unknown, ContextoOperacao]): Promise<never> {
    const op = a[1];
    throw new ErroOperacao(
      500,
      'operacao-desconhecida',
      'Operação',
      `A portaria não usa o executor (${op}).`,
    );
  }

  private relido(hospital: string, reg: number, visitante: number | null, agora: string): SituacaoDoPaciente {
    const acomp = this.acompanhantesMem.find(
      (a) => a.hospital === hospital && a.internacao === reg && a.fim === null,
    );
    const internado = this.internadosLista.some((i) => i.internacao === reg);
    return {
      internado,
      bloqueios: this.bloqueiosMem
        .filter((b) => b.hospital === hospital && b.internacao === reg && !b.revogadoEm)
        .map((b) => ({
          id: b.id,
          motivo: b.motivo,
          abrangencia: b.abrangencia,
          visitante: b.visitante,
          limite: b.limite,
          incluiAcompanhante: b.incluiAcompanhante,
          inicio: b.inicio,
          fim: b.fim,
          revogado: false,
        })),
      abertas: this.visitas.filter(
        (v) =>
          v.hospital === hospital &&
          v.internacao === reg &&
          v.saida === null &&
          v.papel === 'visitante' &&
          v.validoAte > agora.slice(0, 16),
      ).length,
      acompanhante: acomp?.visitante ?? null,
      acompanhanteFundamento: acomp?.fundamento ?? null,
      visitanteEmVisita:
        visitante !== null &&
        this.visitas.some((v) => v.hospital === hospital && v.visitante === visitante && v.saida === null),
    };
  }

  private gravador(hospital: string): GravadorPortaria {
    this.semear(hospital);
    const agora = () => this.agoraTexto().slice(0, 16);
    const visitanteDe = (id: number) =>
      this.visitantes.find((v) => v.hospital === hospital && v.id === id && !v.anonimizado);
    const encerrar: GravadorPortaria['encerrarVisita'] = async (x) => {
      const v = this.visitas.find((a) => a.hospital === hospital && a.id === x.id);
      if (!v) throw recusa('nao-encontrado', 'Visita não encontrada.');
      if (v.saida !== null) throw recusa('visita-encerrada', 'A saída desta visita já foi registrada.');
      Object.assign(v, {
        saida: x.saida.slice(0, 16) < v.entrada ? v.entrada : x.saida.slice(0, 16),
        origem: x.origem,
      });
      return x.id;
    };
    return {
      registrarVisitante: async (v) => {
        const chave = `${hospital}:${v.tipoDocumento}:${v.documento}`;
        const ja = this.visitantes.find((x) => x.chave === chave);
        if (ja) {
          const nova = v.foto?.chave ?? null;
          const fotoAnterior = nova && ja.fotoChave && ja.fotoChave !== nova ? ja.fotoChave : null;
          Object.assign(ja, {
            nome: v.nome,
            nascimento: v.nascimento ?? ja.nascimento,
            telefone: v.telefone ?? ja.telefone,
            tipoVisitante: v.tipoVisitante,
            fotoChave: nova ?? ja.fotoChave,
            reterAte: ja.reterAte > v.reterAte ? ja.reterAte : v.reterAte,
          });
          return { id: ja.id, novo: false, fotoAnterior };
        }
        const id = ++this.seq;
        this.visitantes.push({
          id,
          hospital,
          chave,
          anonimizado: false,
          nome: v.nome,
          tipoDocumento: v.tipoDocumento,
          documento: v.documento,
          nascimento: v.nascimento,
          telefone: v.telefone,
          tipoVisitante: v.tipoVisitante,
          fotoChave: v.foto?.chave ?? null,
          reterAte: v.reterAte,
          ultimaVisita: null,
        });
        return { id, novo: true, fotoAnterior: null };
      },
      expurgarVisitantes: async (x) => {
        const ids: number[] = [];
        const fotos: string[] = [];
        for (const v of this.visitantes) {
          if (ids.length >= x.teto) break;
          if (v.hospital !== hospital || v.anonimizado || v.reterAte >= x.hoje) continue;
          if (this.visitas.some((a) => a.visitante === v.id && a.saida === null)) continue;
          if (v.fotoChave) fotos.push(v.fotoChave);
          Object.assign(v, {
            anonimizado: true,
            chave: null,
            nome: 'VISITANTE ANONIMIZADO',
            documento: '',
            tipoDocumento: 'anonimo',
            nascimento: null,
            telefone: null,
            fotoChave: null,
          });
          ids.push(v.id);
        }
        return { ids, fotos };
      },
      registrarVisita: async (v, avaliar) => {
        if (v.chave) {
          const ja = this.visitas.find((x) => x.chave === `${hospital}:${v.chave}`);
          if (ja) {
            if (ja.visitante !== v.visitante)
              throw recusa('chave-reutilizada', 'A chave deste pedido já foi usada em outra visita.');
            return { id: ja.id, papel: ja.papel, repetida: true };
          }
        }
        if (this.crachasMem.some((c) => c.hospital === hospital && c.cracha === v.cracha))
          throw recusa('cracha-em-uso', 'Este código já é o crachá de um colaborador: emita outro.', {
            campos: ['cracha'],
          });
        const pessoa = visitanteDe(v.visitante);
        if (!pessoa) throw recusa('visitante-nao-encontrado', 'Visitante não encontrado: cadastre de novo.');
        // A visita anterior do visitante com o crachá vencido e sem a saída: encerrada como expirada.
        const vencida = this.visitas.find(
          (x) =>
            x.hospital === hospital &&
            x.visitante === v.visitante &&
            x.saida === null &&
            x.validoAte <= v.entrada.slice(0, 16),
        );
        if (vencida) Object.assign(vencida, { saida: vencida.validoAte, origem: 'expirada' });
        let papel: VisitaRegistrada['papel'] = 'visitante';
        if (v.destino.tipo === 'paciente') {
          this.travas.push(`${hospital}:${v.destino.internacao}`);
          const r = this.relido(hospital, v.destino.internacao, v.visitante, v.entrada);
          if (!r.internado) throw recusa('sem-internacao', 'O paciente não está mais internado.');
          const a = avaliar(r);
          if (!a.permitida) throw recusa(a.recusa, a.mensagem);
          papel = a.papel;
        }
        if (
          this.visitas.some((x) => x.hospital === hospital && x.visitante === v.visitante && x.saida === null)
        )
          throw recusa('ja-em-visita', 'Este visitante já tem uma visita em curso: registre a saída antes.');
        const id = ++this.seq;
        const p = v.destino.tipo === 'paciente' ? v.destino : null;
        this.visitas.push({
          id,
          hospital,
          chave: v.chave ? `${hospital}:${v.chave}` : null,
          visitante: v.visitante,
          visitanteNome: pessoa.nome,
          documento: pessoa.documento,
          tipoDocumento: pessoa.tipoDocumento,
          telefone: pessoa.telefone,
          temFoto: pessoa.fotoChave !== null,
          papel,
          internacao: p?.internacao ?? null,
          paciente: p?.paciente ?? null,
          bloco: p?.bloco ?? null,
          acomod: p?.acomod ?? null,
          leito: p?.leito ?? null,
          tipoVisitado: v.tipoVisitado,
          local: v.destino.tipo === 'outro' ? v.destino.local : null,
          identificacao: v.identificacao,
          cracha: v.cracha,
          entrada: v.entrada.slice(0, 16),
          validoAte: v.validoAte.slice(0, 16),
          saida: null,
          excecao: v.excecao,
          usuario: v.usuario,
        });
        Object.assign(pessoa, {
          ultimaVisita: v.entrada.slice(0, 16),
          reterAte: pessoa.reterAte > v.reterAte ? pessoa.reterAte : v.reterAte,
        });
        return { id, papel, repetida: false };
      },
      encerrarVisita: encerrar,
      definirRegra: async (r) => {
        const ja = this.regrasMem.find((x) => x.hospital === hospital && x.unidade === r.unidade);
        const mudou = () =>
          recusa('regra-mudou', 'A regra desta unidade mudou depois que você abriu: abra de novo.');
        const valores = {
          horaInicio: r.horaInicio,
          horaFim: r.horaFim,
          maxSimultaneos: r.maxSimultaneos,
          idadeMinima: r.idadeMinima,
          uti: r.uti,
          isolamento: r.isolamento,
          duracaoMaxMin: r.duracaoMaxMin,
          observacao: r.observacao,
          atualizadoPor: r.usuario,
          atualizadoEm: agora(),
        };
        if (r.versao === null) {
          if (ja) throw mudou();
          const id = ++this.seq;
          this.regrasMem.push({ ...valores, id, unidade: r.unidade, versao: 1, hospital });
          return { id, versao: 1 };
        }
        if (!ja || ja.versao !== r.versao) throw mudou();
        Object.assign(ja, valores, { versao: ja.versao + 1 });
        return { id: ja.id, versao: ja.versao };
      },
      bloquear: async (b) => {
        if (b.visitante !== null && !this.visitantes.some((v) => v.id === b.visitante))
          throw recusa('visitante-nao-encontrado', 'Visitante não encontrado.');
        const id = ++this.seq;
        this.bloqueiosMem.push({
          ...b,
          id,
          hospital,
          visitanteNome: b.visitante !== null ? (visitanteDe(b.visitante)?.nome ?? null) : null,
          revogado: false,
          revogadoEm: null,
          criadoPor: b.usuario,
        });
        return id;
      },
      revogarBloqueio: async (x) => {
        const b = this.bloqueiosMem.find((y) => y.hospital === hospital && y.id === x.id);
        if (!b) throw recusa('nao-encontrado', 'Bloqueio não encontrado.');
        if (b.revogadoEm) throw recusa('ja-revogado', 'Este bloqueio já foi revogado.');
        if (x.exigeMotivo === 'clinico' && b.motivo !== 'clinico')
          throw recusa(
            'so-bloqueio-clinico',
            'Aqui só o bloqueio por decisão clínica: o sigilo, a ordem judicial e o pedido são revogados pela supervisão.',
          );
        if (b.motivo === 'clinico' && !x.podeClinico)
          throw recusa(
            'bloqueio-clinico',
            'O bloqueio por decisão clínica só é revogado pela enfermagem ou pelo médico.',
          );
        b.revogadoEm = agora();
        return { id: b.id, internacao: b.internacao, motivo: b.motivo };
      },
      registrarAcompanhante: async (a) => {
        this.travas.push(`${hospital}:${a.internacao}`);
        if (!this.internadosLista.some((i) => i.internacao === a.internacao))
          throw recusa('sem-internacao', 'O paciente não está mais internado.');
        const pessoa = visitanteDe(a.visitante);
        if (!pessoa) throw recusa('visitante-nao-encontrado', 'Visitante não encontrado: cadastre de novo.');
        const vigente = this.acompanhantesMem.find(
          (x) => x.hospital === hospital && x.internacao === a.internacao && x.fim === null,
        );
        if (vigente?.visitante === a.visitante)
          throw recusa('ja-acompanhante', 'Esta pessoa já é o acompanhante vigente deste paciente.');
        if (vigente) Object.assign(vigente, { fim: a.inicio.slice(0, 16) });
        const id = ++this.seq;
        this.acompanhantesMem.push({
          id,
          hospital,
          internacao: a.internacao,
          paciente: a.paciente,
          bloco: a.bloco,
          visitante: a.visitante,
          visitanteNome: pessoa.nome,
          fundamento: a.fundamento,
          refeicao: a.refeicao,
          pernoite: a.pernoite,
          observacao: a.observacao,
          inicio: a.inicio.slice(0, 16),
          fim: null,
          substitui: vigente?.id ?? null,
          criadoPor: a.usuario,
        });
        return { id, substituido: vigente?.id ?? null };
      },
      encerrarAcompanhante: async (x) => {
        const a = this.acompanhantesMem.find((y) => y.hospital === hospital && y.id === x.id);
        if (!a) throw recusa('nao-encontrado', 'Acompanhante não encontrado.');
        if (a.fim !== null) throw recusa('ja-encerrado', 'Este acompanhamento já foi encerrado.');
        Object.assign(a, { fim: x.fim.slice(0, 16) < a.inicio ? a.inicio : x.fim.slice(0, 16) });
        return { id: a.id, internacao: a.internacao };
      },
      configurarTerminal: async (t) => {
        if (t.id === null) {
          const id = ++this.seq;
          this.terminaisMem.push({
            id,
            hospital,
            nome: t.nome,
            tipoTerminal: t.tipoTerminal,
            fabricante: t.fabricante,
            local: t.local,
            sentido: t.sentido,
            ativo: t.ativo,
            versao: 1,
          });
          return { id, versao: 1 };
        }
        const ja = this.terminaisMem.find((x) => x.hospital === hospital && x.id === t.id);
        if (!ja || ja.versao !== t.versao)
          throw recusa('terminal-mudou', 'O terminal mudou depois que você abriu: abra de novo.');
        Object.assign(ja, {
          nome: t.nome,
          tipoTerminal: t.tipoTerminal,
          fabricante: t.fabricante,
          local: t.local,
          sentido: t.sentido,
          ativo: t.ativo,
          versao: ja.versao + 1,
        });
        return { id: ja.id, versao: ja.versao };
      },
      registrarEventoCatraca: async (ev, avaliar) => {
        const chave = `${hospital}:${ev.terminal}:${ev.chave}`;
        const ja = this.eventosMem.find((x) => x.chave === chave);
        if (ja)
          return {
            id: ja.id,
            resultado: ja.resultado,
            motivo: ja.motivo,
            visita: ja.visita,
            colaborador: ja.colaborador ?? null,
            repetido: true,
          };
        const t = this.terminaisMem.find((x) => x.hospital === hospital && x.id === ev.terminal);
        if (!t) throw recusa('terminal-desconhecido', 'Terminal não cadastrado neste estabelecimento.');
        const v = this.visitas.find((x) => x.hospital === hospital && x.cracha === ev.cracha) ?? null;
        const cr = v ? null : this.crachasMem.find((x) => x.hospital === hospital && x.cracha === ev.cracha);
        const col = cr ? COLABORADORES_SINTETICOS.find((x) => x.matricula === cr.matricula) : undefined;
        const colaborador = col
          ? { id: col.id, ativo: col.ativo, perfis: col.perfis, setores: col.setores }
          : null;
        const a = avaliar({
          terminal: {
            id: t.id,
            tipoTerminal: t.tipoTerminal,
            fabricante: t.fabricante,
            sentido: t.sentido,
            ativo: t.ativo,
          },
          visita: v ? { id: v.id, validoAte: v.validoAte, saida: v.saida } : null,
          colaborador,
          regras: colaborador
            ? this.regrasAcessoMem.filter((r) => r.hospital === hospital && r.terminal === t.id)
            : [],
        });
        const id = ++this.seq;
        this.eventosMem.unshift({
          id,
          hospital,
          chave,
          terminal: t.id,
          cracha: ev.cracha,
          sentido: ev.sentido,
          resultado: a.resultado,
          motivo: a.motivo,
          ocorridoEm: ev.ocorridoEm.slice(0, 16),
          visita: v?.id ?? null,
          colaborador: colaborador?.id ?? null,
        });
        if (a.encerra && v && v.saida === null)
          await encerrar({ id: v.id, saida: ev.ocorridoEm, origem: 'catraca', usuario: ev.usuario });
        return {
          id,
          resultado: a.resultado,
          motivo: a.motivo,
          visita: v?.id ?? null,
          colaborador: colaborador?.id ?? null,
          repetido: false,
        };
      },
      gravarRegraAcesso: async (r) => {
        if (!this.terminaisMem.some((x) => x.hospital === hospital && x.id === r.terminal))
          throw recusa('terminal-desconhecido', 'Terminal não cadastrado neste estabelecimento.');
        const valores = {
          terminal: r.terminal,
          perfil: r.perfil,
          setor: r.setor,
          diasSemana: r.diasSemana,
          horaInicio: r.horaInicio,
          horaFim: r.horaFim,
          entrada: r.entrada,
          saida: r.saida,
          vigenciaInicio: r.vigenciaInicio,
          vigenciaFim: r.vigenciaFim,
          prioridade: r.prioridade,
          ativo: r.ativo,
        };
        if (r.id === null) {
          const id = ++this.seq;
          this.regrasAcessoMem.push({ ...valores, id, versao: 1, hospital });
          return { id, versao: 1 };
        }
        const ja = this.regrasAcessoMem.find((x) => x.hospital === hospital && x.id === r.id);
        if (!ja) throw recusa('nao-encontrado', 'Regra de acesso não encontrada neste terminal.');
        if (ja.versao !== r.versao)
          throw recusa('regra-mudou', 'A regra de acesso mudou depois que você abriu: abra de novo.');
        Object.assign(ja, valores, { versao: ja.versao + 1 });
        return { id: ja.id, versao: ja.versao };
      },
      vincularCrachaColaborador: async (x) => {
        const col = COLABORADORES_SINTETICOS.find((c) => c.matricula === x.matricula);
        if (!col)
          throw recusa('matricula-desconhecida', 'Matrícula não encontrada neste estabelecimento.', {
            campos: ['matricula'],
          });
        const outro = this.crachasMem.find(
          (c) => c.hospital === hospital && c.cracha === x.cracha && c.matricula !== x.matricula,
        );
        if (x.cracha !== null && outro)
          throw recusa('cracha-em-uso', 'Este crachá já está ligado a outra matrícula.', {
            campos: ['cracha'],
          });
        const i = this.crachasMem.findIndex((c) => c.hospital === hospital && c.matricula === x.matricula);
        if (i >= 0) this.crachasMem.splice(i, 1);
        if (x.cracha !== null) this.crachasMem.push({ hospital, matricula: x.matricula, cracha: x.cracha });
        return { id: col.id };
      },
    };
  }

  async gravarSgh<T>(c: ContextoPortaria, _t: unknown, fn: (g: GravadorPortaria) => Promise<T>): Promise<T> {
    return fn(this.gravador(est(c)));
  }

  async relogio(): Promise<string> {
    return this.agoraTexto();
  }
  async dominios() {
    return DOMINIOS;
  }
  async unidades() {
    const m = new Map(this.internadosLista.map((i) => [i.unidade, i.unidadeNome]));
    return [...m]
      .map(([unidade, nome]) => ({ unidade, nome }))
      .sort((a, b) => a.unidade.localeCompare(b.unidade));
  }
  async internados() {
    return [...this.internadosLista];
  }
  async internado(_c: unknown, internacao: number) {
    return this.internadosLista.find((i) => i.internacao === internacao) ?? null;
  }
  async regrasAcesso(c: ContextoPortaria) {
    return this.regrasAcessoMem
      .filter((r) => r.hospital === est(c))
      .map((r): RegraAcessoRegistrada => {
        const copia: Partial<typeof r> = { ...r };
        delete copia.hospital;
        return copia as RegraAcessoRegistrada;
      });
  }
  async perfisESetores() {
    return { perfis: [...PERFIS_SINTETICOS], setores: [...SETORES_SINTETICOS] };
  }
  async regras(c: ContextoPortaria) {
    this.semear(est(c));
    return this.regrasMem.filter((r) => r.hospital === est(c));
  }
  async bloqueios(c: ContextoPortaria, internacao?: number | null) {
    this.semear(est(c));
    return this.bloqueiosMem.filter(
      (b) => b.hospital === est(c) && !b.revogadoEm && (internacao == null || b.internacao === internacao),
    );
  }
  async visitante(c: ContextoPortaria, id: number) {
    this.semear(est(c));
    return this.visitantes.find((v) => v.hospital === est(c) && v.id === id && !v.anonimizado) ?? null;
  }
  async buscarVisitantes(
    c: ContextoPortaria,
    b: { documento: { tipo: string; numero: string } | null; nomeBusca: string | null },
  ) {
    if (b.documento) {
      const chave = `${est(c)}:${b.documento.tipo}:${b.documento.numero}`;
      return this.visitantes.filter((v) => v.chave === chave);
    }
    if (!b.nomeBusca || b.nomeBusca.length < 3) return [];
    const alvo = b.nomeBusca;
    const norma = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    return this.visitantes
      .filter((v) => v.hospital === est(c) && !v.anonimizado && norma(v.nome).startsWith(alvo))
      .slice(0, 30);
  }
  async vencidos(c: ContextoPortaria, hoje: string) {
    this.semear(est(c));
    return this.visitantes.filter(
      (v) =>
        v.hospital === est(c) &&
        !v.anonimizado &&
        v.reterAte < hoje &&
        !this.visitas.some((a) => a.visitante === v.id && a.saida === null),
    ).length;
  }
  async abertas(c: ContextoPortaria) {
    this.semear(est(c));
    // Como no banco: o crachá válido ou vencido há até 24 horas.
    const limite = new Date(this.agora().getTime() - 24 * 3_600_000);
    const corte = minuto(limite).slice(0, 16);
    return this.visitas
      .filter((v) => v.hospital === est(c) && v.saida === null && v.validoAte > corte)
      .reverse();
  }
  async visita(c: ContextoPortaria, id: number) {
    this.semear(est(c));
    return this.visitas.find((v) => v.hospital === est(c) && v.id === id) ?? null;
  }
  async visitasDoPeriodo(
    c: ContextoPortaria,
    f: { internacao: number | null; unidade: string | null; de: string; ate: string },
  ) {
    return this.visitas.filter(
      (v) =>
        v.hospital === est(c) &&
        (f.internacao !== null ? v.internacao === f.internacao : v.bloco === f.unidade) &&
        v.entrada.slice(0, 10) <= f.ate &&
        (v.saida ?? v.validoAte).slice(0, 10) >= f.de,
    );
  }
  async acompanhantes(c: ContextoPortaria, unidade?: string | null) {
    this.semear(est(c));
    return this.acompanhantesMem.filter(
      (a) => a.hospital === est(c) && a.fim === null && (unidade == null || a.bloco === unidade),
    );
  }
  async terminais(c: ContextoPortaria) {
    this.semear(est(c));
    return this.terminaisMem.filter((t) => t.hospital === est(c));
  }
  async eventos(c: ContextoPortaria, teto = 50) {
    this.semear(est(c));
    return this.eventosMem.filter((e) => e.hospital === est(c)).slice(0, teto);
  }
  async foto(c: ContextoPortaria, id: number) {
    this.semear(est(c));
    return this.visitantes.find((v) => v.hospital === est(c) && v.id === id)?.fotoChave ?? null;
  }
}
