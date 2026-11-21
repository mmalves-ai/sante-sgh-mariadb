// A porta da notificação compulsória em memória (M48, etapa 4): dev/ci e os testes, com dados SINTÉTICOS (nenhum
// paciente real): quatro atendimentos (dengue, raiva, pneumonia e um óbito com dengue), dois resultados (VDRL reagente e
// IgG da dengue, que não é gatilho), o cadastro de CID notificável reduzido e três modelos de ficha com perguntas.
import type { AtendimentoParaAgravo, CasoAgravoRegistrado, CidNotificavelCadastro, ExameParaAgravo, FiltroCasosAgravo, GatilhoExameRegistrado, PacienteDoAgravo, UnidadeDoAgravo } from './tipos.js';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import { recusaVersaoAgravo } from './tipos.js';
import { recusa } from '@sgh/nucleo';
import { relogioDoEstabelecimento } from '../recepcao/porta-memoria.js';
import type { ContextoAgravo, GravadorAgravo, PortaAgravo } from './porta-agravo.js';

const HORA = 3_600_000;
const local = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const msDe = (t: string) =>
  Date.parse(`${(t.length === 10 ? `${t}T00:00:00` : t.length === 16 ? `${t}:00` : t).slice(0, 19)}Z`);

/** IDs sintéticos (fora de qualquer faixa real do banco). */
export const AGRAVO_SINTETICO = {
  pacienteDengue: 9_048_001,
  pacienteRaiva: 9_048_002,
  pacienteVdrl: 9_048_003,
  pacienteObito: 9_048_004,
  atendimentoDengue: 948_001,
  atendimentoRaiva: 948_002,
  atendimentoPneumonia: 948_003,
  atendimentoObito: 948_004,
  exameVdrl: 9_480_001,
  exameDengueIgg: 9_480_002,
} as const;
const S = AGRAVO_SINTETICO;

const CADASTRO: readonly CidNotificavelCadastro[] = [
  { cid: 'A90', nome: 'DENGUE [DENGUE CLASSICO]', codigoCadastro: 1 },
  { cid: 'A150', nome: 'TUBERCULOSE PULMONAR (SINTETICO)', codigoCadastro: 1 },
  { cid: 'A820', nome: 'RAIVA SILVESTRE', codigoCadastro: 2 },
  { cid: 'B24', nome: 'DOENCA PELO VIRUS DA IMUNODEFICIENCIA HUMANA NAO ESPECIFICADA', codigoCadastro: 1 },
];
const OUTROS_CIDS = [
  { cid: 'J18', nome: 'PNEUMONIA POR MICROORGANISMO NAO ESPECIFICADA', codigoCadastro: 0 },
  { cid: 'A539', nome: 'SIFILIS NAO ESPECIFICADA', codigoCadastro: 0 },
];
const MODELOS = [
  { id: 18, nome: 'A90/A92' },
  { id: 24, nome: 'B24' },
  { id: 48, nome: 'Padrão/Individual' },
];
const PERGUNTAS_BASE = [
  [1, 1, 'Número'],
  [2, 1, 'Agravo/doença'],
  [2, 2, 'Código (CID10)'],
  [3, 0, 'Data da notificação'],
  [4, 0, 'U.F.'],
  [5, 1, 'Município de notificação'],
  [6, 1, 'Unidade de saúde(ou outra fonte notificadora)'],
  [7, 0, 'Data dos primeiros sintomas'],
  [8, 0, 'Nome do paciente'],
  [9, 0, 'Data de nascimento'],
  [10, 1, 'Idade'],
  [10, 2, 'Idade unidade'],
  [11, 0, 'Sexo'],
] as const;
const UNIDADE: UnidadeDoAgravo = {
  codigo: 1,
  nome: 'UNIDADE SINTETICA',
  cnes: '0000000',
  cidade: 'CAMPOS DOS GOYTACAZES',
  uf: 'RJ',
};

interface Estado {
  casos: CasoAgravoRegistrado[];
  gatilhos: GatilhoExameRegistrado[];
  seq: number;
}

export class PortaAgravoMemoria implements PortaAgravo {
  readonly destino = 'memoria' as const;
  private estado: Estado = { casos: [], gatilhos: [], seq: 0 };
  private readonly t0: number;
  private readonly pacientesSint: Map<number, PacienteDoAgravo>;
  private readonly atendimentosSint: AtendimentoParaAgravo[];
  private readonly examesSint: (ExameParaAgravo & { liberadoEm: string })[];

