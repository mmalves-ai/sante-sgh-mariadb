// Porta EM MEMÓRIA do construtor de formulários novos (M45, etapa 1): a sessão sintética de dev/ci (E2E e testes da
// API). Versões, casos e a história SINTÉTICOS por estabelecimento, com as mesmas recusas das gravações SGH_ (código
// nunca repetido, versão vista, rascunho só no lugar, publicado imutável, quatro olhos, aposentar só o publicado). O
// modelo do prontuário não é criado aqui (a ponte é do executor, desligada): `executar` recusa.
import { randomUUID } from 'node:crypto';
import type {
  EspecialidadeLida,
  EventoFormNovoLido,
  EstadoFormNovoSgh,
  FormNovoLido,
  PerguntaDoBancoLegado,
} from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type {
  ContextoFormularioNovo,
  GravadorFormularioNovo,
  PortaFormularioNovo,
} from './formulario-novo-porta.js';

const recusa = (codigo: string, detalhe: string) =>
  new ErroProblema('recusa-de-negocio', 409, 'Não gravado', detalhe, { codigo });

/** Códigos de modelo do prontuário sintéticos (os mais usados da cópia, só os códigos). */
const CODIGOS_SINTETICOS = ['ENF021', 'MORSE', 'ENF02', 'ENF091', 'NUT01', 'EVAM', 'E08', 'M12'];

const BANCO_SINTETICO: PerguntaDoBancoLegado[] = [
  {
    id: 9001,
    descricao: 'Peso',
    tipoperg: '6',
    unidade: 'kg',
    ativo: true,
    opcoes: [],
    usoEmModelos: 12,
  },
  {
    id: 9002,
    descricao: 'Mobilidade',
    tipoperg: '13',
    unidade: null,
    ativo: true,
    opcoes: ['Acamado', 'Limitada', 'Deambula'],
    usoEmModelos: 3,
  },
  {
    id: 9003,
    descricao: 'Avaliado em',
    tipoperg: '2',
    unidade: null,
    ativo: true,
    opcoes: [],
    usoEmModelos: 5,
  },
];

const ESPECIALIDADES_SINTETICAS: EspecialidadeLida[] = [
  { codigo: 12, nome: 'Cardiologia' },
  { codigo: 40, nome: 'Clínica médica' },
  { codigo: 61, nome: 'Enfermagem' },
  { codigo: 77, nome: 'Nutrição' },
];

interface Estado {
  seq: number;
  versoes: FormNovoLido[];
  eventos: Map<number, EventoFormNovoLido[]>;
}

const p2 = (x: number) => String(x).padStart(2, '0');
const agora = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
};

export class PortaFormularioNovoMemoria implements PortaFormularioNovo {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  private e(c: ContextoFormularioNovo): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = { seq: 0, versoes: [], eventos: new Map() };
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  async podeGravar(): ReturnType<PortaFormularioNovo['podeGravar']> {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw recusa(
      'operacao-indisponivel',
      'O modelo do prontuário não é criado na sessão sintética: a versão publicada fica só neste sistema.',
    );
  }

