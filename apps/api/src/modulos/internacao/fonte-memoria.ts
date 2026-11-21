// Fonte SINTÉTICA do M16 (sessão sintética de dev/ci; E2E): um estabelecimento inventado com dois blocos, uma
// terapia intensiva e o movimento de internação gerado de forma determinística desde 2024 (nenhuma pessoa real:
// iniciais e números inventados). A "gravação por fora" do E2E (o outro sistema internando um paciente) chega por
// um arquivo JSON (LEITOS_SINTETICOS_POR_FORA, só dev/ci): a internação do arquivo ocupa o leito pedido e o canal
// `leitos` do vigia muda de selo quando o arquivo muda, como mudaria no banco.
import { createHash } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { readFileSync } from 'node:fs';
import type {
  CanalVigia,
  InternacaoMovimento,
  LeiturasPainel,
  MovimentoInternacao,
  TrechoMovimento,
  TransferenciaMovimento,
} from '@sgh/contratos';
import { relogioDeParede } from '@sgh/dominio-internacao';
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

const DIA = 86_400_000;

const BLOCOS = [
  { bloco: '1', nome: 'Bloco sintético A' },
  { bloco: '2', nome: 'Bloco sintético B' },
];
const ACOMODACOES = [
  { bloco: '1', acomodacao: 'ENF1', nome: 'Enfermaria sintética', tipo: 1, leitos: 6 },
  { bloco: '1', acomodacao: 'APT1', nome: 'Apartamentos sintéticos', tipo: 2, leitos: 4 },
  { bloco: '2', acomodacao: 'UTI1', nome: 'Terapia intensiva sintética', tipo: 3, leitos: 5 },
];
const TIPOS = new Map<number, string>([
  [0, 'Não informado'],
  [1, 'Enfermaria'],
  [2, 'Apartamento'],
  [3, 'U.T.I.'],
]);
/** Leito inativo do cadastro sintético (aparece como inativo no painel). */
const INATIVO = '1/APT1/04';
const INICIAIS = ['AS', 'MCB', 'JPO', 'LFR', 'RMN', 'TQS', 'BCA', 'EVL', 'GHP', 'KDO', 'NSR', 'PZA'];
const CONVENIOS = ['CONVÊNIO SINTÉTICO A', 'CONVÊNIO SINTÉTICO B', 'PARTICULAR SINTÉTICO'];

