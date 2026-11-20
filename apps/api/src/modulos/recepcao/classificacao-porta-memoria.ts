// Porta da classificação de risco em MEMÓRIA (M44, etapa 1): a sessão sintética de dev/ci (E2E). Protocolo,
// classificações, sinais e avisos SINTÉTICOS, por estabelecimento, com as mesmas recusas das gravações SGH_ (sucessão
// única por atendimento ou anterior, versão seguinte do mesmo tipo, aviso único por chave). O vínculo sintético sai do
// login: ENFERMEIRO (CBO 223505, COREN ativo), TECNICO (322205), MEDICO (225125); a recepção e os demais, sem vínculo
// clínico. O relógio é o mesmo da recepção e do atendimento em memória (hora de Brasília, sem fuso). Nada vai à cópia.
import type {
  ProtocoloPacienteLido,
  VersaoGerenciadoLida,
  ClassificacaoLida,
  CorLegadoLida,
  OpcaoPrioridadeVista,
  SinaisSgh,
  VersaoProtocoloLida,
} from '@sgh/legado';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type {
  ContextoClassificacao,
  GravadorClassificacao,
  PortaClassificacao,
} from './classificacao-porta.js';
import { relogioDoEstabelecimento } from './porta-memoria.js';

interface Estado {
  seq: number;
  versoes: (VersaoProtocoloLida & { conteudo: unknown })[];
  classificacoes: ClassificacaoLida[];
  sinais: { cabecalho: string; em: string; sinais: SinaisSgh }[];
  avisos: Set<string>;
  /** M44 (etapa 3): as definições publicadas e os protocolos dos pacientes (com os eventos). */
  gerenciados: VersaoGerenciadoLida[];
  protocolos: ProtocoloPacienteLido[];
}

const recusa = (codigo: string, detalhe: string) =>
  new ErroProblema('recusa-de-negocio', 409, 'Não gravado', detalhe, { codigo });

/** A tabela de cores antiga como a cópia pc tem (configuração, sem pessoa). */
const CORES_LEGADO: CorLegadoLida[] = [
  { id: 1, codigoProtocolo: 1, classificacao: 'EMERGENTE', corOriginal: 'clRed', corHex: '#ff0000' },
  { id: 2, codigoProtocolo: 2, classificacao: 'MUITO URGENTE', corOriginal: '$000080FF', corHex: '#ff8000' },
  { id: 3, codigoProtocolo: 3, classificacao: 'URGENTE', corOriginal: 'clYellow', corHex: '#ffff00' },
  { id: 4, codigoProtocolo: 4, classificacao: 'POUCO URGENTE', corOriginal: 'clGreen', corHex: '#008000' },
  { id: 5, codigoProtocolo: 5, classificacao: 'NAO URGENTE', corOriginal: 'clBlue', corHex: '#0000ff' },
  { id: 6, codigoProtocolo: 6, classificacao: 'OBITO', corOriginal: 'clBlack', corHex: '#000000' },
  { id: 7, codigoProtocolo: 7, classificacao: 'OUTROS', corOriginal: 'clWhite', corHex: '#ffffff' },
];

/** As 5 opções de "Prioridade clínica" vistas (contagens sintéticas). */
const OPCOES_VISTAS: OpcaoPrioridadeVista[] = [
  { indice: 1, idResposta: 2706, texto: 'Emergência- Vermelho', registros: 12 },
  { indice: 2, idResposta: 2707, texto: 'Muito urgente- Laranja', registros: 881 },
  { indice: 3, idResposta: 2708, texto: 'Urgente- Amarelo', registros: 4177 },
  { indice: 4, idResposta: 2709, texto: 'Pouco urgente- Verde', registros: 14717 },
  { indice: 5, idResposta: 2710, texto: 'Não urgente- Azul', registros: 7566 },
];

export class PortaClassificacaoMemoria implements PortaClassificacao {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  /**
   * `trilha`: o registrador dos eventos a mais da gravação (regra 3); a falha dele desfaz o que a gravação mudou em
   * memória, como o ROLLBACK da transação no banco. Sem registrador, o evento a mais é recusado (falha fechada).
   */
  constructor(
    private readonly opcoes: { agora?: () => Date; trilha?: Pick<RegistradorTrilha, 'registrar'> } = {},
  ) {}