  constructor(
    private readonly opcoes: {
      agora?: () => Date;
      /**
       * Na sessão sintética, os pacientes do cadastro em memória (o caso aberto sem sugestão escolhe o paciente pela
       * busca do cadastro; D-BUSCA-48.4). Sem ela, só os quatro pacientes sintéticos dos gatilhos.
       */
      cadastro?: (c: ContextoAgravo, ids: readonly number[]) => Promise<readonly PacienteDoAgravo[]>;
    } = {},
  ) {
    this.t0 = msDe(this.agoraLocal());
    const pac = (id: number, nome: string, nascimento: string, sexo: 'M' | 'F'): PacienteDoAgravo => ({
      id,
      nome,
      prontuario: id - 9_000_000,
      nascimento,
      sexo,
      mae: null,
      cns: null,
    });
    this.pacientesSint = new Map(
      [
        pac(S.pacienteDengue, 'PACIENTE SINTETICO DENGUE', '1990-05-01', 'F'),
        pac(S.pacienteRaiva, 'PACIENTE SINTETICO RAIVA', '1980-01-15', 'M'),
        pac(S.pacienteVdrl, 'PACIENTE SINTETICO SIFILIS', '2000-07-20', 'F'),
        pac(S.pacienteObito, 'PACIENTE SINTETICO OBITO', '1950-03-03', 'M'),
      ].map((p) => [p.id, p]),
    );
    const atd = (
      atendimento: number,
      paciente: number,
      horasAtras: number,
      cids: string[],
      obitoHorasAtras: number | null = null,
    ): AtendimentoParaAgravo => ({
      atendimento,
      paciente,
      unidade: 1,
      entrada: local(this.t0 - horasAtras * HORA),
      cids,
      obitoEm: obitoHorasAtras === null ? null : local(this.t0 - obitoHorasAtras * HORA),
    });
    this.atendimentosSint = [
      atd(S.atendimentoDengue, S.pacienteDengue, 26, ['A90']),
      atd(S.atendimentoRaiva, S.pacienteRaiva, 3, ['A820']),
      atd(S.atendimentoPneumonia, S.pacienteVdrl, 30, ['J18']),
      atd(S.atendimentoObito, S.pacienteObito, 72, ['A90'], 2),
    ];
    this.examesSint = [
      {
        exame: S.exameVdrl,
        atendimento: S.atendimentoPneumonia,
        paciente: S.pacienteVdrl,
        nomeExame: 'VDRL',
        liberado: true,
        resultados: ['REAGENTE (1:16)'],
        liberadoEm: local(this.t0 - 20 * HORA),
      },
      {
        exame: S.exameDengueIgg,
        atendimento: S.atendimentoDengue,
        paciente: S.pacienteDengue,
        nomeExame: 'DENGUE IGG',
        liberado: true,
        resultados: ['REAGENTE'],
        liberadoEm: local(this.t0 - 10 * HORA),
      },
    ];
  }

  private agoraLocal(): string {
    return relogioDoEstabelecimento(this.opcoes.agora?.() ?? new Date()).agora.slice(0, 19);
  }