/** Gerador pseudoaleatório determinístico (mulberry32). */
function gerador(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const d0 = (t: number) => new Date(Math.floor(t / DIA) * DIA);
const horaDoDia = (t: number) => {
  const m = Math.floor((t % DIA) / 60_000);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

interface Estada {
  readonly reg: number;
  readonly paciente: number;
  readonly ini: number;
  readonly fim: number | null;
  readonly motivo: number;
  readonly carater: string;
  readonly clinica: string;
  readonly trechos: { ac: (typeof ACOMODACOES)[number]; leito: string; ini: number; fim: number | null }[];
  readonly iniciais: string;
  readonly sexo: string;
  readonly nascimento: Date;
  readonly convenio: string;
}

/** Uma internação gravada "por fora" (o arquivo do E2E). */
export interface InternacaoPorFora {
  readonly reg: number;
  readonly bloco: string;
  readonly acomodacao: string;
  readonly leito: string;
  readonly iniciais: string;
  readonly sexo: 'M' | 'F';
  readonly nascimento: string;
  readonly convenio: string;
}

/**
 * M57 (etapa 3): o movimento de OUTRO estabelecimento sintético da rede (o BI consolidado da Rede soma estabelecimentos
 * diferentes): outra semente do gerador e um fator nos painéis operacional e financeiro. Sem variante, o estabelecimento
 * é o sintético de sempre (semente 2016, fator 1).
 */
export interface VarianteSintetica {
  readonly semente: number;
  readonly fator: number;
}

const SEMENTE_PADRAO = 2016;

/**
 * A variante do estabelecimento sintético da rede de REDE_SINTETICA_SEGUNDO ("cod:Nome"; só dev/ci): outra semente e
 * 60% do movimento dos painéis da cópia diária. Sem a variável, nenhuma variante.
 */
export function variantesSinteticasRede(segundo: string | undefined): Record<string, VarianteSintetica> {
  const s = segundo?.trim();
  if (!s) return {};
  const codigo = (s.includes(':') ? s.slice(0, s.indexOf(':')) : s).trim();
  return /^[a-z][a-z0-9]{1,9}$/.test(codigo) ? { [codigo]: { semente: 2057, fator: 0.6 } } : {};
}

export class FonteInternacaoMemoria implements FonteInternacao {
  readonly destino = 'memoria' as const;
  private readonly geradas = new Map<number, { estadas: Estada[]; geradoEm: number }>();

  /**
   * `agora`: relógio de parede (ms); `arquivoPorFora`: o JSON do E2E (opcional); `variantes`: os outros
   * estabelecimentos sintéticos da rede (código → semente e fator).
   */
  constructor(
    private readonly opcoes: {
      readonly agora?: () => number;
      readonly arquivoPorFora?: string | null;
      readonly variantes?: Readonly<Record<string, VarianteSintetica>>;
    } = {},
  ) {}

  private variante(c?: Pick<CtxInternacao, 'hospital'>): VarianteSintetica {
    return (c && this.opcoes.variantes?.[c.hospital]) || { semente: SEMENTE_PADRAO, fator: 1 };
  }

  private agora(): number {
    return this.opcoes.agora?.() ?? relogioDeParede(Date.now());
  }

  /** O movimento sintético, gerado uma vez por dia (determinístico pela data e pela semente do estabelecimento). */
  private gerar(c?: Pick<CtxInternacao, 'hospital'>): Estada[] {
    const agora = this.agora();
    const semente = this.variante(c).semente;
    const ja = this.geradas.get(semente);
    if (ja && Math.floor(ja.geradoEm / DIA) === Math.floor(agora / DIA)) return ja.estadas;
    const r = gerador(semente);
    const inicio = Date.UTC(2024, 0, 1);
    const livresAte = new Map<string, number>();
    for (const a of ACOMODACOES)
      for (let k = 1; k <= a.leitos; k++)
        livresAte.set(`${a.bloco}/${a.acomodacao}/${String(k).padStart(2, '0')}`, 0);
    livresAte.delete(INATIVO);
    const estadas: Estada[] = [];
    let reg = 70_000;
    for (let dia = inicio; dia < agora; dia += DIA) {
      const n = r() < 0.5 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const ini = dia + Math.floor(r() * 20 + 2) * 3_600_000 + Math.floor(r() * 60) * 60_000;
        if (ini >= agora) continue;
        const uti = r() < 0.2;
        const ac = ACOMODACOES[uti ? 2 : r() < 0.6 ? 0 : 1]!;
        const livre = [...livresAte.entries()].find(
          ([chave, ate]) => chave.startsWith(`${ac.bloco}/${ac.acomodacao}/`) && ate <= ini,
        );
        if (!livre) continue;
        const dias = Math.floor(r() * 8) + 1;
        let fim: number | null = ini + dias * DIA + Math.floor(r() * 6) * 3_600_000;
        if (fim >= agora) fim = null;
        const trechos: Estada['trechos'] = [];
        // Parte das internações da UTI volta para a enfermaria (trajetória que passa pela UTI e volta).
        if (uti && dias > 3 && r() < 0.6) {
          const meio = ini + 2 * DIA;
          const destino = [...livresAte.entries()].find(([c, ate]) => c.startsWith('1/ENF1/') && ate <= meio);
          if (destino && (fim === null || meio < fim)) {
            trechos.push({ ac, leito: livre[0].split('/')[2]!, ini, fim: meio });
            trechos.push({ ac: ACOMODACOES[0]!, leito: destino[0].split('/')[2]!, ini: meio, fim });
            livresAte.set(livre[0], meio);
            livresAte.set(destino[0], fim ?? Number.POSITIVE_INFINITY);
          }
        }
        if (trechos.length === 0) {
          trechos.push({ ac, leito: livre[0].split('/')[2]!, ini, fim });
          livresAte.set(livre[0], fim ?? Number.POSITIVE_INFINITY);
        }
        const m = r();
        reg++;
        estadas.push({
          reg,
          paciente: 500_000 + Math.floor(r() * 900),
          ini,
          fim,
          motivo: m < 0.85 ? 12 : m < 0.9 ? 41 : m < 0.94 ? 16 : m < 0.97 ? 31 : 32,
          carater: r() < 0.55 ? '2' : '1',
          clinica: r() < 0.53 ? 'M' : 'C',
          trechos,
          iniciais: INICIAIS[reg % INICIAIS.length]!,
          sexo: reg % 2 ? 'F' : 'M',
          nascimento: new Date(Date.UTC(1935 + (reg % 60), reg % 12, 1 + (reg % 27))),
          convenio: CONVENIOS[reg % CONVENIOS.length]!,
        });
      }
    }
    this.geradas.set(semente, { estadas, geradoEm: agora });
    return estadas;
  }

  /** A internação gravada por fora (o arquivo do E2E), ou null. */
  private porFora(): InternacaoPorFora | null {
    const arq = this.opcoes.arquivoPorFora;
    if (!arq) return null;
    try {
      const x = JSON.parse(readFileSync(arq, 'utf8')) as Partial<InternacaoPorFora>;
      if (typeof x.reg !== 'number' || !x.bloco || !x.acomodacao || !x.leito) return null;
      return x as InternacaoPorFora;
    } catch {
      return null;
    }
  }

  async leiturasPainel(): Promise<LeiturasPainel> {
    const agora = this.agora();
    const abertas = this.gerar().filter((e) => e.fim === null);
    const ocupacao = new Map<string, number>();
    for (const e of abertas) {
      const t = e.trechos[e.trechos.length - 1]!;
      ocupacao.set(`${t.ac.bloco}/${t.ac.acomodacao}/${t.leito}`, e.reg);
    }
    const fora = this.porFora();
    if (fora) ocupacao.set(`${fora.bloco}/${fora.acomodacao}/${fora.leito}`, fora.reg);
    let id = 0;
    return {
      blocos: BLOCOS,
      acomodacoes: ACOMODACOES.map((a) => ({
        bloco: a.bloco,
        acomodacao: a.acomodacao,
        nome: a.nome,
        tipo: a.tipo,
      })),
      leitos: ACOMODACOES.flatMap((a) =>
        Array.from({ length: a.leitos }, (_, k) => {
          const leito = String(k + 1).padStart(2, '0');
          const chave = `${a.bloco}/${a.acomodacao}/${leito}`;
          return {
            id: ++id,
            bloco: a.bloco,
            acomodacao: a.acomodacao,
            leito,
            status: chave === INATIVO ? 'I' : 'A',
            reg: ocupacao.get(chave) ?? 0,
            ramal: 2000 + id,
          };
        }),
      ),
      abertas: [
        ...abertas.map((e) => {
          const t = e.trechos[e.trechos.length - 1]!;
          return {
            reg: e.reg,
            bloco: t.ac.bloco,
            acomodacao: t.ac.acomodacao,
            leito: t.leito,
            entrada: d0(e.ini),
            iniciais: e.iniciais,
            nascimento: e.nascimento,
            sexo: e.sexo,
            convenio: e.convenio,
            tipoTrecho: t.ac.tipo,
          };
        }),
        ...(fora
          ? [
              {
                reg: fora.reg,
                bloco: fora.bloco,
                acomodacao: fora.acomodacao,
                leito: fora.leito,
                entrada: d0(agora),
                iniciais: fora.iniciais,
                nascimento: new Date(`${fora.nascimento}T00:00:00.000Z`),
                sexo: fora.sexo,
                convenio: fora.convenio,
                tipoTrecho: ACOMODACOES.find((a) => a.acomodacao === fora.acomodacao)?.tipo ?? null,
              },
            ]
          : []),
      ],
      tipos: TIPOS,
    };
  }

  async pacienteDaInternacao(_c: CtxInternacao, reg: number): Promise<PacienteDaInternacao | null> {
    const fora = this.porFora();
    if (fora?.reg === reg)
      return {
        internacao: reg,
        nome: 'PACIENTE SINTÉTICO DO TESTE',
        entrada: d0(this.agora()).toISOString().slice(0, 10),
        convenio: fora.convenio,
        clinica: 'M',
      };
    const e = this.gerar().find((x) => x.reg === reg && x.fim === null);
    if (!e) return null;
    return {
      internacao: reg,
      nome: `PACIENTE SINTÉTICO ${e.iniciais}`,
      entrada: d0(e.ini).toISOString().slice(0, 10),
      convenio: e.convenio,
      clinica: e.clinica,
    };
  }

  async movimento(c?: CtxInternacao): Promise<MovimentoInternacao> {
    const estadas = this.gerar(c);
    const internacoes: InternacaoMovimento[] = [];
    const trechos: TrechoMovimento[] = [];
    const transferencias: TransferenciaMovimento[] = [];
    let cod = 0;
    for (const e of estadas) {
      const ult = e.trechos[e.trechos.length - 1]!;
      internacoes.push({
        reg: e.reg,
        paciente: e.paciente,
        bloco: ult.ac.bloco,
        acomodacao: ult.ac.acomodacao,
        leito: ult.leito,
        entrada: d0(e.ini),
        horaEntrada: horaDoDia(e.ini),
        alta: e.fim === null ? null : d0(e.fim),
        horaAlta: e.fim === null ? null : horaDoDia(e.fim),
        motivo: e.fim === null ? null : e.motivo,
        carater: e.carater,
        clinica: e.clinica,
        permanencia: e.fim === null ? null : Math.floor(e.fim / DIA) - Math.floor(e.ini / DIA) + 1,
      });
      e.trechos.forEach((t, k) => {
        trechos.push({
          reg: e.reg,
          cod: ++cod,
          bloco: t.ac.bloco,
          acomodacao: t.ac.acomodacao,
          leito: t.leito,
          entrada: d0(t.ini),
          horaEntrada: horaDoDia(t.ini),
          saida: t.fim === null ? null : d0(t.fim),
          horaSaida: t.fim === null ? null : horaDoDia(t.fim),
          tipo: t.ac.tipo,
        });
        const prox = e.trechos[k + 1];
        if (prox)
          transferencias.push({
            reg: e.reg,
            data: d0(prox.ini),
            hora: horaDoDia(prox.ini),
            origem: { bloco: t.ac.bloco, acomodacao: t.ac.acomodacao, leito: t.leito },
            destino: { bloco: prox.ac.bloco, acomodacao: prox.ac.acomodacao, leito: prox.leito },
          });
      });
    }
    return {
      internacoes,
      trechos,
      transferencias,
      unidades: ACOMODACOES.map((a) => ({
        bloco: a.bloco,
        acomodacao: a.acomodacao,
        nome: a.nome,
        tipo: a.tipo,
        leitos: a.leitos,
        leitosAtivos: a.leitos - (INATIVO.startsWith(`${a.bloco}/${a.acomodacao}/`) ? 1 : 0),
      })),
      tipos: TIPOS,
      dadosAte: d0(this.agora()),
    };
  }

  async conferencia(): Promise<{ cadastro: CadastroLeitos; espelho: RetratoLeitos }> {
    const p = await this.leiturasPainel();
    const cadastro: CadastroLeitos = {
      blocos: BLOCOS.map((b) => ({ ...b, andares: 1 })),
      acomodacoes: ACOMODACOES.map((a) => ({ bloco: a.bloco, acomodacao: a.acomodacao, nome: a.nome })),
      leitos: p.leitos.map((l) => ({
        id: l.id,
        bloco: l.bloco,
        acomodacao: l.acomodacao,
        leito: l.leito,
        ativo: l.status !== 'I',
        ocupado: l.reg > 0,
        ramal: l.ramal,
        andar: 1,
        reg: l.reg,
      })),
    };
    // O registro de conferência sintético: um leito sem par e um ramal diferente (divergências de exemplo).
    const espelho: RetratoLeitos = {
      acomodacoes: ACOMODACOES.map((a) => ({
        bloco: a.bloco,
        acomodacao: a.acomodacao,
        tipoAtendimento: 'I' as const,
        nome: a.nome,
      })),
      leitos: [
        ...p.leitos
          .filter((l) => !(l.acomodacao === 'UTI1' && l.leito === '05'))
          .map((l) => ({
            bloco: l.bloco,
            acomodacao: l.acomodacao,
            leito: l.leito,
            tipoAtendimento: 'I' as const,
            ativo: l.status !== 'I',
            ramal: l.acomodacao === 'ENF1' && l.leito === '01' ? 9999 : l.ramal,
          })),
        {
          bloco: null,
          acomodacao: 'PA',
          leito: 'OBS1',
          tipoAtendimento: 'E' as const,
          ativo: true,
          ramal: null,
        },
      ],
      retratos: 12,
    };
    return { cadastro, espelho };
  }

  async censoFechado(): Promise<CensoFechadoLido | null> {
    return null;
  }

  async diasFechados(): Promise<string[]> {
    return [];
  }

  async operacional(c: CtxInternacao, de: string, ate: string): Promise<OperacionalDoMes[]> {
    const f = this.variante(c).fator;
    const q = (v: number) => Math.round(v * f);
    return this.meses(de, ate).map((m, i) => ({
      periodo: m,
      atendimentosExternos: q(3000 + ((i * 137) % 400)),
      internacoes: q(140 + ((i * 7) % 30)),
      consultas: q(2100 + ((i * 53) % 300)),
      cirurgias: q(60 + ((i * 11) % 20)),
      exames: q(28_000 + ((i * 997) % 3000)),
    }));
  }

  async financeiro(c: CtxInternacao, de: string, ate: string): Promise<FinanceiroDoMes[]> {
    const f = this.variante(c).fator;
    return this.meses(de, ate).flatMap((m, i) => {
      const cobrado = (6_500_000 + ((i * 173_000) % 900_000)) * f;
      const bx = i < 3 ? 0 : cobrado * 0.9;
      return (['data-do-item', 'competencia'] as const).map((regua) => ({
        periodo: m,
        regua,
        cobrado: regua === 'competencia' ? cobrado * 1.02 : cobrado,
        pago: bx * 0.85,
        cobradoBaixado: bx,
        pagoBaixado: bx * 0.85,
      }));
    });
  }

  private meses(de: string, ate: string): string[] {
    const r: string[] = [];
    let [a, m] = de.split('-').map(Number) as [number, number];
    const [aa, mm] = ate.split('-').map(Number) as [number, number];
    while (a < aa || (a === aa && m <= mm)) {
      r.push(`${a}-${String(m).padStart(2, '0')}`);
      if (++m > 12) {
        m = 1;
        a++;
      }
    }
    return r;
  }

  async dataDaCopia(): Promise<Date | null> {
    return new Date(this.agora());
  }

  async canal(_alvo: ContextoNucleo, canal: CanalVigia, marca: MarcaVigia): Promise<LeituraCanal> {
    if (canal !== 'leitos') return { selo: 'sintetico', marca, consultas: 1 };
    const fora = this.opcoes.arquivoPorFora ? JSON.stringify(this.porFora()) : '';
    const selo = createHash('sha256').update(`${this.gerar().length}:${fora}`).digest('hex').slice(0, 16);
    return { selo, marca: { maiorId: 1, maiorId2: 1, janela: 1 }, consultas: 1 };
  }
}