  private e(c: ContextoClassificacao): Estado {
    const k = c.hospital;
    let s = this.estados.get(k);
    if (!s) {
      s = {
        seq: 100,
        versoes: [],
        classificacoes: [],
        sinais: [],
        avisos: new Set(),
        gerenciados: [],
        protocolos: [],
      };
      this.estados.set(k, s);
    }
    return s;
  }

  /** Hora local do estabelecimento (AAAA-MM-DDTHH:MM:SS), a mesma das outras portas em memória. */
  private agora(): string {
    return relogioDoEstabelecimento(this.opcoes.agora?.() ?? new Date()).agora;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw recusa(
      'operacao-indisponivel',
      'O formulário do prontuário não é gravado na sessão sintética: a classificação fica só neste sistema.',
    );
  }

  async gravarSgh<T>(
    c: ContextoClassificacao,
    _trilha: unknown,
    fn: (g: GravadorClassificacao) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const em = this.agora();
    // Retrato para desfazer (a transação em memória): a falha no meio, inclusive da trilha, não deixa nada gravado.
    const antes = {
      seq: s.seq,
      versoes: s.versoes.length,
      classificacoes: s.classificacoes.length,
      sinais: s.sinais.length,
      avisos: new Set(s.avisos),
      gerenciados: s.gerenciados.length,
      protocolos: structuredClone(s.protocolos),
    };
    const g: GravadorClassificacao = {
      publicarProtocolo: async (p) => {
        const id = ++s.seq;
        let protocolo = id;
        let versao = 1;
        if (p.protocolo !== null) {
          const doProt = s.versoes.filter((v) => v.protocolo === p.protocolo);
          if (doProt.length === 0)
            throw recusa('protocolo-inexistente', 'O protocolo não existe neste estabelecimento.');
          if (doProt[0]!.tipo !== p.tipo)
            throw recusa('tipo-diferente', 'A versão nova tem de ser do mesmo tipo do protocolo.');
          protocolo = p.protocolo;
          versao = Math.max(...doProt.map((v) => v.versao)) + 1;
        }
        s.versoes.unshift({
          id,
          protocolo,
          versao,
          tipo: p.tipo,
          nome: p.nome,
          notas: p.notas,
          autor: p.autor,
          aprovador: p.aprovador,
          publicadoEm: em,
          licencaValidaAte: p.licenca?.validaAte ?? null,
          impressao: p.impressao,
          conteudo: JSON.parse(JSON.stringify(p.conteudo)) as unknown,
        });
        return { id, protocolo, versao };
      },
      classificar: async (x) => {
        const sucede = x.anterior === null ? `inicial:${x.cabecalho}` : `apos:${x.anterior}`;
        const ja = s.classificacoes.some((k) =>
          x.anterior === null
            ? k.cabecalho === x.cabecalho && k.anterior === null
            : k.anterior === x.anterior,
        );
        if (ja)
          throw recusa(
            x.anterior === null ? 'ja-classificado' : 'anterior-desatualizada',
            x.anterior === null
              ? 'Este atendimento acabou de ser classificado por outra pessoa. Abra de novo.'
              : 'A classificação mudou depois que você abriu. Abra de novo antes de reclassificar.',
          );
        void sucede;
        const id = ++s.seq;
        s.classificacoes.push({
          id,
          cabecalho: x.cabecalho,
          reg: x.reg,
          paciente: x.paciente,
          versaoProtocolo: x.versaoProtocolo,
          fluxograma: x.fluxograma,
          discriminadores: [...x.discriminadores],
          automaticos: [...x.automaticos],
          sinais: { ...x.sinais },
          corProposta: x.corProposta,
          corFinal: x.corFinal,
          justificativa: x.justificativa,
          motivo: x.motivo,
          descricaoMudanca: x.descricaoMudanca,
          anterior: x.anterior,
          tempoAlvoMin: x.tempoAlvoMin,
          registroE08: x.e08.situacao === 'desligado' ? null : x.e08.registro,
          e08: x.e08.situacao,
          autor: x.autor,
          em,
        });
        let sinais = 0;
        if (x.motivo !== 'estouro') {
          s.sinais.push({ cabecalho: x.cabecalho, em, sinais: { ...x.sinais } });
          sinais = Object.values(x.sinais).filter((v) => v !== null).length;
        }
        return { id, sinais };
      },
      registrarSinais: async (x) => {
        s.sinais.push({ cabecalho: x.cabecalho, em, sinais: { ...x.sinais } });
        return Object.values(x.sinais).filter((v) => v !== null).length;
      },
      avisarEstouro: async (a) => {
        if (s.avisos.has(a.chave)) return false;
        s.avisos.add(a.chave);
        return true;
      },
      publicarGerenciado: async (p) => {
        const versao =
          Math.max(0, ...s.gerenciados.filter((v) => v.tipo === p.tipo).map((v) => v.versao)) + 1;
        if (p.autor.toUpperCase() === p.aprovador.toUpperCase())
          throw recusa('autoaprovacao', 'Quem aprova a versão não pode ser quem a redigiu.');
        const id = ++s.seq;
        s.gerenciados.push({
          id,
          tipo: p.tipo,
          versao,
          nome: p.nome,
          notas: p.notas,
          autor: p.autor,
          aprovador: p.aprovador,
          publicadoEm: em,
          impressao: p.impressao,
          conteudo: JSON.parse(JSON.stringify(p.conteudo)) as unknown,
        });
        return { id, versao };
      },
      incluirProtocolo: async (p) => {
        const g = s.gerenciados.find((v) => v.id === p.gerenciado);
        if (!g || g.tipo !== p.tipo)
          throw recusa('versao-inexistente', 'A versão do protocolo não existe neste estabelecimento.');
        if (s.protocolos.some((x) => x.cabecalho === p.cabecalho && x.tipo === p.tipo))
          throw recusa('ja-incluido', 'Este paciente já está neste protocolo neste atendimento.');
        const id = ++s.seq;
        s.protocolos.push({
          id,
          cabecalho: p.cabecalho,
          reg: p.reg,
          paciente: p.paciente,
          tipo: p.tipo,
          gerenciado: p.gerenciado,
          origem: p.origem,
          sugeridoPor: p.sugeridoPor,
          criterios: [...p.criterios],
          chegadaEm: p.chegadaEm.length === 16 ? `${p.chegadaEm}:00` : p.chegadaEm.slice(0, 19),
          incluidoEm: em,
          incluidoPor: p.autor,
          eventos: [],
        });
        return id;
      },
      registrarEventoProtocolo: async (p) => {
        const x = s.protocolos.find((k) => k.id === p.protocoloPaciente);
        if (!x)
          throw recusa('protocolo-inexistente', 'O protocolo do paciente não existe neste estabelecimento.');
        if (x.eventos.some((k) => k.tipo === 'encerramento'))
          throw recusa(
            p.tipoEvento === 'encerramento' ? 'ja-encerrado' : 'protocolo-encerrado',
            'O protocolo deste paciente já foi encerrado.',
          );
        if (x.eventos.some((k) => k.tipo === p.tipoEvento && k.codigo === p.codigo))
          throw recusa(
            'ja-registrado',
            'Este item do protocolo já foi registrado. Abra de novo para ver o registro.',
          );
        const id = ++s.seq;
        const h = (v: string | null) => (v === null ? null : v.length === 16 ? `${v}:00` : v.slice(0, 19));
        x.eventos.push({
          id,
          tipo: p.tipoEvento,
          codigo: p.codigo,
          situacao: p.situacao,
          quando: h(p.ocorridoEm),
          prazoEm: h(p.prazoEm),
          motivo: p.motivo,
          por: p.por,
          em,
        });
        return id;
      },
      registrarEvento: async (l) => {
        if (!this.opcoes.trilha) throw new Error('trilha indisponível na sessão sintética');
        await this.opcoes.trilha.registrar({
          evento: l.evento,
          rede: l.rede,
          hospital: l.hospital,
          usuario: l.usuario,
          estacao: l.estacao ?? '',
          correlacao: l.correlacao,
          recurso: l.recurso,
          resultado: 'sucesso',
          ...(l.tabelaAlvo ? { tabelaAlvo: l.tabelaAlvo } : {}),
          ...(l.idAlvo ? { idAlvo: l.idAlvo } : {}),
          ...(l.chaveNaturalAlvo ? { chaveNaturalAlvo: l.chaveNaturalAlvo } : {}),
          ...(l.idPaciente ? { paciente: l.idPaciente } : {}),
        });
      },
    };
    try {
      return await fn(g);
    } catch (erro) {
      s.seq = antes.seq;
      s.versoes.splice(0, s.versoes.length - antes.versoes);
      s.classificacoes.length = antes.classificacoes;
      s.sinais.length = antes.sinais;
      s.avisos = antes.avisos;
      s.gerenciados.length = antes.gerenciados;
      s.protocolos = antes.protocolos;
      throw erro;
    }
  }

