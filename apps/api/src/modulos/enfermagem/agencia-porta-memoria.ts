// Porta da agência transfusional (M47, etapa 2) EM MEMÓRIA: a sessão sintética de dev/ci (E2E). A requisição, a amostra
// e os atos vêm da agência da etapa 1 em memória (a mesma instância); a imuno-hematologia, as bolsas e os movimentos
// ficam aqui, com as mesmas recusas da gravação SGH_ (a requisição de outro paciente ou encerrada, a amostra ausente, a
// bolsa fora do estoque, a liberação pela mesma pessoa, a bolsa já recebida ou já usada num ato, a versão desatualizada,
// a máquina de situações, a reserva para requisição de outro hemocomponente ou além da quantidade). Nada é de pessoa
// real (marca "SINTETICO M47"); um exame de tipagem SINTÉTICO já lançado por paciente.
import {
  type BolsaEstoqueLida,
  type CadastrosDoEstoque,
  classeDoHemocomponente,
  type ExameImunoLancado,
  type FiltroEstoque,
  HEMOCOMPONENTES_VISTOS,
  type ImunoHematologiaLida,
  type MovimentoBolsaLido,
  type SituacaoBolsaEstoque,
  TIPO_CADASTRO_DO_MOVIMENTO,
  type TipoMovimentoBolsa,
  MENSAGENS_CORRECAO_HEMO,
  type VersaoBolsaLida,
} from '@sgh/contratos';
import {
  conferirMovimento,
  MENSAGENS_ESTOQUE,
  type ProvaCruzadaResumo,
  type ResultadoImunoResumo,
  temperaturaNaFaixaDoHemocomponente,
  TIPO_DO_MOVIMENTO,
  vencida,
  venceEm,
} from '@sgh/dominio-sadt';
import { type ContextoOperacao, type LiberacaoConsultada, recusa } from '@sgh/legado';
import type { ContextoAgencia, FiltroImunoPorta, GravadorAgencia, PortaAgencia } from './agencia-porta.js';
import type { PortaTransfusao } from './transfusao-porta.js';

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };
type Bolsa = Mutavel<Omit<BolsaEstoqueLida, 'vencida' | 'situacao' | 'ato' | 'reservadaPara'>> & {
  situacao: Exclude<SituacaoBolsaEstoque, 'transfundida'>;
  reserva: number | null;
  chave: string | null;
};
type Movimento = MovimentoBolsaLido & { bolsa: number; chave: string | null };
type Imuno = ImunoHematologiaLida & { chave: string | null };
interface Estado {
  seq: number;
  imunos: Imuno[];
  bolsas: Bolsa[];
  movimentos: Movimento[];
  /** W0-03: as versões anteriores das bolsas corrigidas. */
  versoes: (VersaoBolsaLida & { bolsa: number })[];
}

/** Os cadastros da agência na sessão sintética (a linha 0 "não informado", como no cadastro real). */
export const CADASTROS_ESTOQUE_SINTETICOS: CadastrosDoEstoque = Object.freeze({
  locais: [
    { codigo: 0, descricao: 'NAO INFORMADO' },
    { codigo: 1, descricao: 'GELADEIRA DE HEMOCOMPONENTES SINTETICO' },
    { codigo: 2, descricao: 'AGITADOR DE PLAQUETAS SINTETICO' },
    { codigo: 3, descricao: 'FREEZER DE PLASMA SINTETICO' },
  ],
  motivos: [
    { codigo: 0, descricao: 'NAO INFORMADO' },
    { codigo: 1, descricao: 'VENCIMENTO SINTETICO' },
    { codigo: 2, descricao: 'BOLSA ROMPIDA SINTETICO' },
    { codigo: 3, descricao: 'DEVOLUCAO AO HEMOCENTRO SINTETICO' },
  ],
  cortada: false,
});
const noCadastro = (lista: readonly { readonly codigo: number }[], codigo: number) =>
  lista.some((x) => x.codigo === codigo);