  podeGravar(): Promise<LiberacaoGravacao> {
    return Promise.resolve({ pode: true, codigo: null, motivo: null });
  }
  executar(_c: ContextoAgravo, op: string): Promise<never> {
    return Promise.reject(new Error(`Operação ${op} sem receita do executor: só SGH_.`));
  }
  relogio(): Promise<string> {
    return Promise.resolve(this.agoraLocal());
  }
  cidsNotificaveis(): Promise<CidNotificavelCadastro[]> {
    return Promise.resolve([...CADASTRO]);
  }
  cidDoCadastro(_c: ContextoAgravo, cid: string) {
    return Promise.resolve([...CADASTRO, ...OUTROS_CIDS].find((x) => x.cid === cid) ?? null);
  }
  atendimentosComCid(_c: ContextoAgravo, desde: string) {
    const notificaveis = new Set(CADASTRO.map((x) => x.cid));
    const itens = this.atendimentosSint
      .filter((a) => a.entrada !== null && msDe(a.entrada) >= msDe(desde))
      .flatMap((a) =>
        a.cids
          .filter((c) => notificaveis.has(c))
          .map((cid) => ({
            atendimento: a.atendimento,
            paciente: a.paciente,
            unidade: a.unidade,
            cid,
            registradoEm: a.entrada as string,
          })),
      );
    return Promise.resolve({ itens, cortado: false });
  }
  obitos(_c: ContextoAgravo, desde: string) {
    return Promise.resolve(
      this.atendimentosSint
        .filter((a) => a.obitoEm !== null && msDe(a.obitoEm) >= msDe(desde))
        .map((a) => ({
          atendimento: a.atendimento,
          paciente: a.paciente,
          unidade: a.unidade,
          cids: a.cids,
          obitoEm: a.obitoEm as string,
        })),
    );
  }
  resultados(_c: ContextoAgravo, desde: string, padroes: readonly string[]) {
    const itens = this.examesSint
      .filter((x) => msDe(x.liberadoEm) >= msDe(desde))
      .filter((x) => padroes.some((p) => x.nomeExame.toUpperCase().includes(p.toUpperCase())))
      .flatMap((x) =>
        x.resultados.map((resultado) => ({
          exame: x.exame,
          atendimento: x.atendimento ?? 0,
          paciente: x.paciente ?? 0,
          unidade: 1,
          nomeExame: x.nomeExame,
          resultado,
          liberadoEm: x.liberadoEm,
        })),
      );
    return Promise.resolve({ itens, cortado: false });
  }
  atendimento(_c: ContextoAgravo, id: number) {
    return Promise.resolve(this.atendimentosSint.find((a) => a.atendimento === id) ?? null);
  }
  declaracaoObito(): Promise<string | null> {
    return Promise.resolve(null);
  }
  exame(_c: ContextoAgravo, id: number) {
    const x = this.examesSint.find((e) => e.exame === id);
    if (!x) return Promise.resolve(null);
    return Promise.resolve({
      exame: x.exame,
      atendimento: x.atendimento,
      paciente: x.paciente,
      nomeExame: x.nomeExame,
      liberado: x.liberado,
      resultados: x.resultados,
    });
  }
  async pacientes(c: ContextoAgravo, ids: readonly number[]) {
    const r = new Map<number, PacienteDoAgravo>();
    for (const i of ids) {
      const p = this.pacientesSint.get(i);
      if (p) r.set(i, p);
    }
    const faltam = ids.filter((i) => !r.has(i));
    if (faltam.length && this.opcoes.cadastro)
      for (const p of await this.opcoes.cadastro(c, faltam)) r.set(p.id, p);
    return r;
  }
  unidades() {
    return Promise.resolve(new Map([[1, UNIDADE]]));
  }
  modelosFicha() {
    return Promise.resolve([...MODELOS]);
  }
  perguntasFicha(_c: ContextoAgravo, modelo: number) {
    if (!MODELOS.some((m) => m.id === modelo)) return Promise.resolve([]);
    return Promise.resolve(
      PERGUNTAS_BASE.map(([codigo, subcodigo, texto]) => ({ codigo, subcodigo, texto })),
    );
  }
  caso(_c: ContextoAgravo, id: number) {
    return Promise.resolve(this.estado.casos.find((x) => x.id === id) ?? null);
  }
  casos(_c: ContextoAgravo, f: FiltroCasosAgravo) {
    const xs = this.estado.casos
      .filter((x) => !f.situacao || x.situacao === f.situacao)
      .filter((x) => !f.periodicidade || x.periodicidade === f.periodicidade)
      .filter((x) => !f.desde || msDe(x.gatilhoEm) >= msDe(f.desde))
      .filter((x) => !f.ate || msDe(x.gatilhoEm) < msDe(f.ate))
      .sort(
        (a, b) =>
          Number(a.situacao !== 'aberto') - Number(b.situacao !== 'aberto') ||
          (a.situacao === 'aberto'
            ? msDe(a.prazoEm) - msDe(b.prazoEm)
            : msDe(b.gatilhoEm) - msDe(a.gatilhoEm)) ||
          b.id - a.id,
      );
    return Promise.resolve({
      itens: xs.slice((f.pagina - 1) * f.porPagina, f.pagina * f.porPagina),
      total: xs.length,
    });
  }
  casosDesde(_c: ContextoAgravo, desde: string) {
    return Promise.resolve(
      this.estado.casos
        .filter((x) => msDe(x.gatilhoEm) >= msDe(desde))
        .map((x) => ({
          origem: x.origem,
          atendimento: x.atendimento,
          exame: x.exame,
          paciente: x.paciente,
          cid: x.cid,
          situacao: x.situacao,
          gatilhoEm: x.gatilhoEm,
        })),
    );
  }
  contagem(_c: ContextoAgravo, agora: string, inicioDoMes: string) {
    const xs = this.estado.casos;
    const abertos = xs.filter((x) => x.situacao === 'aberto');
    return Promise.resolve({
      abertos: abertos.length,
      imediatosAbertos: abertos.filter((x) => x.periodicidade === 'imediata').length,
      vencidos: abertos.filter((x) => msDe(x.prazoEm) < msDe(agora)).length,
      notificadosNoMes: xs.filter(
        (x) =>
          x.situacao === 'notificado' && x.notificadoEm !== null && msDe(x.notificadoEm) >= msDe(inicioDoMes),
      ).length,
    });
  }
  gatilhosExame() {
    return Promise.resolve(this.estado.gatilhos.map((g) => ({ ...g })));
  }

