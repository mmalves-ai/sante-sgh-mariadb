// Curvas de crescimento e gráficos clínicos de referência (03-PEP L141), no banco próprio do cliente. As curvas vêm do
// carregador versionado (catalogos/carregadores/curvas.py: OMS 2006 e 2007 em LMS, INTERGROWTH-21st do prematuro em
// linhas de escore Z) em curva_referencia e curva_referencia_ponto; as medidas do paciente vêm das aferições (peso,
// altura e perímetro cefálico em afericao_valor, a retificada pela retificação) e do registro do nascimento (peso,
// comprimento, perímetro cefálico e idade gestacional). O escore Z, o percentil, a classificação e a escolha da curva
// pela idade (corrigida no prematuro) são do domínio (@sgh/dominio-pep, curvas-crescimento.ts). A medida de crescimento
// registrada aqui é uma aferição como as outras (dentro do atendimento ou fora dele, como na puericultura), gravada
// pelo executor com a trilha na mesma transação, com o nível de alerta do valor pela curva; nada é apagado.
import {
  avaliarMedida,
  type CurvaCalculo,
  imcDe,
  type IndicadorCrescimento,
  INDICADORES_CRESCIMENTO,
  linhasDoGrafico,
  PARAMETRO_DO_INDICADOR,
  referenciaDaMedida,
  type ReferenciaMedida,
  validarMedidaCrescimento,
  type AvaliacaoMedida,
} from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dataDe = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const iso = (v: unknown): string | null => dataDe(v)?.toISOString() ?? null;
const id = z.number().int().positive();
const medida = z.number().positive().max(10_000).nullable().optional();