  async gravarSgh<T>(
    c: ContextoFormularioNovo,
    _trilha: unknown,
    fn: (g: GravadorFormularioNovo) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const antes = { seq: s.seq, versoes: structuredClone(s.versoes), eventos: structuredClone(s.eventos) };
    const evento = (
      id: number,
      tipo: EventoFormNovoLido['tipo'],
      por: string,
      hash: string | null,
      texto: string | null,
    ) =>
      s.eventos.set(id, [...(s.eventos.get(id) ?? []), { tipo, por, em: agora(), contentHash: hash, texto }]);
    const trocar = (id: number, f: (v: FormNovoLido) => FormNovoLido) => {
      s.versoes = s.versoes.map((v) => (v.id === id ? f(v) : v));
    };
    const g: GravadorFormularioNovo = {
      salvar: async (p) => {
        const versaoLinha = randomUUID();
        const casos = p.casos.map((x, i) => ({ ordem: i + 1, caso: structuredClone(x.caso) }));
        if (p.id !== null) {
          const v = s.versoes.find((x) => x.id === p.id);
          if (!v) throw recusa('nao-encontrado', 'Formulário novo não encontrado neste estabelecimento.');
          if (v.estado === 'publicado' || v.estado === 'aposentado')
            throw recusa('imutavel', 'Versão publicada não se altera: crie uma nova versão a partir dela.');
          if (v.estado !== 'rascunho')
            throw recusa('estado-invalido', 'Em revisão: devolva ao rascunho antes de alterar.');
          if (p.versaoEsperada !== null && v.versaoLinha !== p.versaoEsperada)
            throw recusa(
              'versao-concorrente',
              'Outra pessoa salvou esta versão depois que você a abriu. Reabra para ver a versão atual.',
            );
          if (v.codigo !== p.codigo)
            throw recusa('codigo-mudou', 'O código de um formulário não muda depois de criado.');
          trocar(v.id, (x) => ({
            ...x,
            titulo: p.titulo,
            tipoRegistro: p.tipoRegistro,
            definicao: structuredClone(p.definicao),
            autor: p.autor,
            versaoLinha,
            atualizadoEm: agora(),
            casos,
          }));
          evento(v.id, 'salvo', p.autor, null, null);
          return { id: v.id, versao: v.versao, versaoLinha };
        }
        const doCodigo = s.versoes.filter((x) => x.codigo === p.codigo);
        if (p.baseadoEm !== null) {
          const b = s.versoes.find((x) => x.id === p.baseadoEm);
          if (!b) throw recusa('nao-encontrado', 'A versão de origem não existe neste estabelecimento.');
          if (b.estado !== 'publicado' && b.estado !== 'aposentado')
            throw recusa('estado-invalido', 'A versão nova parte de uma versão publicada.');
          if (b.codigo !== p.codigo)
            throw recusa('codigo-mudou', 'A versão nova mantém o código do formulário.');
          if (doCodigo.some((x) => x.estado === 'rascunho' || x.estado === 'revisao'))
            throw recusa(
              'versao-aberta',
              'Já há uma versão deste formulário em rascunho ou em revisão: continue nela.',
            );
        } else if (doCodigo.length > 0 || s.versoes.some((x) => x.codModelo === p.codigo))
          throw recusa('codigo-em-uso', `O código ${p.codigo} já é de outro formulário: escolha outro.`);
        const id = ++s.seq;
        const versao = doCodigo.reduce((m, x) => Math.max(m, x.versao), 0) + 1;
        s.versoes.push({
          id,
          codigo: p.codigo,
          versao,
          estado: 'rascunho',
          titulo: p.titulo,
          tipoRegistro: p.tipoRegistro,
          formato: p.formato,
          definicao: structuredClone(p.definicao),
          contentHash: null,
          ponte: 'so-sante',
          baseadoEm: p.baseadoEm,
          autor: p.autor,
          aprovadoPor: null,
          aprovadoEm: null,
          parecer: null,
          publicadoPor: null,
          publicadoEm: null,
          aposentadoPor: null,
          aposentadoEm: null,
          motivoAposentadoria: null,
          idModeloLegado: null,
          codModelo: null,
          versaoLinha,
          atualizadoEm: agora(),
          casos,
        });
        evento(id, 'salvo', p.autor, null, null);
        return { id, versao, versaoLinha };
      },
      mudar: async (m) => {
        const v = s.versoes.find((x) => x.id === m.id);
        if (!v) throw recusa('nao-encontrado', 'Formulário novo não encontrado neste estabelecimento.');
        const de: Record<string, EstadoFormNovoSgh> = {
          revisao: 'rascunho',
          aprovado: 'revisao',
          devolvido: 'revisao',
          publicado: 'revisao',
          aposentado: 'publicado',
        };
        const p = m.passo;
        if (v.estado !== de[p.tipo]) {
          if (p.tipo === 'aposentado') throw recusa('estado-invalido', 'Só a versão publicada é aposentada.');
          throw recusa(
            v.estado === 'publicado' || v.estado === 'aposentado' ? 'imutavel' : 'estado-invalido',
            'A versão mudou de situação depois de aberta. Reabra para ver a situação atual.',
          );
        }
        if (m.versaoEsperada !== null && v.versaoLinha !== m.versaoEsperada)
          throw recusa(
            'versao-concorrente',
            'Outra pessoa salvou esta versão depois que você a abriu. Reabra para ver a versão atual.',
          );
        const versaoLinha = randomUUID();
        const em = agora();
        // Quatro olhos (D-APROV-45): quem salvou qualquer alteração da versão não a aprova nem a publica.
        const escreveu = (conta: string) =>
          [v.autor, ...(s.eventos.get(v.id) ?? []).filter((x) => x.tipo === 'salvo').map((x) => x.por)].some(
            (a) => a.toUpperCase() === conta.toUpperCase(),
          );
        let hash: string | null = null;
        let texto: string | null = null;
        if (p.tipo === 'revisao')
          trocar(v.id, (x) => ({
            ...x,
            estado: 'revisao',
            aprovadoPor: null,
            aprovadoEm: null,
            parecer: null,
            versaoLinha,
          }));
        else if (p.tipo === 'aprovado') {
          if (escreveu(m.por)) throw recusa('aprovador-e-autor', 'Quem escreveu a versão não a aprova.');
          texto = p.parecer;
          trocar(v.id, (x) => ({
            ...x,
            aprovadoPor: m.por,
            aprovadoEm: em,
            parecer: p.parecer,
            versaoLinha,
          }));
        } else if (p.tipo === 'devolvido') {
          texto = p.parecer;
          trocar(v.id, (x) => ({
            ...x,
            estado: 'rascunho',
            aprovadoPor: null,
            aprovadoEm: null,
            parecer: p.parecer,
            versaoLinha,
          }));
        } else if (p.tipo === 'publicado') {
          if (v.aprovadoPor === null)
            throw recusa('sem-aprovacao', 'Falta a aprovação da comissão de prontuário.');
          if (escreveu(v.aprovadoPor))
            throw recusa('aprovador-e-autor', 'Quem escreveu a versão não a aprova.');
          if (escreveu(m.por)) throw recusa('publicador-e-autor', 'Quem escreveu a versão não a publica.');
          hash = p.contentHash;
          trocar(v.id, (x) => ({
            ...x,
            estado: 'publicado',
            contentHash: p.contentHash,
            ponte: p.ponte,
            publicadoPor: m.por,
            publicadoEm: em,
            idModeloLegado: p.idModeloLegado,
            codModelo: p.codModelo,
            versaoLinha,
          }));
        } else {
          texto = p.motivo;
          trocar(v.id, (x) => ({
            ...x,
            estado: 'aposentado',
            aposentadoPor: m.por,
            aposentadoEm: em,
            motivoAposentadoria: p.motivo,
            versaoLinha,
          }));
        }
        evento(v.id, p.tipo, m.por, hash, texto);
        return { versaoLinha };
      },
    };
    try {
      return await fn(g);
    } catch (x) {
      s.seq = antes.seq;
      s.versoes = antes.versoes;
      s.eventos = antes.eventos;
      throw x;
    }
  }