  async gravarSgh<T>(
    _c: ContextoAgravo,
    _trilha: unknown,
    fn: (g: GravadorAgravo) => Promise<T>,
  ): Promise<T> {
    const antes = structuredClone(this.estado);
    const s = this.estado;
    const aberto = (id: number, versao: number) => {
      const x = s.casos.find((c) => c.id === id);
      if (!x || x.versao !== versao || x.situacao !== 'aberto') throw recusaVersaoAgravo();
      return x;
    };
    const trocar = (x: CasoAgravoRegistrado, novo: CasoAgravoRegistrado) => {
      s.casos = s.casos.map((c) => (c.id === x.id ? novo : c));
    };
    const g: GravadorAgravo = {
      abrirCaso: (c) => {
        if (c.chaveGatilho && s.casos.some((x) => x.chaveGatilho === c.chaveGatilho))
          return Promise.reject(
            recusa(
              'caso-ja-aberto',
              'Este gatilho já virou caso (outra pessoa da vigilância abriu): recarregue a fila.',
            ),
          );
        const id = ++s.seq;
        s.casos.push({
          id,
          origem: c.origem,
          chaveGatilho: c.chaveGatilho,
          atendimento: c.atendimento,
          exame: c.exame,
          paciente: c.paciente,
          cid: c.cid,
          periodicidade: c.periodicidade,
          gatilhoEm: c.gatilhoEm.length === 16 ? `${c.gatilhoEm}:00` : c.gatilhoEm,
          prazoEm: c.prazoEm,
          fichaModelo: c.fichaModelo,
          situacao: 'aberto',
          observacao: c.observacao,
          autoridade: null,
          canal: null,
          numero: null,
          notificadoEm: null,
          recebidoPor: null,
          observacaoNotificacao: null,
          motivoDescarte: null,
          justificativa: null,
          abertoPor: c.usuario,
          abertoEm: c.agora.length === 16 ? `${c.agora}:00` : c.agora,
          encerradoPor: null,
          encerradoEm: null,
          versao: 1,
        });
        return Promise.resolve({ id });
      },
      registrarNotificacao: (r) => {
        const x = aberto(r.id, r.versao);
        trocar(x, {
          ...x,
          situacao: 'notificado',
          autoridade: r.autoridade,
          canal: r.canal,
          numero: r.numero,
          notificadoEm: r.notificadoEm.length === 16 ? `${r.notificadoEm}:00` : r.notificadoEm,
          recebidoPor: r.recebidoPor,
          observacaoNotificacao: r.observacao,
          encerradoPor: r.usuario,
          encerradoEm: r.agora,
          versao: x.versao + 1,
        });
        return Promise.resolve({ versao: x.versao + 1 });
      },
      descartarCaso: (r) => {
        const x = aberto(r.id, r.versao);
        trocar(x, {
          ...x,
          situacao: 'descartado',
          motivoDescarte: r.motivo,
          justificativa: r.justificativa,
          encerradoPor: r.usuario,
          encerradoEm: r.agora,
          versao: x.versao + 1,
        });
        return Promise.resolve({ versao: x.versao + 1 });
      },
      configurarGatilhoExame: (x) => {
        const dup = s.gatilhos.find((y) => y.padrao === x.padrao && y.cid === x.cid && y.id !== x.id);
        if (dup)
          return Promise.reject(
            recusa('gatilho-duplicado', 'Já existe gatilho com este padrão de exame para o mesmo CID.'),
          );
        if (x.id === null) {
          const id = ++s.seq;
          s.gatilhos.push({ id, padrao: x.padrao, exceto: x.exceto, cid: x.cid, ativo: x.ativo, versao: 1 });
          return Promise.resolve({ id, versao: 1, criado: true });
        }
        const atual = s.gatilhos.find((y) => y.id === x.id);
        if (!atual || atual.versao !== x.versao)
          return Promise.reject(
            recusa(
              'versao-desatualizada',
              'O gatilho mudou desde que você abriu a tela (outra pessoa da vigilância alterou): recarregue e confira.',
            ),
          );
        const novo = {
          ...atual,
          padrao: x.padrao,
          exceto: x.exceto,
          cid: x.cid,
          ativo: x.ativo,
          versao: atual.versao + 1,
        };
        s.gatilhos = s.gatilhos.map((y) => (y.id === atual.id ? novo : y));
        return Promise.resolve({ id: atual.id, versao: novo.versao, criado: false });
      },
    };
    try {
      return await fn(g);
    } catch (e) {
      this.estado = antes;
      throw e;
    }
  }
}