export const esquemaMedidaCrescimento = z
  .object({
    paciente: id,
    atendimento: id.nullable().optional(),
    medidoEm: z.string().datetime({ offset: true }),
    pesoKg: medida,
    estaturaCm: medida,
    perimetroCefalicoCm: medida,
    observacao: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type EntradaMedidaCrescimento = z.infer<typeof esquemaMedidaCrescimento>;

export interface NucleoCurvas {
  lerSomente<T>(
    contexto: {
      readonly cliente: string;
      readonly correlacao: string;
      readonly estabelecimento?: number | null;
    },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}
export interface ContextoCurvas {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoCurvas = ContextoCurvas & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

type Publicacao = ReferenciaMedida['publicacao'];
const PREFIXO: Readonly<Record<Publicacao, string>> = {
  oms2006: 'oms2006\\_',
  oms2007: 'oms2007\\_',
  intergrowth: 'intergrowth\\_',
};
const PARAMETROS = ['peso', 'altura', 'perimetro_cefalico'] as const;

export interface MedidaLida {
  readonly afericao: number | null;
  readonly origem: 'afericao' | 'nascimento';
  readonly medidoEm: string;
  readonly pesoKg: number | null;
  readonly estaturaCm: number | null;
  readonly perimetroCefalicoCm: number | null;
  readonly imc: number | null;
  readonly referencia: ReferenciaMedida | null;
  readonly avaliacoes: Partial<Record<IndicadorCrescimento, AvaliacaoMedida>>;
}
export interface GraficoCrescimento {
  readonly indicador: IndicadorCrescimento;
  readonly publicacao: Publicacao;
  readonly codigo: string;
  readonly descricao: string;
  readonly eixo: string;
  readonly unidade: string;
  readonly versaoFonte: string;
  readonly linhas: { x: number; valores: number[] }[];
  readonly pontos: { x: number; y: number; z: number; percentil: number; nivel: string; medidoEm: string }[];
}
export interface CrescimentoDoPaciente {
  readonly paciente: {
    readonly nascimento: string | null;
    readonly sexo: 'masculino' | 'feminino' | null;
    readonly igSemanas: number | null;
    readonly igDias: number | null;
  };
  readonly referenciaAtual: ReferenciaMedida | null;
  readonly medidas: readonly MedidaLida[];
  readonly graficos: readonly GraficoCrescimento[];
  /** Sem curva carregada para o sexo e a idade (o carregador das curvas não rodou no cliente). */
  readonly semCurvas: boolean;
}

interface CurvaLida {
  codigo: string;
  descricao: string;
  eixo: string;
  unidade: string;
  versaoFonte: string;
  calculo: CurvaCalculo;
}

const NIVEL_DO_VALOR = { adequado: 'normal', atencao: 'atencao', alerta: 'critico' } as const;

export class CurvasCrescimentoPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly opMedida = definirOperacao<
    EntradaMedidaCrescimento,
    { afericao: number; valores: number }
  >({
    nome: 'pep.medida_crescimento',
    tabelas: ['afericao', 'afericao_valor'],
    entrada: esquemaMedidaCrescimento as unknown as z.ZodType<EntradaMedidaCrescimento>,
    gravar: (tx, e, ctx) => this.gravar(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'afericao', id: r.afericao }),
  });

  constructor(
    private readonly nucleo: NucleoCurvas,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private quem(c: ContextoCurvas) {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pep.curvas' }, async (l) => {
      const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]);
      if (!e)
        throw new ErroOperacao(
          403,
          'estabelecimento-desconhecido',
          'Estabelecimento',
          'O estabelecimento da sessão não existe no cliente.',
        );
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
      return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
    });
  }

  pacienteExiste(paciente: number): Promise<boolean> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pep.curvas' }, async (l) =>
      Boolean(await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente])),
    );
  }

  /** Nascimento, sexo e idade gestacional (o registro do nascimento prevalece sobre o cadastro). */
  private async crianca(l: Pick<Leitor, 'uma'>, paciente: number) {
    const p = await l.uma(
      `SELECT pf.data_nascimento, s.codigo AS sexo FROM paciente pa
         JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
         LEFT JOIN sexo s ON s.id = pf.sexo_id
        WHERE pa.id = ? AND pa.excluido_em IS NULL`,
      [paciente],
    );
    const rn = await l.uma(
      `SELECT nascido_em, idade_gestacional_semanas, idade_gestacional_dias, peso_gramas, comprimento_cm,
              perimetro_cefalico_cm
         FROM registro_nascimento
        WHERE recem_nascido_paciente_id = ? AND excluido_em IS NULL
        ORDER BY id DESC LIMIT 1`,
      [paciente],
    );
    const sexo = p ? String(p['sexo'] ?? '') : '';
    return {
      existe: Boolean(p),
      nascimento: dataDe(rn?.['nascido_em']) ?? dataDe(p?.['data_nascimento']),
      sexo: sexo === 'masculino' || sexo === 'feminino' ? sexo : null,
      igSemanas: numOuNull(rn?.['idade_gestacional_semanas']),
      igDias: numOuNull(rn?.['idade_gestacional_dias']),
      rn,
    };
  }

  private async curva(
    l: Pick<Leitor, 'consultar'>,
    sexo: string,
    publicacao: Publicacao,
    indicador: IndicadorCrescimento,
  ): Promise<CurvaLida | null> {
    const linhas = await l.consultar(
      `SELECT c.codigo_curva, c.descricao, c.eixo_x, c.unidade_eixo_y, c.versao_fonte, p.codigo_faixa, p.valor_x,
              p.valor_y
         FROM curva_referencia c
         JOIN sexo s ON s.id = c.sexo_id
         JOIN parametro_vital pv ON pv.id = c.parametro_vital_id
         JOIN curva_referencia_ponto p ON p.curva_referencia_id = c.id
        WHERE s.codigo = ? AND pv.codigo = ? AND c.codigo_curva LIKE ? AND c.visivel
          AND (c.vigencia_fim IS NULL OR c.vigencia_fim >= CURRENT_DATE)
          AND (p.vigencia_fim IS NULL OR p.vigencia_fim >= CURRENT_DATE)
        ORDER BY c.ordem_exibicao, c.id, p.valor_x`,
      [sexo, PARAMETRO_DO_INDICADOR[indicador], `${PREFIXO[publicacao]}%`],
    );
    if (linhas.length === 0) return null;
    const primeira = linhas[0]!;
    const codigo = String(primeira['codigo_curva']);
    const porX = new Map<number, Record<string, number>>();
    for (const x of linhas) {
      if (String(x['codigo_curva']) !== codigo) continue;
      const vx = num(x['valor_x']);
      const f = porX.get(vx) ?? {};
      f[String(x['codigo_faixa'])] = num(x['valor_y']);
      porX.set(vx, f);
    }
    const xs = [...porX.keys()].sort((a, b) => a - b);
    const lms = xs.every((x) => ['L', 'M', 'S'].every((k) => porX.get(x)![k] !== undefined));
    const faixasZ = ['Z-3', 'Z-2', 'Z-1', 'Z0', 'Z+1', 'Z+2', 'Z+3'];
    const calculo: CurvaCalculo = lms
      ? {
          tipo: 'lms',
          pontos: xs.map((x) => ({ x, l: porX.get(x)!['L']!, m: porX.get(x)!['M']!, s: porX.get(x)!['S']! })),
        }
      : {
          tipo: 'linhas_z',
          pontos: xs
            .filter((x) => faixasZ.every((k) => porX.get(x)![k] !== undefined))
            .map((x) => ({ x, z: faixasZ.map((k) => porX.get(x)![k]!) })),
        };
    return {
      codigo,
      descricao: String(primeira['descricao']),
      eixo: String(primeira['eixo_x']),
      unidade: String(primeira['unidade_eixo_y']),
      versaoFonte: String(primeira['versao_fonte']),
      calculo,
    };
  }

  /** As medidas do paciente com escore Z, percentil e classificação, e o gráfico de cada indicador e curva. */
  async doPaciente(c: ContextoCurvas, paciente: number): Promise<CrescimentoDoPaciente> {
    const q = await this.quem(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'pep.curvas', estabelecimento: q.estabelecimento },
      async (l) => {
        const cr = await this.crianca(l, paciente);
        const valores = await l.consultar(
          `SELECT a.id, a.aferido_em, pv.codigo, v.valor_numerico
             FROM afericao a
             JOIN afericao_valor v ON v.afericao_id = a.id AND v.excluido_em IS NULL AND NOT v.nao_aferido
             JOIN parametro_vital pv ON pv.id = v.parametro_vital_id
            WHERE a.paciente_id = ? AND a.excluido_em IS NULL AND v.valor_numerico IS NOT NULL
              AND pv.codigo IN (${PARAMETROS.map(() => '?').join(',')})
              AND NOT EXISTS (SELECT 1 FROM afericao_valor r
                               WHERE r.retifica_afericao_valor_id = v.id AND r.excluido_em IS NULL)
            ORDER BY a.aferido_em, a.id, v.sequencia`,
          [paciente, ...PARAMETROS],
        );
        const brutas = new Map<
          number,
          { quando: Date; peso: number | null; altura: number | null; pc: number | null }
        >();
        for (const v of valores) {
          const k = num(v['id']);
          const m = brutas.get(k) ?? { quando: dataDe(v['aferido_em'])!, peso: null, altura: null, pc: null };
          const codigo = String(v['codigo']);
          const valor = num(v['valor_numerico']);
          if (codigo === 'peso') m.peso = valor;
          else if (codigo === 'altura') m.altura = valor;
          else m.pc = valor;
          brutas.set(k, m);
        }
        const lista: {
          afericao: number | null;
          quando: Date;
          peso: number | null;
          altura: number | null;
          pc: number | null;
        }[] = [...brutas.entries()].map(([afericao, m]) => ({ afericao, ...m }));
        const rn = cr.rn;
        if (rn && cr.nascimento && (rn['peso_gramas'] || rn['comprimento_cm'] || rn['perimetro_cefalico_cm']))
          lista.unshift({
            afericao: null,
            quando: cr.nascimento,
            peso: rn['peso_gramas'] ? num(rn['peso_gramas']) / 1000 : null,
            altura: numOuNull(rn['comprimento_cm']),
            pc: numOuNull(rn['perimetro_cefalico_cm']),
          });
        lista.sort((a, b) => a.quando.getTime() - b.quando.getTime());

        const nascimento = cr.nascimento;
        const crianca = { nascimento: nascimento!, igSemanas: cr.igSemanas, igDias: cr.igDias };
        const cache = new Map<string, CurvaLida | null>();
        const curvaDe = async (pub: Publicacao, ind: IndicadorCrescimento) => {
          const k = `${pub}:${ind}`;
          if (!cache.has(k)) cache.set(k, cr.sexo ? await this.curva(l, cr.sexo, pub, ind) : null);
          return cache.get(k)!;
        };
        const graficos = new Map<string, GraficoCrescimento>();
        const medidas: MedidaLida[] = [];
        for (const m of lista) {
          const imc = imcDe(m.peso, m.altura);
          const ref = nascimento ? referenciaDaMedida(crianca, m.quando) : null;
          const avaliacoes: Partial<Record<IndicadorCrescimento, AvaliacaoMedida>> = {};
          const y: Record<IndicadorCrescimento, number | null> = {
            peso: m.peso,
            estatura: m.altura,
            perimetro_cefalico: m.pc,
            imc,
          };
          if (ref)
            for (const ind of INDICADORES_CRESCIMENTO) {
              const valor = y[ind];
              if (valor === null) continue;
              const curva = await curvaDe(ref.publicacao, ind);
              if (!curva) continue;
              const a = avaliarMedida(ind, valor, curva.calculo, ref.x, ref.idadeMeses);
              if (!a) continue;
              avaliacoes[ind] = a;
              const g = this.grafico(graficos, ind, ref.publicacao, curva);
              g.pontos.push({
                x: Math.round(ref.x * 1000) / 1000,
                y: valor,
                z: a.z,
                percentil: a.percentil,
                nivel: a.plausivel ? a.classificacao.nivel : 'revisar',
                medidoEm: m.quando.toISOString(),
              });
            }
          medidas.push({
            afericao: m.afericao,
            origem: m.afericao === null ? 'nascimento' : 'afericao',
            medidoEm: m.quando.toISOString(),
            pesoKg: m.peso,
            estaturaCm: m.altura,
            perimetroCefalicoCm: m.pc,
            imc,
            referencia: ref,
            avaliacoes,
          });
        }
        const referenciaAtual = nascimento ? referenciaDaMedida(crianca, this.agora()) : null;
        // Sem medida na fase atual, o gráfico da idade de hoje aparece vazio para orientar a próxima medida.
        if (referenciaAtual)
          for (const ind of INDICADORES_CRESCIMENTO) {
            const curva = await curvaDe(referenciaAtual.publicacao, ind);
            if (curva) this.grafico(graficos, ind, referenciaAtual.publicacao, curva);
          }
        return {
          paciente: {
            nascimento: iso(nascimento),
            sexo: cr.sexo,
            igSemanas: cr.igSemanas,
            igDias: cr.igDias,
          },
          referenciaAtual,
          medidas: medidas.reverse(),
          graficos: [...graficos.values()],
          semCurvas: Boolean(cr.sexo && nascimento) && graficos.size === 0 && referenciaAtual !== null,
        };
      },
    );
  }

  private grafico(
    mapa: Map<string, GraficoCrescimento>,
    indicador: IndicadorCrescimento,
    publicacao: Publicacao,
    c: CurvaLida,
  ): GraficoCrescimento & { pontos: GraficoCrescimento['pontos'][number][] } {
    const k = `${publicacao}:${indicador}`;
    let g = mapa.get(k);
    if (!g) {
      g = {
        indicador,
        publicacao,
        codigo: c.codigo,
        descricao: c.descricao,
        eixo: c.eixo,
        unidade: c.unidade,
        versaoFonte: c.versaoFonte,
        linhas: linhasDoGrafico(c.calculo),
        pontos: [],
      };
      mapa.set(k, g);
    }
    return g as GraficoCrescimento & { pontos: GraficoCrescimento['pontos'][number][] };
  }

  async registrarMedida(c: ContextoGravacaoCurvas, entrada: unknown) {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa('usuario-sem-conta', 'A gravação exige uma conta de usuário do cliente.');
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(this.opMedida, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async gravar(tx: TxOperacao, e: EntradaMedidaCrescimento, ctx: ContextoOperacao) {
    const cr = await this.crianca(tx, e.paciente);
    if (!cr.existe)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Paciente não encontrado',
        'O paciente não existe.',
      );
    if (e.atendimento) {
      const a = await tx.uma('SELECT paciente_id FROM atendimento WHERE id = ? AND excluido_em IS NULL', [
        e.atendimento,
      ]);
      if (!a || num(a['paciente_id']) !== e.paciente)
        throw recusa('atendimento-de-outro-paciente', 'O atendimento não é deste paciente.');
    }
    const medidoEm = new Date(e.medidoEm);
    const m = {
      pesoKg: e.pesoKg ?? null,
      estaturaCm: e.estaturaCm ?? null,
      perimetroCefalicoCm: e.perimetroCefalicoCm ?? null,
    };
    const falhas = validarMedidaCrescimento({ ...m, medidoEm, nascimento: cr.nascimento }, this.agora());
    if (falhas.length) throw recusa(falhas[0]!.codigo, falhas.map((f) => f.mensagem).join(' '));
    const parametros = await tx.consultar(
      `SELECT id, codigo FROM parametro_vital WHERE codigo IN (${PARAMETROS.map(() => '?').join(',')}) AND ativo`,
      [...PARAMETROS],
    );
    const idPar = new Map(parametros.map((p) => [String(p['codigo']), num(p['id'])]));
    const prof = await tx.uma(
      'SELECT profissional_id FROM usuario_profissional WHERE usuario_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
      [ctx.usuario],
    );
    const ref = referenciaDaMedida(
      { nascimento: cr.nascimento!, igSemanas: cr.igSemanas, igDias: cr.igDias },
      medidoEm,
    );
    const itens: [IndicadorCrescimento, number | null][] = [
      ['peso', m.pesoKg],
      ['estatura', m.estaturaCm],
      ['perimetro_cefalico', m.perimetroCefalicoCm],
    ];
    for (const [ind, v] of itens)
      if (v !== null && !idPar.has(PARAMETRO_DO_INDICADOR[ind]))
        throw recusa(
          'parametro-inexistente',
          `O parâmetro ${PARAMETRO_DO_INDICADOR[ind]} não está ativo: rode o carregador das curvas de crescimento.`,
        );
    const afericao = await tx.incluir('afericao', {
      estabelecimento_id: Number(ctx.estabelecimento),
      paciente_id: e.paciente,
      atendimento_id: e.atendimento ?? null,
      profissional_id: prof ? num(prof['profissional_id']) : null,
      aferido_em: medidoEm,
      fonte: 'manual',
      finalizada: true,
      observacao: e.observacao?.trim() || null,
    });
    let sequencia = 0;
    for (const [ind, v] of itens) {
      if (v === null) continue;
      let nivel: string | null = null;
      if (ref && cr.sexo) {
        const curva = await this.curva(tx, cr.sexo, ref.publicacao, ind);
        const a = curva ? avaliarMedida(ind, v, curva.calculo, ref.x, ref.idadeMeses) : null;
        if (a) nivel = a.plausivel ? NIVEL_DO_VALOR[a.classificacao.nivel] : 'fora_faixa_plausivel';
      }
      await tx.incluir('afericao_valor', {
        afericao_id: afericao,
        sequencia: ++sequencia,
        parametro_vital_id: idPar.get(PARAMETRO_DO_INDICADOR[ind])!,
        valor_numerico: v,
        nivel_alerta: nivel,
      });
    }
    return { afericao, valores: sequencia };
  }
}
