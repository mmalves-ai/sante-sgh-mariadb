// Porta das integrações em memória (M34): a sessão sintética de dev/ci (E2E). Parceiros SINTÉTICOS (o laboratório de
// apoio, a RNDS em homologação e o motor de integração), mensagens de saída com uma na fila de mortos há mais de 4 h
// (o alerta da regra 10 aparece), um retorno do laboratório de apoio a conferir sobre um exame sintético e as
// leituras agregadas do legado sintéticas. Mesmas regras do domínio (retentativa, tratamento, idempotência). Nada vai
// à cópia; o resultado aprovado é "gravado" no exame sintético (o executor do legado não roda aqui).
import { aplicarTratamento, chaveDeOrdem, chaveEventoFato } from '@sgh/dominio-integracao';
import type {
  ContextoOperacao,
  EnvioLidoBanco,
  EnvioNovo,
  LinhaTrilha,
  ParceiroLidoBanco,
  RecebidaLidaBanco,
  ResultadoOperacao,
} from '@sgh/legado';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { registrarNaTrilha } from '../../autorizacao/trilha-memoria.js';
import type { ArmazemConteudoMemoria } from './infra/armazem-conteudo.js';
import { resumoSha256 } from './infra/armazem-conteudo.js';
import type {
  ContextoIntegracao,
  ExameDoRetorno,
  GravadorSghIntegracao,
  PortaIntegracao,
  VinculoResponsavel,
} from './porta.js';

/** O exame sintético do retorno do laboratório de apoio (o pedido 777 foi ao laboratório). */
export const EXAME_SINTETICO_APOIO = 777;

/** O ORU^R01 sintético do laboratório de apoio (nenhum dado de pessoa: só o pedido e os valores). */
export const ORU_SINTETICO = [
  'MSH|^~\\&|LAB-APOIO|LABSINT|SANTE|SINTETICO|20261022080000||ORU^R01^ORU_R01|LABSINT-0001|T|2.5',
  'PID|1||900001^^^^PI',
  `OBR|1|${EXAME_SINTETICO_APOIO}|AP-2026-0001|GLI^GLICOSE`,
  'OBX|1|NM|GLI^GLICOSE||92|mg/dL|70-99||||F',
  'NTE|1||Amostra conferida pelo laboratório de apoio.',
].join('\r');

/** O parceiro como a porta devolve (o resumo do segredo nunca sai da memória). */
function semResumo(x: ParceiroLidoBanco & { resumo: string | null }): ParceiroLidoBanco {
  const p: Partial<ParceiroLidoBanco & { resumo: string | null }> = { ...x };
  delete p.resumo;
  return p as ParceiroLidoBanco;
}

export class PortaIntegracaoMemoria implements PortaIntegracao {
  readonly destino = 'memoria' as const;
  private readonly parceirosPorH = new Map<
    string,
    Map<string, ParceiroLidoBanco & { resumo: string | null }>
  >();
  private readonly enviosPorH = new Map<string, Map<string, EnvioLidoBanco>>();
  private readonly recebidasPorH = new Map<string, Map<string, RecebidaLidaBanco>>();
  private readonly outboxPorH = new Map<string, { tipo: string; chave: string; situacao: string }[]>();
  private readonly marcas = new Map<
    string,
    { ultimoId: string; ultimoCarimbo: Date | null; lidos: number }
  >();
  private readonly resultados = new Map<number, { elementos: number; emissor: number | null }>();
  private seq = 1000;

  constructor(
    private readonly armazem: ArmazemConteudoMemoria,
    private readonly trilha: RegistradorTrilha | null = null,
  ) {}