  async relogio() {
    const agora = this.agora();
    return { agora, hoje: agora.slice(0, 10) };
  }

  async vinculo(_c: ContextoClassificacao, login: string) {
    if (/ENFERMEIRO|COORD\.ENF/i.test(login))
      return { vinculo: 7201, codigoCbo: '223505', conselhoAtivo: true };
    if (/TECNICO/i.test(login)) return { vinculo: 7202, codigoCbo: '322205', conselhoAtivo: true };
    if (/MEDICO/i.test(login)) return { vinculo: 7101, codigoCbo: '225125', conselhoAtivo: true };
    return null;
  }

  async versoes(c: ContextoClassificacao) {
    return this.e(c).versoes.map((v) => {
      const r: Partial<typeof v> = { ...v };
      delete r.conteudo;
      return r as VersaoProtocoloLida;
    });
  }

  async versao(c: ContextoClassificacao, id: number) {
    return this.e(c).versoes.find((v) => v.id === id) ?? null;
  }

  async classificacoes(c: ContextoClassificacao, cabs: readonly string[]) {
    const k = new Set(cabs);
    return this.e(c).classificacoes.filter((x) => k.has(x.cabecalho));
  }

  async classificacoesDoPaciente(c: ContextoClassificacao, paciente: number) {
    return [...this.e(c).classificacoes.filter((x) => x.paciente === paciente)].reverse().slice(0, 50);
  }