const aberta = (e: string) => ['requisitada', 'amostraColetada', 'emAtendimento'].includes(e);
const mesmo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export class PortaAgenciaMemoria implements PortaAgencia {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(
    private readonly transfusao: PortaTransfusao,
    private readonly relogio: (c: ContextoAgencia) => Promise<string>,
  ) {}

  private e(c: ContextoAgencia): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = { seq: 47_500, imunos: [], bolsas: [], movimentos: [], versoes: [] };
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  async podeGravar(): Promise<LiberacaoConsultada> {
    return { pode: true, codigo: null, motivo: null };
  }

  executar(c: ContextoAgencia, op: string, e: unknown, x: ContextoOperacao): never {
    void [c, e, x];
    throw new Error(`Operação ${op} sem simulação nesta porta.`);
  }

  private async atoDaBolsa(c: ContextoAgencia, numero: string): Promise<number | null> {
    const atos = await this.transfusao.atos(c, {});
    return atos.find((a) => a.bolsa.numero === numero)?.id ?? null;
  }

  async gravarSgh<T>(
    c: ContextoAgencia,
    _trilha: unknown,
    fn: (g: GravadorAgencia) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const agora = (await this.relogio(c)).slice(0, 16);
    const k = (chave: string | null, sufixo: string) => (chave ? `${c.hospital}:${chave}${sufixo}` : null);
    const mover = (
      b: Bolsa,
      tipo: TipoMovimentoBolsa,
      antes: SituacaoBolsaEstoque | null,
      depois: SituacaoBolsaEstoque,
      extra: {
        motivoCadastro?: number | null;
        motivo?: string | null;
        requisicao?: number | null;
        usuario: string;
        chave: string | null;
      },
    ) =>
      s.movimentos.push({
        id: ++s.seq,
        bolsa: b.id,
        tipo,
        situacaoAntes: antes,
        situacaoDepois: depois,
        tipoCadastro: TIPO_CADASTRO_DO_MOVIMENTO[tipo],
        motivoCadastro: extra.motivoCadastro ?? null,
        motivo: extra.motivo ?? null,
        requisicao: extra.requisicao ?? null,
        usuario: extra.usuario,
        em: agora,
        chave: extra.chave,
      });
    return fn({
      registrarImuno: async (x) => {
        const chave = k(x.chave, ':imuno');
        const ja = chave ? s.imunos.find((i) => i.chave === chave) : undefined;
        if (ja) return { id: ja.id, repetida: true };
        let amostra: string | null = null;
        if (x.requisicao !== null) {
          const q = await this.transfusao.requisicao(c, x.requisicao, agora);
          if (!q) throw recusa('nao-encontrada', 'A requisição transfusional não foi encontrada.');
          if (q.paciente.id !== x.paciente)
            throw recusa('paciente-diferente', 'A requisição é de outro paciente.');
          amostra = q.amostra?.codigo ?? null;
          if (x.tipo === 'provaCruzada') {
            if (!aberta(q.estado))
              throw recusa('requisicao-encerrada', 'A requisição está cancelada ou já atendida.');
            if (amostra === null) throw recusa('amostra-ausente', 'A requisição não tem amostra coletada.');
          }
        }
        if (x.tipo === 'provaCruzada' && !s.bolsas.some((b) => b.numero === x.bolsa))
          throw recusa('bolsa-fora-do-estoque', 'A bolsa não está no estoque da agência.');
        const id = ++s.seq;
        s.imunos.push({
          id,
          tipo: x.tipo,
          estado: 'registrado',
          paciente: x.paciente,
          requisicao: x.requisicao,
          amostra,
          metodo: x.metodo,
          origem: x.origem,
          tipagem: x.tipo === 'aboRh' ? (x.tipagem ?? { abo: null, rh: null }) : null,
          direta: x.tipo === 'aboRh' ? x.direta : null,
          reversa: x.tipo === 'aboRh' ? x.reversa : null,
          pai: x.tipo === 'pai' ? x.resultado : null,
          anticorpos: x.tipo === 'pai' ? x.anticorpos : null,
          bolsa: x.tipo === 'provaCruzada' ? x.bolsa : null,
          provaCruzada: x.tipo === 'provaCruzada' ? x.resultado : null,
          faseAntiglobulina: x.tipo === 'provaCruzada' ? x.faseAntiglobulina : null,
          exameLancado: x.exameLancado,
          observacao: x.observacao,
          registradoPor: x.usuario,
          registradoEm: agora,
          liberadoPor: null,
          liberadoEm: null,
          motivoInvalidacao: null,
          chave,
        });
        return { id, repetida: false };
      },
      liberarImuno: async (x) => {
        const i = s.imunos.find((y) => y.id === x.id);
        if (!i) throw recusa('nao-encontrado', 'O resultado não foi encontrado neste estabelecimento.');
        if (i.estado !== 'registrado')
          throw recusa(
            i.estado === 'liberado' ? 'ja-liberado' : 'invalidado',
            'O resultado não está a liberar.',
          );
        if (mesmo(i.registradoPor, x.usuario))
          throw recusa('mesmo-profissional', 'A liberação é de outro profissional.');
        if (i.tipo === 'aboRh' && (!i.tipagem?.abo || !i.tipagem.rh))
          throw recusa('tipagem-inconclusiva', 'A tipagem não é conclusiva: não pode ser liberada.');
        Object.assign(i, { estado: 'liberado', liberadoPor: x.usuario, liberadoEm: agora });
        return { id: i.id };
      },
      invalidarImuno: async (x) => {
        const i = s.imunos.find((y) => y.id === x.id);
        if (!i) throw recusa('nao-encontrado', 'O resultado não foi encontrado neste estabelecimento.');
        if (i.estado === 'invalidado') throw recusa('invalidado', 'O resultado já foi invalidado.');
        Object.assign(i, { estado: 'invalidado', motivoInvalidacao: x.motivo });
        return { id: i.id };
      },
      receberBolsa: async (x) => {
        const chave = k(x.chave, ':bolsa');
        const ja = chave ? s.bolsas.find((b) => b.chave === chave) : undefined;
        if (ja) return { id: ja.id, repetida: true };
        const numero = x.numero.trim().toUpperCase();
        if (s.bolsas.some((b) => b.numero === numero))
          throw recusa('bolsa-ja-recebida', MENSAGENS_ESTOQUE['bolsa-ja-recebida']!);
        if ((await this.atoDaBolsa(c, numero)) !== null)
          throw recusa('bolsa-ja-usada', 'Esta bolsa já foi usada em uma transfusão.');
        if (!noCadastro(CADASTROS_ESTOQUE_SINTETICOS.locais, x.local))
          throw recusa('local-inexistente', MENSAGENS_ESTOQUE['local-inexistente']!);
        const codigo = x.hemocomponente.trim().toUpperCase();
        const b: Bolsa = {
          id: ++s.seq,
          numero,
          hemocomponente: {
            codigo,
            rotulo: HEMOCOMPONENTES_VISTOS[codigo]?.rotulo ?? codigo,
            classe: classeDoHemocomponente(codigo),
          },
          tipagem: { abo: x.tipagem.abo, rh: x.tipagem.rh },
          volumeMl: x.volumeMl,
          validade: x.validade.slice(0, 16),
          origem: x.origem,
          local: x.local,
          irradiada: x.irradiada,
          leucorreduzida: x.leucorreduzida,
          temperaturaC: x.temperaturaC,
          inspecaoOk: x.inspecaoOk,
          recebidaEm: agora,
          recebidaPor: x.usuario,
          versao: 0,
          situacao: x.situacao,
          reserva: null,
          chave,
        };
        s.bolsas.push(b);
        mover(b, 'recebimento', null, x.situacao, { usuario: x.usuario, chave: null });
        return { id: b.id, repetida: false };
      },
      corrigirBolsa: async (x) => {
        const rec = (codigo: string) => recusa(codigo, MENSAGENS_CORRECAO_HEMO[codigo] ?? codigo);
        const b = s.bolsas.find((y) => y.id === x.bolsa);
        if (!b) throw recusa('nao-encontrada', 'A bolsa não foi encontrada neste estabelecimento.');
        if ((await this.atoDaBolsa(c, b.numero)) !== null) throw rec('bolsa-usada');
        if (b.situacao === 'descartada' || b.situacao === 'devolvida') throw rec('bolsa-baixada');
        if (b.situacao === 'reservada') throw rec('bolsa-reservada');
        if (b.versao !== x.versao) throw rec('bolsa-alterada');
        const numero = (x.numero ?? b.numero).trim().toUpperCase();
        const tipagem = x.tipagem ?? b.tipagem;
        const validade = x.validade ? x.validade.slice(0, 16) : b.validade;
        const volumeMl = x.volumeMl ?? b.volumeMl;
        if (
          numero === b.numero &&
          tipagem.abo === b.tipagem.abo &&
          tipagem.rh === b.tipagem.rh &&
          validade === b.validade &&
          volumeMl === b.volumeMl
        )
          throw rec('bolsa-sem-mudanca');
        if (
          numero !== b.numero &&
          (s.bolsas.some((y) => y.id !== b.id && y.numero === numero) ||
            (await this.atoDaBolsa(c, numero)) !== null)
        )
          throw rec('bolsa-numero-existente');
        const versao = s.versoes.filter((v) => v.bolsa === b.id).length + 1;
        s.versoes.push({
          bolsa: b.id,
          versao,
          numero: b.numero,
          tipagem: { ...b.tipagem },
          validade: b.validade,
          volumeMl: b.volumeMl,
          motivo: x.motivo,
          corrigidaPor: x.usuario,
          corrigidaEm: agora.slice(0, 16),
        });
        Object.assign(b, { numero, tipagem: { ...tipagem }, validade, volumeMl });
        b.versao += 1;
        return { id: b.id, numero, versao: versao + 1 };
      },
      movimentarBolsa: async (m) => {
        const b = s.bolsas.find((y) => y.id === m.bolsa);
        if (!b) throw recusa('bolsa-nao-encontrada', MENSAGENS_ESTOQUE['bolsa-nao-encontrada']!);
        const chave = k(m.chave, ':mov');
        if (chave && s.movimentos.some((x) => x.chave === chave))
          return { id: b.id, situacao: b.situacao, numero: b.numero, repetida: true };
        if (b.versao !== m.versao)
          throw recusa('versao-desatualizada', MENSAGENS_ESTOQUE['versao-desatualizada']!);
        const ato = await this.atoDaBolsa(c, b.numero);
        const antes: SituacaoBolsaEstoque = ato !== null ? 'transfundida' : b.situacao;
        const r = conferirMovimento({
          acao: m.acao,
          situacao: antes,
          vencida: vencida(b.validade, m.agora),
          inspecaoOk: b.inspecaoOk,
          temperaturaNaFaixa: temperaturaNaFaixaDoHemocomponente(b.hemocomponente.codigo, b.temperaturaC),
          inspecaoConferida: m.inspecaoConferida,
          motivo: m.motivo,
        });
        if (!r.para) {
          const cod = r.bloqueios[0] ?? 'movimento-invalido';
          throw recusa(cod, MENSAGENS_ESTOQUE[cod] ?? cod);
        }
        let reserva: number | null = null;
        if (m.acao === 'reservar') {
          const q = m.requisicao !== null ? await this.transfusao.requisicao(c, m.requisicao, agora) : null;
          if (!q) throw recusa('nao-encontrada', 'A requisição transfusional não foi encontrada.');
          if (!aberta(q.estado))
            throw recusa('requisicao-encerrada', MENSAGENS_ESTOQUE['requisicao-encerrada']!);
          if (q.hemocomponente.codigo !== b.hemocomponente.codigo)
            throw recusa(
              'requisicao-de-outro-hemocomponente',
              MENSAGENS_ESTOQUE['requisicao-de-outro-hemocomponente']!,
            );
          if (
            s.bolsas.filter((y) => y.reserva === q.id && y.situacao === 'reservada').length >=
            q.quantidadeBolsas
          )
            throw recusa('reserva-excedente', MENSAGENS_ESTOQUE['reserva-excedente']!);
          if (b.hemocomponente.classe === 'hemacias' && q.urgencia !== 'extremaUrgencia') {
            const provas = s.imunos.filter(
              (i) =>
                i.tipo === 'provaCruzada' &&
                i.estado === 'liberado' &&
                i.requisicao === q.id &&
                i.bolsa === b.numero,
            );
            const cod = provas.some((i) => i.provaCruzada === 'incompativel')
              ? 'prova-incompativel'
              : provas.some((i) => i.provaCruzada === 'compativel')
                ? null
                : 'prova-cruzada-pendente';
            if (cod) throw recusa(cod, MENSAGENS_ESTOQUE[cod]!);
          }
          reserva = q.id;
        }
        if (
          m.motivoCadastro !== null &&
          m.motivoCadastro !== 0 &&
          !noCadastro(CADASTROS_ESTOQUE_SINTETICOS.motivos, m.motivoCadastro)
        )
          throw recusa('motivo-inexistente', MENSAGENS_ESTOQUE['motivo-inexistente']!);
        const anterior = b.reserva;
        if (r.reinspecao) b.inspecaoOk = true;
        b.situacao = r.para as Bolsa['situacao'];
        b.reserva = reserva;
        b.versao += 1;
        mover(b, TIPO_DO_MOVIMENTO[m.acao], antes, r.para, {
          motivoCadastro: m.motivoCadastro,
          motivo: m.motivo,
          requisicao: m.acao === 'reservar' ? reserva : m.acao === 'cancelarReserva' ? anterior : null,
          usuario: m.usuario,
          chave,
        });
        return { id: b.id, situacao: r.para, numero: b.numero, repetida: false };
      },
    });
  }

  async imunos(c: ContextoAgencia, f: FiltroImunoPorta) {
    const itens = this.e(c)
      .imunos.filter(
        (i) =>
          (f.id === undefined || i.id === f.id) &&
          (!f.estado || i.estado === f.estado) &&
          (!f.tipo || i.tipo === f.tipo) &&
          (f.requisicao === undefined || i.requisicao === f.requisicao) &&
          (f.paciente === undefined || i.paciente === f.paciente),
      )
      .sort((a, b) => b.id - a.id)
      .map((i) => {
        const { chave, ...resto } = i;
        void chave;
        return resto;
      });
    return { itens, cortada: false };
  }

  async resultadosDoPaciente(c: ContextoAgencia, paciente: number): Promise<ResultadoImunoResumo[]> {
    return (await this.imunos(c, { paciente })).itens
      .filter((x) => x.tipo !== 'provaCruzada')
      .map((x) => ({
        tipo: x.tipo,
        estado: x.estado,
        tipagem: x.tipagem,
        pai: x.pai,
        anticorpos: x.anticorpos,
        liberadoEm: x.liberadoEm,
      }));
  }

  async provas(c: ContextoAgencia, requisicao: number): Promise<ProvaCruzadaResumo[]> {
    return (await this.imunos(c, { requisicao, tipo: 'provaCruzada' })).itens.map((x) => ({
      bolsa: x.bolsa ?? '',
      requisicao,
      estado: x.estado,
      resultado: x.provaCruzada ?? 'incompativel',
    }));
  }

  private async lida(c: ContextoAgencia, b: Bolsa, agora: string): Promise<BolsaEstoqueLida> {
    const ato = await this.atoDaBolsa(c, b.numero);
    const q = b.reserva !== null ? await this.transfusao.requisicao(c, b.reserva, agora) : null;
    const { chave, reserva, ...resto } = b;
    void [chave, reserva];
    return {
      ...resto,
      vencida: vencida(b.validade, agora),
      situacao: ato !== null ? 'transfundida' : b.situacao,
      reservadaPara: b.reserva !== null ? { requisicao: b.reserva, paciente: q?.paciente.id ?? 0 } : null,
      ato,
    };
  }

  async estoque(c: ContextoAgencia, f: FiltroEstoque & { readonly agora: string }) {
    const todas = await Promise.all(this.e(c).bolsas.map((b) => this.lida(c, b, f.agora)));
    const itens = todas
      .filter(
        (b) =>
          (!f.situacao || b.situacao === f.situacao) &&
          (!f.hemocomponente || b.hemocomponente.codigo === f.hemocomponente) &&
          (!f.abo || b.tipagem.abo === f.abo) &&
          (!f.rh || b.tipagem.rh === f.rh) &&
          (f.venceEmDias === undefined || venceEm(b.validade, f.agora, f.venceEmDias)) &&
          (!f.numero || b.numero.startsWith(f.numero)),
      )
      .sort((a, b) => a.validade.localeCompare(b.validade) || a.id - b.id);
    return { itens, cortada: false };
  }

  async bolsa(c: ContextoAgencia, k: { readonly id: number } | { readonly numero: string }, agora: string) {
    const b = this.e(c).bolsas.find((x) =>
      'id' in k ? x.id === k.id : x.numero === k.numero.trim().toUpperCase(),
    );
    return b ? this.lida(c, b, agora) : null;
  }

  async versoesBolsa(c: ContextoAgencia, bolsa: number): Promise<VersaoBolsaLida[]> {
    return this.e(c)
      .versoes.filter((v) => v.bolsa === bolsa)
      .map(({ bolsa: _b, ...v }) => (void _b, v));
  }

  async movimentos(c: ContextoAgencia, bolsa: number): Promise<MovimentoBolsaLido[]> {
    const s = this.e(c);
    const r: MovimentoBolsaLido[] = s.movimentos
      .filter((m) => m.bolsa === bolsa)
      .map((m) => {
        const { bolsa: b0, chave, ...resto } = m;
        void [b0, chave];
        return resto;
      });
    const b = s.bolsas.find((x) => x.id === bolsa);
    const atos = b ? (await this.transfusao.atos(c, {})).filter((a) => a.bolsa.numero === b.numero) : [];
    const a = atos[0];
    if (a)
      r.push({
        id: -a.id,
        tipo: 'transfusao',
        situacaoAntes: r.at(-1)?.situacaoDepois ?? null,
        situacaoDepois: 'transfundida',
        tipoCadastro: 3,
        motivoCadastro: null,
        motivo: null,
        requisicao: a.requisicao,
        usuario: a.profissional,
        em: a.inicioEm.slice(0, 16),
      });
    return r;
  }

  async cadastrosDoEstoque(): Promise<CadastrosDoEstoque> {
    return CADASTROS_ESTOQUE_SINTETICOS;
  }

  async examesLancados(_c: ContextoAgencia, prontuario: number, agora: string): Promise<ExameImunoLancado[]> {
    return [
      {
        id: 470_000 + (prontuario % 1000),
        exame: 'TIPS',
        nome: 'TIPAGEM SANGUINEA SINTETICO M47',
        data: agora.slice(0, 10),
      },
    ];
  }
}