  async versoes(c: ContextoFormularioNovo) {
    return structuredClone(this.e(c).versoes).sort(
      (a, b) => a.codigo.localeCompare(b.codigo) || b.versao - a.versao,
    );
  }
  async versao(c: ContextoFormularioNovo, id: number) {
    const v = this.e(c).versoes.find((x) => x.id === id);
    return v ? structuredClone(v) : null;
  }
  async eventos(c: ContextoFormularioNovo, id: number) {
    return structuredClone(this.e(c).eventos.get(id) ?? []);
  }
  async codigosEmUso(c: ContextoFormularioNovo) {
    const s = new Set(CODIGOS_SINTETICOS);
    for (const v of this.e(c).versoes) {
      s.add(v.codigo.toUpperCase());
      if (v.codModelo) s.add(v.codModelo.toUpperCase());
    }
    return s;
  }
  async buscarPerguntas(_c: ContextoFormularioNovo, termo: string, tipos: readonly string[]) {
    const t = termo.trim().toUpperCase();
    return BANCO_SINTETICO.filter(
      (p) => p.descricao.toUpperCase().includes(t) && (tipos.length === 0 || tipos.includes(p.tipoperg)),
    );
  }
  async especialidades() {
    return ESPECIALIDADES_SINTETICAS;
  }
  async hoje() {
    return agora().slice(0, 10);
  }
  async dadosDoPlano(c: ContextoFormularioNovo, codigo: string, reusos: readonly number[]) {
    const codigosExistentes = await this.codigosEmUso(c);
    codigosExistentes.delete(codigo.toUpperCase());
    return {
      codigosExistentes,
      banco: BANCO_SINTETICO.filter((p) => reusos.includes(p.id)),
      respostasCadastradas: [],
    };
  }
}