  private semear(h: string): void {
    if (this.parceirosPorH.has(h)) return;
    const agora = new Date();
    const p = (x: Partial<ParceiroLidoBanco> & Pick<ParceiroLidoBanco, 'codigo' | 'nome' | 'tipo'>) => ({
      id: String(++this.seq),
      canal: null,
      clienteId: null,
      temSegredo: false,
      resumo: null,
      escopos: [],
      eventos: [],
      limiteTentativas: 6,
      finalidade: 'Integração sintética de desenvolvimento e testes.',
      baseLegal: 'tutela-da-saude',
      ativo: true,
      criadoPor: 'SINT.ADMIN',
      alteradoEm: null,
      ...x,
    });
    this.parceirosPorH.set(
      h,
      new Map(
        [
          p({
            codigo: 'lab-apoio-sintetico',
            nome: 'Laboratório de apoio sintético',
            tipo: 'apoio',
            canal: 'oie-apoio-orm',
            escopos: ['resultado.enviar', 'pedido.receber'],
            eventos: ['fato.exame.apoio'],
          }),
          p({
            codigo: 'rnds-homologacao',
            nome: 'RNDS (homologação)',
            tipo: 'fhir',
            escopos: ['paciente.identificar', 'vacina.enviar'],
            eventos: ['fato.vacina.aplicada'],
            ativo: false,
            baseLegal: 'obrigacao-legal',
          }),
          p({
            codigo: 'oie-classificacao',
            nome: 'Classificação de risco externa (motor de integração)',
            tipo: 'hl7',
            canal: 'oie-classificacao-adt',
            eventos: ['integracao.teste'],
            ativo: false,
          }),
        ].map((x) => [x.codigo, x]),
      ),
    );
    const e = (x: Partial<EnvioLidoBanco> & Pick<EnvioLidoBanco, 'situacao'>): EnvioLidoBanco => {
      const id = String(++this.seq);
      return {
        id,
        idOutbox: String(500 + Number(id)),
        chaveEvento: chaveEventoFato('resultado.liberado', h.replace(/[^a-z0-9]/gi, '') || 'pc', id, agora),
        tipoEvento: 'fato.exame.apoio',
        parceiro: 'lab-apoio-sintetico',
        chaveOrdem: chaveDeOrdem('paciente', 900000 + Number(id)),
        tabelaFato: 'SILANEXA',
        idFato: String(EXAME_SINTETICO_APOIO),
        tentativas: 0,
        proximaTentativaEm: null,
        enviadoEm: null,
        recibo: null,
        resposta: null,
        hashConteudo: null,
        mortoEm: null,
        tratamento: null,
        tratadoPor: null,
        motivoTratamento: null,
        criadoEm: new Date(agora.getTime() - 6 * 3_600_000),
        ...x,
      };
    };
    this.enviosPorH.set(
      h,
      new Map(
        [
          e({ situacao: 'enviado', tentativas: 1, enviadoEm: agora, recibo: 'ACK-AA-0001', resposta: 'AA' }),
          e({
            situacao: 'pendente',
            tentativas: 2,
            proximaTentativaEm: new Date(agora.getTime() + 30 * 60_000),
            resposta: 'tempo esgotado',
          }),
          e({
            situacao: 'morto',
            tentativas: 6,
            mortoEm: new Date(agora.getTime() - 5 * 3_600_000),
            resposta: 'AE: exame sem de-para no laboratório',
          }),
        ].map((x) => [x.id, x]),
      ),
    );
    const resumo = resumoSha256(ORU_SINTETICO);
    const chaveS3 = `${h}/lab-apoio-sintetico/entrada/sintetico/${resumo}.txt`;
    void this.armazem.gravar('rede-sintetica', chaveS3, ORU_SINTETICO);
    this.recebidasPorH.set(
      h,
      new Map([
        [
          '901',
          {
            id: '901',
            parceiro: 'lab-apoio-sintetico',
            tipo: 'ORU^R01',
            chaveParceiro: 'LABSINT-0001',
            hash: resumo,
            chaveS3,
            tamanho: ORU_SINTETICO.length,
            situacao: 'conferir',
            detalhe: null,
            tabelaObjeto: 'SILANEXA',
            idObjeto: String(EXAME_SINTETICO_APOIO),
            conferidoPor: null,
            conferidoEm: null,
            recebidoEm: new Date(agora.getTime() - 3_600_000),
          },
        ],
      ]),
    );
    this.outboxPorH.set(h, [
      { tipo: 'fato.exame.apoio', chave: 'sint-1', situacao: 'publicado' },
      { tipo: 'fato.exame.apoio', chave: 'sint-2', situacao: 'pendente' },
    ]);
  }

