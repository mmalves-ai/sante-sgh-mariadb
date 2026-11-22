// Porta das especialidades sob demanda e do lactário na sessão sintética (M45, etapa 6; dev e ci, E2E @M45.6): quatro
// internados SINTÉTICOS admitidos em horas relativas ao relógio (uma parturiente no centro obstétrico, um paciente da
// oncologia, uma paciente da oftalmologia e um lactente na pediatria), os cadastros com os mesmos rótulos dos do
// estabelecimento (acuidade, exames e graduação da oftalmologia, tipos de protocolo e de parto) e os vínculos
// profissionais pelo nome do login (ESPECIALISTA médico, FARMA farmacêutico, LACTARIO nutricionista, ENFERM enfermeiro).
// As gravações ficam em memória, com as mesmas recusas do banco (a versão do protocolo pelo hash, o ciclo repetido, a
// validação e a conferência uma vez e por outra pessoa). Nenhum dado real.
import { ErroOperacao } from '@sgh/nucleo';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import type {
  AlteracaoLactarioRegistrada,
  CadastrosOftalmologia,
  CicloOncologicoRegistrado,
  EventoOncologicoRegistrado,
  ExameOftalmologicoRegistrado,
  InternacaoEspecialidadeLida,
  OrdemLactarioRegistrada,
  PontoPartograma,
  ProtocoloOncologicoRegistrado,
  RecemNascidoRegistrado,
} from './tipos.js';
import type {
  ContextoEspecialidades,
  GravadorEspecialidades,
  InternacaoDaBusca,
  PortaEspecialidades,
  VinculoDoLogin,
} from './porta.js';

const p2 = (n: number) => String(n).padStart(2, '0');
/** "AAAA-MM-DDTHH:MM" de um Date (componentes locais do processo). */
function local(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
/** A cópia sem as chaves (as linhas em memória guardam o estabelecimento e a internação; a leitura não devolve). */
function omitir<T extends object, K extends keyof T>(o: T, ...chaves: K[]): Omit<T, K> {
  const r = { ...o };
  for (const k of chaves) delete r[k];
  return r;
}
/** Chave do estado em memória: o cliente e o estabelecimento da sessão. */
const chaveDe = (c: ContextoEspecialidades) => `${c.cliente}:${c.estabelecimento ?? 0}`;
const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);

interface Sintetico extends Omit<InternacaoEspecialidadeLida, 'admissao' | 'aberta'> {
  readonly horasAtras: number;
  readonly diasDeVida?: number;
}

const SINTETICOS: readonly Sintetico[] = [
  {
    internacao: 950_101,
    prontuario: 70_101,
    paciente: 99_601,
    nome: 'JULIA SINTETICA PARTURIENTE',
    nascimento: '1996-04-12',
    sexo: 'F',
    bloco: 'CO',
    acomodacao: '01',
    leito: 'A',
    horasAtras: 6,
  },
  {
    internacao: 950_102,
    prontuario: 70_102,
    paciente: 99_602,
    nome: 'CARLOS SINTETICO ONCOLOGIA',
    nascimento: '1962-07-20',
    sexo: 'M',
    bloco: '3B',
    acomodacao: '301',
    leito: 'A',
    horasAtras: 30,
  },
  {
    internacao: 950_103,
    prontuario: 70_103,
    paciente: 99_603,
    nome: 'ROSA SINTETICA OFTALMO',
    nascimento: '1950-02-03',
    sexo: 'F',
    bloco: '3B',
    acomodacao: '302',
    leito: 'B',
    horasAtras: 20,
  },
  {
    internacao: 950_104,
    prontuario: 70_104,
    paciente: 99_604,
    nome: 'BEBE SINTETICO LACTARIO',
    nascimento: null,
    diasDeVida: 30,
    sexo: 'M',
    bloco: 'PED',
    acomodacao: '10',
    leito: 'A',
    horasAtras: 50,
  },
];