  async classificacoesDoPeriodo(c: ContextoClassificacao, inicio: string, fim: string) {
    return this.e(c).classificacoes.filter((x) => x.em >= inicio && x.em < fim);
  }

  async sinaisRecentesDosAtendimentos(
    c: ContextoClassificacao,
    itens: readonly { cabecalho: string; desde: string }[],
  ) {
    const r = new Map<string, SinaisSgh>();
    for (const i of itens) {
      const s = await this.sinaisRecentes(c, i.cabecalho, i.desde);
      if (s) r.set(i.cabecalho, s);
    }
    return r;
  }

  async sinaisRecentes(c: ContextoClassificacao, cab: string, desde: string) {
    const l = this.e(c).sinais.filter((x) => x.cabecalho === cab && x.em >= desde);
    if (l.length === 0) return null;
    const r: { -readonly [K in keyof SinaisSgh]: SinaisSgh[K] } = {
      pas: null,
      pad: null,
      fc: null,
      fr: null,
      temperatura: null,
      saturacao: null,
      glicemia: null,
      dor: null,
      glasgow: null,
    };
    for (const x of [...l].reverse())
      for (const [k, v] of Object.entries(x.sinais) as [keyof SinaisSgh, number | null][])
        if (r[k] === null && v !== null) r[k] = v;
    return r;
  }

  async historicoProntuario() {
    return [];
  }

  async opcoesPrioridadeVistas() {
    return OPCOES_VISTAS;
  }

  async coresLegado() {
    return CORES_LEGADO;
  }

  async avisosGravados(c: ContextoClassificacao, chaves: readonly string[]) {
    const s = this.e(c);
    return new Set(chaves.filter((k) => s.avisos.has(k)));
  }

  async versoesGerenciadas(c: ContextoClassificacao) {
    return [...this.e(c).gerenciados].sort((a, b) => a.tipo.localeCompare(b.tipo) || b.versao - a.versao);
  }

  async protocolosDosAtendimentos(c: ContextoClassificacao, cabs: readonly string[]) {
    const k = new Set(cabs);
    return structuredClone(this.e(c).protocolos.filter((x) => k.has(x.cabecalho)));
  }

  async protocolosDoPeriodo(c: ContextoClassificacao, inicio: string, fim: string) {
    return structuredClone(this.e(c).protocolos.filter((x) => x.incluidoEm >= inicio && x.incluidoEm < fim));
  }

  async protocoloDoPaciente(c: ContextoClassificacao, id: number) {
    const x = this.e(c).protocolos.find((p) => p.id === id);
    return x ? structuredClone(x) : null;
  }
}