  private parceirosDe(h: string) {
    this.semear(h);
    return this.parceirosPorH.get(h)!;
  }
  private enviosDe(h: string) {
    this.semear(h);
    return this.enviosPorH.get(h)!;
  }
  private recebidasDe(h: string) {
    this.semear(h);
    return this.recebidasPorH.get(h)!;
  }

  async relogio(): Promise<Date> {
    return new Date();
  }

  async parceiros(c: ContextoIntegracao): Promise<ParceiroLidoBanco[]> {
    return [...this.parceirosDe(c.hospital).values()].map((x) => semResumo(x));
  }

  async parceiro(c: ContextoIntegracao, codigo: string) {
    const x = this.parceirosDe(c.hospital).get(codigo);
    return x ? semResumo(x) : null;
  }

  async credencial(c: ContextoIntegracao, clienteId: string) {
    const x = [...this.parceirosDe(c.hospital).values()].find((p) => p.clienteId === clienteId);
    return x?.resumo ? { codigo: x.codigo, resumo: x.resumo, ativo: x.ativo, escopos: [...x.escopos] } : null;
  }

  async envios(
    c: ContextoIntegracao,
    f: { readonly situacao?: string; readonly parceiro?: string; readonly limite: number },
  ) {
    return [...this.enviosDe(c.hospital).values()]
      .filter((e) => (!f.situacao || e.situacao === f.situacao) && (!f.parceiro || e.parceiro === f.parceiro))
      .reverse()
      .slice(0, f.limite);
  }

  async envio(c: ContextoIntegracao, id: string) {
    return this.enviosDe(c.hospital).get(id) ?? null;
  }

  async mortos(c: ContextoIntegracao) {
    return [...this.enviosDe(c.hospital).values()].filter((e) => e.situacao === 'morto');
  }

  async contagens(c: ContextoIntegracao) {
    const conta = <T>(l: T[], k: (x: T) => string, s: (x: T) => string) => {
      const m = new Map<string, { chave: string; situacao: string; quantidade: number }>();
      for (const x of l) {
        const id = `${k(x)}|${s(x)}`;
        const v = m.get(id) ?? { chave: k(x), situacao: s(x), quantidade: 0 };
        v.quantidade++;
        m.set(id, v);
      }
      return [...m.values()];
    };
    this.semear(c.hospital);
    return {
      outbox: conta(
        this.outboxPorH.get(c.hospital)!,
        (x) => x.tipo,
        (x) => x.situacao,
      ),
      envios: conta(
        [...this.enviosDe(c.hospital).values()],
        (x) => x.parceiro,
        (x) => x.situacao,
      ),
      entradas: conta(
        [...this.recebidasDe(c.hospital).values()],
        (x) => x.parceiro,
        (x) => x.situacao,
      ),
    };
  }

  async recebidas(
    c: ContextoIntegracao,
    f: { readonly situacao?: string; readonly parceiro?: string; readonly limite: number },
  ) {
    return [...this.recebidasDe(c.hospital).values()]
      .filter((e) => (!f.situacao || e.situacao === f.situacao) && (!f.parceiro || e.parceiro === f.parceiro))
      .reverse()
      .slice(0, f.limite);
  }

  async recebida(c: ContextoIntegracao, id: string) {
    return this.recebidasDe(c.hospital).get(id) ?? null;
  }