const CADASTROS: CadastrosOftalmologia = {
  grupos: [
    { codigo: 1, nome: 'Pre-exame' },
    { codigo: 2, nome: 'Refração/lentes de contato' },
    { codigo: 3, nome: 'Exames externo ocular' },
    { codigo: 5, nome: 'Exames complementares descritivos' },
    { codigo: 6, nome: 'Exames complementares estruturados' },
  ],
  exames: [
    { codigo: 2, grupo: 1, nome: 'Tonometria non contact' },
    { codigo: 5, grupo: 1, nome: 'Ceratometria' },
    { codigo: 10, grupo: 2, nome: 'Refracao final' },
    { codigo: 13, grupo: 3, nome: 'Reflexos pupilares' },
    { codigo: 22, grupo: 5, nome: 'Mapeamento de retina' },
    { codigo: 33, grupo: 6, nome: 'Gonioscopia' },
    { codigo: 34, grupo: 5, nome: 'Tomografia de Coerência Óptica' },
  ],
  acuidades: [
    { codigo: 1, nome: '20/20 (1,0)', tipo: 'T' },
    { codigo: 2, nome: '20/25 (0,8)', tipo: 'T' },
    { codigo: 4, nome: '20/40 (0,5)', tipo: 'T' },
    { codigo: 6, nome: '20/60 (0,3)', tipo: 'T' },
    { codigo: 10, nome: '20/200 (0,1)', tipo: 'T' },
    { codigo: 12, nome: '20/400 (0,05)', tipo: 'T' },
    { codigo: 15, nome: 'CD (conta dedos) a 1m', tipo: 'A' },
    { codigo: 18, nome: 'Movimento de mãos', tipo: 'A' },
    { codigo: 21, nome: 'NPL', tipo: 'T' },
  ],
  graduacoes: [
    { codigo: 1, sigla: '0', nome: 'Ângulo fechado' },
    { codigo: 2, sigla: '1', nome: 'Ângulo estreito' },
    { codigo: 4, sigla: '3', nome: 'Ângulo aberto' },
  ],
  tiposArquivo: ['.jpg', '.pdf'],
};
const TIPOS_PROTOCOLO = [
  { codigo: 1, nome: 'Pré-Quimioterapia' },
  { codigo: 2, nome: 'Pré-Quimioterapia + Quimioterapia' },
  { codigo: 3, nome: 'Quimioterapia antineoplásica' },
  { codigo: 4, nome: 'Suporte' },
  { codigo: 5, nome: 'Pós-Quimioterapia' },
];
const TIPOS_PARTO = [
  { codigo: 1, nome: 'NORMAL' },
  { codigo: 2, nome: 'CESÁRIA' },
  { codigo: 3, nome: 'FÓRCEPS' },
  { codigo: 4, nome: 'SEM ESPECIFICAÇÃO' },
];

function vinculosSinteticos(login: string): VinculoDoLogin[] {
  const l = login.toUpperCase();
  const cbo = /ESPECIALISTA/.test(l)
    ? '225265'
    : /FARMA/.test(l)
      ? '223405'
      : /LACTARIO/.test(l)
        ? '223710'
        : /ENFERM/.test(l)
          ? '223505'
          : /MEDICO/.test(l)
            ? '225125'
            : null;
  return cbo ? [{ vinculo: 7_460, cbo, ativo: true }] : [];
}

export class PortaEspecialidadesMemoria implements PortaEspecialidades {
  readonly destino = 'memoria' as const;
  private seq = 1;
  readonly examesGravados: (ExameOftalmologicoRegistrado & { estab: string })[] = [];
  readonly protocolosGravados: (ProtocoloOncologicoRegistrado & { estab: string })[] = [];
  readonly ciclosGravados: (CicloOncologicoRegistrado & { estab: string })[] = [];
  readonly pontosGravados: (PontoPartograma & { estab: string; internacao: number })[] = [];
  readonly rnsGravados: (RecemNascidoRegistrado & { estab: string; internacao: number })[] = [];
  readonly ordensGravadas: (OrdemLactarioRegistrada & { estab: string })[] = [];
  // W0-05: os eventos do protocolo e do ciclo e o log das alterações do lactário.
  readonly eventosOnco: (EventoOncologicoRegistrado & { estab: string })[] = [];
  readonly alteracoesGravadas: (AlteracaoLactarioRegistrada & { estab: string })[] = [];
  /** O teto da lista dos ciclos de uma versão (o do banco é 500; os testes baixam para provar a lista cortada). */
  tetoCiclosDaVersao = 500;

