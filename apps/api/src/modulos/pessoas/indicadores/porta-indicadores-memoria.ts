// Porta do painel de indicadores em memória (W0-06, parte 7): a sessão sintética de dev/ci. Guarda os FATOS datados
// de cada fonte (vínculo, dia de ponto apurado, competência da folha, turma realizada, acidente, censo diário,
// dimensionamento) por estabelecimento e monta a base do recorte como a porta do banco: período, setor e, no
// dimensionamento, o último registro do setor até o fim do período. Nada vai a banco.
import type { CategoriaScp, FonteIndicadorPessoas } from '@sgh/contratos';
import type { SetorIndicador } from '@sgh/dominio-pessoas';
import type {
  BaseLidaIndicadores,
  ContextoIndicadores,
  PortaIndicadoresPessoas,
  RecorteIndicadores,
} from './porta-indicadores.js';

type Setor = Omit<SetorIndicador, 'hospital'>;

/** Os fatos de um estabelecimento (o hospital vem da chave). */
export interface FatosIndicadoresPessoas {
  vinculos: (Setor & { admissao: string; desligamento: string | null })[];
  ponto: (Setor & {
    data: string;
    horasPrevistas: number;
    horasTrabalhadas: number;
    horasAusencia: number;
    horasExtras: number;
    horasEnfermagem: number;
  })[];
  /** Competência AAAA-MM: entra quando o mês está dentro do período. */
  folhaHorasExtras: (Setor & { competencia: string; valorCent: number })[];
  treinamento: (Setor & { data: string; horas: number })[];
  acidentes: (Setor & { data: string; comAfastamento: boolean })[];
  censo: (Setor & { data: string; pacientesDia: number })[];
  dimensionamento: (Setor & { data: string; pacientes: Record<CategoriaScp, number> })[];
}

const vazio = (): FatosIndicadoresPessoas => ({
  vinculos: [],
  ponto: [],
  folhaHorasExtras: [],
  treinamento: [],
  acidentes: [],
  censo: [],
  dimensionamento: [],
});

export class PortaIndicadoresPessoasMemoria implements PortaIndicadoresPessoas {
  readonly destino = 'memoria' as const;
  private readonly fatos = new Map<string, FatosIndicadoresPessoas>();
  /** Testes: fontes que respondem como indisponíveis (a base vem sem elas e com o aviso). */
  readonly indisponiveis = new Map<FonteIndicadorPessoas, string>();
  /** Testes: a data do relógio sintético (sem ela, a data de hoje). */
  hojeFixo: string | null = null;

  /**
   * `padrao` (W0-06, parte 7d): os fatos do estabelecimento que não recebeu nenhum (a sessão sintética de dev/ci usa a
   * base de teste conferida à mão, `SEMENTE_INDICADORES_PESSOAS`); sem ele, o estabelecimento sem fatos fica vazio.
   */
  constructor(private readonly padrao: FatosIndicadoresPessoas | null = null) {}

  private doHospital(hospital: string): FatosIndicadoresPessoas {
    return this.fatos.get(hospital) ?? (this.padrao ? structuredClone(this.padrao) : vazio());
  }

  /** Acrescenta fatos ao estabelecimento (testes e a semente sintética). */
  semear(hospital: string, f: Partial<FatosIndicadoresPessoas>): void {
    const atual = this.fatos.get(hospital) ?? vazio();
    for (const k of Object.keys(f) as (keyof FatosIndicadoresPessoas)[]) {
      (atual[k] as unknown[]).push(...structuredClone(f[k] ?? []));
    }
    this.fatos.set(hospital, atual);
  }

  async hoje(): Promise<string> {
    return this.hojeFixo ?? new Date().toISOString().slice(0, 10);
  }

  async setores(c: ContextoIndicadores): Promise<{ codigo: number; rotulo: string }[]> {
    const f = this.doHospital(c.hospital);
    const m = new Map<number, string>();
    for (const l of Object.values(f).flat() as Setor[]) if (l.setor !== null) m.set(l.setor, l.nomeSetor);
    return [...m]
      .map(([codigo, rotulo]) => ({ codigo, rotulo }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  }

  async base(c: ContextoIndicadores, r: RecorteIndicadores): Promise<BaseLidaIndicadores> {
    const f = this.doHospital(c.hospital);
    const h = { hospital: c.hospital };
    const doSetor = <T extends Setor>(l: readonly T[]) =>
      l.filter((x) => r.setor === null || x.setor === r.setor).map((x) => ({ ...h, ...x }));
    const noPeriodo = <T extends Setor & { data: string }>(l: readonly T[]) =>
      doSetor(l.filter((x) => x.data >= r.inicio && x.data <= r.fim));
    const fonte = <T>(nome: FonteIndicadorPessoas, l: T[]): T[] => (this.indisponiveis.has(nome) ? [] : l);
    const ultimo = new Map<string, FatosIndicadoresPessoas['dimensionamento'][number]>();
    for (const d of f.dimensionamento.filter((x) => x.data <= r.fim)) {
      const k = String(d.setor);
      const a = ultimo.get(k);
      if (!a || a.data <= d.data) ultimo.set(k, d);
    }
    const sem = <T extends { data: string }>(l: T[]): Omit<T, 'data'>[] =>
      l.map((x) => {
        const y: Partial<T> = { ...x };
        delete y.data;
        return y as Omit<T, 'data'>;
      });
    return {
      base: {
        inicio: r.inicio,
        fim: r.fim,
        vinculos: fonte('cadastro', doSetor(f.vinculos.filter((v) => v.admissao <= r.fim))),
        ponto: fonte('ponto', sem(noPeriodo(f.ponto))),
        folhaHorasExtras: fonte(
          'folha',
          doSetor(
            f.folhaHorasExtras.filter(
              (x) => x.competencia >= r.inicio.slice(0, 7) && x.competencia <= r.fim.slice(0, 7),
            ),
          ).map((x) => ({
            hospital: x.hospital,
            setor: x.setor,
            nomeSetor: x.nomeSetor,
            valorCent: x.valorCent,
          })),
        ),
        treinamento: fonte('treinamento', sem(noPeriodo(f.treinamento))),
        acidentes: fonte(
          'sesmt',
          // Somados por setor, como a porta do banco.
          [
            ...noPeriodo(f.acidentes)
              .reduce((m, x) => {
                const k = `${x.setor}|${x.nomeSetor}`;
                const t = m.get(k) ?? {
                  hospital: x.hospital,
                  setor: x.setor,
                  nomeSetor: x.nomeSetor,
                  quantidade: 0,
                  comAfastamento: 0,
                };
                t.quantidade += 1;
                t.comAfastamento += x.comAfastamento ? 1 : 0;
                return m.set(k, t);
              }, new Map<string, { hospital: string; setor: number | null; nomeSetor: string; quantidade: number; comAfastamento: number }>())
              .values(),
          ],
        ),
        censo: fonte('censo', sem(noPeriodo(f.censo))),
        dimensionamento: fonte('dimensionamento', sem(doSetor([...ultimo.values()]))),
      },
      indisponiveis: [...this.indisponiveis].map(([fonte, motivo]) => ({ fonte, motivo })),
    };
  }
}