  async saudeLegado() {
    return {
      filas: [
        { fila: 'OUT_ADT_A03', direcao: 'saida' as const, quantidade: 0, maisAntiga: null },
        { fila: 'OUT_ADT_A04', direcao: 'saida' as const, quantidade: 0, maisAntiga: null },
        { fila: 'OUT_ADT_A08', direcao: 'saida' as const, quantidade: 0, maisAntiga: null },
        { fila: 'IN_ADT_A02', direcao: 'entrada' as const, quantidade: 0, maisAntiga: null },
      ],
      bi: { pendentes: 12, maisAntiga: null },
      examesApoio: { marcados: '<5', exportados: 37, pendentes: '<5', maisAntigo: null },
    };
  }

  async visoes() {
    return [
      { visao: 'V_EPIMED_INTERNACAO', existe: true, linhas: 120 },
      { visao: 'V_FIRST_LEITO', existe: true, linhas: 61 },
      { visao: 'V_MEDIA_PLUS_AGENDAMENTO', existe: true, linhas: null },
    ];
  }

  async identificacao() {
    return {
      pacientesComCpf: 40,
      pacientesComCns: '<5',
      profissionaisComCns: 0,
      estabelecimentoComCnes: true,
    };
  }

  async interfacesApoio() {
    return [{ codigo: 6, nome: 'Laboratório de apoio sintético', laboratorio: 'Apoio sintético', exames: 3 }];
  }

  async deParaExame(_c: ContextoIntegracao, _i: number, codigoExame: string) {
    return codigoExame === 'GLI'
      ? { exame: 1, elementos: [{ codigoLaboratorio: 'GLI', nome: 'GLICOSE' }] }
      : { exame: null, elementos: [] };
  }

  async exameDoRetorno(_c: ContextoIntegracao, id: number): Promise<ExameDoRetorno | null> {
    if (id !== EXAME_SINTETICO_APOIO) return null;
    return {
      id,
      paciente: 900001,
      ato: 15,
      exame: 'GLI',
      exameNome: 'Glicose',
      liberado: false,
      digitado: this.resultados.has(id),
      elementos: [{ elemento: 0, nome: 'GLICOSE' }],
    };
  }

  async exameLido(_c: ContextoIntegracao, id: number) {
    return id === EXAME_SINTETICO_APOIO ? { id, chave: { sintetico: true }, versao: null } : null;
  }

  async vinculos(_c: ContextoIntegracao, login: string): Promise<VinculoResponsavel[]> {
    return login === 'SINT.BIOMEDICO'
      ? [{ vinculo: 4401, conselho: 1001, nome: 'Responsável Técnico Sintético', ativo: true }]
      : [];
  }

  async marca(c: ContextoIntegracao, fato: string) {
    return this.marcas.get(`${c.hospital}|${fato}`) ?? { ultimoId: '0', ultimoCarimbo: null, lidos: 0 };
  }