  constructor(private readonly relogioFixo: (() => Date) | null = null) {}

  private agoraDate(): Date {
    return this.relogioFixo ? this.relogioFixo() : new Date();
  }

  private agora(): string {
    return local(this.agoraDate());
  }

  private internado(s: Sintetico): InternacaoEspecialidadeLida {
    const agora = this.agoraDate();
    const admissao = new Date(agora.getTime() - s.horasAtras * 3_600_000);
    const nascimento =
      s.diasDeVida !== undefined
        ? local(new Date(agora.getTime() - s.diasDeVida * 86_400_000)).slice(0, 10)
        : s.nascimento;
    return { ...omitir(s, 'horasAtras', 'diasDeVida'), nascimento, admissao: local(admissao), aberta: true };
  }

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw new Error(
      'As especialidades gravam pela gravação direta da porta (com a trilha na mesma transação).',
    );
  }

  async gravarSgh<T>(
    c: ContextoEspecialidades,
    _trilha: unknown,
    fn: (g: GravadorEspecialidades) => Promise<T>,
  ) {
    const h = chaveDe(c);
    const em = this.agora();
    const g: GravadorEspecialidades = {
      registrarExame: async (x) => {
        if ((x.od.pio !== null || x.oe.pio !== null) && x.metodoPio === null)
          throw new Error('Operation violates CHECK constraint ck_exame_oftalmologico_valor_metodo');
        const id = this.seq++;
        this.examesGravados.push({
          id,
          internacao: x.internacao,
          od: x.od,
          oe: x.oe,
          metodoPio: x.metodoPio,
          classificacao: x.classificacao,
          alertas: [...x.alertas],
          conduta: x.conduta,
          itens: [...x.itens],
          por: x.usuario,
          em,
          estab: h,
        });
        return id;
      },
      publicarProtocolo: async (x) => {
        const mesmos = this.protocolosGravados.filter((p) => p.estab === h && p.codigo === x.codigo);
        if (mesmos.some((p) => p.hash === x.hash))
          throw new Error('violation of PRIMARY or UNIQUE KEY constraint "uq_protocolo_quimioterapia_hash"');
        const versao = Math.max(0, ...mesmos.map((p) => p.versao)) + 1;
        const id = this.seq++;
        this.protocolosGravados.push({
          id,
          codigo: x.codigo,
          versao,
          nome: x.nome,
          tipo: x.tipo,
          intervaloDias: x.intervaloDias,
          ciclos: x.ciclos,
          indicacao: x.indicacao,
          referencia: x.referencia,
          farmacos: [...x.farmacos],
          hash: x.hash,
          por: x.usuario,
          em,
          estab: h,
        });
        return { id, versao };
      },
      registrarCiclo: async (x) => {
        // A oferta conferida na gravação (como a porta do banco faz na transação).
        const doHospital = this.eventosOnco.filter((e) => e.estab === h);
        if (doHospital.some((e) => e.evento === 'versao-revogada' && e.protocolo === x.protocolo))
          throw recusa(
            'versao-revogada',
            'Esta versão do protocolo foi revogada: não é oferecida a ciclos novos (os ciclos já registrados continuam com ela).',
          );
        const ultimo = doHospital.find(
          (e) =>
            e.codigoProtocolo === x.codigoProtocolo &&
            (e.evento === 'protocolo-inativado' || e.evento === 'protocolo-reativado'),
        );
        if (ultimo?.evento === 'protocolo-inativado')
          throw recusa(
            'protocolo-inativo',
            'O protocolo está inativo: reative-o ou escolha outro protocolo.',
          );
        if (
          this.ciclosGravados.some(
            (c0) =>
              c0.estab === h &&
              c0.paciente === x.paciente &&
              c0.codigoProtocolo === x.codigoProtocolo &&
              c0.curso === (x.curso ?? 1) &&
              c0.numero === x.numero,
          )
        )
          throw new Error('violation of PRIMARY or UNIQUE KEY constraint "uq_ciclo_quimioterapia_numero"');
        const id = this.seq++;
        this.ciclosGravados.push({
          id,
          internacao: x.internacao,
          paciente: x.paciente,
          protocolo: x.protocolo,
          codigoProtocolo: x.codigoProtocolo,
          numero: x.numero,
          dataPrevista: x.dataPrevista,
          pesoKg: x.pesoKg,
          alturaCm: x.alturaCm,
          superficieM2: x.superficieM2,
          creatininaMgDl: x.creatininaMgDl,
          clearanceMlMin: x.clearanceMlMin,
          reducaoPct: x.reducaoPct,
          motivoReducao: x.motivoReducao,
          justificativaIntervalo: x.justificativaIntervalo,
          doses: [...x.doses],
          situacao: 'prescrito',
          por: x.usuario,
          em,
          validadoPor: null,
          validadoEm: null,
          curso: x.curso ?? 1,
          motivoCurso: x.motivoCurso ?? null,
          prescricoes: [],
          andamento: 'ativo',
          estab: h,
        });
        return id;
      },
      vincularPrescricao: async (x) => {
        const i = this.ciclosGravados.findIndex(
          (c0) =>
            c0.estab === h && c0.id === x.ciclo && c0.situacao === 'prescrito' && c0.andamento === 'ativo',
        );
        if (i < 0)
          throw recusa(
            'ciclo-nao-vinculavel',
            'O ciclo não existe ou já foi validado: a prescrição se liga ao ciclo antes da validação.',
          );
        const c0 = this.ciclosGravados[i]!;
        if (x.dataPrevista !== undefined && c0.dataPrevista !== x.dataPrevista)
          throw recusa(
            'ciclo-desatualizado',
            'A data prevista do ciclo mudou (outra pessoa o ajustou): abra de novo e escolha a prescrição da data nova.',
          );
        if (c0.prescricoes.includes(x.prescricao))
          throw new Error(
            'violation of PRIMARY or UNIQUE KEY constraint "uq_ciclo_quimioterapia_prescricao_par"',
          );
        this.ciclosGravados[i] = {
          ...c0,
          prescricoes: [...c0.prescricoes, x.prescricao].sort((a, b) => a - b),
        };
        return x.ciclo;
      },
      validarCiclo: async (x) => {
        const i = this.ciclosGravados.findIndex(
          (c0) =>
            c0.estab === h &&
            c0.id === x.id &&
            c0.situacao === 'prescrito' &&
            c0.andamento === 'ativo' &&
            c0.por !== x.usuario &&
            c0.prescricoes.length > 0,
        );
        if (i < 0)
          throw recusa(
            'ciclo-nao-validavel',
            'O ciclo já foi validado, não existe, foi prescrito por você ou não tem a prescrição ligada: a validação é de outra pessoa, uma vez, com a prescrição dos medicamentos ligada.',
          );
        this.ciclosGravados[i] = {
          ...this.ciclosGravados[i]!,
          situacao: 'validado',
          validadoPor: x.usuario,
          validadoEm: em,
        };
        return x.id;
      },
      registrarPartograma: async (x) => {
        if (x.bcf !== null && (x.bcf < 50 || x.bcf > 220))
          throw new Error('Operation violates CHECK constraint ck_partograma_registro_faixa');
        const id = this.seq++;
        this.pontosGravados.push({
          ...omitir(x, 'prontuario', 'paciente', 'vinculo', 'usuario'),
          id,
          alertas: [...x.alertas],
          por: x.usuario,
          registradoEm: em,
          estab: h,
          internacao: x.internacao,
        });
        return id;
      },
      registrarRecemNascido: async (x) => {
        if (x.apgar5 < 7 && x.apgar10 === null)
          throw new Error('Operation violates CHECK constraint ck_registro_nascimento_apgar');
        const id = this.seq++;
        this.rnsGravados.push({
          ...omitir(x, 'prontuario', 'paciente', 'vinculo', 'usuario'),
          id,
          por: x.usuario,
          em,
          estab: h,
        });
        return id;
      },
      registrarOrdem: async (x) => {
        const id = this.seq++;
        this.ordensGravadas.push({
          id,
          internacao: x.internacao,
          prontuario: x.prontuario,
          paciente: x.paciente,
          formula: x.formula,
          volumeMl: x.volumeMl,
          horarios: [...x.horarios],
          preparoEm: x.preparoEm,
          validadeEm: x.validadeEm,
          lote: x.lote,
          observacao: x.observacao,
          situacao: 'preparada',
          por: x.usuario,
          em,
          conferidoPor: null,
          conferidoEm: null,
          canceladaPor: null,
          canceladaEm: null,
          motivoCancelamento: null,
          etiquetaEm: null,
          estab: h,
        });
        return id;
      },
      conferirOrdem: async (x) => {
        const i = this.ordensGravadas.findIndex(
          (o) =>
            o.estab === h &&
            o.id === x.id &&
            o.situacao === 'preparada' &&
            o.canceladaEm === null &&
            o.por !== x.usuario,
        );
        if (i < 0)
          throw recusa(
            'ordem-nao-conferivel',
            'A ordem já foi conferida, não existe ou foi preparada por você: a conferência é de outra pessoa, uma vez.',
          );
        this.ordensGravadas[i] = {
          ...this.ordensGravadas[i]!,
          situacao: 'conferida',
          conferidoPor: x.usuario,
          conferidoEm: em,
        };
        return x.id;
      },
      registrarEventoOnco: async (x) => {
        const id = this.seq++;
        this.eventosOnco.unshift({
          id,
          estab: h,
          evento: x.evento,
          codigoProtocolo: x.codigoProtocolo,
          protocolo: x.protocolo,
          ciclo: x.ciclo,
          prescricao: x.prescricao,
          categoria: x.categoria,
          ciclosAfetados: x.ciclosAfetados,
          antes: x.antes,
          motivo: x.motivo,
          por: x.usuario,
          em,
        });
        return id;
      },
      revogarVersao: async (x) => {
        if (
          this.eventosOnco.some(
            (e) => e.estab === h && e.evento === 'versao-revogada' && e.protocolo === x.protocolo,
          )
        )
          throw recusa('versao-ja-revogada', 'A versão do protocolo já foi revogada.');
        const daVersao = this.ciclosGravados.filter((c0) => c0.estab === h && c0.protocolo === x.protocolo);
        const emAndamento = daVersao.filter((c0) => c0.andamento !== 'cancelado').length;
        if (emAndamento > x.emAndamentoCiente)
          throw recusa(
            'versao-com-ciclos',
            `${emAndamento} ciclo(s) em andamento usam a versão agora (eram ${x.emAndamentoCiente} na ciência): veja a lista de novo e confirme.`,
          );
        return g.registrarEventoOnco({
          codigoProtocolo: x.codigoProtocolo,
          protocolo: x.protocolo,
          motivo: x.motivo,
          vinculo: x.vinculo,
          usuario: x.usuario,
          evento: 'versao-revogada',
          ciclo: null,
          prescricao: null,
          categoria: null,
          ciclosAfetados: daVersao.length,
          antes: null,
        });
      },
      mudarAndamentoCiclo: async (x) => {
        const i = this.ciclosGravados.findIndex(
          (c0) => c0.estab === h && c0.id === x.id && x.de.includes(c0.andamento),
        );
        if (i < 0)
          throw recusa(
            'ciclo-desatualizado',
            'O andamento do ciclo mudou (outra pessoa agiu nele). Abra de novo.',
          );
        this.ciclosGravados[i] = { ...this.ciclosGravados[i]!, andamento: x.para };
        return x.id;
      },
      ajustarCiclo: async (x) => {
        const i = this.ciclosGravados.findIndex(
          (c0) => c0.estab === h && c0.id === x.id && c0.situacao === 'prescrito' && c0.andamento === 'ativo',
        );
        if (i < 0)
          throw recusa(
            'ciclo-validado',
            'O ciclo já foi validado pelo farmacêutico (ou não está ativo) e não se edita.',
          );
        const c0 = this.ciclosGravados[i]!;
        if (
          c0.prescricoes.length > 0 &&
          (c0.dataPrevista !== x.dataPrevista || c0.reducaoPct !== x.reducaoPct)
        )
          throw recusa(
            'ciclo-com-prescricao',
            'O ciclo tem prescrição ligada, emitida para a data e as doses atuais: desfaça a ligação antes de mudar a data ou a redução e ligue a prescrição nova depois.',
          );
        const antes = {
          dataPrevista: c0.dataPrevista,
          reducaoPct: c0.reducaoPct,
          motivoReducao: c0.motivoReducao,
          justificativaIntervalo: c0.justificativaIntervalo,
          doses: c0.doses.map((d) => ({ farmaco: d.farmaco, final: d.final })),
        };
        this.ciclosGravados[i] = {
          ...c0,
          dataPrevista: x.dataPrevista,
          reducaoPct: x.reducaoPct,
          motivoReducao: x.motivoReducao,
          justificativaIntervalo: x.justificativaIntervalo,
          doses: [...x.doses],
        };
        return antes;
      },
      desligarPrescricao: async (x) => {
        const i = this.ciclosGravados.findIndex(
          (c0) =>
            c0.estab === h &&
            c0.id === x.ciclo &&
            c0.situacao === 'prescrito' &&
            c0.prescricoes.includes(x.prescricao),
        );
        if (i < 0)
          throw recusa(
            'ligacao-nao-desfeita',
            'A prescrição não está ligada a este ciclo, ou o ciclo já foi validado.',
          );
        const c0 = this.ciclosGravados[i]!;
        this.ciclosGravados[i] = { ...c0, prescricoes: c0.prescricoes.filter((p) => p !== x.prescricao) };
        return x.ciclo;
      },
      alterarOrdem: async (x) => {
        const i = this.ordensGravadas.findIndex(
          (o) => o.estab === h && o.id === x.id && o.situacao === 'preparada' && o.canceladaEm === null,
        );
        if (i < 0)
          throw recusa(
            'ordem-conferida',
            'A ordem já foi conferida ou foi cancelada: não se altera; cancele com o motivo.',
          );
        const o0 = this.ordensGravadas[i]!;
        const antes = {
          formula: o0.formula,
          volumeMl: o0.volumeMl,
          horarios: [...o0.horarios],
          preparoEm: o0.preparoEm,
          validadeEm: o0.validadeEm,
          lote: o0.lote,
          observacao: o0.observacao,
        };
        this.ordensGravadas[i] = {
          ...o0,
          formula: x.formula,
          volumeMl: x.volumeMl,
          horarios: [...x.horarios],
          preparoEm: x.preparoEm,
          validadeEm: x.validadeEm,
          lote: x.lote,
          observacao: x.observacao,
        };
        return antes;
      },
      cancelarOrdem: async (x) => {
        const i = this.ordensGravadas.findIndex(
          (o) => o.estab === h && o.id === x.id && o.canceladaEm === null,
        );
        if (i < 0) throw recusa('ordem-cancelada', 'A ordem já foi cancelada (ou não existe).');
        this.ordensGravadas[i] = {
          ...this.ordensGravadas[i]!,
          canceladaPor: x.usuario,
          canceladaEm: em,
          motivoCancelamento: x.motivo,
        };
        return x.id;
      },
      marcarEtiqueta: async (x) => {
        const i = this.ordensGravadas.findIndex(
          (o) => o.estab === h && o.id === x.id && o.etiquetaEm === null,
        );
        if (i >= 0 && this.ordensGravadas[i]!.canceladaEm !== null)
          throw recusa(
            'ordem-cancelada',
            'A ordem foi cancelada: não se emite etiqueta de fórmula cancelada.',
          );
        if (i < 0) return 0;
        this.ordensGravadas[i] = { ...this.ordensGravadas[i]!, etiquetaEm: em };
        return 1;
      },
      registrarAlteracao: async (x) => {
        const id = this.seq++;
        this.alteracoesGravadas.unshift({
          id,
          estab: h,
          idRegistro: x.id,
          evento: x.evento,
          antes: x.antes,
          depois: x.depois,
          motivo: x.motivo,
          por: x.usuario,
          em,
        });
        return id;
      },
    };
    return fn(g);
  }

  // ── W0-05 ──

  async eventosProtocolos(c: ContextoEspecialidades) {
    return this.eventosOnco
      .filter((e) => e.estab === chaveDe(c) && e.ciclo === null && e.evento !== 'prescricao-desligada')
      .map((e) => omitir(e, 'estab'));
  }

  async eventosCiclos(c: ContextoEspecialidades, ciclos: readonly number[]) {
    return this.eventosOnco
      .filter((e) => e.estab === chaveDe(c) && e.ciclo !== null && ciclos.includes(e.ciclo))
      .map((e) => omitir(e, 'estab'));
  }

  async ciclosDaVersao(c: ContextoEspecialidades, protocolo: number) {
    const todos = this.ciclosGravados
      .filter((x) => x.estab === chaveDe(c) && x.protocolo === protocolo)
      .sort((a, b) => b.dataPrevista.localeCompare(a.dataPrevista) || b.id - a.id);
    const itens = todos.slice(0, this.tetoCiclosDaVersao).map((x) => ({
      id: x.id,
      paciente: x.paciente,
      internacao: x.internacao,
      numero: x.numero,
      curso: x.curso,
      dataPrevista: x.dataPrevista,
      situacao: x.situacao,
      andamento: x.andamento,
    }));
    return {
      total: todos.length,
      emAndamento: todos.filter((x) => x.andamento !== 'cancelado').length,
      cortada: todos.length > itens.length,
      itens,
    };
  }

  async alteracoesOrdens(c: ContextoEspecialidades, ids: readonly number[]) {
    return this.alteracoesGravadas
      .filter((x) => x.estab === chaveDe(c) && ids.includes(x.idRegistro))
      .map((x) => omitir(x, 'estab'));
  }

  async relogio() {
    const agora = this.agora();
    return { agora, hoje: agora.slice(0, 10) };
  }

  async vinculos(_c: ContextoEspecialidades, login: string) {
    return vinculosSinteticos(login);
  }

  async internacoes(_c: ContextoEspecialidades, termo: string) {
    const t = termo.trim().toUpperCase();
    const itens: InternacaoDaBusca[] = SINTETICOS.map((s) => this.internado(s))
      .filter((i) => !t || i.nome.includes(t) || String(i.internacao) === t || String(i.prontuario) === t)
      .map((i) => ({
        internacao: i.internacao,
        prontuario: i.prontuario,
        nome: i.nome,
        leito: { bloco: i.bloco, acomodacao: i.acomodacao, leito: i.leito },
        entrada: i.admissao,
      }));
    return { itens, cortada: false };
  }

  async internacao(_c: ContextoEspecialidades, internacao: number) {
    const s = SINTETICOS.find((x) => x.internacao === internacao);
    return s ? this.internado(s) : null;
  }

  async cadastrosOftalmologia() {
    return CADASTROS;
  }

  async tiposProtocolo() {
    return TIPOS_PROTOCOLO;
  }

  async tiposParto() {
    return TIPOS_PARTO;
  }

  async exames(c: ContextoEspecialidades, internacao: number) {
    return this.examesGravados
      .filter((x) => x.estab === chaveDe(c) && x.internacao === internacao)
      .sort((a, b) => b.id - a.id)
      .map((x) => omitir(x, 'estab'));
  }

  async protocolos(c: ContextoEspecialidades) {
    return this.protocolosGravados
      .filter((p) => p.estab === chaveDe(c))
      .sort((a, b) => a.codigo.localeCompare(b.codigo) || b.versao - a.versao)
      .map((p) => omitir(p, 'estab'));
  }

  async protocolo(c: ContextoEspecialidades, id: number) {
    const p = this.protocolosGravados.find((x) => x.estab === chaveDe(c) && x.id === id);
    if (!p) return null;
    const max = Math.max(
      ...this.protocolosGravados
        .filter((x) => x.estab === chaveDe(c) && x.codigo === p.codigo)
        .map((x) => x.versao),
    );
    const resto = omitir(p, 'estab');
    return { ...resto, vigente: p.versao === max };
  }

  async ciclosDoPaciente(c: ContextoEspecialidades, paciente: number) {
    return this.ciclosGravados
      .filter((x) => x.estab === chaveDe(c) && x.paciente === paciente)
      .sort((a, b) => b.dataPrevista.localeCompare(a.dataPrevista) || b.numero - a.numero)
      .map((x) => omitir(x, 'estab'));
  }

  async ciclo(c: ContextoEspecialidades, id: number) {
    const x = this.ciclosGravados.find((y) => y.estab === chaveDe(c) && y.id === id);
    if (!x) return null;
    const resto = omitir(x, 'estab');
    return resto;
  }

  async ciclosAValidar(c: ContextoEspecialidades) {
    return this.ciclosGravados
      .filter((x) => x.estab === chaveDe(c) && x.situacao === 'prescrito' && x.andamento === 'ativo')
      .map((x) => omitir(x, 'estab'));
  }

  /**
   * As prescrições sintéticas do paciente da oncologia: uma vigente desde a admissão (sem fim) e uma suspensa; a
   * vigência cobre o dia a partir da admissão.
   */
  async prescricoesDoDia(_c: ContextoEspecialidades, internacao: number, paciente: number, dia: string) {
    const s = SINTETICOS.find((x) => x.internacao === internacao && x.paciente === paciente);
    if (!s || internacao !== 950_102) return [];
    const inicio = this.internado(s).admissao;
    if (inicio.slice(0, 10) > dia) return [];
    return [
      { id: 990_202, inicio, fim: null, suspensa: true, itens: 1 },
      { id: 990_201, inicio, fim: null, suspensa: false, itens: 3 },
    ];
  }

  /** Os alertas são os gravados no momento do registro (o controller os calcula com o parâmetro da fase ativa). */
  async partograma(c: ContextoEspecialidades, internacao: number) {
    return this.pontosGravados
      .filter((x) => x.estab === chaveDe(c) && x.internacao === internacao)
      .sort((a, b) => a.em.localeCompare(b.em) || a.id - b.id)
      .map((x) => omitir(x, 'estab', 'internacao'));
  }

  async recemNascidos(c: ContextoEspecialidades, internacao: number) {
    return this.rnsGravados
      .filter((x) => x.estab === chaveDe(c) && x.internacao === internacao)
      .map((x) => omitir(x, 'estab', 'internacao'));
  }

  async ordensDoDia(c: ContextoEspecialidades, dia: string) {
    return this.ordensGravadas
      .filter((x) => x.estab === chaveDe(c) && x.preparoEm.startsWith(dia))
      .map((x) => omitir(x, 'estab'));
  }

  async ordem(c: ContextoEspecialidades, id: number) {
    const x = this.ordensGravadas.find((y) => y.estab === chaveDe(c) && y.id === id);
    if (!x) return null;
    const resto = omitir(x, 'estab');
    return resto;
  }
}