  async fatosResultadoLiberado() {
    return [];
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(
    _c: ContextoIntegracao,
    op: string,
    entrada: unknown,
    octx: ContextoOperacao,
  ): Promise<{ resultado: ResultadoOperacao; repetida: boolean }> {
    if (op !== 'sadt.registrarResultado' || !octx.idempotencyKey)
      throw new ErroProblema('operacao-bloqueada', 409, 'Operação não disponível na sessão sintética');
    const e = entrada as { exame: { id: number }; elementos: unknown[]; emissor?: number };
    if (this.resultados.has(e.exame.id))
      throw new ErroProblema('recusa-de-negocio', 409, 'Resultado já digitado', 'O exame já tem resultado.');
    this.resultados.set(e.exame.id, { elementos: e.elementos.length, emissor: e.emissor ?? null });
    return { resultado: { exame: e.exame.id, resultados: e.elementos.length }, repetida: false };
  }

  async gravarSgh<T>(
    c: ContextoIntegracao,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorSghIntegracao) => Promise<T>,
  ): Promise<T> {
    const h = c.hospital;
    const g: GravadorSghIntegracao = {
      criarParceiro: async (p, u) => {
        const m = this.parceirosDe(h);
        if (m.has(p.codigo))
          throw new ErroProblema('recusa-de-negocio', 409, 'Já existe parceiro com este código', undefined, {
            codigo: 'duplicado',
          });
        const id = String(++this.seq);
        m.set(p.codigo, {
          ...p,
          escopos: [...p.escopos],
          eventos: [...p.eventos],
          id,
          clienteId: null,
          temSegredo: false,
          resumo: null,
          ativo: false,
          criadoPor: u,
          alteradoEm: null,
        });
        return id;
      },
      alterarParceiro: async (codigo, p) => {
        const m = this.parceirosDe(h);
        const x = m.get(codigo);
        if (!x) return 0;
        m.set(codigo, {
          ...x,
          ...p,
          escopos: [...p.escopos],
          eventos: [...p.eventos],
          alteradoEm: new Date(),
        });
        return 1;
      },
      gravarCredencial: async (codigo, clienteId, resumo) => {
        const m = this.parceirosDe(h);
        const x = m.get(codigo);
        if (!x) return 0;
        m.set(codigo, { ...x, clienteId, resumo, temSegredo: true, alteradoEm: new Date() });
        return 1;
      },
      tratarMorto: async (id, t) => {
        const m = this.enviosDe(h);
        const x = m.get(id);
        if (!x || x.situacao !== 'morto') return 0;
        const r = aplicarTratamento(x.situacao, t.acao, t.motivo);
        m.set(id, {
          ...x,
          situacao: r.situacao,
          tentativas: r.situacao === 'pendente' ? 0 : x.tentativas,
          proximaTentativaEm: null,
          tratamento: t.acao,
          tratadoPor: t.usuario,
          motivoTratamento: t.motivo,
        });
        return 1;
      },
      registrarRecebida: async (r) => {
        const m = this.recebidasDe(h);
        const ja = [...m.values()].find(
          (x) => x.parceiro === r.parceiro && x.chaveParceiro === r.chaveParceiro,
        );
        if (ja) return { recebida: ja, repetida: true };
        const id = String(++this.seq);
        const nova: RecebidaLidaBanco = {
          ...r,
          id,
          conferidoPor: null,
          conferidoEm: null,
          recebidoEm: new Date(),
        };
        m.set(id, nova);
        return { recebida: nova, repetida: false };
      },
      concluirRecebida: async (id, x) => {
        const m = this.recebidasDe(h);
        const r = m.get(id);
        if (!r || r.situacao !== 'conferir') return 0;
        m.set(id, {
          ...r,
          situacao: x.situacao,
          detalhe: x.detalhe,
          tabelaObjeto: x.tabelaObjeto,
          idObjeto: x.idObjeto,
          conferidoPor: x.usuario,
          conferidoEm: new Date(),
        });
        return 1;
      },
      registrarEnvio: async (n: EnvioNovo) => {
        const m = this.enviosDe(h);
        if ([...m.values()].some((x) => x.chaveEvento === n.chaveEvento && x.parceiro === n.parceiro))
          return false;
        const id = String(++this.seq);
        m.set(id, {
          ...n,
          id,
          situacao: 'pendente',
          tentativas: 0,
          proximaTentativaEm: null,
          enviadoEm: null,
          recibo: null,
          resposta: null,
          hashConteudo: null,
          mortoEm: null,
          tratamento: null,
          tratadoPor: null,
          motivoTratamento: null,
          criadoEm: new Date(),
        });
        return true;
      },
      outbox: async (ev) => {
        this.semear(h);
        this.outboxPorH.get(h)!.push({ tipo: ev.tipo, chave: ev.chave, situacao: 'pendente' });
        return String(++this.seq);
      },
    };
    const r = await fn(g);
    await registrarNaTrilha(this.trilha, typeof trilha === 'function' ? trilha(r) : trilha);
    return r;
  }
}
